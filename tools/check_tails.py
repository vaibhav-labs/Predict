#!/usr/bin/env python3
"""Predict: works every item of the tail bank (app/content/questions/tails.json) out again, with SQL, from the tables. Shares no code with make_tails.py.

For each item it finds the case the text describes (a Seattle day, a flight, a month of the S&P 500), recomputes the class rate of the rare event among the OTHER cases,
and checks the item's base, n, answer and the percent written in its fact. It then applies the fairness test: a player who always says the likelier side at its base rate
must hit within 2 standard errors of what they expect, overall and in the tails (both pools), and no claim sits outside 1% to 15% / 85% to 99%.
"""
import csv
import json
import math
import os
import re
import sqlite3
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
T = os.path.join(ROOT, "data", "question_tables")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def load(db, name, table, cols):
    rows = list(csv.DictReader(open(os.path.join(T, name), encoding="utf-8")))
    db.execute(f"create table {table} ({', '.join(cols)})")
    db.executemany(f"insert into {table} values ({','.join('?' * len(cols))})", [[r[c] for c in cols] for r in rows])


def pct(x):
    return f"{int(x * 100 + 0.5)}%"


def main():
    d = json.load(open(os.path.join(ROOT, "app", "content", "questions", "tails.json"), encoding="utf-8"))
    qs = d["questions"]
    db = sqlite3.connect(":memory:")
    load(db, "seattle_weather.csv", "wx", ["date", "precip_mm", "temp_max_c", "temp_min_c"])
    load(db, "flights.csv", "fl", ["row", "departs", "origin", "destination", "distance_mi", "arrival_delay_min"])
    load(db, "airports.csv", "ap", ["iata", "city", "state"])
    load(db, "sp500_shiller.csv", "sp", ["month", "price", "cpi", "real_price"])
    errors = []

    def bad(q, msg):
        errors.append(f"{q['id']}: {msg}")

    # S&P monthly returns, then the class (after a rise / after a fall) of each month
    sp = db.execute("select month, cast(price as real) from sp order by month").fetchall()
    ret = {sp[i][0]: sp[i][1] / sp[i - 1][1] - 1 for i in range(1, len(sp))}
    months = [m for m, _ in sp]
    prior = {months[i]: ret[months[i - 1]] for i in range(2, len(months))}

    seen_cases = set()
    for q in qs:
        ask = q["ask"]
        ev, case_key = None, None
        if q["domain"] == "weather":
            m = re.match(r"(\d+) (\w+) (\d{4}):", q["fact"])
            day = f"{m.group(3)}-{MONTHS.index(m.group(2)) + 1:02d}-{int(m.group(1)):02d}"
            case_key = ("wx", day)
            sql = {"10 mm": "cast(precip_mm as real) >= 10", "20 mm": "cast(precip_mm as real) >= 20", "28 degrees": "cast(temp_max_c as real) >= 28", "freezing": "cast(temp_min_c as real) <= 0"}
            cond = next((v for k, v in sql.items() if k in ask), None)
            if cond is None:
                bad(q, "unknown weather event"); continue
            mon = day[5:7]
            n, k = db.execute(f"select count(*), sum({cond}) from wx where substr(date,6,2)=?", (mon,)).fetchone()
            own = db.execute(f"select ({cond}) from wx where date=?", (day,)).fetchone()[0]
            lead_ok = f"Seattle, {int(day[8:])} {MONTHS[int(mon) - 1]}." in q["lead"]
            if not lead_ok:
                bad(q, "lead does not match the day")
        elif q["domain"] == "travel":
            m = re.match(r"A flight from (.+) to (.+) \(([\d,]+) miles\), leaving on (\d+) (\w+) (\d{4}) in the (\w+)\.", q["lead"])
            oc, dc, mi, dd, mn, yy, part = m.groups()
            mi = mi.replace(",", "")
            date = f"{yy}-{MONTHS.index(mn) + 1:02d}-{int(dd):02d}"
            lo, hi = {"morning": (0, 11), "afternoon": (12, 16), "evening": (17, 23)}[part]
            rows = db.execute("select f.row, f.origin, f.arrival_delay_min from fl f join ap o on o.iata=f.origin join ap d on d.iata=f.destination "
                              "where o.city=? and d.city=? and f.distance_mi=? and substr(f.departs,1,10)=? and cast(substr(f.departs,12,2) as int) between ? and ?", (oc, dc, mi, date, lo, hi)).fetchall()
            mm = re.search(r"arrived (\d+) minutes (late|early)", q["fact"])
            delay = int(mm.group(1)) * (-1 if mm.group(2) == "early" else 1)
            rows = [r for r in rows if int(r[2]) == delay]
            if len(rows) < 1:
                bad(q, "no flight matches the lead"); continue
            fresh = [r for r in rows if ("fl", r[0]) not in seen_cases]  # two flights can match one description; each item takes one of them
            row, origin, _ = (fresh or rows)[0]
            case_key = ("fl", row)
            mins = 60 if "an hour" in ask else 120 if "two hours" in ask else 180 if "three hours" in ask else None
            if mins is None:
                bad(q, "unknown flight event"); continue
            n, k = db.execute("select count(*), sum(cast(arrival_delay_min as int) >= ?) from fl where origin=? and (case when cast(substr(departs,12,2) as int)<12 then 'morning' when cast(substr(departs,12,2) as int)<17 then 'afternoon' else 'evening' end)=?", (mins, origin, part)).fetchone()
            own = int(delay >= mins)
        else:
            m = re.match(r"The S&P 500, (\w+) (\d{4})\.", q["lead"])
            key = f"{m.group(2)}-{MONTHS.index(m.group(1)) + 1:02d}"
            case_key = ("sp", key)
            if key not in ret or key not in prior:
                bad(q, "month not found"); continue
            f = {"5%": (lambda r: r <= -0.05) if "falls 5%" in ask or "fall 5%" in ask else None,
                 "8%": (lambda r: r <= -0.08) if "8%" in ask and "fall" in ask else None,
                 "6%": (lambda r: r >= 0.06) if "6%" in ask else None}
            fn = f["5%"] if ("5%" in ask) else f["8%"] if ("8%" in ask) else f["6%"]
            if fn is None:
                bad(q, "unknown market event"); continue
            up = prior[key] > 0
            cl = [mm for mm in months[2:] if (prior[mm] > 0) == up]
            n, k = len(cl), sum(1 for mm in cl if fn(ret[mm]))
            own = int(fn(ret[key]))
        if case_key in seen_cases:
            bad(q, f"case {case_key} appears twice")
        seen_cases.add(case_key)
        p = (k - own) / (n - 1)
        is_event_claim = not re.search(r"(less than|does not|stays above|stays under)", ask, re.I)
        base = p if is_event_claim else 1 - p
        answer = bool(own) if is_event_claim else not own
        if abs(base - q["base"]) > 6e-5:
            bad(q, f"base {q['base']} but the table gives {base:.4f}")
        if q["n"] != n - 1:
            bad(q, f"n {q['n']} but the table gives {n - 1}")
        if answer != q["answer"]:
            bad(q, "answer disagrees with the table")
        if pct(p) not in q["fact"]:
            bad(q, f"the fact does not state {pct(p)}")
        if not (0.01 - 1e-9 <= p <= 0.15 + 1e-9):
            bad(q, f"class rate {p:.4f} is outside 1% to 15%")
        if re.search(r"claude|anthropic", json.dumps(q), re.I):
            bad(q, "banned word")
    # fairness
    out = []
    for pool in ("practice", "exam"):
        sub = [q for q in qs if q["pool"] == pool]
        like = [max(q["base"], 1 - q["base"]) for q in sub]
        hits = sum(1 for q in sub if (q["base"] >= 0.5) == q["answer"])
        z = (hits - sum(like)) / math.sqrt(sum(l * (1 - l) for l in like))
        out.append(f"{pool}: {len(sub)} items, a base-rate player expects {sum(like) / len(sub):.1%} and gets {hits / len(sub):.1%} (z={z:+.2f})")
        if abs(z) > 2:
            errors.append(f"{pool} pool is unfair to a base-rate player (z={z:+.2f})")
        if len({q["id"] for q in sub}) != len(sub):
            errors.append(f"{pool} has repeated ids")
    ids = [q["id"] for q in qs]
    if len(ids) != len(set(ids)):
        errors.append("repeated ids")
    if errors:
        print("tail bank problems:")
        print("\n".join(errors[:30]))
        sys.exit(1)
    print(f"tail bank ok: {len(qs)} items re-derived from the tables; " + "; ".join(out))


if __name__ == "__main__":
    main()

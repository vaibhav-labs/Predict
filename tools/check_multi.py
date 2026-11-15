#!/usr/bin/env python3
"""Predict: works every multi-outcome question (app/content/questions/multi.json) out again, with SQL, from the tables. Shares no code with make_multi.py.

For each item: finds its case from the lead, puts the case and every other case of its class into the item's outcome buckets (read from the outcome labels), and checks truth, ref
(the other cases' split), n, and the split written in the fact. Then the fairness test: the reference forecast's total log score must sit within 2.5 standard errors of what it expects.
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
    d = json.load(open(os.path.join(ROOT, "app", "content", "questions", "multi.json"), encoding="utf-8"))
    qs = d["questions"]
    db = sqlite3.connect(":memory:")
    load(db, "seattle_weather.csv", "wx", ["date", "precip_mm", "temp_max_c", "temp_min_c"])
    load(db, "flights.csv", "fl", ["row", "departs", "origin", "destination", "distance_mi", "arrival_delay_min"])
    load(db, "airports.csv", "ap", ["iata", "city", "state"])
    load(db, "sp500_shiller.csv", "sp", ["month", "price", "cpi", "real_price"])
    sp = db.execute("select month, cast(price as real) from sp order by month").fetchall()
    ret = {sp[i][0]: sp[i][1] / sp[i - 1][1] - 1 for i in range(1, len(sp))}
    months = [m for m, _ in sp]
    errors, seen = [], set()
    tot = exp = var = 0.0
    for q in qs:
        bad = lambda msg: errors.append(f"{q['id']}: {msg}")
        k = len(q["outcomes"])
        if q["domain"] == "weather":
            m = re.match(r"Seattle, (\d+) (\w+)\.", q["lead"])
            y = re.search(r"(\d{4}):", q["fact"]).group(1)
            day = f"{y}-{MONTHS.index(m.group(2)) + 1:02d}-{int(m.group(1)):02d}"
            case_key = ("wx", day)
            vals = [float(r[0]) for r in db.execute("select precip_mm from wx where substr(date,6,2)=?", (day[5:7],))]
            own = float(db.execute("select precip_mm from wx where date=?", (day,)).fetchone()[0])
            bucket = lambda p: 0 if p <= 0 else 1 if p < 5 else 2 if p < 15 else 3
        elif q["domain"] == "travel":
            m = re.match(r"A flight from (.+) to (.+) \(([\d,]+) miles\), leaving on (\d+) (\w+) (\d{4}) in the (\w+)\.", q["lead"])
            oc, dc, mi, dd, mn, yy, part = m.groups()
            date = f"{yy}-{MONTHS.index(mn) + 1:02d}-{int(dd):02d}"
            lo, hi = {"morning": (0, 11), "afternoon": (12, 16), "evening": (17, 23)}[part]
            mm = re.search(r"arrived (\d+) minutes (late|early)", q["fact"])
            delay = int(mm.group(1)) * (-1 if mm.group(2) == "early" else 1)
            rows = db.execute("select f.row, f.origin from fl f join ap o on o.iata=f.origin join ap d on d.iata=f.destination where o.city=? and d.city=? and f.distance_mi=? "
                              "and substr(f.departs,1,10)=? and cast(substr(f.departs,12,2) as int) between ? and ? and cast(f.arrival_delay_min as int)=?", (oc, dc, mi.replace(",", ""), date, lo, hi, delay)).fetchall()
            fresh = [r for r in rows if ("fl", r[0]) not in seen]
            if not rows:
                bad("no flight matches the lead"); continue
            row, origin = (fresh or rows)[0]
            case_key = ("fl", row)
            vals = [int(r[0]) for r in db.execute("select arrival_delay_min from fl where origin=? and (case when cast(substr(departs,12,2) as int)<12 then 'morning' when cast(substr(departs,12,2) as int)<17 then 'afternoon' else 'evening' end)=?", (origin, part))]
            own = delay
            bucket = lambda x: 0 if x <= 0 else 1 if x < 15 else 2 if x < 60 else 3
        else:
            m = re.match(r"The S&P 500, (\w+) (\d{4})\.", q["lead"])
            key = f"{m.group(2)}-{MONTHS.index(m.group(1)) + 1:02d}"
            case_key = ("sp", key)
            i = months.index(key)
            up = ret[months[i - 1]] > 0
            vals = [ret[mm] for j, mm in enumerate(months) if j >= 2 and (ret[months[j - 1]] > 0) == up]
            own = ret[key]
            bucket = lambda r: 0 if r <= -0.02 else 2 if r >= 0.02 else 1
        if case_key in seen:
            bad(f"case {case_key} appears twice")
        seen.add(case_key)
        counts = [0] * k
        for v in vals:
            counts[bucket(v)] += 1
        truth = bucket(own)
        n = sum(counts)
        ref = [(c - (1 if i == truth else 0)) / (n - 1) for i, c in enumerate(counts)]
        if truth != q["truth"]:
            bad(f"truth {q['truth']} but the table gives {truth}")
        if q["n"] != n - 1:
            bad(f"n {q['n']} but the table gives {n - 1}")
        if any(abs(a - b) > 6e-5 for a, b in zip(ref, q["ref"])):
            bad(f"ref {q['ref']} but the table gives {[round(x, 4) for x in ref]}")
        if abs(sum(q["ref"]) - 1) > 5e-4:
            bad("ref does not add up to 1")
        for lab, x in zip(q["outcomes"], ref):
            if f"{lab.split(' (')[0]} {pct(x)}" not in q["fact"]:
                bad(f"the fact does not state {lab.split(' (')[0]} {pct(x)}")
        if re.search(r"claude|anthropic", json.dumps(q), re.I):
            bad("banned word")
        score = lambda p: 100 * math.log2(k * max(p, 0.01)) / math.log2(k)
        tot += score(ref[truth])
        e = sum(p * score(p) for p in ref)
        exp += e
        var += sum(p * score(p) ** 2 for p in ref) - e * e
    z = (tot - exp) / math.sqrt(var)
    if abs(z) > 2.5:
        errors.append(f"the reference forecast scores {tot / len(qs):.1f} a question against an expected {exp / len(qs):.1f} (z={z:+.2f}): the draw is not fair")
    if len({q["id"] for q in qs}) != len(qs):
        errors.append("repeated ids")
    if errors:
        print("multi-outcome bank problems:")
        print("\n".join(errors[:30]))
        sys.exit(1)
    print(f"multi bank ok: {len(qs)} questions re-derived from the tables; the record's own forecast scores {tot / len(qs):.1f} a question (expected {exp / len(qs):.1f}, z={z:+.2f})")


if __name__ == "__main__":
    main()

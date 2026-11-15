#!/usr/bin/env python3
"""Check the Fermi bank (app/content/questions/fermi.json) against the tables with code that shares nothing with tools/make_fermi.py.

For every problem it finds the case by its key, works the parts and the whole out again with SQL (sqlite over the CSV records),
takes the reference interval's nearest-rank 5th and 95th percentiles with integer arithmetic, and compares with the file. It checks
truth = k x product of the parts, the shape of every problem, that the practice and exam pools share no case, that the reference
interval holds the truth about 90% of the time in each pool (a z-test), and that the file is exactly what the builder produces.
Python 3 standard library only. Exit 1 on any failure.
"""
import csv
import json
import math
import os
import sqlite3
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TABLES = os.path.join(ROOT, "data", "question_tables")
BANK = os.path.join(ROOT, "app", "content", "questions", "fermi.json")
FIELDS = ("id", "pool", "kind", "key", "lead", "ask", "unit", "scale", "digits", "truth", "mult", "parts", "ref_low", "ref_high", "ref_n", "domain", "fact", "why", "verified", "source", "src_name", "checked")
COUNTS = {"practice": {"fwx": 18, "fflight": 16, "fgrow": 18, "fmkt": 16}, "exam": {"fwx": 12, "fflight": 12, "fgrow": 12, "fmkt": 12}}
OWID = {"gdp": ("owid_gdp_per_person.csv", 0.25), "co2": ("owid_co2_per_person.csv", 0.3), "child": ("owid_child_mortality.csv", 0.25)}
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


def rows(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def pctile(vals, p):
    """Nearest-rank percentile with integer arithmetic: the ceil(p*n/100)-th smallest."""
    s = sorted(vals)
    k = max(1, (p * len(s) + 99) // 100)
    return s[k - 1]


db = sqlite3.connect(":memory:")
db.execute("create table w(d text, p real, hi real, lo real)")
db.executemany("insert into w values(?,?,?,?)", [(r["date"], float(r["precip_mm"]), float(r["temp_max_c"]), float(r["temp_min_c"])) for r in rows("seattle_weather.csv")])
db.execute("create table f(o text, mon int, delay int)")
db.executemany("insert into f values(?,?,?)", [(r["origin"], int(r["departs"][5:7]), int(r["arrival_delay_min"])) for r in rows("flights.csv")])
db.execute("create table m(ym text, price real)")
db.executemany("insert into m values(?,?)", [(r["month"], float(r["price"])) for r in rows("sp500_shiller.csv")])
db.execute("create table o(ind text, code text, y int, v real)")
for ind, (fn, _) in OWID.items():
    db.executemany("insert into o values(?,?,?,?)", [(ind, r["code"], int(r["year"]), float(r["value"])) for r in rows(fn)])


def rel(a, b):
    return abs(a - b) <= 1e-6 * max(1.0, abs(b))


def check_weather(q):
    start = q["key"]
    tot, k = db.execute("select sum(p), sum(p>0) from (select p from w where d >= ? order by d limit 14)", (start,)).fetchone()
    mean = tot / k
    check(rel(q["truth"], tot) and rel(q["parts"][0]["truth"], k) and rel(q["parts"][1]["truth"], mean), f"{q['id']}: the rain total or its parts differ from the record")
    # every other window (14 days, 1461 - 13 starts) with wet days, not overlapping, within twenty days of the date of the year
    starts = [r[0] for r in db.execute("select d from w order by d limit (select count(*) - 13 from w)")]
    ordinal = {d: i for i, d in enumerate(r[0] for r in db.execute("select d from w order by d"))}
    doy = {r[0]: int(r[1]) for r in db.execute("select d, strftime('%j', d) from w")}
    vals = []
    for s in starts:
        if abs(ordinal[s] - ordinal[start]) < 14:
            continue
        gap = abs(doy[s] - doy[start])
        if min(gap, 366 - gap) > 20:
            continue
        t2, k2 = db.execute("select sum(p), sum(p>0) from (select p from w where d >= ? order by d limit 14)", (s,)).fetchone()
        if k2:
            vals.append(math.log10(t2))
    return vals, 0, 1


def check_flight(q):
    o, _, mon = q["key"].split(":")
    n, late, tot = db.execute("select count(*), sum(delay>=15), sum(case when delay>=15 then delay else 0 end) from f where o=? and mon=?", (o, int(mon))).fetchone()
    check(rel(q["truth"], tot) and rel(q["parts"][0]["truth"], n) and rel(q["parts"][1]["truth"], 100 * late / n) and rel(q["parts"][2]["truth"], tot / late), f"{q['id']}: the lateness total or its parts differ from the record")
    vals = [math.log10(t) for (nn, ll, t) in db.execute("select count(*), sum(delay>=15), sum(case when delay>=15 then delay else 0 end) from f group by o, mon") if False]
    vals = []
    for (oo, mm, nn, ll, tt) in db.execute("select o, mon, count(*), sum(delay>=15), sum(case when delay>=15 then delay else 0 end) from f group by o, mon"):
        if (oo, mm) != (o, int(mon)) and nn >= 15 and ll >= 3:
            vals.append(math.log10(tt))
    return vals, 0, 1


def check_grow(q):
    ind, code, t = q["key"].split(":")
    t = int(t)
    v = {y: x for y, x in db.execute("select y, v from o where ind=? and code=?", (ind, code))}
    a, b, e = v[t], v[t + 10], v[t + 20]
    check(rel(q["truth"], e) and rel(q["mult"], a) and rel(q["parts"][0]["truth"], b / a) and rel(q["parts"][1]["truth"], e / b), f"{q['id']}: the growth figures differ from the record")
    tol = OWID[ind][1]
    vals = []
    for c2, t2 in db.execute("select code, y from o where ind=? and y in (1990, 2000)", (ind,)).fetchall():
        if (c2, t2) == (code, t):
            continue
        w = {y: x for y, x in db.execute("select y, v from o where ind=? and code=?", (ind, c2))}
        if t2 + 10 in w and t2 + 20 in w and min(w[t2], w[t2 + 10], w[t2 + 20]) > 0 and abs(math.log(w[t2] / a)) <= tol:
            vals.append(math.log10(w[t2 + 20] / w[t2]))
    return vals, a, 2


def check_market(q):
    ym = q["key"]
    series = [x for x in db.execute("select ym, price from m order by ym")]
    idx = [i for i, (k, _) in enumerate(series) if k == ym][0]
    a, p3, p6, p9 = (series[idx + j][1] for j in (0, 36, 72, 108))
    check(rel(q["truth"], 1000 * p9 / a) and rel(q["parts"][0]["truth"], p3 / a) and rel(q["parts"][1]["truth"], p6 / p3) and rel(q["parts"][2]["truth"], p9 / p6), f"{q['id']}: the market figures differ from the record")
    vals = [math.log10(series[j + 108][1] / series[j][1]) for j in range(len(series) - 108) if abs(j - idx) > 108]
    return vals, 1000, 3


def main():
    doc = json.load(open(BANK, encoding="utf-8"))
    qs = doc["questions"]
    check(doc["count"] == len(qs) == 116, f"expected 116 problems, found {len(qs)}")
    cover = {"practice": [], "exam": []}
    for q in qs:
        check(set(q) == set(FIELDS), f"{q.get('id')}: fields differ from the schema")
        check(q["scale"] == "log" and q["truth"] > 0 and 2 <= len(q["parts"]) <= 4, f"{q['id']}: shape")
        prod = q["mult"]
        for p in q["parts"]:
            prod *= p["truth"]
            check(p["truth"] > 0 and p["label"] and p["hint"] and p["unit"], f"{q['id']}: a part is incomplete")
        check(rel(prod, q["truth"]), f"{q['id']}: truth is not k times the product of the parts")
        text = json.dumps(q).lower()
        check("claude" not in text and "anthropic" not in text, f"{q['id']}: names the assistant")
        check(q["ref_low"] < q["ref_high"] and q["ref_n"] >= 25, f"{q['id']}: reference interval")
        fn = {"fwx": check_weather, "fflight": check_flight, "fgrow": check_grow, "fmkt": check_market}[q["kind"]]
        vals, base, _ = fn(q)
        check(len(vals) == q["ref_n"], f"{q['id']}: {len(vals)} comparison cases, the file says {q['ref_n']}")
        lo, hi = pctile(vals, 5), pctile(vals, 95)
        if q["kind"] in ("fgrow", "fmkt"):
            lo, hi = base * 10 ** lo, base * 10 ** hi
        else:
            lo, hi = 10 ** lo, 10 ** hi
        digits = q["digits"] + 2
        check(round(lo, digits) == q["ref_low"] and round(hi, digits) == q["ref_high"], f"{q['id']}: reference interval {q['ref_low']}..{q['ref_high']} should be {round(lo, digits)}..{round(hi, digits)}")
        cover[q["pool"]].append(q["ref_low"] <= q["truth"] <= q["ref_high"])
    for pool, want in COUNTS.items():
        for kind, n in want.items():
            got = sum(1 for q in qs if q["pool"] == pool and q["kind"] == kind)
            check(got == n, f"{pool} {kind}: {got} problems, expected {n}")
    keys = {}
    for q in qs:
        keys.setdefault(q["key"], set()).add(q["pool"])
    check(all(len(v) == 1 for v in keys.values()), "the practice and exam pools share a case")
    check(len({q["id"] for q in qs}) == len(qs), "duplicate ids")
    msgs = []
    for pool, hits in cover.items():
        n = len(hits)
        z = (sum(hits) / n - 0.9) / math.sqrt(0.09 / n)
        check(abs(z) < 2.0, f"{pool} pool: the reference interval holds the truth {100 * sum(hits) / n:.1f}% of the time (z={z:+.2f}), the bank is not fair to a player who knows the record")
        msgs.append(f"{pool}: {n} problems, reference interval holds the truth {100 * sum(hits) / n:.1f}% (z={z:+.2f})")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_fermi.py"), "--check"], capture_output=True, text=True)
    check(r.returncode == 0, "fermi.json is not what tools/make_fermi.py produces from the tables")
    if fails:
        print("\n".join("FAIL " + f for f in fails[:40]))
        print(f"{len(fails)} failures")
        sys.exit(1)
    print("fermi bank: " + "; ".join(msgs) + "; every part, truth and reference interval re-derived from the records")


if __name__ == "__main__":
    main()

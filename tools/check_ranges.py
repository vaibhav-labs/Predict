#!/usr/bin/env python3
"""Check the range bank (app/content/questions/ranges.json) against the tables, with code that shares nothing with tools/make_ranges.py.

For every question it finds the case by its key, rebuilds the comparison set with SQL (not lists), takes the nearest-rank 5th and
95th percentiles with integer arithmetic, and compares them with the file; it checks the truth, the shape of every question, that
the practice and exam pools share no case, that the reference interval holds the truth about 90% of the time (a z-test, so the bank
cannot be one a player who knows the record would find unfair), and that the file is exactly what the builder produces.
Python 3 standard library only. Exit 1 on any failure.
"""
import csv
import json
import math
import os
import re
import sqlite3
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TABLES = os.path.join(ROOT, "data", "question_tables")
BANK = os.path.join(ROOT, "app", "content", "questions", "ranges.json")
FIELDS = ("id", "pool", "kind", "key", "lead", "ask", "unit", "scale", "digits", "truth", "ref_low", "ref_high", "ref_n", "domain", "fact", "why", "verified", "source", "src_name", "checked")
TOL = {"life": 0.2, "fert": 0.25, "renew": 0.3, "child": 0.25, "co2": 0.3, "gdp": 0.25}
FILES = {"life": "owid_life_expectancy.csv", "fert": "owid_fertility.csv", "renew": "owid_renewables_share.csv", "child": "owid_child_mortality.csv", "co2": "owid_co2_per_person.csv", "gdp": "owid_gdp_per_person.csv"}
LOG = {"child", "co2", "gdp"}
COUNTS = {"practice": 200, "exam": 180}


def table(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def nearest(sorted_vals, p_num):
    """The ceil(p/100 * n)-th smallest value, by integer arithmetic."""
    n = len(sorted_vals)
    k = -(-p_num * n // 100)
    return sorted_vals[max(1, k) - 1]


def build_db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE wx (d TEXT PRIMARY KEY, p REAL, hi REAL)")
    db.executemany("INSERT INTO wx VALUES (?,?,?)", [(r["date"], float(r["precip_mm"]), float(r["temp_max_c"])) for r in table("seattle_weather.csv")])
    db.execute("CREATE TABLE fl (row INTEGER PRIMARY KEY, mi INTEGER, delay INTEGER)")
    db.executemany("INSERT INTO fl VALUES (?,?,?)", [(int(r["row"]), int(r["distance_mi"]), int(r["arrival_delay_min"])) for r in table("flights.csv")])
    db.execute("CREATE TABLE sp (seq INTEGER PRIMARY KEY, month TEXT, price REAL)")
    db.executemany("INSERT INTO sp (month, price) VALUES (?,?)", [(r["month"], float(r["price"])) for r in table("sp500_shiller.csv")])
    for ind, name in FILES.items():
        db.execute(f"CREATE TABLE ow_{ind} (code TEXT, year INTEGER, value REAL)")
        db.executemany(f"INSERT INTO ow_{ind} VALUES (?,?,?)", [(r["code"], int(r["year"]), float(r["value"])) for r in table(name)])
        db.execute(f"""CREATE VIEW win_{ind} AS SELECT a.code AS code, b.year AS t, a.value AS a, b.value AS b FROM ow_{ind} a JOIN ow_{ind} b ON b.code = a.code AND b.year = a.year + 5
                       WHERE b.year BETWEEN 1995 AND 2020 AND (b.year - 1995) % 5 = 0 AND a.value > 0 AND b.value > 0""")
    return db


def derive(db, q):
    """(truth, ref_low, ref_high, n) for a question, from its kind and key."""
    kind, key = q["kind"], q["key"]
    if kind == "wtemp":
        truth, prior = db.execute("SELECT t.hi, y.hi FROM wx t JOIN wx y ON y.d = date(t.d, '-1 day') WHERE t.d = ?", (key,)).fetchone()
        rows = db.execute("""SELECT o.hi FROM wx o JOIN wx py ON py.d = date(o.d, '-1 day') WHERE o.d <> ?
                             AND ABS(py.hi - ?) <= 3.0
                             AND MIN(ABS(CAST(strftime('%j', o.d) AS INTEGER) - CAST(strftime('%j', ?) AS INTEGER)), 366 - ABS(CAST(strftime('%j', o.d) AS INTEGER) - CAST(strftime('%j', ?) AS INTEGER))) <= 10""",
                          (key, prior, key, key)).fetchall()
        v = sorted(r[0] for r in rows)
        return truth, nearest(v, 5), nearest(v, 95), len(v)
    if kind == "wprecip":
        truth = db.execute("SELECT p FROM wx WHERE d = ?", (key,)).fetchone()[0]
        rows = db.execute("""SELECT o.p FROM wx o JOIN wx py ON py.d = date(o.d, '-1 day') WHERE o.d <> ? AND py.p > 0
                             AND MIN(ABS(CAST(strftime('%j', o.d) AS INTEGER) - CAST(strftime('%j', ?) AS INTEGER)), 366 - ABS(CAST(strftime('%j', o.d) AS INTEGER) - CAST(strftime('%j', ?) AS INTEGER))) <= 15""",
                          (key, key, key)).fetchall()
        v = sorted(r[0] for r in rows)
        return truth, nearest(v, 5), nearest(v, 95), len(v)
    if kind == "flight":
        mi, truth = db.execute("SELECT mi, delay FROM fl WHERE row = ?", (int(key),)).fetchone()
        v = sorted(r[0] for r in db.execute("SELECT delay FROM fl WHERE row <> ? AND ABS(mi - ?) <= 0.25 * ?", (int(key), mi, mi)))
        return truth, nearest(v, 5), nearest(v, 95), len(v)
    if kind in FILES:
        code, t = key.split(":")
        a, truth = db.execute(f"SELECT a, b FROM win_{kind} WHERE code = ? AND t = ?", (code, int(t))).fetchone()
        rows = db.execute(f"SELECT a, b FROM win_{kind} WHERE NOT (code = ? AND t = ?) AND a / ? BETWEEN ? AND ?", (code, int(t), a, math.exp(-TOL[kind]), math.exp(TOL[kind]))).fetchall()
        if kind in LOG:
            v = sorted(math.log10(y / x) for x, y in rows)
            return truth, a * 10 ** nearest(v, 5), a * 10 ** nearest(v, 95), len(v)
        v = sorted(y - x for x, y in rows)
        return truth, a + nearest(v, 5), a + nearest(v, 95), len(v)
    if kind == "market":
        seq, price = db.execute("SELECT seq, price FROM sp WHERE month = ?", (key,)).fetchone()
        later = db.execute("SELECT price FROM sp WHERE seq = ?", (seq + 12,)).fetchone()[0]
        last = db.execute("SELECT MAX(seq) FROM sp").fetchone()[0]
        v = sorted(math.log10(db.execute("SELECT price FROM sp WHERE seq = ?", (j + 12,)).fetchone()[0] / p0) for j, p0 in db.execute("SELECT seq, price FROM sp WHERE seq <= ? AND ABS(seq - ?) > 12", (last - 12, seq)))
        return later, price * 10 ** nearest(v, 5), price * 10 ** nearest(v, 95), len(v)
    raise ValueError(kind)


def entity(q):
    """What a case is, so no case is in both pools: a day, a flight, a country and indicator, a year."""
    k = q["kind"]
    if k in ("wtemp", "wprecip"):
        return "wx:" + q["key"]
    if k == "flight":
        return "fl:" + q["key"]
    if k in FILES:
        return f"tr:{k}:{q['key'].split(':')[0]}"
    return "mk:" + q["key"][:4]


def check():
    errors, notes = [], []
    try:
        doc = json.load(open(BANK, encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [f"ranges.json cannot be read: {e}"], notes
    qs = doc.get("questions", [])
    db = build_db()
    ids = set()
    for q in qs:
        where = q.get("id", "?")
        missing = [f for f in FIELDS if f not in q]
        if missing:
            errors.append(f"{where}: missing {missing}")
            continue
        if q["id"] in ids:
            errors.append(f"{where}: duplicate id")
        ids.add(q["id"])
        if q["pool"] not in COUNTS or q["scale"] not in ("linear", "log") or q["verified"] != "recorded" or q["domain"] not in ("weather", "travel", "world", "money"):
            errors.append(f"{where}: pool, scale, verified or domain is wrong")
        if not re.match(r"^https://", q["source"]) or not q["src_name"] or not re.match(r"^\d{4}-\d{2}-\d{2}$", q["checked"]):
            errors.append(f"{where}: needs an https source, a source name and the day it was read")
        if re.search(r"claude|anthropic", json.dumps(q, ensure_ascii=False), re.I):
            errors.append(f"{where}: the builder's name must not appear in the app")
        if not (q["ref_low"] < q["ref_high"]) or (q["scale"] == "log" and (q["ref_low"] <= 0 or q["truth"] <= 0)):
            errors.append(f"{where}: the reference interval is not a range, or a log question has a value of zero or less")
        if q["ref_n"] < 25:
            errors.append(f"{where}: only {q['ref_n']} cases behind the reference")
        try:
            truth, lo, hi, n = derive(db, q)
        except Exception as e:  # a key that finds no case
            errors.append(f"{where}: cannot find its case ({q['kind']} {q['key']}): {e}")
            continue
        d = q["digits"] + 2
        if abs(truth - q["truth"]) > 1e-9:
            errors.append(f"{where}: truth is {q['truth']}, the record says {truth}")
        if n != q["ref_n"] or abs(round(lo, d) - q["ref_low"]) > 1e-9 or abs(round(hi, d) - q["ref_high"]) > 1e-9:
            errors.append(f"{where}: reference {q['ref_low']}..{q['ref_high']} from {q['ref_n']} cases, worked out again {round(lo, d)}..{round(hi, d)} from {n}")
        if f"{n:,}" not in q["fact"]:
            errors.append(f"{where}: the reveal does not quote the number of cases behind the reference")
    for pool, want in COUNTS.items():
        have = [q for q in qs if q.get("pool") == pool]
        if len(have) != want:
            errors.append(f"{pool} pool: expected {want} questions, found {len(have)}")
        if have:
            hit = sum(1 for q in have if q["ref_low"] <= q["truth"] <= q["ref_high"])
            z = (hit - 0.9 * len(have)) / math.sqrt(len(have) * 0.09)
            if abs(z) > 3:
                errors.append(f"{pool} pool: the reference interval holds the truth {hit} times in {len(have)} (z={z:+.2f}): a player who knows the record would be miscalibrated")
            notes.append(f"{pool} pool: {len(have)} ranges, the reference interval holds the truth {hit / len(have):.1%} of the time (z={z:+.2f}); {len({q['kind'] for q in have})} kinds")
    shared = {entity(q) for q in qs if q.get("pool") == "practice"} & {entity(q) for q in qs if q.get("pool") == "exam"}
    if shared:
        errors.append(f"practice and exam pools share cases: {sorted(shared)[:3]}")
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    try:
        import make_ranges
        if make_ranges.render(make_ranges.build()) != open(BANK, encoding="utf-8").read():
            errors.append("ranges.json is not what the tables produce: run python3 tools/make_ranges.py and commit the result")
    except SystemExit as e:
        errors.append(f"the range builder could not run: {e}")
    return errors, notes


def main():
    errors, notes = check()
    for n in notes:
        print(n)
    if errors:
        print("RANGE BANK CHECK FAILED")
        for e in errors[:40]:
            print("  -", e)
        sys.exit(1)
    print("range bank check passed")


if __name__ == "__main__":
    main()

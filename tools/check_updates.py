#!/usr/bin/env python3
"""Check the Unit 6 bank (app/content/questions/updates.json) against the tables with code that shares nothing with tools/make_updates.py.

Every group in every stream (the starting group, the group after the first news, the group after the second) is counted again with SQL
over the CSV records: its case count and the share that ended the way the question asks. Each step's prior must be the previous group's
share and each truth the next group's; every group holds at least 60 cases; the pool sizes; that the practice and exam pools never ask the
same first step (same starting group and first news) and share no stream; that the moves are balanced (strong 8+ points, medium 3 to 8,
weak under 3); that no text names the assistant; and that the file is exactly what the builder produces. Python 3 standard library only.
Exit 1 on any failure.
"""
import csv
import json
import os
import sqlite3
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TABLES = os.path.join(ROOT, "data", "question_tables")
BANK = os.path.join(ROOT, "app", "content", "questions", "updates.json")
MIN_CASES = json.load(open(os.path.join(ROOT, "data", "scoring.json")))["problems"]["update"]["min_cases"]
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


def rows(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


db = sqlite3.connect(":memory:")
db.execute("create table f(o text, mon int, hour int, dow int, mi int, delay int)")
db.executemany("insert into f values(?,?,?,cast(strftime('%w', ?) as int),?,?)",
               [(r["origin"], int(r["departs"][5:7]), int(r["departs"][11:13]), r["departs"][:10], int(r["distance_mi"]), int(r["arrival_delay_min"])) for r in rows("flights.csv")])
db.execute("create table w(y int, mon int, p real, pp real, phi real)")
wr = rows("seattle_weather.csv")
db.executemany("insert into w values(?,?,?,?,?)", [(int(r["date"][:4]), int(r["date"][5:7]), float(r["precip_mm"]), float(wr[i - 1]["precip_mm"]), float(wr[i - 1]["temp_max_c"])) for i, r in enumerate(wr) if i])

DIST = {"under 300 miles": "mi < 300", "300 to 599 miles": "mi >= 300 and mi < 600", "600 to 999 miles": "mi >= 600 and mi < 1000", "1,000 to 1,499 miles": "mi >= 1000 and mi < 1500", "1,500 miles or more": "mi >= 1500"}
HOUR = {"morning": "hour < 10", "midday": "hour >= 10 and hour < 15", "evening": "hour >= 15 and hour < 20", "night": "hour >= 20"}
SEASON = {"winter": "(12, 1, 2)", "spring": "(3, 4, 5)", "summer": "(6, 7, 8)", "autumn": "(9, 10, 11)"}


def where(kind, key):
    a, b = key.split(":", 1)
    if kind == "flight":
        return {"o": lambda: f"o = '{b}'", "m": lambda: f"mon = {int(b)}", "h": lambda: HOUR[b], "d": lambda: DIST[b], "w": lambda: "dow between 1 and 5" if b == "wd" else "dow in (0, 6)"}[a]()
    return {"s": lambda: f"mon in {SEASON[b]}", "m": lambda: f"mon = {int(b)}", "p": lambda: "pp > 0" if b == "wet" else "pp = 0", "t": lambda: "phi >= 15" if b == "warm" else "phi < 15", "y": lambda: f"y = {int(b)}"}[a]()


def share(kind, keys):
    table, ev = ("f", "delay >= 15") if kind == "flight" else ("w", "p > 0")
    n, k = db.execute(f"select count(*), coalesce(sum({ev}), 0) from {table} where " + " and ".join(f"({where(kind, k)})" for k in keys)).fetchone()
    return n, k


p1 = lambda a, b: round(100.0 * a / b + 1e-9, 1)
cat = lambda d: "strong" if abs(d) >= 8 - 1e-9 else "medium" if abs(d) >= 3 - 1e-9 else "weak"


def main():
    doc = json.load(open(BANK, encoding="utf-8"))
    qs = doc["questions"]
    check(doc["count"] == len(qs), "count differs from the questions listed")
    pools = {p: [q for q in qs if q["pool"] == p] for p in ("practice", "exam")}
    check(len(pools["exam"]) == 60, f"exam pool has {len(pools['exam'])} streams, expected 60")
    check(len(pools["practice"]) >= 80, f"practice pool has {len(pools['practice'])} streams, expected at least 80")
    check(len(qs) == len(pools["practice"]) + len(pools["exam"]), "unexpected pool names in the file")
    moves = {"practice": {"strong": 0, "medium": 0, "weak": 0}, "exam": {"strong": 0, "medium": 0, "weak": 0}}
    firsts = {"practice": set(), "exam": set()}
    for q in qs:
        text = json.dumps(q).lower()
        check("claude" not in text and "anthropic" not in text, f"{q['id']}: names the assistant")
        check(q["type"] == "update" and q["lead"] and q["ask"] and q["why"] and q["fact"] and q["source"].startswith("http") and q["jdomain"] in ("work", "life", "world"), f"{q['id']}: incomplete")
        kind, c0, c1, c2 = q["key"].split("|")[0].split(":")[0], *q["key"].split(":", 1)[1].split("|")
        keys = [c0, c1, c2]
        check(q["kind"] == kind and kind in ("flight", "weather"), f"{q['id']}: kind")
        check(len(q["steps"]) == 2, f"{q['id']}: a stream has two steps")
        n0, k0 = share(kind, keys[:1])
        check(n0 >= MIN_CASES and q["prior0"] == p1(k0, n0), f"{q['id']}: starting group should be {p1(k0, n0)}% of {n0}, the file says {q['prior0']}")
        prior, nprev = p1(k0, n0), n0
        for i, s in enumerate(q["steps"]):
            n, k = share(kind, keys[: i + 2])
            check(n >= MIN_CASES, f"{q['id']} step {i + 1}: only {n} cases")
            check(s["n"] == n and s["k"] == k and s["truth"] == p1(k, n), f"{q['id']} step {i + 1}: should be {p1(k, n)}% of {n}, the file says {s['truth']}% of {s['n']}")
            check(s["prior"] == prior and s["n_prior"] == nprev, f"{q['id']} step {i + 1}: the prior should be the previous group's {prior}% of {nprev}")
            check(0 < s["truth"] < 100 and s["news"] and s["fact"] and s["why"], f"{q['id']} step {i + 1}: bad truth, news, fact or why")
            check(len(s["known"]) == i and f"{p1(k, n)}".split(".")[0] in s["fact"] and f"{n:,}" in s["fact"], f"{q['id']} step {i + 1}: the fact line does not carry the counted numbers")
            moves[q["pool"]][cat(s["truth"] - s["prior"])] += 1
            prior, nprev = p1(k, n), n
        firsts[q["pool"]].add(tuple(keys[:2]))
        check(len(set(keys)) == 3, f"{q['id']}: repeated group")
    ids = [q["id"] for q in qs]
    check(len(set(ids)) == len(ids), "duplicate ids")
    check(len({q["key"] for q in qs}) == len(qs), "a stream appears twice")
    check(not (firsts["exam"] & firsts["practice"]), "the practice and exam pools ask the same first step")
    for p, m in moves.items():
        tot = sum(m.values())
        check(tot > 0 and all(0.2 <= v / tot <= 0.45 for v in m.values()), f"{p}: the moves are not balanced: {m}")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_updates.py"), "--check"], capture_output=True, text=True)
    check(r.returncode == 0, "updates.json is not what tools/make_updates.py produces from the tables")
    if fails:
        print("\n".join("FAIL " + f for f in fails[:40]))
        print(f"{len(fails)} failures")
        sys.exit(1)
    print(f"updates bank: {len(pools['practice'])} practice and {len(pools['exam'])} exam streams (two steps each); every group counted again from the records; moves {moves['exam']} in the exam")


if __name__ == "__main__":
    main()

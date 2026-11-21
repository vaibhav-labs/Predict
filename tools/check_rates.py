#!/usr/bin/env python3
"""Check the Unit 5 bank (app/content/questions/rates.json) against the tables with code that shares nothing with tools/make_rates.py.

Every recorded share, every rung of every reference-class ladder (its case count and its rate), the right rung (the narrowest that
still holds 30 or more cases), and every chain (each step's rate among the cases that passed the one before, and the joint share)
is counted again with SQL over the CSV records. Documented base rates are compared with data/question_tables/base_rates.csv.
Also checks the shape of every problem, the pool sizes, that the practice and exam pools share no case, that no text names the
assistant, and that the file is exactly what the builder produces. Python 3 standard library only. Exit 1 on any failure.
"""
import csv
import json
import os
import sqlite3
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TABLES = os.path.join(ROOT, "data", "question_tables")
BANK = os.path.join(ROOT, "app", "content", "questions", "rates.json")
fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


def rows(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


db = sqlite3.connect(":memory:")
db.execute("create table f(o text, mon int, hour int, dow int, mi int, delay int)")
db.executemany("insert into f values(?,?,?,?,?,?)", [(r["origin"], int(r["departs"][5:7]), int(r["departs"][11:13]), 0, int(r["distance_mi"]), int(r["arrival_delay_min"])) for r in rows("flights.csv")])
# the weekday, computed by SQLite itself (0 is Sunday there)
db.execute("create table fd(rid integer primary key, dow int)")
db.executemany("insert into fd values(?, cast(strftime('%w', ?) as int))", [(int(r["row"]), r["departs"][:10]) for r in rows("flights.csv")])
db.execute("create table fw(rid integer primary key, o text, mon int, hour int, mi int, delay int, dow int)")
db.executemany("insert into fw values(?,?,?,?,?,?,(select dow from fd where rid=?))", [(int(r["row"]), r["origin"], int(r["departs"][5:7]), int(r["departs"][11:13]), int(r["distance_mi"]), int(r["arrival_delay_min"]), int(r["row"])) for r in rows("flights.csv")])
db.execute("create table w(d text, y int, mon int, p real, hi real, lo real, pp real, phi real)")
wrows = rows("seattle_weather.csv")
db.executemany("insert into w values(?,?,?,?,?,?,?,?)", [(r["date"], int(r["date"][:4]), int(r["date"][5:7]), float(r["precip_mm"]), float(r["temp_max_c"]), float(r["temp_min_c"]),
                                                       float(wrows[i - 1]["precip_mm"]) if i else None, float(wrows[i - 1]["temp_max_c"]) if i else None) for i, r in enumerate(wrows)])
db.execute("create table m(ym text, price real)")
db.executemany("insert into m values(?,?)", [(r["month"], float(r["price"])) for r in rows("sp500_shiller.csv")])
db.execute("create table o(ind text, code text, y int, v real)")
FILES = {"child": "owid_child_mortality.csv", "life": "owid_life_expectancy.csv", "co2": "owid_co2_per_person.csv", "gdp": "owid_gdp_per_person.csv"}
for ind, fn in FILES.items():
    db.executemany("insert into o values(?,?,?,?)", [(ind, r["code"], int(r["year"]), float(r["value"])) for r in rows(fn)])

DIST = {"under 300 miles": "mi < 300", "300 to 599 miles": "mi >= 300 and mi < 600", "600 to 999 miles": "mi >= 600 and mi < 1000", "1,000 to 1,499 miles": "mi >= 1000 and mi < 1500", "1,500 miles or more": "mi >= 1500"}
HOUR = {"morning": "hour < 10", "midday": "hour >= 10 and hour < 15", "evening": "hour >= 15 and hour < 20", "night": "hour >= 20"}
FEV = {"late": "delay >= 15", "vlate": "delay >= 60", "early": "delay <= -5"}
WEV = {"rain": "p > 0", "wet": "p >= 10", "warm": "hi >= 20", "frost": "lo <= 0"}
p1 = lambda a, b: round(100.0 * a / b + 1e-9, 1)


def share(table, where, event):
    n, k = db.execute(f"select count(*), sum({event}) from {table} where {where}").fetchone()
    return n, k


def check_rate(q):
    kind, key = q["kind"], q["key"]
    if kind == "doc":
        r = [x for x in rows("base_rates.csv") if x["id"] == key][0]
        check(q["truth"] == round((float(r["doc_low"]) + float(r["doc_high"])) / 2, 1), f"{q['id']}: documented rate differs from base_rates.csv")
        return
    if kind == "flight":
        gk, ek = key.rsplit(":", 1)
        a, b = gk.split(":", 1)
        where = {"o": f"o = '{b}'", "d": DIST.get(b, "0"), "h": HOUR.get(b, "0"), "m": f"mon = {int(b) if b.isdigit() else 0}"}[a]
        n, k = share("fw", where, FEV[ek])
    elif kind == "weather":
        gk, ek = key.rsplit(":", 1)
        a, b = gk.split(":", 1)
        if a == "m":
            where = f"mon = {int(b)}"
        else:
            y, mo = b.split("-")
            where = f"y = {int(y)} and mon = {int(mo)}"
        n, k = share("w", where, WEV[ek])
    elif kind == "market":
        dec, ek = key.split(":")
        series = [x for x in db.execute("select ym, price from m order by ym")]
        starts = [i for i in range(len(series) - 12) if int(dec) <= int(series[i][0][:4]) < int(dec) + 10]
        n = len(starts)
        k = sum(1 for i in starts if (series[i + 12][1] > series[i][1] if ek == "up" else series[i + 12][1] >= 1.2 * series[i][1]))
    elif kind == "owid":
        ind, t = key.split(":")
        t = int(t)
        pairs = db.execute("select a.v, b.v from o a join o b on a.ind = b.ind and a.code = b.code where a.ind = ? and a.y = ? and b.y = ?", (ind, t, t + 10)).fetchall()
        n = len(pairs)
        test = {"child": lambda a, b: b <= a / 2, "life": lambda a, b: b - a >= 5, "co2": lambda a, b: b > a, "gdp": lambda a, b: b >= 1.25 * a}[ind]
        k = sum(1 for a, b in pairs if test(a, b))
    else:
        check(False, f"{q['id']}: unknown kind {kind}")
        return
    check(q["n"] == n and q["truth"] == p1(k, n), f"{q['id']}: {q['key']} should be {p1(k, n)}% of {n}, the file says {q['truth']}% of {q['n']}")


def ladder_flight(q):
    o, mon, hour, dist = q["key"][3:].split("|")
    steps = [("1", f"o = '{o}'"), ("2", f"mon = {int(mon)}"), ("3", HOUR[hour]), ("4", DIST[dist])]
    rungs, where = [share("fw", "1", FEV["late"])], []
    for _, w in steps:
        where.append(w)
        rungs.append(share("fw", " and ".join(where), FEV["late"]))
    return rungs


def ladder_weather(q):
    mon, wet, warm, year = q["key"][3:].split("|")
    steps = [f"mon = {int(mon)}", "pp > 0" if wet == "True" else "pp = 0", "phi >= 10" if warm == "True" else "phi < 10", f"y = {int(year)}"]
    rungs, where = [share("w", "pp is not null", WEV["rain"])], ["pp is not null"]
    for w in steps:
        where.append(w)
        rungs.append(share("w", " and ".join(where), WEV["rain"]))
    return rungs


def check_class(q):
    rungs = ladder_flight(q) if q["kind"] == "flight" else ladder_weather(q)
    check(len(rungs) == len(q["classes"]) and all(c["n"] == n and c["rate"] == p1(k, n) for c, (n, k) in zip(q["classes"], rungs)), f"{q['id']}: a rung's case count or rate differs from the record")
    right = max(i for i, (n, _) in enumerate(rungs) if n >= 30)
    check(q["right"] == right, f"{q['id']}: the narrowest group with 30 or more cases is rung {right}, the file says {q['right']}")
    check(all(a["n"] >= b["n"] for a, b in zip(q["classes"], q["classes"][1:])), f"{q['id']}: the rungs are not nested")


FCOND = {"on a weekday": "dow between 1 and 5", "before 6 pm": "hour < 18", "after 6 am": "hour >= 6", "landing under an hour late": "delay < 60", "landing less than 15 minutes late": "delay < 15",
         "a flight of 300 miles or more": "mi >= 300", "a flight under 1,500 miles": "mi < 1500", "landing no earlier than 10 minutes ahead": "delay > -10"}
WCOND = {"a day with no rain": "p = 0", "a high of 8 °C or more": "hi >= 8", "a low of 2 °C or more": "lo >= 2", "a high under 25 °C": "hi < 25", "under 5 mm of rain": "p < 5", "a low under 15 °C": "lo < 15", "a high of 5 °C or more": "hi >= 5"}


def check_chain(q):
    table, conds = ("fw", FCOND) if q["kind"] == "flight" else ("w", WCOND)
    where, prev = [], db.execute(f"select count(*) from {table}").fetchone()[0]
    total = prev
    check(len(q["steps"]) >= 2, f"{q['id']}: a chain needs two steps")
    for s in q["steps"]:
        where.append(conds[s["text"]])
        n = db.execute(f"select count(*) from {table} where " + " and ".join(where)).fetchone()[0]
        check(s["rate"] == p1(n, prev), f"{q['id']}: step '{s['text']}' should be {p1(n, prev)}%, the file says {s['rate']}%")
        check(0.55 <= n / prev <= 0.97, f"{q['id']}: step rate out of range")
        prev = n
    check(q["truth"] == p1(prev, total) and 20 <= q["truth"] <= 70, f"{q['id']}: the joint share should be {p1(prev, total)}%")


def main():
    doc = json.load(open(BANK, encoding="utf-8"))
    qs = doc["questions"]
    check(doc["count"] == len(qs), "count differs from the questions listed")
    want = {("rate", "practice"): 84, ("rate", "exam"): 60, ("class", "practice"): 40, ("chain", "practice"): 40}
    for k, n in want.items():
        got = sum(1 for q in qs if (q["type"], q["pool"]) == k)
        check(got == n, f"{k}: {got} problems, expected {n}")
    check(len(qs) == sum(want.values()), "unexpected problems in the file")
    seen = {}
    for q in qs:
        text = json.dumps(q).lower()
        check("claude" not in text and "anthropic" not in text, f"{q['id']}: names the assistant")
        check(q["lead"] and q["ask"] and q["why"] and q["source"].startswith("http") and q["jdomain"] in ("work", "life", "world"), f"{q['id']}: incomplete")
        if q["type"] == "rate":
            check(0 <= q["truth"] <= 100, f"{q['id']}: truth out of range")
            check_rate(q)
        elif q["type"] == "class":
            check_class(q)
        elif q["type"] == "chain":
            check_chain(q)
        key = (q["type"], q["key"])
        check(key not in seen or seen[key] == q["pool"] and False, f"{q['id']}: repeated case {q['key']}")
        seen[key] = q["pool"]
    ids = [q["id"] for q in qs]
    check(len(set(ids)) == len(ids), "duplicate ids")
    exam = {q["key"] for q in qs if q["type"] == "rate" and q["pool"] == "exam"}
    prac = {q["key"] for q in qs if q["type"] == "rate" and q["pool"] == "practice"}
    check(not (exam & prac), "the practice and exam pools share a case")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_rates.py"), "--check"], capture_output=True, text=True)
    check(r.returncode == 0, "rates.json is not what tools/make_rates.py produces from the tables")
    if fails:
        print("\n".join("FAIL " + f for f in fails[:40]))
        print(f"{len(fails)} failures")
        sys.exit(1)
    rates = [q for q in qs if q["type"] == "rate"]
    print(f"rates bank: {len(rates)} rate problems (84 practice, 60 exam), 40 class ladders, 40 chains; every share, rung and step counted again from the records")


if __name__ == "__main__":
    main()

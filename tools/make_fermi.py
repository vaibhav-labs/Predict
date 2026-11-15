#!/usr/bin/env python3
"""Build the Fermi problems: app/content/questions/fermi.json (68 for practice, 48 for the Unit 4 exam attempts).

A Fermi problem asks for a quantity that is the PRODUCT of a few parts the player can think about one at a time:
"Seattle, the 14 days from 3 November: how many mm of rain fell?" is the number of rainy days times the average rain on a rainy
day. The player gives a low and a high (90%) for each part on the break-it-down worksheet; the worksheet multiplies the parts
(engine/problem.js, combineRanges) into a range for the whole, which is scored as a range: against the truth and against a
REFERENCE interval, the central 90% of the other cases like this one in the record (nearest-rank, case left out, log10 scale).

Every part's truth comes straight from the record, and truth = k * product of the parts' truths exactly (tools/check_fermi.py
re-derives all of it with different code). Cases are drawn at random from each family, never picked for how they turn out.
Seeded: the same tables always give the same bank and the same ids. Python 3 standard library only.

Run:   python3 tools/make_fermi.py           write the file
       python3 tools/make_fermi.py --check   fail if the file on disk is not what the tables produce
"""
import datetime as dt
import hashlib
import json
import math
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qbank"))
import common  # noqa: E402

OUT = os.path.join(common.ROOT, "app", "content", "questions", "fermi.json")
SEED = "predict-fermi-12"  # the first of predict-fermi-1, 2, ... whose two pools had the reference interval holding the truth within one standard error of 90% (z -0.89 and -0.10)
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
QUOTA = {"practice": {"fwx": 18, "fflight": 16, "fgrow": 18, "fmkt": 16}, "exam": {"fwx": 12, "fflight": 12, "fgrow": 12, "fmkt": 12}}
GROW = {
    "gdp": dict(file="owid_gdp_per_person.csv", label="GDP per person (international dollars)", unit="dollars per person", digits=0, tol=0.25),
    "co2": dict(file="owid_co2_per_person.csv", label="CO2 emissions per person (tonnes a year)", unit="tonnes per person", digits=2, tol=0.3),
    "child": dict(file="owid_child_mortality.csv", label="under-five child mortality (% of children who die before five)", unit="% of children", digits=2, tol=0.25),
}
WHY = {
    "fwx": "Rain is two questions, not one: how often does it rain, and how much when it does? You can reason about each (a Seattle winter fortnight is mostly wet; a wet day is usually a few mm, with the odd downpour) far better than you can guess the total. Give each part its own honest range, and let the worksheet combine them.",
    "fflight": "Total lateness is how many flights, times the share that land late, times how late the late ones are. A big airport has many flights and a small one has few, and that one fact swamps the rest. Think of each part on its own, with a range you would bet 19 to 1 on.",
    "fgrow": "Growth compounds: twenty years is two ten-year steps, and the second is built on the first. Think of how far a figure like this usually moves in ten years for a country that starts where this one does, then do it again.",
    "fmkt": "Nine years of stock prices is three stretches of three, and a stretch of three years is anything from a fall of a third to a rise of a half. Give each stretch its own range, then let the worksheet multiply: the whole is wider than any one part, but narrower than the parts added up.",
}


def g(x, digits):
    return f"{x:,.{digits}f}"


def rank(vals, q):
    return vals[max(1, math.ceil(q * len(vals) - 1e-9)) - 1]


def ref_of(others):
    s = sorted(others)
    return rank(s, 0.05), rank(s, 0.95), len(s)


def qid(kind, key):
    return f"{kind}-{hashlib.sha1(key.encode()).hexdigest()[:7]}"


def cand(kind, key, pool_key, lead, ask, unit, digits, truth, mult, parts, lo, hi, n, fact, domain, source, src_name):
    lo, hi = round(lo, digits + 2), round(hi, digits + 2)
    return dict(kind=kind, key=key, pool_key=pool_key, id=qid(kind, key), lead=lead, ask=ask, unit=unit, scale="log", digits=digits, truth=truth, mult=mult,
                parts=parts, ref_low=lo, ref_high=hi, ref_n=n, fact=fact, why=WHY[kind], domain=domain, verified="recorded", source=source, src_name=src_name, checked=common.BANK_DATE)


def part(label, hint, unit, digits, truth):
    return dict(label=label, hint=hint, unit=unit, digits=digits, truth=truth)


# ---------------------------------------------------------------------------------------------------------------- weather: 14-day rain
def weather():
    url, name = common.source_of("seattle_weather.csv")
    days = [dict(d=dt.date.fromisoformat(r["date"]), p=float(r["precip_mm"])) for r in common.read("seattle_weather.csv")]
    n, W = len(days), 14
    doy = [x["d"].timetuple().tm_yday for x in days]
    near = lambda a, b, w: min(abs(a - b), 366 - abs(a - b)) <= w
    win = []
    for i in range(0, n - W + 1):
        ps = [days[j]["p"] for j in range(i, i + W)]
        wet = [p for p in ps if p > 0]
        if wet:
            win.append((i, sum(ps), len(wet), sum(wet) / len(wet)))
    out = []
    for (i, tot, k, mean) in win:
        others = [math.log10(t2) for (i2, t2, k2, m2) in win if abs(i2 - i) >= W and near(doy[i2], doy[i], 20)]
        if len(others) < 40:
            continue
        lo, hi, m = ref_of(others)
        lo, hi = 10 ** lo, 10 ** hi
        d = days[i]["d"]
        stamp = f"{d.day} {MONTHS[d.month - 1]} {d.year}"
        lead = f"Seattle, the 14 days starting {stamp}."
        fact = (f"{g(tot, 1)} mm fell: {k} of the 14 days had measurable rain, and a rainy day averaged {g(mean, 1)} mm. Among the {m} other 14-day stretches within twenty days of the same date of the year "
                f"(not overlapping this one), nine in ten had between {g(lo, 1)} and {g(hi, 1)} mm in all.")
        parts = [part("Rainy days", "How many of the 14 days have any measurable rain?", "days", 0, k), part("Rain on a rainy day", "On average, how many mm fall on a day that has rain?", "mm", 1, mean)]
        out.append(cand("fwx", d.isoformat(), f"fwx:{d.isoformat()}", lead, "How many mm of rain fell in all?", "mm", 1, tot, 1, parts, lo, hi, m, fact, "weather", url, name))
    return out


# ---------------------------------------------------------------------------------------------------------------- flights: lateness by airport and month (the record holds January to March 2001)
def flights():
    url, name = common.source_of("flights.csv")
    airports = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    F = [dict(o=r["origin"], q=int(r["departs"][5:7]), y=int(r["departs"][:4]), delay=int(r["arrival_delay_min"])) for r in common.read("flights.csv")]
    total = len(F)
    airports_n = len({x["o"] for x in F})
    cells = defaultdict(list)
    for x in F:
        cells[(x["o"], x["y"], x["q"])].append(x["delay"])
    stats = {}
    for k, v in cells.items():
        late = [d for d in v if d >= 15]
        if len(v) >= 15 and len(late) >= 3:
            stats[k] = (len(v), len(late), sum(late) / len(late), sum(late))
    qname = {m: MONTHS[m - 1] for m in range(1, 13)}
    out = []
    for k, (cnt, nl, mean, tot) in stats.items():
        o, y, q = k
        others = [math.log10(s[3]) for k2, s in stats.items() if k2 != k]
        if len(others) < 40:
            continue
        lo, hi, m = ref_of(others)
        lo, hi = 10 ** lo, 10 ** hi
        lead = f"A record of {total:,} flights from {airports_n} US airports in {y}. The flights that left {airports[o]} ({o}) in {qname[q]}."
        fact = (f"{cnt} flights left, {nl} of them ({g(100 * nl / cnt, 1)}%) landed 15 or more minutes late, and those were late by {g(mean, 1)} minutes on average: {g(tot, 0)} minutes in all. "
                f"Among the {m} other airport-months in this record, nine in ten added up to between {g(lo, 0)} and {g(hi, 0)} minutes.")
        parts = [part("Flights", "How many of this record's flights left from here that month?", "flights", 0, cnt),
                 part("Share that landed 15+ minutes late", "What percent of them landed 15 or more minutes after schedule?", "%", 1, 100 * nl / cnt),
                 part("Minutes late, on average", "Among the flights that were that late, how many minutes late on average?", "minutes", 1, mean)]
        out.append(cand("fflight", f"{o}:{y}:{q}", f"fl:{o}:{q}", lead, "How many minutes of lateness did those late flights add up to?", "minutes", 0, tot, 0.01, parts, lo, hi, m, fact, "travel", url, name))
    return out


# ---------------------------------------------------------------------------------------------------------------- country growth, 20 years in two steps
def growth():
    out = []
    for ind, spec in GROW.items():
        url, name = common.source_of(spec["file"])
        series, names = defaultdict(dict), {}
        for r in common.read(spec["file"]):
            series[r["code"]][int(r["year"])] = float(r["value"])
            names[r["code"]] = r["country"]
        wins = [(c, t, s[t], s[t + 10], s[t + 20]) for c, s in sorted(series.items()) for t in (1990, 2000) if t in s and t + 10 in s and t + 20 in s and min(s[t], s[t + 10], s[t + 20]) > 0]
        d = spec["digits"]
        for c, t, a, b, e in wins:
            others = [math.log10(e2 / a2) for (c2, t2, a2, b2, e2) in wins if (c2, t2) != (c, t) and abs(math.log(a2 / a)) <= spec["tol"]]
            if len(others) < 25:
                continue
            dl, dh, m = ref_of(others)
            lo, hi = a * 10 ** dl, a * 10 ** dh
            lead = f"{names[c]}, {t}: {spec['label']} was {g(a, d)}."
            fact = (f"By {t + 10} it was {g(b, d)} ({g(b / a, 2)} times the {t} figure), and by {t + 20} it was {g(e, d)} ({g(e / b, 2)} times the {t + 10} figure). Among the {m} other country-windows of twenty years that started "
                    f"within about {int(spec['tol'] * 100)}% of {g(a, d)}, nine in ten ended between {g(lo, d)} and {g(hi, d)}.")
            parts = [part(f"Change {t} to {t + 10}", f"By what factor did it change in the first ten years (2.0 means doubled, 0.5 means halved)?", "times", 2, b / a),
                     part(f"Change {t + 10} to {t + 20}", "By what factor did it change in the next ten years?", "times", 2, e / b)]
            out.append(cand("fgrow", f"{ind}:{c}:{t}", f"fg:{ind}:{c}", lead, f"What was it in {t + 20}?", spec["unit"], d, e, a, parts, lo, hi, m, fact, "world", url, name) | {"sub": ind})
    return out


# ---------------------------------------------------------------------------------------------------------------- markets: nine years in three stretches
def markets():
    url, name = common.source_of("sp500_shiller.csv")
    P = [(r["month"], float(r["price"])) for r in common.read("sp500_shiller.csv")]
    out = []
    for i in range(len(P) - 108):
        month, a = P[i]
        y, mo = int(month[:4]), int(month[5:])
        if mo != 6 or y < 1950:
            continue
        others = [math.log10(P[j + 108][1] / P[j][1]) for j in range(len(P) - 108) if abs(j - i) > 108]
        if len(others) < 100:
            continue
        dl, dh, m = ref_of(others)
        lo, hi = 1000 * 10 ** dl, 1000 * 10 ** dh
        p3, p6, p9 = P[i + 36][1], P[i + 72][1], P[i + 108][1]
        lead = f"US stocks, {MONTHS[mo - 1]} {y}: the S&P 500 index averaged {g(a, 2)} for the month. Say $1,000 went into the index then, with nothing added or taken out and dividends ignored."
        fact = (f"Three years on the index stood at {g(p3, 2)} ({g(p3 / a, 2)} times), after six at {g(p6, 2)} ({g(p6 / p3, 2)} times the three-year figure), and after nine at {g(p9, 2)} ({g(p9 / p6, 2)} times): $1,000 became {g(1000 * p9 / a, 0)}. "
                f"Among the {m} other nine-year stretches in this record (not overlapping this one), nine in ten ended between ${g(lo, 0)} and ${g(hi, 0)} from $1,000.")
        parts = [part("Years 1 to 3", "By what factor does the index change over the first three years (1.5 means up by half)?", "times", 2, p3 / a),
                 part("Years 4 to 6", "By what factor over the next three years?", "times", 2, p6 / p3),
                 part("Years 7 to 9", "By what factor over the last three years?", "times", 2, p9 / p6)]
        out.append(cand("fmkt", month, f"fm:{y}", lead, f"What are the $1,000 worth after nine years, in {MONTHS[mo - 1]} {y + 9}?", "dollars", 0, 1000 * p9 / a, 1000, parts, lo, hi, m, fact, "money", url, name))
    return out


def build():
    cands = weather() + flights() + growth() + markets()
    by_kind = defaultdict(list)
    for c in cands:
        by_kind[c["kind"]].append(c)
    out, taken = [], set()
    for pool in ("exam", "practice"):  # the exam pool picks first, so the practice pool can never hold an exam case
        for kind, count in QUOTA[pool].items():
            rng = random.Random(f"{SEED}:{pool}:{kind}")
            avail = sorted((c for c in by_kind[kind] if c["pool_key"] not in taken), key=lambda c: c["id"])
            rng.shuffle(avail)
            chosen, subs = [], defaultdict(int)
            per_sub = None if kind != "fgrow" else count // len(GROW)
            for c in avail:
                if len(chosen) == count:
                    break
                if c["pool_key"] in taken:
                    continue
                if per_sub is not None and subs[c["sub"]] >= per_sub:
                    continue
                if per_sub is not None:
                    subs[c["sub"]] += 1
                taken.add(c["pool_key"])
                chosen.append(dict(c, pool=pool))
            if len(chosen) < count:
                raise SystemExit(f"{kind}: only {len(chosen)} of {count} cases are available for the {pool} pool")
            out += chosen
    out.sort(key=lambda c: (c["pool"], c["id"]))
    return out


def render(qs):
    keep = ("id", "pool", "kind", "key", "lead", "ask", "unit", "scale", "digits", "truth", "mult", "parts", "ref_low", "ref_high", "ref_n", "domain", "fact", "why", "verified", "source", "src_name", "checked")
    doc = {"version": 1, "built": common.BANK_DATE, "count": len(qs), "note": "Built by tools/make_fermi.py from data/question_tables/. Do not edit by hand: change the tables or the generator and run it again.",
           "questions": [{k: c[k] for k in keep} for c in qs]}
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main():
    text = render(build())
    if "--check" in sys.argv:
        if open(OUT, encoding="utf-8").read() != text:
            sys.exit("app/content/questions/fermi.json is not what the tables produce: run python3 tools/make_fermi.py")
        print("fermi.json matches the tables")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

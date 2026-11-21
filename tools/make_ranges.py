#!/usr/bin/env python3
"""Build the range questions: app/content/questions/ranges.json (200 for practice, 180 for the Unit 3 exam attempts).

A range question gives a real situation and asks for a quantity: "Seattle, 4 December. Yesterday's high was 7.8 C. What is
today's high?" The player gives a low and a high they are 90% sure of. Every question carries a REFERENCE INTERVAL: the
central 90% of the other cases like this one in the record (nearest-rank 5th and 95th percentile of the others, the case
itself left out), so a player who knows the record is a calibrated 90% player on this bank, and the reference width is what
the points are measured against (data/scoring.json, interval.points). tools/check_ranges.py works every number out again with
different code (SQL, not the lists used here) and tests that the reference interval holds the truth 90% of the time.

Cases are drawn at random from each kind, never picked for how they turn out. Nothing here goes online: the records were
written once by tools/snapshot_tables.py. Seeded: the same tables always give the same bank and the same ids.

Run:   python3 tools/make_ranges.py           write the file
       python3 tools/make_ranges.py --check   fail if the file on disk is not what the tables produce
Python 3 standard library only.
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

OUT = os.path.join(common.ROOT, "app", "content", "questions", "ranges.json")
SEED = "predict-ranges-1"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
# How many questions each kind gives to the practice pool and to the exam pool.
QUOTA = {"practice": {"wtemp": 40, "wprecip": 20, "flight": 40, "life": 12, "fert": 12, "renew": 12, "child": 12, "co2": 11, "gdp": 11, "market": 30},
         "exam": {"wtemp": 36, "wprecip": 18, "flight": 36, "life": 10, "fert": 10, "renew": 10, "child": 10, "co2": 10, "gdp": 10, "market": 30}}
MIN_OTHERS = {"wtemp": 40, "wprecip": 40, "flight": 150, "trend": 25, "market": 100}
INDICATORS = {
    "life": dict(file="owid_life_expectancy.csv", unit="years", scale="linear", digits=1, label="life expectancy at birth", ask="What was it in {t}? (years)", tol=0.2),
    "fert": dict(file="owid_fertility.csv", unit="births per woman", scale="linear", digits=2, label="births per woman", ask="How many births per woman in {t}?", tol=0.25),
    "renew": dict(file="owid_renewables_share.csv", unit="% of electricity", scale="linear", digits=1, label="share of electricity from renewables", ask="What share was it in {t}? (%)", tol=0.3),
    "child": dict(file="owid_child_mortality.csv", unit="% of children", scale="log", digits=2, label="under-five child mortality (% of children who die before five)", ask="What was it in {t}? (%)", tol=0.25),
    "co2": dict(file="owid_co2_per_person.csv", unit="tonnes per person", scale="log", digits=2, label="CO2 emissions per person (tonnes a year)", ask="How many tonnes per person in {t}?", tol=0.3),
    "gdp": dict(file="owid_gdp_per_person.csv", unit="dollars per person", scale="log", digits=0, label="GDP per person (international dollars)", ask="What was it in {t}? (dollars)", tol=0.25),
}
WHY = {
    "wtemp": "A day's high is close to the season's habit and to yesterday's. Start from the spread of highs on days like this one, say where 9 in 10 of them land, then adjust. A range that is 3 degrees wide is a hope, not a promise.",
    "wprecip": "Rain is lumpy: most days after a wet day are modest, a few are very wet. Start from how much falls on days like this one, and let the top of your range be generous: the one downpour is what a narrow range cannot survive.",
    "flight": "Most flights land within minutes of schedule and a few are hours late. Start from the spread of arrival delays on flights like this one. The top of your range matters more than the bottom: nothing lands more than an hour early.",
    "trend": "Countries drift: a figure usually moves by about what it moved for countries that started in the same place. Start from the spread of those moves, then adjust for what you know about this country.",
    "market": "A year of stock prices is wide: the market has risen in most years, and has also fallen by a third. Start from how far prices moved over twelve months in the other years, then be as wide as the record says.",
}


def g(x, digits):
    return f"{x:,.{digits}f}"


def rank(vals, q):
    """Nearest-rank percentile of a sorted list: the ceil(q*n)-th value (1-based)."""
    return vals[max(1, math.ceil(q * len(vals) - 1e-9)) - 1]


def ref_of(others):
    s = sorted(others)
    return rank(s, 0.05), rank(s, 0.95), len(s)


def qid(kind, key):
    return f"r{kind}-{hashlib.sha1(key.encode()).hexdigest()[:7]}"


def cand(kind, key, pool_key, lead, ask, unit, scale, digits, truth, lo, hi, n, fact, domain, source, src_name, why):
    lo, hi = round(lo, digits + 2), round(hi, digits + 2)  # stored to two decimals beyond what is shown; the checker rounds the same way
    return dict(kind=kind, key=key, pool_key=pool_key, id=qid(kind, key), lead=lead, ask=ask, unit=unit, scale=scale, digits=digits, truth=truth, ref_low=lo, ref_high=hi, ref_n=n,
                fact=fact, why=why, domain=domain, verified="recorded", source=source, src_name=src_name, checked=common.BANK_DATE)


# ---------------------------------------------------------------------------------------------------------------- weather
def weather():
    url, name = common.source_of("seattle_weather.csv")
    days = [dict(d=dt.date.fromisoformat(r["date"]), p=float(r["precip_mm"]), hi=float(r["temp_max_c"])) for r in common.read("seattle_weather.csv")]
    n = len(days)
    doy = [x["d"].timetuple().tm_yday for x in days]
    near = lambda a, b, w: min(abs(a - b), 366 - abs(a - b)) <= w
    out = []
    for i in range(1, n):
        d = days[i]["d"]
        stamp = f"{d.day} {MONTHS[d.month - 1]}"
        others = [days[j]["hi"] for j in range(1, n) if j != i and near(doy[j], doy[i], 10) and abs(days[j - 1]["hi"] - days[i - 1]["hi"]) <= 3.0]
        if len(others) >= MIN_OTHERS["wtemp"]:
            lo, hi, m = ref_of(others)
            fact = (f"{stamp} {d.year}: the high was {g(days[i]['hi'], 1)} °C. Among the {m} other days within ten days of this date, after a day whose high was within 3 degrees of "
                    f"{g(days[i - 1]['hi'], 1)} °C, nine in ten had a high between {g(lo, 1)} and {g(hi, 1)} °C.")
            out.append(cand("wtemp", d.isoformat(), f"wx:{d.isoformat()}", f"Seattle, {stamp}. Yesterday's high was {g(days[i - 1]['hi'], 1)} °C.", "What is today's high temperature, in °C?", "°C", "linear", 1,
                            days[i]["hi"], lo, hi, m, fact, "weather", url, name, WHY["wtemp"]))
        if days[i - 1]["p"] > 0:
            others = [days[j]["p"] for j in range(1, n) if j != i and days[j - 1]["p"] > 0 and near(doy[j], doy[i], 15)]
            if len(others) >= MIN_OTHERS["wprecip"]:
                lo, hi, m = ref_of(others)
                fact = (f"{stamp} {d.year}: {g(days[i]['p'], 1)} mm fell. Among the {m} other days within fifteen days of this date that followed a wet day, nine in ten had between "
                        f"{g(lo, 1)} and {g(hi, 1)} mm.")
                out.append(cand("wprecip", d.isoformat(), f"wx:{d.isoformat()}", f"Seattle, {stamp}. It rained yesterday ({g(days[i - 1]['p'], 1)} mm).", "How much rain falls today, in mm? (0 if none)", "mm", "linear", 1,
                                days[i]["p"], lo, hi, m, fact, "weather", url, name, WHY["wprecip"]))
    return out


# ---------------------------------------------------------------------------------------------------------------- flights
def flights():
    url, name = common.source_of("flights.csv")
    airports = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    F = [dict(row=int(r["row"]), t=dt.datetime.strptime(r["departs"], "%Y-%m-%d %H:%M"), o=r["origin"], d=r["destination"], mi=int(r["distance_mi"]), delay=int(r["arrival_delay_min"])) for r in common.read("flights.csv")]
    out = []
    for x in F:
        if x["mi"] < 150:
            continue
        others = [y["delay"] for y in F if y is not x and abs(y["mi"] - x["mi"]) <= 0.25 * x["mi"]]
        if len(others) < MIN_OTHERS["flight"]:
            continue
        lo, hi, m = ref_of(others)
        late = "right on schedule" if x["delay"] == 0 else f"{x['delay']} minutes late" if x["delay"] > 0 else f"{-x['delay']} minutes early"
        fact = (f"It landed {late}. Among the {m:,} other flights in this record that flew within a quarter of this distance, nine in ten landed between {g(lo, 0)} and {g(hi, 0)} minutes after schedule "
                f"(negative is early).")
        lead = f"A {x['mi']:,}-mile flight from {airports[x['o']]} ({x['o']}) to {airports[x['d']]} ({x['d']}) leaves on {x['t'].day} {MONTHS[x['t'].month - 1]} {x['t'].year}."
        out.append(cand("flight", str(x["row"]), f"fl:{x['row']}", lead, "How many minutes after its scheduled time does it land? (Early is negative.)", "minutes", "linear", 0, x["delay"], lo, hi, m, fact, "travel", url, name, WHY["flight"]))
    return out


# ---------------------------------------------------------------------------------------------------------------- country trends
def trends():
    out = []
    for ind, spec in INDICATORS.items():
        url, name = common.source_of(spec["file"])
        series, names = defaultdict(dict), {}
        for r in common.read(spec["file"]):
            series[r["code"]][int(r["year"])] = float(r["value"])
            names[r["code"]] = r["country"]
        wins = [(c, t, s[t - 5], s[t]) for c, s in sorted(series.items()) for t in range(1995, 2021, 5) if t in s and t - 5 in s and s[t - 5] > 0 and s[t] > 0]
        step = (lambda a, b: math.log10(b / a)) if spec["scale"] == "log" else (lambda a, b: b - a)
        back = (lambda a, d: a * 10 ** d) if spec["scale"] == "log" else (lambda a, d: a + d)
        for c, t, a, b in wins:
            others = [step(a2, b2) for (c2, t2, a2, b2) in wins if (c2, t2) != (c, t) and abs(math.log(a2 / a)) <= spec["tol"]]
            if len(others) < MIN_OTHERS["trend"]:
                continue
            dl, dh, m = ref_of(others)
            lo, hi = back(a, dl), back(a, dh)
            d = spec["digits"]
            fact = (f"By {t} it was {g(b, d)}. Among the {m} other country-windows of five years that started within about {int(spec['tol'] * 100)}% of {g(a, d)}, nine in ten ended between {g(lo, d)} and {g(hi, d)}.")
            lead = f"{names[c]}, {t - 5}: {spec['label']} was {g(a, d)}."
            out.append(cand(ind, f"{c}:{t}", f"tr:{ind}:{c}", lead, spec["ask"].format(t=t), spec["unit"], spec["scale"], d, b, lo, hi, m, fact, "world", url, name, WHY["trend"]))
    return out


# ---------------------------------------------------------------------------------------------------------------- markets
def markets():
    url, name = common.source_of("sp500_shiller.csv")
    P = [(r["month"], float(r["price"])) for r in common.read("sp500_shiller.csv")]
    out = []
    for i in range(len(P) - 12):
        month, a = P[i]
        y, mo = int(month[:4]), int(month[5:])
        if mo != 6 or y < 1950 or y > 2022:
            continue
        b = P[i + 12][1]
        others = [math.log10(P[j + 12][1] / P[j][1]) for j in range(len(P) - 12) if abs(j - i) > 12]
        if len(others) < MIN_OTHERS["market"]:
            continue
        dl, dh, m = ref_of(others)
        lo, hi = a * 10 ** dl, a * 10 ** dh
        fact = f"A year later the index averaged {g(b, 2)}. Among the {m} other twelve-month stretches in this record (not overlapping this one), nine in ten ended between {g(lo, 2)} and {g(hi, 2)} from this starting point."
        lead = f"US stocks, {MONTHS[mo - 1]} {y}: the S&P 500 averaged {g(a, 2)} for the month."
        out.append(cand("market", month, f"mk:{y}", lead, f"Where does its monthly average stand in {MONTHS[mo - 1]} {y + 1}?", "index points", "log", 2, b, lo, hi, m, fact, "money", url, name, WHY["market"]))
    return out


def build():
    cands = weather() + flights() + trends() + markets()
    by_kind = defaultdict(list)
    for c in cands:
        by_kind[c["kind"]].append(c)
    out, taken = [], set()
    for pool in ("exam", "practice"):  # the exam pool picks first from the same cases, so the practice pool can never contain an exam case
        for kind, count in QUOTA[pool].items():
            rng = random.Random(f"{SEED}:{pool}:{kind}")
            avail = sorted((c for c in by_kind[kind] if c["pool_key"] not in taken and c["key"] not in {x["key"] for x in out if x["kind"] == kind}), key=lambda c: c["id"])
            rng.shuffle(avail)
            chosen = []
            for c in avail:
                if len(chosen) == count:
                    break
                if c["pool_key"] in taken:
                    continue
                taken.add(c["pool_key"])
                chosen.append(dict(c, pool=pool))
            if len(chosen) < count:
                raise SystemExit(f"{kind}: only {len(chosen)} of {count} cases are available for the {pool} pool")
            out += chosen
    out.sort(key=lambda c: (c["pool"], c["id"]))
    return out


def render(qs):
    keep = ("id", "pool", "kind", "key", "lead", "ask", "unit", "scale", "digits", "truth", "ref_low", "ref_high", "ref_n", "domain", "fact", "why", "verified", "source", "src_name", "checked")
    doc = {"version": 1, "built": common.BANK_DATE, "count": len(qs), "note": "Built by tools/make_ranges.py from data/question_tables/. Do not edit by hand: change the tables or the generator and run it again.",
           "questions": [{k: c[k] for k in keep} for c in qs]}
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main():
    text = render(build())
    if "--check" in sys.argv:
        if open(OUT, encoding="utf-8").read() != text:
            sys.exit("app/content/questions/ranges.json is not what the tables produce: run python3 tools/make_ranges.py")
        print("ranges.json matches the tables")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

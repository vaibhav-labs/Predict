#!/usr/bin/env python3
"""Predict: the multi-outcome questions for Unit 10 (Fine grain): app/content/questions/multi.json.

One case from a record (a Seattle day, a flight, a month of the S&P 500) and 3 or 4 outcomes that cover everything that can happen (a delay in four buckets, a day's rain in
four, a month's move in three). The player gives each outcome a whole percent; the chances add up to 100 and none is under 1. The outcome that happened is the case's own, and `ref` is
how often each outcome happened among the OTHER cases in the same class (the case left out): the forecast the record itself would have made. Scored by 100 * log2(k p) / log2(k).

Cases are drawn as they come (20 from each record), so the reference forecast is fair by construction; tools/check_multi.py works every item out again with SQL.

Usage:  python3 tools/make_multi.py          writes app/content/questions/multi.json
        python3 tools/make_multi.py --check  fails if the file differs from a rebuild
"""
import datetime as dt
import hashlib
import json
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qbank"))
import common  # noqa: E402

OUT = os.path.join(common.ROOT, "app", "content", "questions", "multi.json")
SEED = "predict-multi-1"
PER_RECORD = 20
MIN_N = 60
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
FLIGHT = ["On time or early (0 minutes late or less)", "1 to 14 minutes late", "15 to 59 minutes late", "An hour or more late"]
RAIN = ["Dry (no measurable rain)", "Light rain (under 5 mm)", "Moderate rain (5 to under 15 mm)", "Heavy rain (15 mm or more)"]
MOVE = ["Falls 2% or more", "Moves less than 2% either way", "Rises 2% or more"]
CASES = defaultdict(list)


def flight_bucket(d):
    return 0 if d <= 0 else 1 if d < 15 else 2 if d < 60 else 3


def rain_bucket(p):
    return 0 if p <= 0 else 1 if p < 5 else 2 if p < 15 else 3


def move_bucket(r):
    return 0 if r <= -0.02 else 2 if r >= 0.02 else 1


def classes(items, k):
    """items: (class key, outcome index). Returns {class: [counts per outcome]}."""
    out = defaultdict(lambda: [0] * k)
    for key, o in items:
        out[key][o] += 1
    return out


def case(group, key, lead, ask, outcomes, truth, counts, fact, why, domain, src):
    n = sum(counts)
    if n < MIN_N:
        return
    ref = [(c - (1 if i == truth else 0)) / (n - 1) for i, c in enumerate(counts)]
    CASES[group].append(dict(key=f"{group}:{key}", lead=lead, ask=ask, outcomes=outcomes, truth=truth, ref=[round(x, 4) for x in ref], n=n - 1, fact=fact, why=why, domain=domain, source=src[0], src_name=src[1]))


def weather():
    src = common.source_of("seattle_weather.csv")
    rows = common.read("seattle_weather.csv")
    days = [(dt.date.fromisoformat(r["date"]), float(r["precip_mm"])) for r in rows]
    cls = classes([(d.month, rain_bucket(p)) for d, p in days], 4)
    for d, p in days:
        b = rain_bucket(p)
        counts = cls[d.month]
        fact = f"{d.day} {MONTHS[d.month - 1]} {d.year}: {p:g} mm of rain fell ({RAIN[b].split(' (')[0].lower()}). Among the other {sum(counts) - 1} {MONTHS[d.month - 1]} days in this four-year (2012 to 2015) record the days split: {{split}}."
        case("wx", d.isoformat(), f"Seattle, {d.day} {MONTHS[d.month - 1]}.", "How much rain falls today?", RAIN, b, counts, fact,
             "Spread your chances over every way the day can go. The record's own split is the place to start, and a 1% is a real answer: it costs about 186 points if it happens, so give it to the outcomes you honestly cannot rule out.", "weather", src)


def flights():
    src = common.source_of("flights.csv")
    city = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    rows = common.read("flights.csv")
    fl = []
    for r in rows:
        t = dt.datetime.strptime(r["departs"], "%Y-%m-%d %H:%M")
        part = "morning" if t.hour < 12 else "afternoon" if t.hour < 17 else "evening"
        fl.append((r["row"], t, r["origin"], r["destination"], int(r["distance_mi"]), int(r["arrival_delay_min"]), part))
    cls = classes([((o, part), flight_bucket(dl)) for _r, _t, o, _d, _m, dl, part in fl], 4)
    for row, t, o, d, mi, dl, part in fl:
        if o not in city or d not in city:
            continue
        b = flight_bucket(dl)
        counts = cls[(o, part)]
        if sum(counts) < MIN_N:
            continue
        fact = f"This flight arrived {abs(dl)} minutes {'late' if dl > 0 else 'early' if dl < 0 else 'late (on the dot)'}. Among the other {sum(counts) - 1} flights that left {city[o]} in the {part} in this January to March 2001 sample the arrivals split: {{split}}."
        case("fl", row, f"A flight from {city[o]} to {city[d]} ({mi:,} miles), leaving on {t.day} {MONTHS[t.month - 1]} {t.year} in the {part}.", "How late does it arrive?", FLIGHT, b, counts, fact,
             "Most flights land close to time, a few land very late, and a small bucket deserves a small number, not zero. Start from the airport's own split.", "travel", src)


def market():
    src = common.source_of("sp500_shiller.csv")
    rows = common.read("sp500_shiller.csv")
    px = [(r["month"], float(r["price"])) for r in rows]
    ret = [None] + [px[i][1] / px[i - 1][1] - 1 for i in range(1, len(px))]
    state = lambda i: "after a rise" if ret[i - 1] > 0 else "after a fall"
    cls = classes([(state(i), move_bucket(ret[i])) for i in range(2, len(px))], 3)
    for i in range(2, len(px)):
        y, m = px[i][0].split("-")
        b = move_bucket(ret[i])
        counts = cls[state(i)]
        fact = f"In {MONTHS[int(m) - 1]} {y} the monthly average price moved {ret[i] * 100:+.1f}%. Among the other {sum(counts) - 1} months {state(i)} in this record (December 1949 on) the moves split: {{split}}."
        case("mk", px[i][0], f"The S&P 500, {MONTHS[int(m) - 1]} {y}. The month before, the average price {'rose' if ret[i - 1] > 0 else 'fell'} {abs(ret[i - 1]) * 100:.1f}%.", "How does the monthly average price move this month?", MOVE, b, counts,
             fact, "A calm month is the most common outcome and a big move either way is rarer, but neither is impossible. Spread the chances the way the record does, then move only for something you know.", "money", src)


def pct(x):
    return f"{int(x * 100 + 0.5)}%"


def build():
    CASES.clear()
    weather()
    flights()
    market()
    items = []
    for g in ("wx", "fl", "mk"):
        r = random.Random(f"{SEED}:{g}")
        pool = CASES[g][:]
        r.shuffle(pool)
        for c in pool[:PER_RECORD]:
            labels = c["outcomes"]
            split = "; ".join(f"{lab.split(' (')[0]} {pct(x)}" for x, lab in zip(c["ref"], labels))
            items.append(dict(id="multi-" + hashlib.sha1(c["key"].encode()).hexdigest()[:7], lead=c["lead"], ask=c["ask"], outcomes=labels, truth=c["truth"], ref=c["ref"], n=c["n"],
                              fact=c["fact"].replace("{split}", split), why=c["why"], domain=c["domain"], verified="recorded", source=c["source"], src_name=c["src_name"], checked=common.BANK_DATE, pool="practice"))
    random.Random(SEED).shuffle(items)
    return items


def render():
    items = build()
    doc = {"version": 1, "built": common.BANK_DATE, "count": len(items), "seed": SEED, "note": "Built by tools/make_multi.py from data/question_tables/. Do not edit by hand.", "questions": items}
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    text = render()
    if "--check" in sys.argv:
        ok = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == text
        print("multi.json matches the generator" if ok else "multi.json is out of date: run tools/make_multi.py")
        sys.exit(0 if ok else 1)
    open(OUT, "w", encoding="utf-8").write(text)
    print(f"wrote {OUT}: {len(json.loads(text)['questions'])} questions")

#!/usr/bin/env python3
"""Build the Unit 5 outside-view problems: app/content/questions/rates.json.

Three kinds of problem, all with truths read straight from the records or from a cited source:

  rate   "What share of cases like this one end this way?"  The player types a percent; it counts when within 7 points of the truth.
         86 for practice and 60 for the Unit 5 exam (the exam pool shares no case with practice). Some are documented base rates from
         data/question_tables/base_rates.csv (a source and a page), the rest are shares counted in the flight, weather, stock-market and
         country records.
  class  "Which group of past cases should you start from?"  A real case and a ladder of nested groups, from everything in the record down
         to a handful of cases like it, each with how many cases it holds and how often the event happened in it. The right start is the
         NARROWEST group that still holds 30 or more cases (data/scoring.json, rate.class_min_cases): narrower groups are more like the
         case, but under 30 the share is mostly noise. 40 problems, practice and drills only.
  chain  "What share of cases pass every step?"  Steps are given with how often each holds among the cases that passed the one before
         (flights and Seattle days); the truth is the share that pass them all, which is exactly the product. 40 problems, practice and drills.

tools/check_rates.py re-derives every number with different code. Seeded: the same tables always give the same bank and ids.
Python 3 standard library only.

Run:   python3 tools/make_rates.py           write the file
       python3 tools/make_rates.py --check   fail if the file on disk is not what the tables produce
"""
import datetime as dt
import hashlib
import itertools
import json
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qbank"))
import common  # noqa: E402

OUT = os.path.join(common.ROOT, "app", "content", "questions", "rates.json")
SEED = "predict-rates-1"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
MIN_CLASS = 30
QUOTA = {"practice": {"doc": 17, "flight": 30, "weather": 25, "market": 6, "owid": 6}, "exam": {"doc": 10, "flight": 22, "weather": 18, "market": 4, "owid": 6}}
JDOMAIN = {"cbiz": "work", "cfund": "work", "cproj": "world", "csport": "life", "clife": "life", "cbio": "life", "ctrav": "work", "cworld": "world"}
DOC_ASK = {  # the share asked for, one per documented base rate (only the percent rows; counts and averages are not asked here)
    "bls1": "What percent of new locations like it are still open a year later?",
    "bls5": "What percent of new locations like it are still open five years later?",
    "bls10": "What percent of new locations like it are still open ten years later?",
    "fortune": "What percent of companies like it are still on the list 62 years later, in 2017?",
    "bessem58": "What percent of stocks like it have earned less than one-month Treasury bills over their lives?",
    "bessem4": "What percent of all listed stocks does it take to account for the whole of the market's gain over Treasury bills since 1926?",
    "spiva10": "What percent of funds like it trailed the index over the ten years to the end of 2025?",
    "spiva1": "What percent of funds like it trailed the index in 2025?",
    "shed400": "What percent of adults like them say they could cover a $400 emergency expense with cash or its equivalent?",
    "oly_all": "What percent of Games like it ended up costing more than budgeted?",
    "oly_100": "What percent of Games like it cost more than double their budget?",
    "mega90": "What percent of projects like it end up over budget?",
    "ncaa1": "What percent of those games did the 16 seed win?",
    "ncaa2": "What percent of those games did the 15 seed win?",
    "ncaa3": "What percent of those games did the 14 seed win?",
    "ncaa4": "What percent of those games did the 13 seed win?",
    "home_nba": "What percent of those games did the home team win?",
    "home_mlb": "What percent of those games did the home team win?",
    "seer": "What percent of people like them are still alive five years later?",
    "nces6": "What percent of students like them graduate from that college within six years?",
    "nces2": "What percent of students like them finish within one and a half times the normal length?",
    "bio_loa": "What percent of candidates like it eventually win FDA approval?",
    "bio_p1": "What percent of candidates like it move on to Phase II?",
    "bio_p2": "What percent of candidates like it move on to Phase III?",
    "bio_p3": "What percent of candidates like it go on to a filing for approval?",
    "bio_nda": "What percent of filings like it are approved?",
    "bio_onc": "What percent of cancer candidates like it eventually win FDA approval?",
    "bts_ontime": "What percent of flights like it arrive on time (less than 15 minutes after schedule)?",
    "bts_cancel": "What percent of flights like it are cancelled?",
    "osc": "What percent of the re-runs also find a significant result?",
    "ballot": "What percent of incumbents like them win?",
}
WHY_RATE = "Start outside: how often does this happen to cases like this one? That share is the number to begin from. Then ask whether anything about this case really sets it apart, and move only as far as that is worth."


def qid(kind, key):
    return f"{kind}-{hashlib.sha1(key.encode()).hexdigest()[:7]}"


def p1(x):
    return round(100 * x + 1e-9, 1)


def g(x, d=1):
    return f"{x:,.{d}f}"


# ---------------------------------------------------------------------------------------------------------------- rate problems
def doc_rates():
    out = []
    for r in common.read("base_rates.csv"):
        if r["id"] not in DOC_ASK:
            continue
        lo, hi = float(r["doc_low"]), float(r["doc_high"])
        truth = round((lo + hi) / 2, 1)
        out.append(dict(type="rate", kind="doc", key=r["id"], id=qid("rdoc", r["id"]), lead=r["lead"], ask=DOC_ASK[r["id"]], unit="%", truth=truth, n=int(r["n"]) if r["n"] else None,
                        domain=r["domain"], jdomain=JDOMAIN[r["group"]], fact=r["fact"], why=r["why"], verified="sourced", source=r["source_url"], src_name=r["source_name"], checked=r["checked"]))
    return out


def load_flights():
    airports = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    F = []
    for r in common.read("flights.csv"):
        t = dt.datetime.strptime(r["departs"], "%Y-%m-%d %H:%M")
        F.append(dict(o=r["origin"], t=t, mi=int(r["distance_mi"]), delay=int(r["arrival_delay_min"])))
    return airports, F


def hour_bucket(h):
    return "morning" if h < 10 else "midday" if h < 15 else "evening" if h < 20 else "night"


def dist_bucket(mi):
    return "under 300 miles" if mi < 300 else "300 to 599 miles" if mi < 600 else "600 to 999 miles" if mi < 1000 else "1,000 to 1,499 miles" if mi < 1500 else "1,500 miles or more"


FLIGHT_EVENTS = {"late": ("landed 15 or more minutes after schedule", lambda d: d >= 15), "vlate": ("landed an hour or more after schedule", lambda d: d >= 60), "early": ("landed at least 5 minutes ahead of schedule", lambda d: d <= -5)}


def flight_rates():
    url, name = common.source_of("flights.csv")
    airports, F = load_flights()
    total = len(F)
    groups = []  # (key, phrase, members)
    by_o = defaultdict(list)
    for x in F:
        by_o[x["o"]].append(x)
    for o, v in by_o.items():
        groups.append((f"o:{o}", f"left {airports[o]} ({o})", v))
    for b in ("under 300 miles", "300 to 599 miles", "600 to 999 miles", "1,000 to 1,499 miles", "1,500 miles or more"):
        groups.append((f"d:{b}", f"flew {b}", [x for x in F if dist_bucket(x["mi"]) == b]))
    for h in ("morning", "midday", "evening", "night"):
        groups.append((f"h:{h}", f"left in the {h} ({'before 10' if h == 'morning' else '10 to 3' if h == 'midday' else '3 to 8 pm' if h == 'evening' else 'after 8 pm'})", [x for x in F if hour_bucket(x["t"].hour) == h]))
    for m in (1, 2, 3):
        groups.append((f"m:{m}", f"left in {MONTHS[m - 1]}", [x for x in F if x["t"].month == m]))
    out = []
    for gk, phrase, mem in groups:
        for ek, (ephrase, fn) in FLIGHT_EVENTS.items():
            share = sum(1 for x in mem if fn(x["delay"])) / len(mem)
            if share == 0 or share == 1:
                continue
            lead = f"A record of {total:,} US domestic flights in January to March 2001. Look at the flights that {phrase}."
            fact = f"Of the {len(mem):,} flights in this record that {phrase}, {sum(1 for x in mem if fn(x['delay'])):,} ({g(100 * share)}%) {ephrase}."
            out.append(dict(type="rate", kind="flight", key=f"{gk}:{ek}", id=qid("rfl", f"{gk}:{ek}"), lead=lead, ask=f"What percent of them {ephrase}?", unit="%", truth=p1(share), n=len(mem),
                            domain="travel", jdomain="work", fact=fact, why=WHY_RATE, verified="recorded", source=url, src_name=name, checked=common.BANK_DATE))
    return out


def load_weather():
    return [dict(d=dt.date.fromisoformat(r["date"]), p=float(r["precip_mm"]), hi=float(r["temp_max_c"]), lo=float(r["temp_min_c"])) for r in common.read("seattle_weather.csv")]


WX_EVENTS = {"rain": ("had measurable rain", lambda x: x["p"] > 0), "wet": ("had 10 mm of rain or more", lambda x: x["p"] >= 10),
             "warm": ("had a high of 20 °C or more", lambda x: x["hi"] >= 20), "frost": ("had a low of 0 °C or below", lambda x: x["lo"] <= 0)}


def weather_rates():
    url, name = common.source_of("seattle_weather.csv")
    W = load_weather()
    groups = [(f"m:{m}", f"in {MONTHS[m - 1]}, across 2012 to 2015", [x for x in W if x["d"].month == m]) for m in range(1, 13)]
    groups += [(f"ym:{y}-{m}", f"in {MONTHS[m - 1]} {y}", [x for x in W if x["d"].year == y and x["d"].month == m]) for y in range(2012, 2016) for m in range(1, 13)]
    out = []
    for gk, phrase, mem in groups:
        for ek, (ephrase, fn) in WX_EVENTS.items():
            if gk.startswith("ym:") and ek not in ("rain", "wet"):
                continue
            k = sum(1 for x in mem if fn(x))
            if k == 0 or k == len(mem):
                continue
            share = k / len(mem)
            lead = f"Seattle's weather record, 2012 to 2015: the days {phrase}."
            fact = f"Of the {len(mem)} days {phrase}, {k} ({g(100 * share)}%) {ephrase}."
            out.append(dict(type="rate", kind="weather", key=f"{gk}:{ek}", id=qid("rwx", f"{gk}:{ek}"), lead=lead, ask=f"What percent of those days {ephrase}?", unit="%", truth=p1(share), n=len(mem),
                            domain="weather", jdomain="life", fact=fact, why=WHY_RATE, verified="recorded", source=url, src_name=name, checked=common.BANK_DATE))
    return out


def market_rates():
    url, name = common.source_of("sp500_shiller.csv")
    P = [(r["month"], float(r["price"])) for r in common.read("sp500_shiller.csv")]
    out = []
    for dec in range(1950, 2020, 10):
        starts = [i for i in range(len(P) - 12) if dec <= int(P[i][0][:4]) < dec + 10]
        for ek, (ephrase, fn) in {"up": ("ended higher", lambda a, b: b > a), "up20": ("ended at least 20% higher", lambda a, b: b >= 1.2 * a)}.items():
            k = sum(1 for i in starts if fn(P[i][1], P[i + 12][1]))
            if k == 0 or k == len(starts):
                continue
            share = k / len(starts)
            lead = f"The S&P 500 index in the {dec}s. Take every month that began a twelve-month stretch in those ten years, and look at where the index stood a year later."
            fact = f"Of the {len(starts)} twelve-month stretches that began in the {dec}s, {k} ({g(100 * share)}%) {ephrase}."
            out.append(dict(type="rate", kind="market", key=f"{dec}:{ek}", id=qid("rmk", f"{dec}:{ek}"), lead=lead, ask=f"What percent of those stretches {ephrase}?", unit="%", truth=p1(share), n=len(starts),
                            domain="money", jdomain="world", fact=fact, why=WHY_RATE, verified="recorded", source=url, src_name=name, checked=common.BANK_DATE))
    return out


OWID = {"child": ("owid_child_mortality.csv", "child mortality", lambda a, b: b <= a / 2, "fell by half or more"), "life": ("owid_life_expectancy.csv", "life expectancy", lambda a, b: b - a >= 5, "rose by 5 years or more"),
        "co2": ("owid_co2_per_person.csv", "CO2 emissions per person", lambda a, b: b > a, "rose"), "gdp": ("owid_gdp_per_person.csv", "income per person", lambda a, b: b >= 1.25 * a, "rose by a quarter or more")}


def owid_rates():
    out = []
    for ind, (file, label, fn, ephrase) in OWID.items():
        url, name = common.source_of(file)
        series = defaultdict(dict)
        for r in common.read(file):
            series[r["code"]][int(r["year"])] = float(r["value"])
        for t in (1990, 2000, 2010):
            pairs = [(s[t], s[t + 10]) for s in series.values() if t in s and t + 10 in s]
            k = sum(1 for a, b in pairs if fn(a, b))
            if k == 0 or k == len(pairs):
                continue
            share = k / len(pairs)
            lead = f"Countries in the Our World in Data records ({len(pairs)} of them have a figure for both {t} and {t + 10}): {label}."
            fact = f"Of the {len(pairs)} countries with both years, {k} ({g(100 * share)}%) saw {label} {ephrase} between {t} and {t + 10}."
            out.append(dict(type="rate", kind="owid", key=f"{ind}:{t}", id=qid("row", f"{ind}:{t}"), lead=lead, ask=f"What percent of those countries saw it have {ephrase.replace('rose', 'risen').replace('fell', 'fallen')} between {t} and {t + 10}?",
                            unit="%", truth=p1(share), n=len(pairs), domain="world", jdomain="world", fact=fact, why=WHY_RATE, verified="recorded", source=url, src_name=name, checked=common.BANK_DATE))
    return out


# ---------------------------------------------------------------------------------------------------------------- reference-class ladders
def class_problems():
    url, name = common.source_of("flights.csv")
    airports, F = load_flights()
    total = len(F)
    rng = random.Random(f"{SEED}:class")
    ladder_f = [("flight", "o", lambda x, c: x["o"] == c["o"], lambda c: f"left {airports[c['o']]} ({c['o']})"),
                ("flight", "m", lambda x, c: x["t"].month == c["t"].month, lambda c: f"left in {MONTHS[c['t'].month - 1]}"),
                ("flight", "h", lambda x, c: hour_bucket(x["t"].hour) == hour_bucket(c["t"].hour), lambda c: f"left in the {hour_bucket(c['t'].hour)}"),
                ("flight", "b", lambda x, c: dist_bucket(x["mi"]) == dist_bucket(c["mi"]), lambda c: f"flew {dist_bucket(c['mi'])}")]
    out = []
    flights = F[:]
    rng.shuffle(flights)
    seen = set()
    for c in flights:
        key = (c["o"], c["t"].month, hour_bucket(c["t"].hour), dist_bucket(c["mi"]))
        if key in seen:
            continue
        seen.add(key)
        classes, members, label = [], F, "all flights in the record"
        classes.append(dict(label="Every flight in the record", n=len(F), rate=p1(sum(1 for x in F if x["delay"] >= 15) / len(F))))
        phrases = []
        for _, _, fn, ph in ladder_f:
            members = [x for x in members if fn(x, c)]
            phrases.append(ph(c))
            if not members:
                break
            classes.append(dict(label="Flights that " + ", ".join(phrases[:-1]) + (", and " if len(phrases) > 1 else "") + phrases[-1], n=len(members), rate=p1(sum(1 for x in members if x["delay"] >= 15) / len(members))))
        if len(classes) < 5:
            continue
        right = max(i for i, k in enumerate(classes) if k["n"] >= MIN_CLASS)
        out.append(dict(type="class", kind="flight", key="fl:" + "|".join(map(str, key)), pool="practice", id=qid("cfl", "|".join(map(str, key))),
                        lead=f"A flight is about to leave {airports[c['o']]} ({c['o']}). It is a {MONTHS[c['t'].month - 1]} flight, it leaves in the {hour_bucket(c['t'].hour)} and it covers {dist_bucket(c['mi'])}.",
                        ask="You want to know how likely it is to land 15 or more minutes late. Which group of past flights should you start from?",
                        unit="%", classes=classes, right=right, domain="travel", jdomain="work", verified="recorded", source=url, src_name=name, checked=common.BANK_DATE,
                        why="Narrower groups are more like the case, but each cut takes cases away. The rule of thumb: go down the ladder while the group still holds 30 or more cases, and stop there. Past that, the share is mostly noise."))
    W = load_weather()
    urlw, namew = common.source_of("seattle_weather.csv")
    ladder_w = [("m", lambda x, c: x["d"].month == c["d"].month, lambda c: f"in {MONTHS[c['d'].month - 1]}"),
                ("a", lambda x, c: x["wet_prev"] == c["wet_prev"], lambda c: "after a rainy day" if c["wet_prev"] else "after a dry day"),
                ("c", lambda x, c: (x["hi_prev"] >= 10) == (c["hi_prev"] >= 10), lambda c: "after a day with a high of 10 °C or more" if c["hi_prev"] >= 10 else "after a day with a high under 10 °C"),
                ("y", lambda x, c: x["d"].year == c["d"].year, lambda c: f"in {c['d'].year}")]
    days = [dict(W[i], wet_prev=W[i - 1]["p"] > 0, hi_prev=W[i - 1]["hi"]) for i in range(1, len(W))]
    shuffled = days[:]
    rng.shuffle(shuffled)
    seen = set()
    for c in shuffled:
        key = (c["d"].month, c["wet_prev"], c["hi_prev"] >= 10, c["d"].year)
        if key in seen:
            continue
        seen.add(key)
        classes = [dict(label="Every day in the record", n=len(days), rate=p1(sum(1 for x in days if x["p"] > 0) / len(days)))]
        members, phrases = days, []
        for _, fn, ph in ladder_w:
            members = [x for x in members if fn(x, c)]
            phrases.append(ph(c))
            if not members:
                break
            classes.append(dict(label="Days " + ", ".join(phrases), n=len(members), rate=p1(sum(1 for x in members if x["p"] > 0) / len(members))))
        if len(classes) < 5:
            continue
        right = max(i for i, k in enumerate(classes) if k["n"] >= MIN_CLASS)
        out.append(dict(type="class", kind="weather", key="wx:" + "|".join(map(str, key)), pool="practice", id=qid("cwx", "|".join(map(str, key))),
                        lead=f"Seattle, a day in {MONTHS[c['d'].month - 1]} {c['d'].year}. Yesterday was {'a rainy day' if c['wet_prev'] else 'a dry day'} with a high {'of 10 °C or more' if c['hi_prev'] >= 10 else 'under 10 °C'}.",
                        ask="You want to know how likely it is to rain today. Which group of past days should you start from?",
                        unit="%", classes=classes, right=right, domain="weather", jdomain="life", verified="recorded", source=urlw, src_name=namew, checked=common.BANK_DATE,
                        why="Narrower groups are more like the case, but each cut takes cases away. The rule of thumb: go down the ladder while the group still holds 30 or more cases, and stop there. Past that, the share is mostly noise."))
    return out


# ---------------------------------------------------------------------------------------------------------------- chains
def chain_problems():
    rng = random.Random(f"{SEED}:chain")
    out = []
    url, name = common.source_of("flights.csv")
    airports, F = load_flights()
    cf = {"on a weekday": lambda x: x["t"].weekday() < 5, "before 6 pm": lambda x: x["t"].hour < 18, "after 6 am": lambda x: x["t"].hour >= 6, "landing under an hour late": lambda x: x["delay"] < 60,
          "landing less than 15 minutes late": lambda x: x["delay"] < 15, "a flight of 300 miles or more": lambda x: x["mi"] >= 300, "a flight under 1,500 miles": lambda x: x["mi"] < 1500,
          "landing no earlier than 10 minutes ahead": lambda x: x["delay"] > -10}
    names = list(cf)
    combos = [c for k in (2, 3, 4) for c in itertools.permutations(names, k)]
    rng.shuffle(combos)
    for combo in combos:
        if len([o for o in out if o["kind"] == "flight"]) >= 24:
            break
        members, steps, ok = F, [], True
        for nm in combo:
            nxt = [x for x in members if cf[nm](x)]
            r = len(nxt) / len(members)
            if not (0.55 <= r <= 0.97):
                ok = False
                break
            steps.append(dict(text=nm, rate=p1(r)))
            members = nxt
        joint = len(members) / len(F)
        if not ok or not (0.2 <= joint <= 0.7) or set(combo) in [set(o["key_set"]) for o in out]:
            continue
        out.append(dict(type="chain", kind="flight", key="fl:" + "|".join(combo), key_set=list(combo), pool="practice", id=qid("kfl", "|".join(combo)),
                        lead=f"Take the {len(F):,} flights in this record. A flight passes if it clears every step in turn. Each step's rate is among the flights that cleared the steps before it.",
                        ask="What percent of all the flights pass every step?", steps=steps, unit="%", truth=p1(joint), n=len(F), domain="travel", jdomain="work", verified="recorded", source=url, src_name=name, checked=common.BANK_DATE,
                        fact=f"{len(members):,} of the {len(F):,} flights ({g(100 * joint)}%) passed every step. Each step alone looks safe; the steps multiply: " + " × ".join(f"{s['rate']:g}%" for s in steps) + f" = {g(100 * joint)}%.",
                        why="Each step is likely, but all of them have to hold. Multiply the chain: the chance of all of it is smaller than the weakest step, and usually much smaller than the story's feel."))
    W = load_weather()
    urlw, namew = common.source_of("seattle_weather.csv")
    cw = {"a day with no rain": lambda x: x["p"] == 0, "a high of 8 °C or more": lambda x: x["hi"] >= 8, "a low of 2 °C or more": lambda x: x["lo"] >= 2, "a high under 25 °C": lambda x: x["hi"] < 25,
          "under 5 mm of rain": lambda x: x["p"] < 5, "a low under 15 °C": lambda x: x["lo"] < 15, "a high of 5 °C or more": lambda x: x["hi"] >= 5}
    names = list(cw)
    combos = [c for k in (2, 3, 4) for c in itertools.permutations(names, k)]
    rng.shuffle(combos)
    for combo in combos:
        if len([o for o in out if o["kind"] == "weather"]) >= 16:
            break
        members, steps, ok = W, [], True
        for nm in combo:
            nxt = [x for x in members if cw[nm](x)]
            r = len(nxt) / len(members)
            if not (0.55 <= r <= 0.97):
                ok = False
                break
            steps.append(dict(text=nm, rate=p1(r)))
            members = nxt
        joint = len(members) / len(W)
        if not ok or not (0.2 <= joint <= 0.7) or set(combo) in [set(o["key_set"]) for o in out if o["kind"] == "weather"]:
            continue
        out.append(dict(type="chain", kind="weather", key="wx:" + "|".join(combo), key_set=list(combo), pool="practice", id=qid("kwx", "|".join(combo)),
                        lead=f"Take the {len(W):,} days in Seattle's weather record, 2012 to 2015. A day passes if it clears every step in turn. Each step's rate is among the days that cleared the steps before it.",
                        ask="What percent of all the days pass every step?", steps=steps, unit="%", truth=p1(joint), n=len(W), domain="weather", jdomain="life", verified="recorded", source=urlw, src_name=namew, checked=common.BANK_DATE,
                        fact=f"{len(members):,} of the {len(W):,} days ({g(100 * joint)}%) passed every step. The steps multiply: " + " × ".join(f"{s['rate']:g}%" for s in steps) + f" = {g(100 * joint)}%.",
                        why="Each step is likely, but all of them have to hold. Multiply the chain: the chance of all of it is smaller than the weakest step, and usually much smaller than the story's feel."))
    return out


def build():
    pools = defaultdict(list)
    for c in doc_rates() + flight_rates() + weather_rates() + market_rates() + owid_rates():
        pools[c["kind"]].append(c)
    out, taken = [], set()
    for pool in ("exam", "practice"):
        for kind, count in QUOTA[pool].items():
            rng = random.Random(f"{SEED}:{pool}:{kind}")
            avail = sorted((c for c in pools[kind] if c["id"] not in taken), key=lambda c: c["id"])
            rng.shuffle(avail)
            if len(avail) < count:
                raise SystemExit(f"{kind}: only {len(avail)} of {count} are available for the {pool} pool")
            for c in avail[:count]:
                taken.add(c["id"])
                out.append(dict(c, pool=pool))
    cp = class_problems()
    out += [c for c in cp if c["kind"] == "flight"][:24] + [c for c in cp if c["kind"] == "weather"][:16]
    out += chain_problems()[:40]
    out.sort(key=lambda c: (c["type"], c["pool"], c["id"]))
    return out


KEEP = ("id", "type", "pool", "kind", "key", "lead", "ask", "unit", "truth", "classes", "right", "steps", "n", "domain", "jdomain", "fact", "why", "verified", "source", "src_name", "checked")


def render(qs):
    doc = {"version": 1, "built": common.BANK_DATE, "count": len(qs), "note": "Built by tools/make_rates.py from data/question_tables/. Do not edit by hand: change the tables or the generator and run it again.",
           "questions": [{k: c[k] for k in KEEP if k in c} for c in qs]}
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main():
    text = render(build())
    if "--check" in sys.argv:
        if open(OUT, encoding="utf-8").read() != text:
            sys.exit("app/content/questions/rates.json is not what the tables produce: run python3 tools/make_rates.py")
        print("rates.json matches the tables")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

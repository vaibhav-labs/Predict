#!/usr/bin/env python3
"""Predict: the tail-heavy question bank for Unit 10 (Fine grain): app/content/questions/tails.json.

Unit 10 asks for calls on a 1% dial under the sharp (log) rule, so the questions must live in the tails: a claim whose chance among
the other cases is under 15% (or, said the other way round, over 85%). Every item is a real case from a record in data/question_tables/
(a Seattle day, a flight, a month of the S&P 500), the claim is that a rare event happens (or does not), and `base` is how often that event
happened among the OTHER cases in the same class (the case itself is left out), exactly as in the main bank.

Cases are drawn as they come: the truth of a claim is whatever the record shows, so a claim with a 5% base is true in about 5 cases in 100.
That is what makes the bank fair to a player who knows the base rates (and a test of calibration at the tails). A pool is accepted
only when the hit rate of a base-rate player sits within 2 standard errors of what that player expects, overall and in the tails
(tools/check_tails.py works every item out again from the tables and applies the same test).

Usage:  python3 tools/make_tails.py            writes app/content/questions/tails.json
        python3 tools/make_tails.py --check    rebuilds in memory and fails if the file differs
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

OUT = os.path.join(common.ROOT, "app", "content", "questions", "tails.json")
SEED = "predict-tails-1"
PRACTICE, EXAM = 160, 480
MIN_P, MAX_P = 0.01, 0.15  # the class rate of the rare event
MIN_N = 40
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
BANK_DATE = common.BANK_DATE
CASES = []


def say(x):
    return f"{x:g}"


def add(group, key, lead, event_ask, nonevent_ask, happened, k, n, fact, why, domain, src):
    """One case with a rare event: k of the n cases in its class had the event, this one is one of them if `happened`."""
    p = (k - (1 if happened else 0)) / (n - 1)
    if not (MIN_P - 1e-9 <= p <= MAX_P + 1e-9):
        return
    CASES.append(dict(group=group, key=f"{group}:{key}", lead=lead, event_ask=event_ask, nonevent_ask=nonevent_ask, happened=bool(happened), p=p, n=n - 1,
                      fact=fact.replace("{p}", common.pct(p)).replace("{n}", f"{n - 1:,}"), why=why, domain=domain, source=src[0], src_name=src[1]))


# ------------------------------------------------------------------------------------------------------------------------ weather
def weather():
    src = common.source_of("seattle_weather.csv")
    rows = common.read("seattle_weather.csv")
    days = [dict(d=dt.date.fromisoformat(r["date"]), p=float(r["precip_mm"]), hi=float(r["temp_max_c"]), lo=float(r["temp_min_c"])) for r in rows]
    events = {
        "rain10": (lambda x: x["p"] >= 10, "At least 10 mm of rain falls today.", "Less than 10 mm of rain falls today.", "a day with 10 mm or more of rain",
                   lambda x: f"{say(x['p'])} mm of rain fell"),
        "rain20": (lambda x: x["p"] >= 20, "At least 20 mm of rain falls today.", "Less than 20 mm of rain falls today.", "a day with 20 mm or more of rain",
                   lambda x: f"{say(x['p'])} mm of rain fell"),
        "hot": (lambda x: x["hi"] >= 28, "The high today reaches 28 degrees Celsius or more.", "The high today stays under 28 degrees Celsius.", "a day with a high of 28 degrees or more",
                lambda x: f"the high was {say(x['hi'])} degrees"),
        "freeze": (lambda x: x["lo"] <= 0, "The low tonight reaches freezing (0 degrees Celsius or below).", "The low tonight stays above freezing.", "a day with a low at or below freezing",
                   lambda x: f"the low was {say(x['lo'])} degrees"),
    }
    cls = defaultdict(lambda: [0, 0])
    for name, (f, *_rest) in events.items():
        for x in days:
            c = cls[(name, x["d"].month)]
            c[0] += 1
            c[1] += f(x)
    for i in range(1, len(days)):
        x, prev = days[i], days[i - 1]
        lead = f"Seattle, {x['d'].day} {MONTHS[x['d'].month - 1]}. Yesterday the high was {say(prev['hi'])} degrees and {say(prev['p'])} mm of rain fell."
        for name, (f, yes, no, nice, what) in events.items():
            n, k = cls[(name, x["d"].month)]
            if n < MIN_N:
                continue
            fact = (f"{x['d'].day} {MONTHS[x['d'].month - 1]} {x['d'].year}: {what(x)}. Of the other {{n}} {MONTHS[x['d'].month - 1]} days in this four-year (2012 to 2015) record, "
                    f"{{p}} were {nice}.")
            why = ("In the tails the base rate does nearly all the work. Start from how often the event happens in this month, and move only for something that really changed the odds: "
                   "a quiet day before is not a reason to call a rare event. The error to avoid is sliding to 90% or 99% when the honest figure is 96%.")
            add("wx" + name, x["d"].isoformat(), lead, yes, no, f(x), k, n, fact, why, "weather", src)


# ------------------------------------------------------------------------------------------------------------------------ flights
def flights():
    src = common.source_of("flights.csv")
    city = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    rows = common.read("flights.csv")
    fl = []
    for r in rows:
        t = dt.datetime.strptime(r["departs"], "%Y-%m-%d %H:%M")
        part = "morning" if t.hour < 12 else "afternoon" if t.hour < 17 else "evening"
        fl.append(dict(row=r["row"], t=t, o=r["origin"], d=r["destination"], mi=int(r["distance_mi"]), delay=int(r["arrival_delay_min"]), part=part))
    events = {"d60": (60, "at least an hour"), "d120": (120, "at least two hours"), "d180": (180, "at least three hours")}
    cls = defaultdict(lambda: [0, 0])
    for name, (mins, _) in events.items():
        for x in fl:
            c = cls[(name, x["o"], x["part"])]
            c[0] += 1
            c[1] += x["delay"] >= mins
    for x in fl:
        if x["o"] not in city or x["d"] not in city:
            continue
        lead = f"A flight from {city[x['o']]} to {city[x['d']]} ({x['mi']:,} miles), leaving on {x['t'].day} {MONTHS[x['t'].month - 1]} {x['t'].year} in the {x['part']}."
        for name, (mins, words) in events.items():
            n, k = cls[(name, x["o"], x["part"])]
            if n < MIN_N:
                continue
            fact = (f"This flight arrived {abs(x['delay'])} minutes {'late' if x['delay'] > 0 else 'early' if x['delay'] < 0 else 'late (on the dot)'}. Of the other {{n}} flights that left {city[x['o']]} in the {x['part']} in this January to March 2001 sample, "
                    f"{{p}} arrived {words} late.")
            why = ("A long delay is the exception for any one flight, so the base rate for the airport and time of day is the anchor. Rare does not mean never: "
                   "on the 1% dial the difference between 2% and 8% is worth real points, so say the figure the records give, not a round number.")
            add("fl" + name, x["row"], lead, f"The flight arrives {words} late.", f"The flight arrives less than {words.replace('at least ', '')} late.", x["delay"] >= mins, k, n, fact, why, "travel", src)


# ------------------------------------------------------------------------------------------------------------------------ stock market
def market():
    src = common.source_of("sp500_shiller.csv")
    rows = common.read("sp500_shiller.csv")
    px = [(r["month"], float(r["price"])) for r in rows]
    ret = [None] + [px[i][1] / px[i - 1][1] - 1 for i in range(1, len(px))]
    events = {"fall5": (lambda r: r <= -0.05, "The S&P 500 falls 5% or more this month (monthly average).", "The S&P 500 does not fall 5% or more this month (monthly average).", "a month with a fall of 5% or more"),
              "fall8": (lambda r: r <= -0.08, "The S&P 500 falls 8% or more this month (monthly average).", "The S&P 500 does not fall 8% or more this month (monthly average).", "a month with a fall of 8% or more"),
              "rise6": (lambda r: r >= 0.06, "The S&P 500 rises 6% or more this month (monthly average).", "The S&P 500 does not rise 6% or more this month (monthly average).", "a month with a rise of 6% or more")}
    state = lambda i: "after a rise" if ret[i - 1] is not None and ret[i - 1] > 0 else "after a fall"
    cls = defaultdict(lambda: [0, 0])
    for name, (f, *_x) in events.items():
        for i in range(2, len(px)):
            c = cls[(name, state(i))]
            c[0] += 1
            c[1] += f(ret[i])
    for i in range(2, len(px)):
        y, m = px[i][0].split("-")
        lead = f"The S&P 500, {MONTHS[int(m) - 1]} {y}. The month before, the average price {'rose' if ret[i - 1] > 0 else 'fell'} {abs(ret[i - 1]) * 100:.1f}%."
        for name, (f, yes, no, nice) in events.items():
            n, k = cls[(name, state(i))]
            if n < MIN_N:
                continue
            fact = (f"In {MONTHS[int(m) - 1]} {y} the monthly average price moved {ret[i] * 100:+.1f}%. Of the other {{n}} months {state(i)} in this record (December 1949 on), {{p}} were {nice}.")
            why = ("Big monthly moves are rare and no calmer month makes them impossible. Anchor on how often they happen after a month like the last one, "
                   "and keep a few points for the surprise: certainty is the only wrong answer on a rare claim.")
            add("mk" + name, px[i][0], lead, yes, no, f(ret[i]), k, n, fact, why, "money", src)


def build():
    CASES.clear()
    weather()
    flights()
    market()
    rng = random.Random(SEED)
    # One fact per case-event is a candidate; no two items share a case (a day, a flight, a month), so a player never meets two halves of one situation.
    by_case = defaultdict(list)
    for c in CASES:
        by_case[c["key"].split(":", 1)[0][:2] + ":" + c["key"].split(":", 1)[1]].append(c)
    cases = sorted(by_case)
    best = None
    for attempt in range(200):
        r = random.Random(f"{SEED}:{attempt}")
        order = cases[:]
        r.shuffle(order)
        picked = []
        used_groups = defaultdict(int)
        for k in order:
            opts = by_case[k]
            c = opts[r.randrange(len(opts))]
            if used_groups[c["group"]] >= (PRACTICE + EXAM) * 0.34:
                continue
            used_groups[c["group"]] += 1
            picked.append(c)
            if len(picked) == PRACTICE + EXAM:
                break
        if len(picked) < PRACTICE + EXAM:
            continue
        items = [finish(c, r) for c in picked]
        pools = (items[:PRACTICE], items[PRACTICE:])
        zs = [fairness(p) for p in pools]
        if all(abs(z["all"]) <= 1.5 and abs(z["tail"]) <= 1.5 for z in zs):
            best = (attempt, pools, zs)
            break
    if best is None:
        raise SystemExit("no draw of the tail bank was fair to a base-rate player within 1.5 standard errors; widen the attempts or the candidate set")
    return best


def finish(c, r):
    event_side = r.random() < 0.5  # which way the claim is worded; the same fact either way
    if event_side:
        ask, answer, base = c["event_ask"], c["happened"], c["p"]
    else:
        ask, answer, base = c["nonevent_ask"], not c["happened"], 1 - c["p"]
    cid = "tail-" + hashlib.sha1(f"{c['key']}|{event_side}".encode()).hexdigest()[:7]
    return dict(id=cid, lead=c["lead"], ask=ask, claim=f"{c['lead']} {ask}", answer=bool(answer), base=round(base, 4), n=c["n"], fact=c["fact"], why=c["why"], domain=c["domain"],
                diff="easy", verified="recorded", source=c["source"], src_name=c["src_name"], checked=BANK_DATE)


def fairness(items):
    """z of the hit rate of a player who always says the likelier side at its base rate: expected hits against the real hits."""
    def z_of(sub):
        if not sub:
            return 0.0
        exp = sum(max(q["base"], 1 - q["base"]) for q in sub)
        hits = sum(1 for q in sub if (q["base"] >= 0.5) == q["answer"])
        var = sum(max(q["base"], 1 - q["base"]) * (1 - max(q["base"], 1 - q["base"])) for q in sub)
        return (hits - exp) / math.sqrt(var)
    tail = [q for q in items if q["base"] <= MAX_P + 1e-9 or q["base"] >= 1 - MAX_P - 1e-9]
    return {"all": z_of(items), "tail": z_of(tail), "n": len(items)}


def render():
    attempt, (practice, exam), zs = build()
    for q in practice:
        q["pool"] = "practice"
    for q in exam:
        q["pool"] = "exam"
    doc = {"version": 1, "built": BANK_DATE, "count": len(practice) + len(exam), "seed": SEED, "attempt": attempt,
           "note": "Built by tools/make_tails.py from data/question_tables/. Do not edit by hand. Tail-heavy: every claim has a base rate under 15% or over 85%.",
           "questions": practice + exam}
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", zs


if __name__ == "__main__":
    text, zs = render()
    if "--check" in sys.argv:
        ok = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == text
        print("tails.json matches the generator" if ok else "tails.json is out of date: run tools/make_tails.py")
        sys.exit(0 if ok else 1)
    open(OUT, "w", encoding="utf-8").write(text)
    print(f"wrote {OUT}: {PRACTICE} practice, {EXAM} exam; fairness z (practice, exam): {[(round(z['all'], 2), round(z['tail'], 2)) for z in zs]}")

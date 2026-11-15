#!/usr/bin/env python3
"""Build the Unit 6 evidence streams: app/content/questions/updates.json.

A stream is one case seen in two steps. The player is told the case and the rate among cases like it (the prior, an exact figure counted in
the record), then a piece of news narrows the case to a smaller group; the player types the new probability. The truth is the share of that
smaller group (counted in the record) that ended the way the question asks. Step two does the same again with a second piece of news, and its
prior is the truth of step one. A group must hold at least 60 cases (data/scoring.json, problems.update.min_cases) so the truth is not noise.

Streams are chosen so that news is worth different amounts: about 40 percent of the steps move the truth 8 or more points from the prior, 30
percent move it 3 to 8, and 30 percent barely move it (under 3): a player who always moves a lot, or never moves, loses points.

Flights: the record of 20,000 US flights (January to March 2001). Weather: Seattle, 2012 to 2015. Seeded: the same tables always give the
same bank and ids. about 90 streams for practice and 60 for the exam (two steps each), no case shared between pools.
tools/check_updates.py re-derives every number with different code.
Python 3 standard library only.

Run:   python3 tools/make_updates.py           write the file
       python3 tools/make_updates.py --check   fail if the file on disk is not what the tables produce
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

OUT = os.path.join(common.ROOT, "app", "content", "questions", "updates.json")
SEED = "predict-updates-1"
MIN_CASES = 60
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
WHY = {
    "strong": "This news really mattered: it moved the share a long way. News that narrows the case to a group with a different record deserves a big move, but only as far as that group's own record goes.",
    "medium": "This news was worth a modest move. Most news is: it changes the odds a little, not all the way.",
    "weak": "This news was worth almost nothing. A detail can feel important and still leave the share where it was. Moving a lot on it is how you whiplash.",
}


def p1(x):
    return round(100 * x + 1e-9, 1)


def g(x, d=1):
    return f"{x:,.{d}f}"


def qid(key):
    return f"upd-{hashlib.sha1(key.encode()).hexdigest()[:7]}"


def cat(delta):
    d = abs(delta)
    return "strong" if d >= 8 - 1e-9 else "medium" if d >= 3 - 1e-9 else "weak"


# ---------------------------------------------------------------------------------------------------------------- flights
def hour_bucket(h):
    return "morning" if h < 10 else "midday" if h < 15 else "evening" if h < 20 else "night"


def dist_bucket(mi):
    return "under 300 miles" if mi < 300 else "300 to 599 miles" if mi < 600 else "600 to 999 miles" if mi < 1000 else "1,000 to 1,499 miles" if mi < 1500 else "1,500 miles or more"


def flight_streams():
    url, name = common.source_of("flights.csv")
    airports = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    F = []
    for r in common.read("flights.csv"):
        t = dt.datetime.strptime(r["departs"], "%Y-%m-%d %H:%M")
        F.append(dict(o=r["origin"], t=t, mi=int(r["distance_mi"]), late=int(r["arrival_delay_min"]) >= 15))
    conds = defaultdict(list)  # attribute -> [(key, phrase, predicate)]
    counts = defaultdict(int)
    for x in F:
        counts[x["o"]] += 1
    for o, n in counts.items():
        if n >= 250:
            conds["o"].append((f"o:{o}", f"it left {airports[o]} ({o})", lambda x, o=o: x["o"] == o))
    for m in (1, 2, 3):
        conds["m"].append((f"m:{m}", f"it flew in {MONTHS[m - 1]}", lambda x, m=m: x["t"].month == m))
    for h, ph in (("morning", "it is a morning flight (before 10)"), ("midday", "it is a midday flight (10 to 3)"), ("evening", "it is an evening flight (3 to 8 pm)"), ("night", "it is a night flight (after 8 pm)")):
        conds["h"].append((f"h:{h}", ph, lambda x, h=h: hour_bucket(x["t"].hour) == h))
    for b in ("under 300 miles", "300 to 599 miles", "600 to 999 miles", "1,000 to 1,499 miles", "1,500 miles or more"):
        conds["d"].append((f"d:{b}", f"it is a flight of {b}", lambda x, b=b: dist_bucket(x["mi"]) == b))
    conds["w"].append(("w:wd", "it flies on a weekday", lambda x: x["t"].weekday() < 5))
    conds["w"].append(("w:we", "it flies on a weekend", lambda x: x["t"].weekday() >= 5))
    return dict(kind="flight", rows=F, conds=conds, event=lambda x: x["late"], domain="travel", jdomain="work", url=url, name=name,
                lead="One flight from a record of 20,000 US domestic flights in January to March 2001. What you know so far: {start}.",
                ask="What is the chance it landed 15 or more minutes after schedule?", what="landed 15 or more minutes late", base_phrase=lambda start: start, units="flights")


# ---------------------------------------------------------------------------------------------------------------- weather
def weather_streams():
    url, name = common.source_of("seattle_weather.csv")
    rows = common.read("seattle_weather.csv")
    W = []
    prev = None
    for r in rows:
        d = dt.date.fromisoformat(r["date"])
        x = dict(d=d, rain=float(r["precip_mm"]) > 0, hi=float(r["temp_max_c"]), pwet=None if prev is None else prev["rain"], phi=None if prev is None else prev["hi"])
        W.append(x)
        prev = x
    W = [x for x in W if x["pwet"] is not None]
    conds = defaultdict(list)
    seasons = {"winter": (12, 1, 2), "spring": (3, 4, 5), "summer": (6, 7, 8), "autumn": (9, 10, 11)}
    for s, ms in seasons.items():
        conds["s"].append((f"s:{s}", f"it is a {s} day (months {', '.join(MONTHS[m - 1] for m in ms)})", lambda x, ms=ms: x["d"].month in ms))
    for m in range(1, 13):
        conds["m"].append((f"m:{m}", f"it is a day in {MONTHS[m - 1]}", lambda x, m=m: x["d"].month == m))
    conds["p"].append(("p:wet", "the day before had rain", lambda x: x["pwet"]))
    conds["p"].append(("p:dry", "the day before was dry", lambda x: not x["pwet"]))
    conds["t"].append(("t:warm", "the day before had a high of 15 °C or more", lambda x: x["phi"] >= 15))
    conds["t"].append(("t:cool", "the day before had a high under 15 °C", lambda x: x["phi"] < 15))
    for y in range(2012, 2016):
        conds["y"].append((f"y:{y}", f"it is a day in {y}", lambda x, y=y: x["d"].year == y))
    return dict(kind="weather", rows=W, conds=conds, event=lambda x: x["rain"], domain="weather", jdomain="life", url=url, name=name,
                lead="One day from Seattle's weather record, 2012 to 2015. What you know so far: {start}.",
                ask="What is the chance it had measurable rain that day?", what="had measurable rain", base_phrase=lambda start: start, units="days")


# The attribute orders a stream may use: the first news item and the second come from different attributes, and neither repeats the starting one.
ORDERS = {"flight": ["o", "m", "h", "d", "w"], "weather": ["s", "m", "p", "t", "y"]}
STARTS = {"flight": ["o", "d", "h", "m"], "weather": ["s", "m"]}


def candidates(spec):
    rows, event = spec["rows"], spec["event"]
    kind = spec["kind"]
    out = []
    flat = [(a, c) for a, cs in spec["conds"].items() for c in cs]
    cache = {}

    def stat(keys, preds):
        if keys in cache:
            return cache[keys]
        mem = [x for x in rows if all(p(x) for p in preds)]
        n = len(mem)
        k = sum(1 for x in mem if event(x))
        cache[keys] = (n, k)
        return n, k

    starts = [(a, c) for a, c in flat if a in STARTS[kind]]
    for a0, c0 in starts:
        n0, k0 = stat((c0[0],), (c0[2],))
        if n0 < MIN_CASES or k0 in (0, n0):
            continue
        for a1, c1 in flat:
            if a1 == a0 or a1 in (STARTS[kind] if False else []):
                continue
            if a1 in ("m", "s") and a0 in ("m", "s"):
                continue
            n1, k1 = stat((c0[0], c1[0]), (c0[2], c1[2]))
            if n1 < MIN_CASES or k1 in (0, n1):
                continue
            for a2, c2 in flat:
                if a2 in (a0, a1) or (a2 in ("m", "s") and (a0 in ("m", "s") or a1 in ("m", "s"))):
                    continue
                n2, k2 = stat((c0[0], c1[0], c2[0]), (c0[2], c1[2], c2[2]))
                if n2 < MIN_CASES or k2 in (0, n2):
                    continue
                t0, t1, t2 = p1(k0 / n0), p1(k1 / n1), p1(k2 / n2)
                out.append(dict(key=f"{kind}:{c0[0]}|{c1[0]}|{c2[0]}", conds=(c0, c1, c2), nk=((n0, k0), (n1, k1), (n2, k2)), truths=(t0, t1, t2), cats=(cat(t1 - t0), cat(t2 - t1))))
    return out


def build_kind(spec, pool_take):
    kind = spec["kind"]
    cands = candidates(spec)
    by_bucket = defaultdict(list)
    for c in cands:
        by_bucket[c["cats"]].append(c)
    out = {}
    taken_start = set()
    seen = set()  # (starting group, first news) pairs used by any pool: a step one is never asked in both pools
    for pool in ("exam", "practice"):
        want = pool_take[pool]
        rng = random.Random(f"{SEED}:{kind}:{pool}")
        # steps: 40 percent strong, 30 medium, 30 weak, so the streams are drawn from the nine (step one, step two) kinds in proportion
        weights = {("strong", "strong"): 16, ("strong", "medium"): 10, ("medium", "strong"): 10, ("strong", "weak"): 7, ("weak", "strong"): 7, ("medium", "medium"): 9, ("medium", "weak"): 7, ("weak", "medium"): 7, ("weak", "weak"): 7}
        tot = sum(weights.values())
        picked = []
        for b, w in weights.items():
            pool_b = sorted((c for c in by_bucket[b] if c["key"] not in taken_start), key=lambda c: c["key"])
            rng.shuffle(pool_b)
            take = max(1, round(want * w / tot))
            picked += pool_b[:take]
        rng.shuffle(picked)
        picked = picked[:want]
        # no two streams in a pool share their first two groups, and the exam shares no case with practice (the same starting group and news pair)
        final = []
        for c in picked:
            k = (c["conds"][0][0], c["conds"][1][0])
            if k in seen:
                continue
            seen.add(k)
            final.append(c)
        # fill up if de-duplication left it short
        if len(final) < want:
            rest = sorted((c for c in cands if c["key"] not in taken_start and (c["conds"][0][0], c["conds"][1][0]) not in seen), key=lambda c: c["key"])
            rng.shuffle(rest)
            for c in rest:
                k = (c["conds"][0][0], c["conds"][1][0])
                if k in seen:
                    continue
                seen.add(k)
                final.append(c)
                if len(final) >= want:
                    break
        for c in final:
            taken_start.add(c["key"])
        out[pool] = final[:want]
    return out


def to_problem(spec, c, pool):
    kind = spec["kind"]
    c0, c1, c2 = c["conds"]
    (n0, k0), (n1, k1), (n2, k2) = c["nk"]
    t0, t1, t2 = c["truths"]
    start = c0[1]
    steps = [dict(news=c1[1][:1].upper() + c1[1][1:], prior=t0, truth=t1, n=n1, k=k1, n_prior=n0),
             dict(news=c2[1][:1].upper() + c2[1][1:], prior=t1, truth=t2, n=n2, k=k2, n_prior=n1)]
    what = spec["what"]
    fact = (f"Starting group: {start}: {n0:,} {spec['units']}, {k0:,} of them ({g(t0)}%) {what}. Step 1: {c1[1]}: {n1:,} {spec['units']}, {k1:,} ({g(t1)}%). Step 2: {c2[1]}: {n2:,}, {k2:,} ({g(t2)}%).")
    why = " ".join(WHY[cat(s["truth"] - s["prior"])] for s in steps[:1]) + " The second step is judged on its own."
    return dict(id=qid(c["key"]), type="update", pool=pool, kind=kind, key=c["key"], lead=spec["lead"].format(start=start), ask=spec["ask"], unit="%", prior0=t0, steps=steps,
                domain=spec["domain"], jdomain=spec["jdomain"], fact=fact, why=why, verified="recorded", source=spec["url"], src_name=spec["name"], checked=common.BANK_DATE)


def build():
    out = []
    flights, weather = flight_streams(), weather_streams()
    fl = build_kind(flights, {"practice": 64, "exam": 36})
    wx = build_kind(weather, {"practice": 30, "exam": 24})
    for pool in ("exam", "practice"):
        for spec, res in ((flights, fl), (weather, wx)):
            out += [to_problem(spec, c, pool) for c in res[pool]]
    out.sort(key=lambda q: (q["pool"], q["id"]))
    return out


KEEP = ("id", "type", "pool", "kind", "key", "lead", "ask", "unit", "prior0", "steps", "domain", "jdomain", "fact", "why", "verified", "source", "src_name", "checked")


def render(qs):
    doc = {"version": 1, "built": common.BANK_DATE, "count": len(qs),
           "note": "Built by tools/make_updates.py from data/question_tables/. Do not edit by hand: change the tables or the generator and run it again. Each question is a stream of two steps; the app asks one step at a time.",
           "questions": [{k: q[k] for k in KEEP if k in q} for q in qs]}
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main():
    text = render(build())
    if "--check" in sys.argv:
        if open(OUT, encoding="utf-8").read() != text:
            sys.exit("app/content/questions/updates.json is not what the tables produce: run python3 tools/make_updates.py")
        print("updates.json matches the tables")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

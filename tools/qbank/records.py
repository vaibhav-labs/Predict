"""Judgment questions built from real records (verified = "recorded").

Each generator reads a table in data/question_tables/ (written once by tools/snapshot_tables.py, so nothing here goes online),
picks a real case from it (a day, a flight, a country, a year), describes the situation before the outcome in the `lead`, and
asks about the outcome in the `ask`. The outcome is simply what the record shows. How often the same kind of case turned out
that way, among the other cases in the record, is the question's `base`; it sets the difficulty and is shown in the reveal.

tools/check_questions.py works every one of these out again from the tables, with SQL and with a text parser, and shares no
code with this file.
"""
import datetime as dt
from collections import defaultdict

import common
from common import loo, pair, pct

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SEASON_OF = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring", 6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}
SEASON_MONTHS = {"winter": "December to February", "spring": "March to May", "summer": "June to August", "autumn": "September to November"}


def say(x):
    """A number as it is shown: no trailing zeros."""
    return f"{x:g}"


# --------------------------------------------------------------------------------------------------------- weather
WX_SRC = common.source_of("seattle_weather.csv")
WX_RANGE = "four-year (2012 to 2015)"


def weather():
    rows = common.read("seattle_weather.csv")
    days = [dict(d=dt.date.fromisoformat(r["date"]), p=float(r["precip_mm"]), hi=float(r["temp_max_c"]), lo=float(r["temp_min_c"])) for r in rows]
    n = len(days)
    assert all((days[i]["d"] - days[i - 1]["d"]).days == 1 for i in range(1, n)), "the weather table has a gap"
    wet = [x["p"] > 0 for x in days]
    stamp = lambda i: f"{days[i]['d'].day} {MONTHS[days[i]['d'].month - 1]}"
    full = lambda i: f"{stamp(i)} {days[i]['d'].year}"
    ent = lambda *idx: tuple(f"wx:{days[i]['d'].isoformat()}" for i in idx)
    rain_text = lambda i: f"{say(days[i]['p'])} mm of rain fell" if wet[i] else "no rain fell"

    # Does it rain today, given yesterday? (the month's own habit and the day before)
    cls = defaultdict(lambda: [0, 0])
    for i in range(1, n):
        c = cls[(days[i]["d"].month, wet[i - 1])]
        c[0] += 1
        c[1] += wet[i]
    for i in range(1, n):
        m, prev = days[i]["d"].month, wet[i - 1]
        nn, k = cls[(m, prev)]
        if nn < 30:
            continue
        p = loo(k, nn, int(wet[i]))
        lead = f"Seattle, {stamp(i)}. It {'rained' if prev else 'stayed dry'} yesterday."
        fact = (f"{full(i)}: {rain_text(i)}. Of the other {nn - 1:,} {MONTHS[m - 1]} days that followed {'a wet' if prev else 'a dry'} day in this {WX_RANGE} record, "
                f"{pct(p)} had measurable rain.")
        why = ("Weather has momentum: a wet day makes another wet day likelier, and a dry day another dry one. Start from how often it rains in this month "
               "after a day like yesterday, then adjust. Ignoring the season is the usual mistake.")
        pair("wrain", f"{days[i]['d'].isoformat()}", lead, "Measurable rain falls today.", "No measurable rain falls today.", wet[i], p, nn - 1, fact, why,
             "weather", *WX_SRC, ents=ent(i - 1, i))

    # Does a streak carry on?
    run = [1] * n
    for i in range(1, n):
        run[i] = run[i - 1] + 1 if wet[i] == wet[i - 1] else 1
    scls = defaultdict(lambda: [0, 0])
    for i in range(1, n):
        if run[i - 1] >= 3:
            c = scls[(SEASON_OF[days[i]["d"].month], wet[i - 1])]
            c[0] += 1
            c[1] += wet[i] == wet[i - 1]
    for i in range(1, n):
        k = run[i - 1]
        if k < 3:
            continue
        season, state = SEASON_OF[days[i]["d"].month], wet[i - 1]
        nn, kk = scls[(season, state)]
        if nn < 30:
            continue
        cont = wet[i] == state
        p = loo(kk, nn, int(cont))
        word = "rained" if state else "stayed dry"
        lead = f"Seattle, {stamp(i)}. It has {word} for {k} days in a row."
        fact = (f"{full(i)}: the streak {'carried on' if cont else 'ended'} ({rain_text(i)}). After three or more {'wet' if state else 'dry'} days in a row in {season} "
                f"({SEASON_MONTHS[season]}), the streak went on for another day in {pct(p)} of the other {nn - 1:,} cases in this record.")
        why = ("Streaks tend to go on: the weather that has held for several days is the best single guess for tomorrow. Feeling that a dry spell is "
               "'due' to break is the gambler's error.")
        pair("wstreak", f"{days[i]['d'].isoformat()}", lead, f"{'It rains' if state else 'It stays dry'} again today.", "The streak ends today.", cont, p, nn - 1, fact, why,
             "weather", *WX_SRC, ents=ent(*range(i - k, i + 1)))

    # How warm does this time of year get? (the other days within a week of the date, in every year of the record)
    doy = [x["d"].timetuple().tm_yday for x in days]
    near = lambda a, b: min(abs(a - b), 365 - abs(a - b)) <= 7
    rng = common.rng_for("wx-high")
    for i in range(n):
        window = [days[j]["hi"] for j in range(n) if j != i and near(doy[i], doy[j])]
        nw = len(window)
        if nw < 30:
            continue
        options = [x for x in range(int(min(window)), int(max(window)) + 2) if 0.12 <= sum(h >= x for h in window) / nw <= 0.88]
        if not options:
            continue
        x = options[rng.randrange(len(options))]
        p = sum(h >= x for h in window) / nw
        hi = days[i]["hi"]
        lead = f"Seattle, {stamp(i)}."
        fact = (f"{full(i)}: the high was {say(hi)} °C. Across the {nw:,} other days within a week of {stamp(i)} in this record (every year), the high reached {x} °C on {pct(p)} of them.")
        why = ("A date's own history is a strong forecast. For temperature the best first guess is how warm this time of year usually gets, "
               "not how warm it was last week.")
        pair("whigh", f"{days[i]['d'].isoformat()}", lead, f"The day's high reaches {x} °C or more.", f"The day's high stays below {x} °C.", hi >= x, p, nw, fact, why,
             "weather", *WX_SRC, ents=ent(i))

    # A freezing day in the cold months
    fcls = defaultdict(lambda: [0, 0])
    for x in days:
        c = fcls[x["d"].month]
        c[0] += 1
        c[1] += x["lo"] < 0
    for i in range(n):
        m = days[i]["d"].month
        if m not in (11, 12, 1, 2, 3):
            continue
        nn, k = fcls[m]
        frozen = days[i]["lo"] < 0
        p = loo(k, nn, int(frozen))
        lead = f"Seattle, {stamp(i)}."
        fact = (f"{full(i)}: the lowest temperature was {say(days[i]['lo'])} °C. Of the other {nn - 1:,} {MONTHS[m - 1]} days in this record, {pct(p)} dipped below 0 °C.")
        why = ("Seattle is mild, but winter nights still dip below freezing now and then. Judge a threshold by how often it was crossed in this month, "
               "not by how the weather feels.")
        pair("wfreeze", f"{days[i]['d'].isoformat()}", lead, "The day's lowest temperature falls below 0 °C.", "The day's lowest temperature stays at or above 0 °C.", frozen, p, nn - 1, fact, why,
             "weather", *WX_SRC, ents=ent(i))

    # How much rain on a wet day
    hcls = defaultdict(lambda: [0, 0])
    for i in range(n):
        if wet[i]:
            c = hcls[days[i]["d"].month]
            c[0] += 1
            c[1] += days[i]["p"] > 10
    for i in range(n):
        if not wet[i]:
            continue
        m = days[i]["d"].month
        nn, k = hcls[m]
        if nn < 30:
            continue
        heavy = days[i]["p"] > 10
        p = loo(k, nn, int(heavy))
        lead = f"Seattle, {stamp(i)}. Rain falls today."
        fact = f"{full(i)}: {say(days[i]['p'])} mm fell. Of the other {nn - 1:,} wet {MONTHS[m - 1]} days in this record, {pct(p)} brought more than 10 mm."
        why = "Most wet days in Seattle are light. A downpour is the exception, so 'it poured' is a story people remember far out of proportion to how often it happens."
        pair("wheavy", f"{days[i]['d'].isoformat()}", lead, "More than 10 mm falls.", "10 mm or less falls.", heavy, p, nn - 1, fact, why,
             "weather", *WX_SRC, ents=ent(i))

    # Does an unusually warm (or cold) day fade back toward normal?
    month_mean = {m: sum(x["hi"] for x in days if x["d"].month == m) / sum(1 for x in days if x["d"].month == m) for m in range(1, 13)}
    anomaly = lambda i: days[i]["hi"] - month_mean[days[i]["d"].month]
    rcls = defaultdict(lambda: [0, 0])
    for i in range(1, n):
        a = anomaly(i - 1)
        if abs(a) >= 3:
            sign = a > 0
            c = rcls[sign]
            c[0] += 1
            c[1] += (days[i]["hi"] < days[i - 1]["hi"]) if sign else (days[i]["hi"] > days[i - 1]["hi"])
    for i in range(1, n):
        a = anomaly(i - 1)
        if abs(a) < 3:
            continue
        sign = a > 0
        nn, k = rcls[sign]
        back = (days[i]["hi"] < days[i - 1]["hi"]) if sign else (days[i]["hi"] > days[i - 1]["hi"])
        p = loo(k, nn, int(back))
        m = days[i - 1]["d"].month
        lead = (f"Seattle, {stamp(i)}. Yesterday's high was {say(days[i - 1]['hi'])} °C, {abs(round(a))} °C {'above' if sign else 'below'} "
                f"the record's {MONTHS[m - 1]} average ({month_mean[m]:.1f} °C).")
        ask_yes = "Today's high is lower than yesterday's." if sign else "Today's high is higher than yesterday's."
        ask_no = "Today's high is the same or higher." if sign else "Today's high is the same or lower."
        fact = (f"{full(i)}: the high was {say(days[i]['hi'])} °C. After a day 3 °C or more {'above' if sign else 'below'} its month's average, the next day's high moved "
                f"back toward the average in {pct(p)} of the other {nn - 1:,} cases in this record.")
        why = "Unusual weather tends to fade back toward normal: after an unusually warm day the next one is more often cooler than hotter. Regression to the mean is the default."
        pair("wrevert", f"{days[i]['d'].isoformat()}", lead, ask_yes, ask_no, back, p, nn - 1, fact, why, "weather", *WX_SRC, ents=ent(i - 1, i))



# --------------------------------------------------------------------------------------------------------- flights
FL_SRC = common.source_of("flights.csv")
HOUR_BUCKETS = [(0, 8, "before 9 am"), (9, 11, "between 9 am and noon"), (12, 14, "between noon and 3 pm"), (15, 17, "between 3 pm and 6 pm"),
                (18, 20, "between 6 pm and 9 pm"), (21, 23, "at 9 pm or later")]
DIST_BUCKETS = [(0, 299, "under 300 miles"), (300, 699, "300 to 699 miles"), (700, 1199, "700 to 1,199 miles"), (1200, 99999, "1,200 miles or more")]
ORIGIN_MIN = 400  # an airport needs this many departures in the record before it gets a question of its own


def clock(t):
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'am' if t.hour < 12 else 'pm'}"


def bucket_of(value, buckets):
    for lo, hi, label in buckets:
        if lo <= value <= hi:
            return label
    raise ValueError(value)


def flights():
    airports = {r["iata"]: r["city"] for r in common.read("airports.csv")}
    F = [dict(row=int(r["row"]), t=dt.datetime.strptime(r["departs"], "%Y-%m-%d %H:%M"), o=r["origin"], d=r["destination"], mi=int(r["distance_mi"]), delay=int(r["arrival_delay_min"]))
         for r in common.read("flights.csv")]
    place = lambda code: f"{airports[code]} ({code})"
    landed = lambda x: ("right on schedule" if x["delay"] == 0 else f"{x['delay']} minutes late" if x["delay"] > 0 else f"{-x['delay']} minutes early")
    when = lambda x: f"on {x['t'].day} {MONTHS[x['t'].month - 1]} {x['t'].year}"
    for x in F:
        x["hb"] = bucket_of(x["t"].hour, HOUR_BUCKETS)
        x["db"] = bucket_of(x["mi"], DIST_BUCKETS)
    by_hour, by_dist, by_origin = defaultdict(list), defaultdict(list), defaultdict(list)
    for x in F:
        by_hour[x["hb"]].append(x)
        by_dist[x["db"]].append(x)
        by_origin[x["o"]].append(x)
    count = lambda xs, f: sum(1 for x in xs if f(x))
    late15, late60, early = (lambda x: x["delay"] > 15), (lambda x: x["delay"] > 60), (lambda x: x["delay"] < 0)
    overall60 = count(F, late60) / len(F)
    for x in F:
        ent = (f"fl:{x['row']}",)
        route = f"A flight from {place(x['o'])} to {place(x['d'])} is due to leave at {clock(x['t'])} on a {WEEKDAYS[x['t'].weekday()]} in {MONTHS[x['t'].month - 1]}."
        group = by_hour[x["hb"]]
        nn = len(group)
        # Late by more than 15 minutes, judged by the time of day
        p = loo(count(group, late15), nn, int(late15(x)))
        fact = f"The flight left {when(x)} and landed {landed(x)}. Of the other {nn - 1:,} flights scheduled to leave {x['hb']} in this record, {pct(p)} landed more than 15 minutes late."
        why = ("Delays snowball through the day: one late arrival makes the next departure late. Time of day is the best simple clue to whether a flight will be late, "
               "better than the route or the distance.")
        pair("flate", f"{x['row']}", route, "It lands more than 15 minutes late.", "It lands no more than 15 minutes late.", late15(x), p, nn - 1, fact, why, "travel", *FL_SRC, ents=ent)
        # Late by more than an hour
        if x["row"] % 3 == 0:  # one flight in three also gets this question, so it does not crowd out the rest
            p = loo(count(group, late60), nn, int(late60(x)))
            fact = f"The flight left {when(x)} and landed {landed(x)}. Of the other {nn - 1:,} flights scheduled to leave {x['hb']} in this record, {pct(p)} landed more than an hour late."
            why = (f"A long delay is rare, but rare is not never: in this record about {pct(overall60)[:-1]} flights in 100 landed more than an hour late. "
                   "A small chance is still a chance, and a player who treats it as zero pays for it at 99%.")
            pair("fhour", f"{x['row']}", route, "It lands more than an hour late.", "It lands no more than an hour late.", late60(x), p, nn - 1, fact, why, "travel", *FL_SRC, ents=ent)
        # Landing early, judged by distance
        if x["row"] % 3 == 1:
            g = by_dist[x["db"]]
            nn = len(g)
            p = loo(count(g, early), nn, int(early(x)))
            lead = f"A {x['mi']:,}-mile flight from {place(x['o'])} to {place(x['d'])} is due to leave at {clock(x['t'])} on a {WEEKDAYS[x['t'].weekday()]} in {MONTHS[x['t'].month - 1]}."
            fact = f"The flight left {when(x)} and landed {landed(x)}. Of the other {nn - 1:,} flights of {x['db']} in this record, {pct(p)} landed ahead of schedule."
            why = ("Longer flights land early more often, which fits schedules that carry slack for long trips. Distance tells you little about whether a flight will be late, "
                   "but a little about whether it will be early.")
            pair("fearly", f"{x['row']}", lead, "It lands ahead of schedule.", "It lands on time or late.", early(x), p, nn - 1, fact, why, "travel", *FL_SRC, ents=ent)
        # Late, judged by where it starts
        if x["row"] % 3 == 2 and len(by_origin[x["o"]]) >= ORIGIN_MIN:
            g = by_origin[x["o"]]
            nn = len(g)
            p = loo(count(g, late15), nn, int(late15(x)))
            lead = f"A flight leaves {place(x['o'])} for {place(x['d'])} in {MONTHS[x['t'].month - 1]}."
            fact = f"The flight left {when(x)} and landed {landed(x)}. Of the other {nn - 1:,} flights out of {x['o']} in this record, {pct(p)} landed more than 15 minutes late."
            why = "Where a flight starts matters less than when it leaves. Airports differ, but the difference is small next to the time-of-day effect."
            pair("forigin", f"{x['row']}", lead, "It lands more than 15 minutes late.", "It lands no more than 15 minutes late.", late15(x), p, nn - 1, fact, why, "travel", *FL_SRC, ents=ent)


# --------------------------------------------------------------------------------------------------------- world trends
# Our World in Data indicators, every fifth year from 1990 to 2020. A window is three of those years in a row: the five years before
# (what the player is shown), the year at the end of them, and five years on (what they are asked about).
STEP = 5


def dp2(*vals):
    return 2 if min(vals) < 1 else 1


INDICATORS = {
    "life": dict(file="owid_life_expectancy.csv", short="life expectancy",
                 phrase=lambda a, b: f"life expectancy at birth went from {a:.1f} to {b:.1f} years", fmt=lambda v, *o: f"{v:.1f} years",
                 shown=lambda v, *o: f"{v:.1f}",
                 why="Slow-moving trends are the best bet: life expectancy usually keeps rising, and when it dips it usually bounces back. Before betting against a steady trend, look for something that would break it, such as a war or an epidemic."),
    "child": dict(file="owid_child_mortality.csv", short="the under-five death rate",
                  phrase=lambda a, b: f"the death rate for children under five went from {a:.{dp2(a, b)}f}% to {b:.{dp2(a, b)}f}% of live births",
                  fmt=lambda v, *o: f"{v:.{dp2(v, *o)}f}%", shown=lambda v, *o: f"{v:.{dp2(v, *o)}f}",
                  why="Child deaths have fallen almost everywhere for decades, so betting on the trend is rarely wrong. When the base rate for a steady trend is this lopsided, 'it might reverse' deserves very little weight."),
    "co2": dict(file="owid_co2_per_person.csv", short="CO₂ emissions per person",
                phrase=lambda a, b: f"CO₂ emissions per person went from {a:.{dp2(a, b)}f} to {b:.{dp2(a, b)}f} tonnes a year",
                fmt=lambda v, *o: f"{v:.{dp2(v, *o)}f} tonnes", shown=lambda v, *o: f"{v:.{dp2(v, *o)}f}",
                why="Emissions per person move with the economy, fuel prices and policy, so a few years of trend is a shakier guide here than for slow trends like life expectancy. Treat momentum as a modest edge, not a rule."),
    "gdp": dict(file="owid_gdp_per_person.csv", short="income per person", domain="money",
                phrase=lambda a, b: f"income per person (GDP per capita, in 2021 prices and adjusted for living costs) went from ${a:,.0f} to ${b:,.0f}",
                fmt=lambda v, *o: f"${v:,.0f}", shown=lambda v, *o: f"{v:,.0f}",
                why="Incomes mostly keep growing, but recessions and crises interrupt the climb in a real share of cases. Growth is the base rate, not a promise."),
    "renew": dict(file="owid_renewables_share.csv", short="the renewable share of electricity",
                  phrase=lambda a, b: f"renewables' share of electricity went from {a:.{dp2(a, b)}f}% to {b:.{dp2(a, b)}f}%",
                  fmt=lambda v, *o: f"{v:.{dp2(v, *o)}f}%", shown=lambda v, *o: f"{v:.{dp2(v, *o)}f}",
                  why="The renewable share has mostly crept up, but rainfall and the fuel mix make it jumpy in places. A rising trend is likelier to go on than to stop, though far from certain."),
    "fert": dict(file="owid_fertility.csv", short="births per woman",
                 phrase=lambda a, b: f"the average number of births per woman went from {a:.2f} to {b:.2f}",
                 fmt=lambda v, *o: f"{v:.2f} births per woman", shown=lambda v, *o: f"{v:.2f}",
                 why="Fertility has fallen in most countries for decades, and where it has been falling it usually keeps falling. Slow demographic trends rarely reverse inside five years."),
}


def trends():
    for ind, spec in INDICATORS.items():
        series, names = defaultdict(dict), {}
        for r in common.read(spec["file"]):
            series[r["code"]][int(r["year"])] = float(r["value"])
            names[r["code"]] = r["country"]
        windows = []
        for code in sorted(series):
            s = series[code]
            for t in range(1995, 2016, STEP):
                if all(y in s for y in (t - STEP, t, t + STEP)):
                    a, b, c = s[t - STEP], s[t], s[t + STEP]
                    if a != 0 and b != 0 and abs(b - a) / abs(a) >= 0.01 and abs(c - b) / abs(b) >= 0.005:
                        windows.append(dict(code=code, t=t, a=a, b=b, c=c, prior_up=b > a, rose=c > b))
        cls = defaultdict(lambda: [0, 0])
        for w in windows:
            cls[w["prior_up"]][0] += 1
            cls[w["prior_up"]][1] += w["rose"]
        for w in windows:
            t, a, b, c = w["t"], w["a"], w["b"], w["c"]
            if spec["shown"](a, b, c) == spec["shown"](b, a, c) and False:
                continue
            if len({spec["shown"](v, a, b, c) for v in (a, b)}) < 2 or len({spec["shown"](v, a, b, c) for v in (b, c)}) < 2:
                continue
            nn, k = cls[w["prior_up"]]
            p = loo(k, nn, int(w["rose"]))
            lead = f"{names[w['code']]}, {t - STEP} to {t}: {spec['phrase'](a, b)}."
            fact = (f"By {t + STEP} it was {spec['fmt'](c, a, b)}. Across the {nn - 1:,} other country-windows in this record where {spec['short']} had "
                    f"{'risen' if w['prior_up'] else 'fallen'} over the previous five years, it rose over the next five in {pct(p)} of them.")
            pair(f"t{ind}", f"{w['code']}:{t}", lead, f"By {t + STEP} it is higher than in {t}.", f"By {t + STEP} it is lower than in {t}.", w["rose"], p, nn - 1, fact, spec["why"], spec.get("domain", "world"),
                 *common.source_of(spec["file"]), ents=(f"tr:{ind}:{w['code']}",))


# --------------------------------------------------------------------------------------------------------- markets
MK_SRC = common.source_of("sp500_shiller.csv")
MK_FIRST, MK_LAST = 1950, 2022


def markets():
    dec = {}
    for r in common.read("sp500_shiller.csv"):
        if r["month"].endswith("-12"):
            dec[int(r["month"][:4])] = (float(r["price"]), float(r["real_price"]))
    P = {y: v[0] for y, v in dec.items()}
    R = {y: v[1] for y, v in dec.items()}
    years = list(range(MK_FIRST, MK_LAST + 1))
    ret = {y: P[y] / P[y - 1] - 1 for y in years}
    note = "price only; dividends are not counted"
    between = lambda a_, b_: f"from the December {a_} average to the December {b_} average"
    base_lead = f"A calendar year is drawn at random from {MK_FIRST} to {MK_LAST}. We won't say which."
    why_year = ("Stocks rise in most years, but a typical year swings a long way either way. A rising market is the base rate, not a promise, "
                "and a fall of 10% or more is not a freak event.")
    kinds = [
        ("up", lambda r_: r_ > 0, "The S&P 500 ended the year higher than it began.", "The S&P 500 ended the year lower than it began.", "it ended higher"),
        ("drop10", lambda r_: r_ <= -0.10, "The S&P 500 fell 10% or more over the year.", "The S&P 500 did not fall 10% over the year.", "it fell 10% or more"),
        ("gain20", lambda r_: r_ >= 0.20, "The S&P 500 rose 20% or more over the year.", "The S&P 500 did not rise 20% over the year.", "it rose 20% or more"),
    ]
    for name, event, yes, no, said in kinds:
        k = sum(event(ret[y]) for y in years)
        for y in years:
            p = loo(k, len(years), int(event(ret[y])))
            fact = (f"It was {y}: the S&P 500 {'rose' if ret[y] > 0 else 'fell'} {abs(ret[y]) * 100:.1f}% {between(y - 1, y)} ({note}). "
                    f"Across the other {len(years) - 1:,} years from {MK_FIRST} to {MK_LAST}, {said} in {pct(p)}.")
            pair(f"my{name}", f"{y}", base_lead, yes, no, event(ret[y]), p, len(years) - 1, fact, why_year, "money", *MK_SRC, ents=(f"mk:{y}",))
    # After a bad year, and after a very good one
    for name, cond, lead, said_class in (
        ("afterdown", lambda y: ret[y - 1] < 0, f"A year is drawn at random from those that came right after a falling year ({MK_FIRST + 1} to {MK_LAST}).", "a falling year"),
        ("afterboom", lambda y: ret[y - 1] >= 0.20, f"A year is drawn at random from those that came right after a gain of 20% or more ({MK_FIRST + 1} to {MK_LAST}).", "a gain of 20% or more"),
    ):
        pool = [y for y in range(MK_FIRST + 1, MK_LAST + 1) if cond(y)]
        k = sum(ret[y] > 0 for y in pool)
        for y in pool:
            p = loo(k, len(pool), int(ret[y] > 0))
            fact = (f"It was {y}, after {'a fall' if ret[y - 1] < 0 else 'a gain'} of {abs(ret[y - 1]) * 100:.1f}% in {y - 1}: the S&P 500 {'rose' if ret[y] > 0 else 'fell'} {abs(ret[y]) * 100:.1f}% {between(y - 1, y)} ({note}). "
                    f"Of the other {len(pool) - 1:,} years that came right after {said_class}, it rose in {pct(p)}.")
            why = ("One year tells you little about the next. After a bad year or a great one the market has still gone up more often than down, "
                   "so 'it is due for a fall' or 'it has to bounce' are stories, not forecasts.")
            pair(f"my{name}", f"{y}", lead, "The S&P 500 rose that year.", "The S&P 500 fell that year.", ret[y] > 0, p, len(pool) - 1, fact, why, "money", *MK_SRC, ents=(f"mk:{y - 1}", f"mk:{y}"))
    # Longer stretches: the longer you hold, the likelier a gain
    for span in (5, 10, 20):
        starts = list(range(MK_FIRST, MK_LAST - span + 1))
        for real in (False, True):
            S = R if real else P
            gain = {s: S[s + span] / S[s] - 1 for s in starts}
            k = sum(g > 0 for g in gain.values())
            for s in starts:
                p = loo(k, len(starts), int(gain[s] > 0))
                lead = f"A {span}-year stretch is drawn at random, starting in a year from {MK_FIRST} to {MK_LAST - span}. We won't say which."
                yes = ("Even after inflation, the S&P 500 ended the stretch higher than it began." if real else "The S&P 500 ended the stretch higher than it began.")
                no = ("After inflation, the S&P 500 ended the stretch lower than it began." if real else "The S&P 500 ended the stretch lower than it began.")
                fact = (f"It was {s} to {s + span}: the S&P 500 {'rose' if gain[s] > 0 else 'fell'} {abs(gain[s]) * 100:.0f}%{' after inflation' if real else ''} {between(s, s + span)} ({note}). "
                        f"Across the other {len(starts) - 1:,} stretches of {span} years from {MK_FIRST} on, it ended higher in {pct(p)}. Neighbouring stretches overlap, so there are fewer independent cases than that.")
                if real:
                    why = ("Inflation matters. Counting prices only, with no dividends, every stretch of 5, 10 or 20 years that began between 1966 and 1968 ended behind after inflation. "
                           "Match your confidence to the horizon, and to whether you measure before or after inflation.")
                else:
                    why = ("The longer the stretch, the likelier a gain: losses are common over a year, rarer over five, and rare over twenty. "
                           "Matching your confidence to the time horizon is a judgment skill of its own.")
                pair(f"mw{span}{'r' if real else 'n'}", f"{s}", lead, yes, no, gain[s] > 0, p, len(starts) - 1, fact, why, "money", *MK_SRC, ents=tuple(f"mk:{y}" for y in range(s, s + span + 1)))


def generate():
    weather()
    flights()
    trends()
    markets()

#!/usr/bin/env python3
"""Check the question banks before they ship. Nothing here shares code with the builder (tools/make_questions.py and tools/qbank/):
it reads the record tables in data/question_tables/ and the shipped question text, and works every answer out again.

  1. Shape: every question has the fields the app reads, valid labels, a source, and no builder's name in it.
  2. Truth: every recorded question is rebuilt from its own text. The case it names (a day of weather, a flight, a country's
     figures, a year of the stock market) is found in the records, and the answer, the chance it was given (`base`), the number
     of other cases behind that chance, the percentages printed in the reveal and the difficulty are all recomputed and compared.
     Every sourced question is matched to its documented fact in data/question_tables/base_rates.csv and its claim is worked out
     from the documented number and the rounding the source used.
  3. Fairness: cases were drawn without looking at how they turned out, so a player who knew every base rate would be calibrated on
     the bank. A z-test on the recorded questions says whether the true and false claims came out as the base rates predict.
  4. Balance: half true and half false, the designed difficulty mix, no subject above 35%, no case or fact used twice in a bank,
     and nothing shared between the starter bank and the exam pool.
  5. Freshness: the files on disk are exactly what tools/make_questions.py builds from the tables.

Run by tools/check_data.py (and so by the deploy workflow), or by hand:  python3 tools/check_questions.py
Python 3 standard library only.
"""
import csv
import datetime as dt
import json
import math
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BANK = os.path.join(ROOT, "app", "content", "questions", "starter.json")
EXAM_BANK = os.path.join(ROOT, "app", "content", "questions", "exam-u1.json")
TOPUPS = os.path.join(ROOT, "app", "content", "questions", "topups.json")
TABLES = os.path.join(ROOT, "data", "question_tables")
DOMAINS = {"weather", "travel", "money", "work", "world", "sport", "life"}
FIELDS = ("id", "lead", "ask", "claim", "answer", "base", "n", "fact", "why", "domain", "diff", "verified", "source", "src_name", "checked")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SEASON = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring", 6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}
SEASON_SPAN = {"winter": "December to February", "spring": "March to May", "summer": "June to August", "autumn": "September to November"}
EASY_AT, MEDIUM_AT = 0.85, 0.68        # a claim goes one way this often among cases like it: easy, medium (else hard)
EASY_MARGIN, MEDIUM_MARGIN, MIN_MARGIN = 1.2, 0.5, 0.25   # the same idea for a sourced claim: how far its threshold sits from the documented value
MIN_CASES = 30                         # a kind of case needs this many others before a base rate is quoted
MIN_CASES_SMALL = 10                   # years that follow a fall or a boom are few: allowed down to this many, and the reveal prints the count
MAX_Z = 3.0                            # the fairness test allows this many standard errors


class Bad(Exception):
    """A question's own text does not match the records."""


def need(cond, message):
    if not cond:
        raise Bad(message)


def table(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def pct(x):
    return math.floor(x * 100 + 0.5)


def num(text):
    return float(text.replace(",", ""))


def diff_of(p):
    q = max(p, 1 - p)
    return "easy" if q >= EASY_AT - 1e-9 else "medium" if q >= MEDIUM_AT - 1e-9 else "hard"


def logit(p):
    p = min(max(p, 0.005), 0.995)
    return math.log(p / (1 - p))


def margin(scale, low, high, t):
    if scale == "share":
        return logit(low / 100) - logit(t / 100) if t < low else logit(t / 100) - logit(high / 100)
    return math.log(low / t) if t < low else math.log(t / high)


def diff_of_margin(m):
    return "easy" if m >= EASY_MARGIN else "medium" if m >= MEDIUM_MARGIN else "hard"


def shown_ok(text, value):
    """Is a number printed in a question the table's value, rounded to the digits printed?"""
    digits = len(text.split(".")[1]) if "." in text else 0
    return abs(num(text) - value) <= 0.5 * 10 ** -digits + 1e-9


# ===================================================================================== the records, loaded for checking
class Records:
    def __init__(self):
        self.weather = sorted(({"d": dt.date.fromisoformat(r["date"]), "p": float(r["precip_mm"]), "hi": float(r["temp_max_c"]), "lo": float(r["temp_min_c"])}
                               for r in table("seattle_weather.csv")), key=lambda x: x["d"])
        self.at = {x["d"]: i for i, x in enumerate(self.weather)}
        self.wet = [x["p"] > 0 for x in self.weather]
        self.db = sqlite3.connect(":memory:")
        db = self.db
        db.execute("CREATE TABLE fl (row INTEGER, day TEXT, hhmm TEXT, hour INTEGER, o TEXT, d TEXT, mi INTEGER, delay INTEGER)")
        db.executemany("INSERT INTO fl VALUES (?,?,?,?,?,?,?,?)",
                       [(int(r["row"]), r["departs"][:10], r["departs"][11:], int(r["departs"][11:13]), r["origin"], r["destination"], int(r["distance_mi"]), int(r["arrival_delay_min"]))
                        for r in table("flights.csv")])
        db.execute("CREATE TABLE ap (iata TEXT, city TEXT)")
        db.executemany("INSERT INTO ap VALUES (?,?)", [(r["iata"], r["city"]) for r in table("airports.csv")])
        db.execute("CREATE TABLE sp (month TEXT, price REAL, real REAL)")
        db.executemany("INSERT INTO sp VALUES (?,?,?)", [(r["month"], float(r["price"]), float(r["real_price"])) for r in table("sp500_shiller.csv")])
        self.owid = {"life": "owid_life_expectancy.csv", "child": "owid_child_mortality.csv", "co2": "owid_co2_per_person.csv",
                     "gdp": "owid_gdp_per_person.csv", "renew": "owid_renewables_share.csv", "fert": "owid_fertility.csv"}
        for ind, name in self.owid.items():
            db.execute(f"CREATE TABLE ow_{ind} (code TEXT, country TEXT, year INTEGER, value REAL)")
            db.executemany(f"INSERT INTO ow_{ind} VALUES (?,?,?,?)", [(r["code"], r["country"], int(r["year"]), float(r["value"])) for r in table(name)])
            # a window: the value five years before, at the year, and five years on; the year before must have moved, and so must the year after
            db.execute(f"""CREATE VIEW win_{ind} AS SELECT a.code AS code, a.country AS country, b.year AS t, a.value AS va, b.value AS vb, c.value AS vc
                           FROM ow_{ind} a JOIN ow_{ind} b ON b.code = a.code AND b.year = a.year + 5 JOIN ow_{ind} c ON c.code = a.code AND c.year = a.year + 10
                           WHERE b.year BETWEEN 1995 AND 2015 AND a.value <> 0 AND b.value <> 0
                             AND ABS(b.value - a.value) / ABS(a.value) >= 0.01 AND ABS(c.value - b.value) / ABS(b.value) >= 0.005""")
        self.dec = {int(m[:4]): (p, rp) for m, p, rp in db.execute("SELECT month, price, real FROM sp WHERE month LIKE '%-12'")}
        self._weather_classes()

    # ---------------------------------------------------------------------------------------------------- weather classes
    def _weather_classes(self):
        W, n = self.weather, len(self.weather)
        assert all((W[i]["d"] - W[i - 1]["d"]).days == 1 for i in range(1, n)), "the weather table has a gap"
        self.run = [1] * n
        for i in range(1, n):
            self.run[i] = self.run[i - 1] + 1 if self.wet[i] == self.wet[i - 1] else 1
        by_month = defaultdict(list)
        for x in W:
            by_month[x["d"].month].append(x["hi"])
        self.mean_hi = {m: sum(v) / len(v) for m, v in by_month.items()}
        self.anom = [x["hi"] - self.mean_hi[x["d"].month] for x in W]

    def weather_day(self, day):
        need(day in self.at, f"{day} is not in the weather record")
        return self.at[day]


# ===================================================================================== one rule per kind of recorded question
DATE = re.compile(r"^(\d{1,2}) (\w+) (\d{4}): ")


def fact_date(fact):
    m = DATE.match(fact)
    need(m and m[2] in MONTHS, "the reveal does not open with the date")
    return dt.date(int(m[3]), MONTHS.index(m[2]) + 1, int(m[1])), m


def stamp_ok(lead_day, lead_month, day):
    need(int(lead_day) == day.day and lead_month == MONTHS[day.month - 1], f"the lead names {lead_day} {lead_month} but the reveal is about {day}")


def result(answer, p_event, n, ents, ask_yes):
    """`ask_yes` is True when the shipped claim says the event happens; its base is the event's rate, otherwise one minus it."""
    return {"answer": answer if ask_yes else not answer, "base": p_event if ask_yes else 1 - p_event, "n": n, "ents": ents}


def rule_rain(R, q):
    m = re.match(r"^Seattle, (\d+) (\w+)\. It (rained|stayed dry) yesterday\.$", q["lead"])
    if not m or q["ask"] not in ("Measurable rain falls today.", "No measurable rain falls today."):
        return None
    day, i = fact_date(q["fact"])[0], None
    i = R.weather_day(day)
    stamp_ok(m[1], m[2], day)
    W, wet = R.weather, R.wet
    need(i > 0 and wet[i - 1] == (m[3] == "rained"), "the lead's 'yesterday' does not match the record")
    cases = [j for j in range(1, len(W)) if W[j]["d"].month == day.month and wet[j - 1] == wet[i - 1]]
    k, nn = sum(wet[j] for j in cases), len(cases)
    need(nn >= MIN_CASES, "too few cases for a base rate")
    p = (k - wet[i]) / (nn - 1)
    x = W[i]["p"]
    rain = f"{x:g} mm of rain fell" if wet[i] else "no rain fell"
    f = re.match(r"^\d+ \w+ \d{4}: (.+?)\. Of the other ([\d,]+) (\w+) days that followed (a wet|a dry) day in this four-year \(2012 to 2015\) record, (\d+)% had measurable rain\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    need(f[1] == rain and num(f[2]) == nn - 1 and f[3] == MONTHS[day.month - 1] and (f[4] == "a wet") == wet[i - 1] and int(f[5]) == pct(p), f"the reveal's numbers differ from the record: {f.groups()} against {rain}, {nn - 1}, {pct(p)}%")
    return result(wet[i], p, nn - 1, [("wx", day), ("wx", day - dt.timedelta(1))], q["ask"] == "Measurable rain falls today.")


def rule_streak(R, q):
    m = re.match(r"^Seattle, (\d+) (\w+)\. It has (rained|stayed dry) for (\d+) days in a row\.$", q["lead"])
    if not m or q["ask"] not in ("It rains again today.", "It stays dry again today.", "The streak ends today."):
        return None
    day = fact_date(q["fact"])[0]
    i = R.weather_day(day)
    stamp_ok(m[1], m[2], day)
    W, wet, run = R.weather, R.wet, R.run
    state = m[3] == "rained"
    need(wet[i - 1] == state and run[i - 1] == int(m[4]) and run[i - 1] >= 3, "the streak in the lead does not match the record")
    season = SEASON[day.month]
    cases = [j for j in range(1, len(W)) if run[j - 1] >= 3 and SEASON[W[j]["d"].month] == season and wet[j - 1] == state]
    nn, k = len(cases), sum(wet[j] == state for j in cases)
    need(nn >= MIN_CASES, "too few cases for a base rate")
    cont = wet[i] == state
    p = (k - cont) / (nn - 1)
    f = re.match(r"^\d+ \w+ \d{4}: the streak (carried on|ended) \((.+?)\)\. After three or more (wet|dry) days in a row in (\w+) \((.+?)\), the streak went on for another day in (\d+)% of the other ([\d,]+) cases in this record\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    rain = f"{W[i]['p']:g} mm of rain fell" if wet[i] else "no rain fell"
    need((f[1] == "carried on") == cont and f[2] == rain and (f[3] == "wet") == state and f[4] == season and f[5] == SEASON_SPAN[season]
         and int(f[6]) == pct(p) and num(f[7]) == nn - 1, "the reveal's numbers differ from the record")
    ents = [("wx", W[j]["d"]) for j in range(i - run[i - 1], i + 1)]
    expected_ask = "It rains again today." if state else "It stays dry again today."
    need(q["ask"] in (expected_ask, "The streak ends today."), "the claim does not match the streak")
    return result(cont, p, nn - 1, ents, q["ask"] == expected_ask)


def rule_high(R, q):
    m = re.match(r"^Seattle, (\d+) (\w+)\.$", q["lead"])
    a = re.match(r"^The day's high (reaches (-?\d+) °C or more|stays below (-?\d+) °C)\.$", q["ask"])
    if not m or not a:
        return None
    day = fact_date(q["fact"])[0]
    i = R.weather_day(day)
    stamp_ok(m[1], m[2], day)
    x = int(a[2] or a[3])
    doy = day.timetuple().tm_yday
    window = [y["hi"] for j, y in enumerate(R.weather) if j != i and min(abs(y["d"].timetuple().tm_yday - doy), 365 - abs(y["d"].timetuple().tm_yday - doy)) <= 7]
    nn = len(window)
    need(nn >= MIN_CASES, "too few cases for a base rate")
    p = sum(h >= x for h in window) / nn
    need(0.12 <= p <= 0.88, f"the threshold {x} °C is reached on {p:.0%} of comparable days, outside the 12% to 88% the design allows")
    hi = R.weather[i]["hi"]
    f = re.match(r"^\d+ \w+ \d{4}: the high was (-?[\d.]+) °C\. Across the ([\d,]+) other days within a week of (\d+) (\w+) in this record \(every year\), the high reached (-?\d+) °C on (\d+)% of them\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    need(num(f[1]) == hi and num(f[2]) == nn and int(f[3]) == day.day and f[4] == MONTHS[day.month - 1] and int(f[5]) == x and int(f[6]) == pct(p), "the reveal's numbers differ from the record")
    return result(hi >= x, p, nn, [("wx", day)], a[2] is not None)


def rule_freeze(R, q):
    m = re.match(r"^Seattle, (\d+) (\w+)\.$", q["lead"])
    if not m or q["ask"] not in ("The day's lowest temperature falls below 0 °C.", "The day's lowest temperature stays at or above 0 °C."):
        return None
    day = fact_date(q["fact"])[0]
    i = R.weather_day(day)
    stamp_ok(m[1], m[2], day)
    need(day.month in (11, 12, 1, 2, 3), "freezing questions are asked for November to March only")
    cases = [x["lo"] for x in R.weather if x["d"].month == day.month]
    nn, k = len(cases), sum(v < 0 for v in cases)
    frozen = R.weather[i]["lo"] < 0
    p = (k - frozen) / (nn - 1)
    f = re.match(r"^\d+ \w+ \d{4}: the lowest temperature was (-?[\d.]+) °C\. Of the other ([\d,]+) (\w+) days in this record, (\d+)% dipped below 0 °C\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    need(num(f[1]) == R.weather[i]["lo"] and num(f[2]) == nn - 1 and f[3] == MONTHS[day.month - 1] and int(f[4]) == pct(p), "the reveal's numbers differ from the record")
    return result(frozen, p, nn - 1, [("wx", day)], q["ask"].startswith("The day's lowest temperature falls"))


def rule_heavy(R, q):
    m = re.match(r"^Seattle, (\d+) (\w+)\. Rain falls today\.$", q["lead"])
    if not m or q["ask"] not in ("More than 10 mm falls.", "10 mm or less falls."):
        return None
    day = fact_date(q["fact"])[0]
    i = R.weather_day(day)
    stamp_ok(m[1], m[2], day)
    need(R.wet[i], "the lead says rain falls, but the record shows none")
    cases = [x["p"] for x in R.weather if x["d"].month == day.month and x["p"] > 0]
    nn, k = len(cases), sum(v > 10 for v in cases)
    need(nn >= MIN_CASES, "too few cases for a base rate")
    heavy = R.weather[i]["p"] > 10
    p = (k - heavy) / (nn - 1)
    f = re.match(r"^\d+ \w+ \d{4}: ([\d.]+) mm fell\. Of the other ([\d,]+) wet (\w+) days in this record, (\d+)% brought more than 10 mm\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    need(num(f[1]) == R.weather[i]["p"] and num(f[2]) == nn - 1 and f[3] == MONTHS[day.month - 1] and int(f[4]) == pct(p), "the reveal's numbers differ from the record")
    return result(heavy, p, nn - 1, [("wx", day)], q["ask"] == "More than 10 mm falls.")


def rule_revert(R, q):
    m = re.match(r"^Seattle, (\d+) (\w+)\. Yesterday's high was (-?[\d.]+) °C, (\d+) °C (above|below) the record's (\w+) average \(([\d.]+) °C\)\.$", q["lead"])
    if not m:
        return None
    day = fact_date(q["fact"])[0]
    i = R.weather_day(day)
    stamp_ok(m[1], m[2], day)
    W, A = R.weather, R.anom
    above = m[5] == "above"
    need(abs(A[i - 1]) >= 3 and (A[i - 1] > 0) == above, "yesterday was not 3 °C or more away from its month's average on that side")
    ym = W[i - 1]["d"].month
    need(num(m[3]) == W[i - 1]["hi"] and m[6] == MONTHS[ym - 1] and m[7] == f"{R.mean_hi[ym]:.1f}" and int(m[4]) == abs(round(A[i - 1])), "the lead's figures differ from the record")
    back = lambda j: (W[j]["hi"] < W[j - 1]["hi"]) if above else (W[j]["hi"] > W[j - 1]["hi"])
    cases = [j for j in range(1, len(W)) if abs(A[j - 1]) >= 3 and (A[j - 1] > 0) == above]
    nn, k = len(cases), sum(back(j) for j in cases)
    p = (k - back(i)) / (nn - 1)
    f = re.match(r"^\d+ \w+ \d{4}: the high was (-?[\d.]+) °C\. After a day 3 °C or more (above|below) its month's average, the next day's high moved back toward the average in (\d+)% of the other ([\d,]+) cases in this record\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    need(num(f[1]) == W[i]["hi"] and (f[2] == "above") == above and int(f[3]) == pct(p) and num(f[4]) == nn - 1, "the reveal's numbers differ from the record")
    yes, no = (("Today's high is lower than yesterday's.", "Today's high is the same or higher.") if above else ("Today's high is higher than yesterday's.", "Today's high is the same or lower."))
    need(q["ask"] in (yes, no), "the claim does not match the direction")
    return result(back(i), p, nn - 1, [("wx", day - dt.timedelta(1)), ("wx", day)], q["ask"] == yes)


# ----------------------------------------------------------------------------------------------------------------- flights
HOUR_BUCKETS = [(0, 9, "before 9 am"), (9, 12, "between 9 am and noon"), (12, 15, "between noon and 3 pm"), (15, 18, "between 3 pm and 6 pm"), (18, 21, "between 6 pm and 9 pm"), (21, 24, "at 9 pm or later")]
DIST_BUCKETS = [(0, 300, "under 300 miles"), (300, 700, "300 to 699 miles"), (700, 1200, "700 to 1,199 miles"), (1200, 10 ** 6, "1,200 miles or more")]
PLACE = r"(.+?) \(([A-Z]{3})\)"
CLOCK = r"(\d{1,2}):(\d{2}) (am|pm)"


def bucket(value, buckets):
    return next((lo, hi, label) for lo, hi, label in buckets if lo <= value < hi)


def rule_flight(R, q):
    lead, ask = q["lead"], q["ask"]
    m1 = re.match(rf"^A flight from {PLACE} to {PLACE} is due to leave at {CLOCK} on a (\w+) in (\w+)\.$", lead)
    m2 = re.match(rf"^A ([\d,]+)-mile flight from {PLACE} to {PLACE} is due to leave at {CLOCK} on a (\w+) in (\w+)\.$", lead)
    m3 = re.match(rf"^A flight leaves {PLACE} for {PLACE} in (\w+)\.$", lead)
    if not (m1 or m2 or m3):
        return None
    if m1:
        city_o, o, city_d, d, h, mi_, ap, wkday, month = m1.groups()
        miles = None
    elif m2:
        miles, city_o, o, city_d, d, h, mi_, ap, wkday, month = m2.groups()
        miles = int(num(miles))
    else:
        city_o, o, city_d, d, month = m3.groups()
        h = mi_ = ap = wkday = None
        miles = None
    f = re.match(r"^The flight left on (\d+) (\w+) (\d{4}) and landed (right on schedule|(\d+) minutes (late|early))\. Of the other ([\d,]+) flights (.+?) in this record, (\d+)% landed (.+)\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    day = dt.date(int(f[3]), MONTHS.index(f[2]) + 1, int(f[1]))
    delay = 0 if f[4] == "right on schedule" else int(f[5]) * (1 if f[6] == "late" else -1)
    need(MONTHS[day.month - 1] == month, "the lead's month is not the flight's month")
    hhmm = None
    if h:
        hour24 = int(h) % 12 + (12 if ap == "pm" else 0)
        hhmm = f"{hour24:02d}:{mi_}"
        need(WEEKDAYS[day.weekday()] == wkday, "the lead's weekday is not the flight's weekday")
    rows = R.db.execute("SELECT row, hour, mi, delay FROM fl WHERE o = ? AND d = ? AND day = ? AND delay = ? AND (? IS NULL OR hhmm = ?) AND (? IS NULL OR mi = ?)",
                        (o, d, day.isoformat(), delay, hhmm, hhmm, miles, miles)).fetchall()
    need(rows, "no flight in the record matches this question")
    row, hour, mi, _ = rows[0]
    for code, city in ((o, city_o), (d, city_d)):
        got = R.db.execute("SELECT city FROM ap WHERE iata = ?", (code,)).fetchone()
        need(got and got[0] == city, f"{code} is not {city}")
    n_other, shown_pct, tail = num(f[7]), int(f[9]), f[10]
    ents = [("fl", o, d, day.isoformat(), delay)]   # flights alike in route, date and delay look the same to a player: one case
    if m1:
        lo, hi_, label = bucket(hour, HOUR_BUCKETS)
        cls = "hour = ?" if False else "hour >= ? AND hour < ?"
        total, k15, k60 = R.db.execute(f"SELECT COUNT(*), SUM(delay > 15), SUM(delay > 60) FROM fl WHERE {cls}", (lo, hi_)).fetchone()
        need(f[8] == f"scheduled to leave {label}", f"the reveal names the wrong time of day: {f[8]}")
        need(ask in ("It lands more than 15 minutes late.", "It lands no more than 15 minutes late.", "It lands more than an hour late.", "It lands no more than an hour late."), "the claim is not one this lead supports")
        hour_claim = "hour" in ask
        k, own, label_tail = (k60, delay > 60, "more than an hour late") if "hour" in ask else (k15, delay > 15, "more than 15 minutes late")
        need(tail == label_tail, "the reveal measures something other than the claim")
        p = (k - own) / (total - 1)
        need(total - 1 == n_other and shown_pct == pct(p), "the reveal's numbers differ from the record")
        return result(own, p, total - 1, ents, ask.startswith("It lands more than"))
    if m2:
        lo, hi_, label = bucket(mi, DIST_BUCKETS)
        total, k = R.db.execute("SELECT COUNT(*), SUM(delay < 0) FROM fl WHERE mi >= ? AND mi < ?", (lo, hi_)).fetchone()
        need(f[8] == f"of {label}" and tail == "ahead of schedule", "the reveal describes a different class of flight")
        need(ask in ("It lands ahead of schedule.", "It lands on time or late."), "the claim is not one this lead supports")
        own = delay < 0
        p = (k - own) / (total - 1)
        need(total - 1 == n_other and shown_pct == pct(p), "the reveal's numbers differ from the record")
        return result(own, p, total - 1, ents, ask == "It lands ahead of schedule.")
    total, k = R.db.execute("SELECT COUNT(*), SUM(delay > 15) FROM fl WHERE o = ?", (o,)).fetchone()
    need(total >= 400, "too few departures from this airport")
    need(f[8] == f"out of {o}" and tail == "more than 15 minutes late", "the reveal describes a different class of flight")
    need(ask in ("It lands more than 15 minutes late.", "It lands no more than 15 minutes late."), "the claim is not one this lead supports")
    own = delay > 15
    p = (k - own) / (total - 1)
    need(total - 1 == n_other and shown_pct == pct(p), "the reveal's numbers differ from the record")
    return result(own, p, total - 1, ents, ask.startswith("It lands more than"))


# --------------------------------------------------------------------------------------------------------------- world trends
TREND_LEADS = {
    "life": r"life expectancy at birth went from ([\d.]+) to ([\d.]+) years",
    "child": r"the death rate for children under five went from ([\d.]+)% to ([\d.]+)% of live births",
    "co2": r"CO₂ emissions per person went from ([\d.]+) to ([\d.]+) tonnes a year",
    "gdp": r"income per person \(GDP per capita, in 2021 prices and adjusted for living costs\) went from \$([\d,]+) to \$([\d,]+)",
    "renew": r"renewables' share of electricity went from ([\d.]+)% to ([\d.]+)%",
    "fert": r"the average number of births per woman went from ([\d.]+) to ([\d.]+)",
}
TREND_SHORT = {"life": "life expectancy", "child": "the under-five death rate", "co2": "CO₂ emissions per person", "gdp": "income per person",
               "renew": "the renewable share of electricity", "fert": "births per woman"}
TREND_VALUE = {"life": r"([\d.]+) years", "child": r"([\d.]+)%", "co2": r"([\d.]+) tonnes", "gdp": r"\$([\d,]+)", "renew": r"([\d.]+)%", "fert": r"([\d.]+) births per woman"}


def rule_trend(R, q):
    m = re.match(r"^(.+?), (\d{4}) to (\d{4}): (.+)\.$", q["lead"])
    if not m:
        return None
    ind = next((k for k, pat in TREND_LEADS.items() if re.fullmatch(pat, m[4])), None)
    a = re.match(r"^By (\d{4}) it is (higher|lower) than in (\d{4})\.$", q["ask"])
    if not ind or not a:
        return None
    country, y0, t = m[1], int(m[2]), int(m[3])
    need(t - y0 == 5 and int(a[1]) == t + 5 and int(a[3]) == t, "the years in the lead and the claim do not line up")
    nums = re.fullmatch(TREND_LEADS[ind], m[4])
    row = R.db.execute(f"SELECT code, va, vb, vc FROM win_{ind} WHERE country = ? AND t = ?", (country, t)).fetchone()
    need(row, f"{country} has no qualifying window ending in {t}")
    code, va, vb, vc = row
    need(shown_ok(nums[1], va) and shown_ok(nums[2], vb), "the figures in the lead differ from the record")
    need(nums[1] != nums[2], "the lead's two figures look identical, so the direction is not visible")
    f = re.match(rf"^By {t + 5} it was (.+?)\. Across the ([\d,]+) other country-windows in this record where (.+?) had (risen|fallen) over the previous five years, it rose over the next five in (\d+)% of them\.$", q["fact"])
    need(f, "the reveal is not worded as expected")
    value = re.fullmatch(TREND_VALUE[ind], f[1])
    need(value and shown_ok(value[1].replace(",", ""), vc), "the figure in the reveal differs from the record")
    need((num(value[1]) > num(nums[2])) == (vc > vb) and num(value[1]) != num(nums[2]), "the reveal's figure does not show the direction it took")
    up = vb > va
    total, k = R.db.execute(f"SELECT COUNT(*), SUM(vc > vb) FROM win_{ind} WHERE (vb > va) = ?", (up,)).fetchone()
    rose = vc > vb
    p = (k - rose) / (total - 1)
    need(f[3] == TREND_SHORT[ind] and (f[4] == "risen") == up and num(f[2]) == total - 1 and int(f[5]) == pct(p), "the reveal's numbers differ from the record")
    return result(rose, p, total - 1, [("tr", ind, code)], a[2] == "higher")


# ---------------------------------------------------------------------------------------------------------------------- markets
NOTE = r"\(price only; dividends are not counted\)"
BETWEEN = r"from the December (\d{4}) average to the December (\d{4}) average"


def rule_market(R, q):
    lead, ask = q["lead"], q["ask"]
    D = R.dec
    years = range(1950, 2023)
    ret = {y: D[y][0] / D[y - 1][0] - 1 for y in years}
    if lead == "A calendar year is drawn at random from 1950 to 2022. We won't say which.":
        kinds = {("The S&P 500 ended the year higher than it began.", "The S&P 500 ended the year lower than it began."): (lambda r: r > 0, "it ended higher"),
                 ("The S&P 500 fell 10% or more over the year.", "The S&P 500 did not fall 10% over the year."): (lambda r: r <= -0.10, "it fell 10% or more"),
                 ("The S&P 500 rose 20% or more over the year.", "The S&P 500 did not rise 20% over the year."): (lambda r: r >= 0.20, "it rose 20% or more")}
        kind = next((v for k, v in kinds.items() if ask in k), None)
        need(kind, "the claim is not one a drawn year supports")
        yes_ask = next(k[0] for k in kinds if ask in k)
        event, said = kind
        f = re.match(rf"^It was (\d{{4}}): the S&P 500 (rose|fell) ([\d.]+)% {BETWEEN} {NOTE}\. Across the other ([\d,]+) years from 1950 to 2022, (.+?) in (\d+)%\.$", q["fact"])
        need(f, "the reveal is not worded as expected")
        y = int(f[1])
        need(y in ret and int(f[4]) == y - 1 and int(f[5]) == y, "the year in the reveal is not in the record")
        need(abs(num(f[3]) - abs(ret[y]) * 100) <= 0.05 + 1e-9 and (f[2] == "rose") == (ret[y] > 0), "the return in the reveal differs from the record")
        k = sum(event(r) for r in ret.values())
        p = (k - event(ret[y])) / (len(ret) - 1)
        need(f[7] == said and num(f[6]) == len(ret) - 1 and int(f[8]) == pct(p), "the reveal's numbers differ from the record")
        return result(event(ret[y]), p, len(ret) - 1, [("mk", y)], ask == yes_ask)
    m = re.match(r"^A year is drawn at random from those that came right after (a falling year|a gain of 20% or more) \((\d{4}) to (\d{4})\)\.$", lead)
    if m:
        cond = (lambda y: ret[y - 1] < 0) if m[1] == "a falling year" else (lambda y: ret[y - 1] >= 0.20)
        pool = [y for y in range(1951, 2023) if cond(y)]
        need(m[2] == "1951" and m[3] == "2022" and ask in ("The S&P 500 rose that year.", "The S&P 500 fell that year."), "the claim is not one this lead supports")
        f = re.match(rf"^It was (\d{{4}}), after (a fall|a gain) of ([\d.]+)% in (\d{{4}}): the S&P 500 (rose|fell) ([\d.]+)% {BETWEEN} {NOTE}\. Of the other ([\d,]+) years that came right after (.+?), it rose in (\d+)%\.$", q["fact"])
        need(f, "the reveal is not worded as expected")
        y = int(f[1])
        need(y in pool and int(f[4]) == y - 1 and int(f[7]) == y - 1 and int(f[8]) == y, "the year is not in the class the lead describes")
        need(abs(num(f[3]) - abs(ret[y - 1]) * 100) <= 0.05 + 1e-9 and (f[2] == "a fall") == (ret[y - 1] < 0), "the earlier year's return differs from the record")
        need(abs(num(f[6]) - abs(ret[y]) * 100) <= 0.05 + 1e-9 and (f[5] == "rose") == (ret[y] > 0), "the return in the reveal differs from the record")
        k = sum(ret[v] > 0 for v in pool)
        p = (k - (ret[y] > 0)) / (len(pool) - 1)
        need(len(pool) - 1 >= MIN_CASES_SMALL, f"only {len(pool) - 1} other years in this class")
        need(f[10] == m[1] and num(f[9]) == len(pool) - 1 and int(f[11]) == pct(p), "the reveal's numbers differ from the record")
        return result(ret[y] > 0, p, len(pool) - 1, [("mk", y - 1), ("mk", y)], ask == "The S&P 500 rose that year.")
    m = re.match(r"^A (\d+)-year stretch is drawn at random, starting in a year from (\d{4}) to (\d{4})\. We won't say which\.$", lead)
    if m:
        span = int(m[1])
        need(m[2] == "1950" and int(m[3]) == 2022 - span, "the range of starting years is wrong")
        real = ask in ("Even after inflation, the S&P 500 ended the stretch higher than it began.", "After inflation, the S&P 500 ended the stretch lower than it began.")
        need(real or ask in ("The S&P 500 ended the stretch higher than it began.", "The S&P 500 ended the stretch lower than it began."), "the claim is not one a drawn stretch supports")
        idx = 1 if real else 0
        gain = {s: D[s + span][idx] / D[s][idx] - 1 for s in range(1950, 2022 - span + 1)}
        f = re.match(rf"^It was (\d{{4}}) to (\d{{4}}): the S&P 500 (rose|fell) (\d+)%( after inflation)? {BETWEEN} {NOTE}\. Across the other ([\d,]+) stretches of (\d+) years from 1950 on, it ended higher in (\d+)%\. Neighbouring stretches overlap, so there are fewer independent cases than that\.$", q["fact"])
        need(f, "the reveal is not worded as expected")
        s = int(f[1])
        need(s in gain and int(f[2]) == s + span and int(f[5 + 1]) == s and int(f[7]) == s + span and int(f[9]) == span, "the stretch in the reveal does not match the lead")
        need(bool(f[5]) == real and abs(num(f[4]) - abs(gain[s]) * 100) <= 0.5 + 1e-9 and (f[3] == "rose") == (gain[s] > 0), "the return in the reveal differs from the record")
        k = sum(g > 0 for g in gain.values())
        p = (k - (gain[s] > 0)) / (len(gain) - 1)
        need(num(f[8]) == len(gain) - 1 and int(f[10]) == pct(p), "the reveal's numbers differ from the record")
        return result(gain[s] > 0, p, len(gain) - 1, [("mk", y) for y in range(s, s + span + 1)], ask.endswith("higher than it began."))
    return None


RECORDED_RULES = [rule_rain, rule_streak, rule_high, rule_freeze, rule_heavy, rule_revert, rule_flight, rule_trend, rule_market]


# ------------------------------------------------------------------------------------------------------------ documented facts
def read_base_rates():
    """The documented facts, audited for what the table itself promises. Returns (rows, errors)."""
    rows, errors, seen = table("base_rates.csv"), [], set()
    for r in rows:
        where = f"base_rates.csv {r['id']}"
        if r["id"] in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(r["id"])
        try:
            low, high, pad = float(r["doc_low"]), float(r["doc_high"]), float(r["pad"])
            ts = [float(t) for t in r["thresholds"].split(";")]
        except ValueError:
            errors.append(f"{where}: a number does not parse")
            continue
        if not (low <= high and pad >= 0):
            errors.append(f"{where}: the documented range is not low <= high with a rounding allowance of 0 or more")
        if r["scale"] not in ("share", "ratio"):
            errors.append(f"{where}: scale must be share or ratio")
        if r["domain"] not in DOMAINS:
            errors.append(f"{where}: unknown domain {r['domain']}")
        if not re.match(r"^https://", r["source_url"]) or not r["source_name"]:
            errors.append(f"{where}: needs an https source link and a source name")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", r["checked"]):
            errors.append(f"{where}: needs the date the source was read")
        if "{t}" not in r["stem_more"] or "{t}" not in r["stem_fewer"]:
            errors.append(f"{where}: both stems need {{t}} for the threshold")
        seen_numbers = {float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.?\d*", r["evidence"])}
        for label, value in (("low", low), ("high", high)):
            if value not in seen_numbers:
                errors.append(f"{where}: the documented {label} {value:g} does not appear in the evidence text")
        if len(ts) < 3:
            errors.append(f"{where}: lists fewer than three thresholds")
        for t in ts:
            lo, hi = low - pad, high + pad
            if lo <= t <= hi:
                errors.append(f"{where}: the threshold {t:g} sits inside the documented range {lo:g} to {hi:g}")
            elif margin(r["scale"], lo, hi, t) < MIN_MARGIN:
                errors.append(f"{where}: the threshold {t:g} is too close to the documented range {lo:g} to {hi:g}")
    return rows, errors


def rule_sourced(facts, q):
    """Match a sourced question to its fact and work its claim out from the documented number."""
    for r in facts:
        if r["lead"] != q["lead"]:
            continue
        for stem, kind in ((r["stem_more"], "more"), (r["stem_fewer"], "fewer")):
            m = re.fullmatch(re.escape(stem).replace(re.escape("{t}"), r"(-?\d+(?:\.\d+)?)"), q["ask"])
            if not m:
                continue
            t = float(m[1])
            low, high = float(r["doc_low"]) - float(r["pad"]), float(r["doc_high"]) + float(r["pad"])
            need(not (low <= t <= high), f"the threshold {m[1]} sits inside the documented range")
            need(f"{t:g}" in r["thresholds"].replace(";", " ").split() or t in [float(x) for x in r["thresholds"].split(";")], "the threshold is not one the fact lists")
            truth = (t < low) if kind == "more" else (t > high)
            need(q["fact"] == r["fact"] and q["why"] == r["why"] and q["domain"] == r["domain"], "the reveal or the label differs from the documented fact")
            need(q["source"] == r["source_url"] and q["src_name"] == r["source_name"] and q["checked"] == r["checked"], "the source differs from the documented fact")
            need(q["n"] == (int(r["n"]) if r["n"] else 0), "the number of cases differs from the documented fact")
            need(q["diff"] == diff_of_margin(margin(r["scale"], low, high, t)), "the difficulty does not follow from how far the threshold is from the documented value")
            return {"answer": truth, "ents": [("cur", r["id"])], "fact_id": r["id"]}
    raise Bad("no documented fact has this lead and claim")


# ===================================================================================================================== checks
def check_shape(qs, label, errors):
    ids, claims = Counter(q.get("id") for q in qs), Counter(q.get("claim") for q in qs)
    for q in qs:
        where = q.get("id", "?")
        missing = [f for f in FIELDS if f not in q]
        if missing:
            errors.append(f"{where}: missing fields {missing}")
            continue
        if ids[q["id"]] > 1:
            errors.append(f"{where}: duplicate id")
        if claims[q["claim"]] > 1:
            errors.append(f"{where}: duplicate claim text")
        if q["claim"] != (q["lead"] + " " + q["ask"] if q["lead"] else q["ask"]):
            errors.append(f"{where}: the claim is not the lead followed by the ask")
        for field in ("lead", "ask", "fact", "why"):
            if q[field] != q[field].strip() or "  " in q[field] or not q[field]:
                errors.append(f"{where}: {field} has stray spaces or is empty")
        if not isinstance(q["answer"], bool):
            errors.append(f"{where}: answer must be true or false")
        if q["domain"] not in DOMAINS:
            errors.append(f"{where}: unknown domain {q['domain']}")
        if q["diff"] not in ("easy", "medium", "hard"):
            errors.append(f"{where}: unknown difficulty {q['diff']}")
        if q["verified"] not in ("recorded", "sourced"):
            errors.append(f"{where}: unknown verified {q['verified']}")
        if not 10 <= len(q["claim"]) <= 420:
            errors.append(f"{where}: claim length {len(q['claim'])}")
        if not re.match(r"^https://", q["source"]) or not q["src_name"]:
            errors.append(f"{where}: needs an https source link and a source name")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", q["checked"]):
            errors.append(f"{where}: needs the date the records were read")
        if q["verified"] == "recorded":
            if not (isinstance(q["base"], float) and 0 < q["base"] < 1 and q["n"] >= MIN_CASES_SMALL):
                errors.append(f"{where}: a recorded question needs a base rate between 0 and 1 and at least {MIN_CASES_SMALL} other cases")
        elif q["base"] is not None:
            errors.append(f"{where}: a sourced question has no base rate")
        if re.search(r"claude|anthropic", json.dumps(q, ensure_ascii=False), re.I):
            errors.append(f"{where}: the builder's name must not appear in the app")
    return ids


def check_truth(qs, label, R, facts, errors, notes):
    """Work every answer out again. Returns {id: derived} for the fairness test and the checks across banks."""
    derived, done = {}, Counter()
    sources = {(r["source_url"], r["source_name"]) for r in table("sources.csv")}
    for q in qs:
        if any(f not in q for f in FIELDS):
            continue
        try:
            if q["verified"] == "sourced":
                d = rule_sourced(facts, q)
            else:
                d = None
                for rule in RECORDED_RULES:
                    d = rule(R, q)
                    if d:
                        break
                need(d, "no rule recognises this question")
                need(q["answer"] == d["answer"], f"stored answer is {q['answer']} but the record gives {d['answer']}")
                need(abs(q["base"] - d["base"]) <= 6e-5 and q["n"] == d["n"], f"stored base {q['base']} over {q['n']} cases, the record gives {d['base']:.4f} over {d['n']}")
                need(q["diff"] == diff_of(d["base"]), f"stored difficulty {q['diff']} but a base rate of {d['base']:.2f} is {diff_of(d['base'])}")
                need((q["source"], q["src_name"]) in sources, "the source is not one listed in data/question_tables/sources.csv")
            if q["verified"] == "sourced":
                need(q["answer"] == d["answer"], f"stored answer is {q['answer']} but the documented number gives {d['answer']}")
        except Bad as e:
            errors.append(f"{q['id']}: {e}: {q['claim']}")
            continue
        except (TypeError, ValueError, KeyError, AttributeError, IndexError) as e:
            errors.append(f"{q['id']}: could not be checked ({type(e).__name__}: {e}): {q['claim']}")
            continue
        d["q"] = q
        derived[q["id"]] = d
        done[q["verified"]] += 1
    notes.append(f"{label}: {done['recorded']} recorded and {done['sourced']} sourced questions worked out again from the records, and they agree" if not errors else f"{label}: {sum(done.values())} of {len(qs)} questions worked out again")
    return derived


def check_fairness(derived, label, errors, notes):
    """A player who knew every base rate: is the bank calibrated for them? For each recorded question, q is the share of ALL cases in its
    class (this one included) for which its claim holds. If cases were drawn blind to how they turned out, the claims that came out true
    are as many as the q's add up to, within chance."""
    out = []
    for name, keep in (("all", lambda q: True), ("easy", lambda q: q["diff"] == "easy"), ("medium", lambda q: q["diff"] == "medium"), ("hard", lambda q: q["diff"] == "hard")):
        xs = [d for d in derived.values() if d["q"]["verified"] == "recorded" and keep(d["q"])]
        if len(xs) < 20:
            continue
        qs = [(d["base"] * d["n"] + d["q"]["answer"]) / (d["n"] + 1) for d in xs]
        z = sum(d["q"]["answer"] - c for d, c in zip(xs, qs)) / math.sqrt(sum(c * (1 - c) for c in qs))
        hit = sum(max(c, 1 - c) for c in qs) / len(qs)
        out.append(f"{name} z={z:+.2f} (n={len(xs)}, a player who knows the base rates would hit {hit:.0%})")
        if abs(z) > MAX_Z:
            errors.append(f"{label}: the {name} questions are not fair to a player who knows the base rates: z={z:+.2f}, allowed ±{MAX_Z:g}")
    notes.append(f"{label} fairness: " + "; ".join(out))


def check_balance(qs, label, mix, errors):
    n = len(qs) or 1
    t = sum(1 for q in qs if q.get("answer") is True)
    if not 0.45 <= t / n <= 0.55:
        errors.append(f"{label}: true claims are {t / n:.0%}; the design is half and half")
    by_diff = Counter(q.get("diff") for q in qs)
    for d, want in (mix or {}).items():
        if abs(by_diff[d] / n - want) > 0.05:
            errors.append(f"{label}: {d} is {by_diff[d] / n:.0%}, designed for {want:.0%}")
    for d in ("easy", "medium", "hard"):
        sub = [q for q in qs if q.get("diff") == d]
        if len(sub) >= 20 and not 0.40 <= sum(q["answer"] for q in sub) / len(sub) <= 0.60:
            errors.append(f"{label}: {d} questions are not balanced between true and false")
    for d, c in Counter(q.get("domain") for q in qs).items():
        if c / n > 0.35:
            errors.append(f"{label}: subject {d} is {c / n:.0%}, above the 35% limit")


def entities_of(derived):
    ents = defaultdict(list)
    for qid, d in derived.items():
        for e in d["ents"]:
            ents[e].append(qid)
    return ents


def load_bank(path, errors):
    name = os.path.relpath(path, ROOT)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("questions", [])
    except FileNotFoundError:
        errors.append(f"{name} is missing: run python3 tools/make_questions.py")
    except ValueError as e:
        errors.append(f"{name} does not parse: {e}")
    return None


def check_sources(errors):
    rows = table("sources.csv")
    listed = {r["table"] for r in rows}
    for name in sorted(os.listdir(TABLES)):
        if name.endswith(".csv") and name != "sources.csv" and name not in listed:
            errors.append(f"data/question_tables/{name} has no row in sources.csv")
    for r in rows:
        if r["table"] not in os.listdir(TABLES):
            errors.append(f"sources.csv lists {r['table']}, which is not in data/question_tables/")
        if not re.match(r"^https://", r["source_url"]) or not r["source_name"] or not r["how_read"] or not r["note"]:
            errors.append(f"sources.csv {r['table']}: needs a name, an https link, how it was read and a note")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", r["checked"]):
            errors.append(f"sources.csv {r['table']}: needs the date it was read")


def check():
    errors, notes = [], []
    with open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8") as f:
        gym = json.load(f)["gym"]
    check_sources(errors)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    try:
        import make_questions
    except SystemExit as e:  # the builder reads sources.csv as it loads; a row missing there stops it
        errors.append(f"the question builder could not start: {e}")
        make_questions = None
    facts, fact_errors = read_base_rates()
    errors += fact_errors
    R = Records()
    cache = {}

    def built():
        if make_questions is None:
            raise SystemExit("the question builder is not available")
        if not cache:
            cache["banks"] = make_questions.build_banks()
        return cache["banks"]

    def rendered(which):
        questions, _, exam, _ = built()
        return make_questions.render(questions) if which == "starter" else make_questions.render(exam, pool="exam-u1")

    banks = {}
    for path, label, mix, render in ((BANK, "starter bank", gym.get("difficulty_mix"), lambda: rendered("starter")),
                                     (EXAM_BANK, "exam pool", gym.get("exam_mix"), lambda: rendered("exam"))):
        qs = load_bank(path, errors)
        if qs is None:
            continue
        before = len(errors)
        if not 200 <= len(qs) <= 400:
            errors.append(f"{label}: expected between 200 and 400 questions, found {len(qs)}")
        check_shape(qs, label, errors)
        derived = check_truth(qs, label, R, facts, errors, notes)
        check_fairness(derived, label, errors, notes)
        check_balance(qs, label, mix, errors)
        for e, ids in entities_of(derived).items():
            if len(ids) > 1:
                errors.append(f"{label}: the same case is used by more than one question ({e[0]}:{e[-1]}): {ids[:3]}")
        try:
            if render() != open(path, encoding="utf-8").read():
                errors.append(f"{os.path.relpath(path, ROOT)} is not what the tables produce: run python3 tools/make_questions.py and commit the result")
        except SystemExit as e:
            errors.append(f"the builder could not rebuild {os.path.relpath(path, ROOT)}: {e}")
        banks[label] = (qs, derived)
        if len(errors) == before:
            notes.append(f"{label}: {len(qs)} questions, shape, balance and freshness pass")
    if len(banks) == 2:
        (s_qs, s_d), (e_qs, e_d) = banks["starter bank"], banks["exam pool"]
        shared_ids = {q["id"] for q in s_qs} & {q["id"] for q in e_qs}
        shared_claims = {q["claim"] for q in s_qs} & {q["claim"] for q in e_qs}
        shared_cases = set(entities_of(s_d)) & set(entities_of(e_d))
        if shared_ids:
            errors.append(f"the starter bank and the exam pool share ids: {sorted(shared_ids)[:3]}")
        if shared_claims:
            errors.append(f"the starter bank and the exam pool share claims: {sorted(shared_claims)[:2]}")
        if shared_cases:
            errors.append(f"the starter bank and the exam pool both use the same case, so a practice reveal could give an exam answer away: {sorted(map(str, shared_cases))[:3]}")
    check_topups(errors, notes, banks)
    return errors, notes


def check_topups(errors, notes, banks):
    """Top-ups: questions the weekly review adds between releases (design/coach.md). They are read by the app beside the starter bank,
    so they follow the same shape rules, must be `sourced` (a documented fact with a source page read on the `checked` date, never a
    private or personal question), and must not repeat an id or claim of either bank. An empty list is the normal state."""
    if not os.path.exists(TOPUPS):
        errors.append("app/content/questions/topups.json is missing (it may hold an empty list)")
        return
    try:
        with open(TOPUPS, encoding="utf-8") as f:
            doc = json.load(f)
    except ValueError as e:
        errors.append(f"topups.json does not parse: {e}")
        return
    qs = doc.get("questions") if isinstance(doc, dict) else None
    if doc.get("version") != 2 or not isinstance(qs, list):
        errors.append("topups.json must be {\"version\": 2, \"questions\": [...]}")
        return
    before = len(errors)
    if len(qs) > 500:
        errors.append(f"topups.json: {len(qs)} questions is more than a top-up should hold")
    check_shape(qs, "top-ups", errors)
    others = [q for (bq, _) in banks.values() for q in bq]
    ids, claims = {q["id"] for q in others}, {q["claim"] for q in others}
    for q in qs:
        where = q.get("id", "?")
        if q.get("verified") != "sourced":
            errors.append(f"{where}: a top-up must be sourced (a documented fact with its page and the date it was read)")
        if not str(q.get("id", "")).startswith("top-"):
            errors.append(f"{where}: a top-up id starts with top-")
        if q.get("id") in ids:
            errors.append(f"{where}: a top-up repeats an id of the starter bank or the exam pool")
        if q.get("claim") in claims:
            errors.append(f"{where}: a top-up repeats a claim of the starter bank or the exam pool")
    if len(errors) == before:
        notes.append(f"top-ups: {len(qs)} questions, shape and sources pass")


def main():
    errors, notes = check()
    for n in notes:
        print(n)
    if errors:
        print("QUESTION BANK CHECK FAILED")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("question bank check passed")


if __name__ == "__main__":
    main()

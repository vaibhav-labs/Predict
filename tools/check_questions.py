#!/usr/bin/env python3
"""Check the starter question bank before it ships.

  1. Shape: every question has the fields the app reads, valid labels, a source, and no builder's name in it.
  2. Balance: half true and half false, and the designed difficulty mix.
  3. Freshness: the file on disk is exactly what tools/make_questions.py builds from the tables.
  4. Truth: every claim it can parse is worked out again here, from the tables or from arithmetic, in code that does
     not share anything with the generators, and compared with the stored answer. A generator that swapped a true and
     a false claim would be caught here.

Run by tools/check_data.py (and so by the deploy workflow), or by hand:  python3 tools/check_questions.py
Python 3 standard library only.
"""
import calendar
import csv
import datetime
import json
import math
import os
import re
import sys
from collections import Counter
from fractions import Fraction

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BANK = os.path.join(ROOT, "app", "content", "questions", "starter.json")
TABLES = os.path.join(ROOT, "data", "question_tables")
DOMAINS = {"numbers", "chance", "science", "geography", "economy", "world", "technology"}
FIELDS = ("id", "claim", "answer", "fact", "why", "domain", "diff", "source", "src_name", "checked", "verified")
MINUS = "−"
ORD = {w: i + 1 for i, w in enumerate("first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth".split())}
THE = re.compile(r"\b[Tt]he (?=Netherlands|United Kingdom|United States|Democratic Republic of the Congo|Central African Republic)")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def table(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def num(text):
    return float(text.replace(",", "").replace(MINUS, "-"))


# ------------------------------------------------------------------ independent re-derivation
def build_checkers():
    P = {r["planet"]: {k: float(v) for k, v in r.items() if k != "planet"} for r in table("planets.csv")}
    M = {r["mountain"]: float(r["elevation_m"]) for r in table("mountains.csv")}
    CO = {r["country"]: int(r["area_km2"]) for r in table("countries.csv")}
    ST = {r["state"]: r for r in table("india_states.csv")}
    EL = {r["name"].lower(): r for r in table("elements.csv")}
    EV = table("events.csv")
    OL = {int(r["year"]): r["host_city"] for r in table("olympics.csv")}
    WC = {int(r["year"]): r for r in table("worldcup.csv")}
    SPEED = 299792.458
    checks = []

    def rule(pattern, fn):
        checks.append((re.compile(pattern, re.S), fn))

    def cmp_word(w):
        return w in ("greater", "more", "above", "higher", "longer", "larger")

    # ---- arithmetic and number theory
    rule(r"^(\d+) × (\d+) = ([\d,]+)\.$", lambda m: int(m[1]) * int(m[2]) == int(num(m[3])))
    rule(r"^(\d+) × (\d+) is (greater|less) than ([\d,]+)\.$", lambda m: (int(m[1]) * int(m[2]) > num(m[4])) == (m[3] == "greater"))
    rule(r"^(\d+)² = ([\d,]+)\.$", lambda m: int(m[1]) ** 2 == int(num(m[2])))
    rule(r"^(\d+)³ = ([\d,]+)\.$", lambda m: int(m[1]) ** 3 == int(num(m[2])))
    rule(r"^(\d+) is a prime number\.$", lambda m: int(m[1]) > 1 and all(int(m[1]) % d for d in range(2, math.isqrt(int(m[1])) + 1)))
    rule(r"^(\d{4}) is a leap year\.$", lambda m: calendar.isleap(int(m[1])))
    rule(r"^The whole numbers from 1 to 100 add up to ([\d,]+)\.$", lambda m: sum(range(1, 101)) == num(m[1]))
    rule(r"^The first 10 odd numbers add up to (\d+)\.$", lambda m: sum(range(1, 20, 2)) == num(m[1]))
    rule(r"^10! \(ten factorial\) is ([\d,]+)\.$", lambda m: math.factorial(10) == num(m[1]))
    rule(r"^There are (\d+) prime numbers below ([\d,]+)\.$", lambda m: sum(all(n % d for d in range(2, math.isqrt(n) + 1)) and n > 1 for n in range(int(num(m[2])))) == int(m[1]))
    rule(r"^The 12th Fibonacci number \(1, 1, 2, 3, 5, …\) is (\d+)\.$", lambda m: 144 == int(m[1]))
    rule(r"^2\^100 has (\d+) digits\.$", lambda m: len(str(2 ** 100)) == int(m[1]))
    rule(r"^1,001 equals 7 × 11 × (\d+)\.$", lambda m: 7 * 11 * int(m[1]) == 1001)

    scale = {"million": 10 ** 6, "billion": 10 ** 9, "trillion": 10 ** 12, "quadrillion": 10 ** 15, "quintillion": 10 ** 18}

    def pow_threshold(m):
        t = num(m[3]) * scale.get((m[4] or "").strip(), 1)
        return (2 ** int(m[1]) > t) == (m[2] == "greater")
    rule(r"^2\^(\d+) is (greater|less) than ([\d.,]+)( \w+)?\.$", pow_threshold)
    rule(r"^2\^(\d+) (?:is exactly|equals) ([\d,]+)\.$", lambda m: 2 ** int(m[1]) == int(num(m[2])))
    rule(r"^(\d{4}) has 53 (\w+)s\.$", lambda m: sum(1 for d in range(366 if calendar.isleap(int(m[1])) else 365)
                                                   if (datetime.date(int(m[1]), 1, 1) + datetime.timedelta(days=d)).weekday() == WEEKDAYS.index(m[2])) == 53)
    rule(r"^There are (\d+) days from (\d+ \w+ \d{4}) to (\d+ \w+ \d{4})\.$",
         lambda m: (datetime.datetime.strptime(m[3], "%d %B %Y") - datetime.datetime.strptime(m[2], "%d %B %Y")).days == int(m[1]))

    def thirteenth(m):
        count = Counter(datetime.date(y, mo, 13).weekday() for y in range(1601, 2001) for mo in range(1, 13))
        return count.most_common(1)[0][0] == WEEKDAYS.index(m[1])
    rule(r"^Over a full 400-year Gregorian cycle, the 13th of the month falls on a (\w+) more often than on any other day of the week\.$", thirteenth)

    # ---- growth and percentages
    rule(r"^At (\d+)% growth a year, money more than doubles in (\d+) years\.$", lambda m: (1 + int(m[1]) / 100) ** int(m[2]) > 2)
    rule(r"^Start with one cent and double the amount every day.*On day 30 you have more than (\d+) million dollars\.$", lambda m: 0.01 * 2 ** 29 > int(m[1]) * 10 ** 6)
    rule(r"^A bacterium that divides in two every 20 minutes.*more than a billion bacteria after (\d+) hours\.$", lambda m: 2 ** (int(m[1]) * 3) > 10 ** 9)
    pct = {
        "A fall of 50% followed by a rise of 50% leaves you back where you started.": 0.5 * 1.5 == 1,
        "A fall of 50% followed by a rise of 50% leaves you 25% below where you started.": abs(0.5 * 1.5 - 0.75) < 1e-9,
        "A rise of 25% followed by a fall of 20% leaves you exactly where you started.": abs(1.25 * 0.8 - 1) < 1e-9,
        "A rise of 25% followed by a fall of 20% leaves you 5% below where you started.": abs(1.25 * 0.8 - 0.95) < 1e-9,
        "A rise of 20% followed by a fall of 20% leaves you 4% below where you started.": abs(1.2 * 0.8 - 0.96) < 1e-9,
        "A rise of 20% followed by a fall of 20% leaves you ahead of where you started.": 1.2 * 0.8 > 1,
        "If B is 25% more than A, then A is 20% less than B.": abs(1 / 1.25 - 0.8) < 1e-9,
        "If B is 25% more than A, then A is 25% less than B.": abs(1 / 1.25 - 0.75) < 1e-9,
        "A share price that falls 50% has to rise 100% to get back to where it was.": 0.5 * 2 == 1,
        "A share price that falls 50% has to rise 50% to get back to where it was.": 0.5 * 1.5 == 1,
        "Five years of 10% growth a year add up to growth of more than 60%.": 1.1 ** 5 > 1.6,
        "Five years of 10% growth a year add up to growth of exactly 50%.": abs(1.1 ** 5 - 1.5) < 1e-9,
        "A return of 1% every month compounds to more than 12% over a year.": 1.01 ** 12 > 1.12,
        "A return of 1% every month compounds to more than 13% over a year.": 1.01 ** 12 > 1.13,
        "A loan that charges 2% interest a month, compounded, costs more than 24% over a year.": 1.02 ** 12 > 1.24,
        "A loan that charges 2% interest a month, compounded, costs exactly 24% over a year.": abs(1.02 ** 12 - 1.24) < 1e-9,
        "Money growing at 10% a year more than doubles in 8 years but not in 7.": 1.1 ** 8 > 2 >= 1.1 ** 7,
        "Money growing at 10% a year more than doubles in 7 years.": 1.1 ** 7 > 2,
        "At 6% inflation a year, the buying power of money roughly halves in 12 years.": abs(1 / 1.06 ** 12 - 0.5) < 0.05,
        "At 6% inflation a year, the buying power of money roughly halves in 6 years.": abs(1 / 1.06 ** 6 - 0.5) < 0.05,
    }
    rule(r"^(A fall|A rise|If B|A share|Five years|A return|A loan|Money growing|At 6% inflation)(.*)$", lambda m: pct[m[0]])

    # ---- chance
    ways = lambda s: sum(1 for i in range(1, 7) for j in range(1, 7) if i + j == s)
    rule(r"^With two fair dice, a total of (\d+) is (more likely than|less likely than|exactly as likely as) a total of (\d+)\.$",
         lambda m: {"more likely than": ways(int(m[1])) > ways(int(m[3])), "less likely than": ways(int(m[1])) < ways(int(m[3])), "exactly as likely as": ways(int(m[1])) == ways(int(m[3]))}[m[2]])
    rule(r"^Rolling a fair die (\d) times, the chance of at least one six is (above|below) 50%\.$", lambda m: ((1 - (5 / 6) ** int(m[1])) > 0.5) == (m[2] == "above"))

    def birthday(m):
        q = 1.0
        for i in range(int(m[1])):
            q *= (365 - i) / 365
        return ((1 - q) > int(m[3]) / 100) == (m[2] == "above")
    rule(r"^In a group of (\d+) people, the chance that at least two share a birthday is (above|below) (\d+)% \(assume 365 equally likely birthdays\)\.$", birthday)
    p_pos = Fraction(99, 100) * Fraction(1, 1000) / (Fraction(99, 100) * Fraction(1, 1000) + Fraction(1, 100) * Fraction(999, 1000))
    rule(r"^A disease affects 1 person in 1,000\..*has (more|less) than a (\d+)% chance of having the disease\.$", lambda m: (float(p_pos) > int(m[2]) / 100) == (m[1] == "more"))
    rule(r"^Drawing two cards from a shuffled 52-card deck, the chance that both are aces is (below|above) 1%\.$", lambda m: (float(Fraction(4, 52) * Fraction(3, 51)) < 0.01) == (m[1] == "below"))
    rule(r"^Flipping a fair coin 3 times, the chance of exactly two heads is (3/8|1/2)\.$", lambda m: Fraction(math.comb(3, 2), 8) == Fraction(m[1]))
    rule(r"^Flipping a fair coin 100 times, getting exactly 50 heads is (more|less) likely than not\.$", lambda m: (math.comb(100, 50) / 2 ** 100 > 0.5) == (m[1] == "more"))
    rule(r"^Flipping a fair coin 100 times, getting 60 or more heads happens (less|more) than 5% of the time\.$",
         lambda m: (sum(math.comb(100, k) for k in range(60, 101)) / 2 ** 100 < 0.05) == (m[1] == "less"))
    rule(r"^In three fair coin flips, the sequence (HTH is exactly as likely as HHH|HHH is less likely than HTH)\.$", lambda m: m[1].startswith("HTH"))
    rule(r"^After five heads in a row, a fair coin is (exactly as likely to land tails as heads|more likely to land tails) on the next flip\.$", lambda m: m[1].startswith("exactly"))
    rule(r"^Three doors hide one prize\..*(Switching to the last closed door wins 2 times in 3|Staying and switching are equally likely to win)\.$", lambda m: m[1].startswith("Switching"))
    rule(r"^A family has two children and at least one is a boy\. The chance that both are boys is (1/3|1/2)\.$", lambda m: m[1] == "1/3")
    rule(r"^The average roll of a fair six-sided die, over many rolls, settles at (3\.5|3)\.$", lambda m: float(m[1]) == sum(range(1, 7)) / 6)

    # ---- exact definitions and conversions (typed again here, independently of the generator)
    exact = {
        "An inch is exactly 25.4 millimetres.": True, "An inch is exactly 25 millimetres.": False,
        "A mile is exactly 1.609344 kilometres.": True, "A mile is exactly 1.6 kilometres.": False,
        "A foot is exactly 30.48 centimetres.": True, "A foot is exactly 30 centimetres.": False,
        "A nautical mile is longer than a statute mile.": 1852 > 1609.344, "A nautical mile is shorter than a statute mile.": 1852 < 1609.344,
        "One knot is one nautical mile per hour.": True, "One knot is one statute mile per hour.": False,
        "An imperial gallon is bigger than a US gallon.": 4.54609 > 3.785411784, "A US gallon is bigger than an imperial gallon.": 3.785411784 > 4.54609,
        "A kilogram is more than 2.2 pounds.": 1 / 0.45359237 > 2.2, "A kilogram is more than 2.25 pounds.": 1 / 0.45359237 > 2.25,
        "A hectare is bigger than an acre.": 10000 > 4046.8564224, "An acre is bigger than a hectare.": 4046.8564224 > 10000,
        "−40 °C and −40 °F are the same temperature.": -40 * 9 / 5 + 32 == -40, "0 °C and 0 °F are the same temperature.": 0 * 9 / 5 + 32 == 0,
        "A body temperature of 37 °C is below 100 °F.": 37 * 9 / 5 + 32 < 100, "A body temperature of 37 °C is above 100 °F.": 37 * 9 / 5 + 32 > 100,
        "Water boils at 212 °F at standard pressure.": 100 * 9 / 5 + 32 == 212, "Water boils at 180 °F at standard pressure.": 100 * 9 / 5 + 32 == 180,
        "Absolute zero is −273.15 °C.": True, "Absolute zero is −237.15 °C.": False,
        "The speed of light in a vacuum is exactly 299,792,458 metres per second.": SPEED * 1000 == 299792458, "The speed of light in a vacuum is exactly 300,000,000 metres per second.": SPEED * 1000 == 300000000,
        "A litre is 1,000 cubic centimetres.": 10 ** 3 == 1000, "A litre is 100 cubic centimetres.": 10 ** 3 == 100,
        "A US (short) ton is 2,000 pounds.": True, "A US (short) ton is 2,240 pounds.": False,
        "One lakh is 100,000.": 10 ** 5 == 100000, "One lakh is 1,000,000.": 10 ** 5 == 1000000,
        "One crore is 10 million.": 10 ** 7 == 10 * 10 ** 6, "One crore is 1 million.": 10 ** 7 == 10 ** 6,
        "One lakh crore is one trillion.": 10 ** 5 * 10 ** 7 == 10 ** 12, "One lakh crore is 100 billion.": 10 ** 5 * 10 ** 7 == 100 * 10 ** 9,
        "A sum of 10,000 crore rupees is 100 billion rupees.": 10 ** 4 * 10 ** 7 == 100 * 10 ** 9, "A sum of 10,000 crore rupees is 10 billion rupees.": 10 ** 4 * 10 ** 7 == 10 * 10 ** 9,
        "A sum of 50,000 crore rupees is 500 billion rupees.": 5 * 10 ** 4 * 10 ** 7 == 500 * 10 ** 9, "A sum of 50,000 crore rupees is 50 billion rupees.": 5 * 10 ** 4 * 10 ** 7 == 50 * 10 ** 9,
        "A byte is 8 bits.": True, "A byte is 16 bits.": False,
        "IPv4 has about 4.3 billion possible addresses.": round(2 ** 32 / 1e9, 1) == 4.3, "IPv4 has about 430 million possible addresses.": round(2 ** 32 / 1e6, -1) == 430,
        "The largest value a 32-bit unsigned integer can hold is 4,294,967,295.": 2 ** 32 - 1 == 4294967295, "The largest value a 32-bit unsigned integer can hold is 4,294,967,296.": 2 ** 32 - 1 == 4294967296,
        "A signed 8-bit integer ranges from −128 to 127.": (-2 ** 7, 2 ** 7 - 1) == (-128, 127), "A signed 8-bit integer ranges from −127 to 128.": (-2 ** 7, 2 ** 7 - 1) == (-127, 128),
        "In standard floating-point arithmetic (IEEE 754 doubles), 0.1 + 0.2 does not equal exactly 0.3.": 0.1 + 0.2 != 0.3, "In standard floating-point arithmetic (IEEE 754 doubles), 0.1 + 0.2 equals exactly 0.3.": 0.1 + 0.2 == 0.3,
        "The hexadecimal number FF equals 255.": int("FF", 16) == 255, "The hexadecimal number FF equals 256.": int("FF", 16) == 256,
        "The binary number 101010 equals 42.": int("101010", 2) == 42, "The binary number 101010 equals 44.": int("101010", 2) == 44,
        "A 3-bit number can take 8 different values.": 2 ** 3 == 8, "A 3-bit number can take 6 different values.": 2 ** 3 == 6,
        "A 1920 × 1080 frame has more than 2 million pixels.": 1920 * 1080 > 2e6, "A 1920 × 1080 frame has more than 2.5 million pixels.": 1920 * 1080 > 2.5e6,
        "A 3840 × 2160 frame has exactly four times as many pixels as a 1920 × 1080 frame.": 3840 * 2160 == 4 * 1920 * 1080,
        "A 3840 × 2160 frame has exactly twice as many pixels as a 1920 × 1080 frame.": 3840 * 2160 == 2 * 1920 * 1080,
        "Water boils at 212 °F.": True,
    }
    rule(r"^(.+)$", lambda m: exact[m[1]] if m[1] in exact else None)

    # ---- planets
    diam = lambda m: P[m[1]]["diameter_km"] > P[m[2]]["diameter_km"]
    rule(r"^(\w+) is wider than (\w+)\.$", diam)
    rule(r"^(\w+) has more mass than (\w+)\.$", lambda m: P[m[1]]["mass_1e24kg"] > P[m[2]]["mass_1e24kg"])
    rule(r"^(\w+) is denser than (\w+)\.$", lambda m: P[m[1]]["density_kgm3"] > P[m[2]]["density_kgm3"])
    rule(r"^Surface gravity is stronger on (\w+) than on (\w+)\.$", lambda m: P[m[1]]["gravity_ms2"] > P[m[2]]["gravity_ms2"])
    rule(r"^A day on (\w+) is longer than a day on (\w+)\.$", lambda m: P[m[1]]["day_hours"] > P[m[2]]["day_hours"])
    rule(r"^(\w+) is hotter than (\w+), on average\.$", lambda m: P[m[1]]["mean_temp_c"] > P[m[2]]["mean_temp_c"])
    E = P["Earth"]
    rule(r"^(\w+) is (more|less) than (\d+) times as wide as Earth\.$", lambda m: (P[m[1]]["diameter_km"] / E["diameter_km"] > int(m[3])) == (m[2] == "more"))
    rule(r"^Mars is (more|less) than half as wide as Earth\.$", lambda m: (P["Mars"]["diameter_km"] / E["diameter_km"] > 0.5) == (m[1] == "more"))
    rule(r"^(\w+) has (more|less) than (\d+) times the mass of Earth\.$", lambda m: (P[m[1]]["mass_1e24kg"] / E["mass_1e24kg"] > int(m[3])) == (m[2] == "more"))
    rule(r"^Mars has (more|less) than a tenth of the mass of Earth\.$", lambda m: (P["Mars"]["mass_1e24kg"] / E["mass_1e24kg"] > 0.1) == (m[1] == "more"))
    rule(r"^Surface gravity on Jupiter is (more|less) than twice Earth's\.$", lambda m: (P["Jupiter"]["gravity_ms2"] / E["gravity_ms2"] > 2) == (m[1] == "more"))
    rule(r"^Surface gravity on Mars is (more|less) than a third of Earth's\.$", lambda m: (P["Mars"]["gravity_ms2"] / E["gravity_ms2"] > 1 / 3) == (m[1] == "more"))
    rule(r"^A day on Jupiter is (longer|shorter) than half an Earth day\.$", lambda m: (P["Jupiter"]["day_hours"] / E["day_hours"] > 0.5) == (m[1] == "longer"))
    rule(r"^(\w+) is (more|less) than ([\d.]+) times as far from the Sun as Earth\.$", lambda m: (P[m[1]]["sun_dist_1e6km"] / E["sun_dist_1e6km"] > float(m[3])) == (m[2] == "more"))
    rule(r"^One year on (\w+) lasts (longer|less) than (\d+) Earth years\.$", lambda m: (P[m[1]]["orbit_days"] / E["orbit_days"] > int(m[3])) == (m[2] == "longer"))
    rule(r"^The mean temperature of (\w+) is (above|below) (−?\d+) °C\.$", lambda m: (P[m[1]]["mean_temp_c"] > num(m[3])) == (m[2] == "above"))

    def sunlight(m):
        minutes = P[m[4]]["sun_dist_1e6km"] * 1e6 / SPEED / 60
        t = {"an": 1}.get(m[2], None)
        t = float(m[2]) if t is None else t
        t = t * 60 if m[3].startswith("hour") else t
        return (minutes > t) == (m[1] == "more")
    rule(r"^Sunlight takes (more|less) than (\d+|an) (minutes|hours|hour) to reach (\w+)\.$", sunlight)
    rule(r"^Earth is the densest of the eight planets\.$", lambda m: max(P, key=lambda p: P[p]["density_kgm3"]) == "Earth")
    rule(r"^Mercury is the densest of the eight planets\.$", lambda m: max(P, key=lambda p: P[p]["density_kgm3"]) == "Mercury")
    rule(r"^Jupiter has the shortest day of the eight planets\.$", lambda m: min(P, key=lambda p: P[p]["day_hours"] if p not in ("Mercury", "Venus") else 1e9) == "Jupiter")
    rule(r"^Saturn has the shortest day of the eight planets\.$", lambda m: min(P, key=lambda p: P[p]["day_hours"] if p not in ("Mercury", "Venus") else 1e9) == "Saturn")
    rule(r"^Saturn's average density is (above|below) 1,000 kg/m³\.$", lambda m: (P["Saturn"]["density_kgm3"] > 1000) == (m[1] == "above"))
    rule(r"^To the precision NASA lists, Mars and Mercury have (the same|different) surface gravity\.$", lambda m: (P["Mars"]["gravity_ms2"] == P["Mercury"]["gravity_ms2"]) == (m[1] == "the same"))
    rule(r"^Fold a sheet of paper 0\.1 mm thick in half (\d+) times.*thicker than the distance from the Earth to the Sun\.$", lambda m: 1e-4 * 2 ** int(m[1]) > E["sun_dist_1e6km"] * 1e9)

    # ---- mountains
    rule(r"^(.+) is higher than (.+)\.$", lambda m: M[m[1]] > M[m[2]] if m[1] in M and m[2] in M else None)
    rule(r"^(.+) is (higher|lower) than ([\d,]+) metres\.$", lambda m: (M[m[1]] > num(m[3])) == (m[2] == "higher") if m[1] in M else None)
    eight = sorted([n for n, v in M.items() if v >= 8000], key=lambda n: -M[n])
    rule(r"^(.+) is the (\w+)-highest of the 14 mountains above 8,000 metres\.$", lambda m: eight.index(m[1]) + 1 == ORD[m[2]])
    rule(r"^(Fourteen|Ten) mountains on Earth rise above 8,000 metres\.$", lambda m: len(eight) == {"Fourteen": 14, "Ten": 10}[m[1]])
    rule(r"^Mount Everest is (more|less) than 200 metres higher than K2\.$", lambda m: (M["Mount Everest"] - M["K2"] > 200) == (m[1] == "more"))
    outside = {"Aconcagua": M["Aconcagua"], "Denali": M["Denali"]}
    others = max(M[n] for n in ("Kilimanjaro", "Mount Elbrus", "Vinson Massif", "Mount Kosciuszko", "Mont Blanc", "Matterhorn", "Ben Nevis"))
    rule(r"^(Aconcagua|Denali) is the highest mountain outside Asia\.$", lambda m: M[m[1]] == max(outside.values()) and M[m[1]] > others)

    # ---- countries
    ca = lambda s: THE.sub("", s)
    rule(r"^(.+) is larger than (.+) by total area\.$", lambda m: CO[ca(m[1])] > CO[ca(m[2])] if ca(m[1]) in CO and ca(m[2]) in CO else None)
    rule(r"^(.+) has a total area of (more|less) than ([\d,]+) km²\.$", lambda m: (CO[ca(m[1])] > num(m[3])) == (m[2] == "more") if ca(m[1]) in CO else None)
    by_area = sorted(CO, key=lambda c: -CO[c])
    rule(r"^(\w+) is the (\w+)-largest country in the world by total area\.$", lambda m: by_area.index(m[1]) + 1 == ORD[m[2]])

    # ---- India's states
    area = {s: int(r["area_km2"]) for s, r in ST.items()}
    pop = {s: int(r["population_2011"]) for s, r in ST.items()}
    year = {s: int(r["statehood_year"]) for s, r in ST.items() if r["statehood_year"]}
    rule(r"^(.+) is larger than (.+) by area\.$", lambda m: area[m[1]] > area[m[2]] if m[1] in area and m[2] in area else None)
    rule(r"^(.+) had more people than (.+) in the 2011 census\.$", lambda m: pop[m[1]] > pop[m[2]])
    rule(r"^(.+) is the (largest|smallest) of India's 28 states by area\.$", lambda m: (max if m[2] == "largest" else min)(area, key=area.get) == m[1])
    rule(r"^(.+) was the most populous of India's 28 states in the 2011 census\.$", lambda m: max(pop, key=pop.get) == m[1])
    rule(r"^(.+) had the fewest people of India's 28 states in the 2011 census\.$", lambda m: min(pop, key=pop.get) == m[1])
    rule(r"^(.+) had (more|fewer) than (\d+) million people in the 2011 census\.$", lambda m: (pop[m[1]] > int(m[3]) * 10 ** 6) == (m[2] == "more"))
    rule(r"^(.+) is (larger|smaller) than ([\d,]+) km² in area\.$", lambda m: (area[m[1]] > num(m[3])) == (m[2] == "larger"))
    rule(r"^(.+) became a state in (\d{4})\.$", lambda m: year[m[1]] == int(m[2]))
    rule(r"^(.+) became a state before (.+)\.$", lambda m: year[m[1]] < year[m[2]])
    rule(r"^(.+) is the capital of (.+)\.$", lambda m: ST[m[2]]["capital"] == m[1])
    rule(r"^Chhattisgarh, Jharkhand and Uttarakhand were all created as states in (\d{4})\.$", lambda m: all(year[s] == int(m[1]) for s in ("Chhattisgarh", "Jharkhand", "Uttarakhand")))
    rule(r"^Arunachal Pradesh and (\w+) became states on the same day\.$", lambda m: ST["Arunachal Pradesh"]["statehood_date"] == ST[m[1]]["statehood_date"])

    # ---- elements
    rule(r"^The chemical symbol for (\w+) is (\w+)\.$", lambda m: EL[m[1]]["symbol"] == m[2])
    rule(r"^(\w+) has atomic number (\d+)\.$", lambda m: int(EL[m[1].lower()]["atomic_number"]) == int(m[2]))
    wt = lambda n: float(EL[n.lower()]["atomic_weight"].strip("[]"))
    rule(r"^(\w+) has a higher standard atomic weight than (\w+)\.$", lambda m: wt(m[1]) > wt(m[2]))

    # ---- events, Olympics, the World Cup
    month_of = {n: i + 1 for i, n in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])}
    lc = lambda t: next((a.lower() + t[len(a):] for a in ("The ", "A ", "An ") if t.startswith(a)), t)

    def event_claim(claim):
        for r in sorted(EV, key=lambda r: -len(r["event"])):
            e = r["event"]
            m = re.match(re.escape(e) + r" in (\d{4})\.$", claim)
            if m:
                return int(r["year"]) == int(m[1])
            m = re.match(re.escape(e) + r" in (\w+) (\d{4})\.$", claim)
            if m and m[1] in month_of:
                return r["month"] != "" and int(r["month"]) == month_of[m[1]] and int(r["year"]) == int(m[2])
            m = re.match(re.escape(e) + r" on a (\w+)\.$", claim)
            if m:
                d = datetime.datetime.strptime(r["date_as_printed"], "%d %B %Y").date()
                return WEEKDAYS[d.weekday()] == m[1]
            m = re.match(re.escape(e) + r" before (.+)\.$", claim)
            if m:
                for b in EV:
                    if lc(b["event"]) == m[1]:
                        return int(r["year"]) < int(b["year"])
        return None
    rule(r"^(.+)$", lambda m: event_claim(m[1]))
    rule(r"^The (\d{4}) Summer Olympics were held in (.+)\.$", lambda m: OL[int(m[1])] == m[2])
    rule(r"^The Tokyo Summer Olympics that carry the name 2020 were held in (\d{4})\.$", lambda m: int(m[1]) == 2021)
    rule(r"^(London|Athens) hosted the Summer Olympics twice between 1948 and 2024\.$", lambda m: sum(1 for c in OL.values() if c == m[1]) == 2)
    rule(r"^(\w+) won the (\d{4}) FIFA World Cup\.$", lambda m: WC[int(m[2])]["winner"] == m[1])
    rule(r"^The (\d{4}) FIFA World Cup was hosted by (.+)\.$", lambda m: WC[int(m[1])]["host_country"] == ca(m[2]))
    rule(r"^The (\d{4}) FIFA World Cup final was played between (\w+) and (\w+)\.$", lambda m: {WC[int(m[1])]["winner"], WC[int(m[1])]["runner_up"]} == {m[2], m[3]})
    return checks


def rederive(claim, checks):
    """The first rule that recognises the claim decides. Returns True, False, or None when nothing recognises it."""
    for pattern, fn in checks:
        m = pattern.match(claim)
        if not m:
            continue
        try:
            got = fn(m)
        except (KeyError, ValueError, IndexError):
            got = None
        if got is not None:
            return bool(got)
    return None


# ------------------------------------------------------------------ the checks
def check():
    errors, notes = [], []
    try:
        with open(BANK, encoding="utf-8") as f:
            bank = json.load(f)
    except FileNotFoundError:
        return ["app/content/questions/starter.json is missing: run python3 tools/make_questions.py"], notes
    except ValueError as e:
        return [f"starter.json does not parse: {e}"], notes
    qs = bank.get("questions", [])
    if not 200 <= len(qs) <= 400:
        errors.append(f"expected between 200 and 400 questions, found {len(qs)}")

    ids = Counter(q.get("id") for q in qs)
    claims = Counter(q.get("claim") for q in qs)
    for q in qs:
        where = q.get("id", "?")
        missing = [f for f in FIELDS if f not in q]
        if missing:
            errors.append(f"{where}: missing fields {missing}")
            continue
        if ids[q["id"]] > 1: errors.append(f"{where}: duplicate id")
        if claims[q["claim"]] > 1: errors.append(f"{where}: duplicate claim text")
        if not isinstance(q["answer"], bool): errors.append(f"{where}: answer must be true or false")
        if q["domain"] not in DOMAINS: errors.append(f"{where}: unknown domain {q['domain']}")
        if q["diff"] not in ("easy", "medium", "hard"): errors.append(f"{where}: unknown difficulty {q['diff']}")
        if q["verified"] not in ("computed", "definition", "sourced"): errors.append(f"{where}: unknown verified {q['verified']}")
        if not (6 <= len(q["claim"]) <= 260): errors.append(f"{where}: claim length {len(q['claim'])}")
        if not q["fact"]: errors.append(f"{where}: no fact line")
        if q["verified"] == "sourced":
            if not re.match(r"^https://", q["source"]): errors.append(f"{where}: sourced but no https link")
            if not q["src_name"]: errors.append(f"{where}: sourced but no source name")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", q["checked"]): errors.append(f"{where}: sourced but no check date")
        elif q["source"] != "computed":
            errors.append(f"{where}: {q['verified']} questions use source 'computed'")
        if re.search(r"claude|anthropic", json.dumps(q, ensure_ascii=False), re.I):
            errors.append(f"{where}: the builder's name must not appear in the app")

    n = len(qs) or 1
    t = sum(1 for q in qs if q.get("answer") is True)
    if not 0.45 <= t / n <= 0.55: errors.append(f"true claims are {t / n:.0%} of the bank; the design is half and half")
    by_diff = Counter(q.get("diff") for q in qs)
    for d, want in (("easy", 0.40), ("medium", 0.35), ("hard", 0.25)):
        if abs(by_diff[d] / n - want) > 0.05: errors.append(f"{d} is {by_diff[d] / n:.0%} of the bank, designed for {want:.0%}")
    for d in ("easy", "medium", "hard"):
        sub = [q for q in qs if q.get("diff") == d]
        if sub and not 0.40 <= sum(q["answer"] for q in sub) / len(sub) <= 0.60:
            errors.append(f"{d} questions are not balanced between true and false")
    by_domain = Counter(q.get("domain") for q in qs)
    for d, c in by_domain.items():
        if c / n > 0.35: errors.append(f"domain {d} is {c / n:.0%} of the bank")

    # Freshness: rebuild in memory and compare with the file.
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    try:
        import make_questions
        questions, _ = make_questions.build_bank()
        if make_questions.render(questions) != open(BANK, encoding="utf-8").read():
            errors.append("starter.json is not what the tables produce: run python3 tools/make_questions.py and commit the result")
    except SystemExit as e:
        errors.append(f"the generator could not rebuild the bank: {e}")

    # Truth, worked out again.
    checks = build_checkers()
    done, skipped = 0, []
    for q in qs:
        if "claim" not in q or "answer" not in q:
            continue
        got = rederive(q["claim"], checks)
        if got is None:
            skipped.append(q["claim"])
            continue
        done += 1
        if got != q["answer"]:
            errors.append(f"{q['id']}: stored answer is {q['answer']} but the claim works out as {got}: {q['claim']}")
    notes.append(f"{done} of {len(qs)} claims re-derived independently and agree" if not errors else f"{done} of {len(qs)} claims re-derived")
    if len(qs) and done / len(qs) < 0.95:
        errors.append(f"only {done} of {len(qs)} claims could be re-derived; the rest need a rule here: {skipped[:5]}")
    if skipped:
        notes.append(f"not re-derived: {len(skipped)}")
    return errors, notes


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

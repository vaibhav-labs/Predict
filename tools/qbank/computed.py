"""Questions whose answers Python works out (arithmetic, calendar, growth, probability) or that follow from an exact
definition. Nothing here depends on memory, so these are the safest questions in the bank."""
import calendar
import datetime
import math
from fractions import Fraction

from common import add, both, claim_pair, margin_diff, rng_for, words

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------- arithmetic
def arithmetic():
    rng = rng_for("mul")
    A = [12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 24, 25, 26, 27, 28, 29, 31, 32, 34, 36, 37, 38, 41, 42, 43, 45, 46, 47, 48, 52, 53, 54, 56, 57, 59, 63, 64, 67, 68, 72, 73, 76, 78, 81, 83, 84, 87, 92, 96]
    B = [6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24, 26, 27, 29, 31, 33, 34, 36, 37, 38, 39, 41, 43, 44, 46, 47, 48]
    seen, made = set(), 0
    while made < 32:
        a, b = rng.choice(A), rng.choice(B)
        if a == b or (a, b) in seen or (b, a) in seen:
            continue
        p = a * b
        kind, sgn = rng.choice(["neighbor", "digit", "scale"]), rng.choice([-1, 1])
        if kind == "neighbor":
            q = p + sgn * rng.choice([a, b])
        elif kind == "digit":
            q = p + sgn * rng.choice([10, 20, 30, 100])
        else:
            q = int(round(p * rng.choice([0.7, 0.8, 0.85, 1.15, 1.2, 1.3])))
            q = q - (q % 10) + (p % 10)  # same last digit as the true product, so the last digit gives nothing away
        if q <= 0 or q == p:
            continue
        seen.add((a, b))
        made += 1
        rel = abs(q - p) / p
        diff = "easy" if rel >= 0.15 else "medium" if rel >= 0.04 else "hard"
        tens, ones = b // 10 * 10, b % 10
        split = f" ({a} × {tens} = {a * tens:,}, plus {a} × {ones} = {a * ones:,})" if tens and ones else ""
        both("mul", f"{a}x{b}", f"{a} × {b} = {p:,}.", f"{a} × {b} = {q:,}.",
             f"{a} × {b} = {p:,}{split}.", f"{a} × {b} = {p:,}{split}, not {q:,}.",
             "Estimating gets you close. Only the exact product settles it.", "numbers", diff, "computed")

    # Which side of a round number a product falls on.
    rng = rng_for("thr")
    seen, made = set(), 0
    while made < 18:
        a, b = rng.randint(13, 98), rng.randint(13, 98)
        if (a, b) in seen:
            continue
        p = a * b
        step = rng.choice([50, 100, 250, 500, 1000])
        t = round(p / step) * step
        if t == p or abs(p - t) / p > 0.30 or t <= 0:
            continue
        seen.add((a, b))
        made += 1
        claim_pair("thr", f"{a}x{b}:{t}", f"{a} × {b} is greater than {t:,}.", f"{a} × {b} is less than {t:,}.", p > t,
                   f"{a} × {b} = {p:,}, which is {'above' if p > t else 'below'} {t:,} by {abs(p - t):,}.",
                   "Close to a round number, so a rough estimate cannot settle it.", "numbers", margin_diff((p - t) / p), "computed")

    # Squares and cubes.
    rng = rng_for("sq")
    for n in rng.sample(range(11, 30), 12):
        p = n * n
        q = p + rng.choice([-1, 1]) * rng.choice([10, 20, 2 * n + 1, 2 * n - 1])
        rel = abs(q - p) / p
        both("sq", f"{n}", f"{n}² = {p:,}.", f"{n}² = {q:,}.", f"{n}² = {n} × {n} = {p:,}.", f"{n}² = {p:,}, not {q:,}.",
             "Squares of two-digit numbers are easy to half-remember.", "numbers", "easy" if rel >= 0.12 else "medium" if rel >= 0.04 else "hard", "computed")
    for n in rng.sample([6, 7, 8, 9, 11, 12, 13, 14, 15, 16], 6):
        p = n ** 3
        q = p + rng.choice([-1, 1]) * rng.choice([n * n, 3 * n * n, 100, 10 * n])
        rel = abs(q - p) / p
        both("sq", f"cube{n}", f"{n}³ = {p:,}.", f"{n}³ = {q:,}.", f"{n}³ = {n} × {n} × {n} = {p:,}.", f"{n}³ = {p:,}, not {q:,}.",
             "Cubes grow faster than the intuition for them.", "numbers", "easy" if rel >= 0.12 else "medium" if rel >= 0.04 else "hard", "computed")


# ---------------------------------------------------------------- number theory
def is_prime(n):
    return n > 1 and all(n % d for d in range(2, math.isqrt(n) + 1))


def number_theory():
    rng = rng_for("prime")
    composites = [91, 119, 133, 143, 161, 187, 203, 209, 217, 221, 247, 253, 259, 287, 299, 301, 319, 323, 341, 361, 377, 391, 403, 407]
    primes = [53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293]
    for n in rng.sample(composites, 14) + rng.sample(primes, 14):
        prime = is_prime(n)
        if prime:
            fact, diff = f"{n} is prime: no whole number from 2 to {math.isqrt(n)} divides it.", ("medium" if n < 100 else "hard")
        else:
            f = next(d for d in range(2, n) if n % d == 0)
            fact, diff = f"{n} = {f} × {n // f}, so it is not prime.", ("medium" if f == 7 else "hard")
        add("prime", str(n), "x", f"{n} is a prime number.", prime, fact,
            "A number that passes the tests for 2, 3 and 5 looks prime. The traps start at 7, 11 and 13.", "numbers", diff, "computed")

    s = sum(range(1, 101))
    both("series", "gauss", f"The whole numbers from 1 to 100 add up to {s:,}.", "The whole numbers from 1 to 100 add up to 5,500.",
         f"1 + 2 + … + 100 = {s:,} (50 pairs that each add to 101).", f"They add up to {s:,} (50 pairs that each add to 101), not 5,500.",
         "", "numbers", "medium", "computed")
    odd = sum(range(1, 20, 2))
    both("series", "odd10", f"The first 10 odd numbers add up to {odd}.", "The first 10 odd numbers add up to 110.",
         f"1 + 3 + … + 19 = {odd}, which is 10².", f"They add up to {odd}, which is 10², not 110.", "", "numbers", "medium", "computed")
    f10 = math.factorial(10)
    both("series", "fact10", f"10! (ten factorial) is {f10:,}.", "10! (ten factorial) is 3,268,800.",
         f"10! = {f10:,}.", f"10! = {f10:,}, not 3,268,800.", "", "numbers", "hard", "computed")
    p100 = sum(is_prime(n) for n in range(100))
    both("series", "pi100", f"There are {p100} prime numbers below 100.", "There are 28 prime numbers below 100.",
         f"There are {p100} primes below 100.", f"There are {p100} primes below 100, not 28.", "", "numbers", "hard", "computed")
    p1000 = sum(is_prime(n) for n in range(1000))
    both("series", "pi1000", f"There are {p1000} prime numbers below 1,000.", "There are 200 prime numbers below 1,000.",
         f"There are {p1000} primes below 1,000.", f"There are {p1000} primes below 1,000, not 200.",
         "Primes thin out, but more slowly than most people guess.", "numbers", "medium", "computed")
    fib = [1, 1]
    while len(fib) < 12:
        fib.append(fib[-1] + fib[-2])
    both("series", "fib12", f"The 12th Fibonacci number (1, 1, 2, 3, 5, …) is {fib[11]}.", "The 12th Fibonacci number (1, 1, 2, 3, 5, …) is 133.",
         f"The sequence runs 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, {fib[11]}.", f"The 12th number is {fib[11]}, not 133.", "", "numbers", "medium", "computed")
    digits = len(str(2 ** 100))
    both("series", "dig2p100", f"2^100 has {digits} digits.", "2^100 has 25 digits.",
         f"2^100 = {2 ** 100:,}, which has {digits} digits.", f"2^100 has {digits} digits, not 25.", "Each doubling adds about 0.3 of a digit.", "numbers", "hard", "computed")
    assert 7 * 11 * 13 == 1001
    both("series", "1001", "1,001 equals 7 × 11 × 13.", "1,001 equals 7 × 11 × 17.", "7 × 11 × 13 = 1,001.", f"7 × 11 × 13 = 1,001, while 7 × 11 × 17 = {7 * 11 * 17:,}.",
         "", "numbers", "medium", "computed")


# ---------------------------------------------------------------- calendar
def calendar_questions():
    for y in (1800, 1896, 1900, 1960, 2000, 2023, 2024, 2025, 2028, 2100, 2200, 2400):
        leap = calendar.isleap(y)
        diff = "easy" if y % 100 else ("medium" if leap else "hard")
        add("leap", str(y), "x", f"{y} is a leap year.", leap,
            f"{y} is {'' if leap else 'not '}a leap year. A year is a leap year if it divides by 4, except century years, which must divide by 400.",
            "Divisible by 4 is only half of the rule.", "numbers", diff, "computed")

    rng = rng_for("w53")
    for y in (2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033):
        counts = {d: 0 for d in range(7)}
        day = datetime.date(y, 1, 1)
        while day.year == y:
            counts[day.weekday()] += 1
            day += datetime.timedelta(days=1)
        fifty3 = [d for d in counts if counts[d] == 53]
        fifty2 = [d for d in counts if counts[d] == 52]
        t, f = WEEKDAYS[fifty3[0]], WEEKDAYS[rng.choice(fifty2)]
        days = 366 if calendar.isleap(y) else 365
        extra = days - 364
        names = " and ".join(WEEKDAYS[d] + "s" for d in fifty3)
        lead = f"{y} has {days} days, which is 52 weeks plus {extra} extra day{'s' if extra > 1 else ''}"
        both("w53", str(y), f"{y} has 53 {t}s.", f"{y} has 53 {f}s.",
             f"{lead}: {names} appear 53 times.", f"{lead}: only {names} appear 53 times, so {f}s appear 52 times.",
             "A year is 52 weeks and one or two days over.", "numbers", "hard", "computed")

    rng = rng_for("days")
    spans = [((2027, 1, 1), (2027, 7, 1)), ((2027, 3, 1), (2027, 6, 1)), ((2028, 2, 1), (2028, 4, 1)), ((2027, 2, 1), (2027, 4, 1)),
             ((2027, 6, 15), (2027, 9, 15)), ((2027, 10, 1), (2028, 1, 1)), ((2028, 1, 1), (2028, 12, 31)), ((2027, 4, 10), (2027, 8, 20))]
    for a, b in spans:
        d1, d2 = datetime.date(*a), datetime.date(*b)
        n = (d2 - d1).days
        shift = rng.choice([1, 2, 3, 10])
        wrong = n + rng.choice([-1, 1]) * shift
        fa, fb = f"{d1.day} {d1.strftime('%B %Y')}", f"{d2.day} {d2.strftime('%B %Y')}"
        both("days", f"{d1}:{d2}", f"There are {n} days from {fa} to {fb}.", f"There are {wrong} days from {fa} to {fb}.",
             f"From {fa} to {fb} is {n} days.", f"From {fa} to {fb} is {n} days, not {wrong}.",
             "Months have different lengths, so the sum is easy to slip on.", "numbers", "medium" if shift >= 10 else "hard", "computed")

    # The 13th of the month over a full 400-year Gregorian cycle.
    count = [0] * 7
    for y in range(2001, 2401):
        for m in range(1, 13):
            count[datetime.date(y, m, 13).weekday()] += 1
    best = max(range(7), key=lambda d: count[d])
    assert WEEKDAYS[best] == "Friday"
    both("thirteenth", "400", "Over a full 400-year Gregorian cycle, the 13th of the month falls on a Friday more often than on any other day of the week.",
         "Over a full 400-year Gregorian cycle, the 13th of the month falls on a Sunday more often than on any other day of the week.",
         f"Counted over 400 years: Friday {count[4]}, Sunday {count[6]}, Monday {count[0]}, Tuesday {count[1]}, Wednesday {count[2]}, Thursday {count[3]}, Saturday {count[5]}.",
         f"Counted over 400 years, the 13th is a Friday {count[4]} times and a Sunday {count[6]} times.", "The differences are tiny, so memory of the pattern is all there is.",
         "numbers", "hard", "computed")


# ---------------------------------------------------------------- powers and growth
def powers():
    nice = sorted({m * 10 ** e for m in (1, 2, 4, 5, 8) for e in range(2, 18)})
    for n in (10, 16, 20, 24, 30, 32, 40, 50):
        v = 2 ** n
        lo, hi = max(x for x in nice if x < v), min(x for x in nice if x > v)
        for t in (lo, hi):
            claim_pair("pow", f"2^{n}:{t}", f"2^{n} is greater than {words(t)}.", f"2^{n} is less than {words(t)}.", v > t,
                       f"2^{n} = {v:,}, which is {'above' if v > t else 'below'} {words(t)}.",
                       "Powers of two sit close to round powers of ten, which makes them easy to misjudge.", "numbers", margin_diff((v - t) / v), "computed")
    both("pow", "2^10", "2^10 is exactly 1,024.", "2^10 is exactly 1,000.", "2^10 = 1,024.", "2^10 = 1,024, not 1,000.", "", "numbers", "easy", "computed")
    both("pow", "2^16", "2^16 equals 65,536.", "2^16 equals 65,356.", "2^16 = 65,536.", "2^16 = 65,536, not 65,356.", "", "numbers", "hard", "computed")

    day30 = Fraction(1, 100) * 2 ** 29
    both("pow", "penny", "Start with one cent and double the amount every day, so day 1 is 1 cent and day 2 is 2 cents. On day 30 you have more than 5 million dollars.",
         "Start with one cent and double the amount every day, so day 1 is 1 cent and day 2 is 2 cents. On day 30 you have more than 10 million dollars.",
         f"Day 30 is 2^29 cents = ${float(day30):,.2f}.", f"Day 30 is 2^29 cents = ${float(day30):,.2f}, which is above 5 million but below 10 million.",
         "Doubling hides in the first days and explodes in the last.", "economy", "medium", "computed")
    assert 10 ** 9 < 2 ** 30 and 2 ** 24 < 10 ** 9
    both("pow", "bacteria", "A bacterium that divides in two every 20 minutes, with unlimited food, becomes more than a billion bacteria after 10 hours.",
         "A bacterium that divides in two every 20 minutes, with unlimited food, becomes more than a billion bacteria after 8 hours.",
         f"10 hours is 30 doublings, 2^30 = {2 ** 30:,}, so yes.", f"8 hours is 24 doublings, 2^24 = {2 ** 24:,}, so no: 10 hours is the first whole hour past a billion.",
         "", "science", "medium", "computed")

    # Money doubling: the years it takes at a steady rate.
    for r in (3, 4, 5, 6, 7, 8, 9, 12):
        exact = math.log(2) / math.log(1 + r / 100)
        lo, hi = math.floor(exact), math.ceil(exact)
        m = min(abs(exact - lo), abs(hi - exact)) / exact
        both("dbl", str(r), f"At {r}% growth a year, money more than doubles in {hi} years.", f"At {r}% growth a year, money more than doubles in {lo} years.",
             f"At {r}% a year it takes {exact:.1f} years to double: {hi} years is enough.", f"At {r}% a year it takes {exact:.1f} years to double, so {lo} years falls short.",
             "The rule of 72 gives the answer within a few percent: 72 divided by the rate.", "economy", "hard" if m < 0.04 else "medium", "computed")


# ---------------------------------------------------------------- percentages and compounding
def percentages():
    items = [
        ("lossgain", "A fall of 50% followed by a rise of 50% leaves you 25% below where you started.", "A fall of 50% followed by a rise of 50% leaves you back where you started.",
         "100 → 50 → 75. A 50% rise on the smaller number does not recover the loss.", "medium"),
        ("up25", "A rise of 25% followed by a fall of 20% leaves you exactly where you started.", "A rise of 25% followed by a fall of 20% leaves you 5% below where you started.",
         "100 → 125 → 100. A fall of 20% undoes a rise of 25%.", "hard"),
        ("up20", "A rise of 20% followed by a fall of 20% leaves you 4% below where you started.", "A rise of 20% followed by a fall of 20% leaves you ahead of where you started.",
         "100 → 120 → 96. The fall applies to a bigger number than the rise did.", "medium"),
        ("asymm", "If B is 25% more than A, then A is 20% less than B.", "If B is 25% more than A, then A is 25% less than B.",
         "B = 1.25 A, so A = 0.8 B: 20% less, not 25%.", "hard"),
        ("recover", "A share price that falls 50% has to rise 100% to get back to where it was.", "A share price that falls 50% has to rise 50% to get back to where it was.",
         "100 → 50, and 50 → 100 is a rise of 100%.", "medium"),
        ("five10", "Five years of 10% growth a year add up to growth of more than 60%.", "Five years of 10% growth a year add up to growth of exactly 50%.",
         "1.1^5 = 1.61051, so growth of 61%, not 50%.", "medium"),
        ("monthly", "A return of 1% every month compounds to more than 12% over a year.", "A return of 1% every month compounds to more than 13% over a year.",
         "1.01^12 = 1.1268, so 12.7%.", "hard"),
        ("loan", "A loan that charges 2% interest a month, compounded, costs more than 24% over a year.", "A loan that charges 2% interest a month, compounded, costs exactly 24% over a year.",
         "1.02^12 = 1.2682, so 26.8%.", "medium"),
        ("ten7", "Money growing at 10% a year more than doubles in 8 years but not in 7.", "Money growing at 10% a year more than doubles in 7 years.",
         "1.1^7 = 1.949 and 1.1^8 = 2.144.", "hard"),
        ("inflate", "At 6% inflation a year, the buying power of money roughly halves in 12 years.", "At 6% inflation a year, the buying power of money roughly halves in 6 years.",
         "1.06^12 = 2.012, so prices double and the money buys about half.", "medium"),
    ]
    assert abs(1.01 ** 12 - 1.1268) < 1e-3 and abs(1.02 ** 12 - 1.2682) < 1e-3 and 1.1 ** 7 < 2 < 1.1 ** 8 and abs(1.1 ** 5 - 1.61051) < 1e-5 and 1.06 ** 12 > 2
    for key, t, f, fact, diff in items:
        both("pct", key, t, f, fact, fact, "Percentages apply to a base that moves.", "economy", diff, "computed")


# ---------------------------------------------------------------- probability
def chance():
    ways = lambda s: sum(1 for i in range(1, 7) for j in range(1, 7) if i + j == s)
    for key, s1, s2 in (("d78", 7, 8), ("d68", 6, 8), ("d23", 2, 3), ("d1211", 12, 11), ("d69", 6, 9)):
        w1, w2 = ways(s1), ways(s2)
        if w1 == w2:
            both("dice", key, f"With two fair dice, a total of {s1} is exactly as likely as a total of {s2}.", f"With two fair dice, a total of {s1} is more likely than a total of {s2}.",
                 f"Both can be made in {w1} of the 36 ways.", f"Both can be made in {w1} of the 36 ways, so neither is more likely.", "", "chance", "hard", "computed")
        elif w1 > w2:
            both("dice", key, f"With two fair dice, a total of {s1} is more likely than a total of {s2}.", f"With two fair dice, a total of {s1} is exactly as likely as a total of {s2}.",
                 f"A total of {s1} can be made in {w1} of the 36 ways and a total of {s2} in {w2}.", f"A total of {s1} can be made in {w1} of the 36 ways and a total of {s2} in {w2}, so they are not equally likely.",
                 "", "chance", "hard" if w1 - w2 == 1 else "medium", "computed")
        else:
            both("dice", key, f"With two fair dice, a total of {s1} is less likely than a total of {s2}.", f"With two fair dice, a total of {s1} is more likely than a total of {s2}.",
                 f"A total of {s1} can be made in {w1} of the 36 ways and a total of {s2} in {w2}.", f"A total of {s1} can be made in {w1} of the 36 ways and a total of {s2} in {w2}.",
                 "", "chance", "medium", "computed")

    for k in (3, 4):
        p = 1 - (5 / 6) ** k
        claim_pair("sixes", str(k), f"Rolling a fair die {k} times, the chance of at least one six is above 50%.", f"Rolling a fair die {k} times, the chance of at least one six is below 50%.", p > 0.5,
                   f"The chance is 1 − (5/6)^{k} = {p:.1%}.", "People anchor on 1 in 6 for each roll and forget the rolls add up.", "chance", "hard" if abs(p - 0.5) < 0.06 else "medium", "computed")

    def shared_birthday(k):
        q = 1.0
        for i in range(k):
            q *= (365 - i) / 365
        return 1 - q
    for k, t in ((23, 0.5), (20, 0.5), (30, 0.9), (40, 0.85), (50, 0.95), (15, 0.3), (10, 0.2)):
        p = shared_birthday(k)
        claim_pair("bday", f"{k}:{t}", f"In a group of {k} people, the chance that at least two share a birthday is above {t:.0%} (assume 365 equally likely birthdays).",
                   f"In a group of {k} people, the chance that at least two share a birthday is below {t:.0%} (assume 365 equally likely birthdays).", p > t,
                   f"For {k} people the chance is {p:.1%}.", "Pairs, not people: a group of 23 has 253 pairs.", "chance", margin_diff((p - t) / p), "computed")

    both("coin", "two3", "Flipping a fair coin 3 times, the chance of exactly two heads is 3/8.", "Flipping a fair coin 3 times, the chance of exactly two heads is 1/2.",
         "Three of the 8 equally likely sequences (HHT, HTH, THH) have exactly two heads.", "Three of the 8 equally likely sequences have exactly two heads: 3/8, not 1/2.", "", "chance", "medium", "computed")
    p50 = math.comb(100, 50) / 2 ** 100
    claim_pair("coin", "50of100", "Flipping a fair coin 100 times, getting exactly 50 heads is more likely than not.", "Flipping a fair coin 100 times, getting exactly 50 heads is less likely than not.", p50 > 0.5,
               f"The chance of exactly 50 heads is {p50:.1%}.", "50 is the single most likely count, but it is still only about 1 in 13.", "chance", "medium", "computed")
    p60 = sum(math.comb(100, k) for k in range(60, 101)) / 2 ** 100
    claim_pair("coin", "60of100", "Flipping a fair coin 100 times, getting 60 or more heads happens less than 5% of the time.", "Flipping a fair coin 100 times, getting 60 or more heads happens more than 5% of the time.", p60 < 0.05,
               f"The chance of 60 or more heads is {p60:.1%}.", "A 60-40 split feels common but needs luck.", "chance", "hard", "computed")
    seqs = [s for s in range(2 ** 6) if (s >> 1) == 0b11111]  # six flips, the first five heads (1 = heads): last flip heads or tails
    tails_next = sum(1 for s in seqs if (s & 1) == 0)
    assert len(seqs) == 2 and tails_next == 1
    both("coin", "streak", "After five heads in a row, a fair coin is exactly as likely to land tails as heads on the next flip.", "After five heads in a row, a fair coin is more likely to land tails on the next flip.",
         "Flips are independent: the next flip is tails with chance 1/2, whatever came before.", "Flips are independent: the chance of tails is 1/2, the same as heads.", "The gambler's fallacy.", "chance", "easy", "computed")
    both("coin", "hth", "In three fair coin flips, the sequence HTH is exactly as likely as HHH.", "In three fair coin flips, the sequence HHH is less likely than HTH.",
         "Each specific sequence of three flips has chance 1/8.", "Each specific sequence of three flips has chance 1/8, so they are equally likely.", "A mixed sequence looks more typical, which is not the same as more likely.", "chance", "medium", "computed")

    # Monty Hall, by counting every case.
    switch_wins = stay_wins = total = 0
    for car in range(3):
        for pick in range(3):
            opened = [d for d in range(3) if d != pick and d != car]
            for host in opened:
                w = 1 / len(opened)
                other = next(d for d in range(3) if d not in (pick, host))
                total += 1 / 3 * 1 / 3 * w
                switch_wins += 1 / 3 * 1 / 3 * w * (other == car)
                stay_wins += 1 / 3 * 1 / 3 * w * (pick == car)
    assert abs(switch_wins - 2 / 3) < 1e-9
    both("monty", "3doors", "Three doors hide one prize. You pick a door, and the host, who knows where the prize is, opens a different door that has no prize. Switching to the last closed door wins 2 times in 3.",
         "Three doors hide one prize. You pick a door, and the host, who knows where the prize is, opens a different door that has no prize. Staying and switching are equally likely to win.",
         "Your first pick is right 1 time in 3. The other 2 times the host's choice leaves the prize behind the last door.", "Switching wins 2 times in 3, staying wins 1 time in 3.",
         "Two closed doors feel like 50-50. They are not, because the host's choice carries information.", "chance", "medium", "computed")

    pd = Fraction(1, 1000)
    post = (Fraction(99, 100) * pd) / (Fraction(99, 100) * pd + Fraction(1, 100) * (1 - pd))
    assert 0.05 < float(post) < 0.10
    claim_pair("base", "50", "A disease affects 1 person in 1,000. A test catches 99% of cases and wrongly flags 1% of healthy people. Someone who tests positive has more than a 50% chance of having the disease.",
               "A disease affects 1 person in 1,000. A test catches 99% of cases and wrongly flags 1% of healthy people. Someone who tests positive has less than a 50% chance of having the disease.", False,
               f"Out of 100,000 people, 100 are ill and 99 test positive; of the 99,900 healthy, 999 test positive too. So {float(post):.1%} of positives are ill.",
               "A rare condition produces more false alarms than true ones, even from a good test.", "chance", "hard", "computed")
    claim_pair("base", "10", "A disease affects 1 person in 1,000. A test catches 99% of cases and wrongly flags 1% of healthy people. Someone who tests positive has less than a 10% chance of having the disease.",
               "A disease affects 1 person in 1,000. A test catches 99% of cases and wrongly flags 1% of healthy people. Someone who tests positive has more than a 10% chance of having the disease.", True,
               f"Out of 100,000 people, 99 ill and 999 healthy people test positive: {float(post):.1%} of positives are ill.", "The accuracy of the test is not the chance that a positive is right.", "chance", "hard", "computed")
    both("kids", "boy", "A family has two children and at least one is a boy. The chance that both are boys is 1/3.", "A family has two children and at least one is a boy. The chance that both are boys is 1/2.",
         "The equally likely cases are boy-boy, boy-girl and girl-boy. One of those three is boy-boy.", "The equally likely cases are boy-boy, boy-girl and girl-boy, so the chance is 1/3, not 1/2.",
         "", "chance", "hard", "computed")
    aces = Fraction(4, 52) * Fraction(3, 51)
    claim_pair("cards", "aces", "Drawing two cards from a shuffled 52-card deck, the chance that both are aces is below 1%.", "Drawing two cards from a shuffled 52-card deck, the chance that both are aces is above 1%.", float(aces) < 0.01,
               f"(4/52) × (3/51) = 1/221, about {float(aces):.2%}.", "", "chance", "medium", "computed")
    both("die", "mean", "The average roll of a fair six-sided die, over many rolls, settles at 3.5.", "The average roll of a fair six-sided die, over many rolls, settles at 3.",
         "(1 + 2 + 3 + 4 + 5 + 6) / 6 = 3.5.", "(1 + 2 + 3 + 4 + 5 + 6) / 6 = 3.5, not 3.", "", "chance", "easy", "computed")


# ---------------------------------------------------------------- exact definitions and conversions
def definitions():
    d = "definition"
    why_unit = "Customary units have exact metric definitions, and the round numbers people remember are only close."
    both("unit", "inch", "An inch is exactly 25.4 millimetres.", "An inch is exactly 25 millimetres.", "By definition, 1 inch = 25.4 mm exactly.", "By definition, 1 inch = 25.4 mm exactly, not 25.", why_unit, "numbers", "medium", d)
    both("unit", "mile", "A mile is exactly 1.609344 kilometres.", "A mile is exactly 1.6 kilometres.", "By definition, 1 mile = 1,609.344 m exactly.", "By definition, 1 mile = 1,609.344 m exactly, not 1,600.", why_unit, "numbers", "medium", d)
    both("unit", "foot", "A foot is exactly 30.48 centimetres.", "A foot is exactly 30 centimetres.", "By definition, 1 foot = 0.3048 m exactly.", "By definition, 1 foot = 0.3048 m exactly, not 0.30.", why_unit, "numbers", "medium", d)
    both("unit", "nmi", "A nautical mile is longer than a statute mile.", "A nautical mile is shorter than a statute mile.", "A nautical mile is exactly 1,852 m and a statute mile is 1,609.344 m.", "A nautical mile is exactly 1,852 m and a statute mile is 1,609.344 m, so it is longer.", "", "numbers", "medium", d)
    both("unit", "knot", "One knot is one nautical mile per hour.", "One knot is one statute mile per hour.", "By definition, 1 knot = 1 nautical mile per hour = 1.852 km/h.", "By definition, 1 knot = 1 nautical mile per hour = 1.852 km/h, not 1 statute mile per hour.", "", "numbers", "medium", d)
    both("unit", "gallon", "An imperial gallon is bigger than a US gallon.", "A US gallon is bigger than an imperial gallon.", "An imperial gallon is 4.54609 litres and a US gallon is 3.785411784 litres.", "An imperial gallon is 4.54609 litres and a US gallon is 3.785411784 litres, so the imperial one is bigger.", "Same word, different sizes.", "numbers", "hard", d)
    both("unit", "kglb", "A kilogram is more than 2.2 pounds.", "A kilogram is more than 2.25 pounds.", "1 kg = 1 / 0.45359237 lb = 2.2046 lb.", "1 kg = 2.2046 lb, which is under 2.25.", "", "numbers", "hard", d)
    both("unit", "hectare", "A hectare is bigger than an acre.", "An acre is bigger than a hectare.", "1 hectare = 10,000 m² and 1 acre = 4,046.86 m², so a hectare is about 2.47 acres.", "1 hectare = 10,000 m² and 1 acre = 4,046.86 m², so a hectare is the bigger one.", "", "numbers", "medium", d)
    both("unit", "c40", "−40 °C and −40 °F are the same temperature.", "0 °C and 0 °F are the same temperature.", "°F = °C × 9/5 + 32, which gives −40 for both at −40.", "°F = °C × 9/5 + 32, so 0 °C is 32 °F. The scales meet at −40.", "", "numbers", "medium", d)
    both("unit", "c37", "A body temperature of 37 °C is below 100 °F.", "A body temperature of 37 °C is above 100 °F.", "37 °C = 98.6 °F.", "37 °C = 98.6 °F, which is below 100 °F.", "", "numbers", "medium", d)
    both("unit", "c100", "Water boils at 212 °F at standard pressure.", "Water boils at 180 °F at standard pressure.", "100 °C = 212 °F.", "100 °C = 212 °F, not 180.", "", "science", "easy", d)
    both("unit", "abszero", "Absolute zero is −273.15 °C.", "Absolute zero is −237.15 °C.", "Absolute zero is 0 K, which is −273.15 °C.", "Absolute zero is 0 K, which is −273.15 °C, not −237.15.", "", "science", "hard", d)
    both("unit", "light", "The speed of light in a vacuum is exactly 299,792,458 metres per second.", "The speed of light in a vacuum is exactly 300,000,000 metres per second.",
         "The metre is defined from it: 299,792,458 m/s exactly.", "It is 299,792,458 m/s exactly. 3 × 10^8 is a rounding.", "", "science", "medium", d)
    both("unit", "litre", "A litre is 1,000 cubic centimetres.", "A litre is 100 cubic centimetres.", "1 litre = 1 dm³ = 1,000 cm³.", "1 litre = 1,000 cm³, not 100.", "", "numbers", "easy", d)
    both("unit", "shortton", "A US (short) ton is 2,000 pounds.", "A US (short) ton is 2,240 pounds.", "A short ton is 2,000 lb. The long ton is 2,240 lb.", "A short ton is 2,000 lb. 2,240 lb is the long ton.", "Two tons that differ by 12%.", "numbers", "hard", d)
    lakh, crore = 10 ** 5, 10 ** 7
    both("indian", "lakh", "One lakh is 100,000.", "One lakh is 1,000,000.", "1 lakh = 10^5 = 100,000.", "1 lakh = 100,000. A million is 10 lakh.", "", "economy", "easy", d)
    both("indian", "crore", "One crore is 10 million.", "One crore is 1 million.", f"1 crore = 10^7 = {crore:,}.", f"1 crore = {crore:,}, which is 10 million.", "", "economy", "easy", d)
    both("indian", "lakhcrore", "One lakh crore is one trillion.", "One lakh crore is 100 billion.", f"1 lakh crore = 10^5 × 10^7 = 10^12 = {10 ** 12:,}.", f"1 lakh crore = 10^12, which is a trillion, not 100 billion.",
         "Indian budget figures are quoted in lakh crore.", "economy", "medium", d)
    both("indian", "10kcrore", "A sum of 10,000 crore rupees is 100 billion rupees.", "A sum of 10,000 crore rupees is 10 billion rupees.", f"10^4 × 10^7 = 10^11 = {10 ** 11:,}, which is 100 billion.", "10,000 crore is 10^11, which is 100 billion, not 10 billion.", "", "economy", "medium", d)
    both("indian", "50kcrore", "A sum of 50,000 crore rupees is 500 billion rupees.", "A sum of 50,000 crore rupees is 50 billion rupees.", f"5 × 10^4 × 10^7 = 5 × 10^11 = {5 * 10 ** 11:,}, which is 500 billion.", "50,000 crore is 5 × 10^11, which is 500 billion, not 50 billion.", "", "economy", "medium", d)


# ---------------------------------------------------------------- technology numbers
def technology():
    d = "definition"
    both("tech", "byte", "A byte is 8 bits.", "A byte is 16 bits.", "By definition, a byte is 8 bits.", "A byte is 8 bits, not 16.", "", "technology", "easy", d)
    both("tech", "ipv4", "IPv4 has about 4.3 billion possible addresses.", "IPv4 has about 430 million possible addresses.", f"Addresses are 32 bits: 2^32 = {2 ** 32:,}.", f"Addresses are 32 bits: 2^32 = {2 ** 32:,}, about 4.3 billion.", "", "technology", "medium", "computed")
    both("tech", "u32", f"The largest value a 32-bit unsigned integer can hold is {2 ** 32 - 1:,}.", f"The largest value a 32-bit unsigned integer can hold is {2 ** 32:,}.", f"2^32 − 1 = {2 ** 32 - 1:,}, because zero takes one of the 2^32 values.", f"2^32 − 1 = {2 ** 32 - 1:,}, because zero takes one of the values.", "", "technology", "hard", "computed")
    both("tech", "i8", "A signed 8-bit integer ranges from −128 to 127.", "A signed 8-bit integer ranges from −127 to 128.", "Two's complement gives −2^7 to 2^7 − 1.", "Two's complement gives −128 to 127: one more negative value than positive.", "", "technology", "hard", "computed")
    assert 0.1 + 0.2 != 0.3 and repr(0.1 + 0.2) == "0.30000000000000004"
    both("tech", "float", "In standard floating-point arithmetic (IEEE 754 doubles), 0.1 + 0.2 does not equal exactly 0.3.", "In standard floating-point arithmetic (IEEE 754 doubles), 0.1 + 0.2 equals exactly 0.3.",
         "0.1 + 0.2 = 0.30000000000000004, because neither 0.1 nor 0.2 can be stored exactly in binary.", "0.1 + 0.2 = 0.30000000000000004 in doubles.", "", "technology", "medium", "computed")
    both("tech", "hexff", "The hexadecimal number FF equals 255.", "The hexadecimal number FF equals 256.", "FF = 15 × 16 + 15 = 255.", "FF = 15 × 16 + 15 = 255, not 256.", "", "technology", "medium", "computed")
    both("tech", "bin42", "The binary number 101010 equals 42.", "The binary number 101010 equals 44.", "101010 = 32 + 8 + 2 = 42.", "101010 = 32 + 8 + 2 = 42, not 44.", "", "technology", "medium", "computed")
    both("tech", "bits3", "A 3-bit number can take 8 different values.", "A 3-bit number can take 6 different values.", "2^3 = 8.", "2^3 = 8, not 6.", "", "technology", "easy", "computed")
    px = 1920 * 1080
    both("tech", "px1080", "A 1920 × 1080 frame has more than 2 million pixels.", "A 1920 × 1080 frame has more than 2.5 million pixels.", f"1920 × 1080 = {px:,}.", f"1920 × 1080 = {px:,}, which is under 2.5 million.", "", "technology", "hard", "computed")
    both("tech", "px4k", "A 3840 × 2160 frame has exactly four times as many pixels as a 1920 × 1080 frame.", "A 3840 × 2160 frame has exactly twice as many pixels as a 1920 × 1080 frame.",
         "Both sides double, so the pixel count quadruples: 8,294,400 against 2,073,600.", "Both sides double, so the count quadruples, not doubles.", "", "technology", "medium", "computed")


def generate():
    arithmetic()
    number_theory()
    calendar_questions()
    powers()
    percentages()
    chance()
    definitions()
    technology()

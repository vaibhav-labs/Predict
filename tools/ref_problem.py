#!/usr/bin/env python3
"""An independent version of the Block 7 rules, written without looking at app/js/engine/problem.js or reasoning.js.

Prints JSON that tools/engine_tests/b7.mjs compares with the app, number by number:
  worksheet  for every Fermi problem and six 'players' (each part's range is the truth stretched by a factor either way, factors 1.1 to 6,
             and one player whose parts all miss low), the combined range, whether it held, the score, the points, the miss factor
             and the naive (product of the ends) range. The combination is done here from variances in natural logs, not with log10 sums.
  twenty     twenty known problems worked by hand: parts' ranges given as numbers, the answer the worksheet must give (checked in the test too).
  rate       percent problems at several guesses: miss, hit, points.
  chain      the product of each chain's steps against its stored joint share, and the points a naive 'weakest step' answer earns.
  classes    the right rung of every ladder from the counts.
  gates      the exact pass chances of the Unit 4 and Unit 5 gates by true skill (binomial), as the design document quotes them.
Python 3 standard library only.
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json")))
FERMI = json.load(open(os.path.join(ROOT, "app", "content", "questions", "fermi.json")))["questions"]
RATES = json.load(open(os.path.join(ROOT, "app", "content", "questions", "rates.json")))["questions"]
MISS = CFG["interval"]["miss_multiplier"]
P = CFG["interval"]["points"]
R = CFG["problems"]["rate"]
FACTORS = [1.1, 1.5, 2.0, 3.0, 6.0]


def combine(parts, mult):
    """Natural-log version: the centres add, the half-widths add as the square root of the sum of squares."""
    mu = math.log(mult)
    var = 0.0
    for lo, hi in parts:
        mu += (math.log(lo) + math.log(hi)) / 2
        var += ((math.log(hi) - math.log(lo)) / 2) ** 2
    s = math.sqrt(var)
    return math.exp(mu - s), math.exp(mu + s)


def judge(q, low, high):
    t = math.log10(q["truth"])
    lo, hi = math.log10(low), math.log10(high)
    ref_w = math.log10(q["ref_high"]) - math.log10(q["ref_low"])
    score = (hi - lo) + MISS * (max(0.0, lo - t) + max(0.0, t - hi))
    pts = max(P["floor"], round(P["scale"] * (P["offset"] - score / ref_w)))
    factor = 10 ** abs(t - (lo + hi) / 2)
    return {"hit": low <= q["truth"] <= high, "ratio": (hi - lo) / ref_w, "score": score, "points": pts, "miss": factor}


def stretched(truth, f):
    return truth / f, truth * f


def worksheet():
    rows = []
    for q in FERMI:
        for f in FACTORS:
            parts = [stretched(p["truth"], f) for p in q["parts"]]
            low, high = combine(parts, q["mult"])
            rows.append({"q": q["id"], "f": f, "parts": parts, "low": low, "high": high, "naive": [math.prod(a for a, _ in parts) * q["mult"], math.prod(b for _, b in parts) * q["mult"]], **judge(q, low, high)})
        parts = [(p["truth"] / 4, p["truth"] / 2) for p in q["parts"]]  # every part's range sits wholly below its truth
        low, high = combine(parts, q["mult"])
        rows.append({"q": q["id"], "f": "low", "parts": parts, "low": low, "high": high, "naive": [math.prod(a for a, _ in parts) * q["mult"], math.prod(b for _, b in parts) * q["mult"]], **judge(q, low, high)})
    return rows


# Twenty problems worked by hand: (parts as (low, high), multiplier). The expected combined range is written out here to six figures; each is
# the centre (product of geometric means) times or divided by exp(sqrt(sum of squared half-widths in ln)).
TWENTY = [
    ([(2, 8)], 1), ([(10, 1000)], 1), ([(4, 4)], 1), ([(1, 100), (1, 100)], 1), ([(2, 8), (3, 12)], 1),
    ([(5, 20), (5, 20)], 1), ([(10, 40), (0.1, 0.4)], 1), ([(100, 400), (50, 200), (2, 8)], 1), ([(1, 4), (1, 4), (1, 4), (1, 4)], 1), ([(30, 60), (7, 14)], 0.01),
    ([(0.5, 2), (0.5, 2)], 1000), ([(20, 80), (1, 16), (1, 4)], 1), ([(1, 1), (2, 2)], 5), ([(3, 12), (3, 12), (3, 12)], 1), ([(8, 32), (8, 32)], 0.5),
    ([(1000, 4000), (0.01, 0.04)], 1), ([(2, 50), (2, 50)], 1), ([(6, 24)], 100), ([(9, 36), (0.25, 1), (4, 16)], 1), ([(1.5, 6), (2, 8), (3, 12), (5, 20)], 1),
]


def twenty():
    return [{"parts": parts, "mult": mult, "low": combine(parts, mult)[0], "high": combine(parts, mult)[1]} for parts, mult in TWENTY]


def rate_rows():
    out = []
    for q in RATES:
        if q["type"] != "rate":
            continue
        for off in (0, 3.5, 7, 7.1, 10.5, 14, 30, -20):
            g = min(100.0, max(0.0, q["truth"] + off))
            miss = abs(g - q["truth"])
            pts = max(R["floor"], round(R["full_points"] * (1 - miss / R["tolerance"])))
            out.append({"q": q["id"], "guess": g, "miss": miss, "hit": miss <= R["tolerance"] + 1e-9, "points": pts})
    return out


def chains():
    out = []
    for q in RATES:
        if q["type"] != "chain":
            continue
        prod = 100.0 * math.prod(s["rate"] / 100 for s in q["steps"])
        out.append({"q": q["id"], "product": prod, "truth": q["truth"], "weakest": min(s["rate"] for s in q["steps"])})
    return out


def classes():
    return [{"q": q["id"], "right": max(i for i, c in enumerate(q["classes"]) if c["n"] >= R["class_min_cases"]), "stored": q["right"]} for q in RATES if q["type"] == "class"]


def binom(n, p, lo, hi):
    return sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(lo, hi + 1))


def main():
    G = CFG["gates"]
    out = {
        "worksheet": worksheet(), "twenty": twenty(), "rate": rate_rows(), "chain": chains(), "classes": classes(),
        "gates": {"u4": {str(c): binom(G["fermi_exam_calls"], c, G["fermi_pass_hits"], G["fermi_exam_calls"]) for c in (0.5, 0.7, 0.8, 0.9, 0.99)},
                  "u5": {str(c): binom(G["rate_exam_calls"], c, G["rate_pass_within"], G["rate_exam_calls"]) for c in (0.5, 0.7, 0.8, 0.85, 0.9, 0.99)}},
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()

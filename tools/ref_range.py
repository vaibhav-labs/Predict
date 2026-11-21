#!/usr/bin/env python3
"""An independent version of the Block 6 range rules, written without looking at app/js/engine/range.js.

Reads data/scoring.json and app/content/questions/ranges.json, builds a fixed set of 'player' ranges for every question (the
reference interval stretched by a factor around its middle, in the question's own scale, plus a few ranges that miss), and prints
what the rules say about each: held the truth or not, width against the reference, interval score, points. tools/engine_tests/b6.mjs
runs the app's engine on the same ranges and compares every number. It also prints the exact pass chance of the Unit 3 gate by
true coverage (the same table as sim/scoring_sim.py part G) and the measured average of a reference-interval player.

Run:  python3 tools/ref_range.py            (prints JSON)
Python 3 standard library only.
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json")))
QS = json.load(open(os.path.join(ROOT, "app", "content", "questions", "ranges.json")))["questions"]
MISS = CFG["interval"]["miss_multiplier"]
P = CFG["interval"]["points"]
FACTORS = [0.5, 0.8, 1.0, 1.3, 2.0, 4.0]


def to_scale(q, x):
    return math.log10(x) if q["scale"] == "log" else x


def from_scale(q, x):
    return 10 ** x if q["scale"] == "log" else x


def score_of(q, low, high):
    lo, hi, t = to_scale(q, low), to_scale(q, high), to_scale(q, q["truth"])
    return (hi - lo) + MISS * (max(0.0, lo - t) + max(0.0, t - hi))


def points_of(score, ref_w):
    # Python's round() goes to the nearest even number on an exact half, like the app's roundHalfEven.
    return max(P["floor"], round(P["scale"] * (P["offset"] - score / ref_w)))


def stretched(q, f):
    lo, hi = to_scale(q, q["ref_low"]), to_scale(q, q["ref_high"])
    mid, half = (lo + hi) / 2, (hi - lo) / 2 * f
    return from_scale(q, mid - half), from_scale(q, mid + half)


def judge(q, low, high):
    ref_w = to_scale(q, q["ref_high"]) - to_scale(q, q["ref_low"])
    s = score_of(q, low, high)
    return {"hit": low <= q["truth"] <= high, "width": to_scale(q, high) - to_scale(q, low), "ref_w": ref_w,
            "ratio": (to_scale(q, high) - to_scale(q, low)) / ref_w, "score": s, "points": points_of(s, ref_w)}


def binom(n, p, lo, hi):
    return sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(lo, hi + 1))


def main():
    rows = []
    for q in QS:
        for f in FACTORS:
            low, high = stretched(q, f)
            rows.append({"q": q["id"], "f": f, "low": low, "high": high, **judge(q, low, high)})
        # A range that sits wholly above the truth and one wholly below it (the miss side of the score).
        t, ref_w = to_scale(q, q["truth"]), to_scale(q, q["ref_high"]) - to_scale(q, q["ref_low"])
        for name, (a, b) in {"above": (t + 0.1 * ref_w, t + 0.6 * ref_w), "below": (t - 0.6 * ref_w, t - 0.1 * ref_w)}.items():
            low, high = from_scale(q, a), from_scale(q, b)
            rows.append({"q": q["id"], "f": name, "low": low, "high": high, **judge(q, low, high)})
    ref_pts = [judge(q, q["ref_low"], q["ref_high"])["points"] for q in QS]
    lo, hi = CFG["gates"]["range_pass_hits"]
    n = CFG["gates"]["range_exam_calls"]
    out = {
        "rows": rows,
        "reference_player": {"n": len(ref_pts), "mean_points": sum(ref_pts) / len(ref_pts),
                             "hit_rate": sum(1 for q in QS if q["ref_low"] <= q["truth"] <= q["ref_high"]) / len(QS)},
        "gate": {"n": n, "pass_hits": [lo, hi], "pass_rate": {str(c): binom(n, c, lo, hi) for c in (0.5, 0.7, 0.8, 0.9, 0.99)}},
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()

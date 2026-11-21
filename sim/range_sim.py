#!/usr/bin/env python3
"""Predict: the range game on the real range bank (design/balance-report.md 4d).

Players are not made up from a bell curve: each says the question's reference interval stretched by a factor f around its middle
(f = 1 is the record's own middle 90%), and is judged on the real questions of the bank with the real rules from data/scoring.json
(the same judge tools/ref_range.py uses). Questions are drawn at random, as the app draws them.

What it answers:
  1. The Unit 3 exam (60 fresh ranges from the exam pool, pass at 50 to 58 hits): who passes, and how often.
  2. The two range patterns on practice (windows of 40 ranges): how often L05 (fewer than 30 hold) and L06 (39 or 40 hold and wider than
     twice the reference) fire on each player, and how often the re-test band (33 to 38 of 40) is met.
  3. Points a range pays, per player, so a better player earns more.

Python 3 standard library only. Usage:  python3 sim/range_sim.py [--runs N] [--json PATH]
"""
import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import ref_range as RR  # noqa: E402

CFG = RR.CFG
GATE = CFG["gates"]
L = CFG["lessons"]["triggers"]
PLAYERS = [("narrow 0.4x", 0.4), ("narrow 0.6x", 0.6), ("narrow 0.8x", 0.8), ("the record 1.0x", 1.0), ("a little wide 1.3x", 1.3), ("wide 2x", 2.0), ("padded 3x", 3.0)]


def judged(q, f):
    low, high = RR.stretched(q, f)
    return RR.judge(q, low, high)


def run(runs, seed):
    rng = random.Random(seed)
    exam = [q for q in RR.QS if q["pool"] == "exam"]
    prac = [q for q in RR.QS if q["pool"] == "practice"]
    lo, hi = GATE["range_pass_hits"]
    out = {}
    for name, f in PLAYERS:
        ej = {q["id"]: judged(q, f) for q in exam}
        pj = {q["id"]: judged(q, f) for q in prac}
        passes = 0
        hits_sum = pts_sum = 0
        for _ in range(runs):
            pick = rng.sample(exam, GATE["range_exam_calls"])
            h = sum(1 for q in pick if ej[q["id"]]["hit"])
            hits_sum += h
            pts_sum += sum(ej[q["id"]]["points"] for q in pick)
            passes += lo <= h <= hi
        l5 = l6 = clear = 0
        for _ in range(runs):
            pick = rng.sample(prac, L["L05"]["window"])
            js = [pj[q["id"]] for q in pick]
            h = sum(1 for j in js if j["hit"])
            ratio = sum(j["ratio"] for j in js) / len(js)
            l5 += h < L["L05"]["min_hits"]
            l6 += h >= L["L06"]["high_hits"] and ratio > L["L06"]["width_ratio"]
            clear += L["L05"]["clear_hits"][0] <= h <= L["L05"]["clear_hits"][1]
        pts_all = [j["points"] for j in ej.values()]
        out[name] = {"f": f, "coverage": sum(1 for j in ej.values() if j["hit"]) / len(ej), "mean_ratio": sum(j["ratio"] for j in ej.values()) / len(ej),
                     "points_per_range": pts_sum / (runs * GATE["range_exam_calls"]), "exam_pass": passes / runs, "mean_hits": hits_sum / runs,
                     "L05_fires": l5 / runs, "L06_fires": l6 / runs, "retest_band": clear / runs}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20000)
    ap.add_argument("--json")
    a = ap.parse_args()
    res = run(a.runs, CFG["sim"]["seed"])
    print(f"{'player':20s} {'holds':>6s} {'width':>6s} {'pts/range':>9s} {'exam pass':>9s} {'L05':>7s} {'L06':>7s} {'re-test band':>12s}")
    for name, r in res.items():
        print(f"{name:20s} {r['coverage']:6.1%} {r['mean_ratio']:5.2f}x {r['points_per_range']:9.1f} {r['exam_pass']:9.1%} {r['L05_fires']:7.1%} {r['L06_fires']:7.1%} {r['retest_band']:12.1%}")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()

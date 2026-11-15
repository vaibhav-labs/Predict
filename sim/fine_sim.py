#!/usr/bin/env python3
"""Predict: the Unit 10 gate and the round-number pattern L14 (design/balance-report.md 5f).

The exam is `gates.fine_exam_calls` fresh calls drawn from the exam half of the tail bank (app/content/questions/tails.json, 480 questions); it is passed when
the player's average confidence is within `gates.fine_index_tolerance` of their hit rate. A simulated player picks the side the bank's base rate favours
(as the practice calls teach) and states the base rate on it plus a bias `shift` (0 = says the record exactly; positive = too sure; negative = too shy), whole
percents between 50 and 99. The hit is the bank's own answer, so the only luck is which questions come up.

L14 fires when more than `min_share` of the last `window` fine calls sit on a multiple of ten. A player rounds each call to the nearest ten with probability r.

Python 3 standard library only. Usage:  python3 sim/fine_sim.py [--runs N] [--json PATH]
"""
import argparse
import json
import math
import os
import random

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8"))
BANK = [q for q in json.load(open(os.path.join(ROOT, "app", "content", "questions", "tails.json"), encoding="utf-8"))["questions"] if q["pool"] == "exam"]
G = CFG["gates"]
T = CFG["lessons"]["triggers"]["L14"]
N, TOL = G["fine_exam_calls"], G["fine_index_tolerance"]
PLAYERS = [("says the record's number (shift 0)", 0.0), ("a point shy (shift -1)", -0.01), ("a point too sure (shift +1)", 0.01), ("three points too sure (shift +3)", 0.03),
           ("mildly overconfident (shift +5)", 0.05), ("typically overconfident (shift +10)", 0.10), ("shy (shift -5)", -0.05)]
ROUND_RATES = [0.0, 0.2, 0.5, 0.8, 0.9, 0.95, 1.0]


def state(base, shift):
    c = max(base, 1 - base)
    return min(0.99, max(0.50, round(c + shift, 2)))


def exam(shift, rng):
    qs = rng.sample(BANK, N)
    conf = hits = 0.0
    for q in qs:
        side_yes = q["base"] >= 0.5
        conf += state(q["base"], shift)
        hits += 1 if side_yes == q["answer"] else 0
    return conf / N - hits / N


def gate_rows(runs, rng):
    out = {}
    for name, shift in PLAYERS:
        gaps = [exam(shift, rng) for _ in range(runs)]
        out[name] = {"pass": sum(abs(g) <= TOL + 1e-9 for g in gaps) / runs, "mean_gap": sum(gaps) / runs, "sd": math.sqrt(sum((g - sum(gaps) / runs) ** 2 for g in gaps) / runs)}
    return out


def l14_rows(runs, rng):
    w, need = T["window"], T["min_share"]
    out = {}
    for r in ROUND_RATES:
        fire = clear = 0
        for _ in range(runs):
            share = sum(rng.random() < r for _ in range(w)) / w
            fire += share > need
            share2 = sum(rng.random() < r * 0.5 for _ in range(T["clear_window"])) / T["clear_window"]
            clear += share2 < T["clear_below"]
        out[str(r)] = {"fires": fire / runs, "retest_clears_if_habit_halves": clear / runs}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=4000)
    ap.add_argument("--json")
    a = ap.parse_args()
    rng = random.Random(1010)
    res = {"gate": gate_rows(a.runs, rng), "l14": l14_rows(a.runs, rng), "bank": len(BANK), "calls": N, "tolerance": TOL}
    print(f"Unit 10 gate: {N} calls from {len(BANK)} exam questions, average confidence within {TOL * 100:.1f} points of the hit rate ({a.runs} runs each)")
    for k, v in res["gate"].items():
        print(f"  {k:42s} pass {v['pass'] * 100:5.1f}%   mean gap {v['mean_gap'] * 100:+.2f}   sd {v['sd'] * 100:.2f}")
    print(f"L14: more than {T['min_share'] * 100:.0f}% of the last {T['window']} on a multiple of ten")
    for k, v in res["l14"].items():
        print(f"  rounds {float(k) * 100:3.0f}% of the time: fires {v['fires'] * 100:5.1f}%   a halved habit clears the re-test {v['retest_clears_if_habit_halves'] * 100:5.1f}%")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()

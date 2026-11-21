#!/usr/bin/env python3
"""Predict: the know-yourself gates (Units 7 to 9) and the memory-drift pattern L12 (design/balance-report.md 5e).

Choice gates. A player "knows" an item with probability s and picks the right option; otherwise they guess uniformly among the options of the item
(2 for act/hold, 4 for the rest, read from the real bank in app/content/questions/know.json). The exam draws the number of items in
data/scoring.json from the exam pool (U7: counter, U8: luck, U9: act, threshold and value in equal parts) and passes at the listed right count.

Memory drift. Each memory check gives a shift (recalled minus recorded, counted positive when it moved toward what happened). A player has a bias b
(how far the outcome rewrites memory, in points on average) and noise sd (points). The Unit 8 exam needs the mean of the last 30 checks within
memory_drift_max of zero; pattern L12 fires when the mean of the last 10 is at least min_shift, and clears when the next 10 sit within clear_within.

Python 3 standard library only. Usage:  python3 sim/know_sim.py [--runs N] [--json PATH]
"""
import argparse
import json
import os
import random

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8"))
BANK = json.load(open(os.path.join(ROOT, "app", "content", "questions", "know.json"), encoding="utf-8"))["questions"]
G, M = CFG["gates"], CFG["memory"]
TRIG = CFG["lessons"]["triggers"]["L12"] if "triggers" in CFG["lessons"] else CFG["lessons"]["L12"]
SKILL = [("guesser (s 0)", 0.0), ("hunch (s 0.3)", 0.3), ("half knows (s 0.5)", 0.5), ("mostly knows (s 0.7)", 0.7), ("sharp (s 0.85)", 0.85), ("expert (s 0.95)", 0.95)]
BIAS = [("honest recall (b 0, sd 4)", 0.0, 4.0), ("slight rewrite (b 2, sd 4)", 2.0, 4.0), ("rewrites a bit (b 4, sd 4)", 4.0, 4.0), ("rewrites often (b 8, sd 4)", 8.0, 4.0),
        ("heavy rewrite (b 12, sd 4)", 12.0, 4.0), ("honest but noisy (b 0, sd 12)", 0.0, 12.0), ("honest, very noisy (b 0, sd 20)", 0.0, 20.0)]


def exam_pool(family):
    return [len(q["options"]) for q in BANK if q["pool"] == "exam" and q["family"] == family]


def draw_options(unit, rng):
    if unit == "U7":
        pool = exam_pool("counter")
        return rng.sample(pool, G["counter_exam_calls"])
    if unit == "U8":
        pool = exam_pool("luck")
        return rng.sample(pool, G["luck_exam_calls"])
    n = G["decision_exam_calls"]
    per = n // 3
    return [k for fam in ("act", "threshold", "value") for k in rng.sample(exam_pool(fam), per)]


def choice_pass(runs, rng):
    need = {"U7": G["counter_pass_right"], "U8": G["luck_pass_right"], "U9": G["decision_pass_right"]}
    out = {}
    for name, s in SKILL:
        row = {}
        for unit in ("U7", "U8", "U9"):
            ok = 0
            tot = 0
            for _ in range(runs):
                opts = draw_options(unit, rng)
                right = sum(1 for k in opts if rng.random() < s or rng.random() < 1.0 / k)
                tot += right
                ok += right >= need[unit]
            row[unit] = {"pass": ok / runs, "mean_right": tot / runs, "of": len(draw_options(unit, rng)), "need": need[unit]}
        out[name] = row
    return out


def memory(runs, rng):
    w, mx = G["memory_window"], G["memory_drift_max"]
    t10, w10, clear = TRIG["min_shift"], TRIG["window"], TRIG["clear_within"]
    out = {}
    for name, b, sd in BIAS:
        gate = fire = clr = 0
        for _ in range(runs):
            last = [rng.gauss(b / 100, sd / 100) for _ in range(w)]
            gate += abs(sum(last) / w) <= mx
            fire += sum(last[-w10:]) / w10 >= t10
            nxt = [rng.gauss(b / 100, sd / 100) for _ in range(TRIG["clear_window"])]
            clr += abs(sum(nxt) / len(nxt)) <= clear
        out[name] = {"b": b, "sd": sd, "gate_pass": gate / runs, "l12_fires": fire / runs, "retest_clears": clr / runs}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20000)
    ap.add_argument("--json")
    a = ap.parse_args()
    rng = random.Random(CFG["sim"]["seed"])
    cp = choice_pass(a.runs, rng)
    mm = memory(a.runs, rng)
    print(f"{'Player':26s} {'U7 pass':>8s} {'U8 pass':>8s} {'U9 pass':>8s}")
    for n, r in cp.items():
        print(f"{n:26s} {r['U7']['pass']:8.1%} {r['U8']['pass']:8.1%} {r['U9']['pass']:8.1%}")
    print(f"\n{'Memory player':32s} {'U8 drift ok':>11s} {'L12 fires':>10s} {'re-test clears':>14s}")
    for n, r in mm.items():
        print(f"{n:32s} {r['gate_pass']:11.1%} {r['l12_fires']:10.1%} {r['retest_clears']:14.1%}")
    if a.json:
        json.dump({"choice": cp, "memory": mm}, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()

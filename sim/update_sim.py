#!/usr/bin/env python3
"""Predict: the updating game (Unit 6) on the real evidence-stream bank (design/balance-report.md 5d).

A player answers each step with  prior + k * (truth - prior) + noise,  clipped to 0..100: k is how much of the move the news deserved that the player
takes (0 never moves, 1 moves exactly as far as the news is worth, 2 moves twice as far), noise is a normal error in points. The exam is 20 whole
streams (40 steps) drawn from the exam pool as the app draws them (two sittings of ten streams); it passes when 32 or more steps land within 7 points
AND the mean gain over staying at the prior is zero or more (gain = |prior - truth| - miss). Points are the real step rule.

What it answers:
  1. Who passes the Unit 6 gate: an anchored player (k small), a calibrated one, an over-reactor, and noise chasers.
  2. How much each half of the gate bites: the within-7 half alone and the gain half alone.
  3. Points a step pays per player.

Python 3 standard library only. Usage:  python3 sim/update_sim.py [--runs N] [--json PATH]
"""
import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import ref_update as RU  # noqa: E402

CFG = RU.CFG
G = CFG["gates"]
U = CFG["problems"]["update"]
PLAYERS = [("never moves (k 0)", 0.0, 0.0), ("barely moves (k 0.3, noise 3)", 0.3, 3.0), ("under-reacts (k 0.6, noise 3)", 0.6, 3.0), ("calibrated, sharp (k 1, noise 3)", 1.0, 3.0),
           ("calibrated, typical (k 1, noise 5)", 1.0, 5.0), ("calibrated, rough (k 1, noise 8)", 1.0, 8.0), ("over-reacts (k 1.6, noise 3)", 1.6, 3.0), ("whiplash (k 2.5, noise 3)", 2.5, 3.0),
           ("noise chaser (k 0, noise 15)", 0.0, 15.0)]


def steps_of(pool):
    out = []
    for q in RU.UPD:
        if q["pool"] == pool:
            out.append([(s["prior"], s["truth"]) for s in q["steps"]])
    return out


def run(runs, seed):
    rng = random.Random(seed)
    exam = steps_of("exam")
    n_streams = G["update_exam_calls"] // 2
    out = {}
    for name, k, noise in PLAYERS:
        passes = within_only = gain_only = pts = 0
        sw = sg = 0.0
        for _ in range(runs):
            pick = rng.sample(exam, n_streams)
            w = 0
            gains = 0.0
            for stream in pick:
                for prior, truth in stream:
                    g = min(100.0, max(0.0, prior + k * (truth - prior) + rng.gauss(0, noise)))
                    miss = abs(g - truth)
                    w += miss <= U["tolerance"]
                    gains += abs(prior - truth) - miss
                    pts += max(U["floor"], round(U["full_points"] * (1 - miss / U["tolerance"])))
            mg = gains / G["update_exam_calls"]
            sw += w
            sg += mg
            ok_w, ok_g = w >= G["update_pass_within"], mg >= G["update_gain_min"]
            passes += ok_w and ok_g
            within_only += ok_w
            gain_only += ok_g
        out[name] = {"k": k, "noise": noise, "mean_within": sw / runs, "mean_gain": sg / runs, "points_per_step": pts / (runs * G["update_exam_calls"]),
                     "exam_pass": passes / runs, "within_half": within_only / runs, "gain_half": gain_only / runs}
    big = [abs(t - p) for s in exam for p, t in s]
    out["_bank"] = {"steps": len(big), "strong_share": sum(1 for d in big if d >= 8) / len(big), "medium_share": sum(1 for d in big if 3 <= d < 8) / len(big), "weak_share": sum(1 for d in big if d < 3) / len(big),
                    "stay_within_7_share": sum(1 for d in big if d <= 7) / len(big)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=4000)
    ap.add_argument("--json")
    a = ap.parse_args()
    res = run(a.runs, CFG["sim"]["seed"])
    print(f"{'Player':36s} {'within of 40':>12s} {'mean gain':>9s} {'pts/step':>8s} {'within half':>11s} {'gain half':>9s} {'exam pass':>9s}")
    for name, r in res.items():
        if name.startswith("_"):
            continue
        print(f"{name:36s} {r['mean_within']:12.1f} {r['mean_gain']:+9.1f} {r['points_per_step']:8.1f} {r['within_half']:11.1%} {r['gain_half']:9.1%} {r['exam_pass']:9.1%}")
    b = res["_bank"]
    print(f"\nExam bank: {b['steps']} steps; news worth 8 or more points on {b['strong_share']:.0%}, 3 to 8 on {b['medium_share']:.0%}, under 3 on {b['weak_share']:.0%}; staying at the prior is already within 7 on {b['stay_within_7_share']:.0%}.")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()

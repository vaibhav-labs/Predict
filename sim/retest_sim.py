#!/usr/bin/env python3
"""Predict: re-test pass rates (design/balance-report.md 4c).

A pattern flag clears after two re-tests. L01 and L02 re-tests look at the next clear_window calls inside the band after a
waiting period and pass when the gap is within clear_gap (L01: 40 calls, 7 points; L02: 60 calls, 7 points). This sim asks
what each kind of player does to that rule, and what the two-stage structure costs a player who really did fix the habit.

Players: fixed (stated confidence equals the true chance), partly_fixed (half the old bias left), unchanged (the old bias).
The old biases are the ones the L01 and L02 sims called typical. Python 3 standard library only.
Usage:  python3 sim/retest_sim.py [--runs N]
"""
import argparse
import math
import random

CLEAR = {"L01": (40, 0.07), "L02": (60, 0.07)}


def player_gap(kind, bias):
    return {"fixed": 0.0, "partly_fixed": bias / 2, "unchanged": bias}[kind]


def retest_pass(rng, window, clear_gap, true_p, gap):
    """Stated confidence = true chance + gap (overconfident gap > 0, underconfident gap < 0 means stated below the chance)."""
    hits = sum(1 for _ in range(window) if rng.random() < true_p)
    stated = true_p + gap
    return abs(stated - hits / window) <= clear_gap + 1e-12


def run(runs, seed):
    rng = random.Random(seed)
    out = []
    cases = [("L01", 0.95, 0.12), ("L02", 0.70, -0.14)]  # typical band centre and the typical old bias
    for trig, centre, bias in cases:
        w, g = CLEAR[trig]
        for kind in ("fixed", "partly_fixed", "unchanged"):
            gap = player_gap(kind, bias)
            true_p = centre - gap  # the stated number is the true chance plus the gap
            p1 = sum(retest_pass(rng, w, g, true_p, gap) for _ in range(runs)) / runs
            both = sum(retest_pass(rng, w, g, true_p, gap) and retest_pass(rng, w, g, true_p, gap) for _ in range(runs)) / runs
            # the flag clears for good only if both pass; three failed rounds escalate
            clear_in_3 = 0
            for _ in range(runs):
                for _round in range(3):
                    if retest_pass(rng, w, g, true_p, gap) and retest_pass(rng, w, g, true_p, gap):
                        clear_in_3 += 1
                        break
            out.append((trig, kind, w, g, p1, both, clear_in_3 / runs))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20000)
    a = ap.parse_args()
    rows = run(a.runs, 20261115)
    print("| Trigger | Player after the drill | Window | Pass gap | Passes re-test 1 | Passes both re-tests | Clears within 3 rounds |")
    print("|---|---|---|---|---|---|---|")
    for t, k, w, g, p1, both, c3 in rows:
        print(f"| {t} | {k.replace('_', ' ')} | {w} calls | {int(g * 100)} points | {p1 * 100:.1f}% | {both * 100:.1f}% | {c3 * 100:.1f}% |")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Predict: the Fermi and base-rate games on the real banks (design/balance-report.md 5c).

Fermi players guess every part with a log-normal error (natural-log sd `sd`) and state a range of factor f around the guess; the worksheet
combines the parts (log space, centres add, half-widths in quadrature) and the whole is judged against its truth and reference interval with
the real rules of data/scoring.json. A calibrated player states f = exp(1.645 sd). Rate players answer the truth plus noise with standard deviation sd points (clipped
to 0..100) and a lean. Exams are drawn from the exam pools as the app draws them.

What it answers:
  1. The Unit 4 exam (20 Fermi problems from the exam pool: 16 or more hold AND median miss <= 3): who passes.
  2. The Unit 5 exam (40 rate problems from the exam pool: 32 or more within 7): who passes.
  3. Points a problem pays per player.

Python 3 standard library only. Usage:  python3 sim/problem_sim.py [--runs N] [--json PATH]
"""
import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import ref_problem as RP  # noqa: E402

CFG = RP.CFG
G = CFG["gates"]
R = CFG["problems"]["rate"]
FERMI_PLAYERS = [("precise, calibrated (error sd 0.2)", 0.2, math.exp(1.645 * 0.2)), ("typical, calibrated (error sd 0.4)", 0.4, math.exp(1.645 * 0.4)),
                 ("typical, overconfident (sd 0.4, says 1.3x)", 0.4, 1.3), ("rough, overconfident (sd 0.7, says 1.5x)", 0.7, 1.5),
                 ("typical, humble (sd 0.4, says 3x)", 0.4, 3.0), ("rough, calibrated (sd 0.7)", 0.7, math.exp(1.645 * 0.7))]
RATE_PLAYERS = [("knows the record (sd 3)", 3.0, 0.0), ("close (sd 5)", 5.0, 0.0), ("rough (sd 8)", 8.0, 0.0), ("rough, leans high (sd 8, +6)", 8.0, 6.0), ("anchored (sd 15)", 15.0, 0.0)]


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def fermi_judge(q, sd, f, rng):
    """Each part's centre is its truth times a log-normal error (natural-log sd `sd`); the player states a range of factor f around that centre."""
    parts = []
    for p in q["parts"]:
        c = p["truth"] * math.exp(rng.gauss(0, sd))
        parts.append((c / f, c * f))
    lo, hi = RP.combine(parts, q["mult"])
    return RP.judge(q, lo, hi)


def run(runs, seed):
    rng = random.Random(seed)
    fexam = [q for q in RP.FERMI if q["pool"] == "exam"]
    rexam = [q for q in RP.RATES if q["type"] == "rate" and q["pool"] == "exam"]
    out = {"fermi": {}, "rate": {}}
    for name, sd, f in FERMI_PLAYERS:
        passes = hits = pts = 0
        meds = []
        for _ in range(runs):
            pick = rng.sample(fexam, G["fermi_exam_calls"])
            js = [fermi_judge(q, sd, f, rng) for q in pick]
            h = sum(1 for j in js if j["hit"])
            m = median([j["miss"] for j in js])
            hits += h
            pts += sum(j["points"] for j in js)
            meds.append(m)
            passes += h >= G["fermi_pass_hits"] and m <= G["fermi_median_factor"]
        out["fermi"][name] = {"sd": sd, "f": f, "mean_hits": hits / runs, "median_miss": median(meds), "points_per_problem": pts / (runs * G["fermi_exam_calls"]), "exam_pass": passes / runs}
    for name, sd, lean in RATE_PLAYERS:
        passes = within = pts = 0
        for _ in range(runs):
            pick = rng.sample(rexam, G["rate_exam_calls"])
            n_within = 0
            for q in pick:
                g = min(100.0, max(0.0, q["truth"] + lean + rng.gauss(0, sd)))
                miss = abs(g - q["truth"])
                n_within += miss <= R["tolerance"]
                pts += max(R["floor"], round(R["full_points"] * (1 - miss / R["tolerance"])))
            within += n_within
            passes += n_within >= G["rate_pass_within"]
        out["rate"][name] = {"sd": sd, "lean": lean, "mean_within": within / runs, "points_per_problem": pts / (runs * G["rate_exam_calls"]), "exam_pass": passes / runs}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=4000)
    ap.add_argument("--json")
    a = ap.parse_args()
    res = run(a.runs, CFG["sim"]["seed"])
    print(f"{'Fermi player':34s} {'hits of 20':>10s} {'median miss':>11s} {'pts/problem':>11s} {'exam pass':>9s}")
    for name, r in res["fermi"].items():
        print(f"{name:34s} {r['mean_hits']:10.1f} {r['median_miss']:10.2f}x {r['points_per_problem']:11.1f} {r['exam_pass']:9.1%}")
    print(f"\n{'Rate player':34s} {'within of 40':>12s} {'pts/problem':>11s} {'exam pass':>9s}")
    for name, r in res["rate"].items():
        print(f"{name:34s} {r['mean_within']:12.1f} {r['points_per_problem']:11.1f} {r['exam_pass']:9.1%}")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()

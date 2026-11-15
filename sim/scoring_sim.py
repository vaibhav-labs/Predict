#!/usr/bin/env python3
"""Predict: scoring-rule simulator (project-specific, Python standard library only).

Answers six design questions with numbers. Every tunable comes from data/scoring.json.

  A. What does each rule pay for a hit and a miss at each stated confidence?
  B. Honesty test: which reporting policy earns the most under each rule?
  C. Luck vs skill: on the same questions, how often does a worse policy outscore honesty?
  D. Gates and triggers: how well does the calibration gate separate calibrated from
     overconfident players, and how fast does the top-band lesson trigger fire?
  E. Ranges: does the interval score stop "just go wide" and "just go narrow"?
  F. Journal farming: does edge scoring remove the "predict sure things" exploit?

Usage
  python3 sim/scoring_sim.py                                  # print the report
  python3 sim/scoring_sim.py --json sim/out/scoring_results.json
"""
import argparse
import json
import math
import os
import random
import statistics
from itertools import accumulate
from math import log2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json")))
B, SIM, GATES = CFG["binary"], CFG["sim"], CFG["gates"]
LO, HI = B["min_confidence"], B["max_confidence"]
RULES = {n: eval("lambda p: " + e, {"__builtins__": {}, "log2": log2}) for n, e in B["rules"].items()}
CORE, SHARP = B["core_rule"], B["sharp_rule"]
LEVELS = B["dial_steps"]


def clip(c):
    return min(HI, max(LO, c))


def logit(x):
    return math.log(x / (1.0 - x))


def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-z))


def conf(policy, q, rng):
    """Stated confidence for a player whose true chance of being right is q."""
    t = policy["type"]
    if t == "logit_scale":
        return clip(sigmoid(policy["factor"] * logit(q)))
    if t == "constant":
        return clip(policy["value"])
    if t == "round":
        s = policy["step"]
        return clip(math.floor(q / s + 0.5) * s)
    if t == "snap":
        return clip(min(policy["values"], key=lambda v: abs(v - q)))
    if t == "logit_noise":
        return clip(sigmoid(logit(q) + rng.gauss(0.0, policy["sd"])))
    raise ValueError(t)


def draw_q(mix, rng):
    """True chance that the player's preferred answer is right (their real knowledge)."""
    if mix["type"] == "uniform":
        q = rng.uniform(mix["lo"], mix["hi"])
    else:
        q = 0.5 + 0.5 * rng.betavariate(mix["a"], mix["b"])
    return min(0.995, max(0.5, q))


# ---------------------------------------------------------------- A. payout table
def part_a():
    rows = []
    for c in LEVELS:
        row = {"confidence": c}
        for r, f in RULES.items():
            row[r + "_hit"] = f(c)
            row[r + "_miss"] = f(1 - c)
        rows.append(row)
    curves = {}
    for truth in (0.70, 0.90):
        curves[str(truth)] = {
            r: [{"stated": c, "expected": truth * f(c) + (1 - truth) * f(1 - c)} for c in LEVELS]
            for r, f in RULES.items()
        }
    return {"payouts": rows, "honesty_curves": curves}


# ---------------------------------------------------------------- B. honesty test
def part_b(rng):
    out = {}
    for mname, mix in SIM["question_mixes"].items():
        qs = [draw_q(mix, rng) for _ in range(SIM["draws"])]
        acc = sum(qs) / len(qs)
        table = {}
        for pname, pol in SIM["policies"].items():
            cs = [conf(pol, q, rng) for q in qs]
            row = {"mean_stated": sum(cs) / len(cs), "true_accuracy": acc}
            for rname, f in RULES.items():
                row[rname] = sum(q * f(c) + (1 - q) * f(1 - c) for q, c in zip(qs, cs)) / len(qs)
            table[pname] = row
        out[mname] = table
    return out


# ---------------------------------------------------------------- C + D. luck vs skill, gates
def band_of(c):
    return min(4, int((c - 0.5) * 10 + 1e-9))


def part_cd(rng):
    mix = SIM["question_mixes"]["mixed"]
    pols = ["honest", "mild_overconfident", "overconfident", "underconfident", "always_99", "round_to_10"]
    sizes, gsizes, tols = SIM["session_sizes"], SIM["gate_sizes"], SIM["gate_tolerances"]
    max_n = max(sizes + gsizes)
    S = SIM["sessions"]
    rules = (CORE, SHARP)
    beat = {r: {n: {p: 0 for p in pols} for n in sizes} for r in rules}
    neg = {r: {n: 0 for n in sizes} for r in rules}
    honest_tot = {r: {n: [] for n in sizes} for r in rules}
    zopts = SIM["band_z_options"]
    idx_pass = {p: {n: {t: 0 for t in tols} for n in gsizes} for p in pols}
    comp_pass = {p: {n: {z: 0 for z in zopts} for n in gsizes} for p in pols}
    tol0, bmin = GATES["calibration_index_tolerance"], GATES["band_min_items"]
    for _ in range(S):
        qs = [draw_q(mix, rng) for _ in range(max_n)]
        hits = [1 if rng.random() < q else 0 for q in qs]
        cum_h = list(accumulate(hits))
        per = {}
        for p in pols:
            pol = SIM["policies"][p]
            cs = [conf(pol, q, rng) for q in qs]
            pts = [c if h else 1.0 - c for c, h in zip(cs, hits)]
            per[p] = {
                "cs": cs,
                "cum_c": list(accumulate(cs)),
                **{r: list(accumulate(RULES[r](x) for x in pts)) for r in rules},
            }
        for r in rules:
            for n in sizes:
                h_tot = per["honest"][r][n - 1]
                honest_tot[r][n].append(h_tot)
                if h_tot < 0:
                    neg[r][n] += 1
                for p in pols:
                    if p != "honest" and per[p][r][n - 1] > h_tot:
                        beat[r][n][p] += 1
        for p in pols:
            cs = per[p]["cs"]
            for n in gsizes:
                index = (per[p]["cum_c"][n - 1] - cum_h[n - 1]) / n
                for t in tols:
                    if abs(index) <= t + 1e-12:
                        idx_pass[p][n][t] += 1
                bands = [[0, 0.0, 0] for _ in range(5)]
                for i in range(n):
                    b = bands[band_of(cs[i])]
                    b[0] += 1
                    b[1] += cs[i]
                    b[2] += hits[i]
                worst_z = 0.0
                for b in bands:
                    if b[0] >= bmin:
                        m = b[1] / b[0]                      # mean stated confidence in the band
                        se = math.sqrt(m * (1 - m) / b[0])    # its sampling error if the player is calibrated
                        worst_z = max(worst_z, abs(b[2] / b[0] - m) / se)
                if abs(index) <= tol0 + 1e-12:
                    for z in zopts:
                        if worst_z <= z:
                            comp_pass[p][n][z] += 1
    c_out = {}
    for r in rules:
        c_out[r] = {}
        for n in sizes:
            ht = honest_tot[r][n]
            c_out[r][n] = {
                "honest_mean_per_q": statistics.mean(ht) / n,
                "honest_session_sd": statistics.pstdev(ht),
                "honest_negative_session": neg[r][n] / S,
                "outscored_by": {p: beat[r][n][p] / S for p in pols if p != "honest"},
            }
    d_out = {
        "index_gate": {p: {n: {str(t): idx_pass[p][n][t] / S for t in tols} for n in gsizes} for p in pols},
        "composite_gate": {p: {n: {str(z): comp_pass[p][n][z] / S for z in zopts} for n in gsizes} for p in pols},
        "composite_definition": f"|mean stated - hit rate| <= {tol0} overall AND no band with >= {bmin} items "
                                f"further than z standard errors from its stated confidence",
    }
    return c_out, d_out


def part_d_trigger(rng):
    """Lesson trigger 1: in the 90-99 band, mean stated minus hit rate >= gap over the last W calls."""
    mix = SIM["question_mixes"]["mixed"]
    horizon, S = 150, 3000
    windows, gaps = [20, 30, 40], [0.06, 0.08, 0.10]
    out = {}
    for p in ("honest", "mild_overconfident", "overconfident"):
        pol = SIM["policies"][p]
        fired = {(w, g): [] for w in windows for g in gaps}
        for _ in range(S):
            cs, hs = [], []
            while len(cs) < horizon:
                q = draw_q(mix, rng)
                c = conf(pol, q, rng)
                if c >= 0.90:
                    cs.append(c)
                    hs.append(1 if rng.random() < q else 0)
            cc, ch = [0.0] + list(accumulate(cs)), [0] + list(accumulate(hs))
            for w in windows:
                for g in gaps:
                    first = None
                    for k in range(w, horizon + 1):
                        if ((cc[k] - cc[k - w]) - (ch[k] - ch[k - w])) / w >= g - 1e-12:
                            first = k
                            break
                    fired[(w, g)].append(first)
        out[p] = {}
        for (w, g), xs in fired.items():
            hit = [x for x in xs if x is not None]
            out[p][f"W{w}_gap{int(g * 100)}"] = {
                "fires_within_150": len(hit) / S,
                "median_calls_to_fire": statistics.median(hit) if hit else None,
            }
    return out


# ---------------------------------------------------------------- E. ranges
def phi(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def Phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def winkler(a, mult):
    """Expected interval score when the truth is N(0,1) around your best guess and you say [-a, +a]."""
    return 2 * a + mult * 2 * (phi(a) - a * (1 - Phi(a)))


def part_e():
    mult = CFG["interval"]["miss_multiplier"]
    pols = {
        "honest_90": 1.645, "narrow_70": 1.036, "narrow_50": 0.674,
        "wide_99": 2.576, "absurdly_wide": 5.0,
    }
    best_a = min((winkler(a / 1000, mult), a / 1000) for a in range(200, 6001))[1]
    rows = {}
    base = winkler(pols["honest_90"], mult)
    for name, a in pols.items():
        s = winkler(a, mult)
        rows[name] = {
            "half_width_sd": a, "true_coverage": 2 * Phi(a) - 1,
            "naive_hit_points": 2 * Phi(a) - 1, "interval_score": s, "vs_honest": s / base,
        }
    return {"policies": rows, "optimal_half_width_sd": best_a, "optimal_coverage": 2 * Phi(best_a) - 1}


def binom_range(n, p, lo, hi):
    return sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(lo, hi + 1))


def part_g():
    """Range gate: exact chance of passing a 90%-range exam by true coverage."""
    out = {}
    for n, (lo, hi) in {40: (33, 38), 60: (50, 58), 80: (66, 77)}.items():
        out[n] = {"pass_hits": [lo, hi],
                  "pass_rate_by_true_coverage": {str(c): binom_range(n, c, lo, hi) for c in (0.50, 0.70, 0.80, 0.90, 0.99)}}
    return out


# ---------------------------------------------------------------- F. journal farming
def part_f(rng):
    f = RULES[CORE]
    N = 100000

    def ev(p, s):
        return p * f(s) + (1 - p) * f(1 - s)

    cl = lambda x: min(0.99, max(0.01, x))
    acc = {k: [0.0, 0.0] for k in ("farmer_sure_things", "real_forecaster", "real_but_overconfident",
                                   "baseline_copier", "fake_insight")}
    for _ in range(N):
        b = rng.uniform(0.15, 0.85)
        p = cl(sigmoid(logit(b) + rng.gauss(0, 1.0)))       # what private information reveals
        says = {
            "real_forecaster": p,
            "real_but_overconfident": cl(sigmoid(1.6 * logit(p))),
            "baseline_copier": b,
            "fake_insight": cl(sigmoid(logit(b) + rng.gauss(0, 1.0))),   # moves off baseline for no reason
        }
        for k, s in says.items():
            acc[k][0] += ev(p, s)
            acc[k][1] += ev(p, s) - ev(p, b)
        acc["farmer_sure_things"][0] += ev(0.97, 0.97)
        acc["farmer_sure_things"][1] += 0.0                 # baseline is also 0.97
    return {k: {"raw_points": v[0] / N, "edge_points": v[1] / N} for k, v in acc.items()}


# ---------------------------------------------------------------- report
def fmt(x, d=1):
    return f"{x:+.{d}f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json")
    a = ap.parse_args()
    rng = random.Random(SIM["seed"])
    A = part_a()
    Bres = part_b(rng)
    C, D = part_cd(rng)
    T = part_d_trigger(rng)
    E = part_e()
    F = part_f(rng)

    print("PREDICT scoring simulation  (seed %d)\n" % SIM["seed"])
    print("A. Points for a hit / a miss at each stated confidence")
    print(f"{'conf':>5} | {'naive hit':>9} {'miss':>6} | {'core hit':>8} {'miss':>6} | {'sharp hit':>9} {'miss':>6}")
    for r in A["payouts"]:
        print(f"{r['confidence']*100:>4.0f}% | {r['naive_linear_hit']:>+9.0f} {r['naive_linear_miss']:>+6.0f} | "
              f"{r[CORE+'_hit']:>+8.0f} {r[CORE+'_miss']:>+6.0f} | {r[SHARP+'_hit']:>+9.0f} {r[SHARP+'_miss']:>+6.0f}")
    print("\n   Expected points per call by what you SAY, when you are truly right 70% of the time:")
    print("   said: " + " ".join(f"{int(c*100):>5}" for c in LEVELS))
    for r in RULES:
        print(f"   {r[:6]:>6}" + " ".join(f"{x['expected']:>5.0f}" for x in A["honesty_curves"]["0.7"][r]))

    print("\nB. Honesty test: expected points per question (mixed-difficulty questions)")
    print(f"{'policy':<20} {'says':>6} {'right':>6} | {'naive':>7} {'core':>7} {'sharp':>8}")
    for p, row in Bres["mixed"].items():
        print(f"{p:<20} {row['mean_stated']*100:>5.1f}% {row['true_accuracy']*100:>5.1f}% | "
              f"{row['naive_linear']:>+7.1f} {row[CORE]:>+7.1f} {row[SHARP]:>+8.1f}")
    for r in RULES:
        best = max(Bres["mixed"], key=lambda p: Bres["mixed"][p][r])
        print(f"   best under {r}: {best}")
    for m in ("hard", "easy"):
        bests = {r: max(Bres[m], key=lambda p: Bres[m][p][r]) for r in RULES}
        print(f"   {m} questions -> best policy: " + ", ".join(f"{r}={b}" for r, b in bests.items())
              + f"; honest core pts/q {Bres[m]['honest'][CORE]:+.1f}, overconfident {Bres[m]['overconfident'][CORE]:+.1f}")

    print("\nC. Luck vs skill on the SAME questions (share of sessions where the policy outscores honest)")
    for r in (CORE, SHARP):
        print(f"  rule: {r}")
        print(f"  {'n':>4} {'honest pts/q':>12} {'sd/session':>10} {'honest<0':>9} | {'mild_over':>9} {'overconf':>9} {'under':>7} {'always99':>9} {'round10':>8}")
        for n, x in C[r].items():
            o = x["outscored_by"]
            print(f"  {n:>4} {x['honest_mean_per_q']:>12.1f} {x['honest_session_sd']:>10.0f} {x['honest_negative_session']*100:>8.1f}% | "
                  f"{o['mild_overconfident']*100:>8.1f}% {o['overconfident']*100:>8.1f}% {o['underconfident']*100:>6.1f}% "
                  f"{o['always_99']*100:>8.1f}% {o['round_to_10']*100:>7.1f}%")

    print("\nD. Calibration gate pass rates")
    print("  index gate only: |mean stated - hit rate| <= tolerance")
    print(f"  {'policy':<20} {'n':>4} " + " ".join(f"tol {t:>4}" for t in SIM['gate_tolerances']))
    for p in ("honest", "mild_overconfident", "overconfident", "underconfident"):
        for n in SIM["gate_sizes"]:
            print(f"  {p:<20} {n:>4} " + " ".join(f"{D['index_gate'][p][n][str(t)]*100:>7.1f}%" for t in SIM["gate_tolerances"]))
    print("  composite gate: " + D["composite_definition"])
    for z in SIM["band_z_options"]:
        print(f"  z = {z}")
        print(f"  {'policy':<20} " + " ".join(f"n={n:<4}" for n in SIM["gate_sizes"]))
        for p in ("honest", "mild_overconfident", "overconfident", "underconfident", "always_99", "round_to_10"):
            print(f"  {p:<20} " + " ".join(f"{D['composite_gate'][p][n][str(z)]*100:>5.1f}%" for n in SIM["gate_sizes"]))
    print("\n  Top-band lesson trigger (stated 90-99): fires when mean stated - hit rate >= gap over last W calls")
    print(f"  {'setting':<12} | {'honest fires':>12} | {'mild fires':>10} {'median':>7} | {'overconf fires':>14} {'median':>7}")
    for key in T["honest"]:
        h, m, o = T["honest"][key], T["mild_overconfident"][key], T["overconfident"][key]
        print(f"  {key:<12} | {h['fires_within_150']*100:>11.1f}% | {m['fires_within_150']*100:>9.1f}% {str(m['median_calls_to_fire']):>7} | "
              f"{o['fires_within_150']*100:>13.1f}% {str(o['median_calls_to_fire']):>7}")

    print("\nE. Ranges: expected interval score (lower is better), truth ~ N(0,1) around your best guess")
    print(f"  {'policy':<14} {'true cover':>10} {'naive pts':>9} {'interval score':>14} {'vs honest':>9}")
    for n, x in E["policies"].items():
        print(f"  {n:<14} {x['true_coverage']*100:>9.1f}% {x['naive_hit_points']:>9.2f} {x['interval_score']:>14.2f} {x['vs_honest']:>8.2f}x")
    print(f"  score-minimising half-width: {E['optimal_half_width_sd']:.3f} sd = {E['optimal_coverage']*100:.1f}% coverage")

    Gres = part_g()
    print("\nG. Range gate: chance of passing a 90%-range exam, by the player's true coverage (exact binomial)")
    print(f"  {'exam':<22} " + " ".join(f"{c:>6}" for c in ("50%", "70%", "80%", "90%", "99%")))
    for n, x in Gres.items():
        r = x["pass_rate_by_true_coverage"]
        print(f"  {str(n)+' ranges, hits '+str(x['pass_hits'][0])+'-'+str(x['pass_hits'][1]):<22} "
              + " ".join(f"{r[c]*100:>5.1f}%" for c in ("0.5", "0.7", "0.8", "0.9", "0.99")))

    print("\nF. Journal farming: raw points vs edge points per call (core rule)")
    print(f"  {'profile':<24} {'raw':>7} {'edge':>7}")
    for k, x in F.items():
        print(f"  {k:<24} {x['raw_points']:>+7.1f} {x['edge_points']:>+7.1f}")

    if a.json:
        os.makedirs(os.path.dirname(a.json), exist_ok=True)
        json.dump({"A": A, "B": Bres, "C": C, "D": D, "D_trigger": T, "E": E, "F": F, "G": Gres}, open(a.json, "w"), indent=1)
        print(f"\nWrote {a.json}")


if __name__ == "__main__":
    main()

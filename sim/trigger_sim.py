#!/usr/bin/env python3
"""Predict: lesson-trigger simulator for L02 (underconfident), the trigger whose threshold the plan left OPEN (value 5).

Same method as scoring_sim.py part D (which sized L01): 3,000 runs of 150 calls stated inside the trigger's band, the trigger
checked after every call, for a calibrated player, a mildly underconfident one and a typical underconfident one. The
policies and the question mix come from data/scoring.json, so this file shares the sim's definitions.

Usage:   python3 sim/trigger_sim.py                       print the table
         python3 sim/trigger_sim.py --json sim/out/trigger_results.json
Python 3 standard library only.
"""
import argparse
import json
import os
import random
import statistics
import sys
from itertools import accumulate

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring_sim as S  # noqa: E402  (the policies, the question mix and the draw of a player's real chance)

SIM, CFG = S.SIM, S.CFG
BAND = tuple(CFG["lessons"]["triggers"]["L02"]["band"])
LOOK_EVERY = 7  # a session ends about every 7 mid-band calls (18 calls a session, roughly 4 in 10 of them in the 60-80% band)
POLICIES = {
    "honest": SIM["policies"]["honest"],
    "mild_underconfident": {"type": "logit_scale", "factor": 0.7},
    "underconfident": SIM["policies"]["underconfident"],
}


def run(rng, runs=3000, horizon=150):
    mix = SIM["question_mixes"]["mixed"]
    windows, gaps = [60, 80, 100, 120], [0.08, 0.10, 0.12]
    looks = {"every_call": 1, "session_end": LOOK_EVERY}
    out = {}
    for name, pol in POLICIES.items():
        fired = {(w, g, lk): [] for w in windows for g in gaps for lk in looks}
        for _ in range(runs):
            cs, hs = [], []
            while len(cs) < horizon:
                q = S.draw_q(mix, rng)
                c = S.conf(pol, q, rng)
                if BAND[0] - 1e-9 <= c <= BAND[1] + 1e-9:
                    cs.append(c)
                    hs.append(1 if rng.random() < q else 0)
            cc, ch = [0.0] + list(accumulate(cs)), [0] + list(accumulate(hs))
            for w in windows:
                for g in gaps:
                    for lk, every in looks.items():
                        first = None
                        for k in range(w, horizon + 1):
                            if k % every:
                                continue
                            # underconfident: the hit rate is above the stated confidence by the gap or more
                            if ((ch[k] - ch[k - w]) - (cc[k] - cc[k - w])) / w >= g - 1e-12:
                                first = k
                                break
                        fired[(w, g, lk)].append(first)
        out[name] = {}
        for (w, g, lk), xs in fired.items():
            hit = [x for x in xs if x is not None]
            out[name][f"W{w}_gap{int(g * 100)}_{lk}"] = {"fires_within_150": len(hit) / runs, "median_calls_to_fire": statistics.median(hit) if hit else None}
    return out


def table(res, looks=("every_call", "session_end")):
    rows = ["| Window and gap | Looked at | False alarm on a calibrated player | Fires on mild underconfidence | median calls | Fires on typical underconfidence | median calls |", "|---|---|---|---|---|---|---|"]
    for key in res["honest"]:
        w, g, lk = key.split("_", 2)
        m, u = res["mild_underconfident"][key], res["underconfident"][key]
        label = "after every call" if lk == "every_call" else f"every {LOOK_EVERY} calls (session end)"
        rows.append(f"| {w[1:]} calls, {g[3:]} points | {label} | {res['honest'][key]['fires_within_150'] * 100:.1f}% | {m['fires_within_150'] * 100:.1f}% | {m['median_calls_to_fire']} | {u['fires_within_150'] * 100:.1f}% | {u['median_calls_to_fire']} |")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--runs", type=int, default=3000)
    args = ap.parse_args()
    rng = random.Random(SIM["seed"] + 2)
    res = run(rng, args.runs)
    print(table(res))
    if args.json:
        os.makedirs(os.path.dirname(args.json), exist_ok=True)
        with open(args.json, "w") as f:
            json.dump({"L02": res, "band": list(BAND), "runs": args.runs}, f, indent=1)


if __name__ == "__main__":
    main()

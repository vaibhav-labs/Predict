#!/usr/bin/env python3
"""An independent recomputation of every number the Mirror shows, straight from the raw event log.

Block 3's exit test (data/build_blocks.csv, BL3): "every statistic matches an independent recomputation from the raw history".
This file is that recomputation. It shares no code with the app: the Wilson interval is solved as a quadratic here (the app
uses the closed form), the streak and the level are walked with plain loops, and the groups are built with dictionaries.
The rules it follows are written in design/mechanics.md (4.3, 4.6, 4.10) and data/scoring.json.

    python3 tools/ref_mirror.py record.jsonl 2026-11-30      prints the numbers as JSON
"""
import datetime
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8"))


def read(path):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            e = json.loads(line)
            if e.get("type") != "header":
                out.append(e)
    return sorted(out, key=lambda e: (e["t"], e["id"]))


def day_plus(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def wilson(k, n, z):
    """The Wilson interval solved as a quadratic in the true rate: (1 + z^2/n) r^2 - (2p + z^2/n) r + p^2 = 0."""
    if n == 0:
        return None, None
    p, a = k / n, z * z / n
    root = math.sqrt(a * (4 * p * (1 - p) + a))
    lo, hi = ((2 * p + a) - root) / (2 * (1 + a)), ((2 * p + a) + root) / (2 * (1 + a))
    return max(0.0, lo), min(1.0, hi)


def describe(key, rows, z, thin_below):
    """rows: list of (confidence, hit, points)."""
    n = len(rows)
    if n == 0:
        return dict(key=key, n=0, hits=0, hit_rate=None, mean_conf=None, gap=None, points=0, avg_points=None, ci_lo=None, ci_hi=None, gap_lo=None, gap_hi=None, thin=True, verdict="too few")
    hits = sum(1 for r in rows if r[1])
    mc = sum(r[0] for r in rows) / n
    lo, hi = wilson(hits, n, z)
    pts = sum(r[2] for r in rows)
    thin = n < thin_below
    gap_lo, gap_hi = mc - hi, mc - lo
    verdict = "too few" if thin else "too sure" if gap_lo > 0 else "too shy" if gap_hi < 0 else "no clear bias"
    return dict(key=key, n=n, hits=hits, hit_rate=hits / n, mean_conf=mc, gap=mc - hits / n, points=pts, avg_points=pts / n,
                ci_lo=lo, ci_hi=hi, gap_lo=gap_lo, gap_hi=gap_hi, thin=thin, verdict=verdict)


def split(rows, keyfn, z, thin_below):
    buckets = {}
    for r in rows:
        buckets.setdefault(keyfn(r), []).append(r)
    out = [describe(k, v, z, thin_below) for k, v in buckets.items()]
    return sorted(out, key=lambda g: (-g["n"], str(g["key"])))


def bands(rows, edges, z, thin_below):
    out = []
    for i in range(len(edges) - 1):
        lo, hi, last = edges[i], edges[i + 1], i == len(edges) - 2
        inside = [r for r in rows if r[0] >= lo - 1e-9 and (r[0] <= hi + 1e-9 if last else r[0] < hi - 1e-9)]
        d = describe(i, inside, z, thin_below)
        d.update(lo=lo, hi=hi)
        out.append(d)
    return out


def level_cost(L, lv):
    return round(lv["base"] * L ** lv["exp"])


def level_info(points, lv):
    level, floor = 1, 0
    while floor + level_cost(level, lv) <= points:
        floor += level_cost(level, lv)
        level += 1
    cost = level_cost(level, lv)
    return dict(level=level, floor=floor, cost=cost, into=points - floor, to_next=cost - (points - floor))


def reference(events, today, cfg=CFG):
    mir, jc, hab = cfg["mirror"], cfg["journal"], cfg["habit"]
    z, thin_below, edges = mir["error_bar_z"], mir["thin_below"], mir["band_edges"]

    # ---- gym ----
    calls = [e for e in events if e["type"] == "call"]
    gym_rows = [(e["c"], e["hit"], e["points"]) for e in calls]
    gym = describe("gym", gym_rows, z, thin_below)
    topics = split([(e["c"], e["hit"], e["points"], e["domain"]) for e in calls], lambda r: r[3], z, thin_below)

    # ---- journal: resolved cards that count ----
    resolves = {e["prediction"]: e for e in events if e["type"] == "resolve"}
    preds = [e for e in events if e["type"] == "prediction"]
    done = [(p, resolves[p["id"]]) for p in preds if p["id"] in resolves]
    lo_t, hi_t = jc["trivial_band"]

    def counts(p, r):
        return r["outcome"] != "void" and p["scored"] is True and not (p["b"] < lo_t or p["b"] > hi_t) and "self_controlled" not in p.get("flags", [])

    kept = [(p, r) for p, r in done if counts(p, r)]
    jrows = []
    for p, r in kept:
        side_yes = p["c"] >= 0.5
        c = p["c"] if side_yes else 1 - p["c"]
        hit = side_yes == (r["outcome"] == "yes")
        jrows.append((c, hit, r["edge"], p["domain"], p["horizon"]))
    grid = {}
    for c, hit, edge, d, h in jrows:
        cell = grid.setdefault(d, {}).setdefault(h, {"n": 0, "edge": 0})
        cell["n"] += 1
        cell["edge"] += edge
    jsum = describe("journal", [(c, h, e) for c, h, e, _, _ in jrows], z, thin_below)
    journal = dict(
        resolved=len(done), voided=sum(1 for _, r in done if r["outcome"] == "void"),
        unscored=sum(1 for p, r in done if r["outcome"] != "void" and not p["scored"]),
        kept_out=sum(1 for p, r in done if r["outcome"] != "void" and p["scored"] and not counts(p, r)),
        counted=len(kept), yes_rate=(sum(1 for _, r in kept if r["outcome"] == "yes") / len(kept)) if kept else None,
        mean_prob=(sum(p["c"] for p, _ in kept) / len(kept)) if kept else None,
        summary=jsum, bands=bands([(c, h, e) for c, h, e, _, _ in jrows], edges, z, thin_below),
        by_domain=split(jrows, lambda r: r[3], z, thin_below), by_horizon=split(jrows, lambda r: r[4], z, thin_below), grid=grid)

    # ---- days: streak, habit points, career points (a high-water mark), level, seven days ----
    per = {}
    for e in events:
        if e["type"] not in ("call", "prediction", "resolve"):
            continue
        row = per.setdefault(e["d"], dict(calls=0, call_points=0, edge_points=0))
        if e["type"] == "call":
            row["calls"] += 1
            row["call_points"] += e["points"]
        elif e["type"] == "resolve" and isinstance(e.get("edge"), (int, float)):
            row["edge_points"] += e["edge"]
    rows, streak, cum, hwm = [], 0, 0, 0
    if per:
        first, last = min(per), max(per)
        end = max(today, last)
        d = first
        while d <= end:
            played = d in per
            habit = 0
            if played:
                streak += 1
                habit = hab["session_points"] + hab["streak_bonus_per_day"] * min(streak, hab["streak_bonus_cap_days"])
            elif d < end:
                streak = math.floor(streak * hab["streak_cool_fraction"])
            r = per.get(d, dict(calls=0, call_points=0, edge_points=0))
            skill = r["call_points"] + r["edge_points"]
            cum += skill + habit
            hwm = max(hwm, cum)
            rows.append(dict(d=d, played=played, calls=r["calls"], skill=skill, habit=habit, streak=streak, cumulative=cum, career=hwm))
            d = day_plus(d, 1)
    by_day = {r["d"]: r for r in rows}

    def window(end_day):
        days = [by_day.get(day_plus(end_day, i - 6), dict(d=day_plus(end_day, i - 6), played=False, calls=0, skill=0)) for i in range(7)]
        pl = [x for x in days if x["played"]]
        total = sum(x["skill"] for x in days if x["played"])
        return dict(days=days, played=len(pl), calls=sum(x["calls"] for x in days), total=total, avg=(total / len(pl)) if pl else None)

    now, before = window(today), window(day_plus(today, -7))
    t = by_day.get(today)
    beating = None
    if t and t["played"] and before["avg"] is not None:
        beating = t["skill"] > before["avg"]
    career = hwm
    return dict(gym=gym, bands=bands(gym_rows, edges, z, thin_below), topics=topics, journal=journal,
                days=rows, streak=streak, today_played=bool(per.get(today)), career=career, level=level_info(career, cfg["levels"]),
                seven=dict(days=now["days"], played=now["played"], calls=now["calls"], total=now["total"], avg=now["avg"], prev_avg=before["avg"], beating=beating))


if __name__ == "__main__":
    out = reference(read(sys.argv[1]), sys.argv[2])
    json.dump(out, sys.stdout)

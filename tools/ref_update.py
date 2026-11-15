#!/usr/bin/env python3
"""An independent version of the Block 8 rules, written without looking at app/js/engine/update.js.

Prints JSON that tools/engine_tests/b8.mjs compares with the app, number by number. The cases are defined here, not in the test:
  tw        eight cards with updates on various days: the forecast in force each day from lock day to resolve day, and the average daily Brier
            points (raw) and edge (2 * (points(c) - points(baseline))) over those days, with what the locked number alone would have scored.
  moves     the large moves (25 points or more) of seven update histories, whether each was reversed within 14 days (a later update crossing back
            past the middle) and whether it can be judged yet.
  frozen    open cards older than 7 days with a note from the weekly review and no update since the note, by today.
  steps     update problems at several guesses: miss, hit, points, gain over staying at the prior.
  gate      the exact pass chance of the within-7 half of the Unit 6 gate (32 of 40) by true skill.
Python 3 standard library only.
"""
import datetime as dt
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json")))
UPD = json.load(open(os.path.join(ROOT, "app", "content", "questions", "updates.json")))["questions"]
U = CFG["problems"]["update"]
W = CFG["journal"]["edge_weight"]
BASE = dt.date(2026, 10, 1)


def day(k):
    return (BASE + dt.timedelta(days=k)).isoformat()


def brier(p, yes):
    q = p if yes else 1 - p
    return 100 * (1 - 4 * (1 - q) ** 2)


# (name, locked c, baseline b, [(day offset, new c)] in the order made, resolve day offset, outcome yes)
TW = [
    ("none", 0.7, 0.5, [], 4, True),
    ("one", 0.7, 0.5, [(2, 0.9)], 4, True),
    ("on lock day", 0.7, 0.5, [(0, 0.6)], 3, False),
    ("two same day", 0.7, 0.5, [(1, 0.8), (1, 0.9)], 3, True),
    ("after resolve", 0.6, 0.4, [(2, 0.3), (6, 0.95)], 4, False),
    ("down then up", 0.5, 0.5, [(1, 0.4), (3, 0.8)], 5, False),
    ("resolved on lock day", 0.8, 0.5, [(0, 0.3)], 0, True),
    ("late resolve", 0.65, 0.35, [(2, 0.55)], 10, True),
]


def tw():
    out = []
    for name, c, b, ups, end, yes in TW:
        days = []
        now = c
        for k in range(end + 1):
            for d, nc in ups:  # updates are applied in the order made; a later one on the same day wins
                if d == k:
                    now = nc
            days.append(now)
        raws = [brier(x, yes) for x in days]
        edges = [W * (r - brier(b, yes)) for r in raws]
        first = W * (brier(c, yes) - brier(b, yes))
        used = [(d, nc) for d, nc in ups if d <= end]
        out.append({"name": name, "c": c, "b": b, "updates": [{"d": d, "c": nc} for d, nc in ups], "end": end, "yes": yes, "days": days, "raw": sum(raws) / len(raws), "edge": sum(edges) / len(edges),
                    "raw0": brier(c, yes), "edge0": first, "gain": sum(edges) / len(edges) - first, "n": len(days), "used": len(used)})
    return out


# (name, locked c, [(day, new c)], today offset, resolved)
MOVES = [
    ("reversed", 0.3, [(0, 0.7), (5, 0.4)], 6, False),
    ("late reversal", 0.3, [(0, 0.7), (20, 0.4)], 21, False),
    ("not judged yet", 0.3, [(0, 0.7)], 10, False),
    ("judged by time", 0.3, [(0, 0.7)], 15, False),
    ("small", 0.5, [(0, 0.6)], 30, False),
    ("down reversed", 0.8, [(0, 0.4), (3, 0.7)], 4, False),
    ("resolved, none", 0.2, [(1, 0.6)], 3, True),
    ("exactly 25", 0.5, [(0, 0.75)], 20, False),
    ("two moves", 0.2, [(0, 0.6), (2, 0.9), (4, 0.5)], 10, False),
]


def moves():
    out = []
    for name, c, ups, today, resolved in MOVES:
        rows = []
        prev = c
        for i, (d, nc) in enumerate(ups):
            if abs(nc - prev) >= U["update_rule"]["large_move"] - 1e-9:
                mid = (prev + nc) / 2
                up = nc > prev
                rev = any(d2 - d <= 14 and ((x <= mid + 1e-9) if up else (x >= mid - 1e-9)) for d2, x in ups[i + 1:])
                judged = rev or resolved or today - d > 14
                rows.append({"d": d, "reversed": rev, "judged": judged})
            prev = nc
        out.append({"name": name, "c": c, "updates": [{"d": d, "c": nc} for d, nc in ups], "today": today, "resolved": resolved, "moves": rows})
    return out


# (name, card locked day, resolved, [update days], news written day, today)
FROZEN = [
    ("frozen", 0, False, [], 8, 10),
    ("updated after the note", 0, False, [8], 8, 10),
    ("updated before the note", 0, False, [7], 8, 10),
    ("too young", 5, False, [], 8, 10),
    ("resolved", 0, True, [], 8, 10),
    ("exactly 7 days old", 3, False, [], 8, 10),
    ("8 days old", 2, False, [], 8, 10),
]


def frozen():
    out = []
    for name, locked, resolved, ups, written, today in FROZEN:
        waiting = (not resolved) and (today - locked) > 7 and not any(u >= written for u in ups)
        out.append({"name": name, "locked": locked, "resolved": resolved, "updates": ups, "written": written, "today": today, "frozen": waiting, "waited": today - written if waiting else None})
    return out


def steps():
    out = []
    for q in UPD:
        for i, s in enumerate(q["steps"]):
            for off in (0, 3.5, 7, 7.1, -10, 25):
                g = min(100.0, max(0.0, s["truth"] + off))
                miss = abs(g - s["truth"])
                out.append({"id": f"{q['id']}#{i}", "guess": g, "prior": s["prior"], "truth": s["truth"], "miss": miss, "hit": miss <= U["tolerance"] + 1e-9,
                            "points": max(U["floor"], round(U["full_points"] * (1 - miss / U["tolerance"]))), "gain": abs(s["prior"] - s["truth"]) - miss, "moved": g - s["prior"]})
    return out


def binom(n, p, lo, hi):
    return sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(lo, hi + 1))


def main():
    G = CFG["gates"]
    n, need = G["update_exam_calls"], G["update_pass_within"]
    print(json.dumps({"tw": tw(), "moves": moves(), "frozen": frozen(), "steps": steps(), "gate": {str(c): binom(n, c, need, n) for c in (0.5, 0.7, 0.8, 0.85, 0.9, 0.99)}}))


if __name__ == "__main__":
    main()

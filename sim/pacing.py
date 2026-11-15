#!/usr/bin/env python3
"""Predict: pacing check (project-specific, Python standard library only).

Reads the design tables and answers:
  1. How many days does each unit need at 15 minutes a day, given its drills per day,
     practice and exam sizes, and the real-world evidence it waits for?
  2. On what day does each arc end, and is the real-prediction evidence each belt needs
     available by then (from the session-economy trajectory)?
  3. Does every arc's session budget add to 15 minutes?
  4. Exact pass odds for the k-of-n exams and the range trigger.
Writes data/timeline.csv for the roadmap drawing.

Usage:  python3 sim/pacing.py
"""
import csv
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLACK = 1.10          # 10% slack for review rounds and off days inside a unit
SESSION_MIN = 15


def rows(name):
    return list(csv.DictReader(open(os.path.join(ROOT, "data", name), newline="")))


def tail(n, p, k):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


JOURNAL_START = 5   # Block 2 (the journal) is needed by day 5: no real predictions exist before it


def resolved_by(day, traj):
    day = day - (JOURNAL_START - 1)
    if day < 1:
        return 0.0
    if day <= len(traj):
        return float(traj[day - 1]["resolved"])
    last = float(traj[-1]["resolved"])
    rate = float(traj[-1]["reveals_today"])
    return last + (day - len(traj)) * rate


def main():
    units = sorted(rows("units.csv"), key=lambda u: int(u["order"]))
    by_id = {u["id"]: u for u in units}
    print("1. Unit pacing at 15 minutes a day (10% slack included)")
    print(f"{'unit':<5}{'name':<18}{'drill days':>10}{'evidence days':>14}{'unit days':>10}{'start':>7}{'end':>6}")
    clock, timeline = 0, []
    for u in units:
        dpd = int(u["drills_per_day"])
        drill = (math.ceil(int(u["practice_calls"]) / dpd) + math.ceil(int(u["exam_calls"]) / dpd)) if dpd else 0
        days = math.ceil(SLACK * max(drill, int(u["journal_days"])))
        if u["runs_alongside"]:
            start = by_id[u["runs_alongside"]]["_start"]
        else:
            start = clock
        u["_start"], u["_end"], u["_days"] = start, start + days, days
        if not u["runs_alongside"]:
            clock = start + days
        print(f"{u['id']:<5}{u['name']:<18}{drill:>10}{u['journal_days']:>14}{days:>10}{start + 1:>7}{start + days:>6}")
        timeline.append({"id": u["id"], "kind": "unit", "arc": u["arc"], "name": u["name"],
                         "start_day": start + 1, "end_day": start + days})

    print("\n2. Arc ends and belt evidence (resolved real predictions from the session-economy sim)")
    traj = list(csv.DictReader(open(os.path.join(ROOT, "sim", "out", "traj_designed_session.csv"))))
    arc_end = {}
    for u in units:
        if u["id"] != "U12":
            arc_end[u["arc"]] = max(arc_end.get(u["arc"], 0), u["_end"])
    prev_belt = 0
    for b in rows("belts.csv"):
        u = by_id[b["after_unit"]]
        day = u["_end"] if b["id"] != "B5" else by_id["U12"]["_start"] + 365   # Elite needs 12 months of public record
        day = max(day, prev_belt)   # a belt cannot arrive before the one below it
        need = int(b["resolved_needed"])
        while need and resolved_by(day, traj) < need and day < 3000:
            day += 1          # the belt waits for its evidence
        have = resolved_by(day, traj)
        ok = "ok" if have >= need else "SHORT"
        prev_belt = day
        print(f"  {b['belt']:<7}{b['title']:<11} earliest day {day:>4}  needs {need:>3} resolved, sim has {have:>5.0f}  {ok if need else 'external evidence'}")
        timeline.append({"id": b["id"], "kind": "belt", "arc": u["arc"], "name": b["belt"] + " belt: " + b["title"],
                         "start_day": day, "end_day": day})
    print(f"  Units 0 to 11 complete on day {max(arc_end.values())} "
          f"({max(arc_end.values()) / 30.4:.1f} months) if every gate is passed first time.")

    blocks = rows("build_blocks.csv")
    for bl in blocks:
        need = int(bl["needed_by_day"])
        first_use = by_id[bl["enables_unit"]]["_start"] + 1
        if need > max(first_use, 1) and bl["id"] not in ("BL3", "BL4", "BL5"):
            print(f"  WARNING: {bl['id']} is needed on day {first_use} but scheduled for day {need}")
        timeline.append({"id": bl["id"], "kind": "block", "arc": by_id[bl["enables_unit"]]["arc"], "name": bl["name"],
                         "start_day": need, "end_day": need})
    with open(os.path.join(ROOT, "data", "timeline.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "kind", "arc", "name", "start_day", "end_day"])
        w.writeheader()
        w.writerows(timeline)

    print("\n3. Session budget by arc (minutes, must total 15)")
    for r in rows("session_budget.csv"):
        mins = {k[:-4]: int(v) for k, v in r.items() if k.endswith("_min")}
        total = sum(mins.values())
        pct = ", ".join(f"{k} {v} min ({v / total * 100:.0f}%)" for k, v in mins.items())
        print(f"  Arc {r['arc']:<4}{pct}  total {total} {'ok' if total == SESSION_MIN else 'WRONG'}")

    print("\n4. Exact pass odds for k-of-n exams")
    for label, n, k in [("Unit 4 Fermi (16 of 20)", 20, 16), ("Units 5-6 (32 of 40)", 40, 32),
                        ("Unit 7 (22 of 28)", 28, 22), ("Units 8-9 (24 of 30)", 30, 24)]:
        print(f"  {label:<26}" + ", ".join(f"skill {p:.0%}: {tail(n, p, k) * 100:.0f}%" for p in (0.9, 0.85, 0.7)))
    fire = lambda p: 1 - tail(40, p, 30)
    print(f"  Trigger L05 (fewer than 30 of 40 ranges hold): fires at true coverage "
          + ", ".join(f"{p:.0%}: {fire(p) * 100:.1f}%" for p in (0.9, 0.8, 0.7, 0.5)))
    print("\nWrote data/timeline.csv")


if __name__ == "__main__":
    main()

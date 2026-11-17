#!/usr/bin/env python3
"""Predict: the weekly review's inputs, built from the player's record in the private repo.

The scheduled review runs this on a checkout of `Predict-data` (the app pushes record/<day>.jsonl there) and reads the packet it
prints. The packet holds numbers and the text of the player's predictions, nothing else. Reading it, the reviewer writes
coach/latest.json (shape: design/coach.md), checks it with tools/coach_validate.py and commits it to the private repo.

Usage:  python3 tools/weekly_packet.py PATH/TO/Predict-data [--today YYYY-MM-DD] [--out packet.json]
The packet is a pure function of the record and the day, so running it twice gives the same packet. Python standard library only.
"""
import argparse
import datetime
import glob
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8"))
EDGES = CFG["mirror"]["band_edges"]


def add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def load_events(repo):
    events = {}
    for path in sorted(glob.glob(os.path.join(repo, "record", "*.jsonl"))):
        for line in open(path, encoding="utf-8"):
            if line.strip():
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if isinstance(e, dict) and "id" in e and "type" in e and "t" in e:
                    events[e["id"]] = e
    return sorted(events.values(), key=lambda e: (e["t"], e["id"]))


def natural_calls(events):
    judged = {e["exam"] for e in events if e["type"] == "exam" and e.get("state") == "result"}
    return [e for e in events if e["type"] == "call" and e.get("mode") in ("baseline", "practice", "exam") and not (e.get("exam") and e["exam"] not in judged)]


def summarize(calls):
    n = len(calls)
    if not n:
        return {"n": 0, "hit_rate": None, "mean_confidence": None, "gap": None, "points": 0}
    hits = sum(1 for c in calls if c["hit"])
    mean = sum(c["c"] for c in calls) / n
    return {"n": n, "hit_rate": round(hits / n, 4), "mean_confidence": round(mean, 4), "gap": round(mean - hits / n, 4), "points": sum(c["points"] for c in calls)}


def bands(calls):
    out = []
    for i in range(len(EDGES) - 1):
        lo, hi, last = EDGES[i], EDGES[i + 1], i == len(EDGES) - 2
        inside = [c for c in calls if c["c"] >= lo - 1e-9 and (c["c"] <= hi + 1e-9 if last else c["c"] < hi - 1e-9)]
        out.append({"from": lo, "to": hi, **summarize(inside)})
    return out


def predictions(events, today):
    resolves = {e["prediction"]: e for e in events if e["type"] == "resolve"}
    baselines = {}
    for e in events:
        if e["type"] == "baseline":
            baselines.setdefault(e["prediction"], e)
    rows = []
    for p in (e for e in events if e["type"] == "prediction"):
        r = resolves.get(p["id"])
        rows.append({"id": p["id"], "text": p["text"], "domain": p["domain"], "locked": p["d"], "due": p["due"], "said": p["c"],
                     "baseline": baselines[p["id"]]["b"] if p["id"] in baselines else p["b"], "baseline_source": "predict" if p["id"] in baselines else p.get("bSource"),
                     "state": "resolved" if r else ("due" if p["due"] <= today else "open"), "outcome": r["outcome"] if r else None, "has_source": bool(r and r.get("source"))})
    return rows


def flags(events):
    chains = {}
    for e in events:
        if e["type"] != "flag":
            continue
        if e.get("state") == "open":
            chains[e["id"]] = {"trigger": e["trigger"], "state": "open", "fires": e.get("fire", 1), "opened": e["d"]}
        elif e.get("flag") in chains:
            c = chains[e["flag"]]
            c["state"] = {"lesson": "lesson", "drill": "drill", "retest": "retest2" if (e.get("step") == 1 and e.get("pass")) else c["state"], "cleared": "cleared", "escalated": "escalated"}.get(e.get("state"), c["state"])
    return list(chains.values())


def world_forecasts(events, today):
    """Unit 11: world questions the player has forecast twice and that have reached their day without a recorded result (the review can look them up),
    and how many are still open, so the review knows how many new forecasts to write before they open."""
    first = {e["q"]: e for e in events if e["type"] == "world" and e.get("state") == "first"}
    final = {e["q"] for e in events if e["type"] == "world" and e.get("state") == "final"}
    done = {e["q"] for e in events if e["type"] == "world" and e.get("state") == "resolve"}
    to_check = [{"id": q, "text": e["text"], "due": e["due"]} for q, e in sorted(first.items()) if q in final and q not in done and e["due"] <= today]
    waiting = [q for q in first if q in final and q not in done and first[q]["due"] > today]
    return to_check, len(waiting)


def build(repo, today):
    events = load_events(repo)
    since = add_days(today, -6)
    week = [c for c in natural_calls(events) if since <= c["d"] <= today]
    preds = predictions(events, today)
    need_baseline = [p["id"] for p in preds if p["state"] in ("open", "due") and p["baseline_source"] != "predict" and p["due"] >= today]
    to_check, waiting = world_forecasts(events, today)
    return {
        "today": today, "window": [since, today], "events": len(events),
        "gym_week": summarize(week), "gym_week_by_band": bands(week), "gym_all": summarize(natural_calls(events)),
        "days_played_in_week": len({e["d"] for e in events if e["d"] >= since and e["type"] in ("call", "prediction", "resolve")}),
        "predictions": preds,
        "world_predictions_to_check": [p for p in preds if p["domain"] == "world" and p["state"] in ("due", "open")],
        "predictions_without_predict_baseline": need_baseline,
        "world_forecasts_to_check": to_check,
        "world_forecasts_waiting": waiting,
        "forecasts_needed": {"count": 8, "opens_from": add_days(today, 1), "note": "Write your own number for each BEFORE it opens (written on or before opens); the app hides it until the player has locked theirs."},
        "pattern_flags": flags(events),
        "prompts_needed": [add_days(today, i) for i in range(1, 8)],
        "rules": "Write coach/latest.json (design/coach.md). Every checked outcome needs an https source you read; every baseline a reference class; check it with tools/coach_validate.py.",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--today", default=datetime.date.today().isoformat())
    ap.add_argument("--out")
    a = ap.parse_args()
    if not os.path.isdir(os.path.join(a.repo, "record")):
        sys.exit(f"{a.repo}/record not found: is this a checkout of Predict-data?")
    packet = build(a.repo, a.today)
    text = json.dumps(packet, indent=1, sort_keys=True)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text + "\n")
    else:
        print(text)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""An independent recomputation of the Lesson Engine (Block 4) from the raw event log.

The app's engine (app/js/engine/lessons.js, gate.js) is checked against this file, which shares no code with it: the triggers,
the flag chain, the exam gate and the autopsy queue are written again here, in a different shape (a state machine that is
updated in place, where the app folds the log). A disagreement on any synthetic player is a bug in one of the two.

  python3 tools/ref_lessons.py walk <record.jsonl> <last_day>   the flags a player would have met, day by day (see walk())
  python3 tools/ref_lessons.py gate <calls.json>                 the Unit 1 verdict of each list of calls in the file
  python3 tools/ref_lessons.py autopsies <record.jsonl>          the cards that need an autopsy, in the order they resolved

The walk is the shared script for the tests: on each day the engine is looked at twice, in the morning (before the day's
events, as when Today opens) and in the evening (after them, as when the last session ends); every pattern flag that is
open in the evening has its lesson read and its drill done the same evening. Flag events carry the look's own time, so the
two implementations see the same clock. Python standard library only; every threshold comes from data/scoring.json.
"""
import datetime
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8"))
L = CFG["lessons"]
EPS = 1e-9
MORNING, EVENING, LESSON, DRILL = "T07:00:00.000Z", "T21:00:00.000Z", "T21:30:00.000Z", "T21:31:00.000Z"


def add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


def load(path):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        if e.get("type") != "header":
            out.append(e)
    return sorted(out, key=lambda e: (e["t"], e["id"]))


# ---------------------------------------------------------------- the observations
def natural(events):
    return [e for e in events if e["type"] == "call" and e["mode"] in L["natural_modes"]]


def rejected(p):
    return p.get("flagged") is True or bool(p.get("flags"))


def in_band(c, band):
    return band[0] - EPS <= c <= band[1] + EPS


def mean(xs):
    return sum(xs) / len(xs)


# ---------------------------------------------------------------- the triggers: fire() -> (evidence, strength) or None; retest() -> (pass, evidence) or None
def fire_band(calls, since, t, sign):
    obs = [c for c in calls if (not since or c["t"] > since) and in_band(c["c"], t["band"])]
    if len(obs) < t["window"]:
        return None
    w = obs[-t["window"]:]
    mc, hr = mean([c["c"] for c in w]), mean([1 if c["hit"] else 0 for c in w])
    gap = sign * (mc - hr)
    if gap < t["gap"] - 1e-12:
        return None
    return {"n": len(w), "meanConf": mc, "hitRate": hr, "gap": gap}, gap / math.sqrt(max(mc * (1 - mc), 1e-9) / len(w))


def retest_band(calls, since, ready, t, sign):
    obs = [c for c in calls if c["t"] > since and c["d"] >= ready and in_band(c["c"], t["band"])]
    if len(obs) < t["clear_window"]:
        return None
    w = obs[:t["clear_window"]]
    mc, hr = mean([c["c"] for c in w]), mean([1 if c["hit"] else 0 for c in w])
    return abs(mc - hr) <= t["clear_gap"] + 1e-12, {"n": len(w), "meanConf": mc, "hitRate": hr, "gap": sign * (mc - hr)}


def fire_fence(calls, since, t):
    obs = [c for c in calls if not since or c["t"] > since]
    if len(obs) < t["window"]:
        return None
    w = obs[-t["window"]:]
    zone = [c for c in w if in_band(c["c"], t["zone"])]
    share = len(zone) / len(w)
    zone_hit = (sum(1 for c in zone if c["hit"]) / len(zone)) if zone else 0
    if not share > t["share"] + 1e-12 or zone_hit < t["hit_rate"] - 1e-12:
        return None
    return {"n": len(w), "zone": len(zone), "share": share, "zoneHitRate": zone_hit}, (share - t["share"]) / math.sqrt(t["share"] * (1 - t["share"]) / len(w))


def retest_fence(calls, since, ready, t):
    obs = [c for c in calls if c["t"] > since and c["d"] >= ready]
    if len(obs) < t["clear_window"]:
        return None
    w = obs[:t["clear_window"]]
    share = sum(1 for c in w if in_band(c["c"], t["zone"])) / len(w)
    return share < t["clear_share"] - 1e-12, {"n": len(w), "share": share}


def fire_soft(preds, since, t):
    obs = [p for p in preds if not since or p["t"] > since]
    if len(obs) < t["window"]:
        return None
    w = obs[-t["window"]:]
    bad = sum(1 for p in w if rejected(p))
    if bad < t["rejects"]:
        return None
    return {"n": len(w), "rejects": bad}, (bad - 0.15 * len(w)) / math.sqrt(len(w) * 0.15 * 0.85)


def retest_soft(preds, since, ready, t):
    obs = [p for p in preds if p["t"] > since and p["d"] >= ready]
    if len(obs) < t["clear_window"]:
        return None
    w = obs[:t["clear_window"]]
    bad = sum(1 for p in w if rejected(p))
    return bad <= t["clear_rejects"], {"n": len(w), "rejects": bad}


# ---------------------------------------------------------------- the walk
class Walker:
    def __init__(self, events):
        self.events = events
        self.chains = []          # each: dict(trigger, state, fires, opened_day, drill_day, drill_t, r1_t, cleared_t, cleared_day)
        self.calls, self.preds, self.all = [], [], []
        self.played, self.n_calls, self.n_preds = set(), {}, {}
        self.out = []             # the normalized timeline

    # -- bookkeeping of what has happened so far
    def feed(self, e):
        self.all.append(e)
        if e["type"] in ("call", "prediction", "resolve"):
            self.played.add(e["d"])
        if e["type"] == "call":
            self.n_calls[e["d"]] = self.n_calls.get(e["d"], 0) + 1
            if e["mode"] in L["natural_modes"]:
                self.calls.append(e)
        elif e["type"] == "prediction":
            self.n_preds[e["d"]] = self.n_preds.get(e["d"], 0) + 1
            self.preds.append(e)

    def sorted_preds(self):
        return sorted(self.preds, key=lambda p: (p["t"], p["id"]))

    # -- L15
    def missed_days(self, today, since_day):
        if not self.played:
            return None
        first = min(self.played)
        t = L["triggers"]["L15"]
        missed = []
        for i in range(t["window_days"], 0, -1):
            d = add_days(today, -i)
            if d < first or (since_day and d <= since_day):
                continue
            if d not in self.played:
                missed.append(d)
        return {"missed": len(missed)} if len(missed) >= t["missed"] else None

    def minimum_run(self, from_day, today):
        t = L["triggers"]["L15"]["minimum"]
        run, d = 0, from_day
        while d <= today:
            ok = self.n_calls.get(d, 0) >= t["gym_calls"] and self.n_preds.get(d, 0) >= t["predictions"]
            if ok:
                run += 1
            elif d < today:
                run = 0
            d = add_days(d, 1)
        return run

    # -- one look
    def look(self, today, stamp, day_label):
        t_iso = today + stamp
        pre = {c["trigger"]: c for c in self.chains}      # the state each trigger's last chain was in when the look began
        pre_state = {id(c): c["state"] for c in self.chains}
        events = []

        def emit(**fields):
            row = {"day": today, "at": stamp[1:3], **fields}
            events.append(row)
            self.out.append(row)

        # 1. re-tests and the L15 run
        for i, c in enumerate(self.chains, 1):
            if c["trigger"] == "L15":
                if c["state"] == "open" and self.minimum_run(c["opened_day"], today) >= L["triggers"]["L15"]["clear_days"]:
                    c["state"], c["cleared_t"], c["cleared_day"] = "cleared", t_iso, today
                    emit(state="cleared", chain=i, trigger="L15")
                continue
            if c["state"] not in ("drilled", "retest2"):
                continue
            step = 1 if c["state"] == "drilled" else 2
            ready = add_days(c["drill_day"], L["retest_after_days"][step - 1])
            since = c["drill_t"] if step == 1 else c["r1_t"]
            t = L["triggers"][c["trigger"]]
            if c["trigger"] == "L01":
                res = retest_band(self.calls, since, ready, t, +1)
            elif c["trigger"] == "L02":
                res = retest_band(self.calls, since, ready, t, -1)
            elif c["trigger"] == "L03":
                res = retest_fence(self.calls, since, ready, t)
            else:
                res = retest_soft(self.sorted_preds(), since, ready, t)
            if res is None:
                continue
            ok, ev = res
            emit(state="retest", chain=i, trigger=c["trigger"], step=step, passed=ok, **{k: v for k, v in ev.items()})
            if ok:
                if step == 1:
                    c["state"], c["r1_t"] = "retest2", t_iso
                else:
                    c["state"], c["cleared_t"], c["cleared_day"] = "cleared", t_iso, today
            else:
                c["fires"] += 1
                c["state"] = "escalated" if c["fires"] >= L["escalate_after_fires"] else "open"

        # 2. new fires, within the limits
        in_repair = sum(1 for c in self.chains if c["trigger"] != "L15" and c["state"] in ("open", "drilled", "retest2"))
        opened_today = sum(1 for c in self.chains if c["opened_day"] == today and c["trigger"] != "L15")
        found = []
        for tid, t in L["triggers"].items():
            last = pre.get(tid)
            # the last chain of this trigger, judged by the state it was in when the look began
            if last is not None and pre_state[id(last)] != "cleared":
                continue
            since = last["cleared_t"] if last else ""
            if tid == "L15":
                res = self.missed_days(today, last["cleared_day"] if last else "")
                if res:
                    found.append((tid, res, math.inf))
                continue
            if tid == "L01":
                res = fire_band(self.calls, since, t, +1)
            elif tid == "L02":
                res = fire_band(self.calls, since, t, -1)
            elif tid == "L03":
                res = fire_fence(self.calls, since, t)
            elif tid == "L04":
                res = fire_soft(self.sorted_preds(), since, t)
            else:
                res = None
            if res:
                found.append((tid, res[0], res[1]))
        found.sort(key=lambda f: (0 if f[0] == "L15" else 1, -f[2] if f[2] != math.inf else 0, f[0]))
        for tid, ev, strength in found:
            if tid != "L15" and (in_repair >= L["max_in_repair"] or opened_today >= L["max_new_per_day"]):
                continue
            self.chains.append({"trigger": tid, "state": "open", "fires": 1, "opened_day": today, "drill_day": None, "drill_t": None, "r1_t": None, "cleared_t": None, "cleared_day": None})
            emit(state="open", chain=len(self.chains), trigger=tid, **ev)
            if tid != "L15":
                in_repair += 1
                opened_today += 1
        return events

    def player_acts(self, today):
        """The scripted player reads the lesson and does the drill the evening a pattern flag is open."""
        for c in self.chains:
            if c["trigger"] != "L15" and c["state"] == "open":
                c["state"], c["drill_day"], c["drill_t"] = "drilled", today, today + DRILL


def walk(events, last_day):
    w = Walker(events)
    by_day = {}
    for e in events:
        by_day.setdefault(e["d"], []).append(e)
    if not events:
        return []
    day = min(by_day)
    while day <= last_day:
        w.look(day, MORNING, day)
        for e in by_day.get(day, []):
            w.feed(e)
        w.look(day, EVENING, day)
        w.player_acts(day)
        day = add_days(day, 1)
    return w.out


# ---------------------------------------------------------------- the Unit 1 gate
def gate(calls):
    g, edges = CFG["gates"], CFG["mirror"]["band_edges"]
    n = len(calls)
    if not n:
        return {"n": 0, "pass": False, "reasons": []}
    index = mean([c["c"] for c in calls]) - mean([1 if c["hit"] else 0 for c in calls])
    reasons, bands = [], []
    for i in range(len(edges) - 1):
        lo, hi, last = edges[i], edges[i + 1], i == len(edges) - 2
        inside = [c for c in calls if c["c"] >= lo - EPS and (c["c"] <= hi + EPS if last else c["c"] < hi - EPS)]
        m = len(inside)
        row = {"lo": lo, "hi": hi, "n": m, "checked": m >= g["band_min_items"], "off": False, "z": None}
        if m:
            bm, bh = mean([c["c"] for c in inside]), mean([1 if c["hit"] else 0 for c in inside])
            row.update(meanConf=bm, hitRate=bh)
            if row["checked"]:
                row["z"] = abs(bh - bm) / math.sqrt(bm * (1 - bm) / m)
                row["off"] = row["z"] > g["band_z_max"] + EPS
        if row["off"]:
            reasons.append(f"band:{lo}")
        bands.append(row)
    if abs(index) > g["calibration_index_tolerance"] + 1e-12:
        reasons.insert(0, "index")
    return {"n": n, "pass": not reasons, "index": index, "reasons": reasons, "bands": bands}


# ---------------------------------------------------------------- the autopsy queue
def autopsies(events):
    A = L["autopsy"]
    preds = {e["id"]: e for e in events if e["type"] == "prediction"}
    resolves = sorted([e for e in events if e["type"] == "resolve"], key=lambda e: (e["t"], e["id"]))
    done = {e["prediction"] for e in events if e["type"] == "autopsy"}
    out, confident_hits = [], 0
    for r in resolves:
        p = preds.get(r["prediction"])
        if not p or r["outcome"] == "void" or not p.get("scored"):
            continue
        yes = p["c"] >= 0.5
        conf = p["c"] if yes else 1 - p["c"]
        if conf < A["min_confidence"] - EPS:
            continue
        right = yes == (r["outcome"] == "yes")
        if not right:
            out.append({"prediction": p["id"], "kind": "miss", "filed": p["id"] in done})
        else:
            confident_hits += 1
            if confident_hits % A["hit_sample_every"] == 0:
                out.append({"prediction": p["id"], "kind": "hit_sample", "filed": p["id"] in done})
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "walk":
        print(json.dumps(walk(load(sys.argv[2]), sys.argv[3])))
    elif cmd == "gate":
        print(json.dumps([gate(c) for c in json.load(open(sys.argv[2]))]))
    elif cmd == "autopsies":
        print(json.dumps(autopsies(load(sys.argv[2]))))
    else:
        sys.exit(f"unknown command {cmd}")

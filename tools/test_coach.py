#!/usr/bin/env python3
"""Predict: the app's reading of the coach file (app/js/engine/coach.js) against the independent Python rules
(tools/coach_validate.py) on every fixture in tools/fixtures/coach. Both must keep and drop the same things."""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import coach_validate as V  # noqa: E402
import synth  # noqa: E402
import weekly_packet as W  # noqa: E402
import merge_topups as M  # noqa: E402
import check_questions as Q  # noqa: E402

JS = r"""
import { parseCoach } from '%s/app/js/engine/coach.js';
import fs from 'node:fs';
const dir = process.argv[1];
const out = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const c = parseCoach(JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')));
  out[f] = { kept: { letter: c.letter ? 1 : 0, sources: c.letter ? c.letter.sources.length : 0, drills: c.drills.length, prompt_days: c.prompts.length,
    prompt_items: c.prompts.reduce((n, p) => n + p.items.length, 0), baselines: Object.keys(c.baselines).length, outcomes: Object.keys(c.outcomes).length, reads: Object.keys(c.reads).length }, dropped: c.dropped };
}
console.log(JSON.stringify(out));
""" % ROOT


def packet_checks():
    """The weekly review's inputs, from a synthetic record laid out the way the app pushes it (record/<day>.jsonl)."""
    import tempfile
    r = synth.Rec(3)
    for k in range(10):
        r.play_day(synth.add_days("2026-09-01", k), 8, synth.pol_calibrated)
    p = r.prediction("2026-09-05", 300, 0.7, 0.5, domain="world", due_option="week", text="By 12 September, the ferry will run.")
    q = r.prediction("2026-09-06", 300, 0.6, 0.5, domain="work", due_option="tomorrow", text="By 7 September, the report ships.")
    r.resolve(q, "2026-09-08", 20, "yes")
    repo = tempfile.mkdtemp()
    os.makedirs(os.path.join(repo, "record"))
    days = {}
    for e in r.events:
        days.setdefault(e["d"], []).append(e)
    for d, evs in days.items():
        with open(os.path.join(repo, "record", f"{d}.jsonl"), "w") as f:
            f.write("\n".join(json.dumps(x) for x in evs) + "\n")
    # the same event pushed twice (two devices) counts once
    with open(os.path.join(repo, "record", "2026-09-10.jsonl"), "a") as f:
        f.write(json.dumps(days["2026-09-10"][0]) + "\n")
    today = "2026-09-10"
    a, b = W.build(repo, today), W.build(repo, today)
    bad = 0

    def ok(name, cond, detail=""):
        nonlocal bad
        print(("PASS" if cond else "FAIL"), "weekly packet:", name, detail)
        bad += 0 if cond else 1

    wk = [e for e in r.events if e["type"] == "call" and "2026-09-04" <= e["d"] <= today]
    mean = 0.0
    for c in wk:
        mean += c["c"]
    mean /= len(wk)
    hit = sum(1 for c in wk if c["hit"]) / len(wk)
    ok("the same record gives the same packet", a == b)
    ok("the week's calls and numbers match a count of the raw events", a["gym_week"]["n"] == len(wk) and abs(a["gym_week"]["gap"] - (mean - hit)) < 1e-3 and abs(a["gym_week"]["hit_rate"] - hit) < 1e-3, f"{a['gym_week']['n']} vs {len(wk)}")
    ok("the bands add up to the calls", sum(x["n"] for x in a["gym_week_by_band"]) == len(wk))
    ok("a duplicate event is counted once", a["events"] == len(r.events), f"{a['events']} vs {len(r.events)}")
    ok("the open world prediction is listed for a check, with a baseline still wanted", [x["id"] for x in a["world_predictions_to_check"]] == [p["id"]] and a["predictions_without_predict_baseline"] == [p["id"]])
    ok("the resolved card is resolved and its outcome is there", [x for x in a["predictions"] if x["id"] == q["id"]][0]["state"] == "resolved")
    ok("seven days of ideas are asked for, starting tomorrow", a["prompts_needed"][0] == "2026-09-11" and len(a["prompts_needed"]) == 7)
    ok("the packet holds no field the review should not see (no token, no key names)", "token" not in json.dumps(a).lower())
    return bad


def topup_checks():
    prop = [{"lead": "A new city bike-share scheme opens in a mid-sized European city.", "ask": "It is still running five years later.", "answer": True, "fact": "A documented study found most schemes survive five years.",
             "why": "Start from how often schemes like this one last, then adjust for what you know of this one.", "domain": "world", "diff": "medium", "source": "https://example.org/study", "src_name": "Example study", "checked": "2026-11-15"}]
    new, skipped, problems = M.build_questions(prop + prop, [])
    errors = []
    Q.check_shape(new, "top-ups", errors)
    bad = 0
    for name, cond in (("one new question, the duplicate skipped", len(new) == 1 and skipped == 1), ("it passes the question shape rules", not errors),
                       ("its id starts with top- and it is sourced", new[0]["id"].startswith("top-") and new[0]["verified"] == "sourced"),
                       ("a proposal missing a field is refused", M.build_questions([{"lead": "x"}], [])[2] != [])):
        print(("PASS" if cond else "FAIL"), "top-ups:", name, errors[:2] if not cond else "")
        bad += 0 if cond else 1
    return bad


def main():
    fixtures = os.path.join(ROOT, "tools", "fixtures", "coach")
    js = json.loads(subprocess.run(["node", "--input-type=module", "-e", JS, fixtures], capture_output=True, text=True, check=True).stdout)
    bad = 0
    for name in sorted(js):
        kept, dropped = V.parse(json.load(open(os.path.join(fixtures, name), encoding="utf-8")))
        same = kept == js[name]["kept"] and dropped == js[name]["dropped"]
        print(("PASS" if same else "FAIL"), name, "kept", kept, "dropped", dropped, "" if same else f"| app: {js[name]}")
        bad += 0 if same else 1
    # what the app keeps of the bad file is exactly the good part
    good = js["good.json"]
    if good["dropped"] != 0:
        print("FAIL good.json should lose nothing"); bad += 1
    if js["bad.json"]["kept"] != good["kept"]:
        print("FAIL the bad file should keep exactly what the good file has"); bad += 1
    bad += packet_checks() + topup_checks()
    print(f"{len(js)} fixtures and the weekly packet, {bad} failures")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

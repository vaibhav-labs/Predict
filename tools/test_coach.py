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
    print(f"{len(js)} fixtures, {bad} disagreements")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

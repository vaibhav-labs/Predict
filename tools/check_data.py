#!/usr/bin/env python3
"""Stop a broken push from reaching the phone, and keep personal files out of the public repo.

Run by the Pages workflow before every deploy, and by hand:  python3 tools/check_data.py
Python 3 standard library only.
"""
import csv
import glob
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP_DIRS = {".git", "site", "node_modules"}
errors = []


def rel(path):
    return os.path.relpath(path, ROOT)


# 1. Every JSON file the app ships must parse (scoring rules, manifest, later the content files).
json_files = [os.path.join(ROOT, "data", "scoring.json")]
json_files += glob.glob(os.path.join(ROOT, "app", "**", "*.json"), recursive=True)
json_files += glob.glob(os.path.join(ROOT, "app", "**", "*.webmanifest"), recursive=True)
for path in sorted(set(json_files)):
    try:
        with open(path, encoding="utf-8") as f:
            json.load(f)
    except Exception as e:  # missing file, bad syntax, bad encoding
        errors.append(f"{rel(path)}: {e}")

# 2. Every design table: one header, the same number of cells on every row, ids that are unique.
tables = sorted(glob.glob(os.path.join(ROOT, "data", "*.csv")) + glob.glob(os.path.join(ROOT, "data", "question_tables", "*.csv")))
for path in tables:
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        errors.append(f"{rel(path)}: empty file")
        continue
    head = rows[0]
    if any(not h.strip() for h in head):
        errors.append(f"{rel(path)}: a column has no name")
    for n, row in enumerate(rows[1:], start=2):
        if len(row) != len(head):
            errors.append(f"{rel(path)}: row {n} has {len(row)} cells, the header has {len(head)}")
    if "id" in head:
        i = head.index("id")
        ids = [r[i] for r in rows[1:] if len(r) > i]
        dupes = sorted({x for x in ids if ids.count(x) > 1})
        if dupes:
            errors.append(f"{rel(path)}: duplicate ids {dupes}")

# 3. Nothing personal in a public repo: no record exports or backups.
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for name in filenames:
        low = name.lower()
        if low.endswith(".jsonl") or low.startswith("predict-record") or low.startswith("predict-backup"):
            errors.append(f"{rel(os.path.join(dirpath, name))}: looks like a personal record. Keep it out of this public repo.")

# 4. The lesson engine's settings and its table say the same thing: every pattern in scoring.json is a row of
#    data/lesson_triggers.csv, and the row's minimum sample is the window the engine really uses.
with open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8") as f:
    cfg = json.load(f)
with open(os.path.join(ROOT, "data", "lesson_triggers.csv"), encoding="utf-8", newline="") as f:
    trigger_rows = {r["id"]: r for r in csv.DictReader(f)}
for tid, t in cfg["lessons"]["triggers"].items():
    row = trigger_rows.get(tid)
    if not row:
        errors.append(f"data/lesson_triggers.csv: no row for {tid}, which scoring.json lessons.triggers defines")
        continue
    window = t.get("window", t.get("window_days"))
    if str(window) != row["min_sample"]:
        errors.append(f"{tid}: scoring.json looks at {window} observations, data/lesson_triggers.csv says min_sample {row['min_sample']}")
    drill = t.get("drill")
    if drill and drill["kind"] not in {"wheel", "forced", "zone_locked", "rewrite", "stepwise", "budget", "chain", "plan", "classpick", "domain", "stream", "move"}:
        errors.append(f"{tid}: unknown drill kind {drill['kind']!r}")
with open(os.path.join(ROOT, "data", "vague_claims.csv"), encoding="utf-8", newline="") as f:
    vague = list(csv.DictReader(f))
need = cfg["lessons"]["triggers"]["L04"]["drill"]["items"]
if len(vague) < 2 * need:
    errors.append(f"data/vague_claims.csv has {len(vague)} rows; the rewrite drill needs at least {2 * need} so a second drill brings new ones")
# The two range triggers (Block 6): their windows, the clearing band and the drill's settings must agree with the gate's table.
for tid in ("L05", "L06"):
    t = cfg["lessons"]["triggers"].get(tid)
    if not t:
        errors.append(f"scoring.json lessons.triggers has no {tid}")
        continue
    lo, hi = t["clear_hits"]
    if not (0 < lo <= hi <= t["clear_window"]):
        errors.append(f"{tid}: clear_hits {t['clear_hits']} is not a band inside {t['clear_window']} ranges")
    if tid not in cfg["gates"]["rust_triggers"].get("U3", []):
        errors.append(f"{tid} is not among gates.rust_triggers.U3")
if cfg["lessons"]["triggers"]["L06"]["drill"]["budget_ratio"] <= 1:
    errors.append("L06: the width budget must allow more than the reference width")
if cfg["interval"]["exam_session_size"] * 3 != cfg["gates"]["range_exam_calls"]:
    errors.append("interval.exam_session_size times 3 sittings must equal gates.range_exam_calls")
for r in vague:
    if not (r["vague"].strip() and r["hint"].strip() and r["sharp_example"].strip()):
        errors.append(f"data/vague_claims.csv: {r['id']} has an empty cell")

# 5. The app never names its maker: not in a screen, a data file or a picture's hidden text.
for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "app")):
    for name in filenames:
        with open(os.path.join(dirpath, name), "rb") as f:
            blob = f.read().lower()
        if b"claude" in blob or b"anthropic" in blob:
            errors.append(f"{rel(os.path.join(dirpath, name))}: names the assistant that made it. The app says Predict.")

# 6. The starter question bank: shape, balance, freshness against its tables, and every claim worked out again.
sys.path.insert(0, os.path.join(ROOT, "tools"))
import check_questions  # noqa: E402

bank_errors, bank_notes = check_questions.check()
errors += [f"question bank: {e}" for e in bank_errors]

# 7. The range bank (Block 6): every reference interval worked out again with SQL, the pools disjoint, the interval fair.
import check_ranges  # noqa: E402

range_errors, range_notes = check_ranges.check()
errors += [f"range bank: {e}" for e in range_errors]
bank_notes += [f"range bank: {n}" for n in range_notes]

# 8. The Fermi bank and the Unit 5 bank (Block 7): every part, truth, reference interval, rung and chain worked out again from the records.
import subprocess  # noqa: E402
for _name, _script in (("fermi bank", "check_fermi.py"), ("outside-view bank", "check_rates.py"), ("updating bank", "check_updates.py")):
    _r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), _script)], capture_output=True, text=True)
    if _r.returncode != 0:
        errors += [f"{_name}: {line}" for line in (_r.stdout + _r.stderr).strip().splitlines()[:20]]
    else:
        bank_notes.append(f"{_name}: " + _r.stdout.strip().splitlines()[-1])

if errors:
    print("DATA CHECK FAILED")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"data check passed: {len(tables)} tables, {len(set(json_files))} JSON files, no personal files")
for note in bank_notes:
    print("  question bank:", note)

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

# 4. The starter question bank: shape, balance, freshness against its tables, and every claim worked out again.
sys.path.insert(0, os.path.join(ROOT, "tools"))
import check_questions  # noqa: E402

bank_errors, bank_notes = check_questions.check()
errors += [f"question bank: {e}" for e in bank_errors]

if errors:
    print("DATA CHECK FAILED")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"data check passed: {len(tables)} tables, {len(set(json_files))} JSON files, no personal files")
for note in bank_notes:
    print("  question bank:", note)

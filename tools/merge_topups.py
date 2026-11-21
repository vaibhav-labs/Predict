#!/usr/bin/env python3
"""Predict: turn the weekly review's proposed question top-ups into app/content/questions/topups.json.

The review (which can only write to the private repo) leaves coach/topups-proposed.json there:
  {"questions": [{"lead": "...", "ask": "...", "answer": true, "fact": "...", "why": "...", "domain": "world",
                  "diff": "medium", "source": "https://...", "src_name": "...", "checked": "YYYY-MM-DD"}, ...]}
Run this on a checkout of the public repo, then `python3 tools/check_data.py`: a top-up that breaks a rule fails the check and does not ship.
Only questions about the world and documented facts belong here (the data is public): nothing from the player's record.

Usage:  python3 tools/merge_topups.py PROPOSED.json [--dry-run]
"""
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TOPUPS = os.path.join(ROOT, "app", "content", "questions", "topups.json")
NEED = ("lead", "ask", "answer", "fact", "why", "domain", "diff", "source", "src_name", "checked")


def build_questions(proposed, existing):
    """Full question objects from proposals, skipping any claim already in `existing`. Returns (new, skipped, problems)."""
    seen = {q["claim"] for q in existing}
    new, skipped, problems = [], 0, []
    for i, p in enumerate(proposed):
        missing = [k for k in NEED if k not in p]
        if missing:
            problems.append(f"proposal {i}: missing {missing}")
            continue
        claim = p["lead"].strip() + " " + p["ask"].strip() if p["lead"].strip() else p["ask"].strip()
        if claim in seen:
            skipped += 1
            continue
        seen.add(claim)
        new.append({"id": "top-" + hashlib.sha1(claim.encode()).hexdigest()[:7], "lead": p["lead"].strip(), "ask": p["ask"].strip(), "claim": claim, "answer": p["answer"],
                    "base": None, "n": 0, "fact": p["fact"].strip(), "why": p["why"].strip(), "domain": p["domain"], "diff": p["diff"], "verified": "sourced",
                    "source": p["source"], "src_name": p["src_name"], "checked": p["checked"]})
    return new, skipped, problems


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    proposed = json.load(open(args[0], encoding="utf-8")).get("questions", [])
    doc = json.load(open(TOPUPS, encoding="utf-8"))
    new, skipped, problems = build_questions(proposed, doc["questions"])
    for p in problems:
        print("problem:", p)
    print(f"{len(new)} new, {skipped} already there, {len(problems)} refused")
    if "--dry-run" in sys.argv or problems:
        sys.exit(1 if problems else 0)
    doc["questions"] += new
    doc["count"] = len(doc["questions"])
    doc["built"] = max([doc["built"]] + [q["checked"] for q in new])
    with open(TOPUPS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("written; now run python3 tools/check_data.py")


if __name__ == "__main__":
    main()

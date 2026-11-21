#!/usr/bin/env python3
"""Predict: check what the weekly review wrote before it is committed to the private repo.

The app (app/js/engine/coach.js, parseCoach) silently drops anything that does not pass; this script says what would be dropped, so
the review can fix it first. It is an independent port of the same rules: tools/test_coach.py runs both on the same fixtures and
fails if they disagree.

Usage:  python3 tools/coach_validate.py coach/latest.json      exit 1 if anything would be dropped
"""
import json
import re
import sys
from datetime import date
from urllib.parse import urlparse

VERSION = 1
BANNED = re.compile(r"claude|anthropic", re.I)
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DOMAINS = {"work", "life", "world"}
DUES = {"tomorrow", "week", "month", "longer"}
RESULTS = {"yes", "no", "void"}
ID = re.compile(r"^[\w-]+$")
L = dict(title=120, paragraph=700, paragraphs=12, drills=6, drill_text=400, prompt=220, per_day=3, days=14, read=900, note=300, ref=160, ids=400, sources=10, label=120)


def text(v, mx):
    return v.strip() if isinstance(v, str) and v.strip() and len(v) <= mx and not BANNED.search(v) else None


def day_of(v):
    if isinstance(v, str) and DAY.match(v[:10]):
        try:
            date.fromisoformat(v[:10])
            return v[:10]
        except ValueError:
            return None
    return None


def https(v):
    if not isinstance(v, str) or len(v) > 400:
        return None
    u = urlparse(v)
    return v if u.scheme == "https" and "." in (u.hostname or "") else None


def isobj(v):
    return isinstance(v, dict)


def parse(raw):
    """Returns (kept, dropped): kept counts what the app would keep of each kind."""
    kept = dict(letter=0, sources=0, drills=0, prompt_days=0, prompt_items=0, baselines=0, outcomes=0, reads=0)
    dropped = 0
    if not isobj(raw) or raw.get("version") != VERSION:
        return kept, (1 if raw else 0)
    letter = raw.get("letter")
    if isobj(letter):
        paras = letter.get("paragraphs")
        paras = [text(x, L["paragraph"]) for x in paras[: L["paragraphs"]]] if isinstance(paras, list) else []
        if text(letter.get("title"), L["title"]) and paras and all(paras):
            kept["letter"] = 1
            for s in (letter.get("sources") or [])[: L["sources"]] if isinstance(letter.get("sources"), list) else []:
                if isobj(s) and text(s.get("label"), L["label"]) and https(s.get("url")):
                    kept["sources"] += 1
                else:
                    dropped += 1
        else:
            dropped += 1
    elif "letter" in raw:
        dropped += 1
    for d in (raw.get("drills") or [])[: L["drills"]] if isinstance(raw.get("drills"), list) else []:
        if isobj(d) and text(d.get("title"), L["title"]) and text(d.get("text"), L["drill_text"]):
            kept["drills"] += 1
        else:
            dropped += 1
    for e in (raw.get("prompts") or [])[: L["days"]] if isinstance(raw.get("prompts"), list) else []:
        items = 0
        raw_items = e.get("items") if isobj(e) and isinstance(e.get("items"), list) else []
        for it in raw_items[: L["per_day"]]:
            if isobj(it) and text(it.get("text"), L["prompt"]):
                items += 1
            else:
                dropped += 1
        if isobj(e) and isinstance(e.get("day"), str) and DAY.match(e["day"]) and items:
            kept["prompt_days"] += 1
            kept["prompt_items"] += items
        else:
            dropped += 1

    def entries(o):
        return list(o.items())[: L["ids"]] if isobj(o) else []

    for i, b in entries(raw.get("baselines")):
        p = b.get("p") if isobj(b) else None
        if isobj(b) and isinstance(p, (int, float)) and not isinstance(p, bool) and 0.01 <= p <= 0.99 and day_of(b.get("written")) and text(b.get("ref"), L["ref"]) and ID.match(i):
            kept["baselines"] += 1
        else:
            dropped += 1
    for i, o in entries(raw.get("outcomes")):
        if isobj(o) and o.get("result") in RESULTS and https(o.get("source")) and day_of(o.get("checked")) and ID.match(i):
            kept["outcomes"] += 1
        else:
            dropped += 1
    for i, r in entries(raw.get("reads")):
        if isobj(r) and text(r.get("text"), L["read"]) and day_of(r.get("written")) and ID.match(i):
            kept["reads"] += 1
        else:
            dropped += 1
    return kept, dropped


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        raw = json.load(f)
    kept, dropped = parse(raw)
    print(json.dumps(kept))
    if dropped:
        print(f"{dropped} thing(s) would be dropped by the app: fix them before committing")
        sys.exit(1)
    print("coach file ok")


if __name__ == "__main__":
    main()

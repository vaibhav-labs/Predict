#!/usr/bin/env python3
"""Build app/content/questions/starter.json, the starter question bank for the gym.

Where the questions come from, and what that does and does not prove:
  * computed:   Python works the answer out (arithmetic, calendar, growth, probability).
  * definition: the answer follows from an exact definition (a unit, the lakh and the crore, a data type).
  * sourced:    the answer comes from a table in data/question_tables/. Each row there names the page it was read
                from and the day it was read. Claims keep clear of near ties, so two sources that differ by a few
                metres still agree. One page was read per row, except where sources.csv says two agree.
The difficulty labels (easy, medium, hard) are a designer's first guess from the size of the gap in each claim.
They are re-tuned from the player's own hit rates later.

Run:   python3 tools/make_questions.py           write the file
       python3 tools/make_questions.py --check   fail if the file on disk is not what the tables produce
Python 3 standard library only. Seeded: the same tables always give the same bank and the same ids.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qbank"))
import common  # noqa: E402
import computed  # noqa: E402
import sourced  # noqa: E402

TOTAL = 240
# Half true and half false, and the difficulty mix the gym is designed around (40 / 35 / 25).
QUOTA = {(True, "easy"): 48, (False, "easy"): 48, (True, "medium"): 42, (False, "medium"): 42, (True, "hard"): 30, (False, "hard"): 30}
# The most questions one kind of claim may supply, so no single template dominates the bank.
CAP = {
    "mul": 9, "thr": 6, "sq": 6, "prime": 8, "series": 6, "leap": 4, "w53": 3, "days": 3, "thirteenth": 1, "pow": 7, "dbl": 4, "pct": 7,
    "dice": 4, "sixes": 2, "bday": 4, "coin": 5, "monty": 1, "base": 2, "kids": 1, "cards": 1, "die": 1, "unit": 9, "indian": 4, "tech": 6,
    "planet": 28, "peak": 18, "country": 18, "state": 22, "element": 16, "event": 30, "evday": 4, "olympics": 8, "worldcup": 10,
}
FIELDS = ("id", "claim", "answer", "fact", "why", "domain", "diff", "source", "src_name", "checked", "verified")


def entities(c):
    """The real-world things a claim is about. A bank never carries two claims about the same event or tournament:
    the reveal of one would answer the other."""
    g, k = c["group"], c["key"]
    if g in ("event", "evday"):
        return set(re.findall(r"EV\d\d", k))
    if g == "olympics" and re.search(r":\d{4}$", k):
        return {"olympics:" + k[-4:]}
    if g == "worldcup":
        return {"wc:" + k[-4:]}
    return set()


def select(cands):
    import random
    rng = random.Random(f"{common.SEED}:select")
    used_keys, used_ents, chosen = set(), set(), []
    count = defaultdict(int)
    for cell in ((True, "hard"), (False, "hard"), (True, "easy"), (False, "easy"), (True, "medium"), (False, "medium")):
        need = QUOTA[cell]
        pool = [c for c in cands if (c["answer"], c["diff"]) == cell]
        rng.shuffle(pool)
        while need:
            open_ = [c for c in pool if c["key"] not in used_keys and count[c["group"]] < CAP[c["group"]] and not (entities(c) & used_ents)]
            if not open_:
                raise SystemExit(f"Not enough candidates for {cell}: short by {need}. Add generators or raise a cap.")
            best = min(open_, key=lambda c: count[c["group"]] / CAP[c["group"]])
            used_keys.add(best["key"])
            used_ents |= entities(best)
            count[best["group"]] += 1
            chosen.append(best)
            need -= 1
    return chosen


def build_bank():
    common.CANDS.clear()
    computed.generate()
    sourced.generate()
    assert all(g in CAP for g in {c["group"] for c in common.CANDS}), sorted({c["group"] for c in common.CANDS} - set(CAP))
    chosen = select(common.CANDS)
    order = {g: i for i, g in enumerate(CAP)}
    chosen.sort(key=lambda c: (order[c["group"]], common.cid(c)))
    questions = []
    for c in chosen:
        q = dict(c, id=common.cid(c))
        questions.append({f: q[f] for f in FIELDS})
    assert len(questions) == TOTAL
    return questions, chosen


def render(questions):
    head = json.dumps({"version": 1, "built": common.BANK_DATE, "count": len(questions),
                       "note": "Built by tools/make_questions.py from data/question_tables/. Do not edit by hand: change the tables or the generators and run it again."}, ensure_ascii=False)
    body = ",\n".join(json.dumps(q, ensure_ascii=False) for q in questions)
    return head[:-1] + ',\n"questions":[\n' + body + "\n]}\n"


def summary(questions, chosen):
    lines = [f"{len(questions)} questions"]
    lines.append("true/false: " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(q["answer"] for q in questions).items())))
    lines.append("difficulty: " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(q["diff"] for q in questions).items())))
    lines.append("domain: " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(q["domain"] for q in questions).items())))
    lines.append("verified: " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(q["verified"] for q in questions).items())))
    lines.append("groups: " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(c["group"] for c in chosen).items())))
    return "\n".join(lines)


def main():
    questions, chosen = build_bank()
    text = render(questions)
    if "--check" in sys.argv:
        try:
            on_disk = open(common.OUT, encoding="utf-8").read()
        except FileNotFoundError:
            print(f"{os.path.relpath(common.OUT, common.ROOT)} is missing: run python3 tools/make_questions.py")
            sys.exit(1)
        if on_disk != text:
            print(f"{os.path.relpath(common.OUT, common.ROOT)} is not what the tables produce: run python3 tools/make_questions.py and commit the result")
            sys.exit(1)
        print("starter.json matches the tables")
        return
    os.makedirs(os.path.dirname(common.OUT), exist_ok=True)
    with open(common.OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(summary(questions, chosen))
    print("wrote", os.path.relpath(common.OUT, common.ROOT))


if __name__ == "__main__":
    main()

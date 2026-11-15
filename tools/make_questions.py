#!/usr/bin/env python3
"""Build the gym's question banks: app/content/questions/starter.json (240 questions, for the baseline and practice) and
app/content/questions/exam-u1.json (the Unit 1 exam pool, questions practice never serves).

The gym asks judgment calls, not trivia. Every question sets a scene (the lead) and asks how it turns out (the ask). Where
the questions come from, and what that does and does not prove:
  * recorded: a real case drawn from a record in data/question_tables/ (a day of Seattle weather, a flight, a country's
              figures, a year of the stock market). The answer is what the record shows. `base` is how often the same kind
              of case turned out that way among the other cases in the record, which is also what sets the difficulty.
              tools/snapshot_tables.py wrote those records once; nothing here goes online.
  * sourced:  a base rate documented by a named source (data/question_tables/base_rates.csv), with its page and the day
              it was read. Claims keep clear of near ties.
Cases are drawn at random from each kind, never picked for how they turn out, so the bank is as predictable as the records
are. tools/check_questions.py tests exactly that: a player who knew every base rate would be calibrated on this bank.

Run:   python3 tools/make_questions.py           write the files
       python3 tools/make_questions.py --check   fail if the files on disk are not what the tables produce
Python 3 standard library only. Seeded: the same tables always give the same banks and the same ids.
"""
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qbank"))
import common  # noqa: E402
import curated  # noqa: E402
import records  # noqa: E402

TOTAL = 240
EXAM_TOTAL = 304
EXAM_OUT = os.path.join(common.ROOT, "app", "content", "questions", "exam-u1.json")
# Half true and half false, and the difficulty mix the gym is designed around (40 / 35 / 25).
QUOTA = {(True, "easy"): 48, (False, "easy"): 48, (True, "medium"): 42, (False, "medium"): 42, (True, "hard"): 30, (False, "hard"): 30}
# The Unit 1 exam pool leans hard (gym.exam_mix is 7 / 38 / 55): its questions are never shown in practice, so an exam call is always fresh.
EXAM_QUOTA = {(True, "easy"): 12, (False, "easy"): 12, (True, "medium"): 57, (False, "medium"): 57, (True, "hard"): 83, (False, "hard"): 83}
# The most questions one kind of claim may supply to a bank, so no single template dominates it. A cap is also a weight: the builder fills
# every kind in proportion to its cap, within what the cells and the records allow, so the caps add up to more than the bank's size
# (the builder never fills a kind past its cap, and the spare room is what lets it fill a cell when a case is ruled out for sharing a
# day, flight, country or year with one already chosen). The exam pool has its own caps: it leans hard, and only some kinds can supply
# hard questions. Markets get small caps because a year can appear only once in a bank, and there are 73 of them.
CAP = {
    "wrain": 22, "wstreak": 13, "whigh": 18, "wfreeze": 8, "wheavy": 6, "wrevert": 13,
    "flate": 26, "fhour": 14, "fearly": 18, "forigin": 14,
    "tlife": 14, "tchild": 14, "tco2": 15, "tgdp": 12, "trenew": 15, "tfert": 15,
    "myup": 2, "mydrop10": 2, "mygain20": 1, "myafterdown": 1, "myafterboom": 1, "mw5n": 1, "mw5r": 1, "mw10n": 1, "mw10r": 1, "mw20r": 1,
    "cbiz": 3, "cfund": 3, "cproj": 2, "csport": 3, "cbio": 2, "clife": 2, "cwx": 1, "ctrav": 1, "cworld": 3,
}
EXAM_CAP = {
    "wrain": 26, "wstreak": 12, "whigh": 26, "wfreeze": 8, "wheavy": 6, "wrevert": 18,
    "flate": 18, "fhour": 10, "fearly": 44, "forigin": 26,
    "tlife": 12, "tchild": 12, "tco2": 30, "tgdp": 20, "trenew": 26, "tfert": 18,
    "myup": 1, "mydrop10": 1, "mygain20": 1, "myafterdown": 1, "myafterboom": 1, "mw5n": 1, "mw5r": 1, "mw10n": 1, "mw10r": 1, "mw20r": 1,
    "cbiz": 3, "cfund": 3, "cproj": 3, "csport": 3, "cbio": 3, "clife": 2, "cwx": 2, "ctrav": 1, "cworld": 3,
}
FIELDS = ("id", "lead", "ask", "claim", "answer", "base", "n", "fact", "why", "domain", "diff", "verified", "source", "src_name", "checked")


def allocate(avail, quota, cap):
    """How many questions each kind of claim gives each cell. A max-flow, filled one question at a time: the kind that has used the
    smallest share of its cap goes next, and a kind may take a place in a cell by moving another kind's question to a different
    cell it can also fill. So the kinds end up filled in proportion to their caps, within what the cells and the records allow."""
    groups = sorted({g for g, _ in avail})
    cells = sorted(quota, key=str)
    edges = defaultdict(int)
    for g in groups:
        edges[("s", ("g", g))] = cap[g]
    for (g, cell), n in avail.items():
        edges[(("g", g), ("c", cell))] = n
    for cell in cells:
        edges[(("c", cell), "t")] = quota[cell]
    nxt = defaultdict(list)
    for a, b in list(edges):
        nxt[a].append(b)
        nxt[b].append(a)
    flow = defaultdict(int)
    used = {g: 0 for g in groups}

    def add_one(g):
        """Find a path from the source through kind g to the sink in the residual network (never back through the source, so no
        other kind loses a question) and push one question along it."""
        start = ("g", g)
        if flow[("s", start)] >= edges[("s", start)]:
            return False
        prev, queue = {start: "s"}, [start]
        for u in queue:
            for v in nxt[u]:
                if v != "s" and v not in prev and edges[(u, v)] - flow[(u, v)] > 0:
                    prev[v] = u
                    queue.append(v)
        if "t" not in prev:
            return False
        v = "t"
        while v != "s":
            u = prev[v]
            flow[(u, v)] += 1
            flow[(v, u)] -= 1
            v = u
        return True

    need = sum(quota.values())
    for done in range(need):
        for g in sorted(groups, key=lambda g: (used[g] / cap[g], g)):
            if add_one(g):
                used[g] += 1
                break
        else:
            raise SystemExit(f"The quotas cannot be met from these kinds of claim and their caps: short by {need - done}. Add generators or raise a cap.")
    return {(g, cell): flow[(("g", g), ("c", cell))] for g in groups for cell in cells if flow[(("g", g), ("c", cell))] > 0}


def select(cands, quota, cap, used_keys=frozenset(), used_ents=frozenset(), used_claims=frozenset(), label="starter"):
    """Pick questions cell by cell (true or false, easy or medium or hard). Within a kind and a cell the order is random and blind to
    how a case turned out, so the bank keeps the records' own odds."""
    rng = random.Random(f"{common.SEED}:select:{label}")
    used_keys, used_ents, used_claims = set(used_keys), set(used_ents), set(used_claims)
    pools = defaultdict(list)
    for c in cands:
        if c["key"] not in used_keys:
            pools[(c["group"], (c["answer"], c["diff"]))].append(c)
    for k in sorted(pools, key=str):
        rng.shuffle(pools[k])
    avail = {k: len({c["key"] for c in v}) for k, v in pools.items()}
    alloc = allocate(avail, quota, cap)
    chosen, count = [], defaultdict(int)

    def take(c):
        used_keys.add(c["key"])
        used_ents.update(c["ents"])
        used_claims.add(c["claim"])
        count[c["group"]] += 1
        chosen.append(c)

    def free(c):
        return c["key"] not in used_keys and c["claim"] not in used_claims and not (set(c["ents"]) & used_ents)

    short = {}
    for cell in sorted(quota, key=str):
        got = 0
        for g in sorted({g for g, c in alloc if c == cell}):
            for c in pools[(g, cell)]:
                if got >= quota[cell] or sum(1 for x in chosen if x["group"] == g and (x["answer"], x["diff"]) == cell) >= alloc[(g, cell)]:
                    break
                if free(c):
                    take(c)
                    got += 1
        short[cell] = quota[cell] - got
    # A case ruled out because it clashed with one already chosen (the same day, flight, country or year) leaves a cell short:
    # fill it from any kind that still has allowance.
    for cell, need in short.items():
        while need:
            open_ = [c for g in sorted({g for g, cc in pools if cc == cell}) for c in pools[(g, cell)] if free(c) and count[c["group"]] < cap[c["group"]]]
            if not open_:
                raise SystemExit(f"Not enough candidates for {cell}: short by {need}. Add generators or raise a cap.")
            take(min(open_, key=lambda c: count[c["group"]] / cap[c["group"]]))
            need -= 1
    return chosen


def finish(chosen):
    order = {g: i for i, g in enumerate(CAP)}
    chosen = sorted(chosen, key=lambda c: (order[c["group"]], common.cid(c)))
    return [{f: dict(c, id=common.cid(c))[f] for f in FIELDS} for c in chosen], chosen


def build_banks():
    common.CANDS.clear()
    records.generate()
    curated.generate()
    cands = common.CANDS
    assert all(g in CAP and g in EXAM_CAP for g in {c["group"] for c in cands}), sorted({c["group"] for c in cands} - set(CAP))
    starter_chosen = select(cands, QUOTA, CAP, label="starter")
    questions, starter_chosen = finish(starter_chosen)
    assert len(questions) == TOTAL
    # The exam pool never repeats a case, or a case about the same day, flight, country or year, that the starter bank already shows:
    # a practice reveal must not give an exam answer away.
    ents = set().union(*[set(c["ents"]) for c in starter_chosen])
    exam_chosen = select(cands, EXAM_QUOTA, EXAM_CAP, used_keys={c["key"] for c in starter_chosen}, used_ents=ents, used_claims={c["claim"] for c in starter_chosen}, label="exam")
    exam, exam_chosen = finish(exam_chosen)
    assert len(exam) == EXAM_TOTAL
    return questions, starter_chosen, exam, exam_chosen


def render(questions, pool=None):
    meta = {"version": 2, "built": common.BANK_DATE, "count": len(questions)}
    if pool:
        meta["pool"] = pool
    meta["note"] = "Built by tools/make_questions.py from data/question_tables/. Do not edit by hand: change the tables or the generators and run it again."
    head = json.dumps(meta, ensure_ascii=False)
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
    questions, chosen, exam, exam_chosen = build_banks()
    files = [(common.OUT, render(questions)), (EXAM_OUT, render(exam, pool="exam-u1"))]
    if "--check" in sys.argv:
        for path, text in files:
            name = os.path.relpath(path, common.ROOT)
            try:
                on_disk = open(path, encoding="utf-8").read()
            except FileNotFoundError:
                print(f"{name} is missing: run python3 tools/make_questions.py")
                sys.exit(1)
            if on_disk != text:
                print(f"{name} is not what the tables produce: run python3 tools/make_questions.py and commit the result")
                sys.exit(1)
        print("starter.json and exam-u1.json match the tables")
        return
    os.makedirs(os.path.dirname(common.OUT), exist_ok=True)
    for path, text in files:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", os.path.relpath(path, common.ROOT))
    print("starter bank:\n" + summary(questions, chosen))
    print("exam pool:\n" + summary(exam, exam_chosen))


if __name__ == "__main__":
    main()

"""Shared pieces for the question-bank builder (tools/make_questions.py).

A candidate is one claim the gym could show. Every fact gets a key; a key can have two variants (one true claim,
one false claim) and the selection step uses at most one of them, so a player never meets both halves of a fact.
"""
import csv
import hashlib
import os
import random

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TABLES = os.path.join(ROOT, "data", "question_tables")
OUT = os.path.join(ROOT, "app", "content", "questions", "starter.json")

SEED = "predict-starter-1"
BANK_DATE = "2026-11-15"  # the day the tables were read; shown to the player as "Checked <date>"
DOMAINS = ("numbers", "chance", "science", "geography", "economy", "world", "technology")
DIFFS = ("easy", "medium", "hard")
VERIFIED = ("computed", "definition", "sourced")

CANDS = []


def read(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def rng_for(group):
    """Each group has its own random stream, so adding a group never reshuffles another."""
    return random.Random(f"{SEED}:{group}")


def add(group, key, variant, claim, answer, fact, why, domain, diff, verified, source="computed", src_name="", checked=""):
    assert domain in DOMAINS, domain
    assert diff in DIFFS, diff
    assert verified in VERIFIED, verified
    assert variant in ("t", "f", "x"), variant
    CANDS.append(dict(group=group, key=f"{group}:{key}", variant=variant, claim=claim, answer=bool(answer), fact=fact,
                      why=why, domain=domain, diff=diff, verified=verified, source=source, src_name=src_name, checked=checked))


def both(group, key, true_claim, false_claim, fact_true, fact_false, why, domain, diff, verified, **src):
    """The usual pair: one true claim and one false claim about the same fact."""
    add(group, key, "t", true_claim, True, fact_true, why, domain, diff, verified, **src)
    add(group, key, "f", false_claim, False, fact_false, why, domain, diff, verified, **src)


def claim_pair(group, key, text_if_true, text_if_false, truth, fact, why, domain, diff, verified, **src):
    """Two opposite statements about one fact (for example 'greater than' and 'less than'): whichever is true is
    the true variant, the other is the false one."""
    add(group, key, "t", text_if_true if truth else text_if_false, True, fact, why, domain, diff, verified, **src)
    add(group, key, "f", text_if_false if truth else text_if_true, False, fact, why, domain, diff, verified, **src)


def ratio_diff(r):
    """How hard it is to tell two quantities apart: a big ratio is easy, a near tie is hard."""
    r = max(r, 1 / r) if r > 0 else 1e9
    return "easy" if r >= 2.5 else "medium" if r >= 1.35 else "hard"


def margin_diff(m):
    """How hard a threshold claim is: far from the threshold is easy, close to it is hard."""
    m = abs(m)
    return "easy" if m >= 0.25 else "medium" if m >= 0.08 else "hard"


def cid(c):
    """Stable id from the fact key and variant, so an id never changes meaning when the bank grows."""
    h = hashlib.sha1(f"{c['key']}|{c['variant']}".encode("utf-8")).hexdigest()[:7]
    return f"{c['group'].replace('_', '')[:4]}-{h}"


def lc_first(text):
    """Lower-case the first word only when it is a plain article, so proper names stay as they are."""
    for art in ("The ", "A ", "An "):
        if text.startswith(art):
            return art.lower() + text[len(art):]
    return text


def words(x):
    """A round number in plain words, for thresholds in a claim."""
    for size, name in ((10**18, "quintillion"), (10**15, "quadrillion"), (10**12, "trillion"), (10**9, "billion"), (10**6, "million")):
        if x >= size:
            v = x / size
            return f"{v:g} {name}"
    return f"{int(x):,}"

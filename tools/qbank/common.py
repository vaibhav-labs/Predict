"""Shared pieces for the question-bank builder (tools/make_questions.py).

A candidate is one claim the gym could show. The gym asks judgment calls, not trivia: each question sets a scene (the
`lead`: where, when, what has happened so far) and then makes a claim about how it turns out (the `ask`). The player says
yes or no and how sure they are, and the reveal shows what really happened and how often it goes that way.

Every fact gets a key. A fact has two variants, the claim that turned out true and the claim that turned out false, and
the selection step uses at most one of them, so a player never meets both halves of a fact.

`base` is the chance that this variant's claim is true, judged from the other cases of the same kind in the record (the
case itself is left out). Difficulty is how lopsided that chance is: a claim that goes one way 85 times in 100 is easy to
call, one that is nearly a coin flip is hard.
"""
import csv
import hashlib
import os
import random

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TABLES = os.path.join(ROOT, "data", "question_tables")
OUT = os.path.join(ROOT, "app", "content", "questions", "starter.json")

SEED = "predict-judgment-1"
BANK_DATE = "2026-11-15"  # the day the records were read; shown to the player as "Checked <date>"
DOMAINS = ("weather", "travel", "money", "work", "world", "sport", "life")
DIFFS = ("easy", "medium", "hard")
VERIFIED = ("recorded", "sourced")
EASY_AT, MEDIUM_AT = 0.85, 0.68  # how lopsided a claim's chance must be to be called easy, or medium

CANDS = []


def read(name):
    with open(os.path.join(TABLES, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def source_of(table):
    """The link and the name shown for a record, read from data/question_tables/sources.csv so a question can never cite something else."""
    for r in read("sources.csv"):
        if r["table"] == table:
            return r["source_url"], r["source_name"]
    raise SystemExit(f"data/question_tables/sources.csv has no row for {table}")


def rng_for(group):
    """Each group has its own random stream, so adding a group never reshuffles another."""
    return random.Random(f"{SEED}:{group}")


def pct(x):
    """A chance as a whole percent. The checker rounds the same way: half goes up."""
    return f"{int(x * 100 + 0.5)}%"


def predictability(p):
    return max(p, 1 - p)


def diff_for(p):
    """How easy a claim is to call, from how lopsided its chance is."""
    q = predictability(p)
    return "easy" if q >= EASY_AT - 1e-9 else "medium" if q >= MEDIUM_AT - 1e-9 else "hard"


def add(group, key, variant, lead, ask, answer, base, n, fact, why, domain, diff, verified, source, src_name, checked, ents=()):
    assert domain in DOMAINS, domain
    assert diff in DIFFS, diff
    assert verified in VERIFIED, verified
    assert variant[:1] in ("t", "f"), variant  # "t" is the claim that turned out true, "f" the one that turned out false; sourced facts add ":<threshold>"
    assert ask and ask.strip() == ask and (not lead or lead.strip() == lead), (lead, ask)
    claim = f"{lead} {ask}" if lead else ask
    CANDS.append(dict(group=group, key=f"{group}:{key}", variant=variant, lead=lead, ask=ask, claim=claim, answer=bool(answer),
                      base=None if base is None else round(base, 4), n=int(n), fact=fact, why=why, domain=domain, diff=diff,
                      verified=verified, source=source, src_name=src_name, checked=checked, ents=tuple(ents)))


def pair(group, key, lead, ask_yes, ask_no, happened, p_event, n, fact, why, domain, source, src_name, checked=BANK_DATE, ents=(), diff=None, verified="recorded"):
    """The usual pair for a recorded event. `ask_yes` says the event happens, `ask_no` says it does not, `happened` is what
    the record shows, and `p_event` is how often the event happened in the other cases of the same kind. The variant that
    matches the record is the true one."""
    if p_event >= 0.995 or p_event <= 0.005:
        return  # a class where it always went one way is not a probability, only a small sample: leave it out
    d = diff or diff_for(p_event)
    true_ask = ask_yes if happened else ask_no
    false_ask = ask_no if happened else ask_yes
    for variant, ask, answer in (("t", true_ask, True), ("f", false_ask, False)):
        base = p_event if ask == ask_yes else 1 - p_event
        add(group, key, variant, lead, ask, answer, base, n, fact, why, domain, d, verified, source, src_name, checked, ents)


def cid(c):
    """Stable id from the fact key and variant, so an id never changes meaning when the bank grows."""
    h = hashlib.sha1(f"{c['key']}|{c['variant']}".encode("utf-8")).hexdigest()[:7]
    return f"{c['group'].replace('_', '')[:4]}-{h}"


def loo(k, n, own):
    """Rate among the other cases: `k` of `n` cases had the event, and this case is one of them if `own` is 1."""
    return (k - own) / (n - 1)

"""Judgment questions from documented base rates (verified = "sourced").

Each row of data/question_tables/base_rates.csv is one documented fact: a rate, or a range of rates, published by a named source,
with the page it came from, the day it was read, and the words (or the table row) that show the number. A fact becomes questions
the same way every time. The lead sets the scene (a case of some kind), and the ask makes a claim about how cases of that kind
usually turn out: "More than 40% of ... " or "Fewer than 40% of ...", for each threshold the row lists.

A claim is only true or false when its threshold is clear of the documented value, so every threshold has to sit outside the range
(the documented numbers, widened by the rounding the source used) and at least MIN_MARGIN away from it. How far away sets the
difficulty: a threshold far from the documented value is easy to call, one just outside it is hard. The margin is measured on the
log-odds scale for shares (so 5% against 2% is a big gap, as it feels) and on the log scale for plain quantities.

Sourced questions carry no `base`: there is no record to count cases in, only the source. One fact gives at most one question to
a bank (its key is the fact's id), so the starter bank and the exam pool never both show the same fact.

tools/check_questions.py reads the same table with its own code and works every claim out again.
"""
import math

import common

# A theme groups facts that a player would see as one subject (new businesses, funds and stocks, big projects, sport, drug
# development, health and learning, hurricanes, flights, the wider world). tools/make_questions.py caps what each theme may give a
# bank, so no single subject fills it.
GROUPS = ("cbiz", "cfund", "cproj", "csport", "cbio", "clife", "cwx", "ctrav", "cworld")
MIN_MARGIN = 0.25       # a threshold nearer the documented value than this is too close to call, and is rejected
EASY_MARGIN, MEDIUM_MARGIN = 1.2, 0.5
SCALES = ("share", "ratio")


def logit(p):
    p = min(max(p, 0.005), 0.995)  # a share of exactly 0 or 100 is read as 0.5% or 99.5%
    return math.log(p / (1 - p))


def margin(scale, low, high, t):
    """How far a threshold sits outside the documented range [low, high] (a positive number)."""
    if scale == "share":
        return logit(low / 100) - logit(t / 100) if t < low else logit(t / 100) - logit(high / 100)
    return math.log(low / t) if t < low else math.log(t / high)


def diff_for_margin(m):
    return "easy" if m >= EASY_MARGIN else "medium" if m >= MEDIUM_MARGIN else "hard"


def generate():
    seen = set()
    for r in common.read("base_rates.csv"):
        if r["id"] in seen:
            raise SystemExit(f"base_rates.csv: duplicate fact id {r['id']}")
        seen.add(r["id"])
        group, scale = r["group"], r["scale"]
        if group not in GROUPS:
            raise SystemExit(f"base_rates.csv: {r['id']} is in the group {group}, which is not one of {GROUPS}")
        if scale not in SCALES:
            raise SystemExit(f"base_rates.csv: {r['id']} has the scale {scale}, expected one of {SCALES}")
        low, high = float(r["doc_low"]) - float(r["pad"]), float(r["doc_high"]) + float(r["pad"])
        n = int(r["n"]) if r["n"] else 0
        for text in r["thresholds"].split(";"):
            t = float(text)
            if low <= t <= high:
                raise SystemExit(f"base_rates.csv: {r['id']}: the threshold {text} falls inside the documented range {low:g} to {high:g}")
            m = margin(scale, low, high, t)
            if m < MIN_MARGIN:
                raise SystemExit(f"base_rates.csv: {r['id']}: the threshold {text} is too close to the documented range {low:g} to {high:g}")
            diff = diff_for_margin(m)
            more_is_true = t < low
            stems = {True: r["stem_more"], False: r["stem_fewer"]}
            say = lambda stem: stem.replace("{t}", f"{t:g}")
            for variant, ask, answer in ((f"t:{text}", say(stems[more_is_true]), True), (f"f:{text}", say(stems[not more_is_true]), False)):
                common.add(group, r["id"], variant, r["lead"], ask, answer, None, n, r["fact"], r["why"], r["domain"], diff, "sourced",
                           r["source_url"], r["source_name"], r["checked"], ents=(f"cur:{r['id']}",))

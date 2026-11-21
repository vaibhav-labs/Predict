#!/usr/bin/env python3
"""Check the Unit 7 to 9 bank (app/content/questions/know.json) with code that shares nothing with tools/make_know.py.

Every answer is worked out again from the numbers on the item: the Bayes posterior of a second number, the expected value and break-even of a decision,
the luck-or-judgment square from whether the call hit and whether the process was sound. A counter-argument item must have exactly one strong option and
four distinct options; a luck item's text must contain a cue from the sound pool exactly when its process is sound (and from the flawed pool when it is
flawed, never both); no option leaks the answer by length alone (the right one is not always the longest); pools, ids and sizes; no text names the
assistant; and the file is what the builder writes. Python 3 standard library only. Exit 1 on any failure.
"""
import json
import os
import re
import subprocess
import sys
from fractions import Fraction as F

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BANK = os.path.join(ROOT, "app", "content", "questions", "know.json")
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json")))
G = CFG["gates"]
sys.path.insert(0, os.path.join(ROOT, "tools", "qbank"))
import know_scenes as K  # noqa: E402

fails = []


def check(ok, msg):
    if not ok:
        fails.append(msg)


def main():
    d = json.load(open(BANK, encoding="utf-8"))
    qs = d["questions"]
    ids = [q["id"] for q in qs]
    check(len(ids) == len(set(ids)), "duplicate ids")
    by = {}
    for q in qs:
        by.setdefault((q["family"], q["pool"]), []).append(q)
        text = json.dumps(q, ensure_ascii=False)
        check(not re.search(r"claude|anthropic", text, re.I), f"{q['id']}: names the assistant")
        check(q["type"] == "choice" and q["pool"] in ("practice", "exam"), f"{q['id']}: type or pool")
        check(isinstance(q["right"], int) and 0 <= q["right"] < len(q["options"]), f"{q['id']}: right index")
        check(len(set(q["options"])) == len(q["options"]), f"{q['id']}: repeated option")
        check(all(0 < len(o) <= 240 for o in q["options"]), f"{q['id']}: option length")
        check(q["unit"] == {"counter": "U7", "second": "U7", "luck": "U8", "act": "U9", "threshold": "U9", "value": "U9"}[q["family"]], f"{q['id']}: unit")

    # sizes: the exams draw from their own pools and need at least one whole attempt of fresh problems
    need = {"counter": G["counter_exam_calls"], "luck": G["luck_exam_calls"]}
    for fam, n in need.items():
        check(len(by.get((fam, "exam"), [])) >= n, f"{fam}: exam pool smaller than one attempt ({n})")
        check(len(by.get((fam, "practice"), [])) >= 36, f"{fam}: practice pool too small")
    dec_exam = sum(len(by.get((f, "exam"), [])) for f in ("act", "threshold", "value"))
    check(dec_exam >= G["decision_exam_calls"] * 2, "decision exam pool smaller than two attempts")
    check(len(by.get(("second", "exam"), [])) == 0, "second-number items belong to practice only")
    # no claim in both pools (counter and luck scenes are split by pool)
    for fam in ("counter", "luck"):
        lp = {q["lead"] for q in by.get((fam, "practice"), [])}
        le = {q["lead"] for q in by.get((fam, "exam"), [])}
        check(not (lp & le), f"{fam}: the same lead in both pools")
    # the exam leads never start from the same scene or claim as a practice lead
    cl_p = {re.sub(r"^You forecast \d+% that ", "", q["lead"]) for q in by.get(("counter", "practice"), [])}
    cl_e = {re.sub(r"^You forecast \d+% that ", "", q["lead"]) for q in by.get(("counter", "exam"), [])}
    check(not (cl_p & cl_e), "counter: a claim in both pools")

    longest = {"counter": 0, "threshold": 0, "n": {"counter": 0}}
    for q in qs:
        f = q["family"]
        if f == "counter":
            tags = q["tags"]
            check(tags.count("strong") == 1 and q["right"] == tags.index("strong"), f"{q['id']}: exactly one strong option, and it is the right one")
            check(set(tags) <= {"strong", "supports", "beside", "tiny", "vague"} and len(set(tags)) == 4, f"{q['id']}: four different kinds of option")
            lens = [len(o) for o in q["options"]]
            longest["n"]["counter"] += 1
            if lens[q["right"]] == max(lens):
                longest["counter"] += 1
        elif f == "second":
            prior, lr = q["prior"], q["lr"]
            odds = F(prior, 100) / (1 - F(prior, 100)) / F(lr)
            post = odds / (1 + odds)
            right = round(post * 100)
            vals = [int(o.rstrip("%")) for o in q["options"]]
            check(vals[q["right"]] == right, f"{q['id']}: right option {vals[q['right']]} but the posterior is {float(post * 100):.2f}")
            sv = sorted(vals)
            check(len(set(vals)) == 4 and all(sv[i + 1] - sv[i] >= 4 for i in range(3)), f"{q['id']}: options too close")
            check(abs(float(post * 100) - right) < 0.5 + 1e-9, f"{q['id']}: rounding")
            check(prior in vals and any(v > prior for v in vals) and any(v < right for v in vals), f"{q['id']}: stay / wrong-way / overshoot options")
        elif f == "luck":
            hit, process = q["hit"], q["process"]
            label = {(True, "sound"): "Good judgment", (True, "flawed"): "Good luck", (False, "sound"): "Bad luck", (False, "flawed"): "Bad judgment"}[(hit, process)]
            check(q["options"][q["right"]] == label, f"{q['id']}: answer should be {label}")
            in_sound = [c for c in K.SOUND if c in q["lead"]]
            in_flawed = [c for c in K.FLAWED if c in q["lead"]]
            check(len(in_sound) == (1 if process == "sound" else 0) and len(in_flawed) == (1 if process == "flawed" else 0), f"{q['id']}: the cue in the text does not match the process")
            scene_hit = any(h in q["lead"] for _, h, _ in K.SCENES)
            scene_miss = any(m in q["lead"] for _, _, m in K.SCENES)
            check(scene_hit == hit and scene_miss == (not hit), f"{q['id']}: the result in the text does not match hit")
            check(q["options"] == K.LABELS, f"{q['id']}: options")
        elif f == "act":
            p, g, l = q["p"], q["gain"], q["loss"]
            ev = F(p, 100) * g - (1 - F(p, 100)) * l
            check(ev != 0, f"{q['id']}: a tie")
            check(q["options"][q["right"]] == ("Act" if ev > 0 else "Hold off"), f"{q['id']}: act or hold")
        elif f == "threshold":
            g, l = q["gain"], q["loss"]
            t = F(l, g + l) * 100
            vals = [int(o.rstrip("%")) for o in q["options"]]
            check(vals[q["right"]] == round(t), f"{q['id']}: break-even is {float(t):.2f}")
            sv = sorted(vals)
            check(len(set(vals)) == 4 and all(sv[i + 1] - sv[i] >= 4 for i in range(3)), f"{q['id']}: options too close")
        elif f == "value":
            p, g, l = q["p"], q["gain"], q["loss"]
            ev = F(p, 100) * g - (1 - F(p, 100)) * l
            check(ev.denominator == 1, f"{q['id']}: not a whole number")
            vals = [int(o) for o in q["options"]]
            check(vals[q["right"]] == ev, f"{q['id']}: value is {ev}")
            sv = sorted(vals)
            check(len(set(vals)) == 4 and all(sv[i + 1] - sv[i] >= 3 for i in range(3)), f"{q['id']}: options too close")
    n = longest["n"]["counter"]
    check(longest["counter"] / n < 0.75, f"counter: the right option is the longest in {longest['counter']} of {n} items: length gives it away")
    # the act items: about half sit where the 50% instinct is wrong
    acts = [q for q in qs if q["family"] == "act"]
    trap = sum(1 for q in acts if (q["p"] < 50) == (F(q["p"], 100) * q["gain"] - (1 - F(q["p"], 100)) * q["loss"] > 0))
    check(0.4 <= trap / len(acts) <= 0.6, f"act: {trap} of {len(acts)} items beat the 50% instinct")
    # right answers spread across positions
    for fam in ("counter", "luck", "second", "threshold", "value"):
        pos = [q["right"] for q in qs if q["family"] == fam]
        k = max(pos) + 1
        for i in range(k):
            share = pos.count(i) / len(pos)
            check(share < 0.45, f"{fam}: the right answer sits in position {i + 1} in {share:.0%} of items")
    # the builder
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_know.py"), "--check"], capture_output=True, text=True)
    check(r.returncode == 0, "know.json is not what make_know.py writes")
    if fails:
        for m in fails[:40]:
            print("FAIL", m)
        print(f"{len(fails)} failure(s)")
        sys.exit(1)
    print(f"know bank ok: {len(qs)} items ({', '.join(f'{k[0]}/{k[1]} {len(v)}' for k, v in sorted(by.items()))}); the right counter option is the longest in {longest['counter']} of {n}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build the Unit 7 to 9 bank (app/content/questions/know.json): choice problems with one right option, computed from the numbers on each item.

  counter   (Unit 7) which of four counter-arguments is the strongest: one is specific and bears on the claim, the others support it, are true but beside
            the point, are tiny, or are vague
  second    (Unit 7 practice) how far a counter-argument that is N times likelier if the claim is false should move a number (Bayes)
  luck      (Unit 8) was a result luck or judgment: the call hit or missed, the process was sound or flawed
  act       (Unit 9) act or hold, given a chance, a gain and a loss
  threshold (Unit 9) where acting breaks even
  value     (Unit 9) what acting is worth on average

Deterministic: the same seed writes the same file. tools/check_know.py re-derives every answer with code that shares nothing with this file.
Usage: python3 tools/make_know.py [--check]   (--check exits 1 if the file on disk differs from what this would write)
"""
import json
import os
import random
import sys
from fractions import Fraction as F

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "qbank"))
import know_scenes as K  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "app", "content", "questions", "know.json")
SEED = "predict-know-1"
BANK_DATE = "2026-11-16"

VAGUE = [
    "Things don't always go the way people expect, and this could be one of those times when it doesn't.",
    "There is always some chance something goes wrong, and with this much going on it is hard to say it won't.",
    "It is hard to be sure about anything like this, so a forecast this confident seems a bit much.",
    "Plans like this can go either way, and people who have been through it say it is easy to be caught out.",
    "Nobody can really know how this will turn out, which is a reason to be careful with a high number.",
    "Anything could happen between now and then, and some of it may not be what you have planned for.",
    "People are often too optimistic about this kind of thing, and it would not be a surprise if that is true here.",
    "It might not work out, in general, as these things sometimes don't, whatever the plan says.",
]
TAILS = {
    "supports": ["It points to things going smoothly.", "That makes the forecast look about right.", "It suggests the plan is on track."],
    "beside": ["It was mentioned in passing last week.", "Several people have commented on it.", "It is the sort of detail people notice."],
    "tiny": ["It is possible, but it would cost very little if it happened.", "It is a real risk, though a small one.", "It would be a minor nuisance if it happened."],
}


def rng_for(*parts):
    return random.Random("|".join(str(p) for p in (SEED,) + parts))


def pct(x):
    return f"{x}%"


# ---- counter (Unit 7) -----------------------------------------------------------------------------------------------
def counters():
    out = []
    for i, (dom, claim, p, a, b, pos, side, minor) in enumerate(K.COUNTERS):
        pool = "practice" if i % 2 == 0 else "exam"
        for form, strong in (("a", a), ("b", b)):
            r = rng_for("counter", i, form)
            others = [("supports", pos + " " + r.choice(TAILS["supports"])), ("beside", side + " " + r.choice(TAILS["beside"])), ("tiny", minor + " " + r.choice(TAILS["tiny"])), ("vague", r.choice(VAGUE))]
            r.shuffle(others)
            picks = [("strong", strong)] + others[:3]
            r.shuffle(picks)
            tags = [t for t, _ in picks]
            out.append({
                "id": f"ctr-{i:02d}{form}", "type": "choice", "family": "counter", "kind": "counter", "unit": "U7", "pool": pool, "domain": dom, "jdomain": dom,
                "lead": f"You forecast {p}% that {claim}.", "ask": "Which of these is the strongest argument against your forecast?",
                "options": [t for _, t in picks], "tags": tags, "right": tags.index("strong"), "p": p,
                "fact": f"The strongest is: “{strong}” It is specific, it bears on whether the claim comes true, and your {p}% does not already allow for it.",
                "why": "A good case against names something you can check and that moves the odds. A point that supports your forecast is not against it, a true fact beside the point changes nothing, a tiny risk moves it a little, and a vague worry moves it not at all.",
                "verified": "computed", "checked": BANK_DATE,
            })
    return out


# ---- second (Unit 7 practice) -------------------------------------------------------------------------------------------------
def posterior(prior, lr):
    odds = F(prior, 100) / (1 - F(prior, 100)) / F(lr)
    return odds / (1 + odds)


def seconds():
    out = []
    n = 0
    for i, (text, lr) in enumerate(K.EVIDENCE):
        for k in range(2):
            r = rng_for("second", i, k)
            for _ in range(200):
                prior = r.choice([60, 65, 70, 75, 80, 85, 90])
                post = round(float(posterior(prior, lr) * 100))
                drop = prior - post
                over = max(1, prior - 2 * drop)
                wrong = min(99, prior + max(5, round(drop / 2)))
                opts = {"stay": prior, "right": post, "over": over, "wrong": wrong}
                vals = sorted(opts.values())
                if all(vals[j + 1] - vals[j] >= 4 for j in range(3)) and 1 <= min(vals) and max(vals) <= 99:
                    break
            else:
                continue
            items = list(opts.items())
            r.shuffle(items)
            tags = [t for t, _ in items]
            n += 1
            out.append({
                "id": f"sec-{n:03d}", "type": "choice", "family": "second", "kind": "second", "unit": "U7", "pool": "practice", "domain": "work", "jdomain": "work",
                "lead": f"You forecast {prior}% that a plan works out.", "ask": f"New evidence arrives: {text[0].lower() + text[1:]} It is about {lr} times as likely if the plan fails as if it works. What should your number be now?",
                "options": [pct(v) for _, v in items], "tags": tags, "right": tags.index("right"), "prior": prior, "lr": lr,
                "fact": f"{pct(post)}. Start from the odds for ({prior} to {100 - prior}), divide by {lr} because the evidence is {lr} times as likely if it fails, and turn the odds back into a chance.",
                "why": f"Staying at {pct(prior)} ignores the evidence; moving to {pct(over)} treats it as twice as strong as it is; {pct(wrong)} moves the wrong way.",
                "verified": "computed", "checked": BANK_DATE,
            })
    return out


# ---- luck (Unit 8) ------------------------------------------------------------------------------------------------------------------
def lucks():
    out = []
    n = 0
    for i, (scene, hit_t, miss_t) in enumerate(K.SCENES):
        pool = "practice" if i % 2 == 0 else "exam"
        for j in range(6):
            r = rng_for("luck", i, j)
            hit = j % 4 in (0, 3)       # combos: (hit, sound) (miss, sound) (miss, flawed) (hit, flawed) -> hit when j%4 in {0,3}
            sound = j % 4 in (0, 1)
            cue = r.choice(K.SOUND if sound else K.FLAWED)
            said = f" They put it at {r.choice([55, 60, 65, 70, 75, 80, 85, 90])}%." if r.random() < 0.5 else ""
            n += 1
            label = ("Good judgment" if sound else "Good luck") if hit else ("Bad luck" if sound else "Bad judgment")
            out.append({
                "id": f"lk-{n:03d}", "type": "choice", "family": "luck", "kind": "luck", "unit": "U8", "pool": pool, "domain": "life", "jdomain": "life",
                "lead": f"{scene}.{said} {cue} {hit_t if hit else miss_t}", "ask": "Was the result mostly luck or judgment?",
                "options": list(K.LABELS), "right": K.LABELS.index(label), "hit": hit, "process": "sound" if sound else "flawed",
                "fact": f"{label}. The call {'worked out' if hit else 'did not work out'} and the process was {'sound' if sound else 'flawed'}: " + (
                    "a sound process that pays off is earned." if (hit and sound) else "a flawed process that pays off was lucky; the same process will not keep paying." if hit else
                    "a sound process that fails is bad luck: keep the process." if sound else "a flawed process that fails is the process's fault: change it."),
                "why": "Judge the decision by what the person knew and how they reasoned, not by how it turned out. Good process plus a bad outcome is bad luck; bad process plus a good outcome is good luck.",
                "verified": "computed", "checked": BANK_DATE, "cue": cue,
            })
    return out


# ---- decisions (Unit 9) ------------------------------------------------------------------------------------------------------------------
PAIRS = [(30, 10), (10, 30), (40, 10), (10, 40), (15, 35), (35, 15), (60, 20), (20, 60), (50, 10), (10, 50), (25, 25), (80, 20), (20, 80), (45, 5), (5, 45), (70, 30), (30, 70), (90, 10), (10, 90), (160, 40), (40, 160), (150, 50), (50, 150), (75, 25), (25, 75)]


def ev_of(p, gain, loss):
    return F(p, 100) * gain - (1 - F(p, 100)) * loss


def decisions():
    out = []
    na = nt = nv = 0
    r0 = rng_for("decisions")
    frames = list(K.ACTS)
    # act: half the items sit where the 50% instinct is wrong
    k = 0
    while na < 60:
        r = rng_for("act", k); k += 1
        gain, loss = r.choice(PAIRS)
        p = r.choice(range(10, 100, 10))
        ev = ev_of(p, gain, loss)
        if ev == 0:
            continue
        trap = (p < 50) == (ev > 0)   # the instinct "act above 50%" is wrong
        if trap != (na % 2 == 0):
            continue
        frame, what = r.choice(frames)
        na += 1
        right = 0 if ev > 0 else 1
        out.append({
            "id": f"act-{na:03d}", "type": "choice", "family": "act", "kind": "act", "unit": "U9", "pool": "practice" if na % 2 else "exam", "domain": "work", "jdomain": "work",
            "lead": f"{frame} If it works out ({what}) you gain {gain}. If not, you lose {loss}. You put the chance it works out at {p}%.", "ask": "Act or hold off?",
            "options": ["Act", "Hold off"], "right": right, "p": p, "gain": gain, "loss": loss,
            "fact": f"{'Act' if ev > 0 else 'Hold off'}. On average acting is worth {p}% × {gain} − {100 - p}% × {loss} = {float(ev):g}. Acting pays when your chance is above {loss} ÷ ({gain} + {loss}) = {round(100 * loss / (gain + loss))}%.",
            "why": "The line for acting is not 50%: it moves with what is at stake on each side.",
            "verified": "computed", "checked": BANK_DATE,
        })
    k = 0
    seen = set()
    while nt < 60:
        r = rng_for("thr", k); k += 1
        gain, loss = r.choice(PAIRS)
        if (gain, loss) in seen and len(seen) < len(PAIRS):
            continue
        seen.add((gain, loss))
        if len(seen) >= len(PAIRS):
            seen.clear()
        right = round(100 * loss / (gain + loss))
        inv = round(100 * gain / (gain + loss))
        cand = {"right": right, "inverse": inv, "half": 50, "ratio": min(99, round(100 * loss / gain)) if loss != gain else 25}
        vals = sorted(cand.values())
        if len(set(vals)) < 4 or any(vals[j + 1] - vals[j] < 4 for j in range(3)):
            continue
        frame, what = r.choice(frames)
        items = list(cand.items()); r.shuffle(items)
        tags = [t for t, _ in items]
        nt += 1
        out.append({
            "id": f"thr-{nt:03d}", "type": "choice", "family": "threshold", "kind": "threshold", "unit": "U9", "pool": "practice" if nt % 2 else "exam", "domain": "work", "jdomain": "work",
            "lead": f"{frame} If it works out ({what}) you gain {gain}. If not, you lose {loss}.", "ask": "How likely does it have to be to work out before acting is worth it, on average?",
            "options": [pct(v) for _, v in items], "tags": tags, "right": tags.index("right"), "gain": gain, "loss": loss,
            "fact": f"{pct(right)}. Break-even is the loss over the total at stake: {loss} ÷ ({gain} + {loss}).",
            "why": f"At {pct(right)} the gains and losses cancel on average; above it acting pays, below it holding off does. {pct(inv)} is the same sum turned upside down.",
            "verified": "computed", "checked": BANK_DATE,
        })
    k = 0
    while nv < 60:
        r = rng_for("val", k); k += 1
        gain, loss = r.choice(PAIRS)
        p = r.choice(range(10, 100, 10))
        ev = ev_of(p, gain, loss)
        if ev == 0 or ev.denominator != 1:
            continue
        ev = int(ev)
        cand = {"right": ev, "gain_only": int(F(p, 100) * gain) if (F(p, 100) * gain).denominator == 1 else round(float(F(p, 100) * gain)),
                "wrong_p": int(round(float(F(p, 100) * gain - F(p, 100) * loss))), "mid": (gain - loss) // 2}
        vals = sorted(cand.values())
        if len(set(vals)) < 4 or any(vals[j + 1] - vals[j] < 3 for j in range(3)):
            continue
        frame, what = r.choice(frames)
        items = list(cand.items()); r.shuffle(items)
        tags = [t for t, _ in items]
        nv += 1
        out.append({
            "id": f"val-{nv:03d}", "type": "choice", "family": "value", "kind": "value", "unit": "U9", "pool": "practice" if nv % 2 else "exam", "domain": "work", "jdomain": "work",
            "lead": f"{frame} If it works out ({what}) you gain {gain}. If not, you lose {loss}. You put the chance it works out at {p}%.", "ask": "What is acting worth on average?",
            "options": [f"{v:+d}" for _, v in items], "tags": tags, "right": tags.index("right"), "p": p, "gain": gain, "loss": loss,
            "fact": f"{ev:+d}. {p}% × {gain} = {float(F(p, 100) * gain):g}, minus {100 - p}% × {loss} = {float((1 - F(p, 100)) * loss):g}.",
            "why": "Weigh each result by its chance: the gain by the chance it works, the loss by the chance it does not.",
            "verified": "computed", "checked": BANK_DATE,
        })
    return out


def build():
    qs = counters() + seconds() + lucks() + decisions()
    return {"version": 1, "built": BANK_DATE, "seed": SEED, "questions": qs}


def main():
    text = json.dumps(build(), indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if cur != text:
            print("know.json is not what make_know.py writes"); sys.exit(1)
        print("know.json matches the builder"); return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    qs = json.loads(text)["questions"]
    from collections import Counter
    print(Counter((q["family"], q["pool"]) for q in qs))


if __name__ == "__main__":
    main()

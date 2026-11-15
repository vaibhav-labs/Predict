#!/usr/bin/env python3
"""Synthetic records for the tests: players whose behaviour is known, written as the app's own event log.

The tests import this file (the browser tests write the record to a .jsonl and Import it through the Coach tab; the engine
tests hand it to the app's own parser), so a statistic on screen can be compared with an independent computation of the
same raw events. Python standard library only. Nothing here is a real person's record.
"""
import datetime
import json
import math
import os
import random

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json"), encoding="utf-8"))
STEPS = CFG["binary"]["dial_steps"]
FORMULA = CFG["binary"]["rules"][CFG["binary"]["core_rule"]]
EDGE_WEIGHT = CFG["journal"]["edge_weight"]
TOPICS = ["geography", "numbers", "science", "world", "chance", "economy", "technology"]


def pts(p):
    """Points for a chosen side that was given probability p (Python round: halves go to the even number, as in the app)."""
    return round(eval(FORMULA, {"__builtins__": {}}, {"p": p, "log2": math.log2}))


def add_days(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()


class Rec:
    """An event log under construction. Time is UTC, and the local day equals the UTC day (the tests run in UTC)."""

    def __init__(self, seed=1):
        self.rng = random.Random(seed)
        self.events = []
        self.counter = 0

    def _stamp(self, day, minute):
        y, m, d = (int(x) for x in day.split("-"))
        t = datetime.datetime(y, m, d, 8, 0, 0, tzinfo=datetime.timezone.utc) + datetime.timedelta(minutes=minute)
        return t.strftime("%Y-%m-%dT%H:%M:%S.000Z"), day

    def _add(self, type_, day, minute, **fields):
        self.counter += 1
        t, d = self._stamp(day, minute)
        ev = {"id": f"{self.counter:09d}-{self.rng.getrandbits(40):010x}", "t": t, "d": d, "type": type_}
        ev.update({k: v for k, v in fields.items() if v is not None})
        self.events.append(ev)
        return ev

    # ---- the gym ----
    def session(self, day, minute, mode="practice", unit="U1", size=18, n=None):
        return self._add("session", day, minute, mode=mode, unit=unit, size=size, n=n)["id"]

    def call(self, sid, day, minute, c, side, truth, domain="geography", diff="easy", mode="practice", unit="U1", q=None):
        hit = (side == "yes") == truth
        qid = q or f"synth-q{self.counter + 1}"
        return self._add("call", day, minute, session=sid, mode=mode, unit=unit, q=qid, claim=f"Synthetic claim {self.counter + 1}", domain=domain, diff=diff,
                         side=side, c=c, truth=truth, hit=hit, points=pts(c) if hit else pts(1 - c), rule="brier_points", ms=4000)

    def end(self, sid, day, minute):
        return self._add("session_end", day, minute, session=sid)

    def play_day(self, day, n, policy, topics=None, mode="practice", unit="U1", minute=0):
        """One session of n calls. policy(i, rng) -> (stated confidence, the player's true chance of being right)."""
        sid = self.session(day, minute, mode=mode, unit=unit, size=n)
        topics = topics or TOPICS
        for i in range(n):
            c, q = policy(i, self.rng)
            truth = self.rng.random() < 0.5
            right = self.rng.random() < q
            side = ("yes" if truth else "no") if right else ("no" if truth else "yes")
            self.call(sid, day, minute + 1 + i, c, side, truth, domain=topics[(len(self.events)) % len(topics)], diff=("easy", "medium", "hard")[i % 3], mode=mode, unit=unit)
        self.end(sid, day, minute + n + 1)
        return sid

    # ---- the journal ----
    def prediction(self, day, minute, c, b, domain="work", due_option="week", scored=True, flags=(), flagged=False, text=None, bsource="starter"):
        horizon = CFG["journal"]["horizon_of_due"][due_option]
        due = add_days(day, CFG["journal"]["due_offset_days"][due_option])
        chain = {"outsideView": {"text": "Reference class and its usual rate.", "rate": 0.5}, "evidence": [{"text": "A signal.", "dir": "up", "test": False}],
                 "caseAgainst": {"text": "The strongest reason to be wrong.", "number": 30}, "tripwire": {"text": "What would change my mind.", "number": 40}}
        return self._add("prediction", day, minute, text=text or f"By {due}, synthetic thing {self.counter + 1} will happen.", domain=domain, dueOption=due_option, due=due, horizon=horizon,
                         chain=chain, c=c, b=b, bSource=bsource, scored=scored, ms=200000, flags=list(flags), flagged=flagged)

    def update(self, pred, day, minute, c, prev, reason="New information."):
        return self._add("update", day, minute, prediction=pred["id"], c=c, prev=prev, reason=reason)

    def resolve(self, pred, day, minute, outcome, note=None):
        if outcome == "void":
            return self._add("resolve", day, minute, prediction=pred["id"], outcome="void", note=note, raw=None, edge=None)
        yes = outcome == "yes"
        raw = pts(pred["c"]) if yes else pts(1 - pred["c"])
        base = pts(pred["b"]) if yes else pts(1 - pred["b"])
        return self._add("resolve", day, minute, prediction=pred["id"], outcome=outcome, note=note, raw=raw, edge=EDGE_WEIGHT * (raw - base) if pred["scored"] else None)

    # ---- the Unit 1 exam (Block 4): an attempt, and its sittings of sealed calls ----
    def exam_start(self, day, minute, n=200, reused=0):
        return self._add("exam", day, minute, state="start", unit="U1", n=n, reused=reused)["id"]

    def exam_sitting(self, attempt, day, minute, rows, n, of=10):
        """One sitting. rows = [(question, stated confidence, side)], a question being a dict of the exam bank."""
        sid = self._add("session", day, minute, mode="exam", unit="U1", size=len(rows), exam=attempt, n=n, of=of)["id"]
        for i, (q, c, side) in enumerate(rows):
            hit = (side == "yes") == q["answer"]
            self._add("call", day, minute + 1 + i, session=sid, mode="exam", unit="U1", exam=attempt, q=q["id"], claim=q["claim"], domain=q["domain"], diff=q["diff"],
                      side=side, c=c, truth=q["answer"], hit=hit, points=pts(c) if hit else pts(1 - c), rule="brier_points", ms=4000)
        self.end(sid, day, minute + len(rows) + 1)
        return sid

    # ---- Unit 3 ranges (Block 6): range sessions, ranges, and the exam of 60 ----
    def rsession(self, day, minute, mode="practice", size=10, plan=(), **extra):
        return self._add("rsession", day, minute, mode=mode, unit="U3", size=size, plan=list(plan), **extra)["id"]

    def range_(self, sid, day, minute, q, low, high, mode="practice", exam=None):
        """One locked range on question `q` (a dict of app/content/questions/ranges.json); the judging is ref_range's, written separately from the app's."""
        import ref_range
        j = ref_range.judge(q, low, high)
        return self._add("range", day, minute, session=sid, mode=mode, unit="U3", exam=exam, q=q["id"], kind=q["kind"], domain=q["domain"], claim=f"{q['lead']} {q['ask']}",
                         scale=q["scale"], low=low, high=high, truth=q["truth"], refLow=q["ref_low"], refHigh=q["ref_high"], hit=j["hit"], width=j["width"], refWidth=j["ref_w"],
                         ratio=j["ratio"], score=j["score"], points=j["points"], ms=9000)

    def rend(self, sid, day, minute):
        return self._add("rsession_end", day, minute, session=sid)

    def range_day(self, day, questions, policy, mode="practice", minute=0, exam=None, n=None, of=None):
        """One session of ranges. policy(i, rng, q) -> (low, high) for that question."""
        extra = {}
        if exam:
            extra = {"exam": exam, "n": n, "of": of}
        sid = self.rsession(day, minute, mode=mode, size=len(questions), plan=[q["id"] for q in questions], **extra)
        for i, q in enumerate(questions):
            low, high = policy(i, self.rng, q)
            self.range_(sid, day, minute + 1 + i, q, low, high, mode=mode, exam=exam)
        self.rend(sid, day, minute + len(questions) + 1)
        return sid

    def range_exam_start(self, day, minute, n=60):
        return self._add("exam", day, minute, state="start", unit="U3", n=n)["id"]

    # ---- output ----
    def sorted(self):
        return sorted(self.events, key=lambda e: (e["t"], e["id"]))

    def write(self, path, build="synthetic"):
        evs = self.sorted()
        head = {"type": "header", "format": "predict-record", "version": 1, "exported": evs[-1]["t"] if evs else "", "events": len(evs), "build": build}
        with open(path, "w", encoding="utf-8") as f:
            for e in [head] + evs:
                f.write(json.dumps(e) + "\n")
        return path


def mixed_player(today="2026-11-30", seed=7):
    """The record the Mirror is checked against. It has: a streak that was built, halved by missed days and rebuilt, a baseline
    then practice, an overconfident topic and a shy one, thin groups, journal cards of every kind (resolved yes and no, void,
    an extra card for the day, a trivial one, a self-controlled one, some still open and one due) and a last played day two days
    before `today`, so today starts unplayed."""
    r = Rec(seed)
    missed = {add_days(today, -k) for k in (33, 32, 25, 18, 17, 16, 9, 3)}
    day_i = 0

    def policy_for(i):
        def policy(j, rng):
            c = STEPS[(j * 3 + i) % len(STEPS)]
            q = min(0.97, max(0.5, c - 0.12)) if c >= 0.8 else (c + 0.05 if c < 0.65 else c)  # too sure up high, a touch shy low
            return c, q
        return policy

    played = []
    for k in range(44, 1, -1):  # 44 days ago to 2 days ago
        day = add_days(today, -k)
        if day in missed:
            continue
        mode, unit, n = ("baseline", "U0", 20) if day_i < 3 else ("practice", "U1", 18 if day_i % 5 else 6)
        r.play_day(day, n, policy_for(day_i), mode=mode, unit=unit, minute=0)
        played.append(day)
        day_i += 1
    played_set = set(played)

    def nearest_played(day, after=True):
        step = 1 if after else -1
        while day not in played_set:
            day = add_days(day, step)
        return day

    last_play = played[-1]
    # Journal: about one card per played day. Domain rotates (work twice as often), due option rotates, and the player's real
    # chance is below the stated one in work (too sure), equal in life, above in world (too shy). Only cards whose due date has
    # passed by `last_play` are resolved; the rest stay open.
    domains = ["work", "life", "work", "world", "work", "life"]
    options = ["week", "tomorrow", "week", "tomorrow", "week", "tomorrow", "month", "week"]
    stated = [0.70, 0.60, 0.80, 0.30, 0.85, 0.65, 0.55, 0.75, 0.40, 0.90, 0.60]
    real = {"work": -0.12, "life": 0.0, "world": 0.08}
    for i, day in enumerate(played[:-1]):
        domain, opt = domains[i % len(domains)], options[i % len(options)]
        if i in (12, 14, 20):
            opt = "tomorrow"  # these three kinds of card must resolve to be seen
        c = stated[i % len(stated)]
        extra = {}
        b = 0.5
        if i == 12:
            b = 0.97                       # trivial: kept out of the map
        if i == 14:
            extra["flags"] = ["self_controlled"]  # self-controlled: kept out
        if i == 20:
            extra["scored"] = False        # an extra card for the day: logged, not scored
        pred = r.prediction(day, 400 + i, c, b, domain=domain, due_option=opt, **extra)
        due = nearest_played(pred["due"]) if pred["due"] <= last_play else None
        if due and due <= last_play:
            if i == 10:
                outcome = "void"
            else:
                q = min(0.97, max(0.03, c + real[domain]))
                outcome = "yes" if r.rng.random() < q else "no"
            r.resolve(pred, due, 420 + i, outcome, note="Synthetic outcome.")
    # One card written on the last played day that is due on `today` (a 'tomorrow' card from yesterday would be due today).
    pred = r.prediction(add_days(today, -1) if add_days(today, -1) in played_set else last_play, 450, 0.65, 0.5, domain="world", due_option="tomorrow")
    return r


# =====================================================================================================================
# Block 4: players for the Lesson Engine. Each builder returns a Rec holding only what the player did (calls, journal
# cards), never a flag: the tests let the engine find the pattern, once in JS and once in tools/ref_lessons.py.
# =====================================================================================================================
STEP_WEIGHTS = {0.5: 1, 0.55: 1, 0.6: 2, 0.65: 2, 0.7: 3, 0.75: 3, 0.8: 3, 0.85: 2, 0.9: 3, 0.95: 2, 0.99: 1}


def _pick(rng, weights=STEP_WEIGHTS):
    steps = list(weights)
    return rng.choices(steps, [weights[s] for s in steps])[0]


def pol_calibrated(i, rng):
    c = _pick(rng)
    return c, c


def pol_over(gap=0.16):
    """Says 90 to 99% where they are right gap less often, honest everywhere else."""
    def policy(i, rng):
        c = _pick(rng)
        return c, (max(0.5, c - gap) if c >= 0.9 else c)
    return policy


def pol_under(lift=0.2):
    """Says 60 to 80% where they are right lift more often, honest everywhere else."""
    def policy(i, rng):
        c = _pick(rng)
        return c, (min(0.97, c + lift) if 0.6 - 1e-9 <= c <= 0.8 + 1e-9 else c)
    return policy


def pol_fence(share=0.4):
    """Says 50 or 55% on a share of the calls although they are right 7 times in 10 on those."""
    def policy(i, rng):
        if rng.random() < share:
            return rng.choice([0.5, 0.55]), 0.7
        c = _pick(rng, {k: v for k, v in STEP_WEIGHTS.items() if k >= 0.6})
        return c, c
    return policy


def lesson_player(kind, seed=11, days=60, start="2026-09-01"):
    r = Rec(seed)
    mid = {"calibrated": [("calibrated", days)], "over_fixed": [("over", 9), ("calibrated", days)], "over_stuck": [("over", days)],
           "under": [("under", days)], "fence": [("fence", days)], "busy": [("busy_two", 14), ("busy_three", days)]}
    pols = {"calibrated": pol_calibrated, "over": pol_over(), "under": pol_under(), "fence": pol_fence(), "busy_two": None, "busy_three": None}

    def busy_two(i, rng):  # top band too sure and mid band too shy
        x = rng.random()
        if x < 0.28:
            return rng.choice([0.9, 0.95, 0.99]), 0.74
        if x < 0.62:
            return rng.choice([0.6, 0.65, 0.7, 0.75, 0.8]), 0.92
        return 0.85, 0.85

    def busy_three(i, rng):  # the same two, and from the third week a fence at 50% on two calls in five (so the third pattern arrives while two are in repair)
        x = rng.random()
        if x < 0.22:
            return rng.choice([0.9, 0.95, 0.99]), 0.74
        if x < 0.5:
            return rng.choice([0.6, 0.65, 0.7, 0.75, 0.8]), 0.92
        if x < 0.9:
            return rng.choice([0.5, 0.55]), 0.75
        return 0.85, 0.85
    pols["busy_two"], pols["busy_three"] = busy_two, busy_three
    plan = mid[kind]
    for k in range(days):
        day = add_days(start, k)
        acc, policy = 0, None
        for name, upto in plan:
            acc += upto
            if k < acc:
                policy = pols[name]
                break
        if k < 3:
            r.play_day(day, 20, pol_calibrated, mode="baseline", unit="U0")
        else:
            r.play_day(day, 18, policy)
        r.prediction(day, 400, 0.6, 0.5, flags=(), flagged=False)
    return r


def soft_player(seed=5, days=40, start="2026-09-01"):
    """A call a day (to keep the day played), a journal card a day; the first ten days half of the cards are vague, then all are sharp."""
    r = Rec(seed)
    for k in range(days):
        day = add_days(start, k)
        r.play_day(day, 6, pol_calibrated)
        vague = k < 10 and k % 2 == 0
        r.prediction(day, 400, 0.6, 0.5, flags=("no_date",) if vague else (), flagged=vague)
    return r


def missed_player(seed=9, start="2026-09-01"):
    """Plays days 0 to 9, skips 10 to 12, comes back on day 13 with the minimum (5 calls and a card) every day, except
    day 15 with only 4 calls (which breaks the run) and one more skipped pair at 30 and 31."""
    r = Rec(seed)
    for k in range(0, 45):
        day = add_days(start, k)
        if k in (10, 11, 12, 30, 31):
            continue
        n = 18 if k < 10 else (4 if k == 15 else 5)
        r.play_day(day, n, pol_calibrated)
        r.prediction(day, 400, 0.6, 0.5)
    return r


def autopsy_player(seed=13, start="2026-09-01"):
    """Resolved journal cards for the autopsy queue: confident misses on both sides, confident hits (every fifth is sampled),
    cards under the bar, a void card, an unscored extra, and two autopsies already filed."""
    r = Rec(seed)
    spec = [  # (stated, outcome, scored)
        (0.90, "no", True), (0.85, "yes", True), (0.95, "yes", True), (0.60, "no", True), (0.10, "yes", True), (0.15, "no", True),
        (0.92, "yes", True), (0.88, "yes", True), (0.97, "yes", True), (0.30, "yes", True), (0.85, "yes", True), (0.90, "void", True),
        (0.95, "no", False), (0.05, "no", True), (0.86, "yes", True), (0.84, "no", True), (0.93, "yes", True), (0.07, "yes", True),
        (0.91, "yes", True), (0.89, "yes", True), (0.96, "yes", True), (0.12, "no", True), (0.99, "yes", True), (0.5, "no", True),
    ]
    for i, (c, outcome, scored) in enumerate(spec):
        day = add_days(start, i)
        p = r.prediction(day, 400, c, 0.5, domain=("work", "life", "world")[i % 3], due_option="tomorrow", scored=scored)
        r.resolve(p, add_days(day, 1), 420, outcome)
        if i in (0, 4):
            r._add("autopsy", add_days(day, 1), 430, prediction=p["id"], kind="miss", knew="I knew the usual rate.", missed="I did not ask who decides.", verdict="judgment", rule="Ask who decides first.")
    return r


def eligible_player(seed=17, start="2026-09-01"):
    """A calibrated player who has done the 60-call baseline (three days) and the 90 practice calls (five days): the Unit 1 exam is open."""
    r = Rec(seed)
    for k in range(8):
        day = add_days(start, k)
        if k < 3:
            r.play_day(day, 20, pol_calibrated, mode="baseline", unit="U0")
        else:
            r.play_day(day, 18, pol_calibrated)
        r.prediction(day, 400, 0.6, 0.5)
    return r


def u1_passed_player(exam_bank, seed=19, start="2026-09-01"):
    """The eligible player, who then sat and passed the Unit 1 exam (200 calls in 10 sittings, the verdict written): Unit 3 is open."""
    r = eligible_player(seed, start)
    day0 = add_days(start, 8)
    rows = exam_rows(exam_bank, [(0.55, 40, 22), (0.65, 40, 26), (0.75, 40, 30), (0.85, 40, 34), (0.95, 40, 38)], random.Random(seed))
    att = r.exam_start(day0, 10, n=200)
    for i in range(10):
        r.exam_sitting(att, add_days(day0, i), 20, rows[i * 20:(i + 1) * 20], n=i + 1)
    r._add("exam", add_days(day0, 9), 300, state="result", exam=att, **{"pass": True}, n=200, index=0.0, meanConf=0.75, hitRate=0.75, reasons=[], worst=None, bands=[])
    return r


# ---- Units 4 and 5 (Block 7): problem sessions, problems, and the exams ----
def _bank(name):
    return json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "content", "questions", name)))["questions"]


def u3_passed_player(exam_bank, seed=23, start="2026-09-01"):
    """The Unit 1 passer who then did 40 practice ranges and sat and passed the Unit 3 exam (60 ranges, 54 holding): Units 4 is open."""
    import ref_range
    r = u1_passed_player(exam_bank, seed, start)
    pool = [q for q in _bank("ranges.json") if q["pool"] == "practice"]
    xpool = [q for q in _bank("ranges.json") if q["pool"] == "exam"]
    day0 = add_days(start, 20)
    for k in range(4):
        r.range_day(add_days(day0, k), pool[k * 10:(k + 1) * 10], centered_policy(1.0), minute=0)
    att = r.range_exam_start(add_days(day0, 6), 10)
    for k in range(3):
        r.range_day(add_days(day0, 6 + k), xpool[k * 20:(k + 1) * 20], centered_policy(1.0), mode="exam", minute=20, exam=att, n=k + 1, of=3)
    r._add("exam", add_days(day0, 9), 300, state="result", exam=att, unit="U3", **{"pass": True}, n=60, hits=60, coverage=1.0, points=0, reasons=[], dir=None)
    return r


def prob_session(r, day, minute, family, unit, plan, mode="practice", **extra):
    return r._add("psession", day, minute, mode=mode, unit=unit, family=family, size=len(plan), plan=list(plan), **extra)["id"]


def prob_fermi(r, sid, day, minute, q, stretch=1.5, mode="practice", exam=None, unit="U4"):
    """One Fermi problem answered with every part's range the truth stretched by `stretch` either way; judged by ref_problem (written separately)."""
    import ref_problem as RP
    parts = [(p["truth"] / stretch, p["truth"] * stretch) for p in q["parts"]]
    lo, hi = RP.combine(parts, q["mult"])
    j = RP.judge(q, lo, hi)
    pd = [{"low": a, "high": b, "truth": p["truth"], "hit": a <= p["truth"] <= b} for (a, b), p in zip(parts, q["parts"])]
    return r._add("prob", day, minute, session=sid, mode=mode, unit=unit, family="fermi", exam=exam, q=q["id"], kind=q["kind"], domain=q["domain"], parts=pd, low=lo, high=hi, truth=q["truth"],
                  scale="log", refLow=q["ref_low"], refHigh=q["ref_high"], hit=j["hit"], ratio=j["ratio"], score=j["score"], points=j["points"], miss=j["miss"], partsHit=sum(1 for x in pd if x["hit"]), claim=f"{q['lead']} {q['ask']}", ms=20000)


def prob_rate(r, sid, day, minute, q, off=0.0, mode="practice", exam=None, unit="U5"):
    g = min(100.0, max(0.0, q["truth"] + off))
    miss = abs(g - q["truth"])
    pts_ = max(-100, round(100 * (1 - miss / 7)))
    return r._add("prob", day, minute, session=sid, mode=mode, unit=unit, family="rate", exam=exam, q=q["id"], kind=q["kind"], jdomain=q["jdomain"], guess=g, truth=q["truth"], miss=miss, signed=g - q["truth"],
                  hit=miss <= 7 + 1e-9, points=pts_, claim=f"{q['lead']} {q['ask']}", ms=9000)


def prob_end(r, sid, day, minute):
    return r._add("psession_end", day, minute, session=sid)


def u4_ready_player(exam_bank, seed=29, start="2026-09-01"):
    """Unit 3 passed, then 16 Fermi practice problems (two sessions of 8): the Unit 4 exam is open."""
    r = u3_passed_player(exam_bank, seed, start)
    pool = [q for q in _bank("fermi.json") if q["pool"] == "practice"]
    day0 = add_days(start, 32)
    for k in range(2):
        qs = pool[k * 8:(k + 1) * 8]
        sid = prob_session(r, add_days(day0, k), 0, "fermi", "U4", [q["id"] for q in qs])
        for i, q in enumerate(qs):
            prob_fermi(r, sid, add_days(day0, k), 1 + i, q)
        prob_end(r, sid, add_days(day0, k), 20)
    return r


def u5_ready_player(exam_bank, seed=31, start="2026-09-01"):
    """Unit 4 passed (a sealed exam of 20 Fermi problems, 20 holding) and 36 practice rate/class problems done: the Unit 5 exam is open."""
    r = u4_ready_player(exam_bank, seed, start)
    xpool = [q for q in _bank("fermi.json") if q["pool"] == "exam"]
    day0 = add_days(start, 36)
    att = r._add("exam", day0, 5, state="start", unit="U4", n=20)["id"]
    for k in range(2):
        qs = xpool[k * 10:(k + 1) * 10]
        sid = prob_session(r, add_days(day0, k), 10, "fermi", "U4", [q["id"] for q in qs], mode="exam", exam=att, n=k + 1, of=2)
        for i, q in enumerate(qs):
            prob_fermi(r, sid, add_days(day0, k), 11 + i, q, mode="exam", exam=att)
        prob_end(r, sid, add_days(day0, k), 30)
    r._add("exam", add_days(day0, 2), 5, state="result", exam=att, unit="U4", **{"pass": True}, n=20, hits=20, coverage=1.0, points=0, reasons=[], dir=None, medianMiss=1.2, meanRatio=1.0)
    rates = [q for q in _bank("rates.json") if q["type"] == "rate" and q["pool"] == "practice"]
    day1 = add_days(day0, 4)
    for k in range(3):
        qs = rates[k * 12:(k + 1) * 12]
        sid = prob_session(r, add_days(day1, k), 0, "rate", "U5", [q["id"] for q in qs])
        for i, q in enumerate(qs):
            prob_rate(r, sid, add_days(day1, k), 1 + i, q, off=(0 if i % 3 else 5))
        prob_end(r, sid, add_days(day1, k), 20)
    return r


def prob_update(r, sid, day, minute, step, off=0.0, mode="practice", exam=None, unit="U6"):
    """One update step (a dict from engine stepsOf: id, prior, truth, ...) answered `off` points from the truth; the rules are written out here, apart from the app's."""
    g = min(100.0, max(0.0, step["truth"] + off))
    miss = abs(g - step["truth"])
    pts_ = max(-100, round(100 * (1 - miss / 7)))
    return r._add("prob", day, minute, session=sid, mode=mode, unit=unit, family="update", exam=exam, q=step["id"], kind=step["kind"], jdomain=step["jdomain"], guess=g, truth=step["truth"], prior=step["prior"],
                  miss=miss, signed=g - step["truth"], hit=miss <= 7 + 1e-9, points=pts_, gain=abs(step["prior"] - step["truth"]) - miss, moved=g - step["prior"], news=step["news"], claim=f"{step['lead']} {step['ask']}", ms=9000)


def update_steps(pool):
    """Every step of every stream in a pool of updates.json, as the problem screen asks it (ids 'upd-…#0', 'upd-…#1')."""
    out = []
    for q in _bank("updates.json"):
        if q["pool"] != pool:
            continue
        for i, s in enumerate(q["steps"]):
            out.append({"id": f"{q['id']}#{i}", "stream": q["id"], "kind": q["kind"], "jdomain": q["jdomain"], "lead": q["lead"], "ask": q["ask"], "news": s["news"], "prior": s["prior"], "truth": s["truth"]})
    return out


def u5_passed_player(exam_bank, seed=37, start="2026-09-01"):
    """Unit 5 passed (a recorded pass of a 40-problem exam) on top of u5_ready_player: Unit 6 opens."""
    r = u5_ready_player(exam_bank, seed, start)
    day = add_days(start, 45)
    att = r._add("exam", day, 5, state="start", unit="U5", n=40)["id"]
    r._add("exam", add_days(day, 1), 5, state="result", exam=att, unit="U5", **{"pass": True}, n=40, hits=36, coverage=0.9, points=0, reasons=[], dir=None, meanMiss=3.0, bias=0.5, within=36)
    return r


def u6_ready_player(exam_bank, seed=41, start="2026-09-01"):
    """Unit 5 passed, then 30 practice update steps (five sessions of six): the Unit 6 exam is open."""
    r = u5_passed_player(exam_bank, seed, start)
    steps = update_steps("practice")
    day0 = add_days(start, 48)
    for k in range(5):
        qs = steps[k * 6:(k + 1) * 6]
        sid = prob_session(r, add_days(day0, k), 0, "update", "U6", [q["id"] for q in qs])
        for i, q in enumerate(qs):
            prob_update(r, sid, add_days(day0, k), 1 + i, q, off=(0 if i % 3 else 4))
        prob_end(r, sid, add_days(day0, k), 20)
    return r



# ---- Units 7 to 9 (Block 9): choice units ----
def _pass_unit(r, unit, day, n):
    att = r._add("exam", day, 5, state="start", unit=unit, n=n)["id"]
    r._add("exam", add_days(day, 1), 5, state="result", exam=att, unit=unit, **{"pass": True}, n=n, hits=n - 2, coverage=0.9, points=0, reasons=[], dir=None, right=n - 2)
    return r


def u6_passed_player(exam_bank, seed=43, start="2026-09-01"):
    """Unit 6 passed (a recorded pass): Unit 7 opens."""
    return _pass_unit(u6_ready_player(exam_bank, seed, start), "U6", add_days(start, 60), 40)


def u7_passed_player(exam_bank, seed=47, start="2026-09-01"):
    """Unit 7 passed on top: Unit 8 opens, so a due card asks the memory check first."""
    return _pass_unit(u6_passed_player(exam_bank, seed, start), "U7", add_days(start, 64), 28)


def u8_passed_player(exam_bank, seed=53, start="2026-09-01"):
    """Unit 8 passed on top: Unit 9 opens, so decision cards are open."""
    return _pass_unit(u7_passed_player(exam_bank, seed, start), "U8", add_days(start, 68), 30)



# ---- Unit 10 (Block 10): fine calls on the 1% dial ----
import math  # noqa: E402


def sharp_pts(c, hit):
    p = c if hit else 1 - c
    return round(100 * (1 + math.log2(p)))


def fine_call(r, sid, day, minute, q, c, side, mode="practice", exam=None, ms=4000):
    """One call on the 1% dial under the sharp rule: `points` sharp, `core` the Brier points the ledger reads."""
    hit = (side == "yes") == q["answer"]
    return r._add("call", day, minute, session=sid, mode=mode, unit="U10", fine=True, exam=exam, q=q["id"], claim=q["claim"], domain=q["domain"], diff=q["diff"], side=side, c=c,
                  truth=q["answer"], hit=hit, points=sharp_pts(c, hit), core=pts(c) if hit else pts(1 - c), rule="log_points", ms=ms)


def fine_session(r, day, minute, qs, cs, mode="practice", exam=None, n=None, of=None, honest=False, **extra):
    """qs: tail questions; cs: the stated confidence of each; the side is the one the question's base rate favours."""
    sid = r._add("session", day, minute, mode=mode, unit="U10", fine=True, size=len(qs), exam=exam, n=n, of=of, plan=[q["id"] for q in qs], **extra)["id"]
    for i, (q, c) in enumerate(zip(qs, cs)):
        side = "yes" if q["base"] >= 0.5 else "no"
        if honest:  # about (1 - c) of the calls take the side the question did not favour, so the record is calibrated
            if ((r.counter * 37) % 100) / 100 < 1 - c:
                side = "no" if side == "yes" else "yes"
        fine_call(r, sid, day, minute + 1 + i, q, c, side, mode=mode, exam=exam)
    r._add("session_end", day, minute + len(qs) + 1, session=sid)
    return sid


def _tails(pool):
    return [q for q in json.load(open(os.path.join(ROOT, "app", "content", "questions", "tails.json"), encoding="utf-8"))["questions"] if q["pool"] == pool]


def u9_passed_player(exam_bank, seed=59, start="2026-09-01"):
    """Unit 9 passed on top: Unit 10 opens."""
    return _pass_unit(u8_passed_player(exam_bank, seed, start), "U9", add_days(start, 72), 30)


def u10_ready_player(exam_bank, seed=61, start="2026-09-01", conf=0.95):
    """Unit 10 open and 84 practice calls made (six sessions of 14), spread on 5% steps near the base rate: the exam is ready."""
    r = u9_passed_player(exam_bank, seed, start)
    qs = _tails("practice")[:84]
    day0 = add_days(start, 76)
    for k in range(6):
        sub = qs[k * 14:(k + 1) * 14]
        fine_session(r, add_days(day0, k), 0, sub, [conf if (j % 2) else 0.97 for j in range(len(sub))])
    return r


def range_policy(f):
    """A range player who says the reference interval stretched by f (1 = exactly the record's middle 90%)."""
    import ref_range

    def policy(i, rng, q):
        return ref_range.stretched(q, f)
    return policy


def hit_miss_policy(pattern):
    """A range player whose i-th range holds the truth when pattern[i % len] is '1' and misses it (well above) otherwise; each is the reference width."""
    import ref_range

    def policy(i, rng, q):
        t = ref_range.to_scale(q, q["truth"])
        w = ref_range.to_scale(q, q["ref_high"]) - ref_range.to_scale(q, q["ref_low"])
        if pattern[i % len(pattern)] == "1":
            return ref_range.from_scale(q, t - w * 0.5), ref_range.from_scale(q, t + w * 0.5)
        return ref_range.from_scale(q, t + w * 0.2), ref_range.from_scale(q, t + w * 1.2)
    return policy


def centered_policy(k):
    """A range player who always holds the truth: centred on it, k reference widths wide (k = 1 is as wide as the record's middle 90%)."""
    import ref_range

    def policy(i, rng, q):
        t = ref_range.to_scale(q, q["truth"])
        w = ref_range.to_scale(q, q["ref_high"]) - ref_range.to_scale(q, q["ref_low"])
        return ref_range.from_scale(q, t - w * k / 2), ref_range.from_scale(q, t + w * k / 2)
    return policy


def exam_rows(bank, groups, rng):
    """Calls for an exam from real questions: groups = [(stated, how many, how many of them right)]. Questions are drawn in a random
    order without repeats, the side is the right one for the first `right` calls of a group and the wrong one for the rest."""
    order = list(bank)
    rng.shuffle(order)
    rows, k = [], 0
    for c, n, right in groups:
        for i in range(n):
            q = order[k]
            k += 1
            yes_is_right = q["answer"]
            side = ("yes" if yes_is_right else "no") if i < right else ("no" if yes_is_right else "yes")
            rows.append((q, c, side))
    rng.shuffle(rows)
    return rows


# ---- Monte Carlo draws: the same players as sim/scoring_sim.py, written out for the JS engine to judge --------------------
def _sim():
    import sys
    sys.path.insert(0, os.path.join(ROOT, "sim"))
    import scoring_sim
    return scoring_sim


def mc_band_runs(policy, lo, hi, runs, horizon, seed):
    """`runs` players' first `horizon` calls stated inside [lo, hi]: [{"c": [...], "h": "0101..."}]."""
    S = _sim()
    rng = random.Random(seed)
    pol = {"honest": S.SIM["policies"]["honest"], "mild_overconfident": S.SIM["policies"]["mild_overconfident"], "overconfident": S.SIM["policies"]["overconfident"],
           "underconfident": S.SIM["policies"]["underconfident"], "mild_underconfident": {"type": "logit_scale", "factor": 0.7}}[policy]
    mix = S.SIM["question_mixes"]["mixed"]
    out = []
    for _ in range(runs):
        cs, hs = [], []
        while len(cs) < horizon:
            q = S.draw_q(mix, rng)
            c = S.conf(pol, q, rng)
            if lo - 1e-9 <= c <= hi + 1e-9:
                cs.append(round(c, 6))
                hs.append("1" if rng.random() < q else "0")
        out.append({"c": cs, "h": "".join(hs)})
    return out


def mc_gate_players(policy, runs, n, seed):
    """`runs` players' n exam calls under a policy of sim/scoring_sim.py: [{"c": [...], "h": "0101..."}]."""
    S = _sim()
    rng = random.Random(seed)
    pols = S.SIM["policies"]
    mix = S.SIM["question_mixes"]["mixed"]
    out = []
    for _ in range(runs):
        qs = [S.draw_q(mix, rng) for _ in range(n)]
        cs = [round(S.conf(pols[policy], q, rng), 6) for q in qs]
        hs = "".join("1" if rng.random() < q else "0" for q in qs)
        out.append({"c": cs, "h": hs})
    return out


def dump(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    return path

#!/usr/bin/env python3
"""Browser checks for the later blocks (3 to 10). Each block gets a phase that loads a synthetic record from tools/synth.py
through the real Import button, fixes the clock, and compares what the screens show with an independent recomputation
(tools/ref_mirror.py and the block's own reference) from the same raw events.

    python3 tools/test_blocks.py              run every phase
    python3 tools/test_blocks.py b3 b4        run only these phases
    python3 tools/test_blocks.py --shots DIR  also save phone-size screenshots

Needs Playwright for Python and its Chromium. The play-through of the first two blocks stays in tools/test_flow.py.
"""
import json
import math
import os
import random
import re
import shutil
import sys
import tempfile
import traceback
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_pwa as T  # noqa: E402  (the test server, the deploy step, the address)
import test_flow as F  # noqa: E402  (its tap-target and overflow audit, request watchers, screen helpers)
import synth  # noqa: E402
import ref_mirror  # noqa: E402
import ref_lessons  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE, VIEW, SMALL, MINUS = T.BASE, F.VIEW, F.SMALL, F.MINUS
CFG = synth.CFG
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    if not ok:
        T.annotate_failure(name, detail)


def js_round(x): return math.floor(x + 0.5)
def signed(n): return f"+{n}" if n > 0 else f"{MINUS}{-n}" if n < 0 else "0"
def pct(c): return f"{js_round(c * 100)}%"
def gap_pts(g): return signed(js_round(g * 100))
def days(n): return f"{n} {'day' if n == 1 else 'days'}"
def cap1(t): return t[:1].upper() + t[1:]
def near(a, b, tol=1e-4): return (a is None and b is None) or (a is not None and b is not None and abs(a - b) <= tol)


# ---------------------------------------------------------------------------------------------------------------
# Opening the app with a record and a clock
# ---------------------------------------------------------------------------------------------------------------
def open_app(E, today, record=None, viewport=VIEW, hour=12):
    """A fresh browser context (so a fresh phone), the clock fixed at `today` in UTC, the record imported if given."""
    ctx = E.browser.new_context(viewport=viewport, device_scale_factor=2, timezone_id="UTC", permissions=["clipboard-read", "clipboard-write"])
    ctx.add_init_script(F.NO_SHARE)
    page = ctx.new_page()
    E.page = page
    F.attach(E, page)
    page.clock.install(time=f"{today}T{hour:02d}:00:00Z")
    if record:
        page.goto(BASE + "#/coach")
        page.wait_for_selector("#import-file", state="attached")
        page.set_input_files("#import-file", record)
        page.wait_for_function("(document.querySelector('#record-msg') || {}).textContent && document.querySelector('#record-msg').textContent.startsWith('Imported')", timeout=20000)
    else:
        page.goto(BASE)
        page.wait_for_selector(".nav")
    E.ctx = ctx
    return page


def go(page, hash_):
    """A real route change (never a no-op to the page's current hash), then wait for the screen."""
    page.evaluate("(h) => { location.hash = h; }", hash_)
    page.wait_for_timeout(60)


def shot(E, name, full=True):
    if T.SHOTS:
        os.makedirs(T.SHOTS, exist_ok=True)
        E.page.screenshot(path=os.path.join(T.SHOTS, name), full_page=full)


def text(page, sel):
    return (page.text_content(sel) or "").strip()


def attrs(page, sel, names):
    return page.eval_on_selector_all(sel, "(els, names) => els.map(e => Object.fromEntries(names.map(n => [n, e.getAttribute(n)])))", names)


# ---------------------------------------------------------------------------------------------------------------
# Block 3: the Mirror
# ---------------------------------------------------------------------------------------------------------------
CURVE = dict(W=350, H=268, L=38, R=14, T=12, B=70)


def curve_xy(c, r):
    pw, ph = CURVE["W"] - CURVE["L"] - CURVE["R"], CURVE["H"] - CURVE["T"] - CURVE["B"]
    return CURVE["L"] + ((c - 0.5) / 0.5) * pw, CURVE["T"] + (1 - r) * ph


def check_standing(E, ref, label, today_played, mirror=True):
    page, lv = E.page, ref["level"]
    s = ref["seven"]
    check(f"{label}: level is {lv['level']} and the note says how far to the next one", text(page, "#level") == str(lv["level"]) and text(page, "#level-note") == f"{lv['to_next']} points to {lv['level'] + 1}",
          f"{text(page, '#level')} / {text(page, '#level-note')} vs {lv}")
    if mirror:
        check(f"{label}: career points (a high-water mark) are {ref['career']}", text(page, "#career") == f"{ref['career']} career points", text(page, "#career"))
    note = "played today" if today_played else ("play today to keep it" if ref["streak"] > 0 else "start one today")
    check(f"{label}: the streak is {days(ref['streak'])} and says what to do", text(page, "#streak") == days(ref["streak"]) and text(page, "#streak-note") == note, f"{text(page, '#streak')} / {text(page, '#streak-note')}")
    avg = "–" if s["avg"] is None else f"{signed(js_round(s['avg']))}/day"
    check(f"{label}: the seven-day score is {avg} over {s['played']} played days and {s['calls']} calls",
          text(page, "#seven") == avg and text(page, "#seven-note") == f"{s['played']} of 7 played · n={s['calls']} calls", f"{text(page, '#seven')} / {text(page, '#seven-note')}")
    if not mirror:
        return
    got = attrs(page, "#week .day", ["data-day", "data-played", "data-skill"])
    want = [dict(**{"data-day": d["d"], "data-played": "1" if d["played"] else "0", "data-skill": str(d["skill"])}) for d in s["days"]]
    check(f"{label}: the seven daily bars are the last seven days and their skill points", got == want, f"{got} vs {want}")
    if s["beating"] is not None:
        prev = signed(js_round(s["prev_avg"]))
        beat = text(page, "#seven-beat")
        check(f"{label}: it says whether today beats the seven days before ({'above' if s['beating'] else 'at or below'})",
              ("above" in beat) == s["beating"] and f"({prev} a day)" in beat, beat)


def check_curve(E, bands, label, thin_below):
    page = E.page
    dots = page.eval_on_selector_all("#curve circle.pt", "els => els.map(e => ({cx: +e.getAttribute('cx'), cy: +e.getAttribute('cy'), thin: e.classList.contains('thin')}))")
    bars = page.eval_on_selector_all("#curve line.eb:not(.cap)", "els => els.map(e => ({x: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), y2: +e.getAttribute('y2'), thin: e.classList.contains('thin')}))")
    live = [b for b in bands if b["n"] > 0]
    ok = len(dots) == len(live) == len(bars)
    for d, b, bar in zip(dots, live, bars):
        x, y = curve_xy(b["mean_conf"], b["hit_rate"])
        _, y_hi = curve_xy(b["mean_conf"], b["ci_hi"])
        _, y_lo = curve_xy(b["mean_conf"], b["ci_lo"])
        ok = ok and near(d["cx"], x, 0.05) and near(d["cy"], y, 0.05) and d["thin"] == b["thin"] and near(bar["x"], x, 0.05) and near(bar["y1"], y_hi, 0.05) and near(bar["y2"], y_lo, 0.05) and bar["thin"] == b["thin"]
    check(f"{label}: every dot has a 95% error bar from the independent Wilson interval, thin bands hollow and dashed", ok, f"{dots[:2]} {bars[:2]}")
    ns = [t.strip() for t in page.eval_on_selector_all("#curve text.n", "els => els.map(e => e.textContent)")]
    check(f"{label}: the number of calls is printed under every band", ns == [f"n={b['n']}" for b in bands], str(ns))


def group_text(g):
    return f"n={g['n']} · too few to say anything" if g["thin"] else f"n={g['n']} · right {pct(g['hit_rate'])} · said {pct(g['mean_conf'])}"


def check_bias(E, groups, labelof, label):
    page = E.page
    rows = attrs(page, "#bias-chart g.bm", ["data-key", "data-n", "data-gap", "data-lo", "data-hi", "data-verdict"])
    ok = len(rows) == len(groups)
    for r, g in zip(rows, groups):
        ok = ok and r["data-key"] == str(g["key"]) and int(r["data-n"]) == g["n"] and near(float(r["data-gap"]), g["gap"] * 100, 1e-4) \
            and near(float(r["data-lo"]), g["gap_lo"] * 100, 1e-4) and near(float(r["data-hi"]), g["gap_hi"] * 100, 1e-4) and r["data-verdict"] == g["verdict"]
    check(f"{label}: one bar per group with the independent gap, its 95% interval and the verdict ({len(groups)} groups)", ok, f"{rows[:2]} vs {[(g['key'], g['gap'], g['gap_lo']) for g in groups[:2]]}")
    lis = page.eval_on_selector_all("#bias-list li", "els => els.map(e => [e.querySelector('.t span').textContent, e.querySelector('.t em').textContent, e.querySelector('.m').textContent, e.querySelector('.cap').textContent])")
    want = [[labelof(g["key"]), group_text(g), "–" if g["thin"] else f"{gap_pts(g['gap'])} pts", g["verdict"]] for g in groups]
    check(f"{label}: every line shows its n, the hit rate, the stated confidence and the gap in points", [[c.strip() for c in r] for r in lis] == want, f"{lis[:2]} vs {want[:2]}")


def group_line(g, per="card"):
    """The 'your pattern' line the case file prints for one group (same wording rules as design/mechanics.md 4.10)."""
    if not g or not g["n"]:
        return "n=0 · nothing resolved here yet"
    edge = "" if g["avg_points"] is None else f" · edge {signed(js_round(g['avg_points']))} a {per}"
    if g["thin"]:
        return f"n={g['n']} · too few to say anything{edge}"
    return f"n={g['n']} · right {pct(g['hit_rate'])} · said {pct(g['mean_conf'])} · gap {gap_pts(g['gap'])} pts ({g['verdict']}){edge}"


LENSES = ["lens-what", "lens-reasoning", "lens-luck", "lens-pattern", "lens-next"]
DOMAIN_NAMES = {"work": "Work", "life": "Life", "world": "World"}
HORIZON_NAMES = {"week": "Up to a week", "month": "A month", "longer": "Longer"}


def kept_out_reason(p, resolve, cfg):
    lo, hi = cfg["journal"]["trivial_band"]
    if resolve["outcome"] == "void":
        return "it was void"
    if not p["scored"]:
        return "it was an extra card for the day, logged but not scored"
    if p["b"] < lo or p["b"] > hi:
        return f"its baseline ({pct(p['b'])}) was a near-certainty, which says nothing about you"
    if "self_controlled" in p.get("flags", []):
        return "it was about something fully in your own control"
    return None


def check_casefile(E, ref, events, p, resolve, label):
    """Open one resolved card and compare its five lenses with the independent record."""
    page = E.page
    go(page, f"#/journal/{p['id']}")
    page.wait_for_selector("#lens-pattern")
    order = page.eval_on_selector_all("section[id^=lens-]", "els => els.map(e => e.id)")
    check(f"{label}: the five lenses come in order", order == LENSES, str(order))
    j = ref["journal"]
    check(f"{label}: the pattern card says it is the journal only, with the counted n", f"journal only · n={j['counted']}" in text(page, "#lens-pattern"), text(page, "#lens-pattern")[:120])
    dom = next((g for g in j["by_domain"] if g["key"] == p["domain"]), None)
    hor = next((g for g in j["by_horizon"] if g["key"] == p["horizon"]), None)
    cell = (j["grid"].get(p["domain"]) or {}).get(p["horizon"])
    want_cell = f"n={cell['n']} · edge {signed(js_round(cell['edge'] / cell['n']))} a card" if cell else "n=0 · nothing resolved here yet"
    got = {k: text(page, f"#{k}") for k in ("pat-domain", "pat-horizon", "pat-cell", "pat-all")}
    want = {"pat-domain": group_line(dom), "pat-horizon": group_line(hor), "pat-cell": want_cell, "pat-all": group_line(j["summary"])}
    check(f"{label}: your pattern for {p['domain']}, {p['horizon']} and for the whole journal equals the independent record", got == want, f"{got} vs {want}")
    heads = {k: text(page, f"#{k}-k") for k in ("pat-domain", "pat-horizon", "pat-cell")}
    check(f"{label}: the rows are named for this card's domain and horizon",
          heads == {"pat-domain": DOMAIN_NAMES[p["domain"]], "pat-horizon": HORIZON_NAMES[p["horizon"]], "pat-cell": f"{DOMAIN_NAMES[p['domain']]}, {HORIZON_NAMES[p['horizon']].lower()}"}, str(heads))
    why = kept_out_reason(p, resolve, CFG)
    note = page.query_selector("#pattern-kept-out")
    if why:
        check(f"{label}: it says this card is kept out of the record, and why", note is not None and text(page, "#pattern-kept-out") == f"This card is kept out of your record because {why}.", text(page, "#pattern-kept-out") if note else "no note")
    else:
        check(f"{label}: a card that counts carries no kept-out note", note is None)
    if resolve["outcome"] != "void":
        rows = page.eval_on_selector_all("#lens-next tbody tr", "els => els.length")
        check(f"{label}: the next-time table lists the other numbers and marks the one said", rows == 11 and page.eval_on_selector_all("#lens-next tr.mine", "els => els.length") == 1, str(rows))
        edge_txt = text(page, "#lens-luck .sumgrid .p:nth-child(2) b")
        want_edge = signed(resolve["edge"]) if p["scored"] else "Unscored"
        check(f"{label}: the luck lens shows the edge the engine recorded", edge_txt == want_edge, f"{edge_txt} vs {want_edge}")
    else:
        check(f"{label}: a void card scores nothing and says so", "No score on a void card" in text(page, "#lens-luck") and "Nothing to compare" in text(page, "#lens-next"))
    F.audit(E, f"case file {label}")


def phase_b3(E):
    """Block 3, the Mirror: every statistic on the screens against tools/ref_mirror.py, from the same raw log."""
    last_played, today = "2026-11-28", "2026-11-30"
    rec = synth.mixed_player(today)
    path = rec.write(os.path.join(E.tmp, "mixed.jsonl"))
    events = ref_mirror.read(path)
    ref = ref_mirror.reference(events, today)
    cfgm = CFG["mirror"]
    check("the synthetic player holds every kind of card the Mirror must tell apart", ref["journal"]["voided"] >= 1 and ref["journal"]["unscored"] >= 1 and ref["journal"]["kept_out"] >= 2, str({k: ref["journal"][k] for k in ("voided", "unscored", "kept_out", "counted")}))

    page = open_app(E, today, path)
    # -- Today shows the same standing as the Mirror --
    go(page, "#/today")
    page.wait_for_selector("#standing-link")
    check_standing(E, ref, "Today", False, mirror=False)
    check("Today's block count follows the build (Block 10 of 10 built)", "Block 10 of 10 built" in page.inner_text("body"))
    F.audit(E, "today with standing")
    shot(E, "b3-today.png")

    # -- the Mirror: standing, curve, bias map, journal record, belts --
    F.tab(page, "mirror")
    page.wait_for_selector("#standing")
    check_standing(E, ref, "Mirror", False)
    F.audit(E, "mirror")
    shot(E, "b3-mirror.png")
    page.set_viewport_size(SMALL); F.audit(E, "mirror"); page.set_viewport_size(VIEW)

    check_curve(E, ref["bands"], "gym curve", cfgm["thin_below"])
    check("the gym curve is the default view", page.get_attribute("#curve-source [data-value=gym]", "aria-pressed") == "true")
    # -- the bias map by topic, then the journal's domain and horizon --
    check_bias(E, ref["topics"], cap1, "by topic")
    page.click("#bias-split [data-value=domain]")
    page.wait_for_selector("#bias-chart")
    check_bias(E, ref["journal"]["by_domain"], cap1, "by domain")
    page.click("#bias-split [data-value=horizon]")
    page.wait_for_selector("#bias-chart")
    names = {"week": "Up to a week", "month": "A month", "longer": "Longer"}
    check_bias(E, ref["journal"]["by_horizon"], lambda k: names[k], "by horizon")
    page.click("#bias-split [data-value=topic]")

    # -- the journal curve --
    page.click("#curve-source [data-value=journal]")
    page.wait_for_selector("#curve")
    check_curve(E, ref["journal"]["bands"], "journal curve", cfgm["thin_below"])
    page.click("#curve-source [data-value=gym]")

    # -- the journal-only record --
    j = ref["journal"]
    rows = {tr.query_selector_all("td")[0].text_content().strip(): [td.text_content().strip() for td in tr.query_selector_all("td")[1:]] for tr in page.query_selector_all("#jr-table tr")}
    s = j["summary"]
    want = {
        "Resolved": [str(j["resolved"]), f"{j['voided']} void · {j['unscored']} extra · {j['kept_out']} kept out"],
        "Counted": [str(j["counted"]), "scored, not void, not trivial"],
        "Happened": [pct(j["yes_rate"]), f"n={j['counted']}"],
        "Said on average": [pct(j["mean_prob"]), f"n={j['counted']}"],
        "Edge": [f"{signed(js_round(s['avg_points']))} a card", f"total {signed(s['points'])}"],
    }
    check("the journal-only record equals the independent count (resolved, void, extra, kept out, yes rate, edge)", rows == want, f"{rows} vs {want}")
    grid = {(tr.get_attribute("data-domain"), td.get_attribute("data-horizon")): td.text_content().strip() for tr in page.query_selector_all("#jr-grid tbody tr") for td in tr.query_selector_all("td[data-horizon]")}
    want_grid = {}
    for d in CFG["journal"]["domains"]:
        for hz in ("week", "month", "longer"):
            c = j["grid"].get(d, {}).get(hz)
            want_grid[(d, hz)] = f"n={c['n']} {signed(js_round(c['edge'] / c['n']))}" if c else "n=0"
    check("the domain-by-horizon grid shows n and average edge in every cell, as counted independently", grid == want_grid, f"{grid} vs {want_grid}")

    # -- belts: real progress, no gate claimed --
    belts = page.eval_on_selector_all("#belts li", "els => els.map(e => [e.getAttribute('data-belt'), e.querySelector('em').textContent, e.querySelector('.chip').textContent])")
    b1 = next(b for b in belts if b[0] == "B1")
    check("the Yellow belt row shows the resolved count against 40 and that no gate is claimed", f"Resolved real predictions: {j['counted']} of 40" in b1[1] and "Gates U0 to U3: 1 of 4" in b1[1] and b1[2] == "Not yet", str(b1))
    check("five belts are listed, none earned yet", [b[0] for b in belts] == ["B1", "B2", "B3", "B4", "B5"] and all(b[2] == "Not yet" for b in belts), str(belts))

    # -- the plain numbers table still matches (Block 1's check, now with 564 calls) --
    gym = ref["gym"]
    rows = {tr.query_selector_all("td")[0].text_content().strip(): (tr.query_selector_all("td")[1].text_content().strip(), tr.query_selector_all("td")[2].text_content().strip()) for tr in page.query_selector_all("#stats tr")}
    note = "too sure" if gym["gap"] > 0.02 else "too shy" if gym["gap"] < -0.02 else "honest"
    check("Your numbers: calls, right, average confidence, gap and points equal the recomputation",
          rows == {"Calls": (str(gym["n"]), "n"), "Right": (f"{gym['hits']} of {gym['n']} ({pct(gym['hit_rate'])})", f"n={gym['n']}"), "Average confidence": (pct(gym["mean_conf"]), f"n={gym['n']}"),
                   "Gap": (f"{gap_pts(gym['gap'])} pts", note), "Points": (signed(gym["points"]), f"{signed(js_round(gym['avg_points']))} a call")}, str(rows))

    # -- the case file: one card of each kind, opened from the Journal --
    resolves = {e["prediction"]: e for e in events if e["type"] == "resolve"}
    cards = [(p, resolves[p["id"]]) for p in events if p["type"] == "prediction" and p["id"] in resolves]
    pick = {
        "a counted work card": next((c for c in cards if c[1]["outcome"] != "void" and c[0]["scored"] and c[0]["domain"] == "work" and c[0]["horizon"] == "week" and kept_out_reason(*c, CFG) is None), None),
        "a counted life card": next((c for c in cards if c[1]["outcome"] != "void" and c[0]["scored"] and c[0]["domain"] == "life" and kept_out_reason(*c, CFG) is None), None),
        "a counted world card": next((c for c in cards if c[1]["outcome"] != "void" and c[0]["scored"] and c[0]["domain"] == "world" and kept_out_reason(*c, CFG) is None), None),
        "the month-horizon card (a group too small to read)": next((c for c in cards if c[0]["horizon"] == "month" and kept_out_reason(*c, CFG) is None), None),
        "the near-certain card": next((c for c in cards if c[0]["b"] > CFG["journal"]["trivial_band"][1] or c[0]["b"] < CFG["journal"]["trivial_band"][0]), None),
        "the self-controlled card": next((c for c in cards if "self_controlled" in c[0].get("flags", [])), None),
        "the extra card for the day": next((c for c in cards if not c[0]["scored"]), None),
        "the void card": next((c for c in cards if c[1]["outcome"] == "void"), None),
    }
    check("the record holds one resolved card of every kind the case file must treat differently", all(pick.values()), str([k for k, v in pick.items() if not v]))
    for name, found in pick.items():
        if found:
            check_casefile(E, ref, events, found[0], found[1], name)
    shot(E, "b3-casefile.png")
    E.ctx.close()

    # -- the same record on the last played day: today is played, so the streak is alive and today can beat the average --
    ref2 = ref_mirror.reference(events, last_played)
    page = open_app(E, last_played, path)
    F.tab(page, "mirror")
    page.wait_for_selector("#standing")
    check_standing(E, ref2, "Mirror on a played day", True)
    check("on a played day the streak note says played today", text(page, "#streak-note") == "played today")
    E.ctx.close()

    # -- an empty phone: nothing to show, nothing invented --
    page = open_app(E, today)
    F.tab(page, "mirror")
    page.wait_for_selector("#standing")
    check("a new phone: level 1, no streak, no seven-day average, and no made-up numbers",
          text(page, "#level") == "1" and text(page, "#streak") == "0 days" and text(page, "#seven") == "–" and text(page, "#career") == "0 career points" and text(page, "#level-note") == "140 points to 2")
    check("a new phone: empty states say why instead of drawing a curve", "needs at least" in text(page, "#curve-empty") and "No calls yet" in text(page, "#bias-empty"))
    F.audit(E, "mirror empty")
    E.ctx.close()



# ---------------------------------------------------------------------------------------------------------------
# Block 4: the Lesson Engine (flags, drills, the exam, the autopsy)
# ---------------------------------------------------------------------------------------------------------------
LCFG = CFG["lessons"]
STEPS = CFG["binary"]["dial_steps"]
EXAM_BANK = json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "exam-u1.json"), encoding="utf-8"))["questions"]
EXAM_BY_CLAIM = {q["claim"]: q for q in EXAM_BANK}
EXAM_IDS = {q["id"] for q in EXAM_BANK}
PRACTICE_BY_CLAIM = F.BY_CLAIM
PRACTICE_IDS = {q["id"] for q in PRACTICE_BY_CLAIM.values()}
START = "2026-09-01"


def whole(x): return js_round(x * 100)


def mean(xs):
    """Added left to right, as the app adds: Python 3.12's sum() compensates, and the two disagree in the last digit, which a value on a rounding edge shows."""
    s = 0.0
    for x in xs:
        s += x
    return s / len(xs)


def read_events(page):
    return F.read_db(page)["events"]


def of_type(page, type_, **where):
    return [e for e in read_events(page) if e["type"] == type_ and all(e.get(k) == v for k, v in where.items())]


def answer(page, by_claim, c, right=True, side=None):
    """Read the question on screen and set the dial to `c` on the right side (or the wrong one). Returns (question, side)."""
    page.wait_for_selector("#claim")
    q = by_claim[text(page, "#claim")]
    if side is None:
        side = ("yes" if q["answer"] else "no") if right else ("no" if q["answer"] else "yes")
    k, sign = STEPS.index(c), (1 if side == "yes" else -1)
    if k == 0:  # a 50% call: lean to the side first, then come back, so the dial remembers the lean
        page.fill("#dial", str(sign))
    page.fill("#dial", str(sign * k))
    return q, side


def press_lock(page):
    F.settle(page)
    page.click("#lock")


def advance_to(page, prev, prefixes=("#/summary/", "#/exam/")):
    page.wait_for_function("([prev, prefixes]) => { if (prefixes.some((p) => location.hash.startsWith(p))) return true; const c = document.getElementById('claim'); return !!c && c.textContent !== prev; }",
                           arg=[prev, list(prefixes)], timeout=15000)


def play_revealed(page, by_claim, n, c=0.7, first_done=0):
    """n calls with an instant reveal, each the right answer at c (below 90%, so a wheel drill asks nothing)."""
    for _ in range(n):
        answer(page, by_claim, c)
        claim = text(page, "#claim")
        press_lock(page)
        page.wait_for_selector("#verdict")
        F.settle(page)
        page.click("#next")
        advance_to(page, claim)


def play_sealed(page, by_claim, n, c=0.5, rights=None):
    """n exam calls at c, the first `rights` of them right (half by default). Nothing is shown between calls."""
    rights = n // 2 if rights is None else rights
    for i in range(n):
        answer(page, by_claim, c, right=(i < rights))
        claim = text(page, "#claim")
        press_lock(page)
        advance_to(page, claim)


def natural_calls(events):
    return [e for e in events if e["type"] == "call" and e["mode"] in LCFG["natural_modes"]]


def l01_evidence(events):
    t = LCFG["triggers"]["L01"]
    obs = [c for c in natural_calls(events) if t["band"][0] - 1e-9 <= c["c"] <= t["band"][1] + 1e-9][-t["window"]:]
    mc, hr = mean([c["c"] for c in obs]), mean([1 if c["hit"] else 0 for c in obs])
    return f"In your last {len(obs)} calls stated at {whole(t['band'][0])} to {whole(t['band'][1])}% you said {pct(mc)} on average and were right {pct(hr)} of the time: {whole(mc - hr)} points too sure."


def note_expect(call_c, earlier, q):
    """What the instant note under a miss should say, from the player's own earlier calls and the question's records."""
    same = [c for c in natural_calls(earlier) if c["c"] >= call_c - 1e-9]
    if len(same) >= 5:
        hit = mean([1 if c["hit"] else 0 for c in same])
        step = min(STEPS, key=lambda s: abs(s - hit))
        cal = f"From your own record: your calls at {pct(call_c)} or more were right {pct(hit)} of the time ({len(same)} calls). A calibrated call there is about {pct(step)}."
    else:
        cal = f"At {pct(call_c)} you expect to be wrong about 1 time in {js_round(1 / (1 - call_c))}. This was one of them. Was it that one in {js_round(1 / (1 - call_c))}, or did the wrong side tempt you?"
    base = q.get("base")
    if not isinstance(base, (int, float)):
        luck = "This comes from a documented figure, not a record of cases, so there is no count to tell luck from judgment. Treat a miss this sure as judgment."
    else:
        chance = base if q["answer"] else 1 - base
        luck = (f"In the records this outcome happens in only {pct(chance)} of cases like it. This one may be luck." if chance < LCFG["luck_rare_below"] - 1e-9
                else f"In the records this outcome happens in {pct(chance)} of cases like it. It was not a freak: the call, not luck, was the problem.")
    return cal, luck


def phase_b4_flags(E):
    """Flags: an overconfident record opens L01; its lesson, its wheel drill, the instant note, and the re-test clock. Then the other drills."""
    rec = synth.lesson_player("over_stuck", days=60, start=START)
    path = rec.write(os.path.join(E.tmp, "over_stuck.jsonl"))
    events = rec.sorted()
    today = synth.add_days(START, 60)
    page = open_app(E, today, path)
    go(page, "#/today")
    page.wait_for_selector("#needs")
    rows = attrs(page, "#needs a[data-flag]", ["data-flag", "data-state"])
    check("an overconfident record opens one pattern flag, Overconfident at the top, waiting for its lesson",
          len(rows) == 1 and rows[0]["data-state"] == "open" and "Overconfident at the top" in text(page, "#needs"), str(rows))
    check("Today puts the pattern's lesson ahead of the next Unit 1 card", text(page, "#lesson-line") == "Pattern · Overconfident at the top", text(page, "#lesson-line"))
    F.audit(E, "today with a pattern flag")
    fid = rows[0]["data-flag"]
    opened = of_type(page, "flag", state="open")
    check("the flag is in the record once, with the numbers that opened it", len(opened) == 1 and opened[0]["trigger"] == "L01" and opened[0]["evidence"]["n"] == LCFG["triggers"]["L01"]["window"], str(opened))
    for _ in range(3):
        go(page, "#/path"); go(page, "#/today")
    page.wait_for_selector("#needs")
    check("looking again, on every screen, writes no second flag", len(of_type(page, "flag")) == 1, str(len(of_type(page, "flag"))))

    page.click("#needs a[data-flag]")
    page.wait_for_selector("#flag-title")
    check("the flag screen names the pattern and states the record that opened it, equal to the independent count",
          text(page, "#flag-title") == "Overconfident at the top" and l01_evidence(events) in text(page, "#flag-evidence"), text(page, "#flag-evidence"))
    check("it carries the lesson (the price of 99) and the drill", "The price of 99" in text(page, "#flag-lesson") and "wheel" in text(page, "#flag-action").lower(), text(page, "#flag-action")[:160])
    F.audit(E, "flag lesson")
    shot(E, "b4-flag.png")
    page.click("#flag-drill")
    page.wait_for_selector("#claim")
    check("the drill opens as a drill: 1 of 15, tagged Drill, at the address of its flag",
          page.url.endswith(f"#/gym/drill-{fid}") and text(page, ".cnt") == "1 of 15" and text(page, "#mode-tag") == "Drill", f"{page.url} {text(page, '.cnt')} {text(page, '#mode-tag')}")
    check("the lesson was read when the drill started, so the flag is waiting on the drill", [e["flag"] for e in of_type(page, "flag", state="lesson")] == [fid])

    # a deliberate miss at 90%: the wheel check comes first, then the instant note
    q, side = answer(page, PRACTICE_BY_CLAIM, 0.9, right=False)
    claim = text(page, "#claim")
    press_lock(page)
    page.wait_for_selector("#wheel-check")
    check("a call at 90% in the wheel drill is checked against the wheel before it locks, and nothing is saved yet", len(of_type(page, "call", session=of_type(page, "session")[-1]["id"])) == 0 and "wheel" in text(page, "#wheel-check").lower())
    page.click("#wheel-lower")
    page.wait_for_selector("#lock")
    check("lowering the dial goes back to the dial", page.query_selector("#wheel-check") is None)
    press_lock(page)
    page.wait_for_selector("#wheel-keep")
    F.settle(page)
    page.click("#wheel-keep")
    page.wait_for_selector("#verdict")
    page.wait_for_selector("#instant-note")
    cal, luck = note_expect(0.9, events, q)
    check("the miss at 90% gets the instant note: what a calibrated call looked like, from the player's own record",
          text(page, "#note-calibrated") == cal, f"{text(page, '#note-calibrated')} vs {cal}")
    check("the note says whether the records call the outcome rare, by the 20% rule", text(page, "#note-luck") == luck, f"{text(page, '#note-luck')} vs {luck}")
    F.audit(E, "reveal with the instant note")
    shot(E, "b4-note.png")
    F.settle(page)
    page.click("#next")
    advance_to(page, claim)
    play_revealed(page, PRACTICE_BY_CLAIM, 14, c=0.7)
    page.wait_for_function("location.hash.startsWith('#/summary/')")
    check("the drill ends on its summary, which says how the two re-tests work", "Two re-tests" in text(page, "#drill-next"), text(page, "#drill-next")[:120])
    F.audit(E, "drill summary")
    ev = read_events(page)
    drill_calls = [e for e in ev if e["type"] == "call" and e["mode"] == "drill"]
    check("15 drill calls were saved, all from the practice bank and none from the exam bank", len(drill_calls) == 15 and all(e["q"] in PRACTICE_IDS and e["q"] not in EXAM_IDS for e in drill_calls), str(len(drill_calls)))
    done = [e for e in ev if e["type"] == "flag" and e.get("state") == "drill"]
    check("the flag moved to its re-tests exactly once, from the drill's session", len(done) == 1 and done[0]["flag"] == fid and done[0]["session"] == drill_calls[0]["session"], str(done))
    go(page, "#/today")
    page.wait_for_selector("#needs")
    ready = synth.add_days(today, LCFG["retest_after_days"][0])
    row = text(page, "#needs a[data-flag]")
    check("Today says when the first re-test starts, three days after the drill", f"Re-test 1 of 2 starts on {ready}" in row, row)
    check("a pattern in repair no longer holds the lesson slot", "Pattern" not in text(page, "#lesson-line"), text(page, "#lesson-line"))
    check("drill calls do not count toward any trigger, and the flag is not opened again by them", len(of_type(page, "flag", state="open")) == 1)
    go(page, "#/path")
    page.wait_for_selector("#patterns")
    check("the Path lists the pattern under Your patterns", "Overconfident at the top" in text(page, "#patterns"), text(page, "#patterns"))
    E.ctx.close()

    # -- the other drills: what is locked on the dial --
    for kind, drill, steps_ok, steps_locked, name in (
        ("under", "forced", [0.5, 0.8, 0.85, 0.9, 0.95, 0.99], [0.55, 0.6, 0.65, 0.7, 0.75], "Underconfident"),
        ("fence", "zone_locked", [c for c in STEPS if c >= 0.6], [0.5, 0.55], "Fence-sitting"),
    ):
        r = synth.lesson_player(kind, days=60, start=START)
        path = r.write(os.path.join(E.tmp, f"{kind}.jsonl"))
        page = open_app(E, synth.add_days(START, 60), path)
        go(page, "#/today")
        page.wait_for_selector("#needs a[data-flag]")
        fid = attrs(page, "#needs a[data-flag]", ["data-flag"])[0]["data-flag"]
        check(f"a {kind} record opens its own pattern, {name}", name in text(page, "#needs"), text(page, "#needs"))
        go(page, f"#/flag/{fid}")
        page.wait_for_selector("#flag-drill")
        page.click("#flag-drill")
        page.wait_for_selector("#claim")
        locked = []
        for c in STEPS:
            k = STEPS.index(c)
            page.fill("#dial", str(k))
            enabled = page.is_enabled("#lock")
            locked.append((c, enabled))
        bad = [c for c, en in locked if en != (c in steps_ok)]
        check(f"the {drill} drill locks exactly the steps it should: open {[whole(c) for c in steps_ok]}", not bad, str(locked))
        page.fill("#dial", str(STEPS.index(steps_locked[0])))
        check("a locked step says why", not page.is_hidden("#dial-hint") and len(text(page, "#dial-hint")) > 10, text(page, "#dial-hint"))
        F.audit(E, f"{drill} drill")
        E.ctx.close()

    # -- soft questions: the rewrite drill (L04) --
    r = synth.soft_player(days=10, start=START)
    path = r.write(os.path.join(E.tmp, "soft.jsonl"))
    page = open_app(E, synth.add_days(START, 10), path)
    go(page, "#/today")
    page.wait_for_selector("#needs a[data-flag]")
    fid = attrs(page, "#needs a[data-flag]", ["data-flag"])[0]["data-flag"]
    check("five rejected predictions in the last ten open Soft questions", "Soft questions" in text(page, "#needs"), text(page, "#needs"))
    go(page, f"#/flag/{fid}")
    page.wait_for_selector("#flag-drill")
    page.click("#flag-drill")
    page.wait_for_selector("#rewrite-text")
    with open(os.path.join(synth.ROOT, "data", "vague_claims.csv"), encoding="utf-8") as f:
        import csv
        vague = list(csv.DictReader(f))
    check("the rewrite drill starts with the first vague prediction on the list", text(page, "#rewrite-vague") == vague[0]["vague"], text(page, "#rewrite-vague"))
    check("Next one waits until the rewrite passes the checker", page.is_disabled("#rewrite-go"))
    page.fill("#rewrite-text", vague[0]["vague"])
    check("the original wording is refused", "That is the original" in text(page, "#rewrite-flags") and page.is_disabled("#rewrite-go"), text(page, "#rewrite-flags"))
    F.audit(E, "rewrite drill")
    for i in range(LCFG["triggers"]["L04"]["drill"]["items"]):
        page.fill("#rewrite-text", vague[i]["sharp_example"])
        F.settle(page)
        check(f"rewrite {i + 1}: a sharp version is accepted", page.is_enabled("#rewrite-go"), text(page, "#rewrite-flags"))
        page.click("#rewrite-go")
        page.wait_for_timeout(80)
    page.wait_for_selector("#flag-progress")
    done = of_type(page, "flag", state="drill")
    check("five rewrites file the drill: the flag moves on and the rewrites are kept", len(done) == 1 and done[0]["items"] == 5 and len(done[0]["rewrites"]) == 5, str(done)[:200])
    check("the flag screen now counts the first re-test in journal predictions", "Re-test 1 of 2" in text(page, "#flag-action"), text(page, "#flag-action")[:100])
    E.ctx.close()

    # -- missed days (L15): a smaller day, no lesson --
    r = synth.Rec(31)
    for k in range(10):
        day = synth.add_days(START, k)
        if k < 3:
            r.play_day(day, 20, synth.pol_calibrated, mode="baseline", unit="U0")
        else:
            r.play_day(day, 18, synth.pol_calibrated)
        r.prediction(day, 400, 0.6, 0.5)
    path = r.write(os.path.join(E.tmp, "missed.jsonl"))
    today = synth.add_days(START, 13)
    page = open_app(E, today, path)
    go(page, "#/today")
    page.wait_for_selector("#habit-card")
    m = LCFG["triggers"]["L15"]["minimum"]
    practice = len([e for e in r.events if e["type"] == "call" and e["mode"] == "practice"])
    check("three missed days in the last seven open Missed days, and Today says it is a minimum day",
          f"{m['gym_calls']} gym calls" in text(page, "#habit-card") and text(page, "#habit-run") == f"0 of {LCFG['triggers']['L15']['clear_days']} days", text(page, "#habit-card")[:160])
    check("the session is shrunk to the minimum and says so", text(page, "#gym-line") == f"{m['gym_calls']} calls · Unit 1 practice, {practice} of 90 so far · minimum session", text(page, "#gym-line"))
    check("it is not a judgment lesson: no pattern row and no lesson", page.query_selector("#needs a[data-flag]") is None and "Pattern" not in text(page, "#lesson-line"))
    F.audit(E, "today on a minimum day")
    page.click("#start")
    page.wait_for_selector("#claim")
    check("the session has exactly the minimum number of calls", text(page, ".cnt") == f"1 of {m['gym_calls']}", text(page, ".cnt"))
    E.ctx.close()


def exam_calls_for(page, attempt):
    return [e for e in read_events(page) if e["type"] == "call" and e.get("exam") == attempt]


def band_name(lo, hi): return f"{whole(lo)} to {whole(hi)}%"


def reasons_expect(res):
    out = []
    g = CFG["gates"]
    for r in res["reasons"]:
        if r == "index":
            out.append(f"Your average confidence ({pct(res['meanConf'])}) and your hit rate ({pct(res['hitRate'])}) were {whole(abs(res['index']))} points apart. The limit is {whole(g['calibration_index_tolerance'])}.")
        elif r.startswith("band:"):
            b = next(x for x in res["bands"] if str(x["lo"]) == r[5:])
            out.append(f"Calls stated at {band_name(b['lo'], b['hi'])}: you said {pct(b['meanConf'])} and were right {pct(b['hitRate'])} ({b['n']} calls), {b['z']:.1f} standard errors off. The limit is {g['band_z_max']}.")
    return out


def check_verdict(E, page, attempt, want_pass, label):
    """The verdict screen against tools/ref_lessons.py gate, from the 200 calls in the record."""
    calls = [{"c": e["c"], "hit": e["hit"]} for e in exam_calls_for(page, attempt)]
    ref = ref_lessons.gate(calls)
    check(f"{label}: the record holds all 200 exam calls and the independent verdict is {'a pass' if want_pass else 'a fail'}", len(calls) == 200 and ref["pass"] == want_pass, f"{len(calls)} calls, ref {ref['pass']}, {ref['reasons']}")
    page.wait_for_selector("#exam-verdict")
    sign = "+" if ref["index"] > 0 and whole(abs(ref["index"])) else "−" if ref["index"] < 0 and whole(abs(ref["index"])) else ""
    meanconf = mean([c["c"] for c in calls]); hit = mean([1 if c["hit"] else 0 for c in calls])
    got = {k: text(page, f"#exam-{k}") for k in ("verdict", "n", "conf", "hit", "gap")}
    want = {"verdict": "Passed" if want_pass else "Not passed this time", "n": "200", "conf": pct(meanconf), "hit": pct(hit), "gap": f"{sign}{whole(abs(ref['index']))}"}
    check(f"{label}: verdict, calls, average confidence, hit rate and gap equal the independent recomputation", got == want, f"{got} vs {want}")
    rows = page.eval_on_selector_all("#exam-bands tbody tr", "els => els.map(e => [...e.querySelectorAll('td')].map(t => t.textContent.trim()))")
    want_rows = []
    for b in ref["bands"]:
        if b["n"]:
            want_rows.append([band_name(b["lo"], b["hi"]), str(b["n"]), pct(b["meanConf"]), pct(b["hitRate"]), (f"{b['z']:.1f} SE{' (off)' if b['off'] else ''}" if b["checked"] else "not judged")])
    check(f"{label}: the band table lists every band with calls, with the standard errors off and which are off", rows == want_rows, f"{rows} vs {want_rows}")
    if not want_pass:
        stored = of_type(page, "exam", state="result", exam=attempt)[0]
        res = {"reasons": ref["reasons"], "meanConf": meanconf, "hitRate": hit, "index": ref["index"], "bands": ref["bands"]}
        paras = [t.strip() for t in page.eval_on_selector_all("#exam-reasons p", "els => els.map(e => e.textContent)")]
        want_p = reasons_expect(res)
        check(f"{label}: it says why in plain words (the index and the off band), with the numbers", paras[:len(want_p)] == want_p, f"{paras} vs {want_p}")
        check(f"{label}: the worst band is the one the stored verdict names", stored["worst"] is not None and stored["worst"]["dir"] == "too sure" and stored["worst"]["lo"] == 0.9, str(stored["worst"]))
    check(f"{label}: exactly one verdict is in the record, and it is the independent one", len(of_type(page, "exam", state="result", exam=attempt)) == 1 and of_type(page, "exam", state="result", exam=attempt)[0]["pass"] == want_pass)
    F.audit(E, f"exam {label}")


def phase_b4_exam(E):
    """The Unit 1 exam: opens at 90 practice calls, sealed sittings of 20, judged once at call 200, repair then retake."""
    rec = synth.eligible_player(start=START)
    path = rec.write(os.path.join(E.tmp, "eligible.jsonl"))
    page = open_app(E, "2026-09-09", path)
    go(page, "#/path")
    page.wait_for_selector("#gate-card")
    check("after 60 baseline and 90 practice calls the exam is Ready, for 200 fresh calls in 10 sittings of 20", text(page, "#gate-status") == "Ready" and "200 fresh calls in 10 sittings of 20" in text(page, "#gate-card"), text(page, "#gate-card")[:200])
    go(page, "#/today")
    page.wait_for_selector("#need-exam")
    check("Today has the exam in 'Needs you'", "Unit 1 exam" in text(page, "#need-exam"), text(page, "#need-exam"))
    check("150 calls are in the record before any exam call", text(page, "#stat-calls") == "150", text(page, "#stat-calls"))
    go(page, "#/path")
    page.wait_for_selector("#gate-start")
    F.audit(E, "path with the exam ready")
    shot(E, "b4-path.png")
    page.click("#gate-start")
    page.wait_for_selector("#claim")
    check("the first sitting opens as the exam, sitting 1 of 10, 1 of 20", text(page, ".cnt") == "1 of 20" and text(page, "#mode-tag") == "Exam · sitting 1 of 10", f"{text(page, '.cnt')} {text(page, '#mode-tag')}")
    check("an exam question comes from the exam pool only", text(page, "#claim") in EXAM_BY_CLAIM, text(page, "#claim")[:60])
    F.audit(E, "exam sitting")
    play_sealed(page, EXAM_BY_CLAIM, 20)
    page.wait_for_selector("#exam-sealed")
    attempt = of_type(page, "exam", state="start")[0]["id"]
    check("the first sitting ends on the sealed screen: 20 of 200, and no verdict", text(page, "#exam-count") == "20 of 200" and page.query_selector("#exam-verdict") is None, text(page, "#exam-count"))
    F.audit(E, "exam sealed")
    ec = exam_calls_for(page, attempt)
    check("20 exam calls were saved, each carrying its attempt, none shown a reveal, all from the exam pool", len(ec) == 20 and all(e["mode"] == "exam" and e["q"] in EXAM_IDS for e in ec), str(len(ec)))
    check("there is one attempt, started with its size, and the sitting is recorded as sitting 1 of 10", len(of_type(page, "exam", state="start")) == 1 and of_type(page, "session", exam=attempt)[0]["n"] == 1 and of_type(page, "session", exam=attempt)[0]["of"] == 10)
    go(page, "#/mirror")
    page.wait_for_selector("#stats")
    rows = {tr.query_selector_all("td")[0].text_content().strip(): tr.query_selector_all("td")[1].text_content().strip() for tr in page.query_selector_all("#stats tr")}
    check("sealed: the Mirror still counts only the 150 calls, not the 20 exam calls", rows["Calls"] == "150", str(rows))
    go(page, "#/path")
    page.wait_for_selector("#gate-card")
    check("the Path says the exam is in progress and offers the next sitting of 20", text(page, "#gate-status") == "In progress" and text(page, "#gate-start") == "Next sitting: 20 calls", f"{text(page, '#gate-status')} / {text(page, '#gate-start')}")
    E.ctx.close()

    # -- a record 180 calls into the exam: the last sitting is played here, and the verdict is judged ----------------
    for kind, groups, want_pass in (
        ("pass", [(0.55, 40, 22), (0.65, 40, 26), (0.75, 40, 30), (0.85, 40, 34), (0.95, 20, 19)], True),
        ("fail", [(0.99, 180, 90)], False),
    ):
        r = synth.eligible_player(start=START)
        rows = synth.exam_rows(EXAM_BANK, groups, random.Random(5))
        attempt = r.exam_start("2026-09-09", 10, n=200, reused=0)
        for i in range(9):
            r.exam_sitting(attempt, synth.add_days("2026-09-09", i), 20, rows[i * 20:(i + 1) * 20], n=i + 1)
        path = r.write(os.path.join(E.tmp, f"exam_{kind}.jsonl"))
        page = open_app(E, synth.add_days("2026-09-09", 9), path)
        go(page, "#/today")
        page.wait_for_selector("#stat-calls")
        check(f"{kind}: 180 sealed exam calls are in the record, and Today counts only the 150 others", text(page, "#stat-calls") == "150", text(page, "#stat-calls"))
        go(page, "#/path")
        page.wait_for_selector("#gate-start")
        check(f"{kind}: the exam is in progress, 180 of 200", text(page, "#gate-status") == "In progress" and "180 of 200" in text(page, "#gate-card"), text(page, "#gate-card")[:160])
        page.click("#gate-start")
        page.wait_for_selector("#claim")
        check(f"{kind}: the last sitting is sitting 10 of 10", text(page, "#mode-tag") == "Exam · sitting 10 of 10" and text(page, ".cnt") == "1 of 20", f"{text(page, '#mode-tag')} {text(page, '.cnt')}")
        used_before = {e["q"] for e in r.events if e["type"] == "call"}
        check(f"{kind}: the question is one the exam has not asked", EXAM_BY_CLAIM[text(page, "#claim")]["id"] not in used_before)
        # 20 calls at 55%, 11 of them right: the 200 calls then sit at exactly 71% said and 71% right (a pass for the calibrated record),
        # away from any rounding edge
        play_sealed(page, EXAM_BY_CLAIM, 20, c=0.55, rights=11)
        page.wait_for_selector("#exam-verdict")
        check_verdict(E, page, attempt, want_pass, kind)
        shot(E, f"b4-exam-{kind}.png")
        go(page, "#/mirror")
        page.wait_for_selector("#stats")
        rows_m = {tr.query_selector_all("td")[0].text_content().strip(): tr.query_selector_all("td")[1].text_content().strip() for tr in page.query_selector_all("#stats tr")}
        check(f"{kind}: once judged, the 200 exam calls join the record (350 calls)", rows_m["Calls"] == "350", str(rows_m))
        go(page, f"#/exam/{attempt}")
        page.wait_for_selector("#exam-verdict")
        check(f"{kind}: opening the result again writes no second verdict", len(of_type(page, "exam", state="result", exam=attempt)) == 1)
        go(page, "#/path")
        page.wait_for_selector("#gate-status")
        if want_pass:
            check("pass: the Path says Passed and lists the attempt", text(page, "#gate-status") == "Passed" and page.query_selector("#gate-attempts li") is not None and "Passed" in text(page, "#gate-attempts"), text(page, "#gate-card")[:160])
            units = [t.strip() for t in page.eval_on_selector_all(".units .chip", "els => els.map(e => e.textContent)")]
            check("pass: Unit 1 shows Passed", units[1] == "Passed", str(units))
            go(page, "#/mirror")
            page.wait_for_selector("#belts")
            check("pass: the Yellow belt counts the passed Unit 1 gate (baseline and exam: 2 of 4)", "Gates U0 to U3: 2 of 4" in text(page, "#belts li[data-belt=B1] em"), text(page, "#belts li[data-belt=B1] em"))
        else:
            check("fail: the Path sends the player to the repair drill, not straight to a new exam", text(page, "#gate-status") == "Repair first" and text(page, "#gate-start") == "Start the repair drill", f"{text(page, '#gate-status')} / {text(page, '#gate-start')}")
            go(page, "#/today")
            page.wait_for_selector("#needs")
            check("fail: the 180 calls at 99% are now in the record, so the engine opens Overconfident at the top", "Overconfident at the top" in text(page, "#needs"), text(page, "#needs")[:200])
            go(page, "#/path")
            page.click("#gate-start")
            page.wait_for_selector("#claim")
            check("the repair drill is 20 calls, tagged Repair drill, aimed at the band that was too sure", text(page, ".cnt") == "1 of 20" and text(page, "#mode-tag") == "Repair drill", f"{text(page, '.cnt')} {text(page, '#mode-tag')}")
            play_revealed(page, PRACTICE_BY_CLAIM, 20, c=0.7)
            page.wait_for_function("location.hash.startsWith('#/summary/')")
            check("the repair drill's summary says a new exam is open", "new exam" in text(page, "#drill-next").lower(), text(page, "#drill-next"))
            check("the repair drill was recorded once against the failed attempt", len(of_type(page, "exam", state="repair", exam=attempt)) == 1)
            go(page, "#/path")
            page.wait_for_selector("#gate-start")
            check("after the repair drill the Path offers a new exam", text(page, "#gate-status") == "Ready" and text(page, "#gate-start") == "Start a new exam", f"{text(page, '#gate-status')} / {text(page, '#gate-start')}")
            page.click("#gate-start")
            page.wait_for_selector("#claim")
            evs = read_events(page)
            used = {e["q"] for e in evs if e["type"] == "call"}
            starts = [e for e in evs if e["type"] == "exam" and e["state"] == "start"]
            fresh = len([q for q in EXAM_BANK if q["id"] not in used])
            check("a retake knows how many of its questions must be asked again (104 fresh of the 200 it needs)", len(starts) == 2 and starts[1]["reused"] == max(0, 200 - fresh) == 96, f"{[s['reused'] for s in starts]}, fresh {fresh}")
            check("the retake's first sitting starts with a question never asked before", EXAM_BY_CLAIM[text(page, "#claim")]["id"] not in used)
        E.ctx.close()


def phase_b4_autopsy(E):
    """A synthetic miss at 85%: the autopsy blocks the next journal step, takes four questions and a chain audit, and the case file holds all five lenses."""
    r = synth.Rec(21)
    for k in range(6):
        r.play_day(synth.add_days(START, k), 6, synth.pol_calibrated)
    text_claim = "By 8 September 2026, the vendor will have signed the renewal."
    p = r.prediction("2026-09-07", 400, 0.85, 0.55, domain="work", due_option="tomorrow", text=text_claim)
    path = r.write(os.path.join(E.tmp, "miss85.jsonl"))
    page = open_app(E, "2026-09-08", path)
    go(page, "#/journal")
    page.wait_for_selector("#due-list")
    check("the card is due, and nothing is waiting on an autopsy yet", page.query_selector("#autopsy-due") is None and text_claim in text(page, "#due-list"))
    go(page, f"#/journal/{p['id']}")
    page.wait_for_selector("#resolve")
    page.click(".pick[data-value=no]")
    F.settle(page)
    page.click("#resolve")
    page.wait_for_function("location.hash.startsWith('#/autopsy/')")
    page.wait_for_selector("#autopsy-file")
    check("resolving a card that missed at 85% goes straight to its autopsy", page.url.endswith(f"#/autopsy/{p['id']}"), page.url)
    check("the autopsy says what it is: a miss at 85%, on this claim, You said 85%", text(page, "#autopsy-kind") == "A miss at 85%" and text(page, "#autopsy-claim") == text_claim and "You said 85%" in text(page, ".cap"), text(page, "#autopsy-kind"))
    suggest = "At your baseline (55% for yes), what happened had a 45% chance. That is not rare: the call, more than luck, was the problem."
    check("it says how likely the outcome was at the baseline, and whether that is rare", text(page, "#autopsy-suggest") == suggest, text(page, "#autopsy-suggest"))
    check("it cannot be filed empty", page.is_disabled("#autopsy-file"))
    F.audit(E, "autopsy")
    shot(E, "b4-autopsy.png")
    # -- the journal waits for it --
    go(page, "#/journal/write")
    page.wait_for_function("!location.hash.includes('write') && location.hash.startsWith('#/autopsy/')")
    check("writing a new prediction is blocked until the autopsy is filed", page.url.endswith(f"#/autopsy/{p['id']}"), page.url)
    go(page, "#/journal")
    page.wait_for_selector("#autopsy-due")
    check("the Journal tab puts the autopsy first, with its count", "1 due" in text(page, "#autopsy-due") and page.query_selector("#write") is None, text(page, "#autopsy-due")[:120])
    F.audit(E, "journal with an autopsy due")
    go(page, "#/today")
    page.wait_for_selector("#need-autopsy")
    check("Today lists the autopsy in 'Needs you', and the Journal line says it comes first", text_claim in text(page, "#need-autopsy") and text(page, "#journal-line") == "Autopsy due first", text(page, "#journal-line"))
    go(page, f"#/journal/{p['id']}")
    page.wait_for_selector("#autopsy-banner")
    check("the case file opens with an Autopsy due banner and a button to it", page.query_selector("#autopsy-open") is not None, text(page, "#autopsy-banner"))
    go(page, f"#/autopsy/{p['id']}")
    page.wait_for_selector("#autopsy-file")
    # -- fill it in --
    for link, mark in (("outside", "held"), ("e1", "weak"), ("case", "missed"), ("trip", "held")):
        page.click(f"#audit-{link} .pick[data-value={mark}]")
    page.fill("#autopsy-knew", "The vendor had signed the last two renewals on time.")
    page.fill("#autopsy-missed", "Their budget year had just reset and nobody owned the signature.")
    page.click("#autopsy-verdict .pick[data-value=judgment]")
    check("with the links marked and two of three boxes filled the autopsy still waits", page.is_disabled("#autopsy-file"))
    page.fill("#autopsy-rule", "Ask who signs, and when their budget resets.")
    check("every link marked, every box filled and a verdict chosen: it can be filed", page.is_enabled("#autopsy-file"))
    F.settle(page)
    page.click("#autopsy-file")
    page.wait_for_function("location.hash.startsWith('#/journal/')")
    page.wait_for_selector("#lens-next")
    a = of_type(page, "autopsy", prediction=p["id"])
    check("one autopsy was filed, with the audit, the answers, the verdict, what the record suggested and the rule",
          len(a) == 1 and a[0]["kind"] == "miss" and a[0]["audit"] == {"outside": "held", "evidence": ["weak"], "caseAgainst": "missed", "tripwire": "held"} and a[0]["verdict"] == "judgment"
          and a[0]["suggested"] == "judgment" and abs(a[0]["chance"] - 0.45) < 1e-9 and a[0]["rule"] == "Ask who signs, and when their budget resets.", str(a)[:300])
    order = page.eval_on_selector_all("section[id^=lens-]", "els => els.map(e => e.id)")
    check("the case file has all five lenses, in order, and no autopsy banner", order == LENSES and page.query_selector("#autopsy-banner") is None, str(order))
    marks = [t.strip() for t in page.eval_on_selector_all("#lens-reasoning .chip.mark", "els => els.map(e => e.textContent)")]
    check("lens 2 marks every link: held up, weak, missed it, held up", marks == ["Held up", "Weak", "Missed it", "Held up"], str(marks))
    check("lens 2 keeps what the player knew and what they missed", text(page, "#reasoning-knew") == "The vendor had signed the last two renewals on time." and text(page, "#reasoning-missed") == "Their budget year had just reset and nobody owned the signature.")
    check("lens 2 gives the signal's own test", "Its own test" in text(page, "#lens-reasoning"), text(page, "#lens-reasoning")[:200])
    check("lens 3 says how likely the outcome was at the baseline, and what the player called it", text(page, "#luck-chance") == "At the baseline (55% for yes), what happened had a 45% chance." and text(page, "#luck-verdict") == "You called it judgment, and the record agrees.", f"{text(page, '#luck-chance')} | {text(page, '#luck-verdict')}")
    check("lens 5 holds the table of other numbers and the rule", page.eval_on_selector_all("#lens-next tbody tr", "els => els.length") == 11 and text(page, "#next-rule") == "Ask who signs, and when their budget resets.")
    rechecks = [[t.strip() for t in tr] for tr in page.eval_on_selector_all("#next-rechecks li", "els => els.map(e => [...e.querySelectorAll('.t span, .t em')].map(x => x.textContent))")]
    check("lens 5 lists the two re-checks, at 3 and 10 days, with their dates", rechecks == [["Day 3", "Due on 2026-09-11"], ["Day 10", "Due on 2026-09-18"]], str(rechecks))
    F.audit(E, "case file with an autopsy")
    shot(E, "b4-casefile.png")
    page.set_viewport_size(SMALL); F.audit(E, "case file with an autopsy"); page.set_viewport_size(VIEW)
    # -- the rule sits above the next five cards --
    go(page, "#/journal/write")
    page.wait_for_selector("#rule-card")
    check("the journal is open again, and the rule sits above the claim with five cards left", "Ask who signs" in text(page, "#rule-card") and "5 cards left" in text(page, "#rule-card"), text(page, "#rule-card"))
    F.audit(E, "write a prediction with a rule card")
    # -- the re-checks, three days and ten days on --
    page.clock.set_system_time("2026-09-11T12:00:00Z")
    go(page, "#/today")
    page.wait_for_selector("#recheck-1")
    check("three days on, Today asks whether the rule was used", "Ask who signs" in text(page, "#recheck-1") and page.query_selector("#recheck-2") is None, text(page, "#recheck-1")[:120])
    F.audit(E, "today with a re-check")
    page.click("#recheck-1 .pick[data-value=partly]")
    page.wait_for_function("document.querySelector('#recheck-1') === null")
    rc = of_type(page, "recheck")
    check("the answer is saved against the autopsy and the step, and the card is gone", len(rc) == 1 and rc[0]["autopsy"] == a[0]["id"] and rc[0]["step"] == 1 and rc[0]["used"] == "partly", str(rc))
    page.clock.set_system_time("2026-09-18T12:00:00Z")
    go(page, "#/path")
    go(page, "#/today")
    page.wait_for_selector("#recheck-2")
    page.click("#recheck-2 .pick[data-value=yes]")
    page.wait_for_function("document.querySelector('#recheck-2') === null")
    go(page, f"#/journal/{p['id']}")
    page.wait_for_selector("#next-rechecks")
    rechecks = [[t.strip() for t in tr] for tr in page.eval_on_selector_all("#next-rechecks li", "els => els.map(e => [...e.querySelectorAll('.t span, .t em')].map(x => x.textContent))")]
    check("the case file shows both answers", rechecks == [["Day 3", "Used it in part"], ["Day 10", "Used it"]], str(rechecks))
    E.ctx.close()


# ---------------------------------------------------------------------------------------------------------------
# Block 5: the Coach (a pretend GitHub, the weekly letter, ideas, Predict's numbers and source-linked checks)
# ---------------------------------------------------------------------------------------------------------------
class FakeGitHub:
    """api.github.com as far as the app uses it: the repo, the contents API, a bearer token, CORS."""
    HOST = "https://api.github.com"

    def __init__(self, token="tok-test-123", private=True, push=True):
        self.token, self.private, self.push = token, private, push
        self.files, self.requests, self.sha = {}, [], 0
        self.down = False

    def put(self, path, text):
        self.sha += 1
        self.files[path] = {"text": text, "sha": f"s{self.sha}"}

    def handle(self, route, request):
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT,OPTIONS", "access-control-expose-headers": "*"}
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        if self.down:
            return route.abort("failed")
        self.requests.append((request.method, request.url, request.headers.get("authorization")))
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return route.fulfill(status=401, headers=cors, json={"message": "Bad credentials"})
        path = request.url.split("api.github.com/repos/", 1)[1].split("?")[0]
        repo = "/".join(path.split("/")[:2])
        if repo != "me/Predict-data":
            return route.fulfill(status=404, headers=cors, json={"message": "Not Found"})
        rest = path[len(repo):]
        if rest == "":
            return route.fulfill(status=200, headers=cors, json={"full_name": repo, "private": self.private, "permissions": {"push": self.push}})
        name = rest[len("/contents/"):]
        if request.method == "GET":
            f = self.files.get(name)
            if not f:
                return route.fulfill(status=404, headers=cors, json={"message": "Not Found"})
            import base64
            return route.fulfill(status=200, headers=cors, json={"content": base64.b64encode(f["text"].encode()).decode(), "sha": f["sha"]})
        body = json.loads(request.post_data)
        cur = self.files.get(name)
        if cur and body.get("sha") != cur["sha"]:
            return route.fulfill(status=409, headers=cors, json={"message": "conflict"})
        import base64
        self.put(name, base64.b64decode(body["content"]).decode())
        return route.fulfill(status=200 if cur else 201, headers=cors, json={"content": {"sha": self.files[name]["sha"]}})


def phase_b5(E):
    today = "2026-09-08"
    r = synth.Rec(31)
    for k in range(5):
        r.play_day(synth.add_days("2026-09-02", k), 6, synth.pol_calibrated)
    p_open = r.prediction("2026-09-06", 400, 0.7, 0.5, domain="world", due_option="week", text="By 13 September 2026, the first named storm of the week will make landfall.")
    p_due = r.prediction("2026-09-03", 400, 0.6, 0.5, domain="world", due_option="tomorrow", text="By 4 September 2026, the ferry strike will end.")
    p_nosrc = r.prediction("2026-09-02", 400, 0.6, 0.5, domain="world", due_option="tomorrow", text="By 3 September 2026, the bridge will reopen to traffic.")
    p_done = r.prediction("2026-09-02", 410, 0.65, 0.5, domain="life", due_option="tomorrow", text="By 3 September 2026, I will have run three times.")
    r.resolve(p_done, "2026-09-04", 30, "yes")
    path = r.write(os.path.join(E.tmp, "coach.jsonl"))
    page = open_app(E, today, path)
    gh = FakeGitHub()
    E.ctx.route("https://api.github.com/**", gh.handle)
    n_outside = len(E.outside)
    go(page, "#/coach")
    page.wait_for_selector("#sync-card")
    page.clock.run_for(6000)
    check("before anything is connected: the Coach tab shows the setup, no letter, and no request is made", page.query_selector("#coach-none") is not None and page.is_visible("#sync-form") and not gh.requests and len(E.outside) == n_outside, str(gh.requests[:1]))
    check("it explains the private repository and the token", "private repository" in text(page, "#sync-intro").lower() and "token" in text(page, "#sync-intro").lower(), text(page, "#sync-intro"))
    F.audit(E, "coach, not connected")
    shot(E, "b5-coach-setup.png")

    def connect(repo, token):
        page.fill("#sync-repo", repo)
        page.fill("#sync-token", token)
        page.click("#sync-save")

    connect("not a repo", "x")
    page.wait_for_function("document.querySelector('#sync-status').textContent.includes('owner/name')")
    check("a repository written wrongly is refused before any request", not gh.requests, text(page, "#sync-status"))
    connect("me/Predict-data", "wrong-token")
    page.wait_for_function("document.querySelector('#sync-status').textContent.includes('refused the token')")
    check("a wrong token is refused in words, and nothing is saved", page.is_visible("#sync-form") and not has_meta(page, "sync"), text(page, "#sync-status"))
    gh.private = False
    connect("me/Predict-data", gh.token)
    page.wait_for_function("document.querySelector('#sync-status').textContent.includes('public')")
    check("a public repository is refused, because the record is personal", page.is_visible("#sync-form") and not gh.files, text(page, "#sync-status"))
    gh.private = True
    connect("me/Predict-data", gh.token)
    page.wait_for_function("document.querySelector('#sync-status').textContent.startsWith('Synced')", timeout=20000)
    events = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip() and json.loads(l).get("type") != "header"]
    by_day = {}
    for e in events:
        by_day.setdefault(e["d"], []).append(e["id"])
    got = {k[len("record/"):-len(".jsonl")]: [json.loads(x)["id"] for x in v["text"].splitlines()] for k, v in gh.files.items() if k.startswith("record/")}
    check("connected: one file a day went to the repo, with exactly the events of that day", set(got) == set(by_day) and all(sorted(got[d]) == sorted(by_day[d]) for d in by_day), f"{sorted(got)} vs {sorted(by_day)}")
    check("the status says how many events were sent", f"{len(events)} new events sent" in text(page, "#sync-status"), text(page, "#sync-status"))
    check("the token is on this phone only: in no file of the repo, and every request went to api.github.com with it as a header",
          all(gh.token not in v["text"] for v in gh.files.values()) and all(u.startswith("https://api.github.com/repos/me/Predict-data") and a == f"Bearer {gh.token}" for _, u, a in gh.requests if a == f"Bearer {gh.token}"), "")
    check("the only requests off this site were to api.github.com, and only after connecting", all(u.startswith("https://api.github.com/") for u in E.outside[n_outside:]), str(E.outside[n_outside:][:2]))
    E.outside[:] = E.outside[:n_outside]
    check("the Coach tab now says where it is connected, with a sync button and a way to disconnect", "me/Predict-data" in text(page, "#sync-where") and page.is_visible("#sync-now") and page.is_visible("#sync-off") and not page.is_visible("#sync-form"))
    writes = sum(1 for m, _, _ in gh.requests if m == "PUT")
    page.click("#sync-now")
    page.wait_for_function("document.querySelector('#sync-status').textContent.startsWith('Synced')")
    check("a second sync writes nothing new", sum(1 for m, _, _ in gh.requests if m == "PUT") == writes, f"{writes} writes then {sum(1 for m, _, _ in gh.requests if m == 'PUT')}")
    E.outside[:] = E.outside[:n_outside]
    F.audit(E, "coach, connected")
    shot(E, "b5-coach-connected.png")

    # -- the weekly review has run: a letter, drills, three ideas, numbers, a check with its source, a read --
    coach = {"version": 1, "week": "2026-W37", "written": "2026-09-07",
             "letter": {"title": "A steadier week, and one number to watch", "paragraphs": ["You made 30 calls and sat close to the line at 70 to 80%.", "Your world predictions are all open: one resolves this week."],
                        "sources": [{"label": "Weather service forecast office", "url": "https://www.weather.gov/sew/"}]},
             "drills": [{"title": "Name the rate first", "text": "Before each journal card, write the usual rate for its reference class, then move."}],
             "prompts": [{"day": today, "items": [{"text": "By 30 September 2026, the first snow will be recorded on a Cascade pass road camera.", "domain": "world", "due": "month"},
                                                   {"text": "By Friday, my team will have merged the release branch.", "domain": "work", "due": "week"},
                                                   {"text": "By tomorrow night, I will have read for an hour.", "domain": "life", "due": "tomorrow"}]}],
             "baselines": {p_open["id"]: {"p": 0.35, "written": "2026-09-07", "ref": "named storms making landfall in a given week, 1990 to 2025"}},
             "outcomes": {p_due["id"]: {"result": "yes", "source": "https://www.example.org/ferry-strike-ends", "checked": "2026-09-08", "note": "The union and the operator signed on 4 September."},
                          p_nosrc["id"]: {"result": "yes", "checked": "2026-09-08"}},
             "reads": {p_done["id"]: {"text": "Running three times needed a plan, and yours had one: the case against named the weather, which is what happened.", "written": "2026-09-07"}}}
    gh.put("coach/latest.json", json.dumps(coach))
    page.click("#sync-now")
    page.wait_for_selector("#coach-letter", timeout=20000)
    check("after a sync the letter is on the Coach tab: title, both paragraphs, its week", text(page, "#coach-letter h2") == coach["letter"]["title"] and all(t in text(page, "#coach-letter") for t in coach["letter"]["paragraphs"]) and "2026-W37" in text(page, "#coach-letter .eyebrow"), text(page, "#coach-letter")[:120])
    link = attrs(page, "#coach-sources a", ["href", "rel", "target"])[0]
    check("its source is a link to an https page that opens safely", link == {"href": "https://www.weather.gov/sew/", "rel": "noopener noreferrer", "target": "_blank"}, str(link))
    check("the drill set is shown", "Name the rate first" in text(page, "#coach-drills"), text(page, "#coach-drills"))
    check("the none-yet card is gone", page.query_selector("#coach-none") is None)
    F.audit(E, "coach with a letter")
    shot(E, "b5-coach-letter.png")
    E.outside[:] = E.outside[:n_outside]
    # -- Today shows a nudge until the letter is read --
    go(page, "#/path"); go(page, "#/today")
    page.wait_for_selector("#day")
    check("a letter that was on screen on the Coach tab counts as read: Today has no 'From Predict' card for it", page.query_selector("#letter-card") is None)
    # a new week's letter arrives while the player is on Today (the phone syncs by itself a few seconds after it comes online)
    coach2 = dict(coach, week="2026-W38", letter=dict(coach["letter"], title="Two weeks of steady calls"))
    gh.put("coach/latest.json", json.dumps(coach2))
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.clock.run_for(5000)
    for _ in range(40):
        if any(u.endswith('coach/latest.json') for _, u, _ in gh.requests[-6:]):
            break
        page.wait_for_timeout(100)
    go(page, "#/path"); go(page, "#/today")
    page.wait_for_selector("#letter-card", timeout=10000)
    check("a letter that arrives by itself shows on Today as 'From Predict' with its title and a way to open it", "Two weeks of steady calls" in text(page, "#letter-card") and page.is_visible("#letter-open"), text(page, "#letter-card"))
    page.click("#letter-open")
    page.wait_for_selector("#coach-letter")
    check("opening it shows the letter, and the card is gone from Today after", "Two weeks of steady calls" in text(page, "#coach-letter h2"))
    go(page, "#/path"); go(page, "#/today")
    page.wait_for_selector("#day")
    check("Today's card for it is gone once it has been opened", page.query_selector("#letter-card") is None)
    E.outside[:] = E.outside[:n_outside]
    # -- ideas on the journal --
    go(page, "#/journal/write")
    page.wait_for_selector("#prompt-ideas")
    chips = page.eval_on_selector_all(".prompt-chip", "els => els.map(e => e.textContent)")
    check("the journal offers three ideas for today, exactly as written", chips == [i["text"] for i in coach["prompts"][0]["items"]], str(chips))
    page.click(".prompt-chip[data-i='1']")
    page.wait_for_selector("#claim-text")
    on = page.eval_on_selector_all(".picker .pick.on", "els => els.map(e => e.dataset.value)")
    check("tapping one fills the claim and sets its domain and due date, still editable", page.input_value("#claim-text") == coach["prompts"][0]["items"][1]["text"] and on == ["work", "week"], f"{page.input_value('#claim-text')!r} {on}")
    # -- Predict's number replaced the baseline on the open card --
    go(page, f"#/journal/{p_open['id']}")
    page.wait_for_selector(".claim")
    check("an open card shows Predict's number as its baseline with its reference class", "Baseline: 35%" in text(page, "main") and "Predict's outside view: named storms making landfall" in text(page, "main"), text(page, "main")[:200])
    # -- a check with a source on a due card; one without a source is never shown --
    go(page, f"#/journal/{p_nosrc['id']}")
    page.wait_for_selector("#resolve")
    check("a check that came without a source link is not shown at all", page.query_selector("#predict-check") is None)
    go(page, f"#/journal/{p_due['id']}")
    page.wait_for_selector("#predict-check")
    check("a due card shows what Predict found, its date, a note and the source link", "2026-09-08" in text(page, "#predict-check") and "Happened." in text(page, "#predict-check") and attrs(page, "#predict-check-source", ["href"])[0]["href"] == "https://www.example.org/ferry-strike-ends", text(page, "#predict-check"))
    check("nothing is picked for the player", page.eval_on_selector_all(".pick.on", "els => els.length") == 0)
    F.settle(page)
    page.click("#use-check")
    on = page.eval_on_selector_all(".pick.on", "els => els.map(e => e.dataset.value)")
    check("'Use this answer' picks it, and the player still presses Resolve", on == ["yes"] and page.is_enabled("#resolve"))
    page.click("#resolve")
    page.wait_for_selector("#lens-what")
    check("the case file carries the source link of the check", attrs(page, "#what-source a", ["href"])[0]["href"] == "https://www.example.org/ferry-strike-ends" and "2026-09-08" in text(page, "#what-source"), text(page, "#what-source"))
    # -- a resolve the player decided alone has no source --
    go(page, f"#/journal/{p_nosrc['id']}")
    page.wait_for_selector("#resolve")
    page.click(".pick[data-value=no]")
    F.settle(page)
    page.click("#resolve")
    page.wait_for_selector("#lens-what")
    check("a card resolved without Predict's check has no source line", page.query_selector("#what-source") is None)
    # -- Predict's read --
    go(page, f"#/journal/{p_done['id']}")
    page.wait_for_selector("#lens-next")
    check("a resolved card shows Predict's read, dated, in the last lens", "Running three times needed a plan" in text(page, "#predict-read") and "2026-09-07" in text(page, "#predict-read"), text(page, "#predict-read"))
    go(page, f"#/journal/{p_due['id']}")
    page.wait_for_selector("#lens-next")
    check("a card with no read shows none", page.query_selector("#predict-read") is None)
    F.audit(E, "case file with a source")

    # -- offline: the letter is still there, the sync says so --
    go(page, "#/coach")
    page.wait_for_selector("#coach-letter")
    gh.down = True
    page.click("#sync-now")
    page.wait_for_function("document.querySelector('#sync-status').textContent.includes('No connection')", timeout=15000)
    check("offline: sync says there is no connection, and the letter is still shown from the phone", page.query_selector("#coach-letter") is not None and "safe on this phone" in text(page, "#sync-status"), text(page, "#sync-status"))
    gh.down = False
    # -- Ask Predict --
    page.click("#checkin-copy")
    page.wait_for_timeout(200)
    msg = page.evaluate("navigator.clipboard.readText()")
    check("Ask Predict copies a message with this week's numbers and sends nothing", msg.startswith("Predict, here is my week.") and "Gym:" in msg and "Journal:" in msg and "claude" not in msg.lower(), msg[:160])
    # -- disconnect --
    gh.requests.clear()
    page.click("#sync-off")
    page.wait_for_selector("#sync-form:not([hidden])")
    check("disconnecting forgets the token and brings the setup back", page.is_visible("#sync-form") and "token is gone" in text(page, "#sync-status"), text(page, "#sync-status"))
    go(page, "#/path"); go(page, "#/today")
    page.clock.run_for(8000)
    check("after disconnecting, nothing more is sent", not gh.requests, str(gh.requests[:1]))
    # -- erase takes the token and the cached letter --
    go(page, "#/coach")
    page.wait_for_selector("#sync-form:not([hidden])")
    connect("me/Predict-data", gh.token)
    page.wait_for_function("document.querySelector('#sync-status').textContent.startsWith('Synced')", timeout=20000)
    E.outside[:] = E.outside[:n_outside]
    page.click("#erase-btn")
    page.fill("#erase-confirm", "ERASE")
    page.click("#erase-go")
    page.wait_for_function("document.querySelector('#record-msg').textContent.startsWith('Erased')")
    page.reload()
    page.wait_for_selector("#sync-card")
    check("erasing the phone also forgets the repository token and the cached letter", page.is_visible("#sync-form") and page.query_selector("#coach-letter") is None and not has_meta(page, "sync") and not has_meta(page, "coach"), "")
    # GitHub answers 401 to a wrong token and 404 to a file that does not exist yet: both are expected here and were checked above.
    E.bad[:] = [x for x in E.bad if "api.github.com" not in x]
    E.console[:] = [c for c in E.console if not (c[0] == "b5" and "Failed to load resource" in c[1])]
    E.outside[:] = [u for u in E.outside if not u.startswith("https://api.github.com/repos/me/Predict-data")]
    page.context.close()


# ---------------------------------------------------------------------------------------------------------------
# Block 6: ranges (Unit 3)
# ---------------------------------------------------------------------------------------------------------------
import ref_range  # noqa: E402  (an independent version of the range rules)

RANGE_BANK = json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "ranges.json"), encoding="utf-8"))["questions"]
RANGE_PRACTICE = [q for q in RANGE_BANK if q["pool"] == "practice"]
RANGE_EXAM = [q for q in RANGE_BANK if q["pool"] == "exam"]
RANGE_BY_CLAIM = {f"{q['lead']} {q['ask']}": q for q in RANGE_BANK}
RANGE_BY_ID = {q["id"]: q for q in RANGE_BANK}
U1_EXAM = json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "exam-u1.json"), encoding="utf-8"))["questions"]


def rnum(x):
    """A number as typed into the app: full precision, so the app and the reference judge the same double."""
    return repr(float(x))


def centred(q, k, shift=0.0):
    """low and high as typed for a range k reference widths wide, centred on the truth, moved up by `shift` reference widths."""
    t = ref_range.to_scale(q, q["truth"])
    w = ref_range.to_scale(q, q["ref_high"]) - ref_range.to_scale(q, q["ref_low"])
    return ref_range.from_scale(q, t - w * k / 2 + w * shift), ref_range.from_scale(q, t + w * k / 2 + w * shift)


def fill_range(page, low, high):
    page.fill("#range-low", rnum(low))
    if page.query_selector("#range-high"):
        page.fill("#range-high", rnum(high))


def range_question(page):
    page.wait_for_selector("#claim")
    return RANGE_BY_CLAIM[text(page, "#claim")]


def play_ranges(page, n, chooser, reveal=True, checks=None):
    """n ranges. chooser(i, q) -> (low, high). With reveal, each range is read on its reveal screen and `checks(q, low, high, expected)` may look at it."""
    done = []
    for i in range(n):
        q = range_question(page)
        claim = text(page, "#claim")
        low, high = chooser(i, q)
        low, high = float(rnum(low)), float(rnum(high))
        fill_range(page, low, high)
        stepwise = page.query_selector("#high-box") is None
        if stepwise:  # the one-end-at-a-time drill: set the low end first, then the high end
            F.settle(page)
            page.click("#lock")
            page.wait_for_selector("#high-box")
            page.fill("#range-high", rnum(high))
        F.settle(page)
        page.click("#lock")
        exp = ref_range.judge(q, low, high)
        if reveal:
            page.wait_for_selector("#verdict")
            if checks:
                checks(q, low, high, exp)
            F.settle(page)
            page.click("#next")
        advance_to(page, claim, prefixes=("#/rsummary/", "#/rexam/"))
        done.append((q, low, high, exp))
    return done


def ranges_of(page, **where):
    return of_type(page, "range", **where)


def phase_b6(E):
    """Unit 3: the range screens, the points, the sealed exam, the drills and the range patterns, against ref_range.py."""
    # -- Unit 3 stays closed until the Unit 1 exam is passed ---------------------------------------------------------
    r0 = synth.eligible_player(start=START)
    page = open_app(E, "2026-09-12", r0.write(os.path.join(E.tmp, "b6_closed.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#day")
    check("before the Unit 1 exam is passed there is no ranges card on Today and no Unit 3 exam on the Path", page.query_selector("#ranges-card") is None and page.query_selector("#need-rexam") is None)
    go(page, "#/path")
    page.wait_for_selector("#gate-card")
    u3 = [li for li in page.query_selector_all(".units li") if "Unit 3" in (li.text_content() or "")]
    check("Unit 3 is Locked on the Path and has no exam card", page.query_selector("#rgate-card") is None and u3 and "Locked" in u3[0].text_content(), (u3[0].text_content() if u3 else "")[:60])
    go(page, "#/range/practice")
    page.wait_for_function("location.hash === '#/today'", timeout=5000)
    check("opening the ranges address while closed sends you back to Today", page.evaluate("location.hash") == "#/today")
    E.ctx.close()

    # -- open: the card, the three lessons, the first practice session ------------------------------------------------
    base = synth.u1_passed_player(U1_EXAM, start=START)
    day = "2026-09-20"
    page = open_app(E, day, base.write(os.path.join(E.tmp, "b6_open.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#ranges-card")
    check("Unit 3 is open: Today offers ten ranges, none done", "10 ranges" in text(page, "#ranges-line") and "0 of 40" in text(page, "#ranges-line"), text(page, "#ranges-line"))
    F.audit(E, "today with ranges")
    go(page, "#/path")
    page.wait_for_selector("#rgate-card")
    u3 = [li for li in page.query_selector_all(".units li") if "Unit 3" in (li.text_content() or "")]
    check("the Path lists Unit 3 as Open, with its three lesson cards and a practice card", "Open" in u3[0].text_content() and len(page.query_selector_all("#range-lessons .lesson-link")) == 3 and page.is_visible("#range-practice"))
    check("the exam card says it opens after 40 practice ranges", text(page, "#rgate-status") == "Not open yet" and "40 practice ranges" in text(page, "#rgate-card"), text(page, "#rgate-card")[:120])
    F.audit(E, "path with Unit 3")
    shot(E, "b6-path.png")
    go(page, "#/lesson/ninety")
    page.wait_for_selector("#lesson-title")
    binom_pass = {c: ref_range.binom(60, c, 50, 58) for c in (0.9, 0.7, 0.99)}
    body = text(page, "main")
    check("the first card is 'What a 90% range means' and its pass chances are the exact binomial ones", "What a 90% range means" in text(page, "#lesson-title") and all(f"{js_round(v * 100)}%" in body for v in binom_pass.values()) and "Unit 3" in text(page, ".eyebrow"), body[-260:])
    F.audit(E, "lesson ninety")
    page.click("#lesson-done")
    page.wait_for_function("() => { const t = document.querySelector('#lesson-title'); return t && t.textContent.includes('price of width'); }", timeout=10000)
    check("Got it moves to the second card, 'The price of width', with its table", "price of width" in text(page, "#lesson-title") and page.query_selector(".tbl") is not None and "1.00" in text(page, ".tbl"), text(page, "#lesson-title"))
    page.click("#lesson-done")
    page.wait_for_function("() => { const t = document.querySelector('#lesson-title'); return t && t.textContent.includes('one end at a time'); }", timeout=10000)
    page.click("#lesson-done")
    page.wait_for_function("location.hash === '#/path'")
    check("three cards read are three lesson events and the Path says so", len(of_type(page, "lesson")) >= 3 and {"ninety", "price", "ends"} <= {e["lesson"] for e in of_type(page, "lesson")})

    n_calls_before = len([e for e in read_events(page) if e["type"] in ("call", "session")])
    go(page, "#/range/practice")
    page.wait_for_selector("#claim")
    q = range_question(page)
    check("a practice session opens: range 1 of 10, from the practice pool, nothing to lock yet", text(page, ".cnt") == "1 of 10" and q["pool"] == "practice" and "Unit 3 practice" in text(page, "#mode-tag") and page.is_disabled("#lock"), f"{text(page, '.cnt')} {q['id']}")
    check("the screen asks for a low and a high in the question's unit", page.is_visible("#range-low") and page.is_visible("#range-high") and q["unit"] in text(page, "#range-entry"), q["unit"])
    F.audit(E, "range question")
    shot(E, "b6-question.png")
    page.fill("#range-low", "abc"); page.fill("#range-high", "5")
    check("letters are refused in words and the lock stays off", "numbers only" in text(page, "#range-msg").lower() and page.is_disabled("#lock"), text(page, "#range-msg"))
    page.fill("#range-low", "9"); page.fill("#range-high", "3")
    check("a low above the high is refused", "low end" in text(page, "#range-msg").lower() and page.is_disabled("#lock"), text(page, "#range-msg"))
    page.fill("#range-low", ""); page.fill("#range-high", "")
    check("empty fields lock nothing and say nothing yet", page.is_disabled("#lock") and text(page, "#range-msg") == "")
    lo, hi = ref_range.stretched(q, 1.0)
    page.fill("#range-low", rnum(lo)); page.fill("#range-high", rnum(hi))
    check("a valid range turns the lock on and shows its width", not page.is_disabled("#lock") and text(page, "#range-info").startswith("Width"), text(page, "#range-info"))
    seen_log = False

    def log_check(q_):
        nonlocal seen_log
        if q_["scale"] == "log" and not seen_log:
            seen_log = True
            page.fill("#range-low", "0"); page.fill("#range-high", "5")
            check("a log question refuses a zero", "above zero" in text(page, "#range-msg").lower() and page.is_disabled("#lock"), text(page, "#range-msg"))

    factors = [1.0, 0.6, 1.5, 1.0, 0.4, 2.0, 1.0, 0.8, 1.2, 1.0]
    sums = {"points": 0, "hits": 0, "ratio": 0.0}
    revealed = []

    def on_reveal(q_, low, high, exp):
        got = text(page, "#points")
        ok_pts = got == signed(exp["points"])
        ok_verdict = text(page, "#verdict") == ("Inside" if exp["hit"] else "Outside")
        revealed.append((ok_pts, ok_verdict, got, exp["points"]))
        sums["points"] += exp["points"]; sums["hits"] += exp["hit"]; sums["ratio"] += exp["ratio"]

    def chooser(i, q_):
        return (lo, hi) if i == 0 else ref_range.stretched(q_, factors[i])

    first = True
    done = []
    for i in range(10):
        q_ = range_question(page)
        claim = text(page, "#claim")
        log_check(q_)
        low, high = chooser(i, q_)
        low, high = float(rnum(low)), float(rnum(high))
        fill_range(page, low, high)
        F.settle(page)
        page.click("#lock")
        exp = ref_range.judge(q_, low, high)
        page.wait_for_selector("#verdict")
        on_reveal(q_, low, high, exp)
        if first:
            first = False
            check("the reveal draws the truth, your range and the reference interval, with the source", page.is_visible("#range-line") and "reference interval" in (page.get_attribute("#range-line", "aria-label") or "") and f"{q_['truth']:,.{q_['digits']}f}" in text(page, ".rl-key") and page.query_selector("a.link[href^='https://']") is not None, text(page, ".rl-key"))
            check("the reveal says whether it held, the width against the reference and how the score works", "reference" in text(page, "#range-note") and ("held the truth" in text(page, "#range-note") or "below" in text(page, "#range-note") or "above" in text(page, "#range-note")), text(page, "#range-note")[:200])
            F.audit(E, "range reveal")
            shot(E, "b6-reveal.png")
        F.settle(page)
        page.click("#next")
        advance_to(page, claim, prefixes=("#/rsummary/",))
        done.append((q_, low, high, exp))
    page.wait_for_selector("#rs-head")
    check("every reveal showed the points and the verdict the independent rules give", all(a and b for a, b, _, _ in revealed), str([r for r in revealed if not (r[0] and r[1])][:2]))
    check("the session ends on its summary: how many held, the points and the width against the reference", text(page, "#rs-head") == f"{sums['hits']} of 10 ranges held the truth." and text(page, "#sum-points") == signed(sums["points"]) and text(page, "#sum-inside") == f"{sums['hits']} of 10" and text(page, "#sum-width") == f"{sums['ratio'] / 10:.1f}×", f"{text(page, '#rs-head')} | {text(page, '#sum-points')} | {text(page, '#sum-width')} | {text(page, '#sum-inside')} want {sums} {signed(sums['points'])}")
    check("the summary lists the ten ranges", len(page.query_selector_all("#rows li")) == 10)
    F.audit(E, "range summary")
    shot(E, "b6-summary.png")
    ev = read_events(page)
    rs = [e for e in ev if e["type"] == "range"]
    check("ten ranges were saved with the numbers the independent rules give (hit, ratio, score, points)", len(rs) == 10 and all(r["mode"] == "practice" and r["unit"] == "U3" for r in rs) and all(
        r["hit"] == d[3]["hit"] and r["points"] == d[3]["points"] and near(r["ratio"], d[3]["ratio"], 1e-9) and near(r["score"], d[3]["score"], 1e-9) and r["low"] == d[1] and r["high"] == d[2] for r, d in zip(rs, done)))
    check("one range session and its end were written, and no gym call or gym session was added", len([e for e in ev if e["type"] == "rsession"]) == 1 and len([e for e in ev if e["type"] == "rsession_end"]) == 1 and len([e for e in ev if e["type"] in ("call", "session")]) == n_calls_before)
    kinds = {}
    for r in rs:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    check("ten different practice questions, no kind more than three", len({r["q"] for r in rs}) == 10 and max(kinds.values()) <= 3, str(kinds))
    go(page, "#/mirror")
    page.wait_for_selector("#range-record")
    check("the Mirror counts the ten ranges apart from the calls: n=10, the held count, the width and the points", text(page, "#rr-n") == "n=10" and f"{sums['hits']} of 10" in text(page, "#rr-table") and signed(sums["points"]) in text(page, "#rr-table"), text(page, "#rr-table")[:200])
    rows = {tr.query_selector_all("td")[0].text_content().strip(): tr.query_selector_all("td")[1].text_content().strip() for tr in page.query_selector_all("#stats tr")}
    check("the gym's numbers did not move: still 350 calls", rows["Calls"] == "350", str(rows))
    F.audit(E, "mirror with ranges")
    shot(E, "b6-mirror.png")
    # -- stopping in the middle and coming back ----------------------------------------------------------------------
    go(page, "#/range/practice")
    page.wait_for_selector("#claim")
    plan2 = [e for e in read_events(page) if e["type"] == "rsession"][-1]["plan"]
    play_ranges(page, 3, lambda i, q_: ref_range.stretched(q_, 1.0))
    go(page, "#/today")
    page.wait_for_selector("#ranges-card")
    check("closing a session in the middle leaves it to resume, and Today says where it stands", "Resume: 3 of 10" in text(page, "#ranges-line") and text(page, "#ranges-start") == "Resume ranges", text(page, "#ranges-line"))
    page.click("#ranges-start")
    page.wait_for_selector("#claim")
    check("resuming shows the fourth planned range, 4 of 10", text(page, ".cnt") == "4 of 10" and range_question(page)["id"] == plan2[3], f"{text(page, '.cnt')}")
    play_ranges(page, 7, lambda i, q_: ref_range.stretched(q_, 1.0))
    page.wait_for_selector("#rs-head")
    rs2 = ranges_of(page)
    check("the second session's ten ranges are all new questions (twenty in all, none repeated)", len({r["q"] for r in rs2}) == 20 and len(rs2) == 20, str(len(rs2)))
    E.ctx.close()

    # -- a too-narrow player: L05 opens, and the one-bound-at-a-time drill ------------------------------------------
    r = synth.u1_passed_player(U1_EXAM, start=START)
    for k in range(4):
        r.range_day(synth.add_days("2026-09-20", k), RANGE_PRACTICE[k * 10:(k + 1) * 10], synth.hit_miss_policy("1100110011"), minute=10)
    page = open_app(E, "2026-09-25", r.write(os.path.join(E.tmp, "b6_narrow.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#needs")
    check("24 of the last 40 ranges held: Today shows the pattern 'Ranges too narrow'", "Ranges too narrow" in text(page, "#needs"), text(page, "#needs")[:200])
    page.click("#needs a[data-flag]")
    page.wait_for_selector("#flag-title")
    check("its screen names the pattern and says what the record shows", text(page, "#flag-title") == "Ranges too narrow" and "Only 24 of your last 40 ranges held the truth" in text(page, "#flag-evidence"), text(page, "#flag-evidence"))
    check("it opens the card 'Build it one end at a time' and offers the drill", "Build it one end at a time" in text(page, "#flag-lesson") and "one end at a time" in text(page, "#flag-action"), text(page, "#flag-action")[:150])
    F.audit(E, "flag L05")
    page.click("#flag-drill")
    page.wait_for_function("location.hash.startsWith('#/range/drill-')")
    page.wait_for_selector("#claim")
    check("the drill opens as a drill, 1 of 10, with only the low end to fill in", text(page, ".cnt") == "1 of 10" and text(page, "#mode-tag") == "Drill" and page.query_selector("#high-box") is None and text(page, "#lock") == "Set the low end" and "Step 1 of 2" in text(page, "#step-note"), text(page, "#step-note"))
    F.audit(E, "stepwise drill, low end")
    q = range_question(page)
    claim = text(page, "#claim")
    lo, hi = ref_range.stretched(q, 1.0)
    page.fill("#range-low", rnum(lo))
    F.settle(page)
    page.click("#lock")
    page.wait_for_selector("#high-box")
    check("setting the low end freezes it and asks for the high end", page.get_attribute("#range-low", "readonly") is not None and "Step 2 of 2" in text(page, "#step-note") and page.is_disabled("#lock") and text(page, "#lock") == "Lock in", text(page, "#step-note"))
    page.fill("#range-high", rnum(hi))
    F.settle(page)
    page.click("#lock")
    page.wait_for_selector("#verdict")
    check("then the range locks and reveals like any other, as a drill", "Drill" in text(page, ".tags"), text(page, ".tags"))
    F.settle(page)
    page.click("#next")
    advance_to(page, claim, prefixes=("#/rsummary/",))
    play_ranges(page, 9, lambda i, q_: ref_range.stretched(q_, 1.0))
    page.wait_for_selector("#drill-next")
    ev = read_events(page)
    flag = [e for e in ev if e["type"] == "flag" and e.get("state") == "open" and e.get("trigger") == "L05"][0]
    check("ten drill ranges later the flag is in 'drill', with its re-tests described", [e["state"] for e in ev if e["type"] == "flag" and e.get("flag") == flag["id"]] == ["lesson", "drill"] and "Two re-tests" in text(page, "#drill-next"), text(page, "#drill-next")[:200])
    check("the drill's ranges are marked drill and the Mirror leaves them out (still n=40)", len([e for e in ev if e["type"] == "range" and e["mode"] == "drill"]) == 10, "")
    go(page, "#/mirror")
    page.wait_for_selector("#range-record")
    check("the Mirror reads 'too narrow' on 24 of 40 and counts no drill range", text(page, "#rr-n") == "n=40" and "24 of 40" in text(page, "#rr-table") and "too narrow" in text(page, "#rr-table"), text(page, "#rr-table")[:200])
    E.ctx.close()

    # -- a too-wide player: L06, the width budget --------------------------------------------------------------------
    r = synth.u1_passed_player(U1_EXAM, start=START)
    for k in range(4):
        r.range_day(synth.add_days("2026-09-20", k), RANGE_PRACTICE[k * 10:(k + 1) * 10], synth.centered_policy(3.0), minute=10)
    page = open_app(E, "2026-09-25", r.write(os.path.join(E.tmp, "b6_wide.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#needs")
    check("40 of 40 held at three times the reference width: Today shows 'Ranges too wide'", "Ranges too wide" in text(page, "#needs"), text(page, "#needs")[:200])
    page.click("#needs a[data-flag]")
    page.wait_for_selector("#flag-title")
    check("its evidence says every range held and how much wider than the record they were", "40 of your last 40 ranges held the truth" in text(page, "#flag-evidence") and "3.0 times" in text(page, "#flag-evidence"), text(page, "#flag-evidence"))
    check("it opens 'The price of width'", "The price of width" in text(page, "#flag-lesson"), text(page, "#flag-lesson")[:80])
    page.click("#flag-drill")
    page.wait_for_selector("#claim")
    check("the drill shows a width budget", "Width budget" in text(page, "#budget-note") and page.is_visible("#range-high"), text(page, "#budget-note"))
    F.audit(E, "budget drill")
    q = range_question(page)
    w = ref_range.to_scale(q, q["ref_high"]) - ref_range.to_scale(q, q["ref_low"])
    t = ref_range.to_scale(q, q["truth"])
    wide = (ref_range.from_scale(q, t - w * 3), ref_range.from_scale(q, t + w * 3))
    page.fill("#range-low", rnum(wide[0])); page.fill("#range-high", rnum(wide[1]))
    check("a range over the budget will not lock and says so", page.is_disabled("#lock") and "over the budget" in text(page, "#range-msg").lower(), text(page, "#range-msg"))
    ok_lo, ok_hi = ref_range.stretched(q, 1.5)
    page.fill("#range-low", rnum(ok_lo)); page.fill("#range-high", rnum(ok_hi))
    check("1.5 reference widths is inside the 1.6 budget and locks", not page.is_disabled("#lock") and not text(page, "#range-msg"), text(page, "#range-msg"))
    play_ranges(page, 10, lambda i, q_: ref_range.stretched(q_, 1.0))
    page.wait_for_selector("#drill-next")
    ev = read_events(page)
    flag = [e for e in ev if e["type"] == "flag" and e.get("state") == "open" and e.get("trigger") == "L06"][0]
    check("after the budget drill the flag is in 'drill'", [e["state"] for e in ev if e["type"] == "flag" and e.get("flag") == flag["id"]][-1] == "drill")
    E.ctx.close()

    # -- the Unit 3 exam: ready, sealed sittings, the verdict ----------------------------------------------------------
    r = synth.u1_passed_player(U1_EXAM, start=START)
    for k in range(4):
        r.range_day(synth.add_days("2026-09-20", k), RANGE_PRACTICE[k * 10:(k + 1) * 10], synth.hit_miss_policy("1111111110"), minute=10)
    page = open_app(E, "2026-09-25", r.write(os.path.join(E.tmp, "b6_ready.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#rgate-card")
    check("with 40 practice ranges the exam is Ready: 60 fresh ranges in 3 sittings of 20", text(page, "#rgate-status") == "Ready" and "60 fresh ranges in 3 sittings of 20" in text(page, "#rgate-card") and "50 to 58" in text(page, "#rgate-card"), text(page, "#rgate-card")[:200])
    go(page, "#/today")
    page.wait_for_selector("#need-rexam")
    check("Today has the Unit 3 exam in 'Needs you'", "Unit 3 exam" in text(page, "#need-rexam"))
    go(page, "#/path")
    page.wait_for_selector("#rgate-start")
    F.audit(E, "path with the range exam ready")
    page.click("#rgate-start")
    page.wait_for_selector("#claim")
    q = range_question(page)
    check("the exam opens: sitting 1 of 3, range 1 of 20, from the exam pool", text(page, ".cnt") == "1 of 20" and text(page, "#mode-tag") == "Exam · sitting 1 of 3" and q["pool"] == "exam", f"{text(page, '.cnt')} {text(page, '#mode-tag')} {q['pool']}")
    check("the exam says the result is sealed", "Sealed" in text(page, ".foot"), text(page, ".foot"))
    F.audit(E, "range exam sitting")
    def exam_chooser(i, q_):
        return centred(q_, 1.0) if i % 10 != 9 else centred(q_, 1.0, shift=3.0)

    play_ranges(page, 20, exam_chooser, reveal=False)
    page.wait_for_selector("#rexam-sealed")
    attempt = [e for e in of_type(page, "exam", state="start") if e.get("unit") == "U3"][0]
    check("after the sitting: the sealed screen, 20 of 60, no verdict anywhere", text(page, "#rexam-count") == "20 of 60" and page.query_selector("#rexam-verdict") is None and page.query_selector("#verdict") is None, text(page, "#rexam-count"))
    F.audit(E, "range exam sealed")
    ex = [e for e in ranges_of(page) if e.get("exam") == attempt["id"]]
    check("20 exam ranges were saved, each carrying its attempt, all from the exam pool", len(ex) == 20 and all(e["mode"] == "exam" and RANGE_BY_ID[e["q"]]["pool"] == "exam" for e in ex), str(len(ex)))
    check("the attempt is a Unit 3 attempt of 60", attempt["unit"] == "U3" and attempt["n"] == 60)
    go(page, "#/mirror")
    page.wait_for_selector("#range-record")
    rows = {tr.query_selector_all("td")[0].text_content().strip(): tr.query_selector_all("td")[1].text_content().strip() for tr in page.query_selector_all("#stats tr")}
    check("sealed: the Mirror counts the 40 practice ranges and none of the 20 exam ranges", text(page, "#rr-n") == "n=40", text(page, "#rr-n"))
    go(page, "#/path")
    page.wait_for_selector("#rgate-card")
    check("the Path says the exam is in progress and offers the next sitting of 20", text(page, "#rgate-status") == "In progress" and text(page, "#rgate-start") == "Next sitting: 20 ranges", f"{text(page, '#rgate-status')} / {text(page, '#rgate-start')}")
    E.ctx.close()

    # -- judged: pass, fail too narrow, fail too wide ------------------------------------------------------------------
    for kind, first40, last20, want_pass, want_hits in (
        ("pass", "1111111110", lambda i: i % 10 != 9, True, 54),
        ("narrow", "1110000000", lambda i: i % 2 == 0, False, 22),
        ("wide", "1", lambda i: True, False, 60),
    ):
        r = synth.u1_passed_player(U1_EXAM, start=START)
        for k in range(4):
            r.range_day(synth.add_days("2026-09-20", k), RANGE_PRACTICE[k * 10:(k + 1) * 10], synth.hit_miss_policy("1111111110"), minute=10)
        att = r.range_exam_start("2026-09-25", 10)
        pool = list(RANGE_EXAM)
        random.Random(11).shuffle(pool)
        policy = synth.centered_policy(3.0) if kind == "wide" else synth.hit_miss_policy(first40)
        r.range_day("2026-09-25", pool[:20], policy, mode="exam", minute=20, exam=att, n=1, of=3)
        r.range_day("2026-09-26", pool[20:40], policy, mode="exam", minute=20, exam=att, n=2, of=3)
        page = open_app(E, "2026-09-27", r.write(os.path.join(E.tmp, f"b6_exam_{kind}.jsonl")))
        go(page, "#/path")
        page.wait_for_selector("#rgate-start")
        page.click("#rgate-start")
        page.wait_for_selector("#claim")
        check(f"[{kind}] the last sitting is sitting 3 of 3 with 20 ranges to go", text(page, ".cnt") == "1 of 20" and text(page, "#mode-tag") == "Exam · sitting 3 of 3", f"{text(page, '.cnt')} {text(page, '#mode-tag')}")
        used = {e["q"] for e in ranges_of(page, mode="exam")}

        def chooser(i, q_):
            if kind == "wide":
                return centred(q_, 3.0)
            return centred(q_, 1.0) if last20(i) else centred(q_, 1.0, shift=3.0)

        play_ranges(page, 20, chooser, reveal=False)
        page.wait_for_selector("#rexam-verdict")
        new = [e for e in ranges_of(page, mode="exam") if e["q"] not in used]
        check(f"[{kind}] the last sitting's ranges are fresh: none was asked before in this exam", len(new) == 20 and len({e["q"] for e in ranges_of(page, mode="exam")}) == 60)
        res = [e for e in of_type(page, "exam", state="result") if e.get("unit") == "U3"][0]
        exp_hits = sum(1 for e in ranges_of(page, mode="exam") if e["hit"])
        check(f"[{kind}] judged once: {exp_hits} of 60 held the truth, {'passed' if want_pass else 'not passed'}", res["pass"] == want_pass and res["hits"] == exp_hits == want_hits and res["n"] == 60 and text(page, "#rexam-hits") == str(exp_hits) and text(page, "#rexam-verdict") == ("Passed" if want_pass else "Not passed this time"), f"{res['hits']} {text(page, '#rexam-verdict')}")
        check(f"[{kind}] the verdict agrees with the gate's table: 50 to 58 passes", res["pass"] == (50 <= exp_hits <= 58))
        F.audit(E, f"range exam verdict {kind}")
        shot(E, f"b6-verdict-{kind}.png")
        if not want_pass:
            why = text(page, "#rexam-reasons")
            check(f"[{kind}] it says why, in words", ("too narrow" in why) if kind == "narrow" else ("wider than they needed" in why), why[:200])
            check(f"[{kind}] and names the repair", ("one end at a time" in why) if kind == "narrow" else ("width budget" in why), why[-200:])
        go(page, "#/mirror")
        page.wait_for_selector("#range-record")
        check(f"[{kind}] judged: the exam ranges now join the Mirror (n=100)", text(page, "#rr-n") == "n=100", text(page, "#rr-n"))
        go(page, "#/path")
        page.wait_for_selector("#rgate-card")
        if want_pass:
            check("[pass] the Path says Passed and the Unit 3 row says Passed", text(page, "#rgate-status") == "Passed" and "Passed" in [li for li in page.query_selector_all(".units li") if "Unit 3" in li.text_content()][0].text_content())
            go(page, "#/mirror")
            page.wait_for_selector("#belts")
            check("[pass] the belts count Unit 3's gate: Gates U0 to U3, 3 of 4", "Gates U0 to U3: 3 of 4" in text(page, "#belts"), text(page, "#belts")[:200])
        else:
            check(f"[{kind}] the Path says repair first, with the drill", text(page, "#rgate-status") == "Repair first" and page.is_visible("#rgate-start"), text(page, "#rgate-card")[:160])
            page.click("#rgate-start")
            page.wait_for_selector("#claim")
            check(f"[{kind}] the repair drill is {'one end at a time' if kind == 'narrow' else 'under a width budget'}", (page.query_selector("#high-box") is None) if kind == "narrow" else (page.query_selector("#budget-note") is not None), text(page, "#mode-tag"))
            check(f"[{kind}] it is called a repair drill", text(page, "#mode-tag") == "Repair drill", text(page, "#mode-tag"))
            play_ranges(page, 10, lambda i, q_: ref_range.stretched(q_, 1.0))
            page.wait_for_selector("#drill-next")
            check(f"[{kind}] after it the next exam is open again", "repair drill is done" in text(page, "#drill-next") and len([e for e in read_events(page) if e["type"] == "exam" and e.get("state") == "repair"]) == 1)
            go(page, "#/path")
            page.wait_for_selector("#rgate-card")
            check(f"[{kind}] the exam card says Ready again", text(page, "#rgate-status") == "Ready", text(page, "#rgate-status"))
        E.ctx.close()

    # -- rust: a passed Unit 3 reopens when a range pattern comes back ------------------------------------------------------
    r = synth.u1_passed_player(U1_EXAM, start=START)
    for k in range(4):
        r.range_day(synth.add_days("2026-09-20", k), RANGE_PRACTICE[k * 10:(k + 1) * 10], synth.hit_miss_policy("1111111110"), minute=10)
    att = r.range_exam_start("2026-09-25", 10)
    pool = list(RANGE_EXAM)
    random.Random(12).shuffle(pool)
    for s in range(3):
        r.range_day(synth.add_days("2026-09-25", s), pool[s * 20:(s + 1) * 20], synth.hit_miss_policy("1111111110"), mode="exam", minute=20, exam=att, n=s + 1, of=3)
    r._add("exam", "2026-09-27", 400, state="result", exam=att, **{"pass": True}, n=60, hits=54, coverage=0.9, meanRatio=1.0, points=0, reasons=[], dir=None)
    for k in range(4):
        r.range_day(synth.add_days("2026-10-01", k), RANGE_PRACTICE[40 + k * 10:50 + k * 10], synth.hit_miss_policy("1100110011"), minute=10)
    page = open_app(E, "2026-10-06", r.write(os.path.join(E.tmp, "b6_rust.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#rgate-rust")
    check("a range pattern that returns after the pass shows Rust on the exam card", "Ranges too narrow" in text(page, "#rgate-rust") and text(page, "#rgate-status") == "Passed", text(page, "#rgate-rust"))
    E.ctx.close()


# ---------------------------------------------------------------------------------------------------------------
# Block 7: Fermi worksheets, base rates, reference classes, chains, and the Unit 4 and 5 exams
# ---------------------------------------------------------------------------------------------------------------
import ref_problem as RP  # noqa: E402  (an independent version of the Block 7 rules)
FERMI_BANK = json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "fermi.json"), encoding="utf-8"))["questions"]
RATE_ALL = json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "rates.json"), encoding="utf-8"))["questions"]
FERMI_BY_CLAIM = {f"{q['lead']} {q['ask']}": q for q in FERMI_BANK}
RATE_BY_CLAIM = {f"{q['lead']} {q['ask']}": q for q in RATE_ALL if q["type"] in ("rate", "class")}
CHAINS = [q for q in RATE_ALL if q["type"] == "chain"]


def pct1(x): return f"{float(f'{x:.1f}'):g}%"


def fermi_expect(q, parts):
    lo, hi = RP.combine(parts, q["mult"])
    j = RP.judge(q, lo, hi)
    return lo, hi, j


def play_fermi(page, n, stretch_of, direct=True, checks=None, reveal=True):
    """n Fermi problems. stretch_of(i, q) -> a factor (every part's range is its truth stretched by it) or 'above' (every part wholly above its truth)."""
    out = []
    for i in range(n):
        page.wait_for_selector("#claim")
        claim = text(page, "#claim")
        q = FERMI_BY_CLAIM[claim]
        if direct:
            page.wait_for_selector("#direct-low")
            check_btn = page.is_disabled("#direct-go")
            page.fill("#direct-low", rnum(q["ref_low"])); page.fill("#direct-high", rnum(q["ref_high"]))
            F.settle(page)
            page.click("#direct-go")
            if i == 0:
                out_first = check_btn
        page.wait_for_selector("#part-0-low")
        f = stretch_of(i, q)
        parts = [(p["truth"] * 1.5, p["truth"] * 3) if f == "above" else (p["truth"] / f, p["truth"] * f) for p in q["parts"]]
        for k, (a, b) in enumerate(parts):
            page.fill(f"#part-{k}-low", rnum(a)); page.fill(f"#part-{k}-high", rnum(b))
        lo, hi, j = fermi_expect(q, parts)
        F.settle(page)
        page.click("#lock")
        if reveal:
            page.wait_for_selector("#verdict")
            if checks:
                checks(i, q, parts, lo, hi, j)
            F.settle(page)
            page.click("#next")
        advance_to(page, claim, prefixes=("#/psummary/", "#/pexam/"))
        out.append((q, parts, lo, hi, j))
    return out


def phase_b7(E):
    """Units 4 and 5: the worksheet, the sealed exams, base rates, reference ladders and chains, against ref_problem.py."""
    # -- closed until Unit 3 is passed ----------------------------------------------------------------------------------
    r0 = synth.u1_passed_player(U1_EXAM, start=START)
    page = open_app(E, "2026-09-20", r0.write(os.path.join(E.tmp, "b7_closed.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#ranges-card")
    check("before Unit 3 is passed there is no Unit 4 card on Today", page.query_selector("#u4-card") is None and page.query_selector("#u5-card") is None)
    go(page, "#/path")
    page.wait_for_selector("#rgate-card")
    u4 = [li for li in page.query_selector_all(".units li") if "Unit 4" in (li.text_content() or "")]
    check("Unit 4 is Locked on the Path and has no cards", u4 and "Locked" in u4[0].text_content() and page.query_selector("#fermi-practice-card") is None and page.query_selector("#pgate-U4-card") is None)
    go(page, "#/prob/fermi")
    page.wait_for_function("location.hash === '#/today'", timeout=5000)
    check("opening the Fermi address while closed sends you back to Today", page.evaluate("location.hash") == "#/today")
    E.ctx.close()

    # -- open: Today, the Path, the lesson cards --------------------------------------------------------------------------
    base = synth.u3_passed_player(U1_EXAM, start=START)
    day = "2026-10-12"
    page = open_app(E, day, base.write(os.path.join(E.tmp, "b7_open.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#u4-card")
    check("Unit 4 is open: Today offers eight Fermi problems, none done", "8 Fermi problems" in text(page, "#u4-line") and "0 of 16" in text(page, "#u4-line") and page.query_selector("#u5-card") is None, text(page, "#u4-line"))
    F.audit(E, "today with Unit 4")
    go(page, "#/path")
    page.wait_for_selector("#pgate-U4-card")
    check("the Path shows Unit 4 as Open with three lesson cards, practice, and an exam card that is not open yet",
          len(page.query_selector_all("#fermi-lessons-card .lesson-link")) == 3 and page.is_visible("#fermi-practice") and page.is_visible("#chain-practice") and text(page, "#pgate-U4-status") == "Not open yet" and "16 practice" in text(page, "#pgate-U4-card"), text(page, "#pgate-U4-card")[:120])
    check("Unit 5 stays closed until Unit 4 is passed", page.query_selector("#rate-practice-card") is None and page.query_selector("#pgate-U5-card") is None)
    F.audit(E, "path with Unit 4")
    shot(E, "b7-path.png")
    go(page, "#/lesson/break")
    page.wait_for_selector("#lesson-title")
    check("the first Unit 4 card is 'Break it down' under Unit 4", "Unit 4" in text(page, ".eyebrow") and len(text(page, "#lesson-title")) > 3, text(page, "#lesson-title"))
    F.audit(E, "fermi lesson")
    for _ in range(3):
        page.click("#lesson-done")
        page.wait_for_timeout(250)
    page.wait_for_function("location.hash === '#/path'", timeout=10000)
    check("three Unit 4 cards read are three lesson events", {"break", "multiply", "parts"} <= {e["lesson"] for e in of_type(page, "lesson")})

    # -- a practice session of eight -----------------------------------------------------------------------------------------
    go(page, "#/prob/fermi")
    page.wait_for_selector("#direct-low")
    q0 = FERMI_BY_CLAIM[text(page, "#claim")]
    check("a Fermi session opens: problem 1 of 8, from the practice pool, asking for a first guess before the worksheet", text(page, ".cnt") == "1 of 8" and q0["pool"] == "practice" and "Unit 4 practice" in text(page, "#mode-tag") and page.is_disabled("#direct-go") and page.query_selector("#part-0-low") is None, q0["id"])
    F.audit(E, "fermi first guess")
    page.fill("#direct-low", "abc"); page.fill("#direct-high", "5")
    check("letters in the first guess are refused", "numbers only" in text(page, "#range-msg").lower() and page.is_disabled("#direct-go"), text(page, "#range-msg"))
    page.fill("#direct-low", "0"); page.fill("#direct-high", "5")
    check("a zero low end is refused for a size you cannot be 90% sure of on a log scale", page.is_disabled("#direct-go"), text(page, "#range-msg"))
    page.fill("#direct-low", rnum(q0["ref_low"])); page.fill("#direct-high", rnum(q0["ref_high"]))
    F.settle(page)
    page.click("#direct-go")
    page.wait_for_selector("#part-0-low")
    nparts = len(q0["parts"])
    check("the worksheet has one card per part of the problem, and the lock is off until every part is filled", len(page.query_selector_all(".part")) == nparts and page.is_disabled("#lock") and nparts >= 2, f"{nparts} parts")
    F.audit(E, "fermi worksheet")
    shot(E, "b7-worksheet.png")
    page.fill("#part-0-low", "5"); page.fill("#part-0-high", "2")
    check("a part whose low is above its high is refused by name", "low end" in text(page, "#range-msg").lower() and page.is_disabled("#lock"), text(page, "#range-msg"))
    # fill part 0 properly and the rest, and compare the live combined range with the independent combination
    parts0 = [(p["truth"] / 2, p["truth"] * 2) for p in q0["parts"]]
    for k, (a, b) in enumerate(parts0):
        page.fill(f"#part-{k}-low", rnum(a)); page.fill(f"#part-{k}-high", rnum(b))
    lo0, hi0 = RP.combine(parts0, q0["mult"])
    shown = text(page, "#sheet-range")
    digits = q0["digits"]
    fmtn = lambda x: f"{x:,.{digits}f}"  # noqa: E731
    check("the worksheet shows the combined range as the independent version works it out (centres add, spreads in quadrature)", shown.startswith(f"{fmtn(lo0)} to {fmtn(hi0)}"), f"{shown} vs {fmtn(lo0)} to {fmtn(hi0)}")
    check("it also says what lows-times-lows and highs-times-highs would give, and that it is wider", "would give" in text(page, "#sheet-sum") and not page.is_disabled("#lock"))
    page.reload()
    page.wait_for_selector("#direct-low")
    check("closing the page mid-problem keeps the session open: the same problem comes back, nothing saved for it", text(page, ".cnt") == "1 of 8" and FERMI_BY_CLAIM[text(page, "#claim")]["id"] == q0["id"] and not of_type(page, "prob"))

    seen = []

    def fermi_checks(i, q, parts, lo, hi, j):
        ev_pts = text(page, "#points")
        ok = ev_pts == signed(j["points"]) and (("Inside" in text(page, "#verdict")) == j["hit"])
        seen.append(ok)
        if i == 0:
            check("the reveal shows the points and inside or outside as the independent rules give, the parts table, and the worksheet against the first guess",
                  ok and len(page.query_selector_all("#part-rows li")) == len(q["parts"]) and page.query_selector("#direct-note") is not None and page.is_visible("#range-line"), f"{ev_pts} vs {signed(j['points'])}")
            F.audit(E, "fermi reveal")
            shot(E, "b7-reveal.png")

    plan = [1.5, 2.0, "above", 3.0, 1.2, 2.5, "above", 1.5]
    done = play_fermi(page, 8, lambda i, q: plan[i], checks=fermi_checks)
    check("all eight reveals showed the independent points and verdict", len(seen) == 8 and all(seen), str(seen))
    page.wait_for_function("location.hash.startsWith('#/psummary/')", timeout=10000)
    probs = of_type(page, "prob", mode="practice", family="fermi")
    check("eight Fermi problems were saved with the numbers the independent rules give (combined range, hit, points, miss factor)", len(probs) == 8 and all(
        near(p["low"], d[2], 1e-9 * max(1, d[2])) and near(p["high"], d[3], 1e-9 * max(1, d[3])) and p["hit"] == d[4]["hit"] and p["points"] == d[4]["points"] and near(p["miss"], d[4]["miss"], 1e-6 * d[4]["miss"]) and len(p["parts"]) == len(d[0]["parts"]) and p["unit"] == "U4"
        for p, d in zip(probs, done)), str([(p["points"], d[4]["points"]) for p, d in zip(probs, done)])[:200])
    check("every problem carries the first guess and its score, for the Mirror's comparison", all(p.get("direct") and "points" in p["direct"] for p in probs))
    hits = sum(1 for d in done if d[4]["hit"])
    pts_sum = sum(d[4]["points"] for d in done)
    check("the summary says how many held the truth and the points total", f"{hits} of 8 held the truth" in text(page, "#ps-head") and text(page, "#sum-points") == signed(pts_sum), f"{text(page, '#ps-head')} {text(page, '#sum-points')}")
    F.audit(E, "fermi summary")
    shot(E, "b7-summary.png")
    check("a session of Fermi problems ends with one psession_end and no gate event", len(of_type(page, "psession_end")) == 1 and not [e for e in of_type(page, "exam") if e.get("unit") == "U4"])
    go(page, "#/mirror")
    page.wait_for_selector("#reasoning-record")
    rs_text = text(page, "#rs-table")
    med = sorted(d[4]["miss"] for d in done)
    median = (med[3] + med[4]) / 2
    check("the Mirror shows the Fermi ranges that held and the median miss", f"{hits} of 8" in rs_text and f"{median:.1f}×" in rs_text, rs_text[:200])
    F.audit(E, "mirror reasoning")
    E.ctx.close()

    # -- the Unit 4 exam: ready, sealed sittings, verdict --------------------------------------------------------------------
    r4 = synth.u4_ready_player(U1_EXAM, start=START)
    day = "2026-10-12"
    page = open_app(E, day, r4.write(os.path.join(E.tmp, "b7_u4.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#need-pexam-U4")
    check("Today lists the Unit 4 exam as ready", "20 fresh problems" in text(page, "#need-pexam-U4"), text(page, "#need-pexam-U4"))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U4-start")
    check("the Path says the exam is Ready: 20 fresh Fermi problems in 2 sittings of 10", text(page, "#pgate-U4-status") == "Ready" and "2 sittings of 10" in text(page, "#pgate-U4-card") and "16 of 20" in text(page, "#pgate-U4-card"), text(page, "#pgate-U4-card")[:160])
    F.audit(E, "path with Unit 4 exam")
    page.click("#pgate-U4-start")
    page.wait_for_selector("#part-0-low")
    q = FERMI_BY_CLAIM[text(page, "#claim")]
    check("the exam opens on the worksheet with no first-guess step: sitting 1 of 2, problem 1 of 10, from the exam pool", text(page, ".cnt") == "1 of 10" and "sitting 1 of 2" in text(page, "#mode-tag") and q["pool"] == "exam" and page.query_selector("#direct-low") is None, q["id"])
    start_ev = [e for e in of_type(page, "exam", state="start") if e.get("unit") == "U4"]
    check("starting wrote a Unit 4 attempt of 20", len(start_ev) == 1 and start_ev[0]["n"] == 20)
    stretch = lambda i, q: "above" if i in (2, 5) else 1.5  # noqa: E731
    sit1 = play_fermi(page, 10, stretch, direct=False, reveal=False)
    page.wait_for_function("location.hash.startsWith('#/pexam/')", timeout=15000)
    page.wait_for_selector("#pexam-sealed")
    body = text(page, "main").lower()
    check("between sittings nothing is shown about the answers: no verdict, no hits, no points", page.query_selector("#pexam-verdict") is None and "inside" not in body and "held the truth" not in body and "10 of 20" in text(page, "#pexam-count") or "10 of 20" in body, text(page, "#pexam-sealed")[:160])
    F.audit(E, "fermi exam sealed")
    check("the sealed screen lists sitting 2 and the exam's saved answers are 10 sealed problems", len(of_type(page, "prob", mode="exam")) == 10)
    go(page, "#/mirror")
    page.wait_for_selector("#stats")
    check("sealed exam problems stay out of the Mirror until the verdict", page.query_selector("#reasoning-record") is not None and "Fermi ranges that held" in text(page, "#rs-table") and "n=16" in text(page, "#rs-n"), text(page, "#rs-n"))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U4-start")
    check("the Path shows the exam in progress with the next sitting", text(page, "#pgate-U4-status") == "In progress" and "10 of 20" in text(page, "#pgate-U4-card"), text(page, "#pgate-U4-card")[:140])
    page.click("#pgate-U4-start")
    page.wait_for_selector("#part-0-low")
    check("sitting 2 opens at 1 of 10", text(page, ".cnt") == "1 of 10" and "sitting 2 of 2" in text(page, "#mode-tag"))
    used1 = {d[0]["id"] for d in sit1}
    q2 = FERMI_BY_CLAIM[text(page, "#claim")]
    check("sitting 2 never repeats a problem from sitting 1", q2["id"] not in used1)
    sit2 = play_fermi(page, 10, lambda i, q: 1.5, direct=False, reveal=False)
    page.wait_for_function("location.hash.startsWith('#/pexam/')", timeout=15000)
    page.wait_for_selector("#pexam-verdict")
    allp = sit1 + sit2
    hits = sum(1 for d in allp if d[4]["hit"])
    medm = sorted(d[4]["miss"] for d in allp)
    medm = (medm[9] + medm[10]) / 2
    want_pass = hits >= 16 and medm <= 3
    check("the verdict is the independent one: hits, median miss and pass", text(page, "#pexam-hits") == str(hits) and (text(page, "#pexam-verdict") == "Passed") == want_pass and f"{medm:.1f}×" == text(page, "#pexam-miss"), f"{text(page, '#pexam-hits')}/{hits} {text(page, '#pexam-verdict')} {text(page, '#pexam-miss')}/{medm:.2f}")
    res = [e for e in of_type(page, "exam", state="result") if e.get("unit") == "U4"]
    check("one Unit 4 result event with n=20, the hits, the pass and the median miss", len(res) == 1 and res[0]["n"] == 20 and res[0]["hits"] == hits and res[0]["pass"] == want_pass and near(res[0]["medianMiss"], medm, 1e-6), str(res[:1])[:200])
    F.audit(E, "fermi exam verdict")
    shot(E, "b7-exam-pass.png")
    go(page, "#/today")
    page.wait_for_selector("#u5-card")
    check("passing Unit 4 opens Unit 5: Today offers twelve base-rate problems", "12 base-rate problems" in text(page, "#u5-line") and "0 of 36" in text(page, "#u5-line"), text(page, "#u5-line"))
    E.ctx.close()

    # -- Unit 5 practice: base rates, a reference ladder, a chain -----------------------------------------------------------
    r5 = synth.u5_ready_player(U1_EXAM, start=START)
    import csv
    fl = list(csv.DictReader(open(os.path.join(synth.ROOT, "data", "question_tables", "flights.csv"), encoding="utf-8")))
    def late_share(rows): return len(rows), round(100.0 * sum(1 for x in rows if int(x["arrival_delay_min"]) >= 15) / len(rows) + 1e-9, 1)
    tpa = [x for x in fl if x["origin"] == "TPA"]; jan = [x for x in tpa if x["departs"][5:7] == "01"]; morning = [x for x in jan if int(x["departs"][11:13]) < 10]
    under = [x for x in morning if int(x["distance_mi"]) < 300]
    ladder_counts = [late_share(fl), late_share(tpa), late_share(jan), late_share(morning), late_share(under)]
    check("the ladder lesson's worked example (Tampa, January, morning, under 300 miles) matches the flight record", ladder_counts == [(20000, 21.4), (393, 19.6), (123, 19.5), (34, 2.9), (9, 11.1)], str(ladder_counts))
    page = open_app(E, "2026-10-20", r5.write(os.path.join(E.tmp, "b7_u5.jsonl")))
    go(page, "#/lesson/ladder")
    page.wait_for_selector("#lesson-title")
    body = text(page, "main")
    check("the ladder card shows the example's rungs", all(t in body for t in ("20,000", "393", "123", "34")) and all(t in body for t in ("21.4%", "19.6%", "19.5%", "2.9%")), body[:200])
    F.audit(E, "ladder lesson")
    go(page, "#/path")
    page.wait_for_selector("#pgate-U5-card")
    check("the Path shows Unit 5 open with the exam Ready (36 practice done)", text(page, "#pgate-U5-status") == "Ready" and len(page.query_selector_all("#rate-lessons-card .lesson-link")) == 4 and "40 fresh" in text(page, "#pgate-U5-card"), text(page, "#pgate-U5-card")[:140])
    go(page, "#/prob/rate")
    page.wait_for_selector("#claim")
    seen_kinds, outs = set(), []
    for i in range(12):
        page.wait_for_selector("#claim")
        claim = text(page, "#claim")
        q = RATE_BY_CLAIM[claim]
        if q["type"] == "class":
            seen_kinds.add("class")
            page.wait_for_selector("#class-choices")
            pick = q["right"] if i % 2 == 0 else len(q["classes"]) - 1
            if i == 0 or "class" not in seen_kinds:
                F.audit(E, "class ladder")
            page.click(f"#class-{pick}")
            F.settle(page)
            page.click("#lock")
            page.wait_for_selector("#verdict")
            exp_pts = 60 if pick == q["right"] else -30
            outs.append(("class", q, pick, exp_pts, text(page, "#points") == signed(exp_pts) and (("Right group" in text(page, "#verdict")) == (pick == q["right"]))))
        else:
            seen_kinds.add("rate")
            off = [0, 10, -3.5, 25][i % 4]
            g = min(100.0, max(0.0, q["truth"] + off))
            page.fill("#pct-input", rnum(g))
            if not outs and F.audit:
                F.audit(E, "rate question")
            F.settle(page)
            page.click("#lock")
            page.wait_for_selector("#verdict")
            miss = abs(g - q["truth"])
            exp_pts = max(-100, round(100 * (1 - miss / 7)))
            outs.append(("rate", q, g, exp_pts, text(page, "#points") == signed(exp_pts) and (("Within 7" in text(page, "#verdict")) == (miss <= 7 + 1e-9))))
        F.settle(page)
        page.click("#next")
        advance_to(page, claim, prefixes=("#/psummary/",))
    page.wait_for_function("location.hash.startsWith('#/psummary/')", timeout=10000)
    check("a Unit 5 session mixes base-rate problems and reference ladders, nine and three", seen_kinds == {"rate", "class"} and sum(1 for o in outs if o[0] == "class") == 3, str([o[0] for o in outs]))
    check("every reveal showed the independent points and verdict (percent: 100 × (1 − miss/7); ladder: +60 or −30)", all(o[4] for o in outs), str([(o[0], o[3], o[4]) for o in outs]))
    ps = of_type(page, "prob", mode="practice", unit="U5")
    new = ps[-12:]
    check("twelve problems were saved with the independent guess, miss, hit and points; ladders carry choice and right",
          len(new) == 12 and all((p["family"] == "class" and p["choice"] == o[2] and p["points"] == o[3]) or (p["family"] == "rate" and near(p["guess"], o[2], 1e-9) and p["points"] == o[3]) for p, o in zip(new, outs)))
    F.audit(E, "rate summary")
    go(page, "#/prob/chain")
    page.wait_for_selector("#chain-steps")
    F.audit(E, "chain question")
    chain_ok = []
    for i in range(10):
        page.wait_for_selector("#chain-steps")
        rates = tuple(float(t.rstrip("%")) for t in page.eval_on_selector_all("#chain-steps li b", "els => els.map(e => e.textContent)"))
        match = [c for c in CHAINS if tuple(s["rate"] for s in c["steps"]) == rates]
        truth = match[0]["truth"]
        guess = truth if i % 2 == 0 else min(100.0, max(rates))  # the product, or the naive 'strongest step'
        page.fill("#pct-input", rnum(guess))
        F.settle(page)
        page.click("#lock")
        page.wait_for_selector("#verdict")
        note = text(page, "#pct-note")
        exp_pts = max(-100, round(100 * (1 - abs(guess - truth) / 7)))
        chain_ok.append(bool(match) and text(page, "#points") == signed(exp_pts) and "The chain multiplies" in note and pct1(truth) in note)
        if i == 0:
            F.audit(E, "chain reveal")
        F.settle(page)
        page.click("#next")
        if i < 9:
            page.wait_for_function("() => !document.getElementById('verdict')", timeout=10000)
    page.wait_for_function("location.hash.startsWith('#/psummary/')", timeout=10000)
    check("ten chain problems: each reveal shows the product of its steps and the independent points", len(chain_ok) == 10 and all(chain_ok), str(chain_ok))
    cprobs = of_type(page, "prob", family="chain")
    check("chain problems are saved as practice but do not count toward the Unit 5 gate", len(cprobs) == 10 and all(p["mode"] == "practice" for p in cprobs))

    # -- the Unit 5 exam, failed on purpose: too high, then the repair drill ---------------------------------------------------
    go(page, "#/path")
    page.wait_for_selector("#pgate-U5-start")
    page.click("#pgate-U5-start")
    page.wait_for_selector("#pct-input")
    check("the Unit 5 exam opens at sitting 1 of 2, problem 1 of 20, base rates only", text(page, ".cnt") == "1 of 20" and "sitting 1 of 2" in text(page, "#mode-tag") and RATE_BY_CLAIM[text(page, "#claim")]["pool"] == "exam" and RATE_BY_CLAIM[text(page, "#claim")]["type"] == "rate")
    exam_ans = []
    for sitting in range(2):
        for i in range(20):
            page.wait_for_selector("#pct-input")
            claim = text(page, "#claim")
            q = RATE_BY_CLAIM[claim]
            g = min(100.0, q["truth"] + 20)
            page.fill("#pct-input", rnum(g))
            F.settle(page)
            page.click("#lock")
            advance_to(page, claim, prefixes=("#/pexam/",))
            exam_ans.append((q, g))
        if sitting == 0:
            page.wait_for_selector("#pexam-sealed")
            check("after sitting 1 the exam is sealed", page.query_selector("#pexam-verdict") is None and "20 of 40" in text(page, "#pexam-count"))
            page.click("#pexam-next")
    page.wait_for_selector("#pexam-verdict")
    within = sum(1 for q, g in exam_ans if abs(g - q["truth"]) <= 7 + 1e-9)
    bias = sum(g - q["truth"] for q, g in exam_ans) / 40
    check("the Unit 5 verdict is the independent one: within-7 count, not passed, and it says the answers ran high", text(page, "#pexam-hits") == str(within) and text(page, "#pexam-verdict").startswith("Not passed") and "ran high" in text(page, "#pexam-reasons"), f"{text(page, '#pexam-hits')}/{within} {text(page, '#pexam-reasons')[:140]}")
    res = [e for e in of_type(page, "exam", state="result") if e.get("unit") == "U5"]
    check("one Unit 5 result: n=40, within, bias and the reason", len(res) == 1 and res[0]["n"] == 40 and res[0]["hits"] == within and not res[0]["pass"] and near(res[0]["bias"], bias, 1e-6) and res[0]["dir"] == "too high", str(res[:1])[:200])
    F.audit(E, "rate exam failed")
    check("the verdict page points to a repair drill of ten", page.get_attribute("#pexam-after", "href") == "#/prob/repair-U5")
    page.click("#pexam-after")
    page.wait_for_selector("#pct-input")
    check("the repair drill opens: 1 of 10, labelled as a repair drill", text(page, ".cnt") == "1 of 10" and "Repair drill" in text(page, "#mode-tag"))
    for i in range(10):
        page.wait_for_selector("#pct-input")
        claim = text(page, "#claim")
        q = RATE_BY_CLAIM[claim]
        page.fill("#pct-input", rnum(q["truth"]))
        F.settle(page)
        page.click("#lock")
        page.wait_for_selector("#verdict")
        F.settle(page)
        page.click("#next")
        advance_to(page, claim, prefixes=("#/psummary/",))
    page.wait_for_function("location.hash.startsWith('#/psummary/')", timeout=10000)
    check("the repair drill ends on a summary that says what happens next, and writes the repair event", page.query_selector("#drill-next") is not None and [e for e in of_type(page, "exam", state="repair")], text(page, "main")[:120])
    drills = [p for p in of_type(page, "prob") if p["mode"] == "drill"]
    check("drill problems are saved as drill and kept out of the Mirror's count", len(drills) == 10)
    go(page, "#/path")
    page.wait_for_selector("#pgate-U5-status")
    check("after the repair a new Unit 5 exam is Ready", text(page, "#pgate-U5-status") == "Ready", text(page, "#pgate-U5-status"))
    go(page, "#/mirror")
    page.wait_for_selector("#reasoning-record")
    rs = text(page, "#rs-table")
    natural = [e for e in of_type(page, "prob") if e["mode"] in ("practice", "exam") and e["family"] in ("rate", "chain")]
    wi = sum(1 for e in natural if e["hit"])
    check("the Mirror counts base rates within 7 over practice and the judged exam only (drills excluded)", f"{wi} of {len(natural)}" in rs, rs[:240])
    F.audit(E, "mirror reasoning rates")
    E.ctx.close()


    # -- the journal's reasoning tools: shown as their units open --------------------------------------------------------------
    def write_card(page, text_, steps=None, own=None, c=None):
        go(page, "#/journal/write")
        page.wait_for_selector("#claim-text")
        page.fill("#claim-text", text_)
        page.click(".picker >> text=Work"); page.click(".picker >> text=This week")
        has_own = page.query_selector("#own-task") is not None
        if own is not None and has_own:
            page.click("#own-task .picker >> text=Yes" if own else "#own-task .picker >> text=No")
        F.settle(page)
        page.click("text=Next: the chain")
        page.wait_for_selector("#add-evidence")
        has_chain = page.query_selector("#chain-box") is not None
        for f in page.query_selector_all("input.field[type=text]"):
            if not f.evaluate("e => !!e.closest('#chain-box')"):
                f.fill("x")
        if steps and has_chain:
            ins = page.query_selector_all("#chain-box input")
            for i, (t, pr) in enumerate(steps):
                ins[2 * i].fill(t); ins[2 * i + 1].fill(str(pr))
        prod_text = text(page, "#chain-product") if has_chain else ""
        F.settle(page)
        page.click("text=Next: your number")
        page.wait_for_selector("#prob")
        if c is not None:
            page.evaluate("(v) => { const e = document.getElementById('prob'); e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", c)
        notes = (text(page, "#chain-note") if page.query_selector("#chain-note") else "", text(page, "#outside-grade") if page.query_selector("#outside-grade") else "")
        F.settle(page)
        page.click("#lock")
        page.wait_for_function("location.hash.startsWith('#/journal/') && location.hash !== '#/journal/write'", timeout=8000)
        return has_own, has_chain, prod_text, notes

    page = open_app(E, "2026-09-20", synth.u1_passed_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b7j0.jsonl")))
    has_own, has_chain, _, notes = write_card(page, "By Friday, the report will be sent.")
    check("before Unit 4 is open the journal has no own-task tag, no chain steps and no outside-view grade", not has_own and not has_chain and notes == ("", ""))
    E.ctx.close()

    page = open_app(E, "2026-10-12", synth.u3_passed_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b7j1.jsonl")))
    has_own, has_chain, prod_text, notes = write_card(page, "By Friday, the vendor will ship and I will install it and it will pass the check.", steps=[("It ships", 80), ("I install it", 70), ("It passes", 90)], c=70)
    check("with Unit 4 open the chain step offers steps, multiplies them as typed (80 x 70 x 90 = 50.4%) and warns when the number is above the product",
          has_chain and not has_own and "50%" in prod_text and "50%" in notes[0] and "about to say 70%" in notes[0] and notes[1] == "", f"{prod_text} | {notes}")
    pr = [e for e in of_type(page, "prediction")][-1]
    check("the card is saved with its steps (three, as probabilities) and no own-task tag", [x["p"] for x in pr.get("steps", [])] == [0.8, 0.7, 0.9] and "own" not in pr, str(pr.get("steps")))
    F.audit(E, "journal chain steps")
    E.ctx.close()

    page = open_app(E, "2026-10-20", synth.u5_ready_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b7j2.jsonl")))
    has_own, has_chain, prod_text, notes = write_card(page, "By Friday, I will finish the draft and send it to the team.", steps=[("I finish", 90), ("It gets approved", 60)], own=True, c=40)
    check("with Unit 5 open there is an own-task tag, and the lock step grades the outside view against the baseline", has_own and "baseline" in notes[1] and ("accepted" in notes[1] or "away" in notes[1]) and "at or under" in notes[0], str(notes))
    pr = [e for e in of_type(page, "prediction")][-1]
    check("the card is saved with own true and its two steps", pr.get("own") is True and len(pr.get("steps", [])) == 2)
    page.wait_for_selector("#lens-reasoning, #chain-open, .card")
    body = text(page, "main")
    check("the card shows its chain steps and the product", "Chain steps" in body and "Together: 54%" in body or "Together: 54.0%" in body or "Together: 54" in body, body[:260])
    F.audit(E, "journal with own task")
    E.ctx.close()


# ---------------------------------------------------------------------------------------------------------------
# Block 8: updating (Unit 6): evidence streams, the sealed exam, the update action on a journal card, time-weighted scoring
# ---------------------------------------------------------------------------------------------------------------
import ref_update as RU  # noqa: E402  (an independent version of the Block 8 rules)
UPD_STEPS = {}
for _pool in ("practice", "exam"):
    for _s in synth.update_steps(_pool):
        UPD_STEPS.setdefault((f"{_s['lead']} {_s['ask']}", _s["news"], pct1(_s["prior"])), _s)
UPD_BY_ID = {s["id"]: s for s in synth.update_steps("practice") + synth.update_steps("exam")}


def upd_step(page):
    page.wait_for_selector("#news")
    key = (text(page, "#claim"), text(page, "#news"), text(page, "#prior"))
    return UPD_STEPS[key]


def advance_step(page, prev_news, prefixes=("#/psummary/", "#/pexam/")):
    page.wait_for_function("([prev, prefixes]) => { if (prefixes.some((p) => location.hash.startsWith(p))) return true; const n = document.getElementById('news'); const c = document.getElementById('claim'); const pr = document.getElementById('prior'); return !!n && !!c && !!pr && (c.textContent + '|' + n.textContent + '|' + pr.textContent) !== prev; }", arg=[prev_news, list(prefixes)], timeout=15000)


def play_updates(page, n, off_of, reveal=True, checks=None):
    """n update steps; off_of(i, step) -> points from the truth the player types (clamped to 0..100). Returns the steps and the guesses typed."""
    out = []
    for i in range(n):
        q = upd_step(page)
        prev_news = text(page, "#claim") + "|" + q["news"] + "|" + text(page, "#prior")
        g = min(100.0, max(0.0, q["truth"] + off_of(i, q)))
        page.fill("#pct-input", f"{g:g}")
        F.settle(page)
        page.click("#lock")
        if reveal:
            page.wait_for_selector("#verdict")
            if checks:
                checks(i, q, g)
            F.settle(page)
            page.click("#next")
        advance_step(page, prev_news)
        out.append((q, g))
    return out


def upd_points(q, g):
    miss = abs(g - q["truth"])
    return max(-100, round(100 * (1 - miss / 7))), miss <= 7 + 1e-9, abs(q["prior"] - q["truth"]) - miss


def phase_b8(E):
    """Unit 6: the stream steps, the exam, updating a journal card, time-weighted scores, against ref_update.py."""
    # -- closed until Unit 5 is passed -------------------------------------------------------------------------------------
    page = open_app(E, "2026-10-20", synth.u5_ready_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b8_closed.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#u5-card")
    check("before Unit 5 is passed there is no Unit 6 card on Today", page.query_selector("#u6-card") is None)
    go(page, "#/path")
    page.wait_for_selector("#pgate-U5-card")
    u6 = [li for li in page.query_selector_all(".units li") if "Unit 6" in (li.text_content() or "")]
    check("Unit 6 is Locked on the Path and has no cards", u6 and "Locked" in u6[0].text_content() and page.query_selector("#update-practice-card") is None and page.query_selector("#pgate-U6-card") is None)
    go(page, "#/prob/update")
    page.wait_for_function("location.hash === '#/today'", timeout=5000)
    check("opening the updating address while closed sends you back to Today", page.evaluate("location.hash") == "#/today")
    E.ctx.close()
    rc = synth.u5_ready_player(U1_EXAM, start=START)
    card0 = rc.prediction("2026-10-19", 0, 0.30, 0.50, due_option="month", text="By the end of November, the vendor will ship the release.")
    page = open_app(E, "2026-10-20", rc.write(os.path.join(E.tmp, "b8_closed2.jsonl")))
    go(page, f"#/journal/{card0['id']}")
    page.wait_for_selector(".claim")
    check("before Unit 6 is open an open card has no update action: a lock is final", page.query_selector("#update-card") is None and page.query_selector("textarea") is None and page.query_selector("input[type=range]") is None)
    E.ctx.close()

    # -- open: Today, the Path, the lesson cards ---------------------------------------------------------------------------
    base = synth.u5_passed_player(U1_EXAM, start=START)
    page = open_app(E, "2026-10-25", base.write(os.path.join(E.tmp, "b8_open.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#u6-card")
    check("Unit 6 is open: Today offers six update steps, none done", "6 update steps" in text(page, "#u6-line") and "0 of 30" in text(page, "#u6-line"), text(page, "#u6-line"))
    F.audit(E, "today with Unit 6")
    go(page, "#/path")
    page.wait_for_selector("#pgate-U6-card")
    check("the Path shows Unit 6 with three lesson cards, practice, and an exam that is not open yet",
          len(page.query_selector_all("#update-lessons-card .lesson-link")) == 3 and page.is_visible("#update-practice") and text(page, "#pgate-U6-status") == "Not open yet" and "30 practice" in text(page, "#pgate-U6-card"), text(page, "#pgate-U6-card")[:120])
    F.audit(E, "path with Unit 6")
    shot(E, "b8-path.png")
    go(page, "#/lesson/worth")
    page.wait_for_selector("#lesson-title")
    body = text(page, "main")
    import csv
    fl = list(csv.DictReader(open(os.path.join(synth.ROOT, "data", "question_tables", "flights.csv"), encoding="utf-8")))
    import datetime as _dt
    def late(rows): return len(rows), round(100.0 * sum(1 for x in rows if int(x["arrival_delay_min"]) >= 15) / len(rows) + 1e-9, 1)
    bwi = [x for x in fl if x["origin"] == "BWI"]
    ex = [late(bwi), late([x for x in bwi if int(x["departs"][11:13]) < 10]), late([x for x in bwi if _dt.datetime.strptime(x["departs"][:10], "%Y-%m-%d").weekday() < 5])]
    check("the worked example on 'How much is news worth' matches the flight record (Baltimore: 23.2% of 921, before 10: 8.5% of 246, weekday: 23.0% of 691)", ex == [(921, 23.2), (246, 8.5), (691, 23.0)] and all(t in body for t in ("23.2%", "921", "8.5%", "246", "23.0%", "691")), f"{ex}")
    F.audit(E, "updating lesson")
    go(page, "#/lesson/steps")
    page.wait_for_selector("#lesson-title")
    check("the first Unit 6 card names the exam: 40 fresh steps, 32 within 7", "40 fresh steps" in text(page, "main") and "32" in text(page, "main") and "Unit 6" in text(page, ".eyebrow"), text(page, "main")[:140])
    for _ in range(3):
        page.click("#lesson-done")
        page.wait_for_timeout(250)
    page.wait_for_function("location.hash === '#/path'", timeout=10000)
    check("three Unit 6 cards read are three lesson events", {"steps", "worth", "reason"} <= {e["lesson"] for e in of_type(page, "lesson")})

    # -- a practice session of six: prior, news, your number ---------------------------------------------------------------
    go(page, "#/prob/update")
    page.wait_for_selector("#news")
    q0 = upd_step(page)
    check("an update session opens: step 1 of 6, from the practice pool, with the prior, the news and a number to type, and no result in sight",
          text(page, ".cnt") == "1 of 6" and "Unit 6 practice" in text(page, "#mode-tag") and page.is_disabled("#lock") and q0["id"].endswith("#0") and text(page, "#prior") == pct1(q0["prior"]) and page.query_selector("#verdict") is None, q0["id"])
    F.audit(E, "update step")
    shot(E, "b8-step.png")
    page.fill("#pct-input", "abc")
    check("letters are refused", "numbers only" in text(page, "#pct-msg").lower() and page.is_disabled("#lock"))
    page.fill("#pct-input", "140")
    check("a number over 100 is refused", page.is_disabled("#lock"), text(page, "#pct-msg"))
    page.fill("#pct-input", "35")
    n_probs0 = len(of_type(page, "prob"))
    page.reload()
    page.wait_for_selector("#news")
    check("closing the page mid-step keeps the session open at the same step with nothing saved for it", text(page, ".cnt") == "1 of 6" and upd_step(page)["id"] == q0["id"] and len(of_type(page, "prob")) == n_probs0)

    seen = []

    def upd_checks(i, q, g):
        pts_, hit, gain = upd_points(q, g)
        ok = text(page, "#points") == signed(pts_) and (("Within 7" in text(page, "#verdict")) == hit)
        note = text(page, "#gain-note")
        ok2 = ("Moving helped" in note) if gain > 0.05 else ("Moving cost" in note) if gain < -0.05 else ("equally close" in note)
        seen.append(ok and ok2)
        if i == 0:
            check("the reveal shows the points, within 7 or not and what the move was worth as the independent rules give, with the counted fact", ok and ok2 and pct1(q["truth"]) in text(page, ".rl-key") and "Before the news" in text(page, ".answer"), f"{text(page, '#points')} vs {signed(pts_)}; {note}")
            F.audit(E, "update reveal")
            shot(E, "b8-reveal.png")
        if i == 1:
            check("step 2 of a stream starts from what step 1 revealed: its prior is step 1's truth", q["id"].endswith("#1") and q["prior"] == UPD_BY_ID[q["id"][:-1] + "0"]["truth"], q["id"])

    offs = [3.0, -9.0, 0.0, 6.0, -2.0, 12.0]
    done = play_updates(page, 6, lambda i, q: offs[i], checks=upd_checks)
    check("all six reveals showed the independent points, verdict and gain note", len(seen) == 6 and all(seen), str(seen))
    check("steps come in pairs: 1 and 2 of one stream, then the next", [q["id"][-2:] for q, _ in done] == ["#0", "#1"] * 3 and done[0][0]["stream"] == done[1][0]["stream"] and done[0][0]["stream"] != done[2][0]["stream"])
    page.wait_for_function("location.hash.startsWith('#/psummary/')", timeout=10000)
    probs = of_type(page, "prob", mode="practice", family="update")
    check("six update steps were saved with the numbers the independent rules give (guess, truth, prior, within, points, gain, move)", len(probs) == 6 and all(
        near(p["guess"], g, 1e-9) and near(p["truth"], q["truth"], 1e-9) and near(p["prior"], q["prior"], 1e-9) and p["hit"] == upd_points(q, g)[1] and p["points"] == upd_points(q, g)[0] and near(p["gain"], upd_points(q, g)[2], 1e-6) and near(p["moved"], g - q["prior"], 1e-6) and p["unit"] == "U6" and p["q"] == q["id"]
        for p, (q, g) in zip(probs, done)), str([(p["points"], upd_points(q, g)[0]) for p, (q, g) in zip(probs, done)]))
    hits = sum(1 for q, g in done if upd_points(q, g)[1])
    check("the summary says how many were within 7 and the points total", f"{hits} of 6" in text(page, "#ps-head") and text(page, "#sum-points") == signed(sum(upd_points(q, g)[0] for q, g in done)), f"{text(page, '#ps-head')} {text(page, '#sum-points')}")
    F.audit(E, "update summary")
    go(page, "#/mirror")
    page.wait_for_selector("#reasoning-record")
    rs = text(page, "#rs-table")
    mg = sum(upd_points(q, g)[2] for q, g in done) / 6
    check("the Mirror shows update steps within 7 and the gain over staying put as the independent rules give", f"{hits} of 6" in rs and f"{abs(mg):.1f} pts" in rs and "Gain over staying put" in rs, rs[:300])
    F.audit(E, "mirror updating")
    E.ctx.close()

    # -- the Unit 6 exam: sealed sittings, a verdict that reads within 7 and the average gain ----------------------------------------
    r6 = synth.u6_ready_player(U1_EXAM, start=START)
    day = "2026-10-25"
    page = open_app(E, day, r6.write(os.path.join(E.tmp, "b8_u6.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#need-pexam-U6")
    check("Today lists the Unit 6 exam as ready", "40 fresh problems" in text(page, "#need-pexam-U6"), text(page, "#need-pexam-U6"))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U6-start")
    check("the Path says the exam is Ready: 40 fresh update steps in 2 sittings of 20, 32 within 7", text(page, "#pgate-U6-status") == "Ready" and "2 sittings of 20" in text(page, "#pgate-U6-card") and "32 of 40" in text(page, "#pgate-U6-card"), text(page, "#pgate-U6-card")[:200])
    F.audit(E, "path with Unit 6 exam")
    page.click("#pgate-U6-start")
    page.wait_for_selector("#news")
    q = upd_step(page)
    check("the exam opens at 1 of 20, sitting 1 of 2, from the exam pool", text(page, ".cnt") == "1 of 20" and "sitting 1 of 2" in text(page, "#mode-tag") and q["id"] in {s["id"] for s in synth.update_steps("exam")}, q["id"])
    start_ev = [e for e in of_type(page, "exam", state="start") if e.get("unit") == "U6"]
    check("starting wrote a Unit 6 attempt of 40", len(start_ev) == 1 and start_ev[0]["n"] == 40)
    off1 = lambda i, q: 12.0 if i % 8 == 0 else 3.0  # noqa: E731
    sit1 = play_updates(page, 20, off1, reveal=False)
    page.wait_for_function("location.hash.startsWith('#/pexam/')", timeout=20000)
    page.wait_for_selector("#pexam-sealed")
    body = text(page, "main").lower()
    check("between sittings nothing is shown about the answers", page.query_selector("#pexam-verdict") is None and "within 7" not in body and "gain" not in body and "20 of 40" in body, text(page, "#pexam-sealed")[:160])
    F.audit(E, "update exam sealed")
    check("the saved answers are 20 sealed problems", len(of_type(page, "prob", mode="exam", family="update")) == 20)
    page.click("#pexam-next")
    page.wait_for_selector("#news")
    used1 = {s["stream"] for s, _ in sit1}
    q2 = upd_step(page)
    check("sitting 2 opens at 1 of 20 and never repeats a stream from sitting 1", text(page, ".cnt") == "1 of 20" and "sitting 2 of 2" in text(page, "#mode-tag") and q2["stream"] not in used1, q2["id"])
    sit2 = play_updates(page, 20, off1, reveal=False)
    page.wait_for_function("location.hash.startsWith('#/pexam/')", timeout=20000)
    page.wait_for_selector("#pexam-verdict")
    allp = sit1 + sit2
    w = sum(1 for q, g in allp if upd_points(q, g)[1])
    gain = sum(upd_points(q, g)[2] for q, g in allp) / 40
    want_pass = w >= 32 and gain >= 0
    check("the verdict is the independent one: within 7, average gain, pass", text(page, "#pexam-hits") == str(w) and (text(page, "#pexam-verdict") == "Passed") == want_pass and f"{gain:+.1f} pts" == text(page, "#pexam-miss"), f"{text(page, '#pexam-hits')}/{w} {text(page, '#pexam-verdict')} {text(page, '#pexam-miss')}/{gain:.2f}")
    res = [e for e in of_type(page, "exam", state="result") if e.get("unit") == "U6"]
    check("one Unit 6 result event with n=40, the within count, the mean gain and the pass", len(res) == 1 and res[0]["n"] == 40 and res[0]["hits"] == w and res[0]["pass"] == want_pass and near(res[0]["meanGain"], gain, 1e-6), str(res[:1])[:200])
    F.audit(E, "update exam verdict")
    shot(E, "b8-exam.png")
    E.ctx.close()

    # -- a failed exam says which half failed, and a repair drill follows -------------------------------------------------------------
    rf = synth.u6_ready_player(U1_EXAM, start=START)
    xsteps = synth.update_steps("exam")
    att = rf._add("exam", "2026-10-24", 5, state="start", unit="U6", n=40)["id"]
    for k in range(2):
        sid = synth.prob_session(rf, "2026-10-24", 10 + 30 * k, "update", "U6", [s["id"] for s in xsteps[k * 20:(k + 1) * 20]], mode="exam", exam=att, n=k + 1, of=2)
        for i, s in enumerate(xsteps[k * 20:(k + 1) * 20]):
            synth.prob_update(rf, sid, "2026-10-24", 11 + 30 * k + i, s, off=12.0 * (1 if s["truth"] >= s["prior"] else -1), mode="exam", exam=att)  # 12 points past the truth, away from the prior
        synth.prob_end(rf, sid, "2026-10-24", 40 + 30 * k)
    page = open_app(E, "2026-10-25", rf.write(os.path.join(E.tmp, "b8_fail.jsonl")))
    go(page, f"#/pexam/{att}")
    page.wait_for_selector("#pexam-verdict")
    fails = sum(1 for e in of_type(page, "prob", mode="exam", family="update") if not e["hit"])
    reasons = text(page, "#pexam-reasons")
    check("a failed exam says Not passed and names why: too few within 7 and a negative gain", text(page, "#pexam-verdict") == "Not passed this time" and "within 7 points" in reasons and "further from the truth" in reasons and fails >= 9, reasons[:260])
    check("it offers the repair drill of 10 steps", "10 problems" in reasons and "repair-U6" in (page.get_attribute("#pexam-after", "href") or ""))
    F.audit(E, "update exam failed")
    page.click("#pexam-after")
    page.wait_for_selector("#news")
    check("the repair drill is a session of 10 update steps tagged Repair drill", text(page, ".cnt") == "1 of 10" and "Repair drill" in text(page, "#mode-tag"), text(page, "#mode-tag"))
    E.ctx.close()

    # -- updating an open journal card ---------------------------------------------------------------------------------------
    ju = synth.u6_ready_player(U1_EXAM, start=START)
    card = ju.prediction("2026-10-23", 0, 0.30, 0.50, due_option="month", text="By the end of November, the vendor will ship the new release.")
    page = open_app(E, "2026-10-25", ju.write(os.path.join(E.tmp, "b8_j.jsonl")))
    go(page, f"#/journal/{card['id']}")
    page.wait_for_selector("#update-card")
    check("an open card has an Update card: the number in force, the tripwire as a prompt, a slider and a reason box", "30%" in text(page, "#update-card") and "What would change my mind" in text(page, "#update-tripwire") and "Has that happened" in text(page, "#update-tripwire") and page.query_selector("#update-reason") is not None, text(page, "#update-card")[:200])
    F.audit(E, "journal update card")
    shot(E, "b8-update.png")
    F.settle(page)
    page.click("#update-go")
    check("updating without moving the slider is refused, and nothing is saved", "already in force" in text(page, "#update-msg") and not of_type(page, "update"))
    page.evaluate("(v) => { const e = document.getElementById('update-prob'); e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", 70)
    check("moving the slider shows the move from the number in force", "Up 40 points from 30%" in text(page, "#update-move") and text(page, "#update-readout") == "70%", text(page, "#update-move"))
    F.settle(page)
    page.click("#update-go")
    check("an update without a reason is refused", "what changed your mind" in text(page, "#update-msg").lower() and not of_type(page, "update"), text(page, "#update-msg"))
    page.fill("#update-reason", "The vendor confirmed the date in writing.")
    F.settle(page)
    page.click("#update-go")
    page.wait_for_selector("#update-history")
    ups = of_type(page, "update")
    check("the update is saved with the card, the new number, the one it replaced and the reason", len(ups) == 1 and ups[0]["prediction"] == card["id"] and near(ups[0]["c"], 0.70) and near(ups[0]["prev"], 0.30) and ups[0]["reason"].startswith("The vendor confirmed"), str(ups))
    check("the card now shows the locked number and the number in force, and the history lists the reason", "locked 30%" in text(page, "#update-history") and "now 70%" in text(page, "#update-history") and "The vendor confirmed" in text(page, "#update-history") and "Now 70%" in text(page, "main"), text(page, "#update-history")[:160])
    check("the locked prediction event itself is untouched", [e for e in of_type(page, "prediction") if e["id"] == card["id"]][0]["c"] == 0.30)
    go(page, "#/mirror")
    page.wait_for_selector("#reasoning-record")
    check("the Mirror counts the card updated with a reason, against the 12 the unit asks for", "Open or resolved cards updated with a reason" in text(page, "#rs-table") and "of 12" in text(page, "#rs-table"), text(page, "#rs-table")[:300])
    E.ctx.close()

    # -- a card scored over its life: the daily forecast in force, time-weighted ------------------------------------------------------
    jr = synth.u6_ready_player(U1_EXAM, start=START)
    card2 = jr.prediction("2026-10-12", 0, 0.30, 0.50, due_option="week", text="By next Monday, the committee will approve the budget.")
    jr.update(card2, "2026-10-14", 0, 0.70, 0.30, "A member said it will pass.")
    jr.update(card2, "2026-10-16", 0, 0.50, 0.70, "The vote moved to a later date.")
    page = open_app(E, "2026-10-20", jr.write(os.path.join(E.tmp, "b8_r.jsonl")))
    go(page, f"#/journal/{card2['id']}")
    page.wait_for_selector("#resolve")
    page.click(".pick >> text=Happened")
    F.settle(page)
    page.click("#resolve")
    page.wait_for_selector("#lens-what")
    rs_ev = [e for e in of_type(page, "resolve") if e["prediction"] == card2["id"]][0]
    # the independent version: days 12th to 20th, the number in force each day
    seq = [0.30, 0.30, 0.70, 0.70, 0.50, 0.50, 0.50, 0.50, 0.50]
    raws = [RU.brier(c, True) for c in seq]
    edges = [RU.W * (r - RU.brier(0.50, True)) for r in raws]
    check("the resolve event holds the time-weighted raw and edge, the locked number's own score, and the days", near(rs_ev["raw"], sum(raws) / 9, 1e-9) and near(rs_ev["edge"], sum(edges) / 9, 1e-9) and near(rs_ev["raw0"], RU.brier(0.30, True), 1e-9) and near(rs_ev["edge0"], RU.W * (RU.brier(0.30, True) - RU.brier(0.50, True)), 1e-9) and rs_ev["days"] == 9, str({k: rs_ev.get(k) for k in ("raw", "edge", "raw0", "edge0", "days")}))
    gain = sum(edges) / 9 - RU.W * (RU.brier(0.30, True) - RU.brier(0.50, True))
    check("the case file lists the updates and says what they added", "A member said it will pass." in text(page, "#what-updates") and "added" in text(page, "#luck-updates") and f"added {abs(round(gain))}" in text(page, "#luck-updates") and "9 days" in text(page, "#luck-updates"), text(page, "#luck-updates"))
    F.audit(E, "case file with updates")
    shot(E, "b8-casefile.png")
    go(page, "#/mirror")
    page.wait_for_selector("#reasoning-record")
    check("the Mirror says what the updates added on resolved cards", "What your updates added" in text(page, "#rs-table"), text(page, "#rs-table")[:300])
    E.ctx.close()


def phase_b9(E):
    """Units 7 to 9: choice problems, the memory check that hides the record, decision cards and their reviews."""
    # -- closed until Unit 6 is passed -----------------------------------------------------------------------------------
    page = open_app(E, "2026-11-20", synth.u5_passed_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b9_closed.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#u6-card")
    check("before Unit 6 is passed there is no Unit 7 card on Today", page.query_selector("#u7-card") is None)
    go(page, "#/prob/counter")
    page.wait_for_function("location.hash === '#/today'", timeout=5000)
    check("opening the counter-argument address while closed sends you back to Today", page.evaluate("location.hash") == "#/today")
    go(page, "#/recall/practice")
    page.wait_for_timeout(300)
    check("the recall practice is closed too until Unit 8 is open", page.evaluate("location.hash") == "#/today" or page.query_selector("#recall-input") is None)
    E.ctx.close()

    # -- Unit 7 open: a practice session of choice problems ------------------------------------------------------------------
    page = open_app(E, "2026-11-20", synth.u6_passed_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b9_u7.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#u7-card")
    check("Unit 7 is open: Today has its card and no Unit 8 card", page.query_selector("#u8-card") is None, text(page, "#u7-card")[:120])
    F.audit(E, "today with Unit 7")
    go(page, "#/prob/counter")
    page.wait_for_selector("#choices")
    n_opts = len(page.query_selector_all("#choices .choice"))
    check("a counter-argument problem shows a question and 3 or more options, with no answer in sight", n_opts >= 3 and page.query_selector(".right") is None, str(n_opts))
    F.audit(E, "choice problem")
    shot(E, "b9-choice.png")
    seen = []
    for i in range(6):
        page.wait_for_selector("#choices")
        page.wait_for_timeout(450)
        page.click("#choice-0")
        page.click("#lock")
        page.wait_for_selector("#choice-rows", timeout=5000)
        seen.append(len(page.query_selector_all("#choice-rows li.right")))
        if i == 0:
            F.audit(E, "choice reveal")
            shot(E, "b9-choice-reveal.png")
        nxt = page.query_selector("#next")
        if nxt:
            page.wait_for_timeout(450)
            nxt.click()
        page.wait_for_timeout(120)
    page.wait_for_function("location.hash.startsWith('#/psummary/') || location.hash.startsWith('#/summary/')", timeout=10000)
    probs = of_type(page, "prob")
    check("six choice problems were saved as prob events of unit U7", len(probs) >= 6 and all(p.get("unit") == "U7" for p in probs[-6:]), str(len(probs)))
    check("each reveal marked exactly one option as the right one", seen and all(x == 1 for x in seen), str(seen))
    E.ctx.close()

    # -- Unit 8 open: a due card asks the memory check before it shows the record --------------------------------------------
    r = synth.u7_passed_player(U1_EXAM, start=START)
    card = r.prediction("2026-11-08", 0, 0.83, 0.5, text="By 15 November, the vendor will ship the release.")
    old = r.prediction("2026-11-18", 0, 0.62, 0.5, due_option="month", text="By the end of December, the report will be done.")
    page = open_app(E, "2026-11-20", r.write(os.path.join(E.tmp, "b9_u8.jsonl")))
    go(page, f"#/journal/{card['id']}")
    page.wait_for_selector("#memory-card")
    body = text(page, "main")
    check("a due card asks what you said first and does not show the number you locked", "83" not in body and "The record stays hidden" in body and page.query_selector("#resolve-card") is None, body[:160])
    F.audit(E, "memory check on a due card")
    shot(E, "b9-memory.png")
    page.fill("#recall-input", "abc")
    check("letters are refused", page.is_disabled("#recall-lock"))
    page.fill("#recall-input", "120")
    check("a number over 99 is refused", page.is_disabled("#recall-lock"), text(page, "#recall-msg"))
    page.fill("#recall-input", "70")
    page.wait_for_timeout(450)
    page.click("#recall-lock")
    page.wait_for_selector("#memory-note", timeout=5000)
    mem = of_type(page, "memory")
    check("the answer is saved with what was recorded", len(mem) == 1 and mem[0]["src"] == "card" and near(mem[0]["recalled"], 0.70) and near(mem[0]["recorded"], 0.83), str(mem))
    check("after the answer the record is shown, with the gap", "70%" in text(page, "#memory-note") and "83%" in text(page, "main"), text(page, "#memory-note"))
    go(page, f"#/journal/{old['id']}")
    page.wait_for_selector(".claim")
    check("a card that is not due yet shows no memory check", page.query_selector("#memory-card") is None)

    # -- the recall practice on old gym calls ----------------------------------------------------------------------------------
    go(page, "#/today")
    page.wait_for_selector("#recall-card")
    F.audit(E, "today with recall")
    go(page, "#/recall/practice")
    page.wait_for_selector("#recall-input")
    shown = text(page, "main")
    check("a recall check asks how sure you were and keeps the record hidden", "The record stays hidden" in shown and page.query_selector("#recall-note") is None)
    F.audit(E, "recall practice")
    page.fill("#recall-input", "75")
    page.wait_for_timeout(450)
    page.click("#recall-lock")
    page.wait_for_selector("#recall-note", timeout=5000)
    mem = of_type(page, "memory")
    check("a recall answer is saved as a call memory", mem[-1]["src"] == "call" and near(mem[-1]["recalled"], 0.75) and 0.5 <= mem[-1]["recorded"] <= 0.99, str(mem[-1]))
    check("the reveal says what was said and which way memory moved", "You said" in text(page, "main") and "remembered 75%" in text(page, "#recall-note"), text(page, "#recall-note"))

    # -- decision cards: closed until Unit 8 is passed, then lock, wait, review on the date ------------------------------------------
    go(page, "#/decide")
    page.wait_for_function("location.hash === '#/path'", timeout=5000)
    check("the decision cards are closed until Unit 8 is passed", page.evaluate("location.hash") == "#/path")
    E.ctx.close()
    page = open_app(E, "2026-11-20", synth.u8_passed_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b9_u9.jsonl")))
    go(page, "#/decide/new")
    page.wait_for_selector("#decision-text")
    page.fill("#decision-text", "Move the launch to March.")
    page.fill("#decision-option", "Move it")
    page.fill("#decision-p", "70")
    page.fill("#decision-gain", "30")
    page.fill("#decision-loss", "10")
    page.wait_for_timeout(100)
    line = text(page, "#decision-line")
    check("the card shows the break-even from the stakes (10 / 40 = 25%) and what the line says", "25%" in line and "act" in line, line)
    F.audit(E, "new decision")
    shot(E, "b9-decision-new.png")
    page.click(".picker button:has-text('Act')")
    page.wait_for_timeout(450)
    page.click("#decision-lock")
    page.wait_for_selector("#decision-numbers", timeout=5000)
    dec = of_type(page, "decision")
    check("the decision is saved with its threshold and rule", len(dec) == 1 and near(dec[0]["threshold"], 0.25) and dec[0]["rule"] == "act" and near(dec[0]["p"], 0.70), str(dec))
    check("an open decision waits for its date", page.query_selector("#decision-wait") is not None and page.query_selector("#review-go") is None)
    E.ctx.close()

    rr = synth.u8_passed_player(U1_EXAM, start=START)
    rr._add("decision", "2026-11-05", 0, text="Hire a second analyst.", option="Hire", p=0.6, gain=30, loss=20, threshold=0.4, rule="act", choice="hold", review="2026-11-19")
    rr._add("decision", "2026-11-06", 0, text="Switch the vendor.", option="Switch", p=0.3, gain=10, loss=10, threshold=0.5, rule="hold", choice="hold", review="2026-12-20")
    page = open_app(E, "2026-11-20", rr.write(os.path.join(E.tmp, "b9_dec.jsonl")))
    go(page, "#/decide")
    page.wait_for_selector("#decision-new")
    items = page.query_selector_all(".lesson-link")
    check("the list shows both cards", len(items) >= 2, str(len(items)))
    go(page, "#/today")
    page.wait_for_selector("#needs")
    check("a decision whose date has come is listed as needing you, the later one is not", len(page.query_selector_all("[id^=need-decision-]")) == 1)
    dec = [e for e in of_type(page, "decision") if e["text"].startswith("Hire")][0]
    go(page, f"#/decide/{dec['id']}")
    page.wait_for_selector("#decision-review-card")
    F.audit(E, "decision review")
    check("a due decision asks what happened", page.query_selector("#review-outcome") is not None and page.query_selector("#review-again") is not None)
    page.click("#review-outcome [data-value=no]")
    page.click("#review-again [data-value=same]")
    page.wait_for_timeout(450)
    page.click("#review-go")
    page.wait_for_selector("#decision-result", timeout=5000)
    rev = of_type(page, "decision_review")
    check("the review is saved", len(rev) == 1 and rev[0]["outcome"] == "no" and rev[0]["again"] == "same", str(rev))
    check("value of your choice (hold = 0) and of the line (act, no = -20) are shown", "0" in text(page, "#decision-value") and "20" in text(page, "#decision-value"), text(page, "#decision-value"))
    go(page, "#/mirror")
    page.wait_for_selector("#know-record")
    check("the Mirror shows a Knowing yourself table once there is a decision or a memory check", "Knowing yourself" in text(page, "#know-record") and page.query_selector("#know-table") is not None, text(page, "#know-record")[:140])
    F.audit(E, "mirror with Block 9")
    go(page, "#/help")
    page.wait_for_selector(".prose")
    check("the Help screen explains Units 7 to 9", "Knowing yourself" in text(page, "main") and "break-even" in text(page, "main"))
    E.ctx.close()


TAILS = {q["claim"]: q for q in json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "tails.json"), encoding="utf-8"))["questions"]}


def set_dial(page, k):
    page.evaluate("(v) => { const i = document.getElementById('dial'); i.value = String(v); i.dispatchEvent(new Event('input')); }", k)


def fine_call_ui(page, c_pct, truthful=True, side=None):
    """Answer the fine question on screen: the side the base rate favours (or `side`), at c_pct percent, by the dial itself."""
    page.wait_for_selector("#claim")
    q = TAILS[text(page, "#claim")]
    s = side or ("yes" if q["base"] >= 0.5 else "no")
    set_dial(page, (c_pct - 50) * (1 if s == "yes" else -1))
    page.wait_for_timeout(450)
    page.click("#lock")
    return q, s


def phase_b10(E):
    """Unit 10: the 1% dial under the sharp rule, tail questions, the sealed 400-call exam, the round-number drill (L14)."""
    # -- closed until Unit 9 is passed ----------------------------------------------------------------------------------------
    page = open_app(E, "2026-11-25", synth.u8_passed_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b10_closed.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#needs, .stat")
    check("before Unit 9 is passed there is no Unit 10 card on Today", page.query_selector("#u10-card") is None)
    go(page, "#/fine")
    page.wait_for_function("location.hash === '#/today'", timeout=5000)
    check("opening the fine-grain address while closed sends you back to Today", page.evaluate("location.hash") == "#/today")
    E.ctx.close()

    # -- open: Today, Path, the dial, one call --------------------------------------------------------------------------------
    r = synth.u9_passed_player(U1_EXAM, start=START)
    page = open_app(E, "2026-11-25", r.write(os.path.join(E.tmp, "b10_open.jsonl")))
    go(page, "#/today")
    page.wait_for_selector("#u10-card")
    check("Unit 10 is open: Today has its card with 0 of 84", "0 of 84" in text(page, "#u10-count"), text(page, "#u10-card")[:120])
    F.audit(E, "today with Unit 10")
    go(page, "#/path")
    page.wait_for_selector("#pgate-U10-card")
    check("the Path shows Unit 10 with three lesson cards, practice and an exam not open yet", len(page.query_selector_all("#fine-lessons-card .lesson-link")) == 3 and text(page, "#pgate-U10-status") == "Not open yet" and page.is_visible("#fine-practice"), text(page, "#pgate-U10-card")[:100])
    F.audit(E, "path with Unit 10")
    go(page, "#/lesson/sharp")
    page.wait_for_selector("#lesson-title")
    body = text(page, "main")
    check("the sharp-rule card gives the payout table's own numbers (99% right +99, 99% wrong -564)", "99" in body and "564" in body and "Unit 10" in text(page, ".eyebrow"), body[:160])
    F.audit(E, "sharp lesson")
    go(page, "#/fine")
    page.wait_for_selector("#dial")
    mn, mx = page.get_attribute("#dial", "min"), page.get_attribute("#dial", "max")
    check("the dial has 1% steps: 49 on each side of a toss-up", (mn, mx) == ("-49", "49") and page.query_selector("#dial-up") is not None and page.query_selector("#dial-down") is not None, str((mn, mx)))
    check("a fine session opens: 1 of 14, tagged Unit 10 practice", text(page, ".cnt") == "1 of 14" and "Unit 10 practice" in text(page, "#mode-tag"), text(page, ".cnt"))
    F.audit(E, "fine question")
    shot(E, "b10-question.png")
    for _ in range(13):
        page.click("#dial-up")
    check("thirteen taps on +1 from a toss-up make 63% Yes, and the payouts shown are the sharp rule's", "63%" in text(page, "main") and signed(synth.sharp_pts(0.63, True)) in text(page, ".pay") and signed(synth.sharp_pts(0.63, False)) in text(page, ".pay"), text(page, ".pay"))
    page.wait_for_timeout(450)
    page.click("#lock")
    page.wait_for_selector("#verdict", timeout=5000)
    ev = of_type(page, "call")[-1]
    check("the call is saved on the 1% dial: fine, unit U10, 63%, sharp points, core points and the log rule", ev.get("fine") is True and ev["unit"] == "U10" and near(ev["c"], 0.63) and ev["rule"] == "log_points" and ev["points"] == synth.sharp_pts(0.63, ev["hit"]) and ev["core"] == synth.pts(0.63) if ev["hit"] else ev["core"] == synth.pts(1 - 0.63), str(ev))
    check("the reveal shows the sharp points and what the base rate alone would have scored", text(page, "#points") == signed(ev["points"]) and "base rate" in text(page, "#base-compare"), text(page, "#base-compare"))
    F.audit(E, "fine reveal")
    shot(E, "b10-reveal.png")
    for i in range(13):
        page.wait_for_timeout(450)
        page.click("#next")
        page.wait_for_selector("#claim, #sum-points", timeout=5000)
        if page.query_selector("#sum-points"):
            break
        fine_call_ui(page, 96 if i % 2 else 97)
        page.wait_for_selector("#verdict", timeout=5000)
    page.wait_for_timeout(450)
    if page.query_selector("#next"):
        page.click("#next")
    page.wait_for_selector("#sum-points", timeout=8000)
    sess_calls = [c for c in of_type(page, "call") if c.get("fine")]
    total = sum(c["points"] for c in sess_calls)
    check("the session summary is in sharp points and counts the multiples of ten", len(sess_calls) == 14 and text(page, "#sum-points") == signed(total) and re.fullmatch(r"\d+ of 14", text(page, "#sum-round")), f"{text(page, '#sum-points')} vs {signed(total)}")
    F.audit(E, "fine summary")
    go(page, "#/today")
    page.wait_for_selector("#u10-card")
    check("Today counts the 14 fine calls toward the 84", "14 of 84" in text(page, "#u10-count"), text(page, "#u10-count"))
    stat = text(page, "#stat-points")
    core_sum = sum(c["core"] for c in of_type(page, "call") if c.get("mode") in ("practice", "baseline", "exam", "drill") and c.get("core") is not None)
    check("the points on Today never swing on the sharp rule: fine calls count at the core rule", abs(int(stat.replace("\u2212", "-").replace("+", "")) - sum((c["core"] if c.get("fine") else c["points"]) for c in of_type(page, "call"))) <= 1, f"{stat}")
    E.ctx.close()

    # -- the exam: 84 practice calls made; sittings of 20, sealed; the last sitting gives the verdict -------------------------
    r = synth.u10_ready_player(U1_EXAM, start=START)
    page = open_app(E, "2026-11-25", r.write(os.path.join(E.tmp, "b10_ready.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U10-card")
    check("with 84 practice calls the exam card says Ready", text(page, "#pgate-U10-status") == "Ready" and page.query_selector("#fine-exam-start") is not None, text(page, "#pgate-U10-card")[:120])
    go(page, "#/fine/exam")
    page.wait_for_selector("#dial")
    check("an exam sitting is sealed: sitting 1 of 20, no result shown", "Exam" in text(page, "#mode-tag") and "sitting 1 of 20" in text(page, "#mode-tag") and text(page, ".cnt") == "1 of 20")
    q, _ = fine_call_ui(page, 96)
    page.wait_for_function("document.querySelector('.cnt') && document.querySelector('.cnt').textContent === '2 of 20'", timeout=5000)
    check("an exam call shows no reveal: the next question follows at once", page.query_selector("#verdict") is None and text(page, ".cnt") == "2 of 20")
    for i in range(19):
        page.wait_for_function("document.querySelector('.cnt') && document.querySelector('.cnt').textContent === '%d of 20' || location.hash.startsWith('#/fexam/')" % (i + 2), timeout=5000)
        if page.evaluate("location.hash").startswith("#/fexam/"):
            break
        fine_call_ui(page, 96)
        page.wait_for_timeout(120)
    page.wait_for_selector("#fexam-progress", timeout=8000)
    check("after 20 calls the exam screen shows only the sealed progress: 20 of 400", "20 of 400" in text(page, "#fexam-progress") and page.query_selector("#fexam-verdict") is None, text(page, "#fexam-progress"))
    exam_calls = [c for c in of_type(page, "call") if c.get("mode") == "exam" and c.get("unit") == "U10"]
    check("the 20 exam calls are saved on the fine dial and carry the exam id", len(exam_calls) == 20 and all(c.get("fine") and c.get("exam") for c in exam_calls), str([(c.get("mode"), c.get("fine"), c.get("exam")) for c in exam_calls][:3]) + str(len(exam_calls)))
    E.ctx.close()
    verdict_player(E, True)
    verdict_player(E, False)

    # -- L14: the round-number habit and its drill ------------------------------------------------------------------------------
    r = synth.u9_passed_player(U1_EXAM, start=START)
    qs = synth._tails("practice")[:100]
    day0 = "2026-09-20"
    for k in range(5):
        sub = qs[k * 20:(k + 1) * 20]
        synth.fine_session(r, synth.add_days(day0, k), 0, sub, [[0.9, 0.8, 0.7, 0.6, 0.5][j % 5] for j in range(20)], honest=True)
    page = open_app(E, "2026-11-25", r.write(os.path.join(E.tmp, "b10_l14.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U10-card")
    page.wait_for_selector("#patterns")
    check("100 fine calls on multiples of ten open the round-number pattern", "Round-number habit" in text(page, "#patterns"), text(page, "#patterns")[:120])
    flag = [e for e in read_events(page) if e["type"] == "flag" and e.get("trigger") == "L14" and e.get("state") == "open"]
    check("one L14 flag was written, with the share in its evidence", len(flag) == 1 and flag[0]["evidence"]["share"] == 1.0, str(flag[:1]))
    go(page, f"#/flag/{flag[0]['id']}")
    page.wait_for_selector("main")
    body = text(page, "main")
    check("the flag screen says what it saw and what the re-tests ask", "multiple of ten" in body and "100 calls on the 1% dial" in body, body[:200])
    F.audit(E, "L14 flag")
    go(page, f"#/fine/drill-{flag[0]['id']}")
    page.wait_for_selector("#dial")
    check("the drill is 20 calls and tagged Drill", text(page, ".cnt") == "1 of 20" and "Drill" in text(page, "#mode-tag"))
    for _ in range(10):
        page.click("#dial-up")
    check("a multiple of ten (60%) is locked in the drill: the hint shows and Lock waits", page.is_visible("#dial-hint") and page.is_disabled("#lock"), text(page, "#dial-hint"))
    page.click("#dial-up")
    check("61% is allowed", not page.is_disabled("#lock") and not page.is_visible("#dial-hint"))
    F.audit(E, "L14 drill")
    E.ctx.close()

    # -- several outcomes: three or four chances adding up to 100, scored by the log rule -------------------------------------
    import math as _m
    multi = json.load(open(os.path.join(synth.ROOT, "app", "content", "questions", "multi.json"), encoding="utf-8"))["questions"]
    by_id = {q["id"]: q for q in multi}
    r = synth.u9_passed_player(U1_EXAM, start=START)
    page = open_app(E, "2026-11-25", r.write(os.path.join(E.tmp, "b10_multi.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#multi-card")
    check("the Path has the several-outcomes card with 0 answered", "0 answered" in text(page, "#multi-count"), text(page, "#multi-card")[:100])
    go(page, "#/multi")
    page.wait_for_selector("#multi-0")
    qid = None
    lead = text(page, "#multi-lead")
    q = next(x for x in multi if x["lead"] == lead)
    k = len(q["outcomes"])
    check("a question shows its lead, its ask and one box for each outcome", k in (3, 4) and len(page.query_selector_all("input.field.num")) == k and text(page, "#multi-ask") == q["ask"], lead)
    check("Lock waits while the boxes are empty", page.is_disabled("#multi-lock"))
    F.audit(E, "multi question")
    shot(E, "b10-multi.png")
    # 40/30/20: a three-outcome sum of 90 is refused with the total shown; a four-outcome pad is filled to reach 100
    base = [60, 30, 10] if k == 3 else [50, 25, 15, 10]
    for i, v in enumerate(base[:-1]):
        page.fill(f"#multi-{i}", str(v))
    page.fill(f"#multi-{k - 1}", str(base[-1] - 5))
    check("a total of 95 shows the total and an error and keeps Lock off", text(page, "#multi-total") == "95%" and "add up" in text(page, "#multi-msg") and page.is_disabled("#multi-lock"), text(page, "#multi-msg"))
    page.fill(f"#multi-{k - 1}", "0")
    page.fill(f"#multi-0", str(base[0] + base[-1]))
    check("an outcome at 0% is refused", "at least 1" in text(page, "#multi-msg") and page.is_disabled("#multi-lock"), text(page, "#multi-msg"))
    for i, v in enumerate(base):
        page.fill(f"#multi-{i}", str(v))
    check("a total of exactly 100 turns the total to 100% and opens Lock", text(page, "#multi-total") == "100%" and not page.is_disabled("#multi-lock"))
    page.wait_for_timeout(450)
    page.click("#multi-lock")
    page.wait_for_selector("#multi-result", timeout=5000)
    ev = of_type(page, "multi")[-1]
    want = round(100 * _m.log2(k * base[q["truth"]] / 100) / _m.log2(k))
    wref = round(100 * _m.log2(k * max(q["ref"][q["truth"]], 0.01)) / _m.log2(k))
    check("the answer is saved as a multi event with the percents, the truth and both scores", ev["q"] == q["id"] and ev["p"] == base and ev["truth"] == q["truth"] and ev["points"] == want and abs(ev["refPoints"] - wref) <= 1 and ev["unit"] == "U10", str(ev))
    check("the reveal shows your points, the record's points and the truth row", text(page, "#multi-points") == signed(want) and "what happened" in text(page, f"#multi-row-{q['truth']}") and "record" in text(page, "#multi-row-0"), text(page, "#multi-result")[:160])
    check("the other rows do not say what happened", all("what happened" not in text(page, f"#multi-row-{i}") for i in range(k) if i != q["truth"]))
    F.audit(E, "multi reveal")
    page.wait_for_timeout(450)
    page.click("#multi-next")
    page.wait_for_selector("#multi-0", timeout=5000)
    check("the next question is a different one", text(page, "#multi-lead") != lead)
    go(page, "#/path")
    page.wait_for_selector("#multi-card")
    check("the card now counts one answer and gives the average", "1 answered" in text(page, "#multi-count") and "average" in text(page, "#multi-mean"), text(page, "#multi-card")[:120])
    E.ctx.close()


def verdict_player(E, want_pass):
    """The last sitting of the 400-call exam: 380 sealed calls are on file, the player makes 20 more, and the verdict follows."""
    r = synth.u10_ready_player(U1_EXAM, start=START)
    pool = synth._tails("exam")
    att = r._add("exam", "2026-11-12", 0, state="start", unit="U10", n=400)["id"]
    for k in range(19):
        sub = pool[k * 20:(k + 1) * 20]
        sid = r._add("session", synth.add_days("2026-11-12", k // 3), 10 + k * 40, mode="exam", unit="U10", fine=True, size=20, exam=att, n=k + 1, of=20, plan=[q["id"] for q in sub])["id"]
        for j, q in enumerate(sub):
            base_side = "yes" if q["base"] >= 0.5 else "no"
            side = base_side if want_pass or (k * 20 + j) % 8 else ("no" if base_side == "yes" else "yes")
            synth.fine_call(r, sid, synth.add_days("2026-11-12", k // 3), 11 + k * 40 + j, q, 0.96, side, mode="exam", exam=att)
        r._add("session_end", synth.add_days("2026-11-12", k // 3), 12 + k * 40 + 20, session=sid)
    page = open_app(E, "2026-11-25", r.write(os.path.join(E.tmp, f"b10_verdict_{want_pass}.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U10-card")
    check(f"{'pass' if want_pass else 'fail'} run: the exam shows 380 of 400 done, in progress", text(page, "#pgate-U10-status") == "In progress" and "380 of 400" in text(page, "#pgate-U10-card"), text(page, "#pgate-U10-card")[:120])
    go(page, "#/fine/exam")
    page.wait_for_selector("#dial")
    for i in range(20):
        page.wait_for_function("document.querySelector('#claim') !== null", timeout=5000)
        fine_call_ui(page, 96)
        page.wait_for_timeout(150)
    page.wait_for_selector("#fexam-verdict", timeout=15000)
    v = text(page, "#fexam-verdict")
    res = [e for e in read_events(page) if e["type"] == "exam" and e.get("state") == "result" and e.get("unit") == "U10"]
    check(f"the verdict is {'Passed' if want_pass else 'Not passed'} and is written once", len(res) == 1 and res[0]["pass"] is want_pass and v.startswith("Passed" if want_pass else "Not passed") and res[0]["n"] == 400, f"{v} / {res[0] if res else None}")
    conf, hit = res[0]["meanConf"], res[0]["hitRate"]
    check("the verdict shows the average confidence and the hit rate that decided it", text(page, "#fexam-conf") == pct(conf) and text(page, "#fexam-hit") == pct(hit), f"{text(page, '#fexam-conf')} {text(page, '#fexam-hit')}")
    F.audit(E, f"fine exam verdict {want_pass}")
    go(page, "#/path")
    page.wait_for_selector("#pgate-U10-card")
    status = text(page, "#pgate-U10-status")
    check("the Path shows Passed after a pass and Repair first after a fail", status == ("Passed" if want_pass else "Repair first"), status)
    if not want_pass:
        check("a fail says which way: too sure", "too sure" in text(page, "#pgate-U10-card"), text(page, "#pgate-U10-card")[:140])
        go(page, "#/fine/repair")
        page.wait_for_selector("#dial")
        check("the repair drill is 20 calls and tagged Repair drill", text(page, ".cnt") == "1 of 20" and "Repair drill" in text(page, "#mode-tag"))
    E.ctx.close()

def put_meta(page, key, value):
    """Write a value into the phone's `meta` store (how the weekly review's file sits in the cache) straight through IndexedDB."""
    page.evaluate("""([k, v]) => new Promise((res, rej) => { const r = indexedDB.open('predict-record'); r.onsuccess = () => { const tx = r.result.transaction('meta', 'readwrite'); tx.objectStore('meta').put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); })""", [key, value])


def phase_b11(E):
    """Unit 11, with the machine: Predict's forecast stays sealed until your first number is locked; first, final and Predict are scored three ways."""
    import math as _m
    # -- closed until the Unit 10 exam is passed -------------------------------------------------------------------------------
    page = open_app(E, "2026-12-01", synth.u10_ready_player(U1_EXAM, start=START).write(os.path.join(E.tmp, "b11_closed.jsonl")))
    go(page, "#/path")
    page.wait_for_selector("#pgate-U11-card")
    check("before the Unit 10 exam is passed the Path says Unit 11 is not open", text(page, "#pgate-U11-status") == "Not open yet", text(page, "#pgate-U11-card")[:100])
    go(page, "#/world")
    page.wait_for_function("location.hash === '#/path'", timeout=5000)
    check("opening the list while closed sends you back to the Path", page.evaluate("location.hash") == "#/path")
    E.ctx.close()

    # -- open: a record with one question already finalised and due, and the review's file in the cache ---------------------------
    def fc(id_, text_, opens, due, p, **more):
        return {"text": text_, "p": p, "written": "2026-11-15", "opens": opens, "due": due, "ref": f"Reference class for {id_}: about {int(p * 100)} in 100", "result": None, "source": None, "checked": None, **more}
    raw = {"version": 1, "week": "2026-W48", "written": "2026-11-30", "forecasts": {
        "w-a": {"text": "By 20 December, will the pilot city report more than 3 cm of snow in a single day?", "p": 0.37, "written": "2026-11-15", "opens": "2026-11-30", "due": "2026-12-20", "ref": "Winters since 1990 in this city: 37 days in 100 of this kind turned out that way"},
        "w-b": {"text": "A question that has not opened yet", "p": 0.81, "written": "2026-11-15", "opens": "2026-12-05", "due": "2026-12-30", "ref": "Hidden reference class"},
        "w-c": {"text": "A question that closed before you forecast it", "p": 0.66, "written": "2026-11-15", "opens": "2026-11-20", "due": "2026-11-28", "ref": "Closed reference class"},
        "w-e": {"text": "By 29 November, will the central bank have changed its rate?", "p": 0.3, "written": "2026-11-15", "opens": "2026-11-20", "due": "2026-11-29", "ref": "Meetings since 2000: 30 in 100 moved", "result": "no", "source": "https://example.org/rates", "checked": "2026-11-30"}}}
    r = synth.u10_passed_player(U1_EXAM, start=START)
    r._add("world", "2026-11-22", 10, state="first", q="w-e", text=raw["forecasts"]["w-e"]["text"], due="2026-11-29", opens="2026-11-20", p=0.55, ms=9000)
    r._add("world", "2026-11-22", 12, state="final", q="w-e", p=0.45, machine=0.3, machineWritten="2026-11-15", machineRef=raw["forecasts"]["w-e"]["ref"], ms=9000)
    page = open_app(E, "2026-12-01", r.write(os.path.join(E.tmp, "b11_open.jsonl")))
    put_meta(page, "coach", {"raw": raw, "fetched": "2026-11-30T20:00:00Z"})
    page.reload()
    page.wait_for_selector(".nav")
    go(page, "#/today")
    page.wait_for_selector("#u11-card")
    check("Unit 11 is open: Today has its card with two questions waiting", "2 waiting" in text(page, "#u11-count"), text(page, "#u11-card")[:120])
    F.audit(E, "today with Unit 11")
    go(page, "#/path")
    page.wait_for_selector("#pgate-U11-card")
    check("the Path shows Unit 11 collecting: 1 of 60 is not yet settled, 0 of 60", text(page, "#pgate-U11-status") == "Collecting" and "0 of 60" in text(page, "#pgate-U11-card"), text(page, "#pgate-U11-card")[:120])
    check("Predict's numbers are nowhere on the Today or the Path screens", all(x not in page.content() for x in ("37%", "81%", "66%")))
    go(page, "#/world")
    page.wait_for_selector("#world-gate")
    check("the list shows the measure at 0 of 60 and groups: one to say what happened, one open", "0 of 60" in text(page, "#world-count") and page.query_selector("#world-due") is not None and page.query_selector("#world-open") is not None, text(page, "main")[:200])
    body = page.content()
    check("a question that has not opened is not listed and its number is not in the page", "has not opened yet" not in body and "81%" not in body and "0.81" not in body)
    check("a question that closed before it was forecast is not offered", "closed before you forecast" not in text(page, "main"))
    F.audit(E, "world list")
    shot(E, "b11-list.png")
    go(page, "#/world/w-b")
    page.wait_for_function("location.hash === '#/world'", timeout=5000)
    check("a question that has not opened cannot be reached by its address", page.evaluate("location.hash") == "#/world")

    # -- the sealed first number ----------------------------------------------------------------------------------------------
    go(page, "#/world/w-a")
    page.wait_for_selector("#world-sealed")
    html = page.content()
    check("before the first number is locked Predict's number is not in the page at all", "37%" not in html and "0.37" not in html and page.query_selector("#world-machine") is None and "37 days in 100" not in html, "")
    check("the sealed card says so", "Sealed" in text(page, "#world-sealed"))
    F.audit(E, "world sealed")
    shot(E, "b11-sealed.png")
    for _ in range(10):
        page.click("#dial-up")
    check("ten taps on +1 make 60% Yes on the 1% dial", "60%" in text(page, "main"), text(page, "main")[:120])
    page.wait_for_timeout(450)
    page.click("#world-lock")
    page.wait_for_selector("#world-machine", timeout=5000)
    first = [e for e in of_type(page, "world") if e["state"] == "first" and e["q"] == "w-a"]
    check("the first number is saved before anything of Predict's is shown", len(first) == 1 and near(first[0]["p"], 0.60) and first[0]["due"] == "2026-12-20" and "machine" not in first[0], str(first))
    check("now Predict's number and its reason are shown beside the player's own", text(page, "#world-machine") == "37%" and text(page, "#world-first") == "60%" and "37 days in 100" in text(page, "#world-ref"), text(page, "#world-numbers"))
    check("the second dial starts at the first number", "60%" in text(page, ".big"), text(page, ".big"))
    F.audit(E, "world reveal")
    shot(E, "b11-reveal.png")
    # leaving and coming back lands on the same step: the first number is kept
    go(page, "#/world")
    page.wait_for_selector("#world-reveal")
    check("a question with a first number waits under Finalise", "See Predict" in text(page, "#world-reveal"), text(page, "#world-reveal")[:100])
    go(page, "#/world/w-a")
    page.wait_for_selector("#world-final")
    for _ in range(20):
        page.click("#dial-down")
    check("twenty taps on -1 from 60% Yes make 40% Yes (a call of 60% on No)", "40%" in text(page, ".big") or "No · 60%" in text(page, ".big"), text(page, ".big"))
    page.wait_for_timeout(450)
    page.click("#world-final")
    page.wait_for_function("location.hash === '#/world'", timeout=5000)
    fin = [e for e in of_type(page, "world") if e["state"] == "final" and e["q"] == "w-a"]
    check("the final number is saved with the number the player saw", len(fin) == 1 and near(fin[0]["p"], 0.40) and near(fin[0]["machine"], 0.37) and fin[0]["machineWritten"] == "2026-11-15", str(fin))
    page.wait_for_selector("#world-waiting")
    check("the question now waits for its day", "Locked" in text(page, "#world-waiting") and "20 Dec 2026" in text(page, "#world-waiting"), text(page, "#world-waiting")[:120])
    check("a second first number cannot be written: the question no longer offers one", page.query_selector("#world-lock") is None)

    # -- a closed question ---------------------------------------------------------------------------------------------------
    go(page, "#/world/w-c")
    page.wait_for_selector("#world-wait")
    check("a question that closed before you forecast it says so and shows no number of Predict's", "not scored" in text(page, "#world-wait") and "66%" not in page.content())

    # -- settling: Predict's reading with its source, the player confirms --------------------------------------------------------
    go(page, "#/world/w-e")
    page.wait_for_selector("#world-checked")
    check("a due question shows what Predict read, with its page, and asks the player", "it did not happen" in text(page, "#world-checked") and page.get_attribute("#world-checked a", "href") == "https://example.org/rates" and page.is_disabled("#world-resolve"), text(page, "#world-checked"))
    F.audit(E, "world settle")
    page.click("#world-outcome [data-value=no]")
    page.wait_for_timeout(450)
    page.click("#world-resolve")
    page.wait_for_selector("#world-done", timeout=5000)
    res = [e for e in of_type(page, "world") if e["state"] == "resolve"]
    check("the result is saved as confirmed from Predict's page", len(res) == 1 and res[0]["outcome"] == "no" and res[0]["via"] == "predict" and res[0]["source"] == "https://example.org/rates", str(res))
    pt = lambda q: round(100 * (1 + _m.log2(q)))
    want = (pt(0.45), pt(0.55), pt(0.70))  # first 55% yes (45% on no), final 45% yes (55% on no), Predict 30% yes (70% on no)
    done = text(page, "#world-done")
    check("the settled row shows the three numbers and their sharp points", all(x in done for x in ("55%", "45%", "30%", signed(want[0]), signed(want[1]), signed(want[2]))), done)
    go(page, "#/world")
    page.wait_for_selector("#world-gate")
    check("the measure now reads 1 of 60 with the three averages", "1 of 60" in text(page, "#world-count") and signed(want[0]) in text(page, "#world-means") and signed(want[2]) in text(page, "#world-means"), text(page, "#world-gate"))
    go(page, "#/mirror")
    page.wait_for_selector("#world-record")
    tbl = text(page, "#wr-table")
    check("the Mirror has the three averages over the one settled question, flagged as a hint", text(page, "#wr-n") == "n=1" and signed(want[0]) in tbl and signed(want[1]) in tbl and signed(want[2]) in tbl and "hint" in text(page, "#world-record"), tbl)
    F.audit(E, "mirror with Unit 11")
    check("the app never said Claude on a Unit 11 screen", "claude" not in page.content().lower())
    E.ctx.close()


def has_meta(page, key):
    """Whether the phone holds a saved value in the `meta` store under `key` (read straight from IndexedDB)."""
    return page.evaluate("""(k) => new Promise((res) => { const r = indexedDB.open('predict-record'); r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').get(k); q.onsuccess = () => res(q.result !== undefined); }; r.onerror = () => res(false); })""", key)


PHASES = [
    ("b3", "Block 3: the Mirror", phase_b3),
    ("b4f", "Block 4: flags, drills and the instant note", phase_b4_flags),
    ("b4e", "Block 4: the Unit 1 exam", phase_b4_exam),
    ("b4a", "Block 4: the autopsy and the case file", phase_b4_autopsy),
    ("b5", "Block 5: the Coach", phase_b5),
    ("b6", "Block 6: ranges", phase_b6),
    ("b7", "Block 7: Fermi, base rates, chains", phase_b7),
    ("b8", "Block 8: updating", phase_b8),
    ("b9", "Block 9: knowing yourself", phase_b9),
    ("b10", "Block 10: fine grain", phase_b10),
    ("b11", "Block 10: with the machine", phase_b11),
]


def main():
    wanted = [a for a in sys.argv[1:] if not a.startswith("--") and a in {p[0] for p in PHASES}]
    if "b4" in sys.argv[1:]:
        wanted += ["b4f", "b4e", "b4a"]
    root, tmp = tempfile.mkdtemp(prefix="predict-blocks-"), tempfile.mkdtemp(prefix="predict-blocks-files-")
    T.deploy(root, "blockstest")
    server = T.Server(root)
    server.start()
    E = SimpleNamespace(tmp=tmp, console=[], bad=[], outside=[], taps={}, overflow={}, texts=[], audited=set(), phase="blocks")
    with sync_playwright() as p:
        E.browser = p.chromium.launch()
        for key, name, fn in PHASES:
            if wanted and key not in wanted:
                continue
            print(f"\n== {name} ==", flush=True)
            E.phase = key
            try:
                fn(E)
            except Exception as e:  # a crash is a failure, and the next phase still runs
                traceback.print_exc()
                check(f"phase '{name}' ran to the end", False, f"{type(e).__name__}: {str(e)[:300]}")
                try:
                    E.page.screenshot(path=os.path.join(tmp, f"crash-{key}.png"))
                except Exception:
                    pass
        E.browser.close()
    print("\n== whole run ==")
    errs = [t for _, t in E.console]
    check("no script errors and no console errors in the whole run", not errs, "; ".join(errs[:3]))
    check("every file the app asked for was found (no 404s)", not E.bad, "; ".join(E.bad[:3]))
    check("no request ever left this site", not E.outside, "; ".join(E.outside[:3]))
    check(f"every screen's tap targets are at least 44 px ({len(E.audited)} screens checked)", not E.taps, "; ".join(f"{k}: {v[:2]}" for k, v in list(E.taps.items())[:3]))
    check("no screen scrolls sideways, at 390 or 320 px", not E.overflow, str(E.overflow))
    check("the app never says Claude on any screen it showed", "claude" not in "\n".join(E.texts).lower())
    server.stop() if server.is_up() else None
    shutil.rmtree(root, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + (f"   (files kept in {tmp})" if failed else ""))
    if not failed:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

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
    check("Today's block count follows the build (Block 4 of 10 built)", "Block 4 of 10 built" in page.inner_text("body"))
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


PHASES = [
    ("b3", "Block 3: the Mirror", phase_b3),
    ("b4f", "Block 4: flags, drills and the instant note", phase_b4_flags),
    ("b4e", "Block 4: the Unit 1 exam", phase_b4_exam),
    ("b4a", "Block 4: the autopsy and the case file", phase_b4_autopsy),
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

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
    check("Today's block count follows the build (Block 3 of 10 built)", "Block 3 of 10 built" in page.inner_text("body"))
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


PHASES = [
    ("b3", "Block 3: the Mirror", phase_b3),
]


def main():
    wanted = [a for a in sys.argv[1:] if not a.startswith("--") and a in {p[0] for p in PHASES}]
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

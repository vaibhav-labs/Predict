#!/usr/bin/env python3
"""Play the app the way a person does, on a phone-size screen, and check what it shows and what it saves.

    python3 tools/test_flow.py                run every check
    python3 tools/test_flow.py --shots DIR    also save phone-size screenshots into DIR

Needs Playwright for Python and its Chromium. Nothing is fetched from the internet: the app is built into a
temporary folder and served from there, under /Predict/, like GitHub Pages does. Chromium only; Safari on a real
iPhone is checked by hand, with the "This device" card on the Coach tab.

The story it plays, in order:
   1  Shell        five tabs, no sideways scroll at 390 and 320 px, tap targets of 44 px, fonts, no failed requests
   2  Baseline 1   the dial table, 20 calls with no feedback, a reload and a close in the middle, the summary
   3  Baseline 2   the server is stopped and the phone is in airplane mode: the session still plays and saves
   4  Baseline 3   the 60th call; the curve in Mirror equals an independent recomputation from the raw calls
   5  Practice     instant reveal on every call, flags, the summary
   6  Lessons       every number on the four cards equals the payout table
   7  Backup        Export, Erase, Import, import twice, bad files, the share-sheet path, the spreadsheet copy
   8  Draw rules    the bank used up: longest-ago questions come back first, disputed ones never do
   9  Timeout       60 seconds with no answer; the app closed for a minute; the tab hidden and shown again
  10  Zero gap      a session answered only at 50%: the gap is exactly 0 and is written 0, never +0 or −0
  11  Whole run     no script errors, no failed or outside requests, the app never says "Claude"

Every expected number is computed here from data/scoring.json and the question bank, not read back from the app.
"""
import csv
import datetime
import json
import math
import os
import re
import shutil
import sys
import tempfile
import traceback
from collections import Counter
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_pwa as T  # noqa: E402  (the test server, the deploy step, the address)
from playwright.sync_api import sync_playwright  # noqa: E402

REPO, BASE, SHOTS = T.REPO, T.BASE, T.SHOTS
VIEW = {"width": 390, "height": 844}
SMALL = {"width": 320, "height": 568}
MINUS = "−"
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    if not ok:
        T.annotate_failure(name, detail)


# ---------------------------------------------------------------------------------------------------------------
# What the game should say, worked out here from the data files
# ---------------------------------------------------------------------------------------------------------------
def load(*parts):
    with open(os.path.join(REPO, *parts), encoding="utf-8") as f:
        return f.read()


CFG = json.loads(load("data", "scoring.json"))
BANK = json.loads(load("app", "content", "questions", "starter.json"))["questions"]
BY_CLAIM = {q["claim"]: q for q in BANK}
BY_ID = {q["id"]: q for q in BANK}
UNITS = {r["id"]: r for r in csv.DictReader(open(os.path.join(REPO, "data", "units.csv"), encoding="utf-8"))}
STEPS = CFG["binary"]["dial_steps"]
RULE = CFG["binary"]["core_rule"]
FORMULA = CFG["binary"]["rules"][RULE]
TIMEOUT_S = CFG["gym"]["timeout_seconds"]
GUARD_MS = CFG["gym"]["tap_guard_ms"]
BASE_TOTAL, BASE_PER = int(UNITS["U0"]["practice_calls"]), int(UNITS["U0"]["drills_per_day"])
PRACTICE_PER, PRACTICE_TOTAL = int(UNITS["U1"]["drills_per_day"]), int(UNITS["U1"]["practice_calls"])
JCFG = CFG["journal"]
CHECKER_RULES = [{**r, "re": re.compile(r["pattern"], re.IGNORECASE)} for r in csv.DictReader(open(os.path.join(REPO, "data", "checker_rules.csv"), encoding="utf-8"))]


def check_claim(text):
    """Mirrors app/js/engine/journal.js checkClaim: 'require' fires when the pattern is absent, 'forbid' when present."""
    out = []
    for r in CHECKER_RULES:
        matched = bool(r["re"].search(text or ""))
        if (r["sense"] == "require" and not matched) or (r["sense"] == "forbid" and matched):
            out.append(r["flag"])
    return out


def journal_raw(c, outcome_yes):
    return hit_pts(c) if outcome_yes else miss_pts(c)


def journal_edge(c, b, outcome_yes):
    return JCFG["edge_weight"] * (journal_raw(c, outcome_yes) - journal_raw(b, outcome_yes))


def add_days(day_str, n):
    y, m, d = (int(x) for x in day_str.split("-"))
    return (datetime.date(y, m, d) + datetime.timedelta(days=n)).isoformat()
BASE_SESSIONS = math.ceil(BASE_TOTAL / BASE_PER)
TABS = [("today", "Today"), ("journal", "Journal"), ("mirror", "Mirror"), ("coach", "Coach"), ("path", "Path")]


def js_round(x):
    """JavaScript's Math.round: halves go up."""
    return math.floor(x + 0.5)


def pts(p):
    """Points for a call whose chosen side was given probability p, from the rule in scoring.json. Python's round()
    goes to the even number on an exact half, which is what the app and the simulators do."""
    return round(eval(FORMULA, {"__builtins__": {}}, {"p": p, "log2": math.log2, "log": math.log, "log10": math.log10}))


def hit_pts(c): return pts(c)
def miss_pts(c): return pts(1 - c)
def expect_pts(q, c): return q * hit_pts(c) + (1 - q) * miss_pts(c)
def signed(n): return f"+{n}" if n > 0 else f"{MINUS}{-n}" if n < 0 else "0"
def pct(c): return f"{js_round(c * 100)}%"
def cap(s): return s[:1].upper() + s[1:]


def f1(x):
    r = js_round(x * 10) / 10
    return (MINUS if r < 0 else "") + f"{abs(r):.1f}"


def stats(calls):
    """Same sums, in the same order, as the app: so every float agrees to the last bit."""
    n = len(calls)
    if not n:
        return dict(n=0, hits=0, points=0, mean_conf=None, hit_rate=None, gap=None, avg=None)
    hits = sum(1 for c in calls if c["hit"])
    total = 0.0
    for c in calls:
        total += c["c"]
    mean_conf = total / n
    points = sum(c["points"] for c in calls)
    return dict(n=n, hits=hits, points=points, mean_conf=mean_conf, hit_rate=hits / n, gap=mean_conf - hits / n, avg=points / n)


def bands_of(calls):
    edges, thin_below = CFG["mirror"]["band_edges"], CFG["mirror"]["thin_below"]
    out = []
    for i in range(len(edges) - 1):
        lo, hi, last = edges[i], edges[i + 1], i == len(edges) - 2
        inside = [c for c in calls if c["c"] >= lo - 1e-9 and (c["c"] <= hi + 1e-9 if last else c["c"] < hi - 1e-9)]
        st = stats(inside)
        out.append(dict(lo=lo, hi=hi, last=last, thin=st["n"] < thin_below, **st))
    return out


def decide(g, truth):
    """The test player. Walks through all eleven confidence steps, is right three times in four, and on every
    other 50% call leaves the dial untouched (the side then defaults to Yes)."""
    step_i = (g * 3 + 1) % len(STEPS)
    side = "yes" if truth == (g % 4 != 3) else "no"
    untouched = step_i == 0 and g % 2 == 1
    return step_i, ("yes" if untouched else side), untouched


# ---------------------------------------------------------------------------------------------------------------
# Talking to the page
# ---------------------------------------------------------------------------------------------------------------
READ_DB = """() => new Promise((resolve, reject) => {
  const open = indexedDB.open('predict-record');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(['events', 'meta']);
    const ev = tx.objectStore('events').getAll();
    const keys = tx.objectStore('meta').getAllKeys();
    const vals = tx.objectStore('meta').getAll();
    tx.oncomplete = () => { db.close(); resolve({ events: ev.result, meta: Object.fromEntries(keys.result.map((k, i) => [k, vals.result[i]])) }); };
    tx.onerror = () => reject(tx.error);
  };
})"""
SET_META = """([key, value]) => new Promise((resolve, reject) => {
  const open = indexedDB.open('predict-record');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
})"""
TAPS = """() => {
  const out = [];
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary, [role=button]')) {
    if (el.closest('[hidden]') || el.classList.contains('visually-hidden')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width < 43.5 || r.height < 43.5) {
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
      out.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + name + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return out;
}"""
# The share sheet and the download path, both under the test's control. Chromium on Linux has no share sheet, so
# the default is a plain download; a test that wants the phone's behaviour installs its own stub.
NO_SHARE = """for (const k of ['canShare', 'share']) Object.defineProperty(Navigator.prototype, k, { value: undefined, writable: true, configurable: true });"""
# Counts how often the app asks the browser to keep its storage (it should ask once each time it opens).
SPY_PERSIST = """(() => { const s = navigator.storage; window.__persist = 0;
  if (s && s.persist) { const o = s.persist.bind(s); s.persist = () => { window.__persist++; return o(); }; } })();"""


def text(page, sel):
    return (page.text_content(sel) or "").strip()


def settle(page):
    """Wait out the tap guard: a button that has just appeared ignores taps for tap_guard_ms."""
    page.wait_for_timeout(GUARD_MS + 80)


def read_db(page):
    db = page.evaluate(READ_DB)
    db["events"].sort(key=lambda e: (e["t"], e["id"]))
    return db


def db_calls(page):
    return [e for e in read_db(page)["events"] if e["type"] == "call"]


def shot(S, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        S.page.screenshot(path=os.path.join(SHOTS, name))


def tab(page, name):
    """Open a tab the way a thumb does: tap it in the bottom bar (from a focus screen, by address).
    Clicks by selector, not a cached element handle: the route can replace the whole screen between
    finding the link and clicking it, and a handle to the old one is then "not attached to the DOM"."""
    sel = f".nav a[href='#/{name}']"
    if page.query_selector(sel):
        page.click(sel)
    else:
        page.evaluate("(h) => { location.hash = h; }", f"#/{name}")
    page.wait_for_selector(f".nav a[href='#/{name}'][aria-current='page']")


def audit(S, label):
    """Per screen: tap targets, sideways scroll, and the words on it (for the "never says Claude" check)."""
    page = S.page
    bad = page.evaluate(TAPS)
    if bad:
        S.taps[label] = bad
    sw, iw = page.evaluate("[Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), window.innerWidth]")
    if sw > iw:
        S.overflow[f"{label} at {iw}px"] = sw
    S.texts.append(page.inner_text("body"))
    S.audited.add(label)


def attach(S, page):
    page.on("pageerror", lambda e: S.console.append((S.phase, f"pageerror: {e}")))
    page.on("console", lambda m: S.console.append((S.phase, f"console.{m.type}: {m.text}")) if m.type == "error" else None)
    page.on("response", lambda r: S.bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    page.on("request", lambda r: S.outside.append(r.url) if not r.url.startswith((f"http://127.0.0.1:{T.PORT}/", "data:", "blob:")) else None)


def advance(page, prev_claim):
    """After a lock: wait for the next question, or for the summary when the session is over."""
    page.wait_for_function(
        "(prev) => { if (location.hash.startsWith('#/summary/')) return true; const c = document.getElementById('claim'); return !!c && c.textContent !== prev; }",
        arg=prev_claim, timeout=10000)


def start_session(S):
    tab(S.page, "today")
    S.page.click("#start")
    S.page.wait_for_selector("#claim")


# ---------------------------------------------------------------------------------------------------------------
# One call, and what should follow it
# ---------------------------------------------------------------------------------------------------------------
def play_call(S, mode, index, size, double_tap=False):
    """Read the question, answer it by the test player's rule, lock. Returns the expected record and the question."""
    page = S.page
    claim = text(page, "#claim")
    q = BY_CLAIM.get(claim)
    if q is None:
        raise AssertionError(f"the question on screen is not in the bank: {claim[:70]!r}")
    here = text(page, ".cnt")
    if here != f"{index} of {size}":
        check(f"the header counts the calls: {index} of {size}", False, here)
    tags = [t.strip() for t in page.eval_on_selector_all(".tag", "els => els.map(e => e.textContent)")]
    want_tags = [cap(q["domain"]), "Baseline" if mode == "baseline" else "Unit 1 practice"]
    if tags != want_tags:
        S.slips.append(f"tags {tags} != {want_tags}")
    step_i, side, untouched = decide(S.g, q["answer"])
    c = STEPS[step_i]
    if not untouched:
        sign = 1 if side == "yes" else -1
        if step_i == 0:  # a 50% call: lean to the side first, then come back, so the dial must remember the lean
            page.fill("#dial", str(sign))
        page.fill("#dial", str(sign * step_i))
    hit = (side == "yes") == q["answer"]
    rec = dict(q=q["id"], claim=claim, side=side, c=c, truth=q["answer"], hit=hit,
               points=hit_pts(c) if hit else miss_pts(c), mode=mode, g=S.g)
    settle(page)
    box = page.locator("#lock").bounding_box()
    page.click("#lock")
    S.g += 1
    S.expected.append(rec)
    if double_tap:  # the second tap of a double tap lands where Lock in was, on the screen that has just replaced it
        advance(page, claim)
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(150)
        S.double_tap = (index, len(db_calls(page)), text(page, ".cnt"))
    return rec, q


def check_reveal(S, rec, q, index, size):
    """The reveal after a practice call: verdict, points, the two sentences, the strip, the answer card, the source."""
    page, c, slips = S.page, rec["c"], S.slips
    page.wait_for_selector("#verdict")
    got = text(page, "#verdict")
    if got != ("Right" if rec["hit"] else "Wrong"):
        slips.append(f"verdict {got!r} for {rec['claim'][:40]!r}")
    if text(page, "#points") != signed(rec["points"]):
        slips.append(f"points {text(page, '#points')!r} != {signed(rec['points'])!r}")
    note = text(page, ".note")
    want_note = (f"At {pct(c)} a hit pays {hit_pts(c)} and a miss would have cost {-miss_pts(c)}." if rec["hit"]
                 else f"At {pct(c)} a miss costs {-miss_pts(c)} and a hit would have paid {hit_pts(c)}.")
    if note != want_note:
        slips.append(f"note {note!r} != {want_note!r}")
    labels = [t.strip() for t in page.eval_on_selector_all(".labels span", "els => els.map(e => e.textContent)")]
    want_labels = [f"Truth: {'Yes' if rec['truth'] else 'No'}", f"You: {'Yes' if rec['side'] == 'yes' else 'No'} · {pct(c)}"]
    if labels != want_labels:
        slips.append(f"labels {labels} != {want_labels}")
    aria = page.get_attribute(".strip", "aria-label")
    want_aria = f"The truth was {'Yes' if rec['truth'] else 'No'}. You said {'Yes' if rec['side'] == 'yes' else 'No'} at {pct(c)}."
    if aria != want_aria:
        slips.append(f"strip label {aria!r}")
    card = text(page, ".answer")
    if q["fact"] not in card or ("Yes, that is true." if q["answer"] else "No, that is false.") not in card:
        slips.append(f"answer card for {rec['claim'][:40]!r}")
    kind = text(page, ".answer .shead .cap")
    want_kind = "Computed" if q["verified"] == "computed" else "By definition" if q["verified"] == "definition" else f"Checked {q['checked']}"
    if kind != want_kind:
        slips.append(f"kind {kind!r} != {want_kind!r}")
    if q["source"].startswith("http"):
        link = page.query_selector(".answer a.link")
        ok = bool(link) and link.get_attribute("href") == q["source"] and link.get_attribute("target") == "_blank" and "noopener" in (link.get_attribute("rel") or "") \
            and f"Source: {q['src_name'] or 'link'}" in link.text_content()
        if not ok:
            slips.append(f"source link for {rec['claim'][:40]!r}")
    elif "Computed:" not in card and "By definition:" not in card:
        slips.append(f"no 'computed' or 'by definition' line for {rec['claim'][:40]!r}")
    filled = page.eval_on_selector_all(".prog i.on", "els => els.length")
    if filled != index:
        slips.append(f"progress strip {filled} != {index}")
    want_btn = "Finish session" if index >= size else "Next call"
    if text(page, "#next") != want_btn:
        slips.append(f"button {text(page, '#next')!r} != {want_btn!r}")


def play_session(S, mode, size, reveal, first=1, flag_at=None, small_at=None, reload_after=None, guard_at=None):
    """Play calls first..size. In baseline there is no reveal; in practice every call is revealed and checked.
    Ends when the app moves to the summary. Returns the list of (record, question)."""
    page, played = S.page, []
    for index in range(first, size + 1):
        rec, q = play_call(S, mode, index, size)
        played.append((rec, q))
        if reveal:
            if guard_at == index:  # Next call tapped the instant the reveal appears (a second tap on Lock in) does nothing
                page.wait_for_selector("#verdict")
                page.evaluate("document.getElementById('next').click()")
                page.wait_for_timeout(120)
                S.guard_held = page.query_selector("#verdict") is not None and text(page, ".cnt") == f"{index} of {size}"
            check_reveal(S, rec, q, index, size)
            if small_at == index:  # the longest screen of the session, at the narrowest phone
                shot(S, "05-reveal.png")
                page.set_viewport_size(SMALL)
                audit(S, "practice reveal")
                page.set_viewport_size(VIEW)
            elif index in (1, 2):
                audit(S, "practice reveal")
            if flag_at == index:
                page.click("#flag")
                page.wait_for_function("document.getElementById('flag').textContent.startsWith('Flagged')")
                if text(page, "#flag") != "Flagged. It will not come back." or not page.is_disabled("#flag"):
                    S.slips.append("flag button did not confirm")
                S.disputed.add(q["id"])
            if reload_after == index:  # the app is closed on the reveal: the call is saved, the next question comes back
                page.reload()
                page.wait_for_selector("#claim")
                S.reload_ok = text(page, ".cnt") == f"{index + 1} of {size}" and len(db_calls(page)) == len(S.expected)
                continue
            settle(page)
            page.click("#next")
        advance(page, rec["claim"])
        if not reveal and index < size:
            # No feedback in the baseline: nothing of the answer may be on screen until the session ends.
            body = page.inner_text("body")
            leaked = page.query_selector("#verdict") or page.query_selector("#points") or "Truth:" in body or "The answer" in body
            if leaked:
                S.slips.append(f"feedback appeared during the baseline after call {index}")
    return played


def session_id(page):
    m = re.match(r"#/summary/(.+)$", page.evaluate("location.hash"))
    return m.group(1) if m else None


def check_summary(S, exp, label, title, heading):
    """The summary page against an independent sum of the calls just made."""
    page = S.page
    st = stats(exp)
    ok = []
    ok.append(("title", text(page, ".eyebrow") == title, text(page, ".eyebrow")))
    ok.append(("points", text(page, "#sum-points") == signed(st["points"]), f"{text(page, '#sum-points')} vs {signed(st['points'])}"))
    ok.append(("right", text(page, "#sum-right") == f"{st['hits']} of {st['n']}", f"{text(page, '#sum-right')} vs {st['hits']} of {st['n']}"))
    grid = [t.strip() for t in page.eval_on_selector_all(".sumgrid .p b", "els => els.map(e => e.textContent)")]
    gap_pts = signed(js_round(st["gap"] * 100))  # a gap that rounds to zero is written 0, with no sign
    want_grid = [signed(st["points"]), f"{st['hits']} of {st['n']}", pct(st["mean_conf"]), gap_pts]
    ok.append(("grid", grid == want_grid, f"{grid} vs {want_grid}"))
    ok.append(("heading", heading(st) in text(page, ".claim"), text(page, ".claim")))
    rows = page.eval_on_selector_all("#rows li", """els => els.map(li => ({
        claim: li.querySelector('.t span').textContent, said: li.querySelector('.t em').textContent,
        pts: li.querySelector('.m').textContent }))""")
    want_rows = [dict(claim=r["claim"], said=f"You said {'Yes' if r['side'] == 'yes' else 'No'} at {pct(r['c'])} · truth: {'Yes' if r['truth'] else 'No'}",
                      pts=signed(r["points"])) for r in exp]
    ok.append(("rows", rows == want_rows, f"{len(rows)} rows" + ("" if rows == want_rows else f"; first difference: {next(((a, b) for a, b in zip(rows, want_rows) if a != b), None)}")))
    bad = [f"{k}: {d}" for k, good, d in ok if not good]
    check(f"{label}: the summary equals an independent sum of the calls", not bad, "; ".join(bad))


def check_saved(S, label, exp, mode, session_ids=None):
    """What was written to the phone for these calls, compared with what was chosen."""
    got = [e for e in db_calls(S.page) if e["mode"] == mode][-len(exp):] if exp else []
    bad = []
    if len(got) != len(exp):
        bad.append(f"{len(got)} saved vs {len(exp)} played")
    for g, e in zip(got, exp):
        want = dict(q=e["q"], claim=e["claim"], side=e["side"], c=e["c"], truth=e["truth"], hit=e["hit"], points=e["points"], mode=mode, rule=RULE,
                    unit="U0" if mode == "baseline" else "U1", domain=BY_ID[e["q"]]["domain"], diff=BY_ID[e["q"]]["diff"])
        diff = {k: (g.get(k), v) for k, v in want.items() if g.get(k) != v}
        if diff:
            bad.append(f"{e['claim'][:30]!r}: {diff}")
            break
        if not (0 <= g["ms"] <= TIMEOUT_S * 1000):
            bad.append(f"ms {g['ms']}")
            break
    if len({g["session"] for g in got}) != 1:
        bad.append("calls of one session carry different session ids")
    check(f"{label}: each call was saved exactly as chosen (side, confidence, truth, points, rule)", not bad, "; ".join(bad[:3]))


def check_mix(S, label, exp, size):
    """A baseline session is half true and half false, and follows the 40/35/25 difficulty mix."""
    truths = Counter(BY_ID[r["q"]]["answer"] for r in exp)
    diffs = Counter(BY_ID[r["q"]]["diff"] for r in exp)
    mix = CFG["gym"]["difficulty_mix"]
    want = {d: round(size * w) for d, w in mix.items()}
    check(f"{label}: {size // 2} true and {size - size // 2} false claims", truths[True] == size // 2 and truths[False] == size - size // 2, str(dict(truths)))
    check(f"{label}: difficulty follows the mix {want}", all(abs(diffs[d] - want[d]) <= 1 for d in want), str(dict(diffs)))


def check_mirror(S, calls, label):
    """Mirror against an independent recomputation: the table of numbers, and every dot and label of the curve."""
    page = S.page
    tab(page, "mirror")
    st = stats(calls)
    rows = {}
    for tr in page.query_selector_all("#stats tr"):
        tds = [t.strip() for t in (td.text_content() for td in tr.query_selector_all("td"))]
        rows[tds[0]] = (tds[1], tds[2])
    gap_note = "too sure" if st["gap"] > 0.02 else "too shy" if st["gap"] < -0.02 else "honest"
    want = {
        "Calls": (str(st["n"]), "n"),
        "Right": (f"{st['hits']} of {st['n']} ({pct(st['hit_rate'])})", f"n={st['n']}"),
        "Average confidence": (pct(st["mean_conf"]), f"n={st['n']}"),
        "Gap": (f"{signed(js_round(st['gap'] * 100))} pts", gap_note),
        "Points": (signed(st["points"]), f"{signed(js_round(st['avg']))} a call"),
    }
    check(f"{label}: Mirror's numbers equal the recomputation", rows == want, f"{rows} vs {want}")
    bands = bands_of(calls)
    W, H, L, R_, T_, B_ = 350, 268, 38, 14, 12, 70  # the chart's own geometry (app/js/ui/mirror.js)
    pw, ph = W - L - R_, H - T_ - B_
    dots = page.eval_on_selector_all("#curve circle.pt", "els => els.map(e => ({cx: +e.getAttribute('cx'), cy: +e.getAttribute('cy'), thin: e.classList.contains('thin')}))")
    want_dots = [dict(cx=L + ((b["mean_conf"] - 0.5) / 0.5) * pw, cy=T_ + (1 - b["hit_rate"]) * ph, thin=b["thin"]) for b in bands if b["n"] > 0]
    same = len(dots) == len(want_dots) and all(abs(a["cx"] - b["cx"]) < 0.05 and abs(a["cy"] - b["cy"]) < 0.05 and a["thin"] == b["thin"] for a, b in zip(dots, want_dots))
    check(f"{label}: the curve's dots sit where the calls put them, thin bands hollow", same, f"{dots} vs {want_dots}")
    ns = [t.strip() for t in page.eval_on_selector_all("#curve text.n", "els => els.map(e => e.textContent)")]
    check(f"{label}: the number of calls is printed under every band", ns == [f"n={b['n']}" for b in bands], str(ns))
    audit(S, "mirror with curve")


# ---------------------------------------------------------------------------------------------------------------
# The eleven phases
# ---------------------------------------------------------------------------------------------------------------
def phase_shell(S):
    page = S.page
    resp = page.goto(BASE)
    check("the app opens under /Predict/", resp.ok, f"status {resp.status}")
    page.wait_for_selector(".nav")
    page.wait_for_function("async () => { await navigator.serviceWorker.ready; return (await caches.keys()).length > 0; }", timeout=15000)
    page.reload()
    page.wait_for_selector(".nav")
    check("the page title is Predict", page.title() == "Predict", page.title())
    check("the service worker controls the page", page.evaluate("!!navigator.serviceWorker.controller"))
    check("the app asks the browser to protect its storage, once each time it opens", page.evaluate("window.__persist") == 1, str(page.evaluate("window.__persist")))
    fams = page.evaluate("document.fonts.ready.then(() => Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family))")
    check("Inter and Newsreader load from the app's own files", {"Inter", "Newsreader"} <= {f.strip("'\"") for f in fams}, str(fams))
    gap_line = f"{BASE_PER} calls · Baseline session 1 of {BASE_SESSIONS}"
    check("Today starts at Day 1 with no calls and offers baseline session 1",
          text(page, "#day") == "Day 1" and text(page, "#stat-calls") == "0" and text(page, "#stat-base") == f"0 of {BASE_TOTAL}" and text(page, "#gym-line") == gap_line and text(page, "#start") == "Start session",
          f"{text(page, '#day')} | {text(page, '#stat-calls')} | {text(page, '#stat-base')} | {text(page, '#gym-line')}")
    for name, label in TABS:
        tab(page, name)
        head = text(page, ".top .mark")
        want = "Predict" if name == "today" else label
        if head != want:
            S.slips.append(f"tab {name}: header {head!r}")
        audit(S, f"tab {name}")
    check("each of the five tabs opens its own screen", not S.slips, "; ".join(S.slips))
    tab(page, "journal")
    check("Journal starts with a CTA to write today's prediction, nothing due or open yet",
          text(page, "#write") == "Write today’s prediction" and text(page, ".top .date") == "Nothing due", text(page, ".top .date"))
    tab(page, "mirror")
    check("Mirror explains why there is no curve yet",
          text(page, "#curve-empty") == f"The curve needs at least {CFG['mirror']['min_calls_for_curve']} calls. You have 0. The baseline finishes at {BASE_TOTAL}.", text(page, "#curve-empty"))
    tab(page, "coach")
    check("Coach starts with an empty record and shows this build",
          text(page, "#record-summary") == "0 events, 0 calls. Not exported yet." and text(page, "#build") == "flowtest", f"{text(page, '#record-summary')} | {text(page, '#build')}")
    tab(page, "path")
    chips = [t.strip() for t in page.eval_on_selector_all(".chip", "els => els.map(e => e.textContent)")]
    check("Path lists four lesson cards, Unit 0 at 0 of 60, Unit 1 open, the rest locked",
          len(page.query_selector_all("#lessons a")) == 4 and chips[0] == f"0 of {BASE_TOTAL}" and chips[1] == "Practice" and set(chips[2:]) == {"Locked"}, str(chips))
    # the narrowest phone we care about (iPhone SE size)
    page.set_viewport_size(SMALL)
    for name, _ in TABS:
        tab(page, name)
        audit(S, f"tab {name}")
    page.set_viewport_size(VIEW)
    tab(page, "today")
    shot(S, "01-today.png")


def phase_baseline_1(S):
    page = S.page
    start_session(S)
    check("a baseline session opens at 1 of 20 with the Baseline tag",
          text(page, ".tt") == "Baseline" and text(page, ".cnt") == f"1 of {BASE_PER}" and "Baseline" in [t.strip() for t in page.eval_on_selector_all(".tag", "els => els.map(e => e.textContent)")])
    page.evaluate("document.getElementById('lock').click()")  # a tap the instant the question appears
    page.wait_for_timeout(150)
    check(f"a tap on Lock in within {GUARD_MS} ms of a question appearing is ignored",
          len(db_calls(page)) == 0 and text(page, ".cnt") == f"1 of {BASE_PER}" and not page.is_disabled("#lock"))
    box = page.locator("#lock").bounding_box()
    check("Lock in is on screen without scrolling at 390 x 844", box["y"] >= 0 and box["y"] + box["height"] <= VIEW["height"], str(box))
    audit(S, "baseline question")
    page.set_viewport_size(SMALL)
    audit(S, "baseline question")
    page.set_viewport_size(VIEW)
    shot(S, "02-question.png")

    # ---- the dial, all 21 positions, against the payout table ----
    attrs = page.eval_on_selector("#dial", "e => [e.type, +e.min, +e.max, +e.step, +e.value]")
    check("the dial is a slider from −10 to +10 in whole steps, resting at 0", attrs == ["range", -10, 10, 1, 0], str(attrs))
    bad = []
    for k in range(-10, 11):
        page.fill("#dial", str(k))
        c = STEPS[abs(k)]
        name = "Yes" if k > 0 else "No" if k < 0 else "Toss-up"
        want = dict(read=f"{name} · {js_round(c * 100)}%", pay=[signed(hit_pts(c)), signed(miss_pts(c))], wheel=f"A wheel that wins {js_round(c * 100)} spins in 100.", wn=str(js_round(c * 100)))
        got = dict(read=text(page, ".big"), pay=[t.strip() for t in page.eval_on_selector_all(".pay b", "els => els.map(e => e.textContent)")],
                   wheel=text(page, ".wtxt b"), wn=text(page, ".eq text.wn"))
        if got != want or page.get_attribute("#dial", "aria-valuetext") != want["read"]:
            bad.append(f"k={k}: {got} vs {want}")
    check("all 21 dial positions show the right readout, both payouts and the equivalent wheel", not bad, "; ".join(bad[:2]))
    table = [(js_round(c * 100), signed(hit_pts(c)), signed(miss_pts(c))) for c in STEPS]
    check("the payout table has 22 numbers and they are the rule's, e.g. 70% pays " + f"{signed(hit_pts(0.7))} or {signed(miss_pts(0.7))}",
          len(table) == 11 and table[0][1:] == ("0", "0") and table[-1][1] == f"+{hit_pts(0.99)}", str(table))
    page.focus("#dial")
    page.fill("#dial", "0")
    page.keyboard.press("ArrowRight")
    check("the arrow keys move the dial (keyboard and screen readers)", text(page, ".big") == f"Yes · {js_round(STEPS[1] * 100)}%", text(page, ".big"))
    box = page.locator("#dial").bounding_box()
    page.mouse.click(box["x"] + box["width"] - 2, box["y"] + box["height"] / 2)
    right_end = text(page, ".big")
    page.mouse.click(box["x"] + 2, box["y"] + box["height"] / 2)
    left_end = text(page, ".big")
    check("a tap at either end of the slider reaches 99% Yes or 99% No", right_end == "Yes · 99%" and left_end == "No · 99%", f"{right_end} | {left_end}")
    page.fill("#dial", "0")

    # ---- calls 1 to 5, saved the moment they are locked ----
    for index in range(1, 6):
        rec, q = play_call(S, "baseline", index, BASE_PER, double_tap=(index == 3))
        advance(page, rec["claim"])
        saved = db_calls(page)
        if len(saved) != index:
            S.slips.append(f"{len(saved)} calls saved after {index} locks")
    check("a call is on the phone the moment it is locked", not S.slips, "; ".join(S.slips))
    check("no feedback appears during the baseline", page.query_selector("#verdict") is None and "Truth:" not in page.inner_text("body"))
    check("a double tap on Lock in saves one call: the second tap does not answer the next question",
          S.double_tap == (3, 3, f"4 of {BASE_PER}"), str(S.double_tap))
    check("the app still asked for storage protection only once", page.evaluate("window.__persist") == 1, str(page.evaluate("window.__persist")))

    # ---- close the app in the middle (reload), then close the session and resume ----
    claim6 = text(page, "#claim")
    page.reload()
    page.wait_for_selector("#claim")
    check("reloading in the middle keeps the same question on screen at 6 of 20",
          text(page, "#claim") == claim6 and text(page, ".cnt") == f"6 of {BASE_PER}" and page.evaluate("location.hash") == "#/gym", f"{text(page, '#claim')[:40]} | {text(page, '.cnt')}")
    page.click("a.x")
    page.wait_for_selector(".nav")
    check("closing the session leaves a Resume on Today with the 5 calls counted",
          text(page, "#gym-line") == f"Resume: 5 of {BASE_PER} done · Baseline" and text(page, "#start") == "Resume session" and text(page, "#stat-calls") == "5" and text(page, "#stat-base") == f"5 of {BASE_TOTAL}",
          f"{text(page, '#gym-line')} | {text(page, '#start')}")
    page.click("#start")
    page.wait_for_selector("#claim")
    check("Resume brings back the same question", text(page, "#claim") == claim6)

    # ---- the rest of session 1 ----
    play_session(S, "baseline", BASE_PER, reveal=False, first=6)
    page.wait_for_function("location.hash.startsWith('#/summary/')")
    page.evaluate("document.querySelector('.foot .btn').click()")  # the second tap of a double tap on the last Lock in
    page.wait_for_timeout(150)
    check("a tap the instant the summary appears does not leave it", session_id(page) is not None, page.evaluate("location.hash"))
    sid = session_id(page)
    exp = S.expected[0:BASE_PER]
    check("the 20th call ends the session and opens its summary", sid is not None and len(exp) == BASE_PER)
    check_summary(S, exp, "baseline session 1", "Baseline session 1", lambda st: f"Here is how those {st['n']} calls went.")
    check("the summary says how far the baseline is and that Mirror draws a rough curve already",
          text(page, "#base-note") == f"Baseline: {BASE_PER} of {BASE_TOTAL} calls done. Mirror already draws a first rough curve, and it firms up as the calls add up. A different day makes a fairer next session.", text(page, "#base-note"))
    check("the summary offers Back to Today and Start another session",
          text(page, ".foot .btn") == "Back to Today" and text(page, ".foot .ghost") == "Start another session")
    check_saved(S, "baseline session 1", exp, "baseline")
    check_mix(S, "baseline session 1", exp, BASE_PER)
    audit(S, "baseline summary")
    shot(S, "03-summary.png")
    # flag a question from the summary; flagging again changes nothing
    page.click("#rows li:nth-child(2) .flagbtn")
    flagged_q = exp[1]["q"]
    S.disputed.add(flagged_q)
    page.click("#rows li:nth-child(2) .flagbtn")
    disputes = [e for e in read_db(page)["events"] if e["type"] == "dispute"]
    check("Flag on the summary saves one dispute, however often it is tapped",
          len(disputes) == 1 and disputes[0]["q"] == flagged_q and text(page, "#rows li:nth-child(2) .flagbtn") == "Flagged"
          and page.get_attribute("#rows li:nth-child(2) .flagbtn", "aria-pressed") == "true", str(disputes))
    page.reload()
    page.wait_for_selector("#rows")
    check("the flag is still there after the app is reopened",
          page.get_attribute("#rows li:nth-child(2) .flagbtn", "aria-pressed") == "true" and page.get_attribute("#rows li:nth-child(1) .flagbtn", "aria-pressed") == "false")
    # Back must not start a session by itself
    sessions_before = len([e for e in read_db(page)["events"] if e["type"] == "session"])
    page.go_back()
    page.wait_for_function("location.hash !== '' && !location.hash.startsWith('#/summary/')")
    sessions_after = len([e for e in read_db(page)["events"] if e["type"] == "session"])
    check("Back from a summary does not start the next session", sessions_after == sessions_before and page.evaluate("location.hash") != "#/gym", f"{page.evaluate('location.hash')} | sessions {sessions_before}->{sessions_after}")
    tab(page, "today")
    check("Today after session 1: 20 calls, baseline 20 of 60, session 2 next",
          text(page, "#stat-calls") == "20" and text(page, "#stat-base") == f"20 of {BASE_TOTAL}" and text(page, "#gym-line") == f"{BASE_PER} calls · Baseline session 2 of {BASE_SESSIONS}",
          f"{text(page, '#stat-calls')} | {text(page, '#stat-base')} | {text(page, '#gym-line')}")
    check("Today's points equal the sum of the 20 calls", text(page, "#stat-points") == signed(stats(exp)["points"]), f"{text(page, '#stat-points')} vs {signed(stats(exp)['points'])}")
    tab(page, "mirror")
    check("after 20 calls Mirror draws a rough curve with every band hollow",
          page.query_selector("#curve") is not None and all(c.get_attribute("class").endswith("thin") for c in page.query_selector_all("#curve circle.pt")))
    check_mirror(S, exp, "after baseline session 1")


def phase_baseline_offline(S):
    page, ctx, server = S.page, S.ctx, S.server
    S.phase = "offline"
    server.stop()
    ctx.set_offline(True)
    try:
        check("the test server is really down", not server.is_up())
        page.reload()
        page.wait_for_selector(".nav")
        tab(page, "today")
        check("the app opens with the server down and the phone in airplane mode, with its record intact",
              page.title() == "Predict" and text(page, "#stat-calls") == str(BASE_PER), f"{page.title()} | {text(page, '#stat-calls')}")
        tab(page, "coach")
        page.wait_for_function("document.getElementById('offline').textContent.trim() !== 'checking'", timeout=8000)
        page.wait_for_function("document.getElementById('conn').textContent.trim() === 'Offline'", timeout=8000)
        card = {k: text(page, f"#{k}") for k in ("installed", "offline", "opens", "persist", "conn", "build")}
        check("the Coach tab's device card reads right in airplane mode: Offline, Ready, saved on this phone, this build",
              card["conn"] == "Offline" and card["offline"] == "Ready" and card["opens"].startswith("Opened ") and card["installed"] == "Not yet"
              and card["persist"] in ("Yes", "Not granted") and card["build"] == "flowtest", str(card))
        start_session(S)
        check("the next baseline session starts offline at 1 of 20", text(page, ".cnt") == f"1 of {BASE_PER}")
        for index in range(1, 9):
            rec, q = play_call(S, "baseline", index, BASE_PER)
            advance(page, rec["claim"])
        claim9 = text(page, "#claim")
        page.reload()
        page.wait_for_selector("#claim")
        check("reloading offline keeps the question and the 8 saved calls",
              text(page, "#claim") == claim9 and text(page, ".cnt") == f"9 of {BASE_PER}" and len(db_calls(page)) == BASE_PER + 8)
        play_session(S, "baseline", BASE_PER, reveal=False, first=9)
        page.wait_for_function("location.hash.startsWith('#/summary/')")
        exp = S.expected[BASE_PER:2 * BASE_PER]
        check_summary(S, exp, "baseline session 2 (offline)", "Baseline session 2", lambda st: f"Here is how those {st['n']} calls went.")
        check_saved(S, "baseline session 2 (offline)", exp, "baseline")
        check_mix(S, "baseline session 2", exp, BASE_PER)
    finally:
        ctx.set_offline(False)
        server.start()
        S.phase = "online"


def phase_baseline_3(S):
    page = S.page
    page.reload()  # back online, on the summary of session 2
    page.wait_for_selector("#rows")
    start_session(S)
    check("the third baseline session starts at 1 of 20", text(page, ".cnt") == f"1 of {BASE_PER}")
    play_session(S, "baseline", BASE_PER, reveal=False)
    page.wait_for_function("location.hash.startsWith('#/summary/')")
    exp = S.expected[2 * BASE_PER:3 * BASE_PER]
    check_summary(S, exp, "baseline session 3", "Baseline session 3", lambda st: "Baseline complete. Here is how this last session went.")
    check_saved(S, "baseline session 3", exp, "baseline")
    check_mix(S, "baseline session 3", exp, BASE_PER)
    check("after 60 calls the summary points to the calibration curve",
          text(page, ".foot .btn") == "See your calibration curve" and page.get_attribute(".foot .btn", "href") == "#/mirror" and page.query_selector("#base-note") is None)
    audit(S, "baseline complete summary")
    calls = db_calls(page)
    base = [c for c in calls if c["mode"] == "baseline"]
    ids = [c["q"] for c in base]
    check("60 baseline calls, and no question appeared twice", len(base) == BASE_TOTAL and len(set(ids)) == BASE_TOTAL, f"{len(base)} calls, {len(set(ids))} different")
    settle(page)
    page.click(".foot .btn")
    page.wait_for_selector("#curve")
    check_mirror(S, S.expected[:BASE_TOTAL], "after the 60 baseline calls")
    check("with 60 calls the dots are filled where a band holds 10 or more calls",
          any(not c.get_attribute("class").endswith("thin") for c in page.query_selector_all("#curve circle.pt")))
    shot(S, "04-mirror.png")
    tab(page, "today")
    check("Today after the baseline: Done, and Unit 1 practice is next",
          text(page, "#stat-base") == "Done" and text(page, "#gym-line") == f"{PRACTICE_PER} calls · Unit 1 practice, 0 of {PRACTICE_TOTAL} so far", f"{text(page, '#stat-base')} | {text(page, '#gym-line')}")
    tab(page, "path")
    chips = [t.strip() for t in page.eval_on_selector_all(".chip", "els => els.map(e => e.textContent)")]
    check("Path marks Unit 0 as Done", chips[0] == "Done", str(chips))


def phase_practice(S):
    page = S.page
    start_session(S)
    check("a practice session opens as Gym, 1 of 18, tagged Unit 1 practice", text(page, ".tt") == "Gym" and text(page, ".cnt") == f"1 of {PRACTICE_PER}")
    S.slips.clear()
    start = len(S.expected)
    flag_at = 5
    played = play_session(S, "practice", PRACTICE_PER, reveal=True, flag_at=flag_at, small_at=3, reload_after=7, guard_at=2)
    check(f"Next call tapped within {GUARD_MS} ms of a reveal appearing is ignored (a double tap cannot skip the answer)", S.guard_held is True, str(S.guard_held))
    check("closing the app on a reveal keeps the call and brings back the next question (8 of 18)", S.reload_ok is True, str(S.reload_ok))
    check("every reveal shows the right verdict, points, sentences, strip, answer, source and progress", not S.slips, "; ".join(S.slips[:3]))
    page.wait_for_function("location.hash.startsWith('#/summary/')")
    exp = S.expected[start:start + PRACTICE_PER]
    check("the 18th reveal says Finish session and the session ends on the summary", session_id(page) is not None and len(exp) == PRACTICE_PER)
    check_summary(S, exp, "practice session 1", "Practice session", lambda st: f"{st['hits']} of {st['n']} right.")
    check("the practice summary offers Back to Today and Start another session",
          text(page, ".foot .btn") == "Back to Today" and text(page, ".foot .ghost") == "Start another session" and page.get_attribute(".foot .ghost", "href") == "#/gym")
    check_saved(S, "practice session 1", exp, "practice")
    qs = [r["q"] for r in exp]
    baseline_ids = {c["q"] for c in db_calls(page) if c["mode"] == "baseline"}
    trues = sum(1 for q in qs if BY_ID[q]["answer"])
    check("18 different questions, none of them seen in the baseline", len(set(qs)) == PRACTICE_PER and not (set(qs) & baseline_ids))
    check("true and false stay near half and half", 5 <= trues <= 13, f"{trues} true of {PRACTICE_PER}")
    flagged = exp[flag_at - 1]["q"]
    check("the call flagged at the reveal is the one that was saved as disputed",
          flagged in {e["q"] for e in read_db(page)["events"] if e["type"] == "dispute"})
    row = page.query_selector(f"#rows li:nth-child({flag_at}) .flagbtn")
    check("the summary shows that call as already flagged", row.get_attribute("aria-pressed") == "true" and row.text_content().strip() == "Flagged")
    audit(S, "practice summary")
    shot(S, "05-practice-summary.png")
    tab(page, "today")
    check("Today after practice: 18 of 90 so far",
          text(page, "#gym-line") == f"{PRACTICE_PER} calls · Unit 1 practice, {PRACTICE_PER} of {PRACTICE_TOTAL} so far" and text(page, "#stat-calls") == str(BASE_TOTAL + PRACTICE_PER),
          f"{text(page, '#gym-line')} | {text(page, '#stat-calls')}")
    check_mirror(S, S.expected, "after practice")
    tab(page, "path")
    chips = [t.strip() for t in page.eval_on_selector_all(".chip", "els => els.map(e => e.textContent)")]
    check("Path shows the practice calls on Unit 1", chips[1] == f"{PRACTICE_PER} calls", str(chips))


def phase_lessons(S):
    page = S.page
    tab(page, "path")
    page.click("#lessons a:nth-child(1)")
    page.wait_for_selector("#lesson-title")
    q = expect_pts
    # (card id, title, the bold numbers in reading order) worked out from the payout table, not from the app
    cards = [
        ("points", "How the points work", [f1(q(0.7, 0.7)), f1(q(0.7, 0.9)), f1(q(0.7, 0.99))]),
        ("price99", "The price of 99", [signed(hit_pts(0.99)), signed(miss_pts(0.99)), str(math.ceil(-miss_pts(0.99) / hit_pts(0.99))), f1(q(0.8, 0.99)), f1(q(0.8, 0.8))]),
        ("knowmore", "You know more than you say", [signed(hit_pts(0.6)), signed(hit_pts(0.8)), f1(q(0.8, 0.6)), f1(q(0.8, 0.8)), f1(q(0.8, 0.8) - q(0.8, 0.6)), str(-miss_pts(0.6))]),
        ("fifty", "50% is a claim too", [str(hit_pts(0.5)), signed(hit_pts(0.6)), str(-miss_pts(0.6)), f1(q(0.7, 0.5)), f1(q(0.7, 0.7))]),
    ]
    bad = []
    for n, (cid, title, bold) in enumerate(cards, 1):
        page.wait_for_function("(t) => (document.getElementById('lesson-title') || {}).textContent === t", arg=title, timeout=5000)
        if text(page, ".tt") != f"Card {n} of 4" or page.evaluate("location.hash") != f"#/lesson/{cid}":
            bad.append(f"card {n} header {text(page, '.tt')} {page.evaluate('location.hash')}")
        got = [t.strip() for t in page.eval_on_selector_all(".prose p b", "els => els.map(e => e.textContent)")]
        if cid == "price99":
            got = [t for t in got if not t.startswith("A wheel")]
        if got != bold:
            bad.append(f"card {n} ({cid}): {got} vs {bold}")
        if cid == "points":
            cells = [t.strip() for t in page.eval_on_selector_all(".prose table td", "els => els.map(e => e.textContent)")]
            want = []
            for c in (0.5, 0.6, 0.7, 0.8, 0.9, 0.99):
                want += [pct(c), signed(hit_pts(c)), signed(miss_pts(c))]
            if cells != want:
                bad.append(f"table {cells} vs {want}")
        if n == 1:
            audit(S, "lesson card")
            shot(S, "06-lesson.png")
        page.click("#lesson-done")
    check("every number on the four lesson cards equals the payout table", not bad, "; ".join(bad[:2]))
    page.wait_for_selector("#lessons")
    check("after the fourth card the app returns to Path, which counts 4 of 4 read", text(page, ".top .date") == "4 of 4 cards read" and len(page.query_selector_all("#lessons .tick.on")) == 4, text(page, ".top .date"))
    tab(page, "today")
    check("Today says all four cards are read", "All four Unit 1 cards read" in text(page, ".steps"))
    lessons = [e for e in read_db(page)["events"] if e["type"] == "lesson"]
    tab(page, "path")
    page.click("#lessons a:nth-child(1)")
    page.wait_for_selector("#lesson-title")
    check("a card that was read offers Next card, and reading it again saves nothing new", text(page, "#lesson-done") == "Next card")
    page.click("#lesson-done")
    page.wait_for_function("location.hash === '#/lesson/price99'")
    after = [e for e in read_db(page)["events"] if e["type"] == "lesson"]
    check("exactly four lesson events are saved", len(lessons) == 4 and len(after) == 4, f"{len(lessons)} then {len(after)}")
    tab(page, "path") if page.query_selector(".nav") else page.click("a.x")
    page.wait_for_selector(".nav")


def snapshot(S):
    page = S.page
    tab(page, "today")
    today = {k: text(page, sel) for k, sel in (("day", "#day"), ("calls", "#stat-calls"), ("points", "#stat-points"), ("base", "#stat-base"), ("line", "#gym-line"))}
    tab(page, "mirror")
    mirror = dict(stats=page.eval_on_selector("#stats", "e => e.innerText"), curve=page.eval_on_selector("#curve", "e => e.outerHTML") if page.query_selector("#curve") else None)
    tab(page, "path")
    path = text(page, ".top .date") + " | " + " | ".join(t.strip() for t in page.eval_on_selector_all(".chip", "els => els.map(e => e.textContent)"))
    return dict(today=today, mirror=mirror, path=path, events=read_db(page)["events"])


def import_file(S, path):
    page = S.page
    page.evaluate("document.getElementById('record-msg').textContent = ''")
    page.set_input_files("#import-file", path)
    page.wait_for_function("document.getElementById('record-msg').textContent.trim() !== ''", timeout=8000)
    return text(page, "#record-msg"), text(page, "#record-summary")


def write_file(S, name, content):
    path = os.path.join(S.tmp, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def phase_backup(S):
    page = S.page
    before = snapshot(S)
    n_events = len(before["events"])
    n_calls = len([e for e in before["events"] if e["type"] == "call"])
    tab(page, "today")
    check("before any Export, Today nudges the player to back up", page.query_selector(".nudge") is not None)
    tab(page, "coach")
    audit(S, "coach")
    shot(S, "07-coach.png")
    check("Coach counts the record: events and calls", text(page, "#record-summary") == f"{n_events} events, {n_calls} calls. Not exported yet.", text(page, "#record-summary"))

    # ---- Export (download) ----
    with page.expect_download() as dl:
        page.click("#export-record")
    d = dl.value
    path = os.path.join(S.tmp, d.suggested_filename)
    d.save_as(path)
    check("Export downloads predict-record-<day>.jsonl", re.fullmatch(r"predict-record-\d{4}-\d{2}-\d{2}\.jsonl", d.suggested_filename) is not None, d.suggested_filename)
    lines = [json.loads(x) for x in open(path, encoding="utf-8").read().splitlines() if x.strip()]
    header, body = lines[0], lines[1:]
    check("the file starts with a header: format, version, count, build",
          header.get("type") == "header" and header.get("format") == "predict-record" and header.get("version") == 1 and header.get("events") == n_events and header.get("build") == "flowtest", str(header))
    check("the file holds every event on the phone, once, in time order",
          [e["id"] for e in body] == [e["id"] for e in before["events"]] and body == before["events"], f"{len(body)} vs {n_events}")
    page.wait_for_function("document.getElementById('record-msg').textContent.includes('Downloaded')")
    last_export = [e for e in read_db(page)["events"] if e["type"] == "export"]
    check("Export then notes itself and says what it did",
          len(last_export) == 1 and text(page, "#record-summary") == f"{n_events + 1} events, {n_calls} calls. Last Export: {last_export[0]['d']}." and f"with {n_events} events" in text(page, "#record-msg"),
          f"{text(page, '#record-summary')} | {text(page, '#record-msg')}")
    tab(page, "today")
    check("after an Export the backup nudge goes away", page.query_selector(".nudge") is None)
    tab(page, "coach")

    # ---- the spreadsheet copy ----
    with page.expect_download() as dl:
        page.click("#export-csv")
    d = dl.value
    cpath = os.path.join(S.tmp, d.suggested_filename)
    d.save_as(cpath)
    rows = list(csv.reader(open(cpath, encoding="utf-8")))
    saved_calls = [e for e in read_db(page)["events"] if e["type"] == "call"]
    check("the spreadsheet copy has one row per call with the right columns",
          rows[0] == ["time", "day", "session", "mode", "unit", "question", "claim", "domain", "difficulty", "side", "confidence", "truth", "right", "points", "ms"] and len(rows) == 1 + len(saved_calls)
          and [r[5] for r in rows[1:]] == [c["q"] for c in saved_calls] and [r[13] for r in rows[1:]] == [str(c["points"]) for c in saved_calls], f"{len(rows) - 1} rows")
    check("a spreadsheet copy does not count as a backup", text(page, "#record-summary").endswith(f"Last Export: {last_export[0]['d']}."), text(page, "#record-summary"))

    # ---- the share sheet (iPhone) path: success, cancel, and a share that fails ----
    stub = """(mode) => {
      window.__shared = null;
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
        if (mode === 'cancel') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
        if (mode === 'fail') { const e = new Error('not allowed'); e.name = 'NotAllowedError'; throw e; }
        window.__shared = { name: data.files[0].name, text: await data.files[0].text() };
      } });
    }"""
    count_now = len(read_db(page)["events"])
    page.evaluate(stub, "ok")
    page.click("#export-record")
    page.wait_for_function("window.__shared !== null")
    shared = page.evaluate("window.__shared")
    page.wait_for_function("document.getElementById('record-msg').textContent.startsWith('Shared')")
    first_line = json.loads(shared["text"].splitlines()[0])
    check("with a share sheet Export hands over the file and says it was shared",
          shared["name"].startswith("predict-record-") and first_line["format"] == "predict-record" and text(page, "#record-msg").startswith(f"Shared a record of {count_now} events"), f"{shared['name']} | {text(page, '#record-msg')}")
    count_shared = len(read_db(page)["events"])
    page.evaluate(stub, "cancel")
    page.evaluate("document.getElementById('record-msg').textContent = ''")
    page.click("#export-record")
    page.wait_for_timeout(300)
    check("cancelling the share sheet records nothing and says nothing", len(read_db(page)["events"]) == count_shared and text(page, "#record-msg") == "")
    page.evaluate(stub, "fail")
    with page.expect_download() as dl:
        page.click("#export-record")
    check("a share that fails falls back to a plain download", dl.value.suggested_filename.startswith("predict-record-"))
    page.evaluate("Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });")

    # ---- Erase ----
    page.click("#erase-btn")
    check("Erase asks for the word ERASE first: the button stays off for anything else", page.is_disabled("#erase-go"))
    page.fill("#erase-confirm", "erase")
    check("lowercase 'erase' does not unlock it", page.is_disabled("#erase-go"))
    page.fill("#erase-confirm", "ERASE")
    check("typing ERASE unlocks it", not page.is_disabled("#erase-go"))
    page.click("#erase-go")
    page.wait_for_function("document.getElementById('record-summary').textContent.startsWith('0 events')")
    db = read_db(page)
    check("Erase empties the record and the saved state, and says so",
          db["events"] == [] and "active" not in db["meta"] and text(page, "#record-summary") == "0 events, 0 calls. Not exported yet." and text(page, "#record-msg").startswith("Erased"), f"{len(db['events'])} events, meta {list(db['meta'])}")
    tab(page, "today")
    check("after Erase, Today is a fresh start", text(page, "#stat-calls") == "0" and text(page, "#stat-base") == f"0 of {BASE_TOTAL}" and text(page, "#day") == "Day 1" and text(page, "#start") == "Start session")
    tab(page, "mirror")
    check("after Erase, Mirror has no curve and shows dashes", page.query_selector("#curve") is None and "–" in text(page, "#stats"))

    # ---- Import: the Export file puts everything back, and a second import adds nothing ----
    tab(page, "coach")
    msg, summary = import_file(S, path)
    check("Import restores every event", msg == f"Imported {n_events} new events. 0 were already here." and summary == f"{n_events} events, {n_calls} calls. Not exported yet.", f"{msg} | {summary}")
    after = snapshot(S)
    same = {k: (after[k] == before[k]) for k in ("today", "mirror", "path", "events")}
    check("after the restore, Today, Mirror's numbers and curve, Path and every event are identical to before", all(same.values()), str(same))
    tab(page, "coach")
    msg, summary = import_file(S, path)
    check("importing the same file again counts nothing twice", msg == f"Imported 0 new events. {n_events} were already here." and len(read_db(page)["events"]) == n_events, f"{msg}")

    # ---- Import: files that are not what they should be ----
    unknown = [dict(id=f"zz-note-{i}", t=f"2026-11-1{6 + i}T08:00:00.000Z", d=f"2026-11-1{6 + i}", type="note", text="kept, never shown") for i in range(2)]
    mixed = write_file(S, "mixed.jsonl", json.dumps(dict(type="header", format="predict-record", version=1)) + "\n" + json.dumps(unknown[0]) + "\nthis is not json\n" + json.dumps(unknown[1]) + "\n")
    msg, summary = import_file(S, mixed)
    check("a file with one bad line imports the good ones and counts the bad line (singular)", msg == "Imported 2 new events. 0 were already here. 1 line could not be read.", msg)
    check("events of a type the app does not know are kept and never break a screen", len(read_db(page)["events"]) == n_events + 2 and summary.startswith(f"{n_events + 2} events"), summary)
    newer = write_file(S, "newer.jsonl", json.dumps(dict(type="header", format="predict-record", version=99)) + "\n" + json.dumps(dict(id="zz-new-1", t="2026-11-20T08:00:00.000Z", d="2026-11-20", type="note")) + "\n")
    msg, _ = import_file(S, newer)
    check("a file from a newer version is refused with a clear message and nothing is imported", msg == "That file is from a newer version of Predict. Update the app first." and len(read_db(page)["events"]) == n_events + 2, msg)
    msg, _ = import_file(S, write_file(S, "empty.jsonl", ""))
    check("an empty file is refused", msg == "No events found in that file.", msg)
    msg, _ = import_file(S, write_file(S, "words.txt", "hello world\nnothing to see here\n"))
    check("a file that is not a record is refused", msg == "No events found in that file.", msg)
    for name, _ in TABS:
        tab(page, name)
    check("with the extra events the five tabs still open", True)
    tab(page, "coach")
    S.n_extra = 2


def phase_reuse(S):
    """The bank used up. Import a record in which every question has been seen once, except two, and in which the
    oldest question is disputed. The next practice session must serve those two, then bring back the questions that
    were answered longest ago, skipping the disputed one and every question flagged earlier."""
    page = S.page
    events = read_db(page)["events"]
    used = {e["q"] for e in events if e["type"] == "call"}
    disputed = {e["q"] for e in events if e["type"] == "dispute"}
    fresh = [q["id"] for q in BANK if q["id"] not in used]
    y = fresh[:2]
    old = [q for q in BANK if q["id"] not in used and q["id"] not in y]
    t0 = datetime.datetime(2026, 1, 1)
    fake, order = [], []
    for i, q in enumerate(old):
        t = t0 + datetime.timedelta(minutes=i)
        c = 0.7
        fake.append(dict(id=f"fake-c-{i:04d}", t=t.strftime("%Y-%m-%dT%H:%M:%S.000Z"), d=t.strftime("%Y-%m-%d"), type="call", session="fake-s1", mode="practice", unit="U1",
                         q=q["id"], claim=q["claim"], domain=q["domain"], diff=q["diff"], side="yes", c=c, truth=q["answer"], hit=bool(q["answer"]),
                         points=hit_pts(c) if q["answer"] else miss_pts(c), rule=RULE, ms=4000))
        order.append(q["id"])
    z = order[0]
    fake.append(dict(id="fake-d-0001", t=t0.strftime("%Y-%m-%dT%H:%M:%S.000Z"), d="2026-01-01", type="dispute", q=z))
    path = write_file(S, "bank-used-up.jsonl", json.dumps(dict(type="header", format="predict-record", version=1)) + "\n" + "\n".join(json.dumps(e) for e in fake) + "\n")
    tab(page, "coach")
    msg, summary = import_file(S, path)
    check("a large record (160 calls) imports in one go", msg == f"Imported {len(fake)} new events. 0 were already here.", msg)
    exp_first = set(y)
    exp_reuse = order[1:1 + PRACTICE_PER - 2]  # the oldest first, without the disputed one
    start_session(S)
    S.slips.clear()
    start = len(S.expected)
    shown = []
    for index in range(1, PRACTICE_PER + 1):
        rec, q = play_call(S, "practice", index, PRACTICE_PER)
        shown.append(q["id"])
        page.wait_for_selector("#verdict")
        settle(page)
        page.click("#next")
        advance(page, rec["claim"])
    page.wait_for_function("location.hash.startsWith('#/summary/')")
    all_disputed = disputed | {z}
    check("the two unseen questions come first", set(shown[:2]) == exp_first, f"{shown[:2]} vs {y}")
    check("then the questions answered longest ago come back, oldest first, in order", shown[2:] == exp_reuse, f"{[BY_ID[s]['claim'][:18] for s in shown[2:6]]}...")
    check("no disputed question came back, not the ones flagged earlier and not the oldest one", not (set(shown) & all_disputed), str(set(shown) & all_disputed))
    check("no question repeated inside the session", len(set(shown)) == PRACTICE_PER)
    check("the session was saved with the 18 calls", len(db_calls(page)) == BASE_TOTAL + PRACTICE_PER + len(fake) - 1 + PRACTICE_PER, str(len(db_calls(page))))
    tab(page, "today")
    check("Today counts every call, imported ones included",
          text(page, "#stat-calls") == str(len(db_calls(page))), f"{text(page, '#stat-calls')} vs {len(db_calls(page))}")
    tab(page, "mirror")
    check("Mirror still draws with hundreds of calls", page.query_selector("#curve") is not None)


def phase_timeout(S):
    """60 seconds with no answer, in a second phone (fresh storage) whose clock the test controls."""
    ctx2 = S.browser.new_context(viewport=VIEW, device_scale_factor=2)
    p2 = ctx2.new_page()
    attach(S, p2)
    S.page, keep = p2, S.page
    try:
        p2.clock.install()
        p2.goto(BASE + "#/today")
        p2.wait_for_selector(".nav")
        p2.click("#start")
        p2.wait_for_selector("#claim")
        first = text(p2, "#claim")
        p2.clock.fast_forward((TIMEOUT_S + 1) * 1000)
        p2.wait_for_function("(c) => { const e = document.getElementById('claim'); return !!e && e.textContent !== c; }", arg=first, timeout=8000)
        toast = p2.query_selector(".toast")
        check(f"a question left for {TIMEOUT_S} seconds is dropped, with a notice",
              toast is not None and toast.text_content() == f"No answer in {TIMEOUT_S} seconds. That question goes back to the pool.", toast.text_content() if toast else "no notice")
        db = read_db(p2)
        skips = [e for e in db["events"] if e["type"] == "skip"]
        check("the timeout is saved as a skip, never as a call",
              len(skips) == 1 and skips[0]["reason"] == "timeout" and skips[0]["q"] == BY_CLAIM[first]["id"] and not [e for e in db["events"] if e["type"] == "call"], str(skips))
        second = text(p2, "#claim")
        check("the session carries on at 1 of 20 with a different question", text(p2, ".cnt") == f"1 of {BASE_PER}" and second != first)
        # a quick answer is accepted
        settle(p2)
        p2.click("#lock")
        advance(p2, second)
        third = text(p2, "#claim")
        calls = [e for e in read_db(p2)["events"] if e["type"] == "call"]
        check("a normal answer after a skip is saved as call 1", len(calls) == 1 and calls[0]["q"] == BY_CLAIM[second]["id"] and text(p2, ".cnt") == f"2 of {BASE_PER}")
        # the app is closed for a long while with a question on screen
        active = read_db(p2)["meta"]["active"]
        p2.evaluate(SET_META, ["active", {**active, "shownAt": active["shownAt"] - 3_600_000}])
        p2.reload()
        p2.wait_for_function("(c) => { const e = document.getElementById('claim'); return !!e && e.textContent !== c; }", arg=third, timeout=8000)
        fourth = text(p2, "#claim")
        skips = [e for e in read_db(p2)["events"] if e["type"] == "skip"]
        check("a question that sat unanswered while the app was closed is skipped on return",
              len(skips) == 2 and skips[1]["q"] == BY_CLAIM[third]["id"] and skips[1]["reason"] == "timeout" and fourth != third and text(p2, ".cnt") == f"2 of {BASE_PER}", str(skips[1:]))
        # the tab is hidden and shown again after a long time
        active = read_db(p2)["meta"]["active"]
        p2.evaluate(SET_META, ["active", {**active, "shownAt": active["shownAt"] - 3_600_000}])
        p2.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        p2.wait_for_function("(c) => { const e = document.getElementById('claim'); return !!e && e.textContent !== c; }", arg=fourth, timeout=8000)
        skips = [e for e in read_db(p2)["events"] if e["type"] == "skip"]
        check("coming back to a hidden tab after a long time also skips the stale question", len(skips) == 3 and skips[2]["q"] == BY_CLAIM[fourth]["id"], str(skips[2:]))
        check("skipped questions were not scored and are still unseen", len([e for e in read_db(p2)["events"] if e["type"] == "call"]) == 1)
        # play the session out: skipped questions are replaced by spares, and the session still has 20 calls
        for index in range(2, BASE_PER + 1):
            claim = text(p2, "#claim")
            settle(p2)
            p2.click("#lock")
            advance(p2, claim)
        p2.wait_for_function("location.hash.startsWith('#/summary/')")
        calls = [e for e in read_db(p2)["events"] if e["type"] == "call"]
        skipped_ids = {e["q"] for e in skips}
        check("with three skips the session still ends at exactly 20 calls, none of them a skipped question",
              len(calls) == BASE_PER and not ({c["q"] for c in calls} & skipped_ids), f"{len(calls)} calls")
        audit(S, "summary after timeouts")
    finally:
        S.page = keep
        ctx2.close()


def phase_zero_gap(S):
    """A gap that rounds to zero is written 0, never +0 or −0. A second phone (fresh storage) plays one baseline session
    answering every call at 50% with the dial untouched, which says Yes. A baseline session is half true and half false,
    so exactly 10 of its 20 calls are right, and the gap (average confidence minus hit rate) is exactly 0."""
    ctx2 = S.browser.new_context(viewport=VIEW, device_scale_factor=2)
    p2 = ctx2.new_page()
    attach(S, p2)
    S.page, keep = p2, S.page
    try:
        p2.goto(BASE + "#/today")
        p2.wait_for_selector(".nav")
        p2.click("#start")
        p2.wait_for_selector("#claim")
        exp = []
        for _ in range(BASE_PER):
            claim = text(p2, "#claim")
            q = BY_CLAIM[claim]
            hit = bool(q["answer"])  # the untouched dial says Yes
            exp.append(dict(q=q["id"], claim=claim, side="yes", c=0.5, truth=q["answer"], hit=hit, points=hit_pts(0.5) if hit else miss_pts(0.5), mode="baseline"))
            settle(p2)
            p2.click("#lock")
            advance(p2, claim)
        p2.wait_for_function("location.hash.startsWith('#/summary/')")
        grid = [t.strip() for t in p2.eval_on_selector_all(".sumgrid .p b", "els => els.map(e => e.textContent)")]
        check_summary(S, exp, "a session answered only at 50%", "Baseline session 1", lambda st: f"Here is how those {st['n']} calls went.")
        check_mirror(S, exp, "after a session answered only at 50%")
        mirror_gap = text(p2, "#stats tr:nth-child(4) td:nth-child(2)")
        check("a gap that rounds to zero is written 0, never +0 or −0, in the summary and in Mirror",
              stats(exp)["gap"] == 0 and len(grid) == 4 and grid[3] == "0" and mirror_gap == "0 pts", f"gap {stats(exp)['gap']} | summary {grid[3:]} | Mirror {mirror_gap!r}")
    finally:
        S.page = keep
        ctx2.close()


def phase_journal(S):
    """Block 2, the Journal: the checker, Ask Predict as a copied message, writing the full chain, a
    lock that refuses edits, a due card on the right day with a controlled clock, resolve, and the
    outcome card's numbers against an independent computation."""
    ctx2 = S.browser.new_context(viewport=VIEW, device_scale_factor=2, timezone_id="UTC", permissions=["clipboard-read", "clipboard-write"])
    p2 = ctx2.new_page()
    attach(S, p2)
    S.page, keep = p2, S.page
    try:
        p2.clock.install()
        p2.goto(BASE + "#/journal")
        p2.wait_for_selector(".nav")
        check("the Journal tab offers to write today's prediction when none exists yet", text(p2, "#write") == "Write today’s prediction")

        p2.click("#write")
        p2.wait_for_selector("#claim-text")
        vague = "Our project will probably go a lot better soon"
        p2.fill("#claim-text", vague)
        p2.wait_for_timeout(80)
        shown = sorted(t.strip() for t in p2.eval_on_selector_all("#flags .msg", "els => els.map(e => e.textContent)"))
        expected = sorted(r["message"] for r in CHECKER_RULES if r["flag"] in check_claim(vague))
        check("the checker flags a vague, dateless claim exactly as the rules in data/checker_rules.csv say", shown == expected, f"{shown} vs {expected}")

        p2.click("#ask-predict")
        p2.wait_for_timeout(80)
        copied = p2.evaluate("() => navigator.clipboard.readText()")
        check("Ask Predict copies a ready-made message naming Predict, with no link and no mention of this tool",
              "Predict" in copied and "http" not in copied and "claude" not in copied.lower(), copied[:140])

        claim = "By tomorrow, the vendor will confirm the November shipment in writing."
        check("a sharp claim with a date clears every rule", check_claim(claim) == [], str(check_claim(claim)))
        p2.fill("#claim-text", claim)
        p2.wait_for_timeout(80)
        check("the checker panel clears once the claim is sharp", p2.query_selector_all("#flags .msg") == [])
        audit(S, "journal claim")
        p2.set_viewport_size(SMALL)  # the four-chip due picker is the layout most likely to misbehave this narrow
        audit(S, "journal claim")
        p2.set_viewport_size(VIEW)

        p2.click(".picker >> text=Work")
        p2.click(".picker >> text=Tomorrow")
        settle(p2)
        p2.click("text=Next: the chain")
        p2.wait_for_selector("#add-evidence")
        texts = p2.query_selector_all("input.field[type=text]")
        check("the chain step offers the outside view, the case against and the tripwire as text fields", len(texts) == 3, str(len(texts)))
        audit(S, "journal chain")
        texts[0].fill("Vendors in this category confirm a shipment by the stated date about 70% of the time.")
        texts[1].fill("The vendor's team has been slow to answer email this month.")
        texts[2].fill("No reply, or a request for more time, by end of day tomorrow.")
        settle(p2)
        p2.click("text=Next: your number")
        p2.wait_for_selector("#prob")
        audit(S, "journal lock")
        p2.fill("#prob", "75")
        p2.wait_for_timeout(50)
        check("the probability readout tracks the slider", text(p2, ".big") == "75%")
        settle(p2)
        p2.click("#lock")
        p2.wait_for_function("location.hash.startsWith('#/journal/') && location.hash !== '#/journal/write'", timeout=5000)
        pred_hash = p2.evaluate("location.hash")
        db = read_db(p2)
        pred = next(e for e in db["events"] if e["type"] == "prediction")
        today0 = pred["d"]
        expected_due = add_days(today0, JCFG["due_offset_days"]["tomorrow"])
        check("the locked card carries the domain, the due date (from data/scoring.json, not a hardcoded day count) and the probability",
              pred["domain"] == "work" and pred["due"] == expected_due and pred["c"] == 0.75, str(pred)[:200])
        check("the full chain was saved: outside view, case against and tripwire text", pred["chain"]["outsideView"]["text"].startswith("Vendors") and pred["chain"]["caseAgainst"]["text"] and pred["chain"]["tripwire"]["text"])
        check("the lock records how long the full chain took to write, like a gym call's ms", isinstance(pred.get("ms"), int) and pred["ms"] > 0, str(pred.get("ms")))

        editable = p2.query_selector_all("textarea, input.range, input[type=number], #claim-text")
        check("a locked card's own page has no editable field anywhere: a lock is final", len(editable) == 0, str(len(editable)))
        check("the baseline is revealed right after lock (mechanics.md 4.3 step 5), not withheld until resolution", "Baseline: 50%" in p2.inner_text("body"))
        audit(S, "journal open card")

        mutated = {**pred, "c": 0.99}
        refused = p2.evaluate("""(e) => new Promise((resolve) => {
          const open = indexedDB.open('predict-record');
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('events', 'readwrite');
            tx.objectStore('events').add(e).onerror = (ev) => { ev.preventDefault(); resolve(true); };
            tx.oncomplete = () => resolve(false);
          };
        })""", mutated)
        check("the store itself refuses a second event under a locked prediction's id", refused)
        still = next(e for e in read_db(p2)["events"] if e["type"] == "prediction")
        check("and its probability on the phone is unchanged", still["c"] == 0.75, str(still["c"]))

        # A second prediction the same day is logged but not scored (data/scoring.json journal.scored_predictions_per_day).
        tab(p2, "journal")
        p2.click("#write")
        p2.wait_for_selector("#claim-text")
        p2.fill("#claim-text", "By next week, the second vendor will reply with a firm date.")
        p2.click(".picker >> text=Life")
        p2.click(".picker >> text=This week")
        settle(p2)
        p2.click("text=Next: the chain")
        p2.wait_for_selector("#add-evidence")
        for f in p2.query_selector_all("input.field[type=text]"):
            f.fill("x")
        settle(p2)
        p2.click("text=Next: your number")
        p2.wait_for_selector("#prob")
        settle(p2)
        p2.click("#lock")
        p2.wait_for_function("location.hash.startsWith('#/journal/') && location.hash !== '#/journal/write'", timeout=5000)
        check("one scored card a day: the extra prediction is logged unscored", "Logged, unscored" in p2.inner_text("body"))

        # A due card appears on the right day, and not before: a controlled clock, and a real route change to see it.
        tab(p2, "journal")
        check("before its due day, the first card sits in Open and the Due list is empty",
              p2.query_selector("#due-list .lesson-link") is None and len(p2.query_selector_all("#open-list .lesson-link")) == 2)
        audit(S, "journal list with cards")
        p2.clock.fast_forward(24 * 3600 * 1000 + 5000)
        tab(p2, "today")  # a real hashchange, never a no-op navigation to the page's current hash
        tab(p2, "journal")
        check("on its due day, the first card moves from Open to Due; the week-horizon second card stays Open",
              len(p2.query_selector_all("#due-list .lesson-link")) == 1 and len(p2.query_selector_all("#open-list .lesson-link")) == 1)

        p2.goto(BASE + pred_hash)
        p2.wait_for_selector("#resolve")
        audit(S, "journal due card")
        settle(p2)
        p2.click(".picker >> text=Happened")
        p2.click("#resolve")
        p2.wait_for_selector(".sumgrid")
        audit(S, "journal outcome")
        exp_raw, exp_edge = journal_raw(0.75, True), journal_edge(0.75, 0.5, True)
        grid = [t.strip() for t in p2.eval_on_selector_all(".sumgrid .p b", "els => els.map(e => e.textContent)")]
        body = p2.inner_text(".sumgrid")
        check("the outcome card's baseline and edge match an independent computation from data/scoring.json",
              grid == [pct(0.5), signed(exp_edge)] and f"raw {signed(exp_raw)}" in body,
              f"{grid}, expected [{pct(0.5)}, {signed(exp_edge)}], raw {signed(exp_raw)} in {body!r}")
        rows = p2.eval_on_selector_all(".tbl tbody tr", "els => els.map(e => [e.children[0].textContent, e.children[1].textContent])")
        exp_rows = [[pct(c), signed(journal_edge(c, 0.5, True))] for c in STEPS]
        check("the outcome card's table of other numbers matches an independent computation at all eleven steps", rows == exp_rows, f"{rows} vs {exp_rows}")
    finally:
        S.page = keep
        ctx2.close()


def phase_final(S):
    errs = [t for ph, t in S.console if not (ph == "offline" and "net::ERR" in t)]
    check("no script errors and no console errors in the whole run", not errs, "; ".join(errs[:3]))
    check("every file the app asked for was found (no 404s)", not S.bad, "; ".join(S.bad[:3]))
    check("no request ever left this site", not S.outside, "; ".join(S.outside[:3]))
    check(f"every screen's tap targets are at least 44 px ({len(S.audited)} screens checked)", not S.taps, "; ".join(f"{k}: {v[:2]}" for k, v in list(S.taps.items())[:3]))
    check("no screen scrolls sideways, at 390 or 320 px", not S.overflow, str(S.overflow))
    blob = "\n".join(S.texts)
    check("the app never says Claude on any screen it showed", "claude" not in blob.lower())
    leaked = []
    for d, _, names in os.walk(os.path.join(REPO, "app")):
        for n in names:
            if n.endswith((".js", ".css", ".html", ".json", ".webmanifest")):
                with open(os.path.join(d, n), encoding="utf-8") as f:
                    if "claude" in f.read().lower():
                        leaked.append(os.path.relpath(os.path.join(d, n), REPO))
    check("and the word is nowhere in the app's files either", not leaked, ", ".join(leaked))


PHASES = [
    ("1 shell", phase_shell),
    ("2 baseline session 1", phase_baseline_1),
    ("3 baseline session 2, offline", phase_baseline_offline),
    ("4 baseline session 3 and the curve", phase_baseline_3),
    ("5 practice with instant reveal", phase_practice),
    ("6 lessons", phase_lessons),
    ("7 backup: export, erase, import", phase_backup),
    ("8 questions used up, disputes", phase_reuse),
    ("9 the timeout", phase_timeout),
    ("10 a gap of zero", phase_zero_gap),
    ("11 the journal", phase_journal),
    ("12 whole run", phase_final),
]


def main():
    root, tmp = tempfile.mkdtemp(prefix="predict-flow-"), tempfile.mkdtemp(prefix="predict-flow-files-")
    check("the question bank has unique claims, so the test can tell questions apart", len(BY_CLAIM) == len(BANK) == len(BY_ID), f"{len(BY_CLAIM)} claims, {len(BANK)} questions")
    T.deploy(root, "flowtest")
    server = T.Server(root)
    server.start()
    S = SimpleNamespace(server=server, tmp=tmp, g=0, expected=[], disputed=set(), slips=[], console=[], bad=[], outside=[], taps={}, overflow={}, texts=[],
                        audited=set(), phase="online", double_tap=None, guard_held=None, reload_ok=None)
    with sync_playwright() as p:
        S.browser = p.chromium.launch()
        S.ctx = S.browser.new_context(viewport=VIEW, device_scale_factor=2)
        S.ctx.add_init_script(NO_SHARE)
        S.ctx.add_init_script(SPY_PERSIST)
        S.page = S.ctx.new_page()
        attach(S, S.page)
        for name, fn in PHASES:
            print(f"\n== {name} ==", flush=True)
            try:
                fn(S)
            except Exception as e:  # a crash is a failure, and the next phase still runs
                traceback.print_exc()
                check(f"phase '{name}' ran to the end", False, f"{type(e).__name__}: {str(e)[:300]}")
                try:
                    S.page.screenshot(path=os.path.join(tmp, f"crash-{name.split()[0]}.png"))
                except Exception:
                    pass
            S.slips.clear()
        S.browser.close()
    server.stop() if server.is_up() else None
    shutil.rmtree(root, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + (f"   (files kept in {tmp})" if failed else ""))
    if not failed:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

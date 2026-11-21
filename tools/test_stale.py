#!/usr/bin/env python3
"""A phone that still holds an unfinished session from an older question bank must open and carry on.

The rebuilt bank no longer has the old question ids, so a session planned against the old bank names questions
that do not exist. The app used to stop with "Predict could not start"; it must skip those and draw fresh ones.

    python3 tools/test_stale.py
"""
import functools
import http.server
import os
import socketserver
import subprocess
import sys
import threading

from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORT = int(os.environ.get("PREDICT_PORT", "8777"))
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        fails += 1


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def seed_session(page, plan):
    page.evaluate(
        """(plan) => new Promise((res) => { const r = indexedDB.open('predict-record'); r.onsuccess = () => {
          const tx = r.result.transaction('events', 'readwrite');
          tx.objectStore('events').add({ id: 'zz-stale-session', t: new Date().toISOString(), d: new Date().toISOString().slice(0, 10),
            type: 'session', mode: 'baseline', unit: 'U0', size: 20, n: 1, plan });
          tx.oncomplete = () => res(); }; })""",
        plan,
    )


def main():
    subprocess.run(["sh", "tools/build_site.sh"], cwd=REPO, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    handler = functools.partial(Quiet, directory=os.path.join(REPO, "site"))
    srv = socketserver.TCPServer(("127.0.0.1", PORT), handler, bind_and_activate=False)
    srv.allow_reuse_address = True
    srv.server_bind(); srv.server_activate()
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{PORT}/index.html"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(service_workers="block")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_selector("#start", timeout=15000)
        seed_session(page, [f"old-bank-q{i}" for i in range(24)])
        page.goto(url)
        page.wait_for_selector("#start", timeout=15000)
        check("an unfinished session from an older bank still shows Resume session", page.inner_text("#start") == "Resume session", page.inner_text("#start"))
        page.click("#start")
        page.wait_for_function("document.querySelector('#claim') || document.body.innerText.includes('could not start')", timeout=10000)
        check("Resume opens a question, not the 'could not start' screen", page.query_selector("#claim") is not None, page.inner_text("body")[:100].replace("\n", " / "))
        check("no script errors", not errors, "; ".join(errors[:2]))
        claim = page.query_selector("#claim"); tag = page.query_selector(".tags .tag")
        check("the question on screen is one that exists in the current bank (it has a claim and a domain tag)",
              bool(claim and claim.inner_text().strip() and tag and tag.inner_text().strip()))
        check("the app never said Claude", "claude" not in page.content().lower())
        browser.close()
    srv.shutdown()
    print(f"\n{'all checks passed' if not fails else str(fails) + ' check(s) failed'}")
    sys.exit(1 if fails else 0)


main()

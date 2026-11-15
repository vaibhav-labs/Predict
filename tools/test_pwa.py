#!/usr/bin/env python3
"""Check the app the way GitHub Pages will serve it: under /Predict/, with a service worker, offline,
and across a deploy. Needs Playwright for Python and its Chromium (pip install playwright, then
playwright install chromium).

    python3 tools/test_pwa.py                 run the checks
    python3 tools/test_pwa.py --shots DIR     also save phone-size screenshots into DIR

The offline test is real: the test server is stopped and the page must still open from the cache.
Playing the game itself (sessions, saving, backup) is tools/test_flow.py's job; this file is about
installing, the cache, and deploys.
"""
import functools
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/Predict/"
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
results = []


def annotate_failure(name, detail=""):
    """On GitHub Actions a failing check also becomes a red annotation on the run. Anyone can read annotations from the
    public API without logging in, while the job log itself needs a login. Nothing happens anywhere else."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        message = (name + (f"  [{detail}]" if detail else ""))[:900]
        message = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title=FAIL::{message}", flush=True)


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    if not ok:
        annotate_failure(name, detail)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json", ".csv": "text/csv", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "max-age=600")  # what GitHub Pages sends
        super().end_headers()

    def log_message(self, *args):
        pass


class Server:
    def __init__(self, root):
        self.root, self.httpd = root, None

    def start(self):
        socketserver.ThreadingTCPServer.allow_reuse_address = True
        self.httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=self.root))
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    @staticmethod
    def is_up():
        try:
            urllib.request.urlopen(BASE, timeout=1).read()
            return True
        except Exception:
            return False


def deploy(root, build, marker=None):
    """Same steps as the Pages workflow: assemble site/, stamp the build id, publish under /Predict/."""
    subprocess.run(["sh", "tools/build_site.sh"], cwd=REPO, env=dict(os.environ, BUILD_ID=build), check=True, capture_output=True)
    dest = os.path.join(root, "Predict")
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(os.path.join(REPO, "site"), dest)
    if marker:  # change a data file so we can see whether a deploy's new content arrives
        path = os.path.join(dest, "data", "scoring.json")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        data["_deploy_marker"] = marker
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)


def build_of(page):
    return page.evaluate("(document.querySelector('meta[name=predict-build]') || {}).content || null")


def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name))


def wait_until(page, js, timeout=3000):
    try:
        page.wait_for_function(js, timeout=timeout)
    except Exception:
        pass


def main():
    root = tempfile.mkdtemp(prefix="predict-pwa-")
    server = Server(root)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---- deploy A, online ----
        deploy(root, "aaaaaaa")
        server.start()
        resp = page.goto(BASE)
        check("page loads under /Predict/", resp.ok, f"status {resp.status}")
        # ready = the worker has installed (shell cached) and activated; the first load is never controlled
        page.wait_for_function("async () => { await navigator.serviceWorker.ready; return (await caches.keys()).length > 0; }", timeout=10000)
        page.reload()
        page.wait_for_load_state("load")
        check("service worker controls the page after reload", page.evaluate("!!navigator.serviceWorker.controller"))
        scope = page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.scope)")
        check("service worker scope is the /Predict/ subpath", scope == BASE, scope)
        check("build id stamped into the page", build_of(page) == "aaaaaaa", str(build_of(page)))
        check("no horizontal scroll at 390 px", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        # The device card lives on the Coach tab. Routes are in the hash, so switching tab is not a reload.
        page.evaluate("location.hash = '#/coach'")
        page.wait_for_selector("#opens")
        check("saved-on-phone counter counts reopens", page.inner_text("#opens").strip() == "Opened 2 times", page.inner_text("#opens"))
        wait_until(page, "document.getElementById('offline').textContent.trim() !== 'checking'")
        check("device card: works offline says Ready once the shell is cached", page.inner_text("#offline").strip() == "Ready", page.inner_text("#offline"))
        listed = page.evaluate("fetch('./precache.json', {cache: 'reload'}).then(r => r.json())")
        cached = page.evaluate("caches.open('predict-shell-aaaaaaa').then(c => c.keys()).then(ks => ks.map(k => new URL(k.url).pathname))")
        missing = [f for f in listed if "/Predict/" + f not in cached]
        check("every file the app needs (scripts, styles, fonts, tables, questions) is in the offline cache",
              len(listed) > 30 and not missing, f"{len(listed)} listed, missing {missing[:3]}")
        check("the question bank and the fonts are among them", all(x in listed for x in ["content/questions/starter.json", "fonts/inter-latin-400-normal.woff2", "js/app.js", "css/app.css"]))
        shot(page, "1-online.png")

        cdp = ctx.new_cdp_session(page)
        try:
            manifest = cdp.send("Page.getAppManifest")
            check("manifest parses without errors", not manifest.get("errors"), str(manifest.get("errors")))
            install = cdp.send("Page.getInstallabilityErrors")
            check("Chrome reports no installability errors", not install.get("installabilityErrors"), json.dumps(install.get("installabilityErrors")))
        except Exception as e:
            check("manifest and installability via DevTools", False, str(e))
        cdp.detach()  # an attached DevTools session overrides Playwright's offline emulation

        for path in ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
                     "icons/apple-touch-icon.png", "sw.js", "data/scoring.json", "data/belts.csv"]:
            status, kind = page.evaluate("(u) => fetch(u).then(r => [r.status, r.headers.get('content-type')])", BASE + path)
            check(f"served: {path}", status == 200, f"{status} {kind}")
        before = page.evaluate("fetch('./data/scoring.json').then(r => r.text())")

        # ---- offline for real: the server is stopped ----
        server.stop()
        check("test server is really down", not server.is_up())
        page.reload()
        page.wait_for_load_state("load")
        check("opens with the server down", page.title() == "Predict", page.title())
        page.wait_for_selector("#opens")
        check("saved-on-phone counter still counts offline", page.inner_text("#opens").strip() == "Opened 3 times", page.inner_text("#opens"))
        ctx.set_offline(True)  # airplane mode
        page.reload()
        page.wait_for_load_state("load")
        check("opens in airplane mode", page.title() == "Predict", page.title())
        page.wait_for_selector("#conn")
        wait_until(page, "document.getElementById('conn').textContent.trim()==='Offline'")
        check("connection row says Offline in airplane mode", page.inner_text("#conn").strip() == "Offline", page.inner_text("#conn"))
        shot(page, "2-offline.png")
        ctx.set_offline(False)
        # Routes live in the hash (#/journal), never in the path: Pages has no server-side fallback and
        # every relative URL in the app depends on the page being served from /Predict/.
        page.goto(BASE + "?from=home#/journal")
        check("a hash route opens the shell offline", page.title() == "Predict", page.title())
        check("data file served from cache offline", page.evaluate("fetch('./data/scoring.json').then(r => r.text())") == before)

        # ---- deploy B (new build, changed data), back online ----
        deploy(root, "bbbbbbb", marker="bbbbbbb")
        server.start()
        page.goto(BASE)
        page.wait_for_load_state("load")
        check("a new deploy shows on the first open", build_of(page) == "bbbbbbb", str(build_of(page)))
        keys = []
        for _ in range(40):
            keys = page.evaluate("caches.keys()")
            if keys == ["predict-shell-bbbbbbb"]:
                break
            time.sleep(0.25)
        check("old cache deleted, only the new build's cache remains", keys == ["predict-shell-bbbbbbb"], str(keys))
        try:
            banner = page.wait_for_selector(".banner", timeout=8000)
            check("an app that was open when a new version arrived says so on Today", "A new version is ready." in banner.inner_text(), banner.inner_text())
            page.click(".banner button")
            page.wait_for_load_state("load")
            page.wait_for_selector(".nav")
            check("the Reload button loads the new version and the notice is gone", build_of(page) == "bbbbbbb" and page.query_selector(".banner") is None)
        except Exception as e:
            check("an app that was open when a new version arrived says so on Today", False, str(e)[:120])
        after = page.evaluate("fetch('./data/scoring.json').then(r => r.text())")
        check("a changed data file arrives after a deploy (not stale)", '"_deploy_marker"' in after)
        shot(page, "3-after-deploy.png")
        server.stop()
        page.reload()
        page.wait_for_load_state("load")
        check("still opens offline after the update", page.title() == "Predict" and build_of(page) == "bbbbbbb")
        check("no JavaScript errors on the page", not errors, "; ".join(errors))
        browser.close()

    shutil.rmtree(root, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

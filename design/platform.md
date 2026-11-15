# Predict: platform (installable web app on GitHub Pages)

Version 0.2 · Last updated: 2026-11-15 · Blocks 1 and 2 built · Companion to `mechanics.md` and the Build Plan doc

> **Summary.** Predict ships as an installable web app (a PWA) that GitHub Pages serves free from this
> repo at https://vaibhav-labs.github.io/Predict/. No domain is bought. The code and the content are
> public. The player's record is not: it lives in the phone's own storage and, from Block 5, can sync to
> a private repo. The builder pushes new content to this repo on a schedule, and every push redeploys
> the app.

---

## 1. Decisions

| Area | Choice | Why |
|---|---|---|
| App type | Installable PWA: manifest, service worker, works offline | A 15-minute daily habit needs an icon on the home screen and no waiting for a network |
| Hosting | GitHub Pages project site at `/Predict/`, deployed by `.github/workflows/pages.yml` on every push to `main` | Free, no server, live about a minute after a push |
| Domain | None: `vaibhav-labs.github.io/Predict` | Player decision |
| Stack | Plain HTML, CSS and JavaScript modules. No framework. No build step beyond `tools/build_site.sh` | One small app, nothing to upgrade, and the engine can be tested against the Python simulators |
| Record | Append-only event log in the phone's IndexedDB: one line per call, lock, resolve and update, each with an id and a time | Imports never double-count, and every statistic can be recomputed from the log |
| Backup | Export to a `.jsonl` file, Import merges by id. The app nudges a weekly Export | A phone can lose its storage; a backup file cannot be lost the same way |
| Sync | Block 5: a private repo `Predict-data` and a fine-grained token the player creates (Contents read and write on that one repo). The token stays in the phone's storage, never in code | The only way for the coach to read the record without running a server |
| Ask Predict | Block 5: copies a ready-made message (the question, the player's relevant numbers, the chain so far) and opens the chat where Predict answers | No API key and no server. Live in-app answers wait for an optional key-based version |
| Reminders | None at first: the app shows what is due when it opens | A static site has no push server |

## 2. What "public repo" means

- **Public:** the app code, the design docs, the data tables, the simulators, the starter questions,
  each weekly top-up of verified questions, world-question checks with their sources, `STATE.md`.
- **Never in this repo:** calls, predictions, flags, exams, coach letters, personal question text,
  record exports, tokens. `tools/check_data.py` stops a deploy if it finds a `.jsonl` file or a
  `predict-record*` or `predict-backup*` file anywhere in the tree.
- Where the personal data goes instead: the phone, and from Block 5 the private `Predict-data` repo
  (the record, the coach letters, the drill sets).

## 3. Repo layout

| Path | What it is |
|---|---|
| `app/` | The shipped app. `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`, `fonts/` (self-hosted Inter and Newsreader, with their licences), `css/app.css`, `js/` and `content/questions/starter.json` |
| `app/js/engine/` | Pure functions, no page and no storage: `scoring.js` (reads the rule from `data/scoring.json`), `expr.js` (a safe reader for the rule formulas), `record.js` (the event log, Export and Import, statistics, the calibration bands), `draw.js` (choosing questions), `csv.js` |
| `app/js/ui/` | The screens: `today`, `gym` (session, reveal, summary), `dial`, `mirror` (the curve), `path`, `lesson`, `coach` (Export, Import, Erase, the device check), `common` |
| `app/js/` | `app.js` (boot and routes), `store.js` (the one storage adapter), `lessons.js` (the four Unit 1 cards, every number computed from the payout table), `dom.js`, `build.js` (the build id) |
| `data/` | The design tables. `tools/build_site.sh` copies `scoring.json` and the CSVs to `site/data/`, so the app reads the same files the simulators do |
| `data/question_tables/` | The tables the question bank is built from, each row with its source page and the day it was read. Build time only: not copied to the site |
| `design/` | `mechanics.md`, `balance-report.md`, this file |
| `sim/` | Simulators and their outputs. `sim/tools/` (three helper scripts from the game-design skill) is not published |
| `tools/` | `build_site.sh` (assemble), `check_data.py` (gate), `make_questions.py` and `qbank/` (build the bank), `check_questions.py` (re-derive every answer), `test_engine.mjs`, `test_pwa.py`, `test_flow.py`, `make_icons.py` |
| `.github/workflows/` | `pages.yml` (check, assemble, deploy) and `tests.yml` (the browser tests, on pull requests and pushes) |
| `site/` | Build output. Ignored by git |

## 4. Deploy

1. A push to `main` starts the workflow.
2. `tools/check_data.py` fails the run if a JSON file or a table is broken, a personal file is present,
   or the question bank is wrong: it rebuilds the bank from its tables and compares it with the file on
   disk, checks the shape and balance, and works every claim out again (`check_questions.py`). The engine
   tests (`node --test tools/test_engine.mjs`) run next.
3. `tools/build_site.sh` copies `app/` and `data/` into `site/`, replaces `__BUILD__` with the short
   commit hash in `sw.js`, `index.html` and `js/build.js` (so every deploy has its own cache name), and
   writes `site/precache.json`, the list of every file the app needs offline.
4. The site is uploaded and deployed. If any step fails, the previous deploy stays live.
5. On the phone the service worker installs by fetching every file in `precache.json`, all or none: if one
   fetch fails the install fails and the phone keeps the version it has. Opening the app asks the network
   first (a new deploy shows at once) and keeps a copy; offline it opens the copy. Every other file comes
   from the current build's cache. When the new worker activates it deletes the old caches, and an app
   that was already open shows "A new version is ready" on Today. It never reloads by itself, so a
   session is never cut off.

One-time setup: **Settings, Pages, Build and deployment, Source: GitHub Actions.**

## 5. Content flow (builder to app)

The builder commits files to `app/content/` (and to `data/` when a table changes). The check runs, the
deploy runs, and the phone has the new content the next time it opens online and keeps it for offline.

| What | When | Where |
|---|---|---|
| 240-question starter bank (143 sourced, 83 computed, 14 by definition; half true, half false) | Block 1, built | `app/content/questions/starter.json`, generated by `tools/make_questions.py` from `data/question_tables/`. Change a table or a generator and run it again; never edit the file by hand |
| About 130 verified questions matched to the unit and weak bands | Weekly, from Block 5 | `app/content/questions/` |
| World-question checks with sources, five new world questions a week | Weekly, from Block 5 | `app/content/world/` |
| Predict's own forecasts (Block 10) | Before the week's questions open | `app/content/predict/`, so the commit time proves they were made first |

Every question carries its fact key's source page, the day it was read, and how it was verified
(`computed`, `definition` or `sourced`). `tools/check_questions.py` re-derives all 240 claims from the
tables and arithmetic, and it is mutation-tested: flipping any answer makes it fail. Difficulty labels
(easy, medium, hard) are a designer's first guess from the size of the gap in each claim, and are re-tuned
from the player's own hit rates later.

A bad push is rolled back by reverting the commit. A broken table, JSON file or question never deploys.

## 6. Record flow (phone to builder)

- **Before Block 5:** the player taps Export and shares the file into the chat when a review is wanted.
- **From Block 5:** the app pushes new events to the private `Predict-data` repo after each session and
  on open (the GitHub API accepts browser calls with the token in an Authorization header). The weekly
  review reads the record there and writes the letter and drill set back into the same repo, and the
  app pulls them on open.
- Import is idempotent: the same event id is never counted twice, so restoring a backup on top of a
  synced record is safe.

## 7. Rules for the app code

1. Relative URLs only, and routes live in the hash (`#/journal`). Pages has no server-side fallback, and
   every relative URL depends on the page being served from `/Predict/`.
2. No requests to other sites while the app runs: fonts are self-hosted, no CDN, no analytics. This keeps
   the app offline-safe and the record private.
3. The engine (scoring, gates, statistics, lesson triggers) is pure functions in `app/js/engine/`, with
   no page and no storage in them. Node tests check them against the Python simulators.
4. Storage sits behind one adapter (`app/js/store.js`): IndexedDB now, a sync adapter in Block 5.
5. Every tunable number is read from `data/`. None is written into the JavaScript.
6. A file that needs the build id must be added to the stamping loop in `tools/build_site.sh`; the build
   stops if a placeholder is left behind.
7. A button that sits where the next screen's button will appear (Lock in, Next call, the summary's buttons)
   ignores taps for `gym.tap_guard_ms` after its screen appears, so a double tap cannot answer the next
   question or skip a reveal.
8. After any change under `app/`, all of these must pass: `python3 tools/check_data.py`,
   `node --test tools/test_engine.mjs`, `sh tools/build_site.sh`, `python3 tools/test_pwa.py` and
   `python3 tools/test_flow.py` (the last two need Playwright and its Chromium). They run in Chromium only;
   Safari on a real iPhone is checked by hand with the "This device" card on the Coach tab.

## 8. Risks

| Risk | What happens | What the plan does |
|---|---|---|
| iPhone clears website data | Safari can delete a site's stored data after 7 days without a visit. An app installed to the home screen is exempt | Install first (the shell shows an install check), ask for persistent storage, nudge a weekly Export. Import restores everything |
| Two copies on one iPhone | The installed app and a Safari tab keep separate storage, so a record made in a tab is not in the app | Install first and play only in the installed app. Move a record between them with Export and Import |
| Stale files after a deploy | An old page runs against new content | Build id in the cache name, network first for the page, an all-or-nothing install, and an update notice. Covered by `tools/test_pwa.py` |
| Only Chromium is tested | A Safari-only quirk could slip through | The first phone check is the safety net (section 10). The code avoids syntax older than Safari 15 |
| A bad push | A broken table or file reaches the phone | The check gate stops the deploy, and the old deploy stays live until a new one succeeds |
| Token on the phone (Block 5) | A leaked token could read or write the private data repo | Fine-grained token for that one repo, Contents only, 90-day expiry, kept in the phone's storage, never in code or a URL. The app shows its expiry date. If the phone is lost, revoke it on GitHub |
| The weekly review needs write access to the private repo from a scheduled run | A scheduled run has its own credentials question | Block 5 spike. Fallback: the player starts the review chat and the builder commits from there |
| Public repo | Anyone can read the design, the question bank and `STATE.md` | By design. Nothing personal is committed, and the check gate enforces it |

## 9. Parked

Live in-app answers from Predict (needs an API key and a small proxy), push reminders, a custom
domain, an app-store listing.

## 10. Check it on a phone (about five minutes)

1. Settings, Pages, Source: GitHub Actions. Push to `main` (the first-push commands are in `STATE.md`) and wait for the green run.
2. iPhone: open https://vaibhav-labs.github.io/Predict/ in Safari, tap Share, Add to Home Screen.
   Android: browser menu, Install app.
3. Open it from the new icon and play from the icon from now on: an installed app keeps its own saved
   data, separate from Safari. Tap Start session and make one call.
4. Open the Coach tab and read the "This device" card: Opens as an installed app, Yes; Works offline,
   Ready; Saved on this phone, Opened 1 time (or more); Storage protected, Yes or Not granted;
   Connection, Online.
5. Close the app, turn on airplane mode, open it from the icon again. It must open, show the call you made,
   and let you play. The Connection row must say Offline.
6. Tap Export record on the Coach tab. The share sheet should offer Save to Files.

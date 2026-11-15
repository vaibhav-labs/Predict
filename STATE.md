# Predict: build state

Last updated: 2026-11-15 · Stage: Block 1 (The Dial) is built and passes all its tests in a desktop Chromium; it has not been pushed to GitHub or tried on a phone yet · Next: push, install on the phone, play a session; Block 2 (The Journal) only when the player says so

## What Predict is

A 15-minute daily game that trains calibrated judgment. Three loops: a gym of instant-answer
confidence calls, a journal of real predictions scored when reality resolves, and Predict as the coach
(a hand-off in the app, plus a weekly review). Failure patterns, never single misses, trigger lessons.
The long goal is a public forecasting track record.

## Where things live

- **The app:** an installable web app (PWA) on GitHub Pages, https://vaibhav-labs.github.io/Predict/,
  built from this repo (`vaibhav-labs/Predict`, public, MIT licence). `design/platform.md` is the
  platform contract: read it before touching `app/`.
- **Plan (living doc, the player's review copy):** https://claude.ai/artifact/BUo12qUvu7psyrBNYC7HDY
  Tabs: Plan, Evidence. Read it with the Claude Docs tools, including its comments and the
  "Decisions for you" table, before building anything. (The doc links need the player's login.)
- **Build plan (living doc):** https://claude.ai/artifact/J7HpkHhembY8mMigEmnco6
  Ten blocks with their needed-by days, the architecture, and the screens as they will look.
- **App snapshot (clickable screens):** https://claude.ai/artifact/GAVtBNxEpk6UH7aEBzbWnW
- **Design tables, simulators, balance report:** this repo (`data/`, `sim/`, `design/`), mirrored in the
  player's `Predict` folder on their Mac and in the "VJ Games" project under `predict/`.
- **Question bank:** `app/content/questions/starter.json`. It is generated: edit the tables in
  `data/question_tables/` or the generators in `tools/qbank/`, run `python3 tools/make_questions.py`, commit both.
- **Private data repo (from Block 5):** `Predict-data`, created by the player. It holds the record and the
  coach letters. Nothing personal ever goes in the public repo.

## What exists in the app today

Block 1 is built. Five tabs: Today, Journal (a card that says it arrives in Block 2), Mirror, Coach, Path.

- **The call.** A claim, Yes or No, and a dial of 11 steps from 50% to 99%. The points for a hit and a
  miss are shown before the call is locked, and come from `data/scoring.json`.
- **The gym.** The baseline (Unit 0) is 60 calls in 3 sessions of 20, half true and half false, no
  feedback until a session ends. Practice (Unit 1) is 18 calls a session with an instant reveal: verdict,
  points, the answer with its source link, and a flag for a disputed question. A question not answered
  in 60 seconds goes back to the pool. Every call is saved on the phone as it is made; closing the app in
  the middle leaves a Resume on Today.
- **Mirror.** The calibration curve, from 20 calls on, with thin bands (under 10 calls) drawn as such.
- **Path and lessons.** The units, and the four Unit 1 lesson cards, whose numbers are computed from the payout table.
- **Coach tab.** Export the record (a `.jsonl` file through the share sheet, or a download), the calls as a
  `.csv`, Import (the same file twice counts once), Erase (typed confirmation), and a "This device" card
  that checks installed, offline, saved and connection. The Ask Predict hand-off arrives in Block 5.
- **Question bank.** 240 questions: 120 true and 120 false; 96 easy, 84 medium, 60 hard; 83 computed, 14
  by definition, 143 sourced (each with a page link and the day it was read, 2026-11-15). Domains:
  geography 58, numbers 57, science 48, world 23, chance 19, economy 18, technology 17.
- **Install and offline.** The service worker installs all 40 files or none, opens with the server down
  and in airplane mode, and shows "A new version is ready" on Today after a deploy.
- **Tests, all passing, all in Chromium:** `node --test tools/test_engine.mjs` (24), `python3 tools/test_pwa.py`
  (33), `python3 tools/test_flow.py` (143, about 2 minutes), plus `python3 tools/check_data.py`, which also
  rebuilds the question bank from its tables and works all 240 claims out again with independent code.
  A fresh copy of the repo (what GitHub will check out) passes the same. The play-through test covers the
  baseline, practice, reload and resume, offline play, the summary and Mirror numbers against independent
  recomputation, lessons against the payout table, Export, Erase and Import, bad files, the 60-second
  timeout, a session answered only at 50% (its gap is exactly 0 and must read 0), double taps, tap-target
  sizes and no sideways scroll at 390 and 320 px.
- **Workflows.** `pages.yml` deploys on every push to `main` after `check_data.py` and the engine tests.
  `tests.yml` runs the three browser suites on pull requests and pushes and never blocks a deploy. It has
  not run on GitHub yet, so its first run may need a small fix.

## Not done, on purpose or not yet known

- The tests run in Chromium only. Safari on an iPhone cannot be run here, so the first phone check
  (design/platform.md, section 10) is the real test of install, offline and saved data.
- Whether an 18-call round fits in 5 minutes is not measured (open value 1). Every call records its
  milliseconds, so the first practice sessions answer it.
- Sessions are not limited to one a day, and there is no streak yet (Block 3).
- One question pool. The 70/30 unit split and the 90-day rule wait for Block 4.
- The difficulty labels, the shift of the mix when the hit rate leaves 65 to 85%, and the 10-call
  threshold for a thin band are first guesses, to be re-tuned from real hit rates.
- A sourced question was verified by reading one page (two agreeing pages for Olympics and World Cup rows).
  A flag on a question in the app is the player's way to catch a mistake; a flagged question is never
  drawn again.

## Decisions

2026-11-14

- Domains: work and projects, personal life, world events. Time: 15 minutes a day. First pass: plan only.
- Scoring: Brier-based points (50% scores 0, certainty +100, a miss at 99% scores -292); log rule from
  Unit 10; real predictions pay edge over a hidden baseline, weight 2.
- Curriculum: Units 0 to 12 in 4 arcs. Every gate is a fixed exam of fresh calls judged once.
- Lesson engine: instant note, autopsy, and 15 pattern triggers with repair drills and two re-tests.
- Build: 10 blocks, never more than one block ahead of where the player is. Six of them are needed in the first 24 days.
- Journal: one scored prediction a day with a six-link chain (claim, outside view, evidence with tests,
  case against, tripwire, number), and a five-lens case file when it resolves. Player request, same day.
  Effect (sim): 100 resolved real predictions on day 124, not 48; belts Yellow, Green, Brown wait for
  evidence (days 61, 184, 351). Journal counts in units.csv scaled to match.

2026-11-15 (player request, replaces the earlier "private web page" platform)

- Platform: an installable web app (PWA) hosted free on GitHub Pages from `vaibhav-labs/Predict`. No domain.
- The repo is public, so the code, tables, starter questions and design docs are public. The player's
  record is not: it lives on the phone (append-only event log, Export and Import) and, from Block 5, syncs
  to the private `Predict-data` repo with a token the player creates.
- The builder pushes content (question top-ups, world-question checks, later Predict's forecasts) to the
  public repo on a schedule; each push redeploys. Coach letters and drill sets go to the private repo.
- Ask Predict (Block 5) copies a ready-made message and opens the chat where Predict answers. Live
  in-app answers need an API key and a proxy, so they are parked.
- The coach is called Predict everywhere the player can see it. The builder's own name stays inside the plan docs.

2026-11-15 (the player went to sleep and said to build what could be built; the builder took these defaults)

- Block 1 was built before the one-time GitHub setup, because it needs nothing from GitHub to build.
- The seven plan choices were taken at their defaults and nothing contradicted them: the name Predict, the
  quiet dojo look, a Sunday-morning review, world topics of India policy and economy, world affairs, and
  technology and AI, a coach that may read the full record, and a start at the first session after the
  phone check. Only the name and the look touch Block 1. The context note (5 to 10 lines on current
  projects) is still the player's to write, and Block 5 needs it.
- The starter bank is general knowledge, so it is the same for every player and public. The world-topic
  questions arrive with the weekly top-ups in Block 5.
- The tap guard (`gym.tap_guard_ms`, 400) is new: a double tap cannot answer the next question or skip a
  reveal. The baseline curve shows from 20 calls (Mirror) and the summary text says so.
- The calibration gap is written in whole points by one function for both screens (`gapPts` in
  `app/js/engine/scoring.js`): a gap that rounds to zero reads 0, never +0 or −0. The first version printed
  "−0 pts" on Mirror; found in the screenshots, fixed, and pinned by a test.

## Waiting on the player

1. The one-time setup. First turn on Pages: github.com/vaibhav-labs/Predict/settings/pages, Source: GitHub
   Actions. Then run this in Terminal. The Mac folder is not a git repo yet, and the repo holds only its
   LICENSE, so these commands adopt the repo's history and keep every file here. The lines after `cd` move
   the two deploy files into `.github/workflows/` (the tool that wrote this folder is not allowed to write
   there, so they wait in `workflows-to-move/`) and, only if this Mac has no git identity yet, give this repo
   one with a private address. Each line runs only if the one before it worked.

   ```
   cd ~/Documents/Predict &&
   mkdir -p .github/workflows &&
   mv workflows-to-move/*.yml .github/workflows/ &&
   rmdir workflows-to-move &&
   git init -b main &&
   git remote add origin https://github.com/vaibhav-labs/Predict.git &&
   { git config user.name >/dev/null || git config user.name "vaibhav-labs"; } &&
   { git config user.email >/dev/null || git config user.email "vaibhav-labs@users.noreply.github.com"; } &&
   git fetch origin &&
   git reset origin/main &&
   git checkout -- LICENSE &&
   git add -A &&
   git commit -m "Predict: Block 1, The Dial" &&
   git push -u origin main
   ```

   (Tried against stand-in repos with the same shape: with and without a git identity, and with a refused
   push followed by a retry. Two commits, LICENSE untouched, nothing ignored is committed.) If the push is
   the step that fails (a sign-in), fix that and run only `git push -u origin main`; git asks for a personal
   access token, or use `gh auth login` or GitHub Desktop. A token must be allowed to change workflow files
   (the "Workflows" permission). If the first deploy ran before Pages was on, open the Actions tab and
   re-run it. When it is green, the app is live at https://vaibhav-labs.github.io/Predict/.
2. The first phone check, about five minutes (`design/platform.md`, section 10): install from Safari,
   play from the icon, open it in airplane mode, read the "This device" card on the Coach tab. Day 1 is
   the day Block 1 passes its exit test on the phone.
3. Look through the screens and say what feels wrong. One more, open value 13 in `design/mechanics.md`:
   belt evidence at one prediction a day (keep the 40, 150, 300 thresholds, or thin them).
4. Before Block 5: create the private `Predict-data` repo and a fine-grained token for it, and write the context note.

## How to resume

1. Read `design/platform.md`, then the plan doc's decisions table and any comments.
2. Read `design/mechanics.md` (algorithms, data model, the 14 OPEN values) and the data tables. Unit, belt
   and block days are in `data/timeline.csv`: Units 0 to 11 end on day 224.
3. Block 1 is done apart from the phone parts of its exit test (`data/build_blocks.csv`). Build Block 2
   (the Journal) only when the player says to.
4. After every change under `app/`, all of these must pass: `python3 tools/check_data.py`,
   `node --test tools/test_engine.mjs`, `sh tools/build_site.sh`, `python3 tools/test_pwa.py`,
   `python3 tools/test_flow.py`. The last two need Playwright and Chromium.
5. After each block: update this file, the change log in `design/mechanics.md`, and the plan docs.

## Rules to keep

- Every tunable number lives in a data file. Re-run `sh sim/run_all.sh` after any change (it needs the three
  helper scripts in `sim/tools/`, which are not in the public repo; copy them from the Mac folder).
- A gate is a fixed exam, never a rolling window.
- Only verified or computed questions count toward a gate.
- A prediction cannot change after it is locked.
- A lesson fires on a pattern with a minimum sample, never on one miss.
- The coach is called Predict everywhere the player can see it: the button says "Ask Predict". The builder's
  own name never appears in the app (the tests check every screen and every file).
- Never commit the player's record, a backup, a token or personal question text to the public repo.
- Relative URLs only; routes live in the hash; no requests to other sites while the app runs.
- A button that sits where the next screen's button will appear ignores taps for `gym.tap_guard_ms`.
- An event never stores an undefined field: what is saved and what is exported must be the same record.

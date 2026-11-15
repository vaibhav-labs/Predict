# Predict: build state

Last updated: 2026-11-15 · Stage: Blocks 1 (The Dial) and 2 (The Journal) are on `main`, merged and live
at https://vaibhav-labs.github.io/Predict/ (commit `fa252f5`). Block 3 (The Mirror) is built and tested on
branch `block-3`, waiting to be pushed and merged. Nothing has been tried on a phone yet · Next: the phone
checks (below); the later blocks are built one after another on their own branches (see "Build log")

## Report for the player (Block 3, 2026-11-15)

Block 3, the Mirror, passes its exit test (`data/build_blocks.csv`, row BL3: every statistic matches an
independent recomputation from the raw history). `tools/ref_mirror.py` recomputes every number from the raw
event log with different code (the Wilson interval solved as a quadratic, the streak and the level walked
with plain loops, the groups built with dictionaries), and `tools/test_blocks.py` loads a synthetic
player's record through the real Import button, fixes the clock, and compares what the screens show with it.

**What's there.** Today now shows the level (with the points to the next one), the streak and the seven-day
score. The Mirror has a standing card (level, career points, the streak, seven daily bars, whether today
beats the seven days before), the calibration curve with a 95% error bar on every dot and the number of
calls under it (gym or journal), the bias map (the gap by topic for the gym, by domain or by horizon for
the journal, each with its interval and a verdict that is read from the interval and never from the gap
alone), the journal-only record (resolved, void, extra, kept out, what happened, what you said, the edge, and
a grid of domain by horizon with the number of cards and the average edge in each cell), the five belts with
real progress, and the plain numbers table. A resolved card's case file now has its five lenses in order, and
the fourth, your pattern, shows the journal-only record for that card's domain, horizon and cell with every
sample size ("too few" under 10), and says in one sentence why a card is kept out of the record when it is.

**A fix on the way.** The table of other numbers on a resolved card did not mark (or contain) the number you
said when it fell between two dial steps or below 50%. It now runs on the side the card leaned to and always
holds your own number, once, marked. Found by the new case-file test; pinned by a new engine test.

**Assumptions taken:** see "Block 3 assumptions" below. In short: what counts as a played day, a seven-day
score that leaves habit points out, verdicts read from the interval, and a belt never shown as earned until
its gates exist.

**Tests, all passing, in Chromium:** `python3 tools/check_data.py`; `node --test tools/test_engine.mjs` (49);
`python3 tools/test_pwa.py` (33); `python3 tools/test_flow.py` (166, about 2 minutes); and the new
`python3 tools/test_blocks.py` (97), which also runs on GitHub Actions. A second bug turned up and was fixed
while adding the stored `flags` and `flagged` checks: a blank claim box counted as "the checker flagged this
draft", because an empty claim always lacks a date.

**What the phone check for Block 3 should cover:** open the Mirror after a few days of play and see whether
the standing card, the error bars and the verdict words make sense to you (a hollow dot means too few
calls to trust it); read a resolved card's case file and see whether lens 4 tells you something or just
repeats the numbers. Open values 4 (points a day) and 13 (belt evidence at one prediction a day) can only
be settled from real play: the seven-day card and the belt rows are where you will see them.

## Report for the player (Block 2, 2026-11-15)

Block 2, the Journal, is merged into `main` and live and passes its exit test
(`data/build_blocks.csv`, row BL2) in a desktop Chromium: `python3 tools/check_data.py`,
`node --test tools/test_engine.mjs` (36 passed), `sh tools/build_site.sh`, `python3 tools/test_pwa.py`
(33 passed), `python3 tools/test_flow.py` (162 passed, about 3 minutes). That run includes both worked
edge examples from `design/mechanics.md` (4.3 and 4.9) coming out exactly, a full write-check-chain-lock
play-through, a locked card refusing every edit (in the UI and at the storage layer), a due card
appearing on the right day under a controlled clock, and the outcome card's table of other numbers
checked against an independent computation.

**What's there:** the prediction card with its six-link chain (claim, outside view with its own
reference-class rate, up to three evidence signals each marked up or down, case against, tripwire, a
1-99% probability); an in-app, offline checker (no date, a vague word, not observable, self-controlled,
`data/checker_rules.csv`) with an Ask Predict button that copies a ready-made message to the clipboard
(never a link, never a network call); lock, after which the claim, chain, due date and probability
cannot change; a due list on the Journal tab split into Due, Open and Recently resolved; resolve
(Happened, Didn't happen, Void) with a one-line note; edge points scored against a hidden base-rate
baseline (revealed right after lock, not withheld until resolution); three horizons (week, month,
longer) for that baseline; and an outcome card with the table of what the edge would have been at the
gym's other confidence steps. One scored prediction a day; extra ones are logged but unscored.

**Assumptions taken:** see "Block 2 assumptions" below. In short: due-date day counts, three horizon
buckets from the four due-date choices, a flat 50% starter baseline table, a five-resolved threshold
before switching to the player's own rate, the checker's word lists, and always scoring the journal
with the core (Brier) rule. Nothing in Block 2's scope needed the player's own decision.

**What the phone check for Block 2 should cover:** write one real prediction with its full chain and
see whether 4 minutes is enough (every lock records its own timing, like Block 1's calls do, so this is
also a first answer to open value 1's twin question for the journal); try the checker on a few of your
own sentences and see whether the four flags feel right; tap Ask Predict and confirm the message pastes
from the clipboard into a chat; leave a card open overnight (or just a day) and see it move from Open to
Due the next time you open the app; and resolve one for real.

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

Blocks 1 and 2 are on `main`; Block 3 is built on `block-3`. Five tabs: Today, Journal, Mirror, Coach, Path.

- **The call.** A claim, Yes or No, and a dial of 11 steps from 50% to 99%. The points for a hit and a
  miss are shown before the call is locked, and come from `data/scoring.json`.
- **The gym.** The baseline (Unit 0) is 60 calls in 3 sessions of 20, half true and half false, no
  feedback until a session ends. Practice (Unit 1) is 18 calls a session with an instant reveal: verdict,
  points, the answer with its source link, and a flag for a disputed question. A question not answered
  in 60 seconds goes back to the pool. Every call is saved on the phone as it is made; closing the app in
  the middle leaves a Resume on Today.
- **The journal.** One real prediction a day, written as a six-link chain (claim, outside view with its
  own rate, up to three evidence signals marked up or down, case against, tripwire, a 1-99% probability)
  and checked by rules in the app (no date, a vague word, not observable, self-controlled,
  `data/checker_rules.csv`), with an Ask Predict button that copies a ready-made message (never a link,
  never a request off this site). A lock makes the claim, chain, due date and probability immutable; the
  hidden baseline (the player's own rate for that domain and horizon once 5 have resolved there, else a
  starter table, else 50%) is revealed right after. Cards move from Open to Due on their due day; the
  Journal tab lists Due, Open and the ten most recently resolved. Resolving one (Happened, Didn't happen,
  Void) pays edge points (weight 2) against the baseline and shows the table of what the edge would have
  been at every one of the gym's other confidence steps. One scored card a day; extra ones are logged
  unscored.
- **How to play.** A help screen (`#/help`, opened from the "?" next to the date on Today) explaining the
  daily loop, the dial, baseline vs practice, the journal's six-link chain, the calibration gap, and the
  journal's baseline and edge, plus what is not built yet (belts, levels, streak, Predict reading or
  answering inside the app). Not tied to a build block: added on request, independent of `data/build_blocks.csv`.
- **Mirror (Block 3).** A standing card (level, career points, streak, seven daily bars), the calibration
  curve from 20 calls on with a 95% error bar and the number of calls on every dot (thin bands, under 10
  calls, drawn hollow and dashed), the bias map by topic, domain or horizon, the journal-only record with a
  domain-by-horizon grid, five belts with real progress and the plain numbers table. Today carries the same
  level, streak and seven-day score. A resolved card's case file has its five lenses; lens 4 is your pattern.
- **Path and lessons.** The units, and the four Unit 1 lesson cards, whose numbers are computed from the payout table.
- **Coach tab.** Export the record (a `.jsonl` file through the share sheet, or a download), the calls as a
  `.csv`, Import (the same file twice counts once), Erase (typed confirmation), and a "This device" card
  that checks installed, offline, saved and connection. The Ask Predict hand-off arrives in Block 5.
- **Question bank.** 240 questions: 120 true and 120 false; 96 easy, 84 medium, 60 hard; 83 computed, 14
  by definition, 143 sourced (each with a page link and the day it was read, 2026-11-15). Domains:
  geography 58, numbers 57, science 48, world 23, chance 19, economy 18, technology 17.
- **Install and offline.** The service worker installs all 40 files or none, opens with the server down
  and in airplane mode, and shows "A new version is ready" on Today after a deploy.
- **Tests, all passing, all in Chromium:** `node --test tools/test_engine.mjs` (36), `python3 tools/test_pwa.py`
  (33), `python3 tools/test_flow.py` (162, about 3 minutes), plus `python3 tools/check_data.py`, which also
  rebuilds the question bank from its tables and works all 240 claims out again with independent code.
  A fresh copy of the repo (what GitHub will check out) passes the same. The play-through test covers the
  baseline, practice, reload and resume, offline play, the summary and Mirror numbers against independent
  recomputation, lessons against the payout table, Export, Erase and Import, bad files, the 60-second
  timeout, a session answered only at 50% (its gap is exactly 0 and must read 0), double taps, tap-target
  sizes, no sideways scroll at 390 and 320 px, and (Block 2) the checker, Ask Predict, a locked card
  refusing edits, a due card on the right day under a controlled clock, resolve, and the outcome card's
  numbers against an independent computation.
- **Workflows.** `pages.yml` deploys on every push to `main` after `check_data.py` and the engine tests;
  green on every push so far. `tests.yml` runs the three browser suites on pull requests and pushes to
  `main` and `block-*`, pinned to `ubuntu-24.04` and `playwright==1.65.2` with a runner-diagnostics
  `::notice::` as its first step, and never blocks a deploy; a failing check now also becomes a GitHub
  Actions annotation (`T.annotate_failure` in `tools/test_pwa.py`), readable from the public API without
  a login, since the job log itself needs one. That annotation caught a real bug on commit `945a226`: a
  click race in the test's own `tab()` helper (`tools/test_flow.py`) — it queried the nav link, then
  called `.click()` on that handle, and if the SPA's route replaced the screen in between, the handle
  pointed at a detached element. Fixed in `fa252f5` by clicking the selector instead of a cached handle,
  which Playwright auto-waits and re-resolves on. That almost certainly explains the first run's failure
  too (commit `944ee64`, before this annotation existed to say which check): same helper, same app, and
  the fix is in the test harness, not `app/`. Green since, on both `block-2` and `main`.

## Not done, on purpose or not yet known

- The tests run in Chromium only. Safari on an iPhone cannot be run here, so the first phone check
  (design/platform.md, section 10) is the real test of install, offline and saved data.
- Whether an 18-call round fits in 5 minutes is not measured (open value 1). Every call records its
  milliseconds, so the first practice sessions answer it.
- Sessions are not limited to one a day (the streak counts played days, so extra sessions add nothing to it).
- One question pool. The 70/30 unit split and the 90-day rule wait for Block 4.
- The difficulty labels, the shift of the mix when the hit rate leaves 65 to 85%, and the 10-call
  threshold for a thin band are first guesses, to be re-tuned from real hit rates.
- A sourced question was verified by reading one page (two agreeing pages for Olympics and World Cup rows).
  A flag on a question in the app is the player's way to catch a mistake; a flagged question is never
  drawn again.
- Block 2 ran only in Chromium too; writing a chain with a thumb, and whether a card really moves from
  Open to Due on the phone's own clock, are untested until the phone check above.
- The starter baseline table (`data/journal_baselines.csv`) is flat at 50% for every domain and horizon,
  and the five-resolved threshold before switching to the player's own rate
  (`journal.own_rate_min_resolved`) is a first guess: both wait for real baselines (open value 2).
- The case file has its five lenses, but the autopsy, the audit of the chain, the luck-or-judgment
  reading beyond the plain edge, and the rule card wait for Block 4 as planned.
- Updating an open prediction (Block 8), the memory check (Unit 8, Block 9) and Predict's own baseline
  (Block 5) are not built; none of them are in Block 2's scope.

## Block 2 assumptions

Where the docs left a choice, the simplest option that fit them was taken and the build went on. Nothing
in Block 2's scope needed a decision only the player could make.

- **Three horizons from four due-date choices.** The due-date template (`tomorrow, this week, this
  month, longer`, mechanics.md 4.3) stays as four player-facing choices, but the baseline table and the
  belts (`data/belts.csv`'s "month-horizon") only need three buckets, so `tomorrow` and `this week` share
  the `week` bucket (`data/scoring.json`, `journal.horizon_of_due`).
- **Due-date day counts.** `tomorrow` = 1 day, `week` = 7, `month` = 30, `longer` = 90
  (`journal.due_offset_days`): nothing in the docs fixes a calendar rule yet.
- **Starter baseline table.** `data/journal_baselines.csv` is flat at 50% for every domain and horizon: a
  neutral placeholder rather than an invented domain-specific guess, left to be retuned once real
  baselines exist (open value 2).
- **Own-rate threshold.** The player's own rate replaces the starter table once 5 or more real
  predictions have resolved in that domain and horizon (`journal.own_rate_min_resolved`); below that, the
  starter table (then 50%) is used, matching 4.3 step 4's "a starter table... until there is history."
- **The journal always scores with the core rule** (`brier_points`), never the gym's sharp rule: both
  worked examples in mechanics.md (4.3 and 4.9) use it throughout, and nothing ties journal scoring to a
  gym unit.
- **The checker is rule-based, not a model call:** four flags (no date, a vague word, not observable,
  self-controlled), each a `require` or `forbid` pattern in `data/checker_rules.csv`. The "no date" flag
  checks the claim's own wording even though the due date is also a separate required field, matching
  the template "By [date], ...".
- **Ask Predict copies a message to the clipboard, never a link:** the app may never call a model or
  leave this site, and the builder's own name may never appear under `app/`.
- **The outcome card's "table of other numbers"** reuses the gym's eleven confidence steps (50 to 99%,
  `binary.dial_steps`) rather than a new scale, since both worked examples in mechanics.md 4.9 land on
  values from that table.
- **Extra same-day predictions** still get a real baseline, a resolve flow and a raw score; only their
  `edge` is withheld (`scored: false`), so the full chain and the outcome card still work for them.
- `sim/run_all.sh` was not re-run: the three helper scripts it needs live only on the player's Mac
  (`design/platform.md`, `sim/` note), and none of the new numbers above feed the balance report.

## Block 3 assumptions

Where the docs left a choice, the simplest option that fit them was taken. None needed the player.

- **A played day** is a day with a call, a locked prediction or a resolved prediction (`mirror` and `habit`
  notes in `data/scoring.json`). A session that was opened and closed with no call is not a played day.
  Habit points are paid once per played day however many sessions it holds, so at most 120 a day.
- **The seven-day score is skill points only** (call points plus journal edge points), averaged over the days
  played in the window, so attendance cannot raise it. Days not played are not zeros.
- **Verdicts are read from the 95% Wilson interval** (`mirror.error_bar_z`, 1.96), not from the gap alone:
  a sample that cannot support a claim says "no clear bias" or "too few" (under `mirror.thin_below`, 10).
- **A journal card is written like a gym call** for the map: confidence on the side it leaned to (50% leans
  Yes, as the dial does), a hit when that side was right, and its edge as its points.
- **Belts show progress, never an award.** Only the baseline (U0) counts as a passed gate when its three
  sessions are done; every other gate waits for Block 4's exams. The fifth belt is external.
- **Career points are a high-water mark** of the running total of call points, edge points and habit points,
  so a bad day cannot lower the level. The level cost is `140 * L^1.2` rounded half to even, which
  reproduces `data/levels.csv` exactly.
- **Bias map range** is plus and minus 30 points; a gap beyond that is drawn at the edge of the chart and
  printed in full in the list under it.
- **Open values 4 and 13** (points a day, belt evidence at one prediction a day) are not settled by this block:
  the numbers to settle them now exist on the screen, and real play is what is missing.

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

1. ~~The one-time GitHub setup.~~ Done: the repo is live at https://vaibhav-labs.github.io/Predict/,
   now serving Block 2, commit `fa252f5` on `main`.
2. The first phone check, about five minutes (`design/platform.md`, section 10): install from Safari,
   play from the icon, open it in airplane mode, read the "This device" card on the Coach tab. Day 1 is
   the day Block 1 passes its exit test on the phone. Block 2's phone check (above) is still open too.
3. Look through the screens and say what feels wrong. One more, open value 13 in `design/mechanics.md`:
   belt evidence at one prediction a day (keep the 40, 150, 300 thresholds, or thin them).
4. Before Block 5: create the private `Predict-data` repo and a fine-grained token for it, and write the context note.
5. ~~`tests.yml`'s first real run (commit `944ee64`) failed with no readable log.~~ Resolved: failing
   checks now post a GitHub annotation, readable from the public API without a login
   (`T.annotate_failure`). That mechanism then caught a real click race in the test's own `tab()`
   helper on a later push (`945a226`), fixed in `fa252f5` — almost certainly the same bug that failed
   `944ee64` silently. Green since.

## How to resume

1. Read `design/platform.md`, then the plan doc's decisions table and any comments.
2. Read `design/mechanics.md` (algorithms, data model, the 14 OPEN values) and the data tables. Unit, belt
   and block days are in `data/timeline.csv`: Units 0 to 11 end on day 224.
3. Blocks 1 and 2 are done, merged into `main` and live; Block 3 is built on `block-3` (see "Build log").
   The phone parts of their exit tests (`data/build_blocks.csv`) are still the player's to run.
4. After every change under `app/`, all of these must pass: `python3 tools/check_data.py`,
   `node --test tools/test_engine.mjs`, `sh tools/build_site.sh`, `python3 tools/test_pwa.py`,
   `python3 tools/test_flow.py`, `python3 tools/test_blocks.py`. The last three need Playwright and
   Chromium. Run them in separate copies of the repo when running them at the same time: `build_site.sh`
   rebuilds `site/` from scratch.
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

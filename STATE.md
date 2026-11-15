# Predict: build state

Last updated: 2026-11-15 · Stage (Block 4 built on `block-4`; older text follows): Blocks 1 (The Dial) and 2 (The Journal) are on `main`, merged and live
at https://vaibhav-labs.github.io/Predict/ (commit `fa252f5`). Block 3 (The Mirror) is built and tested on
branch `block-3`, and the rebuilt question bank (judgment and prediction, not trivia) is on `block-4`, both
waiting to be pushed and merged. Nothing has been tried on a phone yet · Next: the phone checks (below); the
later blocks are built one after another on their own branches (see "Build log")

## Report for the player (Block 5, the Coach, 2026-11-15)

Block 5 is built and tested against a pretend GitHub: what cannot be tested from here is your own private repository and a real weekly run, so the
exit test's "first weekly letter built from your real data" waits on you (below).

**What's there.** The Coach tab can connect to a private repository (you paste `your-name/Predict-data` and a token). The record goes there one file a day
and only ever adds: a second push writes nothing, a second phone's events come back, a public repository or a token that cannot write is refused. When the
weekly review has written `coach/latest.json` the app shows its letter and drill set on the Coach tab (Today shows a card until you open it), three ideas for the
day on the journal's write screen (tapping one starts the claim), Predict's read of a resolved card in its case file, Predict's outside-view number as a card's
baseline when it arrived before the due day, and, for world cards, what Predict looked up with the page it read (you still press Resolve, and the page is saved
with your answer). Anything without a source link, or not https, is not shown. Ask Predict on the Coach tab copies a message with your week's numbers.
`topups.json` is the place the weekly review's verified questions land.

**The review itself** is a scheduled task: its prompt, the file's shape and the setup are in `design/coach.md`. `tools/weekly_packet.py` builds its inputs from your
record, `tools/coach_validate.py` says what the app would drop, `tools/merge_topups.py` turns proposed questions into the shipped file.

**Tests:** `python3 tools/test_coach.py` (the app's reading of the file against independent Python rules, the packet, the top-up merge); 23 new engine tests
(95 in all); a browser phase `b5` against a pretend GitHub (token only on the phone and only to api.github.com, wrong token, public repo, offline, disconnect, erase,
the letter, ideas, baselines, the source link). All the suites pass: engine 95, `test_pwa.py` 33, `test_flow.py` 166, `test_blocks.py` 238.

**What you need to do (about ten minutes, see `design/coach.md`):** make the private repository `Predict-data` (with a README), make a fine-grained token for it
(Contents: read and write, 90 days), paste both into the Coach tab, write `coach/context.md`, and say whether you want the weekly review scheduled from here (it needs
read and write access to that repository). Until then everything works without it.

## Report for the player (Block 4, the Lesson Engine, 2026-11-15)

Block 4 passes its exit test (`data/build_blocks.csv`, row BL4). A synthetic overconfident history fires L01 and a
calibrated one does not, at the simulated rates; the gate passes and fails the right synthetic players; a synthetic miss
at 85% opens the autopsy and builds a case file with all five lenses. `tools/ref_lessons.py` re-implements the trigger
walk, the gate and the autopsy queue in different code, and both the engine tests and the browser tests compare what the
app shows with it.

**What's there.** Predict now reads your own record for habits and tells you only when enough calls say so: too sure at
90 to 99% (L01), too shy at 60 to 80% (L02), too many 50 to 55% calls (L03), vague journal predictions (L04) and missed
days (L15). A pattern comes with a one-minute lesson, a drill (a wheel check, forced steps, a locked zone, or rewriting
vague predictions) and two re-tests on your normal play, 3 and 10 days later. A miss at 80% or more gets a two-line note
under the reveal. The Unit 1 exam is 200 fresh calls in 10 sittings of 20 with nothing shown until the end; a pass counts
toward the first belt, a fail names its reasons and sends you to a repair drill. A miss at 85% or more (and one confident
hit in five) gets a short autopsy before your next journal step, and its rule sits above your next five cards.

**Tests, all passing, in Chromium:** `python3 tools/check_data.py`; `node --test tools/test_engine.mjs` (72);
`python3 tools/test_pwa.py` (33); `python3 tools/test_flow.py` (166); `python3 tools/test_blocks.py` (203), which also runs
on GitHub Actions. The Mirror's belts count a passed Unit 1 gate (the Yellow row reads 2 of 4 after baseline and exam).

**Found on the way.** The app icons carried embedded text naming the assistant; they were regenerated (pixel-identical) and
the checks now scan every file under `app/`, pictures included, for the banned word. `check_data.py` also checks that the
lesson thresholds agree with `data/lesson_triggers.csv`.

**What the phone check for Block 4 should cover:** whether a flag's lesson reads as help rather than a scolding, whether
the exam's ten sittings feel like a fair length across days, and whether the note under a miss tells you something. Open
risk: L02's re-test (60 calls, 7 points) fails a calibrated player about a third of the time; see
`design/balance-report.md` 4c.

## Report for the player (the question bank, rebuilt for judgment, 2026-11-15)

You said the questions tested arithmetic and hard knowledge, and you wanted judgment and prediction. The old
bank (240 almanac, arithmetic and chance items) is gone. Every question is now a call about how something
turns out, and the reveal always shows how often it goes that way.

**What a question looks like.** A scene, then a claim about it. "Seattle, 4 December. It rained yesterday. No
measurable rain falls today." Or: "A flight from Kansas City to Tulsa is due to leave at 2:25 pm on a Monday in
February. It lands no more than an hour late." You say yes or no and how sure you are. The reveal gives the
answer, what really happened, how often claims like this held among the other cases in the record (and how
many other cases there are), what the base rate alone would have said, one lesson line, and a link to the
source.

**Where the cases come from.** Real records, committed in `data/question_tables/` with the page they came from
and the day they were read (`sources.csv`): Seattle's daily weather for 2012 to 2015 (NOAA, via vega-datasets),
20,000 US flights from January to March 2001 (BTS), the S&P 500's monthly history since 1950 (Robert Shiller's
data), and six Our World in Data series (life expectancy, child mortality, CO2 per person, income per person,
renewable share of electricity, births per woman), used as five-year trends: "will it keep going?". On top of
that, 37 documented base rates from named sources (business survival from BLS, fund managers against the index
from SPIVA, Olympic budgets, NCAA upsets, drug approval odds, hurricane seasons, recessions, and more), each with
the words or the table row that show the number. A claim about one of those is only asked when its threshold is
clear of the documented value, and how far it is sets the difficulty.

**The bank.** 240 starter questions (120 true, 120 false; 96 easy, 84 medium, 60 hard; 220 from the records and
20 from documented facts; weather 73, travel 64, world 67, money 26, life 4, sport 3, work 3) and a separate
pool of 304 for the Unit 1 exam (152 true, 152 false; 24 easy, 114 medium, 166 hard) that practice never shows.
The two share no question and no case (no day, flight, country or year), so a practice reveal cannot give an
exam answer away.

**How we know it is right.** `tools/check_questions.py` shares no code with the builder. It reads the records
and the question text and works every answer, every printed percentage, the number of other cases and the
difficulty out again (weather and flights with SQL on the committed tables, trends and markets from the tables,
each documented fact from its widened range). It also tests the bank for fairness: cases were drawn without
looking at how they turned out, and a z-test says a player who knew every base rate would be calibrated on it
(overall z = +0.09 on the starter, +0.91 on the exam; limit 3). It rebuilds the files from the tables and
compares them with what is on disk. I broke the checker on purpose 22 ways (a flipped answer, an edited weather
day, a changed percentage, a moved threshold, a missing source row, the builder's name slipped into a question,
a duplicated claim, and so on) and it caught every one. The build is now identical on every run (it was not
before: the order depended on Python's hash seed; the checker found it).

**Where it is honest rather than perfect.** The "base rate" is the share of the other cases in the same record,
not a forecast of the future: four years of Seattle, one winter quarter of flights in 2001, and 73 years of the
market. Stretches of the market overlap, so they hold fewer independent cases than their count (the reveal says
so). A year that follows a fall or a boom has only 17 to 19 other cases and the reveal prints that number. A
documented fact gives at most one question to a bank. Sport, work and life have only three or four questions each
in the starter, so the Mirror's topic bars for them are thin for now. Flag any question you disagree with and it
never comes back.

**What would make it better, if you want it.** More families of real cases: IPL results (batting first or
chasing, toss, totals) would give sport a proper family and feel closer to home; more documented facts for work
and life. Jobs data (FRED) could not be reached, so there is no unemployment family yet.

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
- **Question bank:** `app/content/questions/starter.json` (practice and baseline) and `exam-u1.json` (the Unit 1
  exam pool, never shown in practice). Both are generated: edit the tables in `data/question_tables/`
  (`base_rates.csv` holds the documented facts, `sources.csv` the source of every record table) or the generators
  in `tools/qbank/` (`records.py`, `curated.py`), run `python3 tools/make_questions.py`, commit both.
  `tools/snapshot_tables.py` is how the record tables were first fetched; the app never fetches anything.
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
- **Path and lessons.** The units, the Unit 1 exam card (Not open yet, Ready, In progress, Repair first, Passed, Rust), the
  four Unit 1 lesson cards (numbers computed from the payout table), and each pattern flag with where it stands.
- **Coach (Block 5).** Weekly letter and drill set, a private-repository card (connect, sync now, disconnect), Ask Predict (copies this week's numbers),
  today's three ideas on the journal write screen, a check with its source on a due world card, Predict's read in the case file, Predict's baseline on a card.
- **Lesson engine (Block 4).** Pattern flags (`#/flag/<id>`): evidence, the lesson, the drill, re-test progress. Drills in the
  gym (`#/gym/drill-<id>`) and the rewrite drill (`#/rewrite/<id>`). The sealed exam (`#/exam/<id>`) with verdict, bands and
  repair. The autopsy (`#/autopsy/<id>`). Minimum session when days are missed. The help screen explains all of it.
- **Coach tab.** Export the record (a `.jsonl` file through the share sheet, or a download), the calls as a
  `.csv`, Import (the same file twice counts once), Erase (typed confirmation), and a "This device" card
  that checks installed, offline, saved and connection. The Ask Predict hand-off arrives in Block 5.
- **Question bank.** 240 judgment questions: 120 true and 120 false; 96 easy, 84 medium, 60 hard; 220 `recorded`
  (a real case from a committed table, with the base rate among the other cases and how many there are) and 20
  `sourced` (a documented rate, `Checked 2026-11-15`). Domains: weather 73, travel 64, world 67, money 26, life 4,
  sport 3, work 3. Each question is a scene (`lead`) and a claim (`ask`); the reveal adds the base-rate line and a
  source link. Plus the Unit 1 exam pool: 304 questions, never shown in practice (not yet loaded by the app: Block 4).
- **Install and offline.** The service worker installs all 40 files or none, opens with the server down
  and in airplane mode, and shows "A new version is ready" on Today after a deploy.
- **Tests, all passing, all in Chromium:** `node --test tools/test_engine.mjs` (49), `python3 tools/test_pwa.py`
  (33), `python3 tools/test_flow.py` (166, about 3 minutes), `python3 tools/test_blocks.py` (97), plus
  `python3 tools/check_data.py`, which also rebuilds both question banks from their tables and works every claim
  out again with independent code.
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
- Questions seen in the last 90 days are not served again; 30% of each session is review. When nothing is left outside that window the oldest are reused (the exam's `reused` count says how many).
- The difficulty labels, the shift of the mix when the hit rate leaves 65 to 85%, and the 10-call
  threshold for a thin band are first guesses, to be re-tuned from real hit rates.
- A documented fact was verified by reading its source page, and the table keeps the words or the row that show
  the number. A recorded question is re-derived from the committed table by independent code. A flag on a
  question in the app is the player's way to catch a mistake; a flagged question is never drawn again.
- The records are small: four years of Seattle weather, one quarter of flights, one stock index. Their base rates
  describe those records, not the future, and the reveal says how many cases stand behind each one.
- Sport, work and life have only 3 or 4 starter questions each, so their Mirror bars stay "too few" for a while.
- Block 2 ran only in Chromium too; writing a chain with a thumb, and whether a card really moves from
  Open to Due on the phone's own clock, are untested until the phone check above.
- The starter baseline table (`data/journal_baselines.csv`) is flat at 50% for every domain and horizon,
  and the five-resolved threshold before switching to the player's own rate
  (`journal.own_rate_min_resolved`) is a first guess: both wait for real baselines (open value 2).
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

## Block 4 assumptions

- **Luck or judgment:** an outcome whose baseline chance was under 20% (`lessons.luck_rare_below`) reads as luck; a sourced question
  (no base) always reads as judgment. The player's own marking in the autopsy stands over the suggestion.
- **Natural calls only** feed a trigger (baseline, practice, exam); drill calls never do, and calls from before a flag's last
  clearance never re-fire it.
- **Exam sealing:** exam calls are invisible to the Mirror, the ledger points and every trigger until the verdict, but they
  count for the played day and for the questions already used. The 10 sittings of 20 are drawn up front.
- **A retake** serves fresh questions first and re-serves only what the pool cannot supply (`reused` records how many).
- **Repair drill:** 20 calls on the worst band (a wheel check if too sure, forced steps if too shy).
- **Autopsy form:** four questions plus a mark (held, weak, missed) on each chain link and a check of the evidence links; filing is
  blocked until it is done and the journal's next step waits for it. Rechecks at 3 and 10 days ask one question.
- **L15 (missed days):** two or more missed days in the last seven; the minimum session is 5 gym calls, a reveal and one
  prediction; clears after 5 played days in a row that hold it. It sits outside the one-a-day and two-in-repair limits.
- **Synthetic busy player:** the test generator now draws a player who plays most days, so L15 does not fire in tests that
  are not about it; tests that need it say so.
- **Belts:** a passed Unit 1 exam counts as the U1 gate. Other gates still wait for their blocks.
- **Icons:** regenerated clean; a test scans every app file for the banned word.

## Block 5 assumptions

- **One file a day** (`record/<day>.jsonl`) rather than one file or one file per event: a day's file is small, a union by event id is cheap, and a second device
  only touches the days it played.
- **A day is pushed again when its event count changes**, not by hashing: the log only grows, so a changed count is a changed day.
- **The token is stored in the phone's own `meta` store**, which an Export never reads and Erase clears. A fine-grained token with Contents on one repository is the
  smallest grant GitHub offers; a leaked token could read and write that repository, which is why a public repository is refused.
- **The coach's file is data, not code:** text only (set as text, never as markup), https links only, the builder's name refused, limits on every field.
  Whatever fails is dropped and counted; nothing is repaired.
- **A coach baseline** counts if it was written on or before the due day and the card is unresolved; the first one adopted wins; the locked baseline stays as `b0`.
- **A checked outcome** is a suggestion: it is shown with its page and date, never pre-selected, and its source is stored only if the player used it and agreed.
- **Top-ups** are `sourced` questions only (documented facts about the world), ids start `top-`, and they ship through the normal deploy after `check_data.py`.
- **Auto-sync** runs a few seconds after the record changes and when the phone comes online, only when connected; there is no background sync while the app is closed.
- **Not proven:** the unattended weekly run (needs the player's repository), and GitHub's behaviour with a real token (the pretend GitHub follows the documented contents API).

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
- The starter bank was general knowledge (replaced the same day, see the next block of decisions). The
  world-topic questions arrive with the weekly top-ups in Block 5.
- The tap guard (`gym.tap_guard_ms`, 400) is new: a double tap cannot answer the next question or skip a
  reveal. The baseline curve shows from 20 calls (Mirror) and the summary text says so.
- The calibration gap is written in whole points by one function for both screens (`gapPts` in
  `app/js/engine/scoring.js`): a gap that rounds to zero reads 0, never +0 or −0. The first version printed
  "−0 pts" on Mirror; found in the screenshots, fixed, and pinned by a test.

2026-11-15 (player feedback: "not a test of mathematical knowledge or hardcore knowledge, rather judgement and prediction")

- Interpretation, stated to the player and not contradicted: every gym item is a judgment call about how a real
  situation turns out (a base rate, a favourite against an upset, a plan against reality, weather, flights,
  markets, world trends), each with a source and a base-rate reveal. Arithmetic, chance puzzles and almanac facts
  are removed. The player added that Our World in Data may be used where it fits; it is used for one family, the
  five-year trend ("will it keep going?").
- Two kinds of question, `verified: recorded | sourced`. `recorded` is a real case from a committed table whose
  base rate is the leave-one-out share among the other cases of its kind; its difficulty is how lopsided that
  share is (easy 85% or more one way, medium 68%, else hard). `sourced` is a documented rate with no case count;
  its difficulty is how far the claim's threshold sits from the documented value (log-odds for shares, log for
  quantities, easy from 1.2, medium from 0.5, never nearer than 0.25).
- Cases are drawn blind to outcome inside each cell, so the bank keeps the records' own odds; the checker's z-test
  holds the bank to that. A documented fact gives one question per bank. A case never appears twice in a bank
  (one day, flight, country or year), and the exam pool avoids every case the starter bank used.
- Every question's source link and name come from `data/question_tables/sources.csv`, so a question cannot cite
  something else. The source of a documented fact is on its own row, with the page text that shows the number.

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
- Only recorded or sourced questions count toward a gate (every question is one or the other).
- A prediction cannot change after it is locked.
- A lesson fires on a pattern with a minimum sample, never on one miss.
- The coach is called Predict everywhere the player can see it: the button says "Ask Predict". The builder's
  own name never appears in the app (the tests check every screen and every file).
- Never commit the player's record, a backup, a token or personal question text to the public repo.
- Relative URLs only; routes live in the hash; no requests to other sites while the app runs, except api.github.com after the player connects a private repository (`sync.js`).
- A button that sits where the next screen's button will appear ignores taps for `gym.tap_guard_ms`.
- An event never stores an undefined field: what is saved and what is exported must be the same record.

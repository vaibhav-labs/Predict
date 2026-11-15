# Predict: mechanics (version 0.2)

Version 0.2 · Stage: Concept, with Blocks 1 and 2 built · Last updated: 2026-11-15 · Companion to the plan doc "Predict: Game Plan"

> **Summary.** Predict is a 15-minute daily training game for calibrated judgment. This file is the
> build-facing half of the design: the loop, the economy, the algorithms, the data model and the open
> questions. Key decisions: a proper scoring rule (honesty is the best strategy), edge scoring for real
> predictions (no farming), gates as fixed exams (luck rarely passes), lessons triggered by patterns
> (never by single misses). Every tunable number lives in `data/`. Fourteen values are still `OPEN:`.

---

## 1. Profile

- **High concept (18 words):** Daily forecasting dojo: stake a confidence on a claim, reality scores
  you, and patterns of misses become lessons.
- **Core fun action:** call it, lock it, see reality answer. Secondary: watching your calibration
  curve straighten, and reading true sentences about your own judgment.
- **Mechanic types:** internal economy (points, evidence, flags, mastery) and progression (units,
  gates, belts) dominate. No physics or tactical maneuvering. Social interaction arrives in Arc IV
  (public tournaments, AI partner).
- **Emergence vs progression:** the curriculum is authored progression (12 units, 15 lesson
  triggers). The content is emergent and free: the player's own life and the world supply an endless
  stream of questions, so play hours do not scale content cost.
- **Platform:** installable web app (a PWA) on GitHub Pages, phone first and offline-capable, with Predict
  as coach: a hand-off in the app and a weekly review on a schedule (Predict is an AI model; every label
  says "Predict", for example "Ask Predict"). Details in `design/platform.md`. Single player until Unit 12.

### Play-time budget (minutes of a 15-minute session; `data/session_budget.csv`)

| Arc | Reveals | Gym | Lesson | Journal | Scoreboard |
|---|---|---|---|---|---|
| I | 2 (13%) | 5 (33%) | 3 (20%) | 4 (27%) | 1 (7%) |
| II | 2 (13%) | 4 (27%) | 3 (20%) | 5 (33%) | 1 (7%) |
| III | 3 (20%) | 3 (20%) | 2 (13%) | 6 (40%) | 1 (7%) |
| IV | 3 (20%) | 4 (27%) | 1 (7%) | 6 (40%) | 1 (7%) |

Systems below are ordered by this budget: gym call, journal prediction, lesson engine, reveals.

### Fun and chores

| Fun (maximise) | Chore | Mitigation |
|---|---|---|
| Locking a call and seeing the reveal | Writing a scoreable prediction | Template, rule-based checker with Ask Predict for a rewrite, three suggested prompts a day (written at the weekly review) to choose one from |
| Beating your own 7-day average | Remembering to resolve | Due cards on the day; coach pre-checks world events with a source |
| A straighter calibration curve | Waiting for outcomes | One due-tomorrow prediction daily; instant gym answers |
| A new move on the forecast card | Reading lessons | 90-second drills built from the player's own calls |
| A true sentence about yourself | Bookkeeping | All automatic; nothing to tally by hand |

### Not gameplay

Belts, levels, streak flames and any visual theme are feedback, not play. They get one screen and no
design budget beyond Block 3.

### Realistic vs fudged

- **Must be exact:** the scoring math; locked predictions cannot change; outcomes come from reality
  or a source; every statistic shows its sample size; gates are fixed exams judged once.
- **Fudged for play:** belts and levels; flat habit points; the due-tomorrow prediction (an
  artificial short horizon so reveals arrive daily); difficulty adapted to hold the hit rate near
  75%.
- **Never fudged in the game's favour:** no softened scores, no hidden misses. Predict's own
  forecasts (Unit 11) are scored by the same rule and shown.

---

## 2. Core loop

```
call (answer + confidence, locked)
  -> reality reveals (instantly in the gym, days later in the journal)
  -> points by a proper rule + one more row of evidence in the record
  -> bias map updates -> a lesson opens if a pattern is too big for luck
                      -> a gate closes if a fixed exam is passed -> new move on the forecast card
  -> next call, made with one more tool or one less blind spot
```

Core mechanic: **the confidence call**. It happens about 20 times a session, connects to every
resource below, and carries a real decision each time (how sure am I?).

---

## 3. Internal economy

Text Machinations notation. One step = one day.

```
[+] --90% attendance--> (minutes: 15)                         # attention is the scarce resource
(minutes) --5--> <gym round> --> (calls) +18                   # interactive
(minutes) --4--> <journal> --> (open_predictions) +1           # interactive: one deep case, any horizon
(open_predictions) --delay 1..30 days--> (resolved)            # reality resolves
(calls),(resolved) --> [points = rule(p)] --> (career_points)  # register: proper score
(career_points) --> <level up: 140 * L^1.2> --> (level)        # converter with rising cost
(calls),(resolved) ..stats.. (bias_map)                         # state connection
(bias_map) ..pattern > luck.. *trigger* --> (flags) +1          # trigger
(flags) --<lesson + repair drill + 2 re-tests>--> [x]           # drain
(exam_calls) --<gate: fixed n, judged once>--> (units) +1       # converter, lock and key
(units) ..unlocks.. forecast-card moves                         # activator
[+] --played--> (streak) ; (streak) --missed day: half--> [x]   # capped source, forgiving drain
(mastery) --rust: review calls can re-fire a trigger--> [x]     # static friction
END: none. Milestones are belts.
```

| Resource | Source | Drain or converter | Shown as |
|---|---|---|---|
| Minutes | Showing up | Spent on gym, journal, lesson | Session progress bar |
| Points | Every scored call | Confident misses (negative) | Per call, session total, 7-day average |
| Career points, level | Sum of points and habit points | None (high-water mark) | Level number |
| Evidence | Each resolved call | Old calls age out of gate and trigger windows | Sample size beside every statistic |
| Open predictions | Journal step (1 scored a day, with its full chain) | Resolution | Due list |
| Flags | Pattern triggers | Lesson, drill and two re-tests | Open lessons list |
| Units, moves | Gates | None; a gate can reopen | Forecast card |
| Streak | A played day | Halves on a missed day | Day count |

Every displayed resource has a source and a drain or converter.

### Feedback loops

| Loop | Type | Effect | Investment | Return | Speed | Range | Durability |
|---|---|---|---|---|---|---|---|
| Skill engine: practice, better calibration, more points per call | Positive | Constructive | 15 min a day | +4.6 points a call from fixing typical overconfidence (28.8 to 33.4) | Days | Long | Saturates at honesty |
| Lesson loop: pattern, lesson, drill, error falls | Negative on error | Constructive | 3-minute lesson slot | Flag cleared | Next session, re-tests at 3 and 10 days | Short | While flags exist |
| Overconfidence tax: stated above true, points fall | Negative | Corrective | None | Minus 4.6 to minus 31 points a call | Instant | Short | Permanent |
| Pipeline: log today, reveal later | Positive, delayed | Constructive | 4 min a day | 0.7 to 0.9 reveals a day | 1 to 30 days | Medium | Permanent |
| Escalating challenge: gate passed, tighter tolerance | Negative on progress | Holds flow | None | Gate tolerance 5 points, then 3 | Per unit | Long | To Unit 12 |
| Streak: daily play, flat bonus | Positive, capped | Habit | Attendance | At most 120 of about 780 points a day | Daily | Short | Cap at 10 days |
| Rust: no practice, trigger re-fires, gate reopens | Static friction | Maintains skill | None | None | Weeks | Long | Permanent |

### Patterns chosen

| Pattern | Where | Problem it solves |
|---|---|---|
| Dynamic Engine | Skill raises points per call | Sense of growth tied to real skill |
| Stopping Mechanism | Honesty is the score optimum; level cost rises; streak bonus caps at 10 days | No runaway from bluffing, grinding or attendance |
| Escalating Challenge | Gates tighten from 5 points to 3; difficulty holds the hit rate near 75% | Flow as skill grows |
| Escalating Complexity | One new move on the forecast card per unit | Depth without front-loading rules |
| Multiple Feedback | One call feeds points now, the bias map later, triggers on patterns | Depth from one action |
| Static and Dynamic Friction | Rust; streak halves on a miss | Skill needs upkeep; a miss does not end the habit |
| Slow Cycle | Weekly coach review, monthly season report | Rhythm and a reason to look back |

---

## 4. Systems

### 4.1 Gym call (binary)

- **Goal:** state a confidence that matches your real chance of being right.
- **Algorithm**
  1. Serve a verified question not seen in the last 90 days: 70% from the current unit's pool, 30%
     review. Difficulty is chosen to hold the player's recent hit rate between 65% and 85%.
  2. The player picks an answer and a confidence `c`: 50, 55 ... 95, 99 until Unit 10, then 1% steps.
  3. The player locks. A lock is final.
  4. Reveal the outcome. `p = c` if right, `1 - c` if wrong.
  5. `points = round(100 * (1 - 4 * (1 - p)^2))` (core rule). From Unit 10:
     `points = round(100 * (1 + log2(p)))` (sharp rule).
  6. Record `{question, unit, domain, c, outcome, points, time, latency, exam id}`.
  7. If wrong and `c >= 0.80`, show the instant note (answer, trap, what a calibrated call looked like).
  8. Update the bias map and evaluate every trigger whose window includes this call.
- **Worked example:** you say 80% and are wrong. `p = 0.20`, points `= 100 * (1 - 4 * 0.64) = -156`.
- **Randomness:** question order only. No dice in scoring.
- **Edge cases:** no answer in 60 seconds, or the app closed for that long with the question open: the
  question returns to the pool unscored (a `skip` in the record). A disputed question is flagged, never
  drawn again, kept out of gates, and checked at the weekly review. A tap on Lock in or Next call within
  `tap_guard_ms` of the screen appearing is ignored, so a double tap cannot answer the next question or
  skip a reveal.
- **As built in Block 1:** there is one 240-question bank and one pool, so the 70/30 unit-pool split and
  the 90-day rule wait for Block 4. A question is never repeated until the bank is used up, then the one
  answered longest ago comes back first; a disputed question never does. A baseline session (Unit 0) is
  planned up front, half true and half false and spread 40/35/25 over easy, medium and hard, and shows no
  feedback until it ends. Practice (Unit 1) picks each question as the player goes and reveals it at once;
  once 8 of the last 20 calls exist, a hit rate above 85% shifts the mix to 20/35/45 and below 65% to
  60/30/10. A 50% call keeps the side the dial last leaned to (Yes if it never moved).
- **Tuning knobs (`data/scoring.json`):** rules, dial limits, note threshold, review share, and in the
  `gym` section the mixes, the window, the timeout and `tap_guard_ms`.
- **Balance evidence:** `sim/scoring_sim.py` parts A to C. Honest reporting is the best of nine
  policies on easy, mixed and hard sets.

### 4.2 Range call

- **Algorithm:** the player gives low and high for a 90% range. On a log10 or linear scale set per
  question: `score = width + 20 * distance outside the range` (lower is better).
- **Balance evidence:** part E. The expected score is lowest at exactly 90% coverage; 50% coverage
  scores 1.77 times worse, absurdly wide 2.42 times worse.
- **OPEN:** the mapping from interval score to points needs a per-question reference width
  (Block 6).

### 4.3 Journal prediction

States: `draft -> checked -> locked -> open -> due -> resolved (yes, no, void) -> autopsied -> archived`.

1. The player writes a statement from the template "By [date], [measurable thing] will [happen]",
   and picks a domain (work, life, world) and a due date (tomorrow, this week, this month, longer).
2. The checker is a set of rules in the app, instant and offline. It flags: ambiguous term, no date,
   not observable, self-controlled. Trivial is flagged once a baseline exists. For a rewrite the
   player taps Ask Predict, which copies the claim to the chat where Predict proposes sharper wording.
3. The chain, one line each, written before the baseline is shown: outside view (the player's own
   reference class and rate), evidence (up to three signals, each marked up or down and answered
   "would this also have been true in the cases that missed?"), case against (the strongest reason
   to be wrong, with a number), tripwire (what would change my mind, and to what number).
4. A baseline `b` is recorded and hidden. At lock it is the player's own base rate for that domain
   and horizon (a starter table in `data/` until there is history), then 50%. From Block 5,
   Predict's outside-view probability replaces it if it is recorded before the due date, either at
   the weekly review or through Ask Predict after the lock. The latest baseline recorded before the
   due date is the one scored against, and each one is kept in the record with its time.
5. The player sets a probability from 1 to 99% and locks. Text, chain, date and probability are now
   immutable. The baseline is revealed, and a later one is shown when it arrives.
6. On the due date the card appears in Reveals. From Unit 8 a memory check asks "what did you say?"
   first. The player marks yes, no or void with a one-line evidence note. World questions arrive
   pre-checked by the coach with a source link.
7. `raw = rule(p)`, `base = rule(b)`, `edge = 2 * (raw - base)`. Void scores nothing.
8. From Unit 6 the player may update. The score becomes the time-weighted average of daily scores
   from lock to resolution, each forecast carried forward until changed.
9. A trivial call (baseline outside 5% to 95%) or a self-controlled one is scored but kept out of
   gates and the bias map.
10. A miss at 85% or more requires an autopsy before the next journal step. One in five confident
   hits is sampled for autopsy too. Every resolved prediction gets a case file (section 4.9).

- **Limit:** one scored prediction a day, the daily case. Extra ones are logged unscored.
- **Worked example:** you say 75% a client signs by Friday; the baseline is 55%. If it happens:
  `raw = 75`, `base = 19`, `edge = 2 * 56 = +112`. If not: `raw = -125`, `base = -21`,
  `edge = 2 * -104 = -208`.
- **Balance evidence:** part F. Raw points make sure-thing farming the best strategy (88.4 a call
  against 26.3). Edge makes it worth zero and real forecasting worth 14.5 before the weight.
- **OPEN:** baseline quality and the edge weight (Block 2).

### 4.4 Lesson engine

Flag states: `open -> lesson taken -> drill passed -> re-test 1 (3 or more days) -> re-test 2
(10 or more days) -> cleared`. A failed re-test returns the flag to `open` and adds one to its fire
count. At three fires the flag escalates to the weekly review, where the coach builds a custom set
from the player's own misses.

- Triggers are evaluated at session end. At most one new pattern lesson per session, at most two
  flags in active repair; others queue by size of standardized gap. Missed days (L15) goes first.
- All 15 pattern triggers plus the two every-time responses are in `data/lesson_triggers.csv`.
- **Balance evidence:** part D. Trigger L01 at 40 calls and a 10-point gap fires falsely on a
  calibrated player 8.1% of the time in 150 top-band calls and catches typical overconfidence in a
  median of 46 calls.

### 4.5 Gates and belts

- A gate is a fixed exam of fresh calls, judged once at the end. Failing sends the player to a
  repair drill on the worst band, then to a new exam. One exam runs at a time.
- A passed gate reopens if its trigger later fires on review calls (rust).
- Units, gates and evidence: `data/units.csv`. Belts: `data/belts.csv`.

### 4.6 Levels and streak

- Level cost: `140 * L^1.2` career points (`data/levels.csv`). Career points are a high-water mark.
- Habit points are flat: 60 a session plus 6 a streak day up to 60. Never a multiplier.
- A missed day halves the streak.

### 4.7 Coach protocol (weekly, scheduled)

1. Read calls, predictions and flags since the last review, from the record the app syncs to the player's private data repo (before Block 5, from the player's Export file).
2. Recompute the bias map independently and compare it with the app.
3. Resolve due world questions by web search; attach the source; mark them pre-checked.
4. Write the letter: what improved, the one pattern to fix, next week's focus. At most 150 words. It is saved to the private data repo, never the public one.
5. Build a 10 to 15 item drill set from the week's misses (private repo).
6. Add about 130 verified questions matched to the unit and weak bands, committed to the app's content folder and live after the next deploy.
7. Propose five world questions for the coming week with resolution criteria.
8. Log any change to a tuning value in the change log.

### 4.8 Question supply

- A question is gate-eligible only if it is `recorded` or `sourced` (every question is one or the other).
- **What a gym question is.** A judgment call, not a test of knowledge or arithmetic: a scene (`lead`: where,
  when, what has happened so far) and a claim about how it turns out (`ask`). The player says yes or no and how
  sure; the reveal shows what happened and how often claims like it held. Player feedback, 2026-11-15: "not a
  test of mathematical knowledge or any core hardcore knowledge, rather judgement and prediction".
- **Two kinds.** `recorded`: a real case from a committed record table (Seattle daily weather 2012 to 2015, 20,000
  US flights in January to March 2001, S&P 500 monthly history since 1950, five-year trends in six Our World in
  Data series). Its `base` is the leave-one-out chance that this claim is true among the other cases of the same
  kind, `n` is how many other cases there are, and its difficulty is how lopsided `base` is (easy 85% or more one
  way, medium 68%, else hard). `sourced`: a documented rate from a named source (`data/question_tables/base_rates.csv`),
  asked as "more than t%" or "fewer than t%" for thresholds clear of the documented value; no `base`, and its
  difficulty is how far the threshold sits from the documented value (log-odds for shares, log for quantities:
  easy from 1.2, medium from 0.5, never nearer than 0.25).
- **Fairness.** Within each cell (true or false, easy, medium, hard) cases are drawn blind to how they turned
  out, so a player who knows every base rate is calibrated on the bank (checked by a z-test, limit 3). The
  base rate is a reference class drawn from the same record, not a forecast; `n` is shown.
- **Question factory.** `tools/make_questions.py` reads the tables, builds every candidate claim (about 95,000),
  and selects the bank by fair progressive filling across kinds, with no case used twice in a bank and none
  shared between the starter bank and the exam pool. `tools/check_questions.py` re-derives every answer, base,
  count and percentage with separate code and compares the files with what the tables produce.
- Anything Predict writes live in a chat is practice only.
- **Delivery:** the 240-question starter bank and the 304-question Unit 1 exam pool ship in the app. Each weekly
  top-up is committed to the public repo's content folder, so gym questions are general and sourced, never
  about the player's own life.
- **Volume (scope check):** about 126 gym items a week, roughly 4,000 across Units 0 to 11 (224 days at up to
  18 a day). The record tables yield about 95,000 distinct candidate claims, so volume is not the limit; breadth
  is. Sport, work and life are thin (3 or 4 starter questions each) until more record families or documented
  facts are added (IPL results are the obvious next family). Lessons: 13 unit lesson sets and 15 pattern
  lessons, written one block at a time.

### 4.9 Case file

Every resolved prediction gets a case file built from its stored chain, the outcome and the record.
A miss at 85% or more, and one in five confident hits, need the four-question autopsy first (what I
knew, what I missed, luck or judgment, one rule). It takes about 90 seconds, and the answers seed the file.

- **Five lenses:** what happened (dates, tripwire, outcome); your reasoning (each link of the chain
  marked held, weak or missed against what happened, with the evidence tests); luck or judgment (the
  edge lost or won beyond the baseline, and how likely this outcome was at the baseline); your pattern
  (the journal-only record with its sample size and the flags it feeds, never a lesson from one case);
  next time (a table of edge at other numbers, the rule in the player's words, re-checks at 3 and 10
  days, and Predict's read once the coach exists).
- **Rule card:** the rule is shown above the player's next five journal cards.
- **Worked example:** you say 85% against a 55% baseline and it does not happen. `raw = -189`,
  `base = -21`, `edge = 2 * -168 = -336`. At 55% the same miss scores 0, at 65% -96, at 75% -208.
  An 85% call breaks even only if the true chance is 70% or better.
- **Staging:** Block 2 builds the chain as written, the outcome and the table of other numbers;
  Block 3 adds your pattern; Block 4 adds the autopsy, the audit, luck or judgment and the rule card;
  Block 5 adds Predict's read; Block 8 turns the tripwire into an update prompt; Block 9 adds the
  memory check. Until Block 4 ships, a miss at 85% or more shows a plain reveal and its autopsy waits.
- **Time:** the chain fits the 4-minute journal slot. The autopsy adds about 2 minutes on the days it
  is due, so those days run slightly over 15 minutes.

### 4.10 The Mirror (Block 3)

Nothing the Mirror shows is stored. Every number is worked out again from the event log each time a screen
opens, so an Import, an Erase or a new day changes it at once, and an independent recomputation
(`tools/ref_mirror.py`) can be held against it from the same raw events.

- **A played day** is a local day with at least one call, one locked prediction or one resolved prediction.
  A session that was opened and closed with no call does not count, and neither does opening the app.
- **Streak.** A played day adds one. A missed day keeps `floor(streak * streak_cool_fraction)` (one half) of
  the streak. Today is never a miss while it is still going, so the screens say "play today to keep it"
  until it is played and "played today" after.
- **Habit points** are paid once per played day, however many sessions it holds: `session_points` plus
  `streak_bonus_per_day` for each streak day up to `streak_bonus_cap_days` (at most 120 a day).
- **Career points** are a high-water mark of the running total of call points, journal edge points and
  habit points. The level comes from career points alone (cost `140 * L^1.2`, rounded half to even, so
  `data/levels.csv` is reproduced exactly); a bad day can lower the running total but never the level.
- **Seven-day score** is the average skill points (call points plus edge points, never habit points) over the
  days played in the last seven, with the number of played days and calls under it. "Today beats the
  seven days before" compares today's skill points with the same average over the seven days before today.
  Habit points are left out so that showing up can never raise it.
- **Error bars.** Every point on a calibration curve carries a 95% Wilson interval for its hit rate
  (`mirror.error_bar_z`, 1.96), and the number of calls is printed under it. A band with fewer than
  `mirror.thin_below` (10) calls is hollow and dashed, never hidden.
- **Verdicts.** A group's gap is its average stated confidence minus its hit rate. The verdict is read from
  the Wilson interval, not from the gap alone: "too sure" when even the best hit rate the sample allows is
  below the average confidence, "too shy" when even the worst is above it, otherwise "no clear bias", and
  "too few" under `thin_below`. A group that is too few to read shows its numbers and claims nothing.
- **Bias map.** The gym's calls are split by topic. The journal's are split by domain and by horizon, and
  by both in a grid that shows the number of cards and the average edge in each cell.
- **Journal-only record.** Counts resolved cards that are not void, are scored (the one a day), are not
  trivial (baseline outside `journal.trivial_band`) and are not self-controlled (the checker flagged
  `self_controlled` at lock). A card is written like a gym call: confidence on the side it leaned to (50%
  leans Yes), a hit when that side was right, and its edge as its points. The card that is kept out of
  the record is still scored and still listed, and its case file says in one sentence why it is kept out.
- **Belts** show real progress from facts the app can count (gates passed, resolved real predictions, total
  edge, month-horizon results, calibration gap). A belt is never shown as earned in Block 3: no gate
  can be passed before Block 4 builds the exams, and the fifth belt is external.
- **Case file, lens 4 (your pattern).** For a resolved card: the journal-only record for its domain, for its
  horizon, for the cell where the two meet, and for the whole journal, each with its n; "too few" under
  `thin_below`. One card is a story, not a pattern: nothing here becomes a lesson (Block 4).
- **Table of other numbers (fix in Block 3).** The rows are the gym's eleven steps on the side the card
  leaned to (a forecast under 50% runs 50, 45 ... 1), plus a row for the number actually said when it falls
  between two steps, so that number is always in the table, once, marked.

---

## 5. Data model (the player's record)

| Collection | One document is | Key fields |
|---|---|---|
| `questions` | A gym question | id, lead (the scene), ask (the claim), claim (lead and ask), answer, base (chance the claim holds among other cases; none for a documented fact), n (other cases), fact, why, domain, difficulty, verified (`recorded` or `sourced`), source, source name, checked (the day the records or page were read) |
| `calls` | One locked gym call | question, confidence, outcome, points, time, latency, unit, exam |
| `predictions` | One journal card | text, domain, due date, state, probability, baseline, chain (outside view, evidence with tests, case against, tripwire), outcome, evidence note, raw, edge, flags, autopsy answers, rule |
| `updates` | One revision of a prediction | prediction, new probability, reason, time |
| `flags` | One open lesson | trigger, state, fire count, evidence window, re-test dates |
| `exams` | One gate attempt | unit, calls, result, statistics |
| `profile` | The player | level, career points, streak, units passed, context note, active rules |
| `letters` | One coach letter | week, text, drill set, questions added |

**As built in Block 1.** The log holds six event types. Each has an `id`, a time `t` (UTC) and the player's
local day `d`. `session` (mode, unit, size, and for a baseline the planned question ids), `call` (session,
question, claim text, domain, difficulty, side, confidence, truth, hit, points, rule, milliseconds), `skip`
(a question dropped after 60 seconds), `dispute` (a question flagged), `lesson` (a card read) and `export`
(a backup made). Events of a type the app does not know are kept and ignored, so a newer record never
breaks an older app. An Export file is a header line followed by the events, one JSON object per line.

**As built in Blocks 2 and 3.** Two more event types. `prediction` (text, domain, due option and date,
horizon, the chain, probability `c`, baseline `b` and where it came from, `scored`, milliseconds taken,
`flags` the checker raised on the final wording, and `flagged`, whether it raised any while the card was
being written) and `resolve` (prediction id, outcome yes, no or void, an optional note, the raw points and
the edge, which is null for an extra card). A prediction is never edited after it is locked; the store
refuses a second event under its id.

Two homes. `questions` is content: the builder commits it to the public repo and the app caches it. Every
other collection is the player's record and is personal, including `letters`. The record is an
append-only event log in the phone's own storage, one line per event with an id and a time, so importing
a backup never double-counts and any statistic can be recomputed from the log. Export writes it to a
file. From Block 5 it also syncs to a private `Predict-data` repo. Nothing personal is ever committed to
the public `Predict` repo (`design/platform.md`, sections 2 and 6).

---

## 6. Open questions

| # | OPEN value | Why it is open | Settled by |
|---|---|---|---|
| 1 | Does an 18-call round fit in 5 minutes on a phone? | Timing was assumed, not measured | Block 1 exit test, on the player's phone. Every call records its milliseconds, so the first practice sessions answer it |
| 2 | Baseline quality for edge scoring | An outside-view baseline has not been tested on personal questions | Block 2: first 20 baselines checked by hand (about Day 25), then the first 60 (about Day 65) |
| 3 | Edge weight (now 2) | Balances the worth and the swing of a real call | Block 2 real data |
| 4 | Points a day (now assumed 780) | Drives every level date | Block 3, after two weeks of play |
| 5 | Underconfidence trigger L02 threshold | Not yet simulated | Block 4 simulation |
| 6 | Interval score to points mapping | Needs a reference width per question | Block 6 |
| 7 | Chain-blindness trigger L07 threshold | Needs journal data | Block 7 |
| 8 | Planning-fallacy trigger L08 threshold | Needs journal data | Block 7 |
| 9 | Unit 4 gate: the factor-of-3 rule | Needs playtest data on Fermi problems | Block 7 |
| 10 | Unit 6 gate: the update-value rule | Needs real updates to score | Block 8 |
| 11 | Unit 7 outcome gate and memory-drift trigger L12 | Small expected effects, noisy at this sample | Block 9 |
| 12 | Unit 11 gate | Needs about 8 weeks of paired human and AI forecasts | Block 10 |
| 13 | Belt evidence at one prediction a day | Yellow, Green and Brown wait on 40, 150 and 300 resolved real predictions. At one a day they arrive on days 61, 184 and 351, not 34, 96 and 160 | Decision after Block 3 shows the real resolution rate: keep the thresholds or thin them |
| 14 | Journal-fed triggers at one a day (L04, L07 to L13) | Their windows fill about three times slower, and thinning them raises false alarms | Block 4 and Block 7 data, then re-simulate |

---

## 7. Phase gates (game-design skill)

- **Concept:** the core action is clear from the high concept; each arc's budget totals 15 minutes;
  five comparable tools are named in the plan doc with how Predict differs.
- **Core mechanics:** every displayed resource has a source and a drain; the confidence call is a
  decision inside the core loop; no strategy dominates in simulation (honest is best; farming is
  worth zero under edge); units end in the intended range (224 days for Units 0 to 11).
- **Balance:** reports exist for scoring, gates, triggers, ranges, journal edge, session economy,
  levels and pacing. No unresolved DOMINANT, DEAD OPTION, ACCELERATING or grind flag. Two flags are
  intended: gym-only play never builds real evidence (NO ENDING), and binge play has a swingy streak.

---

## 8. Change log

| Date | Section | Change | Reason |
|---|---|---|---|
| 2026-11-14 | All | Concept version 0.1 | First plan |
| 2026-11-14 | 3, 4.3, 4.9, 5, 6 | Journal cut from three scored predictions a day to one, with a six-link chain and a case file | Player request: depth over breadth. Effects (sim): 100 resolved real predictions on day 124, not 48; Units 0 to 11 end on day 224, not 222; belts Yellow, Green, Brown wait for evidence (days 61, 184, 351) |
| 2026-11-14 | 4.5 | Per-band gate tolerance changed from a fixed 10 points to 2.5 standard errors; exam 150 to 200 calls | The first design failed calibrated players 63% of the time |
| 2026-11-14 | 4.4 | Trigger L01 changed from 30 calls and 8 points to 40 calls and 10 points | False alarms on calibrated players fell from 42% to 8% |
| 2026-11-14 | 4.3 | Journal scored on edge, not raw points; weight set to 2 | Raw points made sure-thing farming the best strategy |
| 2026-11-14 | 4.5 | Black belt moved behind Unit 12 | It requires 50 resolved public questions |
| 2026-11-15 | 1, 4.7, 4.8, 5, build blocks 1 and 5 | Platform changed from a private web page to an installable web app (PWA) on GitHub Pages. The record is local-first with Export and Import and syncs to a private repo from Block 5. The builder pushes content to the public repo | Player request: a PWA, free hosting on GitHub, no domain, content pushed regularly. Effects: the code and question bank are public; no live in-app answers from Predict until a key-based option is added; scoring and pacing numbers are unchanged |
| 2026-11-15 | 2, 4.3, 4.8, build blocks 2, 5, 9 and 10 | Without a live model in the app, the checker became in-app rules plus an Ask Predict hand-off; the baseline is the player's own base rate until Block 5, then Predict's number if it arrives before the due date; the case-against grade is written at the weekly review; Predict's own forecast on a world question is committed to the private repo before the question opens | Consequence of the PWA decision: the app has no key and no server, so nothing can call a model while the player plays. Effects: scoring and pacing numbers are unchanged; early edge scores rest on weaker baselines, so open value 2 now settles on the first 20 baselines by hand |
| 2026-11-15 | 4.3, build block 2 | Block 2 built: the prediction card and its six-link chain, the rule-based checker (`data/checker_rules.csv`), Ask Predict as a copied clipboard message, lock, the due list, resolve, edge against the baseline, three horizon buckets (`data/journal_baselines.csv`, `data/scoring.json` journal section), and the outcome card's table of other numbers. The two worked edge examples (4.3, 4.9) pin the scoring exactly | Build note, not a design change: scoring, the chain and the baseline rule are unchanged from the plan. Assumptions taken where the docs left a choice (due-date day counts, the three horizon buckets, a flat 50% starter table, a five-resolved own-rate threshold) are listed under "Block 2 assumptions" in STATE.md, not here, since none of them change a number already fixed by this file |
| 2026-11-15 | 4.1, 4.8, 5, `data/scoring.json` | Block 1 built. Gym draws, baseline and practice rules written down as built (section 4.1); the record's six event types written down (section 5); `gym.tap_guard_ms` (400) added so a double tap cannot answer the next question or skip a reveal; the baseline curve shows from 20 calls, with bands under 10 calls drawn hollow. Version 0.2 | Block 1 build. Effects: scoring and pacing numbers are unchanged (`sh sim/run_all.sh` reproduced every output exactly); the 70/30 unit-pool and 90-day rules wait for Block 4 because there is one bank; the mixes, the window and `thin_below` stay first guesses until real hit rates arrive |
| 2026-11-15 | 4.10, 4.9, build block 3 | Block 3 built: the Mirror. Streak, habit points, career points and level, the seven-day score, error bars and sample sizes on the curve, the bias map by topic, domain and horizon, the journal-only record, the belt rows with real progress, and the case file's your-pattern lens. Every number is held against an independent Python recomputation (`tools/ref_mirror.py`) from the same raw events. One fix on the way: the table of other numbers now always holds the number actually said, and runs on the side the card leaned to | Build note, not a design change: nothing in a rule or a number changed. The played-day definition, the seven-day score excluding habit points, and the verdict being read from the interval are the readings taken where the docs left a choice (STATE.md, "Block 3 assumptions") |
| 2026-11-15 | 4.8, 5, build blocks 1 and 4 | Player feedback ("not a test of mathematical knowledge or any core hardcore knowledge, rather judgement and prediction"): the gym question bank is rebuilt. Every question is a judgment call, a scene plus a claim about how it turns out, drawn from committed real records (Seattle weather, US flights, S&P 500 history, Our World in Data trends) or from 37 documented base rates with their evidence; arithmetic, chance puzzles and almanac facts are gone. New fields `lead`, `ask`, `base`, `n`; `verified` is `recorded` or `sourced`; the reveal adds the base rate and its number of cases. A 304-question Unit 1 exam pool is built beside the 240-question starter bank. `tools/check_questions.py` is rewritten to re-derive every answer with independent code, test fairness (z-test) and compare the files with the tables | Content change, not a rule change: scoring, gates and pacing numbers are unchanged. Difficulty is now how lopsided a claim's base rate is (recorded) or how far its threshold is from the documented value (sourced), so the 40/35/25 and 7/38/55 mixes mean something different from the old size-of-gap labels and stay first guesses until real hit rates arrive (STATE.md, "the question bank, rebuilt for judgment") |

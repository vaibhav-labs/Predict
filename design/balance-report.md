# Predict: balance report (concept version 0.1)

> **Summary.** Nine checks back the numbers in the plan. Honest reporting is the best strategy under the scoring rule, gates and lesson triggers are sized so luck rarely decides them, real predictions are scored on edge so sure things are worth nothing, and the 15-minute session, with one deep prediction a day, reaches a first journal bias map (100 resolved real predictions) in about 124 days. Four findings changed the design; they are listed first. Rebuild this file with `sh sim/run_all.sh`.

## Changes the simulations forced

| Finding | Change | Result |
|---|---|---|
| Gate with a fixed 10-point tolerance per band failed calibrated players 63% of the time at 150 calls | Bands are judged against their own sampling error (2.5 standard errors); exam is 200 calls | Calibrated pass rate 88%, typical overconfident 1% |
| Overconfidence trigger at 30 calls and an 8-point gap fired falsely on 42% of calibrated players | 40 calls and a 10-point gap | False alarms 8%; typical overconfidence still caught in a median of 46 calls |
| Raw points on real predictions made logging sure things the best strategy (88 against 26 a call) | Real predictions pay edge over a hidden baseline | Sure things earn 0; real forecasting earns 14.5 |
| A rolling window gives a miscalibrated player many chances to pass by luck | Every gate is a fixed exam of fresh calls, judged once | Pass rates below apply once per attempt |

## 1. Scoring rule: does honesty win?

- **Intent:** the highest-scoring way to play must be to say what you believe.
- **Method:** `python3 sim/scoring_sim.py`, 120,000 questions per policy and question set, seed 20261114. Rules are in `data/scoring.json`.

Points for a hit and a miss:

| You say | Home-made: hit | miss | Predict rule: hit | miss | Sharp rule: hit | miss |
|---|---|---|---|---|---|---|
| 50% | +0 | +0 | +0 | +0 | +0 | +0 |
| 55% | +10 | -10 | +19 | -21 | +14 | -15 |
| 60% | +20 | -20 | +36 | -44 | +26 | -32 |
| 65% | +30 | -30 | +51 | -69 | +38 | -51 |
| 70% | +40 | -40 | +64 | -96 | +49 | -74 |
| 75% | +50 | -50 | +75 | -125 | +58 | -100 |
| 80% | +60 | -60 | +84 | -156 | +68 | -132 |
| 85% | +70 | -70 | +91 | -189 | +77 | -174 |
| 90% | +80 | -80 | +96 | -224 | +85 | -232 |
| 95% | +90 | -90 | +99 | -261 | +93 | -332 |
| 99% | +98 | -98 | +100 | -292 | +99 | -564 |

Expected points a call, mixed-difficulty set (true accuracy 75%):

| Reporting style | Says on average | Home-made rule | Predict rule | Sharp rule |
|---|---|---|---|---|
| Honest | 75.0% | +33.4 | +33.4 | +27.9 |
| Mildly overconfident (says 82% when 75% is true) | 79.9% | +38.5 | +32.2 | +25.9 |
| Typical overconfident (says 90% when 75% is true) | 84.5% | +42.7 | +28.8 | +18.8 |
| Underconfident (says 63% when 75% is true) | 65.3% | +21.5 | +28.8 | +22.8 |
| Always 50% | 50.0% | +0.0 | +0.0 | +0.0 |
| Always 99% | 99.0% | +49.0 | +2.0 | -67.1 |
| Honest, rounded to tens | 74.9% | +33.3 | +33.1 | +27.4 |
| Honest, three levels only (50, 75, 99) | 75.0% | +34.3 | +31.4 | +23.5 |
| Right on average, sloppy call to call | 75.0% | +32.3 | +29.2 | +23.6 |

- **Result:** best style under the Predict rule: mixed set: honest, hard set: honest, easy set: honest. Under the sharp rule: mixed: honest, hard: honest, easy: honest. Under the home-made rule: mixed: always_99, hard: always_99, easy: always_99.
- Hard set: honest +16.7, typical overconfident +12.1. Easy set: honest +50.1, typical overconfident +45.6.
- **Problems found:** none under the Predict and sharp rules. The home-made rule has a DOMINANT strategy (always 99%), so it is rejected.
- **Note:** rounding to tens costs 0.3 points a call under the Predict rule and 0.5 under the sharp rule; three levels cost 2.0 and 4.4.

## 2. Luck against skill

- **Intent:** know how many calls it takes before skill, not luck, decides a comparison.
- **Method:** 6,000 sessions; each policy faces the same questions with the same outcomes.

| Calls | Typical overconfident twin outscores honest | Mildly overconfident twin outscores honest | Honest total is negative | Honest points a call | Spread of a session total (sd) |
|---|---|---|---|---|---|
| 20 | 30.4% | 40.5% | 3.9% | 33.2 | 347 |
| 50 | 19.4% | 33.6% | 0.3% | 33.4 | 554 |
| 100 | 10.2% | 26.2% | 0.0% | 33.3 | 783 |
| 150 | 5.8% | 20.7% | 0.0% | 33.3 | 945 |
| 200 | 3.3% | 18.1% | 0.0% | 33.3 | 1104 |
| 400 | 0.4% | 9.4% | 0.0% | 33.3 | 1567 |

- **Result:** one session is mostly luck. Typical overconfidence separates by 150 to 200 calls; mild overconfidence needs 400.
- **Change made:** gates, belts and triggers are judged on 150 calls or more. The scoreboard shows a 7-day average beside the day's total.

## 3. Gates

- **Intent:** a calibrated player passes most of the time; a miscalibrated one almost never.
- **Method:** same sessions; exact binomial for count-based exams.

Unit 1 gate (|mean stated - hit rate| <= 0.05 overall AND no band with >= 15 items further than z standard errors from its stated confidence, z = 2.5):

| Calls in the exam | Calibrated | Mildly overconfident | Typical overconfident | Underconfident | Always 99% |
|---|---|---|---|---|---|
| 100 | 75.5% | 43.5% | 7.5% | 12.2% | 0.0% |
| 150 | 83.2% | 40.6% | 2.9% | 7.8% | 0.0% |
| 200 (chosen) | 87.6% | 37.6% | 1.2% | 4.9% | 0.0% |
| 300 | 92.0% | 29.9% | 0.2% | 1.5% | 0.0% |
| 400 | 93.4% | 24.0% | 0.0% | 0.4% | 0.0% |

Unit 10 gate (400 calls, average confidence within 3 points of hit rate): calibrated 85.7%, mildly overconfident 18.4%, typical overconfident 0.1%.

Brown belt check (300 real predictions, within 5 points): calibrated 97.0%, typical overconfident 2.5%.

Unit 3 range gate, chance of passing by the player's true coverage:

| Exam | 50% | 70% | 80% | 90% (calibrated) | 99% (always wide) |
|---|---|---|---|---|---|
| 40 ranges, 33 to 38 hold | 0.0% | 5.5% | 43.6% | 87.8% | 6.1% |
| 60 ranges, 50 to 58 hold (chosen) | 0.0% | 1.4% | 32.3% | 95.2% | 12.1% |
| 80 ranges, 66 to 77 hold | 0.0% | 0.8% | 34.6% | 97.7% | 4.7% |

Count-based exams (exact binomial):

```
  Unit 4 Fermi (16 of 20)   skill 90%: 96%, skill 85%: 83%, skill 70%: 24%
  Units 5-6 (32 of 40)      skill 90%: 98%, skill 85%: 86%, skill 70%: 11%
  Unit 7 (22 of 28)         skill 90%: 98%, skill 85%: 88%, skill 70%: 22%
  Units 8-9 (24 of 30)      skill 90%: 97%, skill 85%: 85%, skill 70%: 16%
  Trigger L05 (fewer than 30 of 40 ranges hold): fires at true coverage 90%: 0.1%, 80%: 16.1%, 70%: 69.1%, 50%: 99.9%
```
- **Problems found:** the first gate design failed calibrated players 63% of the time (see top table).
- **Open risks:** a mildly overconfident player passes the Unit 1 gate about 4 times in 10. The Unit 10 gate and the belts on real predictions catch what Unit 1 lets through.

## 4. Lesson trigger for overconfidence (L01)

- **Intent:** fire on a real pattern within a week of play, and rarely on a calibrated player.
- **Method:** 3,000 runs of 150 calls stated at 90 to 99%, trigger checked after every call.

| Window and gap | False alarm on a calibrated player | Fires on mild overconfidence | median calls | Fires on typical overconfidence | median calls |
|---|---|---|---|---|---|
| 20 calls, 6 points | 71.9% | 99.6% | 26 | 100.0% | 20 |
| 20 calls, 8 points | 66.7% | 96.5% | 36 | 99.9% | 22 |
| 20 calls, 10 points | 50.3% | 96.0% | 37 | 99.9% | 22 |
| 30 calls, 6 points | 48.8% | 96.9% | 38 | 100.0% | 30 |
| 30 calls, 8 points | 41.5% | 90.9% | 47 | 99.5% | 30 |
| 30 calls, 10 points | 18.8% | 72.5% | 65 | 99.0% | 33 |
| 40 calls, 6 points | 35.0% | 92.0% | 49 | 99.9% | 40 |
| 40 calls, 8 points | 16.5% | 82.6% | 60 | 99.0% | 40 |
| 40 calls, 10 points (chosen) | 8.1% | 62.8% | 72 | 94.6% | 46 |

- **Change made:** 40 calls and a 10-point gap. A typical overconfident player makes about 9 top-band calls a day, so 46 calls is about five days.

## 4b. Lesson trigger for underconfidence (L02)

- **Intent:** the same as L01, in the 60 to 80% band, where the plan left the threshold OPEN (value 5).
- **Method:** 3,000 runs of 150 calls stated at 60 to 80% (`sim/trigger_sim.py`), the trigger checked after every call and, more realistically, once every 7 calls (about one session's worth of calls in that band).

| Window and gap | Looked at | False alarm on a calibrated player | Fires on mild underconfidence | median calls | Fires on typical underconfidence | median calls |
|---|---|---|---|---|---|---|
| 60 calls, 8 points | after every call | 44.0% | 90.8% | 63 | 100.0% | 60 |
| 60 calls, 8 points | every 7 calls (session end) | 34.0% | 84.9% | 70 | 99.8% | 63 |
| 60 calls, 10 points | after every call | 26.4% | 78.8% | 72 | 99.2% | 60 |
| 60 calls, 10 points | every 7 calls (session end) | 19.7% | 71.0% | 77 | 98.8% | 63 |
| 60 calls, 12 points | after every call | 13.8% | 60.6% | 80 | 97.5% | 60 |
| 60 calls, 12 points (chosen) | every 7 calls (session end) | 9.6% | 51.7% | 84 | 95.8% | 63 |
| 80 calls, 8 points | after every call | 23.4% | 78.1% | 81 | 99.5% | 80 |
| 80 calls, 8 points | every 7 calls (session end) | 17.9% | 71.8% | 84 | 98.9% | 84 |
| 80 calls, 10 points | after every call | 11.0% | 60.6% | 86 | 98.0% | 80 |
| 80 calls, 10 points | every 7 calls (session end) | 8.2% | 52.7% | 91 | 96.4% | 84 |
| 80 calls, 12 points | after every call | 4.6% | 40.4% | 94 | 93.4% | 80 |
| 80 calls, 12 points | every 7 calls (session end) | 3.1% | 33.3% | 98 | 89.5% | 84 |
| 100 calls, 8 points | after every call | 11.9% | 65.9% | 100 | 98.5% | 100 |
| 100 calls, 8 points | every 7 calls (session end) | 8.7% | 58.2% | 105 | 97.6% | 105 |
| 100 calls, 10 points | after every call | 4.6% | 45.2% | 102 | 95.3% | 100 |
| 100 calls, 10 points | every 7 calls (session end) | 3.3% | 38.2% | 105 | 93.1% | 105 |
| 100 calls, 12 points | after every call | 1.4% | 25.9% | 107 | 86.8% | 100 |
| 100 calls, 12 points | every 7 calls (session end) | 1.2% | 19.9% | 112 | 82.5% | 105 |
| 120 calls, 8 points | after every call | 6.0% | 54.4% | 120 | 97.7% | 120 |
| 120 calls, 8 points | every 7 calls (session end) | 4.2% | 47.4% | 126 | 96.7% | 126 |
| 120 calls, 10 points | after every call | 1.8% | 32.7% | 120 | 93.3% | 120 |
| 120 calls, 10 points | every 7 calls (session end) | 1.2% | 27.2% | 126 | 89.5% | 126 |
| 120 calls, 12 points | after every call | 0.4% | 16.2% | 121 | 81.1% | 120 |
| 120 calls, 12 points | every 7 calls (session end) | 0.3% | 12.6% | 126 | 76.3% | 126 |

- **Change made:** the plan's 60 calls and 10 points fired falsely on a calibrated player 19.7% of the time at session-end looks. 60 calls and 12 points: 9.6% false alarms, 95.8% of typical underconfident players caught in a median of 63 calls.

## 4c. Re-tests: what a pattern flag costs a player who really fixed the habit

- **Intent:** a flag clears after two re-tests (the next `clear_window` calls in the band, 3 and then 10 days after the drill). The question is whether that rule clears players who changed, keeps players who did not, and what it costs an honest fixer through bad luck alone.
- **Method:** `sim/retest_sim.py`, 20,000 runs per row. The typical old biases are the ones the L01 and L02 sims used (12 points over at 95%; 14 points under at 70%). A re-test passes when the gap between stated and hit rate is within `clear_gap` (7 points for both). A round is a pair of re-tests; three failed rounds escalate the flag.

| Trigger | Player after the drill | Window | Pass gap | Passes re-test 1 | Passes both re-tests | Clears within 3 rounds |
|---|---|---|---|---|---|---|
| L01 | fixed | 40 calls | 7 points | 95.1% | 90.5% | 99.9% |
| L01 | partly fixed | 40 calls | 7 points | 55.4% | 29.9% | 65.7% |
| L01 | unchanged | 40 calls | 7 points | 16.6% | 2.7% | 7.9% |
| L02 | fixed | 60 calls | 7 points | 79.8% | 63.1% | 95.0% |
| L02 | partly fixed | 60 calls | 7 points | 51.7% | 27.5% | 61.6% |
| L02 | unchanged | 60 calls | 7 points | 8.8% | 0.7% | 2.3% |

- **Reading it:** a player who truly fixed L01 clears 90.5% of the time on the first round and 99.9% within three rounds. A player who did nothing clears 2.7% of rounds. Half-fixed players are the middle: about a third pass a round, and two thirds clear in three rounds, which is the intended pressure to finish the job.
- **The cost to be honest about:** L02's re-test needs 60 calls inside a 20-point band, so a calibrated player fails one of its two re-tests by chance about a third of the time (63% pass both), and 5% of honest fixers fail all three rounds and escalate. A failed round adds a fire and repeats the lesson, so the harm is a repeated drill, not a lost belt. Widening `clear_gap` to 9 points raises the honest pass to about 76% but also lets half-fixed players through, so it is left at 7 and listed as an open risk.
- **Long-horizon false alarms:** the L01 and L02 tables above are for 150 calls. Over a year, with a flag open only when the trigger fires on calls after the last clearance, a calibrated player meets a false L02 fire about once in 10 windows of 60; the one-new-pattern-a-day and two-in-repair limits stop a burst, and a false fire is cleared by the first re-test that reads near zero.

## 5. Ranges

- **Intent:** neither going wide nor going narrow may beat an honest 90% range.
- **Method:** closed form; truth normally distributed around the player's best guess.

| Range habit | True coverage | Home-made score (1 a hit) | Interval score (lower is better) | Against honest |
|---|---|---|---|---|
| Honest 90% range | 90.0% | 0.90 | 4.13 | 1.00x |
| A bit narrow | 70.0% | 0.70 | 5.18 | 1.26x |
| Narrow | 50.0% | 0.50 | 7.32 | 1.77x |
| Wide | 99.0% | 0.99 | 5.22 | 1.26x |
| Absurdly wide | 100.0% | 1.00 | 10.00 | 2.42x |

- **Result:** the score is lowest at 90.0% coverage. A hit-counting rule would reward absurdly wide ranges.

## 5b. Ranges on the real bank (Block 6)

Section 5 is the closed form. This is the same game on the real range bank (`app/content/questions/ranges.json`, 200 practice and 180 exam ranges from the committed records), with the real rules from `data/scoring.json`. `sim/range_sim.py` (20,000 runs a row): each player says the question's reference interval stretched by a factor around its middle, and is judged on questions drawn at random.

| Player | Holds the truth | Width against reference | Points a range | Exam pass (50 to 58 of 60) | L05 fires | L06 fires | Re-test band met (33 to 38 of 40) |
|---|---|---|---|---|---|---|---|
| narrow 0.4x | 41.1% | 0.40x | -101.9 | 0.0% | 100.0% | 0.0% | 0.0% |
| narrow 0.6x | 56.7% | 0.60x | -39.7 | 0.0% | 97.4% | 0.0% | 0.1% |
| narrow 0.8x | 77.8% | 0.80x | -5.4 | 14.2% | 69.5% | 0.0% | 4.3% |
| the record 1.0x | 91.1% | 1.00x | -2.3 | 98.5% | 0.1% | 0.0% | 90.6% |
| a little wide 1.3x | 94.4% | 1.30x | -16.4 | 90.2% | 0.0% | 0.0% | 73.2% |
| wide 2x | 98.3% | 2.00x | -79.1 | 25.5% | 0.0% | 0.0% | 10.2% |
| padded 3x | 100.0% | 3.00x | -175.0 | 0.0% | 0.0% | 100.0% | 0.0% |

- **The gate does its job.** A player who says the record's own middle 90% passes the exam 98.5% of the time; a player 20% too narrow 14.2%, 40% too narrow 0.0%; twice too wide 25.5%, three times 0.0%.
- **L05 and L06 fire on the right people.** L05 fires on 97.4% of players at 0.6x and 0.1% of the record player; L06 only on the padded player (100.0% at 3x): a range 2x the reference is at the line, not over it.
- **Points are flat near the best range, as a fair score is.** The record player earns -2.3 a range and a player at 0.8x -5.4: the points barely tell them apart, but the exam does (98.5% against 14.2%). Being worse on either side is charged steeply: -102 at 0.4x, -175 at 3x.
- **The offset 1.25.** On bell-shaped outcomes the honest range's expected interval score is 1.254 reference widths (section 5); on the real bank, with the floor at -400, the record player averages -5.6 a range over all 380 questions, so knowing the record earns about 0. Some kinds (rain, life expectancy, child mortality) cost 2 to 3 reference widths on a miss-heavy average and others (income per person) 1.0, so points swing by kind; the Mirror shows the split.
- **Open risk:** the reference interval is the record's, so a player with knowledge the record lacks can beat it. That is the intent: it is the outside view, and beating it is the skill.

## 5c. Fermi and base rates on the real banks (Block 7)

`sim/problem_sim.py` plays the Unit 4 and Unit 5 exams on the real exam pools (`fermi.json` 48 problems, `rates.json` 60 rate problems) with the real rules from `data/scoring.json`. A Fermi player guesses every part with a log-normal error (natural-log sd in the first column) and states a range of factor f around the guess; the worksheet combines the parts and the whole is judged against its truth and reference interval. A calibrated player states f = exp(1.645 sd). A rate player answers the truth plus Gaussian noise (sd in points) and a lean.

| Fermi player | Hits of 20 | Median miss | Points a problem | Exam pass (16 hold and median miss within 3) |
|---|---|---|---|---|
| precise, calibrated (error sd 0.2) | 18.0 | 1.24x | +51 | 95.4% |
| typical, calibrated (error sd 0.4) | 18.0 | 1.52x | -15 | 95.4% |
| typical, overconfident (sd 0.4, says 1.3x) | 9.9 | 1.52x | -60 | 0.4% |
| rough, overconfident (sd 0.7, says 1.5x) | 8.7 | 2.10x | -131 | 0.1% |
| typical, humble (sd 0.4, says 3x) | 19.9 | 1.53x | -77 | 100.0% |
| rough, calibrated (sd 0.7) | 18.0 | 2.10x | -105 | 93.7% |

| Rate player | Within 7 of 40 | Points a problem | Exam pass (32 or more within 7) |
|---|---|---|---|
| knows the record (sd 3) | 39.3 | +67 | 100.0% |
| close (sd 5) | 34.6 | +46 | 91.3% |
| rough (sd 8) | 27.1 | +19 | 6.3% |
| rough, leans high (sd 8, +6) | 21.1 | -1 | 0.0% |
| anchored (sd 15) | 18.2 | -17 | 0.0% |

- **The Fermi gate separates calibrated from overconfident:** a calibrated player passes about 95.4% whatever their skill (a rough guesser 93.7%, a precise one 95.4%); an overconfident one almost never (0.4%). Skill shows in the points, not the pass.
- **Open risk: padding passes the gate.** A humble player who says 3x passes 100.0% (Unit 3 caps hits at 58 of 60 to stop this; Unit 4 does not), but earns -77 a problem against -15 for the calibrated player. If padding shows up in a real record, add an upper bound on hits or a width cap to the Unit 4 gate (one line in `data/scoring.json` and `gateU4`).
- **The Unit 5 gate asks for a real outside view:** a player within 3 points on average passes 100.0%, within 5 91.3%, within 8 6.3%; a lean of 6 points high with that noise 0.0%.

## 5d. Updating on the real evidence-stream bank (Block 8)

`sim/update_sim.py` plays the Unit 6 exam on the real exam pool (60 streams of two steps, `updates.json`), 20 streams a sitting pair as the app draws them, with the real rules from `data/scoring.json`. A player answers each step with prior + k x (truth - prior) + noise: k is the share of the deserved move taken (0 never moves, 1 exactly as far as the news is worth, above 1 too far), noise is a normal error in points. The gate needs 32 of 40 steps within 7 points and a mean gain of zero or more over staying at the prior.

| Player | Within 7 of 40 | Mean gain | Points a step | Within half passes | Gain half passes | Exam pass |
|---|---|---|---|---|---|---|
| never moves (k 0) | 23.7 | +0.0 | +11 | 0.1% | 100.0% | 0.1% |
| barely moves (k 0.3, noise 3) | 27.9 | +1.4 | +24 | 7.7% | 99.8% | 7.7% |
| under-reacts (k 0.6, noise 3) | 34.4 | +3.1 | +47 | 91.5% | 100.0% | 91.5% |
| calibrated, sharp (k 1, noise 3) | 39.2 | +4.4 | +66 | 100.0% | 100.0% | 100.0% |
| calibrated, typical (k 1, noise 5) | 33.7 | +2.9 | +44 | 82.5% | 100.0% | 82.5% |
| calibrated, rough (k 1, noise 8) | 24.9 | +0.5 | +13 | 1.2% | 70.2% | 1.2% |
| over-reacts (k 1.6, noise 3) | 30.4 | +2.1 | +33 | 33.2% | 100.0% | 33.2% |
| whiplash (k 2.5, noise 3) | 18.3 | -2.9 | -13 | 0.0% | 0.0% | 0.0% |
| noise chaser (k 0, noise 15) | 12.6 | -6.7 | -38 | 0.0% | 0.0% | 0.0% |

- **The bank is balanced on purpose:** news is worth 8 or more points on 36.7% of exam steps, 3 to 8 on 30.0% and under 3 on 33.3%. Staying at the prior is within 7 on 59.2% of steps, so a player who never moves earns +11 a step and passes 0.1%.
- **The within-7 half does the work.** A calibrated player with typical noise passes 82.5%, a rough one 1.2%; an over-reactor (k 1.6) passes 33.2% and a whiplash player (k 2.5) never. The gain half is nearly always met by anyone who moves the right way (70.2% even for the rough player), so it mostly catches whiplash and chasing noise.
- **Open risk: a half-hearted mover passes.** A player who takes only 60% of every deserved move (k 0.6, noise 3) passes 91.5%: with a tolerance of 7 and streams that are mostly small moves, under-reaction is forgiven. If real players do this, tighten `update_pass_within` or add a floor on the share of a big move taken (the Mirror already shows that share).

## 6. Real predictions: raw points against edge

- **Intent:** logging sure things must not pay.
- **Method:** 100,000 simulated predictions per profile under the Predict rule, before the edge weight.

| Profile | Raw points a call | Edge points a call |
|---|---|---|
| Logs only sure things | +88.4 | +0.0 |
| Real forecaster with private information | +26.3 | +14.5 |
| Real forecaster, overconfident | +23.9 | +12.1 |
| Copies the baseline | +11.8 | +0.0 |
| Moves off the baseline for no reason | -2.2 | -14.0 |

- **Result:** raw points have a DOMINANT strategy (sure things). Edge removes it. With edge weight 2, an average real call is worth 29 points against 33.4 for a calibrated gym call.

## 7. Session economy

- **Intent:** daily reveals from week one, a first calibration curve from the gym in the first week, a first journal bias map (100 resolved real predictions) in about four months at one prediction a day (inside two months at three a day), no dead way of playing hidden in the design.
- **Method:** `economy_sim.py sim/session_economy.json --runs 500 --steps 180`; one step is a day; 90% attendance.

| Way of playing | Days to 100 resolved real predictions | Scored calls by day 30 | Reveals a day, day 7 | Reveals a day, day 30 | Simulator flags |
|---|---|---|---|---|---|
| Designed session: 18 gym calls and 1 deep prediction a day (mixed horizons) | 124 | 488 | 0.3 | 0.8 | none |
| One prediction a day, nothing else | 118 | 21 | 0.5 | 0.9 | none |
| Gym only | never | 868 | 0.0 | 0.0 | FLAT, NO ENDING |
| Gym plus one month-long prediction a day (the limit) | 141 | 498 | 0.2 | 0.6 | none |
| Gym plus one next-day prediction a day (the limit) | 113 | 514 | 0.9 | 0.9 | none |
| Two long sessions a week | 131 | 562 | 0.5 | 0.7 | SWINGY |

Attendance sweep, designed session, days to 100 resolved real predictions:

```
Strategy comparison: 300 runs each, up to 240 steps; sweeping show_up

strategy           value map_ready   timeout    len  flags
designed_session     0.6      100%        0%  179.4  -
designed_session    0.75      100%        0%  146.7  -
designed_session     0.9      100%        0%  124.3  -
designed_session       1      100%        0%  113.0  -

Run with --strategy NAME for the full per-pool report of one strategy.
```

Streak at 90% attendance, halving on a missed day against a hard reset (last column, mean and p10..p90):

```
halve on a missed day (cool=0.5):
Mean (p10..p90) of tracked pools at checkpoints (finished runs hold their last value):
  step              feedback              resolved         reveals_today                streak
     1         16.2 (18..18)            0.0 (0..0)            0.0 (0..0)            0.9 (1..1)
    22      358.1 (324..396)          10.2 (9..11)            0.7 (1..1)          12.3 (5..22)
    45      732.1 (684..774)         29.4 (27..31)            0.9 (1..1)          16.1 (7..28)
    67    1088.1 (1026..1134)         49.0 (46..51)            0.9 (1..1)          16.9 (6..31)
    90    1460.2 (1386..1530)         69.6 (66..73)            0.9 (1..1)          17.4 (6..31)

hard reset (cool=1.0):
Mean (p10..p90) of tracked pools at checkpoints (finished runs hold their last value):
  step              feedback              resolved         reveals_today                streak
     1         16.2 (18..18)            0.0 (0..0)            0.0 (0..0)            0.9 (1..1)
    22      358.1 (324..396)          10.2 (9..11)            0.7 (1..1)           9.0 (1..22)
    45      732.1 (684..774)         29.4 (27..31)            0.9 (1..1)           9.0 (1..21)
    67    1088.1 (1026..1134)         49.0 (46..51)            0.9 (1..1)           8.6 (0..22)
    90    1460.2 (1386..1530)         69.6 (66..73)            0.9 (1..1)           8.8 (1..21)
```
- **Problems found:** gym-only play is flagged FLAT and NO ENDING on real evidence: it never builds a bias map. Intended, and the reason the journal is not optional.
- **Not dominant:** one next-day prediction a day reaches 100 fastest, but builds no week or month evidence. The Green belt requires 20 month-horizon results, so the mix stays.
- **Limit of the model:** predictions resolve at a constant daily rate per horizon, not on exact due dates.

## 8. Level curve

- **Intent:** first level-up in minutes, a level every day or two early, no late grind.
- **Method:** `xp_curve.py --model power --base 140 --exp 1.2 --levels 50 --xp-per-minute 52`.

| Level | Career points | Day reached | Days that level took |
|---|---|---|---|
| 2 | 140 | 0.2 | 0.2 |
| 5 | 1,724 | 2.2 | 0.9 |
| 10 | 8,991 | 11.5 | 2.5 |
| 15 | 22,823 | 29.3 | 4.3 |
| 20 | 43,811 | 56.2 | 6.1 |
| 25 | 72,401 | 92.8 | 8.1 |
| 30 | 108,950 | 139.7 | 10.2 |
| 40 | 207,095 | 265.5 | 14.6 |
| 50 | 340,255 | 436.2 | 19.2 |

- **Result:** the curve tool printed no warning (no dip, no six-figure costs, first level-up under 10 minutes, last level under 6 times a mid-game one).
- **Open risk:** 52 points a minute is an assumption (18 calibrated gym calls, about 2.6 reveals, habit points). Re-fit after two weeks of real play.

## 9. Unit pacing

- **Intent:** every unit fits its drills and its real-world evidence into 15 minutes a day.
- **Method:** `python3 sim/pacing.py` over `data/units.csv`, with 10% slack.

```
1. Unit pacing at 15 minutes a day (10% slack included)
unit name              drill days evidence days unit days  start   end
U0   Baseline                   3             0         4      1     4
U1   Calibration               17             0        19      5    23
U2   Sharp questions            5            10        11      5    15
U3   Ranges                    10             0        11     24    34
U4   Fermi                     18             0        20     35    54
U5   Outside view              13            15        17     55    71
U6   Updating                  14            24        27     72    98
U7   Second opinions           10            14        16     99   114
U8   Autopsy                   11            21        24    115   138
U9   Decisions                 12            21        24    139   162
U10  Fine grain                35             0        39    163   201
U11  With the machine           0            56        62    163   224
U12  Arena                      0           120       132    202   333

2. Arc ends and belt evidence (resolved real predictions from the session-economy sim)
  Yellow Calibrated  earliest day   61  needs  40 resolved, sim has    40  ok
  Green  Analyst     earliest day  184  needs 150 resolved, sim has   151  ok
  Brown  Judge       earliest day  351  needs 300 resolved, sim has   301  ok
  Black  Contender   earliest day  351  needs   0 resolved, sim has   301  external evidence
  Red    Elite       earliest day  566  needs   0 resolved, sim has   494  external evidence
  Units 0 to 11 complete on day 224 (7.4 months) if every gate is passed first time.
```

Session budget check:

```
  Arc I   reveals 2 min (13%), gym 5 min (33%), lesson 3 min (20%), journal 4 min (27%), scoreboard 1 min (7%)  total 15 ok
  Arc II  reveals 2 min (13%), gym 4 min (27%), lesson 3 min (20%), journal 5 min (33%), scoreboard 1 min (7%)  total 15 ok
  Arc III reveals 3 min (20%), gym 3 min (20%), lesson 2 min (13%), journal 6 min (40%), scoreboard 1 min (7%)  total 15 ok
  Arc IV  reveals 3 min (20%), gym 4 min (27%), lesson 1 min (7%), journal 6 min (40%), scoreboard 1 min (7%)  total 15 ok
```

## Open risks

The fourteen OPEN values and the block that settles each are listed in `design/mechanics.md`, section 6.

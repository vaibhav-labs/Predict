# Predict: resume here

Written 2026-11-15, when a session had to stop in the middle of Block 4. Read this first, then `STATE.md`
(the full state, reports for the player, assumptions, decisions) and `design/mechanics.md` (the rules). Update the
"Where it stands" section below every time you commit; it is what a fresh session reads.

## What this is

Predict is a 15-minute-a-day calibrated-forecasting game, an installable PWA on GitHub Pages
(https://vaibhav-labs.github.io/Predict/, repo https://github.com/vaibhav-labs/Predict, public, MIT). No frameworks,
ES modules, hash routes, relative URLs, a service worker that precaches everything or nothing. The player's record
lives on the phone (append-only event log, Export and Import); from Block 5 it syncs to a private `Predict-data`
repo with a token the player makes.

## Standing instructions from the player (never break these)

- Proceed without asking more questions; state assumptions in `STATE.md`.
- The in-app coach is **Predict** ("Ask Predict"). The word "Claude" never appears in the app: the tests check every
  screen and every file under `app/`, and the question checker rejects `claude|anthropic` in any question.
- Never commit the player's record, a backup, a token or personal question text to the public repo. Never use the
  player's private email in a commit or any external request. Commit identity: `Predict builder
  <noreply@users.noreply.github.com>` (already set in the repo's git config).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01W3QrnFd3mgVPjHcMBz26sk`.
- If a web fetch or search fails or a domain is reported blocked, do not fetch it another way (curl, Python,
  archives). Say so and use another source. Blocked so far: SSRN 2804554, science.org, PubMed, OpenSecrets, the NCAA
  page, FRED, the vega-datasets package page.
- The player wants short plain-language progress messages, and said: "keep saving the work more often so that in the
  next session it can pick up from where it left". So: commit after every step that passes, and refresh the bundle
  (below) and this file.
- The player's feedback that drives the content: the gym must test **judgment and prediction**, not arithmetic or
  hard knowledge (done: see STATE.md, "the question bank, rebuilt for judgment"). Our World in Data may be used where it fits.

## Where it stands (update this)

Branches in the repo (`/home/claude/predict-build` in the cloud workspace; also in the bundle, see "Saving"):

| Branch | Tip | What |
|---|---|---|
| `main` (= `origin/main`) | `165f3c3` | Blocks 1 and 2 plus the help screen, live |
| `block-3` | `9d5d90d` | Block 3, the Mirror: built, tested, not pushed or merged |
| `block-4` | see `git log` | on top of block-3: `0685fb1` the rebuilt judgment question bank (done, all tests green), `946dc17` WIP Block 4 engines |

All suites pass at `0685fb1`: `python3 tools/check_data.py` (also rebuilds both question banks and re-derives every
answer with independent code), `node --test tools/test_engine.mjs` (49), `python3 tools/test_pwa.py` (33),
`python3 tools/test_flow.py` (166), `python3 tools/test_blocks.py` (97). Run the three browser suites in separate
copies of the repo with different `PREDICT_PORT` values (they rebuild `site/`).

### Block 4 (The Lesson Engine): what exists, what is left

Exit test (data/build_blocks.csv, row BL4): a synthetic overconfident history fires L01 and a calibrated one does not,
at the simulated rates; the gate passes and fails the right synthetic players; a synthetic miss at 85% opens the
autopsy and builds a case file with all five lenses.

Exists and committed (`946dc17`, WIP, not wired into the app):

- `app/js/engine/lessons.js`: pattern triggers, flag lifecycle (`evaluate`, `flagsOf`), `instantNote`, autopsy queue
  (`autopsyDue`, `needsAutopsy`), `ruleCards`, `rechecksDue`.
- `app/js/engine/gate.js`: the fixed-exam Unit 1 gate (`gateU1`, `examsOf`, `gateStatus`, `examSittingSize`).
- `data/scoring.json`: `lessons`, `gates`, `gym.exam_*`, `gym.reseen_days` and review settings. L02's gap is 12 points
  (sim/trigger_sim.py found 10 fired falsely on a calibrated player 20% of the time).
- `tools/ref_lessons.py`: independent Python reference (`walk`, `gate`, `autopsies`).
- `tools/engine_tests/b4.mjs` and `walk.mjs` and `tools/synth.py`: 11 tests, **7 pass and 4 fail**: the walk comparison,
  the flag lifecycle (L15, the missed-days trigger, fires in scenarios that did not expect it), the failed re-test
  path, and the daily/in-repair limits. Not yet imported by `tools/test_engine.mjs` (it imports only `b3.mjs`), so CI is
  unaffected. First job: make those four pass, deciding in each case whether the test scenario or the engine is wrong,
  with `ref_lessons.py` as the tiebreaker, then add `import './engine_tests/b4.mjs';` below the b3 import.
- `design/balance-report.md` (section 4c partly), `sim/trigger_sim.py` and its outputs.

Left to do in Block 4, in this order:

1. Make `b4.mjs` pass; make `tools/ref_lessons.py gate` accept the compact calls format; import b4 in `test_engine.mjs`.
2. `luckOrJudgment`: a call whose `base` is null (a sourced question) counts as judgment; add
   `lessons.luck_rare_below` (about 0.2) and `gates.repair_drill_calls` (about 20) to `scoring.json`.
3. `app/js/app.js` loads only `starter.json` (about line 69): also load `exam-u1.json` and tag each pool (practice,
   exam). The exam pool must never be served in practice.
4. Screens and routes: instant note on the reveal, flag lesson card, drills (including the rewrite drill and a new
   `data/vague_claims.csv`), the exam hub, sittings (20 calls drawn up front, no feedback until judged), result,
   repair drill and retake; the autopsy form, journal blocking until a miss is autopsied, the rule card, rechecks,
   audit marks, lens updates in the case file; Today and Path integration; the L15 minimum session; `evaluate` calls
   on session end and app open; `BLOCKS_BUILT = 4`; help and Path text.
5. Browser phase `b4` in `tools/test_blocks.py`; a `check_data.py` consistency check (lessons config against
   `data/lesson_triggers.csv` minimum samples).
6. Docs: `STATE.md` (report for the player, Block 4 assumptions), `design/mechanics.md` 4.4, 4.5, 4.8, 4.9 and the change
   log, `design/balance-report.md` 4c (re-test pass rates and long-horizon false-alarm exposure), `README.md`.
7. Run all suites, commit on `block-4` with the trailers, refresh the bundle.

### Blocks 5 to 10 (each on its own chained branch: engine, UI, data, tests, docs)

BL5 Coach (sync adapter to the private `Predict-data` repo over the GitHub API with a mock-tested token flow, weekly
review inputs, world-outcome checks with sources, question top-ups, suggested prompts, the Ask Predict hand-off,
Predict's read; amend "no requests to other sites" only for this), BL6 Ranges, BL7 Reasoning tools, BL8 Updating,
BL9 Know yourself, BL10 Compete. Specs are rows BL5 to BL10 of `data/build_blocks.csv` and the sections of
`design/mechanics.md`.

### Delivery

The cloud workspace cannot push to GitHub. The hand-off is a git bundle of the branches, written into the player's
connected Mac folder (`Predict`), plus one paste-in prompt for Claude Code on the Mac: fetch the bundle, push the
branches, read CI through the public API, merge in order (block-3, block-4, ...), delete the bundle. No docs-only pushes
to `main` while building. Also re-sync the "VJ Games" project mirror and run every suite on the final tip.

## Saving (do this often)

```sh
cd /home/claude/predict-build
git add -A && git commit      # with the trailers above
git bundle create /mnt/user-data/outputs/predict-all.bundle --all
# then write it to the Mac folder with the device_commit_files tool (stagedPath = the bundle path,
# devicePath = /Users/jain/Documents/Predict/predict-all.bundle)
```

To restore in a fresh workspace: `git clone predict-all.bundle predict-build && cd predict-build && git checkout block-4`
(the bundle holds main, block-3 and block-4). The project "VJ Games" also holds a text mirror of the key files under
`predict/` (it is stale unless a note below says it was refreshed; the bundle is the complete copy).

## Still the player's to do

- The phone check for Blocks 1 to 3 (install from Safari, play from the icon, airplane mode, the "This device" card).
- Before Block 5: create the private `Predict-data` repo and a fine-grained token for it, and write the 5 to 10 line
  context note.
- Say whether the new questions feel right; IPL results would be the next record family if they want more sport.

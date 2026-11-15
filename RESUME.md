# Predict: resume here

Written 2026-11-15; refreshed after Block 4. Read this first, then `STATE.md`
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

| Branch | What |
|---|---|
| `main` (= `origin/main`, `165f3c3`) | Blocks 1 and 2 plus the help screen, live |
| `block-3` | Block 3, the Mirror: built, tested, not pushed or merged |
| `block-4` | on top of block-3: the rebuilt question bank and **Block 4, the Lesson Engine: done, all suites green** |

Suites on the Block 4 tip: `python3 tools/check_data.py` (also rebuilds both question banks), `node --test
tools/test_engine.mjs` (72), `python3 tools/test_pwa.py` (33), `python3 tools/test_flow.py` (166), `python3
tools/test_blocks.py` (203). Run the three browser suites in separate copies of the repo (tar without .git, site,
node_modules) with different `PREDICT_PORT` values; they rebuild `site/`.

Block 4 docs are written (STATE.md report and assumptions, mechanics 4.4/4.5/4.9 and the change log, balance report 4c
with `sim/retest_sim.py`). Open risk: L02's re-test fails a calibrated player about a third of the time (4c).

Next: Block 5 on a new branch `block-5` chained on `block-4`, then 6 to 10.

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

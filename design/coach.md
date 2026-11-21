# The coach loop (Block 5)

How the weekly review works, what it reads, what it writes and what the app does with it. The app has no key and no server: the
review is a scheduled task that runs somewhere else, reads the record from the player's private repository and writes one file back.
The app only ever reads that file, and only through the checks in `app/js/engine/coach.js`.

## The two repositories

| | Public `Predict` | Private `Predict-data` |
|---|---|---|
| Holds | the app, the data tables, the question banks, the tests | `record/<day>.jsonl` (the player's events), `coach/latest.json` (the review's output), `coach/archive/<week>.json`, `coach/topups-proposed.json` |
| Written by | the builder | the app (record) and the weekly review (coach) |
| Read by | everyone | the player's token, the review |

Nothing personal goes to the public repository. `tools/check_data.py` refuses a `.jsonl` record, a backup or a token anywhere in it.

## Setup the player does once (about five minutes)

1. On GitHub make a new repository named `Predict-data`, **private**, with a README so it has a first commit.
2. Make a fine-grained personal access token: only this repository, permission **Contents: read and write**, expiry 90 days.
3. In the app: Coach tab, Private repository, paste `your-name/Predict-data` and the token, Save and connect. The app refuses a public
   repository and a token that cannot write. The token is kept in this phone's storage only: never in an Export, never in the repo.
4. Write a context note (5 to 10 lines about the player's work and what they want to get better at) to `coach/context.md` in the
   private repo. The review reads it; the app does not.
5. Give the scheduled review read and write access to the private repository (a second token, or the repository's own deploy key).

## What the app does

- After each session, and on open, a few seconds after the last change: for every day whose event count changed, read
  `record/<day>.jsonl`, merge by event id (a union, never an overwrite), write it back; bring in events the file has that the phone
  does not (a second device). Then read `coach/latest.json`, cache it on the phone, and adopt Predict's baselines that arrived in time.
- Offline or failing, nothing is lost: the record is on the phone, and the next round sends it.
- The letter, the drill set, the three ideas for the day, Predict's read of a card, and a checked outcome with its source all come from
  `coach/latest.json` and appear as plain text. A link is shown only if it is https. Anything that fails a check is dropped, and
  a checked outcome without a source link is never shown.

## `coach/latest.json`

```json
{
  "version": 1,
  "week": "2026-W46",
  "written": "2026-11-15",
  "letter": { "title": "...", "paragraphs": ["...", "..."], "sources": [{ "label": "...", "url": "https://..." }] },
  "drills": [{ "title": "...", "text": "..." }],
  "prompts": [{ "day": "2026-11-16", "items": [{ "text": "By ..., ...", "domain": "world", "due": "month" }] }],
  "baselines": { "<prediction id>": { "p": 0.35, "written": "2026-11-15", "ref": "the reference class and span" } },
  "outcomes": { "<prediction id>": { "result": "yes", "source": "https://...", "checked": "2026-11-15", "note": "..." } },
  "reads": { "<prediction id>": { "text": "...", "written": "2026-11-15" } },
  "news": { "<prediction id>": { "text": "...", "written": "2026-11-15", "source": "https://..." } },
  "grades": { "<prediction id>": { "grade": "sound", "written": "2026-11-15", "note": "..." } }
}
```

Limits are in `app/js/engine/coach.js` and `tools/coach_validate.py`, which agree (`tools/test_coach.py` fails if they do not):
a title is 120 characters, a letter paragraph 700, at most 12 paragraphs, 3 ideas a day for up to 14 days, a read 900 characters,
a baseline between 1% and 99%.

### Rules for each part

- **Letter and drills.** Written to the player in Predict's voice, from the packet. Specific: name the band, the pattern, the
  number and its sample size. Never praise or blame from one call. The drill set is up to six short items built from the player's own
  misses (the escalated flags first). The builder's name never appears; the validator rejects it.
- **Three ideas a day, seven days ahead.** Concrete, dated, measurable predictions the player can make about their own work,
  life or the world, each one a claim a stranger could score. Mixed domains and due options. Not copies of past cards.
- **Baselines.** An outside-view probability for each open card that has none from Predict yet and is not due before this
  review. `ref` says the reference class and the span it covers. The app adopts it only if `written` is on or before the card's due
  day, and never after the card is resolved. The player's own locked baseline stays on the card as `b0`.
- **Checked outcomes.** For a due or open `world` card, look the outcome up and write `result`, the page you read as `source` (https),
  the date as `checked`. If the page does not settle it, leave it out: the player resolves it themselves. The player always confirms.
  Only a result the player used goes into the record, with its source.
- **Reads.** After a card resolves: what the chain got right and what the outcome says about it, in plain words, tied to the
  player's own marks if there is an autopsy. Under 900 characters.
- **Grades (Block 9, Unit 7).** For each card locked since Unit 7 opened that has a case against, grade the case against: `sound` when it names a specific
  reason the claim could be false that the card's own evidence does not already answer; `weak` when it is vague, generic or already answered; `missing` when it was left blank or
  restates the claim. `weak` and `missing` need a one-line `note` saying what a sound one would look like; `sound` may leave the note out. The app shows the grade on the card and counts them on the Mirror. A grade for
  an unknown or malformed id is dropped.
- **Top-ups.** Write proposed questions to `coach/topups-proposed.json` (shape in `tools/merge_topups.py`). They are documented
  facts about the world with their source page read on the date given, never anything from the player's record. The builder
  merges them into the public repo with `tools/merge_topups.py`; `tools/check_data.py` rejects any that break a rule.

## The weekly review (a scheduled task)

Runs once a week (Sunday evening local time suggests itself: the packet looks at the last seven days). Prompt:

> You are Predict, the coach in the Predict app. Work in a checkout of the private repository `Predict-data`.
> 1. Pull. Read `coach/context.md`.
> 2. Run `python3 tools/weekly_packet.py . --out /tmp/packet.json` from a checkout of the public `Predict` repository (clone it
>    read-only), and read the packet.
> 3. Check each `world_predictions_to_check` card against a primary or reputable source you actually read. Record only what a page
>    settles, with its URL. Write an outside-view baseline for each id in `predictions_without_predict_baseline`.
> 4. Write the letter, the drill set, seven days of ideas (3 a day, dates from `prompts_needed`), and a read for each card resolved
>    since the last review. Never use the builder's name: you are Predict.
> 5. Write `coach/latest.json`, copy it to `coach/archive/<week>.json`, and run `python3 tools/coach_validate.py coach/latest.json`.
>    Fix everything it says would be dropped. Optionally write `coach/topups-proposed.json`.
> 6. Commit and push to the private repository only. Do not touch the public repository. If a step fails, write
>    `coach/last-error.txt` and stop: a missing week is better than a wrong one.

The loop is unattended, so it fails safe: a missing or invalid file leaves the app exactly as it was, and the player's own record
never depends on the review.

## Not done in Block 5

Predict's own forecast on a world question, committed before the question opens (Block 10). Case-against grading (Block 9). The
review does not yet read the app's flag chains beyond their state.

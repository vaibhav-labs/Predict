// Updating (Block 8, design/mechanics.md 4.12): the update action on an open journal card, the time-weighted score of a card that was updated,
// the two patterns that read updates (L10 frozen forecasts, L11 whiplash), and the Unit 6 problems (an evidence stream: a prior, news, a new number).
// Pure functions of the record and data/scoring.json. No page, no storage.
import { addDays } from './record.js';
import { journalScore } from './journal.js';
import { roundHalfEven } from './scoring.js';

const EPS = 1e-9;
const dayOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ---- the update action ----------------------------------------------------------------------------------------------------
// Whether a card can be updated now, and why not. Only an open card (not yet due) can; the new probability must differ from the one in force;
// the reason needs min_reason_chars; the probability stays inside the journal's 1 to 99 percent.
export function checkUpdate(p, cNew, reason, cfg) {
  const U = cfg.problems.update.update_rule;
  if (!p || p.state !== 'open') return { ok: false, error: 'Only a card that is still open can be updated.' };
  if (typeof cNew !== 'number' || !Number.isFinite(cNew)) return { ok: false, error: 'Pick a probability.' };
  const J = cfg.journal;
  if (cNew < J.probability_min - EPS || cNew > J.probability_max + EPS) return { ok: false, error: 'A probability runs from 1 to 99 percent.' };
  const now = typeof p.cNow === 'number' ? p.cNow : p.c;
  if (Math.abs(cNew - now) < 0.005) return { ok: false, error: 'That is the number already in force. Move it, or leave the card as it is.' };
  if (String(reason || '').trim().length < U.min_reason_chars) return { ok: false, error: 'Say in a line what changed your mind.' };
  return { ok: true, prev: now, move: cNew - now };
}

// The forecast in force on each calendar day from the day the card was locked to `endDay`: the locked number, then each update from its own day on
// (an update on the lock day replaces the locked number; a second update on a day replaces the first). Updates dated after `endDay` are ignored.
export function timeline(p, endDay) {
  const ups = (p.updates || []).filter((u) => u.d <= endDay);
  const days = [];
  const last = Math.max(0, daysBetween(p.d, endDay));
  let c = p.c, i = 0;
  const sorted = ups.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (let k = 0; k <= last; k++) {
    const d = addDays(p.d, k);
    while (i < sorted.length && sorted[i].d <= d) { c = sorted[i].c; i++; }
    days.push({ d, c });
  }
  return days;
}

// The score of a card over its life: the average of the daily scores, each day scored at the forecast in force that day, from the lock day to
// the resolve day (both counted). With no update every day carries the locked number and the result is the ordinary score. `raw0` and `edge0`
// are what the locked number alone would have scored, and `gain` is how much the updates added (or cost).
export function twScore(S, p, endDay, outcomeYes, edgeWeight) {
  const days = timeline(p, endDay);
  let raw = 0, edge = 0;
  for (const x of days) { const s = journalScore(S, x.c, p.b, outcomeYes, edgeWeight); raw += s.raw; edge += s.edge; }
  const n = days.length;
  const first = journalScore(S, p.c, p.b, outcomeYes, edgeWeight);
  const avgRaw = raw / n, avgEdge = edge / n;
  return { raw: avgRaw, edge: avgEdge, raw0: first.raw, edge0: first.edge, gain: avgEdge - first.edge, days: n, updates: (p.updates || []).filter((u) => u.d <= endDay).length };
}

// ---- patterns ---------------------------------------------------------------------------------------------------------------
// A large move: an update that moved the card's number by `large` (25 points) or more. It was reversed when, within `reverse_days` days, a later
// update on the same card took it back past the middle of the move. It can be judged once it was reversed, or the window has run out, or the card
// has resolved (no further update is possible).
export function largeMoves(predictions, today, t) {
  const out = [];
  for (const p of predictions) {
    const ups = (p.updates || []).slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    ups.forEach((u, i) => {
      const prev = typeof u.prev === 'number' ? u.prev : i === 0 ? p.c : ups[i - 1].c;
      if (Math.abs(u.c - prev) < t.large - EPS) return;
      const mid = (prev + u.c) / 2, up = u.c > prev;
      const later = ups.slice(i + 1).filter((x) => daysBetween(u.d, x.d) <= t.reverse_days);
      const reversed = later.some((x) => (up ? x.c <= mid + EPS : x.c >= mid - EPS));
      const closed = reversed || p.state === 'resolved' || daysBetween(u.d, today) > t.reverse_days;
      out.push({ prediction: p.id, t: u.t, d: u.d, prev, c: u.c, reversed, judged: closed });
    });
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}
export const whiplashObs = (predictions, today, t, since = '', readyDay = '') => largeMoves(predictions, today, t).filter((m) => m.judged && (!since || m.t > since) && (!readyDay || m.d >= readyDay));

// L10: open cards older than `news_days` days that the weekly review found news for, with no update since the review wrote the note.
export function frozenCards(predictions, news, today, t) {
  const out = [];
  for (const p of predictions) {
    const n = news && news[p.id];
    if (!n || p.state !== 'open' || daysBetween(p.d, today) <= t.news_days) continue;
    if ((p.updates || []).some((u) => u.d >= n.written)) continue;
    out.push({ prediction: p.id, written: n.written, waited: daysBetween(n.written, today) });
  }
  return out;
}

// ---- the Unit 6 problems ----------------------------------------------------------------------------------------------------
// A problem is one step of an evidence stream. `q` = { prior, truth, ... }; the player types the new probability (percent).
export function scoreUpdate(q, guess, cfg) {
  const U = cfg.problems.update;
  const miss = Math.abs(guess - q.truth);
  const points = Math.max(U.floor, roundHalfEven(U.full_points * (1 - miss / U.tolerance)));
  return { guess, truth: q.truth, prior: q.prior, miss, signed: guess - q.truth, hit: miss <= U.tolerance + EPS, points, gain: Math.abs(q.prior - q.truth) - miss, moved: guess - q.prior };
}
// Unit 6: 32 or more of 40 steps within 7 points, and on average the answers sit no further from the truth than leaving the prior alone would.
export function gateU6(probs, gates) {
  const n = probs.length;
  const hits = probs.filter((p) => p.hit).length;
  const gain = n ? probs.reduce((s, p) => s + p.gain, 0) / n : null;
  const bias = n ? probs.reduce((s, p) => s + p.signed, 0) / n : null;
  const reasons = [];
  if (n > 0 && hits < gates.update_pass_within) reasons.push('within');
  if (n > 0 && gain < gates.update_gain_min - EPS) reasons.push('gain');
  return { n, hits, within: hits, meanGain: gain, bias, meanMiss: n ? probs.reduce((s, p) => s + p.miss, 0) / n : null, points: probs.reduce((s, p) => s + p.points, 0),
    pass: n > 0 && reasons.length === 0, reasons, dir: reasons.includes('gain') ? 'moved the wrong way' : reasons.includes('within') ? (bias > 0 ? 'too high' : 'too low') : null, need: gates.update_pass_within };
}
// How the Mirror reads the player's updates: how many steps, within 7, whether they moved toward the truth and how much of the move they made.
export function describeUpdates(list, { thinBelow = 10 } = {}) {
  const n = list.length;
  if (!n) return { n: 0, within: 0, rate: null, meanGain: null, underMove: null, thin: true, points: 0 };
  const within = list.filter((p) => p.hit).length;
  const big = list.filter((p) => Math.abs(p.truth - p.prior) >= 8);
  // Of the steps where the truth sat 8 or more points from the prior: the average share of the way the player moved (1 = all the way, 0 = stayed put).
  const share = big.length ? big.reduce((s, p) => s + (p.moved / (p.truth - p.prior)), 0) / big.length : null;
  return { n, within, rate: within / n, meanGain: list.reduce((s, p) => s + p.gain, 0) / n, moveShare: share, bigN: big.length, thin: n < thinBelow, points: list.reduce((s, p) => s + p.points, 0) };
}

// The value of the player's journal updates: over resolved scored cards that were updated, the average edge the updates added.
export function updateValue(predictions) {
  const rows = predictions.filter((p) => p.state === 'resolved' && p.scored && (p.outcome === 'yes' || p.outcome === 'no') && typeof p.edge0 === 'number' && typeof p.edge === 'number' && (p.updates || []).length);
  if (!rows.length) return { n: 0, mean: null, total: 0 };
  const total = rows.reduce((s, p) => s + (p.edge - p.edge0), 0);
  return { n: rows.length, mean: total / rows.length, total };
}
export { dayOf };

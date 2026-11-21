// Know yourself (Block 9, design/mechanics.md 4.13): the choice problems of Units 7 to 9, the memory check, the decision card, the
// weekly review's grade of a case against, and the value of a second estimate. Pure functions of the record and data/scoring.json
// ("problems.choice", "gates", "memory", "decision"): no page, no storage.
import { addDays, daysBetween, callsOf } from './record.js';
import { shuffle } from './draw.js';

const EPS = 1e-9;
const round2 = (x) => Math.round(x * 100) / 100;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// ---- choice problems ---------------------------------------------------------------------------------------------------
// The units that ask them, and the keys their gate numbers sit under in data/scoring.json ("gates": <key>_exam_calls, <key>_pass_right, <key>_repair_calls).
export const CHOICE_UNITS = { U7: 'counter', U8: 'luck', U9: 'decision' };
export const isChoiceUnit = (unit) => Object.prototype.hasOwnProperty.call(CHOICE_UNITS, unit);

export function scoreChoice(q, choice, cfg) {
  const C = cfg.problems.choice;
  const hit = choice === q.right;
  return { choice, right: q.right, hit, points: hit ? C.right_points : C.wrong_points };
}

// Unit 7, 8 or 9: `need` of the exam's problems right. (Unit 8 also reads the memory checks: see gateU8.)
export function gateChoice(unit, probs, gates) {
  const key = CHOICE_UNITS[unit];
  const need = gates[`${key}_pass_right`];
  const n = probs.length;
  const hits = probs.filter((p) => p.hit).length;
  const reasons = [];
  if (n > 0 && hits < need) reasons.push('right');
  return { n, hits, right: hits, points: probs.reduce((s, p) => s + p.points, 0), pass: n > 0 && reasons.length === 0, reasons, dir: reasons.length ? 'too many wrong' : null, need };
}
export const gateU7 = (probs, gates) => gateChoice('U7', probs, gates);
export const gateU9 = (probs, gates) => gateChoice('U9', probs, gates);
// Unit 8: `luck_pass_right` of 30 right AND the average drift of the last memory_window memory checks within memory_drift_max.
export function gateU8(probs, gates, extra = {}) {
  const v = gateChoice('U8', probs, gates);
  const m = extra.memory || null;
  const reasons = v.reasons.slice();
  if (v.n > 0 && m && m.n > 0 && Math.abs(m.drift) > gates.memory_drift_max + EPS) reasons.push('memory');
  return { ...v, reasons, pass: v.n > 0 && reasons.length === 0, memoryDrift: m ? m.drift : null, memoryN: m ? m.n : 0, dir: reasons.includes('memory') ? 'rewrites the past' : v.dir };
}
export const choiceGateOf = (unit) => (unit === 'U7' ? gateU7 : unit === 'U8' ? gateU8 : gateU9);

// Which bank items serve a unit's practice, and which its exam. An item has `family` ('counter', 'second', 'luck', 'act', 'threshold', 'value') and `pool`.
export const practiceFamilies = (unit, cfg) => cfg.problems.choice[unit].families;
export const examFamilies = (unit, cfg) => { const f = cfg.problems.choice[unit].exam_family; return f ? [f] : cfg.problems.choice[unit].families; };

// What the Mirror reads from the player's choice problems of one family or unit.
export function describeChoices(list, { thinBelow = 10 } = {}) {
  const n = list.length;
  if (!n) return { n: 0, right: 0, rate: null, thin: true, points: 0 };
  const right = list.filter((p) => p.hit).length;
  return { n, right, rate: right / n, thin: n < thinBelow, points: list.reduce((s, p) => s + p.points, 0) };
}

// ---- the second number (Unit 7 practice) -------------------------------------------------------------------------------------
// A counter-argument came with a likelihood ratio: how many times more likely the evidence is if the claim is false than if it is true.
// The right second number is the Bayes posterior; an item lists it among options that stay put, overshoot, or move the wrong way.
export function posterior(prior, lr) {
  const odds = (prior / (1 - prior)) / lr;
  return odds / (1 + odds);
}

// ---- the memory check (Unit 8) ----------------------------------------------------------------------------------------------
// Events: `memory` { src: 'card' | 'call', ref, recalled, recorded, mode: 'card' | 'practice' | 'drill', session?, flag? }. `recalled` and `recorded` are what the
// player remembered and what the record says, as probabilities in the units of the source: a card's chance of yes, a call's confidence in its side.
// Drift is positive when the recalled number moved toward what happened: (recalled - recorded) when yes / a hit, the reverse otherwise.
export const shiftToward = (recalled, recorded, towardUp) => (towardUp ? recalled - recorded : recorded - recalled);

// Every memory check whose outcome is known, oldest first, each with its drift.
export function memoryObs(events, predictions) {
  const preds = new Map(predictions.map((p) => [p.id, p]));
  const calls = new Map(events.filter((e) => e.type === 'call').map((e) => [e.id, e]));
  const out = [];
  for (const e of events) {
    if (e.type !== 'memory') continue;
    let up = null;
    if (e.src === 'card') {
      const p = preds.get(e.ref);
      if (p && p.state === 'resolved' && (p.outcome === 'yes' || p.outcome === 'no')) up = p.outcome === 'yes';
    } else if (e.src === 'call') {
      const c = calls.get(e.ref);
      if (c) up = !!c.hit;
    }
    if (up === null) continue;
    out.push({ id: e.id, t: e.t, d: e.d, src: e.src, ref: e.ref, mode: e.mode, recalled: e.recalled, recorded: e.recorded, shift: shiftToward(e.recalled, e.recorded, up), abs: Math.abs(e.recalled - e.recorded) });
  }
  return out;
}
// The last `window` checks: how many, the average drift (positive = rewriting toward the outcome), the average size of the error.
export function memoryStats(obs, window) {
  const w = window ? obs.slice(-window) : obs;
  return { n: w.length, all: obs.length, drift: mean(w.map((o) => o.shift)) ?? 0, meanAbs: mean(w.map((o) => o.abs)), toward: w.filter((o) => o.shift > EPS).length };
}
export const memoryChecked = (events, src, ref) => events.some((e) => e.type === 'memory' && e.src === src && e.ref === ref);

// Gym calls a practice check can ask about: a natural call (not an exam call, which stays sealed), at least min_age_days days old, not asked before.
export function memoryCandidates(events, today, cfg) {
  const M = cfg.memory;
  const asked = new Set(events.filter((e) => e.type === 'memory' && e.src === 'call').map((e) => e.ref));
  return callsOf(events).filter((c) => cfg.lessons.natural_modes.includes(c.mode) && !asked.has(c.id) && daysBetween(c.d, today) >= M.min_age_days && c.claim);
}
export function planMemory({ events, today, cfg, size, rng }) {
  return shuffle(memoryCandidates(events, today, cfg), rng).slice(0, size).map((c) => c.id);
}
// A due card needs its memory check before the record is shown, once the player is in Unit 8.
export const memoryRequired = (p, events, open) => open && p.state === 'due' && !memoryChecked(events, 'card', p.id);

export function checkRecall(text, lo, hi) {
  const t = String(text ?? '').trim().replace(/%$/, '');
  if (t === '') return { ok: false, error: 'Type the number you remember, as a percent.' };
  const x = Number(t);
  if (!Number.isFinite(x)) return { ok: false, error: 'Use numbers only, like 70.' };
  const v = round2(x / 100);
  if (v < lo - EPS || v > hi + EPS) return { ok: false, error: `A forecast here runs from ${Math.round(lo * 100)} to ${Math.round(hi * 100)} percent.` };
  return { ok: true, value: v };
}

// ---- the decision card (Unit 9) --------------------------------------------------------------------------------------------------
// Events: `decision` { text, option, p, gain, loss, threshold, rule, choice, review } and `decision_review` { decision, outcome: yes | no | void, again, note }.
export const breakEven = (gain, loss) => loss / (gain + loss);
export const ruleOf = (p, gain, loss) => (p > breakEven(gain, loss) + EPS ? 'act' : 'hold');
const intIn = (v, lo, hi) => { const x = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isInteger(x) && x >= lo && x <= hi ? x : null; };

export function checkDecision(f, cfg, today) {
  const D = cfg.decision;
  if (String(f.text || '').trim().length < 8) return { ok: false, error: 'Say what you are deciding, in a line.' };
  if (String(f.option || '').trim().length < 3) return { ok: false, error: 'Say what you would do if you act.' };
  const p = Number(f.p);
  if (!Number.isFinite(p) || p < cfg.journal.probability_min - EPS || p > cfg.journal.probability_max + EPS) return { ok: false, error: 'Your forecast runs from 1 to 99 percent.' };
  const gain = intIn(f.gain, D.min_stake, D.max_stake), loss = intIn(f.loss, D.min_stake, D.max_stake);
  if (gain === null) return { ok: false, error: `What you gain if you act and are right: a whole number from ${D.min_stake} up.` };
  if (loss === null) return { ok: false, error: `What you lose if you act and are wrong: a whole number from ${D.min_stake} up.` };
  if (f.choice !== 'act' && f.choice !== 'hold') return { ok: false, error: 'Say whether you will act or hold off.' };
  const review = String(f.review || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review)) return { ok: false, error: 'Pick a review date.' };
  const days = daysBetween(today, review);
  if (days < D.min_review_days) return { ok: false, error: `Review at least ${D.min_review_days} days from today: long enough for the result to show.` };
  if (days > D.max_review_days) return { ok: false, error: `Review within ${D.max_review_days} days.` };
  const threshold = breakEven(gain, loss);
  return { ok: true, p: round2(p), gain, loss, threshold, rule: ruleOf(p, gain, loss), review };
}

// Every decision card with where it stands: open until its review day, due from then until reviewed, then reviewed with the value of the choice made
// and of the choice the rule would have made. Void outcomes carry no value.
export function decisionsOf(events, today) {
  const reviews = new Map(events.filter((e) => e.type === 'decision_review').map((e) => [e.decision, e]));
  return events.filter((e) => e.type === 'decision').map((d) => {
    const r = reviews.get(d.id) || null;
    const state = r ? 'reviewed' : d.review <= today ? 'due' : 'open';
    const worth = (choice, yes) => (choice === 'act' ? (yes ? d.gain : -d.loss) : 0);
    const known = r && (r.outcome === 'yes' || r.outcome === 'no');
    return { ...d, state, review_event: r, outcome: r ? r.outcome : null, again: r ? r.again : null,
      value: known ? worth(d.choice, r.outcome === 'yes') : null, ruleValue: known ? worth(d.rule, r.outcome === 'yes') : null, followed: d.choice === d.rule };
  }).sort((a, b) => (a.review < b.review ? -1 : a.review > b.review ? 1 : a.t < b.t ? -1 : 1));
}
export const decisionsDue = (list) => list.filter((d) => d.state === 'due');
export function describeDecisions(list) {
  const done = list.filter((d) => d.state === 'reviewed');
  const scored = done.filter((d) => d.value !== null);
  const followed = done.filter((d) => d.followed);
  const hit = scored.filter((d) => (d.p >= 0.5) === (d.outcome === 'yes'));
  return {
    n: list.length, reviewed: done.length, open: list.filter((d) => d.state === 'open').length, due: list.filter((d) => d.state === 'due').length,
    followedShare: done.length ? followed.length / done.length : null, value: scored.reduce((s, d) => s + d.value, 0), ruleValue: scored.reduce((s, d) => s + d.ruleValue, 0), scoredN: scored.length,
    sameAgain: done.filter((d) => d.again === 'same').length, forecastRight: scored.length ? hit.length / scored.length : null,
  };
}

// ---- the weekly review's grade of a case against (Unit 7) ----------------------------------------------------------------
// The review writes `grades` { <card id>: { grade: 'sound' | 'weak' | 'missing', note, written } } into coach/latest.json (engine/coach.js checks it).
// A case against is sound when it names a specific reason the claim could be false that the card's own evidence does not already answer.
export const gradeOf = (coach, p) => (coach && coach.grades && coach.grades[p.id]) || null;
export function describeGrades(predictions, coach) {
  const mine = predictions.filter((p) => p.chain && p.chain.caseAgainst && String(p.chain.caseAgainst.text || '').trim());
  const rows = mine.map((p) => ({ p, g: gradeOf(coach, p) }));
  const graded = rows.filter((r) => r.g);
  return { n: mine.length, graded: graded.length, sound: graded.filter((r) => r.g.grade === 'sound').length, weak: graded.filter((r) => r.g.grade === 'weak').length, waiting: rows.length - graded.length };
}

// ---- the second estimate (Unit 7) -------------------------------------------------------------------------------------------------
// From Unit 7 a card is written in two numbers: a gut number first, then the final one after the chain (including the case against). `first` is stored on the card.
// The value of the second number over resolved scored cards that carry both: how many points a card earned from the chain, on average.
export function secondValue(S, predictions) {
  const rows = predictions.filter((p) => p.state === 'resolved' && p.scored && (p.outcome === 'yes' || p.outcome === 'no') && typeof p.first === 'number');
  if (!rows.length) return { n: 0, mean: null, moved: null, better: 0 };
  const diffs = rows.map((p) => { const yes = p.outcome === 'yes'; return S.score(p.c, yes) - S.score(p.first, yes); });
  return { n: rows.length, mean: mean(diffs), moved: mean(rows.map((p) => Math.abs(p.c - p.first))), better: diffs.filter((x) => x > EPS).length, same: diffs.filter((x) => Math.abs(x) <= EPS).length };
}

export { addDays };

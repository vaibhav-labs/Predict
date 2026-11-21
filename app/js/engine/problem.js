// Units 4 and 5 (design/mechanics.md 4.11): the break-it-down worksheet for Fermi problems, base-rate problems, reference-class
// ladders and probability chains. Pure functions of the record and data/scoring.json ("problems", "gates", "interval"): no page,
// no storage. A Fermi problem is scored as a range on its whole (engine/range.js); a percent problem counts when it lands within
// `tolerance` points of the truth.
import { roundHalfEven } from './scoring.js';
import { allProbsOf, daysBetween, localDay } from './record.js';
import { examsOf } from './gate.js';
import { ACTIVE, flagsOf } from './lessons.js';
import { shuffle, availablePool } from './draw.js';
import { scoreRange, checkInput } from './range.js';

// ---- the worksheet: combine the parts' ranges into a range for the whole -------------------------------------------------
// Each part is a (low, high) the player would bet 19 to 1 on. In log space a product is a sum: the centres add, and the
// half-widths add in quadrature, because the parts' errors are taken to be independent (one part running high is no reason for
// another to). The result is a range for the whole that is wider than any one part but much narrower than the naive one, which
// multiplies every low and every high and so assumes every part is wrong the same way at once.
export function combineRanges(parts, mult = 1) {
  let centre = Math.log10(mult), sq = 0;
  for (const p of parts) {
    const a = Math.log10(p.low), b = Math.log10(p.high);
    centre += (a + b) / 2;
    sq += ((b - a) / 2) ** 2;
  }
  const half = Math.sqrt(sq);
  return { low: 10 ** (centre - half), high: 10 ** (centre + half), centre: 10 ** centre, logCentre: centre, logHalf: half };
}
export function naiveRange(parts, mult = 1) {
  return { low: parts.reduce((s, p) => s * p.low, mult), high: parts.reduce((s, p) => s * p.high, mult) };
}
// The product of a chain of probabilities (each given the ones before it).
export const chainProduct = (ps) => ps.reduce((s, p) => s * p, 1);

// Check what the player typed for one part (the same rules as a range question) and for every part of a problem.
export function checkParts(q, entries) {
  const out = [];
  for (let i = 0; i < q.parts.length; i++) {
    const e = entries[i] || {};
    const r = checkInput({ scale: 'log' }, e.low, e.high);
    if (!r.ok) return { ok: false, index: i, error: r.error };
    out.push({ low: r.low, high: r.high });
  }
  return { ok: true, parts: out };
}

// How far, as a factor, the truth sits from the middle of a range (the geometric middle): 1 is dead centre, 3 is a factor of three away.
export const missFactor = (low, high, truth) => 10 ** Math.abs(Math.log10(truth) - (Math.log10(low) + Math.log10(high)) / 2);

// Score a Fermi problem: every part against its own truth, the combined range against the whole's truth and reference interval.
// `direct` is the player's first guess before the worksheet (a low and a high), scored the same way, for comparison only.
export function scoreFermi(q, entries, cfg, direct = null) {
  const parts = entries.map((e, i) => ({ low: e.low, high: e.high, truth: q.parts[i].truth, hit: e.low <= q.parts[i].truth && q.parts[i].truth <= e.high }));
  const range = combineRanges(parts, q.mult);
  const sc = scoreRange(q, range.low, range.high, cfg);
  const out = { ...sc, low: range.low, high: range.high, parts, partsHit: parts.filter((p) => p.hit).length, miss: missFactor(range.low, range.high, q.truth), naive: naiveRange(parts, q.mult) };
  if (direct) { const d = scoreRange(q, direct.low, direct.high, cfg); out.direct = { low: direct.low, high: direct.high, hit: d.hit, points: d.points, ratio: d.ratio, miss: missFactor(direct.low, direct.high, q.truth) }; }
  return out;
}

// ---- percent problems ------------------------------------------------------------------------------------------------------
export function checkPercent(text) {
  const t = String(text ?? '').trim().replace(/%$/, '');
  if (t === '') return { ok: false, error: 'Type a percent from 0 to 100.' };
  const x = Number(t);
  if (!Number.isFinite(x)) return { ok: false, error: 'Use numbers only, like 35.' };
  if (x < 0 || x > 100) return { ok: false, error: 'A percent runs from 0 to 100.' };
  return { ok: true, value: x };
}
export function ratePoints(miss, R) {
  return Math.max(R.floor, roundHalfEven(R.full_points * (1 - miss / R.tolerance)));
}
export function scoreRate(q, guess, cfg) {
  const R = cfg.problems.rate;
  const miss = Math.abs(guess - q.truth);
  return { guess, truth: q.truth, miss, signed: guess - q.truth, hit: miss <= R.tolerance + 1e-9, points: ratePoints(miss, R) };
}
export function scoreClass(q, choice, cfg) {
  const R = cfg.problems.rate;
  const hit = choice === q.right;
  return { choice, right: q.right, hit, points: hit ? R.class_right : R.class_wrong };
}
// The right rung of a ladder, from the counts: the narrowest group that still holds class_min_cases cases.
export const rightRung = (classes, min) => classes.reduce((best, c, i) => (c.n >= min ? i : best), 0);

// ---- the gates ----------------------------------------------------------------------------------------------------------------
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

// Unit 4: 16 or more of 20 worksheet ranges hold the truth, and the median miss is within a factor of 3.
export function gateU4(probs, gates) {
  const n = probs.length;
  const hits = probs.filter((p) => p.hit).length;
  const factors = probs.map((p) => p.miss);
  const medianMiss = median(factors);
  const reasons = [];
  if (n > 0 && hits < gates.fermi_pass_hits) reasons.push('hits');
  if (n > 0 && medianMiss > gates.fermi_median_factor + 1e-9) reasons.push('factor');
  const ratios = probs.map((p) => p.ratio).filter((x) => typeof x === 'number');
  return { n, hits, coverage: n ? hits / n : null, medianMiss, meanRatio: ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : null, points: probs.reduce((s, p) => s + p.points, 0),
    pass: n > 0 && reasons.length === 0, reasons, dir: reasons.includes('hits') ? 'too narrow' : reasons.includes('factor') ? 'too far off' : null, need: gates.fermi_pass_hits, factor: gates.fermi_median_factor };
}
// Unit 5: 32 or more of 40 base-rate answers within 7 points.
export function gateU5(probs, gates) {
  const n = probs.length;
  const within = probs.filter((p) => p.hit).length;
  const bias = n ? probs.reduce((s, p) => s + p.signed, 0) / n : null;
  const reasons = [];
  if (n > 0 && within < gates.rate_pass_within) reasons.push('within');
  return { n, hits: within, within, meanMiss: n ? probs.reduce((s, p) => s + p.miss, 0) / n : null, bias, points: probs.reduce((s, p) => s + p.points, 0), pass: n > 0 && reasons.length === 0, reasons, dir: reasons.length ? (bias > 0 ? 'too high' : 'too low') : null, need: gates.rate_pass_within };
}
export const gateOf = (unit) => (unit === 'U4' ? gateU4 : gateU5);
export const examTotal = (unit, gates) => (unit === 'U4' ? gates.fermi_exam_calls : gates.rate_exam_calls);
export const examSitting = (unit, cfg) => (unit === 'U4' ? cfg.problems.fermi.exam_session_size : cfg.problems.rate.exam_session_size);

// Where the player stands on a Unit 4 or 5 gate. `open` says the unit before it is passed.
export function problemGateStatus(events, cfg, unit, { open = false, practice = 0, practiceRequired = 0 } = {}) {
  const g = cfg.gates;
  const attempts = examsOf(events, cfg, unit);
  const running = attempts.find((a) => !a.result) || null;
  const passedAttempt = attempts.find((a) => a.result && a.result.pass) || null;
  const lastFailed = [...attempts].reverse().find((a) => a.result && !a.result.pass) || null;
  const needsRepair = !passedAttempt && !running && !!lastFailed && !lastFailed.repairedAt;
  let rust = null;
  if (passedAttempt) {
    const watch = new Set((g.rust_triggers && g.rust_triggers[unit]) || []);
    rust = flagsOf(events, cfg).find((c) => watch.has(c.trigger) && c.openedAt > passedAttempt.result.t && ACTIVE.has(c.state)) || null;
  }
  const eligible = open && practice >= practiceRequired && !passedAttempt && !running && !needsRepair;
  return { unit, open, attempts, running, passed: !!passedAttempt, passedAt: passedAttempt ? passedAttempt.result.t : null, lastFailed, needsRepair, rust, eligible, total: examTotal(unit, g), done: running ? running.calls.length : 0, practice, practiceRequired };
}
export const sittingSize = (status, cfg) => Math.min(examSitting(status.unit, cfg), status.total - status.done);

// The repair drill after a failed exam: more Fermi problems when the worksheet ranges were off; more base-rate problems otherwise.
export function problemRepairOf(unit, cfg) {
  return unit === 'U4' ? { kind: 'fermi', calls: cfg.gates.fermi_repair_calls } : { kind: 'rate', calls: cfg.gates.rate_repair_calls };
}

// ---- problem sessions in the record ------------------------------------------------------------------------------------------
// `psession` opens one (mode practice | drill | exam; unit U4 | U5; family fermi | rate | chain | class; size; plan: the problem ids in order;
// flag / repair / exam / n / of), `prob` is one locked answer, `psession_end` closes it. Kept apart from the gym's and the ranges' events.
export function psessionsOf(events) {
  const list = events.filter((e) => e.type === 'psession').map((s) => ({ ...s, probs: [], ended: false }));
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const e of events) {
    const s = byId.get(e.session);
    if (!s) continue;
    if (e.type === 'prob') s.probs.push(e);
    else if (e.type === 'psession_end') s.ended = true;
  }
  return list;
}
export function activePSession(events) {
  const open = psessionsOf(events).filter((s) => !s.ended);
  return open.length ? open[open.length - 1] : null;
}
// The player's own problems that the Mirror and the lessons read: practice and judged exams, never a drill. Sealed exam problems are left out by probsOf.
export const naturalProbs = (probs) => probs.filter((p) => p.mode === 'practice' || p.mode === 'exam');

// ---- drawing a session --------------------------------------------------------------------------------------------------------
// `size` problem ids from `bank`: not answered in the last reseen_days days, not disputed, no family more than about half a session
// (a quarter for Fermi, which has four), and when the pool runs short the longest-ago ones come back.
export function planProblems({ bank, events, today = localDay(), size, reseenDays, rng, exclude = new Set(), capShare = 0.25 }) {
  const all = allProbsOf(events);
  const recent = new Set(all.filter((r) => daysBetween(r.d, today) < reseenDays).map((r) => r.q));
  const disputed = new Set(events.filter((e) => e.type === 'dispute').map((e) => e.q));
  const lastUsed = new Map(all.map((r, i) => [r.q, i]));
  const open = bank.filter((q) => !exclude.has(q.id));
  const { pool } = availablePool(open, recent, disputed, size, lastUsed);
  const cap = Math.max(1, Math.ceil(size * capShare));
  const kinds = new Map();
  const picked = [];
  for (const q of shuffle(pool, rng)) {
    if (picked.length >= size) break;
    if ((kinds.get(q.kind) || 0) >= cap) continue;
    kinds.set(q.kind, (kinds.get(q.kind) || 0) + 1);
    picked.push(q.id);
  }
  for (const q of shuffle(pool, rng)) { if (picked.length >= size) break; if (!picked.includes(q.id)) picked.push(q.id); }
  return picked;
}
// A Unit 5 session: rate problems with `classEvery` of them reference-class ladders, shuffled together.
export function planMix({ rateBank, classBank, events, today, size, classCount, reseenDays, rng }) {
  const rates = planProblems({ bank: rateBank, events, today, size: size - classCount, reseenDays, rng, capShare: 0.5 });
  const classes = planProblems({ bank: classBank, events, today, size: classCount, reseenDays, rng, capShare: 1 });
  return shuffle(rates.concat(classes), rng);
}

// The sittings of an exam are drawn when it starts from the exam pool, never repeating a problem within the attempt and preferring problems
// no earlier attempt used. Returns the id lists per sitting and how many problems had to be reused.
export function planProblemExam({ bank, events, unit, size, total, rng }) {
  const all = allProbsOf(events);
  const used = new Set(all.filter((r) => r.mode === 'exam' && r.unit === unit).map((r) => r.q));
  const disputed = new Set(events.filter((e) => e.type === 'dispute').map((e) => e.q));
  const lastUsed = new Map(all.map((r, i) => [r.q, i]));
  const { pool, reused } = availablePool(bank, used, disputed, total, lastUsed);
  const order = shuffle(pool, rng);
  const sittings = [];
  const cap = Math.ceil(size / 4);
  let rest = order.slice(0, total);
  for (let s = 0; s < Math.ceil(total / size); s++) {
    const want = Math.min(size, total - sittings.reduce((n, x) => n + x.length, 0));
    const kinds = new Map();
    const mine = [];
    for (const q of rest) { if (mine.length >= want) break; if ((kinds.get(q.kind) || 0) >= cap) continue; kinds.set(q.kind, (kinds.get(q.kind) || 0) + 1); mine.push(q); }
    for (const q of rest) { if (mine.length >= want) break; if (!mine.includes(q)) mine.push(q); }
    rest = rest.filter((q) => !mine.includes(q));
    sittings.push(mine.map((q) => q.id));
  }
  return { sittings, reused: reused ? Math.max(0, total - bank.filter((q) => !used.has(q.id) && !disputed.has(q.id)).length) : 0 };
}

// ---- reading the problems: the Mirror -------------------------------------------------------------------------------------------
export function describeFermi(list, { thinBelow = 8, coverage = 0.9 } = {}) {
  const n = list.length;
  if (!n) return { n: 0, hits: 0, rate: null, medianMiss: null, partsRate: null, thin: true, points: 0 };
  const hits = list.filter((p) => p.hit).length;
  const parts = list.reduce((s, p) => s + (p.partsHit || 0), 0), partsN = list.reduce((s, p) => s + ((p.parts || []).length), 0);
  const withDirect = list.filter((p) => p.direct);
  return { n, hits, rate: hits / n, medianMiss: median(list.map((p) => p.miss)), partsRate: partsN ? parts / partsN : null, thin: n < thinBelow, points: list.reduce((s, p) => s + p.points, 0),
    directN: withDirect.length, worksheetHits: withDirect.filter((p) => p.hit).length, directHits: withDirect.filter((p) => p.direct.hit).length, coverage };
}
export function describeRates(list, { thinBelow = 10 } = {}) {
  const n = list.length;
  if (!n) return { n: 0, within: 0, rate: null, meanMiss: null, bias: null, thin: true, points: 0 };
  const within = list.filter((p) => p.hit).length;
  return { n, within, rate: within / n, meanMiss: list.reduce((s, p) => s + p.miss, 0) / n, bias: list.reduce((s, p) => s + p.signed, 0) / n, thin: n < thinBelow, points: list.reduce((s, p) => s + p.points, 0) };
}

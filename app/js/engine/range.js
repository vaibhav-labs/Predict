// Ranges (Unit 3, design/mechanics.md 4.2): give a low and a high you are 90% sure the truth sits between. Scored by the interval
// (Winkler) score: the width of your range plus 20 times how far the truth fell outside it. Narrow is rewarded and a miss is
// charged hard, so the best range is the honest one. Points are that score measured against the width of the REFERENCE interval
// (the central 90% of the other cases like this one in the record), so a player who knows the record earns about 0 and a
// better one earns more. Pure functions of the record and data/scoring.json ("interval", "gates"): no page, no storage.
import { roundHalfEven } from './scoring.js';
import { allRangesOf, daysBetween, localDay } from './record.js';
import { examsOf } from './gate.js';
import { ACTIVE, flagsOf, naturalRanges } from './lessons.js';
import { shuffle, availablePool } from './draw.js';
import { wilson } from './stats.js';

// A question's own scale: log10 for a question that spans orders of magnitude, linear otherwise.
export const scaled = (q, x) => (q.scale === 'log' ? Math.log10(x) : x);
export const refWidth = (q) => scaled(q, q.ref_high) - scaled(q, q.ref_low);

// The interval score of [low, high] against the truth, in the question's scale. Lower is better.
export function intervalScore(q, low, high, miss) {
  const lo = scaled(q, low), hi = scaled(q, high), t = scaled(q, q.truth);
  const below = Math.max(0, lo - t), above = Math.max(0, t - hi);
  return (hi - lo) + miss * (below + above);
}

// What a range pays: scale * (offset - score / reference width), whole points (halves to even, as the simulators do), never
// below the floor.
export function rangePoints(score, refW, P) {
  const raw = P.scale * (P.offset - score / Math.max(refW, 1e-12));
  return Math.max(P.floor, roundHalfEven(raw));
}

// Check what the player typed. Returns { ok, low, high } or { ok: false, error }. A log question needs both bounds above zero;
// a low above the high is refused; nothing else is, because a silly range simply scores badly.
export function checkInput(q, lowText, highText) {
  const num = (t) => (typeof t === 'number' ? t : Number(String(t).trim().replace(/,/g, '')));
  const blank = (t) => t === undefined || t === null || String(t).trim() === '';
  if (blank(lowText) || blank(highText)) return { ok: false, error: 'Fill in both ends.' };
  const low = num(lowText), high = num(highText);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { ok: false, error: 'Use numbers only, like 12.5.' };
  if (q.scale === 'log' && (low <= 0 || high <= 0)) return { ok: false, error: 'Both ends must be above zero for this one.' };
  if (low > high) return { ok: false, error: 'The low end must not be above the high end.' };
  return { ok: true, low, high };
}

// Score one range: whether it held the truth, how wide it was against the reference, the interval score and the points.
export function scoreRange(q, low, high, cfg) {
  const I = cfg.interval;
  const refW = refWidth(q);
  const width = scaled(q, high) - scaled(q, low);
  const score = intervalScore(q, low, high, I.miss_multiplier);
  return { hit: low <= q.truth && q.truth <= high, width, refW, ratio: width / refW, score, points: rangePoints(score, refW, I.points) };
}

// ---- width budget (the drill for ranges that are too wide) --------------------------------------------------------------
// The most the drill allows: budget_ratio times the reference width. For a log question that is a ratio of high to low.
export const budgetOf = (q, ratio) => ratio * refWidth(q);
export function withinBudget(q, low, high, ratio) {
  return scaled(q, high) - scaled(q, low) <= budgetOf(q, ratio) + 1e-12;
}
// The budget in words the player can use: "at most 14.2 wide", or "no more than 3.1 times as high as the low end".
export function budgetText(q, ratio) {
  const b = budgetOf(q, ratio);
  if (q.scale === 'log') return `${(10 ** b).toFixed(1)} times`;
  return b >= 100 ? String(Math.round(b)) : b >= 10 ? b.toFixed(1) : b.toFixed(Math.max(1, (q.digits || 1)));
}

// ---- the gate: 60 fresh ranges, judged once -----------------------------------------------------------------------------
// Pass when the number that held the truth is inside gates.range_pass_hits (50 to 58 of 60): too few says too narrow, too many
// says padded. A calibrated player passes about 95% of the time, a 70%-coverage player about 1% (sim/scoring_sim.py part G).
export function gateU3(ranges, gates) {
  const n = ranges.length;
  const hits = ranges.filter((r) => r.hit).length;
  const [lo, hi] = gates.range_pass_hits;
  const reasons = [];
  if (n > 0 && hits < lo) reasons.push('narrow');
  if (n > 0 && hits > hi) reasons.push('wide');
  const meanRatio = n ? ranges.reduce((s, r) => s + r.ratio, 0) / n : null;
  const points = ranges.reduce((s, r) => s + r.points, 0);
  return { n, hits, coverage: n ? hits / n : null, meanRatio, points, pass: n > 0 && reasons.length === 0, reasons, dir: reasons[0] === 'wide' ? 'too wide' : reasons[0] === 'narrow' ? 'too narrow' : null, lo, hi };
}

// Where the player stands on the Unit 3 gate. `open` says Unit 1's gate has been passed; `practiceRanges` and `practiceRequired`
// are the ranges done and the units.csv practice_calls for U3.
export function rangeGateStatus(events, cfg, { open = false, practiceRanges = 0, practiceRequired = 0 } = {}) {
  const g = cfg.gates;
  const attempts = examsOf(events, cfg, 'U3');
  const running = attempts.find((a) => !a.result) || null;
  const passedAttempt = attempts.find((a) => a.result && a.result.pass) || null;
  const lastFailed = [...attempts].reverse().find((a) => a.result && !a.result.pass) || null;
  const needsRepair = !passedAttempt && !running && !!lastFailed && !lastFailed.repairedAt;
  let rust = null;
  if (passedAttempt) {
    const watch = new Set((g.rust_triggers && g.rust_triggers.U3) || []);
    rust = flagsOf(events, cfg).find((c) => watch.has(c.trigger) && c.openedAt > passedAttempt.result.t && ACTIVE.has(c.state)) || null;
  }
  const eligible = open && practiceRanges >= practiceRequired && !passedAttempt && !running && !needsRepair;
  return { open, attempts, running, passed: !!passedAttempt, passedAt: passedAttempt ? passedAttempt.result.t : null, lastFailed, needsRepair, rust, eligible, total: g.range_exam_calls, done: running ? running.calls.length : 0 };
}
export const rangeSittingSize = (status, cfg) => Math.min(cfg.interval.exam_session_size, status.total - status.done);

// The repair drill after a failed Unit 3 exam: ranges built one bound at a time when they were too narrow, ranges under a width
// budget when they were too wide.
export function rangeRepairOf(result, cfg) {
  const calls = cfg.gates.range_repair_calls;
  const T = cfg.lessons.triggers;
  if (result && result.dir === 'too wide') return { kind: 'budget', calls, budget_ratio: T.L06.drill.budget_ratio };
  return { kind: 'stepwise', calls };
}

// ---- range sessions in the record -------------------------------------------------------------------------------------
// `rsession` opens one (fields: mode practice | drill | exam, size, plan: the question ids in order, flag / repair / exam / n / of),
// `range` is one locked range (session, q, low, high, truth, hit, ...), `rsession_end` closes it. Kept apart from the gym's
// `session` and `call` events, so nothing about the binary calls changes.
export function rsessionsOf(events) {
  const list = events.filter((e) => e.type === 'rsession').map((s) => ({ ...s, ranges: [], ended: false }));
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const e of events) {
    const s = byId.get(e.session);
    if (!s) continue;
    if (e.type === 'range') s.ranges.push(e);
    else if (e.type === 'rsession_end') s.ended = true;
  }
  return list;
}
export function activeRSession(events) {
  const open = rsessionsOf(events).filter((s) => !s.ended);
  return open.length ? open[open.length - 1] : null;
}

// The ranges the lesson triggers read (lessons.js): the player's own, in practice or in a judged exam. A drill's never count.
export { naturalRanges };

// ---- drawing a session -------------------------------------------------------------------------------------------------
// `size` question ids from `bank`: not answered in the last reseen_days days, not disputed, and no kind more than about a quarter
// of the session, so a session is never ten temperatures. When the pool is used up the longest-ago ones come back.
export function planRanges({ bank, events, today = localDay(), size, reseenDays, rng, exclude = new Set() }) {
  const all = allRangesOf(events);
  const recent = new Set(all.filter((r) => daysBetween(r.d, today) < reseenDays).map((r) => r.q));
  const disputed = new Set(events.filter((e) => e.type === 'dispute').map((e) => e.q));
  const lastUsed = new Map(all.map((r, i) => [r.q, i]));
  const open = bank.filter((q) => !exclude.has(q.id));
  const { pool } = availablePool(open, recent, disputed, size, lastUsed);
  const cap = Math.ceil(size / 4);
  const kinds = new Map();
  const picked = [];
  for (const q of shuffle(pool, rng)) {
    if (picked.length >= size) break;
    if ((kinds.get(q.kind) || 0) >= cap) continue;
    kinds.set(q.kind, (kinds.get(q.kind) || 0) + 1);
    picked.push(q.id);
  }
  // A thin pool (the cap left holes): fill from what is left, whatever the kind.
  for (const q of shuffle(pool, rng)) {
    if (picked.length >= size) break;
    if (!picked.includes(q.id)) picked.push(q.id);
  }
  return picked;
}

// The three sittings of an exam are drawn when it starts, from the exam pool, never repeating a range within the attempt and
// preferring ranges no earlier attempt used. Returns one list of ids per sitting.
export function planRangeExam({ bank, events, size, sitting, total, rng }) {
  const all = allRangesOf(events);
  const used = new Set(all.filter((r) => r.mode === 'exam').map((r) => r.q));
  const disputed = new Set(events.filter((e) => e.type === 'dispute').map((e) => e.q));
  const lastUsed = new Map(all.map((r, i) => [r.q, i]));
  const { pool, reused } = availablePool(bank, used, disputed, total, lastUsed);
  const picked = [];
  const kinds = new Map();
  const cap = Math.ceil(size / 4);
  const order = shuffle(pool, rng);
  // Within one sitting no kind is more than a quarter of it; across the exam the draw is simply shuffled.
  const sittings = [];
  let rest = order.slice();
  for (let s = 0; s < Math.ceil(total / size); s++) {
    const want = Math.min(size, total - picked.length);
    const mine = [];
    kinds.clear();
    for (const q of rest) {
      if (mine.length >= want) break;
      if ((kinds.get(q.kind) || 0) >= cap) continue;
      kinds.set(q.kind, (kinds.get(q.kind) || 0) + 1);
      mine.push(q);
    }
    for (const q of rest) { if (mine.length >= want) break; if (!mine.includes(q)) mine.push(q); }
    rest = rest.filter((q) => !mine.includes(q));
    mine.forEach((q) => picked.push(q.id));
    sittings.push(mine.map((q) => q.id));
  }
  return { sittings, sitting: sittings[sitting] || [], reused: reused ? Math.max(0, total - bank.filter((q) => !used.has(q.id) && !disputed.has(q.id)).length) : 0 };
}

// ---- reading the ranges: the Mirror -----------------------------------------------------------------------------------
// How often your 90% ranges held the truth, with an honest error bar, and how wide they were against the reference.
export function describeRanges(list, { thinBelow = 10, coverage = 0.9 } = {}) {
  const n = list.length;
  if (!n) return { n: 0, hits: 0, rate: null, ci: { lo: null, hi: null }, meanRatio: null, medianRatio: null, points: 0, avgPoints: null, thin: true, verdict: 'too few' };
  const hits = list.filter((r) => r.hit).length;
  const ci = wilson(hits, n);
  const ratios = list.map((r) => r.ratio).sort((a, b) => a - b);
  const medianRatio = n % 2 ? ratios[(n - 1) / 2] : (ratios[n / 2 - 1] + ratios[n / 2]) / 2;
  const points = list.reduce((s, r) => s + r.points, 0);
  const thin = n < thinBelow;
  const verdict = thin ? 'too few' : ci.hi < coverage ? 'too narrow' : ci.lo > coverage ? 'too wide' : 'no clear bias';
  return { n, hits, rate: hits / n, ci, meanRatio: ratios.reduce((s, x) => s + x, 0) / n, medianRatio, points, avgPoints: points / n, thin, verdict };
}
export function rangesByKind(list, opts) {
  const map = new Map();
  for (const r of list) { if (!map.has(r.kind)) map.set(r.kind, []); map.get(r.kind).push(r); }
  return [...map.entries()].map(([kind, l]) => ({ kind, ...describeRanges(l, opts) })).sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind));
}

// Unit 10, Fine grain (Block 10): the 1% dial under the sharp (log) rule, tail-heavy calls, the 400-call exam, multi-outcome questions and the round-number
// habit (L14). Pure functions of the record; the numbers come from data/scoring.json (binary.fine, gates.fine_*, problems.fine, lessons.triggers.L14).
import { callsOf, allCallsOf } from './record.js';
import { examsOf } from './gate.js';
import { flagsOf, ACTIVE } from './lessons.js';
import { roundHalfEven } from './scoring.js';

const EPS = 1e-9;
const round2 = (x) => Math.round(x * 100) / 100;

// The dial's confidences for a fine call: 50, 51 ... 99 (as fractions, so 0.63 is exactly what the player picked).
export function fineSteps(cfg) {
  const f = cfg.binary.fine;
  const n = Math.round((f.max - f.min) / f.step);
  return Array.from({ length: n + 1 }, (_, i) => round2(f.min + i * f.step));
}

// A call made on the 1% dial in a Unit 10 session. Its `points` are the sharp score; `core` is what the same call scores under the core rule (so the ledger
// is read in one currency: `ledgerPoints`).
export const isFine = (e) => e.type === 'call' && e.fine === true;
export const fineCalls = (events) => callsOf(events).filter(isFine);
export const ledgerPoints = (e) => (typeof e.core === 'number' ? e.core : e.points);

// Points under the sharp rule for a call stated at c that turned out right (hit) or wrong, and the same for the best an honest base-rate answer could have said.
export const sharp = (S, c, hit) => S.score(c, hit, S.sharpRule);
export const cap = (c, cfg) => Math.min(Math.max(c, cfg.binary.fine.min), cfg.binary.fine.max);
// What a player who said the base rate (the likelier side at its base) would have scored on this item.
export function baseAnswer(q, S, cfg) {
  const yes = q.base >= 0.5;
  const c = cap(round2(yes ? q.base : 1 - q.base), cfg);
  const hit = yes === q.answer;
  return { side: yes ? 'yes' : 'no', c, hit, points: sharp(S, c, hit) };
}

// A multi-outcome question: probabilities (whole percents, at least 1 each, adding up to 100) over k outcomes. The outcome that happened scored p: 100 * log2(k * p) / log2(k),
// so a flat answer scores 0, certainty +100, and with two outcomes it is the sharp rule. A forecast that gives the real outcome 1% costs about 186 to 232 points.
export const multiPoints = (k, p) => roundHalfEven((100 * Math.log2(k * p)) / Math.log2(k));
export function checkMulti(values, k, min = 1) {
  if (values.length !== k) return { ok: false, error: `Give a chance for each of the ${k} outcomes.` };
  if (values.some((v) => !Number.isInteger(v))) return { ok: false, error: 'Whole percents only.' };
  if (values.some((v) => v < min)) return { ok: false, error: `Every outcome gets at least ${min}%.` };
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum !== 100) return { ok: false, error: `The chances add up to ${sum}%. They need to add up to 100%.` };
  return { ok: true };
}

// ---- the Unit 10 exam: 400 fresh calls, the average confidence within `fine_index_tolerance` of the hit rate -----------------------------
export function gateFine(calls, gates) {
  const n = calls.length;
  const meanConf = n ? calls.reduce((s, c) => s + c.c, 0) / n : null;
  const hitRate = n ? calls.filter((c) => c.hit).length / n : null;
  const index = n ? meanConf - hitRate : null;
  const points = calls.reduce((s, c) => s + c.points, 0);
  const reasons = n && Math.abs(index) > gates.fine_index_tolerance + 1e-12 ? ['index'] : [];
  return { n, pass: n > 0 && reasons.length === 0, index, meanConf, hitRate, hits: calls.filter((c) => c.hit).length, points, reasons, dir: index === null ? null : index > 0 ? 'too sure' : 'too shy' };
}

export function fineGateStatus(events, cfg, { open = false, practice = 0, practiceRequired = 0 } = {}) {
  const g = cfg.gates;
  const attempts = examsOf(events, cfg, 'U10');
  const running = attempts.find((a) => !a.result) || null;
  const passedAttempt = attempts.find((a) => a.result && a.result.pass) || null;
  const lastFailed = [...attempts].reverse().find((a) => a.result && !a.result.pass) || null;
  const needsRepair = !passedAttempt && !running && !!lastFailed && !lastFailed.repairedAt;
  let rust = null;
  if (passedAttempt) {
    const watch = new Set((g.rust_triggers && g.rust_triggers.U10) || []);
    rust = flagsOf(events, cfg).find((c) => watch.has(c.trigger) && c.openedAt > passedAttempt.result.t && ACTIVE.has(c.state)) || null;
  }
  const eligible = open && practice >= practiceRequired && !passedAttempt && !running && !needsRepair;
  return { unit: 'U10', open, attempts, running, passed: !!passedAttempt, passedAt: passedAttempt ? passedAttempt.result.t : null, lastFailed, needsRepair, rust, eligible, total: g.fine_exam_calls,
    done: running ? running.calls.length : 0, practice, practiceRequired };
}
export const fineSittingSize = (status, cfg) => Math.min(cfg.gates.fine_sitting, status.total - status.done);

// The repair drill after a failed Unit 10 exam: fine calls aimed at the direction the exam missed.
export const fineRepairOf = (verdict, cfg) => ({ kind: 'fine', calls: cfg.gates.fine_repair_calls, dir: verdict && verdict.dir });

// ---- L14: the round-number habit ------------------------------------------------------------------------------------------------------
export const isRound = (c, to = 10) => Math.round(c * 100) % to === 0;
export const roundShare = (list, to = 10) => (list.length ? list.filter((x) => isRound(x.c, to)).length / list.length : null);
export const describeFine = (events, cfg) => {
  const list = fineCalls(events).filter((c) => c.mode === 'practice' || c.mode === 'exam');
  const n = list.length;
  const last = list.slice(-cfg.lessons.triggers.L14.window);
  const hits = list.filter((c) => c.hit).length;
  const lowTail = list.filter((c) => c.c >= 0.95);
  return { n, hits, hitRate: n ? hits / n : null, meanConf: n ? list.reduce((s, c) => s + c.c, 0) / n : null, roundShare: roundShare(last, cfg.lessons.triggers.L14.round_to), lastN: last.length,
    sharpPoints: list.reduce((s, c) => s + c.points, 0), tailN: lowTail.length, tailHit: lowTail.length ? lowTail.filter((c) => c.hit).length / lowTail.length : null };
};
export { allCallsOf };

// The lesson engine as the app runs it: look at the record, write what the engine says, and tell the screens where each flag
// stands. The rules themselves are in engine/lessons.js and engine/gate.js; this file only reads the store and writes events.
import * as R from './engine/record.js';
import * as LE from './engine/lessons.js';
import * as G from './engine/gate.js';
import * as RG from './engine/range.js';
import * as PB from './engine/problem.js';
import * as KN from './engine/know.js';
import * as FN from './engine/fine.js';
import { unitRow } from './ui/common.js';

// From the day Unit 8 opens (the time Unit 7 was passed) every case that resolves gets an autopsy. Before that, only the cases the first rule picks.
export const autopsyFrom = (ctx) => { const st = problemGateState(ctx, 'U7'); return st.passed ? st.passedAt : null; };
export const autopsyDueOf = (ctx, predictions, events = ctx.store.events) => LE.autopsyDue(predictions, events, ctx.cfg, autopsyFrom(ctx));

// Called when a screen that shows lessons opens, and when a session ends. Asking twice in a row writes nothing the second time.
export async function runLessonEngine(ctx) {
  const today = R.localDay();
  const events = ctx.store.events;
  const { append } = LE.evaluate(events, { today, cfg: ctx.cfg, predictions: R.predictionsOf(events, today), news: (ctx.coach && ctx.coach.news) || {} });
  for (const f of append) {
    const { type, ...fields } = f;
    await ctx.store.append(R.makeEvent('flag', fields));
  }
  return append.length;
}

// Everything a screen needs to know about lessons right now.
export function lessonState(ctx) {
  const events = ctx.store.events, today = R.localDay(), cfg = ctx.cfg;
  const predictions = R.predictionsOf(events, today);
  const chains = LE.flagsOf(events, cfg);
  const habit = chains.find((c) => c.trigger === 'L15' && c.state === 'open') || null;
  const patterns = chains.filter((c) => c.trigger !== 'L15' && LE.ACTIVE.has(c.state));
  const progress = (c) => LE.retestProgress(c, events, { cfg, predictions, today, news: (ctx.coach && ctx.coach.news) || {} });
  return {
    today, predictions, chains, habit, patterns, progress,
    escalated: chains.filter((c) => c.trigger !== 'L15' && c.state === 'escalated'),
    due: LE.autopsyDue(predictions, events, cfg, autopsyFrom(ctx)),
    rechecks: LE.rechecksDue(events, today, cfg),
    rules: LE.ruleCards(events, cfg),
  };
}

// Where the player stands on the Unit 1 gate.
export function gateState(ctx) {
  const events = ctx.store.events;
  const practiceCalls = R.callsOf(events).filter((c) => c.mode === 'practice').length;
  const base = R.baselineProgress(events, Number(unitRow(ctx, 'U0').practice_calls));
  return G.gateStatus(events, ctx.cfg, { practiceCalls, practiceRequired: Number(unitRow(ctx, 'U1').practice_calls), baselineDone: base.complete });
}

// The exam is judged once, when its last call is in: the verdict is written to the record and the sealed calls join it.
// Safe to call again: an exam that has its verdict is left alone.
export async function judgeExam(ctx, attemptId) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === attemptId);
  if (!attempt || attempt.result || attempt.calls.length < attempt.total) return false;
  const v = G.gateU1(attempt.calls, ctx.cfg.gates, ctx.cfg.mirror.band_edges);
  await ctx.store.append(R.makeEvent('exam', {
    state: 'result', exam: attempt.id, pass: v.pass, n: v.n, index: v.index, meanConf: v.meanConf, hitRate: v.hitRate, reasons: v.reasons, worst: v.worst,
    bands: v.bands.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanConf: b.meanConf, hitRate: b.hitRate, z: b.z, checked: b.checked, off: b.off })),
  }));
  return true;
}

// Where the player stands on the Unit 3 gate (60 fresh ranges). It opens when Unit 1's gate is passed and the practice ranges are done.
export function rangeGateState(ctx) {
  const events = ctx.store.events;
  const practice = R.rangesOf(events).filter((r) => r.mode === 'practice').length;
  return RG.rangeGateStatus(events, ctx.cfg, { open: gateState(ctx).passed, practiceRanges: practice, practiceRequired: Number(unitRow(ctx, 'U3').practice_calls) });
}

// The Unit 3 exam is judged once, when its last range is in. Safe to call again: an exam that has its verdict is left alone.
export async function judgeRangeExam(ctx, attemptId) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg, 'U3').find((a) => a.id === attemptId);
  if (!attempt || attempt.result || attempt.calls.length < attempt.total) return false;
  const v = RG.gateU3(attempt.calls, ctx.cfg.gates);
  await ctx.store.append(R.makeEvent('exam', {
    state: 'result', exam: attempt.id, unit: 'U3', pass: v.pass, n: v.n, hits: v.hits, coverage: v.coverage, meanRatio: v.meanRatio, points: v.points, reasons: v.reasons, dir: v.dir,
  }));
  return true;
}

const PROBLEM_UNITS = new Set(['U4', 'U5', 'U6', 'U7', 'U8', 'U9']);

// Where the player stands on the Unit 4 or Unit 5 gate. Unit 4 opens when Unit 3's gate is passed, Unit 5 when Unit 4's is. The practice that counts
// is the unit's own: Fermi problems for Unit 4, base-rate and reference-class problems for Unit 5 (chain problems are lesson-slot practice).
export function problemGateState(ctx, unit) {
  const events = ctx.store.events;
  const open = unit === 'U4' ? rangeGateState(ctx).passed : problemGateState(ctx, ctx.cfg.gates.opens_after[unit]).passed;
  const families = KN.isChoiceUnit(unit) ? ctx.cfg.problems.choice[unit].families : unit === 'U4' ? ['fermi'] : unit === 'U5' ? ['rate', 'class'] : ['update'];
  const practice = R.probsOf(events).filter((p) => p.mode === 'practice' && p.unit === unit && families.includes(p.family)).length;
  // Unit 8's exam also reads the memory checks: it opens once memory_min_checks checks (whose outcome is known) are in.
  const extraReady = unit !== 'U8' || memoryChecks(ctx).length >= ctx.cfg.gates.memory_min_checks;
  return PB.problemGateStatus(events, ctx.cfg, unit, { open, practice, practiceRequired: Number(unitRow(ctx, unit).practice_calls), extraReady });
}
// Every memory check with a known outcome: the card ones at their reveal, the practice and drill ones on old gym calls.
export const memoryChecks = (ctx) => KN.memoryObs(ctx.store.events, R.predictionsOf(ctx.store.events, R.localDay()));

// A Unit 4 or Unit 5 exam is judged once, when its last problem is in. Safe to call again: an exam that has its verdict is left alone.
export async function judgeProblemExam(ctx, attemptId) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === attemptId && PROBLEM_UNITS.has(a.unit));
  if (!attempt || attempt.result || attempt.calls.length < attempt.total) return false;
  const memory = attempt.unit === 'U8' ? KN.memoryStats(memoryChecks(ctx), ctx.cfg.gates.memory_window) : null;
  const v = PB.gateOf(attempt.unit)(attempt.calls, ctx.cfg.gates, { memory });
  const extra = KN.isChoiceUnit(attempt.unit) ? { right: v.hits, ...(attempt.unit === 'U8' ? { memoryDrift: v.memoryDrift, memoryN: v.memoryN } : {}) } : attempt.unit === 'U4' ? { medianMiss: v.medianMiss, meanRatio: v.meanRatio } : attempt.unit === 'U6' ? { meanMiss: v.meanMiss, bias: v.bias, within: v.within, meanGain: v.meanGain } : { meanMiss: v.meanMiss, bias: v.bias, within: v.within };
  await ctx.store.append(R.makeEvent('exam', { state: 'result', exam: attempt.id, unit: attempt.unit, pass: v.pass, n: v.n, hits: v.hits, coverage: attempt.unit === 'U4' ? v.coverage : v.hits / v.n, points: v.points, reasons: v.reasons, dir: v.dir, ...extra }));
  return true;
}

// Unit 10 (Fine grain): opens when Unit 9 is passed. The practice that counts toward its exam is the fine calls of practice sessions; the exam is judged once,
// when its last call is in (400 calls, the average confidence within 3 points of the hit rate).
export function fineGateState(ctx) {
  const events = ctx.store.events;
  const open = problemGateState(ctx, ctx.cfg.gates.opens_after.U10).passed;
  const practice = FN.fineCalls(events).filter((c) => c.mode === 'practice').length;
  return FN.fineGateStatus(events, ctx.cfg, { open, practice, practiceRequired: Number(unitRow(ctx, 'U10').practice_calls) });
}
export async function judgeFineExam(ctx, attemptId) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === attemptId && a.unit === 'U10');
  if (!attempt || attempt.result || attempt.calls.length < attempt.total) return false;
  const v = FN.gateFine(attempt.calls.filter((c) => c.type === 'call'), ctx.cfg.gates);
  await ctx.store.append(R.makeEvent('exam', { state: 'result', exam: attempt.id, unit: 'U10', pass: v.pass, n: v.n, hits: v.hits, meanConf: v.meanConf, hitRate: v.hitRate, index: v.index, points: v.points, reasons: v.reasons, dir: v.dir }));
  return true;
}

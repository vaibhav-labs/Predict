// The lesson engine as the app runs it: look at the record, write what the engine says, and tell the screens where each flag
// stands. The rules themselves are in engine/lessons.js and engine/gate.js; this file only reads the store and writes events.
import * as R from './engine/record.js';
import * as LE from './engine/lessons.js';
import * as G from './engine/gate.js';
import { unitRow } from './ui/common.js';

// Called when a screen that shows lessons opens, and when a session ends. Asking twice in a row writes nothing the second time.
export async function runLessonEngine(ctx) {
  const today = R.localDay();
  const events = ctx.store.events;
  const { append } = LE.evaluate(events, { today, cfg: ctx.cfg, predictions: R.predictionsOf(events, today) });
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
  const progress = (c) => LE.retestProgress(c, events, { cfg, predictions, today });
  return {
    today, predictions, chains, habit, patterns, progress,
    escalated: chains.filter((c) => c.trigger !== 'L15' && c.state === 'escalated'),
    due: LE.autopsyDue(predictions, events, cfg),
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

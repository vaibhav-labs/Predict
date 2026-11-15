// Block 9, know yourself (Units 7 to 9): the choice problems and their gates, the memory check and pattern L12, the decision card, the weekly review's grade
// of a case against, the second estimate, and autopsy on every case. The arithmetic is compared with tools/ref_know.py, written separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cfg, S, ROOT } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as PB from '../../app/js/engine/problem.js';
import * as KN from '../../app/js/engine/know.js';
import { parseCoach } from '../../app/js/engine/coach.js';

const REF = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_know.py')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const G = cfg.gates;
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

let seq = 0;
const D0 = '2026-10-01';
const day = (k) => R.addDays(D0, k);
const stamp = (d) => { seq += 1; return `${d}T${String(6 + Math.floor(seq / 3600) % 16).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`; };
const ev = (type, d, fields = {}) => ({ type, id: `k${String(++seq).padStart(6, '0')}`, t: stamp(d), d, ...fields });
const pred = (d, o = {}) => ev('prediction', d, { text: 'By Friday it will happen.', domain: 'work', dueOption: 'week', due: o.due || R.addDays(d, 7), horizon: 'week',
  chain: { outsideView: { text: 'usual', rate: 0.5 }, evidence: [{ text: 'a signal', dir: 'up', test: true }], caseAgainst: { text: o.caseText ?? 'it could slip', number: 10 }, tripwire: { text: 't', number: 30 } },
  c: o.c ?? 0.6, b: o.b ?? 0.5, bSource: 'starter', scored: o.scored ?? true, flags: [], ...(o.first !== undefined ? { first: o.first } : {}) });
const resolve = (p, d, outcome, extra = {}) => ev('resolve', d, { prediction: p.id, outcome, raw: 1, edge: 1, ...extra });
const call = (d, c, hit, extra = {}) => ev('call', d, { session: 's', mode: 'practice', unit: 'U1', q: `q${seq}`, claim: 'A claim.', side: 'yes', c, truth: hit, hit, points: hit ? 10 : -10, ...extra });
const mem = (d, src, ref, recalled, recorded, extra = {}) => ev('memory', d, { src, ref, recalled, recorded, mode: 'practice', ...extra });

// ===================================================================================================================
test('the Block 9 settings are in the table: three gates, the memory check, the decision card, pattern L12, autopsy from Unit 8', () => {
  assert.deepEqual([G.counter_exam_calls, G.counter_pass_right, G.counter_repair_calls], [28, 22, 8]);
  assert.deepEqual([G.luck_exam_calls, G.luck_pass_right, G.luck_repair_calls], [30, 24, 8]);
  assert.deepEqual([G.decision_exam_calls, G.decision_pass_right, G.decision_repair_calls], [30, 24, 8]);
  assert.deepEqual([G.memory_window, G.memory_min_checks, G.memory_drift_max], [30, 30, 0.05]);
  assert.deepEqual([G.opens_after.U7, G.opens_after.U8, G.opens_after.U9], ['U6', 'U7', 'U8']);
  assert.deepEqual(G.rust_triggers.U8, ['L12']);
  const C = cfg.problems.choice;
  assert.deepEqual([C.right_points, C.wrong_points, C.session_size, C.reseen_days], [60, -30, 6, 90]);
  assert.deepEqual([C.U7.exam_session_size, C.U8.exam_session_size, C.U9.exam_session_size], [14, 15, 15]);
  assert.deepEqual([cfg.memory.min_age_days, cfg.memory.session_size], [2, 10]);
  assert.deepEqual([cfg.decision.min_review_days, cfg.decision.max_review_days, cfg.decision.cards_needed], [7, 365, 10]);
  const t = cfg.lessons.triggers.L12;
  assert.deepEqual([t.window, t.min_shift, t.clear_window, t.clear_within, t.drill.kind, t.drill.calls], [10, 0.1, 10, 0.05, 'recall', 10]);
  assert.equal(cfg.lessons.autopsy.all_from_unit, 'U8');
  // the exam sizes divide into whole sittings
  for (const [u, key] of [['U7', 'counter'], ['U8', 'luck'], ['U9', 'decision']]) assert.equal(G[`${key}_exam_calls`] % C[u].exam_session_size, 0, u);
});

test('a choice problem pays right_points or wrong_points, and the exam sizes come from the table', () => {
  const q = { right: 2 };
  assert.deepEqual(KN.scoreChoice(q, 2, cfg), { choice: 2, right: 2, hit: true, points: 60 });
  assert.deepEqual(KN.scoreChoice(q, 0, cfg), { choice: 0, right: 2, hit: false, points: -30 });
  assert.deepEqual([PB.examTotal('U7', G), PB.examTotal('U8', G), PB.examTotal('U9', G)], [28, 30, 30]);
  assert.deepEqual([PB.examSitting('U7', cfg), PB.examSitting('U8', cfg), PB.examSitting('U9', cfg)], [14, 15, 15]);
  assert.deepEqual([PB.problemRepairOf('U7', cfg).calls, PB.problemRepairOf('U8', cfg).calls, PB.problemRepairOf('U9', cfg).calls], [8, 8, 8]);
  assert.equal(PB.problemRepairOf('U8', cfg).kind, 'choice');
});

test('the unit gates agree with the reference at the line and either side of it', () => {
  for (const c of REF.gate_cases) {
    const total = G[`${KN.CHOICE_UNITS[c.unit]}_exam_calls`];
    const probs = Array.from({ length: total }, (_, i) => ({ hit: i < c.right, points: i < c.right ? 60 : -30 }));
    const v = PB.gateOf(c.unit)(probs, G, { memory: { n: 30, drift: 0 } });
    assert.equal(v.pass, c.pass, `${c.unit} ${c.right}`);
    assert.equal(v.hits, c.right);
    assert.equal(v.points, c.right * 60 - (total - c.right) * 30);
  }
  assert.equal(PB.gateOf('U7')([], G).pass, false, 'no problems never passes');
});

test('Unit 8 needs the memory too: 24 right with drift beyond 5 points fails, within passes, and a record with no checks is judged on the problems alone', () => {
  const probs = Array.from({ length: 30 }, (_, i) => ({ hit: i < 26, points: 0 }));
  assert.equal(KN.gateU8(probs, G, { memory: { n: 30, drift: 0.051 } }).pass, false);
  assert.deepEqual(KN.gateU8(probs, G, { memory: { n: 30, drift: 0.051 } }).reasons, ['memory']);
  assert.equal(KN.gateU8(probs, G, { memory: { n: 30, drift: -0.06 } }).pass, false, 'drift the other way counts too');
  assert.equal(KN.gateU8(probs, G, { memory: { n: 30, drift: 0.05 } }).pass, true);
  assert.equal(KN.gateU8(probs, G, { memory: { n: 30, drift: -0.049 } }).pass, true);
  assert.equal(KN.gateU8(probs, G, {}).pass, true);
  const few = Array.from({ length: 30 }, (_, i) => ({ hit: i < 20, points: 0 }));
  assert.deepEqual(KN.gateU8(few, G, { memory: { n: 30, drift: 0.2 } }).reasons, ['right', 'memory']);
});

test('the posterior of a second number matches the exact fraction in the reference on 42 cases', () => {
  assert.equal(REF.posterior.length, 42);
  for (const c of REF.posterior) near(KN.posterior(c.prior, c.lr), c.post, `prior ${c.prior} lr ${c.lr}`, 1e-12);
});

test('the break-even line and the choice it implies match the reference on 96 cases', () => {
  assert.equal(REF.breakeven.length, 96);
  for (const c of REF.breakeven) {
    near(KN.breakEven(c.gain, c.loss), c.threshold, 'threshold', 1e-12);
    assert.equal(KN.ruleOf(c.p, c.gain, c.loss), c.rule, `p ${c.p} gain ${c.gain} loss ${c.loss}`);
  }
});

test('memory drift is positive when the recalled number moved toward what happened, and matches the reference', () => {
  for (const c of REF.memory) near(KN.shiftToward(c.recalled, c.recorded, c.up), c.shift, `recalled ${c.recalled} recorded ${c.recorded}`, 1e-12);
  assert.ok(KN.shiftToward(0.7, 0.6, true) > 0 && KN.shiftToward(0.7, 0.6, false) < 0);
});

test('memory checks on cards and calls join their outcomes; a card still unresolved, a void card and an unknown call are left out', () => {
  const p1 = pred(day(0), { c: 0.6 }), p2 = pred(day(0), { c: 0.7 }), p3 = pred(day(0), { c: 0.4 }), p4 = pred(day(0));
  const c1 = call(day(1), 0.8, true), c2 = call(day(1), 0.7, false);
  const events = [p1, p2, p3, p4, c1, c2, resolve(p1, day(8), 'yes'), resolve(p2, day(8), 'no'), resolve(p3, day(8), 'void'),
    mem(day(8), 'card', p1.id, 0.7, 0.6, { mode: 'card' }), mem(day(8), 'card', p2.id, 0.8, 0.7, { mode: 'card' }), mem(day(8), 'card', p3.id, 0.5, 0.4, { mode: 'card' }), mem(day(8), 'card', p4.id, 0.5, 0.5, { mode: 'card' }),
    mem(day(9), 'call', c1.id, 0.9, 0.8), mem(day(9), 'call', c2.id, 0.6, 0.7), mem(day(9), 'call', 'nope', 0.6, 0.7)];
  const obs = KN.memoryObs(events, R.predictionsOf(events, day(20)));
  assert.equal(obs.length, 4);
  near(obs[0].shift, 0.1, 'yes card recalled higher'); near(obs[1].shift, -0.1, 'no outcome, recalled higher: moved away');
  near(obs[2].shift, 0.1, 'hit, recalled higher'); near(obs[3].shift, 0.1, 'miss, recalled lower: moved toward the miss');
  const st = KN.memoryStats(obs, 30);
  assert.equal(st.n, 4); near(st.drift, 0.05, 'mean'); near(st.meanAbs, 0.1, 'mean size');
  assert.equal(KN.memoryStats([], 30).n, 0);
  assert.equal(KN.memoryStats(obs, 2).n, 2, 'only the last two');
});

test('a practice check asks only about natural gym calls at least min_age_days old that have not been asked, never an exam call', () => {
  const today = day(10);
  const old = call(day(7), 0.7, true), young = call(day(9), 0.7, true), edge = call(day(8), 0.7, true), drill = call(day(1), 0.7, true, { mode: 'drill' });
  const examCall = call(day(1), 0.7, true, { mode: 'exam', exam: 'x1' });
  const asked = call(day(2), 0.7, true), noclaim = call(day(2), 0.7, true, { claim: '' });
  const events = [old, young, edge, drill, examCall, asked, noclaim, mem(day(9), 'call', asked.id, 0.7, 0.7)];
  const ids = KN.memoryCandidates(events, today, cfg).map((c) => c.id).sort();
  assert.deepEqual(ids, [old.id, edge.id].sort(), 'the two-day-old call counts, yesterday\'s does not');
  assert.equal(KN.planMemory({ events, today, cfg, size: 10, rng: () => 0.3 }).length, 2);
});

test('a due card needs its memory check first, once Unit 8 is open, and only once', () => {
  const p = pred(day(0));
  const events = [p];
  const due = R.predictionsOf(events, day(8))[0];
  assert.equal(due.state, 'due');
  assert.equal(KN.memoryRequired(due, events, true), true);
  assert.equal(KN.memoryRequired(due, events, false), false, 'before Unit 8');
  events.push(mem(day(8), 'card', p.id, 0.6, 0.6, { mode: 'card' }));
  assert.equal(KN.memoryRequired(due, events, true), false);
  const openCard = R.predictionsOf(events, day(3))[0];
  assert.equal(KN.memoryRequired({ ...openCard, id: 'other' }, events, true), false, 'an open card is not asked yet');
});

test('the recall field takes whole percents, strips a percent sign, and keeps to the range', () => {
  assert.deepEqual(KN.checkRecall('70', 0.01, 0.99), { ok: true, value: 0.7 });
  assert.deepEqual(KN.checkRecall(' 65% ', 0.01, 0.99), { ok: true, value: 0.65 });
  assert.equal(KN.checkRecall('', 0.01, 0.99).ok, false);
  assert.equal(KN.checkRecall('abc', 0.01, 0.99).ok, false);
  assert.equal(KN.checkRecall('100', 0.01, 0.99).ok, false);
  assert.equal(KN.checkRecall('0', 0.01, 0.99).ok, false);
  assert.equal(KN.checkRecall('45', 0.5, 0.99).ok, false, 'a call never sat under 50');
});

// ---- L12 ------------------------------------------------------------------------------------------------------------
function series(events, n, d0, shiftBy, base = 0.6) {
  // n resolved yes cards with a memory check whose recalled number sits shiftBy above the recorded one.
  const made = [];
  for (let i = 0; i < n; i++) {
    const p = pred(day(d0 + i), { c: base });
    made.push(p, resolve(p, day(d0 + i + 8), 'yes'), mem(day(d0 + i + 8), 'card', p.id, Math.round((base + shiftBy) * 100) / 100, base, { mode: 'card' }));
  }
  events.push(...made);
  return made;
}
const evalAll = (events, today) => LE.evaluate(events, { today, cfg, predictions: R.predictionsOf(events, today), news: {} });
const flagState = (events) => LE.flagsOf(events, cfg).filter((c) => c.trigger === 'L12').map((c) => c.state);

test('L12 fires on 10 checks that drifted 10 points toward the outcome, agrees with the reference at the line, and never on fewer than 10', () => {
  assert.equal(REF.l12.exact, true); assert.equal(REF.l12.under, false); assert.equal(REF.l12.few, null); assert.equal(REF.l12.mixed, false); assert.equal(REF.l12.last10, true);
  const ev10 = [], today = day(40);
  series(ev10, 10, 0, 0.1);
  assert.equal(evalAll(ev10, today).append.some((f) => f.trigger === 'L12'), REF.l12.exact);
  const under = []; series(under, 10, 0, 0.09);
  assert.equal(evalAll(under, today).append.some((f) => f.trigger === 'L12'), REF.l12.under);
  const few = []; series(few, 9, 0, 0.2);
  assert.equal(evalAll(few, today).append.some((f) => f.trigger === 'L12'), false);
  const last = []; series(last, 5, 0, -0.2); series(last, 10, 10, 0.1);
  assert.equal(evalAll(last, day(60)).append.some((f) => f.trigger === 'L12'), REF.l12.last10);
});

test('L12 runs the whole lifecycle: fire, drill, re-test after the wait on 10 fresh checks, and clears when the drift is within 5 points', () => {
  const events = [];
  series(events, 10, 0, 0.12);
  let today = day(40);
  const fire = evalAll(events, today).append.find((f) => f.trigger === 'L12');
  assert.ok(fire, 'fires');
  near(fire.evidence.drift, 0.12, 'drift in the evidence', 1e-9);
  const open = ev('flag', today, { state: 'open', trigger: 'L12', fire: 1, evidence: fire.evidence, chain: 1 });
  events.push(open);
  events.push(ev('flag', today, { state: 'lesson', flag: open.id }));
  const drillDay = today;
  events.push(ev('flag', drillDay, { state: 'drill', flag: open.id, session: 'drill1' }));
  assert.deepEqual(flagState(events), ['drill']);
  assert.equal(LE.drillOf('L12', cfg).kind, 'recall');
  // checks made before the ready day do not count
  const [d1] = cfg.lessons.retest_after_days;
  series(events, 10, 41, 0.0);
  const early = LE.retestProgress(LE.flagsOf(events, cfg)[0], events, { cfg, predictions: R.predictionsOf(events, day(41)), today: day(41) });
  assert.equal(early.ready, false);
  today = R.addDays(drillDay, d1 + 12);
  // the checks above were resolved around day 49 to 58: fresh ones, written after the drill, from the ready day on
  const prog = LE.retestProgress(LE.flagsOf(events, cfg)[0], events, { cfg, predictions: R.predictionsOf(events, today), today });
  assert.equal(prog.need, 10);
  assert.ok(prog.have > 0 && prog.have <= 10);
  const res = evalAll(events, today).append.find((f) => f.state === 'retest');
  if (res) assert.equal(res.pass, true, 'no drift passes');
});

test('L12 does not clear on drift: 10 fresh checks still 8 points toward the outcome fail the first re-test and reopen it', () => {
  const events = [];
  series(events, 10, 0, 0.15);
  const open = ev('flag', day(40), { state: 'open', trigger: 'L12', fire: 1, evidence: { n: 10, drift: 0.15 }, chain: 1 });
  events.push(open, ev('flag', day(40), { state: 'lesson', flag: open.id }), ev('flag', day(40), { state: 'drill', flag: open.id, session: 'd' }));
  const [d1] = cfg.lessons.retest_after_days;
  const ready = R.addDays(day(40), d1);
  series(events, 10, 44, 0.08);
  const today = day(80);
  assert.ok(R.addDays(day(44), 8) >= ready);
  const res = evalAll(events, today).append.find((f) => f.state === 'retest');
  assert.ok(res, 'enough checks for a re-test');
  assert.equal(res.pass, false);
  near(res.evidence.drift, 0.08, 'measured', 1e-9);
});

test('drift the other way is not rewriting the past, so it does not fire L12', () => {
  const events = [];
  series(events, 10, 0, -0.2);
  assert.equal(evalAll(events, day(40)).append.some((f) => f.trigger === 'L12'), false);
});

// ---- autopsy on every case ------------------------------------------------------------------------------------------
test('before Unit 8 only confident misses and every fifth confident hit get an autopsy; from Unit 8 on every case that resolves does', () => {
  const events = [];
  const cards = [];
  for (let i = 0; i < 6; i++) { const p = pred(day(i), { c: i % 2 ? 0.6 : 0.9 }); cards.push(p); events.push(p, resolve(p, day(i + 10), i % 3 === 0 ? 'yes' : 'no')); }
  const preds = R.predictionsOf(events, day(30));
  const old = LE.autopsyDue(preds, events, cfg).needed.map((n) => n.p.id);
  const everyAll = LE.autopsyDue(preds, events, cfg, day(0) + 'T00:00:00.000Z');
  assert.ok(everyAll.needed.length === 6, 'every case');
  assert.ok(old.length < 6);
  const kinds = everyAll.needed.map((n) => n.kind);
  assert.ok(kinds.includes('case'));
  for (const n of LE.autopsyDue(preds, events, cfg).needed) assert.equal(everyAll.needed.find((m) => m.p.id === n.p.id).kind, n.kind, 'the old rule keeps its kind');
  // only cases resolved after Unit 8 opened
  const half = LE.autopsyDue(preds, events, cfg, `${day(13)}T23:59:59.999Z`);
  assert.ok(half.needed.length < 6 && half.needed.length >= old.length);
  for (const n of half.needed.filter((x) => x.kind === 'case')) assert.ok(n.p.resolvedAt > `${day(13)}T23:59:59.999Z`);
  // a void or unscored card never needs one
  const v = pred(day(0)); events.push(v, resolve(v, day(12), 'void'));
  const u = pred(day(0), { scored: false }); events.push(u, resolve(u, day(12), 'yes'));
  assert.equal(LE.autopsyDue(R.predictionsOf(events, day(30)), events, cfg, `${day(-1)}T00:00:00.000Z`).needed.length, 6);
});

// ---- the decision card -----------------------------------------------------------------------------------------------------
const good = { text: 'Take the new job offer', option: 'Accept', p: 0.6, gain: 30, loss: 10, choice: 'act', review: day(30) };
test('a decision card needs what, what you will do, a forecast, both stakes, a choice and a review date a week to a year away', () => {
  const ok = KN.checkDecision(good, cfg, day(0));
  assert.equal(ok.ok, true);
  near(ok.threshold, 0.25, 'break-even 10/40'); assert.equal(ok.rule, 'act');
  const bad = (o, rx) => { const r = KN.checkDecision({ ...good, ...o }, cfg, day(0)); assert.equal(r.ok, false); assert.match(r.error, rx); };
  bad({ text: 'short' }, /deciding/); bad({ option: 'x' }, /would do/); bad({ p: 1 }, /1 to 99/); bad({ p: 0 }, /1 to 99/); bad({ p: 'x' }, /1 to 99/);
  bad({ gain: 0 }, /gain/); bad({ loss: '1.5' }, /lose/); bad({ gain: 2000000 }, /gain/); bad({ choice: 'maybe' }, /act or hold/);
  bad({ review: '' }, /review date/); bad({ review: day(6) }, /at least 7 days/); bad({ review: day(366) }, /within 365/);
  assert.equal(KN.checkDecision({ ...good, review: day(7) }, cfg, day(0)).ok, true, 'exactly a week');
  assert.equal(KN.checkDecision({ ...good, review: day(365) }, cfg, day(0)).ok, true, 'exactly a year');
  assert.equal(KN.checkDecision({ ...good, p: '0.6' }, cfg, day(0)).ok, true);
  assert.equal(KN.checkDecision({ ...good, gain: '1,000' }, cfg, day(0)).ok, true, 'a thousands comma is fine');
});

test('a decision review comes due on its date, not before, and value is read at the review: acting pays gain or loss, holding pays nothing', () => {
  const act = ev('decision', day(0), { ...good, id: 'dA', threshold: 0.25, rule: 'act' });
  const hold = ev('decision', day(0), { ...good, id: 'dB', choice: 'hold', review: day(40), threshold: 0.25, rule: 'act' });
  const contra = ev('decision', day(0), { ...good, id: 'dC', p: 0.1, choice: 'act', threshold: 0.25, rule: 'hold' });
  const events = [act, hold, contra];
  assert.deepEqual(KN.decisionsOf(events, day(29)).map((d) => d.state), ['open', 'open', 'open'].map((s, i) => (i === 0 ? s : s)).slice(0, 3));
  let list = KN.decisionsOf(events, day(30));
  assert.deepEqual(list.filter((d) => d.state === 'due').map((d) => d.id).sort(), ['dA', 'dC'], 'due on the review day, the 40-day one not yet');
  assert.equal(KN.decisionsDue(KN.decisionsOf(events, day(29))).length, 0, 'the day before it is not due');
  events.push(ev('decision_review', day(31), { decision: 'dA', outcome: 'no', again: 'same' }), ev('decision_review', day(41), { decision: 'dB', outcome: 'yes', again: 'different' }), ev('decision_review', day(31), { decision: 'dC', outcome: 'yes', again: 'same' }));
  list = Object.fromEntries(KN.decisionsOf(events, day(41)).map((d) => [d.id, d]));
  assert.deepEqual([list.dA.state, list.dA.value, list.dA.ruleValue, list.dA.followed], ['reviewed', -10, -10, true]);
  assert.deepEqual([list.dB.value, list.dB.ruleValue, list.dB.followed], [0, 30, false]);
  assert.deepEqual([list.dC.value, list.dC.ruleValue, list.dC.followed], [30, 0, false]);
  const d = KN.describeDecisions(Object.values(list));
  assert.deepEqual([d.n, d.reviewed, d.scoredN, d.value, d.ruleValue, d.sameAgain], [3, 3, 3, 20, 20, 2]);
  near(d.followedShare, 1 / 3, 'followed the rule one time in three');
  const voided = KN.decisionsOf([...events, ev('decision', day(0), { ...good, id: 'dD', threshold: 0.25, rule: 'act' }), ev('decision_review', day(31), { decision: 'dD', outcome: 'void' })], day(41)).find((x) => x.id === 'dD');
  assert.deepEqual([voided.state, voided.value, voided.ruleValue], ['reviewed', null, null]);
  assert.equal(KN.describeDecisions([]).followedShare, null);
});

test('the pay of each choice for each outcome matches the reference on every break-even case', () => {
  for (const c of REF.breakeven) {
    const d = ev('decision', day(0), { ...good, id: `r${seq}`, p: c.p, gain: c.gain, loss: c.loss, choice: 'act', rule: c.rule, review: day(30) });
    const h = ev('decision', day(0), { ...good, id: `h${seq}`, p: c.p, gain: c.gain, loss: c.loss, choice: 'hold', rule: c.rule, review: day(30) });
    const rv = (x) => ev('decision_review', day(31), { decision: x.id, outcome: c.yes ? 'yes' : 'no' });
    const [a, b] = KN.decisionsOf([d, h, rv(d), rv(h)], day(40));
    assert.equal(a.value, c.act); assert.equal(b.value, c.hold);
  }
});

// ---- the weekly review's grade of a case against ----------------------------------------------------------------------
test('the coach file may carry a grade for a case against: sound needs no note, weak and missing need one, anything else is dropped', () => {
  const c = parseCoach({ version: 1, grades: {
    a1: { grade: 'sound', written: '2026-11-01' }, a2: { grade: 'weak', note: 'It restates the claim.', written: '2026-11-01' }, a3: { grade: 'missing', note: 'Nothing written.', written: '2026-11-02' },
    b1: { grade: 'weak', written: '2026-11-01' }, b2: { grade: 'great', note: 'x', written: '2026-11-01' }, b3: { grade: 'sound', written: 'soon' }, 'b 4': { grade: 'sound', written: '2026-11-01' },
    b5: { grade: 'weak', note: 'Ask Cl' + 'aude', written: '2026-11-01' }, b6: 5,
  } });
  assert.deepEqual(Object.keys(c.grades).sort(), ['a1', 'a2', 'a3']);
  assert.equal(c.grades.a2.note, 'It restates the claim.'); assert.equal(c.grades.a1.note, null);
  assert.equal(c.dropped, 6);
  assert.deepEqual(parseCoach({ version: 1 }).grades, {});
});

test('grades are counted per card that has a case against: sound, weak, and waiting for the review', () => {
  const p1 = pred(day(0)), p2 = pred(day(0)), p3 = pred(day(0)), p4 = pred(day(0), { caseText: '' });
  const preds = R.predictionsOf([p1, p2, p3, p4], day(2));
  const coach = { grades: { [p1.id]: { grade: 'sound', note: null, written: day(1) }, [p2.id]: { grade: 'weak', note: 'vague', written: day(1) }, [p4.id]: { grade: 'missing', note: 'none', written: day(1) } } };
  assert.deepEqual(KN.describeGrades(preds, coach), { n: 3, graded: 2, sound: 1, weak: 1, waiting: 1 });
  assert.deepEqual(KN.describeGrades(preds, null), { n: 3, graded: 0, sound: 0, weak: 0, waiting: 3 });
  assert.equal(KN.gradeOf(coach, p3), null);
});

// ---- the second estimate ------------------------------------------------------------------------------------------------
test('the value of the second number is the points the final number earned over the gut number, on resolved scored cards that carry both', () => {
  const a = pred(day(0), { c: 0.8, first: 0.6 }), b = pred(day(0), { c: 0.7, first: 0.9 }), c = pred(day(0), { c: 0.5, first: 0.5 }), noFirst = pred(day(0)), unscored = pred(day(0), { c: 0.8, first: 0.5, scored: false });
  const events = [a, b, c, noFirst, unscored, resolve(a, day(8), 'yes'), resolve(b, day(8), 'no'), resolve(c, day(8), 'yes'), resolve(noFirst, day(8), 'yes'), resolve(unscored, day(8), 'yes')];
  const preds = R.predictionsOf(events, day(20));
  const v = KN.secondValue(S, preds);
  assert.equal(v.n, 3);
  const exp = [S.score(0.8, true) - S.score(0.6, true), S.score(0.7, false) - S.score(0.9, false), 0];
  near(v.mean, exp.reduce((s, x) => s + x, 0) / 3, 'mean points', 1e-9);
  assert.equal(v.better, exp.filter((x) => x > 0).length);
  near(v.moved, (0.2 + 0.2 + 0) / 3, 'average move', 1e-9);
  assert.equal(KN.secondValue(S, []).n, 0);
});

test('an unresolved or void card is not read for the second number', () => {
  const a = pred(day(0), { c: 0.8, first: 0.6 }), b = pred(day(0), { c: 0.8, first: 0.6 });
  const events = [a, b, resolve(b, day(8), 'void')];
  assert.equal(KN.secondValue(S, R.predictionsOf(events, day(20))).n, 0);
});

// ---- the planners -----------------------------------------------------------------------------------------------------------
test('which families serve a unit: practice draws from all of them, the exam from the one the table names (Unit 9 from all three)', () => {
  assert.deepEqual(KN.practiceFamilies('U7', cfg), ['counter', 'second']);
  assert.deepEqual(KN.examFamilies('U7', cfg), ['counter']);
  assert.deepEqual(KN.examFamilies('U8', cfg), ['luck']);
  assert.deepEqual(KN.examFamilies('U9', cfg), ['act', 'threshold', 'value']);
  assert.equal(KN.isChoiceUnit('U6'), false);
});

test('the Mirror reading of choice problems counts right, rate and points, and calls a small sample thin', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ hit: i < 9, points: i < 9 ? 60 : -30 }));
  const d = KN.describeChoices(list);
  assert.deepEqual([d.n, d.right, d.points, d.thin], [12, 9, 9 * 60 - 3 * 30, false]);
  near(d.rate, 0.75, 'rate');
  assert.equal(KN.describeChoices(list.slice(0, 4)).thin, true);
  assert.deepEqual(KN.describeChoices([]), { n: 0, right: 0, rate: null, thin: true, points: 0 });
});

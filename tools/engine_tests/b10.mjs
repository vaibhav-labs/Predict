// Block 10, compete (Unit 10 so far): the sharp rule on the 1% dial, the 400-call exam, the multi-outcome score and pattern L14.
// The arithmetic of the sharp rule and the multi-outcome score is compared with Python's, written separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cfg, S, py } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as FN from '../../app/js/engine/fine.js';
import { summarize } from '../../app/js/engine/record.js';
import { ledger } from '../../app/js/engine/progress.js';
import * as WD from '../../app/js/engine/world.js';

const G = cfg.gates;
let seq = 0;
const D0 = '2026-10-01';
const day = (k) => R.addDays(D0, k);
const stamp = (d) => { seq += 1; return `${d}T${String(6 + (Math.floor(seq / 3600) % 16)).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`; };
const ev = (type, d, fields = {}) => ({ type, id: `f${String(++seq).padStart(6, '0')}`, t: stamp(d), d, ...fields });
const fcall = (d, c, hit, extra = {}) => ev('call', d, { session: 's', mode: 'practice', unit: 'U10', fine: true, q: `q${seq}`, claim: 'A claim.', side: 'yes', c, truth: hit, hit, points: FN.sharp(S, c, hit), core: S.score(c, hit), rule: 'log_points', ...extra });

test('the Block 10 settings are in the table: the fine dial, the 400-call exam, the opening chain, pattern L14', () => {
  assert.deepEqual([cfg.binary.fine.min, cfg.binary.fine.max, cfg.binary.fine.step, cfg.binary.fine.rule], [0.5, 0.99, 0.01, 'log_points']);
  assert.deepEqual([G.fine_exam_calls, G.fine_index_tolerance, G.fine_sitting, G.fine_repair_calls], [400, 0.03, 20, 20]);
  assert.deepEqual([G.opens_after.U10, G.opens_after.U11, G.opens_after.U12], ['U9', 'U10', 'U10']);
  assert.deepEqual(G.rust_triggers.U10, ['L14']);
  const t = cfg.lessons.triggers.L14;
  assert.deepEqual([t.window, t.min_share, t.clear_window, t.clear_below, t.round_to, t.drill.kind, t.drill.calls, t.drill.lock_multiples_of], [100, 0.9, 100, 0.7, 10, 'fine', 20, 10]);
  assert.equal(S.sharpRule, 'log_points');
});

test('the dial has 50 steps from 50% to 99%, each exactly the percent shown', () => {
  const steps = FN.fineSteps(cfg);
  assert.equal(steps.length, 50);
  assert.deepEqual([steps[0], steps[1], steps[13], steps[49]], [0.5, 0.51, 0.63, 0.99]);
  assert.ok(steps.every((c, i) => Math.round(c * 100) === 50 + i));
});

test('sharp points on every step match Python: round(100 * (1 + log2 p)), hit and miss', () => {
  const ref = JSON.parse(py('import math\nprint(json.dumps({str(c): [round(100*(1+math.log2(c/100))), round(100*(1+math.log2(1-c/100)))] for c in range(50,100)}))'));
  for (const c of FN.fineSteps(cfg)) {
    const key = String(Math.round(c * 100));
    assert.equal(FN.sharp(S, c, true), ref[key][0], `hit at ${key}`);
    assert.equal(FN.sharp(S, c, false), ref[key][1], `miss at ${key}`);
  }
  assert.equal(FN.sharp(S, 0.5, true), 0);
  assert.equal(FN.sharp(S, 0.99, false), -564);
});

test('multi-outcome points: 100 * log2(k p) / log2(k) matches Python, a flat answer scores 0, certainty 100, two outcomes equal the sharp rule', () => {
  const ref = JSON.parse(py('import math\nprint(json.dumps({f"{k}:{p}": round(100*math.log2(k*p/100)/math.log2(k)) for k in (2,3,4,5) for p in range(1,100)}))'));
  for (const k of [2, 3, 4, 5]) for (let p = 1; p <= 99; p++) assert.equal(FN.multiPoints(k, p / 100), ref[`${k}:${p}`], `k ${k} p ${p}`);
  assert.equal(FN.multiPoints(4, 0.25), 0);
  assert.equal(FN.multiPoints(4, 1), 100);
  for (let c = 50; c <= 99; c++) assert.equal(FN.multiPoints(2, c / 100), FN.sharp(S, c / 100, true), `two outcomes at ${c}`);
});

test('a multi-outcome answer must give every outcome a whole percent, at least 1, adding to 100', () => {
  assert.equal(FN.checkMulti([40, 30, 20, 10], 4).ok, true);
  assert.match(FN.checkMulti([40, 30, 20], 4).error, /each of the 4/);
  assert.match(FN.checkMulti([40, 30, 20, 11], 4).error, /101/);
  assert.match(FN.checkMulti([50, 50, 0, 0], 4).error, /at least 1/);
  assert.match(FN.checkMulti([40.5, 29.5, 20, 10], 4).error, /Whole/);
});

test('the Unit 10 verdict: the average confidence within 3 points of the hit rate, judged on all 400', () => {
  const mk = (n, c, hits) => Array.from({ length: n }, (_, i) => ({ c, hit: i < hits, points: FN.sharp(S, c, i < hits) }));
  let v = FN.gateFine(mk(400, 0.96, 384), G); // right 96%, says 96%
  assert.equal(v.pass, true); assert.equal(v.n, 400);
  v = FN.gateFine(mk(400, 0.96, 372), G); // right 93%: 3 points off exactly: passes
  assert.equal(v.pass, true);
  v = FN.gateFine(mk(400, 0.96, 371), G); // 3.25 points off
  assert.equal(v.pass, false); assert.deepEqual(v.reasons, ['index']); assert.equal(v.dir, 'too sure');
  v = FN.gateFine(mk(400, 0.9, 380), G); // right 95%, says 90%
  assert.equal(v.pass, false); assert.equal(v.dir, 'too shy');
  assert.equal(FN.gateFine([], G).pass, false);
});

test('the Unit 10 gate opens after Unit 9 and 84 fine practice calls, is judged once, repairs after a fail, and watches L14 for rust', () => {
  const ex = (type, d, f) => ev('exam', d, f);
  const base = { open: true, practice: 84, practiceRequired: 84 };
  let events = [];
  let st = FN.fineGateStatus(events, cfg, { ...base, open: false });
  assert.equal(st.eligible, false);
  st = FN.fineGateStatus(events, cfg, { ...base, practice: 83 });
  assert.equal(st.eligible, false);
  st = FN.fineGateStatus(events, cfg, base);
  assert.equal(st.eligible, true); assert.equal(st.total, 400);
  const start = ex('exam', day(1), { state: 'start', unit: 'U10', n: 400 });
  events = [start, fcall(day(1), 0.9, true, { mode: 'exam', exam: start.id })];
  st = FN.fineGateStatus(events, cfg, base);
  assert.equal(st.running.id, start.id); assert.equal(st.eligible, false); assert.equal(st.done, 1);
  assert.equal(FN.fineSittingSize(st, cfg), 20);
  events.push(ex('exam', day(3), { state: 'result', exam: start.id, unit: 'U10', pass: false, dir: 'too sure' }));
  st = FN.fineGateStatus(events, cfg, base);
  assert.equal(st.needsRepair, true); assert.equal(st.eligible, false);
  assert.deepEqual(FN.fineRepairOf(st.lastFailed.result, cfg), { kind: 'fine', calls: 20, dir: 'too sure' });
  const rep = ex('exam', day(4), { state: 'repair', exam: start.id, session: 'r' });
  events.push(rep);
  st = FN.fineGateStatus(events, cfg, base);
  assert.equal(st.needsRepair, false); assert.equal(st.eligible, true);
  const start2 = ex('exam', day(5), { state: 'start', unit: 'U10', n: 400 });
  events.push(start2, ex('exam', day(8), { state: 'result', exam: start2.id, unit: 'U10', pass: true }));
  st = FN.fineGateStatus(events, cfg, base);
  assert.equal(st.passed, true); assert.equal(st.eligible, false); assert.equal(st.rust, null);
  const rustFlag = ev('flag', day(20), { state: 'open', trigger: 'L14', fire: 1, evidence: {} });
  st = FN.fineGateStatus(events.concat(rustFlag), cfg, base);
  assert.equal(st.rust.trigger, 'L14');
});

test('a fine call counts at the core rule in the ledger and the summary, never at its sharp points', () => {
  const calls = [fcall(day(0), 0.99, false), fcall(day(0), 0.9, true)];
  assert.equal(calls[0].points, -564);
  assert.equal(calls[0].core, S.score(0.99, false));
  const sum = summarize(calls);
  assert.equal(sum.points, S.score(0.99, false) + S.score(0.9, true));
  const rows = ledger(calls, day(1), cfg.habit).rows;
  assert.equal(rows[0].callPoints, sum.points);
});

test('L14 fires when more than 90% of the last 100 fine calls sit on a multiple of ten, and not at 90% or on drill calls', () => {
  const t = cfg.lessons.triggers.L14;
  const fire = (events) => LE.TRIGGERS.L14.fire({ calls: LE.naturalCalls(events, cfg), t }, '');
  const mix = (roundCount, mode = 'practice') => Array.from({ length: 100 }, (_, i) => fcall(day(i % 20), i < roundCount ? [0.5, 0.6, 0.7, 0.8, 0.9][i % 5] : [0.63, 0.67, 0.97, 0.91][i % 4], i % 3 !== 0, { mode }));
  assert.equal(fire(mix(90)), null, 'exactly 90% does not fire');
  const f = fire(mix(91));
  assert.ok(f && f.evidence.n === 100 && Math.abs(f.evidence.share - 0.91) < 1e-9);
  assert.equal(fire(mix(100, 'drill')), null, 'drill calls never count');
  assert.equal(fire(mix(100).slice(0, 99)), null, 'fewer than 100 fine calls do not fire');
  const plain = Array.from({ length: 100 }, (_, i) => ev('call', day(i % 20), { session: 's', mode: 'practice', unit: 'U1', q: `p${i}`, claim: 'c', side: 'yes', c: 0.7, truth: true, hit: true, points: 1 }));
  assert.equal(fire(plain), null, 'ordinary 5% dial calls are not fine calls');
});

test('L14 re-test: the next 100 fine calls after the drill, fewer than 70% on a multiple of ten', () => {
  const t = cfg.lessons.triggers.L14;
  const batch = (n, roundN, d) => Array.from({ length: n }, (_, i) => fcall(day(d + (i % 5)), i < roundN ? 0.8 : 0.83, true));
  const run = (events, since, ready) => LE.TRIGGERS.L14.retest({ calls: LE.naturalCalls(events, cfg), t }, since, ready);
  assert.equal(run(batch(99, 10, 5), '', day(3)), null, 'not enough calls');
  const pass = run(batch(100, 69, 5), '', day(3));
  assert.equal(pass.pass, true); assert.equal(pass.evidence.n, 100);
  assert.equal(run(batch(100, 70, 5), '', day(3)).pass, false, 'exactly 70% does not pass');
  const early = batch(100, 10, 1);
  assert.equal(run(early, '', day(3)), null, 'calls before the ready day do not count');
});

test('describeFine reads the practice and exam fine calls: the last 100 for the round share, the tail calls apart', () => {
  const events = [...Array.from({ length: 10 }, (_, i) => fcall(day(i), 0.97, i !== 0)), fcall(day(11), 0.6, true), fcall(day(11), 0.8, true, { mode: 'drill' })];
  const d = FN.describeFine(events, cfg);
  assert.equal(d.n, 11);
  assert.equal(d.tailN, 10); assert.equal(d.tailHit, 0.9);
  assert.equal(d.hits, 10);
  assert.equal(d.roundShare, 1 / 11);
});

// ---- Unit 11: world questions, the two forecasts and Predict's ---------------------------------------------------------------------
test('world points: the sharp rule on the side the chance points to, matching a recomputation for every whole percent', () => {
  const ref = JSON.parse(py('import math\nout={}\nfor p in range(1,100):\n  for yes in (True,False):\n    q=p/100 if yes else 1-p/100\n    out[f"{p}:{str(yes).lower()}"]=round(100*(1+math.log2(q)))\nprint(json.dumps(out))'));
  for (let p = 1; p <= 99; p++) for (const yes of [true, false]) {
    // a number below 50% is a call on no at 100 - p: it is right when no happened. The log score of "what happened" is its chance.
    const want = ref[`${p}:${yes}`];
    // the dial is capped at 50..99, so the published points for a call at c are the table's: compare through c.
    const got = WD.worldPoints(S, p / 100, yes);
    assert.equal(got, want, `p ${p} yes ${yes}`);
  }
});

test('world questions: states by day, Predict\'s number hidden until opened, the record keeps what the player saw', () => {
  const f = (id, opens, due, p = 0.37) => [id, { text: `Will ${id} happen?`, p, written: '2026-11-01', opens, due, ref: 'a base rate', result: null, source: null, checked: null }];
  const coach = { forecasts: Object.fromEntries([f('w-a', '2026-11-10', '2026-12-01'), f('w-b', '2026-11-20', '2026-12-10'), f('w-c', '2026-11-01', '2026-11-12')]) };
  const today = '2026-11-14';
  const ev = (state, id, rest) => ({ type: 'world', state, id, t: `${today}T10:00:00Z`, d: today, ...rest });
  let qs = WD.worldQuestions([], coach, today);
  assert.deepEqual(qs.map((q) => [q.id, q.state]), [['w-c', 'expired'], ['w-a', 'open']], 'w-b has not opened and is not listed; w-c is past due and was never forecast');
  const events = [ev('first', 'w-a', { text: 'Will w-a happen?', due: '2026-12-01', opens: '2026-11-10', p: 0.6 })];
  qs = WD.worldQuestions(events, coach, today);
  assert.equal(qs.find((q) => q.id === 'w-a').state, 'reveal', 'a first number is in, the final one is not');
  events.push(ev('final', 'w-a', { p: 0.5, machine: 0.37, machineWritten: '2026-11-01', machineRef: 'a base rate' }));
  assert.equal(WD.worldQuestions(events, coach, today).find((q) => q.id === 'w-a').state, 'waiting');
  assert.equal(WD.worldQuestions(events, coach, '2026-12-02').find((q) => q.id === 'w-a').state, 'due');
  // a new file that no longer lists the question changes nothing for a question the player started
  const gone = WD.worldQuestions(events, { forecasts: {} }, '2026-12-02').find((q) => q.id === 'w-a');
  assert.equal(gone.state, 'due'); assert.equal(gone.machine, 0.37); assert.equal(gone.text, 'Will w-a happen?');
  // a final without a first is ignored; a second first is ignored
  assert.equal(WD.worldQuestions([ev('final', 'w-a', { p: 0.5, machine: 0.37 })], coach, today).find((q) => q.id === 'w-a').state, 'open');
  const twice = WD.worldQuestions([...events, ev('first', 'w-a', { p: 0.99 })], coach, today).find((q) => q.id === 'w-a');
  assert.equal(twice.first.p, 0.6);
  events.push(ev('resolve', 'w-a', { outcome: 'yes', via: 'self' }));
  const done = WD.worldQuestions(events, coach, '2026-12-02').find((q) => q.id === 'w-a');
  assert.equal(done.state, 'resolved');
  assert.deepEqual(WD.worldScores(S, done), { first: WD.worldPoints(S, 0.6, true), final: 0, machine: WD.worldPoints(S, 0.37, true) });
  assert.equal(WD.worldScores(S, { ...done, resolve: { outcome: 'void' } }), null, 'a void question scores nothing');
});

test('world gate: needs 60 resolved, then final at least as good as first and as Predict\'s alone', () => {
  const mk = (i, first, final, machine, outcome = 'yes') => ({ id: `w${i}`, first: { p: first }, final: { p: final }, machine, resolve: { outcome } });
  const many = (n, a) => Array.from({ length: n }, (_, i) => mk(i, ...a));
  let g = WD.worldGate(S, many(59, [0.6, 0.7, 0.65]), cfg.gates);
  assert.equal(g.n, 59); assert.equal(g.ready, false); assert.equal(g.passed, false);
  g = WD.worldGate(S, many(60, [0.6, 0.7, 0.65]), cfg.gates);
  assert.equal(g.ready, true); assert.equal(g.passed, true, 'final 70 beats first 60 and Predict 65 when yes happens every time');
  g = WD.worldGate(S, many(60, [0.7, 0.6, 0.65]), cfg.gates);
  assert.equal(g.beatsFirst, false); assert.equal(g.passed, false);
  g = WD.worldGate(S, many(60, [0.6, 0.65, 0.65]), cfg.gates);
  assert.equal(g.passed, true, 'equal to Predict\'s alone counts');
  g = WD.worldGate(S, [...many(60, [0.6, 0.7, 0.65]), mk(99, 0.9, 0.9, 0.9, 'void')], cfg.gates);
  assert.equal(g.n, 60); assert.equal(g.voided, 1, 'void questions are counted apart and carry no points');
  const unresolved = { ...mk(1, 0.6, 0.7, 0.65), resolve: null };
  assert.equal(WD.worldGate(S, [unresolved], cfg.gates).n, 0);
});

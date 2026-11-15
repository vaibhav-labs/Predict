// Block 6, Ranges (Unit 3): the interval score and the points it pays, the input check, the width budget, the Unit 3 gate, the two
// range triggers (L05 too narrow, L06 too wide) with their flags, the sealed exam, the drawing of sessions and the Mirror's
// numbers. The scoring tests compare the app with tools/ref_range.py, which was written separately, on 3,040 ranges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cfg, ROOT, py, near } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as G from '../../app/js/engine/gate.js';
import * as RG from '../../app/js/engine/range.js';
import { ledger } from '../../app/js/engine/progress.js';
import { seeded } from '../../app/js/engine/draw.js';
import { execFileSync } from 'node:child_process';

const BANK = JSON.parse(readFileSync(path.join(ROOT, 'app', 'content', 'questions', 'ranges.json'), 'utf8')).questions;
const byId = new Map(BANK.map((q) => [q.id, q]));
const REF = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_range.py')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const I = cfg.interval;
const L = cfg.lessons.triggers;

// ---- hand-built events --------------------------------------------------------------------------------------------------
let seq = 0;
const stamp = (d) => { seq += 1; return `${d}T08:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.${String(seq % 1000).padStart(3, '0')}Z`; };
const range = (d, hit, ratio, extra = {}) => { seq += 1; return { id: `r${String(seq).padStart(6, '0')}`, t: stamp(d), d, type: 'range', mode: 'practice', session: 'rs1', q: `rq${seq}`, kind: 'wtemp', hit, ratio, width: ratio, points: hit ? 20 : -200, ...extra }; };
const at = (d, hhmm, fields) => { seq += 1; return { id: `e${String(seq).padStart(6, '0')}`, t: `${d}T${hhmm}:00.000Z`, d, ...fields }; };
// n ranges on a day, the first `hits` of them holding the truth, all at width ratio `ratio` (a ratio of 1 is the reference width)
const batch = (d, n, hits, ratio = 1, extra) => Array.from({ length: n }, (_, i) => range(d, i < hits, ratio, extra));
const evalAll = (events, today) => LE.evaluate(events, { today, cfg, predictions: R.predictionsOf(events, today) });
const evalRanges = (events, today) => evalAll(events, today).append.filter((f) => f.trigger === 'L05' || f.trigger === 'L06' || f.state === 'retest');
const apply = (events, today, hhmm = '21:00') => { const made = evalAll(events, today).append.filter((f) => f.trigger !== 'L15').map((f) => at(today, hhmm, { ...f })); events.push(...made); return made; };
const states = (events, trigger) => LE.flagsOf(events, cfg).filter((c) => c.trigger === trigger).map((c) => c.state);
const D0 = '2026-09-01';
const day = (k) => R.addDays(D0, k);

// ===================================================================================================================
test('the range settings are in the table: 90% ranges, 20 times the miss, offset 1.25, 60 ranges and 50 to 58 hits, L05 and L06 with their drills', () => {
  assert.equal(I.coverage, 0.9);
  near(I.miss_multiplier, 2 / (1 - I.coverage), 'miss multiplier = 2 / (1 - coverage)', 1e-9);
  assert.deepEqual(cfg.gates.range_pass_hits, [50, 58]);
  assert.equal(cfg.gates.range_exam_calls, 60);
  assert.deepEqual(cfg.gates.rust_triggers.U3, ['L05', 'L06']);
  assert.equal(L.L05.drill.kind, 'stepwise');
  assert.equal(L.L06.drill.kind, 'budget');
  assert.equal(L.L06.drill.budget_ratio, 1.6);
  assert.equal(I.exam_session_size * 3, cfg.gates.range_exam_calls);
});

test('the offset 1.25 is the expected score of an honest interval on bell-shaped outcomes (sim part E), and the bank agrees about a reference player', () => {
  const out = JSON.parse(py(`
import math
from math import erf, exp, pi, sqrt
phi = lambda x: exp(-x * x / 2) / sqrt(2 * pi)
Phi = lambda x: 0.5 * (1 + erf(x / sqrt(2)))
a = 1.645
w = 2 * a + 20 * 2 * (phi(a) - a * (1 - Phi(a)))
print(json.dumps({"ratio": w / (2 * a)}))`));
  near(out.ratio, 1.254, 'score over width, honest interval', 0.002);
  assert.ok(Math.abs(I.points.offset - out.ratio) < 0.01);
  assert.ok(Math.abs(REF.reference_player.mean_points) < 10, `a reference-interval player averages ${REF.reference_player.mean_points.toFixed(1)} points a range`);
  assert.ok(REF.reference_player.hit_rate > 0.88 && REF.reference_player.hit_rate < 0.92);
});

test('the interval score and the points: the app and the independent reference agree on all 3,040 ranges (hit, width, ratio, score, points)', () => {
  assert.equal(REF.rows.length, BANK.length * 8);
  let worst = 0;
  for (const r of REF.rows) {
    const q = byId.get(r.q);
    const mine = RG.scoreRange(q, r.low, r.high, cfg);
    assert.equal(mine.hit, r.hit, `${r.q} ${r.f}`);
    assert.equal(mine.points, r.points, `${r.q} ${r.f} points`);
    for (const k of ['width', 'ratio', 'score']) worst = Math.max(worst, Math.abs(mine[k] - r[k]) / Math.max(1, Math.abs(r[k])));
    near(mine.refW, r.ref_w, `${r.q} reference width`, 1e-9);
  }
  assert.ok(worst < 1e-9, `largest relative difference ${worst}`);
});

test('the score by hand: inside costs the width, outside costs the width plus 20 times the distance, a log question works in log10', () => {
  const q = { scale: 'linear', truth: 10, ref_low: 6, ref_high: 14 }; // reference width 8
  near(RG.intervalScore(q, 7, 13, 20), 6, 'inside: the width');
  near(RG.intervalScore(q, 11, 15, 20), 4 + 20 * 1, 'one above the truth: width 4 + 20 * 1');
  near(RG.intervalScore(q, 2, 8, 20), 6 + 20 * 2, 'two below the truth');
  assert.equal(RG.rangePoints(6, 8, I.points), 50, '1.25 - 6/8 = 0.5');
  assert.equal(RG.rangePoints(RG.intervalScore(q, 6, 14, 20), 8, I.points), 25, 'exactly the reference interval, holding the truth: +25');
  assert.equal(RG.rangePoints(1e6, 8, I.points), I.points.floor, 'never below the floor');
  const lg = { scale: 'log', truth: 100, ref_low: 10, ref_high: 1000 }; // width 2 decades
  near(RG.refWidth(lg), 2, 'two decades');
  near(RG.intervalScore(lg, 30, 300, 20), 1, 'a decade wide, inside');
  near(RG.intervalScore(lg, 1000, 10000, 20), 1 + 20 * 1, 'a decade above the truth');
  assert.equal(RG.rangePoints(2.5, 2, I.points), 0, '1.25 * 2 = 2.5 is the break-even score');
  assert.equal(RG.rangePoints(2.6, 2, I.points), -5, 'a little over break-even loses a little');
});

test('half points go to the nearest even number, as the simulators round', () => {
  // 100 * (1.25 - 0.745) = 50.5 -> 50 ; 100 * (1.25 - 0.735) = 51.5 -> 52
  assert.equal(RG.rangePoints(0.745, 1, I.points), 50);
  assert.equal(RG.rangePoints(0.735, 1, I.points), 52);
});

test('what the player types: both ends, numbers only, a log question above zero, low not above high, and nothing else refused', () => {
  const lin = { scale: 'linear' }, lg = { scale: 'log' };
  assert.deepEqual(RG.checkInput(lin, '7.5', '12'), { ok: true, low: 7.5, high: 12 });
  assert.deepEqual(RG.checkInput(lin, ' 1,200 ', '1,500'), { ok: true, low: 1200, high: 1500 });
  assert.deepEqual(RG.checkInput(lin, '-5', '5'), { ok: true, low: -5, high: 5 });
  assert.deepEqual(RG.checkInput(lin, '4', '4'), { ok: true, low: 4, high: 4 });
  for (const [a, b] of [['', '5'], ['5', ''], ['  ', '3'], [undefined, '3']]) assert.equal(RG.checkInput(lin, a, b).ok, false);
  for (const [a, b] of [['abc', '5'], ['5', 'x'], ['1e', '2'], ['NaN', '4'], ['Infinity', '9']]) assert.match(RG.checkInput(lin, a, b).error, /numbers only/i);
  assert.match(RG.checkInput(lin, '9', '3').error, /low end/i);
  assert.match(RG.checkInput(lg, '0', '3').error, /above zero/i);
  assert.match(RG.checkInput(lg, '-1', '3').error, /above zero/i);
  assert.equal(RG.checkInput(lg, '0.5', '3').ok, true);
});

test('the width budget: at most 1.6 reference widths, in the question\'s own scale, and the words for it', () => {
  const lin = { scale: 'linear', digits: 1, truth: 10, ref_low: 6, ref_high: 14 };
  near(RG.budgetOf(lin, 1.6), 12.8, 'budget');
  assert.equal(RG.withinBudget(lin, 5, 17.8, 1.6), true);
  assert.equal(RG.withinBudget(lin, 5, 17.9, 1.6), false);
  assert.equal(RG.budgetText(lin, 1.6), '12.8');
  const lg = { scale: 'log', digits: 2, truth: 100, ref_low: 10, ref_high: 1000 };
  assert.equal(RG.withinBudget(lg, 10, 1500, 1.6), true); // 2.18 decades <= 3.2
  assert.equal(RG.withinBudget(lg, 1, 5000, 1.6), false); // 3.7 decades
  assert.equal(RG.budgetText(lg, 1.6), '1584.9 times');
});

// ---- the gate -------------------------------------------------------------------------------------------------------
test('the Unit 3 gate: 50 to 58 hits of 60 pass; 49 is too narrow, 59 too wide; the exact pass chances are the ones the simulation published', () => {
  const rs = (hits, ratio = 1) => batch('2026-10-01', 60, hits, ratio);
  for (let h = 0; h <= 60; h++) {
    const v = RG.gateU3(rs(h), cfg.gates);
    assert.equal(v.pass, h >= 50 && h <= 58, `${h} hits`);
    assert.equal(v.hits, h);
    if (h < 50) assert.deepEqual(v.reasons, ['narrow']);
    if (h > 58) assert.deepEqual(v.reasons, ['wide']);
  }
  assert.equal(RG.gateU3(rs(49), cfg.gates).dir, 'too narrow');
  assert.equal(RG.gateU3(rs(59), cfg.gates).dir, 'too wide');
  assert.equal(RG.gateU3(rs(54), cfg.gates).dir, null);
  assert.equal(RG.gateU3([], cfg.gates).pass, false);
  near(RG.gateU3(rs(54, 1.5), cfg.gates).meanRatio, 1.5, 'mean ratio');
  // The published table: the exact chance a player of each true coverage passes.
  const pub = out60();
  assert.ok(pub['0.9'] > 0.95 && pub['0.7'] < 0.02 && pub['0.99'] < 0.13 && pub['0.5'] < 1e-6);
  assert.deepEqual(Object.keys(REF.gate.pass_rate).sort(), Object.keys(pub).sort());
  for (const k of Object.keys(pub)) near(pub[k], REF.gate.pass_rate[k], `pass chance at ${k}`, 1e-12);
});
function out60() {
  const comb = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  const res = {};
  for (const c of [0.5, 0.7, 0.8, 0.9, 0.99]) {
    let s = 0;
    for (let k = 50; k <= 58; k++) s += comb(60, k) * c ** k * (1 - c) ** (60 - k);
    res[String(c)] = s;
  }
  return res;
}

test('a Unit 3 exam is sealed until it is judged: on file, but invisible to the ledger, the triggers and the natural ranges', () => {
  const ev = [];
  ev.push(at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U3', n: 60 }));
  const examId = ev[0].id;
  const practice = batch(day(0), 3, 3);
  const sealed = batch(day(0), 5, 0, 1, { mode: 'exam', exam: examId, points: -111 });
  ev.push(...practice, ...sealed);
  assert.equal(R.allRangesOf(ev).length, 8);
  assert.equal(R.rangesOf(ev).length, 3, 'only the practice ranges are visible');
  assert.equal(LE.naturalRanges(ev).length, 3);
  const led = ledger(ev, day(0), cfg.habit);
  assert.equal(led.byDay.get(day(0)).calls, 8, 'the day is played, every range counts as work done');
  assert.equal(led.byDay.get(day(0)).callPoints, 60, 'only the 3 unsealed ranges pay (20 each)');
  ev.push(at(day(0), '09:00', { type: 'exam', state: 'result', exam: examId, pass: false, n: 5 }));
  assert.equal(R.rangesOf(ev).length, 8, 'judged: the ranges join the record');
  assert.equal(ledger(ev, day(0), cfg.habit).byDay.get(day(0)).callPoints, 60 - 555);
});

test('exams are kept apart by unit: a Unit 3 attempt never reads as a Unit 1 exam, and its ranges are its calls', () => {
  const ev = [at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U3', n: 60 })];
  const id = ev[0].id;
  ev.push(...batch(day(0), 4, 4, 1, { mode: 'exam', exam: id }));
  assert.equal(G.examsOf(ev, cfg, 'U1').length, 0);
  assert.equal(G.examsOf(ev, cfg, 'U3').length, 1);
  assert.equal(G.examsOf(ev, cfg, 'U3')[0].calls.length, 4);
  const st = G.gateStatus(ev, cfg, { practiceCalls: 99, practiceRequired: 0, baselineDone: true });
  assert.equal(st.running, null, 'Unit 1 does not see the Unit 3 attempt');
  assert.equal(st.eligible, true);
  // An old start event without a unit is Unit 1's.
  const old = [at(day(0), '07:00', { type: 'exam', state: 'start', n: 200 })];
  assert.equal(G.examsOf(old, cfg, 'U1').length, 1);
});

test('where the player stands on the Unit 3 gate: closed, ready, running, failed (repair first), passed, and rust', () => {
  const need = { practiceRequired: 40 };
  const st = (ev, over = {}) => RG.rangeGateStatus(ev, cfg, { open: true, practiceRanges: 40, ...need, ...over });
  assert.equal(st([], { open: false }).eligible, false, 'Unit 1 not passed');
  assert.equal(st([], { practiceRanges: 39 }).eligible, false, 'not enough practice yet');
  assert.equal(st([]).eligible, true);
  const start = at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U3', n: 60 });
  let ev = [start, ...batch(day(0), 20, 18, 1, { mode: 'exam', exam: start.id })];
  assert.equal(st(ev).running.id, start.id);
  assert.equal(st(ev).done, 20);
  assert.equal(RG.rangeSittingSize(st(ev), cfg), 20);
  ev.push(...batch(day(1), 40, 36, 1, { mode: 'exam', exam: start.id }));
  assert.equal(RG.rangeSittingSize(st(ev), cfg), 0);
  // judged and failed too narrow
  ev.push(at(day(1), '10:00', { type: 'exam', state: 'result', exam: start.id, pass: false, dir: 'too narrow', hits: 40 }));
  assert.equal(st(ev).needsRepair, true);
  assert.equal(st(ev).eligible, false);
  assert.deepEqual(RG.rangeRepairOf({ dir: 'too narrow' }, cfg), { kind: 'stepwise', calls: 10 });
  assert.deepEqual(RG.rangeRepairOf({ dir: 'too wide' }, cfg), { kind: 'budget', calls: 10, budget_ratio: 1.6 });
  ev.push(at(day(2), '10:00', { type: 'exam', state: 'repair', exam: start.id, session: 'rs9' }));
  assert.equal(st(ev).needsRepair, false);
  assert.equal(st(ev).eligible, true, 'a new exam may start after the repair drill');
  // a second attempt and a pass
  const s2 = at(day(3), '07:00', { type: 'exam', state: 'start', unit: 'U3', n: 60 });
  ev.push(s2, ...batch(day(3), 60, 54, 1, { mode: 'exam', exam: s2.id }), at(day(3), '09:00', { type: 'exam', state: 'result', exam: s2.id, pass: true, hits: 54 }));
  const done = st(ev);
  assert.equal(done.passed, true);
  assert.equal(done.eligible, false);
  assert.equal(done.rust, null);
  // rust: L05 fires after the pass and is still active
  ev.push(at(day(9), '21:00', { type: 'flag', state: 'open', trigger: 'L05', fire: 1, evidence: {}, chain: 1 }));
  assert.equal(st(ev).rust.trigger, 'L05');
});

// ---- the triggers ---------------------------------------------------------------------------------------------------
test('L05 fires when fewer than 30 of the last 40 ranges held the truth, and not at 30', () => {
  assert.equal(evalRanges(batch(day(0), 40, 30), day(1)).length, 0, '30 of 40: not yet');
  const f = evalRanges(batch(day(0), 40, 29), day(1));
  assert.equal(f.length, 1);
  assert.equal(f[0].trigger, 'L05');
  assert.equal(f[0].evidence.hits, 29);
  assert.equal(f[0].evidence.n, 40);
  assert.equal(evalRanges(batch(day(0), 39, 0), day(1)).length, 0, 'it needs 40 ranges to say anything');
  // Only the last 40 count: 30 early misses followed by 40 good ones is fine.
  assert.equal(evalRanges([...batch(day(0), 30, 0), ...batch(day(1), 40, 36)], day(2)).length, 0);
});

test('L06 fires on 39 or 40 hits of 40 with an average width over twice the reference, and not on a calibrated player or an honest wide one', () => {
  assert.equal(evalRanges(batch(day(0), 40, 40, 2.01), day(1))[0].trigger, 'L06');
  assert.equal(evalRanges(batch(day(0), 40, 39, 2.5), day(1))[0].trigger, 'L06');
  assert.equal(evalRanges(batch(day(0), 40, 38, 3), day(1)).length, 0, '38 hits is not "always inside"');
  assert.equal(evalRanges(batch(day(0), 40, 40, 2), day(1)).length, 0, 'exactly twice the reference is not over it');
  assert.equal(evalRanges(batch(day(0), 40, 40, 1.2), day(1)).length, 0, 'a safe-looking player on honest widths is calibrated enough');
  const f = evalRanges(batch(day(0), 40, 40, 4), day(1))[0];
  near(f.evidence.meanRatio, 4, 'average width against the reference');
});

test('a drill\'s ranges never fire or clear anything, and an exam\'s count only once judged', () => {
  const drill = batch(day(0), 40, 0, 1, { mode: 'drill' });
  assert.equal(evalRanges(drill, day(1)).length, 0);
  const ex = at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U3', n: 60 });
  const sealed = [ex, ...batch(day(0), 40, 0, 1, { mode: 'exam', exam: ex.id })];
  assert.equal(evalRanges(sealed, day(1)).length, 0, 'sealed');
  sealed.push(at(day(1), '07:00', { type: 'exam', state: 'result', exam: ex.id, pass: false }));
  assert.equal(evalRanges(sealed, day(2))[0].trigger, 'L05', 'judged: the player\'s own ranges, so it fires');
});

test('lifecycle of L05: open, lesson, drill, re-test 1 from day 3 (33 to 38 of 40), re-test 2 from day 10, cleared; the first re-test fails at 39', () => {
  const ev = batch(D0, 40, 25);
  assert.deepEqual(apply(ev, day(1)).map((e) => e.trigger), ['L05']);
  const flag = LE.flagsOf(ev, cfg)[0];
  ev.push(at(day(1), '22:00', { type: 'flag', state: 'lesson', flag: flag.id }));
  ev.push(at(day(1), '22:10', { type: 'flag', state: 'drill', flag: flag.id, session: 'rs2' }));
  assert.equal(states(ev, 'L05')[0], 'drill');
  // ranges made before day 4 do not count toward re-test 1 (3 days after the drill)
  ev.push(...batch(day(2), 40, 36));
  assert.equal(apply(ev, day(3)).length, 0);
  assert.equal(LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: [], today: day(3) }).have, 0);
  ev.push(...batch(day(4), 40, 36));
  const p = LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: [], today: day(4) });
  assert.deepEqual([p.step, p.need, p.have, p.ready], [1, 40, 40, true]);
  const r1 = apply(ev, day(4));
  assert.equal(r1[0].state, 'retest');
  assert.equal(r1[0].pass, true);
  assert.equal(r1[0].step, 1);
  assert.equal(states(ev, 'L05')[0], 'retest2');
  ev.push(...batch(day(5), 40, 36));
  assert.equal(apply(ev, day(9)).length, 0, 'not before the tenth day');
  ev.push(...batch(day(11), 40, 34));
  const r2 = apply(ev, day(11));
  assert.equal(r2[0].step, 2);
  assert.equal(r2[0].pass, true);
  assert.equal(states(ev, 'L05')[0], 'cleared');
  // after it cleared, only later ranges can fire it again
  assert.equal(apply(ev, day(12)).length, 0);
});

test('a re-test that comes back at 39 hits (wide) or 32 (narrow) fails and reopens the flag with one more fire', () => {
  for (const hits of [39, 32]) {
    const ev = batch(D0, 40, 20);
    apply(ev, day(1));
    const flag = LE.flagsOf(ev, cfg)[0];
    ev.push(at(day(1), '22:00', { type: 'flag', state: 'drill', flag: flag.id, session: 'rs2' }));
    ev.push(...batch(day(4), 40, hits));
    const r = apply(ev, day(4))[0];
    assert.equal(r.pass, false, `${hits} hits`);
    assert.equal(LE.flagsOf(ev, cfg)[0].fires, 2);
    assert.equal(LE.flagsOf(ev, cfg)[0].state, 'open');
  }
});

test('evaluate with ranges is idempotent, and the range flags share the limits with the others (one new a day)', () => {
  const ev = batch(D0, 40, 20);
  assert.equal(apply(ev, day(1)).length, 1);
  assert.equal(apply(ev, day(1)).length, 0);
  assert.equal(apply(ev, day(1), '21:30').length, 0);
});

test('a drill for each range trigger is in the table and says what to do', () => {
  assert.deepEqual(LE.drillOf('L05', cfg), { kind: 'stepwise', calls: 10 });
  assert.deepEqual(LE.drillOf('L06', cfg), { kind: 'budget', calls: 10, budget_ratio: 1.6 });
});

// ---- drawing sessions ---------------------------------------------------------------------------------------------------
const practicePool = BANK.filter((q) => q.pool === 'practice'), examPool = BANK.filter((q) => q.pool === 'exam');
const rangeEv = (q, d, extra = {}) => ({ id: `u${++seq}`, t: stamp(d), d, type: 'range', mode: 'practice', session: 's', q, ...extra });

test('a practice session: 10 distinct practice ranges, no kind more than 3, nothing answered in the last 90 days, nothing disputed, the same seed gives the same draw', () => {
  const plan = (events, rng, today = '2026-11-16') => RG.planRanges({ bank: practicePool, events, today, size: I.session_size, reseenDays: I.reseen_days, rng });
  const a = plan([], seeded(7));
  assert.equal(a.length, 10);
  assert.equal(new Set(a).size, 10);
  assert.ok(a.every((id) => byId.get(id).pool === 'practice'));
  const kinds = {};
  a.forEach((id) => { kinds[byId.get(id).kind] = (kinds[byId.get(id).kind] || 0) + 1; });
  assert.ok(Math.max(...Object.values(kinds)) <= 3, JSON.stringify(kinds));
  assert.deepEqual(plan([], seeded(7)), a);
  assert.notDeepEqual(plan([], seeded(8)), a);
  // the 90-day rule
  const seen = a.map((q) => rangeEv(q, '2026-09-01')); // 76 days before
  const b = plan(seen, seeded(7));
  assert.equal(b.filter((x) => a.includes(x)).length, 0);
  // 168 days before: free again. A bank of just those ten gives all ten back; 76 days before it would have had to reuse them too, but only
  // because nothing else was left, never while fresh ones exist (the draw above).
  const tenOnly = practicePool.filter((q) => a.includes(q.id));
  const old = a.map((q) => rangeEv(q, '2026-06-01'));
  assert.deepEqual(RG.planRanges({ bank: tenOnly, events: old, today: '2026-11-16', size: 10, reseenDays: I.reseen_days, rng: seeded(1) }).sort(), a.slice().sort());
  // disputed ranges stay out
  const dis = a.map((q) => ({ id: `x${++seq}`, t: stamp('2026-11-01'), d: '2026-11-01', type: 'dispute', q }));
  assert.equal(plan(dis, seeded(7)).filter((x) => a.includes(x)).length, 0);
  // the pool used up: the longest ago come back first
  const all = practicePool.map((q, i) => rangeEv(q.id, '2026-11-10'));
  const c = plan(all, seeded(3));
  assert.equal(c.length, 10);
});

test('a Unit 3 exam is drawn from its own pool in three sittings of 20, 60 distinct ranges, no kind over a quarter of a sitting, and a second attempt prefers fresh ranges', () => {
  const draw = (events, seed) => RG.planRangeExam({ bank: examPool, events, size: 20, sitting: 0, total: 60, rng: seeded(seed) });
  const a = draw([], 5);
  assert.equal(a.sittings.length, 3);
  assert.deepEqual(a.sittings.map((s) => s.length), [20, 20, 20]);
  const flat = a.sittings.flat();
  assert.equal(new Set(flat).size, 60);
  assert.ok(flat.every((id) => byId.get(id).pool === 'exam'), 'never a practice range');
  for (const s of a.sittings) {
    const k = {};
    s.forEach((id) => { k[byId.get(id).kind] = (k[byId.get(id).kind] || 0) + 1; });
    assert.ok(Math.max(...Object.values(k)) <= 5, JSON.stringify(k));
  }
  assert.equal(a.reused, 0);
  const first = flat.map((q) => rangeEv(q, '2026-10-01', { mode: 'exam', exam: 'x1' }));
  const b = draw(first, 6);
  assert.equal(b.sittings.flat().filter((id) => flat.includes(id)).length, 0, 'fresh ranges first');
  const two = [...first, ...b.sittings.flat().map((q) => rangeEv(q, '2026-10-20', { mode: 'exam', exam: 'x2' }))];
  const c = draw(two, 7);
  assert.equal(new Set(c.sittings.flat()).size, 60);
  assert.equal(c.reused, 0, '180 exam ranges allow three attempts with no repeat');
  const three = [...two, ...c.sittings.flat().map((q) => rangeEv(q, '2026-11-10', { mode: 'exam', exam: 'x3' }))];
  assert.ok(draw(three, 8).reused > 0, 'a fourth attempt has to reuse the longest-ago ranges');
});

test('range sessions in the record: open until rsession_end, the active one is the last open, and a range joins the session it names', () => {
  const s1 = { id: 's1', t: '2026-11-01T08:00:00.000Z', d: '2026-11-01', type: 'rsession', mode: 'practice', size: 10, plan: [] };
  const r1 = { id: 'r1', t: '2026-11-01T08:01:00.000Z', d: '2026-11-01', type: 'range', session: 's1', q: 'a', hit: true };
  let ev = [s1, r1];
  assert.equal(RG.activeRSession(ev).id, 's1');
  assert.equal(RG.rsessionsOf(ev)[0].ranges.length, 1);
  ev.push({ id: 'e1', t: '2026-11-01T08:09:00.000Z', d: '2026-11-01', type: 'rsession_end', session: 's1' });
  assert.equal(RG.activeRSession(ev), null);
  // gym sessions know nothing of ranges
  assert.equal(R.sessionsOf(ev).length, 0);
  assert.equal(R.activeSession(ev), null);
  assert.equal(R.callsOf(ev).length, 0);
});

// ---- the Mirror ---------------------------------------------------------------------------------------------------
test('what the Mirror says about ranges: coverage with an honest error bar, width against the reference, and a verdict that never overclaims', () => {
  const mk = (n, hits, ratio) => batch('2026-10-01', n, hits, ratio);
  const d = RG.describeRanges(mk(40, 36, 1));
  assert.deepEqual([d.n, d.hits], [40, 36]);
  near(d.rate, 0.9, 'coverage');
  assert.ok(d.ci.lo < 0.9 && d.ci.hi > 0.9);
  assert.equal(d.verdict, 'no clear bias');
  assert.equal(RG.describeRanges(mk(40, 24, 1)).verdict, 'too narrow');
  assert.equal(RG.describeRanges(mk(60, 60, 2.2)).verdict, 'too wide');
  assert.equal(RG.describeRanges(mk(9, 2, 1)).verdict, 'too few', 'under 10 ranges says nothing');
  assert.equal(RG.describeRanges([]).n, 0);
  const mixed = [...mk(3, 3, 1), ...mk(1, 1, 5)];
  near(RG.describeRanges(mixed).meanRatio, 2, 'mean');
  near(RG.describeRanges(mixed).medianRatio, 1, 'median');
  const groups = RG.rangesByKind([...batch(day(0), 5, 5, 1, { kind: 'a' }), ...batch(day(0), 8, 4, 1, { kind: 'b' })]);
  assert.deepEqual(groups.map((g) => [g.kind, g.n]), [['b', 8], ['a', 5]]);
});

test('ranges count as a played day and as skill points in the ledger; the gym\'s calls and curve never read them', () => {
  const ev = batch('2026-10-01', 4, 4);
  const led = ledger(ev, '2026-10-01', cfg.habit);
  assert.equal(led.rows.length, 1);
  assert.equal(led.rows[0].played, true);
  assert.equal(led.rows[0].callPoints, 80);
  assert.equal(R.callsOf(ev).length, 0);
  assert.equal(R.summarize(R.callsOf(ev)).n, 0);
});

test('every range question has what the screens need: a lead, an ask, a unit, a scale, a truth inside the log domain, a reference interval around something, a source', () => {
  for (const q of BANK) {
    assert.ok(q.lead && q.ask && q.unit && q.fact && q.why, q.id);
    assert.ok(q.scale === 'linear' || q.scale === 'log', q.id);
    assert.ok(q.ref_low < q.ref_high, q.id);
    if (q.scale === 'log') assert.ok(q.truth > 0 && q.ref_low > 0, q.id);
    assert.ok(/^https:\/\//.test(q.source), q.id);
    assert.ok(!/claude|anthropic/i.test(JSON.stringify(q)), q.id);
  }
});

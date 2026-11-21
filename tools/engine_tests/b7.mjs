// Block 7, reasoning tools (Units 4 and 5): the break-it-down worksheet and its chain multiplier, Fermi scoring, the percent, class and chain
// problems, the Unit 4 and Unit 5 gates, the four journal patterns (L07 chain blindness, L08 planning fallacy, L09 base-rate neglect, L13 domain
// blind spot) and the outside-view grade. The arithmetic is compared with tools/ref_problem.py, which was written separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cfg, ROOT, near } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as PB from '../../app/js/engine/problem.js';
import * as RS from '../../app/js/engine/reasoning.js';
import { ledger } from '../../app/js/engine/progress.js';
import { seeded } from '../../app/js/engine/draw.js';

const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'app', 'content', 'questions', f), 'utf8')).questions;
const FERMI = load('fermi.json');
const RATES = load('rates.json');
const fById = new Map(FERMI.map((q) => [q.id, q]));
const REF = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_problem.py')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const G = cfg.gates;
const L = cfg.lessons.triggers;
const rel = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

// ---- hand-built events ------------------------------------------------------------------------------------------------------
let seq = 0;
const stamp = (d) => { seq += 1; return `${d}T${String(6 + Math.floor(seq / 3600) % 16).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`; };
const at = (d, hhmm, fields) => { seq += 1; return { id: `e${String(seq).padStart(6, '0')}`, t: `${d}T${hhmm}:00.000Z`, d, ...fields }; };
const D0 = '2026-09-01';
const day = (k) => R.addDays(D0, k);
const prob = (d, hit, extra = {}) => { seq += 1; return { id: `p${String(seq).padStart(6, '0')}`, t: stamp(d), d, type: 'prob', mode: 'practice', unit: 'U5', family: 'rate', session: 'ps1', q: `pq${seq}`, kind: 'doc', hit, miss: hit ? 2 : 12, signed: hit ? 2 : 12, points: hit ? 70 : -60, ...extra }; };
const pred = (d, o = {}) => {
  seq += 1;
  return { type: 'prediction', id: `x${String(seq).padStart(6, '0')}`, t: stamp(d), d, text: 'By Friday it will happen.', domain: o.domain || 'work', dueOption: 'week', due: R.addDays(d, 2), horizon: 'week',
    chain: { outsideView: { text: 'usual', rate: o.rate ?? 0.5 }, evidence: o.evidence ?? [{ text: 'a signal', dir: 'up', test: true }], caseAgainst: { text: 'c', number: 10 }, tripwire: { text: 't', number: 30 } },
    c: o.c ?? 0.7, b: o.b ?? 0.5, bSource: 'starter', scored: true, flags: [], ...(o.steps ? { steps: o.steps } : {}), ...(o.own ? { own: true } : {}) };
};
const resolve = (p, outcome, d, edge = 0) => ({ type: 'resolve', id: `y${String(++seq).padStart(6, '0')}`, t: stamp(d), d, prediction: p.id, outcome, raw: 0, edge });
// n cards, the first `yes` of them resolving yes, all stated at c, each resolved on `resolveDay`
const cards = (n, yes, c, resolveDay, o = {}, edgeOf = () => 0) => Array.from({ length: n }, (_, i) => { const p = pred(day(0), { c, ...o }); return [p, resolve(p, i < yes ? 'yes' : 'no', resolveDay, edgeOf(i))]; }).flat();
const steps3 = [{ text: 'a', p: 0.8 }, { text: 'b', p: 0.8 }, { text: 'c', p: 0.8 }];
const evalAll = (events, today) => LE.evaluate(events, { today, cfg, predictions: R.predictionsOf(events, today) });
const apply = (events, today, hhmm = '21:00') => { const made = evalAll(events, today).append.filter((f) => f.trigger !== 'L15').map((f) => at(today, hhmm, { ...f })); events.push(...made); return made; };
const states = (events, trigger) => LE.flagsOf(events, cfg).filter((c) => c.trigger === trigger).map((c) => c.state);

// ===================================================================================================================
test('the Block 7 settings are in the table: the gates, the problem scoring, the four triggers and their drills', () => {
  assert.equal(G.fermi_exam_calls, 20);
  assert.equal(G.fermi_pass_hits, 16);
  assert.equal(G.fermi_median_factor, 3);
  assert.equal(G.rate_exam_calls, 40);
  assert.equal(G.rate_pass_within, 32);
  assert.equal(cfg.problems.rate.tolerance, 7);
  assert.equal(cfg.problems.rate.class_min_cases, 30);
  assert.deepEqual(G.opens_after, { U4: 'U3', U5: 'U4' });
  assert.deepEqual(G.rust_triggers.U4, ['L07']);
  assert.deepEqual(G.rust_triggers.U5, ['L08', 'L09']);
  assert.deepEqual([L.L07.window, L.L07.gap, L.L07.clear_gap, L.L07.drill.kind, L.L07.drill.calls], [15, 0.15, 0.10, 'chain', 10]);
  assert.deepEqual([L.L08.window, L.L08.gap, L.L08.drill.kind], [20, 0.15, 'plan']);
  assert.deepEqual([L.L09.window, L.L09.distance, L.L09.drill.kind, L.L09.drill.calls], [15, 0.25, 'classpick', 8]);
  assert.deepEqual([L.L13.window, L.L13.drill.kind], [30, 'domain']);
});

test('the worksheet: the app and the independent reference agree on 696 Fermi answers (combined range, held, ratio, score, points, miss factor, naive range)', () => {
  assert.equal(REF.worksheet.length, 696);
  for (const row of REF.worksheet) {
    const q = fById.get(row.q);
    const entries = row.parts.map(([low, high]) => ({ low, high }));
    const r = PB.scoreFermi(q, entries, cfg);
    rel(r.low, row.low, `${row.q} ${row.f} low`, 1e-9);
    rel(r.high, row.high, `${row.q} ${row.f} high`, 1e-9);
    assert.equal(r.hit, row.hit, `${row.q} ${row.f} hit`);
    rel(r.ratio, row.ratio, `${row.q} ${row.f} ratio`, 1e-9);
    rel(r.score, row.score, `${row.q} ${row.f} score`, 1e-9);
    assert.equal(r.points, row.points, `${row.q} ${row.f} points`);
    rel(r.miss, row.miss, `${row.q} ${row.f} miss factor`, 1e-9);
    rel(r.naive.low, row.naive[0], `${row.q} naive low`);
    rel(r.naive.high, row.naive[1], `${row.q} naive high`);
  }
});

test('the worksheet arithmetic on 20 known problems: centres multiply, half-widths add in quadrature, a multiplier scales both ends', () => {
  assert.equal(REF.twenty.length, 20);
  for (const k of REF.twenty) {
    const got = PB.combineRanges(k.parts.map(([low, high]) => ({ low, high })), k.mult);
    rel(got.low, k.low, `low of ${JSON.stringify(k.parts)}`, 1e-9);
    rel(got.high, k.high, `high of ${JSON.stringify(k.parts)}`, 1e-9);
    assert.ok(got.low <= got.high);
  }
  // closed forms worked by hand
  const c = (parts, mult = 1) => PB.combineRanges(parts.map(([low, high]) => ({ low, high })), mult);
  near(c([[4, 4]]).low, 4, 'a point part stays a point', 1e-9);
  near(c([[2, 8]]).high, 8, 'one part is its own range', 1e-9);
  near(c([[1, 1], [2, 2]], 5).low, 10, '5 x 1 x 2', 1e-9);
  near(c([[1, 4], [1, 4], [1, 4], [1, 4]]).low, 4, 'four (1, 4) parts: centre 16, half-width 2 ln 2, so 16 / 4', 1e-9);
  near(c([[1, 4], [1, 4], [1, 4], [1, 4]]).high, 64, 'and 16 x 4', 1e-9);
  near(c([[1, 100], [1, 100]]).high, 10 ** (2 + Math.SQRT2), 'two (1, 100) parts: centre 100 (10 x 10), half-width sqrt(2) decades', 1e-9);
  near(PB.chainProduct([0.8, 0.8, 0.8]), 0.512, 'three 80% steps make 51%', 1e-12);
  // the combined range is wider than any one part and narrower than the naive one, and the naive one is the product of the ends
  const parts = [{ low: 2, high: 8 }, { low: 3, high: 12 }, { low: 10, high: 40 }];
  const comb = PB.combineRanges(parts), naive = PB.naiveRange(parts);
  assert.ok(comb.high / comb.low > 4 && comb.high / comb.low < naive.high / naive.low);
  assert.equal(naive.low, 60);
  assert.equal(naive.high, 3840);
});

test('what the player types for the parts: every part needs both ends above zero, low not above high', () => {
  const q = FERMI[0];
  const good = q.parts.map(() => ({ low: '2', high: '9' }));
  assert.equal(PB.checkParts(q, good).ok, true);
  const bad1 = good.map((x) => ({ ...x })); bad1[1] = { low: '', high: '5' };
  assert.deepEqual([PB.checkParts(q, bad1).ok, PB.checkParts(q, bad1).index], [false, 1]);
  const bad2 = good.map((x) => ({ ...x })); bad2[0] = { low: '0', high: '5' };
  assert.equal(PB.checkParts(q, bad2).ok, false);
  const bad3 = good.map((x) => ({ ...x })); bad3[0] = { low: '9', high: '2' };
  assert.equal(PB.checkParts(q, bad3).ok, false);
  assert.equal(PB.checkParts(q, [{ low: 'x', high: '1' }, ...good.slice(1)]).ok, false);
});

test('Fermi scoring keeps the part verdicts and compares the worksheet with a first direct guess', () => {
  const q = FERMI.find((x) => x.kind === 'fwx');
  const entries = q.parts.map((p) => ({ low: p.truth / 2, high: p.truth * 2 }));
  const r = PB.scoreFermi(q, entries, cfg, { low: q.truth / 10, high: q.truth / 5 });
  assert.equal(r.partsHit, q.parts.length);
  assert.equal(r.hit, true);
  assert.equal(r.direct.hit, false);
  assert.ok(r.points > r.direct.points);
  assert.ok(r.direct.miss > r.miss);
  assert.equal(PB.scoreFermi(q, entries, cfg).direct, undefined);
});

test('percent problems: the miss in points, a hit within 7, full points at the truth, nothing worse than the floor; the app agrees with the reference on 1,152 answers', () => {
  const rates = new Map(RATES.map((q) => [q.id, q]));
  for (const row of REF.rate) {
    const r = PB.scoreRate(rates.get(row.q), row.guess, cfg);
    near(r.miss, row.miss, `${row.q} miss`, 1e-9);
    assert.equal(r.hit, row.hit, `${row.q} hit at ${row.guess}`);
    assert.equal(r.points, row.points, `${row.q} points at ${row.guess}`);
  }
  const q = { truth: 40 };
  assert.deepEqual([PB.scoreRate(q, 40, cfg).points, PB.scoreRate(q, 47, cfg).points, PB.scoreRate(q, 47, cfg).hit, PB.scoreRate(q, 47.1, cfg).hit, PB.scoreRate(q, 90, cfg).points], [100, 0, true, false, -100]);
  assert.deepEqual([PB.scoreRate(q, 33.5, cfg).points, PB.scoreRate(q, 20, cfg).points], [7, -100]);
});

test('what the player types for a percent: 0 to 100, numbers only, a trailing % is fine', () => {
  assert.deepEqual([PB.checkPercent('35').ok, PB.checkPercent('35%').value, PB.checkPercent(' 0 ').ok, PB.checkPercent('100').ok], [true, 35, true, true]);
  for (const t of ['', 'abc', '101', '-1']) assert.equal(PB.checkPercent(t).ok, false, t);
});

test('chains: every stored joint share is the product of its steps, and a chain is always lower than its weakest step', () => {
  assert.equal(REF.chain.length, 40);
  for (const c of REF.chain) {
    assert.ok(Math.abs(c.product - c.truth) < 0.5, `${c.q}: ${c.product} vs ${c.truth}`);
    assert.ok(c.truth < c.weakest, `${c.q}: the whole is below the weakest step`);
  }
});

test('reference classes: the right rung is the narrowest group that still holds 30 cases, for all 40 ladders', () => {
  assert.equal(REF.classes.length, 40);
  const ladders = new Map(RATES.filter((q) => q.type === 'class').map((q) => [q.id, q]));
  for (const c of REF.classes) {
    assert.equal(c.right, c.stored);
    assert.equal(PB.rightRung(ladders.get(c.q).classes, cfg.problems.rate.class_min_cases), c.right);
  }
  assert.deepEqual([PB.scoreClass({ right: 3 }, 3, cfg).points, PB.scoreClass({ right: 3 }, 4, cfg).points, PB.scoreClass({ right: 3 }, 4, cfg).hit], [60, -30, false]);
  assert.equal(new Set(REF.classes.map((c) => c.right)).size >= 3, true, 'the right answer varies');
});

test('the Unit 4 gate: 16 of 20 hold and the median miss within a factor of 3; the pass chances are the published ones', () => {
  const mk = (hits, miss) => Array.from({ length: 20 }, (_, i) => ({ hit: i < hits, miss, ratio: 1, points: 0 }));
  assert.equal(PB.gateU4(mk(16, 2.9), G).pass, true);
  const f15 = PB.gateU4(mk(15, 2.9), G);
  assert.deepEqual([f15.pass, f15.reasons, f15.dir], [false, ['hits'], 'too narrow']);
  const far = PB.gateU4(mk(19, 3.1), G);
  assert.deepEqual([far.pass, far.reasons, far.dir], [false, ['factor'], 'too far off']);
  assert.equal(PB.gateU4(mk(20, 3), G).pass, true, 'exactly a factor of 3 passes');
  near(REF.gates.u4['0.9'], 0.9568, 'a true 90% player passes 96%', 1e-3);
  near(REF.gates.u4['0.7'], 0.2375, 'a 70% player passes 24%', 1e-3);
  assert.equal(PB.gateU4([], G).pass, false);
});

test('the Unit 5 gate: 32 of 40 within 7 points; a failure says whether the answers ran high or low', () => {
  const mk = (n, signed) => Array.from({ length: 40 }, (_, i) => ({ hit: i < n, miss: Math.abs(signed), signed, points: 0 }));
  assert.equal(PB.gateU5(mk(32, 3), G).pass, true);
  const f = PB.gateU5(mk(31, 12), G);
  assert.deepEqual([f.pass, f.reasons, f.dir], [false, ['within'], 'too high']);
  assert.equal(PB.gateU5(mk(30, -12), G).dir, 'too low');
  near(REF.gates.u5['0.85'], 0.8646, 'an 85% player passes 87%', 1e-3);
  near(REF.gates.u5['0.7'], 0.111, 'a 70% player passes 11%', 1e-3);
});

test('exams: a problem exam is sealed until judged, counted as that unit\'s calls, and kept apart by unit', () => {
  const start = at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U4', n: 20 });
  const sealed = Array.from({ length: 5 }, () => prob(day(0), true, { mode: 'exam', exam: start.id, unit: 'U4', family: 'fermi', points: 90 }));
  const ev = [start, prob(day(0), true, { mode: 'practice', points: 40, unit: 'U4' }), ...sealed];
  assert.equal(R.allProbsOf(ev).length, 6);
  assert.equal(R.probsOf(ev).length, 1, 'only the practice problem is visible');
  assert.equal(ledger(ev, day(0), cfg.habit).byDay.get(day(0)).callPoints, 40, 'sealed problems pay nothing yet');
  assert.equal(ledger(ev, day(0), cfg.habit).byDay.get(day(0)).calls, 6, 'but the day is played');
  ev.push(at(day(0), '09:00', { type: 'exam', state: 'result', exam: start.id, unit: 'U4', pass: false, n: 5 }));
  assert.equal(R.probsOf(ev).length, 6);
  assert.equal(ledger(ev, day(0), cfg.habit).byDay.get(day(0)).callPoints, 40 + 450);
});

test('where the player stands on the Unit 4 and Unit 5 gates: closed, ready, running, repair first, passed, rust', () => {
  const st = (ev, unit, over = {}) => PB.problemGateStatus(ev, cfg, unit, { open: true, practice: unit === 'U4' ? 16 : 36, practiceRequired: unit === 'U4' ? 16 : 36, ...over });
  for (const unit of ['U4', 'U5']) {
    const total = unit === 'U4' ? 20 : 40;
    assert.equal(st([], unit, { open: false }).eligible, false, 'the unit before is not passed');
    assert.equal(st([], unit, { practice: 5 }).eligible, false, 'not enough practice');
    assert.equal(st([], unit).eligible, true);
    assert.equal(st([], unit).total, total);
    const start = at(day(0), '07:00', { type: 'exam', state: 'start', unit, n: total });
    let ev = [start, ...Array.from({ length: 10 }, () => prob(day(0), true, { mode: 'exam', exam: start.id, unit }))];
    assert.equal(st(ev, unit).running.id, start.id);
    assert.equal(st(ev, unit).done, 10);
    assert.equal(PB.sittingSize(st(ev, unit), cfg), unit === 'U4' ? 10 : 20 > total - 10 ? total - 10 : 20);
    ev.push(at(day(1), '10:00', { type: 'exam', state: 'result', exam: start.id, unit, pass: false, dir: 'too narrow' }));
    assert.equal(st(ev, unit).needsRepair, true);
    ev.push(at(day(2), '10:00', { type: 'exam', state: 'repair', exam: start.id, session: 'ps9' }));
    assert.equal(st(ev, unit).eligible, true);
    const s2 = at(day(3), '07:00', { type: 'exam', state: 'start', unit, n: total });
    ev.push(s2, at(day(3), '09:00', { type: 'exam', state: 'result', exam: s2.id, unit, pass: true }));
    assert.equal(st(ev, unit).passed, true);
    assert.equal(st(ev, unit).rust, null);
    ev.push(at(day(9), '21:00', { type: 'flag', state: 'open', trigger: unit === 'U4' ? 'L07' : 'L09', fire: 1, evidence: {}, chain: 1 }));
    assert.equal(st(ev, unit).rust.trigger, unit === 'U4' ? 'L07' : 'L09');
  }
  // the units are kept apart: a Unit 4 attempt is not a Unit 5 exam
  const s = at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U4', n: 20 });
  assert.equal(PB.problemGateStatus([s], cfg, 'U5', { open: true, practice: 36, practiceRequired: 36 }).running, null);
  assert.deepEqual(PB.problemRepairOf('U4', cfg), { kind: 'fermi', calls: 6 });
  assert.deepEqual(PB.problemRepairOf('U5', cfg), { kind: 'rate', calls: 10 });
});

// ---- the outside-view grade and the chain multiplier in the journal -------------------------------------------------------------
test('the outside-view grade: the player\'s stated rate against the checker\'s reference class, accepted within 10 points', () => {
  const p = (rate, b, extra = {}) => ({ ...pred(day(0), { rate, b }), ...extra });
  const g = RS.outsideGrade(p(0.4, 0.5), cfg);
  assert.deepEqual([g.accepted, Math.round(g.gap * 100), g.reference, g.stated], [true, -10, 0.5, 0.4]);
  assert.equal(RS.outsideGrade(p(0.39, 0.5), cfg).accepted, false);
  assert.equal(RS.outsideGrade(p(0.6, 0.5), cfg).accepted, true);
  assert.equal(RS.outsideGrade(p(0.61, 0.5), cfg).accepted, false);
  // Predict's later number replaces the baseline for scoring, but the grade is against what was recorded at lock
  assert.equal(RS.outsideGrade(p(0.45, 0.9, { b0: 0.5 }), cfg).reference, 0.5);
  assert.equal(RS.outsideGrade({ chain: { outsideView: { text: 'x', rate: NaN } }, b: 0.5 }, cfg), null);
  assert.equal(RS.acceptedBaseRates([p(0.5, 0.5), p(0.5, 0.5), p(0.1, 0.5)], cfg), 2);
});

test('the chain multiplier: a card with two or more steps is a chain card; the product is the chance of all of it', () => {
  assert.equal(RS.isChainCard(pred(day(0), { steps: steps3 })), true);
  assert.equal(RS.isChainCard(pred(day(0), { steps: [{ text: 'a', p: 0.8 }] })), false);
  assert.equal(RS.isChainCard(pred(day(0))), false);
  near(RS.chainProductOf(steps3), 0.512, 'three 80% steps', 1e-12);
  near(PB.chainProduct([0.9, 0.9, 0.9, 0.9, 0.9]), 0.59049, 'five 90% steps make 59%', 1e-12);
});

// ---- the four journal triggers --------------------------------------------------------------------------------------------------
test('L07 fires when the last 15 resolved chain cards were stated 15 or more points above how often they happened, and not for ordinary cards', () => {
  // 15 chain cards stated at 85%, 8 of them yes: gap 85 - 53 = 32
  const ev = cards(15, 8, 0.85, day(3), { steps: steps3 });
  const f = apply([...ev], day(4));
  assert.deepEqual(f.map((x) => x.trigger), ['L07']);
  assert.equal(f[0].evidence.n, 15);
  near(f[0].evidence.gap, 0.85 - 8 / 15, 'gap', 1e-9);
  // the same cards without steps are not chain cards
  assert.equal(apply(cards(15, 8, 0.85, day(3)), day(4)).length, 0);
  // 14 are not enough, and a gap of 14 points is not enough
  assert.equal(apply(cards(14, 5, 0.85, day(3), { steps: steps3 }), day(4)).length, 0);
  assert.equal(apply(cards(15, 10, 0.80, day(3), { steps: steps3 }), day(4)).filter((x) => x.trigger === 'L07').length, 0, '80% stated, 67% happened: 13 points');
  assert.equal(apply(cards(20, 10, 0.80, day(3), { steps: steps3 }), day(4)).filter((x) => x.trigger === 'L07').length, 1, '80 vs 50: 30 points, 20 cards, only the last 15 count');
  // unresolved and void cards are not observations
  const open = Array.from({ length: 15 }, () => pred(day(0), { c: 0.9, steps: steps3 }));
  assert.equal(apply(open, day(1)).length, 0);
});

test('L08 reads own-task cards the same way over 20 cards', () => {
  assert.equal(apply(cards(20, 9, 0.8, day(3), { own: true }), day(4)).filter((x) => x.trigger === 'L08').length, 1);
  assert.equal(apply(cards(19, 5, 0.8, day(3), { own: true }), day(4)).filter((x) => x.trigger === 'L08').length, 0, '19 is not 20');
  assert.equal(apply(cards(20, 9, 0.8, day(3)), day(4)).filter((x) => x.trigger === 'L08').length, 0, 'cards not marked as own tasks do not count');
  assert.equal(apply(cards(20, 15, 0.8, day(3), { own: true }), day(4)).filter((x) => x.trigger === 'L08').length, 0, 'well calibrated: 80 vs 75');
});

test('L09 fires on far-from-base forecasts with no evidence that scored below the base rate; evidence or a nearer number keeps it quiet', () => {
  const far = (edge, o = {}) => cards(15, 5, 0.85, day(3), { b: 0.4, evidence: [], ...o }, () => edge);
  const f = apply(far(-30), day(4)).filter((x) => x.trigger === 'L09');
  assert.equal(f.length, 1);
  near(f[0].evidence.meanEdge, -30, 'mean edge', 1e-9);
  assert.equal(apply(far(+10), day(4)).filter((x) => x.trigger === 'L09').length, 0, 'beat the base rate');
  assert.equal(apply(far(-30, { evidence: [{ text: 'a signal', dir: 'up', test: true }] }), day(4)).filter((x) => x.trigger === 'L09').length, 0, 'evidence logged');
  assert.equal(apply(far(-30, { b: 0.7 }), day(4)).filter((x) => x.trigger === 'L09').length, 0, 'only 15 points from the base rate');
  assert.equal(apply(far(-30, { b: 0.6 }), day(4)).filter((x) => x.trigger === 'L09').length, 1, 'exactly 25 points from the base rate counts');
});

test('L13 fires for the one domain whose last 30 cards earned a negative edge, and names it', () => {
  const dom = (d, edge, n = 30) => cards(n, n / 2, 0.6, day(3), { domain: d }, () => edge);
  const ev = [...dom('work', 5), ...dom('life', -4), ...dom('world', 3)];
  const f = apply(ev, day(4)).filter((x) => x.trigger === 'L13');
  assert.equal(f.length, 1);
  assert.equal(f[0].evidence.domain, 'life');
  near(f[0].evidence.meanEdge, -4, 'mean edge', 1e-9);
  assert.equal(apply(dom('work', -4, 29), day(4)).filter((x) => x.trigger === 'L13').length, 0, '29 cards are not 30');
  assert.equal(apply(dom('work', 0), day(4)).filter((x) => x.trigger === 'L13').length, 0, 'zero edge is not below zero');
  // the worst domain goes first when two are below zero
  const two = [...dom('work', -2), ...dom('world', -9)];
  assert.equal(apply(two, day(4)).filter((x) => x.trigger === 'L13')[0].evidence.domain, 'world');
  // trivial and self-controlled cards do not count
  const trivial = cards(30, 15, 0.6, day(3), { domain: 'work', b: 0.97 }, () => -9);
  assert.equal(apply(trivial, day(4)).filter((x) => x.trigger === 'L13').length, 0);
});

test('lifecycle of L07: open, lesson, drill, re-test 1 from day 3, re-test 2 from day 10, cleared; a re-test that is still too sure fails and reopens it', () => {
  const ev = cards(15, 8, 0.85, day(3), { steps: steps3 });
  assert.deepEqual(apply(ev, day(4)).map((e) => e.trigger), ['L07']);
  const flag = LE.flagsOf(ev, cfg)[0];
  ev.push(at(day(4), '22:00', { type: 'flag', state: 'lesson', flag: flag.id }));
  ev.push(at(day(4), '22:10', { type: 'flag', state: 'drill', flag: flag.id, session: 'ps2' }));
  assert.equal(states(ev, 'L07')[0], 'drill');
  // chain cards resolved before day 7 (3 days after the drill) do not count for re-test 1
  ev.push(...cards(15, 11, 0.7, day(6), { steps: steps3 }));
  assert.equal(apply(ev, day(6)).length, 0);
  assert.equal(LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: R.predictionsOf(ev, day(6)), today: day(6) }).have, 0);
  ev.push(...cards(15, 11, 0.7, day(8), { steps: steps3 }));
  const p = LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: R.predictionsOf(ev, day(8)), today: day(8) });
  assert.deepEqual([p.step, p.need, p.have, p.ready], [1, 15, 15, true]);
  const r1 = apply(ev, day(8));
  assert.deepEqual([r1[0].state, r1[0].step, r1[0].pass], ['retest', 1, true]);
  assert.equal(states(ev, 'L07')[0], 'retest2');
  ev.push(...cards(15, 11, 0.7, day(15), { steps: steps3 }));
  const r2 = apply(ev, day(15));
  assert.deepEqual([r2[0].step, r2[0].pass], [2, true]);
  assert.equal(states(ev, 'L07')[0], 'cleared');
  // a re-test still 20 points too sure fails
  const bad = cards(15, 8, 0.85, day(3), { steps: steps3 });
  apply(bad, day(4));
  const fl = LE.flagsOf(bad, cfg)[0];
  bad.push(at(day(4), '22:00', { type: 'flag', state: 'lesson', flag: fl.id }), at(day(4), '22:10', { type: 'flag', state: 'drill', flag: fl.id, session: 'ps2' }));
  bad.push(...cards(15, 8, 0.85, day(8), { steps: steps3 }));
  const r = apply(bad, day(8));
  assert.deepEqual([r[0].state, r[0].pass], ['retest', false]);
  assert.equal(LE.flagsOf(bad, cfg)[0].fires, 2);
  assert.equal(states(bad, 'L07')[0], 'open');
});

test('lifecycle of L09: the re-test passes only when every one of the next 15 far-from-base forecasts carries evidence; L13 clears on a non-negative edge in that domain', () => {
  const ev = cards(15, 5, 0.85, day(3), { b: 0.4, evidence: [] }, () => -30);
  apply(ev, day(4));
  const fl = LE.flagsOf(ev, cfg).find((c) => c.trigger === 'L09');
  ev.push(at(day(4), '22:00', { type: 'flag', state: 'lesson', flag: fl.id }), at(day(4), '22:10', { type: 'flag', state: 'drill', flag: fl.id, session: 'ps2' }));
  const fresh = (evidence) => Array.from({ length: 15 }, () => { const p = pred(day(8), { c: 0.85, b: 0.4, evidence }); return p; });
  const withOne = fresh([]); withOne[3] = pred(day(8), { c: 0.85, b: 0.4, evidence: [{ text: 'a signal', dir: 'up', test: true }] });
  const failing = [...ev, ...withOne];
  const rf = apply(failing, day(8)).filter((e) => e.state === 'retest');
  assert.deepEqual([rf[0].pass, rf[0].evidence.withEvidence], [false, 1]);
  const ok = [...ev, ...fresh([{ text: 'a signal', dir: 'up', test: true }])];
  const rp = apply(ok, day(8)).filter((e) => e.state === 'retest');
  assert.deepEqual([rp[0].pass, rp[0].evidence.withEvidence], [true, 15]);
  // forecasts nearer the base than 25 points are not part of the re-test
  const near25 = [...ev, ...Array.from({ length: 15 }, () => pred(day(8), { c: 0.5, b: 0.4 }))];
  assert.equal(apply(near25, day(8)).filter((e) => e.state === 'retest').length, 0);

  const ev2 = cards(30, 15, 0.6, day(3), { domain: 'life' }, () => -4);
  apply(ev2, day(4));
  const f2 = LE.flagsOf(ev2, cfg).find((c) => c.trigger === 'L13');
  ev2.push(at(day(4), '22:00', { type: 'flag', state: 'lesson', flag: f2.id }), at(day(4), '22:10', { type: 'flag', state: 'drill', flag: f2.id, session: 'ps2' }));
  ev2.push(...cards(30, 15, 0.6, day(8), { domain: 'work' }, () => 6)); // another domain: does not count for this flag
  assert.equal(apply(ev2, day(8)).length, 0);
  ev2.push(...cards(30, 15, 0.6, day(8), { domain: 'life' }, () => 2));
  const r = apply(ev2, day(8)).filter((e) => e.state === 'retest');
  assert.deepEqual([r[0].pass, r[0].evidence.domain], [true, 'life']);
});

test('evaluate with the new triggers is idempotent, and they share the one-new-a-day and two-in-repair limits with the others', () => {
  const ev = [...cards(15, 8, 0.85, day(3), { steps: steps3 }), ...cards(20, 9, 0.8, day(3), { own: true })];
  const first = apply(ev, day(4));
  assert.equal(first.length, 1, 'only one new pattern opens a day');
  assert.equal(evalAll(ev, day(4)).append.filter((f) => f.trigger === first[0].trigger).length, 0, 'asking twice writes nothing new');
  assert.equal(apply(ev, day(5)).length, 1, 'the second opens the next day');
});

test('drills for the four triggers are in the table and say what to do', () => {
  for (const [id, kind, calls] of [['L07', 'chain', 10], ['L08', 'plan', 8], ['L09', 'classpick', 8], ['L13', 'domain', 8]]) {
    assert.deepEqual(LE.drillOf(id, cfg), { kind, calls });
  }
  assert.equal(LE.PATTERN_IDS.includes('L13'), true);
});

// ---- drawing sessions ---------------------------------------------------------------------------------------------------------------
test('a Fermi practice session: 8 distinct practice problems, no family more than 2, nothing answered in the last 90 days, nothing disputed; the same seed gives the same draw', () => {
  const bank = FERMI.filter((q) => q.pool === 'practice');
  const args = { bank, events: [], today: day(0), size: cfg.problems.fermi.session_size, reseenDays: cfg.problems.fermi.reseen_days };
  const a = PB.planProblems({ ...args, rng: seeded(7) });
  assert.equal(a.length, 8);
  assert.equal(new Set(a).size, 8);
  const kinds = {};
  for (const id of a) { const q = fById.get(id); assert.equal(q.pool, 'practice'); kinds[q.kind] = (kinds[q.kind] || 0) + 1; }
  assert.ok(Math.max(...Object.values(kinds)) <= 2, JSON.stringify(kinds));
  assert.deepEqual(PB.planProblems({ ...args, rng: seeded(7) }), a);
  assert.notDeepEqual(PB.planProblems({ ...args, rng: seeded(8) }), a);
  const seen = [prob(day(0), true, { q: a[0] }), { type: 'dispute', id: 'd1', t: stamp(day(0)), d: day(0), q: a[1] }];
  const b = PB.planProblems({ ...args, events: seen, today: day(10), rng: seeded(7) });
  assert.ok(!b.includes(a[0]) && !b.includes(a[1]));
  const later = PB.planProblems({ ...args, events: [prob(day(0), true, { q: a[0] })], today: day(95), rng: seeded(7) });
  assert.equal(later.length, 8);
});

test('a Unit 5 session: 9 rate problems and 3 reference-class ladders, shuffled; a Unit 4 exam: 20 distinct problems from the exam pool in two sittings of 10, fresh before reused', () => {
  const rateBank = RATES.filter((q) => q.type === 'rate' && q.pool === 'practice');
  const classBank = RATES.filter((q) => q.type === 'class');
  const plan = PB.planMix({ rateBank, classBank, events: [], today: day(0), size: 12, classCount: 3, reseenDays: 90, rng: seeded(3) });
  const types = plan.map((id) => RATES.find((q) => q.id === id).type);
  assert.deepEqual([plan.length, types.filter((t) => t === 'class').length, types.filter((t) => t === 'rate').length], [12, 3, 9]);
  assert.equal(new Set(plan).size, 12);
  const bank = FERMI.filter((q) => q.pool === 'exam');
  const drawn = PB.planProblemExam({ bank, events: [], unit: 'U4', size: 10, total: 20, rng: seeded(5) });
  assert.deepEqual(drawn.sittings.map((s) => s.length), [10, 10]);
  const flat = drawn.sittings.flat();
  assert.equal(new Set(flat).size, 20);
  assert.equal(drawn.reused, 0);
  const start = at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U4', n: 20 });
  const used = flat.map((q) => prob(day(0), true, { q, mode: 'exam', exam: start.id, unit: 'U4' }));
  const second = PB.planProblemExam({ bank, events: [start, ...used], unit: 'U4', size: 10, total: 20, rng: seeded(5) }).sittings.flat();
  assert.equal(new Set(second).size, 20);
  assert.equal(second.filter((id) => flat.includes(id)).length, 0, 'a second attempt gets fresh problems: the pool holds 48');
  const third = PB.planProblemExam({ bank, events: [start, ...used, ...second.map((q) => prob(day(1), true, { q, mode: 'exam', exam: start.id, unit: 'U4' }))], unit: 'U4', size: 10, total: 20, rng: seeded(5) });
  assert.ok(third.reused > 0, 'a third attempt has to reuse 12 of them');
});

test('problem sessions in the record: open until psession_end, the active one is the last open, a prob joins the session it names', () => {
  const s1 = at(day(0), '08:00', { type: 'psession', mode: 'practice', unit: 'U4', family: 'fermi', size: 8, plan: ['a', 'b'] });
  const p1 = at(day(0), '08:01', { type: 'prob', session: s1.id, q: 'a', hit: true });
  let ev = [s1, p1];
  assert.equal(PB.activePSession(ev).id, s1.id);
  assert.equal(PB.psessionsOf(ev)[0].probs.length, 1);
  ev.push(at(day(0), '08:05', { type: 'psession_end', session: s1.id }));
  assert.equal(PB.activePSession(ev), null);
  assert.equal(PB.psessionsOf(ev)[0].ended, true);
});

test('what the Mirror says about problems: Fermi coverage with the worksheet against the first guess, percent accuracy and bias, thin below the limit', () => {
  const f = Array.from({ length: 10 }, (_, i) => ({ hit: i < 8, miss: 2 + i / 10, points: 10, partsHit: 2, parts: [1, 2], direct: { hit: i < 5 } }));
  const d = PB.describeFermi(f);
  assert.deepEqual([d.n, d.hits, d.thin, d.directN, d.worksheetHits, d.directHits], [10, 8, false, 10, 8, 5]);
  assert.equal(PB.describeFermi(f.slice(0, 4)).thin, true);
  assert.equal(PB.describeFermi([]).rate, null);
  const r = PB.describeRates([{ hit: true, miss: 3, signed: 3, points: 50 }, { hit: false, miss: 11, signed: -11, points: -60 }]);
  assert.deepEqual([r.n, r.within, r.meanMiss, r.bias, r.thin], [2, 1, 7, -4, true]);
});

test('every problem has what the screens need, and no text names the assistant', () => {
  for (const q of FERMI) {
    assert.ok(q.lead && q.ask && q.unit && q.why && q.fact && /^https?:/.test(q.source) && q.parts.length >= 2 && q.scale === 'log' && q.ref_low > 0 && q.ref_high > q.ref_low, q.id);
    assert.ok(q.parts.every((p) => p.label && p.hint && p.unit && p.truth > 0), q.id);
  }
  for (const q of RATES) {
    assert.ok(q.lead && q.ask && q.why && /^https?:/.test(q.source) && ['work', 'life', 'world'].includes(q.jdomain), q.id);
    if (q.type === 'rate') assert.ok(q.truth >= 0 && q.truth <= 100, q.id);
    if (q.type === 'class') assert.ok(q.classes.length >= 5 && q.right >= 0 && q.right < q.classes.length, q.id);
    if (q.type === 'chain') assert.ok(q.steps.length >= 2 && q.truth > 0, q.id);
  }
  assert.ok(!/claude|anthropic/i.test(JSON.stringify(FERMI) + JSON.stringify(RATES)));
});

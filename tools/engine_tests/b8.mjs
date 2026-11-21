// Block 8, updating (Unit 6): the update action on an open journal card and its checks, the time-weighted score of a card that was updated, the two
// patterns that read updates (L10 frozen forecasts, L11 whiplash), the Unit 6 problems and gate, and the stream planners. The arithmetic is compared
// with tools/ref_update.py, which was written separately and defines the cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cfg, S, ROOT } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as PB from '../../app/js/engine/problem.js';
import * as UP from '../../app/js/engine/update.js';
import * as J from '../../app/js/engine/journal.js';
import { parseCoach } from '../../app/js/engine/coach.js';
import { seeded } from '../../app/js/engine/draw.js';

const STREAMS = JSON.parse(readFileSync(path.join(ROOT, 'app', 'content', 'questions', 'updates.json'), 'utf8')).questions;
const REF = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_update.py')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const G = cfg.gates;
const L = cfg.lessons.triggers;
const U = cfg.problems.update;
const rel = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

let seq = 0;
const D0 = '2026-10-01';
const day = (k) => R.addDays(D0, k);
const at = (d, hhmm, fields) => { seq += 1; return { id: `e${String(seq).padStart(6, '0')}`, t: `${d}T${hhmm}:00.000Z`, d, ...fields }; };
const stamp = (d) => { seq += 1; return `${d}T${String(6 + Math.floor(seq / 3600) % 16).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`; };
const pred = (d, o = {}) => {
  seq += 1;
  return { type: 'prediction', id: `x${String(seq).padStart(6, '0')}`, t: stamp(d), d, text: 'By Friday it will happen.', domain: 'work', dueOption: 'longer', due: o.due || day(60), horizon: 'month',
    chain: { outsideView: { text: 'usual', rate: 0.5 }, evidence: [{ text: 'a signal', dir: 'up', test: true }], caseAgainst: { text: 'c', number: 10 }, tripwire: { text: 't', number: 30 } },
    c: o.c ?? 0.3, b: o.b ?? 0.5, bSource: 'starter', scored: true, flags: [] };
};
const upd = (p, d, c, reason = 'new information', prev) => ({ type: 'update', id: `u${String(++seq).padStart(6, '0')}`, t: stamp(d), d, prediction: p.id, c, prev: prev ?? p.c, reason });
const news = (ids, written) => Object.fromEntries(ids.map((id) => [id, { text: 'a development', written, source: 'https://example.org/n' }]));
const evalAll = (events, today, nw = {}) => LE.evaluate(events, { today, cfg, predictions: R.predictionsOf(events, today), news: nw });
const apply = (events, today, nw = {}, hhmm = '21:00') => { const made = evalAll(events, today, nw).append.filter((f) => f.trigger !== 'L15').map((f) => at(today, hhmm, { ...f })); events.push(...made); return made; };
const states = (events, trigger) => LE.flagsOf(events, cfg).filter((c) => c.trigger === trigger).map((c) => c.state);

// ===================================================================================================================
test('the Block 8 settings are in the table: the Unit 6 gate, the problem scoring, the update rule and the two triggers', () => {
  assert.equal(G.update_exam_calls, 40);
  assert.equal(G.update_pass_within, 32);
  assert.equal(G.update_gain_min, 0);
  assert.equal(G.update_repair_calls, 10);
  assert.equal(G.opens_after.U6, 'U5');
  assert.deepEqual(G.rust_triggers.U6, ['L10', 'L11']);
  assert.deepEqual([U.tolerance, U.full_points, U.floor, U.session_size, U.exam_session_size, U.min_cases, U.drill_move_min], [7, 100, -100, 6, 20, 60, 8]);
  assert.deepEqual([U.update_rule.min_reason_chars, U.update_rule.large_move, U.update_rule.reverse_days, U.update_rule.reverse_share, U.update_rule.cards_needed], [3, 0.25, 14, 0.5, 12]);
  assert.deepEqual([L.L10.window, L.L10.news_days, L.L10.clear_stale_days, L.L10.drill.kind, L.L10.drill.calls], [5, 7, 7, 'stream', 5]);
  assert.deepEqual([L.L11.window, L.L11.large, L.L11.reverse_days, L.L11.reverse_share, L.L11.clear_window, L.L11.clear_reversed_below, L.L11.drill.kind, L.L11.drill.calls], [10, 0.25, 14, 0.5, 10, 3, 'move', 8]);
});

test('the time-weighted score of a card that was updated matches the independent hand calculation on eight cards', () => {
  assert.equal(REF.tw.length, 8);
  for (const c of REF.tw) {
    const p = pred(day(0), { c: c.c, b: c.b });
    p.updates = c.updates.map((u) => ({ d: day(u.d), t: `${day(u.d)}T10:00:00.000Z`, c: u.c }));
    const x = UP.twScore(S, p, day(c.end), c.yes, cfg.journal.edge_weight);
    const tl = UP.timeline(p, day(c.end)).map((d) => d.c);
    assert.deepEqual(tl, c.days, `${c.name}: the forecast in force each day`);
    rel(x.raw, c.raw, `${c.name} raw`);
    rel(x.edge, c.edge, `${c.name} edge`);
    rel(x.raw0, c.raw0, `${c.name} raw0`);
    rel(x.edge0, c.edge0, `${c.name} edge0`);
    rel(x.gain, c.gain, `${c.name} gain`);
    assert.equal(x.days, c.n, `${c.name} days`);
    assert.equal(x.updates, c.used, `${c.name} updates used`);
  }
});

test('with no update a card scores exactly as before, and a void card never reaches the scorer', () => {
  const p = pred(day(0), { c: 0.8, b: 0.5 });
  p.updates = [];
  for (const yes of [true, false]) {
    const a = UP.twScore(S, p, day(9), yes, cfg.journal.edge_weight);
    const b = J.journalScore(S, 0.8, 0.5, yes, cfg.journal.edge_weight);
    assert.equal(a.raw, b.raw); assert.equal(a.edge, b.edge); assert.equal(a.gain, 0);
  }
  // predictionsOf carries the updates, the number now in force, and the locked number as it was
  const pr = pred(day(0), { c: 0.3 });
  const ev = [pr, upd(pr, 2, 0.6), upd(pr, 4, 0.5)].map((e) => (e.d === 2 ? { ...e, d: day(2) } : e.d === 4 ? { ...e, d: day(4) } : e));
  const got = R.predictionsOf(ev, day(5))[0];
  assert.deepEqual([got.c, got.cNow, got.updates.length, got.state], [0.3, 0.5, 2, 'open']);
});

test('checking an update: only an open card, a new number inside 1 to 99, different from the one in force, and a reason', () => {
  const p = { id: 'x', state: 'open', c: 0.4, cNow: 0.4 };
  assert.equal(UP.checkUpdate(p, 0.6, 'the vendor confirmed', cfg).ok, true);
  assert.equal(UP.checkUpdate(p, 0.6, 'the vendor confirmed', cfg).prev, 0.4);
  assert.equal(UP.checkUpdate({ ...p, state: 'due' }, 0.6, 'ok then', cfg).ok, false);
  assert.equal(UP.checkUpdate({ ...p, state: 'resolved' }, 0.6, 'ok then', cfg).ok, false);
  assert.equal(UP.checkUpdate(p, 0.4, 'nothing changed', cfg).ok, false, 'the same number');
  assert.equal(UP.checkUpdate(p, 0.403, 'nothing changed', cfg).ok, false, 'under half a point');
  assert.equal(UP.checkUpdate(p, 0.6, '  ', cfg).ok, false, 'no reason');
  assert.equal(UP.checkUpdate(p, 0.6, 'ok', cfg).ok, false, 'a reason under 3 characters');
  assert.equal(UP.checkUpdate(p, 1, 'sure now', cfg).ok, false);
  assert.equal(UP.checkUpdate(p, 0, 'sure now', cfg).ok, false);
  assert.equal(UP.checkUpdate(p, 0.99, 'sure now', cfg).ok, true);
  assert.equal(UP.checkUpdate(p, NaN, 'sure now', cfg).ok, false);
  // measured from the number in force, not the locked one
  assert.equal(UP.checkUpdate({ ...p, cNow: 0.7 }, 0.4, 'back down', cfg).ok, true);
  assert.equal(UP.checkUpdate({ ...p, cNow: 0.7 }, 0.7, 'same again', cfg).ok, false);
});

test('large moves: judged against the middle of the move within 14 days, matching the independent version on nine histories', () => {
  const t = L.L11;
  for (const c of REF.moves) {
    const p = pred(day(0), { c: c.c });
    p.state = c.resolved ? 'resolved' : 'open';
    p.updates = c.updates.map((u, i) => ({ d: day(u.d), t: `${day(u.d)}T${String(10 + i).padStart(2, '0')}:00:00.000Z`, c: u.c }));
    const got = UP.largeMoves([p], day(c.today), t);
    assert.equal(got.length, c.moves.length, `${c.name}: how many large moves`);
    got.forEach((m, i) => { assert.equal(m.d, day(c.moves[i].d)); assert.equal(m.reversed, c.moves[i].reversed, `${c.name}: reversed`); assert.equal(m.judged, c.moves[i].judged, `${c.name}: judged`); });
  }
});

test('frozen cards: open, older than 7 days, with a note and no update since the note, matching the independent version', () => {
  const t = L.L10;
  for (const c of REF.frozen) {
    const p = pred(day(c.locked), {});
    p.state = c.resolved ? 'resolved' : 'open';
    p.updates = c.updates.map((d) => ({ d: day(d), t: `${day(d)}T10:00:00.000Z`, c: 0.5 }));
    const got = UP.frozenCards([p], news([p.id], day(c.written)), day(c.today), t);
    assert.equal(got.length, c.frozen ? 1 : 0, c.name);
    if (c.frozen) assert.equal(got[0].waited, c.waited, `${c.name}: waited`);
  }
  assert.deepEqual(UP.frozenCards([{ ...pred(day(0)), state: 'open', updates: [] }], {}, day(10), t), [], 'no note, no card');
});

test('the Unit 6 steps: miss, within 7, points and gain over staying put match the independent version on every step at six guesses', () => {
  const byId = new Map(STREAMS.flatMap(UP.stepsOf).map((q) => [q.id, q]));
  assert.equal(REF.steps.length, STREAMS.length * 2 * 6);
  for (const r of REF.steps) {
    const q = byId.get(r.id);
    const got = UP.scoreUpdate(q, r.guess, cfg);
    assert.equal(got.hit, r.hit, `${r.id} hit`);
    assert.equal(got.points, r.points, `${r.id} points`);
    rel(got.miss, r.miss, `${r.id} miss`);
    rel(got.gain, r.gain, `${r.id} gain`, 1e-9);
    rel(got.moved, r.moved, `${r.id} moved`, 1e-9);
  }
  // staying at the prior has gain zero; going to the truth has gain equal to the whole move
  const q = byId.get(REF.steps[0].id);
  assert.equal(UP.scoreUpdate(q, q.prior, cfg).gain, 0);
  rel(UP.scoreUpdate(q, q.truth, cfg).gain, Math.abs(q.prior - q.truth), 'moving all the way', 1e-9);
});

test('the Unit 6 gate: 32 of 40 within 7 and an average gain of zero or more; either failure is named; the pass chance is the published one', () => {
  const mk = (n, within, gain) => Array.from({ length: n }, (_, i) => ({ hit: i < within, miss: i < within ? 3 : 12, signed: i < within ? 3 : 12, gain: typeof gain === 'function' ? gain(i) : gain, points: i < within ? 50 : -60 }));
  const ok = UP.gateU6(mk(40, 32, 1), G);
  assert.deepEqual([ok.pass, ok.reasons, ok.hits, ok.within], [true, [], 32, 32]);
  const few = UP.gateU6(mk(40, 31, 1), G);
  assert.deepEqual([few.pass, few.reasons, few.dir], [false, ['within'], 'too high']);
  const lose = UP.gateU6(mk(40, 36, -1), G);
  assert.deepEqual([lose.pass, lose.reasons, lose.dir], [false, ['gain'], 'moved the wrong way']);
  const zero = UP.gateU6(mk(40, 32, 0), G);
  assert.equal(zero.pass, true, 'a gain of exactly zero passes');
  const both = UP.gateU6(mk(40, 10, -2), G);
  assert.deepEqual(both.reasons, ['within', 'gain']);
  assert.equal(UP.gateU6([], G).pass, false);
  assert.equal(PB.gateOf('U6'), UP.gateU6);
  assert.equal(PB.examTotal('U6', G), 40);
  assert.equal(PB.examSitting('U6', cfg), 20);
  assert.deepEqual(PB.problemRepairOf('U6', cfg), { kind: 'update', calls: 10 });
  // the pass chance of the within-7 half, from the independent binomial
  assert.ok(Math.abs(REF.gate['0.85'] - 0.8646) < 1e-4);
  assert.ok(Math.abs(REF.gate['0.7'] - 0.1110) < 1e-4);
});

test('where the player stands on the Unit 6 gate: ready, running, repair first, passed, and rust from L10 or L11', () => {
  const st = (ev, over = {}) => PB.problemGateStatus(ev, cfg, 'U6', { open: true, practice: 30, practiceRequired: 30, ...over });
  assert.equal(st([], { open: false }).eligible, false);
  assert.equal(st([], { practice: 10 }).eligible, false);
  assert.equal(st([]).eligible, true);
  assert.equal(st([]).total, 40);
  const start = at(day(0), '07:00', { type: 'exam', state: 'start', unit: 'U6', n: 40 });
  const ev = [start, at(day(1), '10:00', { type: 'exam', state: 'result', exam: start.id, unit: 'U6', pass: false, reasons: ['gain'] })];
  assert.equal(st(ev).needsRepair, true);
  ev.push(at(day(2), '10:00', { type: 'exam', state: 'repair', exam: start.id, session: 'ps9' }));
  const s2 = at(day(3), '07:00', { type: 'exam', state: 'start', unit: 'U6', n: 40 });
  ev.push(s2, at(day(3), '09:00', { type: 'exam', state: 'result', exam: s2.id, unit: 'U6', pass: true }));
  assert.equal(st(ev).passed, true);
  assert.equal(st(ev).rust, null);
  ev.push(at(day(9), '21:00', { type: 'flag', state: 'open', trigger: 'L11', fire: 1, evidence: {}, chain: 1 }));
  assert.equal(st(ev).rust.trigger, 'L11');
});

test('L10 fires when five open cards older than a week had news and no update; an update, a young card or no note keeps it quiet', () => {
  const make = (n, extra = {}) => Array.from({ length: n }, () => pred(day(0), extra));
  const cards = make(5);
  const nw = news(cards.map((p) => p.id), day(8));
  const ev = [...cards];
  assert.equal(evalAll(ev, day(10), {}).append.filter((f) => f.trigger === 'L10').length, 0, 'no notes');
  const made = evalAll(ev, day(10), nw).append.filter((f) => f.trigger === 'L10');
  assert.equal(made.length, 1);
  assert.equal(made[0].evidence.n, 5);
  assert.equal(made[0].evidence.longest, 2);
  // one of the five updated after the note: four are left, under the window of five
  const ev2 = [...cards, upd(cards[0], 9, 0.5)].map((e) => (e.type === 'update' ? { ...e, d: day(9) } : e));
  assert.equal(evalAll(ev2, day(10), nw).append.filter((f) => f.trigger === 'L10').length, 0);
  // an update made before the note does not count as acting on it
  const ev3 = [...cards, upd(cards[0], 7, 0.5)].map((e) => (e.type === 'update' ? { ...e, d: day(7) } : e));
  assert.equal(evalAll(ev3, day(10), nw).append.filter((f) => f.trigger === 'L10').length, 1);
  // cards only five days old are too young
  const young = [...Array.from({ length: 5 }, () => pred(day(5)))];
  assert.equal(evalAll(young, day(10), news(young.map((p) => p.id), day(8))).append.filter((f) => f.trigger === 'L10').length, 0);
});

test('lifecycle of L10: open, lesson, drill, re-test 1 from day 3, re-test 2 from day 10; it clears only when the waiting cards have been updated', () => {
  const cards = Array.from({ length: 5 }, () => pred(day(0)));
  const nw = news(cards.map((p) => p.id), day(8));
  const ev = [...cards];
  assert.deepEqual(apply(ev, day(10), nw).map((e) => e.trigger), ['L10']);
  const flag = LE.flagsOf(ev, cfg)[0];
  ev.push(at(day(10), '22:00', { type: 'flag', state: 'lesson', flag: flag.id }), at(day(10), '22:10', { type: 'flag', state: 'drill', flag: flag.id, session: 'ps2' }));
  assert.equal(states(ev, 'L10')[0], 'drill');
  // the first re-test is ready 3 days after the drill (day 13): cards have waited 5 days, under the 7 a card may wait
  const early = LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: R.predictionsOf(ev, day(12)), today: day(12), news: nw });
  assert.equal(early.ready, false);
  const r1 = apply(ev, day(13), nw);
  assert.deepEqual([r1[0].state, r1[0].step, r1[0].pass], ['retest', 1, true]);
  assert.equal(states(ev, 'L10')[0], 'retest2');
  // the second is ready on day 20: every card has now waited 12 days; with none updated it fails and reopens
  const bad = [...ev];
  const rb = apply(bad, day(20), nw);
  assert.deepEqual([rb[0].state, rb[0].step, rb[0].pass], ['retest', 2, false]);
  assert.equal(states(bad, 'L10')[0], 'open');
  // with all five updated (with a reason) it clears
  const good = [...ev, ...cards.map((p) => ({ ...upd(p, 14, 0.5), d: day(14) }))];
  const rg = apply(good, day(20), nw);
  assert.deepEqual([rg[0].step, rg[0].pass], [2, true]);
  assert.equal(states(good, 'L10')[0], 'cleared');
});

const swing = (n, reversedCount, lockDay) => Array.from({ length: n }, (_, i) => {
  const p = pred(day(lockDay), { c: 0.3 });
  const ups = [{ ...upd(p, lockDay + 1, 0.7), d: day(lockDay + 1) }];
  if (i < reversedCount) ups.push({ ...upd(p, lockDay + 3, 0.5, 'backed off', 0.7), d: day(lockDay + 3) });
  return [p, ...ups];
}).flat();

test('L11 fires when half of the last ten large updates were reversed within 14 days; fewer reversals, or moves that cannot be judged yet, keep it quiet', () => {
  const half = swing(10, 5, 0);
  const made = evalAll(half, day(30)).append.filter((f) => f.trigger === 'L11');
  assert.equal(made.length, 1);
  assert.deepEqual([made[0].evidence.n, made[0].evidence.reversed], [10, 5]);
  assert.equal(evalAll(swing(10, 4, 0), day(30)).append.filter((f) => f.trigger === 'L11').length, 0, '4 of 10 is under half');
  assert.equal(evalAll(swing(9, 9, 0), day(30)).append.filter((f) => f.trigger === 'L11').length, 0, 'fewer than ten large updates');
  // the unreversed moves of an open card are not judged until 14 days have passed
  const fresh = swing(10, 0, 28);
  assert.equal(UP.whiplashObs(R.predictionsOf(fresh, day(30)), day(30), L.L11).length, 0);
  assert.equal(UP.whiplashObs(R.predictionsOf(fresh, day(50)), day(50), L.L11).length, 10);
});

test('lifecycle of L11: the re-test counts the next ten large updates after the wait and passes with fewer than three reversed', () => {
  const ev = swing(10, 6, 0);
  assert.deepEqual(apply(ev, day(30)).map((e) => e.trigger), ['L11']);
  const flag = LE.flagsOf(ev, cfg)[0];
  ev.push(at(day(30), '22:00', { type: 'flag', state: 'lesson', flag: flag.id }), at(day(30), '22:10', { type: 'flag', state: 'drill', flag: flag.id, session: 'ps3' }));
  // large updates made before the re-test is ready (day 33) do not count
  ev.push(...swing(10, 0, 31));
  assert.equal(LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: R.predictionsOf(ev, day(60)), today: day(60), news: {} }).have, 0);
  ev.push(...swing(10, 2, 36));
  const pr = LE.retestProgress(LE.flagsOf(ev, cfg)[0], ev, { cfg, predictions: R.predictionsOf(ev, day(60)), today: day(60), news: {} });
  assert.deepEqual([pr.need, pr.have, pr.ready], [10, 10, true]);
  const r1 = apply(ev, day(60));
  assert.deepEqual([r1[0].step, r1[0].pass], [1, true]);
  assert.equal(states(ev, 'L11')[0], 'retest2');
  // a re-test with five of ten reversed fails
  const bad = swing(10, 6, 0);
  apply(bad, day(30));
  const fl = LE.flagsOf(bad, cfg)[0];
  bad.push(at(day(30), '22:00', { type: 'flag', state: 'lesson', flag: fl.id }), at(day(30), '22:10', { type: 'flag', state: 'drill', flag: fl.id, session: 'ps3' }), ...swing(10, 5, 36));
  const rb = apply(bad, day(60));
  assert.deepEqual([rb[0].step, rb[0].pass], [1, false]);
  assert.equal(states(bad, 'L11')[0], 'open');
});

test('the coach\'s news notes: a note needs text, a written day and a link; anything else is dropped and counted', () => {
  const raw = { version: 1, news: {
    good: { text: 'The regulator moved the date.', written: '2026-10-08', source: 'https://example.org/a' },
    nolink: { text: 'x', written: '2026-10-08', source: 'example' },
    nodate: { text: 'x', source: 'https://example.org/a' },
    notext: { written: '2026-10-08', source: 'https://example.org/a' },
  } };
  const coach = parseCoach(raw);
  assert.deepEqual(Object.keys(coach.news), ['good']);
  assert.ok(coach.dropped >= 3);
});

test('update streams: a stream is two steps, a step id names its stream, and the planners draw whole streams without repeating anything seen lately', () => {
  assert.equal(UP.streamOf('upd-1a2b3c4#1'), 'upd-1a2b3c4');
  assert.equal(UP.streamOf('plain'), 'plain');
  const steps = UP.stepsOf(STREAMS[0]);
  assert.deepEqual(steps.map((x) => x.id), [`${STREAMS[0].id}#0`, `${STREAMS[0].id}#1`]);
  assert.deepEqual([steps[0].prior, steps[1].prior], [STREAMS[0].prior0, STREAMS[0].steps[0].truth], 'step two starts from what step one revealed');
  assert.equal(steps[1].known.length, 1);
  const practice = STREAMS.filter((q) => q.pool === 'practice'), exam = STREAMS.filter((q) => q.pool === 'exam');
  const a = PB.planStreams({ bank: practice, events: [], today: day(0), steps: 6, reseenDays: U.reseen_days, rng: seeded(5) });
  assert.equal(a.length, 6);
  assert.deepEqual(a, PB.planStreams({ bank: practice, events: [], today: day(0), steps: 6, reseenDays: U.reseen_days, rng: seeded(5) }), 'the same seed, the same draw');
  assert.deepEqual(a.map((id, i) => id.endsWith(i % 2 ? '#1' : '#0')), [true, true, true, true, true, true]);
  assert.equal(new Set(a.map(UP.streamOf)).size, 3);
  // a stream answered in the last 90 days does not come back while others are available
  const seen = at(day(0), '10:00', { type: 'prob', mode: 'practice', unit: 'U6', family: 'update', q: a[0], hit: true, points: 80 });
  for (let s = 1; s < 30; s++) assert.ok(!PB.planStreams({ bank: practice, events: [seen], today: day(10), steps: 6, reseenDays: U.reseen_days, rng: seeded(s) }).some((id) => UP.streamOf(id) === UP.streamOf(a[0])));
  // an odd number of steps ends on a first step
  const five = PB.planStreams({ bank: practice, events: [], today: day(0), steps: 5, reseenDays: 90, rng: seeded(2) });
  assert.equal(five.length, 5); assert.ok(five[4].endsWith('#0'));
  // the exam: two sittings of 20 steps, whole streams, none shared between sittings, all from the exam pool
  const ex = PB.planUpdateExam({ bank: exam, events: [], size: 20, total: 40, rng: seeded(9) });
  assert.deepEqual(ex.sittings.map((s) => s.length), [20, 20]);
  const ids = ex.sittings.flat();
  assert.equal(new Set(ids).size, 40);
  assert.equal(new Set(ids.map(UP.streamOf)).size, 20);
  assert.ok(ids.every((id) => exam.some((q) => q.id === UP.streamOf(id))));
  // a 'move' drill: eight steps that all moved 8 or more points, different steps
  const mv = PB.planMoves({ bank: practice, events: [], today: day(0), steps: 8, reseenDays: 90, rng: seeded(4), minMove: U.drill_move_min });
  const byId = new Map(practice.flatMap(UP.stepsOf).map((q) => [q.id, q]));
  assert.equal(mv.length, 8); assert.equal(new Set(mv).size, 8);
  assert.ok(mv.every((id) => Math.abs(byId.get(id).truth - byId.get(id).prior) >= 8));
});

test('what the Mirror says about update steps and about updates on cards: within 7, gain over staying put, share of a big move, what updates added', () => {
  const rows = [
    { hit: true, truth: 40, prior: 20, moved: 15, gain: 15, points: 80 },
    { hit: true, truth: 20, prior: 20, moved: 0, gain: 0, points: 100 },
    { hit: false, truth: 10, prior: 30, moved: -2, gain: -18, points: -50 },
  ];
  const d = UP.describeUpdates(rows, { thinBelow: 10 });
  assert.deepEqual([d.n, d.within, d.thin, d.bigN], [3, 2, true, 2]);
  rel(d.meanGain, (15 + 0 - 18) / 3, 'mean gain');
  rel(d.moveShare, (15 / 20 + (-2 / -20)) / 2, 'share of the big moves taken');
  assert.equal(UP.describeUpdates([], {}).n, 0);
  const v = UP.updateValue([
    { state: 'resolved', scored: true, outcome: 'yes', edge: 150, edge0: 100, updates: [{}] },
    { state: 'resolved', scored: true, outcome: 'no', edge: 20, edge0: 60, updates: [{}] },
    { state: 'resolved', scored: true, outcome: 'void', edge: null, edge0: null, updates: [{}] },
    { state: 'resolved', scored: true, outcome: 'yes', edge: 90, updates: [] },
    { state: 'open', scored: true, updates: [{}] },
  ]);
  assert.deepEqual([v.n, v.total, v.mean], [2, 10, 5]);
});

test('every update step has what the screens need, and no text names the assistant', () => {
  const all = STREAMS.flatMap(UP.stepsOf);
  assert.equal(all.length, STREAMS.length * 2);
  for (const q of all) {
    assert.ok(q.lead && q.ask && q.news && q.fact && q.why && /^https?:/.test(q.source) && ['work', 'life', 'world'].includes(q.jdomain), q.id);
    assert.ok(q.prior > 0 && q.prior < 100 && q.truth > 0 && q.truth < 100 && q.n >= U.min_cases, q.id);
    assert.ok(!/claude|anthropic/i.test(JSON.stringify(q)), q.id);
  }
  const mids = all.filter((q) => Math.abs(q.truth - q.prior) >= 8).length / all.length;
  assert.ok(mids > 0.25 && mids < 0.55, `big moves are ${(mids * 100).toFixed(0)}% of steps`);
});

test('signed() rounds a fractional score for display (time-weighted edge) and never writes +0 or −0', async () => {
  const { signed } = await import('../../app/js/engine/scoring.js');
  assert.deepEqual([signed(56.888888), signed(-14.2222), signed(0.4), signed(-0.4), signed(7), signed(-7)], ['+57', '−14', '0', '0', '+7', '−7']);
});

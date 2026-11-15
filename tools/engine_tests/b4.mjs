// Block 4, the Lesson Engine: pattern triggers, the flag lifecycle, the Unit 1 exam gate, the autopsy queue, the instant note,
// the 90-day rule and the exam pool. The decisive tests compare the app with tools/ref_lessons.py, an independent
// recomputation, on synthetic players from tools/synth.py (same events, two implementations), and compare the rates at
// which the triggers and the gate fire with the ones the simulations in sim/ published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { cfg, S, ROOT, py, near } from './common.mjs';
import { withDir, readEvents, walkJS, sameTimeline, scenario, summary } from './walk.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as G from '../../app/js/engine/gate.js';
import { planBaseline, pickNext, seeded } from '../../app/js/engine/draw.js';

const L = cfg.lessons;
const readCsv = (name) => JSON.parse(py(`import csv\nprint(json.dumps(list(csv.DictReader(open(${JSON.stringify(path.join(ROOT, 'data', name))}, encoding='utf-8')))))`));

// ---- hand-built events ---------------------------------------------------------------------------------------------
let seq = 0;
const stamp = () => `${String(Math.floor(seq / 60) % 24).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}`;
const call = (d, c, hit, extra = {}) => { seq += 1; return { id: `c${String(seq).padStart(6, '0')}`, t: `${d}T08:${String(seq % 60).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}.${String(seq % 1000).padStart(3, '0')}Z`, d, type: 'call', mode: 'practice', c, hit, side: 'yes', points: 0, q: `q${seq}`, ...extra }; };
const at = (d, hhmm, fields) => { seq += 1; return { id: `e${String(seq).padStart(6, '0')}`, t: `${d}T${hhmm}:00.000Z`, d, ...fields }; };
const predictions = (events, today) => R.predictionsOf(events, today);
const evalAt = (events, today) => LE.evaluate(events, { today, cfg, predictions: predictions(events, today) });
// Apply what evaluate says, the way the app does: each result becomes a flag event written at `hhmm` of `today`.
function apply(events, today, hhmm = '21:00') {
  const { append } = evalAt(events, today);
  const made = append.map((f) => at(today, hhmm, { ...f }));
  events.push(...made);
  return made;
}
// n calls on a day at confidence c, `hits` of them right (the first ones)
const batch = (d, n, c, hits, extra) => Array.from({ length: n }, (_, i) => call(d, c, i < hits, extra));
// A repeating mix of calls: spec = [{ c, pattern: '1110111011' }], one cycle after another, so every group's rate is exact.
function cycles(d, count, spec) {
  const out = [], idx = spec.map(() => 0);
  for (let k = 0; k < count; k++) spec.forEach((g, gi) => { for (let j = 0; j < g.n; j++) { out.push(call(d, g.c, g.pattern[idx[gi]++ % g.pattern.length] === '1')); } });
  return out;
}
const flagState = (events, trigger) => LE.flagsOf(events, cfg).filter((c) => c.trigger === trigger).map((c) => c.state);
const day = (start, k) => R.addDays(start, k);
const D0 = '2026-09-01';

// ===================================================================================================================
test('the lesson settings in data/scoring.json agree with data/lesson_triggers.csv (sample sizes) and every trigger has a drill', () => {
  const rows = new Map(readCsv('lesson_triggers.csv').map((r) => [r.id, r]));
  for (const [id, t] of Object.entries(L.triggers)) {
    assert.ok(rows.has(id), `${id} in lesson_triggers.csv`);
    assert.equal(Number(rows.get(id).min_sample), t.window ?? t.window_days, `${id}: the sample size in the table is the window in the settings`);
    assert.ok(t.drill || id === 'L15', `${id} has a drill`);
  }
  assert.ok(L.max_new_per_day === 1 && L.max_in_repair === 2 && L.escalate_after_fires === 3);
  assert.deepEqual(L.retest_after_days, [3, 10]);
});

test('the walk: the app and the independent reference agree on every flag, for every kind of player', () => {
  const players = [
    ['lesson_player("calibrated", seed=10, days=60)', '2026-10-30', 'calibrated'],
    ['lesson_player("over_fixed", seed=10, days=60)', '2026-10-30', 'over, then fixed after the drill'],
    ['lesson_player("over_stuck", seed=10, days=60)', '2026-10-30', 'over and stays over'],
    ['lesson_player("under", seed=10, days=60)', '2026-10-30', 'under'],
    ['lesson_player("fence", seed=10, days=60)', '2026-10-30', 'fence'],
    ['lesson_player("busy", seed=12, days=60)', '2026-10-30', 'three patterns at once'],
    ['soft_player(seed=5, days=40)', '2026-10-10', 'vague claims'],
    ['missed_player(seed=10)', '2026-10-15', 'missed days'],
  ];
  const seen = {};
  for (const [builder, last, label] of players) {
    const r = scenario(builder, last);
    sameTimeline(r.out, r.ref, label);
    seen[label] = summary(r.out);
  }
  // What each player's story is, so the agreement above is about the right thing and not two empty lists.
  assert.deepEqual(seen.calibrated, [], 'a calibrated player is not flagged');
  assert.deepEqual(seen['over, then fixed after the drill'], ['1:L01:open', '1:L01:retest1+', '1:L01:retest2+'], 'flagged, drilled, passes both re-tests, cleared');
  assert.deepEqual(seen['over and stays over'], ['1:L01:open', '1:L01:retest1-', '1:L01:retest1-'], 'fails the re-test twice: three fires in all, and the third goes to the review');
  assert.deepEqual(seen.under.slice(0, 1), ['1:L02:open']);
  assert.deepEqual(seen.fence.slice(0, 1), ['1:L03:open']);
  assert.deepEqual(seen['vague claims'], ['1:L04:open', '1:L04:retest1+', '1:L04:retest2+']);
  assert.deepEqual(seen['missed days'], ['1:L15:open', '1:L15:cleared', '2:L15:open', '2:L15:cleared']);
  // Three patterns at once: the strongest first, the next one on another day, and the third waits for a place in repair.
  const busy = scenario('lesson_player("busy", seed=12, days=60)', '2026-10-30').out;
  const opens = busy.filter((x) => x.state === 'open');
  assert.deepEqual(opens.map((x) => x.trigger), ['L01', 'L02', 'L03'], 'strongest standardized gap first');
  assert.ok(opens[0].day < opens[1].day && opens[1].day < opens[2].day, 'at most one new pattern lesson a day');
  const escalatedBeforeThird = busy.filter((x) => x.state === 'retest' && !x.passed && x.day === opens[2].day && x.at === opens[2].at);
  assert.ok(escalatedBeforeThird.length >= 1, 'the third pattern opened in the very look where one of the two in repair went to the review');
});

test('missed days: it opens when the player has missed two of the last seven, a day under the minimum breaks the run, five good days in a row clear it', () => {
  const r = scenario('missed_player(seed=10)', '2026-10-15');
  const rows = r.out.filter((x) => x.trigger === 'L15');
  // The player misses 09-11, 09-12 and 09-13, is back on 09-14 with the minimum (5 calls and a card) every day except 09-16 (4 calls).
  assert.deepEqual(rows.slice(0, 2).map((x) => [x.state, x.day, x.at]), [['open', '2026-09-13', '07'], ['cleared', '2026-09-21', '21']],
    'opens on the morning of the third missed day; 09-14 and 09-15 are good, 09-16 has 4 calls so the run restarts, and 09-17 to 09-21 are five good days');
  // They miss 10-01 and 10-02 later: a second chain opens on the morning of 10-03 and clears after five more good days (10-03 to 10-07).
  assert.deepEqual(rows.slice(2).map((x) => [x.state, x.day, x.at]), [['open', '2026-10-03', '07'], ['cleared', '2026-10-07', '21']]);
});

// ---- the flag lifecycle, by hand -----------------------------------------------------------------------------------
// A top-band overconfident window opens L01; every step after that is a flag event, and the state is a fold of them.
function openedL01() {
  const events = [...batch(D0, 40, 0.95, 28)];                 // said 95%, right 70%: 25 points too sure
  const made = apply(events, D0);                              // the flag opens at 21:00
  assert.deepEqual(made.map((e) => [e.state, e.trigger]), [['open', 'L01']]);
  const flag = made[0];
  events.push(at(D0, '21:30', { type: 'flag', state: 'lesson', flag: flag.id }), at(D0, '21:31', { type: 'flag', state: 'drill', flag: flag.id, session: 's-drill' }));
  return { events, flag };
}

test('lifecycle: open, lesson, drill, re-test 1 only from the third day, re-test 2 only from the tenth, then cleared', () => {
  const { events, flag } = openedL01();
  assert.deepEqual(flagState(events, 'L01'), ['drill']);
  // Perfectly calibrated top-band calls on day 1 and day 2 are before the third day: they cannot be the re-test.
  events.push(...batch(day(D0, 1), 40, 0.95, 38));
  assert.deepEqual(evalAt(events, day(D0, 2)).append, [], 'day 2: too early');
  events.push(...batch(day(D0, 2), 40, 0.95, 38));
  assert.deepEqual(evalAt(events, day(D0, 2)).append, [], 'still day 2');
  assert.deepEqual(evalAt(events, day(D0, 3)).append, [], 'day 3, but the calls so far were made on days 1 and 2 and do not count');
  events.push(...batch(day(D0, 3), 39, 0.95, 37));
  assert.deepEqual(evalAt(events, day(D0, 3)).append, [], '39 calls on day 3 are not enough: the re-test needs 40');
  events.push(...batch(day(D0, 3), 1, 0.95, 1));
  const r1 = apply(events, day(D0, 3));
  assert.deepEqual(r1.map((e) => [e.state, e.step, e.pass]), [['retest', 1, true]]);
  assert.equal(r1[0].flag, flag.id);
  assert.deepEqual(flagState(events, 'L01'), ['retest2']);
  // Re-test 2: the next 40 top-band calls made from the tenth day after the drill, and after re-test 1.
  events.push(...batch(day(D0, 5), 40, 0.95, 38));
  assert.deepEqual(evalAt(events, day(D0, 9)).append, [], 'calls on day 5 are before the tenth day');
  events.push(...batch(day(D0, 10), 40, 0.95, 36));
  const r2 = apply(events, day(D0, 10));
  assert.deepEqual(r2.map((e) => [e.state, e.step, e.pass]), [['retest', 2, true]]);
  assert.deepEqual(flagState(events, 'L01'), ['cleared']);
  assert.equal(LE.flagsOf(events, cfg)[0].clearedDay, day(D0, 10));
});

test('lifecycle: a failed re-test reopens the flag with one more fire, and the third fire goes to the review for good', () => {
  const { events, flag } = openedL01();
  events.push(...batch(day(D0, 3), 40, 0.95, 30));              // still 20 points too sure
  const f1 = apply(events, day(D0, 3));
  assert.deepEqual(f1.map((e) => [e.state, e.step, e.pass]), [['retest', 1, false]]);
  let chain = LE.flagsOf(events, cfg)[0];
  assert.equal(chain.state, 'open'); assert.equal(chain.fires, 2); assert.equal(chain.lesson, null); assert.equal(chain.drill, null);
  assert.deepEqual(evalAt(events, day(D0, 3)).append, [], 'nothing more to do until the lesson and drill are done again');
  events.push(at(day(D0, 3), '21:30', { type: 'flag', state: 'lesson', flag: flag.id }), at(day(D0, 3), '21:31', { type: 'flag', state: 'drill', flag: flag.id, session: 's-drill-2' }));
  events.push(...batch(day(D0, 6), 40, 0.95, 31));
  const f2 = apply(events, day(D0, 6));
  assert.deepEqual(f2.map((e) => [e.state, e.step, e.pass]), [['retest', 1, false]]);
  chain = LE.flagsOf(events, cfg)[0];
  assert.equal(chain.state, 'escalated'); assert.equal(chain.fires, 3);
  assert.equal(LE.ACTIVE.has(chain.state), false, 'an escalated flag is out of repair');
  events.push(...batch(day(D0, 8), 80, 0.95, 40));
  assert.deepEqual(evalAt(events, day(D0, 9)).append, [], 'an escalated trigger does not open a second chain beside the first: it waits for the weekly review');
});

test('lifecycle: once cleared, only calls made afterwards can fire the same trigger again', () => {
  const { events } = openedL01();
  events.push(...batch(day(D0, 3), 40, 0.95, 38));
  apply(events, day(D0, 3));
  events.push(...batch(day(D0, 10), 40, 0.95, 38));
  apply(events, day(D0, 10));
  assert.deepEqual(flagState(events, 'L01'), ['cleared']);
  assert.deepEqual(evalAt(events, day(D0, 11)).append, [], 'the old overconfident window must not fire it a second time');
  events.push(...batch(day(D0, 12), 39, 0.95, 20));
  assert.deepEqual(evalAt(events, day(D0, 12)).append, [], '39 new calls are not a window yet');
  events.push(...batch(day(D0, 12), 1, 0.95, 0));
  const again = apply(events, day(D0, 12));
  assert.deepEqual(again.map((e) => [e.state, e.trigger, e.chain]), [['open', 'L01', 2]], 'a fresh window of 40 that is overconfident opens a second chain');
});

test('triggers read natural calls only: a drill never counts, an exam call does, a baseline call does', () => {
  const drill = batch(D0, 40, 0.95, 0, { mode: 'drill' });
  assert.deepEqual(evalAt(drill, D0).append, [], '40 awful drill calls fire nothing');
  assert.equal(LE.naturalCalls(drill, cfg).length, 0);
  for (const mode of ['exam', 'baseline', 'practice']) assert.equal(evalAt(batch(D0, 40, 0.95, 20, { mode }), D0).append.length, 1, `${mode} calls count`);
});

test('triggers: the edges. 10 points exactly fires L01, 9.9 does not; the band is 90 to 99 only; L04 needs three rejections in the last ten', () => {
  const l01 = (hits, c = 0.9) => evalAt(batch(D0, 40, c, hits), D0).append.filter((f) => f.trigger === 'L01').length;
  assert.equal(l01(32), 1, '90% said, 80% right: exactly 10 points');
  assert.equal(l01(33), 0, '90% said, 82.5% right: 7.5 points');
  assert.equal(evalAt(batch(D0, 40, 0.85, 20), D0).append.filter((f) => f.trigger === 'L01').length, 0, '85% is not the top band');
  const soft = (n) => Array.from({ length: 10 }, (_, i) => at(day(D0, i), '09:00', { type: 'prediction', text: 'x', c: 0.6, b: 0.5, scored: true, due: day(D0, i + 7), flags: i < n ? ['no_date'] : [], flagged: i < n }));
  const l04 = (n) => LE.evaluate(soft(n), { today: day(D0, 10), cfg, predictions: predictions(soft(n), day(D0, 10)) }).append.filter((f) => f.trigger === 'L04').length;
  assert.deepEqual([l04(2), l04(3)], [0, 1]);
  // a prediction the player fixed while writing (flagged ever, clean at lock) is rejected too
  const fixed = soft(0).map((p, i) => (i < 3 ? { ...p, flagged: true } : p));
  assert.equal(LE.evaluate(fixed, { today: day(D0, 10), cfg, predictions: predictions(fixed, day(D0, 10)) }).append.length, 1);
});

test('limits: one new pattern a day, two in repair, missed days outside both; the queue goes by standardized gap', () => {
  // 3 top-band calls (70% right), 3 mid-band (90% right) and 4 at 50% (80% right) in every cycle: L01, L02 and L03 all qualify.
  const events = cycles(D0, 30, [{ c: 0.95, n: 3, pattern: '1110111011' }, { c: 0.7, n: 3, pattern: '1111111110' }, { c: 0.5, n: 4, pattern: '11101' }]);
  const seen = LE.TRIGGERS.L01.fire({ calls: LE.naturalCalls(events, cfg), t: L.triggers.L01 }, '');
  assert.ok(seen, 'the fixture really does qualify for L01');
  const first = apply(events, D0);
  assert.deepEqual(first.map((e) => e.trigger), ['L01'], 'only the strongest opens today');
  assert.deepEqual(evalAt(events, D0).append, [], 'and nothing else opens the same day');
  const second = apply(events, day(D0, 1));
  assert.deepEqual(second.map((e) => e.trigger), ['L02']);
  assert.deepEqual(evalAt(events, day(D0, 2)).append, [], 'two are in repair: the third waits');
  assert.deepEqual(evalAt(events, day(D0, 9)).append, [], 'and keeps waiting');
  // The first one is cleared: the third takes its place on the next look.
  events.push(at(day(D0, 9), '21:00', { type: 'flag', state: 'cleared', flag: first[0].id }));
  assert.deepEqual(evalAt(events, day(D0, 9)).append.map((e) => e.trigger), ['L03']);
  // Missed days is outside both limits: it opens even with two pattern flags in repair and a pattern already opened today.
  const busy = cycles(D0, 30, [{ c: 0.95, n: 3, pattern: '1110111011' }, { c: 0.7, n: 3, pattern: '1111111110' }, { c: 0.5, n: 4, pattern: '11101' }]);
  const a = apply(busy, D0), b = apply(busy, day(D0, 1));
  assert.equal(a.length + b.length, 2);
  const late = evalAt(busy, day(D0, 14)).append;
  assert.deepEqual(late.map((e) => e.trigger), ['L15'], 'missed days opens although two patterns are in repair, and the third pattern still waits');
});

test('missed days is a habit flag: no lesson, no drill, and a day with calls but no card does not count toward the run', () => {
  const play = (d, n, withCard) => [...batch(d, n, 0.7, 5), ...(withCard ? [at(d, '09:00', { type: 'prediction', text: 'x', c: 0.6, b: 0.5, scored: true, due: d, flags: [], flagged: false })] : [])];
  const events = [...play(D0, 6, true), ...play(day(D0, 1), 6, true)];
  const open = apply(events, day(D0, 4), '07:00');
  assert.deepEqual(open.map((e) => [e.state, e.trigger]), [['open', 'L15']], 'two days missed');
  const chain = LE.flagsOf(events, cfg)[0];
  assert.equal(chain.state, 'open'); assert.equal(chain.fires, 1);
  assert.equal(LE.waitingFor(chain, cfg), null, 'there is nothing to re-test');
  for (let k = 4; k < 9; k++) events.push(...play(day(D0, k), 5, k !== 6));   // day 6 has the calls and no card
  assert.deepEqual(evalAt(events, day(D0, 8)).append, [], '4..8 would be five days, but day 6 has no prediction: the run restarts');
  for (let k = 9; k < 12; k++) events.push(...play(day(D0, k), 5, true));
  assert.deepEqual(evalAt(events, day(D0, 10)).append, [], 'days 7 to 10 are four good days');
  assert.deepEqual(evalAt(events, day(D0, 11)).append.map((e) => [e.state]), [['cleared']], 'days 7 to 11 are five');
});

test('evaluate is idempotent: applying its answer and asking again at the same moment appends nothing', () => {
  for (const builder of ['lesson_player("busy", seed=12, days=60)', 'missed_player(seed=10)', 'soft_player(seed=5, days=40)']) {
    const log = withDir((dir) => { const f = path.join(dir, 'r.jsonl'); py(`import synth\nsynth.${builder}.write(sys.argv[1])`, [f]); return readEvents(f); });
    const days = [...new Set(log.map((e) => e.d))];
    const half = [];
    for (const e of log) {
      half.push(e);
      if (days.indexOf(e.d) % 7 === 3) {
        const made = apply(half, e.d);
        assert.deepEqual(evalAt(half, e.d).append, [], `${builder} ${e.d}: second look`);
        void made;
      }
    }
  }
});

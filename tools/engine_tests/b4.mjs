// Block 4, the Lesson Engine: pattern triggers, the flag lifecycle, the Unit 1 exam gate, the autopsy queue, the instant note,
// the 90-day rule and the exam pool. The decisive tests compare the app with tools/ref_lessons.py, an independent
// recomputation, on synthetic players from tools/synth.py (same events, two implementations), and compare the rates at
// which the triggers and the gate fire with the ones the simulations in sim/ published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { cfg, S, ROOT, py, near } from './common.mjs';
import { withDir, readEvents, walkJS, sameTimeline, scenario, summary } from './walk.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';
import * as G from '../../app/js/engine/gate.js';
import { ledger } from '../../app/js/engine/progress.js';
import { planBaseline, pickNext, seeded, availablePool } from '../../app/js/engine/draw.js';

const L = cfg.lessons;
const readCsv = (name) => JSON.parse(py(`import csv\nprint(json.dumps(list(csv.DictReader(open(${JSON.stringify(path.join(ROOT, 'data', name))}, encoding='utf-8')))))`));

// ---- hand-built events ---------------------------------------------------------------------------------------------
let seq = 0;
const stamp = () => `${String(Math.floor(seq / 60) % 24).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}`;
const call = (d, c, hit, extra = {}) => { seq += 1; return { id: `c${String(seq).padStart(6, '0')}`, t: `${d}T08:${String(seq % 60).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}.${String(seq % 1000).padStart(3, '0')}Z`, d, type: 'call', mode: 'practice', c, hit, side: 'yes', points: 0, q: `q${seq}`, ...extra }; };
const at = (d, hhmm, fields) => { seq += 1; return { id: `e${String(seq).padStart(6, '0')}`, t: `${d}T${hhmm}:00.000Z`, d, ...fields }; };
const predictions = (events, today) => R.predictionsOf(events, today);
const evalAll = (events, today) => LE.evaluate(events, { today, cfg, predictions: predictions(events, today) });
// The pattern lessons only. The hand-built records below skip days on purpose to keep them short, and a skipped day is missed
// days' (L15) business, which the tests on missed days and the limits cover on their own.
const evalAt = (events, today) => ({ append: evalAll(events, today).append.filter((f) => f.trigger !== 'L15') });
// Apply what evaluate says, the way the app does: each result becomes a flag event written at `hhmm` of `today`.
const applyWith = (look) => (events, today, hhmm = '21:00') => {
  const made = look(events, today).append.map((f) => at(today, hhmm, { ...f }));
  events.push(...made);
  return made;
};
const apply = applyWith(evalAt), applyAll = applyWith(evalAll);
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
    ['lesson_player("busy", seed=12, days=60)', '2026-10-30', 'three patterns, the third late'],
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
  // Three patterns: two from the start and a third from the third week. The third qualifies while two are in repair, waits, and
  // opens when a place is free. (The order by standardized gap is checked on a hand-built record in the limits test.)
  const busy = scenario('lesson_player("busy", seed=12, days=60)', '2026-10-30');
  const opens = busy.out.filter((x) => x.state === 'open');
  assert.deepEqual(opens.map((x) => x.trigger).sort(), ['L01', 'L02', 'L03']);
  assert.equal(new Set(opens.map((x) => x.day)).size, 3, 'at most one new pattern lesson a day');
  const inRepair = (list) => LE.flagsOf(list, cfg).filter((c) => c.trigger !== 'L15' && LE.ACTIVE.has(c.state)).length;
  const third = busy.log.find((e) => e.type === 'flag' && e.state === 'open' && e.trigger === 'L03');
  const qualifiedDay = [...new Set(busy.events.map((e) => e.d))].sort()
    .find((d) => LE.TRIGGERS.L03.fire({ calls: LE.naturalCalls(busy.events.filter((e) => e.d <= d), cfg), t: L.triggers.L03 }, ''));
  assert.ok(qualifiedDay && qualifiedDay < third.d, `the fence qualified on ${qualifiedDay} and opened on ${third.d}: it waited`);
  assert.equal(inRepair(busy.log.filter((e) => e.d <= qualifiedDay)), 2, 'two patterns were in repair when it qualified');
  assert.ok(inRepair(busy.log.slice(0, busy.log.indexOf(third))) <= 1, 'it opened once a place was free');
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
  const late = evalAll(busy, day(D0, 14)).append;
  assert.deepEqual(late.map((e) => e.trigger), ['L15'], 'missed days opens although two patterns are in repair, and the third pattern still waits');
});

test('missed days is a habit flag: no lesson, no drill, and a day with calls but no card does not count toward the run', () => {
  const play = (d, n, withCard) => [...batch(d, n, 0.7, 5), ...(withCard ? [at(d, '09:00', { type: 'prediction', text: 'x', c: 0.6, b: 0.5, scored: true, due: d, flags: [], flagged: false })] : [])];
  const events = [...play(D0, 6, true), ...play(day(D0, 1), 6, true)];
  const open = applyAll(events, day(D0, 4), '07:00');
  assert.deepEqual(open.map((e) => [e.state, e.trigger]), [['open', 'L15']], 'two days missed');
  const chain = LE.flagsOf(events, cfg)[0];
  assert.equal(chain.state, 'open'); assert.equal(chain.fires, 1);
  assert.equal(LE.waitingFor(chain, cfg), null, 'there is nothing to re-test');
  for (let k = 4; k < 9; k++) events.push(...play(day(D0, k), 5, k !== 6));   // day 6 has the calls and no card
  assert.deepEqual(evalAll(events, day(D0, 8)).append, [], '4..8 would be five days, but day 6 has no prediction: the run restarts');
  for (let k = 9; k < 12; k++) events.push(...play(day(D0, k), 5, true));
  assert.deepEqual(evalAll(events, day(D0, 10)).append, [], 'days 7 to 10 are four good days');
  assert.deepEqual(evalAll(events, day(D0, 11)).append.map((e) => [e.state]), [['cleared']], 'days 7 to 11 are five');
});

test('evaluate is idempotent: applying its answer and asking again at the same moment appends nothing', () => {
  for (const builder of ['lesson_player("busy", seed=12, days=60)', 'missed_player(seed=10)', 'soft_player(seed=5, days=40)']) {
    const log = withDir((dir) => { const f = path.join(dir, 'r.jsonl'); py(`import synth\nsynth.${builder}.write(sys.argv[1])`, [f]); return readEvents(f); });
    const days = [...new Set(log.map((e) => e.d))];
    const half = [];
    for (const e of log) {
      half.push(e);
      if (days.indexOf(e.d) % 7 === 3) {
        const made = applyAll(half, e.d);
        assert.deepEqual(evalAll(half, e.d).append, [], `${builder} ${e.d}: second look`);
        void made;
      }
    }
  }
});

// ---- rates: the app against the published simulations ---------------------------------------------------------------
const published = JSON.parse(readFileSync(path.join(ROOT, 'sim', 'out', 'scoring_results.json'), 'utf8'));
const mc = (code) => JSON.parse(py(`import synth\nprint(json.dumps(${code}))`));
const asCalls = (run) => run.c.map((c, i) => ({ c, hit: run.h[i] === '1' }));
// (A median over only the few runs that fire falsely on an honest player is too noisy to compare, so it is read where 200 or more fire.)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

test('the L01 trigger fires at the published rates: rarely on an honest player, mostly on an overconfident one', () => {
  const t = L.triggers.L01;
  assert.deepEqual([t.window, t.gap], [40, 0.1], 'the sim published window 40, gap 10 points');
  for (const policy of ['honest', 'mild_overconfident', 'overconfident']) {
    const runs = mc(`synth.mc_band_runs(${JSON.stringify(policy)}, 0.9, 0.99, 500, 150, 41)`);
    const first = runs.map((run) => {
      const calls = asCalls(run).map((c, i) => ({ ...c, t: `2026-09-01T08:${String(i).padStart(5, '0')}`, d: '2026-09-01', mode: 'practice' }));
      for (let k = t.window; k <= 150; k++) if (LE.TRIGGERS.L01.fire({ calls: calls.slice(0, k), t }, '')) return k;
      return null;
    });
    const fired = first.filter((x) => x !== null);
    const want = published.D_trigger[policy].W40_gap10;
    const rate = fired.length / runs.length;
    assert.ok(Math.abs(rate - want.fires_within_150) < 0.065, `${policy}: fires within 150 calls in ${(rate * 100).toFixed(1)}% of runs, published ${(want.fires_within_150 * 100).toFixed(1)}%`);
    if (fired.length >= 200) assert.ok(Math.abs(median(fired) - want.median_calls_to_fire) <= 8, `${policy}: median ${median(fired)} calls, published ${want.median_calls_to_fire}`);
  }
});

test('the Unit 1 gate: the app and the independent reference agree on every verdict, and pass the published share of each kind of player', () => {
  const edges = cfg.mirror.band_edges;
  const dir = withDir((d) => d);
  for (const [policy, runs] of [['honest', 600], ['mild_overconfident', 400], ['overconfident', 300], ['underconfident', 300], ['always_99', 100], ['round_to_10', 400]]) {
    const players = mc(`synth.mc_gate_players(${JSON.stringify(policy)}, ${runs}, 200, 17)`);
    const ref = withDir((d) => { const f = path.join(d, 'players.json'); writeFileSync(f, JSON.stringify(players)); return JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_lessons.py'), 'gate', f], { encoding: 'utf-8', maxBuffer: 1 << 28 })); });
    let passes = 0;
    players.forEach((run, i) => {
      const mine = G.gateU1(asCalls(run), cfg.gates, edges), r = ref[i];
      assert.equal(mine.pass, r.pass, `${policy} #${i}: verdict`);
      assert.deepEqual(mine.reasons, r.reasons, `${policy} #${i}: reasons`);
      near(mine.index, r.index, `${policy} #${i}: index`);
      mine.bands.forEach((b, j) => { assert.equal(b.n, r.bands[j].n); assert.equal(b.checked, r.bands[j].checked); assert.equal(b.off, r.bands[j].off); near(b.z, r.bands[j].z, `${policy} #${i} band ${j}: z`); });
      if (mine.pass) passes++;
    });
    const want = published.D.composite_gate[policy]['200']['2.5'], got = passes / runs;
    assert.ok(Math.abs(got - want) < 0.08, `${policy}: passes ${(got * 100).toFixed(1)}%, published ${(want * 100).toFixed(1)}%`);
  }
  void dir;
});

test('the gate on hand-built exams: what passes, what fails and why, and the band to repair', () => {
  const exam = (spec) => spec.flatMap(([c, n, hits]) => Array.from({ length: n }, (_, i) => ({ c, hit: i < hits })));
  const edges = cfg.mirror.band_edges;
  const calibrated = G.gateU1(exam([[0.55, 40, 22], [0.65, 40, 26], [0.75, 40, 30], [0.85, 40, 34], [0.95, 40, 38]]), cfg.gates, edges);
  assert.equal(calibrated.pass, true); assert.deepEqual(calibrated.reasons, []);
  const sure = G.gateU1(exam([[0.55, 40, 22], [0.65, 40, 26], [0.75, 40, 30], [0.85, 40, 34], [0.95, 40, 28]]), cfg.gates, edges);
  assert.equal(sure.pass, false);
  assert.deepEqual(sure.reasons, ['band:0.9'], 'the index is 5 points exactly (allowed); the top band is 25 points too sure');
  assert.deepEqual(sure.worst, { lo: 0.9, hi: 1, dir: 'too sure' });
  const shy = G.gateU1(exam([[0.55, 40, 30], [0.65, 40, 36], [0.75, 40, 37], [0.85, 40, 38], [0.95, 40, 40]]), cfg.gates, edges);
  assert.ok(shy.reasons.includes('index') || shy.reasons.some((r) => r.startsWith('band')), 'too shy fails as well');
  assert.equal(shy.worst.dir, 'too shy');
  // A band of fewer than band_min_items calls is never checked on its own: 14 wild calls in one band do not fail an honest exam.
  const thin = G.gateU1(exam([[0.65, 93, 61], [0.75, 93, 70], [0.95, 14, 4]]), cfg.gates, edges);
  assert.equal(thin.bands.find((b) => b.lo === 0.9).checked, false);
  assert.ok(!thin.reasons.some((r) => r === 'band:0.9'));
  assert.equal(G.gateU1([], cfg.gates, edges).pass, false, 'an exam with no calls passes nothing');
  // 5 points exactly is inside the index tolerance; 5.5 is outside.
  assert.equal(G.gateU1(exam([[0.75, 200, 140]]), cfg.gates, edges).reasons.includes('index'), false, '75 said, 70 right');
  assert.equal(G.gateU1(exam([[0.75, 200, 139]]), cfg.gates, edges).reasons.includes('index'), true, '75 said, 69.5 right');
});

test('where the player stands on the gate: eligible, running, failed (repair first), passed, and rust', () => {
  const units = { practiceCalls: 90, practiceRequired: 90, baselineDone: true };
  const st = (events, extra = {}) => G.gateStatus(events, cfg, { ...units, ...extra });
  assert.equal(st([]).eligible, true);
  assert.equal(st([], { baselineDone: false }).eligible, false, 'the baseline comes first');
  assert.equal(st([], { practiceCalls: 89 }).eligible, false, 'and 90 practice calls');
  const events = [];
  events.push(at(D0, '09:00', { type: 'exam', state: 'start', unit: 'U1', n: 200 }));
  const a1 = events[0];
  events.push(...Array.from({ length: 20 }, (_, i) => ({ ...call(D0, 0.7, true, { mode: 'exam' }), exam: a1.id })));
  let s = st(events);
  assert.equal(s.running.id, a1.id); assert.equal(s.done, 20); assert.equal(s.eligible, false);
  assert.equal(G.examSittingSize(s, cfg.gym), 20); assert.equal(G.examSittingSize({ ...s, done: 190 }, cfg.gym), 10, 'the last sitting is the rest');
  events.push(at(D0, '10:00', { type: 'exam', state: 'result', exam: a1.id, pass: false }));
  s = st(events);
  assert.equal(s.needsRepair, true); assert.equal(s.eligible, false); assert.equal(s.running, null);
  events.push(at(D0, '11:00', { type: 'exam', state: 'repair', exam: a1.id }));
  s = st(events);
  assert.equal(s.needsRepair, false); assert.equal(s.eligible, true, 'after the repair drill a new exam may start');
  events.push(at(day(D0, 1), '09:00', { type: 'exam', state: 'start', unit: 'U1', n: 200 }));
  const a2 = events[events.length - 1];
  events.push(at(day(D0, 1), '10:00', { type: 'exam', state: 'result', exam: a2.id, pass: true }));
  s = st(events);
  assert.equal(s.passed, true); assert.equal(s.eligible, false); assert.equal(s.rust, null);
  // Rust: a trigger of the unit fires on later practice calls and is in repair until cleared.
  const flag = at(day(D0, 20), '21:00', { type: 'flag', state: 'open', trigger: 'L01', fire: 1, evidence: {}, chain: 1 });
  events.push(flag);
  s = st(events);
  assert.equal(s.rust && s.rust.id, flag.id, 'L01 firing after the pass is rust');
  events.push(at(day(D0, 30), '21:00', { type: 'flag', state: 'cleared', flag: flag.id }));
  assert.equal(st(events).rust, null, 'cleared again: no rust');
  // A flag that opened before the pass is not rust.
  const old = [at(D0, '08:00', { type: 'flag', state: 'open', trigger: 'L02', fire: 1, evidence: {}, chain: 1 }), at(D0, '09:00', { type: 'exam', state: 'start', unit: 'U1', n: 200 })];
  old.push(at(D0, '10:00', { type: 'exam', state: 'result', exam: old[1].id, pass: true }));
  assert.equal(st(old).rust, null);
});

const withRecord = (builder, fn) => withDir((dir) => { const f = path.join(dir, 'r.jsonl'); py(`import synth\nsynth.${builder}.write(sys.argv[1])`, [f]); return fn(readEvents(f), f); });

test('the autopsy queue: the app and the independent reference list the same cards, in the order they resolved', () => {
  withRecord('autopsy_player()', (events, file) => {
    const preds = R.predictionsOf(events, '2026-10-30');
    const due = LE.autopsyDue(preds, events, cfg);
    const mine = due.needed.map((n) => ({ prediction: n.p.id, kind: n.kind, filed: due.done.has(n.p.id) }));
    const ref = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_lessons.py'), 'autopsies', file], { encoding: 'utf-8' }));
    assert.deepEqual(mine, ref);
    // And the story, worked out by hand from the spec in tools/synth.py: cards 0, 4 and 17 are misses at 85% or more (a forecast of
    // 10% is a call of 90% on No), 7, 16 and 22 are the 5th, 10th and 15th confident hits (85% counts, 84% does not; a void card, an
    // unscored card and a coin flip never count), and cards 0 and 4 already have their autopsy.
    const order = events.filter((e) => e.type === 'prediction').map((e) => e.id);
    assert.deepEqual(mine.map((x) => order.indexOf(x.prediction)), [0, 4, 7, 16, 17, 22]);
    assert.deepEqual(mine.map((x) => x.kind), ['miss', 'miss', 'hit_sample', 'hit_sample', 'miss', 'hit_sample']);
    assert.deepEqual(mine.map((x) => x.filed), [true, true, false, false, false, false]);
    assert.deepEqual(due.pending.map((x) => order.indexOf(x.p.id)), [7, 16, 17, 22], 'what still waits for the player');
    // An autopsy filed for a card takes it off the list.
    const filed = [...events, at('2026-10-29', '10:00', { type: 'autopsy', prediction: mine[3].prediction, kind: 'hit_sample', knew: 'x', missed: 'y', verdict: 'judgment', rule: 'z' })];
    assert.deepEqual(LE.autopsyDue(R.predictionsOf(filed, '2026-10-30'), filed, cfg).pending.map((x) => order.indexOf(x.p.id)), [7, 17, 22]);
    assert.ok(LE.needsAutopsy(preds[17], due) && !LE.needsAutopsy(preds[3], due));
  });
});

test('the rule card sits above the next five cards, and the re-checks fall due at 3 and 10 days', () => {
  const rule = at('2026-09-02', '10:00', { type: 'autopsy', prediction: 'p1', kind: 'miss', knew: 'a', missed: 'b', verdict: 'judgment', rule: 'Ask who decides first.' });
  const card = (d, hhmm = '11:00') => at(d, hhmm, { type: 'prediction', text: 'x', c: 0.6, b: 0.5, scored: true, due: d, flags: [], flagged: false });
  let events = [rule];
  assert.equal(LE.ruleCards(events, cfg).length, 1, 'shown at once, above the next card');
  events = [rule, ...[3, 4, 5, 6].map((k) => card(`2026-09-0${k}`))];
  assert.equal(LE.ruleCards(events, cfg).length, 1, 'four cards later it is still there');
  events.push(card('2026-09-07'));
  assert.equal(LE.ruleCards(events, cfg).length, 0, 'after the fifth card it goes');
  assert.equal(LE.ruleCards([rule, card('2026-09-01', '09:00')], cfg).length, 1, 'a card locked before the autopsy does not count');
  const due = (today, ev) => LE.rechecksDue(ev, today, cfg).map((r) => [r.step, r.dueDay]);
  assert.deepEqual(due('2026-09-04', [rule]), []);
  assert.deepEqual(due('2026-09-05', [rule]), [[1, '2026-09-05']]);
  assert.deepEqual(due('2026-09-20', [rule]), [[1, '2026-09-05'], [2, '2026-09-12']]);
  const first = at('2026-09-06', '09:00', { type: 'recheck', autopsy: rule.id, step: 1, used: 'yes' });
  assert.deepEqual(due('2026-09-20', [rule, first]), [[2, '2026-09-12']], 'answered once, never asked again');
  const noRule = at('2026-09-02', '10:00', { type: 'autopsy', prediction: 'p2', kind: 'miss', knew: 'a', missed: 'b', verdict: 'luck' });
  assert.deepEqual([LE.ruleCards([noRule], cfg).length, due('2026-09-30', [noRule]).length], [0, 0], 'no rule written, nothing to show or re-check');
});

test('the instant note: a miss at 80% or more, with the answer, why it tempted, and what a calibrated call looked like', () => {
  const q = { fact: 'It ended higher.', why: 'Rallies feel unstoppable.', base: 0.7, answer: true, n: 60 };
  const miss = (c) => ({ hit: false, c, mode: 'practice' });
  assert.equal(LE.instantNote({ hit: true, c: 0.95 }, q, [], S, cfg), null, 'a hit gets no note');
  assert.equal(LE.instantNote(miss(0.75), q, [], S, cfg), null, 'a miss under 80% is expected');
  assert.equal(LE.instantNote(miss(0.8), q, [], S, cfg).answer, 'It ended higher.', 'exactly 80% gets one');
  const plain = LE.instantNote(miss(0.9), q, [], S, cfg);
  assert.deepEqual(plain.calibrated, { kind: 'plain', oneIn: 10 }, 'no history yet: "at 90% you expect to be wrong 1 time in 10"');
  assert.equal(LE.instantNote(miss(0.99), q, [], S, cfg).calibrated.oneIn, 100);
  assert.equal(plain.tempted, 'Rallies feel unstoppable.');
  const earlier = (n, hits, mode = 'practice', c = 0.9) => Array.from({ length: n }, (_, i) => ({ c, hit: i < hits, mode }));
  assert.deepEqual(LE.instantNote(miss(0.9), q, earlier(4, 4), S, cfg).calibrated.kind, 'plain', 'four calls are not a record');
  const own = LE.instantNote(miss(0.9), q, earlier(10, 7), S, cfg).calibrated;
  assert.deepEqual(own, { kind: 'own', n: 10, hitRate: 0.7, step: 0.7 }, 'from your own calls at 90% or more: right 7 in 10, so a calibrated call there is 70%');
  assert.equal(LE.instantNote(miss(0.9), q, [...earlier(4, 4), ...earlier(20, 0, 'drill')], S, cfg).calibrated.kind, 'plain', 'a drill call is not your own call');
  assert.equal(LE.instantNote(miss(0.9), q, earlier(10, 7, 'practice', 0.7), S, cfg).calibrated.kind, 'plain', 'calls stated lower do not count as calls at 90%');
  // luck or judgment, from the records: the outcome that beat you is rare (under 20% of cases like it) or it is not.
  assert.deepEqual(plain.luck, { kind: 'judgment', chance: 0.7, n: 60 }, 'it was true, and true 70% of the time');
  assert.equal(LE.instantNote(miss(0.9), { ...q, base: 0.1 }, [], S, cfg).luck.kind, 'luck', 'it was true and true 10% of the time');
  assert.equal(LE.instantNote(miss(0.9), { ...q, base: 0.1, answer: false }, [], S, cfg).luck.kind, 'judgment', 'it was false and false 90% of the time');
  assert.equal(LE.instantNote(miss(0.9), { ...q, base: 0.2 }, [], S, cfg).luck.kind, 'judgment', 'exactly 20% is not rare');
  const sourced = LE.instantNote(miss(0.9), { fact: 'f', why: '', base: null, answer: true, n: 0 }, [], S, cfg);
  assert.deepEqual(sourced.luck, { kind: 'judgment', chance: null, n: 0 }, 'a documented fact has no count of cases: nothing to blame luck on');
  assert.equal(sourced.tempted, null);
  // the same rule for a journal card, against its baseline
  assert.deepEqual([LE.cardOutcomeChance({ outcome: 'yes', b: 0.15 }), LE.cardOutcomeChance({ outcome: 'no', b: 0.15 }), LE.cardOutcomeChance({ outcome: 'void', b: 0.5 })], [0.15, 0.85, null]);
});

test('questions: practice never serves an exam question; a sitting is drawn up front in the exam mix, half true and half false, without repeats', () => {
  const read = (f) => JSON.parse(readFileSync(path.join(ROOT, 'app', 'content', 'questions', f), 'utf8')).questions;
  const starter = read('starter.json'), exam = read('exam-u1.json');
  const ids = new Set(starter.map((x) => x.id));
  assert.equal(exam.filter((x) => ids.has(x.id)).length, 0, 'no question is in both banks');
  assert.equal(new Set(exam.map((x) => x.claim)).size, exam.length);
  const used = new Set();
  const total = cfg.gates.calibration_exam_calls, size = cfg.gym.exam_session_size;
  for (let k = 0; k < total / size; k++) {
    const plan = planBaseline({ bank: exam, usedIds: used, size, spares: 0, mix: cfg.gym.exam_mix, rng: seeded(100 + k) });
    assert.equal(plan.length, size);
    const qs = plan.map((id) => exam.find((x) => x.id === id));
    assert.ok(qs.every((x) => !used.has(x.id)), `sitting ${k + 1}: nothing already sat`);
    assert.equal(qs.filter((x) => x.answer).length, size / 2, `sitting ${k + 1}: half true`);
    const by = (d) => qs.filter((x) => x.diff === d).length;
    assert.deepEqual([by('easy'), by('medium'), by('hard')], [1, 8, 11], `sitting ${k + 1}: the exam mix of ${JSON.stringify(cfg.gym.exam_mix)} on ${size} calls`);
    plan.forEach((id) => used.add(id));
  }
  assert.equal(used.size, total, 'ten sittings of 20 are 200 different questions');
  // A retake of 200 on a bank of 304 reuses 96: the ones sat longest ago come back first.
  const order = new Map([...used].map((id, i) => [id, i]));
  const again = availablePool(exam, used, new Set(), total, order);
  assert.equal(again.reused, true);
  assert.equal(again.pool.length, total);
  const back = again.pool.filter((x) => used.has(x.id));
  assert.equal(back.length, total - (exam.length - used.size));
  assert.deepEqual(back.map((x) => order.get(x.id)), [...back.map((x) => order.get(x.id))].sort((a, b) => a - b).slice(0, back.length));
  assert.ok(Math.max(...back.map((x) => order.get(x.id))) < back.length, 'the earliest-sat come back first');
});

test('the 90-day rule and the 70/30 split: nothing seen in the last 90 days returns; older questions make up the review share of the draws', () => {
  const bank = Array.from({ length: 120 }, (_, i) => ({ id: `q${i}`, answer: i % 2 === 0, diff: ['easy', 'medium', 'hard'][i % 3] }));
  const old = new Set(bank.slice(0, 40).map((x) => x.id));
  const draw = (recentIds, n, reviewShare) => { const rng = seeded(7); return Array.from({ length: n }, () => pickNext({ bank, usedIds: old, recentIds, cfg: cfg.gym, rng, reviewShare })); };
  const recent = new Set(bank.slice(0, 40).map((x) => x.id));
  assert.ok(draw(recent, 600, 0.3).every((q) => !recent.has(q.id)), 'answered 10 days ago: never again');
  const fromOld = draw(new Set(), 3000, 0.3).filter((q) => old.has(q.id)).length / 3000;
  assert.ok(Math.abs(fromOld - 0.3) < 0.03, `30% of draws from the review pool, got ${(fromOld * 100).toFixed(1)}%`);
  assert.equal(draw(new Set(), 600, 0).filter((q) => old.has(q.id)).length > 0, true, 'with no review share the old ones are just part of the pool');
  const onlyOld = Array.from({ length: 50 }, () => pickNext({ bank: bank.slice(0, 40), usedIds: old, recentIds: new Set(), cfg: cfg.gym, rng: seeded(1), reviewShare: 0.3 }));
  assert.ok(onlyOld.every((q) => q && old.has(q.id)), 'with nothing never seen, everything comes from the review pool');
  const R90 = R.recentQuestionIds([call('2026-06-01', 0.7, true, { q: 'qa' }), call('2026-09-01', 0.7, true, { q: 'qb' }), call('2026-09-30', 0.7, true, { q: 'qc' })], '2026-11-29', cfg.gym.reseen_days);
  assert.deepEqual([...R90].sort(), ['qb', 'qc'], '2026-06-01 is 181 days back; 09-01 is 89 days back and still counts as recent, 09-30 is 60');
});

test('a sealed exam: until the verdict is in, its calls are on file but nothing the player sees carries what they scored', () => {
  const start = at(D0, '09:00', { type: 'exam', state: 'start', unit: 'U1', n: 200 });
  const sat = Array.from({ length: 40 }, (_, i) => ({ ...call(D0, 0.95, i < 10, { mode: 'exam', q: `x${i}`, points: i < 10 ? 2 : -400 }), exam: start.id }));
  const mine = call(D0, 0.7, true, { points: 20 });
  const events = [start, ...sat, mine].sort(R.byTime);
  const habit = cfg.habit;
  assert.equal(R.callsOf(events).length, 1, 'only the practice call is visible');
  assert.equal(R.allCallsOf(events).length, 41);
  assert.equal(LE.naturalCalls(events, cfg).length, 1, 'a trigger cannot read a sealed call');
  assert.deepEqual(evalAt(events, D0).append, [], 'and a pattern flag cannot give the score away mid-exam');
  const led = ledger(events, D0, habit);
  assert.equal(led.rows[0].calls, 41, 'the day is played and its calls are counted');
  assert.equal(led.rows[0].callPoints, 20, 'but only the visible call pays');
  assert.equal(R.usedQuestionIds(events).size, 41, 'a sealed question is still used: it is never dealt twice');
  const judged = [...events, at(D0, '12:00', { type: 'exam', state: 'result', exam: start.id, pass: false })];
  assert.equal(R.callsOf(judged).length, 41, 'judged: the calls join the record');
  assert.equal(ledger(judged, D0, habit).rows[0].callPoints, 20 + 10 * 2 - 30 * 400);
  assert.equal(evalAt(judged, D0).append.filter((f) => f.trigger === 'L01').length, 1, 'and now they can fire a trigger: 25% right at 95%');
});

test('retest progress and the drills a flag and a failed exam ask for', () => {
  const { events, flag } = openedL01();
  const chain = () => LE.flagsOf(events, cfg)[0];
  const env = (today) => ({ cfg, predictions: predictions(events, today), today });
  assert.deepEqual(LE.retestProgress(chain(), events, env(D0)), { step: 1, readyDay: day(D0, 3), need: 40, have: 0, ready: false });
  events.push(...batch(day(D0, 3), 25, 0.95, 24), ...batch(day(D0, 3), 5, 0.5, 3), ...batch(day(D0, 2), 9, 0.95, 9));
  assert.deepEqual(LE.retestProgress(chain(), events, env(day(D0, 3))), { step: 1, readyDay: day(D0, 3), need: 40, have: 25, ready: true }, 'only top-band calls from the third day count');
  assert.equal(LE.retestProgress({ ...chain(), state: 'cleared' }, events, env(D0)), null);
  assert.deepEqual(LE.drillOf('L01', cfg), { kind: 'wheel', calls: 15 });
  assert.deepEqual(LE.drillOf('L02', cfg).steps, [0.5, 0.8, 0.85, 0.9, 0.95, 0.99]);
  assert.deepEqual([LE.drillOf('L03', cfg).min, LE.drillOf('L04', cfg).items, LE.drillOf('L15', cfg)], [0.6, 5, null]);
  assert.equal(flag.trigger, 'L01');
  const sure = G.repairDrillOf({ lo: 0.9, hi: 1, dir: 'too sure' }, cfg), shy = G.repairDrillOf({ lo: 0.6, hi: 0.7, dir: 'too shy' }, cfg);
  assert.deepEqual([sure.kind, sure.calls, shy.kind, shy.calls], ['wheel', 20, 'forced', 20]);
  assert.deepEqual(shy.steps, [0.5, 0.8, 0.85, 0.9, 0.95, 0.99]);
  assert.equal(G.repairDrillOf(null, cfg).kind, 'wheel');
});

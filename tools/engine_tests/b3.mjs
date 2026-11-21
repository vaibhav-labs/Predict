// Block 3, the Mirror: error bars, the bias map, the journal-only record, streak, habit points, level and the seven-day
// score. The decisive test compares every number with tools/ref_mirror.py, an independent recomputation from the raw log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cfg, S, table, synthetic, near, py } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as J from '../../app/js/engine/journal.js';
import * as ST from '../../app/js/engine/stats.js';
import * as P from '../../app/js/engine/progress.js';

const opts = { z: cfg.mirror.error_bar_z, thinBelow: cfg.mirror.thin_below };

test('Wilson interval: textbook values, always inside 0 to 1, narrower with more calls', () => {
  const near4 = (a, b) => assert.ok(Math.abs(a - b) < 5e-5, `${a} vs ${b}`);
  let w = ST.wilson(8, 10, 1.96); near4(w.lo, 0.4902); near4(w.hi, 0.9433);
  w = ST.wilson(0, 10, 1.96); assert.equal(w.lo, 0); near4(w.hi, 0.2775);
  w = ST.wilson(10, 10, 1.96); near4(w.lo, 0.7225); assert.equal(w.hi, 1);
  assert.deepEqual(ST.wilson(0, 0, 1.96), { lo: null, hi: null });
  const small = ST.wilson(7, 10, 1.96), large = ST.wilson(70, 100, 1.96);
  assert.ok(large.hi - large.lo < small.hi - small.lo);
  for (let n = 1; n <= 40; n++) for (let k = 0; k <= n; k++) { const x = ST.wilson(k, n, 1.96); assert.ok(x.lo >= 0 && x.hi <= 1 && x.lo <= k / n + 1e-12 && x.hi >= k / n - 1e-12, `${k}/${n}`); }
});

test('a group never claims a bias its sample cannot support', () => {
  const mk = (n, hits, c) => Array.from({ length: n }, (_, i) => ({ c, hit: i < hits, points: 0 }));
  assert.equal(ST.describeGroup('x', mk(9, 1, 0.9), opts).verdict, 'too few');                 // under thin_below, however bad
  assert.equal(ST.describeGroup('x', mk(40, 24, 0.9), opts).verdict, 'too sure');              // 90% said, 60% right
  assert.equal(ST.describeGroup('x', mk(40, 38, 0.6), opts).verdict, 'too shy');               // 60% said, 95% right
  assert.equal(ST.describeGroup('x', mk(20, 15, 0.8), opts).verdict, 'no clear bias');         // 80% said, 75% right, n=20: could be honest
  assert.equal(ST.describeGroup('x', [], opts).n, 0);
});

test('levels: cost 140 * L^1.2 reproduces every row of data/levels.csv', () => {
  const rows = table('levels.csv');
  let floor = 0;
  for (const r of rows) {
    const from = Number(r.from_level);
    assert.equal(P.levelCost(from, cfg.levels), Number(r.xp_to_next), `cost of level ${from}`);
    floor += P.levelCost(from, cfg.levels);
    assert.equal(floor, Number(r.cumulative_xp), `points to reach level ${r.to_level}`);
    const at = P.levelInfo(floor, cfg.levels);
    assert.equal(at.level, Number(r.to_level)); assert.equal(at.into, 0);
    assert.equal(P.levelInfo(floor - 1, cfg.levels).level, Number(r.from_level));
  }
  assert.deepEqual(P.levelInfo(0, cfg.levels), { level: 1, floor: 0, cost: 140, into: 0, toNext: 140 });
});

const habit = cfg.habit;
const callOn = (d, points) => ({ type: 'call', d, points });
test('streak: a played day adds one, a missed day keeps half (rounded down), today is never a miss while it is still going', () => {
  const led = (days, today) => P.ledger(days.map((d) => callOn(d, 10)), today, habit);
  assert.equal(led(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], '2026-11-14').streak, 5);
  assert.equal(led(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], '2026-11-15').streak, 5, 'today not played yet: the streak is still alive');
  assert.equal(led(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], '2026-11-16').streak, 2, 'one missed day (yesterday): 5 becomes 2');
  assert.equal(led(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], '2026-11-17').streak, 1, 'two missed days: 5, 2, 1');
  assert.equal(led(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], '2026-11-18').streak, 0);
  assert.equal(led(['2026-11-10'], '2026-11-12').streak, 0, 'a streak of 1 halves to 0');
  assert.equal(led([], '2026-11-12').streak, 0);
});
test('habit points: 60 a played day plus 6 per streak day up to 10, once a day however many calls, never a multiplier', () => {
  const ev = [];
  for (let i = 0; i < 12; i++) { const d = R.addDays('2026-11-01', i); ev.push(callOn(d, 0), callOn(d, 0), callOn(d, 0)); } // three calls a day for twelve days
  const led = P.ledger(ev, '2026-11-12', habit);
  assert.deepEqual(led.rows.map((r) => r.habit), [66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 120, 120]);
  assert.equal(led.habitTotal, 66 + 72 + 78 + 84 + 90 + 96 + 102 + 108 + 114 + 120 * 3);
  assert.ok(led.rows.every((r) => r.habit <= habit.session_points + habit.streak_bonus_per_day * habit.streak_bonus_cap_days), 'at most 120 a day');
});
test('career points are a high-water mark: a bad day never lowers the level', () => {
  const ev = [callOn('2026-11-01', 500), callOn('2026-11-02', -2000), callOn('2026-11-03', 100)];
  const led = P.ledger(ev, '2026-11-03', habit);
  assert.deepEqual(led.rows.map((r) => r.career), [led.rows[0].cumulative, led.rows[0].cumulative, led.rows[0].cumulative], 'stays at the best running total');
  assert.ok(led.total < led.career);
  const jv = [{ type: 'resolve', d: '2026-11-02', edge: -50 }, { type: 'resolve', d: '2026-11-02', edge: null }, { type: 'lesson', d: '2026-11-04' }, { type: 'export', d: '2026-11-05' }];
  const l2 = P.ledger([callOn('2026-11-02', 10), ...jv], '2026-11-02', habit);
  assert.equal(l2.rows[0].skill, 10 - 50, 'journal edge counts, a null edge and non-play events do not');
  assert.equal(l2.byDay.has('2026-11-04'), false, 'reading a lesson is not a played day');
});
test('the seven-day score averages played days only, and compares today with the seven days before', () => {
  const ev = [callOn('2026-11-01', 100), callOn('2026-11-03', 200), callOn('2026-11-08', 150), callOn('2026-11-09', 400)];
  const led = P.ledger(ev, '2026-11-09', habit);
  const w = P.sevenDay(led, '2026-11-09');
  assert.deepEqual(w.days.map((d) => d.d), ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
  assert.equal(w.played, 3); assert.equal(w.total, 200 + 150 + 400); assert.equal(w.avgPerDay, 750 / 3);
  assert.equal(w.previous.played, 1); assert.equal(w.previous.avgPerDay, 100, 'the seven days before today: 2026-11-01 only... and 11-02 to 11-08 minus today');
});
test('a journal forecast written as a call: it leans to the side it favours, and 50% leans Yes', () => {
  const p = (c, outcome) => ({ id: 'x', c, outcome, edge: 7, domain: 'work', horizon: 'week', due: '2026-12-01' });
  assert.deepEqual([J.asCall(p(0.7, 'yes')).c, J.asCall(p(0.7, 'yes')).hit], [0.7, true]);
  assert.deepEqual([J.asCall(p(0.7, 'no')).c, J.asCall(p(0.7, 'no')).hit], [0.7, false]);
  assert.deepEqual([J.asCall(p(0.3, 'no')).c, J.asCall(p(0.3, 'no')).hit], [0.7, true], '30% says "no" at 70%');
  assert.deepEqual([J.asCall(p(0.5, 'yes')).hit, J.asCall(p(0.5, 'no')).hit], [true, false]);
  assert.equal(J.asCall(p(0.3, 'yes')).side, 'no');
});

// ---- the decisive test: every statistic against an independent recomputation from the raw history ------------------------
for (const today of ['2026-11-30', '2026-11-28']) { // today unplayed, then the last played day itself
  test(`the app's statistics equal the independent recomputation from the raw log (today = ${today})`, () => {
    const { events, ref } = synthetic("mixed_player('2026-11-30')", today);
    const calls = R.callsOf(events);
    // gym summary and bands
    const sum = R.summarize(calls);
    assert.equal(sum.n, ref.gym.n); assert.equal(sum.hits, ref.gym.hits); assert.equal(sum.points, ref.gym.points);
    near(sum.meanConf, ref.gym.mean_conf, 'mean confidence'); near(sum.gap, ref.gym.gap, 'gap');
    const bands = ST.calibrationBars(calls, cfg.mirror.band_edges, cfg.mirror.thin_below, cfg.mirror.error_bar_z);
    assert.equal(bands.length, ref.bands.length);
    bands.forEach((b, i) => {
      const r = ref.bands[i];
      assert.equal(b.n, r.n, `band ${i} n`); assert.equal(b.hits, r.hits); assert.equal(b.thin, r.thin);
      near(b.meanConf, r.mean_conf, `band ${i} mean`); near(b.hitRate, r.hit_rate, `band ${i} rate`); near(b.ci.lo, r.ci_lo, `band ${i} bar lo`); near(b.ci.hi, r.ci_hi, `band ${i} bar hi`);
    });
    // the bias map by topic
    const topics = ST.groupBy(calls, (c) => c.domain, opts);
    assert.deepEqual(topics.map((g) => [g.key, g.n, g.verdict]), ref.topics.map((g) => [g.key, g.n, g.verdict]));
    topics.forEach((g, i) => { near(g.gap, ref.topics[i].gap, `${g.key} gap`); near(g.gapLo, ref.topics[i].gap_lo, `${g.key} gap lo`); near(g.gapHi, ref.topics[i].gap_hi, `${g.key} gap hi`); near(g.avgPoints, ref.topics[i].avg_points, `${g.key} points`); });
    // the journal-only record, by domain, horizon and both
    const predictions = R.predictionsOf(events, today);
    const jr = J.journalRecord(predictions, cfg.journal, opts);
    const rj = ref.journal;
    assert.deepEqual([jr.resolved, jr.voided, jr.unscored, jr.kept_out, jr.counted], [rj.resolved, rj.voided, rj.unscored, rj.kept_out, rj.counted]);
    near(jr.yesRate, rj.yes_rate, 'yes rate'); near(jr.meanProb, rj.mean_prob, 'mean probability'); near(jr.meanEdge, rj.summary.avg_points, 'mean edge'); near(jr.totalEdge, rj.summary.points, 'total edge');
    for (const [mine, theirs, label] of [[jr.byDomain, rj.by_domain, 'domain'], [jr.byHorizon, rj.by_horizon, 'horizon']]) {
      assert.deepEqual(mine.map((g) => [g.key, g.n, g.hits, g.verdict]), theirs.map((g) => [g.key, g.n, g.hits, g.verdict]), label);
      mine.forEach((g, i) => { near(g.gap, theirs[i].gap, `${label} ${g.key} gap`); near(g.gapLo, theirs[i].gap_lo, `${label} ${g.key} lo`); near(g.gapHi, theirs[i].gap_hi, `${label} ${g.key} hi`); near(g.avgPoints, theirs[i].avg_points, `${label} ${g.key} edge`); });
    }
    assert.deepEqual(Object.fromEntries(Object.entries(jr.grid).map(([d, hs]) => [d, hs])), rj.grid);
    const jb = ST.calibrationBars(jr.calls, cfg.mirror.band_edges, cfg.mirror.thin_below, cfg.mirror.error_bar_z);
    jb.forEach((b, i) => { assert.equal(b.n, rj.bands[i].n); near(b.ci.lo, rj.bands[i].ci_lo, `journal band ${i}`); near(b.ci.hi, rj.bands[i].ci_hi, `journal band ${i}`); });
    // days: streak, habit, career, level, seven days
    const led = P.ledger(events, today, cfg.habit);
    assert.equal(led.streak, ref.streak); assert.equal(led.career, ref.career); assert.equal(led.todayPlayed, ref.today_played);
    assert.equal(led.rows.length, ref.days.length);
    led.rows.forEach((r, i) => { const q = ref.days[i]; assert.deepEqual([r.d, r.played, r.calls, r.skill, r.habit, r.streak, r.cumulative, r.career], [q.d, q.played, q.calls, q.skill, q.habit, q.streak, q.cumulative, q.career], `day ${r.d}`); });
    assert.deepEqual(P.levelInfo(led.career, cfg.levels), { level: ref.level.level, floor: ref.level.floor, cost: ref.level.cost, into: ref.level.into, toNext: ref.level.to_next });
    const w = P.sevenDay(led, today);
    assert.deepEqual([w.played, w.calls, w.total], [ref.seven.played, ref.seven.calls, ref.seven.total]);
    near(w.avgPerDay, ref.seven.avg, 'seven-day average'); near(w.previous.avgPerDay, ref.seven.prev_avg, 'previous seven-day average'); assert.equal(w.beating, ref.seven.beating);
    w.days.forEach((d, i) => assert.deepEqual([d.d, d.played, d.skill], [ref.seven.days[i].d, ref.seven.days[i].played, ref.seven.days[i].skill]));
    // what the fixture is meant to contain, so a changed fixture cannot quietly stop testing something
    assert.ok(jr.voided >= 1 && jr.unscored >= 1 && jr.kept_out >= 2, 'the fixture holds void, extra and kept-out cards');
    assert.ok(topics.some((g) => g.verdict === 'too sure') && topics.some((g) => g.verdict === 'no clear bias') && jr.byDomain.some((g) => !g.thin), 'and verdicts of more than one kind');
  });
}

test('trivial and self-controlled cards stay out of the bias map but are still scored', () => {
  const base = { state: 'resolved', outcome: 'yes', scored: true, b: 0.5, flags: [] };
  assert.equal(J.countsForMap(base, cfg.journal), true);
  assert.equal(J.countsForMap({ ...base, b: 0.97 }, cfg.journal), false);
  assert.equal(J.countsForMap({ ...base, b: 0.04 }, cfg.journal), false);
  assert.equal(J.countsForMap({ ...base, b: 0.05 }, cfg.journal), true, 'the band edge itself still counts');
  assert.equal(J.countsForMap({ ...base, flags: ['self_controlled'] }, cfg.journal), false);
  assert.equal(J.countsForMap({ ...base, flags: ['no_date'] }, cfg.journal), true);
  assert.equal(J.countsForMap({ ...base, scored: false }, cfg.journal), false);
  assert.equal(J.countsForMap({ ...base, outcome: 'void' }, cfg.journal), false);
  assert.equal(J.countsForMap({ ...base, state: 'open' }, cfg.journal), false);
  const { flags, ...old } = base; // a card locked by Block 2 has no flags field
  assert.equal(J.countsForMap(old, cfg.journal), true);
});

test('belts show real progress from facts the app can count, and never claim a gate that was not passed', () => {
  const rows = P.beltRows(table('belts.csv'), { gatesPassed: new Set(['U0']), resolved: 12, totalEdge: 340, monthResolved: 3, gapPts: -2 });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.B1.checks.map((c) => [c.label, c.have, c.need]), [['Gates U0 to U3', 1, 4], ['Resolved real predictions', 12, 40]]);
  assert.equal(by.B1.done, false);
  assert.deepEqual(by.B2.checks.map((c) => c.label), ['Gates U4 to U6', 'Resolved real predictions', 'Total edge above zero', 'Month-horizon results']);
  assert.equal(by.B3.checks.find((c) => c.kind === 'within').ok, true);
  assert.equal(by.B5.external, true);
  const all = P.beltRows(table('belts.csv'), { gatesPassed: new Set(['U0', 'U1', 'U2', 'U3']), resolved: 40, totalEdge: 1, monthResolved: 0, gapPts: 0 });
  assert.equal(all.find((r) => r.id === 'B1').done, true);
});

test('the table of other numbers always holds the number you said, once, marked, and runs on the side you leaned to', () => {
  const w = cfg.journal.edge_weight;
  const steps = cfg.binary.dial_steps;
  const two = (x) => Math.round(x * 100) / 100;
  // On a step: the same eleven rows as before, ascending.
  let t = J.otherNumbers(S, 0.5, true, w, 0.75);
  assert.deepEqual(t.map((r) => r.c), steps);
  assert.deepEqual(t.filter((r) => r.mine).map((r) => r.c), [0.75]);
  // Without a number of your own the rows are the steps and nothing is marked (the Block 2 behaviour).
  t = J.otherNumbers(S, 0.55, false, w);
  assert.deepEqual(t.map((r) => r.c), steps);
  assert.ok(t.every((r) => !r.mine));
  // Between two steps: twelve rows, in order, with the new one marked.
  t = J.otherNumbers(S, 0.5, false, w, 0.63);
  assert.equal(t.length, 12);
  assert.deepEqual(t.map((r) => r.c), [...steps, 0.63].sort((a, b) => a - b));
  assert.deepEqual(t.filter((r) => r.mine).map((r) => r.c), [0.63]);
  // A forecast under 50% leans No: the rows are the mirrored steps, 50 down to 1, and it is on one of them or gets its own.
  t = J.otherNumbers(S, 0.5, true, w, 0.3);
  assert.deepEqual(t.map((r) => r.c), steps.map((c) => two(1 - c)));
  assert.deepEqual(t.filter((r) => r.mine).map((r) => r.c), [0.3]);
  t = J.otherNumbers(S, 0.5, true, w, 0.37);
  assert.equal(t.length, 12);
  assert.ok(t.every((r, i) => i === 0 || r.c < t[i - 1].c), 'rows run downward from 50%');
  assert.deepEqual(t.filter((r) => r.mine).map((r) => r.c), [0.37]);
  // Every row's edge is exactly the engine's edge at that number, so the marked row equals what was recorded.
  for (const own of [0.3, 0.37, 0.5, 0.63, 0.75, 0.99, 0.01]) {
    for (const yes of [true, false]) {
      const rows = J.otherNumbers(S, 0.45, yes, w, own);
      const mine = rows.find((r) => r.mine);
      assert.equal(rows.filter((r) => r.mine).length, 1, `one marked row at ${own}`);
      assert.equal(mine.edge, J.journalScore(S, own, 0.45, yes, w).edge);
      for (const r of rows) assert.deepEqual({ raw: r.raw, base: r.base, edge: r.edge }, J.journalScore(S, r.c, 0.45, yes, w));
    }
  }
});

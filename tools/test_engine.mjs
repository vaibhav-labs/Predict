// Checks for the pure parts of the app (scoring, the record, question drawing, the store adapter).
// Run:  node --test tools/test_engine.mjs      (Node 20 or newer, nothing to install)
// The scoring checks compare the app with the Python the simulators use, on the same data/scoring.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { compile } from '../app/js/engine/expr.js';
import { makeScoring, roundHalfEven, signed, gapPts } from '../app/js/engine/scoring.js';
import { parseCSV, parseTable } from '../app/js/engine/csv.js';
import * as R from '../app/js/engine/record.js';
import * as J from '../app/js/engine/journal.js';
import { seeded, planBaseline, pickNext, apportion } from '../app/js/engine/draw.js';
import { openStore, MemoryBackend } from '../app/js/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'data', 'scoring.json'), 'utf8'));
const S = makeScoring(cfg);
const checkerRules = J.compileCheckerRules(parseTable(readFileSync(path.join(ROOT, 'data', 'checker_rules.csv'), 'utf8')));
const journalBaselines = parseTable(readFileSync(path.join(ROOT, 'data', 'journal_baselines.csv'), 'utf8'));

// ---- formulas ------------------------------------------------------------------------------------------
test('formula reader follows Python precedence', () => {
  assert.equal(compile('-2**2')({}), -4);
  assert.equal(compile('2**-1')({}), 0.5);
  assert.equal(compile('2**3**2')({}), 512);
  assert.equal(compile('100*(1-4*(1-p)**2)')({ p: 0.9 }), 100 * (1 - 4 * (1 - 0.9) ** 2));
  assert.equal(compile('100*(1+log2(p))')({ p: 0.5 }), 0);
  assert.equal(compile('  7 - 2 - 1 ')({}), 4);
});
test('formula reader refuses anything that is not arithmetic', () => {
  for (const bad of ['process.exit()', 'p; 1', '__proto__', 'eval(1)', 'p +', '(p', '1 2', 'p $ 2']) {
    assert.throws(() => compile(bad)({ p: 1 }), undefined, bad);
  }
  assert.throws(() => compile('q + 1')({ p: 1 }), /Unknown name q/);
});

// ---- scoring: the 22 numbers on the payout table -------------------------------------------------------
test('payout table has 11 steps from 50 to 99 and 22 values', () => {
  const t = S.table();
  assert.equal(t.length, 11);
  assert.deepEqual(t.map((r) => r.c), [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99]);
  assert.equal(t.length * 2, 22);
});
test('payouts match the numbers in the design (mechanics.md and the snapshot)', () => {
  assert.deepEqual([S.hit(0.5), S.miss(0.5)], [0, 0]);
  assert.deepEqual([S.hit(0.95), S.miss(0.95)], [99, -261]);
  assert.deepEqual([S.hit(0.99), S.miss(0.99)], [100, -292]);
  assert.equal(S.miss(0.8), -156);
  assert.equal(S.score(0.8, false), -156);
  assert.equal(S.score(0.8, true), 84);
});
test('the app and the Python simulators agree on all 22 values, for both rules', () => {
  const py = `
import json, math
cfg = json.load(open(${JSON.stringify(path.join(ROOT, 'data', 'scoring.json'))}))
B = cfg["binary"]
rules = {n: eval("lambda p: " + e, {"__builtins__": {}, "log2": math.log2}) for n, e in B["rules"].items()}
out = {}
for n, f in rules.items():
    out[n] = [[c, round(f(c)), round(f(1 - c))] for c in B["dial_steps"]]
print(json.dumps(out))`;
  const expected = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
  for (const rule of ['brier_points', 'log_points', 'naive_linear']) {
    const mine = cfg.binary.dial_steps.map((c) => [c, S.hit(c, rule), S.miss(c, rule)]);
    assert.deepEqual(mine, expected[rule], rule);
  }
});
test('rounding goes to the nearest even number on an exact half, like Python', () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5].map((x) => roundHalfEven(x) + 0), [0, 2, 2, 4, 0, -2, -2]);
});
test('honest is best: the expected score peaks where stated confidence equals the true chance', () => {
  for (const q of [0.55, 0.65, 0.75, 0.85, 0.95]) {
    const best = S.steps.reduce((b, c) => (S.expected(q, c) > S.expected(q, b) ? c : b), 0.5);
    assert.equal(best, q, `q=${q}`);
  }
});
test('signed() writes a real minus and an explicit plus, and a gap that rounds to zero has no sign', () => {
  assert.deepEqual([signed(5), signed(-5), signed(0)], ['+5', '−5', '0']);
  // The calibration gap in whole points. Math.round(-0.4) is -0 in JavaScript: it must read 0, not "−0" or "+0".
  assert.deepEqual([0, 0.004, -0.004, 0.006, -0.006, 0.125, -0.125, 0.3, -0.3].map(gapPts),
    ['0', '0', '0', '+1', '−1', '+13', '−12', '+30', '−30']);
});

// ---- csv -----------------------------------------------------------------------------------------------
test('csv reader handles quotes, commas and blank lines', () => {
  const rows = parseCSV('a,b,c\n1,"x, y",3\n\n"he said ""hi""",,\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', '3'], ['he said "hi"', '', '']]);
  assert.deepEqual(parseTable('id,name\nU0,Baseline\nU1,Calibration\n'), [{ id: 'U0', name: 'Baseline' }, { id: 'U1', name: 'Calibration' }]);
  const units = parseTable(readFileSync(path.join(ROOT, 'data', 'units.csv'), 'utf8'));
  assert.equal(units[0].id, 'U0');
  assert.equal(units[0].practice_calls, '60');
  assert.equal(units[1].drills_per_day, '18');
});

// ---- the record ----------------------------------------------------------------------------------------
const day = (s) => new Date(`${s}T10:00:00`);
function fakeCall(i, over = {}) {
  const d = day('2026-11-16');
  d.setSeconds(i);
  return R.makeEvent('call', { session: 's1', mode: 'baseline', unit: 'U0', q: `q${i}`, claim: `Claim ${i}, with "quotes"`, domain: 'geography', diff: 'easy', side: 'yes', c: 0.7, truth: true, hit: true, points: 64, ms: 4000, ...over }, d);
}
test('events carry an id, a UTC time and the local day', () => {
  const e = R.makeEvent('call', { q: 'q1' }, new Date(2026, 10, 16, 23, 59, 30));
  assert.match(e.id, /^[0-9a-z]{9}-[0-9a-f]{10}$/);
  assert.equal(e.d, '2026-11-16');
  assert.equal(e.t, new Date(2026, 10, 16, 23, 59, 30).toISOString());
});
test('an event never holds an undefined field, so what is stored and what is exported are the same record', () => {
  const e = R.makeEvent('session', { mode: 'practice', plan: undefined, n: null }, new Date(2026, 10, 16, 8, 0, 0));
  assert.equal('plan' in e, false);
  assert.equal(e.n, null);
  assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
});
test('export then import round-trips, and a second import counts nothing twice', () => {
  const events = Array.from({ length: 20 }, (_, i) => fakeCall(i));
  const text = R.toJSONL(events, { build: 'test' });
  const parsed = R.parseJSONL(text);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.header.events, 20);
  assert.deepEqual(parsed.events, events);
  const first = R.mergeEvents([], parsed.events);
  assert.equal(first.added.length, 20);
  const second = R.mergeEvents(first.merged, parsed.events);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped, 20);
  assert.equal(second.merged.length, 20);
});
test('merging a backup into a record that has newer events keeps both and the time order', () => {
  const a = Array.from({ length: 5 }, (_, i) => fakeCall(i));
  const b = [a[3], a[4], fakeCall(5), fakeCall(6), fakeCall(7)]; // two events the record already has, three new ones
  const { merged, added, skipped } = R.mergeEvents(a, b);
  assert.equal(merged.length, 8);
  assert.equal(added.length, 3);
  assert.equal(skipped, 2);
  assert.equal(new Set(merged.map((e) => e.id)).size, 8);
  assert.deepEqual(merged.map((e) => e.t), merged.map((e) => e.t).slice().sort());
});
test('bad lines are reported, good ones kept', () => {
  const good = fakeCall(1);
  const text = `${JSON.stringify(good)}\nnot json\n{"type":"call"}\n\n[1,2]\n`;
  const { events, errors } = R.parseJSONL(text);
  assert.equal(events.length, 1);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 5]);
});
test('the calls CSV has one row per call and escapes quotes', () => {
  const csv = R.callsToCSV([fakeCall(1), R.makeEvent('dispute', { q: 'q1' })]);
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][6], 'Claim 1, with "quotes"');
  assert.equal(rows[1][12], 'right');
});
test('summary numbers always carry their sample size', () => {
  const calls = [fakeCall(1, { c: 0.9, hit: true, points: 96 }), fakeCall(2, { c: 0.9, hit: false, points: -224 }), fakeCall(3, { c: 0.6, hit: true, points: 36 }), fakeCall(4, { c: 0.6, hit: true, points: 36 })];
  const s = R.summarize(calls);
  assert.equal(s.n, 4);
  assert.equal(s.hits, 3);
  assert.equal(s.hitRate, 0.75);
  assert.ok(Math.abs(s.meanConf - 0.75) < 1e-12);
  assert.equal(s.points, -56);
  assert.equal(R.summarize([]).n, 0);
});
test('calibration bands: edges belong to the band above, the top band is closed, counts add up', () => {
  const edges = cfg.mirror.band_edges;
  const cs = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99].map((c, i) => fakeCall(i, { c, hit: i % 2 === 0 }));
  const bands = R.calibration(cs, edges, cfg.mirror.thin_below);
  assert.deepEqual(bands.map((b) => b.n), [2, 2, 2, 2, 3]);
  assert.equal(bands.reduce((s, b) => s + b.n, 0), 11);
  assert.ok(bands.every((b) => b.thin));
  assert.equal(R.calibration([], edges, 10).every((b) => b.n === 0 && b.hitRate === null), true);
});
test('day number counts from the first call, and sessions and baseline progress follow the log', () => {
  const s = R.makeEvent('session', { mode: 'baseline', unit: 'U0', size: 20, plan: [] }, day('2026-11-16'));
  const calls = Array.from({ length: 3 }, (_, i) => fakeCall(i, { session: s.id }));
  const ev = [s, ...calls];
  assert.equal(R.dayNumber([], '2026-11-16'), 1);
  assert.equal(R.dayNumber(ev, '2026-11-16'), 1);
  assert.equal(R.dayNumber(ev, '2026-11-18'), 3);
  assert.equal(R.dayNumber(ev, '2027-01-01'), 47);
  assert.deepEqual(R.baselineProgress(ev, 60), { done: 3, total: 60, complete: false });
  assert.equal(R.activeSession(ev).id, s.id);
  assert.equal(R.activeSession([...ev, R.makeEvent('session_end', { session: s.id }, day('2026-11-16'))]), null);
  assert.equal(R.sessionsOf(ev)[0].calls.length, 3);
});

// ---- the journal -----------------------------------------------------------------------------------------
function fakePrediction(i, over = {}) {
  const d = day('2026-11-16');
  d.setSeconds(i);
  return R.makeEvent('prediction', {
    text: `Claim ${i}`, domain: 'work', dueOption: 'week', due: '2026-11-23', horizon: 'week',
    chain: { outsideView: { text: 'ov', rate: 0.5 }, evidence: [], caseAgainst: { text: 'ca', number: 10 }, tripwire: { text: 'tw', number: 20 } },
    c: 0.7, b: 0.5, bSource: 'starter', scored: true, ...over,
  }, d);
}
test('the two worked edge examples in mechanics.md 4.3 come out exactly', () => {
  // "you say 75% a client signs by Friday; the baseline is 55%."
  assert.deepEqual(J.journalScore(S, 0.75, 0.55, true, 2), { raw: 75, base: 19, edge: 112 });
  assert.deepEqual(J.journalScore(S, 0.75, 0.55, false, 2), { raw: -125, base: -21, edge: -208 });
});
test('the worked edge example in mechanics.md 4.9 comes out exactly, and the table of other numbers matches it', () => {
  // "you say 85% against a 55% baseline and it does not happen."
  assert.deepEqual(J.journalScore(S, 0.85, 0.55, false, 2), { raw: -189, base: -21, edge: -336 });
  const table = J.otherNumbers(S, 0.55, false, 2);
  const at = (c) => table.find((r) => Math.abs(r.c - c) < 1e-9).edge;
  assert.equal(at(0.55), 0); // the same miss at the baseline itself breaks even
  assert.equal(at(0.65), -96);
  assert.equal(at(0.75), -208);
  assert.equal(at(0.85), -336);
});
test('the checker: a sharp claim with a date passes clean', () => {
  assert.deepEqual(J.checkClaim('By Friday, the client will sign the contract.', checkerRules), []);
});
test('the checker: vague wording and no date are both caught', () => {
  const flags = J.checkClaim('Our project will probably go a lot better soon.', checkerRules).map((f) => f.flag);
  assert.ok(flags.includes('no_date'), flags.join(','));
  assert.ok(flags.includes('ambiguous_term'), flags.join(','));
});
test('the checker: a feeling is not observable', () => {
  const flags = J.checkClaim('I will feel happy about my job by next month.', checkerRules).map((f) => f.flag);
  assert.deepEqual(flags, ['not_observable']);
});
test('the checker: a fully self-controlled task is flagged, with a date and no vague words', () => {
  const flags = J.checkClaim('I will finish writing my report by Friday.', checkerRules).map((f) => f.flag);
  assert.deepEqual(flags, ['self_controlled']);
});
test('due date and horizon follow data/scoring.json journal section, not code', () => {
  const jcfg = cfg.journal;
  assert.equal(J.dueDateFor('tomorrow', '2026-11-15', jcfg), '2026-11-16');
  assert.equal(J.dueDateFor('week', '2026-11-15', jcfg), '2026-11-22');
  assert.equal(J.dueDateFor('month', '2026-11-15', jcfg), '2026-12-15');
  assert.equal(J.dueDateFor('longer', '2026-11-15', jcfg), '2027-02-13');
  assert.deepEqual(['tomorrow', 'week', 'month', 'longer'].map((o) => J.horizonFor(o, jcfg)), ['week', 'week', 'month', 'longer']);
});
test('the baseline: the starter table until there is enough of the player’s own history', () => {
  const jcfg = cfg.journal;
  const starved = J.baselineFor({ domain: 'work', horizon: 'week', own: { n: 4, rate: 0.9 }, starterTable: journalBaselines, cfg: jcfg });
  assert.deepEqual(starved, { b: 0.5, source: 'starter' });
  const own = J.baselineFor({ domain: 'work', horizon: 'week', own: { n: 5, rate: 0.9 }, starterTable: journalBaselines, cfg: jcfg });
  assert.deepEqual(own, { b: 0.9, source: 'own' });
  const noRow = J.baselineFor({ domain: 'work', horizon: 'week', own: { n: 0, rate: null }, starterTable: [], cfg: jcfg });
  assert.deepEqual(noRow, { b: 0.5, source: 'default' });
});
test('ownBaseRate: yes-rate of resolved real predictions in one domain and horizon, void excluded', () => {
  const preds = R.predictionsOf([
    fakePrediction(1, { domain: 'work', horizon: 'week' }),
    fakePrediction(2, { domain: 'work', horizon: 'week' }),
    fakePrediction(3, { domain: 'work', horizon: 'week' }),
    fakePrediction(4, { domain: 'life', horizon: 'week' }), // a different domain: not counted
  ].flatMap((p, i) => [p, R.makeEvent('resolve', { prediction: p.id, outcome: ['yes', 'no', 'void', 'yes'][i], raw: 1, edge: 1 }, day('2026-11-20'))]));
  const own = R.ownBaseRate(preds, 'work', 'week');
  assert.deepEqual(own, { n: 2, rate: 0.5 }); // one yes, one no; the void does not count
});
test('predictionsOf: open, due and resolved follow the clock, and a locked card never changes', () => {
  const p1 = fakePrediction(1, { due: '2026-11-20' }); // open relative to 2026-11-16
  const p2 = fakePrediction(2, { due: '2026-11-10' }); // already due
  const resolve2 = R.makeEvent('resolve', { prediction: p2.id, outcome: 'yes', raw: 75, edge: 112 }, day('2026-11-16'));
  const preds = R.predictionsOf([p1, p2, resolve2], '2026-11-16');
  assert.equal(preds.find((p) => p.id === p1.id).state, 'open');
  assert.equal(preds.find((p) => p.id === p2.id).state, 'resolved');
  const dueBefore = R.predictionsOf([p1], '2026-11-16');
  assert.equal(dueBefore[0].state, 'open');
  const dueAfter = R.predictionsOf([p1], '2026-11-20');
  assert.equal(dueAfter[0].state, 'due');
});
test('a locked prediction is never overwritten: the store refuses a second event with the same id', async () => {
  const store = await openStore(new MemoryBackend());
  const p = fakePrediction(1);
  assert.equal(await store.append(p), true);
  assert.equal(await store.append({ ...p, c: 0.99 }), false); // same id: refused
  assert.equal(store.events.find((e) => e.id === p.id).c, 0.7);
});
test('scoredToday: one scored card a day, extras logged unscored', () => {
  const today = '2026-11-16';
  const first = R.predictionsOf([fakePrediction(1, { scored: true })], today);
  assert.equal(R.scoredToday(first, today), true);
  const unscored = R.predictionsOf([fakePrediction(1, { scored: false })], today);
  assert.equal(R.scoredToday(unscored, today), false);
});

// ---- drawing questions ---------------------------------------------------------------------------------
function bigBank(n = 240) {
  const diffs = ['easy', 'easy', 'medium', 'medium', 'hard'];
  return Array.from({ length: n }, (_, i) => ({ id: `q${i}`, claim: `c${i}`, answer: i % 2 === 0, diff: diffs[i % 5] }));
}
test('apportion splits a total into whole numbers that follow the weights', () => {
  assert.deepEqual(apportion(10, { easy: 0.4, medium: 0.35, hard: 0.25 }), { easy: 4, medium: 4, hard: 2 });
  const out = apportion(20, { easy: 0.4, medium: 0.35, hard: 0.25 });
  assert.equal(out.easy + out.medium + out.hard, 20);
  assert.deepEqual(out, { easy: 8, medium: 7, hard: 5 });
});
test('a baseline session is half true, half false, spread across difficulty, and repeatable from a seed', () => {
  const bank = bigBank();
  const plan = planBaseline({ bank, size: 20, spares: 4, mix: cfg.gym.difficulty_mix, rng: seeded(7) });
  assert.equal(plan.length, 24);
  assert.equal(new Set(plan).size, 24);
  const main = plan.slice(0, 20).map((id) => bank.find((q) => q.id === id));
  assert.equal(main.filter((q) => q.answer).length, 10);
  const byDiff = (d) => main.filter((q) => q.diff === d).length;
  assert.deepEqual([byDiff('easy'), byDiff('medium'), byDiff('hard')], [8, 7, 5]);
  assert.deepEqual(plan, planBaseline({ bank, size: 20, spares: 4, mix: cfg.gym.difficulty_mix, rng: seeded(7) }));
  assert.notDeepEqual(plan, planBaseline({ bank, size: 20, spares: 4, mix: cfg.gym.difficulty_mix, rng: seeded(8) }));
});
test('draws never repeat a question until the bank is used up, and never use a disputed one', () => {
  const bank = bigBank(60);
  const used = new Set();
  const disputed = new Set(['q3', 'q4']);
  const rng = seeded(11);
  const shown = [];
  for (let i = 0; i < 58; i++) {
    const q = pickNext({ bank, usedIds: used, disputedIds: disputed, cfg: cfg.gym, rng, shownTruths: shown.map((x) => x.answer) });
    assert.ok(q, `draw ${i}`);
    assert.ok(!used.has(q.id), `repeat at ${i}`);
    assert.ok(!disputed.has(q.id));
    used.add(q.id); shown.push(q);
  }
  // 58 usable questions are used up; the next draw reuses an old one rather than failing
  const again = pickNext({ bank, usedIds: used, disputedIds: disputed, cfg: cfg.gym, rng, lastUsed: new Map(shown.map((q, i) => [q.id, i])) });
  assert.ok(again && used.has(again.id));
});
test('practice leans harder when the hit rate is high and easier when it is low', () => {
  const bank = bigBank(2000);
  const share = (recent) => {
    const rng = seeded(3);
    let hard = 0, easy = 0;
    for (let i = 0; i < 2000; i++) {
      const q = pickNext({ bank, cfg: cfg.gym, rng, recent });
      if (q.diff === 'hard') hard++;
      if (q.diff === 'easy') easy++;
    }
    return { hard: hard / 2000, easy: easy / 2000 };
  };
  const high = share(Array(20).fill(true));
  const low = share(Array(20).fill(false));
  const mid = share([...Array(15).fill(true), ...Array(5).fill(false)]);
  assert.ok(high.hard > mid.hard && mid.hard > low.hard, JSON.stringify({ high, mid, low }));
  assert.ok(low.easy > mid.easy && mid.easy > high.easy);
});
test('true and false stay near half and half over a practice session', () => {
  const bank = bigBank(400);
  const rng = seeded(5);
  const shown = [];
  const used = new Set();
  for (let i = 0; i < 90; i++) {
    const q = pickNext({ bank, usedIds: used, cfg: cfg.gym, rng, shownTruths: shown });
    used.add(q.id); shown.push(q.answer);
  }
  const t = shown.filter(Boolean).length;
  assert.ok(t >= 36 && t <= 54, `true count ${t}`);
});

// ---- the store adapter ---------------------------------------------------------------------------------
test('the store saves each event before it returns, refuses overwrites, and imports idempotently', async () => {
  const store = await openStore(new MemoryBackend());
  const e1 = fakeCall(1), e2 = fakeCall(2);
  assert.equal(await store.append(e1), true);
  assert.equal(await store.append({ ...e1, points: 999 }), false); // same id: refused, never overwritten
  assert.equal(store.events.find((e) => e.id === e1.id).points, 64);
  assert.equal(await store.append(e2), true);
  assert.equal(store.events.length, 2);
  const file = R.toJSONL(store.events);
  await store.erase();
  assert.equal(store.events.length, 0);
  const { events } = R.parseJSONL(file);
  assert.deepEqual(await store.importEvents(events), { added: 2, skipped: 0 });
  assert.deepEqual(await store.importEvents(events), { added: 0, skipped: 2 });
  assert.equal(store.events.length, 2);
  await store.setMeta('k', { a: 1 });
  assert.deepEqual(await store.getMeta('k'), { a: 1 });
});

// ---- later blocks live in tools/engine_tests/ ----------------------------------------------------------------------
import './engine_tests/b3.mjs';
import './engine_tests/b4.mjs';
import './engine_tests/b5.mjs';

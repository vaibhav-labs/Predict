// The shared walk for the Block 4 tests: a scripted player lives through a synthetic record day by day while the app's own engine
// is looked at twice a day, once in JS here and once in tools/ref_lessons.py, and the two timelines are compared.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { cfg, ROOT, py, near } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as LE from '../../app/js/engine/lessons.js';

export const tmp = () => mkdtempSync(path.join(tmpdir(), 'predict-b4-'));
export const withDir = (fn) => { const dir = tmp(); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
export const readEvents = (file) => R.parseJSONL(readFileSync(file, 'utf8')).events.sort(R.byTime);

// The script is the one in tools/ref_lessons.py (walk).
const MORNING = 'T07:00:00.000Z', EVENING = 'T21:00:00.000Z', LESSON = 'T21:30:00.000Z', DRILL = 'T21:31:00.000Z';

export function walkJS(events, lastDay) {
  const byDay = new Map();
  for (const e of events) { if (!byDay.has(e.d)) byDay.set(e.d, []); byDay.get(e.d).push(e); }
  const log = [];
  const ordinal = new Map(), trigger = new Map();
  const out = [];
  let n = 0;
  const look = (day, stamp) => {
    const { append } = LE.evaluate(log, { today: day, cfg, predictions: R.predictionsOf(log, day) });
    for (const f of append) {
      n += 1;
      const id = `flag-${n}`;
      const ev = { id, t: day + stamp, d: day, ...f };
      log.push(ev);
      if (f.state === 'open') { ordinal.set(id, ordinal.size + 1); trigger.set(id, f.trigger); }
      out.push(normalize(ev, ordinal, trigger, stamp));
    }
  };
  let day = [...byDay.keys()].sort()[0];
  while (day <= lastDay) {
    look(day, MORNING);
    for (const e of byDay.get(day) || []) log.push(e);
    look(day, EVENING);
    // The scripted player reads the lesson and does the drill the evening a pattern flag is open.
    for (const c of LE.flagsOf(log, cfg)) {
      if (c.trigger !== 'L15' && c.state === 'open') {
        n += 1; log.push({ id: `flag-${n}`, t: day + LESSON, d: day, type: 'flag', state: 'lesson', flag: c.id });
        n += 1; log.push({ id: `flag-${n}`, t: day + DRILL, d: day, type: 'flag', state: 'drill', flag: c.id, session: `drill-${n}` });
      }
    }
    day = R.addDays(day, 1);
  }
  return { out, log };
}
const KEYS = { open: { L01: ['n', 'meanConf', 'hitRate', 'gap'], L02: ['n', 'meanConf', 'hitRate', 'gap'], L03: ['n', 'zone', 'share', 'zoneHitRate'], L04: ['n', 'rejects'] }, retest: { L01: ['n', 'meanConf', 'hitRate', 'gap'], L02: ['n', 'meanConf', 'hitRate', 'gap'], L03: ['n', 'share'], L04: ['n', 'rejects'] } };
function normalize(ev, ordinal, trigger, stamp) {
  const id = ev.state === 'open' ? ev.id : ev.flag;
  const row = { day: ev.d, at: stamp.slice(1, 3), state: ev.state, chain: ordinal.get(id), trigger: ev.trigger || trigger.get(id) };
  if (ev.state === 'open') {
    if (row.trigger === 'L15') row.missed = ev.evidence.missed.length;
    else for (const k of KEYS.open[row.trigger]) row[k] = ev.evidence[k];
  } else if (ev.state === 'retest') {
    row.step = ev.step; row.passed = ev.pass;
    for (const k of KEYS.retest[row.trigger]) row[k] = ev.evidence[k];
  }
  return row;
}
export function sameTimeline(a, b, label) {
  assert.equal(a.length, b.length, `${label}: ${a.length} events in the app, ${b.length} in the reference`);
  a.forEach((x, i) => {
    const y = b[i];
    assert.deepEqual(Object.keys(x).sort(), Object.keys(y).sort(), `${label} #${i}: fields`);
    for (const k of Object.keys(x)) {
      if (typeof x[k] === 'number' && !Number.isInteger(x[k])) near(x[k], y[k], `${label} #${i} ${k}`);
      else assert.equal(x[k], y[k], `${label} #${i} ${k}`);
    }
  });
}
export function scenario(builder, lastDay) {
  return withDir((dir) => {
    const f = path.join(dir, 'record.jsonl');
    py(`import synth\nsynth.${builder}.write(sys.argv[1])`, [f]);
    const events = readEvents(f);
    const ref = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_lessons.py'), 'walk', f, lastDay], { encoding: 'utf-8', maxBuffer: 1 << 28 }));
    const mine = walkJS(events, lastDay);
    return { events, ref, ...mine };
  });
}
export const summary = (rows) => rows.map((r) => `${r.chain}:${r.trigger}:${r.state}${r.step ? r.step : ''}${r.state === 'retest' ? (r.passed ? '+' : '-') : ''}`);


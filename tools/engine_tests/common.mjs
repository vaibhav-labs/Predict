// Shared set-up for the engine tests that live in tools/engine_tests/ (imported by tools/test_engine.mjs).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeScoring } from '../../app/js/engine/scoring.js';
import { parseTable } from '../../app/js/engine/csv.js';
import * as R from '../../app/js/engine/record.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cfg = JSON.parse(readFileSync(path.join(ROOT, 'data', 'scoring.json'), 'utf8'));
export const S = makeScoring(cfg);
export const table = (name) => parseTable(readFileSync(path.join(ROOT, 'data', name), 'utf8'));

// Run a snippet of Python from the tools folder and return what it printed.
export function py(code, args = []) {
  return execFileSync('python3', ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})\n${code}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

// A synthetic record from tools/synth.py written to a temp file, read back through the app's own parser,
// together with the independent recomputation from tools/ref_mirror.py for a given "today".
export function synthetic(builder, today) {
  const dir = mkdtempSync(path.join(tmpdir(), 'predict-synth-'));
  const file = path.join(dir, 'record.jsonl');
  try {
    py(`import synth\nsynth.${builder}.write(sys.argv[1])`, [file]);
    const { events, errors } = R.parseJSONL(readFileSync(file, 'utf8'));
    assert.deepEqual(errors, []);
    const ref = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools', 'ref_mirror.py'), file, today], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    return { events: events.sort(R.byTime), ref, file };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export const near = (a, b, msg, tol = 1e-9) => {
  if (a === null || b === null || a === undefined || b === undefined) assert.equal(a ?? null, b ?? null, msg);
  else assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
};

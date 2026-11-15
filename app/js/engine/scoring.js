// Scoring, read from data/scoring.json. No scoring number is written in this file: the rule formulas
// and the dial steps come from the table, exactly as they do for the Python simulators (sim/scoring_sim.py).
import { compile } from './expr.js';

// Python's round() goes to the nearest even number on an exact half; Math.round goes up.
// The simulators use round(), so the app does the same and the two never disagree by a point.
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function makeScoring(cfg) {
  const b = cfg.binary;
  const rules = {};
  for (const [name, formula] of Object.entries(b.rules)) rules[name] = compile(formula);

  // Points for a call whose chosen side got probability p, under a named rule.
  function points(rule, p) {
    const f = rules[rule];
    if (!f) throw new Error(`Unknown scoring rule: ${rule}`);
    return roundHalfEven(f({ p }));
  }
  const core = b.core_rule;
  // What a call at confidence c pays if the chosen side turns out right, and if it turns out wrong.
  const hit = (c, rule = core) => points(rule, c);
  const miss = (c, rule = core) => points(rule, 1 - c);
  // Points actually earned by a call.
  const score = (c, wasRight, rule = core) => (wasRight ? hit(c, rule) : miss(c, rule));
  // Average points per call for someone who is really right a fraction q of the time but says c.
  const expected = (q, c, rule = core) => q * hit(c, rule) + (1 - q) * miss(c, rule);

  return {
    steps: b.dial_steps.slice(),
    min: b.min_confidence,
    max: b.max_confidence,
    noteThreshold: b.note_threshold,
    rule: core,
    points, hit, miss, score, expected,
    // The 22 numbers on the payout table: eleven steps, hit and miss.
    table() { return b.dial_steps.map((c) => ({ c, hit: hit(c), miss: miss(c) })); },
  };
}

// Display helpers: a real minus sign and an explicit plus, so a loss never looks like a dash.
// A time-weighted journal score is not a whole number, so a fraction is rounded for display (and never written +0 or −0).
export const signed = (x) => { const n = Number.isInteger(x) ? x : Math.round(x); return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0'; };
export const pct = (c) => `${Math.round(c * 100)}%`;
// The calibration gap (mean stated confidence minus hit rate) in whole percentage points, signed. A gap that rounds to
// zero is written 0, never +0 or −0 (Math.round turns a small negative gap into −0).
export const gapPts = (gap) => signed(Math.round(gap * 100));

// Gates (design/mechanics.md 4.5): a fixed exam of fresh calls, judged once at the end, never a rolling window.
// Unit 1's exam is 200 calls: the average confidence must sit within calibration_index_tolerance of the hit rate, and no
// band with band_min_items calls or more may sit further than band_z_max standard errors from its own stated confidence.
// Pure functions of the record. The numbers come from data/scoring.json ("gates", "mirror").
import { ACTIVE, flagsOf } from './lessons.js';

const EPS = 1e-9;

// The verdict on a set of exam calls. `calls` are the exam's calls (each with c and hit).
export function gateU1(calls, gates, edges) {
  const n = calls.length;
  const meanConf = n ? calls.reduce((s, c) => s + c.c, 0) / n : null;
  const hitRate = n ? calls.filter((c) => c.hit).length / n : null;
  const index = n ? meanConf - hitRate : null;
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1], last = i === edges.length - 2;
    const inside = calls.filter((c) => c.c >= lo - EPS && (last ? c.c <= hi + EPS : c.c < hi - EPS));
    const m = inside.length;
    const bm = m ? inside.reduce((s, c) => s + c.c, 0) / m : null;
    const bh = m ? inside.filter((c) => c.hit).length / m : null;
    const checked = m >= gates.band_min_items;
    const zval = checked ? Math.abs(bh - bm) / Math.sqrt((bm * (1 - bm)) / m) : null;
    bands.push({ lo, hi, n: m, meanConf: bm, hitRate: bh, gap: m ? bm - bh : null, checked, z: zval, off: checked && zval > gates.band_z_max + EPS });
  }
  const reasons = [];
  if (n && Math.abs(index) > gates.calibration_index_tolerance + 1e-12) reasons.push('index');
  for (const b of bands) if (b.off) reasons.push(`band:${b.lo}`);
  // The worst band for a repair drill: the checked band furthest off; if none is checked, the busiest band that is off by the most.
  const live = bands.filter((b) => b.n > 0);
  const worst = (bands.filter((b) => b.checked).sort((a, b) => b.z - a.z)[0]) || live.sort((a, b) => Math.abs(b.gap) * b.n - Math.abs(a.gap) * a.n)[0] || null;
  return { n, pass: n > 0 && reasons.length === 0, index, meanConf, hitRate, bands, reasons, worst: worst && { lo: worst.lo, hi: worst.hi, dir: worst.gap > 0 ? 'too sure' : 'too shy' } };
}

// ---- the exams in the record ---------------------------------------------------------------------------------
// Events: `exam` with state start (its id is the attempt id), result (flag: the attempt, the verdict) and repair (the
// repair drill after a failed attempt was done). Exam calls carry `exam: <attempt id>` and mode 'exam'; so do the ranges of
// Unit 3's exam (event type `range`). `unit` keeps one unit's attempts (a start without a unit is Unit 1's).
export function examsOf(events, cfg, unit) {
  const attempts = new Map();
  const list = [];
  for (const e of events) {
    if (e.type !== 'exam') continue;
    if (e.state === 'start') {
      const a = { id: e.id, unit: e.unit || 'U1', startedAt: e.t, startedDay: e.d, total: e.n, calls: [], sessions: [], result: null, repairedAt: null, reused: e.reused || 0 };
      attempts.set(e.id, a);
      list.push(a);
    } else if (attempts.has(e.exam)) {
      const a = attempts.get(e.exam);
      if (e.state === 'result' && !a.result) a.result = e;
      else if (e.state === 'repair' && a.result && !a.result.pass && !a.repairedAt) a.repairedAt = e.t;
    }
  }
  for (const e of events) {
    const a = e.exam && attempts.get(e.exam);
    if (!a) continue;
    if (e.type === 'call' || e.type === 'range') a.calls.push(e);
    else if (e.type === 'session' || e.type === 'rsession') a.sessions.push(e);
  }
  return unit ? list.filter((a) => a.unit === unit) : list;
}

// Where the player stands on the Unit 1 gate.
// `progress` carries what the units table says: practiceCalls done, practiceRequired (units.csv, U1 practice_calls) and baselineDone.
export function gateStatus(events, cfg, { practiceCalls = 0, practiceRequired = 0, baselineDone = true } = {}) {
  const g = cfg.gates;
  const attempts = examsOf(events, cfg, 'U1');
  const running = attempts.find((a) => !a.result) || null;
  const passedAttempt = attempts.find((a) => a.result && a.result.pass) || null;
  const lastFailed = [...attempts].reverse().find((a) => a.result && !a.result.pass) || null;
  const needsRepair = !passedAttempt && !running && !!lastFailed && !lastFailed.repairedAt;
  const total = g.calibration_exam_calls;
  // Rust: a passed gate reopens when one of its triggers fires later, on review calls, until that flag is cleared.
  let rust = null;
  if (passedAttempt) {
    const watch = new Set((g.rust_triggers && g.rust_triggers.U1) || []);
    rust = flagsOf(events, cfg).find((c) => watch.has(c.trigger) && c.openedAt > passedAttempt.result.t && ACTIVE.has(c.state)) || null;
  }
  const eligible = baselineDone && practiceCalls >= practiceRequired && !passedAttempt && !running && !needsRepair;
  return { attempts, running, passed: !!passedAttempt, passedAt: passedAttempt ? passedAttempt.result.t : null, lastFailed, needsRepair, rust, eligible, total, done: running ? running.calls.length : 0 };
}

// The next exam sitting: up to exam_session_size calls, never more than the exam has left.
export const examSittingSize = (status, gym) => Math.min(gym.exam_session_size, status.total - status.done);

// The repair drill after a failed exam: gates.repair_drill_calls calls aimed at the worst band. Too sure: each call is checked against
// the wheel before it is locked. Too shy: forced commits (the steps the L02 drill uses). `worst` is the verdict's worst band.
export function repairDrillOf(worst, cfg) {
  const calls = cfg.gates.repair_drill_calls;
  if (worst && worst.dir === 'too shy') return { kind: 'forced', calls, steps: cfg.lessons.triggers.L02.drill.steps, band: worst };
  return { kind: 'wheel', calls, band: worst || null };
}

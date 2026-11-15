// Statistics for the Mirror: honest error bars and the bias map. Pure functions, no page, no storage.
// Every number carries its sample size, and a group too small to say anything is labelled "too few", never drawn as a result.
import { summarize, calibration } from './record.js';

// The Wilson score interval for a hit rate: the range of true rates that the observed hits do not rule out.
// Unlike the textbook "p plus or minus 1.96 standard errors" it stays inside 0 to 1 and behaves with small n.
export function wilson(hits, n, z = 1.96) {
  if (!n) return { lo: null, hi: null };
  const p = hits / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

// One group of calls (a topic, a domain, a horizon, a confidence band): the usual sums, the interval on its hit
// rate, the interval on its gap (average confidence minus hit rate), and a verdict that never claims a bias the
// sample cannot support.
export function describeGroup(key, list, { z = 1.96, thinBelow = 10 } = {}) {
  const s = summarize(list);
  const ci = wilson(s.hits, s.n, z);
  const gapLo = s.n ? s.meanConf - ci.hi : null;
  const gapHi = s.n ? s.meanConf - ci.lo : null;
  const thin = s.n < thinBelow;
  let verdict = 'too few';
  if (!thin) verdict = gapLo > 0 ? 'too sure' : gapHi < 0 ? 'too shy' : 'no clear bias';
  return { key, ...s, ci, gapLo, gapHi, thin, verdict };
}

// Split calls by any key (a function of one call). Biggest group first; ties by name so the order is stable.
export function groupBy(calls, keyFn, opts) {
  const map = new Map();
  for (const c of calls) {
    const k = keyFn(c);
    if (k === undefined || k === null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return [...map.entries()].map(([k, list]) => describeGroup(k, list, opts)).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
}

// The calibration curve with an error bar on every band (the same bands as record.calibration).
export function calibrationBars(calls, edges, thinBelow, z = 1.96) {
  return calibration(calls, edges, thinBelow).map((b) => ({ ...b, ci: wilson(b.hits, b.n, z) }));
}

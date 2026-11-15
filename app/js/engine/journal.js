// The journal: the checker, the due date and horizon, the baseline lookup and the edge score.
// Pure functions, no page and no storage, like the rest of app/js/engine/. Every tunable number comes
// from data/scoring.json (the "journal" section) and data/checker_rules.csv, data/journal_baselines.csv.
import { addDays, resolvedList, summarize } from './record.js';
import { groupBy, describeGroup } from './stats.js';

// ---- the checker ----------------------------------------------------------------------------------------

export function compileCheckerRules(rows) {
  return rows.map((r) => ({ flag: r.flag, sense: r.sense, message: r.message, re: new RegExp(r.pattern, 'i') }));
}

// Flags a claim against the rule table: `require` fires when the pattern is absent, `forbid` when it is present.
export function checkClaim(text, rules) {
  const t = text || '';
  return rules.filter((r) => (r.sense === 'require' ? !r.re.test(t) : r.re.test(t))).map((r) => ({ flag: r.flag, message: r.message }));
}

// ---- due date and horizon --------------------------------------------------------------------------------

export function dueDateFor(dueOption, today, cfg) {
  return addDays(today, cfg.due_offset_days[dueOption]);
}
export const horizonFor = (dueOption, cfg) => cfg.horizon_of_due[dueOption];

// ---- the baseline -----------------------------------------------------------------------------------------

// Priority: the player's own resolved rate for this domain and horizon, once there is enough of it;
// else the starter table; else 50% (design/mechanics.md 4.3.4).
export function baselineFor({ domain, horizon, own, starterTable, cfg }) {
  if (own && own.n >= cfg.own_rate_min_resolved) return { b: own.rate, source: 'own' };
  const row = starterTable.find((r) => r.domain === domain && r.horizon === horizon);
  if (row) return { b: Number(row.base_rate), source: 'starter' };
  return { b: 0.5, source: 'default' };
}

// ---- scoring ------------------------------------------------------------------------------------------------

// raw and base both use the core rule: the claim is always "will this happen", so the stated probability
// (c for the player's call, b for the baseline) plays the role of the gym's confidence on the Yes side.
export function journalScore(S, c, b, outcomeYes, edgeWeight) {
  const raw = S.score(c, outcomeYes);
  const base = S.score(b, outcomeYes);
  return { raw, base, edge: edgeWeight * (raw - base) };
}

// The outcome card's "table of other numbers": what the edge would have been at each of the gym's eleven
// confidence steps, holding the baseline and the real outcome fixed. The rows are the steps on the side you leaned
// to (a forecast under 50% leans No, so its rows run 50, 45 ... 1), and your own number gets a row of its own when it
// sits between two steps, so the number you actually said is always in the table, once, marked `mine`.
export function otherNumbers(S, b, outcomeYes, edgeWeight, own = null) {
  const two = (x) => Math.round(x * 100) / 100;
  const leansNo = own !== null && own < 0.5;
  const cs = S.steps.map((c) => (leansNo ? two(1 - c) : c));
  if (own !== null && !cs.some((c) => Math.abs(c - own) < 1e-9)) {
    cs.push(own);
    cs.sort((x, y) => (leansNo ? y - x : x - y));
  }
  return cs.map((c) => ({ c, mine: own !== null && Math.abs(c - own) < 1e-9, ...journalScore(S, c, b, outcomeYes, edgeWeight) }));
}

// ---- the journal-only record ------------------------------------------------------------------------------
// The journal feeds the bias map, but only with calls that say something: resolved (not void), scored (the one a
// day that counts), not trivial (a baseline outside the trivial band is a sure thing) and not self-controlled
// (the checker flagged it at lock). Everything else is still scored and listed, just kept out (mechanics.md 4.3.9).

export const isTrivial = (p, cfg) => p.b < cfg.trivial_band[0] || p.b > cfg.trivial_band[1];
export const isSelfControlled = (p) => Array.isArray(p.flags) && p.flags.includes('self_controlled');
export const countsForMap = (p, cfg) => p.state === 'resolved' && p.outcome !== 'void' && p.scored === true && !isTrivial(p, cfg) && !isSelfControlled(p);

// A forecast written the way the gym writes a call: how sure you were of the side you leaned to, and whether that
// side was right. A forecast of exactly 50% leans Yes, as the gym's dial does. `points` is the edge, so the usual
// sums give total and average edge.
export function asCall(p) {
  const side = p.c >= 0.5 ? 'yes' : 'no';
  return { id: p.id, side, c: side === 'yes' ? p.c : 1 - p.c, hit: (side === 'yes') === (p.outcome === 'yes'), points: p.edge, domain: p.domain, horizon: p.horizon, due: p.due };
}
export const journalCalls = (predictions, cfg) => resolvedList(predictions).filter((p) => countsForMap(p, cfg)).map(asCall);

export function journalRecord(predictions, cfg, opts) {
  const resolved = resolvedList(predictions);
  const calls = journalCalls(predictions, cfg);
  const yes = resolved.filter((p) => countsForMap(p, cfg) && p.outcome === 'yes').length;
  const counted = resolved.filter((p) => countsForMap(p, cfg));
  const grid = {};
  for (const call of calls) {
    const cell = (grid[call.domain] ||= {})[call.horizon] ||= { n: 0, edge: 0 };
    cell.n += 1;
    cell.edge += call.points;
  }
  return {
    resolved: resolved.length,
    voided: resolved.filter((p) => p.outcome === 'void').length,
    unscored: resolved.filter((p) => p.outcome !== 'void' && !p.scored).length,
    kept_out: resolved.filter((p) => p.outcome !== 'void' && p.scored && !countsForMap(p, cfg)).length,
    counted: counted.length,
    yesRate: counted.length ? yes / counted.length : null,
    meanProb: counted.length ? counted.reduce((a, p) => a + p.c, 0) / counted.length : null,
    ...summarizeEdge(calls),
    calls,
    summary: describeGroup('journal', calls, opts),
    byDomain: groupBy(calls, (c) => c.domain, opts),
    byHorizon: groupBy(calls, (c) => c.horizon, opts),
    grid,
  };
}
function summarizeEdge(calls) {
  const s = summarize(calls);
  return { n: s.n, hits: s.hits, hitRate: s.hitRate, meanConf: s.meanConf, gap: s.gap, totalEdge: s.points, meanEdge: s.avgPoints };
}

// "Your pattern", the fourth lens of the case file: the journal record for this card's domain and horizon, always with its
// sample size, and never a conclusion from one case. A group under `min_n` says so instead of saying anything about you.
export function patternFor(predictions, p, cfg, opts) {
  const rec = journalRecord(predictions, cfg, opts);
  const dom = rec.byDomain.find((g) => g.key === p.domain) || null;
  const hor = rec.byHorizon.find((g) => g.key === p.horizon) || null;
  const cell = (rec.grid[p.domain] || {})[p.horizon] || null;
  return { overall: rec, domain: dom, horizon: hor, cell: cell && { ...cell, meanEdge: cell.edge / cell.n }, counts: countsForMap(p, cfg) };
}

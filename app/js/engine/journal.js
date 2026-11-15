// The journal: the checker, the due date and horizon, the baseline lookup and the edge score.
// Pure functions, no page and no storage, like the rest of app/js/engine/. Every tunable number comes
// from data/scoring.json (the "journal" section) and data/checker_rules.csv, data/journal_baselines.csv.

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
  const days = cfg.due_offset_days[dueOption];
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
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
// confidence steps, holding the baseline and the real outcome fixed.
export function otherNumbers(S, b, outcomeYes, edgeWeight) {
  return S.steps.map((c) => ({ c, ...journalScore(S, c, b, outcomeYes, edgeWeight) }));
}

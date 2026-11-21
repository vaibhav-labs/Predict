// The reasoning tools as the journal uses them (design/mechanics.md 4.11): the chain multiplier, the outside-view grade, and the
// four journal patterns they feed (L07 chain blindness, L08 planning fallacy, L09 base-rate neglect, L13 domain blind spot).
// Pure functions of the player's predictions and data/scoring.json. No page, no storage.
import { countsForMap } from './journal.js';

const EPS = 1e-9;
const dayOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// A card is a chain when the player listed two or more things that must all happen (the chain multiplier's steps, each a probability).
export const stepsOf = (p) => (Array.isArray(p.steps) ? p.steps.filter((s) => typeof s.p === 'number') : []);
export const isChainCard = (p) => stepsOf(p).length >= 2;
export const isOwnTask = (p) => p.own === true;
export const chainProductOf = (steps) => steps.reduce((s, x) => s * x.p, 1);

// The outside-view grade: what the player said the usual rate was, against the checker's reference class (the rate recorded as the card's
// baseline when it was locked: the player's own rate for that domain and horizon, else the starter table). Accepted when within accept_within points.
export function outsideGrade(p, cfg) {
  const ov = p.chain && p.chain.outsideView;
  if (!ov || typeof ov.rate !== 'number' || !Number.isFinite(ov.rate)) return null;
  const reference = typeof p.b0 === 'number' ? p.b0 : p.b;
  if (typeof reference !== 'number') return null;
  const gap = ov.rate - reference;
  const within = cfg.problems.rate.accept_within / 100;
  return { stated: ov.rate, reference, gap, accepted: Math.abs(gap) <= within + EPS, within, source: p.bSource };
}
export const acceptedBaseRates = (predictions, cfg) => predictions.filter((p) => { const g = outsideGrade(p, cfg); return g && g.accepted; }).length;

// ---- the observations the four triggers read ----------------------------------------------------------------------------------
const resolvedReal = (preds) => preds.filter((p) => p.state === 'resolved' && (p.outcome === 'yes' || p.outcome === 'no') && p.scored === true)
  .sort((a, b) => (a.resolvedAt < b.resolvedAt ? -1 : a.resolvedAt > b.resolvedAt ? 1 : a.id < b.id ? -1 : 1));
const late = (list, since, readyDay) => list.filter((p) => (!since || p.resolvedAt > since) && (!readyDay || dayOf(p.resolvedAt) >= readyDay));
// How much too sure a set of cards was: the average probability said for the claim minus how often it happened.
export const gapOf = (list) => (list.length ? mean(list.map((p) => p.c)) - list.filter((p) => p.outcome === 'yes').length / list.length : null);

// L07 chains and L08 own tasks: resolved cards of that kind, in the order they resolved.
export const chainObs = (preds, since, readyDay) => late(resolvedReal(preds).filter(isChainCard), since, readyDay);
export const ownObs = (preds, since, readyDay) => late(resolvedReal(preds).filter(isOwnTask), since, readyDay);
// L09: forecasts far from the recorded base rate with no evidence logged. To fire they must have resolved (they need a score); to clear
// they are the player's next such forecasts as locked (resolved or not), after the re-test day.
const farFromBase = (p, t) => typeof p.b === 'number' && Math.abs(p.c - p.b) >= t.distance - EPS;
export const noEvidence = (p) => !(p.chain && Array.isArray(p.chain.evidence) && p.chain.evidence.filter((e) => e && e.text).length > 0);
export const neglectFireObs = (preds, t, since) => late(resolvedReal(preds).filter((p) => farFromBase(p, t) && noEvidence(p)), since);
export const neglectRetestObs = (preds, t, since, readyDay) => preds.filter((p) => farFromBase(p, t) && (!since || p.t > since) && (!readyDay || p.d >= readyDay)).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
// L13: resolved, scored, non-trivial, not self-controlled cards in one domain.
export const domainObs = (preds, jcfg, domain, since, readyDay) => late(preds.filter((p) => p.domain === domain && countsForMap(p, jcfg) && typeof p.edge === 'number'), since, readyDay)
  .sort((a, b) => (a.resolvedAt < b.resolvedAt ? -1 : a.resolvedAt > b.resolvedAt ? 1 : a.id < b.id ? -1 : 1));
export const meanEdge = (list) => (list.length ? mean(list.map((p) => p.edge)) : null);
export const DOMAINS = ['work', 'life', 'world'];

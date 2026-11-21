// What a flag says, in words, from the numbers the engine stored with it. Pure text: no page, no storage.
import { pct } from './engine/scoring.js';

const whole = (x) => Math.round(x * 100);
const bandText = (band) => `${whole(band[0])} to ${whole(band[1])}%`;
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

export const flagName = (ctx, trigger) => ((ctx.triggers || []).find((r) => r.id === trigger) || { name: trigger }).name;

// The record that opened the flag.
export function evidenceText(chain, cfg) {
  const e = chain.evidence || {};
  const t = cfg.lessons.triggers[chain.trigger] || {};
  switch (chain.trigger) {
    case 'L01': return `In your last ${e.n} calls stated at ${bandText(t.band)} you said ${pct(e.meanConf)} on average and were right ${pct(e.hitRate)} of the time: ${whole(e.gap)} points too sure.`;
    case 'L02': return `In your last ${e.n} calls stated at ${bandText(t.band)} you said ${pct(e.meanConf)} on average and were right ${pct(e.hitRate)} of the time: ${whole(e.gap)} points too shy.`;
    case 'L03': return `${e.zone} of your last ${e.n} calls (${pct(e.share)}) were stated at ${bandText(t.zone)}, and you were right ${pct(e.zoneHitRate)} of those. A ${whole(t.zone[0])}% call says you cannot tell the two sides apart. Your record says you often can.`;
    case 'L04': return `${e.rejects} of your last ${e.n} journal predictions needed a rewrite before a stranger could have scored them.`;
    case 'L05': return `Only ${e.hits} of your last ${e.n} ranges held the truth. A true 90% range holds about ${Math.round(0.9 * e.n)}. Your ranges are too narrow: you are giving up the one thing a 90% range promises.`;
    case 'L06': return `${e.hits} of your last ${e.n} ranges held the truth, and they were on average ${Number(e.meanRatio).toFixed(1)} times as wide as the record says they need to be. A range that always holds is padded, and the score charges for every bit of padding.`;
    case 'L07': return `Your last ${e.n} resolved chain cards (predictions that needed several things to all happen) were stated at ${pct(e.meanStated)} on average, and ${pct(e.rate)} of them happened: ${whole(e.gap)} points too sure. Each step looked likely; the chain is the product.`;
    case 'L08': return `Your last ${e.n} resolved predictions about your own tasks and deadlines were stated at ${pct(e.meanStated)} on average, and ${pct(e.rate)} of them happened: ${whole(e.gap)} points too sure. Your own record is the base rate to start from.`;
    case 'L09': return `In your last ${e.n} resolved forecasts that sat ${whole(t.distance)} points or more from the recorded base rate with no evidence logged, you earned ${Math.round(e.meanEdge)} edge points a card on average: worse than the base rate alone. Start outside, then adjust, and log why.`;
    case 'L10': return `${e.n} of your open predictions have waited ${t.news_days} days or more with news in the weekly review and no update: the longest has waited ${e.longest} days. News that nobody acts on is not information, it is a note.`;
    case 'L11': return `${e.reversed} of your last ${e.n} large updates (${whole(t.large)} points or more) were reversed within ${t.reverse_days} days. Each swing felt justified by the news. Together they say the news was worth less than the move.`;
    case 'L13': return `In ${e.domain} you earned ${Math.round(e.meanEdge * 10) / 10} edge points a card over your last ${e.n} resolved predictions: a forecast that just said the baseline would have done better there.`;
    case 'L15': return `You missed ${(e.missed || []).length} of the last ${e.days} days.`;
    default: return '';
  }
}

// What the two re-tests ask, so the player knows what counts.
export function retestText(chain, cfg) {
  const t = cfg.lessons.triggers[chain.trigger] || {};
  const [d1, d2] = cfg.lessons.retest_after_days;
  if (chain.trigger === 'L05' || chain.trigger === 'L06') {
    const [d1, d2] = cfg.lessons.retest_after_days;
    return `Two re-tests clear this flag, on your next ${t.clear_window} ranges: between ${t.clear_hits[0]} and ${t.clear_hits[1]} of them must hold the truth. The first starts ${d1} days after the drill, the second ${d2} days after it. They come from your normal practice: nothing extra to do.`;
  }
  if (chain.trigger === 'L07' || chain.trigger === 'L08') {
    return `Two re-tests clear this flag, on your next ${t.clear_window} ${chain.trigger === 'L07' ? 'chain cards' : 'own-task predictions'} to resolve: how sure you said you were must be within ${whole(t.clear_gap)} points of how often they happened. The first starts ${d1} days after the drill, the second ${d2} days after it. They come from your normal journal: nothing extra to do.`;
  }
  if (chain.trigger === 'L09') return `Two re-tests clear this flag, on your next ${t.clear_window} forecasts that sit ${whole(t.distance)} points or more from the recorded base rate: every one has to carry logged evidence. The first starts ${d1} days after the drill, the second ${d2} days after it.`;
  if (chain.trigger === 'L10') return `Two re-tests clear this flag: update the open predictions that have news waiting (with a line on why), so that none has waited ${t.clear_stale_days} days or more. The first check is ${d1} days after the drill, the second ${d2} days after it.`;
  if (chain.trigger === 'L11') return `Two re-tests clear this flag, on your next ${t.clear_window} large updates (${whole(t.large)} points or more): fewer than ${t.clear_reversed_below} of them may be reversed within ${t.reverse_days} days. The first starts ${d1} days after the drill, the second ${d2} days after it. They come from your normal journal: nothing extra to do.`;
  if (chain.trigger === 'L13') return `Two re-tests clear this flag, on your next ${t.clear_window} resolved predictions in ${(chain.evidence || {}).domain || 'that domain'}: their average edge must be zero or better. The first starts ${d1} days after the drill, the second ${d2} days after it.`;
  const what = chain.trigger === 'L03' ? `your next ${t.clear_window} calls, with fewer than ${whole(t.clear_share)}% of them at ${bandText(t.zone)}`
    : chain.trigger === 'L04' ? `your next ${t.clear_window} journal predictions, every one accepted first time`
      : `your next ${t.clear_window} calls stated at ${bandText(t.band)}, within ${whole(t.clear_gap)} points of honest`;
  return `Two re-tests clear this flag, on ${what}. The first starts ${d1} days after the drill, the second ${d2} days after it. They come from your normal practice: nothing extra to do.`;
}

export const firesText = (chain) => (chain.fires > 1 ? `This pattern has fired ${times(chain.fires)}.` : '');

// What a drill is, in one line, from the trigger's settings.
export function drillText(chain, cfg) {
  const d = (cfg.lessons.triggers[chain.trigger] || {}).drill;
  if (!d) return '';
  switch (d.kind) {
    case 'wheel': return `${d.calls} calls. Each call at 90% or more is checked against the wheel before you lock it: would you rather bet on your answer, or on a wheel that wins that often?`;
    case 'forced': return `${d.calls} calls where you have to commit: 50%, or ${whole(d.steps[1])}% and up. The steps in between are locked.`;
    case 'zone_locked': return `${d.calls} calls with the ${bandText(cfg.lessons.triggers[chain.trigger].zone)} zone locked: pick ${whole(d.min)}% or more.`;
    case 'stepwise': return `${d.calls} ranges built one end at a time: first the low end, then the high end, each one a number you would be surprised to see the truth cross.`;
    case 'budget': return `${d.calls} ranges with a width budget: no range may be wider than ${d.budget_ratio} times the width the record says a 90% range needs. A range over the budget will not lock.`;
    case 'chain': return `${d.calls} chain problems: each lists steps with how often each holds among the cases that passed the ones before. Say what share pass them all, then see the product.`;
    case 'plan': return `${d.calls} base-rate problems about plans and schedules: how often do projects, budgets and flight times turn out as planned? Start from the record, not the story.`;
    case 'classpick': return `${d.calls} reference-class problems: a case and a ladder of groups from everything down to a handful. Pick the narrowest group that still holds ${cfg.problems.rate.class_min_cases} cases.`;
    case 'domain': return `${d.calls} base-rate problems in ${(chain.evidence || {}).domain || 'your weak domain'}: practice at the part you skip, starting from how often it happens.`;
    case 'stream': return `${d.calls} evidence-stream steps: the rate before the news, the news, and your new number. Learn to move as far as the news is worth.`;
    case 'move': return `${d.calls} how-far-should-this-move steps, each one with news worth a big move (${cfg.problems.update.drill_move_min} points or more). See how far the record says to go.`;
    case 'rewrite': return `Rewrite ${d.items} vague predictions until each one passes the checker.`;
    default: return '';
  }
}

// Where a flag's drill happens.
export const drillRoute = (chain) => (chain.trigger === 'L04' ? `#/rewrite/${chain.id}` : chain.trigger === 'L05' || chain.trigger === 'L06' ? `#/range/drill-${chain.id}` : ['L07', 'L08', 'L09', 'L10', 'L11', 'L13'].includes(chain.trigger) ? `#/prob/drill-${chain.id}` : `#/gym/drill-${chain.id}`);

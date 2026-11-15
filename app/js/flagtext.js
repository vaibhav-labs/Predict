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
    case 'rewrite': return `Rewrite ${d.items} vague predictions until each one passes the checker.`;
    default: return '';
  }
}

// Where a flag's drill happens.
export const drillRoute = (chain) => (chain.trigger === 'L04' ? `#/rewrite/${chain.id}` : chain.trigger === 'L05' || chain.trigger === 'L06' ? `#/range/drill-${chain.id}` : `#/gym/drill-${chain.id}`);

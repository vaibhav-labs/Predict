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
    case 'L15': return `You missed ${(e.missed || []).length} of the last ${e.days} days.`;
    default: return '';
  }
}

// What the two re-tests ask, so the player knows what counts.
export function retestText(chain, cfg) {
  const t = cfg.lessons.triggers[chain.trigger] || {};
  const [d1, d2] = cfg.lessons.retest_after_days;
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
    case 'rewrite': return `Rewrite ${d.items} vague predictions until each one passes the checker.`;
    default: return '';
  }
}

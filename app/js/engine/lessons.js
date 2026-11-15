// The lesson engine (design/mechanics.md 4.4 and 4.9): pattern triggers, the flag lifecycle, the instant note and the
// autopsy queue. Everything here is a pure function of the record and the clock, so a trigger can be checked against a
// synthetic player and the same answer comes out every time. No page, no storage. Every threshold comes from
// data/scoring.json ("lessons"), none is written in this file.
//
// A flag's life: open -> lesson read -> drill done -> re-test 1 (3 or more days later) -> re-test 2 (10 or more days
// after the drill) -> cleared. A failed re-test returns it to open and adds a fire; at escalate_after_fires fires it
// goes to the weekly review. Each step is one `flag` event, so the state is a fold of the log.
import { addDays, localDay, callsOf, rangesOf } from './record.js';
import { ledger } from './progress.js';
import * as RS from './reasoning.js';
import * as UP from './update.js';
import * as KN from './know.js';

const EPS = 1e-9;
const inBand = (c, [lo, hi]) => c.c >= lo - EPS && c.c <= hi + EPS;

// The player's own calls, as the triggers read them. Calls of an exam not yet judged are sealed and read by nothing.
export const naturalCalls = (events, cfg) => callsOf(events).filter((e) => cfg.lessons.natural_modes.includes(e.mode));
// The player's own ranges (Unit 3), as L05 and L06 read them: practice and judged exams, never a drill. A range of an exam not yet judged is sealed.
export const naturalRanges = (events) => rangesOf(events).filter((r) => r.mode === 'practice' || r.mode === 'exam');
// A journal prediction the checker had something to say about: flagged while it was written, or on its final wording.
export const rejected = (p) => p.flagged === true || (Array.isArray(p.flags) && p.flags.length > 0);

function stats(list) {
  const n = list.length;
  const meanConf = list.reduce((s, c) => s + c.c, 0) / n;
  const hitRate = list.filter((c) => c.hit).length / n;
  return { n, meanConf, hitRate, gap: meanConf - hitRate };
}
const z = (gap, p, n) => gap / Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);

// ---- the triggers ---------------------------------------------------------------------------------------------
// fire(ctx, since)    -> null, or { evidence, strength }: the pattern is there in the last `window` observations after `since`.
// retest(ctx, since, readyDay) -> null while there are not yet clear_window observations, else { pass, evidence }.
// ctx = { events, calls (natural calls), predictions (journal cards, oldest first), today, cfg (the whole config), t (this trigger's settings) }.
// `since` is a time (ISO string) or '' and counts only observations made after it.

const after = (list, since) => (since ? list.filter((e) => e.t > since) : list);

function bandTrigger(sign) {
  // sign +1: overconfident (stated above the hit rate); -1: underconfident (hit rate above stated).
  return {
    fire({ calls, t }, since) {
      const obs = after(calls, since).filter((c) => inBand(c, t.band));
      if (obs.length < t.window) return null;
      const w = obs.slice(-t.window);
      const st = stats(w);
      if (sign * st.gap < t.gap - 1e-12) return null;
      return { evidence: { n: st.n, meanConf: st.meanConf, hitRate: st.hitRate, gap: sign * st.gap, from: w[0].t, to: w[w.length - 1].t }, strength: z(sign * st.gap, st.meanConf, st.n) };
    },
    retest({ calls, t }, since, readyDay) {
      const obs = after(calls, since).filter((c) => c.d >= readyDay && inBand(c, t.band));
      if (obs.length < t.clear_window) return null;
      const st = stats(obs.slice(0, t.clear_window));
      return { pass: Math.abs(st.gap) <= t.clear_gap + 1e-12, evidence: { n: st.n, meanConf: st.meanConf, hitRate: st.hitRate, gap: sign * st.gap } };
    },
  };
}

const fence = {
  fire({ calls, t }, since) {
    const obs = after(calls, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const zone = w.filter((c) => inBand(c, t.zone));
    const share = zone.length / w.length;
    const zoneHit = zone.length ? zone.filter((c) => c.hit).length / zone.length : 0;
    if (!(share > t.share + 1e-12) || zoneHit < t.hit_rate - 1e-12) return null;
    return { evidence: { n: w.length, zone: zone.length, share, zoneHitRate: zoneHit, from: w[0].t, to: w[w.length - 1].t }, strength: (share - t.share) / Math.sqrt((t.share * (1 - t.share)) / w.length) };
  },
  retest({ calls, t }, since, readyDay) {
    const obs = after(calls, since).filter((c) => c.d >= readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const share = w.filter((c) => inBand(c, t.zone)).length / w.length;
    return { pass: share < t.clear_share - 1e-12, evidence: { n: w.length, share } };
  },
};

const soft = {
  fire({ predictions, t }, since) {
    const obs = after(predictions, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const rejects = w.filter(rejected).length;
    if (rejects < t.rejects) return null;
    const null_ = 0.15;
    return { evidence: { n: w.length, rejects, ids: w.filter(rejected).map((p) => p.id) }, strength: (rejects - null_ * w.length) / Math.sqrt(w.length * null_ * (1 - null_)) };
  },
  retest({ predictions, t }, since, readyDay) {
    const obs = after(predictions, since).filter((p) => p.d >= readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const rejects = w.filter(rejected).length;
    return { pass: rejects <= t.clear_rejects, evidence: { n: w.length, rejects } };
  },
};

// Ranges (Unit 3). L05: fewer than min_hits of the last window ranges held the truth (too narrow). L06: high_hits or more held it and
// the average width was over width_ratio times the reference (padded). Both clear the same way: the next clear_window ranges, after
// the re-test delay, with a number of hits inside clear_hits.
const hitsOf = (w) => w.filter((r) => r.hit).length;
const meanRatio = (w) => w.reduce((s, r) => s + r.ratio, 0) / w.length;
const rangeRetest = {
  retest({ ranges, t }, since, readyDay) {
    const obs = after(ranges, since).filter((r) => r.d >= readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const hits = hitsOf(w);
    return { pass: hits >= t.clear_hits[0] && hits <= t.clear_hits[1], evidence: { n: w.length, hits, rate: hits / w.length, meanRatio: meanRatio(w) } };
  },
};
const rangeNarrow = {
  fire({ ranges, t }, since) {
    const obs = after(ranges, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const hits = hitsOf(w);
    if (hits >= t.min_hits) return null;
    return { evidence: { n: w.length, hits, rate: hits / w.length, meanRatio: meanRatio(w), from: w[0].t, to: w[w.length - 1].t }, strength: (0.9 * w.length - hits) / Math.sqrt(w.length * 0.9 * 0.1) };
  },
  ...rangeRetest,
};
const rangeWide = {
  fire({ ranges, t }, since) {
    const obs = after(ranges, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const hits = hitsOf(w), ratio = meanRatio(w);
    if (hits < t.high_hits || !(ratio > t.width_ratio + 1e-12)) return null;
    return { evidence: { n: w.length, hits, rate: hits / w.length, meanRatio: ratio, from: w[0].t, to: w[w.length - 1].t }, strength: (hits - 0.9 * w.length) / Math.sqrt(w.length * 0.9 * 0.1) + (ratio - t.width_ratio) };
  },
  ...rangeRetest,
};

// Journal reasoning patterns (Block 7). L07 chain blindness and L08 the planning fallacy: the last `window` resolved cards of that kind were
// stated `gap` or more above how often they happened. They clear when the next `clear_window` such cards, resolved after the re-test day, sit
// within `clear_gap` of how often they happened.
const gapTrigger = (obsOf) => ({
  fire({ predictions, t }, since) {
    const obs = obsOf(predictions, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const gap = RS.gapOf(w);
    if (gap < t.gap - EPS) return null;
    return { evidence: { n: w.length, meanStated: w.reduce((s, p) => s + p.c, 0) / w.length, rate: w.filter((p) => p.outcome === 'yes').length / w.length, gap, from: w[0].resolvedAt, to: w[w.length - 1].resolvedAt }, strength: gap / Math.sqrt(0.25 / w.length) };
  },
  retest({ predictions, t }, since, readyDay) {
    const obs = obsOf(predictions, since, readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const gap = RS.gapOf(w);
    return { pass: Math.abs(gap) <= t.clear_gap + EPS, evidence: { n: w.length, gap, meanStated: w.reduce((s, p) => s + p.c, 0) / w.length, rate: w.filter((p) => p.outcome === 'yes').length / w.length } };
  },
});
// L09 base-rate neglect: the last `window` resolved forecasts that sat `distance` or more from the recorded base rate with no evidence logged
// scored below the base rate (a negative average edge). Clears when each of the next `clear_window` such forecasts carries logged evidence.
const baseNeglect = {
  fire({ predictions, t }, since) {
    const obs = RS.neglectFireObs(predictions, t, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const edge = RS.meanEdge(w);
    if (edge === null || edge >= 0) return null;
    return { evidence: { n: w.length, meanEdge: edge, from: w[0].resolvedAt, to: w[w.length - 1].resolvedAt }, strength: -edge / 30 };
  },
  retest({ predictions, t }, since, readyDay) {
    const obs = RS.neglectRetestObs(predictions, t, since, readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const withEvidence = w.filter((p) => !RS.noEvidence(p)).length;
    return { pass: withEvidence === w.length, evidence: { n: w.length, withEvidence } };
  },
};
// L13 domain blind spot: in one domain the last `window` resolved, scored, non-trivial cards earned a negative average edge, which a forecast
// that just said the baseline would have beaten. Clears when the next `clear_window` in that domain average zero or better.
const domainBlind = {
  fire({ predictions, t, cfg }, since) {
    let worst = null;
    for (const d of RS.DOMAINS) {
      const obs = RS.domainObs(predictions, cfg.journal, d, since);
      if (obs.length < t.window) continue;
      const w = obs.slice(-t.window);
      const edge = RS.meanEdge(w);
      if (edge < 0 && (!worst || edge < worst.edge)) worst = { domain: d, edge, w };
    }
    if (!worst) return null;
    return { evidence: { domain: worst.domain, n: worst.w.length, meanEdge: worst.edge, from: worst.w[0].resolvedAt, to: worst.w[worst.w.length - 1].resolvedAt }, strength: -worst.edge / 30 };
  },
  retest({ predictions, t, cfg }, since, readyDay, chain) {
    const d = chain && chain.evidence && chain.evidence.domain;
    const obs = RS.domainObs(predictions, cfg.journal, d, since, readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const edge = RS.meanEdge(w);
    return { pass: edge >= 0, evidence: { domain: d, n: w.length, meanEdge: edge } };
  },
};

// Updating patterns (Block 8). L10 frozen forecasts: `window` or more open cards, older than news_days days, that the weekly review found news for and
// that were not updated since. It clears when no such card has waited clear_stale_days days or more for an update after the drill.
const frozen = {
  fire({ predictions, news, today, t }, since) {
    const cards = UP.frozenCards(predictions, news, today, t).filter((c) => !since || c.written > since.slice(0, 10));
    if (cards.length < t.window) return null;
    return { evidence: { n: cards.length, cards: cards.map((c) => c.prediction), longest: Math.max(...cards.map((c) => c.waited)) }, strength: cards.length / t.window };
  },
  retest({ predictions, news, today, t }, since, readyDay) {
    const cards = UP.frozenCards(predictions, news, today, t).filter((c) => c.waited >= t.clear_stale_days);
    return { pass: cards.length === 0, evidence: { stale: cards.length, cards: cards.map((c) => c.prediction) } };
  },
};
// L11 whiplash: of the last `window` large updates (25 points or more) that can be judged, half or more were reversed within reverse_days days.
// It clears when fewer than clear_reversed_below of the next clear_window large updates were reversed.
const whiplash = {
  fire({ predictions, today, t }, since) {
    const obs = UP.whiplashObs(predictions, today, t, since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const reversed = w.filter((m) => m.reversed).length;
    if (reversed / w.length < t.reverse_share - EPS) return null;
    return { evidence: { n: w.length, reversed, from: w[0].t, to: w[w.length - 1].t }, strength: reversed / w.length };
  },
  retest({ predictions, today, t }, since, readyDay) {
    const obs = UP.whiplashObs(predictions, today, t, since, readyDay);
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const reversed = w.filter((m) => m.reversed).length;
    return { pass: reversed < t.clear_reversed_below, evidence: { n: w.length, reversed } };
  },
};

// L12 rewritten memory (Block 9): over the last `window` memory checks the recalled forecast sat `min_shift` or more closer to what happened than the recorded one,
// on average. It clears when the next `clear_window` checks (after the drill, from the ready day on) average a drift within `clear_within`, either way.
const memoryDrift = {
  fire({ events, predictions, t }, since) {
    const obs = KN.memoryObs(events, predictions).filter((o) => !since || o.t > since);
    if (obs.length < t.window) return null;
    const w = obs.slice(-t.window);
    const drift = KN.memoryStats(w, 0).drift;
    if (drift < t.min_shift - EPS) return null;
    return { evidence: { n: w.length, drift, from: w[0].t, to: w[w.length - 1].t }, strength: drift / t.min_shift };
  },
  retest({ events, predictions, t }, since, readyDay) {
    const obs = KN.memoryObs(events, predictions).filter((o) => (!since || o.t > since) && (!readyDay || o.d >= readyDay));
    if (obs.length < t.clear_window) return null;
    const w = obs.slice(0, t.clear_window);
    const drift = KN.memoryStats(w, 0).drift;
    return { pass: Math.abs(drift) <= t.clear_within + EPS, evidence: { n: w.length, drift } };
  },
};

// Missed days (L15) is a habit flag: no lesson, no re-test. It fires on missed days in the last window_days, and clears
// after clear_days played days in a row that each hold the minimum session.
function missedDays(ctx, sinceDay) {
  const { events, today, cfg, t } = ctx;
  const led = ledger(events, today, cfg.habit);
  if (!led.rows.length) return null;
  const first = led.rows[0].d;
  const missed = [];
  for (let i = t.window_days; i >= 1; i--) {
    const d = addDays(today, -i);
    if (d < first || (sinceDay && d <= sinceDay)) continue;
    const row = led.byDay.get(d);
    if (!row || !row.played) missed.push(d);
  }
  if (missed.length < t.missed) return null;
  return { evidence: { missed, days: t.window_days }, strength: Infinity };
}
// A day holds the minimum session when it has minimum.gym_calls calls and minimum.predictions predictions written (the
// reveal comes with the calls). The run is the number of such days in a row, today counting once it holds the minimum.
function minimumRun(ctx, fromDay) {
  const { events, today, t } = ctx;
  const calls = new Map(), preds = new Map();
  for (const e of events) {
    if (e.d < fromDay) continue;
    if (e.type === 'call') calls.set(e.d, (calls.get(e.d) || 0) + 1);
    else if (e.type === 'prediction') preds.set(e.d, (preds.get(e.d) || 0) + 1);
  }
  let run = 0;
  for (let d = fromDay; d <= today; d = addDays(d, 1)) {
    if ((calls.get(d) || 0) >= t.minimum.gym_calls && (preds.get(d) || 0) >= t.minimum.predictions) run++;
    else if (d < today) run = 0; // a day without the minimum breaks the run (today is still going)
  }
  return run;
}

// How far the missed-days flag has got: played days in a row that held the minimum, out of the clear_days it needs.
export const habitProgress = (chain, events, { today, cfg }) => ({
  run: minimumRun({ events, today, t: cfg.lessons.triggers.L15 }, chain.openedDay), need: cfg.lessons.triggers.L15.clear_days,
});

export const TRIGGERS = {
  L01: bandTrigger(+1),
  L02: bandTrigger(-1),
  L03: fence,
  L04: soft,
  L05: rangeNarrow,
  L06: rangeWide,
  L07: gapTrigger(RS.chainObs),
  L08: gapTrigger(RS.ownObs),
  L09: baseNeglect,
  L10: frozen,
  L11: whiplash,
  L12: memoryDrift,
  L13: domainBlind,
  L15: { habit: true },
};
export const PATTERN_IDS = Object.keys(TRIGGERS).filter((id) => !TRIGGERS[id].habit);

// ---- the flag lifecycle, as a fold over `flag` events ----------------------------------------------------------
export const ACTIVE = new Set(['open', 'lesson', 'drill', 'retest2']);

export function flagsOf(events, cfg) {
  const chains = new Map();
  const list = [];
  for (const e of events) {
    if (e.type !== 'flag') continue;
    if (e.state === 'open') {
      const c = { id: e.id, trigger: e.trigger, state: 'open', fires: e.fire || 1, openedAt: e.t, openedDay: e.d, evidence: e.evidence || {}, lesson: null, drill: null, retests: [], clearedAt: null, clearedDay: null, escalatedAt: null, history: [e] };
      chains.set(e.id, c);
      list.push(c);
      continue;
    }
    const c = chains.get(e.flag);
    if (!c) continue; // an event about a flag this record does not hold: kept in the log, ignored here
    c.history.push(e);
    if (e.state === 'lesson' && c.state === 'open') { c.state = 'lesson'; c.lesson = { t: e.t, d: e.d }; }
    else if (e.state === 'drill' && (c.state === 'open' || c.state === 'lesson')) { c.state = 'drill'; c.drill = { t: e.t, d: e.d, session: e.session }; c.retests = []; }
    else if (e.state === 'retest' && (c.state === 'drill' || c.state === 'retest2') && e.step === (c.state === 'drill' ? 1 : 2)) {
      if (e.pass) {
        c.retests.push(e);
        if (e.step === 1) c.state = 'retest2';
        else { c.state = 'cleared'; c.clearedAt = e.t; c.clearedDay = e.d; }
      } else {
        c.fires += 1; c.lesson = null; c.drill = null; c.retests = [];
        if (c.fires >= cfg.lessons.escalate_after_fires) { c.state = 'escalated'; c.escalatedAt = e.t; } else c.state = 'open';
      }
    } else if (e.state === 'cleared' && ACTIVE.has(c.state)) { c.state = 'cleared'; c.clearedAt = e.t; c.clearedDay = e.d; }
  }
  return list;
}

// What a chain waits for next: { step, readyDay, since } for a re-test, or null.
export function waitingFor(chain, cfg) {
  const [d1, d2] = cfg.lessons.retest_after_days;
  if (chain.state === 'drill') return { step: 1, readyDay: addDays(chain.drill.d, d1), since: chain.drill.t };
  if (chain.state === 'retest2') return { step: 2, readyDay: addDays(chain.drill.d, d2), since: chain.retests[0].t };
  return null;
}

// How far a chain's next re-test has got: the observations that would count (made after the drill, from the ready day on),
// and how many it needs. `have` is capped at `need`.
export function retestProgress(chain, events, { cfg, predictions, today, news = {} }) {
  const wait = waitingFor(chain, cfg);
  if (!wait) return null;
  const t = cfg.lessons.triggers[chain.trigger];
  const calls = naturalCalls(events, cfg).filter((c) => (wait.since ? c.t > wait.since : true) && c.d >= wait.readyDay);
  const preds = (predictions || []).filter((p) => (wait.since ? p.t > wait.since : true) && p.d >= wait.readyDay);
  const ranges = naturalRanges(events).filter((r) => (wait.since ? r.t > wait.since : true) && r.d >= wait.readyDay);
  const sinceT = wait.since || '';
  const predObs = { L07: () => RS.chainObs(predictions || [], sinceT, wait.readyDay), L08: () => RS.ownObs(predictions || [], sinceT, wait.readyDay), L09: () => RS.neglectRetestObs(predictions || [], t, sinceT, wait.readyDay),
    L13: () => RS.domainObs(predictions || [], cfg.journal, chain.evidence && chain.evidence.domain, sinceT, wait.readyDay) }[chain.trigger];
  if (chain.trigger === 'L10') {
    const stale = UP.frozenCards(predictions || [], news, today, t).filter((c) => c.waited >= t.clear_stale_days).length;
    return { step: wait.step, readyDay: wait.readyDay, need: 1, have: stale === 0 && today >= wait.readyDay ? 1 : 0, ready: today >= wait.readyDay, stale };
  }
  if (chain.trigger === 'L12') {
    const have12 = KN.memoryObs(events, predictions || []).filter((o) => (!sinceT || o.t > sinceT) && (!wait.readyDay || o.d >= wait.readyDay)).length;
    return { step: wait.step, readyDay: wait.readyDay, need: t.clear_window, have: Math.min(have12, t.clear_window), ready: today >= wait.readyDay };
  }
  if (chain.trigger === 'L11') {
    const have11 = UP.whiplashObs(predictions || [], today, t, sinceT, wait.readyDay).length;
    return { step: wait.step, readyDay: wait.readyDay, need: t.clear_window, have: Math.min(have11, t.clear_window), ready: today >= wait.readyDay };
  }
  const have = predObs ? predObs().length : chain.trigger === 'L04' ? preds.length : chain.trigger === 'L03' ? calls.length
    : chain.trigger === 'L05' || chain.trigger === 'L06' ? ranges.length : calls.filter((c) => inBand(c, t.band)).length;
  return { step: wait.step, readyDay: wait.readyDay, need: t.clear_window, have: Math.min(have, t.clear_window), ready: today >= wait.readyDay };
}

// The drill a flag asks for, from the trigger's settings: { kind, calls | items, steps?, min? }.
export const drillOf = (trigger, cfg) => (cfg.lessons.triggers[trigger] || {}).drill || null;

const lastChain = (chains, id) => chains.filter((c) => c.trigger === id).pop() || null;

// What to write to the record now. Returns { append: [event fields], notices } and never writes anything itself, so
// running it twice in a row appends nothing the second time. Call it when a session ends, after a lock, and when Today opens.
export function evaluate(events, { today = localDay(), cfg, predictions, news = {} }) {
  const L = cfg.lessons;
  const chains = flagsOf(events, cfg);
  const calls = naturalCalls(events, cfg);
  const preds = predictions.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : 1));
  const base = { events, calls, ranges: naturalRanges(events), predictions: preds, today, cfg, news };
  const append = [];

  // 1. Re-tests that have enough observations, and the L15 run. `stays` is whether each chain is still in repair afterwards.
  const stays = new Map(chains.map((c) => [c.id, ACTIVE.has(c.state) && c.trigger !== 'L15']));
  for (const c of chains) {
    const trig = TRIGGERS[c.trigger];
    const t = L.triggers[c.trigger];
    if (!trig || !t) continue;
    if (trig.habit) {
      if (c.state === 'open' && minimumRun({ ...base, t }, c.openedDay) >= t.clear_days) append.push({ type: 'flag', state: 'cleared', flag: c.id, evidence: { days: t.clear_days } });
      continue;
    }
    const wait = waitingFor(c, cfg);
    if (!wait) continue;
    const res = trig.retest({ ...base, t }, wait.since, wait.readyDay, c);
    if (!res) continue;
    append.push({ type: 'flag', state: 'retest', flag: c.id, step: wait.step, pass: res.pass, evidence: res.evidence });
    // A pass at step 1 stays in repair, a pass at step 2 clears; a fail reopens the flag, or sends it to the review at the last fire.
    stays.set(c.id, res.pass ? wait.step === 1 : c.fires + 1 < L.escalate_after_fires);
  }

  // 2. New fires, strongest first (missed days always first), within the limits.
  const stillActive = chains.filter((c) => stays.get(c.id)).length;
  const openedToday = chains.filter((c) => c.openedDay === today && c.trigger !== 'L15').length;
  const found = [];
  for (const id of Object.keys(L.triggers)) {
    const t = L.triggers[id];
    const trig = TRIGGERS[id];
    if (!trig) continue;
    const last = lastChain(chains, id);
    if (last && last.state !== 'cleared') continue; // one chain per trigger at a time (escalated ones wait for the review)
    const since = last ? last.clearedAt : '';
    const res = trig.habit ? missedDays({ ...base, t }, last ? last.clearedDay : '') : trig.fire({ ...base, t }, since);
    if (res) found.push({ id, ...res });
  }
  found.sort((a, b) => (a.id === 'L15' ? -1 : b.id === 'L15' ? 1 : b.strength - a.strength || (a.id < b.id ? -1 : 1)));
  let active = stillActive, newToday = openedToday;
  // Missed days changes the shape of the session, not the load of lessons, so it neither counts toward the two flags in repair
  // nor waits behind them.
  for (const f of found) {
    if (f.id !== 'L15' && (active >= L.max_in_repair || newToday >= L.max_new_per_day)) continue;
    const prior = chains.filter((c) => c.trigger === f.id).length;
    append.push({ type: 'flag', state: 'open', trigger: f.id, fire: 1, evidence: f.evidence, chain: prior + 1 });
    if (f.id !== 'L15') { active++; newToday++; }
  }
  return { append };
}

// ---- luck or judgment -------------------------------------------------------------------------------------------
// How often the outcome that happened happens in cases like it. A recorded question knows (its `base` is the chance that its
// claim holds among the other cases); a documented fact from a source has no count of cases, so it has no chance to quote.
export const outcomeChance = (q) => (q && typeof q.base === 'number' ? (q.answer ? q.base : 1 - q.base) : null);
// A miss was luck when the outcome that beat you is a rare one (under lessons.luck_rare_below of cases like it), and
// judgment otherwise, which includes every case the records say nothing about: with nothing to blame, the call was the problem.
export const luckOrJudgment = (chance, cfg) => (chance !== null && chance !== undefined && chance < cfg.lessons.luck_rare_below - EPS ? 'luck' : 'judgment');
// The same for a journal card: the outcome's chance at the baseline `b` (the chance of yes).
export const cardOutcomeChance = (p) => (p.outcome === 'yes' ? p.b : p.outcome === 'no' ? 1 - p.b : null);

// ---- the instant note (A01) ------------------------------------------------------------------------------------
// A gym miss stated at note_threshold or more: the answer, why the wrong side tempted you, and what a calibrated call
// looked like, from your own record when there is enough of it. `luck` says whether the records call the outcome rare.
export function instantNote(call, question, earlierCalls, S, cfg) {
  if (call.hit || call.c < S.noteThreshold - EPS) return null;
  const near = (x) => S.steps.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), S.steps[0]);
  const same = earlierCalls.filter((c) => cfg.lessons.natural_modes.includes(c.mode) && c.c >= call.c - EPS);
  let calibrated;
  if (same.length >= 5) {
    const hit = same.filter((c) => c.hit).length / same.length;
    calibrated = { kind: 'own', n: same.length, hitRate: hit, step: near(hit) };
  } else {
    calibrated = { kind: 'plain', oneIn: Math.round(1 / (1 - call.c)) };
  }
  const chance = outcomeChance(question);
  return { answer: question.fact, tempted: question.why || null, calibrated, luck: { kind: luckOrJudgment(chance, cfg), chance, n: typeof question.n === 'number' ? question.n : null } };
}

// ---- the autopsy (A02) -----------------------------------------------------------------------------------------
// A scored, resolved, non-void card needs an autopsy when it missed at autopsy.min_confidence or more, and one in every
// hit_sample_every confident hits is sampled too (the 5th, 10th ... in the order they resolved), so right-for-the-wrong-
// reason gets caught. Until it is filed, the next journal step waits.
export function sideOf(p) {
  // The forecast that stood when the card resolved (an update replaces the locked number).
  const c0 = typeof p.cNow === 'number' ? p.cNow : p.c;
  const yes = c0 >= 0.5;
  return { yes, c: yes ? c0 : 1 - c0, hit: yes === (p.outcome === 'yes') };
}

export function autopsyDue(predictions, events, cfg, allFrom = null) {
  const A = cfg.lessons.autopsy;
  const done = new Map(events.filter((e) => e.type === 'autopsy').map((e) => [e.prediction, e]));
  const resolved = predictions.filter((p) => p.state === 'resolved' && p.outcome !== 'void' && p.scored)
    .sort((a, b) => (a.resolvedAt < b.resolvedAt ? -1 : a.resolvedAt > b.resolvedAt ? 1 : a.id < b.id ? -1 : 1));
  const needed = [];
  let confidentHits = 0;
  for (const p of resolved) {
    const s = sideOf(p);
    let kind = null;
    if (s.c >= A.min_confidence - EPS) {
      if (!s.hit) kind = 'miss';
      else if (++confidentHits % A.hit_sample_every === 0) kind = 'hit_sample';
    }
    // From Unit 8 on (`allFrom` is the time Unit 8 opened) every case that resolves gets an autopsy, whatever its confidence and result.
    if (!kind && allFrom && p.resolvedAt > allFrom) kind = 'case';
    if (kind) needed.push({ p, kind });
  }
  return { pending: needed.filter((n) => !done.has(n.p.id)), done, needed };
}
export const needsAutopsy = (p, due) => due.needed.find((n) => n.p.id === p.id) || null;

// The rule you wrote at an autopsy sits above your next rule_card_cards journal cards. A card counts once it is locked
// after the autopsy.
export function ruleCards(events, cfg) {
  const A = cfg.lessons.autopsy;
  const preds = events.filter((e) => e.type === 'prediction');
  return events.filter((e) => e.type === 'autopsy' && e.rule)
    .map((a) => ({ autopsy: a, rule: a.rule, since: preds.filter((p) => p.t > a.t).length }))
    .filter((r) => r.since < A.rule_card_cards)
    .sort((x, y) => (x.autopsy.t < y.autopsy.t ? 1 : -1));
}

// Re-checks of a rule at recheck_days after the autopsy: "did you use it?" Due once the day arrives, until answered.
export function rechecksDue(events, today, cfg) {
  const out = [];
  const answered = new Set(events.filter((e) => e.type === 'recheck').map((e) => `${e.autopsy}:${e.step}`));
  for (const a of events.filter((e) => e.type === 'autopsy' && e.rule)) {
    cfg.lessons.autopsy.recheck_days.forEach((n, i) => {
      const dueDay = addDays(a.d, n);
      if (today >= dueDay && !answered.has(`${a.id}:${i + 1}`)) out.push({ autopsy: a, step: i + 1, dueDay });
    });
  }
  return out.sort((x, y) => (x.dueDay < y.dueDay ? -1 : 1));
}

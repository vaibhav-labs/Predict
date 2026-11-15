// The Mirror: where the numbers live. A first calibration curve with an error bar on every band, the bias map split by
// topic, domain and horizon, the journal-only record, level, streak, the seven-day score and the belts.
// Every statistic shows its sample size, and a group too small to say anything says "too few".
import { gateState, rangeGateState, problemGateState } from '../flags.js';
import * as PB from '../engine/problem.js';
import * as RS from '../engine/reasoning.js';
import * as RG from '../engine/range.js';
import { KIND_NAMES } from './ranges.js';
import { KIND_NAMES as PROB_KINDS } from './problems.js';
import { h, s } from '../dom.js';
import * as R from '../engine/record.js';
import * as J from '../engine/journal.js';
import * as ST from '../engine/stats.js';
import * as P from '../engine/progress.js';
import * as LE from '../engine/lessons.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { tabFrame, unitRow, picker, cap1, DOMAIN_NAMES, HORIZON_NAMES } from './common.js';
import { standingOf, standingTiles, weekStrip } from './standing.js';

// The calibration curve. x: how sure you said you were (mean stated confidence in each band). y: how often you were
// right, with a 95% Wilson error bar. The dashed diagonal is a perfectly honest player. The number of calls sits under every point.
export function curveChart(bands, edges) {
  const W = 350, H = 268, L = 38, R_ = 14, T = 12, B = 70;
  const pw = W - L - R_, ph = H - T - B;
  const x = (c) => L + ((c - 0.5) / 0.5) * pw;
  const y = (r) => T + (1 - r) * ph;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Calibration curve: how often you were right at each level of stated confidence, with error bars', id: 'curve' });
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(s('line', { class: 'axis', x1: L, x2: W - R_, y1: y(r), y2: y(r) }), s('text', { x: L - 6, y: y(r) + 4, 'text-anchor': 'end' }, `${Math.round(r * 100)}`));
  }
  for (const c of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) svg.append(s('text', { x: x(c), y: y(0) + 14, 'text-anchor': 'middle' }, `${Math.round(c * 100)}`));
  svg.append(s('line', { class: 'diag', x1: x(0.5), y1: y(0.5), x2: x(1), y2: y(1) }));
  svg.append(s('text', { x: x(1), y: y(0.99) + 32, 'text-anchor': 'end' }, 'honest'));
  const solid = bands.filter((b) => b.n > 0 && !b.thin);
  if (solid.length > 1) svg.append(s('polyline', { class: 'line', points: solid.map((b) => `${x(b.meanConf).toFixed(1)},${y(b.hitRate).toFixed(1)}`).join(' ') }));
  bands.forEach((b, i) => {
    const mid = (b.lo + Math.min(b.hi, 1)) / 2;
    const cx = x(Math.min(mid, 0.975));
    if (b.n > 0 && b.ci) {
      const px = x(b.meanConf);
      svg.append(
        s('line', { class: `eb${b.thin ? ' thin' : ''}`, x1: px, x2: px, y1: y(b.ci.hi), y2: y(b.ci.lo) }),
        s('line', { class: `eb cap${b.thin ? ' thin' : ''}`, x1: px - 4, x2: px + 4, y1: y(b.ci.hi), y2: y(b.ci.hi) }),
        s('line', { class: `eb cap${b.thin ? ' thin' : ''}`, x1: px - 4, x2: px + 4, y1: y(b.ci.lo), y2: y(b.ci.lo) }));
    }
    if (b.n > 0) svg.append(s('circle', { class: `pt${b.thin ? ' thin' : ''}`, cx: x(b.meanConf), cy: y(b.hitRate), r: 5 }));
    svg.append(
      s('text', { class: `n${b.thin ? ' thin' : ''}`, x: cx, y: y(0) + 34, 'text-anchor': 'middle' }, `n=${b.n}`),
      s('text', { class: b.thin ? 'thin' : '', x: cx, y: y(0) + 48, 'text-anchor': 'middle' }, `${Math.round(b.lo * 100)}–${i === bands.length - 1 ? '99' : Math.round(b.hi * 100) - 1}`));
  });
  svg.append(s('text', { x: L + pw / 2, y: H - 4, 'text-anchor': 'middle' }, 'how sure you said you were (%)'));
  svg.append(s('text', { x: 10, y: T + ph / 2, transform: `rotate(-90 10 ${T + ph / 2})`, 'text-anchor': 'middle' }, 'how often right (%)'));
  return svg;
}

// The bias map: one row per group, a bar for the gap (average confidence minus hit rate, in points) and a whisker for
// the 95% interval on it. Right of the line is too sure, left is too shy. A group under thin_below is drawn hollow.
const RANGE = 30; // points either side of honest
export function biasChart(groups, labelOf) {
  const rowH = 34, top = 22, L = 104, Rm = 12, W = 350;
  const H = top + groups.length * rowH + 8;
  const pw = W - L - Rm;
  const x = (g) => L + ((Math.max(-RANGE, Math.min(RANGE, g)) + RANGE) / (2 * RANGE)) * pw;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', id: 'bias-chart', 'aria-label': 'Bias map: for each group, how many points too sure or too shy you were, with an error bar' });
  svg.append(s('text', { class: 'ax', x: x(0) - 6, y: 12, 'text-anchor': 'end' }, '← too shy'), s('text', { class: 'ax', x: x(0) + 6, y: 12, 'text-anchor': 'start' }, 'too sure →'));
  svg.append(s('line', { class: 'zero', x1: x(0), x2: x(0), y1: top - 4, y2: H - 4 }));
  groups.forEach((g, i) => {
    const cy = top + i * rowH + rowH / 2;
    const gp = g.gap * 100, lo = g.gapLo * 100, hi = g.gapHi * 100;
    const row = s('g', { class: 'bm', 'data-key': g.key, 'data-n': g.n, 'data-gap': gp.toFixed(6), 'data-lo': lo.toFixed(6), 'data-hi': hi.toFixed(6), 'data-verdict': g.verdict });
    row.append(s('text', { class: 'lab', x: 0, y: cy - 2 }, labelOf(g.key)), s('text', { class: 'sub', x: 0, y: cy + 12 }, `n=${g.n}`));
    const x0 = x(0), x1 = x(gp);
    row.append(s('rect', { class: `bar ${gp >= 0 ? 'sure' : 'shy'}${g.thin ? ' thin' : ''}`, x: Math.min(x0, x1), y: cy - 7, width: Math.max(1, Math.abs(x1 - x0)), height: 14, rx: 2 }));
    row.append(s('line', { class: `eb${g.thin ? ' thin' : ''}`, x1: x(lo), x2: x(hi), y1: cy, y2: cy }), s('line', { class: `eb cap${g.thin ? ' thin' : ''}`, x1: x(lo), x2: x(lo), y1: cy - 5, y2: cy + 5 }), s('line', { class: `eb cap${g.thin ? ' thin' : ''}`, x1: x(hi), x2: x(hi), y1: cy - 5, y2: cy + 5 }));
    svg.append(row);
  });
  return svg;
}

function biasList(groups, labelOf, perWhat) {
  return h('ul', { class: 'rows', id: 'bias-list' }, groups.map((g) => h('li', { 'data-key': g.key },
    h('div', { class: 't' }, h('span', null, labelOf(g.key)),
      h('em', null, g.thin ? `n=${g.n} · too few to say anything` : `n=${g.n} · right ${pct(g.hitRate)} · said ${pct(g.meanConf)}`)),
    h('span', { class: `m num${!g.thin && g.gap > 0.02 ? ' bad' : ''}` }, g.thin ? '–' : `${gapPts(g.gap)} pts`),
    h('span', { class: 'cap', style: 'min-width:74px;text-align:right' }, g.verdict))));
}

const topicName = (k) => cap1(k);
const SPLITS = [['topic', 'Topic'], ['domain', 'Domain'], ['horizon', 'Horizon']];

export function mirrorScreen(ctx) {
  const events = ctx.store.events;
  const cfg = ctx.cfg.mirror;
  const opts = { z: cfg.error_bar_z, thinBelow: cfg.thin_below };
  const calls = R.callsOf(events);
  const sum = R.summarize(calls);
  const today = R.localDay();
  const predictions = R.predictionsOf(events, today);
  const jrec = J.journalRecord(predictions, ctx.cfg.journal, opts);
  const base = R.baselineProgress(events, Number(unitRow(ctx, 'U0').practice_calls));
  const gap = sum.gap;
  const st = standingOf(ctx);
  const view = { curve: 'gym', split: 'topic' };

  // ---- standing: level, streak, seven days ----
  const standingCard = h('section', { class: 'card stack', id: 'standing' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Standing'), h('span', { class: 'cap num', id: 'career' }, `${st.led.career} career points`)),
    standingTiles(st),
    weekStrip(st.seven),
    h('p', { class: 'cap', id: 'seven-beat' }, st.seven.beating === null ? 'Seven-day average counts played days only.' : st.seven.beating ? `Today is above your average of the seven days before (${signed(Math.round(st.seven.previous.avgPerDay))} a day).` : `Today is at or below your average of the seven days before (${signed(Math.round(st.seven.previous.avgPerDay))} a day).`));

  // ---- the curve, gym or journal ----
  const curveBody = h('div', { class: 'stack', id: 'curve-body' });
  const curveCount = h('span', { class: 'cap num', id: 'curve-count' });
  function paintCurve() {
    const which = view.curve;
    const src = which === 'gym' ? calls : jrec.calls;
    const bands = ST.calibrationBars(src, cfg.band_edges, cfg.thin_below, cfg.error_bar_z);
    const enough = src.length >= cfg.min_calls_for_curve;
    curveCount.textContent = which === 'gym' ? `${sum.n} calls` : `${src.length} resolved cards`;
    curveBody.replaceChildren(
      enough ? curveChart(bands, cfg.band_edges)
        : h('p', { class: 'lede', id: 'curve-empty' }, which === 'gym'
          ? `The curve needs at least ${cfg.min_calls_for_curve} calls. You have ${sum.n}. ${base.complete ? '' : `The baseline finishes at ${base.total}.`}`
          : `The journal curve needs at least ${cfg.min_calls_for_curve} resolved, scored cards. You have ${src.length}.`),
      h('p', { class: 'cap' }, `A dot on the dashed line means that when you said X% you were right X% of the time. Above it, you were too shy. Below it, too sure. The bar on each dot is a ${Math.round(0.95 * 100)}% error bar: the range of true rates your calls do not rule out. A band with fewer than ${cfg.thin_below} calls is drawn hollow with a dashed bar: treat it as a hint, not a result.`));
  }
  const curveCard = h('section', { class: 'card curve stack' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Calibration curve'), curveCount),
    picker([['gym', 'Gym'], ['journal', 'Journal']], view.curve, (v) => { view.curve = v; paintCurve(); }, { id: 'curve-source' }),
    curveBody);
  paintCurve();

  // ---- the bias map: topic (gym), domain and horizon (journal) ----
  const biasBody = h('div', { class: 'stack', id: 'bias-body' });
  const biasCount = h('span', { class: 'cap num', id: 'bias-count' });
  function paintBias() {
    let groups, labelOf, n, what;
    if (view.split === 'topic') { groups = ST.groupBy(calls, (c) => c.domain, opts); labelOf = topicName; n = calls.length; what = 'gym calls'; }
    else if (view.split === 'domain') { groups = jrec.byDomain; labelOf = (k) => DOMAIN_NAMES[k] || k; n = jrec.calls.length; what = 'resolved cards'; }
    else { groups = jrec.byHorizon; labelOf = (k) => HORIZON_NAMES[k] || k; n = jrec.calls.length; what = 'resolved cards'; }
    biasCount.textContent = `${n} ${what}`;
    biasBody.replaceChildren(
      groups.length ? biasChart(groups, labelOf) : h('p', { class: 'lede', id: 'bias-empty' }, view.split === 'topic' ? 'No calls yet.' : 'No resolved, scored journal cards yet. They arrive as predictions come due.'),
      groups.length ? biasList(groups, labelOf) : null,
      h('p', { class: 'cap' }, `The bar is the gap in points between how sure you said you were and how often you were right (the whisker is the 95% error bar on it). Right of the line, too sure. Left, too shy. Under ${cfg.thin_below} calls a group says "too few" and claims nothing.`));
  }
  const biasCard = h('section', { class: 'card curve stack', id: 'bias-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Bias map'), biasCount),
    picker(SPLITS, view.split, (v) => { view.split = v; paintBias(); }, { id: 'bias-split' }),
    biasBody);
  paintBias();

  // ---- journal-only record ----
  const horizons = ['week', 'month', 'longer'], domains = ctx.cfg.journal.domains;
  const jcard = h('section', { class: 'card stack', id: 'journal-record' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Journal record'), h('span', { class: 'cap num', id: 'jr-n' }, `n=${jrec.n}`)),
    h('table', { class: 'tbl', id: 'jr-table' }, h('tbody', null,
      jrow('Resolved', String(jrec.resolved), `${jrec.voided} void · ${jrec.unscored} extra · ${jrec.kept_out} kept out`),
      jrow('Counted', String(jrec.n), 'scored, not void, not trivial'),
      jrow('Happened', jrec.n ? pct(jrec.yesRate) : '–', `n=${jrec.n}`),
      jrow('Said on average', jrec.n ? pct(jrec.meanProb) : '–', `n=${jrec.n}`),
      jrow('Edge', jrec.n ? `${signed(Math.round(jrec.meanEdge))} a card` : '–', jrec.n ? `total ${signed(jrec.totalEdge)}` : ''))),
    h('div', { class: 'eyebrow', style: 'margin-top:4px' }, 'Domain by horizon: cards and average edge'),
    h('table', { class: 'tbl grid', id: 'jr-grid' },
      h('thead', null, h('tr', null, h('th', null, ''), horizons.map((hz) => h('th', null, cap1(hz))))),
      h('tbody', null, domains.map((d) => h('tr', { 'data-domain': d }, h('td', null, DOMAIN_NAMES[d] || d),
        horizons.map((hz) => { const c = (jrec.grid[d] || {})[hz]; return h('td', { 'data-horizon': hz, 'data-n': c ? c.n : 0 }, c ? `n=${c.n} ${signed(Math.round(c.edge / c.n))}` : 'n=0'); }))))));

  // ---- ranges (Unit 3): how often your 90% ranges held the truth, and how wide they were ----
  const natural = LE.naturalRanges(events);
  const rd = RG.describeRanges(natural, { thinBelow: cfg.thin_below, coverage: ctx.cfg.interval.coverage });
  const kinds = RG.rangesByKind(natural, { thinBelow: cfg.thin_below, coverage: ctx.cfg.interval.coverage });
  const rangeCard = natural.length ? h('section', { class: 'card stack', id: 'range-record' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Ranges'), h('span', { class: 'cap num', id: 'rr-n' }, `n=${rd.n}`)),
    h('table', { class: 'tbl', id: 'rr-table' }, h('tbody', null,
      row('Held the truth', `${rd.hits} of ${rd.n} (${pct(rd.rate)})`, 'a true 90% range: 9 in 10'),
      row('Error bar', `${pct(rd.ci.lo)} to ${pct(rd.ci.hi)}`, '95%'),
      row('Reading', rd.verdict, rd.thin ? `under ${cfg.thin_below} ranges` : ''),
      row('Width against reference', `${rd.meanRatio.toFixed(1)}×`, `middle ${rd.medianRatio.toFixed(1)}×`),
      row('Points', signed(rd.points), `${signed(Math.round(rd.avgPoints))} a range`))),
    h('div', { class: 'eyebrow', style: 'margin-top:4px' }, 'By kind of question'),
    h('ul', { class: 'rows', id: 'rr-kinds' }, kinds.map((k) => h('li', { 'data-kind': k.kind },
      h('div', { class: 't' }, h('span', null, KIND_NAMES[k.kind] || k.kind), h('em', null, k.thin ? `n=${k.n} · too few to say anything` : `n=${k.n} · held ${pct(k.rate)} · ${k.meanRatio.toFixed(1)}× the reference`)),
      h('span', { class: `m num${k.points < 0 ? ' bad' : ''}` }, signed(k.points)),
      h('span', { class: 'cap', style: 'min-width:74px;text-align:right' }, k.verdict)))),
    h('p', { class: 'cap' }, 'Drills do not count here. The error bar is the range of true rates your ranges do not rule out; a group with fewer than ' + cfg.thin_below + ' ranges says "too few" and claims nothing.')) : null;

  // ---- problems (Units 4 and 5): Fermi worksheets and base rates; drills do not count ----
  const probs = PB.naturalProbs(R.probsOf(events));
  const fermis = probs.filter((p) => p.family === 'fermi');
  const rates = probs.filter((p) => p.family === 'rate' || p.family === 'chain');
  const classes = probs.filter((p) => p.family === 'class');
  const fd = PB.describeFermi(fermis, { thinBelow: cfg.thin_below, coverage: ctx.cfg.interval.coverage });
  const rtd = PB.describeRates(rates, { thinBelow: cfg.thin_below });
  const accepted = RS.acceptedBaseRates(predictions, ctx.cfg);
  const reasonCard = probs.length || predictions.length ? h('section', { class: 'card stack', id: 'reasoning-record' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Reasoning'), h('span', { class: 'cap num', id: 'rs-n' }, `n=${probs.length}`)),
    h('table', { class: 'tbl', id: 'rs-table' }, h('tbody', null,
      fermis.length ? row('Fermi ranges that held', `${fd.hits} of ${fd.n} (${pct(fd.rate)})`, fd.thin ? `under ${cfg.thin_below}: a hint` : 'a true 90% range: 9 in 10') : null,
      fermis.length ? row('Median miss', `${fd.medianMiss.toFixed(1)}×`, 'from the middle of the range') : null,
      fd.directN ? row('Worksheet vs first guess', `${fd.worksheetHits} vs ${fd.directHits} held`, `of ${fd.directN} with a first guess`) : null,
      rates.length ? row('Base rates within 7', `${rtd.within} of ${rtd.n} (${pct(rtd.rate)})`, rtd.thin ? `under ${cfg.thin_below}: a hint` : '') : null,
      rates.length ? row('Lean', `${rtd.bias > 0 ? '+' : rtd.bias < 0 ? '−' : ''}${Math.abs(rtd.bias).toFixed(1)} pts`, rtd.thin ? 'too few to say' : rtd.bias > 3 ? 'too high' : rtd.bias < -3 ? 'too low' : 'about even') : null,
      classes.length ? row('Right reference group', `${classes.filter((p) => p.hit).length} of ${classes.length}`, '') : null,
      row('Journal cards with an accepted base rate', String(accepted), `of 15 the unit asks for`))),
    h('p', { class: 'cap' }, 'Drills do not count here. A group with fewer than ' + cfg.thin_below + ' problems is a hint, not a result.')) : null;

  // ---- belts ----
  const resolvedCounted = jrec.n;
  const monthResolved = jrec.calls.filter((c) => c.horizon === 'month').length;
  const beltFacts = { gatesPassed: new Set([...(base.complete ? ['U0'] : []), ...(gateState(ctx).passed ? ['U1'] : []), ...(rangeGateState(ctx).passed ? ['U3'] : []), ...(problemGateState(ctx, 'U4').passed ? ['U4'] : []), ...(problemGateState(ctx, 'U5').passed ? ['U5'] : [])]), resolved: resolvedCounted, totalEdge: jrec.totalEdge || 0, monthResolved, gapPts: sum.n ? Math.round(sum.gap * 100) : null };
  const belts = P.beltRows(ctx.belts, beltFacts);
  const beltCard = h('section', { class: 'card stack', id: 'belts' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Belts'), h('span', { class: 'cap' }, 'feedback, not play')),
    h('ul', { class: 'units' }, belts.map((b) => h('li', { class: b.done ? '' : 'locked', 'data-belt': b.id },
      h('span', { class: 't' }, h('b', null, `${b.belt} · ${b.title}`),
        h('em', null, b.external ? b.text : b.checks.map((c) => (c.kind === 'above' ? `${c.label}: ${signed(Math.round(c.have))}` : c.kind === 'within' ? `${c.label}: ${c.have === null ? 'not measured yet' : c.have}` : `${c.label}: ${c.have} of ${c.need}`)).join(' · '))),
      h('span', { class: `chip${b.done ? ' on' : ''}` }, b.done ? 'Earned' : 'Not yet')))));

  // ---- the plain numbers ----
  const stats = h('section', { class: 'card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your numbers'), h('span', { class: 'cap' }, 'every number shows its n')),
    h('table', { class: 'tbl', id: 'stats' },
      h('tbody', null,
        row('Calls', String(sum.n), 'n'),
        row('Right', sum.n ? `${sum.hits} of ${sum.n} (${pct(sum.hitRate)})` : '–', `n=${sum.n}`),
        row('Average confidence', sum.n ? pct(sum.meanConf) : '–', `n=${sum.n}`),
        row('Gap', gap === null ? '–' : `${gapPts(gap)} pts`, gap === null ? '' : gap > 0.02 ? 'too sure' : gap < -0.02 ? 'too shy' : 'honest'),
        row('Points', sum.n ? signed(sum.points) : '–', sum.n ? `${signed(Math.round(sum.avgPoints))} a call` : ''))));

  return tabFrame('mirror', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Mirror'), h('span', { class: 'date' }, base.complete ? 'Baseline done' : `Baseline ${base.done} of ${base.total}`)),
    standingCard, curveCard, biasCard, rangeCard, reasonCard, jcard, beltCard, stats);
}

function row(label, value, note) {
  return h('tr', null, h('td', null, label), h('td', null, value), h('td', { class: 'cap', style: 'padding-left:10px;font-weight:400' }, note));
}
const jrow = row;

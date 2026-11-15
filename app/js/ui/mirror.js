import { h, s } from '../dom.js';
import * as R from '../engine/record.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { tabFrame, soonCard, unitRow } from './common.js';

// The first calibration curve. x: how sure you said you were (mean stated confidence in each band).
// y: how often you were right. The dashed diagonal is a perfectly honest player. The number of calls sits under every point.
export function curveChart(bands, edges) {
  const W = 350, H = 268, L = 38, R_ = 14, T = 12, B = 70;
  const pw = W - L - R_, ph = H - T - B;
  const x = (c) => L + ((c - 0.5) / 0.5) * pw;
  const y = (r) => T + (1 - r) * ph;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Calibration curve: how often you were right at each level of stated confidence', id: 'curve' });
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
    if (b.n > 0) svg.append(s('circle', { class: `pt${b.thin ? ' thin' : ''}`, cx: x(b.meanConf), cy: y(b.hitRate), r: 5 }));
    svg.append(
      s('text', { class: `n${b.thin ? ' thin' : ''}`, x: cx, y: y(0) + 34, 'text-anchor': 'middle' }, `n=${b.n}`),
      s('text', { class: b.thin ? 'thin' : '', x: cx, y: y(0) + 48, 'text-anchor': 'middle' }, `${Math.round(b.lo * 100)}–${i === bands.length - 1 ? '99' : Math.round(b.hi * 100) - 1}`));
  });
  svg.append(s('text', { x: L + pw / 2, y: H - 4, 'text-anchor': 'middle' }, 'how sure you said you were (%)'));
  svg.append(s('text', { x: 10, y: T + ph / 2, transform: `rotate(-90 10 ${T + ph / 2})`, 'text-anchor': 'middle' }, 'how often right (%)'));
  return svg;
}

export function mirrorScreen(ctx) {
  const events = ctx.store.events;
  const calls = R.callsOf(events);
  const sum = R.summarize(calls);
  const cfg = ctx.cfg.mirror;
  const bands = R.calibration(calls, cfg.band_edges, cfg.thin_below);
  const enough = calls.length >= cfg.min_calls_for_curve;
  const base = R.baselineProgress(events, Number(unitRow(ctx, 'U0').practice_calls));
  const gap = sum.gap;

  const curveCard = h('section', { class: 'card curve stack' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Calibration curve'), h('span', { class: 'cap num' }, `${sum.n} calls`)),
    enough ? curveChart(bands, cfg.band_edges)
      : h('p', { class: 'lede', id: 'curve-empty' }, `The curve needs at least ${cfg.min_calls_for_curve} calls. You have ${sum.n}. ${base.complete ? '' : `The baseline finishes at ${base.total}.`}`),
    h('p', { class: 'cap' }, 'A dot on the dashed line means that when you said X% you were right X% of the time. Above it, you were too shy. Below it, too sure. A band with fewer than ' + cfg.thin_below + ' calls is drawn hollow: treat it as a hint, not a result.'));

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
    curveCard, stats,
    soonCard(3, 'Level, streak, the seven-day score, the domain and horizon map, and error bars on every point. Each number will be recomputed from your raw history.'));
}

function row(label, value, note) {
  return h('tr', null, h('td', null, label), h('td', null, value), h('td', { class: 'cap', style: 'padding-left:10px;font-weight:400' }, note));
}

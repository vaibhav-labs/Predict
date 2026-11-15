// Level, streak and the seven-day score: the feedback tiles shown on Today and at the top of the Mirror.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as P from '../engine/progress.js';
import { signed } from '../engine/scoring.js';

export function standingOf(ctx) {
  const today = R.localDay();
  const led = P.ledger(ctx.store.events, today, ctx.cfg.habit);
  return { today, led, level: P.levelInfo(led.career, ctx.cfg.levels), seven: P.sevenDay(led, today) };
}

const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

// Three tiles. The same words and numbers wherever they appear.
export function standingTiles(st, ids = true) {
  const { level, led, seven } = st;
  const sevenText = seven.avgPerDay === null ? '–' : `${signed(Math.round(seven.avgPerDay))}/day`;
  const streakNote = led.todayPlayed ? 'played today' : led.streak > 0 ? 'play today to keep it' : 'start one today';
  return h('div', { class: 'stats standing' },
    h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, 'Level'), h('span', { class: 'val num', id: ids ? 'level' : undefined }, String(level.level)),
      h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((level.into / level.cost) * 100)}%` })),
      h('span', { class: 'cap num', id: ids ? 'level-note' : undefined }, `${level.toNext} points to ${level.level + 1}`)),
    h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, 'Streak'), h('span', { class: 'val num', id: ids ? 'streak' : undefined }, days(led.streak)),
      h('span', { class: 'cap', id: ids ? 'streak-note' : undefined }, streakNote)),
    h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, '7 days'), h('span', { class: 'val num', id: ids ? 'seven' : undefined }, sevenText),
      h('span', { class: 'cap num', id: ids ? 'seven-note' : undefined }, `${seven.played} of 7 played · n=${seven.calls} calls`)));
}

// Seven small bars, oldest first: skill points per day, a missed day shown as a dot.
export function weekStrip(seven) {
  const peak = Math.max(1, ...seven.days.map((d) => Math.abs(d.skill)));
  return h('div', { class: 'week', id: 'week', role: 'img', 'aria-label': `Skill points for each of the last seven days: ${seven.days.map((d) => (d.played ? signed(d.skill) : 'none')).join(', ')}` },
    seven.days.map((d) => h('div', { class: 'day', 'data-day': d.d, 'data-played': d.played ? '1' : '0', 'data-skill': String(d.skill) },
      h('span', { class: 'v num' }, d.played ? signed(d.skill) : ''),
      h('span', { class: 'col2' }, d.played ? h('i', { class: d.skill < 0 ? 'neg' : '', style: `height:${Math.max(4, Math.round((Math.abs(d.skill) / peak) * 44))}px` }) : h('i', { class: 'none' })),
      h('span', { class: 'cap' }, d.d.slice(8)))));
}

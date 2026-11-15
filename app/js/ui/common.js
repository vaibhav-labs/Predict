import { h, icon, shortDate } from '../dom.js';

export const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'journal', label: 'Journal' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'coach', label: 'Coach' },
  { id: 'path', label: 'Path' },
];

export function nav(active) {
  return h('nav', { class: 'nav', 'aria-label': 'Main' },
    TABS.map((t) => h('a', { href: `#/${t.id}`, 'aria-current': t.id === active ? 'page' : undefined }, icon(t.id), t.label)));
}

// A tab screen: header, scrolling column, bottom navigation.
export function tabFrame(active, header, ...children) {
  return h('div', { class: 'app' },
    header || h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Predict'), h('span', { class: 'date' }, shortDate())),
    h('main', { class: 'col' }, ...children),
    nav(active));
}

// A focus screen (a session, a lesson): no tab bar, a close button, an optional count and progress strip.
export function focusFrame({ title, count, progress, closeTo = '#/today', closeLabel = 'Close' }, ...children) {
  return h('div', { class: 'app focus' },
    h('header', { class: 'top2' },
      h('a', { class: 'x', href: closeTo, 'aria-label': closeLabel }, icon('close', 22, 1.8)),
      h('span', { class: 'tt' }, title),
      h('span', { class: 'cnt num' }, count || '')),
    progress ? h('div', { class: 'prog', 'aria-hidden': 'true' }, progress.map((on) => h('i', { class: on ? 'on' : '' }))) : null,
    h('main', { class: 'col' }, ...children));
}

// "Arrives in Block N" card for tabs whose block is not built yet.
export function soonCard(block, what) {
  return h('section', { class: 'card soft stack' },
    h('span', { class: 'eyebrow' }, `Arrives in Block ${block}`),
    h('p', null, what));
}

export const unitRow = (ctx, id) => ctx.units.find((u) => u.id === id);

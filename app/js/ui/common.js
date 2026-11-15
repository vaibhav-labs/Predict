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

// How many of the ten build blocks are in this version (shown on Today).
export const BLOCKS_BUILT = 5;

// A row of choice buttons where exactly one is on. Used for domain, due date, outcome and the Mirror's switches.
export function picker(options, selected, onPick, attrs = {}) {
  let value = selected;
  const btns = options.map(([id, label]) => {
    const b = h('button', { class: `pick${id === value ? ' on' : ''}`, type: 'button', 'aria-pressed': id === value ? 'true' : 'false', 'data-value': id }, label);
    b.addEventListener('click', () => {
      value = id;
      btns.forEach((x, i) => { const on = options[i][0] === value; x.className = `pick${on ? ' on' : ''}`; x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      onPick(value);
    });
    return b;
  });
  return h('div', { class: 'picker', ...attrs }, btns);
}

export const cap1 = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
export const DOMAIN_NAMES = { work: 'Work', life: 'Life', world: 'World' };
export const HORIZON_NAMES = { week: 'Up to a week', month: 'A month', longer: 'Longer' };

// Ask Predict: the message goes to the clipboard, never over the network. Where the browser will not copy, it shows the text to select.
export async function copyMessage(ctx, text, fallback) {
  try {
    await navigator.clipboard.writeText(text);
    ctx.toast('Copied. Paste it into your chat with Predict.');
  } catch {
    fallback.hidden = false;
    fallback.value = text;
    fallback.focus();
    fallback.select();
    ctx.toast('Could not copy automatically. The message is below: select and copy it yourself.');
  }
}

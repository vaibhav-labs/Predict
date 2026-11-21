// Unit 10, multi-outcome questions: three or four outcomes, a percent on each, adding up to 100. Scored by the log rule: the outcome that happened scored
// `100 * log2(k p) / log2(k)`, so a flat answer is 0 and certainty is +100. After the lock: your split against the record's, and what each scored.
// One `multi` event per answer: { q, k, p: [whole percents], truth, points, refPoints, ms, unit 'U10', domain }.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as FN from '../engine/fine.js';
import { seeded, randomSeed, shuffle } from '../engine/draw.js';
import { signed } from '../engine/scoring.js';
import { focusFrame } from './common.js';
import { fineGateState } from '../flags.js';

const refPct = (x) => `${Math.round(x * 100)}%`;
export const multisOf = (events) => events.filter((e) => e.type === 'multi');

// The next question: never asked ones first (shuffled), then the one asked longest ago. A disputed question never comes back.
export function nextMulti(ctx, events, rng) {
  const disputed = R.disputedIds(events);
  const asked = multisOf(events);
  const last = new Map(asked.map((e, i) => [e.q, i]));
  const pool = ctx.multiBank.filter((q) => !disputed.has(q.id));
  const fresh = shuffle(pool.filter((q) => !last.has(q.id)), rng);
  if (fresh.length) return fresh[0];
  return pool.slice().sort((a, b) => last.get(a.id) - last.get(b.id) || (a.id < b.id ? -1 : 1))[0] || null;
}

export function multiScreen(ctx, arg) {
  const { store, cfg } = ctx;
  const st = fineGateState(ctx);
  if (!st.open) { ctx.replace('#/path'); return document.createTextNode(''); }
  const q = (arg && ctx.multiById(arg)) || nextMulti(ctx, store.events, seeded(randomSeed()));
  if (!q) { ctx.replace('#/path'); return document.createTextNode(''); }
  const k = q.outcomes.length;
  const shownAt = Date.now();
  const guardMs = cfg.gym.tap_guard_ms ?? 400;
  const min = cfg.problems.multi.min_percent;
  const done = multisOf(store.events).length;

  const inputs = q.outcomes.map((label, i) => h('input', {
    class: 'field num', id: `multi-${i}`, type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `Chance of: ${label}`, style: 'max-width:5.5em',
  }));
  const total = h('b', { class: 'num', id: 'multi-total' }, '0%');
  const msg = h('p', { class: 'msg', id: 'multi-msg', role: 'status' });
  const lock = h('button', { class: 'btn', type: 'button', id: 'multi-lock', disabled: true }, 'Lock');
  const values = () => inputs.map((el) => (/^\d{1,3}$/.test(el.value.trim()) ? Number(el.value.trim()) : NaN));
  const check = () => {
    const v = values();
    const sum = v.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
    total.textContent = `${sum}%`;
    const filled = inputs.every((el) => el.value.trim() !== '');
    const r = filled ? FN.checkMulti(v, k, min) : { ok: false, error: '' };
    lock.disabled = !r.ok;
    msg.textContent = r.ok ? '' : filled || sum > 100 ? r.error : '';
    msg.className = msg.textContent ? 'msg err' : 'msg';
  };
  inputs.forEach((el) => el.addEventListener('input', check));
  const armedAt = Date.now() + guardMs;

  const entry = h('section', { class: 'card stack', id: 'multi-entry' },
    h('p', { class: 'prose-s' }, `Give each outcome a chance, in whole percents, adding up to 100. Every outcome gets at least ${min}%. The one that happens is scored by the chance you gave it: even odds score 0, and giving the real one ${min}% costs a lot.`),
    ...q.outcomes.map((label, i) => h('label', { class: 'rfield', style: 'flex-direction:row;align-items:center;gap:12px' }, inputs[i], h('span', null, label))),
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Total'), total), msg);
  const foot = h('div', { class: 'foot' }, lock, h('span', { class: 'cap' }, 'Adds up to 100 to lock.'));
  const body = h('div', { class: 'stack' }, entry, foot);

  lock.addEventListener('click', async () => {
    if (Date.now() < armedAt || lock.disabled) return;
    const v = values();
    if (!FN.checkMulti(v, k, min).ok) return;
    lock.disabled = true;
    inputs.forEach((el) => { el.disabled = true; });
    const refP = Math.max(q.ref[q.truth], min / 100);
    const points = FN.multiPoints(k, v[q.truth] / 100);
    const refPoints = FN.multiPoints(k, refP);
    await store.append(R.makeEvent('multi', { q: q.id, unit: 'U10', domain: q.domain, k, p: v, truth: q.truth, points, refPoints, ms: Math.min(1800000, Date.now() - shownAt) }));
    ctx.requestPersist();
    const rows = q.outcomes.map((label, i) => h('div', { class: `mrow${i === q.truth ? ' truth' : ''}`, id: `multi-row-${i}` },
      h('span', { class: 'mlab' }, i === q.truth ? `${label} (what happened)` : label),
      h('span', { class: 'num mine' }, `${v[i]}%`),
      h('span', { class: 'num ref cap' }, `record ${refPct(q.ref[i])}`)));
    const flag = h('button', { class: 'ghost', type: 'button', id: 'flag' }, 'Flag this question as disputed');
    flag.addEventListener('click', async () => { flag.disabled = true; await store.append(R.makeEvent('dispute', { q: q.id })); flag.textContent = 'Flagged. It will not come back.'; });
    const next = h('a', { class: 'btn', href: '#/multi', id: 'multi-next' }, 'Next question');
    next.addEventListener('click', (ev) => { ev.preventDefault(); ctx.replace('#/multi'); ctx.refresh(); });
    body.replaceChildren(
      h('section', { class: 'card stack', id: 'multi-result' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your split'), h('span', { class: 'cap' }, `${k} outcomes`)),
        ...rows,
        h('div', { class: 'res' },
          h('span', { class: `pts${points < 0 ? ' bad' : ''}` }, h('span', { class: 'eyebrow' }, 'Your points'), h('b', { class: 'num', id: 'multi-points' }, signed(points))),
          h('span', { class: `pts${refPoints < 0 ? ' bad' : ''}` }, h('span', { class: 'eyebrow' }, 'The record alone'), h('b', { class: 'num', id: 'multi-ref-points' }, signed(refPoints))))),
      h('section', { class: 'card answer' }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The answer'), h('span', { class: 'cap' }, 'From the record')), h('p', null, q.fact), h('p', { class: 'muted' }, q.why),
        /^https?:/.test(q.source) ? h('a', { class: 'link', href: q.source, target: '_blank', rel: 'noopener noreferrer' }, `Source: ${q.src_name || 'link'} ↗`) : null),
      h('div', { class: 'foot' }, next, flag));
  });

  return focusFrame({ title: 'Several outcomes', count: `${done} done`, closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('div', { class: 'tags' }, h('span', { class: 'tag' }, 'Unit 10'), h('span', { class: 'tag', id: 'mode-tag' }, 'Practice')),
      h('p', { class: 'claim', id: 'multi-lead' }, q.lead), h('p', { class: 'lede', id: 'multi-ask' }, q.ask)),
    body);
}

export function multiPathCard(ctx) {
  const st = fineGateState(ctx);
  if (!st.open) return null;
  const mine = multisOf(ctx.store.events);
  const mean = mine.length ? Math.round(mine.reduce((s, e) => s + e.points, 0) / mine.length) : null;
  return h('section', { class: 'card stack', id: 'multi-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 10 · Several outcomes'), h('span', { class: 'cap num', id: 'multi-count' }, `${mine.length} answered`)),
    h('p', null, 'Three or four outcomes, a chance on each, adding up to 100. The log rule again: flat is 0, and the record alone is the number to beat.'),
    mean === null ? null : h('p', { class: 'cap', id: 'multi-mean' }, `Your average so far: ${signed(mean)} a question.`),
    h('a', { class: 'ghost', href: '#/multi', id: 'multi-start' }, 'Start'));
}

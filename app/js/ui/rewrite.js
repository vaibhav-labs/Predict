// The drill for soft questions (L04): rewrite vague predictions until each one passes the checker. The player's own rejected
// predictions come first; data/vague_claims.csv fills the rest. Nothing here is scored.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import * as J from '../engine/journal.js';
import { focusFrame } from './common.js';

// The items for a drill: up to `count` of the player's own predictions that the checker still rejects, then the table's, rotated by
// how many times the flag has fired so that a second drill brings new ones.
export function rewriteItems(ctx, chain, count) {
  const own = R.predictionsOf(ctx.store.events).filter((p) => LE.rejected(p) && J.checkClaim(p.text, ctx.checkerRules).length > 0)
    .slice(-count).map((p) => ({ id: p.id, vague: p.text, hint: 'This is one of yours that the checker caught.', own: true }));
  const table = ctx.vagueClaims;
  const start = (((chain.fires || 1) - 1) * count) % table.length;
  const rest = table.slice(start).concat(table.slice(0, start)).map((r) => ({ id: r.id, vague: r.vague, hint: r.hint, own: false }));
  return own.concat(rest).slice(0, count);
}

export function rewriteScreen(ctx, id) {
  const chain = LE.flagsOf(ctx.store.events, ctx.cfg).find((c) => c.id === id);
  if (!chain || chain.trigger !== 'L04' || !['open', 'lesson'].includes(chain.state)) { ctx.nav(chain ? `#/flag/${id}` : '#/today'); return document.createTextNode(''); }
  const count = LE.drillOf('L04', ctx.cfg).items;
  const items = rewriteItems(ctx, chain, count);
  const done = [];
  const wrap = h('div', null);

  function paint() {
    const i = done.length;
    if (i >= items.length) { finish(); return; }
    const item = items[i];
    const box = h('textarea', { class: 'field', id: 'rewrite-text', rows: 3, placeholder: 'By [date], [measurable thing] will [happen].' });
    const flags = h('div', { class: 'stack', id: 'rewrite-flags' });
    const go = h('button', { class: 'btn', type: 'button', id: 'rewrite-go' }, i + 1 >= items.length ? 'Finish' : 'Next one');
    const verdict = () => {
      const text = box.value.trim();
      const found = J.checkClaim(text, ctx.checkerRules);
      const problems = [...found.map((f) => f.message)];
      if (text && text.toLowerCase() === item.vague.toLowerCase()) problems.push('That is the original. Rewrite it.');
      if (text.length < 20) problems.push('Write it out in a full sentence.');
      flags.replaceChildren(...(text ? problems.map((m) => h('p', { class: 'msg err' }, m)) : []));
      go.disabled = problems.length > 0;
      return problems.length === 0;
    };
    box.addEventListener('input', verdict);
    go.disabled = true;
    const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
    go.addEventListener('click', () => {
      if (Date.now() < armedAt || !verdict()) return;
      done.push({ id: item.id, text: box.value.trim() });
      paint();
    });
    wrap.replaceChildren(focusFrame({ title: 'Rewrite drill', count: `${i + 1} of ${items.length}`, progress: items.map((_, k) => k < i), closeTo: `#/flag/${id}`, closeLabel: 'Back to the lesson' },
      h('section', { class: 'card stack' },
        h('span', { class: 'eyebrow' }, item.own ? 'One of your predictions' : 'A vague prediction'),
        h('p', { class: 'claim', id: 'rewrite-vague' }, item.vague),
        h('p', { class: 'muted' }, item.hint)),
      h('section', { class: 'stack' }, h('div', { class: 'eyebrow' }, 'Your rewrite'), box, flags),
      h('div', { class: 'foot' }, go)));
    window.scrollTo(0, 0);
  }

  async function finish() {
    await ctx.store.append(R.makeEvent('flag', { state: 'drill', flag: id, session: `rewrite-${id}`, items: done.length, rewrites: done }));
    ctx.replace(`#/flag/${id}`);
  }

  paint();
  return wrap;
}

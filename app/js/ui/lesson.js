import { h } from '../dom.js';
import * as R from '../engine/record.js';
import { LESSONS } from '../lessons.js';
import { focusFrame } from './common.js';
import { wheel } from './dial.js';

// A lesson card's blocks as page elements (also used by the pattern-flag lesson).
export function renderBlocks(blocks) {
  return blocks.map((b) => {
    if (b.p) return h('p', null, b.p.map((part) => (typeof part === 'string' ? part : h('b', null, part.b))));
    if (b.table) {
      return h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, b.table.head.map((t) => h('th', null, t)))),
        h('tbody', null, b.table.rows.map((r) => h('tr', null, r.map((cell, i) => h('td', { class: i === b.table.badCol && cell.startsWith('−') ? 'bad' : '' }, cell))))));
    }
    if (b.wheel) return wheel(b.wheel);
    return null;
  });
}

export function lessonScreen(ctx, id) {
  const idx = LESSONS.findIndex((l) => l.id === id);
  if (idx < 0) { ctx.nav('#/path'); return document.createTextNode(''); }
  const lesson = LESSONS[idx];
  const next = LESSONS[idx + 1];
  const isRead = R.lessonsRead(ctx.store.events).has(id);

  const body = renderBlocks(lesson.blocks(ctx.S));

  const doneBtn = h('button', { class: 'btn', type: 'button', id: 'lesson-done' }, isRead ? (next ? 'Next card' : 'Back to Path') : 'Got it');
  doneBtn.addEventListener('click', async () => {
    doneBtn.disabled = true;
    if (!isRead) await ctx.store.append(R.makeEvent('lesson', { lesson: id }));
    ctx.nav(next ? `#/lesson/${next.id}` : '#/path');
  });

  return focusFrame({ title: `Card ${idx + 1} of ${LESSONS.length}`, closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('div', { class: 'eyebrow' }, 'Unit 1 · Calibration'), h('h1', { class: 'title', id: 'lesson-title' }, lesson.title)),
    h('section', { class: 'card prose stack' }, body),
    h('div', { class: 'foot' }, doneBtn));
}

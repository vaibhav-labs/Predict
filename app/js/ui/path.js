import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import { LESSONS } from '../lessons.js';
import { tabFrame, unitRow } from './common.js';

export function pathScreen(ctx) {
  const events = ctx.store.events;
  const read = R.lessonsRead(events);
  const base = R.baselineProgress(events, Number(unitRow(ctx, 'U0').practice_calls));
  const practice = R.callsOf(events).filter((c) => c.mode === 'practice').length;

  const status = (u) => {
    if (u.id === 'U0') return base.complete ? { text: 'Done', on: true } : { text: `${base.done} of ${base.total}`, on: true };
    if (u.id === 'U1') return { text: practice ? `${practice} calls` : 'Practice', on: true };
    return { text: 'Locked', on: false };
  };
  const arcs = [...new Set(ctx.units.map((u) => u.arc))];

  return tabFrame('path', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Path'), h('span', { class: 'date' }, `${read.size} of ${LESSONS.length} cards read`)),
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 1 lessons'), h('span', { class: 'cap' }, 'under a minute each')),
      h('div', { id: 'lessons' }, LESSONS.map((l) => h('a', { class: 'lesson-link', href: `#/lesson/${l.id}` },
        h('span', { class: `tick${read.has(l.id) ? ' on' : ''}`, 'aria-hidden': 'true' }, read.has(l.id) ? icon('check', 14, 2.4) : null),
        h('span', { class: 't' }, h('b', null, l.title), h('em', null, l.blurb)),
        h('span', { class: 'cap' }, read.has(l.id) ? 'Read' : 'Open'))))),
    arcs.map((arc) => h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Arc ${arc}`)),
      h('ul', { class: 'units' }, ctx.units.filter((u) => u.arc === arc).map((u) => {
        const st = status(u);
        return h('li', { class: st.on ? '' : 'locked' },
          h('span', { class: 't' }, h('b', null, `${u.id.replace('U', 'Unit ')} · ${u.name}`), h('em', null, u.skill)),
          h('span', { class: `chip${st.on ? ' on' : ''}` }, st.text));
      })))),
    h('p', { class: 'cap' }, 'The Unit 1 exam, a fixed set of 200 fresh calls, arrives in Block 4. Later units open as their blocks are built.'));
}

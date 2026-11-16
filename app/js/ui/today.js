import { h, icon, shortDate } from '../dom.js';
import * as R from '../engine/record.js';
import { signed } from '../engine/scoring.js';
import { LESSONS } from '../lessons.js';
import { tabFrame, unitRow } from './common.js';
import { nextSessionPlan } from './gym.js';

export function todayScreen(ctx) {
  const events = ctx.store.events;
  const calls = R.callsOf(events);
  const sum = R.summarize(calls);
  const plan = nextSessionPlan(ctx);
  const active = R.activeSession(events);
  const unit = unitRow(ctx, plan.mode === 'baseline' ? 'U0' : 'U1');
  const today = R.localDay();
  const day = R.dayNumber(events, today);
  const read = R.lessonsRead(events);
  const nextLesson = LESSONS.find((l) => !read.has(l.id));
  const gymMin = ctx.gymMinutes;
  const predictions = R.predictionsOf(events, today);
  const dueCount = R.dueList(predictions).length;
  const writtenToday = predictions.some((p) => p.d === today);
  const journalLine = writtenToday ? "Today's prediction written" : dueCount ? `${dueCount} due to resolve` : 'Write today’s prediction';

  const gymLine = active
    ? `Resume: ${active.calls.length} of ${active.size} done · ${active.mode === 'baseline' ? 'Baseline' : 'Unit 1 practice'}`
    : plan.mode === 'baseline'
      ? `${plan.size} calls · Baseline session ${plan.number} of ${plan.of}`
      : `${plan.size} calls · Unit 1 practice, ${plan.done} of ${plan.total} so far`;

  const lastExport = R.lastExport(events);
  const daysSince = lastExport ? R.daysBetween(lastExport.d, R.localDay()) : null;
  const needsExport = calls.length >= ctx.cfg.record.export_nudge_min_calls && (daysSince === null || daysSince >= ctx.cfg.record.export_nudge_days);

  const baseTotal = Number(unitRow(ctx, 'U0').practice_calls);
  const base = R.baselineProgress(events, baseTotal);

  return tabFrame('today', h('header', { class: 'top' },
      h('span', { class: 'mark' }, 'Predict'),
      h('div', { class: 'topright' },
        h('span', { class: 'date' }, shortDate()),
        h('a', { class: 'helplink', href: '#/help', id: 'help-link', 'aria-label': 'How Predict works' }, icon('help', 20, 1.8)))),
    ctx.updateReady ? h('div', { class: 'banner', role: 'status' }, h('span', null, 'A new version is ready.'), h('button', { type: 'button', onclick: () => location.reload() }, 'Reload')) : null,
    ctx.store.persistent ? null : h('div', { class: 'banner', role: 'alert', style: 'background:var(--seal)' }, h('span', null, 'This browser is not saving your calls. Open Predict in Safari or install it to the home screen.')),
    h('section', { class: 'hero' },
      h('div', { class: 'eyebrow' }, `${unit.id.replace('U', 'Unit ')} · ${unit.name}`),
      h('h1', { id: 'day' }, `Day ${day}`),
      h('p', null, unit.skill + '.')),
    h('section', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, 'Calls'), h('span', { class: 'val num', id: 'stat-calls' }, String(sum.n)), h('span', { class: 'cap' }, 'on this phone')),
      h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, 'Points'), h('span', { class: 'val num', id: 'stat-points' }, signed(sum.points)), h('span', { class: 'cap' }, sum.n ? `${signed(Math.round(sum.avgPoints))} a call · n=${sum.n}` : 'no calls yet')),
      h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, 'Baseline'), h('span', { class: 'val num', id: 'stat-base' }, base.complete ? 'Done' : `${base.done} of ${base.total}`), h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((base.done / base.total) * 100)}%` })), h('span', { class: 'cap' }, base.complete ? 'Curve in Mirror' : 'calls so far'))),
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Today'), h('span', { class: 'cap' }, 'Block 2 of 10 built')),
      h('ol', { class: 'steps' },
        h('li', null, h('span', { class: 'n' }, '1'), h('span', { class: 't' }, h('b', null, 'Gym'), h('em', { id: 'gym-line' }, gymLine)), h('span', { class: 'm num' }, `${gymMin} min`)),
        h('li', { class: nextLesson ? '' : 'later' }, h('span', { class: 'n' }, '2'),
          h('span', { class: 't' }, h('b', null, 'Lesson'), h('em', null, nextLesson ? `Unit 1 · ${nextLesson.title}` : 'All four Unit 1 cards read')),
          nextLesson ? h('a', { class: 'link', href: `#/lesson/${nextLesson.id}`, 'aria-label': `Open the lesson ${nextLesson.title}` }, '1 min') : h('span', { class: 'm num' }, 'Done')),
        h('li', null, h('span', { class: 'n' }, '3'), h('span', { class: 't' }, h('b', null, 'Journal'), h('em', { id: 'journal-line' }, journalLine)), h('a', { class: 'link', href: '#/journal', 'aria-label': 'Open the Journal' }, `${ctx.journalMinutes} min`)))),
    needsExport
      ? h('section', { class: 'card nudge' },
        h('span', { class: 'eyebrow' }, 'Back up your record'),
        h('p', null, lastExport ? `Your last Export was ${daysSince} days ago.` : 'You have not exported your record yet.'),
        h('p', { class: 'cap' }, 'Your calls live only on this phone until the private repository arrives in Block 5.'),
        h('a', { class: 'ghost', href: '#/coach' }, 'Open Export'))
      : null,
    h('a', { class: 'btn', href: '#/gym', id: 'start', style: 'margin-top:auto' }, active ? 'Resume session' : 'Start session'));
}

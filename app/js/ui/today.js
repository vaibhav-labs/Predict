import { h, icon, shortDate } from '../dom.js';
import * as R from '../engine/record.js';
import { signed } from '../engine/scoring.js';
import * as LE from '../engine/lessons.js';
import { LESSONS } from '../lessons.js';
import { tabFrame, unitRow, BLOCKS_BUILT } from './common.js';
import { standingOf, standingTiles } from './standing.js';
import { nextSessionPlan } from './gym.js';
import { lessonState, gateState } from '../flags.js';
import { flagName } from '../flagtext.js';
import { patternRow } from './patterns.js';
import { recheckCard } from './autopsy.js';
import { rangesTodayCard } from './ranges.js';
import { problemsTodayCards } from './problems.js';
import { rangeGateState, problemGateState } from '../flags.js';
import { decideTodayCard, dueDecisionRows } from './decide.js';
import { recallTodayCard } from './recall.js';
import { fineTodayCard } from './fine.js';
import { worldTodayCard } from './world.js';

// What needs the player before anything else: an autopsy that is due, the patterns in repair, the exam.
function needsCard(ctx, ls, gate) {
  const rows = [];
  if (ls.due.pending.length) {
    const n = ls.due.pending[0];
    rows.push(h('a', { class: 'lesson-link', href: `#/autopsy/${n.p.id}`, id: 'need-autopsy' },
      h('span', { class: 'tick', 'aria-hidden': 'true' }),
      h('span', { class: 't' }, h('b', null, 'Autopsy due'), h('em', null, n.p.text)),
      h('span', { class: 'cap num' }, ls.due.pending.length > 1 ? `${ls.due.pending.length} due` : 'Start')));
  }
  for (const c of ls.patterns) rows.push(patternRow(ctx, c, ls));
  if (gate.running || gate.needsRepair || gate.eligible) {
    const text = gate.running ? `${gate.done} of ${gate.total} calls done` : gate.needsRepair ? 'Repair drill first' : `${gate.total} fresh calls, judged once`;
    rows.push(h('a', { class: 'lesson-link', href: '#/path', id: 'need-exam' },
      h('span', { class: 'tick', 'aria-hidden': 'true' }),
      h('span', { class: 't' }, h('b', null, 'Unit 1 exam'), h('em', null, text)),
      h('span', { class: 'cap' }, gate.running ? 'Continue' : gate.needsRepair ? 'Repair' : 'Ready')));
  }
  const rg = rangeGateState(ctx);
  if (rg.running || rg.needsRepair || rg.eligible) {
    const text = rg.running ? `${rg.done} of ${rg.total} ranges done` : rg.needsRepair ? 'Repair drill first' : `${rg.total} fresh ranges, judged once`;
    rows.push(h('a', { class: 'lesson-link', href: '#/path', id: 'need-rexam' },
      h('span', { class: 'tick', 'aria-hidden': 'true' }),
      h('span', { class: 't' }, h('b', null, 'Unit 3 exam'), h('em', null, text)),
      h('span', { class: 'cap' }, rg.running ? 'Continue' : rg.needsRepair ? 'Repair' : 'Ready')));
  }
  rows.push(...dueDecisionRows(ctx));
  for (const unit of ['U4', 'U5', 'U6', 'U7', 'U8', 'U9']) {
    const pg = problemGateState(ctx, unit);
    if (pg.running || pg.needsRepair || pg.eligible) {
      const noun = unit === 'U4' ? 'problems' : unit === 'U6' ? 'steps' : unit === 'U7' || unit === 'U9' ? 'problems' : unit === 'U8' ? 'cases' : 'answers';
      const text = pg.running ? `${pg.done} of ${pg.total} ${noun} done` : pg.needsRepair ? 'Repair drill first' : `${pg.total} fresh problems, judged once`;
      rows.push(h('a', { class: 'lesson-link', href: '#/path', id: `need-pexam-${unit}` },
        h('span', { class: 'tick', 'aria-hidden': 'true' }),
        h('span', { class: 't' }, h('b', null, `Unit ${unit.slice(1)} exam`), h('em', null, text)),
        h('span', { class: 'cap' }, pg.running ? 'Continue' : pg.needsRepair ? 'Repair' : 'Ready')));
    }
  }
  if (!rows.length) return null;
  return h('section', { class: 'card', id: 'needs' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Needs you'), h('span', { class: 'cap' }, String(rows.length))),
    h('div', null, rows));
}

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
  const ls = lessonState(ctx);
  const gate = gateState(ctx);
  const journalLine = ls.due.pending.length ? 'Autopsy due first' : writtenToday ? "Today's prediction written" : dueCount ? `${dueCount} due to resolve` : 'Write today’s prediction';
  const modeText = (m) => (m === 'baseline' ? 'Baseline' : m === 'drill' ? 'Drill' : m === 'exam' ? 'Exam' : 'Unit 1 practice');

  const small = plan.minimum ? ' · minimum session' : '';
  const gymLine = active
    ? `Resume: ${active.calls.length} of ${active.size} done · ${modeText(active.mode)}`
    : plan.mode === 'baseline'
      ? `${plan.size} calls · Baseline session ${plan.number} of ${plan.of}${small}`
      : `${plan.size} calls · Unit 1 practice, ${plan.done} of ${plan.total} so far${small}`;
  // The lesson of the day: a pattern's lesson comes before the next Unit 1 card.
  const patternLesson = ls.patterns.find((c) => c.state === 'open' && c.trigger !== 'L15') || null;

  const lastExport = R.lastExport(events);
  const daysSince = lastExport ? R.daysBetween(lastExport.d, R.localDay()) : null;
  const needsExport = calls.length >= ctx.cfg.record.export_nudge_min_calls && (daysSince === null || daysSince >= ctx.cfg.record.export_nudge_days);

  const baseTotal = Number(unitRow(ctx, 'U0').practice_calls);
  const base = R.baselineProgress(events, baseTotal);

  return tabFrame('today', h('header', { class: 'top' },
      h('span', { class: 'mark' }, 'Predict'),
      h('div', { class: 'topright' },
        h('span', { class: 'date' }, shortDate()),
        h('a', { class: 'helplink', href: '#/help', id: 'help-link', 'aria-label': 'How to play and what things mean' }, icon('help', 20, 1.8)))),
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
    h('a', { class: 'standing-link', href: '#/mirror', id: 'standing-link', 'aria-label': 'Level, streak and seven-day score. Open the Mirror.' }, standingTiles(standingOf(ctx))),
    habitCard(ctx, ls),
    letterNudge(ctx),
    needsCard(ctx, ls, gate),
    rangesTodayCard(ctx),
    ...problemsTodayCards(ctx),
    recallTodayCard(ctx),
    decideTodayCard(ctx),
    fineTodayCard(ctx),
    worldTodayCard(ctx),
    ...ls.rechecks.slice(0, 2).map((r) => recheckCard(ctx, r, () => ctx.refresh())),
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Today'), h('span', { class: 'cap' }, `Block ${BLOCKS_BUILT} of 10 built`)),
      h('ol', { class: 'steps' },
        h('li', null, h('span', { class: 'n' }, '1'), h('span', { class: 't' }, h('b', null, 'Gym'), h('em', { id: 'gym-line' }, gymLine)), h('span', { class: 'm num' }, `${gymMin} min`)),
        h('li', { class: nextLesson || patternLesson ? '' : 'later' }, h('span', { class: 'n' }, '2'),
          h('span', { class: 't' }, h('b', null, 'Lesson'), h('em', { id: 'lesson-line' }, patternLesson ? `Pattern · ${flagName(ctx, patternLesson.trigger)}` : nextLesson ? `Unit 1 · ${nextLesson.title}` : 'All four Unit 1 cards read')),
          patternLesson ? h('a', { class: 'link', href: `#/flag/${patternLesson.id}`, 'aria-label': `Open the lesson ${flagName(ctx, patternLesson.trigger)}` }, '1 min')
            : nextLesson ? h('a', { class: 'link', href: `#/lesson/${nextLesson.id}`, 'aria-label': `Open the lesson ${nextLesson.title}` }, '1 min') : h('span', { class: 'm num' }, 'Done')),
        h('li', null, h('span', { class: 'n' }, '3'), h('span', { class: 't' }, h('b', null, 'Journal'), h('em', { id: 'journal-line' }, journalLine)), h('a', { class: 'link', href: '#/journal', 'aria-label': 'Open the Journal' }, `${ctx.journalMinutes} min`)))),
    needsExport
      ? h('section', { class: 'card nudge' },
        h('span', { class: 'eyebrow' }, 'Back up your record'),
        h('p', null, lastExport ? `Your last Export was ${daysSince} days ago.` : 'You have not exported your record yet.'),
        h('p', { class: 'cap' }, 'Your calls live only on this phone until you connect a private repository on the Coach tab.'),
        h('a', { class: 'ghost', href: '#/coach' }, 'Open Export'))
      : null,
    h('a', { class: 'btn', href: '#/gym', id: 'start', style: 'margin-top:auto' }, active ? 'Resume session' : 'Start session'));
}

// A weekly letter from Predict that has not been opened yet.
function letterNudge(ctx) {
  const L = ctx.coach && ctx.coach.letter;
  if (!L || ctx.letterSeen === (ctx.coach.week || ctx.coach.written || 'seen')) return null;
  return h('section', { class: 'card nudge stack', id: 'letter-card' },
    h('span', { class: 'eyebrow' }, 'From Predict'),
    h('p', null, L.title),
    h('a', { class: 'ghost', href: '#/coach', id: 'letter-open' }, 'Read this week’s letter'));
}

// Missed days (L15): not a lesson, a smaller day until the habit is back. Says what today's minimum is and how far the run is.
function habitCard(ctx, ls) {
  if (!ls.habit) return null;
  const m = ctx.cfg.lessons.triggers.L15.minimum;
  const prog = LE.habitProgress(ls.habit, ctx.store.events, { today: ls.today, cfg: ctx.cfg });
  return h('section', { class: 'card nudge stack', id: 'habit-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Missed days'), h('span', { class: 'cap num', id: 'habit-run' }, `${prog.run} of ${prog.need} days`)),
    h('p', null, `Today is a minimum day: ${m.gym_calls} gym calls, a reveal if one is due, and ${m.predictions} prediction. About three minutes.`),
    h('p', { class: 'cap' }, `${prog.need} days in a row at the minimum or more, and this clears.`),
    h('a', { class: 'ghost', href: `#/flag/${ls.habit.id}` }, 'What this is'));
}

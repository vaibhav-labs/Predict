import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import { LESSONS, RANGE_LESSONS, FERMI_LESSONS, RATE_LESSONS, UPDATE_LESSONS, SECOND_LESSONS, AUTOPSY_LESSONS, DECISION_LESSONS, FINE_LESSONS } from '../lessons.js';
import { finePathCards } from './fine.js';
import { multiPathCard } from './multi.js';
import { worldPathCard } from './world.js';
import { fineGateState } from '../flags.js';
import * as KN from '../engine/know.js';
import { tabFrame, unitRow } from './common.js';
import { lessonState, gateState, rangeGateState, problemGateState } from '../flags.js';
import { patternRow } from './patterns.js';
import { examCard } from './exam.js';
import { rangeExamCard } from './ranges.js';
import { problemExamCard } from './problems.js';

export function pathScreen(ctx) {
  const events = ctx.store.events;
  const cfg = ctx.cfg;
  const read = R.lessonsRead(events);
  const base = R.baselineProgress(events, Number(unitRow(ctx, 'U0').practice_calls));
  const practice = R.callsOf(events).filter((c) => c.mode === 'practice').length;

  const gate = gateState(ctx);
  const rgate = rangeGateState(ctx);
  const rangesDone = R.rangesOf(events).filter((r) => r.mode === 'practice').length;
  const g4 = problemGateState(ctx, 'U4');
  const g5 = problemGateState(ctx, 'U5');
  const g6 = problemGateState(ctx, 'U6');
  const g7 = problemGateState(ctx, 'U7');
  const g8 = problemGateState(ctx, 'U8');
  const g9 = problemGateState(ctx, 'U9');
  const g10 = fineGateState(ctx);
  const probsDone = (unit) => R.probsOf(events).filter((p) => p.mode === 'practice' && p.unit === unit && (KN.isChoiceUnit(unit) ? cfg.problems.choice[unit].families.includes(p.family) : unit === 'U4' ? p.family === 'fermi' : unit === 'U6' ? p.family === 'update' : p.family === 'rate' || p.family === 'class')).length;
  const ls = lessonState(ctx);
  const status = (u) => {
    if (u.id === 'U0') return base.complete ? { text: 'Done', on: true } : { text: `${base.done} of ${base.total}`, on: true };
    if (u.id === 'U1') return gate.passed ? { text: 'Passed', on: true } : { text: practice ? `${practice} calls` : 'Practice', on: true };
    if (u.id === 'U3') return rgate.passed ? { text: 'Passed', on: true } : rgate.open ? { text: rangesDone ? `${rangesDone} ranges` : 'Open', on: true } : { text: 'Locked', on: false };
    if (u.id === 'U4') return g4.passed ? { text: 'Passed', on: true } : g4.open ? { text: probsDone('U4') ? `${probsDone('U4')} problems` : 'Open', on: true } : { text: 'Locked', on: false };
    if (u.id === 'U5') return g5.passed ? { text: 'Passed', on: true } : g5.open ? { text: probsDone('U5') ? `${probsDone('U5')} problems` : 'Open', on: true } : { text: 'Locked', on: false };
    if (u.id === 'U6') return g6.passed ? { text: 'Passed', on: true } : g6.open ? { text: probsDone('U6') ? `${probsDone('U6')} steps` : 'Open', on: true } : { text: 'Locked', on: false };
    for (const [id, g] of [['U7', g7], ['U8', g8], ['U9', g9]]) if (u.id === id) return g.passed ? { text: 'Passed', on: true } : g.open ? { text: probsDone(id) ? `${probsDone(id)} problems` : 'Open', on: true } : { text: 'Locked', on: false };
    if (u.id === 'U10') return g10.passed ? { text: 'Passed', on: true } : g10.open ? { text: g10.practice ? `${g10.practice} calls` : 'Open', on: true } : { text: 'Locked', on: false };
    return { text: 'Locked', on: false };
  };
  const lessonCard = (id, unitName, list, open) => open ? h('section', { class: 'card', id }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `${unitName} lessons`), h('span', { class: 'cap' }, 'under a minute each')),
    h('div', null, list.map((l) => h('a', { class: 'lesson-link', href: `#/lesson/${l.id}` },
      h('span', { class: `tick${read.has(l.id) ? ' on' : ''}`, 'aria-hidden': 'true' }, read.has(l.id) ? icon('check', 14, 2.4) : null),
      h('span', { class: 't' }, h('b', null, l.title), h('em', null, l.blurb)),
      h('span', { class: 'cap' }, read.has(l.id) ? 'Read' : 'Open'))))) : null;
  const practiceCard = (id, unitName, blurb, links, done) => h('section', { class: 'card stack', id }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `${unitName} practice`), h('span', { class: 'cap num' }, `${done} problems so far`)), h('p', null, blurb), ...links);
  const patterns = ls.chains.slice().reverse().slice(0, 8);
  const arcs = [...new Set(ctx.units.map((u) => u.arc))];

  return tabFrame('path', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Path'), h('span', { class: 'date' }, `${read.size} of ${LESSONS.length} cards read`)),
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 1 lessons'), h('span', { class: 'cap' }, 'under a minute each')),
      h('div', { id: 'lessons' }, LESSONS.map((l) => h('a', { class: 'lesson-link', href: `#/lesson/${l.id}` },
        h('span', { class: `tick${read.has(l.id) ? ' on' : ''}`, 'aria-hidden': 'true' }, read.has(l.id) ? icon('check', 14, 2.4) : null),
        h('span', { class: 't' }, h('b', null, l.title), h('em', null, l.blurb)),
        h('span', { class: 'cap' }, read.has(l.id) ? 'Read' : 'Open'))))),
    examCard(ctx),
    rgate.open ? h('section', { class: 'card', id: 'range-lessons-card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 3 lessons'), h('span', { class: 'cap' }, 'under a minute each')),
      h('div', { id: 'range-lessons' }, RANGE_LESSONS.map((l) => h('a', { class: 'lesson-link', href: `#/lesson/${l.id}` },
        h('span', { class: `tick${read.has(l.id) ? ' on' : ''}`, 'aria-hidden': 'true' }, read.has(l.id) ? icon('check', 14, 2.4) : null),
        h('span', { class: 't' }, h('b', null, l.title), h('em', null, l.blurb)),
        h('span', { class: 'cap' }, read.has(l.id) ? 'Read' : 'Open'))))) : null,
    rgate.open ? h('section', { class: 'card stack', id: 'range-practice-card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 3 practice'), h('span', { class: 'cap num' }, `${rangesDone} ranges so far`)),
      h('p', null, 'Ten ranges a session: a low and a high you are 90% sure of, scored against what the record says a 90% range needs.'),
      h('a', { class: 'ghost', href: '#/range/practice', id: 'range-practice' }, 'Start ranges')) : null,
    rangeExamCard(ctx),
    lessonCard('fermi-lessons-card', 'Unit 4', FERMI_LESSONS, g4.open),
    g4.open ? practiceCard('fermi-practice-card', 'Unit 4', 'Eight Fermi problems a session: guess the whole, then break it into parts on the worksheet, each with a low and a high you are 90% sure of.', [
      h('a', { class: 'ghost', href: '#/prob/fermi', id: 'fermi-practice' }, 'Start Fermi problems'),
      h('a', { class: 'ghost', href: '#/prob/chain', id: 'chain-practice' }, 'Chain problems: multiply the steps')], probsDone('U4')) : null,
    problemExamCard(ctx, 'U4'),
    lessonCard('rate-lessons-card', 'Unit 5', RATE_LESSONS, g5.open),
    g5.open ? practiceCard('rate-practice-card', 'Unit 5', 'Twelve problems a session: start outside. How often does this happen to cases like this one, and which group do you start from?', [
      h('a', { class: 'ghost', href: '#/prob/rate', id: 'rate-practice' }, 'Start base rates')], probsDone('U5')) : null,
    problemExamCard(ctx, 'U5'),
    lessonCard('update-lessons-card', 'Unit 6', UPDATE_LESSONS, g6.open),
    g6.open ? practiceCard('update-practice-card', 'Unit 6', 'Six steps a session: the rate before the news, a piece of news, and your new number. Some news is worth a big move and some is worth none. Updates on your real journal cards, with a reason, count toward this unit.', [
      h('a', { class: 'ghost', href: '#/prob/update', id: 'update-practice' }, 'Start updating')], probsDone('U6')) : null,
    problemExamCard(ctx, 'U6'),
    lessonCard('second-lessons-card', 'Unit 7', SECOND_LESSONS, g7.open),
    g7.open ? practiceCard('second-practice-card', 'Unit 7', 'Six problems a session: which counter-argument is the strongest, and how far a counter-argument should move a number. Your real journal cards count too: a gut number first, then the final one, and the weekly review grades your case against.', [
      h('a', { class: 'ghost', href: '#/prob/counter', id: 'counter-practice' }, 'Start second opinions')], probsDone('U7')) : null,
    problemExamCard(ctx, 'U7'),
    lessonCard('autopsy-lessons-card', 'Unit 8', AUTOPSY_LESSONS, g8.open),
    g8.open ? practiceCard('autopsy-practice-card', 'Unit 8', 'Six cases a session: was the result luck or judgment? And the memory check: what did you say, before you look. Every case that resolves now gets an autopsy.', [
      h('a', { class: 'ghost', href: '#/prob/luck', id: 'luck-practice' }, 'Start luck or judgment'),
      h('a', { class: 'ghost', href: '#/recall/practice', id: 'recall-practice' }, 'Memory check: recall old calls')], probsDone('U8')) : null,
    problemExamCard(ctx, 'U8'),
    lessonCard('decision-lessons-card', 'Unit 9', DECISION_LESSONS, g9.open),
    g9.open ? practiceCard('decision-practice-card', 'Unit 9', 'Six problems a session: act or hold off, where acting breaks even, and what a choice is worth on average. Then decision cards of your own, with a review date.', [
      h('a', { class: 'ghost', href: '#/prob/decisions', id: 'decision-practice' }, 'Start decisions'),
      h('a', { class: 'ghost', href: '#/decide', id: 'decision-cards' }, 'Decision cards')], probsDone('U9')) : null,
    problemExamCard(ctx, 'U9'),
    finePathCards(ctx, lessonCard, FINE_LESSONS),
    multiPathCard(ctx),
    worldPathCard(ctx),
    patterns.length ? h('section', { class: 'card', id: 'patterns' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your patterns'), h('span', { class: 'cap' }, 'from your own record')),
      h('div', null, patterns.map((c) => patternRow(ctx, c, ls)))) : null,
    arcs.map((arc) => h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Arc ${arc}`)),
      h('ul', { class: 'units' }, ctx.units.filter((u) => u.arc === arc).map((u) => {
        const st = status(u);
        return h('li', { class: st.on ? '' : 'locked' },
          h('span', { class: 't' }, h('b', null, `${u.id.replace('U', 'Unit ')} · ${u.name}`), h('em', null, u.skill)),
          h('span', { class: `chip${st.on ? ' on' : ''}` }, st.text));
      })))),
    h('p', { class: 'cap' }, 'Later units open as their blocks are built.'));
}

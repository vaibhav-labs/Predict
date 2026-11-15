// A pattern flag: what the record shows, the lesson, the drill, and where the two re-tests stand.
// Missed days (L15) is a habit flag: no lesson, no drill, only the minimum session until five good days in a row.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import { flagCard } from '../lessons.js';
import { focusFrame } from './common.js';
import { renderBlocks } from './lesson.js';
import { lessonState } from '../flags.js';
import { evidenceText, retestText, drillText, firesText, flagName } from '../flagtext.js';

const bar = (have, need) => h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((have / need) * 100)}%` }));

export function flagScreen(ctx, id) {
  const { cfg } = ctx;
  const chain = LE.flagsOf(ctx.store.events, cfg).find((c) => c.id === id);
  if (!chain) { ctx.nav('#/today'); return document.createTextNode(''); }
  const st = lessonState(ctx);
  const name = flagName(ctx, chain.trigger);
  const habit = chain.trigger === 'L15';
  const card = flagCard(chain.trigger);
  const prog = st.progress(chain);

  const evidence = h('section', { class: 'card stack', id: 'flag-evidence' },
    h('span', { class: 'eyebrow' }, 'What your record shows'),
    h('p', null, evidenceText(chain, cfg)),
    chain.fires > 1 ? h('p', { class: 'muted' }, firesText(chain)) : null);

  const lesson = card
    ? h('section', { class: 'card prose stack', id: 'flag-lesson' }, h('span', { class: 'eyebrow' }, card.title), renderBlocks(card.blocks(ctx.S)))
    : null;

  const minimum = cfg.lessons.triggers.L15.minimum;
  const habitCard = habit
    ? h('section', { class: 'card prose stack', id: 'flag-habit' },
      h('span', { class: 'eyebrow' }, 'Not a judgment lesson'),
      h('p', null, `Until you have played ${cfg.lessons.triggers.L15.clear_days} days in a row, the session shrinks to a minimum of about three minutes: ${minimum.gym_calls} gym calls, a reveal if one is due, and one prediction. A day under the minimum starts the count again.`),
      h('p', null, 'A short session every day does more for your record than a long one every few days.'))
    : null;

  let action = null;
  if (chain.state === 'open' || chain.state === 'lesson') {
    const label = chain.state === 'open' ? 'I have read it: start the drill' : 'Start the drill';
    const go = h('button', { class: 'btn', type: 'button', id: 'flag-drill' }, label);
    go.addEventListener('click', async () => {
      go.disabled = true;
      if (chain.state === 'open') await ctx.store.append(R.makeEvent('flag', { state: 'lesson', flag: chain.id }));
      ctx.nav(chain.trigger === 'L04' ? `#/rewrite/${chain.id}` : `#/gym/drill-${chain.id}`);
    });
    action = h('section', { class: 'card stack', id: 'flag-action' }, h('span', { class: 'eyebrow' }, 'The drill'), h('p', null, drillText(chain, cfg)), go);
  } else if (chain.state === 'drill' || chain.state === 'retest2') {
    action = h('section', { class: 'card stack', id: 'flag-action' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Re-test ${prog.step} of 2`), h('span', { class: 'cap num', id: 'flag-progress' }, `${prog.have} of ${prog.need}`)),
      bar(prog.have, prog.need),
      h('p', null, prog.ready ? `Counting now: ${prog.have} of the ${prog.need} observations it needs.` : `Counting starts on ${prog.readyDay}.`),
      h('p', { class: 'muted' }, retestText(chain, cfg)));
  } else if (chain.state === 'escalated') {
    action = h('section', { class: 'card stack', id: 'flag-action' }, h('span', { class: 'eyebrow' }, 'Sent to the weekly review'),
      h('p', null, 'This pattern has come back three times. The weekly review (Block 5) builds a set from your own misses. Until then it waits: it will not open a second lesson beside this one.'));
  } else if (chain.state === 'cleared') {
    action = h('section', { class: 'card stack', id: 'flag-action' }, h('span', { class: 'eyebrow' }, 'Cleared'), h('p', null, `Cleared on ${chain.clearedDay}. If the pattern comes back it opens a new lesson, judged only on calls made from now on.`));
  }
  if (habit && chain.state === 'open') {
    action = h('section', { class: 'card stack', id: 'flag-action' }, h('span', { class: 'eyebrow' }, 'Today'), h('a', { class: 'btn', href: '#/gym', id: 'flag-minimum' }, 'Start the minimum session'));
  }

  return focusFrame({ title: habit ? 'Habit' : 'Pattern', closeTo: '#/today', closeLabel: 'Back to Today' },
    h('section', null, h('div', { class: 'eyebrow' }, `${habit ? 'Habit' : 'Pattern'} · ${chain.trigger}`), h('h1', { class: 'title', id: 'flag-title' }, name)),
    evidence, lesson, habitCard, action);
}

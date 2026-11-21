// The rows that say where each pattern flag stands: shared by Today (the ones in repair) and the Path (all of them).
import { h, icon } from '../dom.js';
import { flagName, drillRoute } from '../flagtext.js';

// What the player does next about a flag, and where that is.
export function patternAction(ctx, chain, st) {
  const flag = `#/flag/${chain.id}`;
  switch (chain.state) {
    case 'open': return { text: chain.trigger === 'L15' ? 'Back to the minimum session' : 'Read the lesson', cap: chain.trigger === 'L15' ? 'Habit' : '1 min', href: flag };
    case 'lesson': return { text: 'Lesson read: start the drill', cap: 'Drill', href: drillRoute(chain) };
    case 'drill':
    case 'retest2': {
      const p = st.progress(chain);
      return { text: p.ready ? `Re-test ${p.step} of 2 is counting: ${p.have} of ${p.need}` : `Re-test ${p.step} of 2 starts on ${p.readyDay}`, cap: `${p.have} of ${p.need}`, href: flag };
    }
    case 'escalated': return { text: 'Sent to the weekly review', cap: 'Review', href: flag };
    case 'cleared': return { text: `Cleared on ${chain.clearedDay}`, cap: 'Cleared', href: flag };
    default: return { text: '', cap: '', href: flag };
  }
}

export function patternRow(ctx, chain, st) {
  const a = patternAction(ctx, chain, st);
  const done = chain.state === 'cleared';
  return h('a', { class: 'lesson-link', href: a.href, 'data-flag': chain.id, 'data-state': chain.state },
    h('span', { class: `tick${done ? ' on' : ''}`, 'aria-hidden': 'true' }, done ? icon('check', 14, 2.4) : null),
    h('span', { class: 't' }, h('b', null, flagName(ctx, chain.trigger)), h('em', null, a.text)),
    h('span', { class: 'cap num' }, a.cap));
}

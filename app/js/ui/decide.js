// The decision card (Unit 9, design/mechanics.md 4.13): what you will do, your forecast, what you stand to gain and lose, a break-even line worked out for
// you, a choice, and a review date. On the review date the card comes due: say what happened and whether you would decide the same again.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as KN from '../engine/know.js';
import { pct } from '../engine/scoring.js';
import { tabFrame, focusFrame, picker } from './common.js';
import { problemGateState } from '../flags.js';

const money = (x) => (x > 0 ? `+${x}` : `${x}`);
const OUT = { yes: 'It worked out', no: "It didn't", void: 'Void' };
const AGAIN = { same: 'I would decide the same', different: 'I would decide differently', unsure: 'Not sure' };

export const decisionsNow = (ctx) => KN.decisionsOf(ctx.store.events, R.localDay());

export function decideScreen(ctx, arg) {
  const open = problemGateState(ctx, 'U9').open;
  if (!open) { ctx.replace('#/path'); return document.createTextNode(''); }
  if (arg === 'new') return newScreen(ctx);
  if (arg) return detailScreen(ctx, arg);
  return listScreen(ctx);
}

function row(d) {
  const tail = d.state === 'reviewed' ? (d.value === null ? 'Void' : money(d.value)) : d.state === 'due' ? 'Review' : `Review ${d.review}`;
  return h('a', { class: 'lesson-link', href: `#/decide/${d.id}`, id: `decision-${d.id}` },
    h('span', { class: 't' }, h('b', null, d.text), h('em', null, `${d.choice === 'act' ? 'Act' : 'Hold off'} · forecast ${pct(d.p)} · line ${pct(d.threshold)}`)),
    h('span', { class: `chip${d.state === 'due' ? ' on' : ''}` }, tail));
}

function listScreen(ctx) {
  const list = decisionsNow(ctx);
  const sum = KN.describeDecisions(list);
  const need = ctx.cfg.decision.cards_needed;
  const part = (title, items, id) => items.length ? h('section', { class: 'card', id }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, title), h('span', { class: 'cap num' }, String(items.length))), h('div', null, items.map(row))) : null;
  return tabFrame('today', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Decisions'), h('span', { class: 'date' }, `${sum.reviewed} of ${need} reviewed`)),
    h('section', { class: 'card stack' }, h('p', null, 'A decision card holds what you will do, your forecast, what you gain and lose, and a date to look back. Ten reviewed decisions are the Unit 9 journal row.'),
      h('a', { class: 'btn', href: '#/decide/new', id: 'decision-new' }, 'New decision card')),
    part('Due for review', list.filter((d) => d.state === 'due'), 'decisions-due'),
    part('Open', list.filter((d) => d.state === 'open'), 'decisions-open'),
    part('Reviewed', list.filter((d) => d.state === 'reviewed').reverse(), 'decisions-reviewed'),
    list.length ? null : h('p', { class: 'cap', id: 'decisions-empty' }, 'No decision cards yet.'));
}

function newScreen(ctx) {
  const { cfg } = ctx;
  const D = cfg.decision;
  const today = R.localDay();
  const draft = { choice: null };
  const text = h('textarea', { class: 'field', id: 'decision-text', rows: 2, placeholder: 'What are you deciding?' });
  const option = h('input', { class: 'field', id: 'decision-option', type: 'text', placeholder: 'What you will do if you act' });
  const p = h('input', { class: 'field num', id: 'decision-p', type: 'number', inputmode: 'numeric', min: 1, max: 99, placeholder: '%' });
  const gain = h('input', { class: 'field num', id: 'decision-gain', type: 'number', inputmode: 'numeric', min: D.min_stake, placeholder: 'e.g. 30' });
  const loss = h('input', { class: 'field num', id: 'decision-loss', type: 'number', inputmode: 'numeric', min: D.min_stake, placeholder: 'e.g. 10' });
  const review = h('input', { class: 'field', id: 'decision-review', type: 'date', value: R.addDays(today, 30), min: R.addDays(today, D.min_review_days), max: R.addDays(today, D.max_review_days) });
  const line = h('p', { class: 'note', id: 'decision-line', role: 'status' }, 'Fill in the forecast and both stakes to see the break-even line.');
  const msg = h('p', { class: 'msg', id: 'decision-msg', role: 'status' });
  const lockBtn = h('button', { class: 'btn', type: 'button', id: 'decision-lock' }, 'Lock the decision');
  const choicePick = picker([['act', 'Act'], ['hold', 'Hold off']], null, (v) => { draft.choice = v; paint(); });

  const fields = () => ({ text: text.value, option: option.value, p: Number(p.value) / 100, gain: gain.value, loss: loss.value, choice: draft.choice, review: review.value });
  function paint() {
    const f = fields();
    const ok = Number.isFinite(f.p) && p.value.trim() !== '' && Number(f.gain) >= 1 && Number(f.loss) >= 1;
    if (ok) {
      const t = KN.breakEven(Number(f.gain), Number(f.loss));
      const rule = KN.ruleOf(f.p, Number(f.gain), Number(f.loss));
      line.textContent = `Break-even is ${pct(t)}: acting pays on average above it. Your forecast is ${pct(f.p)}, so the line says ${rule === 'act' ? 'act' : 'hold off'}.${draft.choice && draft.choice !== rule ? ' You are choosing against the line: that is allowed, and the review will show what it cost or gained.' : ''}`;
    } else line.textContent = 'Fill in the forecast and both stakes to see the break-even line.';
    const r = KN.checkDecision(f, cfg, today);
    msg.textContent = r.ok || !(text.value.trim() && p.value.trim() && gain.value.trim() && loss.value.trim() && draft.choice) ? '' : r.error;
    msg.className = msg.textContent ? 'msg err' : 'msg';
    return r;
  }
  [text, option, p, gain, loss, review].forEach((el) => el.addEventListener('input', paint));
  const armedAt = Date.now() + (cfg.gym.tap_guard_ms ?? 400);
  lockBtn.addEventListener('click', async () => {
    if (Date.now() < armedAt) return;
    const r = KN.checkDecision(fields(), cfg, today);
    if (!r.ok) { msg.textContent = r.error; msg.className = 'msg err'; return; }
    lockBtn.disabled = true;
    const ev = R.makeEvent('decision', { text: text.value.trim(), option: option.value.trim(), p: r.p, gain: r.gain, loss: r.loss, threshold: r.threshold, rule: r.rule, choice: fields().choice, review: r.review });
    await ctx.store.append(ev);
    ctx.requestPersist();
    ctx.nav(`#/decide/${ev.id}`);
  });
  const lab = (t, el) => h('label', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'cap' }, t), el);
  return focusFrame({ title: 'New decision', closeTo: '#/decide', closeLabel: 'Back to decisions' },
    h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'The decision'), text, lab('What you will do if you act', option),
      h('div', { class: 'eyebrow' }, 'Your forecast'), lab('The chance it works out (%)', p),
      h('div', { class: 'eyebrow' }, 'What is at stake'), lab('What you gain if you act and it works out', gain), lab('What you lose if you act and it does not', loss),
      line,
      h('div', { class: 'eyebrow' }, 'Your choice'), choicePick,
      h('div', { class: 'eyebrow' }, 'Review on'), lab(`A date ${D.min_review_days} to ${D.max_review_days} days from today`, review),
      msg,
      h('div', { class: 'foot' }, lockBtn)));
}

function detailScreen(ctx, id) {
  const wrap = h('div', null);
  function paint() {
    const d = decisionsNow(ctx).find((x) => x.id === id);
    if (!d) { ctx.nav('#/decide'); return; }
    wrap.replaceChildren(detailBody(ctx, d, paint));
    window.scrollTo(0, 0);
  }
  paint();
  return wrap;
}

function detailBody(ctx, d, paint) {
  const head = h('section', null, h('div', { class: 'tags' }, h('span', { class: 'tag' }, d.state === 'reviewed' ? 'Reviewed' : d.state === 'due' ? 'Due for review' : 'Open')), h('p', { class: 'claim', id: 'decision-claim' }, d.text), h('p', { class: 'cap' }, `${d.choice === 'act' ? `Act: ${d.option}` : `Hold off (the option was: ${d.option})`} · locked ${d.d} · review ${d.review}`));
  const numbers = h('section', { class: 'card stack', id: 'decision-numbers' }, h('div', { class: 'rl-key' },
    h('span', null, h('b', null, 'Forecast'), ` ${pct(d.p)}`), h('span', null, h('b', null, 'Gain'), ` ${d.gain}`), h('span', null, h('b', null, 'Loss'), ` ${d.loss}`), h('span', null, h('b', null, 'Break-even'), ` ${pct(d.threshold)}`)),
    h('p', null, `The line said ${d.rule === 'act' ? 'act' : 'hold off'}. You chose to ${d.choice === 'act' ? 'act' : 'hold off'}${d.followed ? ', following it' : ', against it'}.`));
  if (d.state === 'open') return focusFrame({ title: 'Decision', closeTo: '#/decide', closeLabel: 'Back to decisions' }, head, numbers, h('p', { class: 'cap', id: 'decision-wait' }, `It comes due on ${d.review}.`));
  if (d.state === 'reviewed') {
    const known = d.value !== null;
    return focusFrame({ title: 'Decision', closeTo: '#/decide', closeLabel: 'Back to decisions' }, head, numbers,
      h('section', { class: 'card stack', id: 'decision-result' }, h('span', { class: 'eyebrow' }, 'What happened'), h('p', null, OUT[d.outcome]),
        known ? h('p', { id: 'decision-value' }, `Your choice paid ${money(d.value)}. The line's choice would have paid ${money(d.ruleValue)}${d.value === d.ruleValue ? ': the same.' : d.value > d.ruleValue ? ': you did better than the line this time.' : ': the line would have done better this time.'}`) : h('p', null, 'Void: this one scores nothing.'),
        h('p', { class: 'cap' }, AGAIN[d.again] || ''),
        d.review_event && d.review_event.note ? h('p', null, d.review_event.note) : null));
  }
  // due: say what happened
  let outcome = null, again = null;
  const note = h('textarea', { class: 'field', id: 'review-note', rows: 2, placeholder: 'A line on what happened (optional).' });
  const go = h('button', { class: 'btn', type: 'button', id: 'review-go' }, 'Save the review');
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  go.addEventListener('click', async () => {
    if (Date.now() < armedAt) return;
    if (!outcome || !again) { ctx.toast('Say what happened, and whether you would decide the same again.'); return; }
    go.disabled = true;
    await ctx.store.append(R.makeEvent('decision_review', { decision: d.id, outcome, again, note: note.value.trim() || undefined }));
    paint();
  });
  return focusFrame({ title: 'Review', closeTo: '#/decide', closeLabel: 'Back to decisions' }, head, numbers,
    h('section', { class: 'card stack', id: 'decision-review-card' }, h('div', { class: 'eyebrow' }, 'What happened?'),
      picker([['yes', 'It worked out'], ['no', "It didn't"], ['void', 'Void']], null, (v) => { outcome = v; }, { id: 'review-outcome' }),
      h('div', { class: 'eyebrow' }, 'Knowing what you know now'),
      picker([['same', 'Decide the same'], ['different', 'Decide differently'], ['unsure', 'Not sure']], null, (v) => { again = v; }, { id: 'review-again' }),
      note, h('div', { class: 'foot' }, go)));
}

// Today: the decision reviews that have come due (rows for the "Needs you" card), and the card that opens the decision list.
export function dueDecisionRows(ctx) {
  if (!problemGateState(ctx, 'U9').open) return [];
  return KN.decisionsDue(decisionsNow(ctx)).map((d) => h('a', { class: 'lesson-link', href: `#/decide/${d.id}`, id: `need-decision-${d.id}` },
    h('span', { class: 'tick', 'aria-hidden': 'true' }),
    h('span', { class: 't' }, h('b', null, 'Decision review due'), h('em', null, d.text)),
    h('span', { class: 'cap' }, 'Review')));
}
export function decideTodayCard(ctx) {
  if (!problemGateState(ctx, 'U9').open) return null;
  const sum = KN.describeDecisions(decisionsNow(ctx));
  return h('section', { class: 'card stack', id: 'decide-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 9 · Decision cards'), h('span', { class: 'cap num' }, `${sum.reviewed} of ${ctx.cfg.decision.cards_needed} reviewed`)),
    h('p', { id: 'decide-line' }, `${sum.open} open · ${sum.due} due for review`),
    h('a', { class: 'ghost', href: '#/decide', id: 'decide-start' }, 'Decision cards'));
}

// The autopsy (A02): after a real prediction missed at 85% or more (and one in five confident hits), four questions and a
// quick audit of the chain, before the next journal step. What the player writes seeds the case file; the rule goes above the
// next five journal cards and is re-checked at 3 and 10 days.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import { pct } from '../engine/scoring.js';
import { focusFrame, picker } from './common.js';
import { lessonState } from '../flags.js';

export const MARKS = [['held', 'Held up'], ['weak', 'Weak'], ['missed', 'Missed it']];
export const markLabel = (m) => (MARKS.find((x) => x[0] === m) || [m, m])[1];
const OUTCOME = { yes: 'It happened', no: 'It did not happen' };
export const USED = { yes: 'Used it', partly: 'Used it in part', no: 'Did not use it' };

// The cards that still need an autopsy, oldest first: [{ p, kind }].
export const pendingAutopsies = (ctx) => lessonState(ctx).due.pending;

// What the record says about the outcome: how likely it was at the baseline, and whether that counts as rare.
export function luckRead(ctx, p) {
  const chance = LE.cardOutcomeChance(p);
  return { chance, kind: LE.luckOrJudgment(chance, ctx.cfg) };
}

// The links of a chain, in the order they are audited.
export function links(p) {
  const c = p.chain;
  return [
    { key: 'outside', id: 'audit-outside', label: 'Outside view', text: `${c.outsideView.text} (${Math.round(c.outsideView.rate * 100)}%)` },
    ...c.evidence.map((ev, i) => ({ key: `e${i + 1}`, id: `audit-e${i + 1}`, label: `Signal ${i + 1} (${ev.dir === 'up' ? 'supports' : 'against'})`, text: ev.text })),
    { key: 'case', id: 'audit-case', label: 'Case against', text: `${c.caseAgainst.text} (${c.caseAgainst.number})` },
    { key: 'trip', id: 'audit-trip', label: 'Tripwire', text: `${c.tripwire.text} (to ${c.tripwire.number})` },
  ];
}
// The audit as it is stored: one mark for each link, by the keys above.
export const auditOf = (a) => (a && a.audit) || {};

export function autopsyScreen(ctx, id) {
  const { cfg, store } = ctx;
  const today = R.localDay();
  const predictions = R.predictionsOf(store.events, today);
  const p = predictions.find((x) => x.id === id);
  if (!p) { ctx.replace('#/journal'); return document.createTextNode(''); }
  const due = LE.autopsyDue(predictions, store.events, cfg);
  const need = LE.needsAutopsy(p, due);
  if (!need || due.done.has(p.id)) { ctx.replace(`#/journal/${p.id}`); return document.createTextNode(''); }

  const startedAt = Date.now();
  const miss = need.kind === 'miss';
  const side = LE.sideOf(p);
  const luck = luckRead(ctx, p);
  const marks = {};
  const minChars = cfg.lessons.autopsy.min_chars;
  const L = links(p);

  const knew = h('textarea', { class: 'field', id: 'autopsy-knew', rows: 2, placeholder: 'What did you actually know, before you locked?' });
  const missedBox = h('textarea', { class: 'field', id: 'autopsy-missed', rows: 2, placeholder: miss ? 'What did you not see, or not weigh?' : 'What could have gone the other way?' });
  const rule = h('textarea', { class: 'field', id: 'autopsy-rule', rows: 2, placeholder: 'One rule for next time, in your own words.' });
  let verdict = null;
  const file = h('button', { class: 'btn', type: 'button', id: 'autopsy-file' }, 'File the autopsy');
  file.disabled = true;

  const ready = () => L.every((l) => marks[l.key]) && [knew, missedBox, rule].every((b) => b.value.trim().length >= minChars) && !!verdict;
  const update = () => { file.disabled = !ready(); };
  [knew, missedBox, rule].forEach((b) => b.addEventListener('input', update));

  const auditRows = L.map((l) => h('div', { class: 'stack', style: 'gap:6px' },
    h('div', { class: 'eyebrow' }, l.label), h('p', null, l.text),
    picker(MARKS, null, (v) => { marks[l.key] = v; update(); }, { id: l.id })));

  const suggestion = miss
    ? (luck.chance === null ? null : h('p', { class: 'muted', id: 'autopsy-suggest' },
      `At your baseline (${pct(p.b)} for yes), what happened had a ${pct(luck.chance)} chance. ${luck.kind === 'luck'
        ? `That is rare, under ${pct(cfg.lessons.luck_rare_below)}: it may be luck.`
        : 'That is not rare: the call, more than luck, was the problem.'}`))
    : h('p', { class: 'muted', id: 'autopsy-suggest' }, luck.chance === null ? 'Was the hit luck, or were your reasons right?' : `At your baseline (${pct(p.b)} for yes), what happened had a ${pct(luck.chance)} chance. Was the hit luck, or were your reasons right?`);

  const armedAt = Date.now() + (cfg.gym.tap_guard_ms ?? 400);
  file.addEventListener('click', async () => {
    if (Date.now() < armedAt || !ready()) return;
    file.disabled = true;
    const audit = { outside: marks.outside, evidence: p.chain.evidence.map((_, i) => marks[`e${i + 1}`]), caseAgainst: marks.case, tripwire: marks.trip };
    await store.append(R.makeEvent('autopsy', {
      prediction: p.id, kind: need.kind, audit, knew: knew.value.trim(), missed: missedBox.value.trim(), verdict,
      suggested: miss ? luck.kind : null, chance: luck.chance, rule: rule.value.trim(), ms: Date.now() - startedAt,
    }));
    const left = LE.autopsyDue(R.predictionsOf(store.events, today), store.events, cfg).pending;
    ctx.replace(left.length ? `#/autopsy/${left[0].p.id}` : `#/journal/${p.id}`);
  });

  return focusFrame({ title: 'Autopsy', closeTo: '#/journal', closeLabel: 'Back to the Journal' },
    h('section', null,
      h('div', { class: 'tags' }, h('span', { class: 'tag' }, 'Autopsy'), h('span', { class: 'tag', id: 'autopsy-kind' }, miss ? `A miss at ${pct(side.c)}` : `A confident hit, sampled`)),
      h('p', { class: 'claim', id: 'autopsy-claim' }, p.text),
      h('p', { class: 'cap' }, `You said ${pct(p.c)} · ${OUTCOME[p.outcome]}.`),
      h('p', { class: 'lede' }, miss
        ? `A miss this sure gets an autopsy before your next journal step. About ninety seconds, and the answers go into the case file.`
        : `One in ${cfg.lessons.autopsy.hit_sample_every} confident hits is looked at too, to catch being right for the wrong reason.`)),
    h('section', { class: 'card stack', id: 'autopsy-audit' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, '1 · Each link, against what happened')), ...auditRows),
    h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, '2 · What I knew'), knew),
    h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, miss ? '3 · What I missed' : '3 · What I might have missed'), missedBox),
    h('section', { class: 'card stack' },
      h('span', { class: 'eyebrow' }, miss ? '4 · Luck or judgment?' : '4 · Luck or judgment?'), suggestion,
      picker([['luck', 'Luck'], ['judgment', 'Judgment']], null, (v) => { verdict = v; update(); }, { id: 'autopsy-verdict' })),
    h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, '5 · One rule for next time'), rule),
    h('div', { class: 'foot' }, file, h('span', { class: 'cap' }, 'Every link marked and every box filled, then you can file it.')));
}

// A re-check of a rule: "did you use it?" Answered with one tap; `onDone` runs after the answer is saved.
export function recheckCard(ctx, r, onDone) {
  const days = ctx.cfg.lessons.autopsy.recheck_days[r.step - 1];
  const buttons = Object.entries(USED).map(([v, label]) => {
    const b = h('button', { class: 'pick', type: 'button', 'data-value': v }, label);
    b.addEventListener('click', async () => {
      buttons.forEach((x) => { x.disabled = true; });
      await ctx.store.append(R.makeEvent('recheck', { autopsy: r.autopsy.id, step: r.step, used: v }));
      if (onDone) onDone();
    });
    return b;
  });
  return h('section', { class: 'card stack recheck', id: `recheck-${r.step}` },
    h('span', { class: 'eyebrow' }, `Rule check · ${days} days on`),
    h('p', null, h('b', null, r.autopsy.rule)),
    h('p', { class: 'muted' }, 'Since you wrote that rule, did you use it?'),
    h('div', { class: 'picker' }, buttons));
}

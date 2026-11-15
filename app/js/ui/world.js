// Unit 11, With the machine (Block 10): world questions forecast twice around a look at Predict's own number. See engine/world.js for the flow and the scoring.
// Predict's number is never drawn until the player's first number is locked: the open screen has no field for it, and its text appears only on the screens
// of a question that has a first number.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as FN from '../engine/fine.js';
import * as WD from '../engine/world.js';
import { signed, pct } from '../engine/scoring.js';
import { focusFrame, picker } from './common.js';
import { makeDial } from './dial.js';
import { fineGateState } from '../flags.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayText = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const whole = (p) => `${Math.round(p * 100)}%`;
const OUTCOMES = [['yes', 'It happened'], ['no', 'It did not happen'], ['void', 'Cannot be settled']];

export const worldOpen = (ctx) => fineGateState(ctx).passed;
export const worldList = (ctx) => WD.worldQuestions(ctx.store.events, ctx.coach || { forecasts: {} }, R.localDay());
export const worldGateOf = (ctx) => WD.worldGate(ctx.S, worldList(ctx), ctx.cfg.gates);

// Where a question stands, in words, without its number when the player has not locked a first one.
const stateLine = (q) => ({
  open: `Open until ${dayText(q.due)}`, reveal: 'Your first number is in: look at Predict\'s, then finalise', waiting: `Locked. Settles on ${dayText(q.due)}`,
  due: 'Due: say what happened', resolved: 'Settled', expired: 'Closed before you forecast it', lapsed: 'Closed before you finalised',
}[q.state]);

function dialFor(ctx, start) {
  const steps = FN.fineSteps(ctx.cfg);
  const dial = makeDial(ctx.S, { steps, rule: ctx.S.sharpRule });
  if (start !== undefined) {
    const k = start >= 0.5 ? Math.round((start - 0.5) * 100) : -Math.round((0.5 - start) * 100);
    dial.input.value = String(Math.max(-(steps.length - 1), Math.min(steps.length - 1, k)));
    dial.input.dispatchEvent(new Event('input'));
  }
  return dial;
}
// The dial reads a side and a confidence; a forecast is the chance of yes.
const yesChance = (v) => (v.side === 'yes' ? v.c : Math.round((1 - v.c) * 100) / 100);

export function worldScreen(ctx, arg) {
  if (!worldOpen(ctx)) { ctx.replace('#/path'); return document.createTextNode(''); }
  return arg ? questionScreen(ctx, arg) : listScreen(ctx);
}

function listScreen(ctx) {
  const qs = worldList(ctx);
  const gate = worldGateOf(ctx);
  const group = (state, title, note) => {
    const rows = qs.filter((q) => (Array.isArray(state) ? state.includes(q.state) : q.state === state));
    if (!rows.length) return null;
    return h('section', { class: 'card stack', id: `world-${Array.isArray(state) ? state[0] : state}` },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, title), h('span', { class: 'cap num' }, String(rows.length))),
      note ? h('p', { class: 'cap' }, note) : null,
      ...rows.map((q) => h('div', { class: 'stack', style: 'gap:4px', 'data-id': q.id },
        h('p', null, q.text), h('span', { class: 'cap' }, stateLine(q)),
        ['open', 'reveal', 'due'].includes(q.state) ? h('a', { class: 'ghost', href: `#/world/${q.id}` }, q.state === 'open' ? 'Forecast it' : q.state === 'reveal' ? 'See Predict\'s number' : 'Say what happened') : null)));
  };
  const resolved = qs.filter((q) => q.state === 'resolved');
  const body = [
    group(['due'], 'Say what happened', 'These have reached their day.'),
    group(['reveal'], 'Finalise', 'Predict\'s number is waiting for you.'),
    group(['open'], 'Open to forecast', 'Lock your own number first. Predict\'s stays sealed until you do.'),
    group(['waiting'], 'Waiting for the day'),
    resolved.length ? h('section', { class: 'card stack', id: 'world-resolved' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Settled'), h('span', { class: 'cap num' }, String(resolved.length))),
      ...resolved.map((q) => resolvedRow(ctx, q))) : null,
  ].filter(Boolean);
  return focusFrame({ title: 'With the machine', closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('p', { class: 'lede', id: 'world-lede' }, 'World questions you forecast twice. Predict wrote its own number before the question opened; you see it only after you lock yours. Then you stand by one number, and it is scored three ways.')),
    gateCard(gate),
    ...(body.length ? body : [h('section', { class: 'card', id: 'world-empty' }, h('p', null, 'No world questions are open. Predict adds new ones in its weekly review; they appear here the day they open.'))]));
}

function gateCard(g) {
  return h('section', { class: 'card stack', id: 'world-gate' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The measure'), h('span', { class: 'cap num', id: 'world-count' }, `${g.n} of ${g.needed} settled`)),
    h('p', null, `Over ${g.needed} settled questions, your final numbers should score at least as well as your first ones and as Predict's alone.`),
    g.n ? h('p', { class: 'cap', id: 'world-means' }, `So far, a question: first ${signed(Math.round(g.first))}, final ${signed(Math.round(g.final))}, Predict ${signed(Math.round(g.machine))}.`) : null,
    g.ready ? h('p', { class: g.passed ? 'msg' : 'msg err', id: 'world-verdict' }, g.passed ? 'Met: your final numbers are at least as good as both.' : `Not met yet: ${!g.beatsFirst ? 'your final numbers score below your first ones' : ''}${!g.beatsFirst && !g.beatsMachine ? ' and ' : ''}${!g.beatsMachine ? 'Predict\'s alone scores higher' : ''}.`) : h('p', { class: 'cap' }, 'This needs real weeks of questions settling; there is no exam to sit.'));
}

const resolvedRow = (ctx, q) => {
  const sc = WD.worldScores(ctx.S, q);
  return h('div', { class: 'stack', style: 'gap:4px', 'data-id': q.id },
    h('p', null, q.text),
    h('span', { class: 'cap' }, q.resolve.outcome === 'void' ? 'Could not be settled: no points.' : `${q.resolve.outcome === 'yes' ? 'It happened' : 'It did not happen'} · first ${whole(q.first.p)} (${signed(sc.first)}) · final ${whole(q.final.p)} (${signed(sc.final)}) · Predict ${whole(q.machine)} (${signed(sc.machine)})`));
};

function questionScreen(ctx, id) {
  const { store } = ctx;
  const q = worldList(ctx).find((x) => x.id === id);
  if (!q) { ctx.replace('#/world'); return document.createTextNode(''); }
  const guardMs = ctx.cfg.gym.tap_guard_ms ?? 400;
  const shownAt = Date.now();
  const frame = (...kids) => focusFrame({ title: 'With the machine', closeTo: '#/world', closeLabel: 'Back to the list' },
    h('section', null, h('div', { class: 'tags' }, h('span', { class: 'tag' }, 'Unit 11'), h('span', { class: 'tag', id: 'world-tag' }, stateLine(q))),
      h('p', { class: 'claim', id: 'world-claim' }, q.text), h('p', { class: 'cap' }, `Settles on ${dayText(q.due)}.`)), ...kids);
  const again = () => ctx.refresh();

  if (q.state === 'open') {
    const dial = dialFor(ctx);
    const lock = h('button', { class: 'btn', type: 'button', id: 'world-lock' }, 'Lock my first number');
    const armedAt = Date.now() + guardMs;
    lock.addEventListener('click', async () => {
      if (Date.now() < armedAt) return;
      lock.disabled = true;
      await store.append(R.makeEvent('world', { state: 'first', q: q.id, text: q.text, due: q.due, opens: q.opens, p: yesChance(dial.value()), ms: Math.min(1800000, Date.now() - shownAt) }));
      ctx.requestPersist();
      again();
    });
    return frame(
      h('section', { class: 'card soft stack', id: 'world-sealed' }, h('span', { class: 'eyebrow' }, 'Predict\'s number'), h('p', null, 'Sealed. Predict wrote its own forecast before this question opened. You will see it as soon as your first number is locked.')),
      dial.el, h('div', { class: 'foot' }, lock, h('span', { class: 'cap' }, 'First, from your own head.')));
  }

  if (q.state === 'reveal') {
    const dial = dialFor(ctx, q.first.p);
    const lock = h('button', { class: 'btn', type: 'button', id: 'world-final' }, 'Stand by this number');
    const armedAt = Date.now() + guardMs;
    lock.addEventListener('click', async () => {
      if (Date.now() < armedAt) return;
      lock.disabled = true;
      await store.append(R.makeEvent('world', { state: 'final', q: q.id, p: yesChance(dial.value()), machine: q.machine, machineWritten: q.machineWritten, machineRef: q.machineRef, ms: Math.min(1800000, Date.now() - shownAt) }));
      ctx.requestPersist();
      ctx.replace('#/world');
    });
    return frame(
      h('section', { class: 'sumgrid', id: 'world-numbers' },
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Your first number'), h('b', { class: 'num', id: 'world-first' }, whole(q.first.p)), h('span', { class: 'cap' }, 'chance of yes')),
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Predict'), h('b', { class: 'num', id: 'world-machine' }, whole(q.machine)), h('span', { class: 'cap' }, `written ${dayText(q.machineWritten)}, before this opened`))),
      h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, 'How Predict got there'), h('p', { id: 'world-ref' }, q.machineRef),
        h('p', { class: 'muted' }, 'You do not have to move. If you move, say why to yourself first: a reason you can name, not just the pull of a bigger number.')),
      h('p', { class: 'cap' }, 'The dial starts at your first number. Whatever you lock is the one that counts.'),
      dial.el, h('div', { class: 'foot' }, lock));
  }

  if (q.state === 'due') {
    let picked = null;
    const save = h('button', { class: 'btn', type: 'button', id: 'world-resolve', disabled: true }, 'Save what happened');
    const armedAt = Date.now() + guardMs;
    save.addEventListener('click', async () => {
      if (Date.now() < armedAt || !picked) return;
      save.disabled = true;
      const used = q.predictResult && picked === q.predictResult;
      await store.append(R.makeEvent('world', { state: 'resolve', q: q.id, outcome: picked, via: used ? 'predict' : 'self', ...(used ? { source: q.predictSource } : {}) }));
      again();
    });
    return frame(
      q.predictResult ? h('section', { class: 'card stack', id: 'world-checked' }, h('span', { class: 'eyebrow' }, `Predict checked ${dayText(q.predictChecked)}`),
        h('p', null, `Its reading: ${q.predictResult === 'void' ? 'cannot be settled' : q.predictResult === 'yes' ? 'it happened' : 'it did not happen'}.`),
        h('a', { class: 'link', href: q.predictSource, target: '_blank', rel: 'noopener noreferrer' }, 'The page it read ↗'), h('p', { class: 'cap' }, 'You confirm: pick what you find.')) : null,
      h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, 'What happened?'),
        picker(OUTCOMES, null, (v) => { picked = v; save.disabled = false; }, { id: 'world-outcome' })),
      h('div', { class: 'foot' }, save));
  }

  if (q.state === 'resolved') return frame(h('section', { class: 'card stack', id: 'world-done' }, resolvedRow(ctx, q)), h('div', { class: 'foot' }, h('a', { class: 'btn', href: '#/world' }, 'Back to the list')));
  return frame(h('section', { class: 'card stack', id: 'world-wait' },
    q.first ? h('p', null, `Locked: first ${whole(q.first.p)}${q.final ? `, final ${whole(q.final.p)}, Predict ${whole(q.machine)}` : ''}.`) : h('p', null, 'This closed before you forecast it, so it is not scored.'),
    q.state === 'waiting' ? h('p', { class: 'cap' }, `Come back on ${dayText(q.due)} to say what happened.`) : null),
  h('div', { class: 'foot' }, h('a', { class: 'btn', href: '#/world' }, 'Back to the list')));
}

// ---- cards --------------------------------------------------------------------------------------------------------------------------------
export function worldTodayCard(ctx) {
  if (!worldOpen(ctx)) return null;
  const qs = worldList(ctx);
  const act = qs.filter((q) => ['open', 'reveal', 'due'].includes(q.state));
  if (!act.length) return null;
  const due = act.filter((q) => q.state === 'due').length;
  return h('section', { class: 'card stack', id: 'u11-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 11 · With the machine'), h('span', { class: 'cap num', id: 'u11-count' }, `${act.length} waiting`)),
    h('p', { id: 'u11-line' }, due ? `${due} ${due === 1 ? 'question has' : 'questions have'} reached ${due === 1 ? 'its' : 'their'} day. ` : '', 'World questions to forecast, then compare with Predict\'s number.'),
    h('a', { class: 'ghost', href: '#/world', id: 'u11-start' }, 'Open the list'));
}

export function worldPathCard(ctx) {
  const open = worldOpen(ctx);
  if (!open) return h('section', { class: 'card stack', id: 'pgate-U11-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 11 · With the machine'), h('span', { class: 'chip', id: 'pgate-U11-status' }, 'Not open yet')),
    h('p', null, 'It opens after the Unit 10 exam is passed.'));
  const g = worldGateOf(ctx);
  return h('section', { class: 'card stack', id: 'pgate-U11-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 11 · With the machine'), h('span', { class: `chip${g.passed ? ' on' : ''}`, id: 'pgate-U11-status' }, g.passed ? 'Met' : g.ready ? 'Not met' : 'Collecting')),
    h('p', null, `${g.n} of ${g.needed} world questions settled with both your forecasts and Predict's. It takes weeks of real questions, not a sitting.`),
    h('a', { class: 'ghost', href: '#/world', id: 'u11-open' }, 'Open the list'));
}

export function worldMirrorRows(ctx) {
  if (!worldOpen(ctx)) return null;
  const g = worldGateOf(ctx);
  if (!g.n) return null;
  return g;
}

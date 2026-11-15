// The memory check (Unit 8, design/mechanics.md 4.13): "what did you say?" before the record is shown. Two places ask it: a due journal card (the
// record stays hidden until the player answers) and the recall practice on old gym calls (also the drill for pattern L12). Every answer is a
// `memory` event; drift (how far memory moved toward what happened) is read from them by engine/know.js.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import * as KN from '../engine/know.js';
import { seeded, randomSeed } from '../engine/draw.js';
import { pct } from '../engine/scoring.js';
import { focusFrame } from './common.js';
import { problemGateState } from '../flags.js';

const pts = (x) => `${Number(Math.abs(x * 100).toFixed(1))} point${Math.abs(x * 100) === 1 ? '' : 's'}`;

// A line saying how a recalled number compared with the record.
export function driftLine(recalled, recorded) {
  const d = recalled - recorded;
  if (Math.abs(d) < 0.005) return `You remembered ${pct(recalled)}: exactly what the record says.`;
  return `You remembered ${pct(recalled)}; the record says ${pct(recorded)}. Your memory was ${pts(d)} ${d > 0 ? 'higher' : 'lower'}.`;
}

// The number field, with its checks. `lo` and `hi` bound what is accepted; `label` says which number is asked for.
function recallField(ctx, lo, hi, label, onLock, lockText = 'Lock my answer') {
  const input = h('input', { class: 'field num', id: 'recall-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'recall-msg' });
  const msg = h('p', { class: 'msg', id: 'recall-msg', role: 'status' });
  const btn = h('button', { class: 'btn', type: 'button', id: 'recall-lock', disabled: true }, lockText);
  const check = () => { const r = KN.checkRecall(input.value, lo, hi); btn.disabled = !r.ok; msg.textContent = !r.ok && input.value.trim() ? r.error : ''; msg.className = msg.textContent ? 'msg err' : 'msg'; return r; };
  input.addEventListener('input', check);
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  btn.addEventListener('click', () => { if (Date.now() < armedAt || btn.disabled) return; const r = check(); if (!r.ok) return; btn.disabled = true; onLock(r.value); });
  const node = h('section', { class: 'card stack', id: 'recall-entry' },
    h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, label), input, h('span', { class: 'cap' }, '%')), msg, h('div', { class: 'foot' }, btn));
  return { node, input };
}

// ---- on a due card: before the record is shown ----------------------------------------------------------------------------------
// `onDone` runs after the answer is saved (the screen repaints and shows the record, now with the drift).
export function memoryCard(ctx, p, onDone) {
  const { cfg } = ctx;
  const M = cfg.memory;
  const f = recallField(ctx, M.recall_min, M.recall_max, 'The number you locked', async (value) => {
    await ctx.store.append(R.makeEvent('memory', { src: 'card', ref: p.id, recalled: value, recorded: typeof p.cNow === 'number' ? p.cNow : p.c, mode: 'card' }));
    onDone(value);
  }, 'Lock my answer, then show the record');
  return h('section', { class: 'card stack', id: 'memory-card' },
    h('span', { class: 'eyebrow' }, 'Before the record: what did you say?'),
    h('p', null, `This card is due. Type the probability of yes you had on it when you last set it, from memory. The record stays hidden until you answer.`),
    f.node);
}

// What the player remembered of a card, when they were asked (shown under the card's header once the record is visible).
export function memoryNote(ctx, p) {
  const e = ctx.store.events.find((x) => x.type === 'memory' && x.src === 'card' && x.ref === p.id);
  return e ? h('p', { class: 'cap', id: 'memory-note' }, driftLine(e.recalled, e.recorded)) : null;
}

// ---- the recall practice and the drill ----------------------------------------------------------------------------------------------
export function recallScreen(ctx, arg, token) {
  const { store, cfg } = ctx;
  const events = () => store.events;
  const today = R.localDay();
  const g8 = problemGateState(ctx, 'U8');
  const chain = arg && arg.startsWith('drill-') ? LE.flagsOf(store.events, cfg).find((c) => c.id === arg.slice(6)) : null;
  const spec = chain && LE.drillOf(chain.trigger, cfg);
  if (!g8.open || (arg && arg.startsWith('drill-') && (!chain || !spec || spec.kind !== 'recall' || !['open', 'lesson'].includes(chain.state)))) {
    ctx.replace('#/path');
    return document.createTextNode('');
  }
  const mode = chain ? 'drill' : 'practice';
  const need = chain ? spec.calls : cfg.memory.session_size;
  const session = `rc-${randomSeed().toString(36)}`;
  const rng = seeded(randomSeed());
  const wrap = h('div', null);
  const mount = (view) => { wrap.replaceChildren(view); window.scrollTo(0, 0); };
  const doneInSession = () => events().filter((e) => e.type === 'memory' && e.session === session).length;
  // A drill counts across reloads: the checks already made for this flag.
  const doneForFlag = () => events().filter((e) => e.type === 'memory' && e.flag === chain.id).length;
  const progressNow = () => (chain ? doneForFlag() : doneInSession());

  async function finish() {
    if (chain && !events().some((e) => e.type === 'flag' && e.state === 'drill' && e.session === `recall-${chain.id}`)) await store.append(R.makeEvent('flag', { state: 'drill', flag: chain.id, session: `recall-${chain.id}` }));
    const mine = events().filter((e) => e.type === 'memory' && (chain ? e.flag === chain.id : e.session === session));
    const calls = new Map(events().filter((e) => e.type === 'call').map((e) => [e.id, e]));
    const shifts = mine.map((e) => { const c = calls.get(e.ref); return c ? KN.shiftToward(e.recalled, e.recorded, !!c.hit) : 0; });
    const drift = shifts.length ? shifts.reduce((a, b) => a + b, 0) / shifts.length : 0;
    const abs = mine.length ? mine.reduce((s, e) => s + Math.abs(e.recalled - e.recorded), 0) / mine.length : 0;
    if (!ctx.alive(token)) return;
    mount(focusFrame({ title: 'Recall done', closeLabel: 'Back to Today' },
      h('section', null, h('div', { class: 'eyebrow' }, chain ? 'Drill' : 'Recall practice'), h('p', { class: 'claim', style: 'font-size:24px', id: 'recall-head' }, `${mine.length} checks done.`)),
      h('section', { class: 'sumgrid' },
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average error'), h('b', { class: 'num', id: 'recall-abs' }, `${(abs * 100).toFixed(1)} pts`), h('span', { class: 'cap' }, 'how far off, either way')),
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Drift'), h('b', { class: 'num', id: 'recall-drift' }, `${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)} pts`), h('span', { class: 'cap' }, 'toward what happened'))),
      chain ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, 'What happens next'), h('p', null, 'The drill is done. The first re-test counts the checks you make from your normal practice and journal reveals, a few days from now.')) : null,
      h('div', { class: 'foot' }, h('a', { class: 'btn', href: chain ? '#/path' : '#/today' }, chain ? 'Back to Path' : 'Back to Today'), chain ? null : h('a', { class: 'ghost', href: '#/recall/practice' }, 'Another round'))));
  }

  function ask(plan) {
    const done = progressNow();
    if (done >= need) { finish(); return; }
    const calls = new Map(events().filter((e) => e.type === 'call').map((e) => [e.id, e]));
    const asked = new Set(events().filter((e) => e.type === 'memory' && e.src === 'call').map((e) => e.ref));
    const id = plan.find((x) => !asked.has(x) && calls.has(x));
    if (!id) {
      if (done === 0) { mount(focusFrame({ title: 'Recall', closeLabel: 'Back to Today' }, h('section', { class: 'card stack', id: 'recall-empty' }, h('span', { class: 'eyebrow' }, 'Nothing to recall yet'), h('p', null, `Recall checks use gym calls that are at least ${cfg.memory.min_age_days} days old and not asked before. Play more of the gym and come back.`)), h('div', { class: 'foot' }, h('a', { class: 'btn', href: '#/today' }, 'Back to Today')))); return; }
      finish(); return;
    }
    const c = calls.get(id);
    const f = recallField(ctx, cfg.memory.call_recall_min, cfg.memory.recall_max, 'How sure you were', async (value) => {
      await store.append(R.makeEvent('memory', { src: 'call', ref: c.id, recalled: value, recorded: c.c, mode, session, ...(chain ? { flag: chain.id } : {}) }));
      if (!ctx.alive(token)) return;
      reveal(plan, c, value);
    });
    mount(focusFrame({ title: chain ? 'Drill' : 'Recall', count: `${done + 1} of ${need}`, progress: Array.from({ length: need }, (_, i) => i < done), closeLabel: 'Close. Your answers so far are saved.' },
      h('section', null, h('div', { class: 'tags' }, h('span', { class: 'tag' }, 'Memory check'), h('span', { class: 'tag' }, `${R.daysBetween(c.d, today)} days ago`)), h('p', { class: 'claim long', id: 'claim' }, c.claim)),
      h('section', { class: 'card stack', id: 'recall-asked' }, h('p', null, `You answered ${c.side === 'yes' ? 'Yes' : 'No'} to this. How sure were you, from 50 to 99? The record stays hidden until you answer.`)),
      f.node));
    f.input.focus();
  }

  function reveal(plan, c, value) {
    const done = progressNow();
    const shift = KN.shiftToward(value, c.c, !!c.hit);
    const nextBtn = h('button', { class: 'btn', type: 'button', id: 'next' }, done >= need ? 'Finish' : 'Next check');
    const armedAt = Date.now() + (cfg.gym.tap_guard_ms ?? 400);
    nextBtn.addEventListener('click', () => { if (Date.now() < armedAt) return; nextBtn.disabled = true; ask(plan); });
    mount(focusFrame({ title: chain ? 'Drill' : 'Recall', count: `${done} of ${need}`, progress: Array.from({ length: need }, (_, i) => i < done), closeLabel: 'Close. Your answers so far are saved.' },
      h('section', { class: 'card stack' },
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, 'Memory check')),
        h('p', { class: 'claim long' }, c.claim),
        h('div', { class: 'rl-key' }, h('span', null, h('b', null, 'You said'), ` ${pct(c.c)} on ${c.side === 'yes' ? 'Yes' : 'No'}`), h('span', null, h('b', null, 'You remembered'), ` ${pct(value)}`), h('span', null, h('b', null, 'It was'), ` ${c.hit ? 'a hit' : 'a miss'}`)),
        h('p', { class: 'note', id: 'recall-note' }, driftLine(value, c.c), Math.abs(shift) < 0.005 ? '' : ` That is ${shift > 0 ? 'toward' : 'away from'} what happened.`)),
      h('div', { class: 'foot' }, nextBtn)));
  }

  ask(KN.planMemory({ events: events(), today, cfg, size: Math.max(need, cfg.memory.session_size) * 2, rng }));
  return wrap;
}

// Today: the recall practice, once Unit 8 is open and there is an old call to ask about.
export function recallTodayCard(ctx) {
  const g8 = problemGateState(ctx, 'U8');
  if (!g8.open) return null;
  const n = KN.memoryCandidates(ctx.store.events, R.localDay(), ctx.cfg).length;
  const have = KN.memoryObs(ctx.store.events, R.predictionsOf(ctx.store.events, R.localDay())).length;
  return h('section', { class: 'card stack', id: 'recall-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 8 · Memory check'), h('span', { class: 'cap num' }, `${have} of ${ctx.cfg.gates.memory_min_checks} checks`)),
    h('p', { id: 'recall-line' }, n ? `${Math.min(n, ctx.cfg.memory.session_size)} old calls to recall: say how sure you were, then see what you said.` : 'No old call is ready to ask about yet.'),
    n ? h('a', { class: 'ghost', href: '#/recall/practice', id: 'recall-start' }, 'Start recall') : null);
}

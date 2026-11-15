// Unit 12, Arena (Block 10): a track record on public questions. Add a question you forecast on Good Judgment Open or Metaculus (your number and the crowd's, copied when
// you forecast), come back when it closes, say what happened. Scored with the sharp rule; the measure is a mean edge over the crowd across 50 settled questions.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as AR from '../engine/arena.js';
import { signed } from '../engine/scoring.js';
import { focusFrame, picker } from './common.js';
import { fineGateState } from '../flags.js';
import { dayText } from './world.js';

const OUTCOMES = [['yes', 'It happened'], ['no', 'It did not happen'], ['void', 'Cannot be settled']];
const whole = (p) => `${Math.round(p * 100)}%`;

export const arenaOpen = (ctx) => fineGateState(ctx).passed;
export const arenaList = (ctx) => AR.arenaItems(ctx.store.events, R.localDay());
export const arenaGateOf = (ctx) => AR.arenaGate(ctx.S, arenaList(ctx), ctx.cfg.gates);

export function arenaScreen(ctx) {
  if (!arenaOpen(ctx)) { ctx.replace('#/path'); return document.createTextNode(''); }
  const { store } = ctx;
  const today = R.localDay();
  const items = arenaList(ctx);
  const gate = arenaGateOf(ctx);
  const guardMs = ctx.cfg.gym.tap_guard_ms ?? 400;

  const field = (id, label, attrs = {}) => {
    const el = h('input', { class: 'field', id, autocomplete: 'off', ...attrs });
    return { el, row: h('label', { class: 'rfield', style: 'gap:4px' }, h('span', { class: 'eyebrow' }, label), el) };
  };
  const title = field('arena-title', 'Question title', { type: 'text', maxlength: String(ctx.cfg.arena.title_max) });
  const url = field('arena-url', 'Link to the question', { type: 'url', inputmode: 'url', placeholder: 'https://www.gjopen.com/questions/...' });
  const mine = field('arena-mine', 'Your forecast (% yes)', { type: 'text', inputmode: 'numeric' });
  const crowd = field('arena-crowd', 'The crowd\'s forecast (% yes)', { type: 'text', inputmode: 'numeric' });
  const closes = field('arena-closes', 'Closes on', { type: 'date', min: today });
  const msg = h('p', { class: 'msg', id: 'arena-msg', role: 'status' });
  const add = h('button', { class: 'btn', type: 'button', id: 'arena-add', disabled: true }, 'Add to my record');
  const read = () => AR.checkArena({ title: title.el.value, url: url.el.value, mine: mine.el.value, crowd: crowd.el.value, closes: closes.el.value }, today, ctx.cfg);
  const check = () => {
    const filled = [title, url, mine, crowd, closes].every((f) => f.el.value.trim());
    const r = filled ? read() : { ok: false, error: '' };
    add.disabled = !r.ok;
    msg.textContent = r.ok ? `On ${r.entry.platform}.` : r.error;
    msg.className = r.ok || !r.error ? 'msg' : 'msg err';
  };
  [title, url, mine, crowd, closes].forEach((f) => f.el.addEventListener('input', check));
  const armedAt = Date.now() + guardMs;
  add.addEventListener('click', async () => {
    if (Date.now() < armedAt) return;
    const r = read();
    if (!r.ok) return;
    add.disabled = true;
    await store.append(R.makeEvent('arena', { state: 'add', ...r.entry }));
    ctx.requestPersist();
    ctx.refresh();
  });

  const itemRow = (i) => {
    const sc = AR.arenaScores(ctx.S, i);
    const line = i.status === 'resolved'
      ? (i.resolve.outcome === 'void' ? 'Could not be settled: no points.' : `${i.resolve.outcome === 'yes' ? 'It happened' : 'It did not happen'} · you ${whole(i.mine)} (${signed(sc.mine)}) · crowd ${whole(i.crowd)} (${signed(sc.crowd)}) · edge ${signed(sc.edge)}`)
      : `You ${whole(i.mine)} · crowd ${whole(i.crowd)} · closes ${dayText(i.closes)}`;
    let picked = null;
    const save = i.status === 'due' ? h('button', { class: 'btn', type: 'button', disabled: true, 'data-save': i.item }, 'Save what happened') : null;
    if (save) {
      const at = Date.now() + guardMs;
      save.addEventListener('click', async () => {
        if (Date.now() < at || !picked) return;
        save.disabled = true;
        await store.append(R.makeEvent('arena', { state: 'resolve', item: i.item, outcome: picked }));
        ctx.refresh();
      });
    }
    return h('div', { class: 'stack', style: 'gap:6px', 'data-item': i.item },
      h('p', null, h('a', { class: 'link', href: i.url, target: '_blank', rel: 'noopener noreferrer' }, `${i.title} ↗`)),
      h('span', { class: 'cap' }, `${i.platform} · ${line}`),
      save ? picker(OUTCOMES, null, (v) => { picked = v; save.disabled = false; }, { class: 'picker', 'data-pick': i.item }) : null, save);
  };
  const group = (status, title_) => {
    const rows = items.filter((i) => i.status === status);
    return rows.length ? h('section', { class: 'card stack', id: `arena-${status}` }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, title_), h('span', { class: 'cap num' }, String(rows.length))), ...rows.map(itemRow)) : null;
  };
  return focusFrame({ title: 'Arena', closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('p', { class: 'lede', id: 'arena-lede' }, 'A public track record. Forecast on Good Judgment Open or Metaculus, copy your number and the crowd\'s here when you do, and say what happened when the question closes. The numbers are your own copy, so the record says self-reported.')),
    gateCard(gate),
    group('due', 'Say what happened'), group('open', 'Open'), group('resolved', 'Settled'),
    h('section', { class: 'card stack', id: 'arena-form' }, h('span', { class: 'eyebrow' }, 'Add a question'),
      title.row, url.row, mine.row, crowd.row, closes.row, msg, h('div', { class: 'foot' }, add, h('span', { class: 'cap' }, 'Only questions that are still open, with the numbers you saw when you forecast.'))));
}

function gateCard(g) {
  return h('section', { class: 'card stack', id: 'arena-gate' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The measure'), h('span', { class: 'cap num', id: 'arena-count' }, `${g.n} of ${g.needed} settled`)),
    h('p', null, `Over ${g.needed} settled public questions, your points should beat the crowd's: a mean edge above zero.`),
    g.n ? h('p', { class: 'cap', id: 'arena-means' }, `So far, a question: you ${signed(Math.round(g.mine))}, the crowd ${signed(Math.round(g.crowd))}, edge ${signed(Math.round(g.edge))} · ahead on ${g.ahead} of ${g.n}.`) : null,
    g.ready ? h('p', { class: g.passed ? 'msg' : 'msg err', id: 'arena-verdict' }, g.passed ? 'Met: you beat the crowd on average.' : 'Not met yet: the crowd is ahead or level.') : h('p', { class: 'cap' }, 'This needs real months of public questions closing.'));
}

export function arenaTodayCard(ctx) {
  if (!arenaOpen(ctx)) return null;
  const due = arenaList(ctx).filter((i) => i.status === 'due');
  if (!due.length) return null;
  return h('section', { class: 'card stack', id: 'u12-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 12 · Arena'), h('span', { class: 'cap num', id: 'u12-count' }, `${due.length} closed`)),
    h('p', null, `${due.length} public ${due.length === 1 ? 'question has' : 'questions have'} closed. Say what happened to add ${due.length === 1 ? 'it' : 'them'} to your record.`),
    h('a', { class: 'ghost', href: '#/arena', id: 'u12-start' }, 'Open the Arena'));
}

export function arenaPathCard(ctx) {
  if (!arenaOpen(ctx)) return h('section', { class: 'card stack', id: 'pgate-U12-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 12 · Arena'), h('span', { class: 'chip', id: 'pgate-U12-status' }, 'Not open yet')),
    h('p', null, 'It opens after the Unit 10 exam is passed.'));
  const g = arenaGateOf(ctx);
  return h('section', { class: 'card stack', id: 'pgate-U12-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 12 · Arena'), h('span', { class: `chip${g.passed ? ' on' : ''}`, id: 'pgate-U12-status' }, g.passed ? 'Met' : g.ready ? 'Not met' : 'Collecting')),
    h('p', null, `${g.n} of ${g.needed} public questions settled. It takes months of real questions, not a sitting.`),
    h('a', { class: 'ghost', href: '#/arena', id: 'u12-open' }, 'Open the Arena'));
}

export function arenaMirrorRows(ctx) {
  if (!arenaOpen(ctx)) return null;
  const g = arenaGateOf(ctx);
  return g.n ? g : null;
}

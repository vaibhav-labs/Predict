// The Journal: one real, scored prediction a day, written as a six-link chain and locked before the
// outcome is known; a due list; resolve; an outcome card with the baseline and the table of other numbers.
import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import * as J from '../engine/journal.js';
import { signed, pct } from '../engine/scoring.js';
import { tabFrame, focusFrame } from './common.js';

const DOMAINS = [['work', 'Work'], ['life', 'Life'], ['world', 'World']];
const DUE_OPTIONS = [['tomorrow', 'Tomorrow'], ['week', 'This week'], ['month', 'This month'], ['longer', 'Longer']];
const OUTCOME_LABEL = { yes: 'Happened', no: "Didn't happen", void: 'Void' };

export function journalScreen(ctx, arg) {
  if (arg === 'write') return composeScreen(ctx);
  if (arg) return detailScreen(ctx, arg);
  return listScreen(ctx);
}

// ---- helpers shared by the list and the detail view ------------------------------------------------------

function domainLabel(id) { return (DOMAINS.find((d) => d[0] === id) || [id, id])[1]; }
function dueLabel(due, today) {
  const n = R.daysBetween(today, due);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n < 0) return `Was due ${-n} ${-n === 1 ? 'day' : 'days'} ago`;
  return `Due in ${n} days`;
}

function predictionRow(ctx, p, today) {
  return h('a', { class: 'lesson-link', href: `#/journal/${p.id}` },
    h('span', { class: `tick${p.state === 'resolved' ? ' on' : ''}`, 'aria-hidden': 'true' }, p.state === 'resolved' ? icon('check', 14, 2.4) : null),
    h('span', { class: 't' }, h('b', null, p.text), h('em', null, `${domainLabel(p.domain)} · ${p.state === 'resolved' ? OUTCOME_LABEL[p.outcome] : dueLabel(p.due, today)}`)),
    h('span', { class: 'cap' }, p.state === 'resolved' ? (p.scored && p.edge !== null ? signed(p.edge) : '') : p.state === 'due' ? 'Resolve' : 'Open'));
}

// ---- the Journal tab: due list, open list, recently resolved ----------------------------------------------

function listScreen(ctx) {
  const today = R.localDay();
  const predictions = R.predictionsOf(ctx.store.events, today);
  const due = R.dueList(predictions);
  const open = R.openList(predictions);
  const resolved = R.resolvedList(predictions).slice(-10).reverse();
  const writtenToday = predictions.filter((p) => p.d === today);

  const cta = writtenToday.length
    ? h('section', { class: 'card stack' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Today, written'), h('span', { class: 'cap' }, `${writtenToday.length} today`)),
      h('div', { id: 'today-written' }, writtenToday.map((p) => predictionRow(ctx, p, today))),
      h('a', { class: 'ghost', href: '#/journal/write', id: 'write' }, 'Write another (logged, unscored)'))
    : h('section', { class: 'card stack' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, "Today's prediction"), h('span', { class: 'cap' }, `${ctx.journalMinutes} min`)),
      h('p', { class: 'lede' }, 'One real prediction about your work, your life or the world, written as a six-link chain.'),
      h('a', { class: 'btn', href: '#/journal/write', id: 'write' }, 'Write today’s prediction'));

  return tabFrame('journal', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Journal'), h('span', { class: 'date' }, due.length ? `${due.length} due` : 'Nothing due')),
    cta,
    section('Due', due, due.length ? due.map((p) => predictionRow(ctx, p, today)) : h('p', { class: 'cap' }, 'Nothing due yet.'), 'due-list'),
    section('Open', open, open.length ? open.map((p) => predictionRow(ctx, p, today)) : h('p', { class: 'cap' }, 'Nothing open.'), 'open-list'),
    resolved.length ? section('Recently resolved', resolved, resolved.map((p) => predictionRow(ctx, p, today)), 'resolved-list') : null);
}

function section(title, list, body, id) {
  return h('section', { class: 'card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, title), h('span', { class: 'cap' }, String(list.length))),
    h('div', { id }, body));
}

// ---- Ask Predict: a copied message, never a link, never a network call -----------------------------------

async function copyToPredict(ctx, text, fallback) {
  try {
    await navigator.clipboard.writeText(text);
    ctx.toast('Copied. Paste it into your chat with Predict.');
  } catch {
    fallback.hidden = false;
    fallback.value = text;
    fallback.focus();
    fallback.select();
    ctx.toast('Could not copy automatically. The message is below: select and copy it yourself.');
  }
}

// ---- writing a prediction: check, chain, probability and lock ---------------------------------------------

function composeScreen(ctx) {
  const jcfg = ctx.cfg.journal;
  const startedAt = Date.now();
  let step = 0;
  const draft = { domain: null, due: null, text: '', outsideView: { text: '', rate: 50 }, evidence: [], caseAgainst: { text: '', number: 0 }, tripwire: { text: '', number: 0 }, c: 0.5 };

  const title = h('span', { class: 'tt' }, 'Write a prediction');
  const count = h('span', { class: 'cnt num' });
  const progress = h('div', { class: 'prog', 'aria-hidden': 'true' });
  const body = h('main', { class: 'col' });
  const el = h('div', { class: 'app focus' },
    h('header', { class: 'top2' }, h('a', { class: 'x', href: '#/journal', 'aria-label': 'Close' }, icon('close', 22, 1.8)), title, count),
    progress, body);

  function paintHeader() {
    count.textContent = `${step + 1} of 3`;
    progress.replaceChildren(...[0, 1, 2].map((i) => h('i', { class: i <= step ? 'on' : '' })));
  }

  function render() {
    paintHeader();
    body.replaceChildren(step === 0 ? stepClaim() : step === 1 ? stepChain() : stepLock());
    window.scrollTo(0, 0);
  }

  // -- step 1: the claim, its domain and due date, the checker ----------------------------------------------
  function stepClaim() {
    const claimField = h('textarea', { class: 'field', id: 'claim-text', rows: 3, placeholder: 'By [date], [measurable thing] will [happen].' }, draft.text);
    const flagsBox = h('div', { class: 'stack', id: 'flags' });
    const fallback = h('textarea', { class: 'field', hidden: true, readonly: true, rows: 4, 'aria-label': 'Message for Predict' });
    const askBtn = h('button', { class: 'ghost', type: 'button', id: 'ask-predict' }, 'Ask Predict for sharper wording');

    function runChecker() {
      const flags = J.checkClaim(claimField.value, ctx.checkerRules);
      flagsBox.replaceChildren(...flags.map((f) => h('p', { class: 'msg err' }, f.message)));
      return flags;
    }
    claimField.addEventListener('input', runChecker);
    askBtn.addEventListener('click', () => {
      const flags = runChecker();
      const msg = `Predict, can you help me sharpen this prediction so a stranger could score it?\nClaim: "${claimField.value}"\n${flags.length ? `What the checker caught: ${flags.map((f) => f.message).join('; ')}\n` : ''}Please propose a sharper version with a clear date and a measurable outcome.`;
      copyToPredict(ctx, msg, fallback);
    });

    const domainPicker = picker(DOMAINS, draft.domain, (v) => { draft.domain = v; });
    const duePicker = picker(DUE_OPTIONS, draft.due, (v) => { draft.due = v; });

    const nextBtn = h('button', { class: 'btn', type: 'button' }, 'Next: the chain');
    const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
    nextBtn.addEventListener('click', () => {
      if (Date.now() < armedAt) return;
      draft.text = claimField.value.trim();
      if (!draft.text || !draft.domain || !draft.due) { ctx.toast('Write the claim, and pick a domain and a due date.'); return; }
      step = 1; render();
    });
    runChecker();

    return h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'The claim'),
      claimField, flagsBox, askBtn, fallback,
      h('div', { class: 'eyebrow' }, 'Domain'), domainPicker,
      h('div', { class: 'eyebrow' }, 'Due'), duePicker,
      h('div', { class: 'foot' }, nextBtn));
  }

  // -- step 2: the six-link chain (claim and domain/due are links 1-3 already set) --------------------------
  function stepChain() {
    const outsideText = field('Your reference class and rate', draft.outsideView.text);
    const outsideRate = numberField('Rate (%)', draft.outsideView.rate, 0, 100);
    const evidenceRows = h('div', { class: 'stack', id: 'evidence-rows' });
    const addEvidence = h('button', { class: 'ghost', type: 'button', id: 'add-evidence' }, 'Add a signal');

    function paintEvidence() {
      evidenceRows.replaceChildren(...draft.evidence.map((ev, i) => evidenceRow(ev, i)));
      addEvidence.hidden = draft.evidence.length >= jcfg.evidence_max;
    }
    function evidenceRow(ev, i) {
      const text = field(`Signal ${i + 1}`, ev.text, (v) => { ev.text = v; });
      const dir = picker([['up', 'Supports'], ['down', 'Against']], ev.dir, (v) => { ev.dir = v; });
      const test = h('div', { class: 'stack', style: 'gap:6px' },
        h('span', { class: 'cap' }, 'Would this also have been true in the cases that missed?'),
        picker([['no', 'No'], ['yes', 'Yes']], ev.test ? 'yes' : 'no', (v) => { ev.test = v === 'yes'; }));
      const rm = h('button', { class: 'ghost', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => { draft.evidence.splice(i, 1); paintEvidence(); });
      return h('div', { class: 'card soft stack' }, text, dir, test, rm);
    }
    addEvidence.addEventListener('click', () => { draft.evidence.push({ text: '', dir: 'up', test: false }); paintEvidence(); });
    paintEvidence();

    const caseText = field('The strongest reason you are wrong', draft.caseAgainst.text);
    const caseNumber = numberField('A number for it', draft.caseAgainst.number, 0, 100);
    const tripText = field('What would change your mind', draft.tripwire.text);
    const tripNumber = numberField('To what number', draft.tripwire.number, 0, 100);

    const backBtn = h('button', { class: 'ghost', type: 'button' }, 'Back');
    backBtn.addEventListener('click', () => { step = 0; render(); });
    const nextBtn = h('button', { class: 'btn', type: 'button' }, 'Next: your number');
    const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
    nextBtn.addEventListener('click', () => {
      if (Date.now() < armedAt) return;
      draft.outsideView = { text: outsideText.input.value.trim(), rate: Number(outsideRate.input.value) / 100 };
      draft.caseAgainst = { text: caseText.input.value.trim(), number: Number(caseNumber.input.value) };
      draft.tripwire = { text: tripText.input.value.trim(), number: Number(tripNumber.input.value) };
      if (!draft.outsideView.text || !draft.caseAgainst.text || !draft.tripwire.text) { ctx.toast('Write all three: outside view, case against and tripwire.'); return; }
      step = 2; render();
    });

    return h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'Outside view'), outsideText.el, outsideRate.el,
      h('div', { class: 'eyebrow' }, 'Evidence (up to three)'), evidenceRows, addEvidence,
      h('div', { class: 'eyebrow' }, 'Case against'), caseText.el, caseNumber.el,
      h('div', { class: 'eyebrow' }, 'Tripwire'), tripText.el, tripNumber.el,
      h('div', { class: 'foot' }, nextBtn, backBtn));
  }

  // -- step 3: the probability and the lock ------------------------------------------------------------------
  function stepLock() {
    const readout = h('div', { class: 'big', 'aria-hidden': 'true' }, pct(draft.c));
    const input = h('input', {
      class: 'range', type: 'range', id: 'prob', min: Math.round(jcfg.probability_min * 100), max: Math.round(jcfg.probability_max * 100),
      step: Math.round(jcfg.probability_step * 100), value: Math.round(draft.c * 100), 'aria-label': 'Your probability the claim will happen',
    });
    input.addEventListener('input', () => { draft.c = Number(input.value) / 100; readout.textContent = pct(draft.c); });

    const backBtn = h('button', { class: 'ghost', type: 'button' }, 'Back');
    backBtn.addEventListener('click', () => { step = 1; render(); });
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock' }, 'Lock in');
    const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < armedAt) return;
      lockBtn.disabled = true;
      await lockPrediction(ctx, draft, Date.now() - startedAt);
    });

    return h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'How sure are you the claim will happen?'), readout, input,
      h('p', { class: 'cap' }, 'A lock is final: this card cannot be edited afterwards.'),
      h('div', { class: 'foot' }, lockBtn, backBtn));
  }

  render();
  return el;
}

function field(label, value, onInput) {
  const input = h('input', { class: 'field', type: 'text', value });
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  return { el: h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'cap' }, label), input), input };
}
function numberField(label, value, min, max) {
  const input = h('input', { class: 'field', type: 'number', inputmode: 'numeric', min, max, value: String(value) });
  return { el: h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'cap' }, label), input), input };
}
function picker(options, selected, onPick) {
  let value = selected;
  const btns = options.map(([id, label]) => {
    const b = h('button', { class: `pick${id === value ? ' on' : ''}`, type: 'button', 'aria-pressed': id === value ? 'true' : 'false' }, label);
    b.addEventListener('click', () => {
      value = id;
      btns.forEach((x, i) => { const on = options[i][0] === value; x.className = `pick${on ? ' on' : ''}`; x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      onPick(value);
    });
    return b;
  });
  return h('div', { class: 'picker' }, btns);
}

async function lockPrediction(ctx, draft, ms) {
  const { cfg, store } = ctx;
  const jcfg = cfg.journal;
  const today = R.localDay();
  const predictions = R.predictionsOf(store.events, today);
  const horizon = J.horizonFor(draft.due, jcfg);
  const due = J.dueDateFor(draft.due, today, jcfg);
  const own = R.ownBaseRate(predictions, draft.domain, horizon);
  const { b, source } = J.baselineFor({ domain: draft.domain, horizon, own, starterTable: ctx.journalBaselines, cfg: jcfg });
  const scored = !R.scoredToday(predictions, today);
  const ev = R.makeEvent('prediction', {
    text: draft.text, domain: draft.domain, dueOption: draft.due, due, horizon,
    chain: { outsideView: draft.outsideView, evidence: draft.evidence, caseAgainst: draft.caseAgainst, tripwire: draft.tripwire },
    c: draft.c, b, bSource: source, scored, ms,
  });
  await store.append(ev);
  ctx.nav(`#/journal/${ev.id}`);
}

// ---- the detail view: open, due (resolve), or resolved (the outcome card) ---------------------------------

// A plain wrapper, repainted in place: resolving a due card changes nothing about the URL (it is
// already #/journal/<id>), so the view cannot rely on a hashchange to show the result.
function detailScreen(ctx, id) {
  const wrap = h('div', null);
  function paint() {
    const today = R.localDay();
    const predictions = R.predictionsOf(ctx.store.events, today);
    const p = predictions.find((x) => x.id === id);
    if (!p) { ctx.nav('#/journal'); return; }
    wrap.replaceChildren(detailBody(ctx, p, today, paint));
    window.scrollTo(0, 0);
  }
  paint();
  return wrap;
}

function detailBody(ctx, p, today, paint) {
  const chainCard = h('section', { class: 'card stack' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your chain')),
    chainLine('Outside view', `${p.chain.outsideView.text} (${Math.round(p.chain.outsideView.rate * 100)}%)`),
    ...p.chain.evidence.map((ev, i) => chainLine(`Signal ${i + 1} (${ev.dir === 'up' ? 'supports' : 'against'})`, ev.text)),
    chainLine('Case against', `${p.chain.caseAgainst.text} (${p.chain.caseAgainst.number})`),
    chainLine('Tripwire', `${p.chain.tripwire.text} (to ${p.chain.tripwire.number})`));

  const header = h('section', null,
    h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(p.domain)), h('span', { class: 'tag' }, p.scored ? 'Scored' : 'Logged, unscored')),
    h('p', { class: 'claim' }, p.text),
    h('p', { class: 'cap' }, `Due ${p.due}${p.state !== 'resolved' ? ` · ${dueLabel(p.due, today)}` : ''} · You said ${pct(p.c)}`));

  const baselineLine = h('p', { class: 'cap' }, `Baseline: ${pct(p.b)}, ${baselineCaption(p)}.`);

  if (p.state === 'open') {
    return focusFrame({ title: 'Prediction', closeTo: '#/journal' },
      header, baselineLine, chainCard);
  }
  if (p.state === 'due') {
    return focusFrame({ title: 'Resolve', closeTo: '#/journal' },
      header, baselineLine, chainCard, resolveCard(ctx, p, paint));
  }
  return outcomeCard(ctx, p, header, chainCard);
}

function chainLine(label, text) {
  return h('div', null, h('div', { class: 'eyebrow' }, label), h('p', null, text));
}

function baselineCaption(p) {
  return p.bSource === 'own' ? `your own rate for ${domainLabel(p.domain)} · ${p.horizon}` : 'a starter guess, no history yet';
}

function resolveCard(ctx, p, paint) {
  let outcome = null;
  const note = h('textarea', { class: 'field', rows: 2, placeholder: 'A one-line note on what happened (optional).' });
  const picked = picker([['yes', 'Happened'], ['no', "Didn't happen"], ['void', 'Void']], null, (v) => { outcome = v; });
  const goBtn = h('button', { class: 'btn', type: 'button', id: 'resolve' }, 'Resolve');
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  goBtn.addEventListener('click', async () => {
    if (Date.now() < armedAt) return;
    if (!outcome) { ctx.toast('Pick what happened.'); return; }
    goBtn.disabled = true;
    const outcomeYes = outcome === 'yes';
    const scoring = outcome === 'void' ? { raw: null, edge: null } : J.journalScore(ctx.S, p.c, p.b, outcomeYes, ctx.cfg.journal.edge_weight);
    await ctx.store.append(R.makeEvent('resolve', { prediction: p.id, outcome, note: note.value.trim() || undefined, raw: scoring.raw, edge: p.scored ? scoring.edge : null }));
    paint();
  });
  return h('section', { class: 'card stack' },
    h('div', { class: 'eyebrow' }, 'What happened?'), picked, note,
    h('div', { class: 'foot' }, goBtn));
}

function outcomeCard(ctx, p, header, chainCard) {
  const outcomeYes = p.outcome === 'yes';
  const table = p.outcome === 'void' ? [] : J.otherNumbers(ctx.S, p.b, outcomeYes, ctx.cfg.journal.edge_weight);
  return focusFrame({ title: 'Outcome', closeTo: '#/journal' },
    header,
    h('section', { class: 'card stack' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Outcome'), h('span', { class: 'cap' }, OUTCOME_LABEL[p.outcome])),
      p.note ? h('p', null, p.note) : null,
      p.outcome === 'void'
        ? h('p', { class: 'lede' }, 'Void: this one scores nothing.')
        : h('div', { class: 'sumgrid' },
          h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Baseline'), h('b', { class: 'num' }, pct(p.b)), h('span', { class: 'cap' }, baselineCaption(p))),
          h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Your edge'), h('b', { class: `num${!p.scored || p.edge < 0 ? ' bad' : ''}` }, p.scored ? signed(p.edge) : 'Unscored'), h('span', { class: 'cap' }, p.scored ? `raw ${signed(p.raw)}` : 'extra prediction')))),
    table.length ? h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'If you had said…')),
      h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'You said'), h('th', null, 'Edge'))),
        h('tbody', null, table.map((row) => h('tr', { class: row.c === p.c ? 'mine' : '' }, h('td', null, pct(row.c)), h('td', { class: row.edge < 0 ? 'bad' : '' }, signed(row.edge))))))) : null,
    chainCard);
}

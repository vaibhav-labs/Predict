// The Journal: one real, scored prediction a day, written as a six-link chain and locked before the
// outcome is known; a due list; resolve; an outcome card with the baseline and the table of other numbers.
import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import * as J from '../engine/journal.js';
import * as LE from '../engine/lessons.js';
import { signed, pct } from '../engine/scoring.js';
import { tabFrame, focusFrame, picker } from './common.js';
import { caseFile, chainCard, baselineCaption, caseNote } from './casefile.js';
import { pendingAutopsies } from './autopsy.js';
import { lessonState, problemGateState, autopsyDueOf } from '../flags.js';
import { stepsOf, chainProductOf, outsideGrade } from '../engine/reasoning.js';
import { promptsFor } from '../engine/coach.js';
import * as UP from '../engine/update.js';
import * as KN from '../engine/know.js';
import { memoryCard, memoryNote } from './recall.js';

const DOMAINS = [['work', 'Work'], ['life', 'Life'], ['world', 'World']];
const DUE_OPTIONS = [['tomorrow', 'Tomorrow'], ['week', 'This week'], ['month', 'This month'], ['longer', 'Longer']];
const OUTCOME_LABEL = { yes: 'Happened', no: "Didn't happen", void: 'Void' };

export function journalScreen(ctx, arg) {
  // An autopsy that is due comes before the next journal step: writing a prediction, or resolving another due card.
  const pending = pendingAutopsies(ctx);
  if (pending.length && arg) {
    const target = arg === 'write' ? null : R.predictionsOf(ctx.store.events, R.localDay()).find((p) => p.id === arg);
    if (arg === 'write' || (target && target.state === 'due')) { ctx.replace(`#/autopsy/${pending[0].p.id}`); return document.createTextNode(''); }
  }
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

  const pending = pendingAutopsies(ctx);
  const cta = pending.length
    ? h('section', { class: 'card nudge stack', id: 'autopsy-due' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Autopsy first'), h('span', { class: 'cap' }, `${pending.length} due`)),
      h('p', null, pending[0].kind === 'miss' ? 'A card missed at 85% or more. Its autopsy comes before your next journal step.' : 'A confident hit was picked for review. Its autopsy comes before your next journal step.'),
      h('p', { class: 'claim', style: 'font-size:18px' }, pending[0].p.text),
      h('a', { class: 'btn', href: `#/autopsy/${pending[0].p.id}`, id: 'autopsy-start' }, 'Start the autopsy'))
    : writtenToday.length
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
  const draft = { domain: null, due: null, text: '', flaggedEver: false, outsideView: { text: '', rate: 50 }, evidence: [], caseAgainst: { text: '', number: 0 }, tripwire: { text: '', number: 0 }, c: 0.5, first: null, steps: [], own: false };
  // The reasoning tools show up as their units open: a chain multiplier from Unit 4, an own-task tag and the outside-view grade from Unit 5.
  const chainOpen = problemGateState(ctx, 'U4').open;
  const gradeOpen = problemGateState(ctx, 'U5').open;
  // From Unit 7 a card is written in two numbers: a gut number first, and the final one after the chain.
  const secondOpen = problemGateState(ctx, 'U7').open;

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

  // The rules the player wrote at their autopsies sit above each of their next few cards.
  const rules = lessonState(ctx).rules;
  const ruleBox = rules.length ? h('section', { class: 'card stack', id: 'rule-card' },
    h('span', { class: 'eyebrow' }, rules.length > 1 ? 'Your rules' : 'Your rule'),
    ...rules.map((r) => h('p', { class: 'rule' }, h('b', null, r.rule), h('span', { class: 'cap' }, ` · from ${r.autopsy.d}, ${ruleCardsLeft(ctx, r)} cards left`)))) : null;

  function render() {
    paintHeader();
    body.replaceChildren(...(ruleBox ? [ruleBox] : []), step === 0 ? stepClaim() : step === 1 ? stepChain() : stepLock());
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
      if (flags.length && claimField.value.trim()) draft.flaggedEver = true; // an empty box always lacks a date: that is not the player's wording being flagged
      flagsBox.replaceChildren(...flags.map((f) => h('p', { class: 'msg err' }, f.message)));
      return flags;
    }
    claimField.addEventListener('input', runChecker);
    // Up to three ideas from Predict's weekly review for today. Tapping one starts the claim; it is still the player's to rewrite.
    const ideas = promptsFor(ctx.coach, R.localDay());
    const ideasBox = ideas.length ? h('div', { class: 'stack', id: 'prompt-ideas' },
      h('span', { class: 'cap' }, 'Three ideas from Predict for today'),
      ...ideas.map((it, i) => {
        const b = h('button', { class: 'ghost prompt-chip', type: 'button', 'data-i': String(i) }, it.text);
        b.addEventListener('click', () => {
          const was = draft.flaggedEver; // a wording Predict suggested is not the player's own wording being caught
          draft.text = it.text; if (it.domain) draft.domain = it.domain; if (it.due) draft.due = it.due;
          render();
          draft.flaggedEver = was;
        });
        return b;
      })) : null;
    askBtn.addEventListener('click', () => {
      const flags = runChecker();
      const msg = `Predict, can you help me sharpen this prediction so a stranger could score it?\nClaim: "${claimField.value}"\n${flags.length ? `What the checker caught: ${flags.map((f) => f.message).join('; ')}\n` : ''}Please propose a sharper version with a clear date and a measurable outcome.`;
      copyToPredict(ctx, msg, fallback);
    });

    const domainPicker = picker(DOMAINS, draft.domain, (v) => { draft.domain = v; });
    const duePicker = picker(DUE_OPTIONS, draft.due, (v) => { draft.due = v; });

    const ownPicker = gradeOpen ? picker([['no', 'No'], ['yes', 'Yes']], draft.own ? 'yes' : 'no', (v) => { draft.own = v === 'yes'; }) : null;
    const firstField = secondOpen ? numberField('Your gut number: the chance it happens, before you think it through (%)', draft.first === null ? '' : Math.round(draft.first * 100), 1, 99) : null;
    if (firstField) firstField.input.id = 'first-number';
    const nextBtn = h('button', { class: 'btn', type: 'button' }, 'Next: the chain');
    const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
    nextBtn.addEventListener('click', () => {
      if (Date.now() < armedAt) return;
      draft.text = claimField.value.trim();
      if (!draft.text || !draft.domain || !draft.due) { ctx.toast('Write the claim, and pick a domain and a due date.'); return; }
      if (firstField) {
        const v = Number(firstField.input.value);
        if (firstField.input.value.trim() === '' || !Number.isInteger(v) || v < 1 || v > 99) { ctx.toast('Give your gut number first: a whole percent from 1 to 99.'); return; }
        draft.first = v / 100;
      }
      step = 1; render();
    });
    runChecker();

    return h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'The claim'),
      ideasBox,
      claimField, flagsBox, askBtn, fallback,
      h('div', { class: 'eyebrow' }, 'Domain'), domainPicker,
      h('div', { class: 'eyebrow' }, 'Due'), duePicker,
      firstField ? h('div', { class: 'stack', id: 'first-box' }, h('div', { class: 'eyebrow' }, 'Your gut number'), h('p', { class: 'cap' }, 'Say it now, before the outside view, the evidence and the case against. It is kept: when the card resolves, the Mirror shows which number was closer.'), firstField.el) : null,
      ownPicker ? h('div', { class: 'stack', id: 'own-task' }, h('div', { class: 'eyebrow' }, 'Your own task?'), h('p', { class: 'cap' }, 'Yes if this is about something you plan to finish or deliver yourself. Plans usually run late; the lessons watch for it.'), ownPicker) : null,
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

    // The chain multiplier (Unit 4): things that must all happen, each with its own probability. They multiply.
    const stepRows = Array.from({ length: 5 }, (_, i) => {
      const st = draft.steps[i] || { text: '', p: '' };
      return { text: field(`Step ${i + 1}`, st.text), pct: numberField('Chance it happens (%)', st.p === '' ? '' : Math.round(st.p * 100), 0, 100) };
    });
    const stepProduct = h('p', { class: 'cap', id: 'chain-product', role: 'status' });
    const readSteps = () => stepRows.map((r) => ({ text: r.text.input.value.trim(), p: r.pct.input.value.trim() === '' ? null : Number(r.pct.input.value) / 100 }))
      .filter((r) => r.text && r.p !== null && Number.isFinite(r.p) && r.p > 0 && r.p <= 1);
    const paintProduct = () => {
      const st = readSteps();
      stepProduct.textContent = st.length >= 2 ? `The steps multiply to ${pct(chainProductOf(st))}. Every one has to happen, so the whole is lower than the weakest step (${pct(Math.min(...st.map((x) => x.p)))}).` : 'Two or more steps make a chain: the app multiplies them for you.';
    };
    stepRows.forEach((r) => [r.text.input, r.pct.input].forEach((el) => el.addEventListener('input', paintProduct)));
    paintProduct();
    const chainBox = chainOpen ? h('div', { class: 'stack', id: 'chain-box' },
      h('div', { class: 'eyebrow' }, 'Chain steps (optional)'),
      h('p', { class: 'cap' }, 'If the claim needs several things to all go right, list them (up to five), each with the chance you give it. Leave blank if it does not.'),
      ...stepRows.map((r) => h('div', { class: 'card soft stack' }, r.text.el, r.pct.el)), stepProduct) : null;

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
      if (chainOpen) {
        const st = readSteps();
        if (st.length === 1) { ctx.toast('A chain needs two steps or more. Add another, or clear this one.'); return; }
        draft.steps = st;
      }
      draft.caseAgainst = { text: caseText.input.value.trim(), number: Number(caseNumber.input.value) };
      draft.tripwire = { text: tripText.input.value.trim(), number: Number(tripNumber.input.value) };
      if (!draft.outsideView.text || !draft.caseAgainst.text || !draft.tripwire.text) { ctx.toast('Write all three: outside view, case against and tripwire.'); return; }
      step = 2; render();
    });

    return h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'Outside view'), outsideText.el, outsideRate.el,
      h('div', { class: 'eyebrow' }, 'Evidence (up to three)'), evidenceRows, addEvidence,
      chainBox,
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
    // What the reasoning tools say about this card before it is locked: the chain's product, and the outside-view grade against the baseline.
    const notes = [];
    const chainSteps = stepsOf(draft);
    const chainNote = chainSteps.length >= 2 ? h('p', { class: 'note', id: 'chain-note' }, '') : null;
    const paintChain = () => { if (chainNote) { const prod = chainProductOf(chainSteps); chainNote.textContent = draft.c > prod + 1e-9 ? `Your steps multiply to ${pct(prod)}, and you are about to say ${pct(draft.c)}. That claims every step is likelier than you said. Lower the number or change a step.` : `Your steps multiply to ${pct(prod)}. Your number is at or under it.`; } };
    if (chainNote) { notes.push(chainNote); paintChain(); input.addEventListener('input', paintChain); }
    if (gradeOpen) {
      const today = R.localDay();
      const predictions = R.predictionsOf(ctx.store.events, today);
      const horizon = J.horizonFor(draft.due, jcfg);
      const { b, source } = J.baselineFor({ domain: draft.domain, horizon, own: R.ownBaseRate(predictions, draft.domain, horizon), starterTable: ctx.journalBaselines, cfg: jcfg });
      const g = outsideGrade({ chain: { outsideView: draft.outsideView }, b, bSource: source }, ctx.cfg);
      if (g) notes.push(h('p', { class: 'note', id: 'outside-grade' }, `Your outside-view rate is ${pct(g.stated)}; the baseline for ${draft.domain}, ${horizon} is ${pct(g.reference)}. ${g.accepted ? 'That is within ' + Math.round(g.within * 100) + ' points: accepted.' : 'That is more than ' + Math.round(g.within * 100) + ' points away. Is there a reason this case is unlike the usual ones?'}`));
    }
    if (draft.first !== null) {
      const firstNote = h('p', { class: 'note', id: 'first-note' }, '');
      const paintFirst = () => { const d = Math.round((draft.c - draft.first) * 100); firstNote.textContent = d === 0 ? `Your gut number was ${pct(draft.first)}, and the chain left it where it was.` : `Your gut number was ${pct(draft.first)}. The chain moved it ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'} ${d > 0 ? 'up' : 'down'}.`; };
      notes.push(firstNote); paintFirst(); input.addEventListener('input', paintFirst);
    }
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock' }, 'Lock in');
    const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < armedAt) return;
      lockBtn.disabled = true;
      await lockPrediction(ctx, draft, Date.now() - startedAt);
    });

    return h('section', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'How sure are you the claim will happen?'), readout, input,
      ...notes,
      h('p', { class: 'cap' }, 'A lock is final: the number you lock stays on the record. While the card is open you can add updates, each with a reason.'),
      h('div', { class: 'foot' }, lockBtn, backBtn));
  }

  render();
  return el;
}

const ruleCardsLeft = (ctx, r) => ctx.cfg.lessons.autopsy.rule_card_cards - r.since;

function field(label, value, onInput) {
  const input = h('input', { class: 'field', type: 'text', value });
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  return { el: h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'cap' }, label), input), input };
}
function numberField(label, value, min, max) {
  const input = h('input', { class: 'field', type: 'number', inputmode: 'numeric', min, max, value: String(value) });
  return { el: h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'cap' }, label), input), input };
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
    // What the checker said when the card was locked, and whether the player ever saw it say something while writing:
    // the case file and the lessons read these, so a rewrite that was never needed is told apart from one that was.
    flags: J.checkClaim(draft.text, ctx.checkerRules).map((f) => f.flag), flagged: draft.flaggedEver,
    // The reasoning tools: a chain's steps (two or more) and the own-task tag. Absent unless used, so older cards read as before.
    ...(Array.isArray(draft.steps) && draft.steps.length >= 2 ? { steps: draft.steps } : {}),
    ...(draft.own ? { own: true } : {}),
    ...(typeof draft.first === 'number' ? { first: draft.first } : {}),
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
    wrap.replaceChildren(detailBody(ctx, p, today, paint, predictions));
    window.scrollTo(0, 0);
  }
  paint();
  return wrap;
}

function detailBody(ctx, p, today, paint, predictions) {
  const header = h('section', null,
    h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(p.domain)), h('span', { class: 'tag' }, p.scored ? 'Scored' : 'Logged, unscored')),
    h('p', { class: 'claim' }, p.text),
    h('p', { class: 'cap' }, `Due ${p.due}${p.state !== 'resolved' ? ` · ${dueLabel(p.due, today)}` : ''} · You said ${pct(p.c)}${p.updates && p.updates.length ? ` · Now ${pct(p.cNow)}` : ''}`));

  const baselineLine = h('p', { class: 'cap' }, `Baseline: ${pct(p.b)}, ${baselineCaption(p)}.`);

  if (p.state === 'open') {
    return focusFrame({ title: 'Prediction', closeTo: '#/journal' },
      header, baselineLine, chainCard(p, { caseNote: caseNote(ctx, p) }), updateHistory(p), problemGateState(ctx, 'U6').open ? updateCard(ctx, p, paint) : null);
  }
  if (p.state === 'due') {
    // From Unit 8 the record stays hidden until the player says what they remember locking.
    if (KN.memoryRequired(p, ctx.store.events, problemGateState(ctx, 'U8').open)) {
      return focusFrame({ title: 'Resolve', closeTo: '#/journal' },
        h('section', null, h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(p.domain)), h('span', { class: 'tag' }, 'Due')), h('p', { class: 'claim', id: 'claim' }, p.text), h('p', { class: 'cap' }, `Due ${p.due}`)),
        memoryCard(ctx, p, () => paint()));
    }
    return focusFrame({ title: 'Resolve', closeTo: '#/journal' },
      header, memoryNote(ctx, p), baselineLine, chainCard(p, { caseNote: caseNote(ctx, p) }), resolveCard(ctx, p, paint));
  }
  return caseFile(ctx, p, header, predictions, paint);
}

function resolveCard(ctx, p, paint) {
  let outcome = null;
  // Predict's check of the world, when the weekly review made one: it comes with its source and is only a suggestion.
  const found = ctx.coach && ctx.coach.outcomes[p.id];
  let usedCheck = false;
  const note = h('textarea', { class: 'field', rows: 2, placeholder: 'A one-line note on what happened (optional).' });
  const picked = picker([['yes', 'Happened'], ['no', "Didn't happen"], ['void', 'Void']], null, (v) => { outcome = v; });
  const checkBox = found ? h('div', { class: 'stack', id: 'predict-check' },
    h('span', { class: 'eyebrow' }, `Predict looked this up on ${found.checked}`),
    h('p', null, `${OUTCOME_LABEL[found.result]}.${found.note ? ' ' + found.note : ''}`),
    h('a', { class: 'srclink', href: found.source, rel: 'noopener noreferrer', target: '_blank', id: 'predict-check-source' }, found.source),
    h('button', { class: 'ghost', type: 'button', id: 'use-check' }, 'Use this answer')) : null;
  if (checkBox) checkBox.querySelector('#use-check').addEventListener('click', () => {
    outcome = found.result; usedCheck = true;
    picked.querySelectorAll('.pick').forEach((b) => { const on = b.dataset.value === outcome; b.className = `pick${on ? ' on' : ''}`; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  });
  const goBtn = h('button', { class: 'btn', type: 'button', id: 'resolve' }, 'Resolve');
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  goBtn.addEventListener('click', async () => {
    if (Date.now() < armedAt) return;
    if (!outcome) { ctx.toast('Pick what happened.'); return; }
    goBtn.disabled = true;
    const outcomeYes = outcome === 'yes';
    // A card that was updated is scored over its life: each day at the number in force that day (engine/update.js). Without updates this is the locked number's score.
    const scoring = outcome === 'void' ? { raw: null, edge: null } : UP.twScore(ctx.S, p, R.localDay(), outcomeYes, ctx.cfg.journal.edge_weight);
    const lifeFields = outcome !== 'void' && p.updates && p.updates.length ? { raw0: scoring.raw0, edge0: p.scored ? scoring.edge0 : null, days: scoring.days } : {};
    // The source link travels with the answer only when the player used Predict's check and agreed with it.
    const cited = usedCheck && found && outcome === found.result;
    await ctx.store.append(R.makeEvent('resolve', { prediction: p.id, outcome, note: note.value.trim() || undefined, raw: scoring.raw, edge: p.scored ? scoring.edge : null, source: cited ? found.source : undefined, checked: cited ? found.checked : undefined, ...lifeFields }));
    // A card that needs an autopsy goes to it at once; the case file waits behind it.
    const now = R.predictionsOf(ctx.store.events, R.localDay());
    const mine = now.find((x) => x.id === p.id);
    if (mine && LE.needsAutopsy(mine, autopsyDueOf(ctx, now, ctx.store.events))) { ctx.replace(`#/autopsy/${p.id}`); return; }
    paint();
  });
  return h('section', { class: 'card stack' },
    h('div', { class: 'eyebrow' }, 'What happened?'), checkBox, picked, note,
    h('div', { class: 'foot' }, goBtn));
}

// ---- updating an open card (Unit 6): a new number and a reason; the locked number stays on the record --------------------------
function updateHistory(p) {
  if (!p.updates || !p.updates.length) return null;
  return h('section', { class: 'card stack', id: 'update-history' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Updates'), h('span', { class: 'cap num' }, `locked ${pct(p.c)} · now ${pct(p.cNow)}`)),
    h('ul', { class: 'rows' }, p.updates.map((u) => h('li', null, h('div', { class: 't' }, h('span', null, u.reason), h('em', null, `${u.d} · ${pct(u.prev)} to ${pct(u.c)}`)), h('span', { class: 'm num' }, `${u.c >= u.prev ? '+' : ''}${Math.round((u.c - u.prev) * 100)}`)))));
}

function updateCard(ctx, p, paint) {
  const jcfg = ctx.cfg.journal;
  const now = typeof p.cNow === 'number' ? p.cNow : p.c;
  let c = now;
  const news = ctx.coach && ctx.coach.news && ctx.coach.news[p.id];
  const readout = h('div', { class: 'big', id: 'update-readout', 'aria-hidden': 'true' }, pct(c));
  const input = h('input', { class: 'range', type: 'range', id: 'update-prob', min: Math.round(jcfg.probability_min * 100), max: Math.round(jcfg.probability_max * 100), step: Math.round(jcfg.probability_step * 100), value: Math.round(c * 100), 'aria-label': 'Your new probability' });
  const msg = h('p', { class: 'msg', id: 'update-msg', role: 'status' });
  const reason = h('textarea', { class: 'field', id: 'update-reason', rows: 2, placeholder: 'What changed your mind? A line is enough.' });
  const move = h('p', { class: 'cap', id: 'update-move' }, 'Move the slider to change the number.');
  const goBtn = h('button', { class: 'btn', type: 'button', id: 'update-go' }, 'Update');
  const paintMove = () => { const d = Math.round((c - now) * 100); move.textContent = d === 0 ? 'Move the slider to change the number.' : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} points from ${pct(now)}.`; };
  input.addEventListener('input', () => { c = Number(input.value) / 100; readout.textContent = pct(c); paintMove(); msg.textContent = ''; msg.className = 'msg'; });
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  goBtn.addEventListener('click', async () => {
    if (Date.now() < armedAt) return;
    const v = UP.checkUpdate(p, c, reason.value, ctx.cfg);
    if (!v.ok) { msg.textContent = v.error; msg.className = 'msg err'; return; }
    goBtn.disabled = true;
    await ctx.store.append(R.makeEvent('update', { prediction: p.id, c, prev: v.prev, reason: reason.value.trim() }));
    ctx.requestPersist();
    ctx.toast('Updated. The locked number stays on the record.');
    paint();
  });
  return h('section', { class: 'card stack', id: 'update-card' },
    h('div', { class: 'eyebrow' }, 'Update this prediction'),
    news ? h('div', { class: 'stack', id: 'update-news' }, h('span', { class: 'eyebrow' }, `Predict found news on ${news.written}`), h('p', null, news.text), h('a', { class: 'srclink', href: news.source, rel: 'noopener noreferrer', target: '_blank' }, news.source)) : null,
    p.chain && p.chain.tripwire ? h('p', { class: 'note', id: 'update-tripwire' }, `You wrote: "${p.chain.tripwire.text}" (to ${p.chain.tripwire.number}). Has that happened?`) : null,
    h('p', { class: 'cap' }, `In force now: ${pct(now)}${p.updates && p.updates.length ? `, locked at ${pct(p.c)}` : ''}.`),
    readout, input, move, reason, msg,
    h('p', { class: 'cap' }, 'Each day the card is open is scored at the number in force that day. One update a day: a second one on the same day replaces the first.'),
    h('div', { class: 'foot' }, goBtn));
}

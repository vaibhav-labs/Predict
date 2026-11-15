// The gym: a session of binary calls. Baseline sessions (Unit 0) give no feedback until the session ends;
// practice sessions (Unit 1) reveal each call at once. A call is saved on the phone the moment it is locked.
import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import { planBaseline, pickNext, seeded, randomSeed } from '../engine/draw.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { focusFrame, unitRow } from './common.js';
import { makeDial } from './dial.js';

export const domainLabel = (d) => (d ? d.charAt(0).toUpperCase() + d.slice(1) : '');

// A judgment question is a scene (the lead: where, when, what has happened so far) and a claim about how it turns out (the ask).
// They read as one sentence, so the text of the claim is the lead, one space, then the ask; the scene is set quieter so the
// claim to judge stands out.
function claimNode(q, attrs) {
  const parts = q.lead && q.ask ? [h('span', { class: 'lead' }, q.lead), ' ', h('span', { class: 'ask' }, q.ask)] : [q.claim];
  return h('p', { class: q.claim.length > 150 ? 'claim long' : 'claim', ...attrs }, ...parts);
}

// The outside view, shown after the call: how often a claim like this one held among the other cases in the records.
// Documented facts from a source (verified 'sourced') carry no count of cases, so they show nothing here.
function baseLine(q) {
  if (q.verified !== 'recorded' || typeof q.base !== 'number') return null;
  const yes = q.base >= 0.5;
  return h('p', { class: 'muted', id: 'base-line' },
    `Claims like this held in ${pct(q.base)} of the ${Number(q.n).toLocaleString('en-US')} other cases. The base rate alone says ${yes ? 'Yes' : 'No'} at ${pct(yes ? q.base : 1 - q.base)}.`);
}

// What the next session would be: the rest of the 60-call baseline first, then Unit 1 practice.
export function nextSessionPlan(ctx) {
  const events = ctx.store.events;
  const U0 = unitRow(ctx, 'U0'), U1 = unitRow(ctx, 'U1');
  const baseTotal = Number(U0.practice_calls);
  const perSession = Number(U0.drills_per_day);
  const base = R.baselineProgress(events, baseTotal);
  if (!base.complete) {
    return { mode: 'baseline', unit: 'U0', size: Math.min(perSession, baseTotal - base.done), number: Math.floor(base.done / perSession) + 1, of: Math.ceil(baseTotal / perSession), label: 'Baseline', done: base.done, total: baseTotal };
  }
  const done = R.callsOf(events).filter((c) => c.mode === 'practice').length;
  return { mode: 'practice', unit: 'U1', size: Number(U1.drills_per_day), label: 'Unit 1 practice', done, total: Number(U1.practice_calls) };
}

const lastUsedMap = (events) => new Map(R.callsOf(events).map((c, i) => [c.q, i]));

export async function gymScreen(ctx, root, token) {
  const { store, cfg, S } = ctx;
  const timeoutMs = cfg.gym.timeout_seconds * 1000;
  // A double tap on a button must not land on the same spot of the next screen: Lock in, Next call and the summary's
  // buttons sit in the same place, so each ignores taps for a moment after its screen appears.
  const guardMs = cfg.gym.tap_guard_ms ?? 400;
  const rng = seeded(randomSeed());
  let timer = null;
  let sessionId = null;
  const stop = () => clearTimeout(timer);
  ctx.onLeave(stop);

  const sessionNow = () => R.sessionsOf(store.events).find((x) => x.id === sessionId);
  const mount = (view) => { root.replaceChildren(view); window.scrollTo(0, 0); };

  async function ensureSession() {
    const open = R.activeSession(store.events);
    if (open) return open;
    const plan = nextSessionPlan(ctx);
    const events = store.events;
    const ev = R.makeEvent('session', {
      mode: plan.mode, unit: plan.unit, size: plan.size, n: plan.number || null,
      plan: plan.mode === 'baseline'
        ? planBaseline({ bank: ctx.bank, usedIds: R.usedQuestionIds(events), disputedIds: R.disputedIds(events), lastUsed: lastUsedMap(events), size: plan.size, spares: cfg.gym.baseline_spares, mix: cfg.gym.difficulty_mix, rng })
        : undefined,
    });
    await store.append(ev);
    return R.sessionsOf(store.events).find((x) => x.id === ev.id);
  }

  async function skip(sess, qid, reason) {
    await store.append(R.makeEvent('skip', { session: sess.id, q: qid, reason }));
    await store.setMeta('active', undefined);
  }

  // The question on screen: the one already shown (so closing and reopening the app never changes it), else the next one.
  async function currentQuestion(sess) {
    const answered = new Set(sess.calls.map((c) => c.q));
    const skipped = new Set(sess.skipped);
    const active = await store.getMeta('active');
    if (active && active.session === sess.id && !answered.has(active.q) && !skipped.has(active.q) && ctx.bankById.has(active.q)) {
      if (Date.now() - active.shownAt > timeoutMs) {
        await skip(sess, active.q, 'timeout');
        return currentQuestion(sessionNow());
      }
      return { q: ctx.bankById.get(active.q), shownAt: active.shownAt };
    }
    let id = null;
    if (sess.mode === 'baseline') {
      id = sess.plan.find((x) => !answered.has(x) && !skipped.has(x)) || null;
    }
    if (!id) {
      const events = store.events;
      const recent = R.callsOf(events).map((c) => c.hit);
      const q = pickNext({ bank: ctx.bank, usedIds: R.usedQuestionIds(events), disputedIds: R.disputedIds(events), skippedIds: skipped, lastUsed: lastUsedMap(events), recent, shownTruths: sess.calls.map((c) => c.truth), cfg: cfg.gym, rng });
      id = q && q.id;
    }
    if (!id) throw new Error('The question bank is empty.');
    const rec = { session: sess.id, q: id, shownAt: Date.now() };
    await store.setMeta('active', rec);
    return { q: ctx.bankById.get(id), shownAt: rec.shownAt };
  }

  async function step() {
    const sess = sessionNow();
    if (sess.ended || sess.calls.length >= sess.size) { await finish(sess); return; }
    const cur = await currentQuestion(sess);
    if (!ctx.alive(token)) return;
    renderQuestion(sessionNow(), cur);
  }

  async function finish(sess) {
    if (!sess.ended) await store.append(R.makeEvent('session_end', { session: sess.id }));
    await store.setMeta('active', undefined);
    // Replace the session screen in the history: Back from the summary must not start the next session.
    if (ctx.alive(token)) ctx.replace(`#/summary/${sess.id}`);
  }

  // `done` is how many segments of the progress strip are filled: calls before this one, or including it once revealed.
  function header(sess, index, done = index - 1) {
    return {
      title: sess.mode === 'baseline' ? 'Baseline' : 'Gym',
      count: `${index} of ${sess.size}`,
      progress: Array.from({ length: sess.size }, (_, i) => i < done),
      closeLabel: 'Close session. Your calls so far are saved.',
    };
  }

  function renderQuestion(sess, { q, shownAt }) {
    const index = sess.calls.length + 1;
    const dial = makeDial(S);
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock' }, 'Lock in');
    const shownHere = Date.now();
    mount(focusFrame(header(sess, index),
      h('section', null,
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(q.domain)), h('span', { class: 'tag' }, sess.mode === 'baseline' ? 'Baseline' : 'Unit 1 practice')),
        claimNode(q, { id: 'claim' })),
      dial.el,
      h('div', { class: 'foot' }, h('span', { class: 'cap' }, 'A lock is final.'), lockBtn)));
    stop();
    timer = setTimeout(() => onTimeout(sess.id, q.id), Math.max(0, timeoutMs - (Date.now() - shownAt)));
    lockBtn.addEventListener('click', () => {
      if (Date.now() - shownHere < guardMs) return;
      lockBtn.disabled = true; stop(); lock(sess, q, shownAt, dial.value());
    });
  }

  async function onTimeout(sid, qid) {
    if (!ctx.alive(token) || sid !== sessionId) return;
    const sess = sessionNow();
    if (!sess || sess.calls.some((c) => c.q === qid)) return;
    await skip(sess, qid, 'timeout');
    ctx.toast(`No answer in ${cfg.gym.timeout_seconds} seconds. That question goes back to the pool.`);
    await step();
  }

  async function lock(sess, q, shownAt, { side, c }) {
    const wasRight = (side === 'yes') === q.answer;
    const ev = R.makeEvent('call', {
      session: sess.id, mode: sess.mode, unit: sess.unit, q: q.id, claim: q.claim, domain: q.domain, diff: q.diff,
      side, c, truth: q.answer, hit: wasRight, points: S.score(c, wasRight), rule: S.rule, ms: Math.min(timeoutMs, Date.now() - shownAt),
    });
    await store.append(ev);
    await store.setMeta('active', undefined);
    ctx.requestPersist();
    if (!ctx.alive(token)) return;
    if (sess.mode === 'baseline') { await step(); return; }
    renderReveal(sess, q, ev);
  }

  function renderReveal(sess, q, ev) {
    const index = sess.calls.length + 1;
    const c = ev.c;
    const pos = ev.side === 'yes' ? 50 + (c - 0.5) * 100 : 50 - (c - 0.5) * 100;
    const hitPts = S.hit(c), missPts = S.miss(c);
    const sourceRow = /^https?:/.test(q.source)
      ? h('a', { class: 'link', href: q.source, target: '_blank', rel: 'noopener noreferrer' }, `Source: ${q.src_name || 'link'} ↗`)
      : null;
    const flagBtn = h('button', { class: 'ghost', type: 'button', id: 'flag' }, 'Flag this question as disputed');
    flagBtn.addEventListener('click', async () => {
      flagBtn.disabled = true;
      await store.append(R.makeEvent('dispute', { q: q.id }));
      flagBtn.textContent = 'Flagged. It will not come back.';
    });
    const nextBtn = h('button', { class: 'btn', type: 'button', id: 'next' }, index >= sess.size ? 'Finish session' : 'Next call');
    const armedAt = Date.now() + guardMs;
    nextBtn.addEventListener('click', async () => { if (Date.now() < armedAt) return; nextBtn.disabled = true; await step(); });
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' },
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(q.domain)), h('span', { class: 'tag' }, 'Unit 1 practice')),
        claimNode(q),
        h('div', { class: 'strip', role: 'img', 'aria-label': `The truth was ${q.answer ? 'Yes' : 'No'}. You said ${ev.side === 'yes' ? 'Yes' : 'No'} at ${pct(c)}.` },
          h('div', { class: 'track' },
            h('i', { class: 'mine', style: `left:${Math.min(50, pos)}%;width:${Math.abs(pos - 50)}%` }),
            h('i', { class: 'truth', style: `left:${q.answer ? 100 : 0}%` }),
            h('i', { class: 'dot', style: `left:${pos}%` })),
          h('div', { class: 'labels' }, h('span', { class: 't' }, `Truth: ${q.answer ? 'Yes' : 'No'}`), h('span', null, `You: ${ev.side === 'yes' ? 'Yes' : 'No'} · ${pct(c)}`))),
        h('div', { class: 'res' },
          h('span', { class: `ans${ev.hit ? '' : ' bad'}`, id: 'verdict' }, icon(ev.hit ? 'right' : 'wrong', 24, 1.8), ev.hit ? 'Right' : 'Wrong'),
          h('span', { class: `pts${ev.points < 0 ? ' bad' : ''}` }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'points' }, signed(ev.points)))),
        h('p', { class: 'note' }, ev.hit
          ? `At ${pct(c)} a hit pays ${hitPts} and a miss would have cost ${-missPts}.`
          : `At ${pct(c)} a miss costs ${-missPts} and a hit would have paid ${hitPts}.`)),
      h('section', { class: 'card answer' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The answer'), h('span', { class: 'cap' }, q.verified === 'sourced' ? `Checked ${q.checked}` : 'From the record')),
        h('p', null, h('b', null, q.answer ? 'Yes, that is true.' : 'No, that is false.'), ' ', q.fact),
        baseLine(q),
        q.why ? h('p', { class: 'muted' }, q.why) : null,
        sourceRow),
      h('div', { class: 'foot' }, nextBtn, flagBtn)));
  }

  function onVisible() {
    if (document.visibilityState !== 'visible') return;
    const sess = sessionNow();
    if (!sess || sess.ended) return;
    store.getMeta('active').then((a) => {
      if (a && a.session === sess.id && Date.now() - a.shownAt > timeoutMs && ctx.alive(token)) onTimeout(sess.id, a.q);
    });
  }
  document.addEventListener('visibilitychange', onVisible);
  ctx.onLeave(() => document.removeEventListener('visibilitychange', onVisible));

  const sess = await ensureSession();
  sessionId = sess.id;
  await step();
}

// What happened in a session. A baseline session shows nothing until now, so this is where its calls are revealed.
export function summaryScreen(ctx, id) {
  const sess = R.sessionsOf(ctx.store.events).find((s) => s.id === id);
  if (!sess) { ctx.nav('#/today'); return document.createTextNode(''); }
  const { S } = ctx;
  const sum = R.summarize(sess.calls);
  const events = ctx.store.events;
  const disputed = R.disputedIds(events);
  const baseTotal = Number(unitRow(ctx, 'U0').practice_calls);
  const base = R.baselineProgress(events, baseTotal);
  const justFinishedBaseline = sess.mode === 'baseline' && base.complete && !R.callsOf(events).some((c) => c.mode === 'practice');
  const title = sess.mode === 'baseline' ? `Baseline session ${sess.n || ''}`.trim() : 'Practice session';
  const pctOrDash = (x) => (x === null ? '–' : pct(x));

  const rows = sess.calls.map((c) => {
    const flag = h('button', { class: 'flagbtn', type: 'button', 'aria-pressed': disputed.has(c.q) ? 'true' : 'false', 'aria-label': `Flag "${c.claim}" as disputed` }, disputed.has(c.q) ? 'Flagged' : 'Flag');
    flag.addEventListener('click', async () => {
      if (flag.getAttribute('aria-pressed') === 'true') return;
      await ctx.store.append(R.makeEvent('dispute', { q: c.q }));
      flag.setAttribute('aria-pressed', 'true');
      flag.textContent = 'Flagged';
    });
    return h('li', null,
      h('div', { class: 't' }, h('span', null, c.claim), h('em', null, `You said ${c.side === 'yes' ? 'Yes' : 'No'} at ${pct(c.c)} · truth: ${c.truth ? 'Yes' : 'No'}`)),
      h('span', { class: `m num${c.points < 0 ? ' bad' : ''}` }, signed(c.points)),
      flag);
  });

  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  const guard = (e) => { if (Date.now() < armedAt) e.preventDefault(); };
  const primary = justFinishedBaseline
    ? h('a', { class: 'btn', href: '#/mirror' }, 'See your calibration curve')
    : h('a', { class: 'btn', href: '#/today' }, 'Back to Today');
  const secondary = justFinishedBaseline
    ? h('a', { class: 'ghost', href: '#/today' }, 'Back to Today')
    : h('a', { class: 'ghost', href: '#/gym' }, 'Start another session');

  primary.addEventListener('click', guard);
  secondary.addEventListener('click', guard);

  return focusFrame({ title: 'Session done', closeLabel: 'Back to Today' },
    h('section', null,
      h('div', { class: 'eyebrow' }, title),
      h('p', { class: 'claim', style: 'font-size:24px' }, sess.mode === 'baseline'
        ? (justFinishedBaseline ? 'Baseline complete. Here is how this last session went.' : `Here is how those ${sum.n} calls went.`)
        : `${sum.hits} of ${sum.n} right.`)),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'sum-points' }, signed(sum.points)), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Right'), h('b', { class: 'num', id: 'sum-right' }, `${sum.hits} of ${sum.n}`), h('span', { class: 'cap' }, `Hit rate ${pctOrDash(sum.hitRate)}`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average confidence'), h('b', { class: 'num' }, pctOrDash(sum.meanConf)), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Gap'), h('b', { class: 'num' }, sum.gap === null ? '–' : gapPts(sum.gap)), h('span', { class: 'cap' }, sum.gap === null ? '' : sum.gap > 0.02 ? 'points too sure' : sum.gap < -0.02 ? 'points too shy' : 'close to honest'))),
    sess.mode === 'baseline' && !justFinishedBaseline
      ? h('p', { class: 'lede', id: 'base-note' }, `Baseline: ${base.done} of ${base.total} calls done. Mirror already draws a first rough curve, and it firms up as the calls add up. A different day makes a fairer next session.`)
      : null,
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, sess.mode === 'baseline' ? 'Your calls, revealed' : 'Your calls'), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('ul', { class: 'rows', id: 'rows' }, rows)),
    h('div', { class: 'foot' }, primary, secondary));
}

// The gym: a session of binary calls. Baseline sessions (Unit 0) give no feedback until the session ends; practice sessions
// (Unit 1) and drills reveal each call at once; an exam sitting gives no feedback at all until the exam is judged. A call is
// saved on the phone the moment it is locked.
import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import * as G from '../engine/gate.js';
import { planBaseline, pickNext, seeded, randomSeed } from '../engine/draw.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { focusFrame, unitRow } from './common.js';
import { makeDial, wheel } from './dial.js';
import { gateState, judgeExam } from '../flags.js';
import { retestText, flagName } from '../flagtext.js';

export const domainLabel = (d) => (d ? d.charAt(0).toUpperCase() + d.slice(1) : '');
const MODE_LABEL = { baseline: 'Baseline', practice: 'Unit 1 practice', drill: 'Drill', exam: 'Exam' };
export const modeLabel = (mode) => MODE_LABEL[mode] || mode;

// A judgment question is a scene (the lead: where, when, what has happened so far) and a claim about how it turns out (the ask).
// They read as one sentence, so the text of the claim is the lead, one space, then the ask; the scene is set quieter so the
// claim to judge stands out.
export function claimNode(q, attrs) {
  const parts = q.lead && q.ask ? [h('span', { class: 'lead' }, q.lead), ' ', h('span', { class: 'ask' }, q.ask)] : [q.claim];
  return h('p', { class: q.claim.length > 150 ? 'claim long' : 'claim', ...attrs }, ...parts);
}

// The outside view, shown after the call: how often a claim like this one held among the other cases in the records.
// Documented facts from a source (verified 'sourced') carry no count of cases, so they show nothing here.
export function baseLine(q) {
  if (q.verified !== 'recorded' || typeof q.base !== 'number') return null;
  const yes = q.base >= 0.5;
  return h('p', { class: 'muted', id: 'base-line' },
    `Claims like this held in ${pct(q.base)} of the ${Number(q.n).toLocaleString('en-US')} other cases. The base rate alone says ${yes ? 'Yes' : 'No'} at ${pct(yes ? q.base : 1 - q.base)}.`);
}

// What the next session would be: the rest of the 60-call baseline first, then Unit 1 practice. While missed days (L15) is open
// the session shrinks to the minimum.
export function nextSessionPlan(ctx) {
  const events = ctx.store.events;
  const U0 = unitRow(ctx, 'U0'), U1 = unitRow(ctx, 'U1');
  const baseTotal = Number(U0.practice_calls);
  const perSession = Number(U0.drills_per_day);
  const base = R.baselineProgress(events, baseTotal);
  let plan;
  if (!base.complete) {
    plan = { mode: 'baseline', unit: 'U0', size: Math.min(perSession, baseTotal - base.done), number: Math.floor(base.done / perSession) + 1, of: Math.ceil(baseTotal / perSession), label: 'Baseline', done: base.done, total: baseTotal };
  } else {
    const done = R.callsOf(events).filter((c) => c.mode === 'practice').length;
    plan = { mode: 'practice', unit: 'U1', size: Number(U1.drills_per_day), label: 'Unit 1 practice', done, total: Number(U1.practice_calls) };
  }
  const minimum = ctx.cfg.lessons.triggers.L15.minimum;
  if (LE.flagsOf(events, ctx.cfg).some((c) => c.trigger === 'L15' && c.state === 'open') && plan.size > minimum.gym_calls) {
    plan = { ...plan, size: minimum.gym_calls, minimum: true };
  }
  return plan;
}

const lastUsedMap = (events) => new Map(R.allCallsOf(events).map((c, i) => [c.q, i]));

export async function gymScreen(ctx, root, token, arg) {
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
  const examBankOf = (sess) => (sess.mode === 'exam' ? ctx.examBank : ctx.bank);

  // The fields of the session to open when none is open, from where the player came: a drill for a flag, the repair drill after
  // a failed exam, the next exam sitting, or the baseline and practice. Returns null when there is nothing to start.
  async function newSession() {
    const events = store.events;
    if (arg && arg.startsWith('drill-')) {
      const chain = LE.flagsOf(events, cfg).find((c) => c.id === arg.slice(6));
      const spec = chain && LE.drillOf(chain.trigger, cfg);
      if (!chain || !spec || spec.kind === 'rewrite' || !['open', 'lesson'].includes(chain.state)) return null;
      return { mode: 'drill', unit: 'U1', size: spec.calls, flag: chain.id, trigger: chain.trigger, drill: spec };
    }
    if (arg === 'repair') {
      const st = gateState(ctx);
      if (!st.needsRepair) return null;
      const spec = G.repairDrillOf(st.lastFailed.result.worst, cfg);
      return { mode: 'drill', unit: 'U1', size: spec.calls, repair: st.lastFailed.id, drill: spec };
    }
    if (arg === 'exam') {
      let st = gateState(ctx);
      let attempt = st.running;
      if (!attempt) {
        if (!st.eligible) return null;
        const disputed = R.disputedIds(events), used = R.usedQuestionIds(events);
        const fresh = ctx.examBank.filter((q) => !used.has(q.id) && !disputed.has(q.id)).length;
        const start = R.makeEvent('exam', { state: 'start', unit: 'U1', n: st.total, reused: Math.max(0, st.total - fresh) });
        await store.append(start);
        st = gateState(ctx);
        attempt = st.running;
      }
      const size = G.examSittingSize(st, cfg.gym);
      const ev = store.events;
      const plan = planBaseline({ bank: ctx.examBank, usedIds: R.usedQuestionIds(ev), disputedIds: R.disputedIds(ev), lastUsed: lastUsedMap(ev), size, spares: cfg.gym.baseline_spares, mix: cfg.gym.exam_mix, rng });
      return { mode: 'exam', unit: 'U1', size, exam: attempt.id, n: Math.floor(st.done / cfg.gym.exam_session_size) + 1, of: Math.ceil(st.total / cfg.gym.exam_session_size), plan };
    }
    const plan = nextSessionPlan(ctx);
    return {
      mode: plan.mode, unit: plan.unit, size: plan.size, n: plan.number || null,
      plan: plan.mode === 'baseline'
        ? planBaseline({ bank: ctx.bank, usedIds: R.usedQuestionIds(events), disputedIds: R.disputedIds(events), lastUsed: lastUsedMap(events), size: plan.size, spares: cfg.gym.baseline_spares, mix: cfg.gym.difficulty_mix, rng })
        : undefined,
    };
  }

  async function ensureSession() {
    const open = R.activeSession(store.events);
    if (open) return open;
    const fields = await newSession();
    if (!fields) return null;
    const ev = R.makeEvent('session', fields);
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
    if (active && active.session === sess.id && !answered.has(active.q) && !skipped.has(active.q) && ctx.questionById(active.q)) {
      if (Date.now() - active.shownAt > timeoutMs) {
        await skip(sess, active.q, 'timeout');
        return currentQuestion(sessionNow());
      }
      return { q: ctx.questionById(active.q), shownAt: active.shownAt };
    }
    let id = null;
    if (sess.plan) id = sess.plan.find((x) => !answered.has(x) && !skipped.has(x)) || null;
    if (!id) {
      const events = store.events;
      const recent = R.callsOf(events).map((c) => c.hit);
      const q = pickNext({
        bank: examBankOf(sess), usedIds: R.usedQuestionIds(events), recentIds: R.recentQuestionIds(events, R.localDay(), cfg.gym.reseen_days),
        disputedIds: R.disputedIds(events), skippedIds: skipped, lastUsed: lastUsedMap(events), recent, shownTruths: sess.calls.map((c) => c.truth),
        cfg: cfg.gym, rng, reviewShare: cfg.gym.review_share,
      });
      id = q && q.id;
    }
    if (!id) throw new Error('The question bank is empty.');
    const rec = { session: sess.id, q: id, shownAt: Date.now() };
    await store.setMeta('active', rec);
    return { q: ctx.questionById(id), shownAt: rec.shownAt };
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
    const has = (type, f) => store.events.some((e) => e.type === type && f(e));
    // A drill that is done moves its flag along (the re-tests start from the day of the drill); a repair drill unlocks the next exam.
    if (sess.mode === 'drill' && sess.flag && !has('flag', (e) => e.state === 'drill' && e.session === sess.id)) await store.append(R.makeEvent('flag', { state: 'drill', flag: sess.flag, session: sess.id }));
    if (sess.mode === 'drill' && sess.repair && !has('exam', (e) => e.state === 'repair' && e.session === sess.id)) await store.append(R.makeEvent('exam', { state: 'repair', exam: sess.repair, session: sess.id }));
    if (sess.mode === 'exam') await judgeExam(ctx, sess.exam);
    // Replace the session screen in the history: Back from the next screen must not start the next session.
    if (ctx.alive(token)) ctx.replace(sess.mode === 'exam' ? `#/exam/${sess.exam}` : `#/summary/${sess.id}`);
  }

  // `done` is how many segments of the progress strip are filled: calls before this one, or including it once revealed.
  function header(sess, index, done = index - 1) {
    return {
      title: sess.mode === 'baseline' ? 'Baseline' : sess.mode === 'drill' ? 'Drill' : sess.mode === 'exam' ? 'Exam' : 'Gym',
      count: `${index} of ${sess.size}`,
      progress: Array.from({ length: sess.size }, (_, i) => i < done),
      closeLabel: sess.mode === 'exam' ? 'Close the sitting. Your calls so far are saved.' : 'Close session. Your calls so far are saved.',
    };
  }

  const tagFor = (sess) => (sess.mode === 'exam' ? `Exam · sitting ${sess.n} of ${sess.of}` : sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : sess.mode === 'baseline' ? 'Baseline' : 'Unit 1 practice');

  // The dial a drill sets: some steps locked (forced commit, zone lock), or every call at 90% or more checked against the wheel.
  function dialOptions(sess, onChange) {
    const d = sess.mode === 'drill' ? sess.drill : null;
    if (d && d.kind === 'forced') return { allowed: d.steps, hint: `Commit: 50%, or ${pct(d.steps[1])} and up. The steps in between are locked in this drill.`, onChange };
    if (d && d.kind === 'zone_locked') return { allowed: S.steps.filter((c) => c >= d.min - 1e-9), hint: `The 50 to 55% zone is locked in this drill. Pick ${pct(d.min)} or more.`, onChange };
    return { onChange };
  }

  function renderQuestion(sess, { q, shownAt }) {
    const index = sess.calls.length + 1;
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock' }, 'Lock in');
    const dial = makeDial(S, dialOptions(sess, (ok) => { lockBtn.disabled = !ok; }));
    const shownHere = Date.now();
    const wheelCheck = sess.mode === 'drill' && sess.drill && sess.drill.kind === 'wheel';
    const foot = h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last call. A lock is final.' : 'A lock is final.'), lockBtn);
    mount(focusFrame(header(sess, index),
      h('section', null,
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(q.domain)), h('span', { class: 'tag', id: 'mode-tag' }, tagFor(sess))),
        claimNode(q, { id: 'claim' })),
      dial.el,
      foot));
    stop();
    timer = setTimeout(() => onTimeout(sess.id, q.id), Math.max(0, timeoutMs - (Date.now() - shownAt)));
    lockBtn.addEventListener('click', () => {
      if (Date.now() - shownHere < guardMs || !dial.ok()) return;
      const v = dial.value();
      // The wheel drill: a call at 90% or more is checked against the wheel before it is locked.
      if (wheelCheck && v.c >= 0.9 - 1e-9) {
        const keep = h('button', { class: 'btn', type: 'button', id: 'wheel-keep' }, 'My answer');
        const lower = h('button', { class: 'ghost', type: 'button', id: 'wheel-lower' }, 'The wheel: lower the dial');
        const check = h('section', { class: 'card stack', id: 'wheel-check' },
          h('span', { class: 'eyebrow' }, 'Wheel check'),
          wheel(v.c),
          h('p', null, `Would you rather bet on your answer, or on a wheel that wins ${Math.round(v.c * 100)} spins in 100?`),
          keep, lower);
        foot.replaceChildren(check);
        lower.addEventListener('click', () => { foot.replaceChildren(h('span', { class: 'cap' }, 'A lock is final.'), lockBtn); });
        const armed = Date.now() + guardMs;
        keep.addEventListener('click', () => { if (Date.now() < armed) return; keep.disabled = true; lower.disabled = true; stop(); lock(sess, q, shownAt, v); });
        return;
      }
      lockBtn.disabled = true; stop(); lock(sess, q, shownAt, v);
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
      session: sess.id, mode: sess.mode, unit: sess.unit, exam: sess.mode === 'exam' ? sess.exam : undefined, q: q.id, claim: q.claim, domain: q.domain, diff: q.diff,
      side, c, truth: q.answer, hit: wasRight, points: S.score(c, wasRight), rule: S.rule, ms: Math.min(timeoutMs, Date.now() - shownAt),
    });
    await store.append(ev);
    await store.setMeta('active', undefined);
    ctx.requestPersist();
    if (!ctx.alive(token)) return;
    if (sess.mode === 'baseline' || sess.mode === 'exam') { await step(); return; }
    renderReveal(sess, q, ev);
  }

  // A miss stated at 80% or more gets a note: what a calibrated call looked like, and whether the records call the outcome rare.
  function noteCard(q, ev) {
    const earlier = R.callsOf(store.events).filter((c) => c.id !== ev.id);
    const note = LE.instantNote(ev, q, earlier, S, cfg);
    if (!note) return null;
    const cal = note.calibrated;
    const calibrated = cal.kind === 'own'
      ? `From your own record: your calls at ${pct(ev.c)} or more were right ${pct(cal.hitRate)} of the time (${cal.n} calls). A calibrated call there is about ${pct(cal.step)}.`
      : `At ${pct(ev.c)} you expect to be wrong about 1 time in ${cal.oneIn}. This was one of them. Was it that one in ${cal.oneIn}, or did the wrong side tempt you?`;
    const luck = note.luck.chance === null
      ? 'This comes from a documented figure, not a record of cases, so there is no count to tell luck from judgment. Treat a miss this sure as judgment.'
      : note.luck.kind === 'luck'
        ? `In the records this outcome happens in only ${pct(note.luck.chance)} of cases like it. This one may be luck.`
        : `In the records this outcome happens in ${pct(note.luck.chance)} of cases like it. It was not a freak: the call, not luck, was the problem.`;
    return h('section', { class: 'card stack', id: 'instant-note' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `A miss at ${pct(ev.c)}`)),
      h('p', { id: 'note-calibrated' }, calibrated),
      h('p', { class: 'muted', id: 'note-luck' }, luck));
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
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(q.domain)), h('span', { class: 'tag' }, tagFor(sess))),
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
      noteCard(q, ev),
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

  const openNow = R.activeSession(store.events);
  if (openNow && openNow.fine) { ctx.replace(openNow.exam ? '#/fine/exam' : openNow.flag ? `#/fine/drill-${openNow.flag}` : openNow.repair ? '#/fine/repair' : '#/fine'); return; }
  const sess = await ensureSession();
  if (!sess) { ctx.replace(arg === 'exam' || arg === 'repair' ? '#/path' : '#/today'); return; }
  sessionId = sess.id;
  await step();
}

// What happened in a session. A baseline session shows nothing until now, so this is where its calls are revealed.
export function summaryScreen(ctx, id) {
  const sess = R.sessionsOf(ctx.store.events).find((s) => s.id === id);
  if (!sess) { ctx.nav('#/today'); return document.createTextNode(''); }
  // An exam sitting is sealed: its results are read on the exam's own screen, once the exam is judged.
  if (sess.mode === 'exam') { ctx.replace(`#/exam/${sess.exam}`); return document.createTextNode(''); }
  const { S } = ctx;
  const sum = R.summarize(sess.calls);
  const events = ctx.store.events;
  const disputed = R.disputedIds(events);
  const baseTotal = Number(unitRow(ctx, 'U0').practice_calls);
  const base = R.baselineProgress(events, baseTotal);
  const justFinishedBaseline = sess.mode === 'baseline' && base.complete && !R.callsOf(events).some((c) => c.mode === 'practice');
  const title = sess.mode === 'baseline' ? `Baseline session ${sess.n || ''}`.trim() : sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : 'Practice session';
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
    : sess.mode === 'drill' ? h('a', { class: 'ghost', href: sess.repair ? '#/path' : '#/gym' }, sess.repair ? 'Back to Path' : 'Start a practice session')
      : h('a', { class: 'ghost', href: '#/gym' }, 'Start another session');

  primary.addEventListener('click', guard);
  secondary.addEventListener('click', guard);

  // After a drill, say what happens next.
  const chain = sess.flag ? LE.flagsOf(events, ctx.cfg).find((c) => c.id === sess.flag) : null;
  const next = sess.mode !== 'drill' ? null
    : sess.repair ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, 'What happens next'), h('p', null, 'The repair drill is done. A new exam of fresh calls is open on the Path whenever you are ready.'))
      : chain ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, `What happens next · ${flagName(ctx, chain.trigger)}`), h('p', null, retestText(chain, ctx.cfg)))
        : null;

  return focusFrame({ title: 'Session done', closeLabel: 'Back to Today' },
    h('section', null,
      h('div', { class: 'eyebrow' }, title),
      h('p', { class: 'claim', style: 'font-size:24px' }, sess.mode === 'baseline'
        ? (justFinishedBaseline ? 'Baseline complete. Here is how this last session went.' : `Here is how those ${sum.n} calls went.`)
        : sess.mode === 'drill' ? `Drill done: ${sum.hits} of ${sum.n} right.`
          : `${sum.hits} of ${sum.n} right.`)),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'sum-points' }, signed(sum.points)), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Right'), h('b', { class: 'num', id: 'sum-right' }, `${sum.hits} of ${sum.n}`), h('span', { class: 'cap' }, `Hit rate ${pctOrDash(sum.hitRate)}`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average confidence'), h('b', { class: 'num' }, pctOrDash(sum.meanConf)), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Gap'), h('b', { class: 'num' }, sum.gap === null ? '–' : gapPts(sum.gap)), h('span', { class: 'cap' }, sum.gap === null ? '' : sum.gap > 0.02 ? 'points too sure' : sum.gap < -0.02 ? 'points too shy' : 'close to honest'))),
    sess.mode === 'baseline' && !justFinishedBaseline
      ? h('p', { class: 'lede', id: 'base-note' }, `Baseline: ${base.done} of ${base.total} calls done. Mirror already draws a first rough curve, and it firms up as the calls add up. A different day makes a fairer next session.`)
      : null,
    next,
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, sess.mode === 'baseline' ? 'Your calls, revealed' : 'Your calls'), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('ul', { class: 'rows', id: 'rows' }, rows)),
    h('div', { class: 'foot' }, primary, secondary));
}

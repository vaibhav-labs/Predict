// Unit 10, Fine grain (Block 10): calls on the 1% dial under the sharp (log) rule, on questions that live in the tails. Practice sessions of 14 and
// drills (the L14 round-number drill and the repair drill) reveal each call at once; the exam is 400 calls in sittings of 20, sealed until the last one.
// A call is a normal `call` event with fine true, unit U10, its sharp points in `points` and the core-rule points in `core` (the ledger reads those).
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import * as FN from '../engine/fine.js';
import { seeded, randomSeed, shuffle } from '../engine/draw.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { focusFrame, unitRow } from './common.js';
import { makeDial } from './dial.js';
import { claimNode, baseLine, domainLabel } from './gym.js';
import { fineGateState, judgeFineExam } from '../flags.js';
import { retestText, flagName } from '../flagtext.js';

const pts = (x) => `${Math.round(Math.abs(x) * 1000) / 10}`;
const tolOf = (cfg) => `${Math.round(cfg.gates.fine_index_tolerance * 1000) / 10}`;
const gapText = (x) => `${x > 0 ? '+' : x < 0 ? '\u2212' : ''}${pts(x)}`;

// The questions of a session, in order: fresh ones first (never asked), then the ones asked longest ago. A disputed question never comes back.
export function planFine({ bank, events, size, rng }) {
  const disputed = R.disputedIds(events);
  const pool = bank.filter((q) => !disputed.has(q.id));
  const used = R.usedQuestionIds(events);
  const last = new Map(R.allCallsOf(events).map((c, i) => [c.q, i]));
  const fresh = shuffle(pool.filter((q) => !used.has(q.id)), rng);
  const older = pool.filter((q) => used.has(q.id)).sort((a, b) => last.get(a.id) - last.get(b.id) || (a.id < b.id ? -1 : 1));
  return fresh.concat(older).slice(0, size).map((q) => q.id);
}

const modeText = (s) => (s.mode === 'exam' ? `Exam · sitting ${s.n} of ${s.of}` : s.mode === 'drill' ? (s.flag ? 'Drill' : 'Repair drill') : 'Unit 10 practice');

export async function fineScreen(ctx, root, token, arg) {
  const { store, cfg, S } = ctx;
  const timeoutMs = cfg.gym.timeout_seconds * 1000;
  const guardMs = cfg.gym.tap_guard_ms ?? 400;
  const rng = seeded(randomSeed());
  const steps = FN.fineSteps(cfg);
  let timer = null;
  let sessionId = null;
  const stop = () => clearTimeout(timer);
  ctx.onLeave(stop);
  const sessionNow = () => R.sessionsOf(store.events).find((x) => x.id === sessionId);
  const mount = (view) => { root.replaceChildren(view); window.scrollTo(0, 0); };
  const bankOf = (sess) => (sess.mode === 'exam' ? ctx.fineExamBank : ctx.fineBank);
  const byId = (id) => ctx.fineById(id);

  async function newSession() {
    const events = store.events;
    const st = fineGateState(ctx);
    if (!st.open) return null;
    if (arg && arg.startsWith('drill-')) {
      const chain = LE.flagsOf(events, cfg).find((c) => c.id === arg.slice(6));
      const spec = chain && LE.drillOf(chain.trigger, cfg);
      if (!chain || chain.trigger !== 'L14' || !spec || !['open', 'lesson'].includes(chain.state)) return null;
      return { mode: 'drill', unit: 'U10', fine: true, size: spec.calls, flag: chain.id, trigger: chain.trigger, drill: spec, plan: planFine({ bank: ctx.fineBank, events, size: spec.calls + 4, rng }) };
    }
    if (arg === 'repair') {
      if (!st.needsRepair) return null;
      const spec = FN.fineRepairOf(st.lastFailed.result, cfg);
      return { mode: 'drill', unit: 'U10', fine: true, size: spec.calls, repair: st.lastFailed.id, drill: spec, plan: planFine({ bank: ctx.fineBank, events, size: spec.calls + 4, rng }) };
    }
    if (arg === 'exam') {
      let cur = st;
      let attempt = cur.running;
      if (!attempt) {
        if (!cur.eligible) return null;
        await store.append(R.makeEvent('exam', { state: 'start', unit: 'U10', n: cur.total }));
        cur = fineGateState(ctx);
        attempt = cur.running;
      }
      const size = FN.fineSittingSize(cur, cfg);
      return { mode: 'exam', unit: 'U10', fine: true, size, exam: attempt.id, n: Math.floor(cur.done / cfg.gates.fine_sitting) + 1, of: Math.ceil(cur.total / cfg.gates.fine_sitting),
        plan: planFine({ bank: ctx.fineExamBank, events: store.events, size: size + 4, rng }) };
    }
    const size = cfg.problems.fine.practice_session_size;
    return { mode: 'practice', unit: 'U10', fine: true, size, plan: planFine({ bank: ctx.fineBank, events, size: size + 4, rng }) };
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

  async function currentQuestion(sess) {
    const answered = new Set(sess.calls.map((c) => c.q));
    const skipped = new Set(sess.skipped);
    const active = await store.getMeta('active');
    if (active && active.session === sess.id && !answered.has(active.q) && !skipped.has(active.q) && byId(active.q)) {
      if (Date.now() - active.shownAt > timeoutMs) { await skip(sess, active.q, 'timeout'); return currentQuestion(sessionNow()); }
      return { q: byId(active.q), shownAt: active.shownAt };
    }
    let id = (sess.plan || []).find((x) => !answered.has(x) && !skipped.has(x)) || null;
    if (!id) {
      const more = planFine({ bank: bankOf(sess), events: store.events, size: 40, rng }).find((x) => !answered.has(x) && !skipped.has(x));
      id = more || null;
    }
    if (!id) throw new Error('The tail question bank is empty.');
    const rec = { session: sess.id, q: id, shownAt: Date.now() };
    await store.setMeta('active', rec);
    return { q: byId(id), shownAt: rec.shownAt };
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
    if (sess.mode === 'drill' && sess.flag && !has('flag', (e) => e.state === 'drill' && e.session === sess.id)) await store.append(R.makeEvent('flag', { state: 'drill', flag: sess.flag, session: sess.id }));
    if (sess.mode === 'drill' && sess.repair && !has('exam', (e) => e.state === 'repair' && e.session === sess.id)) await store.append(R.makeEvent('exam', { state: 'repair', exam: sess.repair, session: sess.id }));
    if (sess.mode === 'exam') await judgeFineExam(ctx, sess.exam);
    if (ctx.alive(token)) ctx.replace(sess.mode === 'exam' ? `#/fexam/${sess.exam}` : `#/fsummary/${sess.id}`);
  }

  const header = (sess, index, done = index - 1) => ({
    title: sess.mode === 'drill' ? 'Drill' : sess.mode === 'exam' ? 'Exam' : 'Fine grain',
    count: `${index} of ${sess.size}`,
    progress: Array.from({ length: sess.size }, (_, i) => i < done),
    closeLabel: sess.mode === 'exam' ? 'Close the sitting. Your calls so far are saved.' : 'Close session. Your calls so far are saved.',
  });

  function dialOptions(sess, onChange) {
    const base = { steps, rule: S.sharpRule, onChange };
    const d = sess.mode === 'drill' ? sess.drill : null;
    if (d && d.kind === 'fine' && d.lock_multiples_of) {
      const to = d.lock_multiples_of;
      return { ...base, allowed: steps.filter((c) => Math.round(c * 100) % to !== 0), hint: `Multiples of ${to} are locked in this drill. Say 63 or 67, whichever you actually believe.` };
    }
    return base;
  }

  function renderQuestion(sess, { q, shownAt }) {
    const index = sess.calls.length + 1;
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock' }, 'Lock in');
    const dial = makeDial(S, dialOptions(sess, (ok) => { lockBtn.disabled = !ok; }));
    const shownHere = Date.now();
    mount(focusFrame(header(sess, index),
      h('section', null,
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(q.domain)), h('span', { class: 'tag', id: 'mode-tag' }, modeText(sess))),
        claimNode(q, { id: 'claim' })),
      dial.el,
      h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last call. A lock is final.' : 'Sharp rule: a sure miss costs a lot. A lock is final.'), lockBtn)));
    stop();
    timer = setTimeout(() => onTimeout(sess.id, q.id), Math.max(0, timeoutMs - (Date.now() - shownAt)));
    lockBtn.addEventListener('click', () => {
      if (Date.now() - shownHere < guardMs || !dial.ok()) return;
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
    const hit = (side === 'yes') === q.answer;
    const ev = R.makeEvent('call', {
      session: sess.id, mode: sess.mode, unit: 'U10', fine: true, exam: sess.mode === 'exam' ? sess.exam : undefined, q: q.id, claim: q.claim, domain: q.domain, diff: q.diff,
      side, c, truth: q.answer, hit, points: FN.sharp(S, c, hit), core: S.score(c, hit), rule: S.sharpRule, ms: Math.min(timeoutMs, Date.now() - shownAt),
    });
    await store.append(ev);
    await store.setMeta('active', undefined);
    ctx.requestPersist();
    if (!ctx.alive(token)) return;
    if (sess.mode === 'exam') { await step(); return; }
    renderReveal(sess, q, ev);
  }

  function renderReveal(sess, q, ev) {
    const index = sess.calls.length + 1;
    const c = ev.c;
    const hitPts = FN.sharp(S, c, true), missPts = FN.sharp(S, c, false);
    const base = FN.baseAnswer(q, S, cfg);
    const flagBtn = h('button', { class: 'ghost', type: 'button', id: 'flag' }, 'Flag this question as disputed');
    flagBtn.addEventListener('click', async () => { flagBtn.disabled = true; await store.append(R.makeEvent('dispute', { q: q.id })); flagBtn.textContent = 'Flagged. It will not come back.'; });
    const nextBtn = h('button', { class: 'btn', type: 'button', id: 'next' }, index >= sess.size ? 'Finish session' : 'Next call');
    const armedAt = Date.now() + guardMs;
    nextBtn.addEventListener('click', async () => { if (Date.now() < armedAt) return; nextBtn.disabled = true; await step(); });
    const sourceRow = /^https?:/.test(q.source) ? h('a', { class: 'link', href: q.source, target: '_blank', rel: 'noopener noreferrer' }, `Source: ${q.src_name || 'link'} ↗`) : null;
    const delta = ev.points - base.points;
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' },
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, domainLabel(q.domain)), h('span', { class: 'tag' }, modeText(sess))),
        claimNode(q),
        h('div', { class: 'res' },
          h('span', { class: `ans${ev.hit ? '' : ' bad'}`, id: 'verdict' }, ev.hit ? 'Right' : 'Wrong'),
          h('span', { class: `pts${ev.points < 0 ? ' bad' : ''}` }, h('span', { class: 'eyebrow' }, 'Sharp points'), h('b', { class: 'num', id: 'points' }, signed(ev.points)))),
        h('p', { class: 'note', id: 'sharp-note' }, ev.hit
          ? `At ${pct(c)} a hit pays ${hitPts} and a miss would have cost ${-missPts}.`
          : `At ${pct(c)} a miss costs ${-missPts} and a hit would have paid ${hitPts}.`),
        typeof q.base === 'number' ? h('p', { class: 'muted', id: 'base-compare' }, `Saying the base rate (${pct(base.c)} ${base.side === 'yes' ? 'Yes' : 'No'}) would have scored ${signed(base.points)} here. You scored ${signed(ev.points)}: ${delta > 0 ? `${delta} better` : delta < 0 ? `${-delta} worse` : 'the same'}.`) : null),
      h('section', { class: 'card answer' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The answer'), h('span', { class: 'cap' }, 'From the record')),
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
    store.getMeta('active').then((a) => { if (a && a.session === sess.id && Date.now() - a.shownAt > timeoutMs && ctx.alive(token)) onTimeout(sess.id, a.q); });
  }
  document.addEventListener('visibilitychange', onVisible);
  ctx.onLeave(() => document.removeEventListener('visibilitychange', onVisible));

  const open = R.activeSession(store.events);
  if (open && !open.fine) { ctx.replace('#/gym'); return; }
  const sess = await ensureSession();
  if (!sess) { ctx.replace(arg === 'exam' || arg === 'repair' ? '#/path' : '#/today'); return; }
  sessionId = sess.id;
  await step();
}

// What happened in a practice or drill session, in the sharp currency.
export function fineSummaryScreen(ctx, id) {
  const sess = R.sessionsOf(ctx.store.events).find((s) => s.id === id);
  if (!sess) { ctx.nav('#/today'); return document.createTextNode(''); }
  if (sess.mode === 'exam') { ctx.replace(`#/fexam/${sess.exam}`); return document.createTextNode(''); }
  const { cfg, S } = ctx;
  const sum = R.summarize(sess.calls);
  const sharpTotal = sess.calls.reduce((s, c) => s + c.points, 0);
  const roundN = sess.calls.filter((c) => FN.isRound(c.c, cfg.problems.fine.round_to)).length;
  const events = ctx.store.events;
  const chain = sess.flag ? LE.flagsOf(events, cfg).find((c) => c.id === sess.flag) : null;
  const next = sess.mode !== 'drill' ? null
    : sess.repair ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, 'What happens next'), h('p', null, 'The repair drill is done. A new exam of fresh calls is open on the Path whenever you are ready.'))
      : chain ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, `What happens next · ${flagName(ctx, chain.trigger)}`), h('p', null, retestText(chain, cfg))) : null;
  const rows = sess.calls.map((c) => h('li', null,
    h('div', { class: 't' }, h('span', null, c.claim), h('em', null, `You said ${c.side === 'yes' ? 'Yes' : 'No'} at ${pct(c.c)} · truth: ${c.truth ? 'Yes' : 'No'}`)),
    h('span', { class: `m num${c.points < 0 ? ' bad' : ''}` }, signed(c.points))));
  const armedAt = Date.now() + (cfg.gym.tap_guard_ms ?? 400);
  const guard = (e) => { if (Date.now() < armedAt) e.preventDefault(); };
  const primary = h('a', { class: 'btn', href: '#/today' }, 'Back to Today');
  const secondary = h('a', { class: 'ghost', href: sess.repair ? '#/path' : '#/fine' }, sess.repair ? 'Back to Path' : 'Another fine session');
  primary.addEventListener('click', guard); secondary.addEventListener('click', guard);
  return focusFrame({ title: 'Session done', closeLabel: 'Back to Today' },
    h('section', null, h('div', { class: 'eyebrow' }, sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : 'Unit 10 practice'),
      h('p', { class: 'claim', style: 'font-size:24px' }, sess.mode === 'drill' ? `Drill done: ${sum.hits} of ${sum.n} right.` : `${sum.hits} of ${sum.n} right.`)),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Sharp points'), h('b', { class: 'num', id: 'sum-points' }, signed(sharpTotal)), h('span', { class: 'cap' }, `${sum.n} calls`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Right'), h('b', { class: 'num', id: 'sum-right' }, `${sum.hits} of ${sum.n}`), h('span', { class: 'cap' }, `Hit rate ${sum.hitRate === null ? '–' : pct(sum.hitRate)}`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average confidence'), h('b', { class: 'num' }, sum.meanConf === null ? '–' : pct(sum.meanConf)), h('span', { class: 'cap' }, sum.gap === null ? '' : `gap ${gapPts(sum.gap)}`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'On a multiple of ten'), h('b', { class: 'num', id: 'sum-round' }, `${roundN} of ${sum.n}`), h('span', { class: 'cap' }, 'a 1% dial earns its steps'))),
    next,
    h('section', { class: 'card' }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your calls'), h('span', { class: 'cap' }, `${sum.n} calls`)), h('ul', { class: 'rows', id: 'rows' }, rows)),
    h('div', { class: 'foot' }, primary, secondary));
}

// The exam's own screen: sealed progress while it runs, the verdict once it is judged.
export function fineExamScreen(ctx, id) {
  const { cfg } = ctx;
  const st = fineGateState(ctx);
  const a = st.attempts.find((x) => x.id === id);
  if (!a) { ctx.nav('#/path'); return document.createTextNode(''); }
  if (!a.result) {
    return focusFrame({ title: 'Exam', closeLabel: 'Back to Path', closeTo: '#/path' },
      h('section', { class: 'card stack', id: 'fexam-progress' }, h('span', { class: 'eyebrow' }, 'Sealed'), h('p', null, `${a.calls.length} of ${a.total} calls done. Nothing is shown until the last one.`),
        a.calls.length < a.total ? h('a', { class: 'btn', href: '#/fine/exam' }, 'Next sitting') : null));
  }
  const r = a.result;
  const tol = tolOf(cfg);
  return focusFrame({ title: 'Verdict', closeLabel: 'Back to Path', closeTo: '#/path' },
    h('section', null, h('div', { class: 'eyebrow' }, 'Unit 10 exam'), h('p', { class: 'claim', style: 'font-size:24px', id: 'fexam-verdict' }, r.pass ? 'Passed.' : 'Not passed this time.')),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average confidence'), h('b', { class: 'num', id: 'fexam-conf' }, pct(r.meanConf))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Hit rate'), h('b', { class: 'num', id: 'fexam-hit' }, pct(r.hitRate))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Gap'), h('b', { class: 'num' }, gapText(r.index)), h('span', { class: 'cap' }, `limit ${tol} points`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Sharp points'), h('b', { class: 'num' }, signed(r.points)), h('span', { class: 'cap' }, `${r.n} calls`))),
    h('section', { class: 'card stack' }, r.pass
      ? h('p', null, `Across ${r.n} fresh calls on the 1% dial your average confidence was within ${tol} points of how often you were right. Unit 10 is done; Units 11 and 12 are open.`)
      : h('p', { id: 'fexam-why' }, `Your average confidence (${pct(r.meanConf)}) and your hit rate (${pct(r.hitRate)}) were ${pts(r.index)} points apart; the limit is ${tol}. You ran ${r.dir === 'too sure' ? 'too sure' : 'too shy'}. A repair drill of ${cfg.gates.fine_repair_calls} calls comes first, then a new exam.`)),
    h('div', { class: 'foot' }, h('a', { class: 'btn', href: '#/path' }, 'Back to Path')));
}

// ---- cards ---------------------------------------------------------------------------------------------------------------------------------
export function fineTodayCard(ctx) {
  const st = fineGateState(ctx);
  if (!st.open || st.passed) return null;
  const cfg = ctx.cfg;
  return h('section', { class: 'card stack', id: 'u10-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 10 · Fine grain'), h('span', { class: 'cap num', id: 'u10-count' }, `${Math.min(st.practice, st.practiceRequired)} of ${st.practiceRequired}`)),
    h('p', { id: 'u10-line' }, `${cfg.problems.fine.practice_session_size} calls a session on the 1% dial, in the tails, scored by the sharp rule. ${st.running ? `Exam in progress: ${st.done} of ${st.total}.` : st.eligible ? 'The 400-call exam is open.' : `The exam opens after ${st.practiceRequired} practice calls.`}`),
    h('a', { class: 'ghost', href: st.needsRepair ? '#/fine/repair' : st.running ? '#/fine/exam' : '#/fine', id: 'u10-start' }, st.needsRepair ? 'Repair drill' : st.running ? 'Next exam sitting' : 'Start fine grain'));
}

export function finePathCards(ctx, lessonCard, FINE_LESSONS) {
  const st = fineGateState(ctx);
  const cfg = ctx.cfg;
  const out = [lessonCard('fine-lessons-card', 'Unit 10', FINE_LESSONS, st.open)];
  if (!st.open) return out;
  const attempts = st.attempts.filter((a) => a.result);
  let status, body, action = null;
  if (st.passed) { status = 'Passed'; body = [h('p', null, `Passed on ${st.passedAt.slice(0, 10)}.`)]; if (st.rust) body.push(h('p', { class: 'msg err', id: 'fine-rust' }, `Rust: ${flagName(ctx, st.rust.trigger)} came back after you passed.`)); }
  else if (st.running) { status = 'In progress'; body = [h('p', null, `${st.done} of ${st.total} calls done, sealed until the last one.`)]; action = h('a', { class: 'btn', href: '#/fine/exam', id: 'fine-exam-start' }, `Next sitting: ${FN.fineSittingSize(st, cfg)} calls`); }
  else if (st.needsRepair) { status = 'Repair first'; body = [h('p', null, `Not passed this time: you ran ${st.lastFailed.result.dir}. A repair drill of ${cfg.gates.fine_repair_calls} calls comes first.`)]; action = h('a', { class: 'btn', href: '#/fine/repair', id: 'fine-exam-start' }, 'Start the repair drill'); }
  else if (st.eligible) { status = 'Ready'; body = [h('p', null, `${st.total} fresh calls on the 1% dial in sittings of ${cfg.gates.fine_sitting}. Your average confidence must be within ${tolOf(cfg)} points of your hit rate.`)]; action = h('a', { class: 'btn', href: '#/fine/exam', id: 'fine-exam-start' }, attempts.length ? 'Start a new exam' : 'Start the exam'); }
  else { status = 'Not open yet'; body = [h('p', null, `It opens after ${st.practiceRequired} fine practice calls. You have made ${st.practice}.`)]; }
  out.push(h('section', { class: 'card stack', id: 'pgate-U10-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 10 · Fine grain'), h('span', { class: 'chip on', id: 'pgate-U10-status' }, status)),
    ...body, action));
  out.splice(1, 0, h('section', { class: 'card stack', id: 'fine-practice-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 10 practice'), h('span', { class: 'cap num' }, `${st.practice} calls so far`)),
    h('p', null, 'Fourteen calls a session on the 1% dial, in the tails, scored by the sharp rule. After each call: what the base rate alone would have scored.'),
    h('a', { class: 'ghost', href: '#/fine', id: 'fine-practice' }, 'Start fine grain')));
  return out;
}

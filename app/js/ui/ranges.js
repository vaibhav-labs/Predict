// Ranges (Unit 3): a real situation, a quantity to guess, and a low and a high you are 90% sure the truth sits between. Practice
// and drills reveal each range at once; an exam sitting gives no feedback until the exam is judged. A range is saved on the phone the
// moment it is locked. The rules are in engine/range.js.
import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import * as G from '../engine/gate.js';
import * as RG from '../engine/range.js';
import { seeded, randomSeed } from '../engine/draw.js';
import { signed } from '../engine/scoring.js';
import { focusFrame, unitRow } from './common.js';
import { rangeGateState, judgeRangeExam } from '../flags.js';
import { retestText, flagName } from '../flagtext.js';

export const KIND_NAMES = {
  wtemp: 'Temperature', wprecip: 'Rain', flight: 'Flight delay', life: 'Life expectancy', fert: 'Births per woman', renew: 'Renewable power',
  child: 'Child mortality', co2: 'CO2 per person', gdp: 'Income per person', market: 'Stock market',
};
const MODE_LABEL = { practice: 'Unit 3 practice', drill: 'Drill', exam: 'Exam' };
export const rangeModeLabel = (m) => MODE_LABEL[m] || m;
const whole = (x) => Math.round(x * 100);

// A number in the question's own style (its digits), with thousands separators.
export const fmt = (q, x) => Number(x).toLocaleString('en-US', { minimumFractionDigits: q.digits, maximumFractionDigits: q.digits });
// How wide a range is, in words: the difference for a linear question, "N times" (high over low) for a log one.
export const widthText = (q, low, high) => (q.scale === 'log' ? `${(high / low).toFixed(1)} times` : fmt(q, high - low));

export function claimNode(q, attrs) {
  return h('p', { class: (q.lead + q.ask).length > 150 ? 'claim long' : 'claim', ...attrs }, h('span', { class: 'lead' }, q.lead), ' ', h('span', { class: 'ask' }, q.ask));
}

// The line of numbers after a range: the truth, your range, and the reference interval, all drawn on the question's own scale.
export function numberLine(q, low, high, hit) {
  const pts = [low, high, q.ref_low, q.ref_high, q.truth].map((x) => RG.scaled(q, x));
  const lo = Math.min(...pts), hi = Math.max(...pts), pad = (hi - lo) * 0.08 || 1;
  const pos = (x) => (((RG.scaled(q, x) - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(2);
  const bar = (cls, a, b) => h('i', { class: `rb ${cls}`, style: `left:${pos(a)}%;width:${Math.max(0.8, pos(b) - pos(a)).toFixed(2)}%` });
  return h('div', { class: 'rline', role: 'img', id: 'range-line',
    'aria-label': `The truth was ${fmt(q, q.truth)} ${q.unit}. Your range ${fmt(q, low)} to ${fmt(q, high)} ${hit ? 'held' : 'missed'} it. The reference interval ran from ${fmt(q, q.ref_low)} to ${fmt(q, q.ref_high)}.` },
    h('div', { class: 'rl-row' }, h('span', { class: 'rl-lab' }, 'You'), h('span', { class: 'rl-track' }, bar(hit ? 'you' : 'you miss', low, high))),
    h('div', { class: 'rl-row' }, h('span', { class: 'rl-lab' }, 'Reference'), h('span', { class: 'rl-track' }, bar('ref', q.ref_low, q.ref_high))),
    h('i', { class: 'rt', style: `left:calc(64px + (100% - 64px) * ${pos(q.truth)} / 100)` }));
}

// What a flag-less drill or an exam sitting is called on screen.
const tagFor = (sess) => (sess.mode === 'exam' ? `Exam · sitting ${sess.n} of ${sess.of}` : sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : 'Unit 3 practice');

export async function rangeScreen(ctx, root, token, arg) {
  const { store, cfg } = ctx;
  const I = cfg.interval;
  const guardMs = cfg.gym.tap_guard_ms ?? 400;
  const rng = seeded(randomSeed());
  let sessionId = null;
  const sessionNow = () => RG.rsessionsOf(store.events).find((x) => x.id === sessionId);
  const mount = (view) => { root.replaceChildren(view); window.scrollTo(0, 0); };
  const practiceBank = () => ctx.rangeBank;

  // The fields of the session to open when none is open, from where the player came. Returns null when there is nothing to start.
  async function newSession() {
    const events = store.events;
    if (arg && arg.startsWith('drill-')) {
      const chain = LE.flagsOf(events, cfg).find((c) => c.id === arg.slice(6));
      const spec = chain && LE.drillOf(chain.trigger, cfg);
      if (!chain || !spec || !['stepwise', 'budget'].includes(spec.kind) || !['open', 'lesson'].includes(chain.state)) return null;
      return { mode: 'drill', unit: 'U3', size: spec.calls, flag: chain.id, trigger: chain.trigger, drill: spec, plan: RG.planRanges({ bank: practiceBank(), events, size: spec.calls, reseenDays: I.reseen_days, rng }) };
    }
    if (arg === 'repair') {
      const st = rangeGateState(ctx);
      if (!st.needsRepair) return null;
      const spec = RG.rangeRepairOf(st.lastFailed.result, cfg);
      return { mode: 'drill', unit: 'U3', size: spec.calls, repair: st.lastFailed.id, drill: spec, plan: RG.planRanges({ bank: practiceBank(), events, size: spec.calls, reseenDays: I.reseen_days, rng }) };
    }
    if (arg === 'exam') {
      let st = rangeGateState(ctx);
      let attempt = st.running;
      if (!attempt) {
        if (!st.eligible) return null;
        await store.append(R.makeEvent('exam', { state: 'start', unit: 'U3', n: st.total }));
        st = rangeGateState(ctx);
        attempt = st.running;
      }
      const size = RG.rangeSittingSize(st, cfg);
      const ev = store.events;
      const drawn = RG.planRangeExam({ bank: ctx.rangeExamBank, events: ev, size: I.exam_session_size, sitting: 0, total: size, rng });
      return { mode: 'exam', unit: 'U3', size, exam: attempt.id, n: Math.floor(st.done / I.exam_session_size) + 1, of: Math.ceil(st.total / I.exam_session_size), plan: drawn.sitting };
    }
    if (!rangeGateState(ctx).open) return null; // Unit 3 opens when the Unit 1 exam is passed
    return { mode: 'practice', unit: 'U3', size: I.session_size, plan: RG.planRanges({ bank: practiceBank(), events, size: I.session_size, reseenDays: I.reseen_days, rng }) };
  }

  async function ensureSession() {
    const open = RG.activeRSession(store.events);
    if (open) return open;
    const fields = await newSession();
    if (!fields) return null;
    const ev = R.makeEvent('rsession', fields);
    await store.append(ev);
    return RG.rsessionsOf(store.events).find((x) => x.id === ev.id);
  }

  async function step() {
    const sess = sessionNow();
    if (sess.ended || sess.ranges.length >= sess.size) { await finish(sess); return; }
    const answered = new Set(sess.ranges.map((r) => r.q));
    const id = sess.plan.find((x) => !answered.has(x) && ctx.rangeById(x));
    if (!id) { await finish(sess); return; }
    if (!ctx.alive(token)) return;
    renderQuestion(sess, ctx.rangeById(id));
  }

  async function finish(sess) {
    if (!sess.ended) await store.append(R.makeEvent('rsession_end', { session: sess.id }));
    const has = (type, f) => store.events.some((e) => e.type === type && f(e));
    if (sess.mode === 'drill' && sess.flag && !has('flag', (e) => e.state === 'drill' && e.session === sess.id)) await store.append(R.makeEvent('flag', { state: 'drill', flag: sess.flag, session: sess.id }));
    if (sess.mode === 'drill' && sess.repair && !has('exam', (e) => e.state === 'repair' && e.session === sess.id)) await store.append(R.makeEvent('exam', { state: 'repair', exam: sess.repair, session: sess.id }));
    if (sess.mode === 'exam') await judgeRangeExam(ctx, sess.exam);
    if (ctx.alive(token)) ctx.replace(sess.mode === 'exam' ? `#/rexam/${sess.exam}` : `#/rsummary/${sess.id}`);
  }

  function header(sess, index, done = index - 1) {
    return {
      title: sess.mode === 'drill' ? 'Drill' : sess.mode === 'exam' ? 'Exam' : 'Ranges',
      count: `${index} of ${sess.size}`,
      progress: Array.from({ length: sess.size }, (_, i) => i < done),
      closeLabel: sess.mode === 'exam' ? 'Close the sitting. Your ranges so far are saved.' : 'Close session. Your ranges so far are saved.',
    };
  }

  function renderQuestion(sess, q) {
    const index = sess.ranges.length + 1;
    const spec = sess.mode === 'drill' ? sess.drill : null;
    const stepwise = !!spec && spec.kind === 'stepwise';
    const budget = !!spec && spec.kind === 'budget';
    const shownAt = Date.now();
    let stage = stepwise ? 'low' : 'both';

    const lowIn = h('input', { class: 'field num', id: 'range-low', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next', 'aria-describedby': 'range-msg' });
    const highIn = h('input', { class: 'field num', id: 'range-high', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'range-msg' });
    const lowBox = h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'Low'), lowIn, h('span', { class: 'cap' }, q.unit));
    const highBox = h('label', { class: 'rfield', id: 'high-box' }, h('span', { class: 'eyebrow' }, 'High'), highIn, h('span', { class: 'cap' }, q.unit));
    const msg = h('p', { class: 'msg', id: 'range-msg', role: 'status' });
    const info = h('p', { class: 'cap', id: 'range-info' });
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock', disabled: true }, stepwise ? 'Set the low end' : 'Lock in');
    const stepNote = h('p', { class: 'muted', id: 'step-note' });

    const blocks = [];
    if (budget) blocks.push(h('p', { class: 'note', id: 'budget-note' }, `Width budget: ${q.scale === 'log' ? `the high end may be at most ${RG.budgetText(q, spec.budget_ratio)} the low end` : `your range may be at most ${RG.budgetText(q, spec.budget_ratio)} ${q.unit} wide`}. A range over the budget will not lock.`));
    const fields = h('div', { class: 'rfields' }, lowBox, stepwise ? null : highBox);

    function refreshStep() {
      if (stage === 'low') {
        stepNote.textContent = 'Step 1 of 2. Pick a low end you would be surprised to see the truth fall under: about 1 time in 20. Build it first, then the high end.';
      } else if (stepwise) {
        stepNote.textContent = 'Step 2 of 2. Now the high end, the same way: a number the truth should exceed only about 1 time in 20.';
      } else stepNote.textContent = '';
    }

    function check() {
      msg.textContent = ''; msg.className = 'msg'; info.textContent = '';
      if (stage === 'low') {
        const r = RG.checkInput(q, lowIn.value, lowIn.value);
        lockBtn.disabled = !r.ok;
        if (!r.ok && lowIn.value.trim()) { msg.textContent = r.error.replace('both ends', 'the low end'); msg.className = 'msg err'; }
        return;
      }
      const r = RG.checkInput(q, lowIn.value, highIn.value);
      if (!r.ok) {
        lockBtn.disabled = true;
        if (lowIn.value.trim() && highIn.value.trim()) { msg.textContent = r.error; msg.className = 'msg err'; }
        return;
      }
      info.textContent = `Width ${widthText(q, r.low, r.high)}.`;
      if (budget && !RG.withinBudget(q, r.low, r.high, spec.budget_ratio)) {
        lockBtn.disabled = true;
        msg.textContent = `Over the budget (at most ${RG.budgetText(q, spec.budget_ratio)}${q.scale === 'log' ? '' : ` ${q.unit}`}). Narrow it.`;
        msg.className = 'msg err';
        return;
      }
      lockBtn.disabled = false;
    }
    [lowIn, highIn].forEach((el) => el.addEventListener('input', check));

    const foot = h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last range. A lock is final.' : 'A lock is final.'), lockBtn);
    mount(focusFrame(header(sess, index),
      h('section', null,
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, KIND_NAMES[q.kind] || q.kind), h('span', { class: 'tag', id: 'mode-tag' }, tagFor(sess))),
        claimNode(q, { id: 'claim' })),
      h('section', { class: 'card stack', id: 'range-entry' },
        h('p', { class: 'prose-s' }, 'Give a low and a high you are 90% sure the truth sits between. Nine times in ten it should.'),
        stepNote, ...blocks, fields, info, msg),
      foot));
    refreshStep();
    check();

    const lockedAt = Date.now() + guardMs;
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < lockedAt || lockBtn.disabled) return;
      if (stage === 'low') {
        stage = 'high';
        lowIn.readOnly = true;
        lowBox.classList.add('set');
        fields.append(highBox);
        lockBtn.textContent = 'Lock in';
        refreshStep();
        check();
        highIn.focus();
        return;
      }
      const r = RG.checkInput(q, lowIn.value, highIn.value);
      if (!r.ok) return;
      lockBtn.disabled = true;
      await lock(sess, q, r.low, r.high, shownAt);
    });
  }

  async function lock(sess, q, low, high, shownAt) {
    const sc = RG.scoreRange(q, low, high, cfg);
    const ev = R.makeEvent('range', {
      session: sess.id, mode: sess.mode, unit: sess.unit, exam: sess.mode === 'exam' ? sess.exam : undefined, q: q.id, kind: q.kind, domain: q.domain,
      claim: `${q.lead} ${q.ask}`, scale: q.scale, low, high, truth: q.truth, refLow: q.ref_low, refHigh: q.ref_high,
      hit: sc.hit, width: sc.width, refWidth: sc.refW, ratio: sc.ratio, score: sc.score, points: sc.points, ms: Math.min(1800000, Date.now() - shownAt),
    });
    await store.append(ev);
    ctx.requestPersist();
    if (!ctx.alive(token)) return;
    if (sess.mode === 'exam') { await step(); return; }
    renderReveal(sess, q, ev);
  }

  function renderReveal(sess, q, ev) {
    const index = sess.ranges.length + 1;
    const hit = ev.hit;
    const gapText = hit ? null : ev.truth < ev.low ? `The truth was ${fmt(q, ev.low - ev.truth)} ${q.unit} below your low end.` : `The truth was ${fmt(q, ev.truth - ev.high)} ${q.unit} above your high end.`;
    const gapLog = hit ? null : ev.truth < ev.low ? `The truth was ${(ev.low / ev.truth).toFixed(1)} times below your low end.` : `The truth was ${(ev.truth / ev.high).toFixed(1)} times above your high end.`;
    const sourceRow = /^https?:/.test(q.source) ? h('a', { class: 'link', href: q.source, target: '_blank', rel: 'noopener noreferrer' }, `Source: ${q.src_name || 'link'} ↗`) : null;
    const flagBtn = h('button', { class: 'ghost', type: 'button', id: 'flag' }, 'Flag this question as disputed');
    flagBtn.addEventListener('click', async () => {
      flagBtn.disabled = true;
      await store.append(R.makeEvent('dispute', { q: q.id }));
      flagBtn.textContent = 'Flagged. It will not come back.';
    });
    const nextBtn = h('button', { class: 'btn', type: 'button', id: 'next' }, index >= sess.size ? 'Finish session' : 'Next range');
    const armedAt = Date.now() + guardMs;
    nextBtn.addEventListener('click', async () => { if (Date.now() < armedAt) return; nextBtn.disabled = true; await step(); });
    const widthWord = ev.ratio < 0.7 ? 'narrower than' : ev.ratio > 1.4 ? 'wider than' : 'about as wide as';
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' },
        h('div', { class: 'tags' }, h('span', { class: 'tag' }, KIND_NAMES[q.kind] || q.kind), h('span', { class: 'tag' }, tagFor(sess))),
        claimNode(q),
        numberLine(q, ev.low, ev.high, hit),
        h('div', { class: 'rl-key' },
          h('span', null, h('b', null, 'Truth'), ` ${fmt(q, q.truth)} ${q.unit}`),
          h('span', null, h('b', null, 'You'), ` ${fmt(q, ev.low)} to ${fmt(q, ev.high)}`),
          h('span', null, h('b', null, 'Reference'), ` ${fmt(q, q.ref_low)} to ${fmt(q, q.ref_high)}`)),
        h('div', { class: 'res' },
          h('span', { class: `ans${hit ? '' : ' bad'}`, id: 'verdict' }, icon(hit ? 'right' : 'wrong', 24, 1.8), hit ? 'Inside' : 'Outside'),
          h('span', { class: `pts${ev.points < 0 ? ' bad' : ''}` }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'points' }, signed(ev.points)))),
        h('p', { class: 'note', id: 'range-note' }, `${hit ? 'It held the truth.' : q.scale === 'log' ? gapLog : gapText} Your range was ${widthText(q, ev.low, ev.high)} wide, ${widthWord} the reference (${widthText(q, q.ref_low, q.ref_high)}). Score: the width plus 20 times any miss, measured against the reference width.`)),
      h('section', { class: 'card answer' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The answer'), h('span', { class: 'cap' }, q.verified === 'sourced' ? `Checked ${q.checked}` : 'From the record')),
        h('p', null, q.fact),
        q.why ? h('p', { class: 'muted' }, q.why) : null,
        sourceRow),
      h('div', { class: 'foot' }, nextBtn, flagBtn)));
  }

  const sess = await ensureSession();
  if (!sess) { ctx.replace(arg === 'exam' || arg === 'repair' ? '#/path' : '#/today'); return; }
  sessionId = sess.id;
  await step();
}

// What happened in a session of ranges.
export function rangeSummaryScreen(ctx, id) {
  const sess = RG.rsessionsOf(ctx.store.events).find((s) => s.id === id);
  if (!sess) { ctx.nav('#/today'); return document.createTextNode(''); }
  if (sess.mode === 'exam') { ctx.replace(`#/rexam/${sess.exam}`); return document.createTextNode(''); }
  const events = ctx.store.events;
  const rs = sess.ranges;
  const hits = rs.filter((r) => r.hit).length;
  const points = rs.reduce((s, r) => s + r.points, 0);
  const ratio = rs.length ? rs.reduce((s, r) => s + r.ratio, 0) / rs.length : null;
  const title = sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : 'Ranges session';
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  const guard = (e) => { if (Date.now() < armedAt) e.preventDefault(); };
  const primary = h('a', { class: 'btn', href: '#/today' }, 'Back to Today');
  const secondary = sess.mode === 'drill' && sess.repair ? h('a', { class: 'ghost', href: '#/path' }, 'Back to Path') : h('a', { class: 'ghost', href: '#/range/practice' }, 'Start another session');
  primary.addEventListener('click', guard); secondary.addEventListener('click', guard);

  const chain = sess.flag ? LE.flagsOf(events, ctx.cfg).find((c) => c.id === sess.flag) : null;
  const next = sess.mode !== 'drill' ? null
    : sess.repair ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, 'What happens next'), h('p', null, 'The repair drill is done. A new exam of fresh ranges is open on the Path whenever you are ready.'))
      : chain ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, `What happens next · ${flagName(ctx, chain.trigger)}`), h('p', null, retestText(chain, ctx.cfg))) : null;

  const rows = rs.map((r) => {
    const q = ctx.rangeById(r.q);
    const f = (x) => (q ? fmt(q, x) : String(x));
    return h('li', null,
      h('div', { class: 't' }, h('span', null, `${q ? KIND_NAMES[q.kind] || q.kind : r.kind}: ${r.claim}`), h('em', null, `You said ${f(r.low)} to ${f(r.high)} · truth ${f(r.truth)} · ${r.hit ? 'inside' : 'outside'}`)),
      h('span', { class: `m num${r.points < 0 ? ' bad' : ''}` }, signed(r.points)));
  });

  return focusFrame({ title: 'Session done', closeLabel: 'Back to Today' },
    h('section', null,
      h('div', { class: 'eyebrow' }, title),
      h('p', { class: 'claim', style: 'font-size:24px', id: 'rs-head' }, `${hits} of ${rs.length} ranges held the truth.`)),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'sum-points' }, signed(points)), h('span', { class: 'cap' }, `${rs.length} ranges`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Inside'), h('b', { class: 'num', id: 'sum-inside' }, `${hits} of ${rs.length}`), h('span', { class: 'cap' }, `a true 90% range holds about ${Math.round(0.9 * rs.length)} of ${rs.length}`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Width against reference'), h('b', { class: 'num', id: 'sum-width' }, ratio === null ? '–' : `${ratio.toFixed(1)}×`), h('span', { class: 'cap' }, '1× is the width the record says')),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Reading'), h('b', { class: 'num', style: 'font-size:20px' }, rs.length < 10 ? 'Too few' : hits >= 9 ? 'On target' : hits >= 7 ? 'A bit narrow' : 'Too narrow'), h('span', { class: 'cap' }, 'ten ranges is a hint, not a verdict'))),
    next,
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your ranges'), h('span', { class: 'cap' }, `${rs.length} ranges`)),
      h('ul', { class: 'rows', id: 'rows' }, rows)),
    h('div', { class: 'foot' }, primary, secondary));
}

// ---- the Unit 3 gate: the card on the Path, the sealed progress and the verdict --------------------------------------------
const bandText = (g) => `${g.range_pass_hits[0]} to ${g.range_pass_hits[1]}`;

export function rangeReasons(result, cfg) {
  const g = cfg.gates;
  const out = [];
  for (const r of result.reasons || []) {
    if (r === 'narrow') out.push(`Only ${result.hits} of ${result.n} ranges held the truth. A true 90% range holds about ${Math.round(0.9 * result.n)}, and the pass band is ${bandText(g)}. Your ranges were too narrow: a range that misses costs its width plus 20 times the miss.`);
    if (r === 'wide') out.push(`${result.hits} of ${result.n} ranges held the truth, over the top of the pass band (${bandText(g)}). Your ranges were wider than they needed to be${typeof result.meanRatio === 'number' ? ` (on average ${result.meanRatio.toFixed(1)} times the reference width)` : ''}. A range that always holds is giving points away.`);
  }
  return out;
}

export function rangeExamCard(ctx) {
  const st = rangeGateState(ctx);
  if (!st.open) return null;
  const { cfg } = ctx;
  const U3 = unitRow(ctx, 'U3');
  const total = st.total, size = cfg.interval.exam_session_size;
  const attempts = st.attempts.filter((a) => a.result);
  let status, body, action = null;
  if (st.passed) {
    status = 'Passed';
    body = [h('p', null, `Passed on ${st.passedAt.slice(0, 10)}: across ${total} fresh ranges, the truth fell inside your range often enough to be a real 90% range (${bandText(cfg.gates)} of ${total}).`)];
    if (st.rust) body.push(h('p', { class: 'msg err', id: 'rgate-rust' }, `Rust: ${flagName(ctx, st.rust.trigger)} came back after you passed. Clear it in your practice to keep the pass honest.`));
  } else if (st.running) {
    status = 'In progress';
    body = [h('p', null, `${st.done} of ${total} ranges done, sealed until the last one. Nothing is shown until the exam is judged.`)];
    action = h('a', { class: 'btn', href: '#/range/exam', id: 'rgate-start' }, `Next sitting: ${RG.rangeSittingSize(st, cfg)} ranges`);
  } else if (st.needsRepair) {
    const r = st.lastFailed.result;
    status = 'Repair first';
    body = [h('p', null, `Not passed this time: ${r.hits} of ${r.n} held the truth (${r.dir || 'off target'}). A repair drill of ${cfg.gates.range_repair_calls} ranges comes before a new exam.`)];
    action = h('a', { class: 'btn', href: '#/range/repair', id: 'rgate-start' }, 'Start the repair drill');
  } else if (st.eligible) {
    status = 'Ready';
    body = [h('p', null, `${total} fresh ranges in ${Math.ceil(total / size)} sittings of ${size}. No feedback until the last one, then one verdict: between ${bandText(cfg.gates)} must hold the truth. Pass it and Unit 3 is done.`)];
    action = h('a', { class: 'btn', href: '#/range/exam', id: 'rgate-start' }, attempts.length ? 'Start a new exam' : 'Start the exam');
  } else {
    const done = R.rangesOf(ctx.store.events).filter((r) => r.mode === 'practice').length;
    status = 'Not open yet';
    body = [h('p', null, `It opens after ${U3.practice_calls} practice ranges. You have made ${done} so far.`)];
  }
  return h('section', { class: 'card stack', id: 'rgate-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 3 exam'), h('span', { class: `chip${st.passed ? ' on' : ''}`, id: 'rgate-status' }, status)),
    ...body, action,
    attempts.length ? h('ul', { class: 'rows', id: 'rgate-attempts' }, attempts.map((a) => h('li', null,
      h('div', { class: 't' }, h('span', null, `${a.result.t.slice(0, 10)} · ${a.result.pass ? 'Passed' : 'Not passed'}`), h('em', null, `${a.result.hits} of ${a.result.n} held the truth`))))) : null);
}

export async function rangeExamScreen(ctx, id) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg, 'U3').find((a) => a.id === id);
  if (!attempt) { ctx.nav('#/path'); return document.createTextNode(''); }
  if (!attempt.result) await judgeRangeExam(ctx, id);
  const now = G.examsOf(ctx.store.events, ctx.cfg, 'U3').find((a) => a.id === id);
  const { cfg } = ctx;
  const total = now.total, size = cfg.interval.exam_session_size;
  if (!now.result) {
    const st = rangeGateState(ctx);
    return focusFrame({ title: 'Exam', closeTo: '#/path', closeLabel: 'Back to Path' },
      h('section', null, h('div', { class: 'eyebrow' }, 'Unit 3 exam'), h('h1', { class: 'title', id: 'rexam-title' }, 'Sealed until the last range')),
      h('section', { class: 'card stack', id: 'rexam-sealed' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Sitting ${Math.min(Math.ceil(now.calls.length / size), Math.ceil(total / size))} of ${Math.ceil(total / size)} done`), h('span', { class: 'cap num', id: 'rexam-count' }, `${now.calls.length} of ${total}`)),
        h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((now.calls.length / total) * 100)}%` })),
        h('p', null, 'Your ranges so far are saved. Whether they held the truth stays hidden until the exam is judged, so nothing you see can change how wide you go on the rest.')),
      h('div', { class: 'foot' }, h('a', { class: 'btn', href: '#/range/exam', id: 'rexam-next' }, `Next sitting: ${RG.rangeSittingSize(st, cfg)} ranges`), h('a', { class: 'ghost', href: '#/path' }, 'Back to Path')));
  }
  const r = now.result;
  const reasons = rangeReasons(r, cfg);
  const fixTo = r.pass ? '#/path' : '#/range/repair';
  return focusFrame({ title: 'Exam result', closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('div', { class: 'eyebrow' }, 'Unit 3 exam'), h('h1', { class: 'title', id: 'rexam-verdict' }, r.pass ? 'Passed' : 'Not passed this time')),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Ranges'), h('b', { class: 'num', id: 'rexam-n' }, String(r.n))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Held the truth'), h('b', { class: 'num', id: 'rexam-hits' }, `${r.hits}`), h('span', { class: 'cap' }, `pass band ${bandText(cfg.gates)}`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Coverage'), h('b', { class: 'num', id: 'rexam-cov' }, `${whole(r.hits / r.n)}%`), h('span', { class: 'cap' }, 'the target is 90%')),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Width against reference'), h('b', { class: 'num', id: 'rexam-width' }, typeof r.meanRatio === 'number' ? `${r.meanRatio.toFixed(1)}×` : '–'), h('span', { class: 'cap' }, 'average'))),
    r.pass ? h('section', { class: 'card stack' }, h('p', null, `Across ${r.n} fresh ranges, ${r.hits} held the truth. That is what a true 90% range does: it is wrong about one time in ten, no more and no less. Unit 3 is done.`))
      : h('section', { class: 'card stack', id: 'rexam-reasons' }, h('span', { class: 'eyebrow' }, 'Why not'), ...reasons.map((t) => h('p', null, t)),
        h('p', { class: 'muted' }, r.dir === 'too wide' ? `The repair drill gives you a width budget: ${cfg.gates.range_repair_calls} ranges that may not be wider than ${cfg.lessons.triggers.L06.drill.budget_ratio} times the reference.` : `The repair drill builds ${cfg.gates.range_repair_calls} ranges one end at a time.`)),
    h('p', { class: 'cap' }, 'These ranges are now part of your record: the Mirror and your lessons read them.'),
    h('div', { class: 'foot' }, h('a', { class: 'btn', href: fixTo, id: 'rexam-after' }, r.pass ? 'Back to Path' : 'Start the repair drill'), r.pass ? null : h('a', { class: 'ghost', href: '#/path' }, 'Back to Path')));
}

// A card on Today: the next session of ranges once Unit 3 is open.
export function rangesTodayCard(ctx) {
  const st = rangeGateState(ctx);
  if (!st.open) return null;
  const events = ctx.store.events;
  const active = RG.activeRSession(events);
  const done = R.rangesOf(events).filter((r) => r.mode === 'practice').length;
  const U3 = unitRow(ctx, 'U3');
  const line = active ? `Resume: ${active.ranges.length} of ${active.size} done · ${rangeModeLabel(active.mode)}` : `${ctx.cfg.interval.session_size} ranges · Unit 3 practice, ${done} of ${U3.practice_calls} so far`;
  return h('section', { class: 'card stack', id: 'ranges-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 3 · Ranges'), h('span', { class: 'cap' }, st.passed ? 'Passed' : 'Optional extra session')),
    h('p', { id: 'ranges-line' }, line),
    h('a', { class: 'ghost', href: active && active.mode === 'exam' ? '#/range/exam' : '#/range/practice', id: 'ranges-start' }, active ? 'Resume ranges' : 'Start ranges'));
}

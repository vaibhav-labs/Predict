// Units 4 and 5: Fermi problems on the break-it-down worksheet, base-rate problems, reference-class ladders and probability chains. Practice and drills reveal
// each answer at once; an exam sitting gives no feedback until the exam is judged. An answer is saved on the phone the moment it is locked. The rules are in
// engine/problem.js.
import { h, icon } from '../dom.js';
import * as R from '../engine/record.js';
import * as LE from '../engine/lessons.js';
import * as G from '../engine/gate.js';
import * as PB from '../engine/problem.js';
import * as RG from '../engine/range.js';
import { seeded, randomSeed } from '../engine/draw.js';
import { signed } from '../engine/scoring.js';
import { focusFrame, unitRow } from './common.js';
import { problemGateState, judgeProblemExam } from '../flags.js';
import { retestText, flagName } from '../flagtext.js';
import { numberLine, claimNode, fmt } from './ranges.js';
import * as UP from '../engine/update.js';
import * as KN from '../engine/know.js';

export const KIND_NAMES = { fwx: 'Rain, fortnight', fflight: 'Flight lateness', fgrow: 'Growth', fmkt: 'Stock market', doc: 'Documented rate', flight: 'Flights', weather: 'Weather', market: 'Stock market', owid: 'Countries', counter: 'Counter-argument', second: 'Second number', luck: 'Luck or judgment', act: 'Act or hold', threshold: 'Break-even', value: 'Expected value' };
const FAMILY_NAMES = { fermi: 'Fermi', rate: 'Base rate', class: 'Reference class', chain: 'Chain', update: 'Updating', counter: 'Counter-argument', second: 'Second number', luck: 'Luck or judgment', act: 'Act or hold', threshold: 'Break-even', value: 'Expected value' };
const UNIT_NAMES = { U4: 'Unit 4 · Fermi', U5: 'Unit 5 · Outside view', U6: 'Unit 6 · Updating', U7: 'Unit 7 · Second opinions', U8: 'Unit 8 · Autopsy', U9: 'Unit 9 · Decisions' };
const CHOICE_ROUTE = { U7: 'counter', U8: 'luck', U9: 'decisions' };
const CHOICE_FROM_ARG = { counter: 'U7', luck: 'U8', decisions: 'U9' };
const pctText = (x) => `${Number(x.toFixed(1))}%`;
const fmtD = (x, digits) => Number(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const PLAN_KEYS = new Set(['oly_all', 'oly_100', 'mega90', 'bts_ontime', 'bts_cancel']);

export const probModeLabel = (sess) => (sess.mode === 'exam' ? 'Exam' : sess.mode === 'drill' ? 'Drill' : sess.family === 'chain' ? 'Chain practice' : `${UNIT_NAMES[sess.unit] || ''} practice`);
const tagFor = (sess) => (sess.mode === 'exam' ? `Exam · sitting ${sess.n} of ${sess.of}` : sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : sess.family === 'chain' ? 'Chain practice' : `Unit ${String(sess.unit).slice(1)} practice`);

export async function problemScreen(ctx, root, token, arg) {
  const { store, cfg } = ctx;
  const P = cfg.problems;
  const guardMs = cfg.gym.tap_guard_ms ?? 400;
  const rng = seeded(randomSeed());
  let sessionId = null;
  const sessionNow = () => PB.psessionsOf(store.events).find((x) => x.id === sessionId);
  const mount = (view) => { root.replaceChildren(view); window.scrollTo(0, 0); };

  // The fields of the session to open when none is open, from where the player came. Returns null when there is nothing to start.
  async function newSession() {
    const events = store.events;
    const plan = (bank, size, capShare) => PB.planProblems({ bank, events, size, reseenDays: P.rate.reseen_days, rng, capShare });
    if (arg && arg.startsWith('drill-')) {
      const chain = LE.flagsOf(events, cfg).find((c) => c.id === arg.slice(6));
      const spec = chain && LE.drillOf(chain.trigger, cfg);
      if (!chain || !spec || !['chain', 'plan', 'classpick', 'domain', 'stream', 'move'].includes(spec.kind) || !['open', 'lesson'].includes(chain.state)) return null;
      const base = { mode: 'drill', size: spec.calls, flag: chain.id, trigger: chain.trigger, drill: spec };
      if (spec.kind === 'stream') return { ...base, unit: 'U6', family: 'update', plan: PB.planStreams({ bank: ctx.updateBank, events, steps: spec.calls, reseenDays: P.update.reseen_days, rng }) };
      if (spec.kind === 'move') return { ...base, unit: 'U6', family: 'update', plan: PB.planMoves({ bank: ctx.updateBank, events, steps: spec.calls, reseenDays: P.update.reseen_days, rng, minMove: P.update.drill_move_min }) };
      if (spec.kind === 'chain') return { ...base, unit: 'U4', family: 'chain', plan: plan(ctx.chainBank, spec.calls, 0.6) };
      if (spec.kind === 'classpick') return { ...base, unit: 'U5', family: 'class', plan: plan(ctx.classBank, spec.calls, 0.6) };
      if (spec.kind === 'plan') return { ...base, unit: 'U5', family: 'rate', plan: plan(ctx.rateBank.filter((q) => q.kind === 'flight' || PLAN_KEYS.has(q.key)), spec.calls, 0.8) };
      const dom = chain.evidence && chain.evidence.domain;
      const own = ctx.rateBank.filter((q) => !dom || q.jdomain === dom);
      return { ...base, unit: 'U5', family: 'rate', plan: plan(own.length >= spec.calls ? own : ctx.rateBank, spec.calls, 0.6) };
    }
    if (arg === 'repair-U4' || arg === 'repair-U5' || arg === 'repair-U6' || arg === 'repair-U7' || arg === 'repair-U8' || arg === 'repair-U9') {
      const unit = arg.slice(7);
      const st = problemGateState(ctx, unit);
      if (!st.needsRepair) return null;
      const spec = PB.problemRepairOf(unit, cfg);
      if (KN.isChoiceUnit(unit)) return { mode: 'drill', unit, family: unit === 'U7' ? 'counter' : unit === 'U8' ? 'luck' : 'act', size: spec.calls, repair: st.lastFailed.id, drill: spec, plan: PB.planProblems({ bank: ctx.knowBank(KN.examFamilies(unit, cfg)), events, size: spec.calls, reseenDays: P.choice.reseen_days, rng, capShare: 0.5 }) };
      if (unit === 'U6') return { mode: 'drill', unit, family: 'update', size: spec.calls, repair: st.lastFailed.id, drill: spec, plan: PB.planStreams({ bank: ctx.updateBank, events, steps: spec.calls, reseenDays: P.update.reseen_days, rng }) };
      return { mode: 'drill', unit, family: spec.kind, size: spec.calls, repair: st.lastFailed.id, drill: spec, plan: plan(unit === 'U4' ? ctx.fermiBank : ctx.rateBank, spec.calls, unit === 'U4' ? 0.3 : 0.6) };
    }
    if (arg === 'exam-U4' || arg === 'exam-U5' || arg === 'exam-U6' || arg === 'exam-U7' || arg === 'exam-U8' || arg === 'exam-U9') {
      const unit = arg.slice(5);
      let st = problemGateState(ctx, unit);
      let attempt = st.running;
      if (!attempt) {
        if (!st.eligible) return null;
        await store.append(R.makeEvent('exam', { state: 'start', unit, n: st.total }));
        st = problemGateState(ctx, unit);
        attempt = st.running;
      }
      const size = PB.sittingSize(st, cfg);
      const per = PB.examSitting(unit, cfg);
      const drawn = KN.isChoiceUnit(unit) ? PB.planProblemExam({ bank: ctx.knowBank(KN.examFamilies(unit, cfg), 'exam'), events: store.events, unit, size: per, total: size, rng }) : unit === 'U6' ? PB.planUpdateExam({ bank: ctx.updateExamBank, events: store.events, size: per, total: size, rng }) : PB.planProblemExam({ bank: unit === 'U4' ? ctx.fermiExamBank : ctx.rateExamBank, events: store.events, unit, size: per, total: size, rng });
      return { mode: 'exam', unit, family: KN.isChoiceUnit(unit) ? KN.examFamilies(unit, cfg)[0] : unit === 'U4' ? 'fermi' : unit === 'U6' ? 'update' : 'rate', size, exam: attempt.id, n: Math.floor(st.done / per) + 1, of: Math.ceil(st.total / per), plan: drawn.sittings[0] || [] };
    }
    if (CHOICE_FROM_ARG[arg]) {
      const unit = CHOICE_FROM_ARG[arg];
      if (!problemGateState(ctx, unit).open) return null;
      const fams = KN.practiceFamilies(unit, cfg);
      return { mode: 'practice', unit, family: fams[0], size: P.choice.session_size, plan: PB.planProblems({ bank: ctx.knowBank(fams), events, size: P.choice.session_size, reseenDays: P.choice.reseen_days, rng, capShare: fams.length > 2 ? 0.5 : 0.6 }) };
    }
    if (arg === 'update') {
      if (!problemGateState(ctx, 'U6').open) return null;
      return { mode: 'practice', unit: 'U6', family: 'update', size: P.update.session_size, plan: PB.planStreams({ bank: ctx.updateBank, events, steps: P.update.session_size, reseenDays: P.update.reseen_days, rng }) };
    }
    if (arg === 'chain') {
      if (!problemGateState(ctx, 'U4').open) return null;
      return { mode: 'practice', unit: 'U4', family: 'chain', size: P.chain.session_size, plan: plan(ctx.chainBank, P.chain.session_size, 0.6) };
    }
    if (arg === 'fermi') {
      if (!problemGateState(ctx, 'U4').open) return null;
      return { mode: 'practice', unit: 'U4', family: 'fermi', size: P.fermi.session_size, plan: plan(ctx.fermiBank, P.fermi.session_size, 0.25) };
    }
    if (arg === 'rate') {
      if (!problemGateState(ctx, 'U5').open) return null;
      return { mode: 'practice', unit: 'U5', family: 'rate', size: P.rate.session_size, plan: PB.planMix({ rateBank: ctx.rateBank, classBank: ctx.classBank, events, size: P.rate.session_size, classCount: P.rate.class_per_session, reseenDays: P.rate.reseen_days, rng }) };
    }
    return null;
  }

  async function ensureSession() {
    const open = PB.activePSession(store.events);
    if (open) return open;
    const fields = await newSession();
    if (!fields) return null;
    const ev = R.makeEvent('psession', fields);
    await store.append(ev);
    return PB.psessionsOf(store.events).find((x) => x.id === ev.id);
  }

  async function step() {
    const sess = sessionNow();
    if (sess.ended || sess.probs.length >= sess.size) { await finish(sess); return; }
    const answered = new Set(sess.probs.map((r) => r.q));
    const id = sess.plan.find((x) => !answered.has(x) && ctx.problemById(x));
    if (!id) { await finish(sess); return; }
    if (!ctx.alive(token)) return;
    const q = ctx.problemById(id);
    if (q.parts) renderFermi(sess, q); else if (q.type === 'class') renderClass(sess, q); else if (q.type === 'update') renderUpdate(sess, q); else if (q.type === 'choice') renderChoice(sess, q); else renderPercent(sess, q);
  }

  async function finish(sess) {
    if (!sess.ended) await store.append(R.makeEvent('psession_end', { session: sess.id }));
    const has = (type, f) => store.events.some((e) => e.type === type && f(e));
    if (sess.mode === 'drill' && sess.flag && !has('flag', (e) => e.state === 'drill' && e.session === sess.id)) await store.append(R.makeEvent('flag', { state: 'drill', flag: sess.flag, session: sess.id }));
    if (sess.mode === 'drill' && sess.repair && !has('exam', (e) => e.state === 'repair' && e.session === sess.id)) await store.append(R.makeEvent('exam', { state: 'repair', exam: sess.repair, session: sess.id }));
    if (sess.mode === 'exam') await judgeProblemExam(ctx, sess.exam);
    if (ctx.alive(token)) ctx.replace(sess.mode === 'exam' ? `#/pexam/${sess.exam}` : `#/psummary/${sess.id}`);
  }

  const header = (sess, index, done = index - 1) => ({
    title: sess.mode === 'drill' ? 'Drill' : sess.mode === 'exam' ? 'Exam' : FAMILY_NAMES[sess.family] || 'Problems',
    count: `${index} of ${sess.size}`,
    progress: Array.from({ length: sess.size }, (_, i) => i < done),
    closeLabel: sess.mode === 'exam' ? 'Close the sitting. Your answers so far are saved.' : 'Close session. Your answers so far are saved.',
  });
  const tags = (sess, q) => h('div', { class: 'tags' }, h('span', { class: 'tag' }, KIND_NAMES[q.kind] || q.kind), h('span', { class: 'tag', id: 'mode-tag' }, tagFor(sess)));
  const sourceRow = (q) => (/^https?:/.test(q.source) ? h('a', { class: 'link', href: q.source, target: '_blank', rel: 'noopener noreferrer' }, `Source: ${q.src_name || 'link'} ↗`) : null);
  const answerCard = (q) => h('section', { class: 'card answer' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The answer'), h('span', { class: 'cap' }, q.verified === 'sourced' ? `Checked ${q.checked}` : q.verified === 'computed' ? 'Worked out' : 'From the record')),
    h('p', null, q.fact), q.why ? h('p', { class: 'muted' }, q.why) : null, sourceRow(q));
  function revealFoot(sess, q, index) {
    const flagBtn = h('button', { class: 'ghost', type: 'button', id: 'flag' }, 'Flag this question as disputed');
    flagBtn.addEventListener('click', async () => { flagBtn.disabled = true; await store.append(R.makeEvent('dispute', { q: q.id })); flagBtn.textContent = 'Flagged. It will not come back.'; });
    const nextBtn = h('button', { class: 'btn', type: 'button', id: 'next' }, index >= sess.size ? 'Finish session' : 'Next problem');
    const armedAt = Date.now() + guardMs;
    nextBtn.addEventListener('click', async () => { if (Date.now() < armedAt) return; nextBtn.disabled = true; await step(); });
    return h('div', { class: 'foot' }, nextBtn, flagBtn);
  }
  const resultRow = (hit, points, hitText, missText) => h('div', { class: 'res' },
    h('span', { class: `ans${hit ? '' : ' bad'}`, id: 'verdict' }, icon(hit ? 'right' : 'wrong', 24, 1.8), hit ? hitText : missText),
    h('span', { class: `pts${points < 0 ? ' bad' : ''}` }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'points' }, signed(points))));

  async function lock(sess, q, fields, shownAt) {
    const ev = R.makeEvent('prob', {
      session: sess.id, mode: sess.mode, unit: sess.unit, family: q.parts ? 'fermi' : q.type === 'choice' ? q.family : q.type, exam: sess.mode === 'exam' ? sess.exam : undefined,
      q: q.id, kind: q.kind, domain: q.domain, jdomain: q.jdomain, ms: Math.min(1800000, Date.now() - shownAt), ...fields,
    });
    await store.append(ev);
    ctx.requestPersist();
    if (!ctx.alive(token)) return null;
    if (sess.mode === 'exam') { await step(); return null; }
    return ev;
  }

  // ---- Fermi: a first guess, then the worksheet --------------------------------------------------------------------------------
  function renderFermi(sess, q) {
    const index = sess.probs.length + 1;
    const shownAt = Date.now();
    let direct = null;
    const directFirst = sess.mode !== 'exam';
    const multNote = q.mult === 1 ? 'The whole is the parts multiplied together.' : q.kind === 'fflight' ? 'The whole is the parts multiplied together, then divided by 100 (the share is a percent).' : `The whole is ${fmtD(q.mult, q.mult < 1 ? 2 : 0)} times the parts multiplied together.`;

    const stageDirect = () => {
      const lowIn = h('input', { class: 'field num', id: 'direct-low', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'range-msg' });
      const highIn = h('input', { class: 'field num', id: 'direct-high', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'range-msg' });
      const msg = h('p', { class: 'msg', id: 'range-msg', role: 'status' });
      const btn = h('button', { class: 'btn', type: 'button', id: 'direct-go', disabled: true }, 'Now break it down');
      const check = () => { const r = RG.checkInput({ scale: 'log' }, lowIn.value, highIn.value); btn.disabled = !r.ok; msg.textContent = !r.ok && lowIn.value.trim() && highIn.value.trim() ? r.error : ''; msg.className = msg.textContent ? 'msg err' : 'msg'; };
      [lowIn, highIn].forEach((el) => el.addEventListener('input', check));
      const armedAt = Date.now() + guardMs;
      btn.addEventListener('click', () => { if (Date.now() < armedAt || btn.disabled) return; const r = RG.checkInput({ scale: 'log' }, lowIn.value, highIn.value); if (!r.ok) return; direct = { low: r.low, high: r.high, ms: Date.now() - shownAt }; stageSheet(); });
      mount(focusFrame(header(sess, index),
        h('section', null, tags(sess, q), claimNode(q, { id: 'claim' })),
        h('section', { class: 'card stack', id: 'direct-entry' },
          h('p', { class: 'prose-s' }, 'First, a quick guess for the whole, straight from the gut: a low and a high you are 90% sure of. Then you will break it down and see whether the worksheet agrees.'),
          h('div', { class: 'rfields' }, h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'Low'), lowIn, h('span', { class: 'cap' }, q.unit)), h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'High'), highIn, h('span', { class: 'cap' }, q.unit))), msg),
        h('div', { class: 'foot' }, h('span', { class: 'cap' }, 'This guess is only for comparison.'), btn)));
    };

    const stageSheet = () => {
      const sheetAt = Date.now();
      const rows = q.parts.map((p, i) => {
        const lowIn = h('input', { class: 'field num', id: `part-${i}-low`, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${p.label}, low` });
        const highIn = h('input', { class: 'field num', id: `part-${i}-high`, type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${p.label}, high` });
        const el = h('section', { class: 'card stack part', id: `part-${i}` }, h('div', { class: 'shead' }, h('b', null, `${i + 1}. ${p.label}`), h('span', { class: 'cap' }, p.unit)), h('p', { class: 'muted' }, p.hint),
          h('div', { class: 'rfields' }, h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'Low'), lowIn), h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'High'), highIn)));
        return { el, lowIn, highIn };
      });
      const sum = h('div', { class: 'sheetsum', id: 'sheet-sum', role: 'status' }, h('span', { class: 'cap' }, 'Fill in every part to see the whole.'));
      const msg = h('p', { class: 'msg', id: 'range-msg', role: 'status' });
      const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock', disabled: true }, 'Lock in the worksheet');
      const entries = () => rows.map((r) => ({ low: r.lowIn.value, high: r.highIn.value }));
      function check() {
        const r = PB.checkParts(q, entries());
        msg.textContent = ''; msg.className = 'msg';
        if (!r.ok) {
          lockBtn.disabled = true;
          const touched = rows.some((x) => x.lowIn.value.trim() || x.highIn.value.trim());
          sum.replaceChildren(h('span', { class: 'cap' }, 'Fill in every part to see the whole.'));
          const row = rows[r.index];
          if (touched && row.lowIn.value.trim() && row.highIn.value.trim()) { msg.textContent = `${q.parts[r.index].label}: ${r.error}`; msg.className = 'msg err'; }
          return null;
        }
        const c = PB.combineRanges(r.parts, q.mult);
        const nv = PB.naiveRange(r.parts, q.mult);
        sum.replaceChildren(h('b', { class: 'num', id: 'sheet-range' }, `${fmt(q, c.low)} to ${fmt(q, c.high)} ${q.unit}`), h('span', { class: 'cap' }, `That is the worksheet's range for the whole. Multiplying every low and every high would give ${fmt(q, nv.low)} to ${fmt(q, nv.high)}: the errors do not all land the same way.`));
        lockBtn.disabled = false;
        return r.parts;
      }
      rows.forEach((r) => [r.lowIn, r.highIn].forEach((el) => el.addEventListener('input', check)));
      const armedAt = Date.now() + guardMs;
      lockBtn.addEventListener('click', async () => {
        if (Date.now() < armedAt || lockBtn.disabled) return;
        const parts = check();
        if (!parts) return;
        lockBtn.disabled = true;
        const sc = PB.scoreFermi(q, parts, cfg, direct);
        const ev = await lock(sess, q, {
          parts: sc.parts, low: sc.low, high: sc.high, truth: q.truth, scale: 'log', refLow: q.ref_low, refHigh: q.ref_high, hit: sc.hit, width: sc.width, refWidth: sc.refW, ratio: sc.ratio, score: sc.score, points: sc.points,
          miss: sc.miss, partsHit: sc.partsHit, direct: sc.direct ? { low: sc.direct.low, high: sc.direct.high, hit: sc.direct.hit, points: sc.direct.points, miss: sc.direct.miss, ms: direct.ms } : undefined, claim: `${q.lead} ${q.ask}`,
        }, shownAt);
        if (ev) renderFermiReveal(sess, q, ev, sc);
      });
      mount(focusFrame(header(sess, index),
        h('section', null, tags(sess, q), claimNode(q, { id: 'claim' })),
        h('section', { class: 'card stack', id: 'sheet-intro' }, h('span', { class: 'eyebrow' }, 'The break-it-down worksheet'), h('p', { class: 'prose-s' }, 'Give each part a low and a high you are 90% sure of. ' + multNote)),
        ...rows.map((r) => r.el), sum, msg,
        h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last problem. A lock is final.' : 'A lock is final.'), lockBtn)));
      rows[0].lowIn.focus();
    };

    if (directFirst) stageDirect(); else stageSheet();
  }

  function renderFermiReveal(sess, q, ev, sc) {
    const index = sess.probs.length + 1;
    const hit = ev.hit;
    const partRows = q.parts.map((p, i) => {
      const e = sc.parts[i];
      return h('li', null, h('div', { class: 't' }, h('span', null, p.label), h('em', null, `You said ${fmtD(e.low, p.digits)} to ${fmtD(e.high, p.digits)} · truth ${fmtD(p.truth, p.digits)}`)),
        h('span', { class: `m num${e.hit ? '' : ' bad'}` }, e.hit ? 'inside' : 'outside'));
    });
    const d = sc.direct;
    const compare = d ? h('p', { class: 'note', id: 'direct-note' }, `Your first guess was ${fmt(q, d.low)} to ${fmt(q, d.high)} (${d.hit ? 'inside' : 'outside'}, ${signed(d.points)} points, ${d.miss.toFixed(1)} times off the middle). The worksheet's range was ${sc.hit ? 'inside' : 'outside'}, ${signed(sc.points)} points, ${sc.miss.toFixed(1)} times off the middle. ${sc.points > d.points ? 'The worksheet did better here.' : sc.points < d.points ? 'The gut guess did better here.' : 'A draw.'}`) : null;
    const widthWord = ev.ratio < 0.7 ? 'narrower than' : ev.ratio > 1.4 ? 'wider than' : 'about as wide as';
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' }, tags(sess, q), claimNode(q), numberLine(q, ev.low, ev.high, hit),
        h('div', { class: 'rl-key' }, h('span', null, h('b', null, 'Truth'), ` ${fmt(q, q.truth)} ${q.unit}`), h('span', null, h('b', null, 'Worksheet'), ` ${fmt(q, ev.low)} to ${fmt(q, ev.high)}`), h('span', null, h('b', null, 'Reference'), ` ${fmt(q, q.ref_low)} to ${fmt(q, q.ref_high)}`)),
        resultRow(hit, ev.points, 'Inside', 'Outside'),
        h('p', { class: 'note', id: 'range-note' }, `${sc.partsHit} of ${q.parts.length} parts held the truth. The worksheet's range was ${(10 ** ev.width).toFixed(1)} times from low to high, ${widthWord} the reference (${(q.ref_high / q.ref_low).toFixed(1)} times). The truth was ${ev.miss.toFixed(1)} times from its middle.`),
        compare),
      h('section', { class: 'card' }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The parts'), h('span', { class: 'cap' }, `${sc.partsHit} of ${q.parts.length} inside`)), h('ul', { class: 'rows', id: 'part-rows' }, partRows)),
      answerCard(q), revealFoot(sess, q, index)));
  }

  // ---- percent problems (base rate and chain) ------------------------------------------------------------------------------------
  function renderPercent(sess, q) {
    const index = sess.probs.length + 1;
    const shownAt = Date.now();
    const input = h('input', { class: 'field num', id: 'pct-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'pct-msg' });
    const msg = h('p', { class: 'msg', id: 'pct-msg', role: 'status' });
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock', disabled: true }, 'Lock in');
    const check = () => { const r = PB.checkPercent(input.value); lockBtn.disabled = !r.ok; msg.textContent = !r.ok && input.value.trim() ? r.error : ''; msg.className = msg.textContent ? 'msg err' : 'msg'; return r; };
    input.addEventListener('input', check);
    const armedAt = Date.now() + guardMs;
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < armedAt || lockBtn.disabled) return;
      const r = check();
      if (!r.ok) return;
      lockBtn.disabled = true;
      const sc = PB.scoreRate(q, r.value, cfg);
      const ev = await lock(sess, q, { guess: sc.guess, truth: sc.truth, miss: sc.miss, signed: sc.signed, hit: sc.hit, points: sc.points, claim: `${q.lead} ${q.ask}`, ...(q.steps ? { steps: q.steps.map((s) => s.rate) } : {}) }, shownAt);
      if (ev) renderPercentReveal(sess, q, ev);
    });
    const stepsBox = q.steps ? h('ol', { class: 'steps', id: 'chain-steps' }, q.steps.map((s, i) => h('li', null, h('span', null, s.text), h('b', { class: 'num' }, `${pctText(s.rate)}`)))) : null;
    mount(focusFrame(header(sess, index),
      h('section', null, tags(sess, q), h('p', { class: (q.lead + q.ask).length > 150 ? 'claim long' : 'claim', id: 'claim' }, h('span', { class: 'lead' }, q.lead), ' ', stepsBox ? null : h('span', { class: 'ask' }, q.ask))),
      stepsBox ? h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, 'The steps, each among the cases that passed the one before'), stepsBox, h('p', { class: 'claim long' }, h('span', { class: 'ask' }, q.ask))) : null,
      h('section', { class: 'card stack', id: 'pct-entry' },
        h('p', { class: 'prose-s' }, q.steps ? 'Type your answer as a percent from 0 to 100. Within 7 points counts.' : 'Start outside: how often does this happen to cases like this one? Type a percent from 0 to 100. Within 7 points counts.'),
        h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'Your answer'), input, h('span', { class: 'cap' }, '%')), msg),
      h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last problem. A lock is final.' : 'A lock is final.'), lockBtn)));
    input.focus();
  }

  function renderPercentReveal(sess, q, ev) {
    const index = sess.probs.length + 1;
    const dir = ev.signed > 0 ? 'above' : ev.signed < 0 ? 'below' : 'on';
    const chainNote = q.steps ? `The chain multiplies: ${q.steps.map((s) => pctText(s.rate)).join(' × ')} = ${pctText(q.truth)}. The weakest step was ${pctText(Math.min(...q.steps.map((s) => s.rate)))}; the whole is lower than any step.` : null;
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' }, tags(sess, q), h('p', { class: 'claim long' }, h('span', { class: 'lead' }, q.lead), ' ', h('span', { class: 'ask' }, q.ask)),
        h('div', { class: 'rl-key' }, h('span', null, h('b', null, 'Truth'), ` ${pctText(q.truth)}`), h('span', null, h('b', null, 'You'), ` ${pctText(ev.guess)}`), q.n ? h('span', null, h('b', null, 'Cases'), ` ${Number(q.n).toLocaleString('en-US')}`) : null),
        resultRow(ev.hit, ev.points, 'Within 7', 'Outside'),
        h('p', { class: 'note', id: 'pct-note' }, ev.signed === 0 ? 'Exactly right.' : `You were ${pctText(Math.abs(ev.signed))} points ${dir} the truth.`, chainNote ? ` ${chainNote}` : '')),
      answerCard(q), revealFoot(sess, q, index)));
  }

  // ---- Unit 6: an evidence stream, one step at a time: the rate before the news, the news, and your new number ------------------------------------
  const knownList = (q) => (q.known && q.known.length ? h('ul', { class: 'rows', id: 'known-news' }, q.known.map((t) => h('li', null, h('div', { class: 't' }, h('span', null, t), h('em', null, 'already counted in the rate below'))))) : null);
  function renderUpdate(sess, q) {
    const index = sess.probs.length + 1;
    const shownAt = Date.now();
    const input = h('input', { class: 'field num', id: 'pct-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'pct-msg' });
    const msg = h('p', { class: 'msg', id: 'pct-msg', role: 'status' });
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock', disabled: true }, 'Lock in');
    const check = () => { const r = PB.checkPercent(input.value); lockBtn.disabled = !r.ok; msg.textContent = !r.ok && input.value.trim() ? r.error : ''; msg.className = msg.textContent ? 'msg err' : 'msg'; return r; };
    input.addEventListener('input', check);
    const armedAt = Date.now() + guardMs;
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < armedAt || lockBtn.disabled) return;
      const r = check();
      if (!r.ok) return;
      lockBtn.disabled = true;
      const sc = UP.scoreUpdate(q, r.value, cfg);
      const ev = await lock(sess, q, { guess: sc.guess, truth: sc.truth, prior: sc.prior, miss: sc.miss, signed: sc.signed, hit: sc.hit, points: sc.points, gain: sc.gain, moved: sc.moved, news: q.news, claim: `${q.lead} ${q.ask}` }, shownAt);
      if (ev) renderUpdateReveal(sess, q, ev);
    });
    mount(focusFrame(header(sess, index),
      h('section', null, tags(sess, q), h('p', { class: 'claim long', id: 'claim' }, h('span', { class: 'lead' }, q.lead), ' ', h('span', { class: 'ask' }, q.ask))),
      knownList(q) ? h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, 'Counted so far'), knownList(q)) : null,
      h('section', { class: 'card stack', id: 'prior-card' }, h('span', { class: 'eyebrow' }, 'Where you stand'), h('p', { class: 'claim', style: 'font-size:28px' }, h('b', { class: 'num', id: 'prior' }, pctText(q.prior)), h('span', { class: 'cap' }, ' of cases like this one, before the news'))),
      h('section', { class: 'card stack', id: 'news-card' }, h('span', { class: 'eyebrow' }, `New information · step ${q.index + 1} of ${q.of}`), h('p', { class: 'claim long', id: 'news' }, q.news)),
      h('section', { class: 'card stack', id: 'pct-entry' },
        h('p', { class: 'prose-s' }, 'What is the chance now? Type a percent from 0 to 100. Within 7 points of the true rate counts. Some news is worth a big move and some is worth none.'),
        h('label', { class: 'rfield' }, h('span', { class: 'eyebrow' }, 'Your new number'), input, h('span', { class: 'cap' }, '%')), msg),
      h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last problem. A lock is final.' : 'A lock is final.'), lockBtn)));
    input.focus();
  }

  function renderUpdateReveal(sess, q, ev) {
    const index = sess.probs.length + 1;
    const gain = ev.gain;
    const worth = Math.abs(q.truth - q.prior);
    const pts = (x) => `${Number(Math.abs(x).toFixed(1))} points`;
    const moveWord = ev.moved === 0 ? `You stayed at ${pctText(q.prior)}` : `You moved ${pts(ev.moved)} ${ev.moved > 0 ? 'up' : 'down'}, from ${pctText(q.prior)} to ${pctText(ev.guess)}`;
    const gainText = Math.abs(gain) < 0.05 ? 'Moving and staying put would have been equally close.' : gain > 0 ? `Moving helped: you ended ${pts(gain)} closer to the truth than staying at ${pctText(q.prior)} would have.` : `Moving cost you: staying at ${pctText(q.prior)} would have been ${pts(gain)} closer.`;
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' }, tags(sess, q), h('p', { class: 'claim long' }, h('span', { class: 'lead' }, q.lead), ' ', h('span', { class: 'ask' }, q.ask)), h('p', { class: 'muted' }, q.news),
        h('div', { class: 'rl-key' }, h('span', null, h('b', null, 'Before'), ` ${pctText(q.prior)}`), h('span', null, h('b', null, 'Truth'), ` ${pctText(q.truth)}`), h('span', null, h('b', null, 'You'), ` ${pctText(ev.guess)}`), q.n ? h('span', null, h('b', null, 'Cases'), ` ${Number(q.n).toLocaleString('en-US')}`) : null),
        resultRow(ev.hit, ev.points, 'Within 7', 'Outside'),
        h('p', { class: 'note', id: 'pct-note' }, `The news was worth ${pts(worth)}. ${moveWord}; you were ${pts(ev.miss)} from the truth. `, h('span', { id: 'gain-note' }, gainText))),
      answerCard(q), revealFoot(sess, q, index)));
  }

  // ---- Units 7 to 9: a choice problem: a situation, a question and a few options, one of them right. The right one is worked out from the numbers on the item ----------
  function renderChoice(sess, q) {
    const index = sess.probs.length + 1;
    const shownAt = Date.now();
    let picked = null;
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock', disabled: true }, 'Lock in');
    const buttons = q.options.map((text, i) => {
      const b = h('button', { class: 'choice', type: 'button', id: `choice-${i}`, 'aria-pressed': 'false' }, h('span', { class: 't' }, text));
      b.addEventListener('click', () => { picked = i; buttons.forEach((x, j) => { x.setAttribute('aria-pressed', String(j === i)); x.classList.toggle('on', j === i); }); lockBtn.disabled = false; });
      return b;
    });
    const armedAt = Date.now() + guardMs;
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < armedAt || lockBtn.disabled || picked === null) return;
      lockBtn.disabled = true;
      const sc = KN.scoreChoice(q, picked, cfg);
      const ev = await lock(sess, q, { choice: sc.choice, right: sc.right, hit: sc.hit, points: sc.points, claim: q.lead }, shownAt);
      if (ev) renderChoiceReveal(sess, q, ev);
    });
    mount(focusFrame(header(sess, index),
      h('section', null, tags(sess, q), h('p', { class: q.lead.length > 150 ? 'claim long' : 'claim', id: 'claim' }, h('span', { class: 'lead' }, q.lead))),
      h('section', { class: 'card stack', id: 'choice-entry' }, h('p', { class: 'prose-s' }, q.ask), h('div', { class: 'choices', id: 'choices' }, buttons)),
      h('div', { class: 'foot' }, h('span', { class: 'cap' }, sess.mode === 'exam' ? 'Sealed: no result until the last problem. A lock is final.' : 'A lock is final.'), lockBtn)));
  }

  function renderChoiceReveal(sess, q, ev) {
    const index = sess.probs.length + 1;
    const rows = q.options.map((text, i) => h('li', { class: i === q.right ? 'right' : '' }, h('div', { class: 't' }, h('span', null, text)), h('span', { class: `m${i === ev.choice && i !== q.right ? ' bad' : ''}` }, i === q.right ? 'right' : i === ev.choice ? 'your pick' : '')));
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' }, tags(sess, q), h('p', { class: 'claim long' }, h('span', { class: 'lead' }, q.lead)), h('p', { class: 'muted' }, q.ask), resultRow(ev.hit, ev.points, 'Right', 'Another answer')),
      h('section', { class: 'card' }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The options')), h('ul', { class: 'rows', id: 'choice-rows' }, rows)),
      answerCard(q), revealFoot(sess, q, index)));
  }

  // ---- reference-class ladders -----------------------------------------------------------------------------------------------------
  function renderClass(sess, q) {
    const index = sess.probs.length + 1;
    const shownAt = Date.now();
    let picked = null;
    const lockBtn = h('button', { class: 'btn', type: 'button', id: 'lock', disabled: true }, 'Lock in');
    const buttons = q.classes.map((c, i) => {
      const b = h('button', { class: 'choice', type: 'button', id: `class-${i}`, 'aria-pressed': 'false' }, h('span', { class: 't' }, c.label), h('span', { class: 'cap num' }, `${c.n.toLocaleString('en-US')} cases`));
      b.addEventListener('click', () => { picked = i; buttons.forEach((x, j) => { x.setAttribute('aria-pressed', String(j === i)); x.classList.toggle('on', j === i); }); lockBtn.disabled = false; });
      return b;
    });
    const armedAt = Date.now() + guardMs;
    lockBtn.addEventListener('click', async () => {
      if (Date.now() < armedAt || lockBtn.disabled || picked === null) return;
      lockBtn.disabled = true;
      const sc = PB.scoreClass(q, picked, cfg);
      const ev = await lock(sess, q, { choice: sc.choice, right: sc.right, hit: sc.hit, points: sc.points, claim: `${q.lead} ${q.ask}` }, shownAt);
      if (ev) renderClassReveal(sess, q, ev);
    });
    mount(focusFrame(header(sess, index),
      h('section', null, tags(sess, q), claimNode(q, { id: 'claim' })),
      h('section', { class: 'card stack', id: 'class-entry' }, h('p', { class: 'prose-s' }, `Pick the group you would start from. The rule of thumb: the narrowest group that still holds ${P.rate.class_min_cases} or more cases.`), h('div', { class: 'choices', id: 'class-choices' }, buttons)),
      h('div', { class: 'foot' }, h('span', { class: 'cap' }, 'A lock is final.'), lockBtn)));
  }

  function renderClassReveal(sess, q, ev) {
    const index = sess.probs.length + 1;
    const rows = q.classes.map((c, i) => h('li', { class: i === q.right ? 'right' : '' }, h('div', { class: 't' }, h('span', null, c.label), h('em', null, `${c.n.toLocaleString('en-US')} cases · ${pctText(c.rate)}${c.n < P.rate.class_min_cases ? ' · too few' : ''}`)), h('span', { class: `m${i === ev.choice ? ' bad' : ''}` }, i === q.right ? 'start here' : i === ev.choice ? 'your pick' : '')));
    mount(focusFrame(header(sess, index, index),
      h('section', { class: 'card' }, tags(sess, q), claimNode(q), resultRow(ev.hit, ev.points, 'Right group', 'Another group'),
        h('p', { class: 'note', id: 'class-note' }, ev.hit ? `That is the narrowest group with ${P.rate.class_min_cases} or more cases: ${pctText(q.classes[q.right].rate)} of them.` : `The narrowest group with ${P.rate.class_min_cases} or more cases was ${q.right + 1} of ${q.classes.length}: ${pctText(q.classes[q.right].rate)}. Narrower than that, the share is mostly noise.`)),
      h('section', { class: 'card' }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'The ladder'), h('span', { class: 'cap' }, 'broad to narrow')), h('ul', { class: 'rows', id: 'class-rows' }, rows)),
      h('section', { class: 'card answer' }, h('p', { class: 'muted' }, q.why), sourceRow(q)), revealFoot(sess, q, index)));
  }

  const sess = await ensureSession();
  if (!sess) { ctx.replace(arg && (arg.startsWith('exam') || arg.startsWith('repair')) ? '#/path' : '#/today'); return; }
  sessionId = sess.id;
  await step();
}

// What happened in a session of problems.
export function problemSummaryScreen(ctx, id) {
  const sess = PB.psessionsOf(ctx.store.events).find((s) => s.id === id);
  if (!sess) { ctx.nav('#/today'); return document.createTextNode(''); }
  if (sess.mode === 'exam') { ctx.replace(`#/pexam/${sess.exam}`); return document.createTextNode(''); }
  const events = ctx.store.events;
  const ps = sess.probs;
  const hits = ps.filter((r) => r.hit).length;
  const points = ps.reduce((s, r) => s + r.points, 0);
  const title = sess.mode === 'drill' ? (sess.flag ? 'Drill' : 'Repair drill') : `${FAMILY_NAMES[sess.family] || 'Problems'} session`;
  const armedAt = Date.now() + (ctx.cfg.gym.tap_guard_ms ?? 400);
  const guard = (e) => { if (Date.now() < armedAt) e.preventDefault(); };
  const again = KN.isChoiceUnit(sess.unit) ? `#/prob/${CHOICE_ROUTE[sess.unit]}` : sess.family === 'fermi' ? '#/prob/fermi' : sess.family === 'chain' ? '#/prob/chain' : sess.family === 'update' ? '#/prob/update' : '#/prob/rate';
  const primary = h('a', { class: 'btn', href: '#/today' }, 'Back to Today');
  const secondary = sess.mode === 'drill' ? h('a', { class: 'ghost', href: sess.repair ? '#/path' : '#/today' }, sess.repair ? 'Back to Path' : 'Back to Today') : h('a', { class: 'ghost', href: again }, 'Start another session');
  primary.addEventListener('click', guard); secondary.addEventListener('click', guard);
  const chain = sess.flag ? LE.flagsOf(events, ctx.cfg).find((c) => c.id === sess.flag) : null;
  const next = sess.mode !== 'drill' ? null
    : sess.repair ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, 'What happens next'), h('p', null, 'The repair drill is done. A new exam of fresh problems is open on the Path whenever you are ready.'))
      : chain ? h('section', { class: 'card stack', id: 'drill-next' }, h('span', { class: 'eyebrow' }, `What happens next · ${flagName(ctx, chain.trigger)}`), h('p', null, retestText(chain, ctx.cfg))) : null;
  const rows = ps.map((r) => {
    const q = ctx.problemById(r.q);
    const what = r.family === 'update' ? `You said ${pctText(r.guess)} · before ${pctText(r.prior)} · truth ${pctText(r.truth)}` : r.family === 'fermi' ? `${q ? fmt(q, r.low) : r.low} to ${q ? fmt(q, r.high) : r.high} · truth ${q ? fmt(q, r.truth) : r.truth}` : r.family === 'class' ? (r.hit ? 'the right group' : 'another group') : KN.isChoiceUnit(r.unit) ? (r.hit ? 'the right answer' : 'another answer') : `You said ${pctText(r.guess)} · truth ${pctText(r.truth)}`;
    return h('li', null, h('div', { class: 't' }, h('span', null, `${KIND_NAMES[r.kind] || r.kind}: ${r.family === 'update' && r.news ? r.news : r.claim}`), h('em', null, `${what} · ${r.hit ? (r.family === 'fermi' ? 'inside' : 'good') : (r.family === 'fermi' ? 'outside' : 'off')}`)),
      h('span', { class: `m num${r.points < 0 ? ' bad' : ''}` }, signed(r.points)));
  });
  const word = KN.isChoiceUnit(sess.unit) ? 'were right' : sess.family === 'fermi' ? 'held the truth' : sess.family === 'class' ? 'picked the right group' : 'were within 7 points';
  return focusFrame({ title: 'Session done', closeLabel: 'Back to Today' },
    h('section', null, h('div', { class: 'eyebrow' }, title), h('p', { class: 'claim', style: 'font-size:24px', id: 'ps-head' }, `${hits} of ${ps.length} ${word}.`)),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Points'), h('b', { class: 'num', id: 'sum-points' }, signed(points)), h('span', { class: 'cap' }, `${ps.length} problems`)),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, sess.family === 'fermi' ? 'Inside' : 'Good'), h('b', { class: 'num', id: 'sum-hits' }, `${hits} of ${ps.length}`), h('span', { class: 'cap' }, sess.family === 'fermi' ? 'a true 90% range holds about 9 in 10' : KN.isChoiceUnit(sess.unit) ? 'the right option' : 'within 7 points, or the right group'))),
    next,
    h('section', { class: 'card' }, h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your answers'), h('span', { class: 'cap' }, `${ps.length} problems`)), h('ul', { class: 'rows', id: 'rows' }, rows)),
    h('div', { class: 'foot' }, primary, secondary));
}

// ---- the Unit 4 and 5 gates: the card on the Path, the sealed progress and the verdict --------------------------------------------------
export function problemReasons(unit, result, cfg) {
  const g = cfg.gates;
  const out = [];
  for (const r of result.reasons || []) {
    if (unit === 'U4' && r === 'hits') out.push(`Only ${result.hits} of ${result.n} worksheet ranges held the truth; ${g.fermi_pass_hits} are needed. A true 90% range holds about ${Math.round(0.9 * result.n)}. Your ranges were too narrow.`);
    if (unit === 'U4' && r === 'factor') out.push(`The median miss was a factor of ${Number(result.medianMiss).toFixed(1)}; the pass line is a factor of ${g.fermi_median_factor}. The middle of your ranges sat too far from the truth: check which part is carrying the error.`);
    if (unit === 'U5' && r === 'within') out.push(`${result.hits} of ${result.n} answers were within ${cfg.problems.rate.tolerance} points; ${g.rate_pass_within} are needed. Your answers ran ${result.dir === 'too high' ? 'high' : 'low'} on average (${Number(result.bias).toFixed(1)} points). Start from how often it happens to cases like it, then adjust.`);
    if (unit === 'U6' && r === 'within') out.push(`${result.hits} of ${result.n} new numbers were within ${cfg.problems.update.tolerance} points of the true rate; ${g.update_pass_within} are needed. Your numbers ran ${result.dir === 'too high' ? 'high' : 'low'} on average (${Number(result.bias).toFixed(1)} points).`);
    if (KN.isChoiceUnit(unit) && r === 'right') out.push(`${result.hits} of ${result.n} answers were right; ${result.need} are needed. ${unit === 'U7' ? 'Look for the argument that is specific, bears on the claim and is not already in your forecast.' : unit === 'U8' ? 'Judge the decision by what the person knew and how they reasoned, not by how it turned out.' : 'Work out the break-even first: the loss over the total at stake.'}`);
    if (unit === 'U8' && r === 'memory') out.push(`Your memory of your own forecasts drifted ${Math.abs(Number(result.memoryDrift) * 100).toFixed(1)} points ${Number(result.memoryDrift) > 0 ? 'toward what happened' : 'away from what happened'} on average; the gate allows ${cfg.gates.memory_drift_max * 100} points either way. The record is the record: write the number before you look, and check it afterwards.`);
    if (unit === 'U6' && r === 'gain') out.push(`On average your moves ended ${Math.abs(Number(result.meanGain)).toFixed(1)} points further from the truth than staying at the prior would have. News is worth a move only as far as the group's own record goes: look at how much narrowing the case changes the share, not how vivid the detail is.`);
  }
  return out;
}

const memoryDone = (ctx) => KN.memoryObs(ctx.store.events, R.predictionsOf(ctx.store.events, R.localDay())).length;

export function problemExamCard(ctx, unit) {
  const st = problemGateState(ctx, unit);
  if (!st.open) return null;
  const { cfg } = ctx;
  const size = PB.examSitting(unit, cfg);
  const U = unitRow(ctx, unit);
  const attempts = st.attempts.filter((a) => a.result);
  const noun = unit === 'U4' ? 'Fermi problems' : unit === 'U6' ? 'update steps' : unit === 'U7' ? 'counter-argument problems' : unit === 'U8' ? 'luck-or-judgment cases' : unit === 'U9' ? 'decision problems' : 'base-rate problems';
  const rule = KN.isChoiceUnit(unit) ? `${cfg.gates[`${KN.CHOICE_UNITS[unit]}_pass_right`]} of ${st.total} must be right${unit === 'U8' ? `, and your memory of your own forecasts must be within ${cfg.gates.memory_drift_max * 100} points over the last ${cfg.gates.memory_window} checks` : ''}` : unit === 'U4' ? `${cfg.gates.fermi_pass_hits} of ${st.total} worksheet ranges must hold the truth, and the median miss must be within a factor of ${cfg.gates.fermi_median_factor}` : unit === 'U6' ? `${cfg.gates.update_pass_within} of ${st.total} new numbers must be within ${cfg.problems.update.tolerance} points, and on average your moves must not lose ground against staying at the prior` : `${cfg.gates.rate_pass_within} of ${st.total} answers must be within ${cfg.problems.rate.tolerance} points`;
  let status, body, action = null;
  if (st.passed) {
    status = 'Passed';
    body = [h('p', null, `Passed on ${st.passedAt.slice(0, 10)}: across ${st.total} fresh ${noun}, ${rule}.`)];
    if (st.rust) body.push(h('p', { class: 'msg err', id: `pgate-${unit}-rust` }, `Rust: ${flagName(ctx, st.rust.trigger)} came back after you passed. Clear it in your practice to keep the pass honest.`));
  } else if (st.running) {
    status = 'In progress';
    body = [h('p', null, `${st.done} of ${st.total} problems done, sealed until the last one. Nothing is shown until the exam is judged.`)];
    action = h('a', { class: 'btn', href: `#/prob/exam-${unit}`, id: `pgate-${unit}-start` }, `Next sitting: ${PB.sittingSize(st, cfg)} problems`);
  } else if (st.needsRepair) {
    const r = st.lastFailed.result;
    status = 'Repair first';
    body = [h('p', null, `Not passed this time: ${r.hits} of ${r.n} (${r.dir || 'off target'}). A repair drill of ${PB.problemRepairOf(unit, cfg).calls} problems comes before a new exam.`)];
    action = h('a', { class: 'btn', href: `#/prob/repair-${unit}`, id: `pgate-${unit}-start` }, 'Start the repair drill');
  } else if (st.eligible) {
    status = 'Ready';
    body = [h('p', null, `${st.total} fresh ${noun} in ${Math.ceil(st.total / size)} sittings of ${size}. No feedback until the last one, then one verdict: ${rule}.`)];
    action = h('a', { class: 'btn', href: `#/prob/exam-${unit}`, id: `pgate-${unit}-start` }, attempts.length ? 'Start a new exam' : 'Start the exam');
  } else {
    status = 'Not open yet';
    body = [h('p', null, `It opens after ${U.practice_calls} practice ${unit === 'U4' ? 'Fermi problems' : unit === 'U6' ? 'update steps' : 'problems'}${unit === 'U8' ? ` and ${cfg.gates.memory_min_checks} memory checks` : ''}. You have done ${st.practice}${unit === 'U8' ? ` and ${memoryDone(ctx)}` : ''} so far.`)];
  }
  return h('section', { class: 'card stack', id: `pgate-${unit}-card` },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Unit ${unit.slice(1)} exam`), h('span', { class: `chip${st.passed ? ' on' : ''}`, id: `pgate-${unit}-status` }, status)),
    ...body, action,
    attempts.length ? h('ul', { class: 'rows', id: `pgate-${unit}-attempts` }, attempts.map((a) => h('li', null, h('div', { class: 't' }, h('span', null, `${a.result.t.slice(0, 10)} · ${a.result.pass ? 'Passed' : 'Not passed'}`), h('em', null, `${a.result.hits} of ${a.result.n}`))))) : null);
}

export async function problemExamScreen(ctx, id) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === id && ['U4', 'U5', 'U6', 'U7', 'U8', 'U9'].includes(a.unit));
  if (!attempt) { ctx.nav('#/path'); return document.createTextNode(''); }
  const unit = attempt.unit;
  if (!attempt.result) await judgeProblemExam(ctx, id);
  const now = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === id);
  const { cfg } = ctx;
  const total = now.total, size = PB.examSitting(unit, cfg);
  if (!now.result) {
    const st = problemGateState(ctx, unit);
    return focusFrame({ title: 'Exam', closeTo: '#/path', closeLabel: 'Back to Path' },
      h('section', null, h('div', { class: 'eyebrow' }, `Unit ${unit.slice(1)} exam`), h('h1', { class: 'title', id: 'pexam-title' }, 'Sealed until the last problem')),
      h('section', { class: 'card stack', id: 'pexam-sealed' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Sitting ${Math.min(Math.ceil(now.calls.length / size), Math.ceil(total / size))} of ${Math.ceil(total / size)} done`), h('span', { class: 'cap num', id: 'pexam-count' }, `${now.calls.length} of ${total}`)),
        h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((now.calls.length / total) * 100)}%` })),
        h('p', null, 'Your answers so far are saved. Whether they were close stays hidden until the exam is judged, so nothing you see can change how you answer the rest.')),
      h('div', { class: 'foot' }, h('a', { class: 'btn', href: `#/prob/exam-${unit}`, id: 'pexam-next' }, `Next sitting: ${PB.sittingSize(st, cfg)} problems`), h('a', { class: 'ghost', href: '#/path' }, 'Back to Path')));
  }
  const r = now.result;
  const reasons = problemReasons(unit, r, cfg);
  const fixTo = r.pass ? '#/path' : `#/prob/repair-${unit}`;
  const stat3 = unit === 'U8'
    ? h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Memory drift'), h('b', { class: 'num', id: 'pexam-miss' }, typeof r.memoryDrift === 'number' ? `${r.memoryDrift >= 0 ? '+' : ''}${(r.memoryDrift * 100).toFixed(1)} pts` : '–'), h('span', { class: 'cap' }, `pass line within ${cfg.gates.memory_drift_max * 100} either way`))
    : KN.isChoiceUnit(unit) ? h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Right'), h('b', { class: 'num', id: 'pexam-miss' }, `${Math.round((r.hits / r.n) * 100)}%`), h('span', { class: 'cap' }, `${r.hits} of ${r.n}`))
    : unit === 'U4'
    ? h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Median miss'), h('b', { class: 'num', id: 'pexam-miss' }, typeof r.medianMiss === 'number' ? `${r.medianMiss.toFixed(1)}×` : '–'), h('span', { class: 'cap' }, `pass line ${cfg.gates.fermi_median_factor}×`))
    : unit === 'U6' ? h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average gain'), h('b', { class: 'num', id: 'pexam-miss' }, typeof r.meanGain === 'number' ? `${r.meanGain >= 0 ? '+' : ''}${r.meanGain.toFixed(1)} pts` : '–'), h('span', { class: 'cap' }, `pass line ${cfg.gates.update_gain_min} or more`))
    : h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average miss'), h('b', { class: 'num', id: 'pexam-miss' }, typeof r.meanMiss === 'number' ? `${r.meanMiss.toFixed(1)} pts` : '–'), h('span', { class: 'cap' }, 'percentage points'));
  return focusFrame({ title: 'Exam result', closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('div', { class: 'eyebrow' }, `Unit ${unit.slice(1)} exam`), h('h1', { class: 'title', id: 'pexam-verdict' }, r.pass ? 'Passed' : 'Not passed this time')),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Problems'), h('b', { class: 'num', id: 'pexam-n' }, String(r.n))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, KN.isChoiceUnit(unit) ? 'Right' : unit === 'U4' ? 'Held the truth' : 'Within 7'), h('b', { class: 'num', id: 'pexam-hits' }, `${r.hits}`), h('span', { class: 'cap' }, `pass line ${KN.isChoiceUnit(unit) ? cfg.gates[`${KN.CHOICE_UNITS[unit]}_pass_right`] : unit === 'U4' ? cfg.gates.fermi_pass_hits : unit === 'U6' ? cfg.gates.update_pass_within : cfg.gates.rate_pass_within}`)),
      stat3),
    r.pass ? h('section', { class: 'card stack' }, h('p', null, unit === 'U7' ? `Across ${r.n} fresh problems you picked the strongest counter-argument ${r.hits} times. You can argue against yourself. Unit 7 is done, and Unit 8 is open.` : unit === 'U8' ? `${r.hits} of ${r.n} cases called right, and your memory of your own forecasts stayed within ${cfg.gates.memory_drift_max * 100} points. You keep the record honest. Unit 8 is done, and Unit 9 is open.` : unit === 'U9' ? `${r.hits} of ${r.n} decision problems right. You can turn a forecast into a choice. Unit 9 is done.` : unit === 'U4' ? `Across ${r.n} fresh problems, ${r.hits} worksheet ranges held the truth. Breaking it down works for you. Unit 4 is done, and Unit 5 is open.` : (unit === 'U6' ? `Across ${r.n} fresh steps, ${r.hits} new numbers were within ${cfg.problems.update.tolerance} points and your moves gained ${Number(r.meanGain).toFixed(1)} points on average over staying put. You move as far as the evidence is worth. Unit 6 is done.` : `Across ${r.n} fresh problems, ${r.hits} answers were within ${cfg.problems.rate.tolerance} points. You start outside. Unit 5 is done.`)))
      : h('section', { class: 'card stack', id: 'pexam-reasons' }, h('span', { class: 'eyebrow' }, 'Why not'), ...reasons.map((t) => h('p', null, t)), h('p', { class: 'muted' }, `The repair drill is ${PB.problemRepairOf(unit, cfg).calls} problems of the same kind.`)),
    h('p', { class: 'cap' }, 'These answers are now part of your record: the Mirror reads them.'),
    h('div', { class: 'foot' }, h('a', { class: 'btn', href: fixTo, id: 'pexam-after' }, r.pass ? 'Back to Path' : 'Start the repair drill'), r.pass ? null : h('a', { class: 'ghost', href: '#/path' }, 'Back to Path')));
}

// Cards on Today: the next session for each open unit.
export function problemsTodayCards(ctx) {
  const events = ctx.store.events;
  const active = PB.activePSession(events);
  const cards = [];
  for (const unit of ['U4', 'U5', 'U6', 'U7', 'U8', 'U9']) {
    const st = problemGateState(ctx, unit);
    if (!st.open) continue;
    const route = KN.isChoiceUnit(unit) ? `#/prob/${CHOICE_ROUTE[unit]}` : unit === 'U4' ? '#/prob/fermi' : unit === 'U6' ? '#/prob/update' : '#/prob/rate';
    const resume = active && active.unit === unit;
    const U = unitRow(ctx, unit);
    const line = resume ? `Resume: ${active.probs.length} of ${active.size} done · ${probModeLabel(active)}` : KN.isChoiceUnit(unit) ? `${ctx.cfg.problems.choice.session_size} ${unit === 'U7' ? 'counter-argument' : unit === 'U8' ? 'luck-or-judgment' : 'decision'} problems · practice ${st.practice} of ${U.practice_calls} so far` : unit === 'U4' ? `${ctx.cfg.problems.fermi.session_size} Fermi problems · practice ${st.practice} of ${U.practice_calls} so far` : unit === 'U6' ? `${ctx.cfg.problems.update.session_size} update steps · practice ${st.practice} of ${U.practice_calls} so far` : `${ctx.cfg.problems.rate.session_size} base-rate problems · practice ${st.practice} of ${U.practice_calls} so far`;
    cards.push(h('section', { class: 'card stack', id: `${unit.toLowerCase()}-card` },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, UNIT_NAMES[unit]), h('span', { class: 'cap' }, st.passed ? 'Passed' : 'Optional extra session')),
      h('p', { id: `${unit.toLowerCase()}-line` }, line),
      h('a', { class: 'ghost', href: resume && active.mode === 'exam' ? `#/prob/exam-${unit}` : route, id: `${unit.toLowerCase()}-start` }, resume ? 'Resume' : KN.isChoiceUnit(unit) ? (unit === 'U7' ? 'Start second opinions' : unit === 'U8' ? 'Start luck or judgment' : 'Start decisions') : unit === 'U4' ? 'Start Fermi problems' : unit === 'U6' ? 'Start updating' : 'Start base rates')));
  }
  return cards;
}

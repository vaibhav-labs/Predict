// The Unit 1 gate: 200 fresh calls in sittings of 20, sealed until the last call, judged once. The card on the Path says where the
// player stands; the exam screen is the sealed progress while it runs and the verdict once it is judged.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as G from '../engine/gate.js';
import { pct } from '../engine/scoring.js';
import { focusFrame, unitRow } from './common.js';
import { gateState, judgeExam } from '../flags.js';
import { flagName } from '../flagtext.js';

const pts = (x) => `${Math.round(Math.abs(x) * 100)}`;
const bandName = (lo, hi) => `${Math.round(lo * 100)} to ${Math.round(hi * 100)}%`;

// Why an exam failed, in plain words, from the verdict stored with it.
export function reasonsText(result, cfg) {
  const out = [];
  for (const r of result.reasons || []) {
    if (r === 'index') out.push(`Your average confidence (${pct(result.meanConf)}) and your hit rate (${pct(result.hitRate)}) were ${pts(result.index)} points apart. The limit is ${pts(cfg.gates.calibration_index_tolerance)}.`);
    else if (r.startsWith('band:')) {
      const b = (result.bands || []).find((x) => String(x.lo) === r.slice(5));
      if (b) out.push(`Calls stated at ${bandName(b.lo, b.hi)}: you said ${pct(b.meanConf)} and were right ${pct(b.hitRate)} (${b.n} calls), ${b.z.toFixed(1)} standard errors off. The limit is ${cfg.gates.band_z_max}.`);
    }
  }
  return out;
}

// The gate's card on the Path.
export function examCard(ctx) {
  const st = gateState(ctx);
  const { cfg } = ctx;
  const total = st.total, size = cfg.gym.exam_session_size;
  const U1 = unitRow(ctx, 'U1');
  const attempts = st.attempts.filter((a) => a.result);
  let status, body, action = null;
  if (st.passed) {
    status = 'Passed';
    body = [h('p', null, `Passed on ${st.passedAt.slice(0, 10)}: across ${total} fresh calls your average confidence was within ${pts(cfg.gates.calibration_index_tolerance)} points of your hit rate, and no band was off.`)];
    if (st.rust) body.push(h('p', { class: 'msg err', id: 'gate-rust' }, `Rust: ${flagName(ctx, st.rust.trigger)} came back after you passed. Clear it in your practice to keep the pass honest.`));
  } else if (st.running) {
    status = 'In progress';
    body = [h('p', null, `${st.done} of ${total} calls done, sealed until the last one. Nothing is shown until the exam is judged.`)];
    action = h('a', { class: 'btn', href: '#/gym/exam', id: 'gate-start' }, `Next sitting: ${G.examSittingSize(st, cfg.gym)} calls`);
  } else if (st.needsRepair) {
    const last = st.lastFailed.result;
    status = 'Repair first';
    body = [h('p', null, `Not passed this time. The worst band was ${last.worst ? `${bandName(last.worst.lo, last.worst.hi)}, ${last.worst.dir}` : 'none in particular'}. A repair drill of ${cfg.gates.repair_drill_calls} calls comes before a new exam.`)];
    action = h('a', { class: 'btn', href: '#/gym/repair', id: 'gate-start' }, 'Start the repair drill');
  } else if (st.eligible) {
    status = 'Ready';
    body = [h('p', null, `${total} fresh calls in ${Math.ceil(total / size)} sittings of ${size}. No feedback until the last call, then one verdict. Pass it and Unit 1 is done.`)];
    action = h('a', { class: 'btn', href: '#/gym/exam', id: 'gate-start' }, attempts.length ? 'Start a new exam' : 'Start the exam');
  } else {
    const practice = R.callsOf(ctx.store.events).filter((c) => c.mode === 'practice').length;
    const base = R.baselineProgress(ctx.store.events, Number(unitRow(ctx, 'U0').practice_calls));
    status = 'Not open yet';
    body = [h('p', null, base.complete
      ? `It opens after ${U1.practice_calls} practice calls. You have made ${practice} so far.`
      : `It opens after the ${base.total}-call baseline and ${U1.practice_calls} practice calls.`)];
  }
  return h('section', { class: 'card stack', id: 'gate-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Unit 1 exam'), h('span', { class: `chip${st.passed ? ' on' : ''}`, id: 'gate-status' }, status)),
    ...body,
    action,
    attempts.length
      ? h('ul', { class: 'rows', id: 'gate-attempts' }, attempts.map((a) => h('li', null,
        h('div', { class: 't' }, h('span', null, `${a.result.t.slice(0, 10)} · ${a.result.pass ? 'Passed' : 'Not passed'}`), h('em', null, `Average confidence ${pct(a.result.meanConf)}, right ${pct(a.result.hitRate)}, ${a.result.n} calls`)))))
      : null);
}

export async function examScreen(ctx, id) {
  const attempt = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === id);
  if (!attempt) { ctx.nav('#/path'); return document.createTextNode(''); }
  if (!attempt.result) await judgeExam(ctx, id);
  const now = G.examsOf(ctx.store.events, ctx.cfg).find((a) => a.id === id);
  const { cfg } = ctx;
  const total = now.total, size = cfg.gym.exam_session_size;
  if (!now.result) {
    const st = gateState(ctx);
    return focusFrame({ title: 'Exam', closeTo: '#/path', closeLabel: 'Back to Path' },
      h('section', null, h('div', { class: 'eyebrow' }, 'Unit 1 exam'), h('h1', { class: 'title', id: 'exam-title' }, 'Sealed until the last call')),
      h('section', { class: 'card stack', id: 'exam-sealed' },
        h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, `Sitting ${Math.min(Math.ceil(now.calls.length / size), Math.ceil(total / size))} of ${Math.ceil(total / size)} done`), h('span', { class: 'cap num', id: 'exam-count' }, `${now.calls.length} of ${total}`)),
        h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((now.calls.length / total) * 100)}%` })),
        h('p', null, 'Your calls so far are saved. Their results stay hidden until the exam is judged, so nothing you see can change how you answer the rest.')),
      h('div', { class: 'foot' }, h('a', { class: 'btn', href: '#/gym/exam', id: 'exam-next' }, `Next sitting: ${G.examSittingSize(st, cfg.gym)} calls`), h('a', { class: 'ghost', href: '#/path' }, 'Back to Path')));
  }
  const r = now.result;
  const reasons = reasonsText(r, cfg);
  const fixTo = r.pass ? '#/path' : '#/gym/repair';
  return focusFrame({ title: 'Exam result', closeTo: '#/path', closeLabel: 'Back to Path' },
    h('section', null, h('div', { class: 'eyebrow' }, 'Unit 1 exam'), h('h1', { class: 'title', id: 'exam-verdict' }, r.pass ? 'Passed' : 'Not passed this time')),
    h('section', { class: 'sumgrid' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Calls'), h('b', { class: 'num', id: 'exam-n' }, String(r.n))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Average confidence'), h('b', { class: 'num', id: 'exam-conf' }, pct(r.meanConf))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Hit rate'), h('b', { class: 'num', id: 'exam-hit' }, pct(r.hitRate))),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Gap'), h('b', { class: 'num', id: 'exam-gap' }, `${pts(r.index) === '0' ? '' : r.index > 0 ? '+' : '−'}${pts(r.index)}`), h('span', { class: 'cap' }, `limit ${pts(cfg.gates.calibration_index_tolerance)}`))),
    r.pass ? h('section', { class: 'card stack' }, h('p', null, `Across ${r.n} fresh calls you said what you meant: your average confidence was within ${pts(cfg.gates.calibration_index_tolerance)} points of your hit rate, and no band with ${cfg.gates.band_min_items} calls or more was further than ${cfg.gates.band_z_max} standard errors off. Unit 1 is done.`))
      : h('section', { class: 'card stack', id: 'exam-reasons' }, h('span', { class: 'eyebrow' }, 'Why not'), ...reasons.map((t) => h('p', null, t)),
        r.worst ? h('p', { class: 'muted' }, `The repair drill works on the ${bandName(r.worst.lo, r.worst.hi)} band, where you were ${r.worst.dir}.`) : null),
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'By band'), h('span', { class: 'cap' }, `a band needs ${cfg.gates.band_min_items} calls to be judged`)),
      h('table', { class: 'tbl', id: 'exam-bands' },
        h('thead', null, h('tr', null, ['Band', 'Calls', 'Said', 'Right', 'Off by'].map((t) => h('th', null, t)))),
        h('tbody', null, r.bands.filter((b) => b.n > 0).map((b) => h('tr', { class: b.off ? 'mine' : '' },
          h('td', null, bandName(b.lo, b.hi)), h('td', null, String(b.n)), h('td', null, pct(b.meanConf)), h('td', null, pct(b.hitRate)),
          h('td', { class: b.off ? 'bad' : '' }, b.checked ? `${b.z.toFixed(1)} SE${b.off ? ' (off)' : ''}` : 'not judged')))))),
    h('p', { class: 'cap' }, 'These calls are now part of your record: the Mirror and your lessons read them.'),
    h('div', { class: 'foot' }, h('a', { class: 'btn', href: fixTo, id: 'exam-after' }, r.pass ? 'Back to Path' : 'Start the repair drill'), r.pass ? null : h('a', { class: 'ghost', href: '#/path' }, 'Back to Path')));
}

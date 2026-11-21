// The confidence dial. A slider from -10 (99% No) through 0 (50%, a toss-up) to +10 (99% Yes). The eleven
// confidence steps come from the scoring table, and the points shown are the table's own numbers, live.
import { h, s } from '../dom.js';
import { signed, pct } from '../engine/scoring.js';

const CIRC = 2 * Math.PI * 34;

// `opts.allowed` (a list of confidences) locks the steps outside it, as a drill does: the dial still moves everywhere, but a
// locked step shows `opts.hint` and `ok()` says no, so the Lock button can wait. `opts.onChange(ok)` is called after every move.
export function makeDial(S, opts = {}) {
  const steps = opts.steps || S.steps;
  const fine = steps.length > 20;
  const allowed = opts.allowed ? new Set(opts.allowed.map((c) => Math.round(c * 100))) : null;
  const okAt = (kk) => !allowed || allowed.has(Math.round(steps[Math.abs(kk)] * 100));
  const hint = h('p', { class: 'msg err', id: 'dial-hint', hidden: true });
  const maxK = steps.length - 1;
  let k = 0, lastSign = 1;

  const readout = h('div', { class: 'big', 'aria-hidden': 'true' });
  const input = h('input', { class: 'range', type: 'range', min: -maxK, max: maxK, step: 1, value: 0, id: 'dial', 'aria-label': `Confidence: ${pct(steps[maxK])} No on the left, ${pct(steps[maxK])} Yes on the right` });
  const fill = h('i', { class: 'fill' });
  const right = h('b', { class: 'num' });
  const wrong = h('b', { class: 'num' });
  const wheelFill = s('circle', { class: 'w1', cx: 44, cy: 44, r: 34, transform: 'rotate(-90 44 44)' });
  const wheelNum = s('text', { class: 'wn', x: 44, y: 53, 'text-anchor': 'middle' });
  const wheelText = h('p', { class: 'wtxt' });

  const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' });
  const tickKs = fine ? [-maxK, -40, -30, -20, -10, 0, 10, 20, 30, 40, maxK] : Array.from({ length: maxK + 1 }, (_, i) => -maxK + 2 * i).filter((t) => t <= maxK);
  for (const t of tickKs) {
    ticks.append(h('span', { class: t === 0 ? 'mid' : '', style: `left:${((t + maxK) / (2 * maxK)) * 100}%` }, String(Math.round(steps[Math.abs(t)] * 100))));
  }

  function value() {
    const side = k > 0 ? 'yes' : k < 0 ? 'no' : lastSign > 0 ? 'yes' : 'no';
    return { side, c: steps[Math.abs(k)], k };
  }
  function paint() {
    const c = steps[Math.abs(k)];
    const name = k > 0 ? 'Yes' : k < 0 ? 'No' : 'Toss-up';
    readout.textContent = `${name} · ${pct(c)}`;
    input.setAttribute('aria-valuetext', readout.textContent);
    const left = k >= 0 ? 50 : ((k + maxK) / (2 * maxK)) * 100;
    fill.style.left = `${left}%`;
    fill.style.width = `${(Math.abs(k) / (2 * maxK)) * 100}%`;
    const hit = S.hit(c, opts.rule), miss = S.miss(c, opts.rule);
    right.textContent = signed(hit);
    wrong.textContent = signed(miss);
    wrong.className = `num${miss < 0 ? ' bad' : ''}`;
    wheelFill.setAttribute('stroke-dasharray', `${(c * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`);
    wheelNum.textContent = String(Math.round(c * 100));
    wheelText.replaceChildren(h('b', null, `A wheel that wins ${Math.round(c * 100)} spins in 100.`), ' Would you rather bet on your answer, or on the wheel?');
    hint.hidden = okAt(k);
    hint.textContent = okAt(k) ? '' : (opts.hint || 'That step is locked in this drill.');
    if (opts.onChange) opts.onChange(okAt(k));
  }
  input.addEventListener('input', () => {
    k = Number(input.value);
    if (k !== 0) lastSign = Math.sign(k);
    paint();
  });
  paint();
  const nudge = (d) => { const nk = Math.max(-maxK, Math.min(maxK, k + d)); input.value = String(nk); input.dispatchEvent(new Event('input')); };
  const nudgeRow = fine ? h('div', { class: 'nudge', id: 'nudge' },
    h('button', { class: 'ghost', type: 'button', id: 'dial-down', 'aria-label': 'One percent less Yes' }, '−1'),
    h('button', { class: 'ghost', type: 'button', id: 'dial-up', 'aria-label': 'One percent more Yes' }, '+1')) : null;
  if (nudgeRow) { nudgeRow.querySelector('#dial-down').addEventListener('click', () => nudge(-1)); nudgeRow.querySelector('#dial-up').addEventListener('click', () => nudge(1)); }

  const el = h('div', { class: 'stack', style: 'gap:20px' },
    h('section', null, h('div', { class: 'eyebrow' }, 'Your call'), readout),
    h('section', null,
      h('div', { class: 'dial' }, input, h('div', { class: 'inset' }, fill)),
      ticks,
      h('div', { class: 'ends', 'aria-hidden': 'true' }, h('span', null, '← No'), h('span', null, 'Yes →')),
      nudgeRow,
      hint),
    h('section', { class: 'pay' },
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'If you are right'), right),
      h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'If you are wrong'), wrong)),
    h('section', { class: 'eq' },
      s('svg', { width: 88, height: 88, viewBox: '0 0 88 88', 'aria-hidden': 'true' }, s('circle', { class: 'w0', cx: 44, cy: 44, r: 34 }), wheelFill, wheelNum),
      h('div', { class: 'eqt' }, h('span', { class: 'eyebrow' }, 'Equivalent bet'), wheelText, h('span', { class: 'cap' }, 'Prefer the wheel? Lower the dial.'))));

  return { el, value, input, ok: () => okAt(k) };
}

// A static wheel for the lesson cards.
export function wheel(c) {
  return h('div', { class: 'eq' },
    s('svg', { width: 88, height: 88, viewBox: '0 0 88 88', 'aria-hidden': 'true' },
      s('circle', { class: 'w0', cx: 44, cy: 44, r: 34 }),
      s('circle', { class: 'w1', cx: 44, cy: 44, r: 34, transform: 'rotate(-90 44 44)', 'stroke-dasharray': `${(c * CIRC).toFixed(1)} ${CIRC.toFixed(1)}` }),
      s('text', { class: 'wn', x: 44, y: 53, 'text-anchor': 'middle' }, String(Math.round(c * 100)))),
    h('div', { class: 'eqt' }, h('span', { class: 'eyebrow' }, 'Equivalent bet'), h('p', { class: 'wtxt' }, h('b', null, `A wheel that wins ${Math.round(c * 100)} spins in 100.`))));
}

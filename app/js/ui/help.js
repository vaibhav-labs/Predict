// What Predict is, what it is for, how it checks itself, how to play, and how to install it.
// Plain reference, no state of its own.
import { h, s } from '../dom.js';
import { focusFrame } from './common.js';

function section(title, ...body) {
  return h('section', { class: 'card prose stack' },
    h('div', { class: 'eyebrow' }, title),
    ...body);
}
function p(term, text) {
  return h('p', null, h('b', null, term + '.'), ' ' + text);
}
function steps(...rows) {
  return h('ol', { class: 'steps' }, rows.map((row, i) => h('li', null,
    h('span', { class: 'n' }, String(i + 1)),
    h('span', { class: 't' }, h('b', null, row[0]), h('em', null, row[1])))));
}

// ---- the core loop, drawn: call, lock, reveal, points, pattern, lesson or gate, back to call -------------
function loopDiagram() {
  const W = 300, H = 360;
  const boxes = [
    ['Call', 'State your confidence'],
    ['Lock', 'Final: no second guess'],
    ['Reveal', 'Reality answers, now or later'],
    ['Points', 'A proper rule scores the call'],
    ['Pattern', 'Enough calls to show it is real'],
  ];
  const bx = 18, bw = W - 2 * 18 - 40, bh = 46, gap = 26;
  const top = (i) => 10 + i * (bh + gap);
  const svg = s('svg', { class: 'loop', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'The core loop: call, lock, reveal, points, pattern, lesson or gate, and back to the next call' });
  boxes.forEach((b, i) => {
    const y = top(i);
    svg.append(
      s('rect', { class: 'loopbox', x: bx, y, width: bw, height: bh, rx: 12 }),
      s('text', { class: 'loopterm', x: bx + 16, y: y + 19 }, b[0]),
      s('text', { class: 'loopnote', x: bx + 16, y: y + 36 }, b[1]));
    if (i < boxes.length - 1) {
      const y1 = y + bh, y2 = top(i + 1);
      svg.append(
        s('line', { class: 'looparrow', x1: bx + bw / 2, y1, x2: bx + bw / 2, y2: y2 - 8 }),
        s('path', { class: 'looparrow', d: `M${bx + bw / 2 - 5},${y2 - 8} L${bx + bw / 2 + 5},${y2 - 8} L${bx + bw / 2},${y2} Z` }));
    }
  });
  const rx = bx + bw + 20, firstY = top(0) + bh / 2, lastY = top(boxes.length - 1) + bh / 2;
  svg.append(
    s('path', { class: 'loopreturn', d: `M${bx + bw},${lastY} C ${rx + 20},${lastY} ${rx + 20},${firstY} ${bx + bw},${firstY}` }),
    s('path', { class: 'loopreturnhead', d: `M${bx + bw + 9},${firstY - 5} L${bx + bw + 9},${firstY + 5} L${bx + bw},${firstY} Z` }),
    s('text', { class: 'loopnote', x: rx + 24, y: (firstY + lastY) / 2, 'text-anchor': 'start', transform: `rotate(90 ${rx + 24} ${(firstY + lastY) / 2})` }, 'the next call'));
  return svg;
}

// ---- the proof: an illustrative calibration curve (not real data) -----------------------------------------
function curveIllustration() {
  const W = 300, H = 210, L = 34, R_ = 12, T = 10, B = 44;
  const pw = W - L - R_, ph = H - T - B;
  const x = (c) => L + ((c - 0.5) / 0.5) * pw;
  const y = (r) => T + (1 - r) * ph;
  const pts = [[0.55, 0.5], [0.65, 0.68], [0.75, 0.7], [0.85, 0.88], [0.95, 0.9]];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'An illustrative calibration curve: dots close to the honest diagonal mean the training is working' });
  svg.append(
    s('line', { class: 'axis', x1: L, x2: W - R_, y1: y(0), y2: y(0) }),
    s('line', { class: 'axis', x1: L, x2: L, y1: y(0), y2: y(1) }),
    s('line', { class: 'diag', x1: x(0.5), y1: y(0.5), x2: x(1), y2: y(1) }),
    s('polyline', { class: 'line', points: pts.map(([c, r]) => `${x(c).toFixed(1)},${y(r).toFixed(1)}`).join(' ') }),
    ...pts.map(([c, r]) => s('circle', { class: 'pt', cx: x(c), cy: y(r), r: 4 })),
    s('text', { x: L + pw / 2, y: H - 6, 'text-anchor': 'middle' }, 'how sure you said you were'),
    s('text', { x: 10, y: T + ph / 2, transform: `rotate(-90 10 ${T + ph / 2})`, 'text-anchor': 'middle' }, 'how often right'));
  return svg;
}

export function helpScreen(ctx) {
  return focusFrame({ title: 'How Predict works', closeTo: '#/today' },

    section('What this is',
      h('p', { class: 'lede' }, 'A daily forecasting dojo: you stake a confidence on a claim, reality scores you, and patterns in your misses become lessons.'),
      h('p', null, 'Three loops feed each other: a gym of instant practice calls, a journal of real predictions that resolve over days or months, and Predict as a coach that reads the pattern and teaches from it.')),

    section('What it is trying to achieve',
      h('p', null, 'The daily target: make your stated confidence mean what it says, so that when you say 80% you are right about 80% of the time.'),
      h('p', null, 'The long goal: a public forecasting track record good enough, on real questions, that your judgment is worth trusting beyond this app. The units, belts and the public arena below are the road toward that; the gym and the journal are where it starts.')),

    section('The core loop', loopDiagram(),
      h('p', { class: 'cap' }, 'Every call, gym or journal, runs this loop. The gym completes it in seconds; the journal completes it over days.')),

    steps(
      ['Gym, about 5 minutes', 'A round of confidence calls, instant or revealed at the end of a session.'],
      ['Lesson, about 1 minute', 'A short card, once enough calls show a real pattern worth naming.'],
      ['Journal, about 4 minutes', 'One real prediction, written with its full chain and locked before you know the answer.']),

    section('How it checks whether it is working', h('div', { class: 'curve' }, curveIllustration()),
      h('p', null, 'Dots on the dashed line mean your stated confidence matches your actual hit rate: the training is doing its job. Above the line, you are too shy; below it, too sure.'),
      p('Gates', 'a unit ends in a fixed exam of fresh calls, judged once. Luck rarely passes a miscalibrated player twice.'),
      p('Edge', 'a journal prediction is scored against a hidden baseline, not just right or wrong, so a safe, obvious guess earns nothing.'),
      p('Lessons', 'fire only once a pattern repeats across many calls, never from a single miss, so the app is not crying wolf.'),
      p('The long-run check', 'a public track record against real questions and other forecasters, later in the plan, is the final exam.')),

    section('How to play',
      p('The dial', 'pick a side, Yes or No, and how sure you are, from 50% (a toss-up) to 99% (near certain). Lock it in.'),
      p('Baseline', 'your first 60 gym calls, in 3 sessions of 20, with no feedback until a session ends: an honest first measurement.'),
      p('Practice', 'reveals each gym call right away: whether you were right, the points, and the answer with its source. The mix of easy, medium and hard questions shifts to keep it challenging.'),
      p('The journal’s six links', 'claim, outside view (your own reference rate), up to three signals for or against, the case against, a tripwire for changing your mind, and a probability. Lock it, and none of it can change.'),
      p('The checker', 'reads your claim for common problems: no date, a vague word, not something a stranger could check, or fully in your own control. It only advises; Ask Predict copies a message to paste into a chat for a second opinion.')),

    section('Mirror and Path',
      p('Calibration curve', 'plots how often you were actually right against how sure you said you were. A point on the dashed line means your X% calls were right about X% of the time; above it, too shy; below it, too sure. Every dot carries a bar for how far luck alone could move it, and the number of calls under it: a dot with few calls is drawn hollow and means little.'),
      p('Bias map', 'your gap split by topic for the gym, and by domain and horizon for the journal. A group with fewer than 10 calls says “too few” and claims nothing; a verdict (too sure, too shy) appears only when the whole bar sits on one side of zero.'),
      p('Level, streak, 7 days', 'Level comes from career points, which never go down. A streak counts days you played (a call, a locked prediction or a resolved one) and a missed day keeps half of it. 7 days is your average skill points on the days you played, so showing up cannot raise it.'),
      p('Path', 'the units ahead, and the lesson cards you have read.')),

    section('Points, gap and edge',
      p('Points', 'a proper scoring rule, so saying what you actually believe is always the best strategy: a confident miss costs more than a confident hit pays.'),
      p('Gap', 'your average stated confidence minus how often you were actually right. Positive means too sure of yourself; negative, too shy.'),
      p('Baseline (journal)', 'revealed right after you lock: your own past rate for that kind of prediction, or a starter guess if you have none yet.'),
      p('Edge', 'what your journal prediction scores against that baseline, not just whether you were right. Beating the baseline is the point; a confident guess that only matches it earns nothing.')),

    section('Add it to your phone',
      steps(
        ['Open the address', 'In Safari (iPhone) or Chrome (Android), go to vaibhav-labs.github.io/Predict.'],
        ['Add it', 'iPhone: tap Share, then Add to Home Screen. Android: open the browser menu, then Install app.'],
        ['Play from the icon', 'from now on: an installed app keeps its own saved data, separate from a browser tab.'])),

    section('Coach',
      p('Export, Import, Erase', 'back up your whole record to a file, restore it (the same file twice counts once), or wipe this phone clean.'),
      p('This device', 'checks that the app is installed, works offline, is saving your calls, and whether it is online right now.')),

    section('Not built yet',
      h('p', null, 'Belts are listed on Mirror with your real progress, but none can be earned until the exams that unlock them are built. A weekly letter from Predict, and Predict answering inside the app, arrive later too: for now Ask Predict only copies a message for you to paste elsewhere.')));
}

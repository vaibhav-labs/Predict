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
      p('The questions', 'each one sets a scene (a day of weather, a flight, a stock market year, a trend, a documented rate) and makes a claim about how it turns out. Nothing here is trivia: you are judged on how sure you were, so start from how often things like this happen, then adjust.'),
      p('The dial', 'pick a side, Yes or No, and how sure you are, from 50% (a toss-up) to 99% (near certain). Lock it in.'),
      p('Baseline', 'your first 60 gym calls, in 3 sessions of 20, with no feedback until a session ends: an honest first measurement.'),
      p('Practice', 'reveals each gym call right away: whether you were right, the points, what happened, how often claims like it held among the other cases in the record, and the source. The mix of easy, medium and hard questions shifts to keep it challenging.'),
      p('The journal’s six links', 'claim, outside view (your own reference rate), up to three signals for or against, the case against, a tripwire for changing your mind, and a probability. Lock it, and none of it can change.'),
      p('The checker', 'reads your claim for common problems: no date, a vague word, not something a stranger could check, or fully in your own control. It only advises; Ask Predict copies a message to paste into a chat for a second opinion.')),

    section('Patterns and lessons',
      p('Patterns', 'Predict reads your own record for habits: too sure at 90 to 99%, too shy at 60 to 80%, a lot of 50 to 55% calls you could have called better, vague journal predictions, missed days. A pattern opens only when enough of your calls say so, never from one call.'),
      p('A pattern flag', 'comes with a one-minute lesson, then a drill, then two re-tests that count your normal practice, three and ten days after the drill. Pass both and it clears. Fail one and it comes back; the third time it goes to the weekly review. At most one new pattern opens a day and two can be in repair at once.'),
      p('Drills', 'the wheel drill checks every call at 90% or more against a wheel that wins that often; the forced drill locks the steps in between; the zone drill locks 50 to 55%; the rewrite drill makes vague predictions sharp. Drill calls never count toward a pattern.'),
      p('The note after a miss', 'a miss at 80% or more gets two lines under the reveal: what a calibrated call looked like in your own record, and whether the records call the outcome rare (under 20% of cases like it) or ordinary.'),
      p('Missed days', 'two or more missed days in a week shrink the session to a three-minute minimum until you have held it five days in a row.')),

    section('The Unit 1 exam',
      p('The exam', 'after 90 practice calls: 200 fresh calls in 10 sittings of 20, from questions practice never serves. Nothing is shown between calls and nothing is judged until the last one, so a lucky streak cannot pass you.'),
      p('The verdict', 'you pass when your average confidence is within 5 points of your hit rate and no band of 15 calls or more sits more than 2.5 standard errors off. A fail says why and sends you to a repair drill on the worst band before a new exam. A pass shows Rust on the Path if the habit it fixed comes back.')),

    section('Ranges (Unit 3)',
      p('What it is', 'a real situation and a quantity to guess: a day’s high, a flight’s delay, a country’s life expectancy a few years on, a year of stock prices. You give a low and a high you are 90% sure the truth sits between. It opens when you have passed the Unit 1 exam.'),
      p('The score', 'the width of your range, plus 20 times how far the truth fell outside it, lower being better. Your points measure that against the reference: the width of the middle 90% of the other cases like this one in the record. Saying exactly the reference interval earns about nothing; a narrower range that still holds the truth earns more; a range that misses, or one far wider than needed, loses.'),
      p('After each range', 'the reveal draws the truth, your range and the reference interval on one line, with the source. Ten ranges a session. A range you have seen in the last 90 days does not come back.'),
      p('The exam', '60 fresh ranges in three sittings of 20, sealed until the last one. Between 50 and 58 must hold the truth: a true 90% range holds about 54. Fewer says too narrow, more says padded. A fail sends you to a repair drill first.'),
      p('Range patterns', 'too narrow (fewer than 30 of your last 40 held the truth) and too wide (39 or 40 held it, at over twice the reference width) each get a lesson, a drill and two re-tests. The narrow drill builds a range one end at a time; the wide drill gives a width budget.')),

    section('The autopsy and the case file',
      p('Autopsy', 'a real prediction that missed at 85% or more, and one in five confident hits, gets a short autopsy before your next journal step: mark each link of your chain held up, weak or missed it, then say what you knew, what you missed, whether it was luck or judgment, and one rule for next time.'),
      p('The rule', 'sits above your next five journal cards and is checked at 3 and 10 days: did you use it?'),
      p('Case file', 'every resolved prediction has five lenses: what happened, your reasoning (with the marks), luck or judgment (how likely the outcome was at the baseline), your pattern, and next time.')),

    section('Mirror and Path',
      p('Calibration curve', 'plots how often you were actually right against how sure you said you were. A point on the dashed line means your X% calls were right about X% of the time; above it, too shy; below it, too sure. Every dot carries a bar for how far luck alone could move it, and the number of calls under it: a dot with few calls is drawn hollow and means little.'),
      p('Bias map', 'your gap split by topic for the gym, and by domain and horizon for the journal. A group with fewer than 10 calls says “too few” and claims nothing; a verdict (too sure, too shy) appears only when the whole bar sits on one side of zero.'),
      p('Level, streak, 7 days', 'Level comes from career points, which never go down. A streak counts days you played (a call, a locked prediction or a resolved one) and a missed day keeps half of it. 7 days is your average skill points on the days you played, so showing up cannot raise it.'),
      p('Ranges on the Mirror', 'how many of your ranges held the truth, with the same kind of error bar, how wide they were against the reference, and the split by kind of question. Drill ranges do not count.'),
      p('Path', 'the units ahead, the Unit 1 and Unit 3 exams, your patterns and where each one stands, and the lesson cards you have read.')),

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
      p('Weekly letter', 'once a week Predict reads your record and writes you a short letter, a drill set and three ideas for a prediction each day. They appear here and on Today. They come from your private repository, so they only appear once you have connected one.'),
      p('Private repository', 'a repository only you can see, on GitHub, that holds a copy of your record. You paste its name and a token that can write to it. The token stays on this phone. The app refuses a public repository, and it contacts GitHub only after you connect.'),
      p('Ask Predict', 'copies a short message with this week’s numbers for you to paste into a chat with Predict. Nothing is sent from the app.'),
      p('Predict’s number and checks', 'when Predict writes an outside-view number for one of your open cards before it is due, that number becomes its baseline and the card says so. For world questions Predict may look up what happened and give the page it read: you still press the button, and the page is saved with your answer.'),
      p('Export, Import, Erase', 'back up your whole record to a file, restore it (the same file twice counts once), or wipe this phone clean.'),
      p('This device', 'checks that the app is installed, works offline, is saving your calls, and whether it is online right now.')),

    section('Not built yet',
      h('p', null, 'Belts are listed on Mirror with your real progress; the Unit 1 and Unit 3 exams count toward the first one, and the later units come with their own exams. Predict answering inside the app arrives later: for now Ask Predict only copies a message for you to paste elsewhere.')));
}

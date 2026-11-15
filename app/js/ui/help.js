// How to play, and what everything on screen means. Plain reference, no state of its own.
import { h } from '../dom.js';
import { focusFrame } from './common.js';

function section(title, ...paragraphs) {
  return h('section', { class: 'card prose stack' },
    h('div', { class: 'eyebrow' }, title),
    ...paragraphs);
}
function p(term, text) {
  return h('p', null, h('b', null, term + '.'), ' ' + text);
}

export function helpScreen(ctx) {
  return focusFrame({ title: 'How to play', closeTo: '#/today' },
    section('Each day',
      h('p', null, 'Open Today. It shows what is next: the gym, a lesson if one is ready, and your journal prediction. Each has its own minutes, so a full day fits in about 15.')),

    section('The gym',
      p('The call', 'pick a side, Yes or No, and how sure you are on the dial, from 50% (a toss-up) to 99% (near certain). Lock it in.'),
      p('Baseline', 'your first 60 calls, in 3 sessions of 20. No feedback until a session ends: an honest first measurement.'),
      p('Practice', 'reveals each call right away: whether you were right, the points, and the answer with its source. The mix of easy, medium and hard questions shifts to keep it challenging.')),

    section('The journal',
      h('p', null, 'Once a day, write one real prediction about your work, your life or the world. Fill in its six-part chain, set a probability from 1% to 99%, and lock it in.'),
      p('Claim, domain, due date', 'what you are predicting, written like "By [date], [thing] will [happen]", which area of life it is about, and when it resolves.'),
      p('The checker', 'reads your claim for a few common problems: no date, a vague word, not something a stranger could check, or something fully in your own control. It only advises; Ask Predict copies a message to paste into a chat for a second opinion.'),
      p('Outside view', 'your own reference class and its usual rate: how often this kind of thing happens in general.'),
      p('Evidence', 'up to three signals, each marked as supporting your claim or working against it.'),
      p('Case against', 'the strongest reason you might be wrong.'),
      p('Tripwire', 'what would change your mind, and to what number.'),
      h('p', null, 'A lock is final: none of this can be edited afterwards. The card then sits Open until its due date, moves to Due, and you resolve it as Happened, Didn’t happen, or Void.')),

    section('Mirror and Path',
      p('Calibration curve', 'plots how often you were actually right against how sure you said you were. A point on the dashed line means your X% calls were right about X% of the time; above it, too shy; below it, too sure. Every dot carries a bar for how far luck alone could move it, and the number of calls under it: a dot with few calls is drawn hollow and means little.'),
      p('Bias map', 'your gap split by topic for the gym, and by domain and horizon for the journal. A group with fewer than 10 calls says “too few” and claims nothing; a verdict (too sure, too shy) appears only when the whole bar sits on one side of zero.'),
      p('Level, streak, 7 days', 'Level comes from career points, which never go down. A streak counts days you played (a call, a locked prediction or a resolved one) and a missed day keeps half of it. 7 days is your average skill points on the days you played, so showing up cannot raise it.'),
      p('Path', 'the units ahead, and the lesson cards you have read.')),

    section('Points, gap and edge',
      p('Points', 'a formula scores every call so that saying what you actually believe is always the best strategy: a confident miss costs more than a confident hit pays.'),
      p('Gap', 'your average stated confidence minus how often you were actually right. Positive means too sure of yourself; negative means too shy; near zero means honest.'),
      p('Baseline (journal)', 'a hidden comparison number, revealed once you lock: your own past rate for that kind of prediction, or a starter guess if you have none yet.'),
      p('Edge', 'what your journal prediction scores against that baseline, not just whether you were right. Beating the baseline is the point; a confident guess that only matches it earns nothing.')),

    section('Coach',
      p('Export, Import, Erase', 'back up your whole record to a file, restore it (the same file twice counts once), or wipe this phone clean.'),
      p('This device', 'checks that the app is installed, works offline, is saving your calls, and whether it is online right now.')),

    section('Not built yet',
      h('p', null, 'Belts are listed on Mirror with your real progress, but none can be earned until the exams that unlock them are built. A weekly letter from Predict, and Predict answering inside the app, arrive later too: for now Ask Predict only copies a message for you to paste elsewhere.')));
}

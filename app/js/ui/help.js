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
      p('The questions', 'each one sets a scene (a day of weather, a flight, a stock market year, a trend, a documented rate) and makes a claim about how it turns out. Nothing here is trivia: you are judged on how sure you were, so start from how often things like this happen, then adjust.'),
      p('The call', 'pick a side, Yes or No, and how sure you are on the dial, from 50% (a toss-up) to 99% (near certain). Lock it in.'),
      p('Baseline', 'your first 60 calls, in 3 sessions of 20. No feedback until a session ends: an honest first measurement.'),
      p('Practice', 'reveals each call right away: whether you were right, the points, what happened, how often claims like it held among the other cases in the record, and the source. The mix of easy, medium and hard questions shifts to keep it challenging.')),

    section('The journal',
      h('p', null, 'Once a day, write one real prediction about your work, your life or the world. Fill in its six-part chain, set a probability from 1% to 99%, and lock it in.'),
      p('Claim, domain, due date', 'what you are predicting, written like "By [date], [thing] will [happen]", which area of life it is about, and when it resolves.'),
      p('The checker', 'reads your claim for a few common problems: no date, a vague word, not something a stranger could check, or something fully in your own control. It only advises; Ask Predict copies a message to paste into a chat for a second opinion.'),
      p('Outside view', 'your own reference class and its usual rate: how often this kind of thing happens in general.'),
      p('Evidence', 'up to three signals, each marked as supporting your claim or working against it.'),
      p('Case against', 'the strongest reason you might be wrong.'),
      p('Tripwire', 'what would change your mind, and to what number.'),
      h('p', null, 'A lock is final: none of this can be edited afterwards. The card then sits Open until its due date, moves to Due, and you resolve it as Happened, Didn’t happen, or Void.')),

    section('Patterns and lessons',
      p('Patterns', 'Predict reads your own record for habits: too sure at 90 to 99%, too shy at 60 to 80%, a lot of 50 to 55% calls you could have called better, vague journal predictions, missed days. A pattern opens only when enough of your calls say so, never from one call.'),
      p('A pattern flag', 'comes with a one-minute lesson, then a drill, then two re-tests that count your normal practice, three and ten days after the drill. Pass both and it clears. Fail one and it comes back; the third time it goes to the weekly review. At most one new pattern opens a day and two can be in repair at once.'),
      p('Drills', 'the wheel drill checks every call at 90% or more against a wheel that wins that often; the forced drill locks the steps in between; the zone drill locks 50 to 55%; the rewrite drill makes vague predictions sharp. Drill calls never count toward a pattern.'),
      p('The note after a miss', 'a miss at 80% or more gets two lines under the reveal: what a calibrated call looked like in your own record, and whether the records call the outcome rare (under 20% of cases like it) or ordinary.'),
      p('Missed days', 'two or more missed days in a week shrink the session to a three-minute minimum until you have held it five days in a row.')),

    section('The Unit 1 exam',
      p('The exam', 'after 90 practice calls: 200 fresh calls in 10 sittings of 20, from questions practice never serves. Nothing is shown between calls and nothing is judged until the last one, so a lucky streak cannot pass you.'),
      p('The verdict', 'you pass when your average confidence is within 5 points of your hit rate and no band of 15 calls or more sits more than 2.5 standard errors off. A fail says why and sends you to a repair drill on the worst band before a new exam. A pass shows Rust on the Path if the habit it fixed comes back.')),

    section('The autopsy and the case file',
      p('Autopsy', 'a real prediction that missed at 85% or more, and one in five confident hits, gets a short autopsy before your next journal step: mark each link of your chain held up, weak or missed it, then say what you knew, what you missed, whether it was luck or judgment, and one rule for next time.'),
      p('The rule', 'sits above your next five journal cards and is checked at 3 and 10 days: did you use it?'),
      p('Case file', 'every resolved prediction has five lenses: what happened, your reasoning (with the marks), luck or judgment (how likely the outcome was at the baseline), your pattern, and next time.')),

    section('Mirror and Path',
      p('Calibration curve', 'plots how often you were actually right against how sure you said you were. A point on the dashed line means your X% calls were right about X% of the time; above it, too shy; below it, too sure. Every dot carries a bar for how far luck alone could move it, and the number of calls under it: a dot with few calls is drawn hollow and means little.'),
      p('Bias map', 'your gap split by topic for the gym, and by domain and horizon for the journal. A group with fewer than 10 calls says “too few” and claims nothing; a verdict (too sure, too shy) appears only when the whole bar sits on one side of zero.'),
      p('Level, streak, 7 days', 'Level comes from career points, which never go down. A streak counts days you played (a call, a locked prediction or a resolved one) and a missed day keeps half of it. 7 days is your average skill points on the days you played, so showing up cannot raise it.'),
      p('Path', 'the units ahead, the Unit 1 exam, your patterns and where each one stands, and the lesson cards you have read.')),

    section('Points, gap and edge',
      p('Points', 'a formula scores every call so that saying what you actually believe is always the best strategy: a confident miss costs more than a confident hit pays.'),
      p('Gap', 'your average stated confidence minus how often you were actually right. Positive means too sure of yourself; negative means too shy; near zero means honest.'),
      p('Baseline (journal)', 'a hidden comparison number, revealed once you lock: your own past rate for that kind of prediction, or a starter guess if you have none yet.'),
      p('Edge', 'what your journal prediction scores against that baseline, not just whether you were right. Beating the baseline is the point; a confident guess that only matches it earns nothing.')),

    section('Coach',
      p('Weekly letter', 'once a week Predict reads your record and writes you a short letter, a drill set and three ideas for a prediction each day. They appear here and on Today. They come from your private repository, so they only appear once you have connected one.'),
      p('Private repository', 'a repository only you can see, on GitHub, that holds a copy of your record. You paste its name and a token that can write to it. The token stays on this phone. The app refuses a public repository, and it contacts GitHub only after you connect.'),
      p('Ask Predict', 'copies a short message with this week’s numbers for you to paste into a chat with Predict. Nothing is sent from the app.'),
      p('Predict’s number and checks', 'when Predict writes an outside-view number for one of your open cards before it is due, that number becomes its baseline and the card says so. For world questions Predict may look up what happened and give the page it read: you still press the button, and the page is saved with your answer.'),
      p('Export, Import, Erase', 'back up your whole record to a file, restore it (the same file twice counts once), or wipe this phone clean.'),
      p('This device', 'checks that the app is installed, works offline, is saving your calls, and whether it is online right now.')),

    section('Not built yet',
      h('p', null, 'Belts are listed on Mirror with your real progress; the Unit 1 exam counts toward the first one, and the later units come with their own exams. Predict answering inside the app arrives later: for now Ask Predict only copies a message for you to paste elsewhere.')));
}

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

    section('Ranges (Unit 3)',
      p('What it is', 'a real situation and a quantity to guess: a day’s high, a flight’s delay, a country’s life expectancy a few years on, a year of stock prices. You give a low and a high you are 90% sure the truth sits between. It opens when you have passed the Unit 1 exam.'),
      p('The score', 'the width of your range, plus 20 times how far the truth fell outside it, lower being better. Your points measure that against the reference: the width of the middle 90% of the other cases like this one in the record. Saying exactly the reference interval earns about nothing; a narrower range that still holds the truth earns more; a range that misses, or one far wider than needed, loses.'),
      p('After each range', 'the reveal draws the truth, your range and the reference interval on one line, with the source. Ten ranges a session. A range you have seen in the last 90 days does not come back.'),
      p('The exam', '60 fresh ranges in three sittings of 20, sealed until the last one. Between 50 and 58 must hold the truth: a true 90% range holds about 54. Fewer says too narrow, more says padded. A fail sends you to a repair drill first.'),
      p('Range patterns', 'too narrow (fewer than 30 of your last 40 held the truth) and too wide (39 or 40 held it, at over twice the reference width) each get a lesson, a drill and two re-tests. The narrow drill builds a range one end at a time; the wide drill gives a width budget.')),

    section('Fermi problems (Unit 4)',
      p('What it is', 'a big quantity you cannot look up, like the minutes of lateness a month of flights adds up to. You break it into parts you can think about, and give each part a low and a high you are 90% sure of. It opens when you have passed the Unit 3 exam.'),
      p('The worksheet', 'the app multiplies your parts for you. The middles combine as a product; the spreads combine in quadrature, because errors in separate parts do not all land the same way, so the whole is narrower than lows times lows and highs times highs. In practice you first make a gut guess for the whole, then see whether the worksheet beat it.'),
      p('The score', 'the worksheet’s range is scored like a range in Unit 3, against the reference interval, and each part is shown held or missed so you can see where the error came from.'),
      p('The exam', '20 fresh problems in two sittings of 10, sealed until the last one. At least 16 worksheet ranges must hold the truth and the median miss must be within a factor of 3. A fail says whether you were too narrow or too far off, then a repair drill.'),
      p('Chains', 'a chain gives you steps, each a rate among the cases that passed the one before. The answer is the product. Chain practice is on the Path; it does not count toward the exam.')),

    section('Base rates (Unit 5)',
      p('What it is', 'start outside: how often does this happen to cases like this one? You type a percent; within 7 points counts. It opens when you have passed Unit 4. Reference-class problems ask you to pick the narrowest group that still holds 30 or more cases.'),
      p('The exam', '40 fresh base-rate problems in two sittings of 20. At least 32 must land within 7 points. A fail says whether you ran high or low, then a repair drill.'),
      p('In the journal', 'with Unit 5 open, a prediction’s outside-view rate is graded against the base rate recorded when you locked it. A card can be tagged as your own task; chain cards take the steps with a probability each, and the app shows their product.'),
      p('Patterns', 'chains that you multiply too generously, your own plans running too sure, forecasts far from the base rate with no evidence, and a domain where your edge is below zero each get a lesson, a drill and re-tests.')),

    section('Updating (Unit 6)',
      p('What it is', 'news arrives and you change your number, but by how much? Each step shows the rate before the news, the news, and you type the new percent. It counts when it lands within 7 points of the real rate for the narrower group. It opens when you have passed Unit 5.'),
      p('The exam', '40 fresh steps in two sittings of 20. At least 32 must land within 7 points, and on average your moves must not end further from the truth than staying at the prior would have. A fail says which, then a repair drill.'),
      p('On a journal card', 'while a card is open you can change its number with a reason of a line or two. The locked number stays on the record, and each day the card was open is scored at the number in force that day. One update a day: a second replaces the first. The Mirror adds up what your updates were worth.'),
      p('Patterns', 'open predictions that had news waiting and no update for a week, and big moves you reverse within two weeks, each get a lesson, a drill and re-tests.')),

    section('Knowing yourself (Units 7 to 9)',
      p('Counter-arguments (Unit 7)', 'a claim, your side, and a list of replies: pick the one that is the strongest honest case against you, not the loudest. It opens when you have passed Unit 6. The exam is 14 problems in a sitting; 22 of 28 counter-argument problems must be right. At the weekly review the coach also grades the case against on each of your cards: sound, weak or missing.'),
      p('The second estimate', 'with Unit 7 open, a journal card first asks for a gut number, then your reasoning, then the final number. Both are kept, and the Mirror shows whether the reasoning moved you the right way.'),
      p('Luck or judgment (Unit 8)', 'a result and the odds that were on the table: was it luck or judgment? It opens when you have passed Unit 7. From here every resolved card gets an autopsy, the hits too, and a memory check comes first: before you see your record, you type the number you recall locking. Your recall drifts toward what happened; the exam opens after 30 checks and needs drift within 5 points either way.'),
      p('Decisions (Unit 9)', 'a decision card pairs a prediction with a stake: what you gain if you act and it works, what you lose if you act and it does not. The break-even is loss divided by gain plus loss; act only when your number is above it. You choose to act or hold, set a review date 7 to 365 days out, and when it comes due you say what happened. Ten reviewed cards make a journal row for the unit.'),
      p('Memory drift pattern', 'if your recall of your own numbers moves 10 points or more toward the outcome across ten checks, you get a lesson, a recall drill of ten checks, and a re-test.')),

    section('The autopsy and the case file',
      p('Autopsy', 'a real prediction that missed at 85% or more, and one in five confident hits, gets a short autopsy before your next journal step: mark each link of your chain held up, weak or missed it, then say what you knew, what you missed, whether it was luck or judgment, and one rule for next time.'),
      p('The rule', 'sits above your next five journal cards and is checked at 3 and 10 days: did you use it?'),
      p('Case file', 'every resolved prediction has five lenses: what happened, your reasoning (with the marks), luck or judgment (how likely the outcome was at the baseline), your pattern, and next time.')),

    section('Mirror and Path',
      p('Calibration curve', 'plots how often you were actually right against how sure you said you were. A point on the dashed line means your X% calls were right about X% of the time; above it, too shy; below it, too sure. Every dot carries a bar for how far luck alone could move it, and the number of calls under it: a dot with few calls is drawn hollow and means little.'),
      p('Bias map', 'your gap split by topic for the gym, and by domain and horizon for the journal. A group with fewer than 10 calls says “too few” and claims nothing; a verdict (too sure, too shy) appears only when the whole bar sits on one side of zero.'),
      p('Level, streak, 7 days', 'Level comes from career points, which never go down. A streak counts days you played (a call, a locked prediction or a resolved one) and a missed day keeps half of it. 7 days is your average skill points on the days you played, so showing up cannot raise it.'),
      p('Ranges on the Mirror', 'how many of your ranges held the truth, with the same kind of error bar, how wide they were against the reference, and the split by kind of question. Drill ranges do not count.'),
      p('Reasoning on the Mirror', 'Fermi ranges that held, the median miss, how the worksheet compares with your first guess, base rates within 7 points and which way you lean, and how many journal cards carry an accepted base rate. Drills do not count.'),
      p('Path', 'the units ahead, the exams for Units 1, 3, 4 and 5, your patterns and where each one stands, and the lesson cards you have read.')),

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
      h('p', null, 'Belts are listed on Mirror with your real progress; the exams for Units 1 and 3 to 9 count toward them, and the later units come with their own exams. Predict answering inside the app arrives later: for now Ask Predict only copies a message for you to paste elsewhere.')));
}

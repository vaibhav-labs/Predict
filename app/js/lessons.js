// The four Unit 1 lesson cards. Every number in them is computed from the payout table at the moment the card is
// drawn (data/scoring.json through the scoring engine), so the text can never disagree with the game.
// A block is a paragraph (strings and {b: bold} parts), a table, or the equivalent-bet wheel.
import { signed, pct } from './engine/scoring.js';
import { combineRanges, naiveRange, chainProduct } from './engine/problem.js';

const f1 = (x) => {
  const r = Math.round(x * 10) / 10;
  return (r < 0 ? '−' : '') + Math.abs(r).toFixed(1);
};

export const LESSONS = [
  {
    id: 'points',
    title: 'How the points work',
    blurb: 'One rule pays every call',
    blocks: (S) => [
      { p: ['Every call pays by one rule. You pick a side and a confidence from 50% to 99%. If you are right you earn points. If you are wrong you lose points. Higher confidence moves both numbers, and a miss moves faster than a hit.'] },
      { table: { head: ['Confidence', 'If right', 'If wrong'], rows: [0.5, 0.6, 0.7, 0.8, 0.9, 0.99].map((c) => [pct(c), signed(S.hit(c)), signed(S.miss(c))]), badCol: 2 } },
      { p: ['Say there is a kind of question you get right 7 times in 10. Over many calls, saying 70% earns ', { b: f1(S.expected(0.7, 0.7)) }, ' a call. Saying 90% earns ', { b: f1(S.expected(0.7, 0.9)) }, '. Saying 99% earns ', { b: f1(S.expected(0.7, 0.99)) }, '.'] },
      { p: ['The rule is built so that saying exactly what you believe earns the most in the long run. Shading up or down only costs points.'] },
    ],
  },
  {
    id: 'price99',
    title: 'The price of 99',
    blurb: 'What one miss at 99% costs',
    blocks: (S) => [
      { p: ['99% says: I would be wrong about once in a hundred. When it is right it pays ', { b: signed(S.hit(0.99)) }, '. When it is wrong it costs ', { b: signed(S.miss(0.99)) }, ', which cancels about ', { b: String(Math.ceil(-S.miss(0.99) / S.hit(0.99))) }, ' right answers.'] },
      { wheel: 0.99 },
      { p: ['Picture a wheel that wins 99 spins in 100. Would you really rather bet on your answer than on the wheel? If not, lower the dial.'] },
      { p: ['If your 99% calls turn out right 8 times in 10, they earn ', { b: f1(S.expected(0.8, 0.99)) }, ' a call. The same calls said honestly at 80% earn ', { b: f1(S.expected(0.8, 0.8)) }, '.'] },
    ],
  },
  {
    id: 'knowmore',
    title: 'You know more than you say',
    blurb: 'Doubt that costs points',
    blocks: (S) => [
      { p: ['Saying 60% on things you get right 8 times in 10 feels safe, but it gives points away.'] },
      { p: ['A hit at 60% pays ', { b: signed(S.hit(0.6)) }, '. At 80% the same hit pays ', { b: signed(S.hit(0.8)) }, '. Over many calls, 60% earns ', { b: f1(S.expected(0.8, 0.6)) }, ' a call and 80% earns ', { b: f1(S.expected(0.8, 0.8)) }, '. That is ', { b: f1(S.expected(0.8, 0.8) - S.expected(0.8, 0.6)) }, ' points left on the table on every call.'] },
      { p: ['A miss at 60% costs only ', { b: String(-S.miss(0.6)) }, ', which is why it feels safe. But when you really do know, say so.'] },
    ],
  },
  {
    id: 'fifty',
    title: '50% is a claim too',
    blurb: 'The score of a coin flip',
    blocks: (S) => [
      { p: ['At 50% a call pays ', { b: String(S.hit(0.5)) }, ' whether you are right or wrong. It is the score of a coin flip, and every other call has to beat it.'] },
      { p: ['50% is not safe, and it is not no answer. It says: on questions like this, I am right half the time. If you lean even slightly one way, say so: at 60% a hit pays ', { b: signed(S.hit(0.6)) }, ' and a miss costs ', { b: String(-S.miss(0.6)) }, '.'] },
      { p: ['If you say 50% on things you would get right 7 times in 10, you earn ', { b: f1(S.expected(0.7, 0.5)) }, ' a call where 70% would earn ', { b: f1(S.expected(0.7, 0.7)) }, '. Use 50% only when you truly cannot tell the two sides apart.'] },
    ],
  },
];

// ---- Unit 3: the three range cards. Their numbers are worked out here from data/scoring.json, so the text cannot disagree with the game.
const erf = (x) => { // Abramowitz and Stegun 7.1.26, good to about 1e-7: plenty for a table shown to two places
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const phi = (x) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
// Expected interval score of "your best guess plus or minus a standard deviations" when the outcome is bell-shaped around it.
const winkler = (a, mult) => 2 * a + mult * 2 * (phi(a) - a * (1 - Phi(a)));
const binom = (n, p, lo, hi) => {
  let total = 0;
  for (let k = lo; k <= hi; k++) { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; total += c * p ** k * (1 - p) ** (n - k); }
  return total;
};
const pc = (x) => `${Math.round(x * 100)}%`;
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

export const RANGE_LESSONS = [
  {
    id: 'ninety',
    title: 'What a 90% range means',
    blurb: 'Nine in ten, not ten in ten',
    blocks: (S, cfg) => {
      const g = cfg.gates, n = g.range_exam_calls, [lo, hi] = g.range_pass_hits;
      return [
        { p: ['A 90% range is a promise: a low and a high chosen so that the truth lands between them ', { b: 'nine times in ten' }, '. Not ten in ten. A range that never misses is too wide to tell anyone anything, and one that misses half the time is too narrow to trust.'] },
        { table: { head: ['Out of 10 ranges', 'What it says'], rows: [['10 held it', 'Wider than you need'], ['9 held it', 'Honest'], ['7 held it', 'A 70% range'], ['5 held it', 'A coin flip']] } },
        { p: [`The Unit 3 exam is ${n} fresh ranges. Between ${lo} and ${hi} of them must hold the truth. A player whose ranges really are 90% passes about `, { b: pc(binom(n, 0.9, lo, hi)) }, ' of the time. A player whose ranges are really 70% passes about ', { b: pc(binom(n, 0.7, lo, hi)) }, ', and one whose ranges hold 99% of the time about ', { b: pc(binom(n, 0.99, lo, hi)) }, '.'] },
      ];
    },
  },
  {
    id: 'price',
    title: 'The price of width',
    blurb: 'Why wide is not safe',
    blocks: (S, cfg) => {
      const m = cfg.interval.miss_multiplier;
      const honest = winkler(1.645, m);
      const rows = [['Narrow: 50%', 0.674], ['Narrow: 70%', 1.036], ['Honest: 90%', 1.645], ['Wide: 99%', 2.576], ['Far too wide', 5]].map(([name, a]) => [name, pc(2 * Phi(a) - 1), f2(winkler(a, m) / honest)]);
      return [
        { p: [`A range is scored by its width plus ${m} times how far the truth fell outside it. A range 8 wide that holds the truth costs `, { b: '8' }, `. The same range missing by 1 costs 8 + ${m} = `, { b: String(8 + m) }, '. Lower is better.'] },
        { p: [`So each end is a bet. Moving an end out by a little costs that little, and saves ${m} times it if the truth lands beyond. That pays only if the truth lands beyond the end more than 1 time in ${m}. This is why the honest ends sit 1 in 20 from the truth on each side.`] },
        { table: { head: ['Range', 'Holds it', 'Score (honest = 1.00)'], rows } },
        { p: ['Narrow and far-too-wide are both worse than honest. The score has no safe side.'] },
      ];
    },
  },
  {
    id: 'ends',
    title: 'Build it one end at a time',
    blurb: 'Start from the record, then widen',
    blocks: () => [
      { p: ['Most people guess a middle and add a little on each side. In the classic studies, ranges built that way held the truth about 5 times in 10 when they were meant to hold it 9 in 10.'] },
      { p: [{ b: 'Build each end alone.' }, ' Find a low end you would be surprised to see the truth fall under: about 1 time in 20. Then a high end the same way. Each end is its own question: would I bet 19 to 1 that the truth is above this number?'] },
      { p: [{ b: 'Start outside.' }, ' The situation has cousins: how far did cases like it move, and how much did they vary? Take the spread of those, then adjust for what you know. The reveal after each range shows the record, so you can see how wide the cousins really were.'] },
      { p: ['If you are not sure, widen first. Then narrow only while you can honestly say the truth would surprise you outside.'] },
    ],
  },
];

// Unit 4 (Fermi): break an unknown into parts you can estimate, and multiply the chain. Every number is worked out here, by the same functions the
// worksheet uses, so the card cannot disagree with the game.
const times = (x) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : x >= 10 ? x.toFixed(0) : x.toFixed(1));
export const FERMI_LESSONS = [
  {
    id: 'break',
    title: 'Break it down',
    blurb: 'Parts you can think about',
    blocks: () => {
      const parts = [{ low: 2, high: 8 }, { low: 3, high: 12 }, { low: 10, high: 40 }];
      const comb = combineRanges(parts), naive = naiveRange(parts);
      return [
        { p: ['Some questions are too big to guess: how many minutes of lateness did a hundred flights add up to? You have no feel for the total. But the total is a product of parts you do have a feel for: ', { b: 'how many flights, times the share that are late, times how late the late ones are.' }] },
        { p: ['The worksheet asks for a low and a high you are 90% sure of for each part, and combines them. The ranges multiply, but the errors do not all land the same way: one part running high is no reason for another to run high. So the combined range is wider than any part, and much narrower than the product of the ends.'] },
        { table: { head: ['Part', 'Your range'], rows: parts.map((x, i) => [`Part ${i + 1}`, `${x.low} to ${x.high}`]).concat([['Worksheet range', `${times(comb.low)} to ${times(comb.high)}`], ['Every low times every high', `${naive.low} to ${naive.high.toLocaleString('en-US')}`]]) } },
        { p: ['The second range is so wide it says nothing. The first is one you can bet on, if each part was honest.'] },
      ];
    },
  },
  {
    id: 'multiply',
    title: 'Multiply the chain',
    blurb: 'Three 80% steps make 51%',
    blocks: () => [
      { p: ['A plan with three steps that each look 80% likely is not 80% likely. All three have to happen, so the chances multiply: ', { b: `0.8 × 0.8 × 0.8 = ${(chainProduct([0.8, 0.8, 0.8]) * 100).toFixed(0)}%` }, '. A story of five steps at 90% is ', { b: `${(chainProduct([0.9, 0.9, 0.9, 0.9, 0.9]) * 100).toFixed(0)}%` }, '.'] },
      { table: { head: ['Steps, each at', '2 steps', '3 steps', '5 steps'], rows: [0.95, 0.9, 0.8, 0.7].map((p) => [pct(p), ...[2, 3, 5].map((n) => pct(chainProduct(Array(n).fill(p))))]) } },
      { p: ['The trap is that every step looks safe on its own and the whole story feels as likely as its best step. It is never more likely than its weakest, and usually much less than either.'] },
      { p: ['In the journal, when a prediction needs several things to all happen, list them and give each its own chance, given the steps before it. The chain multiplier shows the product. Then ask whether your number is above it, and why.'] },
    ],
  },
  {
    id: 'parts',
    title: 'Where the parts come from',
    blurb: 'Each part gets its own honest range',
    blocks: () => [
      { p: ['A good part is one you can reason about without looking anything up: a count you can bracket, a share between 0 and 100, a factor like "doubled" or "halved". Give each part a range you would bet 19 to 1 on, using the same trick as a range question: build each end alone, and start from the cases like it.'] },
      { p: [{ b: 'Do not tune the parts to a total you already have in your head.' }, ' The point of the worksheet is that its answer can differ from your gut. When it does, one of them is wrong, and the reveal shows which part it was.'] },
      { p: ['The gym keeps score two ways. The worksheet\'s range has to hold the truth about nine times in ten, and when it misses, it should miss by a factor you could have lived with: the exam asks for a median miss within a factor of three.'] },
    ],
  },
];

// Unit 5 (outside view): start from how often this kind of thing happens.
export const RATE_LESSONS = [
  {
    id: 'outside',
    title: 'Start outside',
    blurb: 'How often does this happen to cases like it?',
    blocks: (S, cfg) => [
      { p: ['There are two ways in to any forecast. The inside view starts with this case: its details, its story, what you know about the people. The ', { b: 'outside view' }, ' starts with the cases like it: how often does this happen to them?'] },
      { p: ['The inside view is always more vivid and nearly always too sure. Start outside, with the share, then ask what is genuinely different here, and move only as far as that is worth.'] },
      { p: [`In Unit 5 you give a percent for a kind of case, and it counts when it lands within ${cfg.problems.rate.tolerance} points of what the record says. The exam is ${cfg.gates.rate_exam_calls} fresh problems; ${cfg.gates.rate_pass_within} of them must be within that distance.`] },
    ],
  },
  {
    id: 'ladder',
    title: 'How narrow a class',
    blurb: 'Narrow, but not under 30',
    blocks: (S, cfg) => [
      { p: ['A case belongs to many groups at once: all flights, flights from this airport, flights from this airport in January, flights from this airport in January in the morning. Which is the right one to start from?'] },
      { p: ['A narrower group is more like your case. But each cut takes cases away, and a share from a handful of cases is mostly noise. The rule of thumb: ', { b: `go down the ladder while the group still holds ${cfg.problems.rate.class_min_cases} or more cases, and stop there.` }] },
      { table: { head: ['Group', 'Cases', 'Share late'], rows: [['Every flight in the record', '20,000', '21.4%'], ['Left Tampa', '393', '19.6%'], ['Left Tampa in January', '123', '19.5%'], ['… in the morning', '34', '2.9%'], ['… and flew under 300 miles', '9', '11.1%']], } },
      { p: ['The last two shares jump around because they are built on so few cases. The group of 34 is the narrowest one worth trusting.'] },
    ],
  },
  {
    id: 'record',
    title: 'Your own record is a class',
    blurb: 'The planning fallacy and your own base rate',
    blocks: () => [
      { p: ['For your own tasks and deadlines, the best reference class is usually you: how often have the things you planned finished on time? People who plan from the details of the task are too sure, again and again, because the details never include the delays that come from outside.'] },
      { p: ['Mark a journal prediction as about your own task, and the Mirror will keep a record of how those did. When the record says you are too sure, start from the record: if your last ten estimates were met six times, 60% is where you begin.'] },
      { p: ['Projects are famous for this. Olympic Games cost more than budgeted every time, and nine in ten megaprojects run over. Your own project is rarely the exception, whatever its details.'] },
    ],
  },
  {
    id: 'blind',
    title: 'Defer where you lose',
    blurb: 'When your edge is below zero',
    blocks: () => [
      { p: ['The journal compares each prediction with a baseline: the plain base rate. If, over your last 30 resolved cards in one domain, you have earned less than zero, a forecast that just said the baseline would have done better.'] },
      { p: [{ b: 'Defer there, for now.' }, ' Start from the base rate and move away from it only with a logged piece of evidence, one at a time, until the record says your adjustments are worth something.'] },
      { p: ['It is not a verdict on you, only on this domain for the moment. The drill is a set of base-rate problems in that domain: practice at the part you skip.'] },
    ],
  },
];

// The lesson a pattern flag opens: the Unit 1 card that teaches the pattern (L01 to L03), one more card for soft questions, and a Unit 3 card for each range pattern.
export const FLAG_CARD = { L01: 'price99', L02: 'knowmore', L03: 'fifty', L04: 'stranger', L05: 'ends', L06: 'price', L07: 'multiply', L08: 'record', L09: 'outside', L10: 'steps', L11: 'worth', L12: 'memory', L13: 'blind', L14: 'tens' };
export const STRANGER = {
  id: 'stranger',
  title: 'Could a stranger score this?',
  blurb: 'The clairvoyant test',
  blocks: () => [
    { p: ['A prediction is only worth keeping if a stranger could score it without asking what you meant. Picture a clairvoyant who knows exactly what will happen. Could they answer your claim with a plain yes or no?'] },
    { p: ['“The launch will go well” fails: the clairvoyant has to ask what well means. “By 1 March 2027 the launch page will have at least 5,000 sign-ups” passes: there is a date, a thing to count and a number to beat.'] },
    { p: ['Three habits fix most soft claims. ', { b: 'Name the date.' }, ' ', { b: 'Name the count or the event.' }, ' ', { b: 'Say something that happens outside your head.' }] },
    { p: ['The checker catches the common ones: no date, a vague word such as better or soon, a feeling in place of an event. When it flags a claim, rewrite it until the clairvoyant could answer.'] },
  ],
};
export const UPDATE_LESSONS = [
  {
    id: 'steps',
    title: 'Move in measured steps',
    blurb: 'News is worth a move, not a leap',
    blocks: (S, cfg) => [
      { p: ['New information should change a forecast, and by how much matters as much as which way. The two mistakes mirror each other: ', { b: 'anchoring' }, ' (barely moving when the news is big) and ', { b: 'whiplash' }, ' (swinging hard on every headline).'] },
      { p: ['The yardstick is the record. When news narrows a case to a smaller group, the right new number is that group\'s own share. Sometimes that is a long way from where you started. Sometimes it is nowhere at all.'] },
      { p: [`In Unit 6 you see the rate before the news, the news, and you type the new percent. It counts when it lands within ${cfg.problems.update.tolerance} points of the group's real rate. The exam is ${cfg.gates.update_exam_calls} fresh steps: ${cfg.gates.update_pass_within} within that distance, and on average your moves must not end further from the truth than staying put would have.`] },
    ],
  },
  {
    id: 'worth',
    title: 'How much is news worth',
    blurb: 'A detail can feel big and be worth nothing',
    blocks: () => [
      { p: ['Take a flight from Baltimore: 23.2% of the 921 in the record landed 15 or more minutes late. Add that it left before 10 in the morning and the share falls to 8.5% (246 flights): a big move. Add instead that it flew on a weekday and it stays at 23.0% (691 flights): no move at all, though both details felt like they should matter.'] },
      { p: ['Ask two things of any piece of news: ', { b: 'does it separate the cases that end one way from those that end the other?' }, ' and ', { b: 'is it new, or already inside the rate you started from?' }, ' News that does neither is worth about nothing, however vivid.'] },
      { p: ['A good habit: say the move before you make it. "This is worth about five points up." Then check, after the fact, whether it was.'] },
    ],
  },
  {
    id: 'reason',
    title: 'Update with a reason',
    blurb: 'Change the number, write down why',
    blocks: (S, cfg) => [
      { p: ['On a journal card that is still open you can change your number. The original stays on the record. Each day the card was open is scored at the number in force that day, so a good update earns its share and a bad one costs it.'] },
      { p: ['Every update needs a reason of a line or two: what happened that you did not know. The reason is what lets you judge, later, whether your updates are worth making: the Mirror adds them up as the value of your updates.'] },
      { p: [`Two patterns watch for the failures. Frozen forecasts: open cards with news in the weekly review but no update in a week. Whiplash: big moves that you reversed within ${cfg.problems.update.update_rule.reverse_days} days.`] },
    ],
  },
];

// Units 7 to 9 (know yourself): argue against yourself, read your own record honestly, turn a forecast into a choice.
export const SECOND_LESSONS = [
  {
    id: 'counter',
    title: 'Argue against yourself',
    blurb: 'The case against, before reality writes it',
    blocks: (S, cfg) => [
      { p: ['Every journal card already asks for a case against. In Unit 7 the weekly review reads it and grades it: ', { b: 'sound' }, ' (a specific reason the claim could be false that your own evidence does not already answer), ', { b: 'weak' }, ' or ', { b: 'missing' }, '.'] },
      { p: ['A good case against is something you could check, that bears on the outcome, and that your number has not already allowed for. "Things can go wrong" is a mood. "Of the last twelve like it, three finished on time" is an argument.'] },
      { p: [`The exam is ${cfg.gates.counter_exam_calls} fresh problems where you pick the strongest counter-argument out of four: ${cfg.gates.counter_pass_right} must be right. The wrong options are the ones people really write: a point that supports the claim, a true fact beside the point, a tiny risk, and a vague worry.`] },
    ],
  },
  {
    id: 'second',
    title: 'Two numbers, not one',
    blurb: 'A gut number first, a final number after the chain',
    blocks: () => [
      { p: ['From Unit 7 a journal card asks for your gut number first, before you write anything else, and your final number after the outside view, the evidence and the case against. Both are kept. When the card resolves, the Mirror shows which was closer on average.'] },
      { p: ['If the final number is no better than the gut one, the chain is decoration. If it is better, you now have proof that writing it down is worth the minutes.'] },
      { p: ['Practice asks the same thing in miniature: a counter-argument arrives that is, say, three times as likely if you are wrong as if you are right. The right second number is the one the odds give, not "stay put" and not "halve it".'] },
    ],
  },
];
export const AUTOPSY_LESSONS = [
  {
    id: 'process',
    title: 'Judge the decision, not the result',
    blurb: 'Good process, bad luck. Bad process, good luck.',
    blocks: (S, cfg) => [
      { p: ['A result tells you two things at once: what the person knew and did, and what luck did. A good outcome after careless reasoning was luck, and will not repeat. A bad outcome after careful reasoning was bad luck, and the same care is still the right way.'] },
      { p: ['From Unit 8 on, ', { b: 'every case that resolves gets an autopsy' }, ': the hits too, since being right for the wrong reason is how a record flatters you. The Unit 8 problems practise telling luck from judgment by reading how the call was made.'] },
      { p: [`The exam is ${cfg.gates.luck_exam_calls} fresh cases: ${cfg.gates.luck_pass_right} must be right, and your memory of your own forecasts must stay within ${cfg.gates.memory_drift_max * 100} points.`] },
    ],
  },
  {
    id: 'memory',
    title: 'What did you actually say?',
    blurb: 'Hindsight rewrites the record in your head',
    blocks: (S, cfg) => [
      { p: ['After an outcome is known, people remember having been closer to it than they were. "I always thought so." The record says otherwise, which is why you keep one.'] },
      { p: ['From Unit 8 a due card asks ', { b: 'what number did you lock?' }, ' before it shows the record. Only then does the real number appear, with your drift: how far your memory moved toward what happened. Practice asks the same of old gym calls.'] },
      { p: [`Over ${cfg.lessons.triggers.L12.window} checks, memory that sits ${cfg.lessons.triggers.L12.min_shift * 100} points or more closer to the outcome than the record opens a pattern. The cure is the habit: write the number down before you look, and check it afterwards.`] },
    ],
  },
];
export const DECISION_LESSONS = [
  {
    id: 'break',
    title: 'The break-even line',
    blurb: 'Act above it, hold below it',
    blocks: () => [
      { p: ['A forecast is not a decision. To decide, you need what you gain if you act and are right, and what you lose if you act and are wrong. Acting pays on average when your chance is above ', { b: 'loss ÷ (gain + loss)' }, '.'] },
      { p: ['Gain 30, lose 10: the line is 10 ÷ 40, a quarter. A 30% chance is enough. Gain 10, lose 30: the line is three quarters, and a 70% chance is not.'] },
      { p: ['The line is not fifty-fifty unless the stakes are equal. Most bad decisions are made at the wrong line, not the wrong forecast.'] },
    ],
  },
  {
    id: 'value',
    title: 'Weigh each result by its chance',
    blurb: 'What a choice is worth on average',
    blocks: () => [
      { p: ['The average value of acting is the gain times the chance it works, minus the loss times the chance it does not. At 40% with a gain of 30 and a loss of 70: 12 minus 42, which is minus 30. A choice can feel exciting and be worth less than nothing.'] },
      { p: ['Common slips: counting only the gain, using the same chance for both sides, or averaging the gain and the loss as if they were equally likely.'] },
    ],
  },
  {
    id: 'review',
    title: 'Decide, then review',
    blurb: 'A decision card with a review date',
    blocks: (S, cfg) => [
      { p: ['A decision card holds what you will do, your forecast, what you stand to gain and lose, and a review date at least ', String(cfg.decision.min_review_days), ' days out. The break-even line is worked out for you; you still choose.'] },
      { p: ['On the review date the card comes due. You say what happened and whether you would decide the same again. The Mirror then shows how often you followed your own line, and what following it would have paid compared with what you chose.'] },
    ],
  },
];
export const FINE_LESSONS = [
  {
    id: 'sharp',
    title: 'The sharp rule',
    blurb: 'Points that punish a sure miss without mercy',
    blocks: (S, cfg) => [
      { p: ['Unit 10 swaps the dial for a finer one, in steps of 1% from 50 to 99, and the calls are scored by the ', { b: 'sharp rule' }, ': 100 × (1 + log₂ p), where p is the chance you gave to what happened. A flat 50% scores 0; 99% right pays ', String(S.points('log_points', 0.99)), '.'] },
      { p: ['The price of being wrong is steep: at 99% a miss costs ', String(-S.points('log_points', 0.01)), '. At 95% it costs ', String(-S.points('log_points', 0.05)), '; at 90%, ', String(-S.points('log_points', 0.1)), '. That is why 100% is not on the dial. Saying exactly what you believe is still the best policy, but the sharp rule makes the gap between 96% and 99% worth real points.'] },
      { p: ['These calls are scored on this scale only in Unit 10. In the ledger they count at the core rule, so your level never swings on one 1% call.'] },
    ],
  },
  {
    id: 'tails',
    title: 'The tails are where the points are',
    blurb: 'Rare events, and the figure the record gives',
    blocks: (S, cfg) => [
      { p: ['Unit 10 questions are all in the tails: a flight at least three hours late, a month when the market falls 8%, a day with 20 mm of rain. The record says how often. Most of the time the answer is "no, at 96% or 98%".'] },
      { p: ['Two mistakes cost the most. The first is rounding to 99% because it feels sure: a claim that holds 97 times in 100 is wrong three times in a hundred, and the sharp rule charges ', String(-S.points('log_points', 0.01)), ' for each of them. The second is saying 90% because the true figure feels too small to type.'] },
      { p: [`The exam is ${cfg.gates.fine_exam_calls} fresh calls in sittings of ${cfg.gates.fine_sitting}. Your average confidence must be within ${cfg.gates.fine_index_tolerance * 100} points of the share you got right. After each practice call the reveal shows what the base rate alone would have scored.`] },
    ],
  },
  {
    id: 'tens',
    title: 'Sixty or sixty-five',
    blurb: 'Round numbers hide real differences',
    blocks: (S, cfg) => [
      { p: ['A number ending in zero is easy to say and easy to defend. It is also a way of not deciding: 90 could mean 87 or 93, and over many calls that coarseness costs about as much as a small bias.'] },
      { p: [`If more than ${cfg.lessons.triggers.L14.min_share * 100}% of your last ${cfg.lessons.triggers.L14.window} fine calls sit on a multiple of ten, the pattern opens. The drill locks the multiples of ten for ${cfg.lessons.triggers.L14.drill.calls} calls: say 63 or 67, whichever you mean.`] },
      { p: ['The rule is not "avoid zeros". It is "give the number you actually believe". Two re-tests clear it: fewer than ', String(cfg.lessons.triggers.L14.clear_below * 100), '% round on the next ', String(cfg.lessons.triggers.L14.clear_window), '.'] },
    ],
  },
];
const ALL_LISTS = [LESSONS, RANGE_LESSONS, FERMI_LESSONS, RATE_LESSONS, UPDATE_LESSONS, SECOND_LESSONS, AUTOPSY_LESSONS, DECISION_LESSONS, FINE_LESSONS];
export const flagCard = (trigger) => (trigger === 'L04' ? STRANGER : ALL_LISTS.flat().find((l) => l.id === FLAG_CARD[trigger]) || null);
// Every card the Path can open, with the list it belongs to.
export const cardList = (id) => ALL_LISTS.find((list) => list.some((l) => l.id === id)) || null;
export const cardUnit = (id) => (LESSONS.some((l) => l.id === id) ? 'Unit 1 · Calibration' : RANGE_LESSONS.some((l) => l.id === id) ? 'Unit 3 · Ranges' : FERMI_LESSONS.some((l) => l.id === id) ? 'Unit 4 · Fermi' : RATE_LESSONS.some((l) => l.id === id) ? 'Unit 5 · Outside view' : UPDATE_LESSONS.some((l) => l.id === id) ? 'Unit 6 · Updating' : SECOND_LESSONS.some((l) => l.id === id) ? 'Unit 7 · Second opinions' : AUTOPSY_LESSONS.some((l) => l.id === id) ? 'Unit 8 · Autopsy' : FINE_LESSONS.some((l) => l.id === id) ? 'Unit 10 · Fine grain' : 'Unit 9 · Decisions');

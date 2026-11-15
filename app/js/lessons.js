// The four Unit 1 lesson cards. Every number in them is computed from the payout table at the moment the card is
// drawn (data/scoring.json through the scoring engine), so the text can never disagree with the game.
// A block is a paragraph (strings and {b: bold} parts), a table, or the equivalent-bet wheel.
import { signed, pct } from './engine/scoring.js';

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

// The lesson a pattern flag opens: the Unit 1 card that teaches the pattern (L01 to L03), one more card for soft questions, and a Unit 3 card for each range pattern.
export const FLAG_CARD = { L01: 'price99', L02: 'knowmore', L03: 'fifty', L04: 'stranger', L05: 'ends', L06: 'price' };
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
export const flagCard = (trigger) => (trigger === 'L04' ? STRANGER : LESSONS.concat(RANGE_LESSONS).find((l) => l.id === FLAG_CARD[trigger]) || null);
// Every card the Path can open, with the list it belongs to.
export const cardList = (id) => (LESSONS.some((l) => l.id === id) ? LESSONS : RANGE_LESSONS.some((l) => l.id === id) ? RANGE_LESSONS : null);

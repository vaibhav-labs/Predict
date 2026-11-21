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

// The lesson a pattern flag opens: the Unit 1 card that teaches the pattern (L01 to L03), and one more card for soft questions.
export const FLAG_CARD = { L01: 'price99', L02: 'knowmore', L03: 'fifty', L04: 'stranger' };
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
export const flagCard = (trigger) => (trigger === 'L04' ? STRANGER : LESSONS.find((l) => l.id === FLAG_CARD[trigger]) || null);

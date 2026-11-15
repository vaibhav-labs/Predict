// Unit 11, With the machine (Block 10): world questions the player forecasts twice, around a look at Predict's own number.
//   1. `world` state first: the player locks a number (1% dial) before Predict's number is shown.
//   2. Predict's number appears; `world` state final: the player locks the number they will stand by. The final event keeps what they saw (`machine`).
//   3. On the due day the player says what happened: `world` state resolve (yes | no | void), with Predict's checked result and source if it has one.
// All three are scored with the sharp (log) rule from the same chance of yes: p >= 50% is a call on yes at p, below is a call on no at 1 - p.
// Predict's number comes from the coach file (coach.forecasts). It is written before the question opens (the coach parser refuses one that is not), and the
// app does not show it until the player's first number is locked.
import { sharp } from './fine.js';

const r2 = (x) => Math.round(x * 100) / 100;

// The chance of yes `p` against what happened (`yes` true or false), as sharp points. p is a whole percent between 1 and 99.
export function worldPoints(S, p, yes) {
  const py = r2(p);
  const side = py >= 0.5;
  const c = side ? py : r2(1 - py);
  return sharp(S, c, side === yes);
}

export const worldEvents = (events) => events.filter((e) => e.type === 'world');

// Every question the player has touched or can see, in the order they opened. `coach.forecasts` is the file's current set; questions the player already
// started keep their text, due day and Predict's number from the record, so a new file that no longer lists one changes nothing.
export function worldQuestions(events, coach, today) {
  const byId = new Map();
  const get = (id) => { if (!byId.has(id)) byId.set(id, { id, text: null, due: null, opens: null, machine: null, machineRef: null, machineWritten: null, first: null, final: null, resolve: null, listed: false }); return byId.get(id); };
  for (const [id, f] of Object.entries((coach && coach.forecasts) || {})) {
    if (f.opens > today) continue; // not open yet: its number stays out of every list
    const q = get(id);
    Object.assign(q, { text: f.text, due: f.due, opens: f.opens, machine: f.p, machineRef: f.ref, machineWritten: f.written, listed: true, predictResult: f.result, predictSource: f.source, predictChecked: f.checked });
  }
  for (const e of worldEvents(events)) {
    const q = get(e.id);
    if (e.state === 'first' && !q.first) { q.first = e; q.text = q.text || e.text; q.due = q.due || e.due; q.opens = q.opens || e.opens; }
    else if (e.state === 'final' && q.first && !q.final) { q.final = e; q.machine = e.machine; q.machineWritten = e.machineWritten || q.machineWritten; q.machineRef = e.machineRef || q.machineRef; }
    else if (e.state === 'resolve' && q.final && !q.resolve) q.resolve = e;
  }
  const list = [...byId.values()].filter((q) => q.text && q.due);
  for (const q of list) {
    q.state = q.resolve ? 'resolved' : q.final ? (q.due <= today ? 'due' : 'waiting') : q.first ? (q.due <= today ? 'lapsed' : 'reveal') : q.due <= today ? 'expired' : 'open';
  }
  return list.sort((a, b) => (a.opens || '') < (b.opens || '') ? -1 : (a.opens || '') > (b.opens || '') ? 1 : a.id < b.id ? -1 : 1);
}

// Points for one resolved question (void ones carry none): { first, final, machine }.
export function worldScores(S, q) {
  if (!q.resolve || q.resolve.outcome === 'void') return null;
  const yes = q.resolve.outcome === 'yes';
  return { first: worldPoints(S, q.first.p, yes), final: worldPoints(S, q.final.p, yes), machine: worldPoints(S, q.machine, yes) };
}

// The Unit 11 measure: over `gates.world_resolved` resolved questions that carry both of the player's forecasts and Predict's, the final forecasts score
// at least as well as the first ones and as Predict's alone (mean sharp points). It is read live, not sat as an exam.
export function worldGate(S, questions, gates) {
  const scored = questions.map((q) => worldScores(S, q)).filter(Boolean);
  const n = scored.length;
  const mean = (k) => (n ? scored.reduce((s, x) => s + x[k], 0) / n : null);
  const first = mean('first'), final = mean('final'), machine = mean('machine');
  const needed = gates.world_resolved;
  const ready = n >= needed;
  const beatsFirst = ready && final >= first;
  const beatsMachine = ready && final >= machine;
  return { n, needed, ready, first, final, machine, beatsFirst, beatsMachine, passed: beatsFirst && beatsMachine, voided: questions.filter((q) => q.resolve && q.resolve.outcome === 'void').length };
}

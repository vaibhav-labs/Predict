// The player's record: an append-only log of small events, one per call, session, flag and so on.
// Everything here is a pure function of that log, so any number on screen can be recomputed from it,
// importing a backup can never count anything twice (events are matched by id), and the file Predict
// reads is just the log written out. No page, no storage in this file.

export const FORMAT = 'predict-record';
export const FORMAT_VERSION = 1;

// ---- making events -------------------------------------------------------------------------------------

export function makeId(now = Date.now(), rand = defaultRandom) {
  // Starts with the time so ids sort by time; ends with random hex so two phones never collide.
  return `${now.toString(36).padStart(9, '0')}-${rand()}`;
}
function defaultRandom() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    return Array.from(c.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.floor(Math.random() * 2 ** 40).toString(16).padStart(10, '0');
}

export function localDay(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// t is the exact time (UTC), d is the player's local calendar day: streaks and "Day N" follow the player's day.
export function makeEvent(type, fields = {}, date = new Date(), rand = defaultRandom) {
  // A field that is undefined is left out, so the event in storage and the same event in an Export file are identical.
  const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  return { id: makeId(date.getTime(), rand), t: date.toISOString(), d: localDay(date), type, ...given };
}

export const byTime = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- reading and writing files -------------------------------------------------------------------------

export function toJSONL(events, { exported = new Date(), build = '' } = {}) {
  const header = { type: 'header', format: FORMAT, version: FORMAT_VERSION, exported: exported.toISOString(), events: events.length, build };
  return [header, ...events].map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// Valid lines become events; anything else is reported by line number and skipped.
export function parseJSONL(text) {
  const events = [], errors = [];
  let header = null;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let obj;
    try { obj = JSON.parse(line); } catch { errors.push({ line: i + 1, message: 'not valid JSON' }); return; }
    if (obj && obj.type === 'header' && obj.format === FORMAT) { header = obj; return; }
    if (!obj || typeof obj !== 'object' || typeof obj.id !== 'string' || typeof obj.type !== 'string' || typeof obj.t !== 'string') {
      errors.push({ line: i + 1, message: 'missing id, type or time' });
      return;
    }
    events.push(obj);
  });
  return { events, errors, header };
}

// Merge by id: an event already in the record is never counted twice, and an existing event is never overwritten.
export function mergeEvents(existing, incoming) {
  const have = new Set(existing.map((e) => e.id));
  const added = [];
  for (const e of incoming) {
    if (have.has(e.id)) continue;
    have.add(e.id);
    added.push(e);
  }
  const merged = existing.concat(added).sort(byTime);
  return { merged, added, skipped: incoming.length - added.length };
}

const CSV_COLUMNS = ['time', 'day', 'session', 'mode', 'unit', 'question', 'claim', 'domain', 'difficulty', 'side', 'confidence', 'truth', 'right', 'points', 'ms'];
const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function callsToCSV(events) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    if (e.type !== 'call') continue;
    lines.push([e.t, e.d, e.session, e.mode, e.unit, e.q, e.claim, e.domain, e.diff, e.side, e.c, e.truth ? 'yes' : 'no', e.hit ? 'right' : 'wrong', e.points, e.ms].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---- reading the log -----------------------------------------------------------------------------------

// An exam is judged once, at the end. Until its verdict is in, its calls are sealed: nothing the player sees (the Mirror,
// the points, a lesson trigger) may carry what they scored, so `callsOf` leaves them out. `allCallsOf` is everything on file.
export const judgedExams = (events) => new Set(events.filter((e) => e.type === 'exam' && e.state === 'result').map((e) => e.exam));
// A range of an exam is sealed in the same way (Unit 3's exam, 60 ranges, is judged once at the end).
export const isSealed = (e, judged) => (e.type === 'call' || e.type === 'range' || e.type === 'prob') && !!e.exam && !judged.has(e.exam);
export const allCallsOf = (events) => events.filter((e) => e.type === 'call');
export function callsOf(events) {
  const judged = judgedExams(events);
  return events.filter((e) => e.type === 'call' && !isSealed(e, judged));
}
export const usedQuestionIds = (events) => new Set(allCallsOf(events).map((e) => e.q));
// Ranges (Unit 3): `range` events, one per range question locked. Kept apart from calls so the calibration curve, the points
// per call and the gym's open-session logic never read them.
export const allRangesOf = (events) => events.filter((e) => e.type === 'range');
export function rangesOf(events) {
  const judged = judgedExams(events);
  return events.filter((e) => e.type === 'range' && !isSealed(e, judged));
}
// Problems (Units 4 and 5): `prob` events, one per Fermi, base-rate, class or chain problem locked. Exam problems are sealed until judged.
export const allProbsOf = (events) => events.filter((e) => e.type === 'prob');
export function probsOf(events) {
  const judged = judgedExams(events);
  return events.filter((e) => e.type === 'prob' && !isSealed(e, judged));
}
export const disputedIds = (events) => new Set(events.filter((e) => e.type === 'dispute').map((e) => e.q));
// Questions answered within the last `days` days (today counts as day 0): the 90-day rule keeps them from coming back.
export function recentQuestionIds(events, today, days) {
  return new Set(allCallsOf(events).filter((c) => daysBetween(c.d, today) < days).map((c) => c.q));
}
export const lessonsRead = (events) => new Set(events.filter((e) => e.type === 'lesson').map((e) => e.lesson));

// A session is open from its session event until its session_end event.
export function sessionsOf(events) {
  const list = events.filter((e) => e.type === 'session').map((s) => ({ ...s, calls: [], skipped: [], ended: false }));
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const e of events) {
    const s = byId.get(e.session);
    if (!s) continue;
    if (e.type === 'call') s.calls.push(e);
    else if (e.type === 'skip') s.skipped.push(e.q);
    else if (e.type === 'session_end') s.ended = true;
  }
  return list;
}
export function activeSession(events) {
  const open = sessionsOf(events).filter((s) => !s.ended);
  return open.length ? open[open.length - 1] : null;
}

export function baselineProgress(events, total) {
  const done = callsOf(events).filter((e) => e.mode === 'baseline').length;
  return { done: Math.min(done, total), total, complete: done >= total };
}

// The last full backup (the .jsonl Export). A spreadsheet copy of the calls does not count as a backup.
export function lastExport(events) {
  const ex = events.filter((e) => e.type === 'export' && e.kind !== 'csv');
  return ex.length ? ex[ex.length - 1] : null;
}

const dayIndex = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const daysBetween = (a, b) => dayIndex(b) - dayIndex(a);
// A calendar day written as YYYY-MM-DD, moved by n days (n may be negative). Pure calendar arithmetic, no time zones.
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// Day 1 is the day of the first call. Before any call, today is Day 1.
export function dayNumber(events, today) {
  const calls = callsOf(events);
  if (!calls.length) return 1;
  return Math.max(1, daysBetween(calls[0].d, today) + 1);
}

// A journal card: one `prediction` event (written once, at lock, and never changed) plus, once it
// resolves, one `resolve` event that carries the outcome. `today` decides open vs due, so this is a
// pure function of the log and the clock, like dayNumber above.
export function predictionsOf(events, today = localDay()) {
  const resolves = new Map(events.filter((e) => e.type === 'resolve').map((e) => [e.prediction, e]));
  // The player's updates of an open card (Block 8), oldest first: each carries the probability it set and the one it replaced.
  const updates = new Map();
  for (const e of events) if (e.type === 'update') { if (!updates.has(e.prediction)) updates.set(e.prediction, []); updates.get(e.prediction).push(e); }
  // Predict's own number for a card (a `baseline` event, written when it arrived before the due day) replaces the locked baseline for
  // scoring and shows as its source. The first one wins; the number locked with the card stays on it as `b0`.
  const adopted = new Map();
  for (const e of events) if (e.type === 'baseline' && !adopted.has(e.prediction)) adopted.set(e.prediction, e);
  return events.filter((e) => e.type === 'prediction').map((p0) => {
    const a0 = adopted.get(p0.id), r0 = resolves.get(p0.id);
    const a = a0 && (!r0 || a0.t < r0.t) ? a0 : null; // a number that arrives after the card resolved changes nothing
    const p = a ? { ...p0, b: a.b, bSource: 'predict', b0: p0.b, bRef: a.ref } : p0;
    const r = resolves.get(p.id);
    const state = r ? 'resolved' : p.due <= today ? 'due' : 'open';
    const ups = (updates.get(p.id) || []).slice().sort(byTime);
    return { ...p, updates: ups, cNow: ups.length ? ups[ups.length - 1].c : p.c, state, ...(r && r.source ? { source: r.source, checkedDay: r.checked } : {}), outcome: r ? r.outcome : null, note: r ? r.note : undefined, raw: r ? r.raw : null, edge: r ? r.edge : null, ...(r && typeof r.edge0 === 'number' ? { raw0: r.raw0, edge0: r.edge0, days: r.days } : {}), resolvedAt: r ? r.t : undefined };
  }).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : byTime(a, b)));
}
export const dueList = (predictions) => predictions.filter((p) => p.state === 'due');
export const openList = (predictions) => predictions.filter((p) => p.state === 'open');
export const resolvedList = (predictions) => predictions.filter((p) => p.state === 'resolved');

// Whether today already has a scored prediction (one scored card a day; extras are logged unscored).
export function scoredToday(predictions, today = localDay()) {
  return predictions.some((p) => p.d === today && p.scored);
}

// The player's own rate for a domain and horizon, from resolved real predictions (void excluded): used
// as the baseline once there is enough history (data/scoring.json journal.own_rate_min_resolved).
export function ownBaseRate(predictions, domain, horizon) {
  const rows = resolvedList(predictions).filter((p) => p.domain === domain && p.horizon === horizon && p.outcome !== 'void');
  if (!rows.length) return { n: 0, rate: null };
  const yes = rows.filter((p) => p.outcome === 'yes').length;
  return { n: rows.length, rate: yes / rows.length };
}

// ---- statistics: every number carries its sample size --------------------------------------------------

export function summarize(calls) {
  const n = calls.length;
  if (!n) return { n: 0, hits: 0, hitRate: null, meanConf: null, gap: null, points: 0, avgPoints: null };
  const hits = calls.filter((c) => c.hit).length;
  const meanConf = calls.reduce((s, c) => s + c.c, 0) / n;
  const points = calls.reduce((s, c) => s + c.points, 0);
  return { n, hits, hitRate: hits / n, meanConf, gap: meanConf - hits / n, points, avgPoints: points / n };
}

// Calibration curve: group calls by stated confidence into bands (edges from data/scoring.json).
// A call at exactly an upper edge belongs to the next band; the last band includes 1.0.
export function calibration(calls, edges, thinBelow) {
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1], last = i === edges.length - 2;
    const inBand = calls.filter((c) => c.c >= lo - 1e-9 && (last ? c.c <= hi + 1e-9 : c.c < hi - 1e-9));
    const s = summarize(inBand);
    bands.push({ lo, hi, n: s.n, hits: s.hits, meanConf: s.meanConf, hitRate: s.hitRate, thin: s.n < thinBelow });
  }
  return bands;
}

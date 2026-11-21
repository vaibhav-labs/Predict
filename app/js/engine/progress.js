// Feedback, never play: the daily ledger, the streak, habit points, career points, the level and the seven-day score.
// Pure functions of the event log and the clock, like the rest of app/js/engine/. Every number comes from data/scoring.json
// ("habit" and "levels") and data/belts.csv, so a balance pass is a data edit.
import { addDays, daysBetween, judgedExams, isSealed } from './record.js';
import { roundHalfEven } from './scoring.js';

// A day is played when the player did something that scores or counts: a call, a locked prediction, a resolved one.
// Reading a lesson or opening the app does not count, so a streak can only be kept by doing the work.
const PLAYED = new Set(['call', 'range', 'prob', 'prediction', 'resolve', 'update', 'memory', 'decision', 'decision_review']);
const MAX_SPAN_DAYS = 5000; // a record with an absurd date (a phone clock gone wrong) must not hang the screen

// One row per calendar day from the first played day to today, with the streak after that day, the habit points
// that day paid, the skill points (calls plus journal edge) and the running totals.
//   habit points = session_points + streak_bonus_per_day * min(streak, streak_bonus_cap_days), once per played day
//   a missed day keeps floor(streak * streak_cool_fraction) of the streak; today is never a miss while it is still going
//   career points are a high-water mark: the best running total so far, so a bad day can never lower a level
export function ledger(events, today, habit) {
  const per = new Map();
  const judged = judgedExams(events);
  for (const e of events) {
    if (!PLAYED.has(e.type) || typeof e.d !== 'string') continue;
    let row = per.get(e.d);
    if (!row) { row = { d: e.d, calls: 0, callPoints: 0, edgePoints: 0 }; per.set(e.d, row); }
    // A call of an exam not yet judged keeps the day played but pays nothing yet (its score is sealed).
    if (e.type === 'call' || e.type === 'range' || e.type === 'prob') { row.calls += 1; if (!isSealed(e, judged)) row.callPoints += e.points; }
    else if (e.type === 'resolve' && typeof e.edge === 'number') row.edgePoints += e.edge;
  }
  const empty = { rows: [], byDay: new Map(), streak: 0, todayPlayed: false, total: 0, career: 0, habitTotal: 0, skillTotal: 0 };
  const played = [...per.keys()].sort();
  if (!played.length) return empty;
  const first = played[0];
  let end = played[played.length - 1] > today ? played[played.length - 1] : today;
  if (daysBetween(first, end) > MAX_SPAN_DAYS) end = addDays(first, MAX_SPAN_DAYS);

  const rows = [];
  let streak = 0, cumulative = 0, hwm = 0, habitTotal = 0, skillTotal = 0;
  for (let d = first; d <= end; d = addDays(d, 1)) {
    const base = per.get(d);
    const isPlayed = !!base;
    let habitPts = 0;
    if (isPlayed) {
      streak += 1;
      habitPts = habit.session_points + habit.streak_bonus_per_day * Math.min(streak, habit.streak_bonus_cap_days);
    } else if (d < end) {
      streak = Math.floor(streak * habit.streak_cool_fraction);
    }
    const row = base || { d, calls: 0, callPoints: 0, edgePoints: 0 };
    const skill = row.callPoints + row.edgePoints;
    cumulative += skill + habitPts;
    hwm = Math.max(hwm, cumulative);
    habitTotal += habitPts;
    skillTotal += skill;
    rows.push({ d, played: isPlayed, calls: row.calls, callPoints: row.callPoints, edgePoints: row.edgePoints, skill, habit: habitPts, streak, total: skill + habitPts, cumulative, career: hwm });
  }
  return { rows, byDay: new Map(rows.map((r) => [r.d, r])), streak, todayPlayed: per.has(today), total: cumulative, career: hwm, habitTotal, skillTotal };
}

// ---- levels: 140 * L^1.2 points to climb from level L to L+1 (data/scoring.json "levels", data/levels.csv) ----------------
export const levelCost = (L, cfg) => roundHalfEven(cfg.base * L ** cfg.exp);
export function levelInfo(points, cfg) {
  let level = 1, floor = 0;
  while (floor + levelCost(level, cfg) <= points) { floor += levelCost(level, cfg); level += 1; }
  const cost = levelCost(level, cfg);
  return { level, floor, cost, into: points - floor, toNext: cost - (points - floor) };
}

// ---- the seven-day score -----------------------------------------------------------------------------------------------
// The last seven calendar days ending today, skill points only (habit points are not skill). The average is per played
// day, so a missed day does not drag it down (missing days is the streak's job). `beating` compares today with the
// seven days before today, and is null until there is something to compare with.
export function sevenDay(led, today, span = 7) {
  const rowOf = (d) => led.byDay.get(d) || { d, played: false, calls: 0, skill: 0 };
  const window = (endDay) => Array.from({ length: span }, (_, i) => rowOf(addDays(endDay, i - (span - 1))));
  const sum = (rows) => {
    const played = rows.filter((r) => r.played);
    const total = played.reduce((a, r) => a + r.skill, 0);
    return { days: rows, played: played.length, calls: rows.reduce((a, r) => a + r.calls, 0), total, avgPerDay: played.length ? total / played.length : null };
  };
  const now = sum(window(today));
  const before = sum(window(addDays(today, -span)));
  const t = rowOf(today);
  return { ...now, previous: { played: before.played, total: before.total, avgPerDay: before.avgPerDay }, today: { played: !!t.played, skill: t.skill }, beating: t.played && before.avgPerDay !== null ? t.skill > before.avgPerDay : null };
}

// ---- belts ---------------------------------------------------------------------------------------------------------------
// Belts are feedback, not play (mechanics.md section 1). Each row says what is asked and how far along the player is, from
// facts the app can count today; a requirement that depends on a later block says "not measured yet" instead of guessing.
const unitNo = (id) => Number(String(id).replace('U', ''));
export function beltRows(belts, facts) {
  let prev = -1;
  return belts.map((b) => {
    const lastUnit = unitNo(b.after_unit);
    const units = Array.from({ length: Math.max(0, lastUnit - prev) }, (_, i) => `U${prev + 1 + i}`);
    prev = Math.max(prev, lastUnit);
    const need = Number(b.resolved_needed);
    const gatesDone = units.filter((u) => facts.gatesPassed.has(u)).length;
    const checks = [];
    if (units.length) checks.push({ label: `Gates ${units[0].replace('U', 'U')} to ${units[units.length - 1]}`, have: gatesDone, need: units.length });
    if (need) checks.push({ label: 'Resolved real predictions', have: facts.resolved, need });
    if (b.id === 'B2') {
      checks.push({ label: 'Total edge above zero', have: facts.totalEdge, need: 0, kind: 'above', ok: facts.totalEdge > 0 });
      checks.push({ label: 'Month-horizon results', have: facts.monthResolved, need: 20 });
    }
    if (b.id === 'B3') checks.push({ label: 'Calibration gap within 5 points', have: facts.gapPts === null ? null : Math.abs(facts.gapPts), need: 5, kind: 'within', ok: facts.gapPts !== null && Math.abs(facts.gapPts) <= 5 });
    if (b.id === 'B3' && facts.memoryDriftPts !== undefined) checks.push({ label: 'Memory drift within 5 points', have: facts.memoryDriftPts === null || facts.memoryDriftPts === undefined ? null : Math.abs(facts.memoryDriftPts), need: 5, kind: 'within', ok: facts.memoryDriftPts !== null && facts.memoryDriftPts !== undefined && Math.abs(facts.memoryDriftPts) <= 5 });
    const done = checks.length > 0 && checks.every((c) => (c.ok !== undefined ? c.ok : c.have >= c.need));
    return { id: b.id, belt: b.belt, title: b.title, text: b.requirements, checks, done, external: need === 0 && !units.length };
  });
}

// The coach's side of the record (design/mechanics.md 4.7), as pure functions: what the weekly review writes into the private
// repo is read here, checked, and cut down to the fields the app understands. Nothing from the repo is ever drawn as markup,
// only as text, and a field that does not pass its check is dropped rather than repaired.
//
// Layout of the private repo `Predict-data` (see design/coach.md):
//   record/<day>.jsonl     the player's events of one local day, pushed by the app, one JSON event a line
//   coach/latest.json      written by the weekly review, read by the app (the shape is checked by parseCoach below)
import { byTime } from './record.js';

export const COACH_VERSION = 1;
// The builder's name never appears in the app (the data check scans every file for it), so the pattern is spelled with escapes.
const BANNED = /cl\u0061ude|anthr\u006fpic/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DOMAINS = new Set(['work', 'life', 'world']);
const DUES = new Set(['tomorrow', 'week', 'month', 'longer']);
const RESULTS = new Set(['yes', 'no', 'void']);
const LIMITS = { title: 120, paragraph: 700, paragraphs: 12, drills: 6, drillText: 400, prompt: 220, perDay: 3, days: 14, read: 900, note: 300, ref: 160, ids: 400 };

const text = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max && !BANNED.test(v) ? v.trim() : null);
const day = (v) => (typeof v === 'string' && DAY.test(v) ? v : null);
// A written time (ISO) or a day: the day part is what the rules compare.
const dayOf = (v) => (typeof v === 'string' && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const httpsUrl = (v) => {
  if (typeof v !== 'string' || v.length > 400) return null;
  try { const u = new URL(v); return u.protocol === 'https:' && u.hostname.includes('.') ? u.href : null; } catch { return null; }
};

export function emptyCoach() {
  return { version: COACH_VERSION, week: null, written: null, letter: null, drills: [], prompts: [], baselines: {}, outcomes: {}, reads: {}, news: {}, dropped: 0 };
}

// Cut `raw` (parsed JSON of coach/latest.json, or anything) down to what is valid. `dropped` counts what was refused.
export function parseCoach(raw) {
  const out = emptyCoach();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== COACH_VERSION) { out.dropped = raw ? 1 : 0; return out; }
  const drop = () => { out.dropped += 1; };
  out.week = text(raw.week, 20);
  out.written = dayOf(raw.written);

  const L = raw.letter;
  if (L && typeof L === 'object') {
    const title = text(L.title, LIMITS.title);
    const paragraphs = Array.isArray(L.paragraphs) ? L.paragraphs.slice(0, LIMITS.paragraphs).map((x) => text(x, LIMITS.paragraph)) : [];
    if (title && paragraphs.length && paragraphs.every(Boolean)) out.letter = { title, paragraphs, sources: [] };
    else drop();
    if (out.letter && Array.isArray(L.sources)) {
      for (const s of L.sources.slice(0, 10)) {
        const label = text(s && s.label, 120), url = httpsUrl(s && s.url);
        if (label && url) out.letter.sources.push({ label, url }); else drop();
      }
    }
  } else if (L !== undefined) drop();

  for (const d of Array.isArray(raw.drills) ? raw.drills.slice(0, LIMITS.drills) : []) {
    const title = text(d && d.title, LIMITS.title), body = text(d && d.text, LIMITS.drillText);
    if (title && body) out.drills.push({ title, text: body }); else drop();
  }

  for (const entry of Array.isArray(raw.prompts) ? raw.prompts.slice(0, LIMITS.days) : []) {
    const d = day(entry && entry.day);
    const items = [];
    for (const it of Array.isArray(entry && entry.items) ? entry.items.slice(0, LIMITS.perDay) : []) {
      const t = text(it && it.text, LIMITS.prompt);
      if (!t) { drop(); continue; }
      items.push({ text: t, domain: DOMAINS.has(it.domain) ? it.domain : null, due: DUES.has(it.due) ? it.due : null });
    }
    if (d && items.length) out.prompts.push({ day: d, items }); else drop();
  }

  const entries = (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.entries(obj).slice(0, LIMITS.ids) : []);
  for (const [id, b] of entries(raw.baselines)) {
    const p = b && Number(b.p), written = dayOf(b && b.written), ref = text(b && b.ref, LIMITS.ref);
    if (typeof (b && b.p) === 'number' && p >= 0.01 && p <= 0.99 && written && ref && /^[\w-]+$/.test(id)) out.baselines[id] = { p: Math.round(p * 100) / 100, written, ref }; else drop();
  }
  for (const [id, o] of entries(raw.outcomes)) {
    const url = httpsUrl(o && o.source), checked = dayOf(o && o.checked);
    if (o && RESULTS.has(o.result) && url && checked && /^[\w-]+$/.test(id)) out.outcomes[id] = { result: o.result, source: url, checked, note: o.note === undefined ? null : text(o.note, LIMITS.note) };
    else drop(); // a checked outcome without a source link is not shown at all
  }
  for (const [id, r] of entries(raw.reads)) {
    const body = text(r && r.text, LIMITS.read), written = dayOf(r && r.written);
    if (body && written && /^[\w-]+$/.test(id)) out.reads[id] = { text: body, written }; else drop();
  }
  // News the weekly review found for an open prediction (Block 8): the card, a one-line note with its source, and the day it was written. Pattern L10
  // (frozen forecasts) counts the cards that had such news and were not updated afterwards. A note without a source link is not kept.
  for (const [id, n] of entries(raw.news)) {
    const body = text(n && n.text, LIMITS.read), written = dayOf(n && n.written), url = httpsUrl(n && n.source);
    if (body && written && url && /^[\w-]+$/.test(id)) out.news[id] = { text: body, written, source: url }; else drop();
  }
  return out;
}

export const promptsFor = (coach, today) => (coach.prompts.find((p) => p.day === today) || { items: [] }).items;

// The events to write when a coach baseline arrives in time: an open or due card, never one that is resolved, with no
// baseline from Predict adopted yet, whose coach number was written on or before the due day. The card's own locked baseline is kept
// on the card as `b0`; scoring reads the adopted number (see predictionsOf in record.js).
export function baselinesToAdopt(predictions, events, coach) {
  const have = new Set(events.filter((e) => e.type === 'baseline').map((e) => e.prediction));
  const out = [];
  for (const p of predictions) {
    if (p.state === 'resolved' || have.has(p.id)) continue;
    const b = coach.baselines[p.id];
    if (!b || b.written > p.due) continue;
    out.push({ prediction: p.id, b: b.p, ref: b.ref, written: b.written });
  }
  return out;
}

// ---- the record in the private repo: one file a day ------------------------------------------------------------------

export function groupByDay(events) {
  const days = new Map();
  for (const e of events) { if (!days.has(e.d)) days.set(e.d, []); days.get(e.d).push(e); }
  return days;
}
// Which days need pushing: where the count of events on this phone differs from the count at the last push.
export function daysToPush(events, syncedDays = {}) {
  const out = [];
  for (const [d, list] of groupByDay(events)) if (syncedDays[d] !== list.length) out.push(d);
  return out.sort();
}
export const dayFileText = (events) => events.slice().sort(byTime).map((e) => JSON.stringify(e)).join('\n') + '\n';
export function parseDayFile(body) {
  const events = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && typeof o.id === 'string' && typeof o.type === 'string' && typeof o.t === 'string') events.push(o); } catch { /* a bad line is skipped */ }
  }
  return events;
}
// Union by id: what is already in the repo's file stays, what is new on the phone is added, and the order is time order.
export function mergeDayFile(remoteEvents, localEvents) {
  const have = new Map(remoteEvents.map((e) => [e.id, e]));
  let added = 0;
  for (const e of localEvents) if (!have.has(e.id)) { have.set(e.id, e); added += 1; }
  const merged = [...have.values()].sort(byTime);
  return { merged, added, text: dayFileText(merged) };
}

// ---- base64 of UTF-8 text (the contents API speaks base64) ----------------------------------------------------------
export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

// Unit 12, Arena (Block 10): a track record on public questions (Good Judgment Open, Metaculus). The player copies a question from the site with their own forecast
// and the crowd's at that moment; the app keeps them, says when the question is due, and scores both with the sharp rule once the player records what happened.
// Events: `arena` state add { title, url, platform, mine, crowd, closes } (its event id names the item), and `arena` state resolve { item, outcome yes | no | void }.
// These numbers are the player's own copy: the app cannot see the site, so the record says "self-reported" wherever it is shown.
import { worldPoints } from './world.js';

export const PLATFORMS = { 'gjopen.com': 'Good Judgment Open', 'www.gjopen.com': 'Good Judgment Open', 'metaculus.com': 'Metaculus', 'www.metaculus.com': 'Metaculus' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function platformOf(url) {
  try { const u = new URL(url); return u.protocol === 'https:' ? PLATFORMS[u.hostname] || null : null; } catch { return null; }
}

// Checks what the player typed. `fields`: title, url, mine, crowd (whole percents, as typed), closes (YYYY-MM-DD). Returns { ok, error } or { ok: true, entry }.
export function checkArena(fields, today, cfg) {
  const a = cfg.arena;
  const title = String(fields.title || '').trim();
  if (title.length < a.title_min) return { ok: false, error: `Copy the question's title (at least ${a.title_min} characters).` };
  if (title.length > a.title_max) return { ok: false, error: `The title is too long: ${a.title_max} characters at most.` };
  const url = String(fields.url || '').trim();
  const platform = platformOf(url);
  if (!platform) return { ok: false, error: 'The link must be a page on Good Judgment Open or Metaculus (https).' };
  const num = (v) => (/^\d{1,2}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
  const mine = num(fields.mine), crowd = num(fields.crowd);
  if (!(mine >= 1 && mine <= 99)) return { ok: false, error: 'Your forecast is a whole percent from 1 to 99.' };
  if (!(crowd >= 1 && crowd <= 99)) return { ok: false, error: 'The crowd\'s forecast is a whole percent from 1 to 99.' };
  const closes = String(fields.closes || '').trim();
  if (!DAY.test(closes) || Number.isNaN(Date.parse(closes))) return { ok: false, error: 'Give the closing day of the question.' };
  if (closes < today) return { ok: false, error: 'That question has already closed: only questions still open count.' };
  return { ok: true, entry: { title, url: new URL(url).href, platform, mine: mine / 100, crowd: crowd / 100, closes } };
}

export const arenaEvents = (events) => events.filter((e) => e.type === 'arena');

// Every item with its state: open (before it closes), due (closed, outcome not recorded), resolved.
export function arenaItems(events, today) {
  const items = arenaEvents(events).filter((e) => e.state === 'add').map((e) => ({ ...e, item: e.id, resolve: null, added: e.d }));
  const byId = new Map(items.map((i) => [i.item, i]));
  for (const e of arenaEvents(events)) if (e.state === 'resolve') { const i = byId.get(e.item); if (i && !i.resolve) i.resolve = e; }
  for (const i of items) i.status = i.resolve ? 'resolved' : i.closes <= today ? 'due' : 'open';
  return items;
}

// Points for a resolved item (void ones carry none): the player's, the crowd's, and the edge (the player's minus the crowd's).
export function arenaScores(S, i) {
  if (!i.resolve || i.resolve.outcome === 'void') return null;
  const yes = i.resolve.outcome === 'yes';
  const mine = worldPoints(S, i.mine, yes), crowd = worldPoints(S, i.crowd, yes);
  return { mine, crowd, edge: mine - crowd };
}

// The Unit 12 measure: over `gates.arena_resolved` resolved public questions, the player's mean points beat the crowd's (a mean edge above zero). Read live.
export function arenaGate(S, items, gates) {
  const scored = items.map((i) => arenaScores(S, i)).filter(Boolean);
  const n = scored.length;
  const mean = (k) => (n ? scored.reduce((s, x) => s + x[k], 0) / n : null);
  const needed = gates.arena_resolved;
  const ready = n >= needed;
  const edge = mean('edge');
  return { n, needed, ready, mine: mean('mine'), crowd: mean('crowd'), edge, ahead: scored.filter((x) => x.edge > 0).length, passed: ready && edge > 0, voided: items.filter((i) => i.resolve && i.resolve.outcome === 'void').length };
}

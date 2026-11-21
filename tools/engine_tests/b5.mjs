// Block 5, the Coach: the checked reading of the weekly review's file, Predict's baselines (and when they count), the record in the
// private repo as one file a day, and the sync adapter against a pretend GitHub. The token must never reach an event, an Export or
// the repo; a failed round must lose nothing; a second round must write nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './common.mjs';
import * as R from '../../app/js/engine/record.js';
import * as C from '../../app/js/engine/coach.js';
import * as SY from '../../app/js/sync.js';
import { openStore, MemoryBackend } from '../../app/js/store.js';

const fixture = (name) => JSON.parse(readFileSync(path.join(ROOT, 'tools', 'fixtures', 'coach', `${name}.json`), 'utf8'));
const at = (iso) => new Date(iso);
const call = (i, d = '2026-11-16') => R.makeEvent('call', { q: `q${i}`, c: 0.7, hit: true, points: 36, mode: 'practice' }, at(`${d}T10:00:${String(i % 60).padStart(2, '0')}`));
const pred = (id, due, over = {}) => ({ id, t: '2026-11-10T09:00:00.000Z', d: '2026-11-10', type: 'prediction', text: 'By 20 November, it will snow.', domain: 'world', dueOption: 'week', due, horizon: 'week', chain: {}, c: 0.6, b: 0.5, bSource: 'starter', scored: true, ...over });

// ---- reading the coach file -----------------------------------------------------------------------------------------
test('a good coach file is kept whole', () => {
  const c = C.parseCoach(fixture('good'));
  assert.equal(c.dropped, 0);
  assert.equal(c.letter.title, 'A steadier week');
  assert.equal(c.letter.sources.length, 1);
  assert.equal(c.prompts[0].items.length, 3);
  assert.equal(c.baselines['abc-123'].p, 0.35);
  assert.equal(c.outcomes['def-456'].result, 'yes');
});
test('anything that fails its check is dropped and counted, and the rest is kept', () => {
  const c = C.parseCoach(fixture('bad'));
  assert.equal(c.dropped, 8);
  assert.deepEqual(Object.keys(c.baselines), ['abc-123']);
  assert.deepEqual(Object.keys(c.outcomes), ['def-456']);
  assert.equal(c.letter.sources.length, 1); // the http link is gone
  assert.equal(c.drills.length, 1); // the one that named the builder is gone
});
test('a checked outcome without an https source link is never shown', () => {
  const c = C.parseCoach({ version: 1, outcomes: { a1: { result: 'yes', checked: '2026-11-15' }, a2: { result: 'yes', source: 'javascript:alert(1)', checked: '2026-11-15' }, a3: { result: 'no', source: 'http://x.org/a', checked: '2026-11-15' } } });
  assert.deepEqual(c.outcomes, {});
  assert.equal(c.dropped, 3);
});
test('the wrong version, junk, and a file that is not an object read as empty', () => {
  for (const raw of [null, 7, 'x', [], { version: 2 }, { version: '1' }]) assert.equal(C.parseCoach(raw).letter, null);
  assert.equal(C.parseCoach({ version: 1 }).dropped, 0);
});
test('letters are read as text only: markup stays markup and nothing is built from it', () => {
  const c = C.parseCoach({ version: 1, letter: { title: '<img src=x onerror=alert(1)>', paragraphs: ['<b>hi</b>'] } });
  assert.equal(c.letter.title, '<img src=x onerror=alert(1)>'); // kept as characters; the screens set textContent only
  assert.ok(!readFileSync(path.join(ROOT, 'app', 'js', 'ui', 'coach.js'), 'utf8').includes('innerHTML'));
  for (const f of ['app/js/ui/journal.js', 'app/js/ui/casefile.js', 'app/js/ui/today.js']) assert.ok(!readFileSync(path.join(ROOT, f), 'utf8').includes('innerHTML'), f);
});
test('the builder’s name is refused in anything the coach wrote', () => {
  const c = C.parseCoach({ version: 1, letter: { title: 'Ask Claude', paragraphs: ['fine'] }, reads: { a: { text: 'by Anthropic', written: '2026-11-15' } } });
  assert.equal(c.letter, null);
  assert.deepEqual(c.reads, {});
});
test('promptsFor gives today’s ideas and nothing for a day without any', () => {
  const c = C.parseCoach(fixture('good'));
  assert.equal(C.promptsFor(c, '2026-11-16').length, 3);
  assert.equal(C.promptsFor(c, '2026-11-17').length, 0);
  assert.equal(C.promptsFor(C.emptyCoach(), '2026-11-16').length, 0);
});

// ---- Predict's baseline, and when it counts -------------------------------------------------------------------------
test('a baseline that arrives before the due day replaces the locked one for scoring, and the locked number stays on the card', () => {
  const p = pred('abc-123', '2026-11-20');
  const coach = C.parseCoach(fixture('good'));
  const preds = R.predictionsOf([p], '2026-11-16');
  const adopt = C.baselinesToAdopt(preds, [p], coach);
  assert.deepEqual(adopt.map((a) => [a.prediction, a.b]), [['abc-123', 0.35]]);
  const ev = R.makeEvent('baseline', adopt[0], at('2026-11-16T12:00:00'));
  const after = R.predictionsOf([p, ev], '2026-11-16')[0];
  assert.equal(after.b, 0.35);
  assert.equal(after.b0, 0.5);
  assert.equal(after.bSource, 'predict');
  assert.match(after.bRef, /snowfall/);
});
test('a baseline written after the due day, for a resolved card, or already adopted, is not adopted', () => {
  const coach = C.parseCoach(fixture('good')); // written 2026-11-15
  const late = pred('abc-123', '2026-11-14');
  assert.deepEqual(C.baselinesToAdopt(R.predictionsOf([late], '2026-11-10'), [late], coach), []);
  const done = pred('abc-123', '2026-11-20');
  const res = R.makeEvent('resolve', { prediction: 'abc-123', outcome: 'yes', raw: 1, edge: 1 }, at('2026-11-16T12:00:00'));
  assert.deepEqual(C.baselinesToAdopt(R.predictionsOf([done, res], '2026-11-16'), [done, res], coach), []);
  const have = R.makeEvent('baseline', { prediction: 'abc-123', b: 0.4, ref: 'r' }, at('2026-11-16T12:00:00'));
  assert.deepEqual(C.baselinesToAdopt(R.predictionsOf([done, have], '2026-11-16'), [done, have], coach), []);
});
test('a baseline event that lands after a card was resolved changes nothing about that card', () => {
  const p = pred('abc-123', '2026-11-12');
  const res = R.makeEvent('resolve', { prediction: 'abc-123', outcome: 'no', raw: -1, edge: -2 }, at('2026-11-13T12:00:00'));
  const late = { id: 'zzz', t: '2026-11-14T00:00:00.000Z', d: '2026-11-14', type: 'baseline', prediction: 'abc-123', b: 0.1, ref: 'r' };
  const card = R.predictionsOf([p, res, late], '2026-11-16')[0];
  assert.equal(card.b, 0.5);
  assert.equal(card.bSource, 'starter');
});
test('a resolve event carries its source link and checked day onto the card', () => {
  const p = pred('p1', '2026-11-12');
  const res = R.makeEvent('resolve', { prediction: 'p1', outcome: 'yes', raw: 1, edge: 1, source: 'https://www.weather.gov/sew/', checked: '2026-11-13' }, at('2026-11-13T12:00:00'));
  const card = R.predictionsOf([p, res], '2026-11-16')[0];
  assert.equal(card.source, 'https://www.weather.gov/sew/');
  assert.equal(card.checkedDay, '2026-11-13');
  assert.equal('source' in R.predictionsOf([p], '2026-11-16')[0], false);
});

// ---- the record in the repo: one file a day -------------------------------------------------------------------------
test('days to push are the days whose count changed since the last push', () => {
  const ev = [call(1), call(2), call(3, '2026-11-17')];
  assert.deepEqual(C.daysToPush(ev, {}), ['2026-11-16', '2026-11-17']);
  assert.deepEqual(C.daysToPush(ev, { '2026-11-16': 2, '2026-11-17': 1 }), []);
  assert.deepEqual(C.daysToPush(ev, { '2026-11-16': 1, '2026-11-17': 1 }), ['2026-11-16']);
});
test('a day file is a union by id, in time order, and never loses what the repo already has', () => {
  const a = call(1), b = call(2), c = call(3);
  const { merged, added, text } = C.mergeDayFile([c, a], [a, b]);
  assert.equal(added, 1);
  assert.deepEqual(merged.map((e) => e.id), [a, b, c].sort(R.byTime).map((e) => e.id));
  assert.deepEqual(C.parseDayFile(text).map((e) => e.id), merged.map((e) => e.id));
  assert.deepEqual(C.parseDayFile('not json\n{"id":1}\n'), []);
});
test('base64 round-trips text with accents and emoji', () => {
  const s = 'Café — “prédiction” ✓ 日本語 🙂\n' + 'x'.repeat(100000);
  assert.equal(C.fromBase64(C.toBase64(s)), s);
});

// ---- a pretend GitHub ----------------------------------------------------------------------------------------------
function fakeGithub({ privateRepo = true, push = true, token = 'tok-secret', status = null } = {}) {
  const files = new Map(); // path -> { text, sha }
  const log = [];
  let sha = 0;
  let conflictOnce = false;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    log.push({ method, path: u.pathname, auth: init.headers && init.headers.Authorization, host: u.host });
    const reply = (code, body) => ({ status: code, json: async () => body, headers: { get: () => null } });
    if (status) return reply(status, { message: status === 403 ? 'API rate limit exceeded' : 'x' });
    if (!init.headers || init.headers.Authorization !== `Bearer ${token}`) return reply(401, { message: 'Bad credentials' });
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/contents\/(.+))?$/);
    if (!m) return reply(404, {});
    if (!m[2]) return reply(200, { full_name: m[1], private: privateRepo, permissions: { push } });
    const p = m[3];
    if (method === 'GET') {
      const f = files.get(p);
      return f ? reply(200, { content: Buffer.from(f.text).toString('base64'), sha: f.sha }) : reply(404, {});
    }
    const body = JSON.parse(init.body);
    const cur = files.get(p);
    if (conflictOnce) { conflictOnce = false; return reply(409, {}); }
    if (cur && body.sha !== cur.sha) return reply(409, {});
    files.set(p, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `s${++sha}` });
    return reply(cur ? 200 : 201, {});
  };
  return { fetchFn, files, log, conflictNext: () => { conflictOnce = true; }, put: (p, text) => files.set(p, { text, sha: `s${++sha}` }) };
}
const client = (gh, over = {}) => SY.githubClient({ repo: 'me/Predict-data', token: 'tok-secret', fetchFn: gh.fetchFn, ...over });
const freshStore = async (events = []) => { const s = await openStore(new MemoryBackend()); for (const e of events) await s.append(e); return s; };

test('the first round pushes one file a day, the second round writes nothing', async () => {
  const gh = fakeGithub();
  const store = await freshStore([call(1), call(2), call(3, '2026-11-17')]);
  const a = await SY.syncNow({ store, client: client(gh) });
  assert.deepEqual([a.pushedDays, a.pushedEvents], [2, 3]);
  assert.deepEqual([...gh.files.keys()].sort(), ['record/2026-11-16.jsonl', 'record/2026-11-17.jsonl']);
  const writes = gh.log.filter((l) => l.method === 'PUT').length;
  const b = await SY.syncNow({ store, client: client(gh) });
  assert.deepEqual([b.pushedDays, b.pushedEvents], [0, 0]);
  assert.equal(gh.log.filter((l) => l.method === 'PUT').length, writes);
});
test('a new event on an old day goes in without losing the rest, and a second device’s events come back', async () => {
  const gh = fakeGithub();
  const store = await freshStore([call(1), call(2)]);
  await SY.syncNow({ store, client: client(gh) });
  const other = call(9); // written on another phone the same day
  gh.put('record/2026-11-16.jsonl', C.dayFileText([...C.parseDayFile(gh.files.get('record/2026-11-16.jsonl').text), other]));
  await store.append(call(4));
  const r = await SY.syncNow({ store, client: client(gh) });
  assert.equal(r.pulledEvents, 1);
  assert.ok(store.events.some((e) => e.id === other.id));
  const ids = new Set(C.parseDayFile(gh.files.get('record/2026-11-16.jsonl').text).map((e) => e.id));
  for (const e of store.events.filter((e) => e.d === '2026-11-16')) assert.ok(ids.has(e.id));
});
test('a conflicting write is read again and retried once; a second conflict stops the round without losing anything', async () => {
  const gh = fakeGithub();
  const store = await freshStore([call(1)]);
  gh.conflictNext();
  const ok = await SY.syncNow({ store, client: client(gh) });
  assert.equal(ok.pushedDays, 1);
  const store2 = await freshStore([call(2, '2026-11-18')]);
  const c2 = client(gh);
  const real = c2.write;
  c2.write = async () => false;
  await assert.rejects(() => SY.syncNow({ store: store2, client: c2 }), (e) => e.kind === 'conflict');
  assert.equal(store2.events.length, 1);
  assert.equal((await store2.getMeta('syncedDays')) === undefined || !(await store2.getMeta('syncedDays'))['2026-11-18'], true);
  assert.ok(real);
});
test('the token is only ever sent to api.github.com as a header, and is in no file in the repo', async () => {
  const gh = fakeGithub();
  const store = await freshStore([call(1)]);
  await store.setMeta('sync', { repo: 'me/Predict-data', token: 'tok-secret' });
  await SY.syncNow({ store, client: client(gh) });
  assert.ok(gh.log.every((l) => l.host === 'api.github.com' && l.auth === 'Bearer tok-secret'));
  assert.ok(gh.log.every((l) => !l.path.includes('tok-secret')));
  for (const f of gh.files.values()) assert.ok(!f.text.includes('tok-secret'));
  assert.ok(!R.toJSONL(store.events).includes('tok-secret')); // an Export holds events only
  assert.ok(!JSON.stringify(store.events).includes('tok-secret'));
});
test('connecting is refused for a public repo, a token that cannot write, a bad token, a missing repo, and no network', async () => {
  await assert.rejects(() => client(fakeGithub({ privateRepo: false })).check(), (e) => e.kind === 'public');
  await assert.rejects(() => client(fakeGithub({ push: false })).check(), (e) => e.kind === 'forbidden');
  await assert.rejects(() => client(fakeGithub(), { token: 'wrong' }).check(), (e) => e.kind === 'auth');
  await assert.rejects(() => client(fakeGithub({ status: 404 })).check(), (e) => e.kind === 'missing');
  await assert.rejects(() => client(fakeGithub({ status: 403 })).check(), (e) => e.kind === 'forbidden' && /too many/.test(e.message));
  await assert.rejects(() => SY.githubClient({ repo: 'a/b', token: 't', fetchFn: async () => { throw new TypeError('Failed to fetch'); } }).check(), (e) => e.kind === 'offline');
  const ok = await client(fakeGithub()).check();
  assert.equal(ok.name, 'me/Predict-data');
});
test('a failed round changes nothing on the phone: the record is whole and the next round pushes it', async () => {
  const gh = fakeGithub();
  const store = await freshStore([call(1), call(2)]);
  await assert.rejects(() => SY.syncNow({ store, client: client(gh, { token: 'wrong' }) }), (e) => e.kind === 'auth');
  assert.equal(store.events.length, 2);
  assert.equal(gh.files.size, 0);
  const r = await SY.syncNow({ store, client: client(gh) });
  assert.equal(r.pushedEvents, 2);
});
test('the weekly review’s file is read, cached, and its baselines are adopted in time', async () => {
  const gh = fakeGithub();
  const p = pred('abc-123', '2999-01-01');
  const store = await freshStore([p, call(1)]);
  gh.put('coach/latest.json', JSON.stringify(fixture('good')));
  const r = await SY.syncNow({ store, client: client(gh), now: () => at('2026-11-16T12:00:00') });
  assert.equal(r.coachFetched, true);
  assert.equal(r.adopted, 1);
  const coach = await SY.loadCoach(store);
  assert.equal(coach.letter.title, 'A steadier week');
  assert.equal(R.predictionsOf(store.events, '2026-11-16').find((x) => x.id === 'abc-123').b, 0.35);
  const again = await SY.syncNow({ store, client: client(gh), now: () => at('2026-11-16T12:05:00') });
  assert.equal(again.adopted, 0);
});
test('an unreadable coach file is treated as no file, and the cached letter survives offline', async () => {
  const gh = fakeGithub();
  const store = await freshStore([call(1)]);
  gh.put('coach/latest.json', '{not json');
  const r = await SY.syncNow({ store, client: client(gh) });
  assert.equal(r.coachFetched, true);
  assert.equal((await SY.loadCoach(store)).letter, null);
  gh.put('coach/latest.json', JSON.stringify(fixture('good')));
  await SY.syncNow({ store, client: client(gh) });
  assert.equal((await SY.loadCoach(store)).letter.title, 'A steadier week'); // read from the phone, no network involved
});
test('loadConfig accepts only a well-formed repo name and a token', async () => {
  const store = await freshStore();
  assert.equal(await SY.loadConfig(store), null);
  await store.setMeta('sync', { repo: 'not a repo', token: 't' });
  assert.equal(await SY.loadConfig(store), null);
  await store.setMeta('sync', { repo: 'me/Predict-data', token: 't' });
  assert.equal((await SY.loadConfig(store)).repo, 'me/Predict-data');
});

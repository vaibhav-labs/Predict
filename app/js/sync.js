// The sync adapter: the record goes to the player's own private repo through the GitHub contents API, and the weekly review's
// answer (coach/latest.json) comes back. It is the only code that talks to another site, and only to api.github.com, only when the
// player has saved a repo and a token on the Coach tab. The token lives in this phone's storage (the `sync` meta record), never in an
// event, never in an Export, never in code or a URL. Pushing is a union by event id, so nothing is overwritten and a second device,
// or a second push, adds only what is new.
import * as R from './engine/record.js';
import * as C from './engine/coach.js';

const API = 'https://api.github.com';

export class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function words(status, body) {
  if (status === 401) return new SyncError('auth', 'GitHub refused the token. It is wrong or it has expired: make a new one and paste it here.');
  if (status === 403) return new SyncError('forbidden', /rate limit/i.test(body && body.message) ? 'GitHub says too many requests. Try again in a few minutes.' : 'The token cannot write to that repository. It needs Contents: read and write on that one repo.');
  if (status === 404) return new SyncError('missing', 'GitHub cannot find that repository with this token. Check the name (owner/repo) and that the token covers it.');
  return new SyncError('http', `GitHub answered ${status}.`);
}

// `fetchFn` is injected so the tests can stand in for GitHub.
export function githubClient({ repo, token, fetchFn = (...a) => fetch(...a) }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchFn(`${API}/repos/${repo}${path}`, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (err) {
      throw new SyncError('offline', 'No connection to GitHub right now. Your record is safe on this phone and will go when you are online.');
    }
    let json = null;
    try { json = await res.json(); } catch { /* an empty body is fine */ }
    return { status: res.status, json, headers: res.headers };
  }
  return {
    // The repo itself: it must be reachable, writable and private.
    async check() {
      const r = await call('GET', '');
      if (r.status !== 200) throw words(r.status, r.json);
      if (r.json && r.json.private === false) throw new SyncError('public', 'That repository is public. Your record is personal: make a private one and use that.');
      if (r.json && r.json.permissions && r.json.permissions.push === false) throw new SyncError('forbidden', 'The token can read that repository but not write to it. It needs Contents: read and write.');
      return { name: r.json && r.json.full_name, expires: r.headers && r.headers.get && r.headers.get('github-authentication-token-expiration') };
    },
    // A file's text and sha, or null when it does not exist.
    async read(path) {
      const r = await call('GET', `/contents/${path}`);
      if (r.status === 404) return null;
      if (r.status !== 200 || !r.json || typeof r.json.content !== 'string') throw words(r.status, r.json);
      return { text: C.fromBase64(r.json.content), sha: r.json.sha };
    },
    async write(path, text, sha, message) {
      const r = await call('PUT', `/contents/${path}`, { message, content: C.toBase64(text), ...(sha ? { sha } : {}) });
      if (r.status === 200 || r.status === 201) return true;
      if (r.status === 409 || r.status === 422) return false; // someone wrote in between: the caller reads again and retries once
      throw words(r.status, r.json);
    },
  };
}

// ---- one round: push what is new, pull what the repo has --------------------------------------------------------------

export async function loadConfig(store) {
  const c = await store.getMeta('sync');
  return c && C.REPO_NAME.test(c.repo || '') && typeof c.token === 'string' && c.token ? c : null;
}

export async function syncNow({ store, client, now = () => new Date() }) {
  const result = { pushedDays: 0, pushedEvents: 0, pulledEvents: 0, coachFetched: false, adopted: 0 };
  const synced = { ...((await store.getMeta('syncedDays')) || {}) };
  // 1. the record: every day whose count changed
  for (const day of C.daysToPush(store.events, synced)) {
    const local = store.events.filter((e) => e.d === day);
    const path = `record/${day}.jsonl`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remote = await client.read(path);
      const remoteEvents = remote ? C.parseDayFile(remote.text) : [];
      const merged = C.mergeDayFile(remoteEvents, local);
      if (!remote || merged.added > 0) {
        const ok = await client.write(path, merged.text, remote && remote.sha, `record ${day}: ${local.length} events`);
        if (!ok) { if (attempt === 1) throw new SyncError('conflict', 'The record changed on GitHub while pushing. It will be tried again next time.'); continue; }
        result.pushedDays += 1; result.pushedEvents += merged.added;
      }
      // what the repo had that this phone did not (another device, a restored backup): merged in
      const got = await store.importEvents(remoteEvents);
      result.pulledEvents += got.added;
      synced[day] = store.events.filter((e) => e.d === day).length;
      break;
    }
  }
  await store.setMeta('syncedDays', synced);
  // 2. the weekly review's answer
  const file = await client.read('coach/latest.json');
  if (file) {
    let raw = null;
    try { raw = JSON.parse(file.text); } catch { /* an unreadable file is treated as no file */ }
    const coach = C.parseCoach(raw);
    await store.setMeta('coach', { raw: { ...coach, dropped: undefined }, fetched: now().toISOString(), dropped: coach.dropped });
    result.coachFetched = true;
    result.adopted = await adoptBaselines(store, coach, now);
  }
  return result;
}

// Predict's numbers that arrived in time become `baseline` events on their cards.
export async function adoptBaselines(store, coach, now = () => new Date()) {
  const preds = R.predictionsOf(store.events, R.localDay(now()));
  let n = 0;
  for (const b of C.baselinesToAdopt(preds, store.events, coach)) {
    if (await store.append(R.makeEvent('baseline', b, now()))) n += 1;
  }
  return n;
}

// The coach data as the screens read it (cached on the phone, so it works offline).
export async function loadCoach(store) {
  const cached = await store.getMeta('coach');
  return cached && cached.raw ? { ...C.parseCoach(cached.raw), fetched: cached.fetched } : { ...C.emptyCoach(), fetched: null };
}

export const message = (err) => (err instanceof SyncError ? err.message : 'Sync stopped: ' + (err && err.message ? err.message : String(err)));

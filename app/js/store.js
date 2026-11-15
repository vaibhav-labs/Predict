// The one place the record touches storage. Everything else asks this adapter.
// Today it is the phone's own IndexedDB; from Block 5 a sync adapter sits behind the same calls.
// The log is append-only: an event that is already stored is refused, never overwritten (a locked
// prediction therefore cannot be changed). The only way to remove anything is erase().
import { byTime, mergeEvents } from './engine/record.js';

const DB_NAME = 'predict-record';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function done(tx) {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

export class IdbBackend {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('events', { keyPath: 'id' }).createIndex('t', 't');
        db.createObjectStore('meta');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('storage is blocked by another tab'));
    });
    return this;
  }
  async all() {
    return req(this.db.transaction('events').objectStore('events').getAll());
  }
  // Returns the events that were really added. An id that is stored already is refused (the request fails with a
  // ConstraintError, which we swallow so the rest of the batch still goes in): nothing is ever overwritten.
  async addMany(events) {
    const added = [];
    if (!events.length) return added;
    const tx = this.db.transaction('events', 'readwrite');
    const finished = done(tx); // attach the handlers before anything can finish
    const store = tx.objectStore('events');
    for (const e of events) {
      const r = store.add(e);
      r.onsuccess = () => added.push(e);
      r.onerror = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    }
    await finished;
    return added;
  }
  async clear() {
    const tx = this.db.transaction(['events', 'meta'], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore('meta').clear();
    await done(tx);
  }
  async getMeta(key) { return req(this.db.transaction('meta').objectStore('meta').get(key)); }
  async setMeta(key, value) {
    const tx = this.db.transaction('meta', 'readwrite');
    if (value === undefined) tx.objectStore('meta').delete(key); else tx.objectStore('meta').put(value, key);
    await done(tx);
  }
}

// Used when the browser will not give us IndexedDB (some private windows): the app still runs, and says so.
export class MemoryBackend {
  constructor() { this.events = new Map(); this.meta = new Map(); }
  async open() { return this; }
  async all() { return Array.from(this.events.values()); }
  async addMany(events) {
    const added = [];
    for (const e of events) if (!this.events.has(e.id)) { this.events.set(e.id, e); added.push(e); }
    return added;
  }
  async clear() { this.events.clear(); this.meta.clear(); }
  async getMeta(key) { return this.meta.get(key); }
  async setMeta(key, value) { if (value === undefined) this.meta.delete(key); else this.meta.set(key, value); }
}

export async function openStore(backend) {
  let persistent = true;
  if (!backend) {
    try {
      backend = await new IdbBackend().open();
    } catch (err) {
      backend = new MemoryBackend();
      persistent = false;
    }
  }
  let events = (await backend.all()).sort(byTime);
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());

  return {
    persistent,
    get events() { return events; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Saved before the promise resolves: when the caller moves on, the event is on the phone.
    async append(event) {
      const added = await backend.addMany([event]);
      if (added.length) { events = events.concat(added).sort(byTime); changed(); }
      return added.length === 1;
    },
    // Restore a backup: merges by id, so importing the same file twice adds nothing the second time.
    async importEvents(incoming) {
      const { added, skipped } = mergeEvents(events, incoming);
      const stored = await backend.addMany(added);
      if (stored.length) { events = events.concat(stored).sort(byTime); changed(); }
      return { added: stored.length, skipped: skipped + (added.length - stored.length) };
    },
    async erase() { await backend.clear(); events = []; changed(); },
    getMeta: (k) => backend.getMeta(k),
    setMeta: (k, v) => backend.setMeta(k, v),
  };
}

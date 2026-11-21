import { h } from '../dom.js';
import * as R from '../engine/record.js';
import { tabFrame, copyMessage } from './common.js';
import * as SY from '../sync.js';
import * as C from '../engine/coach.js';
import { lessonState } from '../flags.js';
import { flagName } from '../flagtext.js';
import { pct } from '../engine/scoring.js';

// Hand a file to the player: the share sheet where the phone has one (iPhone: Save to Files, Messages, AirDrop),
// otherwise an ordinary download.
async function deliver(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}


const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

// The weekly letter and the drill set Predict wrote at the last review. Text only; links only if they are https with a source label.
function letterCards(ctx) {
  const coach = ctx.coach || C.emptyCoach();
  if (!coach.letter) {
    return [h('section', { class: 'card soft stack', id: 'coach-none' },
      h('span', { class: 'eyebrow' }, 'Your weekly letter'),
      h('p', null, 'Each week Predict reads your record, writes you a short letter and sets a drill. It arrives here once the private repository below is connected and the first review has run. Until then, Ask Predict copies a message with your numbers that you can paste into a chat.'))];
  }
  const L = coach.letter;
  const cards = [h('section', { class: 'card stack prose', id: 'coach-letter' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, coach.week ? `Weekly letter · ${coach.week}` : 'Weekly letter'), h('span', { class: 'cap' }, coach.written || '')),
    h('h2', { class: 'title', style: 'font-size:20px' }, L.title),
    ...L.paragraphs.map((t) => h('p', null, t)),
    L.sources.length ? h('div', { class: 'stack', id: 'coach-sources', style: 'gap:4px' }, h('span', { class: 'cap' }, 'Sources'), ...L.sources.map((x) => h('a', { class: 'srclink', href: x.url, rel: 'noopener noreferrer', target: '_blank' }, x.label))) : null)];
  if (coach.drills.length) cards.push(h('section', { class: 'card stack', id: 'coach-drills' },
    h('span', { class: 'eyebrow' }, 'This week’s drill set'),
    ...coach.drills.map((d) => h('div', null, h('b', null, d.title), h('p', null, d.text)))));
  return cards;
}

// A message with the player's own numbers, for a chat with Predict (the same hand-off as on a journal card).
export function checkInMessage(ctx) {
  const ev = ctx.store.events, today = R.localDay();
  const week = R.callsOf(ev).filter((c) => c.d > R.addDays(today, -7));
  const s = R.summarize(week);
  const preds = R.predictionsOf(ev, today);
  const resolved = preds.filter((p) => p.state === 'resolved' && p.d > R.addDays(today, -7));
  const open = lessonState(ctx).patterns.map((c) => flagName(ctx, c.trigger));
  return [
    'Predict, here is my week. Please write my weekly letter and set a drill.',
    s.n ? `Gym: ${s.n} calls this week, average confidence ${pct(s.meanConf)}, hit rate ${pct(s.hitRate)}.` : 'Gym: no calls this week.',
    `Journal: ${resolved.length} predictions resolved this week, ${preds.filter((p) => p.state === 'due').length} due now, ${preds.filter((p) => p.state === 'open').length} open.`,
    open.length ? `Patterns being worked on: ${open.join('; ')}.` : 'No pattern flags open.',
  ].join('\n');
}

// The private repository: where it is, whether it works, and the button that sends and fetches.
function syncCard(ctx) {
  const repo = h('input', { class: 'field', id: 'sync-repo', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'your-name/Predict-data', 'aria-label': 'Private repository, owner/name' });
  const token = h('input', { class: 'field', id: 'sync-token', type: 'password', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Fine-grained token', 'aria-label': 'Token' });
  const status = h('p', { class: 'msg', id: 'sync-status', role: 'status' });
  const say = (text, kind) => { status.textContent = text; status.className = `msg${kind ? ' ' + kind : ''}`; };
  const form = h('div', { class: 'stack', id: 'sync-form' }, repo, token);
  const save = h('button', { class: 'btn', type: 'button', id: 'sync-save' }, 'Save and connect');
  const now = h('button', { class: 'btn', type: 'button', id: 'sync-now' }, 'Sync now');
  const off = h('button', { class: 'ghost danger', type: 'button', id: 'sync-off' }, 'Disconnect and forget the token');
  const intro = h('p', { class: 'cap', id: 'sync-intro' });
  const connected = h('div', { class: 'stack', id: 'sync-connected', hidden: true }, h('p', { id: 'sync-where' }), now, off);

  async function show() {
    const c = await SY.loadConfig(ctx.store);
    form.hidden = !!c; save.hidden = !!c; connected.hidden = !c;
    intro.textContent = c ? '' : 'Make a private repository on GitHub (call it Predict-data) and a fine-grained token for that one repository with Contents: read and write. Paste both here. The token stays on this phone.';
    if (c) {
      connected.querySelector('#sync-where').textContent = `Connected to ${c.repo}.`;
      const st = await ctx.sync.status();
      if (st) say(st.ok ? `Synced ${when(st.at)}: ${st.pushedEvents} new events sent${st.pulledEvents ? `, ${st.pulledEvents} brought in` : ''}${st.coachFetched ? '' : '. No letter from Predict yet'}.` : st.error, st.ok ? 'ok' : 'err');
    }
  }
  save.addEventListener('click', async () => {
    const r = repo.value.trim(), t = token.value.trim();
    if (!C.REPO_NAME.test(r)) { say('Write the repository as owner/name, for example vaibhav-labs/Predict-data.', 'err'); return; }
    if (!t) { say('Paste the token.', 'err'); return; }
    save.disabled = true; say('Checking the repository…');
    try {
      const client = SY.githubClient({ repo: r, token: t, fetchFn: (...a) => ctx.sync.fetchFn(...a) });
      const info = await client.check();
      await ctx.store.setMeta('sync', { repo: r, token: t, savedAt: new Date().toISOString(), expires: info.expires || null });
      token.value = '';
      await show();
      say(`Connected to ${info.name || r}. Sending your record…`);
      const res = await ctx.sync.run();
      await show();
      if (!res.ok) say(res.error, 'err');
    } catch (err) {
      say(SY.message(err), 'err');
    } finally { save.disabled = false; }
  });
  now.addEventListener('click', async () => {
    now.disabled = true; say('Syncing…');
    const res = await ctx.sync.run();
    await show();
    if (!res.ok) say(res.error, 'err');
    now.disabled = false;
    ctx.refresh();
  });
  off.addEventListener('click', async () => {
    await ctx.store.setMeta('sync', undefined);
    say('Disconnected. The token is gone from this phone. What was already sent stays in the repository; revoke the token on GitHub too.', 'ok');
    await show();
  });
  show();
  return h('section', { class: 'card stack', id: 'sync-card' },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Private repository'), h('span', { class: 'cap' }, 'optional')),
    intro, form, save, connected, status);
}

function askCard(ctx) {
  const box = h('textarea', { class: 'field', id: 'checkin-text', rows: 5, hidden: true, readonly: true });
  const btn = h('button', { class: 'ghost', type: 'button', id: 'checkin-copy' }, 'Ask Predict about my week');
  btn.addEventListener('click', () => copyMessage(ctx, checkInMessage(ctx), box));
  return h('section', { class: 'card stack' }, h('span', { class: 'eyebrow' }, 'Ask Predict'),
    h('p', { class: 'cap' }, 'Copies a short message with this week’s numbers. Paste it into your chat with Predict. Nothing is sent from here.'), btn, box);
}

export function coachScreen(ctx) {
  const { store } = ctx;
  const events = store.events;
  const calls = R.callsOf(events);
  const day = R.localDay();
  const msg = h('p', { class: 'msg', id: 'record-msg', role: 'status' });
  const say = (text, kind) => { msg.textContent = text; msg.className = `msg${kind ? ' ' + kind : ''}`; };
  const summary = h('p', { class: 'lede', id: 'record-summary' });
  const refreshSummary = () => {
    const ev = store.events, cs = R.callsOf(ev);
    const last = R.lastExport(ev);
    summary.textContent = `${ev.length} events, ${cs.length} calls. ` + (last ? `Last Export: ${last.d}.` : 'Not exported yet.');
  };
  refreshSummary();

  const exportBtn = h('button', { class: 'btn', type: 'button', id: 'export-record' }, 'Export record');
  exportBtn.addEventListener('click', async () => {
    const ev = store.events;
    const how = await deliver(`predict-record-${day}.jsonl`, R.toJSONL(ev, { build: ctx.build }), 'text/plain');
    if (how === 'cancelled') return;
    await store.append(R.makeEvent('export', { kind: 'jsonl', count: ev.length, how }));
    say(how === 'shared' ? `Shared a record of ${ev.length} events.` : `Downloaded predict-record-${day}.jsonl with ${ev.length} events.`, 'ok');
    refreshSummary();
  });
  const csvBtn = h('button', { class: 'ghost', type: 'button', id: 'export-csv' }, 'Calls as a spreadsheet (.csv)');
  csvBtn.addEventListener('click', async () => {
    const how = await deliver(`predict-calls-${day}.csv`, R.callsToCSV(store.events), 'text/csv');
    if (how === 'cancelled') return;
    await store.append(R.makeEvent('export', { kind: 'csv', count: calls.length, how }));
    say(how === 'shared' ? 'Shared your calls as a spreadsheet.' : `Downloaded predict-calls-${day}.csv.`, 'ok');
  });

  const file = h('input', { type: 'file', id: 'import-file', class: 'visually-hidden', accept: '.jsonl,.json,.txt,text/plain,application/json', tabindex: '-1' });
  const importBtn = h('button', { class: 'ghost', type: 'button', id: 'import-btn' }, 'Import a record');
  importBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    try {
      const { events: incoming, errors, header } = R.parseJSONL(await f.text());
      if (header && header.version > R.FORMAT_VERSION) { say('That file is from a newer version of Predict. Update the app first.', 'err'); return; }
      if (!incoming.length) { say('No events found in that file.', 'err'); return; }
      const res = await store.importEvents(incoming);
      say(`Imported ${res.added} new events. ${res.skipped} were already here.${errors.length ? ` ${errors.length} ${errors.length === 1 ? 'line' : 'lines'} could not be read.` : ''}`, 'ok');
      refreshSummary();
    } catch (err) {
      say(`Could not read that file: ${err.message}`, 'err');
    } finally {
      file.value = '';
    }
  });

  const confirm = h('input', { class: 'field', id: 'erase-confirm', type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Type ERASE to confirm' });
  const eraseGo = h('button', { class: 'ghost danger', type: 'button', id: 'erase-go', disabled: true }, 'Erase everything on this phone');
  const erasePanel = h('div', { class: 'stack', id: 'erase-panel', hidden: true },
    h('p', { class: 'msg' }, 'This removes every call, prediction, session and lesson from this phone, and the saved repository token. Export first. Type ERASE to confirm.'), confirm, eraseGo);
  confirm.addEventListener('input', () => { eraseGo.disabled = confirm.value.trim() !== 'ERASE'; });
  eraseGo.addEventListener('click', async () => {
    eraseGo.disabled = true;
    await store.erase();
    ctx.coach = C.emptyCoach();
    confirm.value = '';
    erasePanel.hidden = true;
    say('Erased. This phone holds no record now.', 'ok');
    refreshSummary();
  });
  const eraseBtn = h('button', { class: 'ghost danger', type: 'button', id: 'erase-btn' }, 'Erase this phone’s record');
  eraseBtn.addEventListener('click', () => { erasePanel.hidden = !erasePanel.hidden; if (!erasePanel.hidden) confirm.focus(); });

  // Device check: the five things the first hour of Block 1 asks you to confirm on your phone.
  const dd = (id) => h('dd', { id }, 'checking');
  const installed = dd('installed'), offline = dd('offline'), opens = dd('opens'), persist = dd('persist'), conn = dd('conn');
  const set = (el, text, ok) => { el.textContent = text; el.className = ok === true ? 'yes' : ok === false ? 'no' : ''; };
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  set(installed, standalone ? 'Yes' : 'Not yet', standalone ? true : undefined);
  set(opens, `Opened ${ctx.opens} ${ctx.opens === 1 ? 'time' : 'times'}`, store.persistent);
  if (!store.persistent) set(opens, 'Not saved', false);
  const showConn = () => set(conn, navigator.onLine ? 'Online' : 'Offline', navigator.onLine);
  showConn();
  const onNet = () => showConn();
  addEventListener('online', onNet); addEventListener('offline', onNet);
  ctx.onLeave(() => { removeEventListener('online', onNet); removeEventListener('offline', onNet); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(() => caches.keys()).then((keys) => set(offline, keys.length ? 'Ready' : 'Not ready', keys.length > 0)).catch(() => set(offline, 'Not available', false));
  } else set(offline, 'Not available', false);
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => set(persist, p ? 'Yes' : 'Not granted', p)).catch(() => set(persist, 'Unknown'));
  } else set(persist, 'Unknown');

  if (ctx.coach && ctx.coach.letter) { ctx.letterSeen = ctx.coach.week || ctx.coach.written || 'seen'; store.setMeta('letterSeen', ctx.letterSeen); }
  return tabFrame('coach', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Coach'), h('span', { class: 'date' }, 'Predict')),
    ...letterCards(ctx), askCard(ctx), syncCard(ctx),
    h('section', { class: 'card stack' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'Your record'), h('span', { class: 'cap' }, 'on this phone')),
      summary,
      exportBtn, csvBtn, importBtn, file, msg,
      h('p', { class: 'cap' }, 'Export writes everything you have done to one file you can keep or share. Import puts a file back and never counts anything twice.'),
      eraseBtn, erasePanel),
    h('section', { class: 'card' },
      h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, 'This device'), h('span', { class: 'cap' }, 'install check')),
      h('dl', { class: 'status' },
        h('dt', null, 'Opens as an installed app'), installed,
        h('dt', null, 'Works offline'), offline,
        h('dt', null, 'Saved on this phone'), opens,
        h('dt', null, 'Storage protected'), persist,
        h('dt', null, 'Connection'), conn,
        h('dt', null, 'Build'), h('dd', { id: 'build' }, ctx.build)),
      h('p', { class: 'cap' }, 'On iPhone, open the address in Safari, tap Share, then Add to Home Screen. Play from the home-screen icon: an installed app keeps its own saved data.')));
}

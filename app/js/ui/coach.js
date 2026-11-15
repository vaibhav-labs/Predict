import { h } from '../dom.js';
import * as R from '../engine/record.js';
import { tabFrame, soonCard } from './common.js';

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
    h('p', { class: 'msg' }, 'This removes every call, prediction, session and lesson from this phone. Export first. Type ERASE to confirm.'), confirm, eraseGo);
  confirm.addEventListener('input', () => { eraseGo.disabled = confirm.value.trim() !== 'ERASE'; });
  eraseGo.addEventListener('click', async () => {
    eraseGo.disabled = true;
    await store.erase();
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

  return tabFrame('coach', h('header', { class: 'top' }, h('span', { class: 'mark' }, 'Coach'), h('span', { class: 'date' }, 'Predict')),
    soonCard(5, 'Each week Predict reads your record, writes you a short letter and sets a drill. A button on every card will copy a ready-made question and open the chat where Predict answers. Until then, Export your record below and share the file in a chat with Predict.'),
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

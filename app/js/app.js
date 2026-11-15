// Predict, Block 1: the Dial. Boot, routes (kept in the hash, so every relative URL works under /Predict/),
// and the few services every screen shares. No request leaves this site while the app runs.
import { h } from './dom.js';
import { makeScoring } from './engine/scoring.js';
import { parseTable } from './engine/csv.js';
import { openStore } from './store.js';
import { BUILD } from './build.js';
import { tabFrame, soonCard } from './ui/common.js';
import { todayScreen } from './ui/today.js';
import { gymScreen, summaryScreen } from './ui/gym.js';
import { mirrorScreen } from './ui/mirror.js';
import { pathScreen } from './ui/path.js';
import { lessonScreen } from './ui/lesson.js';
import { coachScreen } from './ui/coach.js';

const root = document.getElementById('app');
let routeId = 0;
let leaving = [];
let ctx = null;

async function getOK(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

function fatal(err) {
  console.error(err);
  root.replaceChildren(h('div', { class: 'app' }, h('main', { class: 'col', style: 'padding-top:40px' },
    h('h1', { class: 'title' }, 'Predict could not start'),
    h('p', { class: 'lede' }, String(err && err.message ? err.message : err)),
    h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Try again'))));
}

function soon(tab, title, block, text) {
  return tabFrame(tab, h('header', { class: 'top' }, h('span', { class: 'mark' }, title), h('span', { class: 'date' }, `Block ${block}`)), soonCard(block, text));
}

const routes = {
  today: (c) => todayScreen(c),
  journal: (c) => soon('journal', 'Journal', 2, 'One real prediction a day about your work, your life or the world, written as a six-link chain and locked before the outcome is known. When it resolves, you get a case file that reads it back to you.'),
  mirror: (c) => mirrorScreen(c),
  coach: (c) => coachScreen(c),
  path: (c) => pathScreen(c),
  lesson: (c, arg) => lessonScreen(c, arg),
  summary: (c, arg) => summaryScreen(c, arg),
  gym: async (c, arg, token) => { await gymScreen(c, root, token); return null; },
};

async function route() {
  const token = ++routeId;
  leaving.forEach((fn) => { try { fn(); } catch (e) { /* a cleanup that fails must not block the next screen */ } });
  leaving = [];
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = routes[name] || routes.today;
  try {
    const view = await fn(ctx, arg, token);
    if (view && token === routeId) { root.replaceChildren(view); window.scrollTo(0, 0); }
  } catch (err) {
    if (token === routeId) fatal(err);
  }
}

async function boot() {
  try {
    const [cfg, unitsText, budgetText, bank] = await Promise.all([
      getOK('./data/scoring.json').then((r) => r.json()),
      getOK('./data/units.csv').then((r) => r.text()),
      getOK('./data/session_budget.csv').then((r) => r.text()),
      getOK('./content/questions/starter.json').then((r) => r.json()),
    ]);
    const store = await openStore();
    const opens = ((await store.getMeta('opens')) || 0) + 1;
    await store.setMeta('opens', opens);

    let persistAsked = false;
    ctx = {
      cfg, S: makeScoring(cfg), store, build: BUILD, opens,
      units: parseTable(unitsText),
      gymMinutes: Number(parseTable(budgetText).find((r) => r.arc === 'I').gym_min),
      bank: bank.questions,
      bankById: new Map(bank.questions.map((q) => [q.id, q])),
      updateReady: false,
      nav: (hash) => { location.hash = hash; },
      // Swap the current history entry for another screen, so Back from it never lands on a screen that acts on arrival.
      replace: (hash) => location.replace(hash),
      onLeave: (fn) => leaving.push(fn),
      alive: (token) => token === routeId,
      toast(text) {
        const el = h('div', { class: 'toast', role: 'status' }, text);
        document.body.append(el);
        setTimeout(() => el.remove(), 3500);
      },
      // Ask the browser to keep this site's data. Safari only says yes to an installed app; asking is harmless.
      requestPersist() {
        if (persistAsked || !(navigator.storage && navigator.storage.persist)) return;
        persistAsked = true;
        navigator.storage.persist().catch(() => {});
      },
    };
    ctx.requestPersist();
    addEventListener('hashchange', route);
    store.onChange(() => { /* screens read the store when they are drawn */ });

    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      // A new version took over while the app was open: say so on Today, and never reload in the middle of a session.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        ctx.updateReady = true;
        if (['', '#/today', '#/'].includes(location.hash)) route();
      });
    }
    await route();
  } catch (err) {
    fatal(err);
  }
}

boot();

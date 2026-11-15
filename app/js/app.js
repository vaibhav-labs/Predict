// Predict, Block 1: the Dial. Boot, routes (kept in the hash, so every relative URL works under /Predict/),
// and the few services every screen shares. No request leaves this site while the app runs, except the Coach tab's sync, which talks
// to api.github.com only after the player has saved a repo and a token (sync.js).
import { h } from './dom.js';
import { makeScoring } from './engine/scoring.js';
import { parseTable } from './engine/csv.js';
import { openStore } from './store.js';
import { BUILD } from './build.js';
import { todayScreen } from './ui/today.js';
import { gymScreen, summaryScreen } from './ui/gym.js';
import { mirrorScreen } from './ui/mirror.js';
import { pathScreen } from './ui/path.js';
import { lessonScreen } from './ui/lesson.js';
import { coachScreen } from './ui/coach.js';
import { journalScreen } from './ui/journal.js';
import { helpScreen } from './ui/help.js';
import { flagScreen } from './ui/flag.js';
import { rewriteScreen } from './ui/rewrite.js';
import { examScreen } from './ui/exam.js';
import { autopsyScreen } from './ui/autopsy.js';
import { rangeScreen, rangeSummaryScreen, rangeExamScreen } from './ui/ranges.js';
import { stepsOf } from './engine/update.js';
import { problemScreen, problemSummaryScreen, problemExamScreen } from './ui/problems.js';
import { recallScreen } from './ui/recall.js';
import { decideScreen } from './ui/decide.js';
import { fineScreen, fineSummaryScreen, fineExamScreen } from './ui/fine.js';
import { runLessonEngine } from './flags.js';
import * as SY from './sync.js';
import { compileCheckerRules } from './engine/journal.js';

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

const routes = {
  today: (c) => todayScreen(c),
  journal: (c, arg) => journalScreen(c, arg),
  mirror: (c) => mirrorScreen(c),
  coach: (c) => coachScreen(c),
  path: (c) => pathScreen(c),
  help: (c) => helpScreen(c),
  lesson: (c, arg) => lessonScreen(c, arg),
  summary: (c, arg) => summaryScreen(c, arg),
  flag: (c, arg) => flagScreen(c, arg),
  rewrite: (c, arg) => rewriteScreen(c, arg),
  exam: (c, arg) => examScreen(c, arg),
  autopsy: (c, arg) => autopsyScreen(c, arg),
  rsummary: (c, arg) => rangeSummaryScreen(c, arg),
  rexam: (c, arg) => rangeExamScreen(c, arg),
  range: async (c, arg, token) => { await rangeScreen(c, root, token, arg); return null; },
  psummary: (c, arg) => problemSummaryScreen(c, arg),
  pexam: (c, arg) => problemExamScreen(c, arg),
  prob: async (c, arg, token) => { await problemScreen(c, root, token, arg); return null; },
  recall: (c, arg, token) => recallScreen(c, arg, token),
  decide: (c, arg) => decideScreen(c, arg),
  fine: async (c, arg, token) => { await fineScreen(c, root, token, arg); return null; },
  fsummary: (c, arg) => fineSummaryScreen(c, arg),
  fexam: (c, arg) => fineExamScreen(c, arg),
  gym: async (c, arg, token) => { await gymScreen(c, root, token, arg); return null; },
};

// The screens that show lessons ask the lesson engine to look at the record first. Asking again changes nothing.
const READS_LESSONS = new Set(['today', 'journal', 'mirror', 'path', 'summary', 'flag', 'rewrite', 'exam', 'autopsy', 'lesson', 'rsummary', 'rexam', 'psummary', 'pexam', 'recall', 'decide', 'fsummary', 'fexam', 'fine']);

async function route() {
  const token = ++routeId;
  leaving.forEach((fn) => { try { fn(); } catch (e) { /* a cleanup that fails must not block the next screen */ } });
  leaving = [];
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = routes[name] || routes.today;
  try {
    if (READS_LESSONS.has(name) || !routes[name]) await runLessonEngine(ctx);
    const view = await fn(ctx, arg, token);
    if (view && token === routeId) { root.replaceChildren(view); window.scrollTo(0, 0); }
  } catch (err) {
    if (token === routeId) fatal(err);
  }
}

async function boot() {
  try {
    const [cfg, unitsText, budgetText, bank, topups, exam, ranges, fermi, rates, updates, know, tails, checkerText, journalBaselinesText, beltsText, triggersText, vagueText] = await Promise.all([
      getOK('./data/scoring.json').then((r) => r.json()),
      getOK('./data/units.csv').then((r) => r.text()),
      getOK('./data/session_budget.csv').then((r) => r.text()),
      getOK('./content/questions/starter.json').then((r) => r.json()),
      getOK('./content/questions/topups.json').then((r) => r.json()),
      getOK('./content/questions/exam-u1.json').then((r) => r.json()),
      getOK('./content/questions/ranges.json').then((r) => r.json()),
      getOK('./content/questions/fermi.json').then((r) => r.json()),
      getOK('./content/questions/rates.json').then((r) => r.json()),
      getOK('./content/questions/updates.json').then((r) => r.json()),
      getOK('./content/questions/know.json').then((r) => r.json()),
      getOK('./content/questions/tails.json').then((r) => r.json()),
      getOK('./data/checker_rules.csv').then((r) => r.text()),
      getOK('./data/journal_baselines.csv').then((r) => r.text()),
      getOK('./data/belts.csv').then((r) => r.text()),
      getOK('./data/lesson_triggers.csv').then((r) => r.text()),
      getOK('./data/vague_claims.csv').then((r) => r.text()),
    ]);
    const store = await openStore();
    const opens = ((await store.getMeta('opens')) || 0) + 1;
    await store.setMeta('opens', opens);

    let persistAsked = false;
    // Practice draws from the starter bank plus whatever the weekly review has added since (content/questions/topups.json, checked at build).
    const practice = bank.questions.concat(Array.isArray(topups.questions) ? topups.questions : []);
    const bankById = new Map(practice.map((q) => [q.id, q]));
    const examById = new Map(exam.questions.map((q) => [q.id, q]));
    const rangeById = new Map(ranges.questions.map((q) => [q.id, q]));
    const problemMap = new Map(fermi.questions.concat(rates.questions, updates.questions.flatMap(stepsOf), know.questions).map((q) => [q.id, q]));
    const tailMap = new Map(tails.questions.map((q) => [q.id, q]));
    ctx = {
      cfg, S: makeScoring(cfg), store, build: BUILD, opens,
      units: parseTable(unitsText),
      gymMinutes: Number(parseTable(budgetText).find((r) => r.arc === 'I').gym_min),
      journalMinutes: Number(parseTable(budgetText).find((r) => r.arc === 'I').journal_min),
      // Two pools: practice (the starter bank) and the Unit 1 exam. The exam pool is never served in practice.
      bank: practice,
      bankById,
      examBank: exam.questions,
      examById,
      questionById: (id) => bankById.get(id) || examById.get(id) || tailMap.get(id),
      // Range questions (Unit 3): practice and drills draw from one pool, the Unit 3 exam from the other.
      rangeBank: ranges.questions.filter((q) => q.pool === 'practice'),
      rangeExamBank: ranges.questions.filter((q) => q.pool === 'exam'),
      rangeById: (id) => rangeById.get(id),
      // Fermi problems (Unit 4) and base-rate problems, reference-class ladders and chains (Unit 5): practice and drills draw from the practice pools,
      // the exams from their own.
      fermiBank: fermi.questions.filter((q) => q.pool === 'practice'),
      fermiExamBank: fermi.questions.filter((q) => q.pool === 'exam'),
      rateBank: rates.questions.filter((q) => q.type === 'rate' && q.pool === 'practice'),
      rateExamBank: rates.questions.filter((q) => q.type === 'rate' && q.pool === 'exam'),
      classBank: rates.questions.filter((q) => q.type === 'class'),
      chainBank: rates.questions.filter((q) => q.type === 'chain'),
      // Unit 6 (updating): streams of two steps; the problem screen asks one step at a time, and `problemById` answers for a step id ('upd-…#1').
      updateBank: updates.questions.filter((q) => q.pool === 'practice'),
      updateExamBank: updates.questions.filter((q) => q.pool === 'exam'),
      // Units 7 to 9 (know yourself): choice problems by family. Practice and drills draw from the practice pool, the exams from their own.
      knowBank: (families, pool = 'practice') => know.questions.filter((q) => families.includes(q.family) && q.pool === pool),
      // Unit 10 (fine grain): tail-heavy binary questions. Practice and drills use one pool, the exam the other.
      fineBank: tails.questions.filter((q) => q.pool === 'practice'),
      fineExamBank: tails.questions.filter((q) => q.pool === 'exam'),
      fineById: (id) => tailMap.get(id),
      problemById: (id) => problemMap.get(id),
      triggers: parseTable(triggersText),
      vagueClaims: parseTable(vagueText),
      checkerRules: compileCheckerRules(parseTable(checkerText)),
      journalBaselines: parseTable(journalBaselinesText),
      belts: parseTable(beltsText),
      updateReady: false,
      nav: (hash) => { location.hash = hash; },
      // Swap the current history entry for another screen, so Back from it never lands on a screen that acts on arrival.
      replace: (hash) => location.replace(hash),
      // Draw the current screen again (an answer saved on a screen whose address does not change).
      refresh: () => route(),
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
    ctx.coach = await SY.loadCoach(store);
    ctx.letterSeen = (await store.getMeta('letterSeen')) || null;
    // Sync: only when a repo and a token are saved, only when online, one round at a time. `fetchFn` can be swapped by tests.
    let syncing = null, timer = null;
    ctx.sync = {
      fetchFn: (...a) => fetch(...a),
      status: async () => (await store.getMeta('syncStatus')) || null,
      configured: async () => !!(await SY.loadConfig(store)),
      async run() {
        if (syncing) return syncing;
        const cfgSaved = await SY.loadConfig(store);
        if (!cfgSaved) return { ok: false, off: true };
        syncing = (async () => {
          const at = new Date().toISOString();
          try {
            const client = SY.githubClient({ repo: cfgSaved.repo, token: cfgSaved.token, fetchFn: (...a) => ctx.sync.fetchFn(...a) });
            const res = await SY.syncNow({ store, client });
            ctx.coach = await SY.loadCoach(store);
            await store.setMeta('syncStatus', { at, ok: true, ...res });
            return { ok: true, ...res };
          } catch (err) {
            const out = { at, ok: false, error: SY.message(err), kind: err && err.kind };
            await store.setMeta('syncStatus', out);
            return out;
          } finally { syncing = null; }
        })();
        return syncing;
      },
      // After a change: wait a few seconds (a session writes many events), then push once.
      soon() {
        if (!navigator.onLine) return;
        clearTimeout(timer);
        timer = setTimeout(async () => { if (await SY.loadConfig(store)) { await ctx.sync.run(); } }, 4000);
      },
    };
    addEventListener('hashchange', route);
    store.onChange(() => ctx.sync.soon());
    addEventListener('online', () => ctx.sync.soon());
    ctx.sync.soon();

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

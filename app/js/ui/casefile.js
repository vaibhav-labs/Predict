// The case file: what a resolved prediction teaches, in five lenses (design/mechanics.md 4.9):
//   what happened, your reasoning, luck or judgment, your pattern, next time.
// Each lens is its own card so later blocks can add to one lens without touching the others.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as J from '../engine/journal.js';
import * as LE from '../engine/lessons.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { focusFrame, DOMAIN_NAMES, HORIZON_NAMES } from './common.js';
import { stepsOf, chainProductOf, outsideGrade, isOwnTask } from '../engine/reasoning.js';
import { markLabel, luckRead, recheckCard, USED } from './autopsy.js';

import { problemGateState } from '../flags.js';
const problemUnlocked = (ctx) => problemGateState(ctx, 'U5').open;
const OUTCOME_LABEL = { yes: 'Happened', no: "Didn't happen", void: 'Void' };

export function baselineCaption(p) {
  if (p.bSource === 'predict') return `Predict's outside view${p.bRef ? `: ${p.bRef}` : ''}`;
  return p.bSource === 'own' ? `your own rate for ${DOMAIN_NAMES[p.domain] || p.domain} · ${p.horizon}` : 'a starter guess, no history yet';
}

// One link of the chain. After an autopsy it carries the player's mark (held up, weak or missed it).
function chainLine(label, text, mark, note) {
  return h('div', null,
    mark ? h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, label), h('span', { class: `chip mark mark-${mark}` }, markLabel(mark))) : h('div', { class: 'eyebrow' }, label),
    h('p', null, text), note ? h('p', { class: 'cap' }, note) : null);
}

// The six-link chain exactly as it was locked. Open and due cards show it too. With an `audit` (filed at the autopsy) each link
// carries its mark; with `tests`, each signal says how it did on its own test: would it also have held in the cases that missed?
export function chainCard(p, { id, title = 'Your chain', audit = null, tests = false, after = [], cfg = null } = {}) {
  const a = audit || {};
  const test = (ev) => (tests ? (ev.test ? 'Its own test: it would also have held in the cases that missed.' : 'Its own test: it would not have held in the cases that missed.') : null);
  return h('section', { class: 'card stack', id },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, title)),
    chainLine('Outside view', `${p.chain.outsideView.text} (${Math.round(p.chain.outsideView.rate * 100)}%)`, a.outside),
    ...p.chain.evidence.map((ev, i) => chainLine(`Signal ${i + 1} (${ev.dir === 'up' ? 'supports' : 'against'})`, ev.text, (a.evidence || [])[i], test(ev))),
    ...(stepsOf(p).length >= 2 ? [chainLine('Chain steps', stepsOf(p).map((x) => `${x.text} (${Math.round(x.p * 100)}%)`).join(' · '), null, `Together: ${Math.round(chainProductOf(stepsOf(p)) * 1000) / 10}%. You said ${Math.round(p.c * 100)}%.`)] : []),
    ...(cfg && outsideGrade(p, cfg) ? [chainLine('Outside-view grade', outsideGrade(p, cfg).accepted ? 'Accepted: within the baseline.' : 'Not accepted: far from the baseline.', null, `You said ${Math.round(outsideGrade(p, cfg).stated * 100)}%; the baseline was ${Math.round(outsideGrade(p, cfg).reference * 100)}%.`)] : []),
    ...(isOwnTask(p) ? [chainLine('Your own task', 'You tagged this as something you were doing yourself.')] : []),
    chainLine('Case against', `${p.chain.caseAgainst.text} (${p.chain.caseAgainst.number})`, a.caseAgainst),
    chainLine('Tripwire', `${p.chain.tripwire.text} (to ${p.chain.tripwire.number})`, a.tripwire),
    ...after);
}

const lensHead = (n, title, right) => h('div', { class: 'shead' },
  h('span', { class: 'eyebrow' }, `${n} · ${title}`), right ? h('span', { class: 'cap' }, right) : null);

// 1. What happened: the dates, the outcome, your note.
function lensWhat(ctx, p) {
  return h('section', { class: 'card stack', id: 'lens-what' },
    lensHead(1, 'What happened', OUTCOME_LABEL[p.outcome]),
    h('p', null, `Locked ${p.d}, due ${p.due}, resolved ${p.resolvedAt ? R.localDay(new Date(p.resolvedAt)) : p.due}. You said ${pct(p.c)}.`),
    p.note ? h('p', null, p.note) : null,
    p.updates && p.updates.length ? h('div', { class: 'stack', id: 'what-updates' }, h('span', { class: 'eyebrow' }, 'Your updates'),
      h('ul', { class: 'rows' }, p.updates.map((u) => h('li', null, h('div', { class: 't' }, h('span', null, u.reason), h('em', null, `${u.d} · ${pct(u.prev)} to ${pct(u.c)}`)), h('span', { class: 'm num' }, `${u.c >= u.prev ? '+' : ''}${Math.round((u.c - u.prev) * 100)}`)))),
      h('p', { class: 'cap' }, `Locked at ${pct(p.c)}, ended at ${pct(p.cNow)}.`)) : null,
    p.source ? h('div', { class: 'stack', id: 'what-source', style: 'gap:2px' }, h('span', { class: 'cap' }, `Checked ${p.checkedDay || ''} by Predict. Source:`), h('a', { class: 'srclink', href: p.source, rel: 'noopener noreferrer', target: '_blank' }, p.source)) : null,
    p.outcome === 'void' ? h('p', { class: 'lede' }, 'Void: this one scores nothing.') : null);
}

// 3. Luck or judgment: the edge over the baseline, how likely what happened was at the baseline, and (once the autopsy is
// filed) what the player called it and whether the record agrees.
function lensLuck(ctx, p, env) {
  const read = p.outcome === 'void' ? null : luckRead(ctx, p);
  const a = env.autopsy;
  const verdict = a ? `You called it ${a.verdict === 'luck' ? 'luck' : 'judgment'}${a.suggested ? (a.suggested === a.verdict ? ', and the record agrees.' : `, while the record leans ${a.suggested === 'luck' ? 'luck' : 'judgment'}.`) : '.'}` : null;
  return h('section', { class: 'card stack', id: 'lens-luck' },
    lensHead(3, 'Luck or judgment'),
    p.outcome === 'void' ? h('p', { class: 'cap' }, 'No score on a void card.')
      : h('div', { class: 'sumgrid' },
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Baseline'), h('b', { class: 'num' }, pct(p.b)), h('span', { class: 'cap' }, baselineCaption(p))),
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Your edge'), h('b', { class: `num${!p.scored || p.edge < 0 ? ' bad' : ''}` }, p.scored ? signed(p.edge) : 'Unscored'), h('span', { class: 'cap' }, p.scored ? `raw ${signed(p.raw)}` : 'extra prediction'))),
    p.scored && typeof p.edge0 === 'number' && p.outcome !== 'void' ? h('p', { id: 'luck-updates' }, `Scored over ${p.days || 'its'} days at the number in force each day. The locked ${pct(p.c)} alone would have earned ${signed(p.edge0)}; with your updates the card earned ${signed(p.edge)}: ${p.edge - p.edge0 >= 0 ? 'your updates added' : 'your updates cost'} ${Math.abs(Math.round((p.edge - p.edge0) * 10) / 10)}.`) : null,
    read ? h('p', { id: 'luck-chance' }, `At the baseline (${pct(p.b)} for yes), what happened had a ${pct(read.chance)} chance${read.kind === 'luck' ? `: under ${pct(ctx.cfg.lessons.luck_rare_below)}, a rare outcome.` : '.'}`) : null,
    verdict ? h('p', { id: 'luck-verdict' }, h('b', null, verdict)) : null);
}

// One line of "your pattern": a group's sample, its record and what the sample can bear to say.
export function groupLine(g, perWhat = 'card') {
  if (!g || !g.n) return 'n=0 · nothing resolved here yet';
  const edge = g.avgPoints === null ? '' : ` · edge ${signed(Math.round(g.avgPoints))} a ${perWhat}`;
  if (g.thin) return `n=${g.n} · too few to say anything${edge}`;
  return `n=${g.n} · right ${pct(g.hitRate)} · said ${pct(g.meanConf)} · gap ${gapPts(g.gap)} pts (${g.verdict})${edge}`;
}

// 4. Your pattern: the journal-only record for this domain and horizon, with every sample size.
// Never a lesson from one case: a group under thin_below says "too few".
function lensPattern(ctx, p, env) {
  const mirror = ctx.cfg.mirror;
  const pat = J.patternFor(env.predictions, p, ctx.cfg.journal, { z: mirror.error_bar_z, thinBelow: mirror.thin_below });
  const why = p.outcome === 'void' ? 'it was void'
    : !p.scored ? 'it was an extra card for the day, logged but not scored'
      : J.isTrivial(p, ctx.cfg.journal) ? `its baseline (${pct(p.b)}) was a near-certainty, which says nothing about you`
        : J.isSelfControlled(p) ? 'it was about something fully in your own control' : null;
  const cell = pat.cell;
  const row = (id, label, text) => [h('dt', { id: `${id}-k` }, label), h('dd', { id }, text)];
  return h('section', { class: 'card stack', id: 'lens-pattern' },
    lensHead(4, 'Your pattern', `journal only · n=${pat.overall.n}`),
    why ? h('p', { class: 'cap', id: 'pattern-kept-out' }, `This card is kept out of your record because ${why}.`) : null,
    h('dl', { class: 'status wide' },
      ...row('pat-domain', `${DOMAIN_NAMES[p.domain] || p.domain}`, groupLine(pat.domain)),
      ...row('pat-horizon', HORIZON_NAMES[p.horizon] || p.horizon, groupLine(pat.horizon)),
      ...row('pat-cell', `${DOMAIN_NAMES[p.domain] || p.domain}, ${(HORIZON_NAMES[p.horizon] || p.horizon).toLowerCase()}`,
        cell ? `n=${cell.n} · edge ${signed(Math.round(cell.meanEdge))} a card` : 'n=0 · nothing resolved here yet'),
      ...row('pat-all', 'All journal', groupLine(pat.overall.summary))),
    h('p', { class: 'cap' }, `One card is a story, not a pattern. A group under ${mirror.thin_below} cards is shown but never read as a result.`));
}
// The rule the player wrote at the autopsy, and where its two re-checks stand. A re-check that has come due can be answered here.
function ruleBlock(ctx, a, repaint) {
  const today = R.localDay();
  const events = ctx.store.events;
  const days = ctx.cfg.lessons.autopsy.recheck_days;
  const rows = days.map((n, i) => {
    const step = i + 1;
    const answered = events.find((e) => e.type === 'recheck' && e.autopsy === a.id && e.step === step);
    const dueDay = R.addDays(a.d, n);
    if (answered) return h('li', null, h('div', { class: 't' }, h('span', null, `Day ${n}`), h('em', null, USED[answered.used] || answered.used)));
    if (today >= dueDay) return h('li', null, recheckCard(ctx, { autopsy: a, step, dueDay }, repaint));
    return h('li', null, h('div', { class: 't' }, h('span', null, `Day ${n}`), h('em', null, `Due on ${dueDay}`)));
  });
  return h('div', { class: 'stack', id: 'next-rule-block' },
    h('div', { class: 'eyebrow' }, 'Your rule'),
    h('p', { id: 'next-rule' }, h('b', null, a.rule)),
    h('p', { class: 'cap' }, `Shown above your next ${ctx.cfg.lessons.autopsy.rule_card_cards} journal cards, and checked again at ${days.join(' and ')} days.`),
    h('ul', { class: 'rows', id: 'next-rechecks' }, rows));
}

// 5. Next time: what the edge would have been at the other numbers, the rule and its re-checks.
function lensNext(ctx, p, env) {
  const table = p.outcome === 'void' ? [] : J.otherNumbers(ctx.S, p.b, p.outcome === 'yes', ctx.cfg.journal.edge_weight, p.c);
  return h('section', { class: 'card stack', id: 'lens-next' },
    lensHead(5, 'Next time', table.length ? 'if you had said…' : ''),
    table.length ? h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'You said'), h('th', null, 'Edge'))),
      h('tbody', null, table.map((row) => h('tr', { class: row.mine ? 'mine' : '' }, h('td', null, pct(row.c)), h('td', { class: row.edge < 0 ? 'bad' : '' }, signed(row.edge))))))
      : h('p', { class: 'cap' }, 'Nothing to compare on a void card.'),
    env.autopsy && env.autopsy.rule ? ruleBlock(ctx, env.autopsy, env.repaint) : null,
    // What Predict wrote about this card at a weekly review, when it did.
    ctx.coach && ctx.coach.reads[p.id] ? h('div', { class: 'stack', id: 'predict-read' }, h('div', { class: 'eyebrow' }, `Predict’s read · ${ctx.coach.reads[p.id].written}`), h('p', null, ctx.coach.reads[p.id].text)) : null);
}

export function caseFile(ctx, p, header, predictions, repaint) {
  const events = ctx.store.events;
  const autopsy = events.find((e) => e.type === 'autopsy' && e.prediction === p.id) || null;
  const due = LE.autopsyDue(predictions, events, ctx.cfg);
  const need = autopsy ? null : LE.needsAutopsy(p, due);
  const env = { predictions, autopsy, repaint };
  const banner = need ? h('section', { class: 'card nudge stack', id: 'autopsy-banner' },
    h('span', { class: 'eyebrow' }, 'Autopsy due'),
    h('p', null, need.kind === 'miss' ? 'This card missed at 85% or more. Its autopsy comes before your next journal step.' : 'This confident hit was picked for review. Its autopsy comes before your next journal step.'),
    h('a', { class: 'btn', href: `#/autopsy/${p.id}`, id: 'autopsy-open' }, 'Start the autopsy')) : null;
  const read = autopsy ? [
    h('div', null, h('div', { class: 'eyebrow' }, 'What I knew'), h('p', { id: 'reasoning-knew' }, autopsy.knew)),
    h('div', null, h('div', { class: 'eyebrow' }, autopsy.kind === 'miss' ? 'What I missed' : 'What I might have missed'), h('p', { id: 'reasoning-missed' }, autopsy.missed)),
  ] : [];
  return focusFrame({ title: 'Case file', closeTo: '#/journal' },
    header,
    banner,
    lensWhat(ctx, p, env),
    chainCard(p, { id: 'lens-reasoning', title: '2 · Your reasoning', audit: autopsy ? autopsy.audit : null, tests: true, after: read, cfg: problemUnlocked(ctx) ? ctx.cfg : null }),
    lensLuck(ctx, p, env),
    lensPattern(ctx, p, env),
    lensNext(ctx, p, env));
}

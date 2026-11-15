// The case file: what a resolved prediction teaches, in five lenses (design/mechanics.md 4.9):
//   what happened, your reasoning, luck or judgment, your pattern, next time.
// Each lens is its own card so later blocks can add to one lens without touching the others.
import { h } from '../dom.js';
import * as R from '../engine/record.js';
import * as J from '../engine/journal.js';
import { signed, pct, gapPts } from '../engine/scoring.js';
import { focusFrame, DOMAIN_NAMES, HORIZON_NAMES } from './common.js';

const OUTCOME_LABEL = { yes: 'Happened', no: "Didn't happen", void: 'Void' };

export function baselineCaption(p) {
  return p.bSource === 'own' ? `your own rate for ${DOMAIN_NAMES[p.domain] || p.domain} · ${p.horizon}` : 'a starter guess, no history yet';
}

function chainLine(label, text) {
  return h('div', null, h('div', { class: 'eyebrow' }, label), h('p', null, text));
}

// The six-link chain exactly as it was locked. Open and due cards show it too.
export function chainCard(p, { id, title = 'Your chain' } = {}) {
  return h('section', { class: 'card stack', id },
    h('div', { class: 'shead' }, h('span', { class: 'eyebrow' }, title)),
    chainLine('Outside view', `${p.chain.outsideView.text} (${Math.round(p.chain.outsideView.rate * 100)}%)`),
    ...p.chain.evidence.map((ev, i) => chainLine(`Signal ${i + 1} (${ev.dir === 'up' ? 'supports' : 'against'})`, ev.text)),
    chainLine('Case against', `${p.chain.caseAgainst.text} (${p.chain.caseAgainst.number})`),
    chainLine('Tripwire', `${p.chain.tripwire.text} (to ${p.chain.tripwire.number})`));
}

const lensHead = (n, title, right) => h('div', { class: 'shead' },
  h('span', { class: 'eyebrow' }, `${n} · ${title}`), right ? h('span', { class: 'cap' }, right) : null);

// 1. What happened: the dates, the outcome, your note.
function lensWhat(ctx, p) {
  return h('section', { class: 'card stack', id: 'lens-what' },
    lensHead(1, 'What happened', OUTCOME_LABEL[p.outcome]),
    h('p', null, `Locked ${p.d}, due ${p.due}, resolved ${p.resolvedAt ? R.localDay(new Date(p.resolvedAt)) : p.due}. You said ${pct(p.c)}.`),
    p.note ? h('p', null, p.note) : null,
    p.outcome === 'void' ? h('p', { class: 'lede' }, 'Void: this one scores nothing.') : null);
}

// 3. Luck or judgment: the edge over the baseline.
function lensLuck(ctx, p) {
  return h('section', { class: 'card stack', id: 'lens-luck' },
    lensHead(3, 'Luck or judgment'),
    p.outcome === 'void' ? h('p', { class: 'cap' }, 'No score on a void card.')
      : h('div', { class: 'sumgrid' },
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Baseline'), h('b', { class: 'num' }, pct(p.b)), h('span', { class: 'cap' }, baselineCaption(p))),
        h('div', { class: 'p' }, h('span', { class: 'eyebrow' }, 'Your edge'), h('b', { class: `num${!p.scored || p.edge < 0 ? ' bad' : ''}` }, p.scored ? signed(p.edge) : 'Unscored'), h('span', { class: 'cap' }, p.scored ? `raw ${signed(p.raw)}` : 'extra prediction'))));
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
// 5. Next time: what the edge would have been at the other numbers.
function lensNext(ctx, p) {
  const table = p.outcome === 'void' ? [] : J.otherNumbers(ctx.S, p.b, p.outcome === 'yes', ctx.cfg.journal.edge_weight, p.c);
  return h('section', { class: 'card stack', id: 'lens-next' },
    lensHead(5, 'Next time', table.length ? 'if you had said…' : ''),
    table.length ? h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'You said'), h('th', null, 'Edge'))),
      h('tbody', null, table.map((row) => h('tr', { class: row.mine ? 'mine' : '' }, h('td', null, pct(row.c)), h('td', { class: row.edge < 0 ? 'bad' : '' }, signed(row.edge))))))
      : h('p', { class: 'cap' }, 'Nothing to compare on a void card.'));
}

export function caseFile(ctx, p, header, predictions) {
  const env = { predictions };
  return focusFrame({ title: 'Case file', closeTo: '#/journal' },
    header,
    lensWhat(ctx, p, env),
    chainCard(p, { id: 'lens-reasoning', title: '2 · Your reasoning' }),
    lensLuck(ctx, p, env),
    lensPattern(ctx, p, env),
    lensNext(ctx, p, env));
}

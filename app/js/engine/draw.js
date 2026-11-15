// Choosing questions. Pure functions: give them a random-number function and they always answer the same way,
// which is how the tests check them. The mixes and windows come from data/scoring.json (the "gym" section).

// A small seeded generator (mulberry32) for tests; the app seeds it from the browser's own randomness.
export function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randomSeed() {
  const c = globalThis.crypto;
  return c && c.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32);
}

export function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Split `total` into whole numbers that follow `weights` as closely as possible (largest remainder).
export function apportion(total, weights) {
  const keys = Object.keys(weights);
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  const raw = keys.map((k) => (total * weights[k]) / sum);
  const out = Object.fromEntries(keys.map((k, i) => [k, Math.floor(raw[i])]));
  let left = total - Object.values(out).reduce((s, v) => s + v, 0);
  keys.map((k, i) => ({ k, r: raw[i] - Math.floor(raw[i]) })).sort((x, y) => y.r - x.r).forEach(({ k }) => { if (left-- > 0) out[k]++; });
  return out;
}

// Questions still open to draw: not answered yet and not disputed. If the bank is used up, the questions
// answered longest ago come back first (`lastUsed` maps id -> order, smaller = longer ago).
export function availablePool(bank, usedIds, disputedIds, need, lastUsed = new Map()) {
  const fresh = bank.filter((q) => !usedIds.has(q.id) && !disputedIds.has(q.id));
  if (fresh.length >= need) return { pool: fresh, reused: false };
  const old = bank.filter((q) => usedIds.has(q.id) && !disputedIds.has(q.id)).sort((a, b) => (lastUsed.get(a.id) ?? 0) - (lastUsed.get(b.id) ?? 0));
  return { pool: fresh.concat(old.slice(0, need - fresh.length)), reused: true };
}

// Baseline: the whole session is planned up front so it is balanced and can be resumed. Half the claims are true,
// half false, and difficulty follows the mix. Spares stand in for a question that times out.
export function planBaseline({ bank, usedIds = new Set(), disputedIds = new Set(), lastUsed, size, spares = 0, mix, rng }) {
  const need = size + spares;
  const { pool } = availablePool(bank, usedIds, disputedIds, need, lastUsed);
  const nTrue = Math.floor(size / 2) + (size % 2 && rng() < 0.5 ? 1 : 0);
  const quota = { true: nTrue, false: size - nTrue };
  // Difficulty follows the mix across the whole session; each difficulty is then split between true and false
  // as evenly as it can be, so the session totals come out at exactly nTrue true claims.
  const perDiff = apportion(size, mix);
  const trueByDiff = Object.fromEntries(Object.keys(perDiff).map((d) => [d, Math.floor(perDiff[d] / 2)]));
  let extraTrue = nTrue - Object.values(trueByDiff).reduce((a, b) => a + b, 0);
  for (const d of shuffle(Object.keys(perDiff).filter((d) => perDiff[d] % 2 === 1), rng)) { if (extraTrue > 0) { trueByDiff[d]++; extraTrue--; } }
  for (const d of Object.keys(perDiff)) { if (extraTrue > 0 && trueByDiff[d] < perDiff[d]) { trueByDiff[d]++; extraTrue--; } }
  const chosen = [];
  const taken = new Set();
  const take = (q) => { taken.add(q.id); chosen.push(q); };
  const shuffled = shuffle(pool, rng);
  for (const truth of [true, false]) {
    for (const diff of Object.keys(perDiff)) {
      const count = truth ? trueByDiff[diff] : perDiff[diff] - trueByDiff[diff];
      shuffled.filter((q) => q.answer === truth && q.diff === diff && !taken.has(q.id)).slice(0, count).forEach(take);
    }
    // A cell ran short: borrow from the same side, any difficulty.
    const have = chosen.filter((q) => q.answer === truth).length;
    shuffled.filter((q) => q.answer === truth && !taken.has(q.id)).slice(0, Math.max(0, quota[truth] - have)).forEach(take);
  }
  // Still short (a thin bank): fill from anything left.
  shuffled.filter((q) => !taken.has(q.id)).slice(0, Math.max(0, size - chosen.length)).forEach(take);
  const main = shuffle(chosen, rng);
  const extra = shuffle(shuffled.filter((q) => !taken.has(q.id)), rng).slice(0, spares);
  return main.concat(extra).map((q) => q.id);
}

// Practice: pick the next question from the open pool. If the recent hit rate is above the target band the mix
// shifts to harder questions, below it to easier ones. True and false are kept near half and half within the session.
export function pickNext({ bank, usedIds = new Set(), disputedIds = new Set(), skippedIds = new Set(), lastUsed, recent = [], shownTruths = [], cfg, rng }) {
  const { pool: all } = availablePool(bank, usedIds, disputedIds, 1, lastUsed);
  const pool = all.filter((q) => !skippedIds.has(q.id));
  const open = pool.length ? pool : all;
  if (!open.length) return null;
  const [lo, hi] = cfg.target_hit_rate;
  const window = recent.slice(-cfg.recent_window);
  const rate = window.length >= 8 ? window.filter(Boolean).length / window.length : null;
  const mix = rate === null ? cfg.difficulty_mix : rate > hi ? cfg.mix_when_hit_rate_high : rate < lo ? cfg.mix_when_hit_rate_low : cfg.difficulty_mix;

  const last10 = shownTruths.slice(-10);
  const t = last10.filter(Boolean).length, f = last10.length - t;
  const pTrue = Math.min(0.7, Math.max(0.3, 0.5 - (0.1 * (t - f)) / Math.max(1, t + f)));
  const wantTrue = rng() < pTrue;

  const diffs = Object.keys(mix).filter((d) => open.some((q) => q.diff === d));
  let r = rng() * diffs.reduce((s, d) => s + mix[d], 0);
  let diff = diffs[diffs.length - 1];
  for (const d of diffs) { r -= mix[d]; if (r <= 0) { diff = d; break; } }

  const attempts = [
    (q) => q.diff === diff && q.answer === wantTrue,
    (q) => q.diff === diff,
    (q) => q.answer === wantTrue,
    () => true,
  ];
  for (const ok of attempts) {
    const cell = open.filter(ok);
    if (cell.length) return cell[Math.floor(rng() * cell.length)];
  }
  return null;
}

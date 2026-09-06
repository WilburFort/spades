// Bidding heuristics shared by the bot tiers.

import { suitOf, rankOf, SPADES } from '../engine/cards.js';
import { NIL, partnerOf } from '../engine/scoring.js';
import { groupBySuit, nilDanger } from './analysis.js';

/**
 * Estimate how many tricks a hand should take with sensible play.
 * Returns a fractional estimate; callers round.
 */
export function estimateTricks(hand) {
  const g = groupBySuit(hand);
  const spades = g[SPADES];
  const n = spades.length;
  const ranks = new Set(spades.map(rankOf));
  let est = 0;

  // High spades.
  if (ranks.has(14)) est += 1;
  if (ranks.has(13)) est += n >= 2 ? 1 : 0.5;
  if (ranks.has(12)) est += n >= 3 ? 0.9 : n === 2 ? 0.55 : 0.25;
  if (ranks.has(11)) est += n >= 4 ? 0.65 : n === 3 ? 0.35 : 0.15;
  if (ranks.has(10)) est += n >= 5 ? 0.5 : n === 4 ? 0.25 : 0;
  // Length: spades beyond the third tend to win once others are drawn.
  if (n >= 4) est += (n - 3) * 0.75;
  if (n >= 6) est += (n - 5) * 0.2;
  est = Math.min(est, n);

  // Side suits.
  let voids = 0;
  let singletons = 0;
  for (let s = 0; s < 3; s++) {
    const cards = g[s];
    const L = cards.length;
    if (L === 0) {
      voids++;
      continue;
    }
    if (L === 1) singletons++;
    const r = new Set(cards.map(rankOf));
    if (r.has(14)) est += L <= 4 ? 1 : L === 5 ? 0.85 : 0.6;
    if (r.has(13)) est += L === 1 ? 0.35 : L <= 4 ? 0.7 : 0.45;
    if (r.has(12)) est += L === 1 ? 0.1 : L === 2 ? 0.25 : L <= 4 ? 0.35 : 0.2;
  }
  // Ruffing power from shortness when holding spades.
  if (n >= 3) {
    est += voids * 0.8 + singletons * 0.35;
  } else if (n === 2) {
    est += voids * 0.4 + singletons * 0.15;
  }
  return est;
}

/** Rough probability that a hand can run nil (take no tricks) with a covering partner. */
export function nilRisk(hand) {
  let total = 0;
  let worst = 0;
  for (const c of hand) {
    const d = nilDanger(c, hand); // 0..~19
    // Map danger to a per-card probability of being forced to win a trick.
    let p;
    if (d <= 4) p = 0.01;
    else if (d <= 6) p = 0.03;
    else if (d <= 8) p = 0.08;
    else if (d <= 10) p = 0.18;
    else if (d <= 12) p = 0.35;
    else if (d <= 14) p = 0.6;
    else p = 0.9;
    total += p;
    if (p > worst) worst = p;
  }
  return { expectedTricks: total, worst };
}

/** Standard-issue hand check for a nil bid at the intermediate level. */
export function looksLikeNil(hand) {
  const g = groupBySuit(hand);
  const spades = g[SPADES];
  if (spades.length > 3) return false;
  if (spades.some((c) => rankOf(c) >= 11)) return false;
  if (spades.length === 3 && spades.some((c) => rankOf(c) >= 9)) return false;
  for (let s = 0; s < 3; s++) {
    const cards = g[s];
    const r = cards.map(rankOf);
    if (r.includes(14)) return false;
    if (r.includes(13) && cards.length < 4) return false;
    if (r.includes(12) && cards.length < 3) return false;
    // A doubleton/singleton of high cards cannot be ducked.
    if (cards.length && cards.length <= 2 && Math.min(...r) >= 9) return false;
  }
  const { expectedTricks, worst } = nilRisk(hand);
  return expectedTricks < 0.9 && worst < 0.5;
}

/** Rookie bid: counts aces and kings, ignores protection, adds noise. */
export function rookieBid(view, rng) {
  const hand = view.hand;
  let count = 0;
  let spades = 0;
  for (const c of hand) {
    const r = rankOf(c);
    if (r === 14 || r === 13) count++;
    if (suitOf(c) === SPADES) spades++;
  }
  count += Math.max(0, spades - 3);
  const noise = rng.int(3) - 1; // -1, 0, +1
  let bid = Math.max(1, Math.min(7, count + noise));
  // Rookies sometimes bid nil on any weak-looking hand, without checking the details.
  if (count === 0 && spades <= 3 && view.options.allowNil && rng.chance(0.3)) bid = NIL;
  return bid;
}

/** Intermediate bid: protected-honour counting with a sober nil check. */
export function solidBid(view, rng) {
  const est = estimateTricks(view.hand);
  const partnerBid = view.bids[partnerOf(view.seat)];
  if (view.options.allowNil && looksLikeNil(view.hand)) {
    // Nil is easier with a strong partner; also more attractive when behind.
    const team = view.seat % 2;
    const behind = view.scores[1 - team] - view.scores[team];
    const partnerStrong = partnerBid !== null && partnerBid >= 4;
    if (partnerStrong || behind >= 50 || rng.chance(0.65)) return NIL;
  }
  let bid = Math.round(est - 0.15 + (rng.next() - 0.5) * 0.3);
  if (bid < 1) bid = 1;
  if (bid > 13) bid = 13;
  return bid;
}

/**
 * Expert heuristic bid used as the seed for Monte Carlo calibration: shades for
 * the total of bids already on the table and for the score situation.
 */
export function expertHeuristicBid(view) {
  const est = estimateTricks(view.hand);
  const others = view.bids.filter((b) => b !== null && b !== NIL).reduce((a, b) => a + b, 0);
  let adj = 0;
  if (others + est > 12.5) adj -= Math.min(1, others + est - 12.5) * 0.6; // over-subscribed table
  if (others + est < 9 && view.bids.filter((b) => b !== null).length === 3) adj += 0.3; // free tricks about — take them
  const team = view.seat % 2;
  const bags = view.bags[team];
  if (bags >= 7) adj += 0.3; // near a bag penalty: bid up to absorb tricks
  return est + adj;
}

/** Decide about blind nil before looking at the cards. Only bold or desperate players do it. */
export function wantsBlindNil(view, rng, tier) {
  if (!view.options.allowBlindNil || !view.options.allowNil) return false;
  const team = view.seat % 2;
  const deficit = view.scores[1 - team] - view.scores[team];
  if (deficit < view.options.blindNilMinDeficit) return false;
  const target = view.options.targetScore;
  const oppClose = view.scores[1 - team] >= target - 120;
  if (tier === 'rookie') return rng.chance(0.06);
  if (tier === 'solid') return (deficit >= 200 || oppClose) && rng.chance(0.08);
  // Expert: only as a real comeback attempt when the game is nearly lost.
  return (deficit >= 300 || (oppClose && deficit >= 200)) && rng.chance(0.2);
}

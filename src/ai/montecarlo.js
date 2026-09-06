// Monte Carlo search for the expert bot.
//
// The expert cannot see the other hands, so it repeatedly *imagines* them:
// it deals the unseen cards to the other seats in a way consistent with every
// void it has inferred, plays the hand out with the solid policy for every
// seat, and scores the result. Averaged over many imagined deals, this tells it
// which card (or which bid) does best.

import { suitOf, SPADES } from '../engine/cards.js';
import { playCard, PHASE, legalPlays } from '../engine/game.js';
import { viewFor, stateFromView } from '../engine/view.js';
import { NIL, teamOf, scoreHand } from '../engine/scoring.js';
import { analyze, distinctCandidates } from './analysis.js';
import { solidPlay, legalFromView } from './play.js';
import { estimateTricks, nilRisk } from './bidding.js';

const now = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();

/**
 * Deal the unseen cards to the other three seats, honouring inferred voids and
 * hand sizes, and (when `conditionOnBids` is set) preferring deals in which
 * each player's reconstructed original hand is consistent with the bid they
 * made. Returns an array of 4 hands (ours is left empty).
 */
export function sampleHands(view, a, rng, { conditionOnBids = true, maxTries = 24 } = {}) {
  const others = [0, 1, 2, 3].filter((s) => s !== view.seat);
  const alreadyPlayed = conditionOnBids ? playedBySeat(view) : null;
  let fallback = null;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const hands = dealWithVoids(view, a, rng, others);
    if (!hands) continue;
    if (!conditionOnBids) return hands;
    if (consistentWithBids(view, hands, alreadyPlayed, others)) return hands;
    fallback = hands;
  }
  return fallback || dealWithVoids(view, a, rng, others) || dealFreely(view, a, rng, others);
}

function playedBySeat(view) {
  const out = [[], [], [], []];
  for (const t of view.tricks) for (const p of t.plays) out[p.seat].push(p.card);
  for (const p of view.trick) out[p.seat].push(p.card);
  return out;
}

/** Does each other player's imagined full hand justify the bid they actually made? */
function consistentWithBids(view, hands, alreadyPlayed, others) {
  for (const s of others) {
    const bid = view.bids[s];
    if (bid === null) continue;
    const original = hands[s].concat(alreadyPlayed[s]);
    if (bid === NIL) {
      if (nilRisk(original).expectedTricks > 1.6) return false;
    } else {
      const est = estimateTricks(original);
      const slack = view.tricks.length >= 6 ? 2.2 : 1.6;
      if (Math.abs(est - bid) > slack) return false;
    }
  }
  return true;
}

function dealFreely(view, a, rng, others) {
  const hands = [[], [], [], []];
  const cards = rng.shuffle(a.unseen.slice());
  let i = 0;
  for (const seat of others) for (let k = 0; k < view.handSizes[seat]; k++) hands[seat].push(cards[i++]);
  return hands;
}

function dealWithVoids(view, a, rng, others) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const hands = [[], [], [], []];
    const room = view.handSizes.slice();
    room[view.seat] = 0;
    const cards = rng.shuffle(a.unseen.slice());
    // Place the most constrained cards first: suits with voids around the table.
    cards.sort((x, y) => constraintScore(a, others, y) - constraintScore(a, others, x));
    let ok = true;
    for (const c of cards) {
      const s = suitOf(c);
      const options = others.filter((seat) => room[seat] > 0 && !a.voids[seat][s]);
      if (!options.length) {
        ok = false;
        break;
      }
      // Weight by remaining room so hands fill evenly.
      let total = 0;
      for (const seat of options) total += room[seat];
      let r = rng.next() * total;
      let chosen = options[options.length - 1];
      for (const seat of options) {
        r -= room[seat];
        if (r < 0) {
          chosen = seat;
          break;
        }
      }
      hands[chosen].push(c);
      room[chosen]--;
    }
    if (ok) return hands;
  }
  return null;
}

function constraintScore(a, others, card) {
  const s = suitOf(card);
  let n = 0;
  for (const seat of others) if (a.voids[seat][s]) n++;
  return n;
}

/** Play the rest of the hand with the solid policy for every seat. */
export function rollout(state, rng, policyOpts) {
  let guard = 60;
  while (state.phase === PHASE.PLAYING && guard-- > 0) {
    const seat = state.turn;
    const card = solidPlay(viewFor(state, seat), rng, policyOpts);
    playCard(state, seat, card);
  }
  return state;
}

/** Points our team gained minus the opponents', with bags priced linearly. */
export function evaluate(state, myTeam) {
  const summary = state.lastHand;
  if (!summary) return 0;
  const opts = state.options;
  const bagPrice = opts.bagPenaltyAt > 0 ? opts.bagPenalty / opts.bagPenaltyAt : 0;
  const value = (t) => t.contractPoints + t.nilPoints - t.bagsAdded * bagPrice;
  let score = value(summary.teams[myTeam]) - value(summary.teams[1 - myTeam]);
  if (state.phase === PHASE.GAME_OVER) score += state.winner === myTeam ? 400 : -400;
  return score;
}

/**
 * Choose a card by Monte Carlo evaluation of each distinct candidate.
 * @param {object} view
 * @param {Rng} rng
 * @param {{rollouts?: number, timeBudgetMs?: number}} opts
 * @returns {{card: number, stats: Array<{card:number, mean:number, n:number}>}}
 */
export function monteCarloPlay(view, rng, opts = {}) {
  const rollouts = opts.rollouts ?? 40;
  const budget = opts.timeBudgetMs ?? 250;
  const legal = legalFromView(view);
  const a = analyze(view);
  const cands = distinctCandidates(a, legal);
  if (cands.length === 1) return { card: cands[0], stats: [] };

  const myTeam = teamOf(view.seat);
  const sums = new Map(cands.map((c) => [c, 0]));
  const start = now();
  let n = 0;
  for (; n < rollouts; n++) {
    if (n >= 4 && now() - start > budget) break;
    const hands = sampleHands(view, a, rng);
    for (const c of cands) {
      const state = stateFromView(view, hands);
      playCard(state, view.seat, c);
      rollout(state, rng);
      sums.set(c, sums.get(c) + evaluate(state, myTeam));
    }
  }
  const stats = cands.map((c) => ({ card: c, mean: sums.get(c) / Math.max(1, n), n }));
  // Best mean; break ties toward the heuristic's own choice, then the lower card.
  const heuristic = solidPlay(view, rng);
  stats.sort((x, y) => y.mean - x.mean || (x.card === heuristic ? -1 : y.card === heuristic ? 1 : x.card - y.card));
  return { card: stats[0].card, stats };
}

/**
 * Evaluate candidate bids by rollout. For every imagined deal each candidate is
 * played out with the same cards (common random numbers) and scored as team
 * points gained minus the opponents', bags priced linearly. Bids already made
 * are respected; unknown bids are estimated from the imagined hands.
 * @returns {{bid:number, stats:Array<{bid:number, mean:number, n:number, zeroTricks:number}>}}
 */
export function monteCarloBid(view, rng, opts = {}) {
  const samples = opts.samples ?? 32;
  const budget = opts.timeBudgetMs ?? 220;
  const candidates = opts.candidates ?? [1, 2, 3];
  const a = analyze(view);
  const me = view.seat;
  const myTeam = teamOf(me);
  const start = now();

  const sums = new Map(candidates.map((b) => [b, 0]));
  const zero = new Map(candidates.map((b) => [b, 0]));
  let n = 0;
  for (; n < samples; n++) {
    if (n >= 6 && now() - start > budget) break;
    const hands = sampleHands(view, a, rng);
    const guessed = view.bids.map((b, s) => (b !== null ? b : Math.max(1, Math.round(estimateTricks(hands[s]) - 0.15))));
    for (const cand of candidates) {
      const bids = guessed.slice();
      bids[me] = cand;
      const st = runBiddingRollout(view, hands, bids, rng);
      sums.set(cand, sums.get(cand) + evaluate(st, myTeam));
      if (st.tricksWon[me] === 0) zero.set(cand, zero.get(cand) + 1);
    }
  }
  const stats = candidates.map((b) => ({ bid: b, mean: sums.get(b) / Math.max(1, n), n, zeroTricks: zero.get(b) / Math.max(1, n) }));
  stats.sort((x, y) => y.mean - x.mean);
  return { bid: stats[0].bid, stats };
}

function runBiddingRollout(view, hands, bids, rng, policyOpts = {}) {
  const state = stateFromView(view, hands);
  state.bids = bids;
  state.blind = [false, false, false, false];
  state.phase = PHASE.PLAYING;
  state.leader = (view.dealer + 1) % 4;
  state.turn = state.leader;
  state.trick = [];
  state.tricks = [];
  state.tricksWon = [0, 0, 0, 0];
  state.spadesBroken = false;
  rollout(state, rng, policyOpts);
  return state;
}

export { legalPlays, scoreHand };

// The information a single seat is allowed to see. Bots receive a View, never
// the full state, so they cannot cheat by peeking at other hands.

import { cloneState } from './game.js';

/**
 * Build a player's view of the game. Other players' hands are replaced by their
 * card counts; everything else (bids, played cards, scores) is public.
 */
export function viewFor(state, seat) {
  return {
    seat,
    phase: state.phase,
    options: state.options,
    handNumber: state.handNumber,
    dealer: state.dealer,
    scores: [...state.scores],
    bags: [...state.bags],
    hand: [...state.hands[seat]],
    handSizes: state.hands.map((h) => h.length),
    bids: [...state.bids],
    blind: [...state.blind],
    tricksWon: [...state.tricksWon],
    turn: state.turn,
    leader: state.leader,
    trick: state.trick.map((p) => ({ ...p })),
    tricks: state.tricks,
    spadesBroken: state.spadesBroken,
  };
}

/**
 * Reconstruct a full state object from a view plus a hypothetical assignment
 * of the unseen cards to the other seats. Used by Monte Carlo rollouts.
 */
export function stateFromView(view, hypotheticalHands) {
  const hands = hypotheticalHands.map((h, i) => (i === view.seat ? [...view.hand] : [...h]));
  return cloneState({
    seed: 0,
    rngState: 1,
    options: view.options,
    phase: view.phase,
    handNumber: view.handNumber,
    dealer: view.dealer,
    scores: view.scores,
    bags: view.bags,
    hands,
    bids: view.bids,
    blind: view.blind,
    tricksWon: view.tricksWon,
    turn: view.turn,
    leader: view.leader,
    trick: view.trick,
    tricks: view.tricks,
    spadesBroken: view.spadesBroken,
    history: [],
    winner: null,
    lastHand: null,
  });
}

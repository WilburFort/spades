// Game state and rules for partnership Spades.
//
// The state is a plain object mutated in place by the exported functions.
// Functions return an array of events describing what happened so that the UI
// can animate and the coach can explain. `cloneState` gives a cheap deep copy
// (used by the AI for rollouts).
//
// Seats: 0 = South (the human by default), 1 = West, 2 = North, 3 = East.
// Play proceeds clockwise: 0 → 1 → 2 → 3 → 0.  Teams are seat % 2.

import { Rng, randomSeed } from './rng.js';
import { fullDeck, suitOf, isSpade, SPADES, rankOf } from './cards.js';
import { DEFAULT_OPTIONS, NIL, scoreHand, checkGameOver, teamOf, partnerOf } from './scoring.js';

export const PHASE = Object.freeze({
  IDLE: 'idle',
  BIDDING: 'bidding',
  PLAYING: 'playing',
  HAND_OVER: 'handOver',
  GAME_OVER: 'gameOver',
});

export function nextSeat(seat) {
  return (seat + 1) % 4;
}

export { teamOf, partnerOf };

/**
 * Create a new game. Nothing is dealt until `startHand` is called.
 */
export function newGame({ seed = randomSeed(), options = {}, firstDealer = null } = {}) {
  const rng = new Rng(seed);
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dealer = firstDealer === null ? rng.int(4) : firstDealer;
  return {
    seed,
    rngState: rng.state,
    options: opts,
    phase: PHASE.IDLE,
    handNumber: 0,
    dealer: (dealer + 3) % 4, // startHand advances the dealer first
    scores: [0, 0],
    bags: [0, 0],
    hands: [[], [], [], []],
    bids: [null, null, null, null],
    blind: [false, false, false, false],
    tricksWon: [0, 0, 0, 0],
    turn: null,
    leader: null,
    trick: [], // [{seat, card}] cards in the current trick, in play order
    tricks: [], // completed tricks this hand: [{leader, plays:[{seat,card}], winner}]
    spadesBroken: false,
    history: [], // per-hand summaries
    winner: null,
    lastHand: null,
  };
}

function rngOf(state) {
  const r = new Rng(1);
  r.state = state.rngState;
  return r;
}

function saveRng(state, r) {
  state.rngState = r.state;
}

/** Deal a new hand. Dealer rotates clockwise; player left of dealer bids first. */
export function startHand(state) {
  if (state.phase !== PHASE.IDLE && state.phase !== PHASE.HAND_OVER) {
    throw new Error(`Cannot start a hand during phase ${state.phase}`);
  }
  const r = rngOf(state);
  const deck = r.shuffle(fullDeck());
  saveRng(state, r);

  state.handNumber += 1;
  state.dealer = nextSeat(state.dealer);
  state.hands = [[], [], [], []];
  // Deal one card at a time starting left of dealer, as at a real table.
  let seat = nextSeat(state.dealer);
  for (let i = 0; i < 52; i++) {
    state.hands[seat].push(deck[i]);
    seat = nextSeat(seat);
  }
  for (const h of state.hands) h.sort((a, b) => a - b);

  state.bids = [null, null, null, null];
  state.blind = [false, false, false, false];
  state.tricksWon = [0, 0, 0, 0];
  state.trick = [];
  state.tricks = [];
  state.spadesBroken = false;
  state.leader = nextSeat(state.dealer);
  state.turn = state.leader;
  state.phase = PHASE.BIDDING;
  state.lastHand = null;
  return [{ type: 'handStarted', handNumber: state.handNumber, dealer: state.dealer, firstBidder: state.turn }];
}

/** Is `seat` currently allowed to bid blind nil? */
export function canBidBlindNil(state, seat) {
  if (!state.options.allowNil || !state.options.allowBlindNil) return false;
  const team = teamOf(seat);
  const deficit = state.scores[1 - team] - state.scores[team];
  return deficit >= state.options.blindNilMinDeficit;
}

/** Validate a bid without applying it. Returns an error string or null. */
export function bidError(state, seat, bid, blind = false) {
  if (state.phase !== PHASE.BIDDING) return 'Not the bidding phase';
  if (seat !== state.turn) return `It is seat ${state.turn}'s turn to bid`;
  if (!Number.isInteger(bid) || bid < 0 || bid > 13) return 'Bid must be a whole number from 0 (nil) to 13';
  if (bid === NIL && !state.options.allowNil) return 'Nil bids are disabled';
  if (blind) {
    if (bid !== NIL) return 'Only nil may be bid blind';
    if (!canBidBlindNil(state, seat)) return 'Blind nil is only allowed when far enough behind';
  }
  return null;
}

/** Apply a bid. When all four are in, play begins with the player left of the dealer. */
export function placeBid(state, seat, bid, { blind = false } = {}) {
  const err = bidError(state, seat, bid, blind);
  if (err) throw new Error(err);
  state.bids[seat] = bid;
  state.blind[seat] = !!blind;
  const events = [{ type: 'bid', seat, bid, blind: !!blind }];
  if (state.bids.every((b) => b !== null)) {
    state.phase = PHASE.PLAYING;
    state.leader = nextSeat(state.dealer);
    state.turn = state.leader;
    events.push({ type: 'biddingComplete', bids: [...state.bids], leader: state.leader });
  } else {
    state.turn = nextSeat(seat);
    events.push({ type: 'turn', seat: state.turn, phase: PHASE.BIDDING });
  }
  return events;
}

/** The suit led in the current trick, or null if leading. */
export function ledSuit(state) {
  return state.trick.length ? suitOf(state.trick[0].card) : null;
}

/**
 * Legal cards for `seat` to play right now, given hand `hand` (defaults to the
 * seat's actual hand). Rules: must follow suit when able; spades may not be led
 * until broken unless the hand is all spades.
 */
export function legalPlays(state, seat, hand = state.hands[seat]) {
  if (state.trick.length === 0) {
    if (state.spadesBroken) return [...hand];
    const nonSpades = hand.filter((c) => !isSpade(c));
    return nonSpades.length ? nonSpades : [...hand];
  }
  const suit = ledSuit(state);
  const follow = hand.filter((c) => suitOf(c) === suit);
  return follow.length ? follow : [...hand];
}

/** Why a card cannot be played right now (or null if it can). Used by the coach. */
export function playError(state, seat, card) {
  if (state.phase !== PHASE.PLAYING) return 'Not the play phase';
  if (seat !== state.turn) return 'Not your turn';
  if (!state.hands[seat].includes(card)) return 'You do not hold that card';
  const legal = legalPlays(state, seat);
  if (legal.includes(card)) return null;
  if (state.trick.length === 0) return 'spadesNotBroken';
  return 'mustFollowSuit';
}

/** Winner of a complete trick: highest spade if any, else highest of the led suit. */
export function trickWinner(plays) {
  const led = suitOf(plays[0].card);
  let best = null;
  for (const p of plays) {
    const s = suitOf(p.card);
    if (best === null) {
      best = p;
      continue;
    }
    const bs = suitOf(best.card);
    if (s === SPADES && bs !== SPADES) best = p;
    else if (s === bs && rankOf(p.card) > rankOf(best.card)) best = p;
    else if (s === led && bs !== led && bs !== SPADES) best = p; // cannot happen (best starts as led) but keeps intent clear
  }
  return best.seat;
}

/** Winning play so far in the current (possibly incomplete) trick. */
export function currentWinner(state) {
  if (!state.trick.length) return null;
  return trickWinner(state.trick);
}

/** Play a card. Resolves the trick when it is the fourth card; scores the hand after the 13th trick. */
export function playCard(state, seat, card) {
  const err = playError(state, seat, card);
  if (err) throw new Error(err === 'spadesNotBroken' ? 'Spades have not been broken' : err === 'mustFollowSuit' ? 'You must follow suit' : err);

  const hand = state.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  state.trick.push({ seat, card });
  const events = [{ type: 'play', seat, card, trickIndex: state.tricks.length }];

  if (isSpade(card) && !state.spadesBroken) {
    state.spadesBroken = true;
    events.push({ type: 'spadesBroken', seat, card });
  }

  if (state.trick.length < 4) {
    state.turn = nextSeat(seat);
    events.push({ type: 'turn', seat: state.turn, phase: PHASE.PLAYING });
    return events;
  }

  const winner = trickWinner(state.trick);
  state.tricksWon[winner] += 1;
  const completed = { leader: state.leader, plays: state.trick, winner };
  state.tricks.push(completed);
  events.push({ type: 'trickWon', winner, plays: completed.plays, trickIndex: state.tricks.length - 1 });
  state.trick = [];

  if (state.tricks.length === 13) {
    events.push(...finishHand(state));
  } else {
    state.leader = winner;
    state.turn = winner;
    events.push({ type: 'turn', seat: winner, phase: PHASE.PLAYING });
  }
  return events;
}

function finishHand(state) {
  const result = scoreHand(state.bids, state.blind, state.tricksWon, state.bags, state.options);
  const before = [...state.scores];
  for (const t of result.teams) {
    state.scores[t.team] += t.total;
    state.bags[t.team] = t.bagsAfter;
  }
  const summary = {
    handNumber: state.handNumber,
    dealer: state.dealer,
    bids: [...state.bids],
    blind: [...state.blind],
    tricksWon: [...state.tricksWon],
    teams: result.teams,
    scoresBefore: before,
    scoresAfter: [...state.scores],
  };
  state.history.push(summary);
  state.lastHand = summary;
  state.turn = null;
  state.leader = null;

  const over = checkGameOver(state.scores, state.options);
  const events = [{ type: 'handOver', summary }];
  if (over.over) {
    state.phase = PHASE.GAME_OVER;
    state.winner = over.winner;
    events.push({ type: 'gameOver', winner: over.winner, reason: over.reason, scores: [...state.scores] });
  } else {
    state.phase = PHASE.HAND_OVER;
  }
  return events;
}

/** Deep-enough copy for AI rollouts (hands and trick arrays are copied; options shared). */
export function cloneState(state) {
  return {
    ...state,
    scores: [...state.scores],
    bags: [...state.bags],
    hands: state.hands.map((h) => [...h]),
    bids: [...state.bids],
    blind: [...state.blind],
    tricksWon: [...state.tricksWon],
    trick: state.trick.map((p) => ({ ...p })),
    tricks: state.tricks.slice(),
    history: state.history,
  };
}

/** Every card that has been played so far this hand (completed tricks + current trick). */
export function playedCards(state) {
  const out = [];
  for (const t of state.tricks) for (const p of t.plays) out.push(p.card);
  for (const p of state.trick) out.push(p.card);
  return out;
}

/** Team bid (sum of non-nil bids) and whether each seat is nil. */
export function teamBid(state, team) {
  let bid = 0;
  for (const s of team === 0 ? [0, 2] : [1, 3]) if (state.bids[s] !== null && state.bids[s] !== NIL) bid += state.bids[s];
  return bid;
}

export function teamTricks(state, team) {
  return team === 0 ? state.tricksWon[0] + state.tricksWon[2] : state.tricksWon[1] + state.tricksWon[3];
}

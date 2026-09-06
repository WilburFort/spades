// Shared analysis helpers for the bots. Everything here works from a View
// (see engine/view.js) so bots can only reason about public information plus
// their own hand.

import { suitOf, rankOf, SPADES, isSpade } from '../engine/cards.js';
import { trickWinner } from '../engine/game.js';
import { NIL, partnerOf, teamOf } from '../engine/scoring.js';

/** Compute everything a bot might want to know about the current position. */
export function analyze(view) {
  const me = view.seat;
  const partner = partnerOf(me);
  const myTeam = teamOf(me);

  const playedSet = new Set();
  for (const t of view.tricks) for (const p of t.plays) playedSet.add(p.card);
  for (const p of view.trick) playedSet.add(p.card);

  const handSet = new Set(view.hand);
  const unseen = [];
  for (let c = 0; c < 52; c++) if (!playedSet.has(c) && !handSet.has(c)) unseen.push(c);

  // Void inference: a player who did not follow suit has none of that suit.
  const voids = [
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
    [false, false, false, false],
  ];
  const inspect = (plays) => {
    if (!plays.length) return;
    const led = suitOf(plays[0].card);
    for (let i = 1; i < plays.length; i++) {
      if (suitOf(plays[i].card) !== led) voids[plays[i].seat][led] = true;
    }
  };
  for (const t of view.tricks) inspect(t.plays);
  inspect(view.trick);
  // A player who leads a spade before spades were "broken" had only spades — but
  // that is already implied by the void flags later; nothing more to infer.

  const unseenBySuit = [[], [], [], []];
  for (const c of unseen) unseenBySuit[suitOf(c)].push(c);
  const highestUnseen = unseenBySuit.map((cards) => (cards.length ? rankOf(cards[cards.length - 1]) : 0));

  const nilSeats = [];
  for (let s = 0; s < 4; s++) if (view.bids[s] === NIL) nilSeats.push(s);
  const nilLive = view.bids.map((b, s) => b === NIL && view.tricksWon[s] === 0);

  const bidOf = (team) => {
    let b = 0;
    for (const s of team === 0 ? [0, 2] : [1, 3]) if (view.bids[s] !== null && view.bids[s] !== NIL) b += view.bids[s];
    return b;
  };
  const tricksOf = (team) => (team === 0 ? view.tricksWon[0] + view.tricksWon[2] : view.tricksWon[1] + view.tricksWon[3]);
  const teamBid = [bidOf(0), bidOf(1)];
  const teamTricks = [tricksOf(0), tricksOf(1)];
  // Tricks still needed to make the contract (nil bidders' tricks count only under the default rule).
  const need = [teamBid[0] - teamTricks[0], teamBid[1] - teamTricks[1]];
  const tricksRemaining = 13 - view.tricks.length; // including the current one

  const trick = view.trick;
  const leading = trick.length === 0;
  const ledSuit = leading ? null : suitOf(trick[0].card);
  const winnerSeat = leading ? null : trickWinner(trick);
  const winnerCard = leading ? null : trick.find((p) => p.seat === winnerSeat).card;
  const playedSeats = new Set(trick.map((p) => p.seat));
  // Seats still to play after me in this trick, in order.
  const seatsAfterMe = [];
  for (let k = 1; k <= 3 - trick.length; k++) seatsAfterMe.push((me + k) % 4);
  const isLast = trick.length === 3;

  return {
    me,
    partner,
    myTeam,
    oppTeam: 1 - myTeam,
    hand: view.hand,
    playedSet,
    unseen,
    unseenBySuit,
    highestUnseen,
    voids,
    nilSeats,
    nilLive,
    teamBid,
    teamTricks,
    need,
    tricksRemaining,
    leading,
    ledSuit,
    winnerSeat,
    winnerCard,
    partnerWinning: winnerSeat === partner,
    isLast,
    seatsAfterMe,
    partnerYetToPlay: !leading && !playedSeats.has(partner) && partner !== me,
    spadesOut: unseenBySuit[SPADES].length,
    spadesBroken: view.spadesBroken,
  };
}

/** Would `card` be the winning card of the trick so far (before later players act)? */
export function beatsCurrent(a, card) {
  if (a.leading) return true;
  const ws = suitOf(a.winnerCard);
  const cs = suitOf(card);
  if (cs === SPADES && ws !== SPADES) return true;
  if (cs !== ws) return false;
  return rankOf(card) > rankOf(a.winnerCard);
}

/**
 * Is `card` guaranteed to win the trick if played now, no matter what later
 * players do? True when it beats the current winner and no unseen card can top
 * it (accounting for the possibility of a later player trumping).
 */
export function isSureWinner(a, card, { assumeNoTrump = false } = {}) {
  if (!beatsCurrent(a, card)) return false;
  const s = suitOf(card);
  const r = rankOf(card);
  // Any unseen card of the same suit outranking ours?
  if (a.highestUnseen[s] > r) {
    // Only matters if a later player could hold and legally play it.
    if (a.seatsAfterMe.length) return false;
  }
  if (s !== SPADES && !assumeNoTrump) {
    // A later player void in the led suit could trump.
    if (a.spadesOut > 0) {
      for (const seat of a.seatsAfterMe) {
        if (a.voids[seat][a.ledSuit ?? s]) return false; // known void → real trump danger
      }
      // Unknown voids: treat as safe only late in the hand when few cards remain.
      // (Heuristic callers decide; this function stays optimistic here.)
    }
  }
  return true;
}

/** Cards in `cards` that would beat the current winner. */
export function winningCards(a, cards) {
  return cards.filter((c) => beatsCurrent(a, c));
}

export function lowestOf(cards) {
  let best = null;
  for (const c of cards) if (best === null || rankOf(c) < rankOf(best) || (rankOf(c) === rankOf(best) && c < best)) best = c;
  return best;
}

export function highestOf(cards) {
  let best = null;
  for (const c of cards) if (best === null || rankOf(c) > rankOf(best) || (rankOf(c) === rankOf(best) && c > best)) best = c;
  return best;
}

/** Lowest card of a list that still beats the current winner, or null. */
export function lowestWinner(a, cards) {
  return lowestOf(winningCards(a, cards));
}

export function highestWinner(a, cards) {
  return highestOf(winningCards(a, cards));
}

/** Highest card of the led suit that stays below the current winner (for ducking), or null. */
export function highestUnder(a, cards) {
  const under = cards.filter((c) => !beatsCurrent(a, c));
  return highestOf(under);
}

/** Group cards by suit, ascending. */
export function groupBySuit(cards) {
  const g = [[], [], [], []];
  for (const c of cards) g[suitOf(c)].push(c);
  for (const s of g) s.sort((x, y) => x - y);
  return g;
}

/**
 * Prune equivalent cards: two cards of one suit are interchangeable when every
 * card ranked between them is already played or in our own hand. Returns one
 * representative (the lowest) per class, preserving the caller's order.
 */
export function distinctCandidates(a, cards) {
  const groups = groupBySuit(cards);
  const out = [];
  for (let s = 0; s < 4; s++) {
    const g = groups[s];
    if (!g.length) continue;
    let rep = g[0];
    out.push(rep);
    for (let i = 1; i < g.length; i++) {
      const prev = g[i - 1];
      const cur = g[i];
      let equivalent = true;
      for (let c = prev + 1; c < cur; c++) {
        if (!a.playedSet.has(c) && !a.hand.includes(c)) {
          equivalent = false;
          break;
        }
      }
      if (!equivalent) {
        rep = cur;
        out.push(rep);
      }
    }
  }
  return out;
}

/** Danger score of holding a card when trying to take no tricks (higher = more likely to win a trick). */
export function nilDanger(card, hand) {
  const s = suitOf(card);
  const r = rankOf(card);
  const suitLen = hand.filter((c) => suitOf(c) === s).length;
  let d = r - 2; // 0..12
  if (s === SPADES) d += 4; // spades win when others are void
  if (suitLen <= 1) d += 3; // singleton high card cannot be ducked
  else if (suitLen === 2) d += 1;
  return d;
}

/** Is `seat` on the other team from `me`? */
export function isOpponent(me, seat) {
  return teamOf(me) !== teamOf(seat);
}

/** Count of a suit in a hand. */
export function countSuit(hand, suit) {
  let n = 0;
  for (const c of hand) if (suitOf(c) === suit) n++;
  return n;
}

export { isSpade };

// Card-play policies.
//
//  rookiePlay — deliberately naive: wins with the highest card, tramples the
//               partner, trumps for fun, throws random cards when it cannot win.
//  solidPlay  — a sensible intermediate player: follows the usual partnership
//               conventions, ducks under partners, covers/defends nils, manages
//               bags once the contract is made. Also the rollout policy for the
//               expert's Monte Carlo search.

import { suitOf, rankOf, SPADES, isSpade } from '../engine/cards.js';
import { legalPlays } from '../engine/game.js';
import { NIL, teamOf } from '../engine/scoring.js';
import {
  analyze, beatsCurrent, winningCards, lowestOf, highestOf, lowestWinner, highestWinner,
  highestUnder, groupBySuit, nilDanger,
} from './analysis.js';

/** Legal plays computed from a view. */
export function legalFromView(view) {
  return legalPlays({ trick: view.trick, spadesBroken: view.spadesBroken }, view.seat, view.hand);
}

// ---------------------------------------------------------------- rookie

export function rookiePlay(view, rng) {
  const legal = legalFromView(view);
  if (legal.length === 1) return legal[0];
  const a = analyze(view);
  const myNil = view.bids[a.me] === NIL && a.nilLive[a.me];

  if (myNil) {
    // Knows to play low, but not much else.
    return rng.chance(0.8) ? lowestOf(legal) : rng.pick(legal);
  }

  if (a.leading) {
    if (rng.chance(0.5)) {
      const groups = groupBySuit(legal).filter((g) => g.length);
      return highestOf(rng.pick(groups));
    }
    return rng.pick(legal);
  }

  const inSuit = legal.every((c) => suitOf(c) === a.ledSuit);
  if (inSuit) {
    const winners = winningCards(a, legal);
    if (winners.length) return highestOf(winners); // even over partner
    return rng.chance(0.7) ? lowestOf(legal) : rng.pick(legal);
  }
  // Void in the led suit.
  const spades = legal.filter(isSpade);
  const spadeWinners = winningCards(a, spades);
  if (spadeWinners.length && rng.chance(0.6)) return highestOf(spadeWinners);
  const nonSpades = legal.filter((c) => !isSpade(c));
  if (nonSpades.length) return rng.chance(0.6) ? lowestOf(nonSpades) : rng.pick(nonSpades);
  return lowestOf(legal);
}

// ---------------------------------------------------------------- solid

/**
 * @param {object} view
 * @param {Rng} rng
 * @param {object} [opts]
 * @param {boolean} [opts.individualNeed] treat each seat's own bid as its target (used when
 *        measuring one hand's trick-taking capacity during bidding rollouts)
 */
export function solidPlay(view, rng, opts = {}) {
  const legal = legalFromView(view);
  if (legal.length === 1) return legal[0];
  const a = analyze(view);
  const me = a.me;
  const partner = a.partner;
  const myBid = view.bids[me];
  const myNil = myBid === NIL && a.nilLive[me];
  const partnerNil = view.bids[partner] === NIL && a.nilLive[partner];
  const oppNilSeat = [(me + 1) % 4, (me + 3) % 4].find((s) => view.bids[s] === NIL && a.nilLive[s]);

  let myNeed = a.need[a.myTeam];
  const oppNeed = a.need[a.oppTeam];
  if (opts.individualNeed) myNeed = (myBid === NIL ? 0 : myBid) - view.tricksWon[me];

  // ---- Do we want this trick?
  let want;
  if (myNil) want = false;
  else if (partnerNil) want = true;
  else if (myNeed > 0) want = true;
  else if (oppNeed > 0) {
    // Contract made; take tricks only when it can set the opponents.
    const slack = a.tricksRemaining - oppNeed;
    want = slack <= 1;
  } else want = false;

  // ---- Opponent nil defence: keep the trick low when the nil bidder is still to play,
  //      and never overtake a nil bidder who is currently winning.
  const oppNilToPlay = oppNilSeat !== undefined && a.seatsAfterMe.includes(oppNilSeat);
  const oppNilWinning = oppNilSeat !== undefined && a.winnerSeat === oppNilSeat;

  if (a.leading) return lead(a, view, legal, { myNil, partnerNil, oppNilSeat, want, myNeed, rng });

  const inSuit = legal.every((c) => suitOf(c) === a.ledSuit);

  // ---- My own nil: duck.
  if (myNil) {
    if (inSuit) {
      const under = highestUnder(a, legal);
      if (under !== null) return under;
      // Every card wins so far. Last to play: forced — dump the highest. Otherwise hope.
      return a.isLast ? highestOf(legal) : lowestOf(legal);
    }
    // Void: shed the most dangerous card that does NOT take the trick (a spade would trump!).
    const safe = legal.filter((c) => !beatsCurrent(a, c));
    if (safe.length) return dumpForNil(safe);
    return a.isLast ? highestOf(legal) : lowestOf(legal);
  }

  // ---- Covering partner's nil.
  if (partnerNil) {
    if (a.partnerYetToPlay) {
      if (inSuit) {
        const w = highestWinner(a, legal);
        return w !== null ? w : lowestOf(legal);
      }
      const sw = lowestWinner(a, legal.filter(isSpade));
      if (sw !== null) return sw;
      return discardNormal(a, legal, false);
    }
    if (a.partnerWinning) {
      // Rescue the partner at any cost.
      if (inSuit) {
        const w = lowestWinner(a, legal);
        if (w !== null) return w;
        return lowestOf(legal);
      }
      const sw = lowestWinner(a, legal.filter(isSpade));
      if (sw !== null) return sw;
      return discardNormal(a, legal, false);
    }
    // Partner already ducked safely: play normally, prefer taking.
  }

  if (oppNilWinning && !partnerNil) {
    // Let the nil bidder keep it.
    if (inSuit) {
      const under = highestUnder(a, legal);
      if (under !== null) return under;
      return lowestOf(legal);
    }
    return discardNormal(a, legal, myNeed <= 0);
  }

  if (oppNilToPlay && !partnerNil) {
    // Keep the trick as low as possible so the nil bidder is squeezed.
    if (inSuit) return lowestOf(legal);
    return discardNormal(a, legal, myNeed <= 0);
  }

  // ---- Normal following.
  if (inSuit) {
    if (a.partnerWinning) {
      if (a.isLast) return lowestOf(legal);
      const partnerSure = rankOf(a.winnerCard) > a.highestUnseen[a.ledSuit] || suitOf(a.winnerCard) === SPADES;
      if (partnerSure || !want) return lowestOf(legal);
      // Partner's card could be beaten by a later opponent: protect with a sure winner if cheap.
      const sure = legal.filter((c) => beatsCurrent(a, c) && rankOf(c) > a.highestUnseen[a.ledSuit]);
      if (sure.length && rankOf(a.winnerCard) <= 10) return lowestOf(sure);
      return lowestOf(legal);
    }
    const winners = winningCards(a, legal);
    if (want && winners.length) {
      if (a.isLast) return lowestOf(winners);
      const onlyPartnerLeft = a.seatsAfterMe.length === 1 && a.seatsAfterMe[0] === partner;
      if (onlyPartnerLeft) return lowestOf(winners);
      const sure = winners.filter((c) => rankOf(c) > a.highestUnseen[a.ledSuit]);
      if (sure.length) return lowestOf(sure);
      return highestOf(winners);
    }
    if (!want && a.isLast && winners.length === legal.length) return highestOf(legal); // forced to win: dump the biggest
    return lowestOf(legal);
  }

  // ---- Void in the led suit.
  const spades = legal.filter(isSpade);
  const spadeWinners = winningCards(a, spades);
  if (want && spadeWinners.length && !(a.partnerWinning && partnerSafe(a))) {
    if (a.partnerWinning) {
      // Partner's card could be ruffed by a later opponent: only protect with a spade that opponent cannot beat.
      const sure = spadeWinners.filter((c) => rankOf(c) > a.highestUnseen[SPADES]);
      if (!sure.length) return discardNormal(a, legal, false);
      return lowestOf(sure);
    }
    return lowestOf(spadeWinners);
  }
  return discardNormal(a, legal, !want);
}

/**
 * Is the partner's currently winning card safe enough that we should not
 * overtake or trump it? A boss card (above every unseen card of its suit) is
 * safe unless a later opponent is known to be void in that suit and could ruff.
 */
export function partnerSafe(a) {
  if (a.isLast) return true;
  if (suitOf(a.winnerCard) === SPADES) return rankOf(a.winnerCard) > a.highestUnseen[SPADES];
  if (rankOf(a.winnerCard) <= a.highestUnseen[a.ledSuit]) return false;
  if (a.spadesOut === 0) return true;
  for (const seat of a.seatsAfterMe) {
    if (seat !== a.partner && a.voids[seat][a.ledSuit]) return false; // an opponent may trump it
  }
  return true;
}

/** Choose a discard when void: dump dangerous cards if avoiding tricks, else shorten a side suit. */
function discardNormal(a, legal, avoiding) {
  const nonSpades = legal.filter((c) => !isSpade(c));
  if (avoiding) {
    if (nonSpades.length) return highestOf(nonSpades);
    return highestOf(legal);
  }
  if (nonSpades.length) {
    // Lowest card from the shortest side suit — works toward a void we can ruff.
    const groups = groupBySuit(nonSpades).filter((g) => g.length);
    groups.sort((x, y) => x.length - y.length || rankOf(x[0]) - rankOf(y[0]));
    // Do not throw away a bare ace/king if another suit offers a harmless low card.
    for (const g of groups) if (rankOf(g[0]) <= 10) return g[0];
    return groups[0][0];
  }
  return lowestOf(legal);
}

function dumpForNil(legal) {
  let best = null;
  let bestD = -1;
  for (const c of legal) {
    const d = nilDanger(c, legal);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function lead(a, view, legal, ctx) {
  const { myNil, partnerNil, oppNilSeat, want, myNeed } = ctx;
  const groups = groupBySuit(legal);
  const nonSpades = legal.filter((c) => !isSpade(c));

  if (myNil) {
    // Lead the lowest card we own, preferring a suit where it is genuinely low.
    return lowestOf(nonSpades.length ? nonSpades : legal);
  }

  if (partnerNil) {
    // Take the lead with power so partner can shed dangerous cards.
    const sure = sureWinnersOnLead(a, legal);
    if (sure.length) return highestOf(sure);
    return highestOf(nonSpades.length ? nonSpades : legal);
  }

  if (oppNilSeat !== undefined) {
    // Squeeze the nil bidder with low leads in suits they still hold.
    const usable = nonSpades.filter((c) => !a.voids[oppNilSeat][suitOf(c)]);
    const pool = usable.length ? usable : nonSpades.length ? nonSpades : legal;
    return lowestOf(pool);
  }

  if (want) {
    const sure = sureWinnersOnLead(a, legal);
    const sideSure = sure.filter((c) => !isSpade(c));
    if (sideSure.length) return highestOf(sideSure);
    const spades = groups[SPADES];
    if (spades.length && a.spadesBroken) {
      const top = highestOf(spades);
      if (rankOf(top) > a.highestUnseen[SPADES] && (spades.length >= 3 || myNeed >= 2)) return top;
    }
    if (sure.length) return highestOf(sure);
    // Lead low from the longest side suit and let the partner win cheaply.
    const side = groups.slice(0, 3).filter((g) => g.length);
    if (side.length) {
      side.sort((x, y) => y.length - x.length || rankOf(x[0]) - rankOf(y[0]));
      return side[0][0];
    }
    return lowestOf(legal);
  }

  // Avoiding bags: lead the lowest card we have, side suits first.
  if (nonSpades.length) return lowestOf(nonSpades);
  return lowestOf(legal);
}

/** Cards that will win the trick if led: above every unseen card of the suit and not trumpable as far as we know. */
function sureWinnersOnLead(a, legal) {
  const out = [];
  for (const c of legal) {
    const s = suitOf(c);
    if (rankOf(c) <= a.highestUnseen[s]) continue;
    if (s !== SPADES && a.spadesOut > 0) {
      // Trump danger from a known void.
      let danger = false;
      for (let seat = 0; seat < 4; seat++) if (seat !== a.me && a.voids[seat][s]) danger = true;
      if (danger) continue;
    }
    out.push(c);
  }
  return out;
}

export { teamOf };

// Hand scoring for partnership Spades.
//
// Inputs are plain arrays indexed by seat (0..3). Teams are seat % 2:
//   team 0 = seats 0 & 2, team 1 = seats 1 & 3.
// A bid of 0 is nil. `blind[seat]` marks a blind nil (worth double).

export const NIL = 0;

export const DEFAULT_OPTIONS = Object.freeze({
  targetScore: 500,        // first team to reach this wins (must not be tied)
  losingScore: null,       // e.g. -200 to lose immediately; null disables
  bagPenaltyAt: 10,        // accumulate this many bags ...
  bagPenalty: 100,         // ... and lose this many points
  nilBonus: 100,
  blindNilBonus: 200,
  allowNil: true,
  allowBlindNil: true,
  blindNilMinDeficit: 100, // must be behind by at least this much to bid blind nil
  nilTricksHelpPartner: true, // tricks taken by a failed nil count toward partner's bid
  tenForTwoHundred: false, // a made team bid of 10+ scores 200 (fails cost 200)
});

export function teamOf(seat) {
  return seat % 2;
}

export function partnerOf(seat) {
  return (seat + 2) % 4;
}

export function seatsOfTeam(team) {
  return team === 0 ? [0, 2] : [1, 3];
}

/**
 * Score a completed hand.
 * @param {number[]} bids  bids per seat (0 = nil)
 * @param {boolean[]} blind blind-nil flag per seat
 * @param {number[]} tricks tricks won per seat
 * @param {number[]} bagsBefore accumulated bags per team before this hand
 * @param {object} options
 * @returns {{teams: TeamResult[]}}
 *
 * TeamResult = {
 *   team, bid, tricksCounted, tricksTotal, made, contractPoints, overtricks,
 *   bagsAdded, bagsBefore, bagsAfter, bagPenalty, nils: [{seat, blind, made, points, tricks}],
 *   total
 * }
 */
export function scoreHand(bids, blind, tricks, bagsBefore, options = DEFAULT_OPTIONS) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const teams = [];
  for (let team = 0; team < 2; team++) {
    const seats = seatsOfTeam(team);
    let bid = 0;
    let tricksCounted = 0;
    let tricksTotal = 0;
    const nils = [];
    for (const s of seats) {
      tricksTotal += tricks[s];
      if (bids[s] === NIL) {
        const made = tricks[s] === 0;
        const bonus = blind[s] ? opts.blindNilBonus : opts.nilBonus;
        nils.push({ seat: s, blind: !!blind[s], made, tricks: tricks[s], points: made ? bonus : -bonus });
        if (!made && opts.nilTricksHelpPartner) tricksCounted += tricks[s];
      } else {
        bid += bids[s];
        tricksCounted += tricks[s];
      }
    }

    const made = tricksCounted >= bid;
    let contractPoints = 0;
    let overtricks = 0;
    let bagsAdded = 0;
    if (bid === 0) {
      // Team bid nothing (double nil or nil + nothing). Every trick is a bag.
      overtricks = tricksTotal;
      bagsAdded = tricksTotal;
      contractPoints = overtricks;
    } else if (made) {
      const big = opts.tenForTwoHundred && bid >= 10;
      contractPoints = big ? 200 : bid * 10;
      // Bags: every trick beyond the bid, including tricks a failed nil bidder took.
      overtricks = tricksTotal - bid;
      if (overtricks < 0) overtricks = 0;
      bagsAdded = overtricks;
      contractPoints += overtricks;
    } else {
      const big = opts.tenForTwoHundred && bid >= 10;
      contractPoints = big ? -200 : -bid * 10;
    }

    let bagsAfter = bagsBefore[team] + bagsAdded;
    let bagPenalty = 0;
    if (opts.bagPenaltyAt > 0) {
      while (bagsAfter >= opts.bagPenaltyAt) {
        bagsAfter -= opts.bagPenaltyAt;
        bagPenalty -= opts.bagPenalty;
      }
    }

    const nilPoints = nils.reduce((sum, n) => sum + n.points, 0);
    const total = contractPoints + nilPoints + bagPenalty;
    teams.push({
      team,
      bid,
      tricksCounted,
      tricksTotal,
      made,
      contractPoints,
      overtricks,
      bagsAdded,
      bagsBefore: bagsBefore[team],
      bagsAfter,
      bagPenalty,
      nils,
      nilPoints,
      total,
    });
  }
  return { teams };
}

/**
 * Decide whether the game is over.
 * @returns {{over: boolean, winner: number|null, reason: string}}
 */
export function checkGameOver(scores, options = DEFAULT_OPTIONS) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const [a, b] = scores;
  const reachedA = a >= opts.targetScore;
  const reachedB = b >= opts.targetScore;
  if (reachedA || reachedB) {
    if (a === b) return { over: false, winner: null, reason: 'tied at target — play another hand' };
    return { over: true, winner: a > b ? 0 : 1, reason: 'target' };
  }
  if (opts.losingScore !== null && opts.losingScore !== undefined) {
    const bustA = a <= opts.losingScore;
    const bustB = b <= opts.losingScore;
    if (bustA || bustB) {
      if (a === b) return { over: false, winner: null, reason: 'both bust and tied — play another hand' };
      return { over: true, winner: a > b ? 0 : 1, reason: 'bust' };
    }
  }
  return { over: false, winner: null, reason: '' };
}

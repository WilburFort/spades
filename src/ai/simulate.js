// Headless game runner: four bots play a full game. Used by the simulation
// harness and by tests to prove the skill tiers really differ.

import { newGame, startHand, placeBid, playCard, canBidBlindNil, PHASE } from '../engine/game.js';
import { viewFor } from '../engine/view.js';
import { NIL } from '../engine/scoring.js';
import { createBot } from './bots.js';

/**
 * @param {string[]} tiers four tiers by seat
 * @param {{seed?: number, options?: object, botOpts?: object, maxHands?: number}} cfg
 */
export function playGame(tiers, cfg = {}) {
  const seed = cfg.seed ?? 1;
  const bots = tiers.map((t, i) => createBot(t, { seed: seed * 7 + i * 101, ...(cfg.botOpts || {}) }));
  const game = newGame({ seed, options: cfg.options || {} });
  const maxHands = cfg.maxHands ?? 40;
  const handStats = [];

  while (game.phase !== PHASE.GAME_OVER && game.handNumber < maxHands) {
    startHand(game);
    // Blind nil decisions happen before anyone looks at their cards.
    const blindIntent = [false, false, false, false];
    for (let s = 0; s < 4; s++) if (canBidBlindNil(game, s)) blindIntent[s] = bots[s].chooseBlindNil(viewFor(game, s));

    while (game.phase === PHASE.BIDDING) {
      const seat = game.turn;
      if (blindIntent[seat] && canBidBlindNil(game, seat)) placeBid(game, seat, NIL, { blind: true });
      else placeBid(game, seat, bots[seat].chooseBid(viewFor(game, seat)));
    }
    while (game.phase === PHASE.PLAYING) {
      const seat = game.turn;
      playCard(game, seat, bots[seat].choosePlay(viewFor(game, seat)));
    }
    handStats.push(game.lastHand);
  }
  return { game, handStats, winner: game.winner, scores: game.scores, hands: game.handNumber };
}

/** Aggregate statistics over many games for a fixed lineup. */
export function runSeries(tiers, games, cfg = {}) {
  const agg = {
    tiers,
    games: 0,
    wins: [0, 0],
    hands: 0,
    seat: [0, 1, 2, 3].map(() => ({ bids: 0, made: 0, nils: 0, nilsMade: 0, tricks: 0, bidTotal: 0 })),
    team: [0, 1].map(() => ({ contracts: 0, made: 0, bags: 0, points: 0 })),
  };
  for (let g = 0; g < games; g++) {
    const seed = (cfg.seedBase ?? 1000) + g;
    const r = playGame(tiers, { ...cfg, seed });
    agg.games++;
    if (r.winner !== null) agg.wins[r.winner]++;
    agg.hands += r.hands;
    for (const h of r.handStats) {
      for (let s = 0; s < 4; s++) {
        const st = agg.seat[s];
        if (h.bids[s] === NIL) {
          st.nils++;
          if (h.tricksWon[s] === 0) st.nilsMade++;
        } else {
          st.bids++;
          st.bidTotal += h.bids[s];
        }
        st.tricks += h.tricksWon[s];
      }
      for (const t of h.teams) {
        const ts = agg.team[t.team];
        if (t.bid > 0) {
          ts.contracts++;
          if (t.made) ts.made++;
        }
        ts.bags += t.bagsAdded;
        ts.points += t.total;
      }
    }
  }
  return agg;
}

export function formatSeries(agg) {
  const lines = [];
  const name = (t) => `${agg.tiers[t]}+${agg.tiers[t + 2]}`;
  lines.push(`Lineup: seats [${agg.tiers.join(', ')}]  games=${agg.games} avg hands/game=${(agg.hands / agg.games).toFixed(1)}`);
  for (let t = 0; t < 2; t++) {
    const ts = agg.team[t];
    lines.push(
      `  Team ${t} (${name(t)}): wins ${agg.wins[t]}/${agg.games} (${((100 * agg.wins[t]) / agg.games).toFixed(0)}%)` +
        `  contracts made ${ts.contracts ? ((100 * ts.made) / ts.contracts).toFixed(0) : '-'}%` +
        `  bags/hand ${(ts.bags / agg.hands).toFixed(2)}  pts/hand ${(ts.points / agg.hands).toFixed(1)}`
    );
  }
  for (let s = 0; s < 4; s++) {
    const st = agg.seat[s];
    lines.push(
      `    seat ${s} ${agg.tiers[s].padEnd(6)} avg bid ${(st.bidTotal / Math.max(1, st.bids)).toFixed(2)}` +
        ` avg tricks ${(st.tricks / agg.hands).toFixed(2)}  nils ${st.nils} (made ${st.nilsMade})`
    );
  }
  return lines.join('\n');
}

// Bot factory. Three tiers of skill:
//
//   rookie — counts aces and kings, plays its highest card to win, tramples
//            its partner, trumps whenever it can. Charming, beatable.
//   solid  — a competent club player: protected-honour bidding, ducks under a
//            winning partner, covers and defends nils, manages bags.
//   expert — the solid player's knowledge plus card counting, void inference
//            and Monte Carlo look-ahead for every non-trivial bid and play.

import { Rng } from '../engine/rng.js';
import { NIL } from '../engine/scoring.js';
import { rookieBid, solidBid, expertHeuristicBid, wantsBlindNil, looksLikeNil, nilRisk, nilContext } from './bidding.js';
import { rookiePlay, solidPlay } from './play.js';
import { monteCarloPlay, monteCarloBid } from './montecarlo.js';

export const TIERS = ['rookie', 'solid', 'expert'];

/**
 * @param {'rookie'|'solid'|'expert'} tier
 * @param {{seed?: number, rollouts?: number, bidSamples?: number, timeBudgetMs?: number}} [opts]
 */
export function createBot(tier, opts = {}) {
  if (!TIERS.includes(tier)) throw new Error(`Unknown bot tier: ${tier}`);
  const rng = new Rng(opts.seed ?? 12345);
  const rollouts = opts.rollouts ?? 40;
  const bidSamples = opts.bidSamples ?? 32;
  const timeBudgetMs = opts.timeBudgetMs ?? 250;
  const mcBid = opts.mcBid ?? true;
  let lastThought = null;

  const bot = {
    tier,
    get lastThought() {
      return lastThought;
    },

    /** Called before the bot looks at its cards, only when eligible. */
    chooseBlindNil(view) {
      return wantsBlindNil(view, rng, tier);
    },

    chooseBid(view) {
      if (tier === 'rookie') {
        const b = rookieBid(view, rng);
        if (b === NIL || !opts.bidBias) return b;
        return Math.max(1, Math.min(13, b + opts.bidBias));
      }
      if (tier === 'solid') return solidBid(view, rng);
      return expertBid(view);
    },

    choosePlay(view) {
      if (tier === 'rookie') return rookiePlay(view, rng);
      if (tier === 'solid') return solidPlay(view, rng);
      const { card, stats } = monteCarloPlay(view, rng, { rollouts, timeBudgetMs });
      lastThought = stats;
      return card;
    },
  };

  function expertBid(view) {
    const heuristic = expertHeuristicBid(view);
    if (!mcBid) {
      if (view.options.allowNil && looksLikeNil(view.hand)) return NIL;
      return Math.max(1, Math.min(13, Math.round(heuristic - 0.15)));
    }
    const { partnerNil, oppNil } = nilContext(view);
    const h = Math.max(1, Math.min(13, Math.round(heuristic + (partnerNil ? 0.5 : 0))));
    const candidates = [...new Set([Math.max(1, h - 1), h, Math.min(13, h + 1)])];
    const team = view.seat % 2;
    const behind = view.scores[1 - team] - view.scores[team];
    const risk = nilRisk(view.hand).expectedTricks;
    let nilPlausible = view.options.allowNil && (looksLikeNil(view.hand) || risk < (behind >= 150 ? 1.6 : 1.3));
    if (partnerNil) nilPlausible = false; // never a voluntary double nil
    if (oppNil && risk >= 0.6) nilPlausible = false; // an opponent's nil makes ours much harder to make
    if (nilPlausible) candidates.push(NIL);

    const mc = monteCarloBid(view, rng, { samples: bidSamples, timeBudgetMs, candidates });
    let best = mc.stats[0];
    const heuristicStat = mc.stats.find((s) => s.bid === h);
    // Prefer the heuristic's own bid unless the rollouts clearly disagree.
    if (best.bid !== h && heuristicStat && best.mean - heuristicStat.mean < 4) best = heuristicStat;
    if (best.bid === NIL) {
      // Nil must also succeed often enough in the rollouts to be worth the swing.
      const lcb = best.zeroTricks - Math.sqrt((best.zeroTricks * (1 - best.zeroTricks)) / Math.max(1, best.n));
      const needed = behind >= 150 ? 0.5 : 0.6;
      if (lcb < needed) best = mc.stats.find((s) => s.bid !== NIL) || best;
    }
    lastThought = { bid: best.bid, heuristic, stats: mc.stats };
    return best.bid;
  }

  return bot;
}

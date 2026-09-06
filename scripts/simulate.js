#!/usr/bin/env node
// Bot-vs-bot simulation harness.
//
//   node scripts/simulate.js                 # default matchups, 40 games each
//   node scripts/simulate.js 100             # 100 games each
//   node scripts/simulate.js 50 expert,solid,expert,solid   # custom lineup by seat
//
// Set ROLLOUTS=8 to make the expert faster (weaker) for quick runs.

import { runSeries, formatSeries } from '../src/ai/simulate.js';

const games = Number(process.argv[2] || 40);
const custom = process.argv[3] ? process.argv[3].split(',') : null;
const rollouts = Number(process.env.ROLLOUTS || 24);
const bidSamples = Number(process.env.BID_SAMPLES || 20);
const botOpts = { rollouts, bidSamples, timeBudgetMs: 10_000 };

const matchups = custom
  ? [custom]
  : [
      ['solid', 'rookie', 'solid', 'rookie'],
      ['expert', 'solid', 'expert', 'solid'],
      ['expert', 'rookie', 'expert', 'rookie'],
    ];

for (const tiers of matchups) {
  const t0 = Date.now();
  const agg = runSeries(tiers, games, { botOpts, seedBase: 5000 });
  console.log(formatSeries(agg));
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
}

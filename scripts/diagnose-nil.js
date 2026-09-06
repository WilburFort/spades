#!/usr/bin/env node
// Diagnostic: how do nil bids fare for a given tier, and what breaks them?
//   node scripts/diagnose-nil.js solid 400

import { newGame, startHand, placeBid, playCard, PHASE, viewFor, cardToString, sortHandForDisplay } from '../src/engine/index.js';
import { createBot } from '../src/ai/index.js';
import { nilRisk } from '../src/ai/bidding.js';
import { NIL } from '../src/engine/scoring.js';

const tier = process.argv[2] || 'solid';
const hands = Number(process.argv[3] || 300);
const bots = [0, 1, 2, 3].map((i) => createBot(i % 2 === 0 ? tier : 'solid', { seed: 77 + i, rollouts: 12, bidSamples: 12, timeBudgetMs: 5000 }));

let attempts = 0, made = 0;
const failures = [];
for (let seed = 1; seed <= hands; seed++) {
  const g = newGame({ seed: 40000 + seed, firstDealer: seed % 4 });
  startHand(g);
  const original = g.hands.map((h) => h.slice());
  while (g.phase === PHASE.BIDDING) placeBid(g, g.turn, bots[g.turn].chooseBid(viewFor(g, g.turn)));
  const breaker = [null, null, null, null];
  while (g.phase === PHASE.PLAYING) {
    const seat = g.turn;
    const card = bots[seat].choosePlay(viewFor(g, seat));
    const ev = playCard(g, seat, card);
    const won = ev.find((e) => e.type === 'trickWon');
    if (won && g.bids[won.winner] === NIL && breaker[won.winner] === null) {
      breaker[won.winner] = won.plays.map((p) => `${p.seat === won.winner ? '*' : ''}${cardToString(p.card)}`).join(' ');
    }
  }
  for (let s = 0; s < 4; s++) {
    if (g.bids[s] !== NIL || s % 2 !== 0) continue;
    attempts++;
    if (g.tricksWon[s] === 0) made++;
    else failures.push({ hand: sortHandForDisplay(original[s]).map(cardToString).join(' '), risk: nilRisk(original[s]).expectedTricks.toFixed(2), tricks: g.tricksWon[s], breaker: breaker[s], partnerBid: g.bids[(s + 2) % 4] });
  }
}
console.log(`${tier}: nil attempts ${attempts}, made ${made} (${attempts ? Math.round((100 * made) / attempts) : 0}%) over ${hands} hands`);
for (const f of failures.slice(0, 25)) console.log(`  took ${f.tricks}  risk ${f.risk}  partner bid ${f.partnerBid}  hand: ${f.hand}\n      broken by: ${f.breaker}`);

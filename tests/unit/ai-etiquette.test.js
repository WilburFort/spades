// Partnership etiquette and bidding discipline that reviewers flagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startHand, placeBid, playCard, parseCard, cardToString, viewFor, Rng, legalPlays } from '../../src/engine/index.js';
import { solidPlay, analyze, distinctCandidates } from '../../src/ai/index.js';
import { applyVetoes, evaluate } from '../../src/ai/montecarlo.js';
import { solidBid } from '../../src/ai/bidding.js';
import { createBot } from '../../src/ai/bots.js';
import { scoreHand, DEFAULT_OPTIONS } from '../../src/engine/scoring.js';

function rig(hands, { bids = [3, 3, 3, 3], dealer = 3 } = {}) {
  const g = newGame({ seed: 1, firstDealer: dealer });
  startHand(g);
  g.hands = hands.map((h) => h.map(parseCard).sort((a, b) => a - b));
  for (let i = 0; i < 4; i++) placeBid(g, g.turn, bids[i]);
  return g;
}

test('solid partner does not trump the partner\'s boss card in third seat', () => {
  // Dealer 3 → seat 0 leads. Q♦ K♦ A♦ have been played earlier (we simulate by removing them from all hands).
  // Seat 0 leads J♦ (boss), seat 1 follows low, seat 2 (partner, void in diamonds) must not ruff.
  const g = rig([
    ['JD', '2C', '3C', '4C', '5H'],
    ['4D', '5C', '6C', '7C', '6H'],
    ['7S', '8C', '9C', '10C', '7H'],
    ['3D', 'JC', 'QC', 'KC', '8H'],
  ]);
  // Pretend the higher diamonds are gone: record them as played in an earlier trick.
  g.tricks.push({ leader: 3, plays: [{ seat: 3, card: parseCard('QD') }, { seat: 0, card: parseCard('KD') }, { seat: 1, card: parseCard('AD') }, { seat: 2, card: parseCard('2D') }], winner: 1 });
  g.tricksWon[1] = 1;
  g.leader = 0;
  g.turn = 0;
  playCard(g, 0, parseCard('JD'));
  playCard(g, 1, parseCard('4D'));
  const card = solidPlay(viewFor(g, 2), new Rng(1));
  assert.notEqual(cardToString(card), '7S', 'partner must not ruff a boss jack');
});

test('solid partner still ruffs when a later opponent is known void in the led suit', () => {
  const g = rig([
    ['JD', '2C', '3C', '4C', '5H'],
    ['4D', '5C', '6C', '7C', '6H'],
    ['AS', '8C', '9C', '10C', '7H'],
    ['2S', 'JC', 'QC', 'KC', '8H'],
  ]);
  g.tricks.push({ leader: 3, plays: [{ seat: 3, card: parseCard('QD') }, { seat: 0, card: parseCard('KD') }, { seat: 1, card: parseCard('AD') }, { seat: 2, card: parseCard('2D') }], winner: 1 });
  // Seat 3 showed out of diamonds earlier (discarded a club on a diamond lead).
  g.tricks.push({ leader: 1, plays: [{ seat: 1, card: parseCard('3D') }, { seat: 2, card: parseCard('5D') }, { seat: 3, card: parseCard('2C') }, { seat: 0, card: parseCard('6D') }], winner: 0 });
  g.tricksWon[1] = 1;
  g.tricksWon[0] = 1;
  g.leader = 0;
  g.turn = 0;
  playCard(g, 0, parseCard('JD'));
  playCard(g, 1, parseCard('4D'));
  const card = solidPlay(viewFor(g, 2), new Rng(1));
  assert.equal(cardToString(card), 'AS', 'protect the trick with a spade the void opponent cannot beat');
});

test('vetoes: fourth seat never overtakes or trumps a safe winning partner', () => {
  // Dealer 0 → seat 1 leads: order 1 → 2 → 3 → 0. Seat 0 is last with a spade and a low diamond.
  const g = rig([
    ['3S', '2D', '3D', '4D'],
    ['6C', '5D', '6D', '7D'],
    ['QC', '8D', '9D', '10D'],
    ['4C', 'JD', 'QD', 'KD'],
  ], { dealer: 0 });
  // A♣ and K♣ were played earlier, so partner's Q♣ is the boss club.
  g.tricks.push({ leader: 0, plays: [{ seat: 0, card: parseCard('AC') }, { seat: 1, card: parseCard('KC') }, { seat: 2, card: parseCard('2C') }, { seat: 3, card: parseCard('3C') }], winner: 0 });
  g.tricksWon[0] = 1;
  g.spadesBroken = true;
  playCard(g, 1, parseCard('6C'));
  playCard(g, 2, parseCard('QC'));
  playCard(g, 3, parseCard('4C'));
  const v = viewFor(g, 0);
  const a = analyze(v);
  assert.equal(a.partnerWinning, true);
  const cands = applyVetoes(v, a, distinctCandidates(a, legalPlays(g, 0)));
  assert.ok(!cands.map(cardToString).includes('3S'), `must not trump partner's boss card: ${cands.map(cardToString)}`);
  assert.ok(cands.length >= 1);
});

test('vetoes: a nil bidder in last seat never wins when a losing card exists', () => {
  const g = rig([
    ['2H', 'KH', '3C', '4C'],
    ['5H', '5C', '6C', '7C'],
    ['9H', '8C', '9C', '10C'],
    ['4H', 'JC', 'QC', 'KC'],
  ], { bids: [0, 3, 3, 3] }); // seat 0 bids nil (bids in turn order: seat 0 first since dealer 3)
  // Order 0 → 1 → 2 → 3; make seat 1 lead by rotating: use the engine: seat 0 leads first. Let seat 0 lead 2H? That's nil-safe. Instead test following:
  playCard(g, 0, parseCard('3C'));
  playCard(g, 1, parseCard('5C'));
  playCard(g, 2, parseCard('8C'));
  playCard(g, 3, parseCard('JC'));
  // Seat 3 won, leads hearts; seat 0 (nil) plays second → not last. Rebuild: let seat 3 lead 4H, seat 0 must follow: both 2H (loses) and KH (wins so far).
  playCard(g, 3, parseCard('4H'));
  const v = viewFor(g, 0);
  const a = analyze(v);
  const cands = applyVetoes(v, a, distinctCandidates(a, legalPlays(g, 0)));
  assert.deepEqual(cands.map(cardToString), ['2H']);
});

test('no voluntary double nil: solid never bids nil on top of a partner nil', () => {
  const g = newGame({ seed: 3, firstDealer: 3 });
  startHand(g);
  // Seat 0 bids first; give seat 2 a nil-looking hand and have seat 0 bid nil.
  g.hands[2] = ['2S', '4S', '7H', '5H', '3H', '2H', '8D', '6D', '3D', '9C', '6C', '4C', '2C'].map(parseCard).sort((a, b) => a - b);
  placeBid(g, 0, 0);
  placeBid(g, 1, 3);
  const rng = new Rng(5);
  for (let i = 0; i < 30; i++) assert.notEqual(solidBid(viewFor(g, 2), rng), 0);
  const expert = createBot('expert', { seed: 9, rollouts: 6, bidSamples: 8 });
  for (let i = 0; i < 5; i++) assert.notEqual(expert.chooseBid(viewFor(g, 2)), 0);
});

test('evaluate() sees the ten-bag cliff', () => {
  const mk = (bagsBefore) => {
    const g = newGame({ seed: 1, firstDealer: 3 });
    startHand(g);
    g.bags = [bagsBefore, 0];
    g.lastHand = { teams: scoreHand([3, 4, 1, 3], [false, false, false, false], [5, 4, 1, 3], g.bags, DEFAULT_OPTIONS).teams };
    g.phase = 'handOver';
    return evaluate(g, 0);
  };
  assert.ok(mk(8) < mk(0) - 20, `crossing ten bags should hurt: ${mk(8)} vs ${mk(0)}`);
});

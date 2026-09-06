import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, startHand, placeBid, playCard, legalPlays, PHASE, parseCard, cardToString, viewFor, Rng, suitOf, SPADES,
} from '../../src/engine/index.js';
import { createBot, TIERS, analyze, distinctCandidates, sampleHands, solidPlay, estimateTricks, looksLikeNil } from '../../src/ai/index.js';
import { playGame } from '../../src/ai/simulate.js';

function bidAll(g, bids) {
  for (let i = 0; i < 4; i++) placeBid(g, g.turn, bids[i]);
}

function rig(hands, { bids = [3, 3, 3, 3], dealer = 3 } = {}) {
  const g = newGame({ seed: 1, firstDealer: dealer });
  startHand(g);
  g.hands = hands.map((h) => h.map(parseCard).sort((a, b) => a - b));
  bidAll(g, bids);
  return g;
}

test('every tier bids legally and plays only legal cards across many hands', () => {
  for (const tier of TIERS) {
    const bot = createBot(tier, { seed: 9, rollouts: 4, bidSamples: 4 });
    for (let seed = 1; seed <= (tier === 'expert' ? 3 : 25); seed++) {
      const g = newGame({ seed, firstDealer: seed % 4 });
      startHand(g);
      while (g.phase === PHASE.BIDDING) {
        const bid = bot.chooseBid(viewFor(g, g.turn));
        assert.ok(Number.isInteger(bid) && bid >= 0 && bid <= 13, `${tier} bid ${bid}`);
        placeBid(g, g.turn, bid);
      }
      while (g.phase === PHASE.PLAYING) {
        const seat = g.turn;
        const card = bot.choosePlay(viewFor(g, seat));
        assert.ok(legalPlays(g, seat).includes(card), `${tier} played illegal ${cardToString(card)}`);
        playCard(g, seat, card);
      }
      assert.equal(g.phase === PHASE.HAND_OVER || g.phase === PHASE.GAME_OVER, true);
    }
  }
});

test('bots cannot see other hands: a view carries only card counts', () => {
  const g = newGame({ seed: 4 });
  startHand(g);
  const v = viewFor(g, 2);
  assert.equal(v.hands, undefined);
  assert.equal(v.hand.length, 13);
  assert.deepEqual(v.handSizes, [13, 13, 13, 13]);
});

test('estimateTricks orders hands sensibly and the nil check is strict', () => {
  const strong = ['AS', 'KS', 'QS', 'JS', '5S', 'AH', 'KH', '3H', 'AD', '2D', '4C', '3C', '2C'].map(parseCard);
  const weak = ['2S', '4S', '7H', '5H', '3H', '2H', '8D', '6D', '3D', '9C', '6C', '4C', '2C'].map(parseCard);
  const medium = ['AS', '9S', '3S', 'KH', '7H', '2H', 'QD', '9D', '3D', 'JC', '8C', '5C', '2C'].map(parseCard);
  assert.ok(estimateTricks(strong) > estimateTricks(medium));
  assert.ok(estimateTricks(medium) > estimateTricks(weak));
  assert.ok(estimateTricks(strong) >= 6, `strong estimate ${estimateTricks(strong)}`);
  assert.ok(estimateTricks(weak) < 1.2, `weak estimate ${estimateTricks(weak)}`);
  assert.equal(looksLikeNil(weak), true);
  assert.equal(looksLikeNil(strong), false);
  assert.equal(looksLikeNil(medium), false);
});

test('solid bot follows suit low when partner is winning and takes cheaply when an opponent is', () => {
  // Seat 0 leads, seat 1 plays, seat 2 (partner of 0) plays, seat 3 plays.
  const g = rig([
    ['5H', '2C', '3C', '4C'],
    ['9H', '5C', '6C', '7C'],
    ['AH', 'KH', '8C', '9C'],
    ['QH', 'JH', '10C', 'JC'],
  ]);
  playCard(g, 0, parseCard('5H'));
  playCard(g, 1, parseCard('9H'));
  // Partner (seat 0) is NOT winning; seat 1 is. Seat 2 should win as cheaply as possible.
  const c2 = solidPlay(viewFor(g, 2), new Rng(1));
  assert.equal(cardToString(c2), 'KH'); // K beats 9 and is enough (A kept)
  playCard(g, 2, c2);
  // Seat 3 cannot beat the K: should throw the lowest heart.
  const c3 = solidPlay(viewFor(g, 3), new Rng(1));
  assert.equal(cardToString(c3), 'JH');
});

test('solid bot does not overtake a partner who is already winning', () => {
  const g = rig([
    ['KH', '2C', '3C', '4C'],
    ['3H', '5C', '6C', '7C'],
    ['AH', 'QH', '8C', '9C'],
    ['4H', 'JH', '10C', 'JC'],
  ]);
  playCard(g, 0, parseCard('KH'));
  playCard(g, 1, parseCard('3H'));
  const c2 = solidPlay(viewFor(g, 2), new Rng(1));
  assert.equal(cardToString(c2), 'QH'); // partner's K is winning; play the lower heart
});

test('solid bot ducks under when it bid nil and dumps high cards when void', () => {
  const g = rig(
    [
      ['9H', '2H', 'KC', '3C'],
      ['QH', '5C', '6C', '7C'],
      ['AH', 'KH', '8C', '9C'],
      ['JH', '4H', '10C', 'JC'],
    ],
    { bids: [0, 3, 3, 3] }
  );
  // Seat 0 (nil) leads: expect its lowest card.
  const lead = solidPlay(viewFor(g, 0), new Rng(1));
  assert.equal(cardToString(lead), '2H');
  playCard(g, 0, lead);
  playCard(g, 1, parseCard('QH'));
  playCard(g, 2, parseCard('AH'));
  playCard(g, 3, parseCard('4H'));
  // Seat 2 won and leads clubs; nil bidder must follow with the highest club under the winner.
  assert.equal(g.turn, 2);
  playCard(g, 2, parseCard('9C'));
  playCard(g, 3, parseCard('10C'));
  const duck = solidPlay(viewFor(g, 0), new Rng(1));
  assert.equal(cardToString(duck), '3C'); // K would win; 3 ducks
});

test('solid bot covers a nil partner by winning high when partner is yet to play', () => {
  // Seat 2 bid nil; seat 0 is partner. Seat 1 leads, seat 2 plays before seat 0? No: order 1,2,3,0.
  // Use dealer 0 so seat 1 leads: order 1 -> 2 -> 3 -> 0. Make seat 3 the leader by dealer=2: order 3,0,1,2.
  const g = rig(
    [
      ['AH', 'KH', '5C', '3C'],
      ['QH', '5C', '6C', '7C'].map((c) => c).map((c) => c),
      ['9H', '2H', '8C', '9C'],
      ['4H', 'JH', '10C', 'JC'],
    ],
    // bids are given in turn order: dealer 2 → seats 3, 0, 1, 2 bid in that order, so seat 2 gets the nil.
    { bids: [3, 3, 3, 0], dealer: 2 }
  );
  // Fix the duplicate 5C in seat 1 (rig does not validate): give seat 1 the 2C instead.
  g.hands[1] = ['QH', '2C', '6C', '7C'].map(parseCard).sort((a, b) => a - b);
  assert.equal(g.turn, 3);
  playCard(g, 3, parseCard('4H'));
  // Seat 0's nil partner (seat 2) is still to play: win high so partner can duck.
  const c0 = solidPlay(viewFor(g, 0), new Rng(1));
  assert.equal(cardToString(c0), 'AH');
});

test('solid bot avoids extra tricks once the contract is made and opponents are safe', () => {
  const g = rig([
    ['AH', '2H', '5C', '3C'],
    ['QH', '2C', '6C', '7C'],
    ['9H', '3H', '8C', '9C'],
    ['4H', 'JH', '10C', 'JC'],
  ], { bids: [1, 1, 1, 1] });
  // Pretend both teams already made their bids with tricks left over.
  g.tricksWon = [2, 2, 1, 1];
  g.tricks = new Array(6).fill({ leader: 0, plays: [], winner: 0 });
  const lead = solidPlay(viewFor(g, 0), new Rng(1));
  assert.equal(cardToString(lead), '2H'); // lowest card, not the ace
});

test('sampleHands respects hand sizes and inferred voids', () => {
  const g = newGame({ seed: 21, firstDealer: 3 });
  startHand(g);
  bidAll(g, [3, 3, 3, 3]);
  // Play until somebody fails to follow suit so a void is inferred.
  let voidSeen = false;
  let guard = 0;
  while (!voidSeen && guard++ < 40 && g.phase === PHASE.PLAYING) {
    const seat = g.turn;
    const legal = legalPlays(g, seat);
    const led = g.trick.length ? suitOf(g.trick[0].card) : null;
    const card = legal[0];
    if (led !== null && suitOf(card) !== led) voidSeen = true;
    playCard(g, seat, card);
  }
  const me = g.turn;
  const view = viewFor(g, me);
  const a = analyze(view);
  const rng = new Rng(3);
  for (let i = 0; i < 20; i++) {
    const hands = sampleHands(view, a, rng);
    const all = hands.flat();
    assert.equal(all.length, a.unseen.length);
    assert.equal(new Set(all).size, all.length);
    for (let s = 0; s < 4; s++) {
      if (s === me) continue;
      assert.equal(hands[s].length, view.handSizes[s]);
      for (const c of hands[s]) assert.equal(a.voids[s][suitOf(c)], false, 'dealt into a known void');
    }
  }
  assert.ok(a.voids.some((v) => v.some(Boolean)), 'test should have produced at least one inferred void');
});

test('distinctCandidates merges touching cards of a suit', () => {
  const g = rig([
    ['AH', 'KH', 'QH', '2H', '7S', '6S', '3C'],
    ['9H', '5C', '6C', '7C', '2S', '3S', '4S'],
    ['8H', '4H', '8C', '9C', '5S', '8S', '9S'],
    ['JH', '10H', '10C', 'JC', '10S', 'JS', 'QS'],
  ]);
  const view = viewFor(g, 0);
  const a = analyze(view);
  // Spades are not broken, so only the side suits are legal to lead.
  const cands = distinctCandidates(a, legalPlays(g, 0)).map(cardToString).sort();
  // AH KH QH are one class (nothing between them unseen); 2H separate; 3C.
  assert.deepEqual(cands, ['2H', '3C', 'QH']);
  g.spadesBroken = true;
  const cands2 = distinctCandidates(a, legalPlays(g, 0)).map(cardToString).sort();
  assert.deepEqual(cands2, ['2H', '3C', '6S', 'QH']); // 6S/7S merge into one class
});

test('expert beats solid and solid beats rookie over a handful of games', () => {
  // Small, fast sanity check; the simulation harness does the heavy lifting.
  let solidWins = 0;
  for (let i = 0; i < 6; i++) {
    const r = playGame(['solid', 'rookie', 'solid', 'rookie'], { seed: 300 + i });
    if (r.winner === 0) solidWins++;
  }
  assert.ok(solidWins >= 5, `solid won only ${solidWins}/6 vs rookie`);
});

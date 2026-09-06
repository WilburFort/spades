import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Rng, seedFrom,
  makeCard, suitOf, rankOf, cardToString, parseCard, sortHandForDisplay, fullDeck,
  CLUBS, DIAMONDS, HEARTS, SPADES,
  scoreHand, checkGameOver, DEFAULT_OPTIONS,
  newGame, startHand, placeBid, legalPlays, playCard, trickWinner, playError, bidError,
  canBidBlindNil, PHASE, cloneState, playedCards, teamBid,
  viewFor,
} from '../../src/engine/index.js';

// ---------- RNG ----------

test('rng is deterministic for a seed', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const c = new Rng(43);
  assert.notEqual(a.next(), c.next());
});

test('rng int stays in range and shuffle is a permutation', () => {
  const r = new Rng(7);
  for (let i = 0; i < 1000; i++) {
    const n = r.int(13);
    assert.ok(n >= 0 && n < 13);
  }
  const deck = r.shuffle(fullDeck());
  assert.deepEqual([...deck].sort((x, y) => x - y), fullDeck());
});

test('seedFrom hashes strings stably', () => {
  assert.equal(seedFrom('spades'), seedFrom('spades'));
  assert.notEqual(seedFrom('spades'), seedFrom('hearts'));
  assert.equal(seedFrom(12), 12);
});

// ---------- Cards ----------

test('card encoding round-trips', () => {
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) {
      const c = makeCard(s, r);
      assert.equal(suitOf(c), s);
      assert.equal(rankOf(c), r);
      assert.equal(parseCard(cardToString(c)), c);
    }
  }
  assert.equal(cardToString(makeCard(SPADES, 14)), 'AS');
  assert.equal(cardToString(makeCard(HEARTS, 10)), '10H');
  assert.equal(parseCard('th'), makeCard(HEARTS, 10));
  assert.throws(() => parseCard('1X'));
});

test('display sort alternates colours with spades last and ranks ascending', () => {
  const hand = [parseCard('AS'), parseCard('2C'), parseCard('KD'), parseCard('3H'), parseCard('2S'), parseCard('QD')];
  const sorted = sortHandForDisplay(hand).map(cardToString);
  assert.deepEqual(sorted, ['QD', 'KD', '2C', '3H', '2S', 'AS']);
});

// ---------- Scoring ----------

const noBags = [0, 0];

test('made bids score 10 per trick plus 1 per bag', () => {
  // team 0 bids 3+2=5 takes 6; team 1 bids 4+3=7 takes 7
  const r = scoreHand([3, 4, 2, 3], [false, false, false, false], [3, 4, 3, 3], noBags);
  assert.equal(r.teams[0].made, true);
  assert.equal(r.teams[0].total, 51);
  assert.equal(r.teams[0].bagsAdded, 1);
  assert.equal(r.teams[1].total, 70);
  assert.equal(r.teams[1].bagsAdded, 0);
});

test('failed bids lose 10 per trick bid and add no bags', () => {
  const r = scoreHand([5, 2, 3, 2], [false, false, false, false], [3, 4, 2, 4], noBags);
  assert.equal(r.teams[0].made, false);
  assert.equal(r.teams[0].total, -80);
  assert.equal(r.teams[0].bagsAdded, 0);
  assert.equal(r.teams[1].total, 44); // bid 4, took 8 -> 40 + 4 bags
});

test('nil made adds 100 and nil failed subtracts 100', () => {
  let r = scoreHand([0, 4, 4, 3], [false, false, false, false], [0, 5, 4, 4], noBags);
  assert.equal(r.teams[0].nils[0].made, true);
  assert.equal(r.teams[0].total, 140); // 40 + 100
  r = scoreHand([0, 4, 4, 3], [false, false, false, false], [1, 4, 4, 4], noBags);
  assert.equal(r.teams[0].nils[0].made, false);
  // partner bid 4, took 4, nil bidder's 1 trick counts toward bid (default) and is a bag
  assert.equal(r.teams[0].made, true);
  assert.equal(r.teams[0].total, 40 + 1 - 100);
  assert.equal(r.teams[0].bagsAdded, 1);
});

test('failed nil tricks do not help partner when option is off', () => {
  const opts = { ...DEFAULT_OPTIONS, nilTricksHelpPartner: false };
  // partner bid 4, took 3; nil bidder took 2 -> partner's bid fails
  const r = scoreHand([0, 4, 4, 3], [false, false, false, false], [2, 4, 3, 4], noBags, opts);
  assert.equal(r.teams[0].made, false);
  assert.equal(r.teams[0].total, -40 - 100);
  // with default option the 2 tricks count: 5 >= 4, made with one bag
  const r2 = scoreHand([0, 4, 4, 3], [false, false, false, false], [2, 4, 3, 4], noBags);
  assert.equal(r2.teams[0].made, true);
  assert.equal(r2.teams[0].total, 40 + 1 - 100);
});

test('blind nil is worth 200 either way', () => {
  let r = scoreHand([0, 4, 4, 3], [true, false, false, false], [0, 5, 4, 4], noBags);
  assert.equal(r.teams[0].nils[0].points, 200);
  r = scoreHand([0, 4, 4, 3], [true, false, false, false], [1, 5, 4, 3], noBags);
  assert.equal(r.teams[0].nils[0].points, -200);
});

test('bags roll over at ten and cost 100', () => {
  // team 0 had 8 bags, bids 3, takes 6 -> 3 new bags -> 11 -> penalty, 1 left
  const r = scoreHand([3, 4, 0, 3], [false, false, false, false], [6, 4, 0, 3], [8, 0]);
  assert.equal(r.teams[0].bagsAfter, 1);
  assert.equal(r.teams[0].bagPenalty, -100);
  assert.equal(r.teams[0].total, 30 + 3 + 100 - 100); // contract + bags + nil made - penalty
});

test('bag penalty can be disabled', () => {
  const opts = { ...DEFAULT_OPTIONS, bagPenaltyAt: 0 };
  const r = scoreHand([3, 4, 3, 3], [false, false, false, false], [6, 4, 3, 0], [8, 0], opts);
  assert.equal(r.teams[0].bagsAfter, 11);
  assert.equal(r.teams[0].bagPenalty, 0);
});

test('double nil: every trick is a bag and both nils are scored', () => {
  const r = scoreHand([0, 4, 0, 4], [false, false, false, false], [1, 6, 0, 6], noBags);
  assert.equal(r.teams[0].bid, 0);
  assert.equal(r.teams[0].nils.length, 2);
  assert.equal(r.teams[0].nilPoints, 0); // -100 + 100
  assert.equal(r.teams[0].bagsAdded, 1);
  assert.equal(r.teams[0].total, 1);
});

test('ten for two hundred option', () => {
  const opts = { ...DEFAULT_OPTIONS, tenForTwoHundred: true };
  let r = scoreHand([6, 1, 4, 1], [false, false, false, false], [7, 1, 4, 1], noBags, opts);
  assert.equal(r.teams[0].total, 201);
  r = scoreHand([6, 1, 4, 1], [false, false, false, false], [5, 2, 4, 2], noBags, opts);
  assert.equal(r.teams[0].total, -200);
});

test('game over detection', () => {
  assert.deepEqual(checkGameOver([500, 300]).over, true);
  assert.equal(checkGameOver([500, 300]).winner, 0);
  assert.equal(checkGameOver([510, 520]).winner, 1);
  assert.equal(checkGameOver([500, 500]).over, false);
  assert.equal(checkGameOver([499, 100]).over, false);
  const bust = { ...DEFAULT_OPTIONS, losingScore: -200 };
  assert.equal(checkGameOver([-200, 50], bust).over, true);
  assert.equal(checkGameOver([-200, 50], bust).winner, 1);
  assert.equal(checkGameOver([-200, 50]).over, false);
});

// ---------- Game flow ----------

function freshHand(seed = 1, options = {}) {
  const g = newGame({ seed, options, firstDealer: 3 });
  startHand(g);
  return g;
}

test('startHand deals 13 unique cards each and bidding starts left of dealer', () => {
  const g = freshHand(5);
  assert.equal(g.phase, PHASE.BIDDING);
  assert.equal(g.dealer, 3);
  assert.equal(g.turn, 0);
  const all = g.hands.flat();
  assert.equal(all.length, 52);
  assert.equal(new Set(all).size, 52);
  for (const h of g.hands) assert.equal(h.length, 13);
});

test('deals are reproducible from the seed and differ across seeds', () => {
  const a = freshHand(99), b = freshHand(99), c = freshHand(100);
  assert.deepEqual(a.hands, b.hands);
  assert.notDeepEqual(a.hands, c.hands);
});

test('bidding proceeds clockwise and validates', () => {
  const g = freshHand(1);
  assert.equal(bidError(g, 1, 3), "It is seat 0's turn to bid");
  assert.throws(() => placeBid(g, 1, 3));
  assert.throws(() => placeBid(g, 0, 14));
  assert.throws(() => placeBid(g, 0, -1));
  assert.throws(() => placeBid(g, 0, 2.5));
  placeBid(g, 0, 3);
  assert.equal(g.turn, 1);
  placeBid(g, 1, 4);
  placeBid(g, 2, 0);
  const ev = placeBid(g, 3, 2);
  assert.equal(g.phase, PHASE.PLAYING);
  assert.equal(g.turn, 0); // left of dealer (3) leads
  assert.equal(ev.at(-1).type, 'biddingComplete');
  assert.equal(teamBid(g, 0), 3);
  assert.equal(teamBid(g, 1), 6);
});

test('blind nil requires a deficit and only nil may be blind', () => {
  const g = freshHand(1);
  assert.equal(canBidBlindNil(g, 0), false);
  assert.throws(() => placeBid(g, 0, 0, { blind: true }));
  g.scores = [0, 100];
  assert.equal(canBidBlindNil(g, 0), true);
  assert.equal(canBidBlindNil(g, 1), false);
  assert.throws(() => placeBid(g, 0, 3, { blind: true }));
  placeBid(g, 0, 0, { blind: true });
  assert.equal(g.blind[0], true);
  const g2 = freshHand(1, { allowBlindNil: false });
  g2.scores = [0, 300];
  assert.equal(canBidBlindNil(g2, 0), false);
});

test('nil can be disabled', () => {
  const g = freshHand(1, { allowNil: false });
  assert.throws(() => placeBid(g, 0, 0));
});

function bidAll(g, bids = [3, 3, 3, 3]) {
  for (let i = 0; i < 4; i++) placeBid(g, g.turn, bids[i]);
}

/** Force specific hands into a game for deterministic play tests. */
function rig(hands) {
  const g = newGame({ seed: 1, firstDealer: 3 });
  startHand(g);
  g.hands = hands.map((h) => h.map(parseCard).sort((a, b) => a - b));
  return g;
}

test('legal plays: cannot lead spades until broken unless only spades remain', () => {
  const g = rig([
    ['AS', 'KS', '2C', '3D'],
    ['2S', '3S', '4C', '5D'],
    ['5S', '6S', '6C', '7D'],
    ['7S', '8S', '8C', '9D'],
  ]);
  bidAll(g);
  assert.equal(g.turn, 0);
  const legal = legalPlays(g, 0).map(cardToString).sort();
  assert.deepEqual(legal, ['2C', '3D']);
  assert.equal(playError(g, 0, parseCard('AS')), 'spadesNotBroken');
  assert.throws(() => playCard(g, 0, parseCard('AS')), /Spades have not been broken/);
  // A hand of only spades may lead them.
  g.hands[0] = ['AS', 'KS'].map(parseCard);
  assert.deepEqual(legalPlays(g, 0).map(cardToString).sort(), ['AS', 'KS']);
});

test('legal plays: must follow suit when able, otherwise anything', () => {
  const g = rig([
    ['2C', '3D', 'AS', 'KH'],
    ['4C', '5D', '2S', '2H'],
    ['6C', '7D', '5S', '3H'],
    ['8D', '9D', '7S', '4H'],
  ]);
  bidAll(g);
  playCard(g, 0, parseCard('2C'));
  assert.deepEqual(legalPlays(g, 1).map(cardToString), ['4C']);
  assert.equal(playError(g, 1, parseCard('2S')), 'mustFollowSuit');
  assert.throws(() => playCard(g, 1, parseCard('2S')), /follow suit/);
  playCard(g, 1, parseCard('4C'));
  playCard(g, 2, parseCard('6C'));
  // seat 3 has no clubs: anything goes, including a spade
  assert.deepEqual(legalPlays(g, 3).map(cardToString).sort(), ['4H', '7S', '8D', '9D']);
  const ev = playCard(g, 3, parseCard('7S'));
  assert.ok(ev.some((e) => e.type === 'spadesBroken'));
  assert.equal(g.spadesBroken, true);
  const won = ev.find((e) => e.type === 'trickWon');
  assert.equal(won.winner, 3);
  assert.equal(g.tricksWon[3], 1);
  assert.equal(g.turn, 3); // winner leads
  // spades are broken now so seat 3 may lead one
  assert.ok(legalPlays(g, 3).includes(parseCard('7S')) === false); // it was played
  assert.ok(legalPlays(g, 3).map(cardToString).includes('4H'));
});

test('trick winner: highest of led suit unless a spade was played', () => {
  const p = (seat, c) => ({ seat, card: parseCard(c) });
  assert.equal(trickWinner([p(0, '9H'), p(1, 'KH'), p(2, 'AH'), p(3, '2H')]), 2);
  assert.equal(trickWinner([p(0, '9H'), p(1, 'KH'), p(2, 'AC'), p(3, '2H')]), 1); // off-suit ace loses
  assert.equal(trickWinner([p(0, '9H'), p(1, 'KH'), p(2, '2S'), p(3, 'AH')]), 2); // spade trumps
  assert.equal(trickWinner([p(0, '9H'), p(1, '3S'), p(2, '2S'), p(3, 'AH')]), 1); // higher spade
  assert.equal(trickWinner([p(2, '2S'), p(3, 'AS'), p(0, '3S'), p(1, '9H')]), 3); // spades led
});

test('a full hand of 13 tricks scores and moves to handOver; the winner of each trick leads', () => {
  const g = freshHand(11);
  bidAll(g, [3, 3, 3, 3]);
  let plays = 0;
  while (g.phase === PHASE.PLAYING) {
    const seat = g.turn;
    const legal = legalPlays(g, seat);
    const card = legal[0];
    playCard(g, seat, card);
    plays++;
  }
  assert.equal(plays, 52);
  assert.equal(g.tricks.length, 13);
  assert.equal(g.tricksWon.reduce((a, b) => a + b, 0), 13);
  assert.equal(g.phase, PHASE.HAND_OVER);
  assert.equal(g.history.length, 1);
  assert.equal(g.lastHand.teams.length, 2);
  assert.equal(g.scores[0], g.lastHand.teams[0].total);
  for (const t of g.tricks) {
    assert.equal(t.plays.length, 4);
    assert.equal(t.plays[0].seat, t.leader);
  }
  for (let i = 1; i < g.tricks.length; i++) assert.equal(g.tricks[i].leader, g.tricks[i - 1].winner);
  // next hand rotates dealer
  startHand(g);
  assert.equal(g.dealer, 0);
  assert.equal(g.handNumber, 2);
  assert.equal(g.turn, 1);
});

test('game reaches gameOver when the target is passed', () => {
  const g = freshHand(3, { targetScore: 50, bagPenaltyAt: 0 });
  bidAll(g, [1, 1, 1, 1]);
  while (g.phase === PHASE.PLAYING) playCard(g, g.turn, legalPlays(g, g.turn)[0]);
  // someone made >= 50? Not guaranteed; loop hands until over.
  let guard = 0;
  while (g.phase !== PHASE.GAME_OVER && guard++ < 50) {
    startHand(g);
    bidAll(g, [1, 1, 1, 1]);
    while (g.phase === PHASE.PLAYING) playCard(g, g.turn, legalPlays(g, g.turn)[0]);
  }
  assert.equal(g.phase, PHASE.GAME_OVER);
  assert.ok(g.winner === 0 || g.winner === 1);
  assert.ok(Math.max(...g.scores) >= 50);
  assert.throws(() => startHand(g));
});

test('cloneState is independent of the original', () => {
  const g = freshHand(2);
  bidAll(g);
  const c = cloneState(g);
  playCard(c, c.turn, legalPlays(c, c.turn)[0]);
  assert.equal(g.trick.length, 0);
  assert.equal(c.trick.length, 1);
  assert.equal(g.hands[0].length, 13);
  assert.equal(c.hands[0].length, 12);
});

test('playedCards and views hide other hands', () => {
  const g = freshHand(2);
  bidAll(g);
  playCard(g, g.turn, legalPlays(g, g.turn)[0]);
  assert.equal(playedCards(g).length, 1);
  const v = viewFor(g, 1);
  assert.equal(v.hand.length, 13);
  assert.deepEqual(v.handSizes, [12, 13, 13, 13]);
  assert.equal(v.hands, undefined);
  assert.equal(v.trick.length, 1);
});

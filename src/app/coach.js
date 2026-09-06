// The coach: short, contextual prompts that explain what to do next. It is a
// pure function of the situation plus a small memory of what has been shown,
// so it never nags: concept tips show once, rule tips retire after a few
// showings, and strategy nudges only fire at teachable moments.

import { suitOf, rankOf, SPADES, SUIT_NAMES, cardToPretty, rankLabel } from '../engine/cards.js';
import { NIL, partnerOf, teamOf } from '../engine/scoring.js';
import { analyze, beatsCurrent, estimateTricks, looksLikeNil } from '../ai/index.js';
import { groupBySuit } from '../ai/analysis.js';

const SUIT_WORD = ['clubs', 'diamonds', 'hearts', 'spades'];
const SUIT_SYM = ['♣', '♦', '♥', '♠'];

/** How many times a prompt id may be shown before it retires (Infinity = always). */
const LIMITS = {
  welcome: 1,
  'bid-intro': 2,
  'bid-suggest': Infinity,
  'nil-candidate': 3,
  'blind-nil': 2,
  'lead-first': 2,
  'lead-any': 1,
  'follow-first': 2,
  'spades-broken': 2,
  'partner-winning': 3,
  'contract-made': 3,
  'partner-nil': 3,
  'opp-nil': 3,
  'my-nil': 3,
  'set-chance': 3,
  'one-more': 2,
  'won-trick': 1,
  'illegal-suit': Infinity,
  'illegal-spades': Infinity,
  'only-spades': 2,
  'dump-high': 2,
};

export function tipLimit(id) {
  return LIMITS[id] ?? 2;
}

/**
 * Suggest a bid for the human with a plain-English reason.
 */
export function suggestBid(hand, options) {
  const est = estimateTricks(hand);
  let bid = Math.max(1, Math.round(est - 0.15));
  const reasons = bidReasons(hand);
  const nil = options.allowNil && looksLikeNil(hand);
  return { bid, est, reasons, nil };
}

function bidReasons(hand) {
  const g = groupBySuit(hand);
  const parts = [];
  const spades = g[SPADES];
  const spadeRanks = spades.map(rankOf);
  const highSpades = spades.filter((c) => rankOf(c) >= 12).map(cardToPretty);
  if (highSpades.length) parts.push(`${highSpades.join(' ')} ${highSpades.length === 1 ? 'is' : 'are'} likely to win`);
  if (spades.length >= 4) parts.push(`${spades.length} spades give you extra trump tricks`);
  for (let s = 0; s < 3; s++) {
    const cards = g[s];
    if (cards.some((c) => rankOf(c) === 14)) parts.push(`A${SUIT_SYM[s]} should win a trick`);
    else if (cards.some((c) => rankOf(c) === 13) && cards.length >= 2) parts.push(`K${SUIT_SYM[s]} is protected by other ${SUIT_WORD[s]}`);
    if (cards.length === 0 && spades.length >= 3) parts.push(`you can trump ${SUIT_WORD[s]}`);
  }
  if (!parts.length) parts.push(spadeRanks.length ? 'your cards are low, so expect few tricks' : 'with no spades, expect very few tricks');
  return parts;
}

/**
 * Compute a prompt for the given moment, or null.
 * @param {object} ctx
 * @param {'welcome'|'bid'|'blindnil'|'turn'|'illegal'|'spadesBroken'|'wonTrick'} ctx.moment
 * @param {object} ctx.view    the human's view
 * @param {string[]} ctx.names names by seat
 * @param {object} [ctx.extra] moment-specific data
 */
export function coachPrompt(ctx) {
  const { moment, view, names } = ctx;
  const me = view.seat;
  const partner = partnerOf(me);
  const opps = [(me + 1) % 4, (me + 3) % 4];
  const N = (s) => names[s];

  if (moment === 'welcome') {
    return {
      id: 'welcome',
      text: `Welcome to the table! You're playing with <b>${N(partner)}</b>, sitting across from you. <b>${N(opps[0])}</b> and <b>${N(opps[1])}</b> are the other team. Each hand starts with everyone bidding how many tricks they expect to win.`,
    };
  }

  if (moment === 'blindnil') {
    const team = teamOf(me);
    const deficit = view.scores[1 - team] - view.scores[team];
    return {
      id: 'blind-nil',
      text: `You're behind by <b>${deficit}</b>, so you may bid <b>Blind Nil</b> before looking at your cards: +200 if you win no tricks, −200 if you take even one. It's a long shot — most players just look at their cards.`,
    };
  }

  if (moment === 'bid') {
    const s = suggestBid(view.hand, view.options);
    const partnerBid = view.bids[partner];
    const partnerText = partnerBid === null ? '' : partnerBid === NIL ? ` ${N(partner)} bid Nil, so your team's tricks are all yours to win.` : ` ${N(partner)} bid ${partnerBid}; your team needs your bid plus theirs.`;
    if (s.nil) {
      return {
        id: 'nil-candidate',
        text: `Your hand is low with few spades — a <b>Nil</b> candidate. Nil means promising to win <b>zero</b> tricks: +100 if you succeed, −100 if you take even one. Otherwise bid <b>${s.bid}</b>.${partnerText}`,
        why: s.reasons.join('; ') + '.',
        suggest: s.bid,
      };
    }
    const first = view.handNumber <= 1;
    return {
      id: first ? 'bid-intro' : 'bid-suggest',
      text: first
        ? `Time to bid. Your bid is the number of tricks you think you'll win. Aces and high spades are near-certain winners; a king with company usually wins too. Suggested bid: <b>${s.bid}</b>.${partnerText}`
        : `Suggested bid: <b>${s.bid}</b>.${partnerText}`,
      why: s.reasons.join('; ') + '.',
      suggest: s.bid,
    };
  }

  if (moment === 'illegal') {
    const { reason, card } = ctx.extra;
    if (reason === 'spadesNotBroken') {
      return {
        id: 'illegal-spades',
        text: `Spades aren't <b>broken</b> yet — nobody has played a spade on another suit this hand, so you can't lead one. Lead a different suit for now.`,
      };
    }
    const led = suitOf(view.trick[0].card);
    return {
      id: 'illegal-suit',
      text: `You must <b>follow suit</b>: ${SUIT_WORD[led]} ${SUIT_SYM[led]} were led and you still have ${SUIT_WORD[led]}. ${cardToPretty(card)} can wait.`,
    };
  }

  if (moment === 'spadesBroken') {
    const { seat, card } = ctx.extra;
    return {
      id: 'spades-broken',
      text: `<b>Spades are broken</b> — ${seat === me ? 'you' : N(seat)} played ${cardToPretty(card)} on another suit. From now on anyone may lead spades.`,
    };
  }

  if (moment === 'wonTrick') {
    const { card } = ctx.extra;
    return { id: 'won-trick', text: `You won the trick with ${cardToPretty(card)}. The winner of a trick <b>leads the next one</b>.` };
  }

  if (moment === 'turn') return turnPrompt(ctx);
  return null;
}

function turnPrompt(ctx) {
  const { view, names, legal } = ctx;
  const a = analyze(view);
  const me = a.me;
  const partner = a.partner;
  const N = (s) => names[s];
  const myNil = view.bids[me] === NIL && a.nilLive[me];
  const partnerNil = view.bids[partner] === NIL && a.nilLive[partner];
  const oppNil = [(me + 1) % 4, (me + 3) % 4].find((s) => view.bids[s] === NIL && a.nilLive[s]);
  const myNeed = a.need[a.myTeam];
  const oppNeed = a.need[a.oppTeam];
  const firstHand = view.handNumber <= 1;

  if (a.leading) {
    const onlySpades = legal.every((c) => suitOf(c) === SPADES) && view.hand.some((c) => suitOf(c) === SPADES);
    if (onlySpades && !view.spadesBroken) {
      return { id: 'only-spades', text: `You only have spades left, so you're allowed to lead one even though spades aren't broken.` };
    }
    if (myNil) return { id: 'my-nil', text: `You bid <b>Nil</b>. Lead your lowest card and hope someone plays higher — every trick you win costs 100 points.` };
    if (partnerNil) return { id: 'partner-nil', text: `<b>${N(partner)}</b> bid Nil. Help by winning tricks: lead your high cards so they can slip low cards underneath.` };
    if (oppNil !== undefined) return { id: 'opp-nil', text: `<b>${N(oppNil)}</b> bid Nil. Try to force them to win a trick: lead <b>low</b> cards they may have to beat.` };
    if (myNeed <= 0 && oppNeed > 0 && a.tricksRemaining - oppNeed <= 1) {
      return { id: 'set-chance', text: `Your bid is safe and <b>${N((me + 1) % 4)} & ${N((me + 3) % 4)}</b> still need ${oppNeed} of the last ${a.tricksRemaining} tricks. Win tricks now to <b>set</b> them.` };
    }
    if (myNeed <= 0) return { id: 'contract-made', text: `Your team has <b>made its bid</b>. Extra tricks are <b>bags</b> — every ten bags costs 100 points — so lead low and let the others take the rest.` };
    if (myNeed === 1) return { id: 'one-more', text: `One more trick makes your team's bid. Lead a sure winner if you have one.` };
    if (firstHand && !view.spadesBroken) {
      return { id: 'lead-first', text: `You lead. Play any card except a spade — spades can't be led until someone plays one on another suit. High cards or a long suit are good openers.` };
    }
    return null;
  }

  // Following
  const led = a.ledSuit;
  const canFollow = view.hand.some((c) => suitOf(c) === led);
  if (myNil) {
    return { id: 'my-nil', text: `Nil in progress: play your <b>highest card that still loses</b>. If you can't follow suit, dump your most dangerous card (but not a winning spade).` };
  }
  if (firstHand && canFollow && (view.tricks.length === 0 || ctx.firstFollow)) {
    return {
      id: 'follow-first',
      text: `${N(view.leader)} led ${SUIT_WORD[led]} ${SUIT_SYM[led]}. You must play a ${SUIT_WORD[led].slice(0, -1)} if you have one. The highest ${SUIT_WORD[led].slice(0, -1)} wins unless someone plays a <b>spade</b> — spades beat everything.`,
    };
  }
  if (partnerNil && a.partnerYetToPlay) return { id: 'partner-nil', text: `<b>${N(partner)}</b> (Nil) hasn't played yet. Win this trick with a <b>high</b> card so they can duck under it.` };
  if (partnerNil && a.partnerWinning) return { id: 'partner-nil', text: `<b>${N(partner)}</b> is winning this trick — bad news for their Nil. Beat their card if you possibly can!` };
  if (oppNil !== undefined && a.winnerSeat === oppNil) return { id: 'opp-nil', text: `<b>${N(oppNil)}</b> bid Nil and is currently winning this trick. Don't beat them — let them take it and bust the Nil!` };
  if (oppNil !== undefined && a.seatsAfterMe.includes(oppNil)) return { id: 'opp-nil', text: `<b>${N(oppNil)}</b> (Nil) plays after you. Keep the trick <b>low</b> so they're forced to win it.` };
  if (a.partnerWinning) {
    const partnerSure = rankOf(a.winnerCard) > a.highestUnseen[led] || suitOf(a.winnerCard) === SPADES;
    if (partnerSure || a.isLast) return { id: 'partner-winning', text: `<b>${N(partner)}</b> is already winning this trick. Save your high cards — play your lowest.` };
  }
  if (!canFollow) {
    const winners = legal.filter((c) => beatsCurrent(a, c));
    if (myNeed > 0 && winners.length && !a.partnerWinning) return { id: 'dump-high', text: `You're out of ${SUIT_WORD[led]}, so you may play <b>any</b> card — including a spade to <b>trump</b> the trick. Your lowest winning spade is enough.` };
    if (myNeed <= 0) return { id: 'contract-made', text: `You're out of ${SUIT_WORD[led]} and your bid is already made. Throw away a card you don't want — a high card from another suit avoids future bags.` };
    return { id: 'dump-high', text: `You're out of ${SUIT_WORD[led]}, so you may play any card. A spade would win the trick; otherwise discard a card you don't need.` };
  }
  if (myNeed <= 0 && oppNeed > 0 && a.tricksRemaining - oppNeed <= 1) {
    return { id: 'set-chance', text: `Your bid is safe and the other team still needs ${oppNeed} of the last ${a.tricksRemaining} tricks. Win this one to <b>set</b> them.` };
  }
  if (myNeed <= 0 && legal.some((c) => !beatsCurrent(a, c))) return { id: 'contract-made', text: `Your team's bid is made — extra tricks are bags. Play under the winning card if you can.` };
  return null;
}

/** Short reason for a hinted card. */
export function explainHint(view, card) {
  const a = analyze(view);
  const me = a.me;
  const myNil = view.bids[me] === NIL && a.nilLive[me];
  const pretty = cardToPretty(card);
  if (a.leading) {
    if (myNil) return `${pretty} is your lowest card — a good Nil lead.`;
    if (rankOf(card) > a.highestUnseen[suitOf(card)]) return `${pretty} is the highest ${SUIT_NAMES[suitOf(card)].slice(0, -1)} still out there.`;
    return `Lead ${pretty}: a low card from your longest suit gives away little.`;
  }
  if (myNil) return `${pretty} stays under the winning card.`;
  if (a.partnerWinning && !beatsCurrent(a, card)) return `${names(view)[a.partner]} has the trick — ${pretty} keeps your high cards for later.`;
  if (beatsCurrent(a, card)) return suitOf(card) === SPADES && a.ledSuit !== SPADES ? `${pretty} trumps the trick.` : `${pretty} wins the trick as cheaply as possible.`;
  return `${pretty} loses this trick cheaply.`;
}

function names(view) {
  return view.names || ['You', 'West', 'North', 'East'];
}

export { rankLabel };

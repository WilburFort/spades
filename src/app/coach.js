// The coach: short, contextual prompts that explain what to do next. It is a
// pure function of the situation plus a small memory of what has been shown,
// so it never nags: concept tips show once, rule tips retire after a few
// showings, and strategy nudges fire at most once per hand at teachable moments.

import { suitOf, rankOf, SPADES, cardToPretty, rankLabel } from '../engine/cards.js';
import { NIL, partnerOf, teamOf } from '../engine/scoring.js';
import { analyze, beatsCurrent, estimateTricks, looksLikeNil, nilRisk } from '../ai/index.js';
import { groupBySuit } from '../ai/analysis.js';

const SUIT_WORD = ['clubs', 'diamonds', 'hearts', 'spades'];
const SUIT_ONE = ['club', 'diamond', 'heart', 'spade'];
const SUIT_SYM = ['♣', '♦', '♥', '♠'];

/** How many times a prompt id may be shown in total before it retires (Infinity = always). */
const LIMITS = {
  welcome: 1,
  'bid-intro': 2,
  'bid-suggest': Infinity,
  'nil-candidate': 4,
  'blind-nil': 2,
  'lead-first': 2,
  'follow-first': 2,
  'spades-broken': 2,
  'won-trick': 2,
  'partner-winning': 6,
  'contract-made': 6,
  'partner-nil': 6,
  'opp-nil': 6,
  'my-nil': 6,
  'set-chance': 6,
  'set-risk': 6,
  'one-more': 4,
  'illegal-suit': Infinity,
  'illegal-spades': Infinity,
  'only-spades': 2,
  'dump-high': 3,
  hint: Infinity,
};

/** Strategy nudges: at most once per hand so they land when the idea matters, not three turns in a row. */
export const ONCE_PER_HAND = new Set(['partner-winning', 'contract-made', 'partner-nil', 'opp-nil', 'my-nil', 'set-chance', 'set-risk', 'one-more', 'dump-high']);

/** Minimum time a prompt should stay readable before another may replace it (ms). */
export function minDisplayMs(id) {
  if (id === 'welcome') return 6500;
  if (id === 'illegal-suit' || id === 'illegal-spades') return 2500;
  if (id === 'hint') return 0;
  return 2000;
}

export function tipLimit(id) {
  return LIMITS[id] ?? 2;
}

/**
 * Suggest a bid for the human with a plain-English reason, shaded for the bids
 * already on the table (a partner who bid big has already claimed the tricks).
 */
export function suggestBid(hand, options, view = null) {
  const est = estimateTricks(hand);
  let bid = Math.max(1, Math.round(est - 0.15));
  const reasons = bidReasons(hand);
  let nil = options.allowNil && looksLikeNil(hand);
  if (view) {
    const me = view.seat;
    const partnerBid = view.bids[partnerOf(me)];
    const partnerNil = partnerBid === NIL;
    const others = view.bids.reduce((sum, b) => sum + (b !== null && b !== NIL ? b : 0), 0);
    if (partnerNil) nil = false;
    if (partnerBid !== null && !partnerNil && (partnerBid + bid >= 9 || others + bid > 13) && bid > 1) {
      bid -= 1;
      reasons.push(`${view.names ? view.names[partnerOf(me)] : 'your partner'} already bid ${partnerBid}, so ${bid} is enough — the table only has 13 tricks`);
    }
  }
  return { bid, est, reasons, nil };
}

function bidReasons(hand) {
  const g = groupBySuit(hand);
  const parts = [];
  const spades = g[SPADES];
  const highSpades = spades.filter((c) => rankOf(c) >= 12).map(cardToPretty);
  if (highSpades.length) parts.push(`${highSpades.join(' ')} ${highSpades.length === 1 ? 'is' : 'are'} likely to win`);
  if (spades.length >= 4) parts.push(`${spades.length} spades give you extra trump tricks`);
  for (let s = 0; s < 3; s++) {
    const cards = g[s];
    if (cards.some((c) => rankOf(c) === 14)) parts.push(`A${SUIT_SYM[s]} should win a trick`);
    else if (cards.some((c) => rankOf(c) === 13) && cards.length >= 2) parts.push(`K${SUIT_SYM[s]} is protected by other ${SUIT_WORD[s]}`);
    if (cards.length === 0 && spades.length >= 3) parts.push(`you can trump ${SUIT_WORD[s]}`);
  }
  if (!parts.length) parts.push(spades.length ? 'your cards are low, so expect few tricks' : 'with no spades, expect very few tricks');
  return parts;
}

/**
 * A warning when the player's chosen bid looks like a blunder, or null.
 */
export function bidWarning(bid, hand, options, view) {
  const s = suggestBid(hand, options, view);
  if (bid === NIL) {
    const risk = nilRisk(hand);
    const g = groupBySuit(hand);
    const aces = hand.filter((c) => rankOf(c) === 14).map(cardToPretty);
    const highSpades = g[SPADES].filter((c) => rankOf(c) >= 11).map(cardToPretty);
    if (view && view.bids[partnerOf(view.seat)] === NIL) return `Your partner already bid Nil — two Nils on one team almost never both succeed.`;
    if (aces.length || highSpades.length || risk.expectedTricks > 1.2) {
      const why = [...aces, ...highSpades].length ? `you hold ${[...aces, ...highSpades].join(' ')}, which will probably win a trick` : 'several of your cards are likely to win a trick';
      return `Nil is risky here: ${why}. A busted Nil costs 100.`;
    }
    return null;
  }
  if (bid >= s.bid + 3) return `That's ${bid - s.bid} more than the ${s.bid} the coach expects from this hand. Missing the bid costs ${bid * 10} points.`;
  return null;
}

/**
 * One sentence for the hand summary about the human team's result, or null.
 */
export function summaryCoachLine(summary, names) {
  const t = summary.teams[0];
  const me = summary.bids[0];
  const myNil = t.nils.find((n) => n.seat === 0);
  if (myNil) {
    if (myNil.made) return `Nil made — +${myNil.blind ? 200 : 100}. Keeping every trick below the winning card is exactly the idea.`;
    return `Your Nil was busted by ${myNil.tricks} trick${myNil.tricks === 1 ? '' : 's'} (−${myNil.blind ? 200 : 100}). Nil wants low cards in every suit and a partner who can win tricks over you.`;
  }
  if (t.bagPenalty) return `Ten bags cost your team ${t.bagPenalty}. Once your bid is safe, throw your lowest cards and let the others win.`;
  if (t.bid > 0 && !t.made) {
    const short = t.bid - t.tricksCounted;
    return `You bid ${me}${names ? ` and ${names[2]} bid ${summary.bids[2] === NIL ? 'Nil' : summary.bids[2]}` : ''}: ${t.tricksTotal} tricks was ${short} short, so the whole bid was lost (−${t.bid * 10}). When a hand is uncertain, bid one lower.`;
  }
  if (t.bid > 0 && t.made && t.bagsAdded >= 2) return `Bid ${t.bid}, took ${t.tricksTotal}: ${t.bid * 10} points plus ${t.bagsAdded} bags. Bags carry over and cost 100 at ten — aim to land the bid exactly.`;
  if (t.bid > 0 && t.made && t.bagsAdded === 0) return `Bid ${t.bid}, took exactly ${t.tricksTotal}: no bags. That is the ideal result.`;
  return null;
}

/**
 * Compute a prompt for the given moment, or null.
 * @param {object} ctx
 * @param {'welcome'|'bid'|'blindnil'|'turn'|'illegal'} ctx.moment
 * @param {object} ctx.view    the human's view (with .names)
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
      text: `Welcome to the table! Your partner is <b>${N(partner)}</b>, across from you; <b>${N(opps[0])}</b> and <b>${N(opps[1])}</b> are the other team. A hand has 13 <b>tricks</b>: everyone plays one card and the highest card of the suit led wins, unless someone plays a spade. First, everyone <b>bids</b> how many tricks they expect to win.`,
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
    const s = suggestBid(view.hand, view.options, view);
    const partnerBid = view.bids[partner];
    const partnerText = partnerBid === null ? '' : partnerBid === NIL ? ` ${N(partner)} bid Nil, so every trick your team needs is yours to win.` : ` ${N(partner)} bid ${partnerBid}; your team needs your bid plus theirs.`;
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
        ? `Time to bid. Count the tricks you expect to win: aces and high spades are near-certain winners, and a king with company usually wins too. Suggested bid: <b>${s.bid}</b>.${partnerText}`
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

  if (moment === 'turn') return turnPrompt(ctx);
  return null;
}

function turnPrompt(ctx) {
  const { view, names, legal, extra } = ctx;
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
  const oppNames = `${N((me + 1) % 4)} & ${N((me + 3) % 4)}`;

  // Things that just happened and deserve a sentence before the advice.
  let prefix = '';
  let prefixId = null;
  if (extra?.justBroken) {
    const b = extra.justBroken;
    prefix += `<b>Spades are broken</b> — ${b.seat === me ? 'you' : N(b.seat)} played ${cardToPretty(b.card)} on another suit, so spades may now be led. `;
    prefixId = 'spades-broken';
  }
  if (a.leading && extra?.wonWith !== undefined && extra?.wonWith !== null) {
    prefix += `You won that trick with ${cardToPretty(extra.wonWith)}, so <b>you lead</b>. `;
    prefixId = prefixId || 'won-trick';
  }

  let p = null;
  if (a.leading) {
    const onlySpades = legal.every((c) => suitOf(c) === SPADES) && view.hand.some((c) => suitOf(c) === SPADES);
    if (onlySpades && !view.spadesBroken) p = { id: 'only-spades', text: `You only have spades left, so you're allowed to lead one even though spades aren't broken.` };
    else if (myNil) p = { id: 'my-nil', text: `You bid <b>Nil</b>. Lead your lowest card and hope someone plays higher — every trick you win costs 100 points.` };
    else if (partnerNil) p = { id: 'partner-nil', text: `<b>${N(partner)}</b> bid Nil. Help by winning tricks: lead your high cards so they can slip low cards underneath.` };
    else if (oppNil !== undefined) p = { id: 'opp-nil', text: `<b>${N(oppNil)}</b> bid Nil. Try to force them to win a trick: lead <b>low</b> cards they may have to beat.` };
    else if (myNeed > 0 && myNeed >= a.tricksRemaining - 1 && myNeed >= 2) p = { id: 'set-risk', text: `Your team still needs <b>${myNeed}</b> of the last ${a.tricksRemaining} tricks or you lose ${a.teamBid[a.myTeam] * 10} points — win everything you can.` };
    else if (myNeed <= 0 && oppNeed > 0 && a.tricksRemaining - oppNeed <= 1) p = { id: 'set-chance', text: `Your bid is safe and <b>${oppNames}</b> still need ${oppNeed} of the last ${a.tricksRemaining} tricks. Win tricks now to <b>set</b> them.` };
    else if (myNeed <= 0) p = { id: 'contract-made', text: `Your team has <b>made its bid</b>. Extra tricks are <b>bags</b> — every ten bags costs 100 points — so lead low and let the others take the rest.` };
    else if (myNeed === 1) p = { id: 'one-more', text: `One more trick makes your team's bid. Lead a sure winner if you have one.` };
    else if (firstHand && !view.spadesBroken) p = { id: 'lead-first', text: `You lead. Play any card except a spade — spades can't be led until someone plays one on another suit. High cards or a long suit are good openers.` };
  } else {
    const led = a.ledSuit;
    const canFollow = view.hand.some((c) => suitOf(c) === led);
    if (myNil) p = { id: 'my-nil', text: `Nil in progress: play your <b>highest card that still loses</b>. If you can't follow suit, dump your most dangerous card (but not a spade that would win).` };
    else if (firstHand && canFollow && ctx.firstFollow) {
      p = {
        id: 'follow-first',
        text: `${N(view.leader)} led ${SUIT_WORD[led]} ${SUIT_SYM[led]}. You must play a ${SUIT_ONE[led]} if you have one. The highest ${SUIT_ONE[led]} wins unless someone plays a <b>spade</b> — spades beat everything.`,
      };
    } else if (partnerNil && a.partnerYetToPlay) p = { id: 'partner-nil', text: `<b>${N(partner)}</b> (Nil) hasn't played yet. Win this trick with a <b>high</b> card so they can duck under it.` };
    else if (partnerNil && a.partnerWinning) p = { id: 'partner-nil', text: `<b>${N(partner)}</b> is winning this trick — bad news for their Nil. Beat their card if you possibly can!` };
    else if (oppNil !== undefined && a.winnerSeat === oppNil) p = { id: 'opp-nil', text: `<b>${N(oppNil)}</b> bid Nil and is currently winning this trick. Don't beat them — let them take it and bust the Nil!` };
    else if (oppNil !== undefined && a.seatsAfterMe.includes(oppNil)) p = { id: 'opp-nil', text: `<b>${N(oppNil)}</b> (Nil) plays after you. Keep the trick <b>low</b> so they're forced to win it.` };
    else if (a.partnerWinning && (a.isLast || rankOf(a.winnerCard) > a.highestUnseen[led] || suitOf(a.winnerCard) === SPADES)) {
      p = { id: 'partner-winning', text: `<b>${N(partner)}</b> is already winning this trick. Save your high cards — play your lowest.` };
    } else if (!canFollow) {
      const hasSpade = view.hand.some((c) => suitOf(c) === SPADES);
      const winners = legal.filter((c) => beatsCurrent(a, c));
      if (led === SPADES || !hasSpade) p = { id: 'dump-high', text: `You're out of ${SUIT_WORD[led]}, so you may play <b>any</b> card. ${hasSpade ? 'A higher spade would win the trick; otherwise' : 'You have no spades to trump with, so'} discard a card you don't need — a high card from another suit avoids future bags.` };
      else if (myNeed > 0 && winners.length && !a.partnerWinning) p = { id: 'dump-high', text: `You're out of ${SUIT_WORD[led]}, so you may play <b>any</b> card — including a spade to <b>trump</b> the trick. Your lowest winning spade is enough.` };
      else if (myNeed <= 0) p = { id: 'contract-made', text: `You're out of ${SUIT_WORD[led]} and your bid is already made. Throw away a card you don't want — a high card from another suit avoids future bags.` };
      else p = { id: 'dump-high', text: `You're out of ${SUIT_WORD[led]}, so you may play any card. A spade would trump the trick; otherwise discard a card you don't need.` };
    } else if (myNeed > 0 && myNeed >= a.tricksRemaining - 1 && myNeed >= 2) p = { id: 'set-risk', text: `Your team still needs <b>${myNeed}</b> of the last ${a.tricksRemaining} tricks or you lose ${a.teamBid[a.myTeam] * 10} points — win this one if you can.` };
    else if (myNeed <= 0 && oppNeed > 0 && a.tricksRemaining - oppNeed <= 1) p = { id: 'set-chance', text: `Your bid is safe and the other team still needs ${oppNeed} of the last ${a.tricksRemaining} tricks. Win this one to <b>set</b> them.` };
    else if (myNeed <= 0 && legal.some((c) => !beatsCurrent(a, c))) p = { id: 'contract-made', text: `Your team's bid is made — extra tricks are bags. Play under the winning card if you can.` };
  }

  if (!p && !prefix) return null;
  if (!p) {
    const tail = a.leading ? (view.spadesBroken ? 'Lead any card.' : 'Lead any card except a spade.') : '';
    return { id: prefixId, text: (prefix + tail).trim() };
  }
  if (prefix) return { ...p, id: prefixId && p.id.startsWith('lead') ? prefixId : p.id, text: prefix + p.text, alsoId: prefixId };
  return p;
}

/** Short reason for a hinted card. */
export function explainHint(view, card) {
  const a = analyze(view);
  const me = a.me;
  const myNil = view.bids[me] === NIL && a.nilLive[me];
  const pretty = cardToPretty(card);
  const nm = view.names || ['You', 'West', 'North', 'East'];
  if (a.leading) {
    if (myNil) return `${pretty} is your lowest card — a good Nil lead.`;
    if (rankOf(card) > a.highestUnseen[suitOf(card)]) return `${pretty} is the highest ${SUIT_ONE[suitOf(card)]} still out there.`;
    if (rankOf(card) >= 11) return `${pretty} is your best remaining ${SUIT_ONE[suitOf(card)]} — it wins unless a higher one is still out.`;
    return `Lead ${pretty}: a low card from your longest suit gives away little.`;
  }
  if (myNil) return `${pretty} stays under the winning card.`;
  if (a.partnerWinning && !beatsCurrent(a, card)) return `${nm[a.partner]} has the trick — ${pretty} keeps your high cards for later.`;
  if (beatsCurrent(a, card)) return suitOf(card) === SPADES && a.ledSuit !== SPADES ? `${pretty} trumps the trick.` : `${pretty} wins the trick as cheaply as possible.`;
  return `${pretty} loses this trick cheaply.`;
}

export { rankLabel };

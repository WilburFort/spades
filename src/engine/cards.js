// Card representation.
//
// A card is a small integer 0..51:  id = suit * 13 + (rank - 2)
//   suit: 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades
//   rank: 2..14 where 11 = J, 12 = Q, 13 = K, 14 = A
// Integers keep the AI's Monte Carlo rollouts cheap and make state cloning trivial.

export const CLUBS = 0;
export const DIAMONDS = 1;
export const HEARTS = 2;
export const SPADES = 3;

export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const SUIT_LETTERS = ['C', 'D', 'H', 'S'];
export const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

/** Display order of suits in a fanned hand (alternating colours, spades last). */
export const DISPLAY_SUIT_ORDER = [DIAMONDS, CLUBS, HEARTS, SPADES];

export function makeCard(suit, rank) {
  return suit * 13 + (rank - 2);
}

export function suitOf(card) {
  return Math.floor(card / 13);
}

export function rankOf(card) {
  return (card % 13) + 2;
}

export function isSpade(card) {
  return suitOf(card) === SPADES;
}

export function rankLabel(rank) {
  return RANK_LABELS[rank] || String(rank);
}

/** Short text form, e.g. "AS", "10H", "2C". */
export function cardToString(card) {
  return rankLabel(rankOf(card)) + SUIT_LETTERS[suitOf(card)];
}

/** Pretty form for humans, e.g. "A♠". */
export function cardToPretty(card) {
  return rankLabel(rankOf(card)) + SUIT_SYMBOLS[suitOf(card)];
}

/** Parse "AS" / "10h" / "qd" into a card id. Throws on bad input. */
export function parseCard(text) {
  const m = /^\s*(10|[2-9]|[TJQKA])\s*([CDHS])\s*$/i.exec(String(text));
  if (!m) throw new Error(`Bad card: ${text}`);
  const r = m[1].toUpperCase();
  const rank = r === 'T' ? 10 : r === 'J' ? 11 : r === 'Q' ? 12 : r === 'K' ? 13 : r === 'A' ? 14 : Number(r);
  const suit = SUIT_LETTERS.indexOf(m[2].toUpperCase());
  return makeCard(suit, rank);
}

export function fullDeck() {
  const deck = new Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  return deck;
}

/** Sort a hand for display: alternating suit colours, spades on the right, ascending ranks. */
export function sortHandForDisplay(hand) {
  return [...hand].sort((a, b) => {
    const sa = DISPLAY_SUIT_ORDER.indexOf(suitOf(a));
    const sb = DISPLAY_SUIT_ORDER.indexOf(suitOf(b));
    if (sa !== sb) return sa - sb;
    return rankOf(a) - rankOf(b);
  });
}

/** Cards of a given suit in a hand, ascending by rank. */
export function cardsOfSuit(hand, suit) {
  return hand.filter((c) => suitOf(c) === suit).sort((a, b) => a - b);
}

/** Highest card in a list (by id, which orders by suit then rank). */
export function highest(cards) {
  let best = -1;
  for (const c of cards) if (c > best) best = c;
  return best;
}

export function lowest(cards) {
  let best = Infinity;
  for (const c of cards) if (c < best) best = c;
  return best;
}

/** Group a hand into 4 arrays (by suit index), each ascending by rank. */
export function bySuit(hand) {
  const groups = [[], [], [], []];
  for (const c of hand) groups[suitOf(c)].push(c);
  for (const g of groups) g.sort((a, b) => a - b);
  return groups;
}

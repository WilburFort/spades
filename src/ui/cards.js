// Card rendering: pure DOM + one inline SVG sprite for the suit glyphs, so the
// game needs no image assets and looks identical on every OS.

import { suitOf, rankOf, rankLabel, cardToString, SPADES, HEARTS, DIAMONDS, SUIT_NAMES } from '../engine/cards.js';

const SUIT_PATHS = [
  // clubs
  'M50 4c-10 0-18 8-18 18 0 5 2 10 6 13-4-3-9-5-14-5C13 30 4 39 4 51s9 21 20 21c8 0 15-4 19-11-2 14-7 25-15 35h44c-8-10-13-21-15-35 4 7 11 11 19 11 11 0 20-9 20-21s-9-21-20-21c-5 0-10 2-14 5 4-3 6-8 6-13 0-10-8-18-18-18z',
  // diamonds
  'M50 3c9 21 24 36 43 47C74 61 59 76 50 97 41 76 26 61 7 50 26 39 41 24 50 3z',
  // hearts
  'M50 90C22 68 5 52 5 31 5 16 16 6 29 6c9 0 17 5 21 13 4-8 12-13 21-13 13 0 24 10 24 25 0 21-17 37-45 59z',
  // spades
  'M50 6C30 32 8 44 8 62c0 12 9 21 21 21 8 0 14-4 18-10-2 12-7 18-15 23h36c-8-5-13-11-15-23 4 6 10 10 18 10 12 0 21-9 21-21C92 44 70 32 50 6z',
];

/** Inline SVG sprite defining the four suit symbols. Append once to the document. */
export function suitSprite() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SUIT_PATHS.map((d, i) => `<symbol id="suit-${i}" viewBox="0 0 100 100"><path d="${d}"/></symbol>`).join('');
  return svg;
}

function suitUse(suit, cls = 'suit') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 100 100');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#suit-${suit}`);
  svg.appendChild(use);
  return svg;
}

// Pip positions (x, y) in fractions of the pip area; y > 0.5 pips are flipped.
const PIPS = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 0.333], [1, 0.333], [0.5, 0.5], [0, 0.667], [1, 0.667], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 0.167], [0, 0.333], [1, 0.333], [0, 0.667], [1, 0.667], [0.5, 0.833], [0, 1], [1, 1]],
};

/**
 * Build a card element.
 * @param {number} card card id
 * @param {{faceDown?: boolean}} [opts]
 */
export function cardEl(card, opts = {}) {
  const el = document.createElement('div');
  if (opts.faceDown) {
    el.className = 'card back';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  const suit = suitOf(card);
  const rank = rankOf(card);
  const red = suit === HEARTS || suit === DIAMONDS;
  el.className = `card ${red ? 'red' : 'black'}${suit === SPADES && rank === 14 ? ' spade-ace' : ''}`;
  el.dataset.card = cardToString(card);
  el.dataset.testid = `card-${cardToString(card)}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${rankName(rank)} of ${SUIT_NAMES[suit]}`);

  for (const pos of ['tl', 'br']) {
    const corner = document.createElement('div');
    corner.className = `corner ${pos}`;
    const r = document.createElement('span');
    r.className = `rank${rank === 10 ? ' ten' : ''}`;
    r.textContent = rankLabel(rank);
    corner.append(r, suitUse(suit));
    el.appendChild(corner);
  }

  if (rank === 14) {
    el.appendChild(suitUse(suit, 'suit ace'));
  } else if (rank >= 11) {
    const face = document.createElement('div');
    face.className = 'face';
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = rankLabel(rank);
    face.append(suitUse(suit, 'suit mini a'), letter, suitUse(suit, 'suit mini b'));
    el.appendChild(face);
  } else {
    const pips = document.createElement('div');
    pips.className = 'pips';
    for (const [x, y] of PIPS[rank]) {
      const s = suitUse(suit, `suit${y > 0.5 ? ' flip' : ''}`);
      s.style.left = `${x * 100}%`;
      s.style.top = `${y * 100}%`;
      pips.appendChild(s);
    }
    el.appendChild(pips);
  }
  return el;
}

export function rankName(rank) {
  return { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' }[rank] || String(rank);
}

/** Small inline suit glyph for use in text (status line, coach). */
export function suitGlyph(suit) {
  const span = document.createElement('span');
  span.className = `glyph ${suit === HEARTS || suit === DIAMONDS ? 'red' : 'black'}`;
  span.textContent = ['♣', '♦', '♥', '♠'][suit];
  return span;
}

export { suitOf, rankOf };

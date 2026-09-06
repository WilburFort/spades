// The table: builds the 1280x800 stage, renders seats/hand/trick/scoreboard,
// and performs the card animations. Everything positions inside the stage in
// design pixels; the stage is scaled uniformly to fit the viewport.

import { cardEl, suitSprite } from './cards.js';
import { avatarSvg, humanAvatarSvg } from './avatars.js';
import { sortHandForDisplay, cardToString, suitOf, HEARTS, DIAMONDS } from '../engine/cards.js';
import { NIL, teamOf } from '../engine/scoring.js';
import { TIER_LABEL } from '../app/roster.js';

const STAGE_W = 1280;
const STAGE_H = 800;
const SEAT_NAMES = ['South', 'West', 'North', 'East'];
// Where a trick card ends up (stage px, card centre) — must match .trick .slot CSS.
const TRICK_CENTER = { x: 640, y: 385 };
const SLOT_OFFSET = [
  { x: 0, y: 66 },
  { x: -92, y: 0 },
  { x: 0, y: -66 },
  { x: 92, y: 0 },
];
// Nameplate centres, used as the target of the trick sweep and for bubbles.
const PLATE_CENTER = [
  { x: 120, y: 744 },
  { x: 120, y: 400 },
  { x: 640, y: 100 },
  { x: 1160, y: 400 },
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function svgIcon(paths) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}
export const ICONS = {
  bulb: svgIcon('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.6 10.8c-.7.6-1.1 1.4-1.1 2.2H9.5c0-.8-.4-1.6-1.1-2.2A6 6 0 0 1 12 3z"/>'),
  sound: svgIcon('<path d="M4 10v4h3l4 4V6L7 10H4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  soundOff: svgIcon('<path d="M4 10v4h3l4 4V6L7 10H4zM16 9l5 5M21 9l-5 5"/>'),
  gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  help: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>'),
  scores: svgIcon('<path d="M4 20h16M6 16V10M12 16V4M18 16v-6"/>'),
  menu: svgIcon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};
const SPADE_PATH = '<svg class="spade" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6C30 32 8 44 8 62c0 12 9 21 21 21 8 0 14-4 18-10-2 12-7 18-15 23h36c-8-5-13-11-15-23 4 6 10 10 18 10 12 0 21-9 21-21C92 44 70 32 50 6z"/></svg>';

export class Table {
  constructor(root, { onCardClick } = {}) {
    this.root = root;
    this.scale = 1;
    this.chars = [null, null, null, null];
    this.names = ['You', 'West', 'North', 'East'];
    this.onCardClick = onCardClick || (() => {});
    this.handSlots = new Map(); // card id -> slot element
    this.trickCards = new Map(); // seat -> card element
    this.bubbleTimers = [null, null, null, null];
    this.coachTimer = null;
    this.toastTimer = null;
    this._build();
    this._fit();
    window.addEventListener('resize', () => this._fit());
  }

  // ------------------------------------------------------------ construction
  _build() {
    this.root.innerHTML = '';
    this.root.appendChild(suitSprite());
    const stage = el('div', 'stage');
    stage.dataset.testid = 'stage';
    this.stage = stage;
    stage.appendChild(el('div', 'felt'));

    // top bar
    const top = el('div', 'topbar');
    top.innerHTML = `
      <div class="brand">${SPADE_PATH}<span>Spades Night</span><small data-testid="handinfo"></small></div>
      <div class="status" data-testid="status" aria-live="polite"></div>
      <div class="scoreboard" data-testid="scoreboard">
        <div class="score-row us"><span class="label" data-testid="team-us-label">Us</span><span class="score" data-testid="score-us">0</span><span class="bags" data-testid="bags-us"></span><span class="handchip" data-testid="handchip-us"></span></div>
        <div class="score-row them"><span class="label" data-testid="team-them-label">Them</span><span class="score" data-testid="score-them">0</span><span class="bags" data-testid="bags-them"></span><span class="handchip" data-testid="handchip-them"></span></div>
      </div>
      <div class="toolbar">
        <button class="textbtn" data-testid="btn-hint" title="Coach: suggest a card (H)">Hint</button>
        <button class="iconbtn" data-testid="btn-coach" title="Coach tips (C)" aria-label="Toggle coach tips">${ICONS.bulb}</button>
        <button class="iconbtn" data-testid="btn-sound" title="Sound (M)" aria-label="Toggle sound">${ICONS.sound}</button>
        <button class="iconbtn" data-testid="btn-scores" title="Score history" aria-label="Score history">${ICONS.scores}</button>
        <button class="iconbtn" data-testid="btn-help" title="Rules & help (?)" aria-label="Rules and help">${ICONS.help}</button>
        <button class="iconbtn" data-testid="btn-settings" title="Settings" aria-label="Settings">${ICONS.gear}</button>
      </div>`;
    stage.appendChild(top);
    this.$ = (sel) => stage.querySelector(sel);
    this.statusEl = this.$('.status');
    this.buttons = {
      hint: this.$('[data-testid=btn-hint]'),
      coach: this.$('[data-testid=btn-coach]'),
      sound: this.$('[data-testid=btn-sound]'),
      scores: this.$('[data-testid=btn-scores]'),
      help: this.$('[data-testid=btn-help]'),
      settings: this.$('[data-testid=btn-settings]'),
    };

    // seats
    this.seatEls = [];
    for (let s = 0; s < 4; s++) {
      const seat = el('div', `seat ${teamOf(s) === 0 ? 'us' : 'them'}`);
      seat.dataset.seat = String(s);
      seat.dataset.testid = `seat-${s}`;
      seat.innerHTML = `<div class="nameplate"><div class="avatar" data-testid="avatar-${s}"></div><div class="plate-text"><div class="plate-name" data-testid="name-${s}"></div><div class="plate-chip" data-testid="chip-${s}"></div></div><div class="dealer-badge" data-testid="dealer-${s}" title="Dealer" hidden>D</div></div>`;
      stage.appendChild(seat);
      this.seatEls.push(seat);
    }
    // fans for bots
    this.fanEls = [];
    for (let s = 0; s < 4; s++) {
      const fan = el('div', 'fan');
      fan.dataset.seat = String(s);
      fan.dataset.testid = `fan-${s}`;
      if (s !== 0) stage.appendChild(fan);
      this.fanEls.push(fan);
    }
    // spade tracker (coach aid)
    this.trackerEl = el('div', 'tracker');
    this.trackerEl.dataset.testid = 'spade-tracker';
    this.trackerEl.title = 'Spades still unplayed — the ones in your own hand are shown in teal';
    this.trackerEl.hidden = true;
    stage.appendChild(this.trackerEl);
    // last trick button + panel
    this.lastTrickBtn = el('button', 'textbtn lasttrick', 'Last trick');
    this.lastTrickBtn.dataset.testid = 'btn-lasttrick';
    this.lastTrickBtn.hidden = true;
    stage.appendChild(this.lastTrickBtn);
    this.lastPanel = null;
    // trick area
    this.trickEl = el('div', 'trick');
    this.trickEl.dataset.testid = 'trick';
    for (let s = 0; s < 4; s++) {
      const slot = el('div', 'slot');
      slot.dataset.seat = String(s);
      slot.dataset.testid = `trick-slot-${s}`;
      this.trickEl.appendChild(slot);
    }
    stage.appendChild(this.trickEl);
    // human hand
    this.handEl = el('div', 'hand');
    this.handEl.dataset.testid = 'hand';
    stage.appendChild(this.handEl);
    // flying layer
    this.flyEl = el('div', 'flying');
    stage.appendChild(this.flyEl);
    // coach
    this.coachEl = el('div', 'coach');
    this.coachEl.dataset.testid = 'coach';
    this.coachEl.setAttribute('role', 'status');
    stage.appendChild(this.coachEl);
    // toast
    this.toastEl = el('div', 'toast');
    this.toastEl.dataset.testid = 'toast';
    stage.appendChild(this.toastEl);
    // bubbles
    this.bubbleEls = [];
    for (let s = 0; s < 4; s++) {
      const b = el('div', 'bubble');
      b.dataset.testid = `bubble-${s}`;
      stage.appendChild(b);
      this.bubbleEls.push(b);
    }
    // overlay container for dialogs
    this.overlayRoot = el('div');
    this.overlayRoot.dataset.testid = 'overlays';
    stage.appendChild(this.overlayRoot);

    this.root.appendChild(stage);
  }

  _fit() {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const s = Math.min(w / STAGE_W, h / STAGE_H);
    this.scale = s;
    const x = (w - STAGE_W * s) / 2;
    const y = (h - STAGE_H * s) / 2;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }

  /** Stage-local rect of an element (design px). */
  _rect(elm) {
    const r = elm.getBoundingClientRect();
    const base = this.stage.getBoundingClientRect();
    return {
      x: (r.left - base.left) / this.scale,
      y: (r.top - base.top) / this.scale,
      w: r.width / this.scale,
      h: r.height / this.scale,
    };
  }

  // ------------------------------------------------------------ people
  setLineup(chars, playerName = 'You') {
    this.chars = chars;
    this.names = chars.map((c, s) => (c ? c.name : playerName));
    for (let s = 0; s < 4; s++) {
      const c = chars[s];
      this.$(`[data-testid=avatar-${s}]`).innerHTML = c ? avatarSvg(c.avatar) : humanAvatarSvg();
      const name = this.$(`[data-testid=name-${s}]`);
      if (c) {
        name.innerHTML = `<span>${c.name}</span><span class="stars" title="${TIER_LABEL[c.tier]}">${'★'.repeat(c.stars)}</span>`;
      } else {
        name.innerHTML = `<span>${escapeHtml(playerName)}</span><span class="you">${playerName === 'You' ? SEAT_NAMES[s] : `you · ${SEAT_NAMES[s]}`}</span>`;
      }
    }
    this.$('[data-testid=team-us-label]').textContent = 'Us';
    this.$('[data-testid=team-them-label]').textContent = 'Them';
    this.$('[data-testid=team-us-label]').title = `${playerName} & ${this.names[2]}`;
    this.$('[data-testid=team-them-label]').title = `${this.names[1]} & ${this.names[3]}`;
  }

  // ------------------------------------------------------------ rendering
  setPhase(phase) {
    this.root.dataset.phase = phase;
  }

  setTurn(seat) {
    this.root.dataset.turn = seat === null || seat === undefined ? 'none' : String(seat);
    for (let s = 0; s < 4; s++) this.seatEls[s].classList.toggle('turn', s === seat);
  }

  setAnimating(on) {
    this.root.dataset.animating = on ? 'true' : 'false';
  }

  renderScoreboard(state) {
    const opts = state.options;
    for (const [team, key] of [[0, 'us'], [1, 'them']]) {
      this.$(`[data-testid=score-${key}]`).textContent = String(state.scores[team]);
      const bags = this.$(`[data-testid=bags-${key}]`);
      const at = opts.bagPenaltyAt || 0;
      bags.innerHTML = '';
      if (at > 0) {
        for (let i = 0; i < at; i++) bags.appendChild(el('i', i < state.bags[team] ? 'on' : ''));
        bags.classList.toggle('hot', state.bags[team] >= at - 2);
        bags.title = `${state.bags[team]} bag${state.bags[team] === 1 ? '' : 's'} — ${at} bags cost ${opts.bagPenalty} points`;
      }
      const chip = this.$(`[data-testid=handchip-${key}]`);
      const seats = team === 0 ? [0, 2] : [1, 3];
      const bidsIn = seats.every((s) => state.bids[s] !== null);
      if (state.phase === 'playing' || state.phase === 'handOver' || state.phase === 'gameOver') {
        const bid = seats.reduce((sum, s) => sum + (state.bids[s] !== null && state.bids[s] !== NIL ? state.bids[s] : 0), 0);
        const won = seats.reduce((sum, s) => sum + state.tricksWon[s], 0);
        chip.textContent = bidsIn ? `bid ${bid} · won ${won}` : '';
      } else chip.textContent = '';
    }
    this.$('[data-testid=handinfo]').textContent = state.handNumber ? `Hand ${state.handNumber} · to ${opts.targetScore}` : '';
  }

  renderSeats(state) {
    for (let s = 0; s < 4; s++) {
      const chip = this.$(`[data-testid=chip-${s}]`);
      const bid = state.bids[s];
      const won = state.tricksWon[s];
      if (state.phase === 'bidding' || state.phase === 'idle') {
        chip.innerHTML = bid === null ? '<span>Bid —</span>' : bid === NIL ? `<span class="nil">${state.blind[s] ? 'BLIND NIL' : 'NIL'}</span>` : `<span>Bid <b>${bid}</b></span>`;
      } else if (bid === null) {
        chip.innerHTML = '';
      } else if (bid === NIL) {
        const cls = won > 0 ? 'nil busted' : state.phase === 'handOver' || state.phase === 'gameOver' ? 'nil made' : 'nil';
        chip.innerHTML = `<span class="${cls}">${state.blind[s] ? 'BLIND NIL' : 'NIL'}</span><span>· won <b>${won}</b></span>`;
      } else {
        const pips = [];
        const n = Math.min(8, Math.max(bid, won));
        for (let i = 0; i < n; i++) pips.push(`<i class="${i < won ? (i < bid ? 'won' : 'bag') : ''}"></i>`);
        const more = Math.max(bid, won) > 8 ? `<span style="font-size:10px">+${Math.max(bid, won) - 8}</span>` : '';
        chip.innerHTML = `<span>Bid <b>${bid}</b></span><span>· won <b>${won}</b></span><span class="pips" title="${won} of ${bid}">${pips.join('')}${more}</span>`;
      }
      this.$(`[data-testid=dealer-${s}]`).hidden = state.dealer !== s || !state.handNumber;
    }
  }

  /** Spades still unplayed, as 13 rank pills; the player's own spades are tinted. */
  renderTracker(state, visible) {
    this.trackerEl.hidden = !visible || !state.handNumber;
    if (this.trackerEl.hidden) return;
    const played = new Set();
    for (const t of state.tricks) for (const p of t.plays) if (suitOf(p.card) === 3) played.add(p.card);
    for (const p of state.trick) if (suitOf(p.card) === 3) played.add(p.card);
    const mine = new Set(state.hands[0].filter((c) => suitOf(c) === 3));
    const labels = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let html = '<span class="sp">♠</span>';
    for (let r = 0; r < 13; r++) {
      const card = 39 + r;
      html += `<i class="${played.has(card) ? 'gone' : mine.has(card) ? 'mine' : ''}">${labels[r]}</i>`;
    }
    const left = 13 - played.size;
    html += `<span class="lbl">${left} spade${left === 1 ? '' : 's'} left</span>`;
    this.trackerEl.innerHTML = html;
  }

  /** Show the previous trick in a small panel. */
  showLastTrick(state) {
    this.hideLastTrick();
    const t = state.tricks[state.tricks.length - 1];
    if (!t) return;
    const p = el('div', 'lastpanel');
    p.dataset.testid = 'lastpanel';
    p.appendChild(el('div', 'title', `Trick ${state.tricks.length} — ${this.names[t.winner]} won`));
    for (const play of t.plays) {
      const item = el('div', `lt${play.seat === t.winner ? ' winner' : ''}`);
      item.appendChild(cardEl(play.card));
      item.appendChild(el('span', '', escapeHtml(play.seat === 0 ? 'You' : this.names[play.seat])));
      p.appendChild(item);
    }
    this.stage.appendChild(p);
    this.lastPanel = p;
    const hide = () => this.hideLastTrick();
    p.addEventListener('click', hide);
    this.lastPanelTimer = setTimeout(hide, 3500);
  }

  hideLastTrick() {
    clearTimeout(this.lastPanelTimer);
    this.lastPanel?.remove();
    this.lastPanel = null;
  }

  renderFans(state, { dealAnimation = false } = {}) {
    for (let s = 1; s < 4; s++) {
      const fan = this.fanEls[s];
      const n = state.hands[s].length;
      const existing = fan.children.length;
      if (existing === n) continue;
      fan.innerHTML = '';
      const step = 14;
      const span = (n - 1) * step;
      for (let i = 0; i < n; i++) {
        const c = cardEl(0, { faceDown: true });
        if (dealAnimation) {
          c.classList.add('dealt');
          c.style.animationDelay = `calc(var(--dur-deal) * ${i * 2 + (s === 1 ? 0 : s === 2 ? 1 : 2) * 0.66})`;
        }
        const off = -span / 2 + i * step;
        if (s === 2) {
          c.style.left = `${off - 20}px`;
          c.style.top = '-28px';
          c.style.transform = `rotate(${(i - (n - 1) / 2) * 1.2}deg)`;
        } else {
          c.style.left = '-20px';
          c.style.top = `${off - 28}px`;
          c.style.transform = `rotate(${s === 1 ? 90 : -90}deg)`;
        }
        fan.appendChild(c);
      }
    }
  }

  /** Position (stage px) of the "source" of a bot's card, for the play animation. */
  _fanSource(seat) {
    const fan = this.fanEls[seat];
    const kids = fan.children;
    if (!kids.length) {
      const c = fan.getBoundingClientRect();
      return { x: (c.left - this.stage.getBoundingClientRect().left) / this.scale, y: (c.top - this.stage.getBoundingClientRect().top) / this.scale, w: 40, h: 56 };
    }
    return this._rect(kids[kids.length - 1]);
  }

  /**
   * Render the human's hand. `legal` is a Set of card ids that may be played
   * (null → no interaction). `faceDown` hides the cards (blind-nil decision).
   */
  renderHand(state, { legal = null, faceDown = false, dealAnimation = false } = {}) {
    const cards = sortHandForDisplay(state.hands[0]);
    const n = cards.length;
    this.handEl.dataset.facedown = faceDown ? 'true' : 'false';
    // Remove slots for cards no longer held.
    for (const [id, slot] of this.handSlots) {
      if (!cards.includes(id)) {
        slot.remove();
        this.handSlots.delete(id);
      }
    }
    const step = n > 1 ? Math.min(56, 740 / (n - 1)) : 0;
    cards.forEach((card, i) => {
      let slot = this.handSlots.get(card);
      const rebuild = slot && slot.dataset.facedown !== String(faceDown);
      if (rebuild) {
        slot.remove();
        slot = null;
        this.handSlots.delete(card);
      }
      if (!slot) {
        slot = el('div', 'slot');
        slot.dataset.card = cardToString(card);
        slot.dataset.testid = `hand-card-${cardToString(card)}`;
        slot.dataset.facedown = String(faceDown);
        const c = cardEl(card, { faceDown });
        c.tabIndex = -1;
        slot.appendChild(c);
        slot.addEventListener('click', () => this.onCardClick(card));
        slot.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.onCardClick(card);
          }
        });
        if (dealAnimation) {
          slot.classList.add('dealt');
          slot.style.animationDelay = `calc(var(--dur-deal) * ${i * 2})`;
          slot.firstChild.style.animationDelay = `calc(var(--dur-deal) * ${i * 2})`;
        }
        this.handEl.appendChild(slot);
        this.handSlots.set(card, slot);
      }
      const k = i - (n - 1) / 2;
      slot.style.left = `${k * step}px`;
      slot.style.transform = `translateY(${k * k * 0.6}px) rotate(${k * 1.8}deg)`;
      slot.style.zIndex = String(10 + i);
      const isLegal = legal ? legal.has(card) : false;
      slot.classList.toggle('legal', !!legal && isLegal);
      slot.classList.toggle('illegal', !!legal && !isLegal);
      slot.dataset.legal = legal ? String(isLegal) : 'none';
      slot.firstChild.tabIndex = legal && isLegal ? 0 : -1;
      slot.firstChild.setAttribute('aria-disabled', legal && !isLegal ? 'true' : 'false');
    });
  }

  clearHand() {
    this.handEl.innerHTML = '';
    this.handSlots.clear();
  }

  shakeCard(card) {
    const slot = this.handSlots.get(card);
    if (!slot) return;
    slot.classList.remove('shake');
    void slot.offsetWidth;
    slot.classList.add('shake');
    setTimeout(() => slot.classList.remove('shake'), 300);
  }

  setHint(card) {
    for (const slot of this.handSlots.values()) slot.classList.remove('hint');
    if (card !== null && card !== undefined) this.handSlots.get(card)?.classList.add('hint');
  }

  focusFirstLegal() {
    for (const slot of this.handSlots.values()) {
      if (slot.classList.contains('legal')) {
        slot.firstChild.focus({ preventScroll: true });
        return;
      }
    }
  }

  // ------------------------------------------------------------ animations
  _dur(name) {
    const v = getComputedStyle(this.root.firstElementChild || this.stage).getPropertyValue(name).trim();
    if (v.endsWith('ms')) return parseFloat(v);
    if (v.endsWith('s')) return parseFloat(v) * 1000;
    return 0;
  }

  wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Deal: fans fill in and the human's cards drop in staggered. */
  async animateDeal(state, { faceDown = false } = {}) {
    this.clearTrick();
    this.clearHand();
    for (let s = 1; s < 4; s++) this.fanEls[s].innerHTML = '';
    this.renderFans(state, { dealAnimation: true });
    this.renderHand(state, { legal: null, faceDown, dealAnimation: true });
    const dealMs = this._dur('--dur-deal');
    await this.wait(dealMs * 26 + this._dur('--dur-play'));
  }

  /** Animate `seat` playing `card` into the trick. */
  async animatePlay(seat, card) {
    const slot = this.trickEl.querySelector(`.slot[data-seat="${seat}"]`);
    const target = cardEl(card);
    target.dataset.testid = `trick-card-${seat}`;
    slot.innerHTML = '';
    slot.appendChild(target);
    this.trickCards.set(seat, target);
    // Source geometry
    let src;
    if (seat === 0) {
      const hs = this.handSlots.get(card);
      src = hs ? this._rect(hs.firstChild) : null;
      if (hs) {
        hs.remove();
        this.handSlots.delete(card);
      }
    } else {
      src = this._fanSource(seat);
    }
    const dst = this._rect(target);
    const dur = this._dur('--dur-play');
    if (src && dur > 0) {
      const dx = src.x + src.w / 2 - (dst.x + dst.w / 2);
      const dy = src.y + src.h / 2 - (dst.y + dst.h / 2);
      const sc = seat === 0 ? src.w / dst.w : 0.55;
      const rot = seat === 1 ? 90 : seat === 3 ? -90 : 0;
      target.style.transform = `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${rot}deg)`;
      target.style.opacity = seat === 0 ? '1' : '0.7';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      target.classList.add('moving');
      const tilt = ((seat * 37 + card * 13) % 9) - 4; // seeded-looking hand-placed tilt
      target.style.transform = `rotate(${tilt}deg)`;
      target.style.opacity = '1';
      await this.wait(dur);
      target.classList.remove('moving');
    } else {
      const tilt = ((seat * 37 + card * 13) % 9) - 4;
      target.style.transform = `rotate(${tilt}deg)`;
    }
  }

  markWinning(seat) {
    for (const [s, c] of this.trickCards) c.classList.toggle('winning', s === seat);
  }

  /** Gather the trick to the winner's nameplate and clear it. */
  async animateTrickSweep(winner) {
    const dur = this._dur('--dur-sweep');
    const target = PLATE_CENTER[winner];
    const promises = [];
    for (const [seat, c] of this.trickCards) {
      const r = this._rect(c);
      const dx = target.x - (r.x + r.w / 2);
      const dy = target.y - (r.y + r.h / 2);
      c.classList.remove('winning');
      c.style.transition = `transform ${dur}ms cubic-bezier(0.4, 0, 0.8, 0.4), opacity ${dur}ms ease-in`;
      c.style.transform = `translate(${dx}px, ${dy}px) scale(0.35) rotate(${seat * 20}deg)`;
      c.style.opacity = '0';
      promises.push(this.wait(dur));
    }
    await Promise.all(promises);
    this.clearTrick();
  }

  clearTrick() {
    for (const slot of this.trickEl.querySelectorAll('.slot')) slot.innerHTML = '';
    this.trickCards.clear();
  }

  /** Re-render the current trick without animation (used when resuming a game). */
  renderTrick(state) {
    this.clearTrick();
    for (const p of state.trick) {
      const slot = this.trickEl.querySelector(`.slot[data-seat="${p.seat}"]`);
      const c = cardEl(p.card);
      c.dataset.testid = `trick-card-${p.seat}`;
      c.style.transform = `rotate(${((p.seat * 37 + p.card * 13) % 9) - 4}deg)`;
      slot.appendChild(c);
      this.trickCards.set(p.seat, c);
    }
  }

  // ------------------------------------------------------------ text & effects
  setStatus(html) {
    this.statusEl.innerHTML = html;
  }

  showBubble(seat, text, ms = 1800) {
    const b = this.bubbleEls[seat];
    if (!text) return;
    b.innerHTML = text;
    b.className = 'bubble';
    b.style.cssText = '';
    const pos = PLATE_CENTER[seat];
    if (seat === 2) {
      // Right of the partner's nameplate, clear of the fan.
      b.classList.add('tail-left');
      b.style.left = `${pos.x + 110}px`;
      b.style.top = `${pos.y - 22}px`;
    } else if (seat === 1) {
      // Above the West nameplate.
      b.classList.add('tail-down');
      b.style.left = '24px';
      b.style.bottom = `${800 - (pos.y - 40)}px`;
    } else if (seat === 3) {
      // Above the East nameplate, anchored to the right edge.
      b.classList.add('tail-down', 'right');
      b.style.right = '24px';
      b.style.bottom = `${800 - (pos.y - 40)}px`;
    } else {
      b.classList.add('tail-down');
      b.style.left = `${pos.x - 60}px`;
      b.style.bottom = `${800 - (pos.y - 40)}px`;
    }
    requestAnimationFrame(() => b.classList.add('show'));
    clearTimeout(this.bubbleTimers[seat]);
    this.bubbleTimers[seat] = setTimeout(() => b.classList.remove('show'), ms);
  }

  hideBubbles() {
    for (let s = 0; s < 4; s++) {
      clearTimeout(this.bubbleTimers[s]);
      this.bubbleEls[s].classList.remove('show');
    }
  }

  /**
   * Show a coach prompt. `prompt` = {id, text, why?}. Handlers: onDismiss, onOff.
   */
  showCoach(prompt, { onDismiss, onOff } = {}) {
    const c = this.coachEl;
    c.innerHTML = '';
    c.dataset.tip = prompt.id;
    c.insertAdjacentHTML('beforeend', ICONS.bulb.replace('<svg', '<svg class="bulb"'));
    const body = el('div');
    body.style.flex = '1';
    const text = el('div', 'text', prompt.text);
    body.appendChild(text);
    const actions = el('div', 'actions');
    if (prompt.why) {
      const why = el('button', 'why-link', 'Why?');
      why.type = 'button';
      why.dataset.testid = 'coach-why';
      const whyText = el('div', 'why', prompt.why);
      whyText.hidden = true;
      why.addEventListener('click', () => {
        whyText.hidden = !whyText.hidden;
        why.textContent = whyText.hidden ? 'Why?' : 'Hide';
      });
      body.appendChild(whyText);
      actions.appendChild(why);
    }
    const off = el('button', 'off-link', 'Turn off tips');
    off.type = 'button';
    off.dataset.testid = 'coach-off';
    off.addEventListener('click', () => onOff && onOff());
    actions.appendChild(off);
    body.appendChild(actions);
    c.appendChild(body);
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss tip');
    close.dataset.testid = 'coach-close';
    close.addEventListener('click', () => {
      this.hideCoach();
      onDismiss && onDismiss(prompt.id);
    });
    c.appendChild(close);
    c.classList.add('show');
  }

  hideCoach() {
    this.coachEl.classList.remove('show');
    delete this.coachEl.dataset.tip;
  }

  toast(text, ms = 1600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  stamp(text, kind = 'bad') {
    const s = el('div', `stamp ${kind}`, text);
    s.dataset.testid = 'stamp';
    this.stage.appendChild(s);
    setTimeout(() => s.remove(), 1600);
  }

  floater(seat, text, color) {
    const f = el('div', 'floater', text);
    const pos = PLATE_CENTER[seat];
    f.style.left = `${pos.x + (seat === 1 ? 90 : seat === 3 ? -120 : 90)}px`;
    f.style.top = `${pos.y - 30}px`;
    if (color) f.style.color = color;
    this.stage.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  confetti(count = 80) {
    const glyphs = ['♠', '♥', '♦', '♣'];
    const colors = ['#ffd166', '#ff7f6e', '#5ad1b5', '#f3f1e9'];
    for (let i = 0; i < count; i++) {
      const p = el('div', 'confetti-piece', glyphs[i % 4]);
      p.style.left = `${Math.random() * 1280}px`;
      p.style.color = colors[i % 4];
      p.style.fontSize = `${16 + Math.random() * 20}px`;
      p.style.animationDuration = `${2.2 + Math.random() * 2}s`;
      p.style.animationDelay = `${Math.random() * 1.2}s`;
      this.stage.appendChild(p);
      setTimeout(() => p.remove(), 5000);
    }
  }

  /** Card colour helper for status text. */
  static pretty(card) {
    const s = suitOf(card);
    const red = s === HEARTS || s === DIAMONDS;
    return `<span class="${red ? 'red' : ''}" style="${red ? 'color:#ff8c94' : ''}">${prettyText(card)}</span>`;
  }
}

function prettyText(card) {
  const r = (card % 13) + 2;
  const label = r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r);
  return label + ['♣', '♦', '♥', '♠'][suitOf(card)];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { SEAT_NAMES, PLATE_CENTER, TRICK_CENTER, SLOT_OFFSET };

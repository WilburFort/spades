// Overlays: lobby, bid panel, hand summary, game over, settings, rules, score history.

import { avatarSvg, humanAvatarSvg } from './avatars.js';
import { ROSTER, ROSTER_BY_ID, PRESETS, TIER_LABEL } from '../app/roster.js';
import { NIL } from '../engine/scoring.js';
import { cardToPretty, suitOf, HEARTS, DIAMONDS } from '../engine/cards.js';
import { escapeHtml } from './table.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function overlay(root, dialogCls, testid) {
  const ov = el('div', 'overlay');
  ov.dataset.testid = testid;
  const d = el('div', `dialog ${dialogCls || ''}`);
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  ov.appendChild(d);
  root.appendChild(ov);
  // Keep keyboard focus inside the dialog while it is open.
  const previouslyFocused = document.activeElement;
  ov.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...d.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !d.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !d.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  });
  return {
    ov,
    d,
    close: () => {
      ov.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    },
  };
}

function trapEnter(ov, handler) {
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  });
}

function switchEl(checked, onChange, testid) {
  const b = el('button', 'switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', checked ? 'true' : 'false');
  if (testid) b.dataset.testid = testid;
  b.addEventListener('click', () => {
    const now = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', now ? 'true' : 'false');
    onChange(now);
  });
  return b;
}

function field(label, hint, control) {
  const f = el('div', 'field');
  const l = el('div', 'lbl', `<span>${label}</span>${hint ? `<small>${hint}</small>` : ''}`);
  f.append(l, control);
  return f;
}

function seg(options, value, onChange, testid) {
  const s = el('div', 'seg');
  if (testid) s.dataset.testid = testid;
  for (const [val, label] of options) {
    const b = el('button', '', label);
    b.type = 'button';
    b.dataset.value = val;
    b.setAttribute('aria-pressed', val === value ? 'true' : 'false');
    b.addEventListener('click', () => {
      for (const x of s.children) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      onChange(val);
    });
    s.appendChild(b);
  }
  return s;
}

// ---------------------------------------------------------------- lobby

/**
 * @param {HTMLElement} root
 * @param {{settings, resume: object|null, onPlay: (settings)=>void, onResume: ()=>void, onRules: ()=>void}} opts
 */
export function showLobby(root, { settings, resume, onPlay, onResume, onRules }) {
  const lob = el('div', 'lobby');
  lob.dataset.testid = 'lobby';
  const card = el('div', 'lobby-card');
  lob.appendChild(card);

  const hero = el('div', 'hero');
  hero.innerHTML = `<div><h1><svg class="spade" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6C30 32 8 44 8 62c0 12 9 21 21 21 8 0 14-4 18-10-2 12-7 18-15 23h36c-8-5-13-11-15-23 4 6 10 10 18 10 12 0 21-9 21-21C92 44 70 32 50 6z"/></svg>Spades Night</h1><p>Partnership Spades against three AI players. Pick a table and deal.</p></div>`;
  const play = el('button', 'textbtn primary', 'Deal me in');
  play.dataset.testid = 'btn-play';
  hero.appendChild(play);
  card.appendChild(hero);

  const cols = el('div', 'cols');
  card.appendChild(cols);
  const left = el('div');
  const right = el('div');
  cols.append(left, right);

  // presets
  left.appendChild(el('h3', '', 'Table'));
  const presets = el('div', 'presets');
  presets.dataset.testid = 'presets';
  const lineupEl = el('div', 'lineup');
  const renderLineup = () => {
    lineupEl.innerHTML = '';
    for (const [role, label] of [['partner', 'Partner'], ['west', 'Left'], ['east', 'Right']]) {
      const row = el('div', 'lineup-row');
      row.appendChild(el('div', 'role', label));
      const pick = el('div', 'botpick');
      pick.dataset.testid = `pick-${role}`;
      for (const bot of ROSTER) {
        const b = el('button');
        b.type = 'button';
        b.dataset.bot = bot.id;
        b.title = `${bot.name} — ${TIER_LABEL[bot.tier]}. ${bot.tagline}`;
        b.innerHTML = `<span class="avatar">${avatarSvg(bot.avatar)}</span><span class="nm">${bot.name.replace('Prof. ', '')}</span><span class="stars">${'★'.repeat(bot.stars)}</span>`;
        b.setAttribute('aria-pressed', settings.lineup[role] === bot.id ? 'true' : 'false');
        const usedElsewhere = Object.entries(settings.lineup).some(([r, id]) => r !== role && id === bot.id);
        b.disabled = usedElsewhere;
        b.addEventListener('click', () => {
          settings.lineup[role] = bot.id;
          settings.preset = Object.entries(PRESETS).find(([, p]) => ['partner', 'west', 'east'].every((k) => p.lineup[k] === settings.lineup[k]))?.[0] || 'custom';
          renderPresets();
          renderLineup();
        });
        pick.appendChild(b);
      }
      row.appendChild(pick);
      lineupEl.appendChild(row);
    }
  };
  const renderPresets = () => {
    presets.innerHTML = '';
    for (const [key, p] of Object.entries(PRESETS)) {
      const b = el('button', 'preset', `<b>${p.label}</b><small>${p.blurb}</small>`);
      b.type = 'button';
      b.dataset.testid = `preset-${key}`;
      b.setAttribute('aria-pressed', settings.preset === key ? 'true' : 'false');
      b.addEventListener('click', () => {
        settings.preset = key;
        settings.lineup = { ...p.lineup };
        renderPresets();
        renderLineup();
      });
      presets.appendChild(b);
    }
  };
  renderPresets();
  left.appendChild(presets);
  left.appendChild(el('h3', '', 'Players'));
  renderLineup();
  left.appendChild(lineupEl);
  left.appendChild(el('div', 'tiny', '★ Rookie · ★★ Solid · ★★★ Expert. Hover a player for their style.'));

  // options
  right.appendChild(el('h3', '', 'Options'));
  right.appendChild(field('Coach tips', 'Short prompts explaining what to do next', switchEl(settings.coach, (v) => (settings.coach = v), 'toggle-coach')));
  right.appendChild(field('Table talk', 'Speech bubbles from the other players', switchEl(settings.tableTalk, (v) => (settings.tableTalk = v), 'toggle-talk')));
  right.appendChild(field('Sound', 'Card, trick and score effects', switchEl(settings.sound, (v) => (settings.sound = v), 'toggle-sound')));
  right.appendChild(field('Speed', 'How fast the bots play', seg([['normal', 'Relaxed'], ['fast', 'Fast'], ['instant', 'Instant']], settings.speed, (v) => (settings.speed = v), 'seg-speed')));
  const target = el('select', 'select');
  target.dataset.testid = 'select-target';
  for (const t of [200, 300, 500, 750]) {
    const o = el('option', '', `${t} points`);
    o.value = String(t);
    if (settings.options.targetScore === t) o.selected = true;
    target.appendChild(o);
  }
  target.addEventListener('change', () => (settings.options.targetScore = Number(target.value)));
  right.appendChild(field('Play to', 'First team to reach this score wins', target));
  const name = el('input', 'text');
  name.value = settings.playerName;
  name.maxLength = 16;
  name.placeholder = 'Your name';
  name.dataset.testid = 'input-name';
  name.addEventListener('input', () => (settings.playerName = name.value.trim() || 'You'));
  right.appendChild(field('Your name', '', name));
  const more = el('details');
  more.innerHTML = '<summary style="cursor:pointer;color:var(--muted);padding:8px 0">House rules</summary>';
  const moreBody = el('div');
  moreBody.appendChild(field('Blind nil', 'Bid nil before looking when 100+ behind (±200)', switchEl(settings.options.allowBlindNil, (v) => (settings.options.allowBlindNil = v))));
  moreBody.appendChild(field('Bag penalty', 'Every 10 overtricks costs 100 points', switchEl(settings.options.bagPenaltyAt > 0, (v) => (settings.options.bagPenaltyAt = v ? 10 : 0))));
  moreBody.appendChild(field('Failed nil helps partner', 'A busted nil bidder’s tricks still count toward the team bid', switchEl(settings.options.nilTricksHelpPartner, (v) => (settings.options.nilTricksHelpPartner = v))));
  moreBody.appendChild(field('10 for 200', 'A made team bid of 10+ scores 200', switchEl(settings.options.tenForTwoHundred, (v) => (settings.options.tenForTwoHundred = v))));
  moreBody.appendChild(field('Lose at −200', 'A team that falls to −200 loses immediately', switchEl(settings.options.losingScore !== null, (v) => (settings.options.losingScore = v ? -200 : null))));
  more.appendChild(moreBody);
  right.appendChild(more);

  const links = el('div', 'tiny');
  links.style.display = 'flex';
  links.style.alignItems = 'center';
  links.style.gap = '12px';
  const rules = el('button', 'textbtn ghost', 'How to play');
  rules.dataset.testid = 'btn-rules';
  rules.addEventListener('click', onRules);
  links.append(rules, el('span', '', 'Keys: <kbd>1</kbd>–<kbd>9</kbd> bid · <kbd>0</kbd> Nil · <kbd>H</kbd> hint · <kbd>C</kbd> coach · <kbd>M</kbd> mute'));
  right.appendChild(links);

  if (resume) {
    const r = el('div', 'resume');
    r.dataset.testid = 'resume';
    r.innerHTML = `<div><b>Game in progress</b> · hand ${resume.state.handNumber}, ${resume.state.scores[0]} to ${resume.state.scores[1]}</div>`;
    const btn = el('button', 'textbtn', 'Resume');
    btn.dataset.testid = 'btn-resume';
    btn.addEventListener('click', onResume);
    r.appendChild(btn);
    card.appendChild(r);
  }

  play.addEventListener('click', () => onPlay(settings));
  root.appendChild(lob);
  setTimeout(() => play.focus({ preventScroll: true }), 0);
  return { close: () => lob.remove() };
}

// ---------------------------------------------------------------- bid panel

/**
 * @param {HTMLElement} stage
 * @param {{suggest: number|null, canNil: boolean, canBlind: boolean, partnerText: string, onBid: (bid:number, blind:boolean)=>void, coachOn: boolean}} o
 */
export function showBidPanel(stage, o) {
  const p = el('div', 'bidpanel');
  p.dataset.testid = 'bidpanel';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Your bid');
  p.innerHTML = `<h2>Your bid</h2><div class="sub">How many tricks will you win this hand?${o.partnerText ? ` <b>${o.partnerText}</b>` : ''}</div>`;
  const grid = el('div', 'bidgrid');
  for (let n = 1; n <= 13; n++) {
    const b = el('button', 'bidbtn', String(n));
    b.type = 'button';
    b.dataset.testid = `bid-${n}`;
    if (o.coachOn && o.suggest === n) b.classList.add('suggest');
    b.addEventListener('click', () => o.onBid(n, false));
    grid.appendChild(b);
  }
  if (o.canNil) {
    const nil = el('button', 'bidbtn nil', 'NIL');
    nil.type = 'button';
    nil.dataset.testid = 'bid-nil';
    nil.title = 'Promise to win zero tricks: +100 if you do, −100 if you take one';
    if (o.coachOn && o.suggest === NIL) nil.classList.add('suggest');
    nil.addEventListener('click', () => o.onBid(NIL, false));
    grid.appendChild(nil);
  }
  p.appendChild(grid);
  const foot = el('div', 'foot', o.footer || (o.canNil ? 'Nil: +100 for zero tricks, −100 if you win any. Number keys also work (0 = Nil).' : 'Number keys also work.'));
  foot.dataset.testid = 'bid-foot';
  p.appendChild(foot);
  stage.appendChild(p);
  const onKey = (e) => {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (document.querySelector('.overlay')) return; // a dialog is open on top of the panel
    if (/^[0-9]$/.test(e.key)) {
      const n = Number(e.key);
      if (n === 0 && o.canNil) o.onBid(NIL, false);
      else if (n >= 1) {
        // Support 10-13 via a short two-key sequence: '1' then '0'..'3'.
        if (n === 1) {
          pending = setTimeout(() => o.onBid(1, false), 350);
          return;
        }
        if (pending) {
          clearTimeout(pending);
          pending = null;
          if (n <= 3) return o.onBid(10 + n, false);
        }
        o.onBid(n, false);
      }
    }
  };
  let pending = null;
  document.addEventListener('keydown', onKey);
  setTimeout(() => (grid.querySelector('.suggest') || grid.firstChild).focus({ preventScroll: true }), 0);
  return {
    close: () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(pending);
      pending = null;
      p.remove();
    },
  };
}

/** Blind-nil decision before the cards are revealed. */
export function showBlindNilPanel(stage, { deficit, onBlind, onLook }) {
  const p = el('div', 'bidpanel');
  p.dataset.testid = 'blindnil-panel';
  p.setAttribute('role', 'dialog');
  p.innerHTML = `<h2>Blind Nil?</h2><div class="sub">You're behind by <b>${deficit}</b>, so you may bid Nil <b>before</b> looking at your cards. Worth <b>+200</b> if you win no tricks, <b>−200</b> if you take even one.</div>`;
  const grid = el('div', 'bidgrid');
  grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
  const look = el('button', 'bidbtn look', 'Look at my cards');
  look.type = 'button';
  look.dataset.testid = 'blindnil-look';
  look.addEventListener('click', onLook);
  const blind = el('button', 'bidbtn blind', 'Bid Blind Nil');
  blind.type = 'button';
  blind.dataset.testid = 'blindnil-bid';
  blind.addEventListener('click', onBlind);
  grid.append(look, blind);
  p.appendChild(grid);
  stage.appendChild(p);
  setTimeout(() => look.focus({ preventScroll: true }), 0);
  return { close: () => p.remove() };
}

// ---------------------------------------------------------------- hand summary

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}
function cls(n) {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
}

/**
 * Hand summary with a count-up on the totals.
 * @returns {Promise<void>} resolves when the player continues
 */
export function showHandSummary(root, { summary, names, options, tricks, gameOver, instant }) {
  return new Promise((resolve) => {
    const { ov, d, close } = overlay(root, 'wide', 'hand-summary');
    const teams = summary.teams;
    const seatsOf = (t) => (t === 0 ? [0, 2] : [1, 3]);
    const bidText = (t) => seatsOf(t).map((s) => (summary.bids[s] === NIL ? `<span class="tag nil">${summary.blind[s] ? 'BLIND NIL' : 'NIL'}</span>` : `${summary.bids[s]}`)).join(' + ');
    const tookText = (t) => seatsOf(t).map((s) => `${summary.tricksWon[s]}`).join(' + ');
    const contract = (t) => {
      const r = teams[t];
      if (r.bid === 0) return `<span class="muted">no contract</span>`;
      return `${signed(r.made ? (options.tenForTwoHundred && r.bid >= 10 ? 200 : r.bid * 10) : r.contractPoints)} <span class="tag ${r.made ? 'made' : 'set'}">${r.made ? 'MADE' : 'SET'}</span>`;
    };
    const bagsText = (t) => {
      const r = teams[t];
      const meter = `<span class="bagmeter">${Array.from({ length: options.bagPenaltyAt || 0 }, (_, i) => `<i class="${i < r.bagsAfter ? 'on' : ''}"></i>`).join('')}</span>`;
      return `${r.bagsAdded ? `+${r.bagsAdded} (${signed(r.bagsAdded)} pt${r.bagsAdded === 1 ? '' : 's'})` : '0'}${options.bagPenaltyAt ? meter : ''}${r.bagPenalty ? ` <span class="tag set">${r.bagPenalty} BAGGED</span>` : ''}`;
    };
    const nilText = (t) => {
      const r = teams[t];
      if (!r.nils.length) return '<span class="muted">—</span>';
      return r.nils.map((n) => `${names[n.seat]}: ${signed(n.points)} <span class="tag ${n.made ? 'made' : 'set'}">${n.made ? 'NIL MADE' : 'NIL BUSTED'}</span>`).join('<br>');
    };
    const us = `${names[0]} & ${names[2]}`;
    const them = `${names[1]} & ${names[3]}`;
    d.innerHTML = `
      <h2>Hand ${summary.handNumber} ${gameOver ? '— final hand' : ''}</h2>
      <table>
        <thead><tr><th></th><th class="us">${escapeHtml(us)}</th><th class="them">${escapeHtml(them)}</th></tr></thead>
        <tbody>
          <tr><td>Bid</td><td>${bidText(0)} = <b>${teams[0].bid}</b></td><td>${bidText(1)} = <b>${teams[1].bid}</b></td></tr>
          <tr><td>Tricks won</td><td>${tookText(0)} = <b>${teams[0].tricksTotal}</b></td><td>${tookText(1)} = <b>${teams[1].tricksTotal}</b></td></tr>
          <tr><td>Contract</td><td class="${cls(teams[0].contractPoints)}">${contract(0)}</td><td class="${cls(teams[1].contractPoints)}">${contract(1)}</td></tr>
          <tr><td>Bags</td><td>${bagsText(0)}</td><td>${bagsText(1)}</td></tr>
          <tr><td>Nil</td><td class="${cls(teams[0].nilPoints)}">${nilText(0)}</td><td class="${cls(teams[1].nilPoints)}">${nilText(1)}</td></tr>
          <tr class="total"><td>This hand</td><td class="${cls(teams[0].total)}" data-testid="hand-total-0">${signed(teams[0].total)}</td><td class="${cls(teams[1].total)}" data-testid="hand-total-1">${signed(teams[1].total)}</td></tr>
          <tr class="total"><td>Score</td><td data-testid="score-after-0">${summary.scoresBefore[0]}</td><td data-testid="score-after-1">${summary.scoresBefore[1]}</td></tr>
        </tbody>
      </table>`;
    const explain = el('p', 'muted');
    explain.style.fontSize = '13px';
    explain.innerHTML = 'Made bid: 10 points per trick bid, +1 per extra trick (a <b>bag</b>). Missed bid: −10 per trick bid. Nil: ±100 (blind ±200). Ten bags: −100.';
    d.appendChild(explain);

    if (tricks && tricks.length) {
      const det = el('details');
      det.innerHTML = '<summary style="cursor:pointer;color:var(--muted);padding:6px 0">Review the 13 tricks</summary>';
      const grid = el('div', 'trick-review');
      tricks.forEach((t, i) => {
        const row = el('div');
        row.innerHTML = `<span class="n">${i + 1}.</span>` + t.plays.map((p) => `<span class="c ${suitOf(p.card) === HEARTS || suitOf(p.card) === DIAMONDS ? 'red' : ''}" title="${escapeHtml(names[p.seat])}">${cardToPretty(p.card)}</span>`).join('') + `<span class="w">${escapeHtml(names[t.winner])}</span>`;
        grid.appendChild(row);
      });
      det.appendChild(grid);
      d.appendChild(det);
    }

    const actions = el('div', 'actions');
    const btn = el('button', 'textbtn primary', gameOver ? 'See final result' : 'Next hand');
    btn.dataset.testid = 'btn-continue';
    actions.appendChild(btn);
    d.appendChild(actions);

    // Count up the scores
    const cells = [d.querySelector('[data-testid=score-after-0]'), d.querySelector('[data-testid=score-after-1]')];
    const from = summary.scoresBefore;
    const to = summary.scoresAfter;
    const dur = instant ? 0 : 900;
    const t0 = performance.now();
    const tick = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const ease = 1 - Math.pow(1 - k, 3);
      for (let t = 0; t < 2; t++) cells[t].textContent = String(Math.round(from[t] + (to[t] - from[t]) * ease));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const done = () => {
      close();
      resolve();
    };
    btn.addEventListener('click', done);
    trapEnter(ov, done);
    setTimeout(() => btn.focus({ preventScroll: true }), 0);
  });
}

// ---------------------------------------------------------------- game over

/**
 * @returns {Promise<'again'|'lobby'>}
 */
export function showGameOver(root, { state, names, stats }) {
  return new Promise((resolve) => {
    const { d, close } = overlay(root, '', 'game-over');
    const won = state.winner === 0;
    const winners = state.winner === 0 ? `${names[0]} & ${names[2]}` : `${names[1]} & ${names[3]}`;
    const trophy = won
      ? '<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true"><path d="M20 8h24v6h8v6c0 7-5 12-11 13-2 4-5 6-9 7v6h8v6H24v-6h8v-6c-4-1-7-3-9-7C17 32 12 27 12 20v-6h8V8zm-2 12v0c0 4 2 7 5 9V20h-5zm28 0h-5v9c3-2 5-5 5-9z" fill="#ffd166"/></svg>'
      : '<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true"><rect x="14" y="8" width="36" height="48" rx="5" fill="#fbf8f0" stroke="#d6d0c2"/><path d="M32 18c-7 9-14 13-14 19 0 4 3 7 7 7 3 0 5-1 6-3-1 4-2 6-5 8h12c-3-2-4-4-5-8 1 2 3 3 6 3 4 0 7-3 7-7 0-6-7-10-14-19z" fill="#1b1b1f"/></svg>';
    d.innerHTML = `
      <div class="trophy">${trophy}</div>
      <h1 style="text-align:center">${won ? 'You win!' : `${escapeHtml(winners)} win`}</h1>
      <p style="text-align:center" class="muted">Final score <b style="color:var(--us)">${state.scores[0]}</b> to <b style="color:var(--them)">${state.scores[1]}</b> after ${state.handNumber} hand${state.handNumber === 1 ? '' : 's'}. <span title="Add ?seed=${state.seed} to the address to replay this deal">Deal #${state.seed}</span></p>
      <div class="statgrid">
        <div class="stat"><b>${stats.contractsMade}/${stats.contracts}</b><small>your team's bids made</small></div>
        <div class="stat"><b>${stats.nilsMade}/${stats.nils}</b><small>nils made (your team)</small></div>
        <div class="stat"><b>${stats.bags}</b><small>bags collected</small></div>
        <div class="stat"><b>${stats.sets}</b><small>times you set them</small></div>
        <div class="stat"><b>${stats.tricks}</b><small>tricks you won</small></div>
        <div class="stat"><b>${stats.bestHand > 0 ? '+' : ''}${stats.bestHand}</b><small>best hand</small></div>
      </div>`;
    const actions = el('div', 'actions center');
    const again = el('button', 'textbtn primary', 'Play again');
    again.dataset.testid = 'btn-again';
    const lobby = el('button', 'textbtn', 'Change table');
    lobby.dataset.testid = 'btn-lobby';
    actions.append(again, lobby);
    d.appendChild(actions);
    again.addEventListener('click', () => {
      close();
      resolve('again');
    });
    lobby.addEventListener('click', () => {
      close();
      resolve('lobby');
    });
    setTimeout(() => again.focus({ preventScroll: true }), 0);
  });
}

// ---------------------------------------------------------------- settings (in game)

export function showSettings(root, { settings, onChange, onQuit }) {
  return new Promise((resolve) => {
    const { ov, d, close } = overlay(root, '', 'settings');
    d.innerHTML = '<h2>Settings</h2>';
    d.appendChild(field('Coach tips', 'Short prompts explaining what to do next', switchEl(settings.coach, (v) => onChange('coach', v), 'settings-coach')));
    d.appendChild(field('Table talk', 'Speech bubbles from the other players', switchEl(settings.tableTalk, (v) => onChange('tableTalk', v), 'settings-talk')));
    d.appendChild(field('Sound', '', switchEl(settings.sound, (v) => onChange('sound', v), 'settings-sound')));
    d.appendChild(field('Speed', '', seg([['normal', 'Relaxed'], ['fast', 'Fast'], ['instant', 'Instant']], settings.speed, (v) => onChange('speed', v), 'settings-speed')));
    const actions = el('div', 'actions');
    const quit = el('button', 'textbtn ghost', 'Quit to lobby');
    quit.dataset.testid = 'btn-quit';
    quit.style.marginRight = 'auto';
    const done = el('button', 'textbtn primary', 'Done');
    done.dataset.testid = 'btn-settings-done';
    actions.append(quit, done);
    d.appendChild(actions);
    done.addEventListener('click', () => {
      close();
      resolve('done');
    });
    quit.addEventListener('click', () => {
      close();
      onQuit();
      resolve('quit');
    });
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        resolve('done');
      }
    });
    setTimeout(() => done.focus({ preventScroll: true }), 0);
  });
}

// ---------------------------------------------------------------- rules

export function showRules(root) {
  return new Promise((resolve) => {
    const { ov, d, close } = overlay(root, 'rules', 'rules');
    d.innerHTML = `
      <h2>How to play Spades</h2>
      <ol>
        <li><b>Teams.</b> You and your partner (across the table) play against the other two. Each player gets 13 cards.</li>
        <li><b>Bidding.</b> Everyone says how many tricks they expect to win. Your team's bid is your bid plus your partner's. <b>Nil</b> means you promise to win zero tricks.</li>
        <li><b>Tricks.</b> The player left of the dealer leads. Going clockwise, everyone plays one card and must <b>follow suit</b> if they can. The highest card of the suit led wins — unless someone plays a <b>spade</b>. Spades are trump and beat everything.</li>
        <li><b>Breaking spades.</b> You can't <em>lead</em> a spade until someone has played one on another suit (or you have nothing but spades).</li>
        <li><b>Scoring.</b> Make your team's bid: <b>10 points per trick bid</b>, plus 1 per extra trick. Miss it: <b>−10 per trick bid</b>. A made Nil is <b>+100</b>, a busted Nil is <b>−100</b> (blind: ±200).</li>
        <li><b>Bags.</b> Extra tricks beyond your bid are bags. Collect ten and you lose <b>100 points</b> — so once your bid is safe, avoid winning more.</li>
        <li><b>Winning.</b> First team to the target score (500 by default) wins.</li>
      </ol>
      <h3>Tips</h3>
      <ul>
        <li>Aces and high spades are near-certain tricks; a king is usually good if you hold another card of that suit.</li>
        <li>If your partner is already winning the trick, play low and save your high cards.</li>
        <li>When you're out of the suit led, you may trump with a spade — your lowest winning spade is enough.</li>
        <li>Cover a partner's Nil by winning tricks with high cards; attack an opponent's Nil by leading low.</li>
      </ul>
      <h3>Shortcuts</h3>
      <p class="muted">Number keys bid (0 = Nil; press 1 then 0–3 for 10–13). Click or focus + Enter plays a card. <kbd>H</kbd> hint, <kbd>C</kbd> coach on/off, <kbd>M</kbd> mute, <kbd>?</kbd> this help, <kbd>Esc</kbd> closes dialogs.</p>`;
    const actions = el('div', 'actions');
    const ok = el('button', 'textbtn primary', 'Got it');
    ok.dataset.testid = 'btn-rules-close';
    actions.appendChild(ok);
    d.appendChild(actions);
    const done = () => {
      close();
      resolve();
    };
    ok.addEventListener('click', done);
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') done();
    });
    setTimeout(() => ok.focus({ preventScroll: true }), 0);
  });
}

// ---------------------------------------------------------------- score history

export function showScoreHistory(root, { history, names, scores }) {
  return new Promise((resolve) => {
    const { ov, d, close } = overlay(root, '', 'score-history');
    const us = `${names[0]} & ${names[2]}`;
    const them = `${names[1]} & ${names[3]}`;
    const rows = history
      .map(
        (h) => `<tr><td>Hand ${h.handNumber}</td><td>${h.teams[0].bid || (h.teams[0].nils.length ? 'nil' : 0)} / ${h.teams[0].tricksTotal}</td><td class="${cls(h.teams[0].total)}">${signed(h.teams[0].total)}</td><td><b>${h.scoresAfter[0]}</b></td><td>${h.teams[1].bid || (h.teams[1].nils.length ? 'nil' : 0)} / ${h.teams[1].tricksTotal}</td><td class="${cls(h.teams[1].total)}">${signed(h.teams[1].total)}</td><td><b>${h.scoresAfter[1]}</b></td></tr>`
      )
      .join('');
    d.innerHTML = `<h2>Score history</h2>
      <table><thead><tr><th></th><th class="us" colspan="3">${escapeHtml(us)}</th><th class="them" colspan="3">${escapeHtml(them)}</th></tr>
      <tr><th></th><th>bid/won</th><th>hand</th><th>total</th><th>bid/won</th><th>hand</th><th>total</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No hands completed yet.</td></tr>'}</tbody></table>
      <p class="muted" style="text-align:right">Current: <b style="color:var(--us)">${scores[0]}</b> — <b style="color:var(--them)">${scores[1]}</b></p>`;
    const actions = el('div', 'actions');
    const ok = el('button', 'textbtn primary', 'Close');
    ok.dataset.testid = 'btn-history-close';
    actions.appendChild(ok);
    d.appendChild(actions);
    const done = () => {
      close();
      resolve();
    };
    ok.addEventListener('click', done);
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') done();
    });
    setTimeout(() => ok.focus({ preventScroll: true }), 0);
  });
}

export function confirmDialog(root, { title, text, ok = 'OK', cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const { ov, d, close } = overlay(root, '', 'confirm');
    d.innerHTML = `<h2>${title}</h2><p>${text}</p>`;
    const actions = el('div', 'actions');
    const c = el('button', 'textbtn', cancel);
    const o = el('button', 'textbtn primary', ok);
    o.dataset.testid = 'btn-confirm-ok';
    c.dataset.testid = 'btn-confirm-cancel';
    actions.append(c, o);
    d.appendChild(actions);
    c.addEventListener('click', () => {
      close();
      resolve(false);
    });
    o.addEventListener('click', () => {
      close();
      resolve(true);
    });
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        resolve(false);
      }
    });
    setTimeout(() => o.focus({ preventScroll: true }), 0);
  });
}

export { ROSTER_BY_ID };

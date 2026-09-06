// Game controller: runs one game as an async loop over the engine, asking bots
// or the human for decisions, sequencing animations, feeding the coach and the
// table talk, and persisting progress so a refresh resumes the game.

import {
  newGame, startHand, placeBid, playCard, legalPlays, playError, canBidBlindNil, currentWinner, PHASE, viewFor,
  cardToPretty, cardToString, parseCard, suitOf, isSpade, SPADES, SUIT_NAMES, randomSeed, Rng, NIL, teamOf, partnerOf,
} from '../engine/index.js';
import { createBot, solidPlay } from '../ai/index.js';
import { Table } from '../ui/table.js';
import { showLobby, showBidPanel, showBlindNilPanel, showHandSummary, showGameOver, showSettings, showRules, showScoreHistory, confirmDialog } from '../ui/dialogs.js';
import { coachPrompt, suggestBid, explainHint, tipLimit, bidWarning, summaryCoachLine, ONCE_PER_HAND, minDisplayMs } from './coach.js';
import { lineupBySeat } from './roster.js';
import { saveSettings, saveGame, loadGame, clearGame } from './settings.js';

class Abort extends Error {}

const SUIT_SYM = ['♣', '♦', '♥', '♠'];

export class GameController {
  constructor({ root, settings, run, sound }) {
    this.root = root;
    this.settings = settings;
    this.run = run;
    this.sound = sound;
    this.token = 0;
    this.state = null;
    this.bots = [null, null, null, null];
    this.chars = [null, null, null, null];
    this.pending = null; // {kind:'play'|'bid', resolve}
    this.blindIntent = [false, false, false, false];
    this.quipRng = new Rng(7);
    this.lastQuipAt = [0, 0, 0, 0];
    this.firstFollowShown = false;
    this.lobby = null;
    this.table = new Table(root, { onCardClick: (card) => this._onCardClick(card) });
    this._wireToolbar();
    this._wireKeys();
    this._applySettingsToUi();
    this._exposeDebugApi();
  }

  // ------------------------------------------------------------ lifecycle
  start() {
    const saved = loadGame();
    if (this.run.autostart) {
      this._newGame();
      return;
    }
    this._showLobby(saved);
  }

  _showLobby(saved = loadGame()) {
    this.table.setPhase('lobby');
    this.table.setTurn(null);
    this.table.setStatus('');
    this.lobby?.close();
    this.lobby = showLobby(this.table.stage, {
      settings: this.settings,
      resume: saved,
      onPlay: () => {
        saveSettings(this.settings);
        this._applySettingsToUi();
        clearGame();
        this.lobby.close();
        this.lobby = null;
        this._newGame();
      },
      onResume: () => {
        this.lobby.close();
        this.lobby = null;
        this._resume(saved);
      },
      onRules: () => showRules(this.table.stage),
    });
  }

  _newGame() {
    const seed = this.run.seed ?? randomSeed();
    this.run.seed = null; // only the first game uses a URL seed
    // A first-time player deals hand 1 (so they watch three bids first); afterwards the dealer is random.
    const firstEver = !this.settings.gamesPlayed;
    this.settings.gamesPlayed = (this.settings.gamesPlayed || 0) + 1;
    saveSettings(this.settings);
    this.skipBlindNil = false;
    this.state = newGame({ seed, options: { ...this.settings.options }, firstDealer: firstEver ? 0 : null });
    this._setupPlayers(seed);
    this.table.setPhase('dealing');
    this.table.renderScoreboard(this.state);
    this.table.renderSeats(this.state);
    this.table.clearHand();
    this.table.clearTrick();
    this._greet();
    this._runGame(false);
  }

  _resume(saved) {
    this.state = saved.state;
    this.settings.lineup = saved.lineup;
    this.settings.playerName = saved.playerName || this.settings.playerName;
    this.blindIntent = Array.isArray(saved.blindIntent) ? saved.blindIntent : [false, false, false, false];
    this._setupPlayers(saved.state.seed + saved.state.handNumber);
    this.table.renderScoreboard(this.state);
    this.table.renderSeats(this.state);
    this.table.renderFans(this.state);
    this.table.renderHand(this.state, { legal: null });
    this.table.renderTrick(this.state);
    this.table.renderTracker(this.state, this.settings.coach && this.state.phase === PHASE.PLAYING);
    this._runGame(true);
  }

  _setupPlayers(seed) {
    this.chars = lineupBySeat(this.settings.lineup);
    // Fixed rollout counts keep a seeded game reproducible; the time budget is only a safety net.
    this.bots = this.chars.map((c, s) => (c ? createBot(c.tier, { seed: seed * 31 + s * 7 + 1, rollouts: 48, bidSamples: 36, timeBudgetMs: 1500, bidBias: c.bidBias || 0 }) : null));
    if (this.run.autoplay) this.autoBot = createBot('solid', { seed: seed + 99 });
    this.quipRng = new Rng(seed ^ 0x5bd1e995);
    this.table.setLineup(this.chars, this.settings.playerName);
    this.names = this.table.names;
  }

  _abortGame() {
    this.token++;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject && p.reject(new Abort());
    }
    this.bidPanel?.close();
    this.bidPanel = null;
    this._hideCoach();
    this.table.hideBubbles();
    this.table.setHint(null);
    this.table.setTurn(null);
    this.table.setAnimating(false);
  }

  _check(token) {
    if (token !== this.token) throw new Abort();
  }

  // ------------------------------------------------------------ the loop
  async _runGame(resuming) {
    const token = ++this.token;
    const state = this.state;
    try {
      this.table.setPhase(state.phase);
      if (resuming && state.phase === PHASE.HAND_OVER) await this._handOverPhase(token);
      while (true) {
        this._check(token);
        if (state.phase === PHASE.IDLE || state.phase === PHASE.HAND_OVER) {
          startHand(state);
          await this._dealPhase(token);
        } else if (resuming) {
          resuming = false;
          this.table.setPhase(state.phase);
          this.table.renderScoreboard(state);
          if (state.phase === PHASE.BIDDING) this.table.renderHand(state, { legal: null });
        }
        if (state.phase === PHASE.BIDDING) await this._biddingPhase(token);
        if (state.phase === PHASE.PLAYING) await this._playPhase(token);
        await this._handOverPhase(token);
        if (state.phase === PHASE.GAME_OVER) {
          await this._gameOverPhase(token);
          return;
        }
      }
    } catch (err) {
      if (err instanceof Abort) return;
      console.error(err);
      this.table.toast(`Something went wrong: ${err.message}`, 4000);
    }
  }

  async _dealPhase(token) {
    const state = this.state;
    this.table.setPhase('dealing');
    this.table.setTurn(null);
    this._hideCoach();
    this.table.setHint(null);
    this.table.hideLastTrick();
    this.table.lastTrickBtn.hidden = true;
    this.table.trackerEl.hidden = true;
    this.table.renderScoreboard(state);
    this.table.renderSeats(state);
    this.table.setStatus(`Hand ${state.handNumber} — <span class="hl">${this._name(state.dealer)}</span> deals`);
    this.sound.play('deal');
    this.firstFollowShown = false;
    this.shownThisHand = new Set();
    this.pendingBroken = null;
    this.pendingWon = null;

    // Blind-nil intentions are formed before anyone looks at their cards.
    this.blindIntent = [false, false, false, false];
    for (let s = 1; s < 4; s++) if (canBidBlindNil(state, s)) this.blindIntent[s] = !!this.bots[s].chooseBlindNil(viewFor(state, s));
    const humanBlind = canBidBlindNil(state, 0) && !this.run.autoplay && !this.skipBlindNil;

    await this.table.animateDeal(state, { faceDown: humanBlind });
    this._check(token);
    this.table.setAnimating(false);

    if (state.handNumber === 1) this._coach('welcome');
    if (humanBlind) {
      const team = 0;
      const deficit = state.scores[1] - state.scores[team];
      this._coach('blindnil');
      const choice = await this._await('blind', (resolve) => {
        this.bidPanel = showBlindNilPanel(this.table.stage, {
          deficit,
          onBlind: () => resolve(true),
          onLook: () => resolve(false),
          onSkip: () => {
            this.skipBlindNil = true;
            resolve(false);
          },
        });
      });
      this._check(token);
      this.bidPanel?.close();
      this.bidPanel = null;
      this.blindIntent[0] = choice;
      this._hideCoach();
      if (!choice) this.table.renderHand(state, { legal: null, faceDown: false });
    }
    this.table.setPhase(PHASE.BIDDING);
    this._save();
  }

  async _biddingPhase(token) {
    const state = this.state;
    while (state.phase === PHASE.BIDDING) {
      this._check(token);
      const seat = state.turn;
      this.table.setTurn(seat);
      this.table.renderSeats(state);
      if (seat === 0) {
        if (this.blindIntent[0] && canBidBlindNil(state, 0)) {
          placeBid(state, 0, NIL, { blind: true });
          this.table.renderHand(state, { legal: null, faceDown: false });
          this.table.showBubble(0, 'Blind Nil!', 1600);
        } else {
          await this._humanBid(token);
        }
      } else {
        await this._botBid(seat, token);
      }
      this.table.renderSeats(state);
      this.table.renderScoreboard(state);
      this.sound.play('bid');
    }
    this._hideCoach();
    this._save();
  }

  async _humanBid(token) {
    const state = this.state;
    const view = viewFor(state, 0);
    this.table.setStatus(`<span class="hl">Your bid</span> — how many tricks will you win?`);
    if (this.run.autoplay) {
      await this._delay(token, 150);
      placeBid(state, 0, this.autoBot.chooseBid(view));
      return;
    }
    view.names = this.names;
    const prompt = this._coach('bid');
    const s = suggestBid(view.hand, state.options, view);
    const partnerBid = state.bids[2];
    const partnerText = partnerBid === null ? '' : partnerBid === NIL ? `${this._name(2)} bid Nil.` : `${this._name(2)} bid ${partnerBid}.`;
    const bid = await this._await('bid', (resolve) => {
      this.bidPanel = showBidPanel(this.table.stage, {
        suggest: this.settings.coach ? (s.nil ? NIL : s.bid) : null,
        canNil: state.options.allowNil,
        partnerText,
        coachOn: this.settings.coach,
        check: (n) => (this.settings.coach ? bidWarning(n, view.hand, state.options, view) : null),
        onBid: (n) => resolve(n),
      });
    });
    this._check(token);
    this.bidPanel?.close();
    this.bidPanel = null;
    placeBid(state, 0, bid);
    this._hideCoach();
    if (prompt) this._retire(prompt.id, false);
    this.table.showBubble(0, bid === NIL ? 'Nil!' : `I'll take <span class="bidnum">${bid}</span>.`, 1400);
  }

  async _botBid(seat, token) {
    const state = this.state;
    const char = this.chars[seat];
    this.table.setStatus(`<span class="hl">${char.name}</span> is bidding…`);
    await this._delay(token, this._thinkTime(seat) * 0.8);
    this._check(token);
    let bid;
    if (this.blindIntent[seat] && canBidBlindNil(state, seat)) {
      placeBid(state, seat, NIL, { blind: true });
      bid = NIL;
      this.table.showBubble(seat, 'Blind Nil!', 1800);
    } else {
      try {
        bid = this.bots[seat].chooseBid(viewFor(state, seat));
      } catch (err) {
        console.error(err);
        bid = 2;
      }
      placeBid(state, seat, bid);
      const line = this._quipText(seat, bid === NIL ? 'nil' : 'bid', { n: bid });
      this.table.showBubble(seat, line || (bid === NIL ? 'Nil.' : `<span class="bidnum">${bid}</span>`), 1700);
    }
  }

  async _playPhase(token) {
    const state = this.state;
    this.table.setPhase(PHASE.PLAYING);
    this.table.renderSeats(state);
    this.table.renderScoreboard(state);
    this.table.renderTracker(state, this.settings.coach);
    this.table.lastTrickBtn.hidden = state.tricks.length === 0;
    while (state.phase === PHASE.PLAYING) {
      this._check(token);
      const seat = state.turn;
      this.table.setTurn(seat);
      if (seat === 0) await this._humanPlay(token);
      else await this._botPlay(seat, token);
    }
  }

  async _humanPlay(token) {
    const state = this.state;
    const legal = legalPlays(state, 0);
    const legalSet = new Set(legal);
    this.table.renderHand(state, { legal: legalSet });
    this.table.markWinning(currentWinner(state));
    const led = state.trick.length ? suitOf(state.trick[0].card) : null;
    if (legal.length === 1 && state.hands[0].length > 1) {
      this.table.setStatus(`<span class="hl">Your turn</span> — ${Table.pretty(legal[0])} is your only legal card`);
    } else if (led === null) {
      this.table.setStatus(`<span class="hl">Your turn</span> — lead ${state.spadesBroken || legal.every(isSpade) ? 'any card' : 'any card but a spade'}`);
    } else {
      const must = state.hands[0].some((c) => suitOf(c) === led);
      this.table.setStatus(`<span class="hl">Your turn</span> — ${must ? `follow with ${SUIT_NAMES[led]} ${SUIT_SYM[led]}` : `no ${SUIT_NAMES[led]}: play anything`}`);
    }
    this.sound.play('turn');
    const view = viewFor(state, 0);
    view.names = this.names;
    if (!this.run.autoplay) {
      const extra = { wonWith: led === null ? this.pendingWon : null, justBroken: this.pendingBroken };
      this.pendingWon = null;
      this.pendingBroken = null;
      this._coach('turn', extra, { legal, firstFollow: led !== null && !this.firstFollowShown });
      if (led !== null) this.firstFollowShown = true;
      // Nudge an idle newcomer toward the Hint button.
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.settings.coach && this.pending?.kind === 'play') this.table.buttons.hint.classList.add('nudge');
      }, 9000);
    }
    let card;
    if (this.run.autoplay) {
      await this._delay(token, 120);
      card = this.autoBot.choosePlay(view);
    } else {
      card = await this._await('play', () => {});
    }
    clearTimeout(this.idleTimer);
    this.table.buttons.hint.classList.remove('nudge');
    this._check(token);
    this._hideCoach();
    this.table.setHint(null);
    await this._commitPlay(0, card, token);
  }

  async _botPlay(seat, token) {
    const state = this.state;
    const char = this.chars[seat];
    this.table.renderHand(state, { legal: null });
    this.table.markWinning(currentWinner(state));
    this.table.setStatus(`<span class="hl">${char.name}</span> is thinking…`);
    const think = this._thinkTime(seat);
    const t0 = performance.now();
    let card;
    try {
      card = this.bots[seat].choosePlay(viewFor(state, seat));
    } catch (err) {
      console.error(err);
      card = legalPlays(state, seat)[0];
    }
    if (!legalPlays(state, seat).includes(card)) card = legalPlays(state, seat)[0];
    const remaining = Math.max(0, think - (performance.now() - t0));
    await this._delay(token, remaining);
    this._check(token);
    await this._commitPlay(seat, card, token);
  }

  async _commitPlay(seat, card, token) {
    const state = this.state;
    const wasWinning = currentWinner(state);
    const ledSuit = state.trick.length ? suitOf(state.trick[0].card) : null;
    const events = playCard(state, seat, card);
    this.table.setAnimating(true);
    this.sound.play('card');
    await this.table.animatePlay(seat, card);
    this._check(token);
    if (seat !== 0) this.table.renderFans(state);
    else this.table.renderHand(state, { legal: null }); // close the gap left by the played card
    // Table talk: a bot trumping its own partner's winning card.
    if (seat !== 0 && ledSuit !== null && ledSuit !== SPADES && isSpade(card) && wasWinning === partnerOf(seat)) this._quip(seat, 'trumpedPartner');

    for (const ev of events) {
      if (ev.type === 'spadesBroken') {
        this.table.toast(`Spades are broken — ${ev.seat === 0 ? 'you' : this._name(ev.seat)} played ${cardToPretty(ev.card)}`, 1800);
        // The coach mentions it at the start of the human's next turn, where it can be read.
        if (ev.seat !== 0) this.pendingBroken = { seat: ev.seat, card: ev.card };
      }
    }
    const won = events.find((e) => e.type === 'trickWon');
    if (!won) {
      this.table.markWinning(currentWinner(state));
      this.table.setAnimating(false);
      return;
    }
    // Trick complete: hold, glow, sweep.
    this.table.setTurn(null);
    this.table.markWinning(won.winner);
    const winnerName = won.winner === 0 ? 'You' : this._name(won.winner);
    this.table.setStatus(`<span class="hl">${winnerName}</span> ${won.winner === 0 ? 'win' : 'wins'} the trick with ${Table.pretty(won.plays.find((p) => p.seat === won.winner).card)}`);
    this.sound.play(teamOf(won.winner) === 0 ? 'trick-us' : 'trick-them');
    await this._delaySkippable(token, this.table._dur('--dur-hold'));
    this._check(token);
    await this.table.animateTrickSweep(won.winner);
    this._check(token);
    this.table.renderSeats(state);
    this.table.renderScoreboard(state);
    this.table.renderTracker(state, this.settings.coach);
    this.table.lastTrickBtn.hidden = state.phase !== PHASE.PLAYING;
    this.table.floater(won.winner, '+1');
    this._afterTrickTalk(won);
    // "You won, so you lead" is folded into the next lead prompt rather than flashed here.
    this.pendingWon = won.winner === 0 ? won.plays.find((p) => p.seat === 0).card : null;
    this.table.setAnimating(false);
    this._save();
  }

  _afterTrickTalk(won) {
    const state = this.state;
    const w = won.winner;
    // A nil bidder just took a trick.
    if (state.bids[w] === NIL && state.tricksWon[w] === 1) {
      this.table.stamp('Nil busted', 'bad');
      this.sound.play('nil-busted');
      if (w !== 0) this._quip(w, 'nilBusted', {}, true);
      return;
    }
    if (w !== 0 && this.quipRng.chance(0.3)) this._quip(w, 'won');
    // Somebody bagged (team already made its bid).
    const team = teamOf(w);
    const seats = team === 0 ? [0, 2] : [1, 3];
    const bid = seats.reduce((a, s) => a + (state.bids[s] === NIL ? 0 : state.bids[s]), 0);
    const tricks = seats.reduce((a, s) => a + state.tricksWon[s], 0);
    if (bid > 0 && tricks > bid) {
      const opp = team === 0 ? [1, 3] : [];
      if (opp.length && this.quipRng.chance(0.35)) this._quip(this.quipRng.pick(opp), 'bagged');
      else if (team === 0 && w === 0 && this.quipRng.chance(0.4)) this._quip(2, 'partnerBagged');
    }
  }

  async _handOverPhase(token) {
    const state = this.state;
    const summary = state.lastHand;
    if (!summary) return;
    this.table.setPhase(state.phase === PHASE.GAME_OVER ? PHASE.GAME_OVER : PHASE.HAND_OVER);
    this.table.setTurn(null);
    this._hideCoach();
    this.table.hideLastTrick();
    this.table.lastTrickBtn.hidden = true;
    this.table.trackerEl.hidden = true;
    this.table.renderHand(state, { legal: null });
    this.table.renderSeats(state);
    this.table.setStatus(`Hand ${summary.handNumber} complete`);
    this._save();

    // Stamps and talk, in order of drama.
    const t0 = summary.teams[0];
    const t1 = summary.teams[1];
    const instant = this.settings.speed === 'instant';
    const beat = async (ms) => {
      if (!instant) await this._delay(token, ms);
    };
    if (t1.bid > 0 && !t1.made) {
      this.table.stamp('Set!', 'good');
      this.sound.play('set');
      this._quip(2, 'oppSet');
      await beat(900);
    }
    if (t0.bid > 0 && !t0.made) {
      this.table.stamp('Set', 'bad');
      this.sound.play('set');
      this._quip(2, 'set');
      await beat(900);
    } else if (t0.bid > 0 && t0.made) {
      const clean = t0.bagsAdded === 0 && this.chars[2].quips.madeBidClean;
      if (this.quipRng.chance(0.5)) this._quip(2, clean ? 'madeBidClean' : 'madeBid');
    }
    if (t1.bid > 0 && t1.made) {
      const seat = this.quipRng.pick([1, 3]);
      if (this.quipRng.chance(0.4)) this._quip(seat, 'madeBid');
    }
    for (const team of [t0, t1]) {
      for (const n of team.nils) {
        if (n.made) {
          this.table.stamp('Nil made', 'gold');
          this.sound.play('nil-made');
          if (n.seat !== 0) this._quip(n.seat, 'nilMade', {}, true);
          await beat(900);
        }
      }
      if (team.bagPenalty) {
        this.table.stamp(`Bagged ${team.bagPenalty}`, 'bad');
        this.sound.play('bags');
        await beat(900);
      }
    }
    await beat(300);
    this._check(token);
    this.table.renderScoreboard(state);
    await showHandSummary(this.table.stage, {
      summary,
      names: this.names,
      options: state.options,
      tricks: state.tricks,
      gameOver: state.phase === PHASE.GAME_OVER,
      instant,
      coachLine: this.settings.coach && !this.run.autoplay ? summaryCoachLine(summary, this.names) : null,
    });
    this._check(token);
    this.table.renderScoreboard(state);
  }

  async _gameOverPhase(token) {
    const state = this.state;
    clearGame();
    this.table.setPhase(PHASE.GAME_OVER);
    const won = state.winner === 0;
    if (!this.run.autoplay) {
      const rec = this.settings.record || { won: 0, lost: 0, nilsMade: 0 };
      rec[won ? 'won' : 'lost'] += 1;
      rec.nilsMade += state.history.reduce((n, h) => n + h.teams[0].nils.filter((x) => x.seat === 0 && x.made).length, 0);
      this.settings.record = rec;
      saveSettings(this.settings);
    }
    this.table.setStatus(won ? `<span class="hl">You win!</span> ${state.scores[0]} to ${state.scores[1]}` : `<span class="hl">${this._name(1)} & ${this._name(3)}</span> win ${state.scores[1]} to ${state.scores[0]}`);
    this.sound.play(won ? 'win' : 'lose');
    if (won) this.table.confetti();
    for (let s = 1; s < 4; s++) this._quip(s, teamOf(s) === state.winner ? 'win' : 'lose', {}, true);
    const stats = this._stats();
    const choice = await showGameOver(this.table.stage, { state, names: this.names, stats });
    this._check(token);
    if (choice === 'again') this._newGame();
    else this._showLobby(null);
  }

  _stats() {
    const h = this.state.history;
    const team0 = h.map((x) => x.teams[0]);
    const contracts = team0.filter((t) => t.bid > 0);
    const nils = team0.flatMap((t) => t.nils);
    return {
      contracts: contracts.length,
      contractsMade: contracts.filter((t) => t.made).length,
      nils: nils.length,
      nilsMade: nils.filter((n) => n.made).length,
      bags: team0.reduce((a, t) => a + t.bagsAdded, 0),
      sets: h.filter((x) => x.teams[1].bid > 0 && !x.teams[1].made).length,
      tricks: h.reduce((a, x) => a + x.tricksWon[0], 0),
      bestHand: Math.max(0, ...team0.map((t) => t.total)),
    };
  }

  // ------------------------------------------------------------ human input
  _await(kind, setup) {
    return new Promise((resolve, reject) => {
      this.pending = { kind, resolve, reject };
      setup((value) => {
        if (this.pending && this.pending.kind === kind) {
          this.pending = null;
          resolve(value);
        }
      });
    });
  }

  _onCardClick(card) {
    const state = this.state;
    if (!state || state.phase !== PHASE.PLAYING || state.turn !== 0 || !this.pending || this.pending.kind !== 'play') return;
    const err = playError(state, 0, card);
    if (err) {
      this.table.shakeCard(card);
      this.sound.play('error');
      const led = state.trick.length ? suitOf(state.trick[0].card) : null;
      const msg = err === 'spadesNotBroken' ? 'Spades aren’t broken yet — lead another suit' : err === 'mustFollowSuit' ? `You must follow suit: ${SUIT_NAMES[led]} ${SUIT_SYM[led]} were led` : err;
      this.table.toast(msg, 1800);
      this._coach('illegal', { reason: err, card });
      return;
    }
    const p = this.pending;
    this.pending = null;
    p.resolve(card);
  }

  // ------------------------------------------------------------ coach & talk
  /**
   * Show the coach prompt for a moment, if there is one and it has not been
   * used up. Informational prompts keep a minimum on-screen time, so a new
   * prompt waits its turn instead of overwriting one that is still being read.
   */
  _coach(moment, extra = null, more = {}) {
    if (!this.settings.coach || !this.state) return null;
    const view = viewFor(this.state, 0);
    view.names = this.names;
    let prompt;
    try {
      prompt = coachPrompt({ moment, view, names: this.names, extra, legal: more.legal || legalPlays(this.state, 0), firstFollow: more.firstFollow });
    } catch (err) {
      console.error(err);
      return null;
    }
    if (!prompt) {
      if (moment === 'turn') this._hideCoach();
      return null;
    }
    const seen = this.settings.seenTips[prompt.id] || 0;
    const usedUp = seen >= tipLimit(prompt.id);
    const onceThisHand = ONCE_PER_HAND.has(prompt.id) && this.shownThisHand?.has(prompt.id) && !more.reshow;
    if (usedUp || onceThisHand) {
      if (moment === 'turn') this._hideCoach();
      return null;
    }
    // Let the previous prompt finish its minimum display time (errors jump the queue).
    const speedFactor = this.settings.speed === 'instant' ? 0 : this.settings.speed === 'fast' ? 0.6 : 1;
    const remaining = this.coachVisibleId ? minDisplayMs(this.coachVisibleId) * speedFactor - (performance.now() - this.coachShownAt) : 0;
    if (moment !== 'illegal' && remaining > 0 && this.coachVisibleId !== prompt.id) {
      clearTimeout(this.coachDefer);
      this.coachDefer = setTimeout(() => {
        if (!this.state || !this.settings.coach) return;
        if (moment === 'turn' && !(this.pending?.kind === 'play' && this.state.turn === 0)) return;
        if (moment === 'bid' && this.pending?.kind !== 'bid') return;
        this.coachVisibleId = null;
        this._coach(moment, extra, more);
      }, remaining + 40);
      return prompt;
    }
    this.table.showCoach(prompt, {
      onDismiss: (id) => this._retire(id, false),
      onOff: () => this._setCoach(false, true),
    });
    this.coachVisibleId = prompt.id;
    this.coachShownAt = performance.now();
    this.shownThisHand?.add(prompt.id);
    if (prompt.alsoId) this.shownThisHand?.add(prompt.alsoId);
    if (moment !== 'bid' && !more.reshow) {
      this._retire(prompt.id, false);
      if (prompt.alsoId) this._retire(prompt.alsoId, false);
    }
    return prompt;
  }

  _hideCoach() {
    clearTimeout(this.coachDefer);
    this.coachVisibleId = null;
    this.table.hideCoach();
  }

  /** Count a showing (or retire the tip for good when dismissed). */
  _retire(id, forever) {
    const limit = tipLimit(id);
    if (limit === Infinity && !forever) return;
    this.settings.seenTips[id] = forever ? Math.max(limit === Infinity ? 999 : limit, (this.settings.seenTips[id] || 0) + 1) : (this.settings.seenTips[id] || 0) + 1;
    saveSettings(this.settings);
  }

  _setCoach(on, announce) {
    this.settings.coach = on;
    saveSettings(this.settings);
    this._applySettingsToUi();
    if (!on) {
      this._hideCoach();
      this.table.setHint(null);
      if (announce) this.table.toast('Coach tips are off. The lightbulb button turns them back on.', 2600);
    } else if (announce) {
      this.table.toast('Coach tips are on.', 1400);
      if (this.state?.phase === PHASE.PLAYING && this.state.turn === 0 && this.pending?.kind === 'play') this._coach('turn', null, { reshow: true });
    }
  }

  _quipText(seat, event, vars = {}) {
    const char = this.chars[seat];
    if (!char || !this.settings.tableTalk) return null;
    const lines = char.quips[event];
    if (!lines || !lines.length) return null;
    const line = this.quipRng.pick(lines);
    return line.replace('{n}', `<span class="bidnum">${vars.n}</span>`);
  }

  _quip(seat, event, vars = {}, force = false) {
    if (seat === 0) return;
    const now = performance.now();
    if (!force && now - this.lastQuipAt[seat] < 2500) return;
    const text = this._quipText(seat, event, vars);
    if (!text) return;
    this.lastQuipAt[seat] = now;
    this.table.showBubble(seat, text, 2200);
  }

  _greet() {
    if (!this.settings.tableTalk || this.settings.speed === 'instant') return;
    [2, 1, 3].forEach((s, i) => setTimeout(() => this.state && this._quip(s, 'greeting', {}, true), 400 + i * 700));
  }

  // ------------------------------------------------------------ toolbar & keys
  _wireToolbar() {
    const b = this.table.buttons;
    b.hint.addEventListener('click', () => this._hint());
    this.table.lastTrickBtn.addEventListener('click', () => this.state && this.table.showLastTrick(this.state));
    b.coach.addEventListener('click', () => this._setCoach(!this.settings.coach, true));
    b.sound.addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      saveSettings(this.settings);
      this._applySettingsToUi();
      this.sound.play('click');
    });
    b.scores.addEventListener('click', () => this.state && showScoreHistory(this.table.stage, { history: this.state.history, names: this.names, scores: this.state.scores }));
    b.help.addEventListener('click', () => showRules(this.table.stage));
    b.settings.addEventListener('click', () => this._openSettings());
  }

  async _openSettings() {
    if (this.lobby) return;
    await showSettings(this.table.stage, {
      settings: this.settings,
      onChange: (key, value) => {
        this.settings[key] = value;
        saveSettings(this.settings);
        this._applySettingsToUi();
        if (key === 'coach' && !value) {
          this._hideCoach();
          this.table.setHint(null);
        }
      },
      onQuit: async () => {
        const ok = await confirmDialog(this.table.stage, { title: 'Quit this game?', text: 'Your progress is saved — you can resume from the lobby.', ok: 'Quit to lobby', cancel: 'Keep playing' });
        if (!ok) return;
        this._save();
        this._abortGame();
        this._showLobby();
      },
    });
  }

  _wireKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'h') this._hint();
      else if (k === 'c') this._setCoach(!this.settings.coach, true);
      else if (k === 'm') this.table.buttons.sound.click();
      else if (e.key === '?') showRules(this.table.stage);
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.pending?.kind === 'play' && !document.querySelector('.overlay')) {
        // Arrow keys walk the playable cards; Enter plays the focused one.
        e.preventDefault();
        const legalSlots = [...this.table.handEl.querySelectorAll('.slot.legal .card')];
        if (!legalSlots.length) return;
        const i = legalSlots.indexOf(document.activeElement);
        const next = i === -1 ? (e.key === 'ArrowRight' ? 0 : legalSlots.length - 1) : (i + (e.key === 'ArrowRight' ? 1 : legalSlots.length - 1)) % legalSlots.length;
        legalSlots[next].focus({ preventScroll: true });
      } else if (e.key === 'Escape' && !document.querySelector('.overlay')) {
        this.table.hideLastTrick();
        this.table.setHint(null);
      }
    });
    const unlock = () => this.sound.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  _hint() {
    const state = this.state;
    if (!state || !this.settings.coach) {
      if (state && !this.settings.coach) this.table.toast('Turn on coach tips to get hints.', 1600);
      return;
    }
    if (state.phase === PHASE.PLAYING && state.turn === 0 && this.pending?.kind === 'play') {
      const view = viewFor(state, 0);
      view.names = this.names;
      const card = solidPlay(view, new Rng(1));
      this.table.setHint(card);
      this.table.showCoach({ id: 'hint', text: `Coach suggests <b>${cardToPretty(card)}</b>. ${explainHint(view, card)}` }, { onOff: () => this._setCoach(false, true) });
    } else if (state.phase === PHASE.BIDDING && state.turn === 0) {
      const s = suggestBid(state.hands[0], state.options);
      this.table.showCoach({ id: 'hint', text: `Coach suggests bidding <b>${s.nil ? 'Nil' : s.bid}</b>.`, why: s.reasons.join('; ') + '.' }, { onOff: () => this._setCoach(false, true) });
    } else {
      this.table.toast('Hints are available on your turn.', 1400);
    }
  }

  _applySettingsToUi() {
    const s = this.settings;
    this.root.dataset.speed = s.speed;
    this.sound.setEnabled(s.sound);
    const b = this.table.buttons;
    b.coach.setAttribute('aria-pressed', s.coach ? 'true' : 'false');
    b.coach.classList.toggle('off', !s.coach);
    b.sound.classList.toggle('off', !s.sound);
    b.sound.innerHTML = s.sound ? this.table.constructor.name && iconSound(true) : iconSound(false);
    b.hint.hidden = !s.coach;
    if (this.state) this.table.renderTracker(this.state, s.coach && this.state.phase === PHASE.PLAYING);
  }

  // ------------------------------------------------------------ helpers
  _name(seat) {
    return this.names ? this.names[seat] : ['You', 'West', 'North', 'East'][seat];
  }

  _thinkTime(seat) {
    const speed = this.settings.speed;
    if (speed === 'instant') return 0;
    const [lo, hi] = this.chars[seat]?.think || [500, 900];
    const t = lo + this.quipRng.next() * (hi - lo);
    return speed === 'fast' ? t * 0.35 : t;
  }

  _delay(token, ms) {
    return new Promise((resolve, reject) => {
      if (ms <= 0) return resolve();
      setTimeout(() => {
        if (token !== this.token) return reject(new Abort());
        resolve();
      }, ms);
    });
  }

  /** A delay the player may cut short with a click or key press (used for the trick hold). */
  _delaySkippable(token, ms) {
    return new Promise((resolve, reject) => {
      if (ms <= 0) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(id);
        this.table.stage.removeEventListener('pointerdown', finish);
        document.removeEventListener('keydown', finish);
        if (token !== this.token) return reject(new Abort());
        resolve();
      };
      const id = setTimeout(finish, ms);
      // Only after a short beat, so a click that played the card does not also skip the hold.
      setTimeout(() => {
        if (done) return;
        this.table.stage.addEventListener('pointerdown', finish);
        document.addEventListener('keydown', finish);
      }, Math.min(250, ms / 3));
    });
  }

  _save() {
    if (!this.state || this.state.phase === PHASE.GAME_OVER) return;
    saveGame({ state: this.state, lineup: { ...this.settings.lineup }, playerName: this.settings.playerName, blindIntent: this.blindIntent });
  }

  _exposeDebugApi() {
    const self = this;
    globalThis.__spades = {
      version: '1.0.0',
      get controller() {
        return self;
      },
      getState() {
        const s = self.state;
        if (!s) return null;
        return JSON.parse(
          JSON.stringify({
            ...s,
            hands: s.hands.map((h) => h.map(cardToString)),
            trick: s.trick.map((p) => ({ seat: p.seat, card: cardToString(p.card) })),
            tricks: s.tricks.map((t) => ({ leader: t.leader, winner: t.winner, plays: t.plays.map((p) => ({ seat: p.seat, card: cardToString(p.card) })) })),
            legal: s.phase === PHASE.PLAYING && s.turn === 0 ? legalPlays(s, 0).map(cardToString) : [],
            pending: self.pending ? self.pending.kind : null,
            names: self.names,
          })
        );
      },
      bid(n) {
        if (!self.pending || self.pending.kind !== 'bid') return 'not waiting for a bid';
        const bid = n === 'nil' ? NIL : Number(n);
        const p = self.pending;
        self.pending = null;
        p.resolve(bid);
        return null;
      },
      blindNil(choice) {
        if (!self.pending || self.pending.kind !== 'blind') return 'not waiting for a blind-nil decision';
        const p = self.pending;
        self.pending = null;
        p.resolve(!!choice);
        return null;
      },
      play(cardText) {
        if (!self.pending || self.pending.kind !== 'play') return 'not waiting for a card';
        const card = parseCard(cardText);
        const err = playError(self.state, 0, card);
        if (err) return err;
        const p = self.pending;
        self.pending = null;
        p.resolve(card);
        return null;
      },
      settings: self.settings,
    };
  }
}

function iconSound(on) {
  return on
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 4V6L7 10H4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 4V6L7 10H4zM16 9l5 5M21 9l-5 5"/></svg>';
}

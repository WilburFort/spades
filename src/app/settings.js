// Settings and persistence (localStorage), plus URL-parameter overrides used by
// tests and for sharing a specific deal.

import { seedFrom } from '../engine/rng.js';
import { PRESETS, ROSTER_BY_ID } from './roster.js';

const SETTINGS_KEY = 'spadesNight.settings.v1';
const GAME_KEY = 'spadesNight.game.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  coach: true,
  tableTalk: true,
  sound: true,
  speed: 'normal', // normal | fast | instant
  preset: 'standard',
  lineup: { ...PRESETS.standard.lineup },
  playerName: 'You',
  options: {
    targetScore: 500,
    losingScore: null,
    bagPenaltyAt: 10,
    allowNil: true,
    allowBlindNil: true,
    nilTricksHelpPartner: true,
    tenForTwoHundred: false,
  },
  seenTips: {},
});

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadSettings() {
  const s = storage();
  let saved = null;
  try {
    saved = s ? JSON.parse(s.getItem(SETTINGS_KEY) || 'null') : null;
  } catch {
    saved = null;
  }
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(saved || {}),
    options: { ...DEFAULT_SETTINGS.options, ...((saved && saved.options) || {}) },
    lineup: { ...DEFAULT_SETTINGS.lineup, ...((saved && saved.lineup) || {}) },
    seenTips: { ...((saved && saved.seenTips) || {}) },
  };
  for (const k of ['partner', 'west', 'east']) if (!ROSTER_BY_ID[merged.lineup[k]]) merged.lineup[k] = DEFAULT_SETTINGS.lineup[k];
  if (!['normal', 'fast', 'instant'].includes(merged.speed)) merged.speed = 'normal';
  return merged;
}

export function saveSettings(settings) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* quota or privacy mode: ignore */
  }
}

/**
 * Apply URL overrides. Recognised:
 *   ?seed=123        deterministic deal
 *   ?fast=1          instant animations, no bot delays (tests)
 *   ?speed=normal|fast|instant
 *   ?coach=0|1       coach prompts
 *   ?talk=0|1        bot table talk
 *   ?sound=0|1
 *   ?preset=casual|standard|hard
 *   ?partner=id&west=id&east=id
 *   ?target=250      target score
 *   ?autostart=1     skip the lobby
 *   ?autoplay=1      the human seat is played by the solid heuristic (unattended runs)
 *   ?blindnil=0, ?bags=0 (disable bag penalty), ?nilhelp=0, ?ten200=1, ?bust=-200
 * Returns { settings, run } where run holds non-persisted flags.
 */
export function applyUrlOverrides(settings, search = globalThis.location?.search || '') {
  const p = new URLSearchParams(search);
  const run = { seed: null, autostart: false, autoplay: false, debug: false };
  const bool = (v) => v === '1' || v === 'true' || v === 'on';
  if (p.has('seed')) run.seed = seedFrom(/^\d+$/.test(p.get('seed')) ? Number(p.get('seed')) : p.get('seed'));
  if (p.has('fast')) settings.speed = bool(p.get('fast')) ? 'instant' : settings.speed;
  if (p.has('speed') && ['normal', 'fast', 'instant'].includes(p.get('speed'))) settings.speed = p.get('speed');
  if (p.has('coach')) settings.coach = bool(p.get('coach'));
  if (p.has('talk')) settings.tableTalk = bool(p.get('talk'));
  if (p.has('sound')) settings.sound = bool(p.get('sound'));
  if (p.has('preset') && PRESETS[p.get('preset')]) {
    settings.preset = p.get('preset');
    settings.lineup = { ...PRESETS[settings.preset].lineup };
  }
  for (const k of ['partner', 'west', 'east']) {
    if (p.has(k) && ROSTER_BY_ID[p.get(k)]) {
      settings.lineup[k] = p.get(k);
      settings.preset = 'custom';
    }
  }
  if (p.has('target')) {
    const t = Number(p.get('target'));
    if (Number.isFinite(t) && t >= 50) settings.options.targetScore = t;
  }
  if (p.has('bust')) {
    const b = Number(p.get('bust'));
    settings.options.losingScore = Number.isFinite(b) && b < 0 ? b : null;
  }
  if (p.has('blindnil')) settings.options.allowBlindNil = bool(p.get('blindnil'));
  if (p.has('nil')) settings.options.allowNil = bool(p.get('nil'));
  if (p.has('bags')) settings.options.bagPenaltyAt = bool(p.get('bags')) ? 10 : 0;
  if (p.has('nilhelp')) settings.options.nilTricksHelpPartner = bool(p.get('nilhelp'));
  if (p.has('ten200')) settings.options.tenForTwoHundred = bool(p.get('ten200'));
  if (p.has('autostart')) run.autostart = bool(p.get('autostart'));
  if (p.has('autoplay')) run.autoplay = bool(p.get('autoplay'));
  if (p.has('debug')) run.debug = bool(p.get('debug'));
  return { settings, run };
}

// ---- game persistence (resume after refresh)

export function saveGame(snapshot) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(GAME_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...snapshot }));
  } catch {
    /* ignore */
  }
}

export function loadGame() {
  const s = storage();
  if (!s) return null;
  try {
    const g = JSON.parse(s.getItem(GAME_KEY) || 'null');
    return g && g.v === 1 && g.state ? g : null;
  } catch {
    return null;
  }
}

export function clearGame() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(GAME_KEY);
  } catch {
    /* ignore */
  }
}

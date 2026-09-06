// Boot: load settings, apply URL overrides, start the controller.

import { loadSettings, applyUrlOverrides } from './app/settings.js';
import { GameController } from './app/controller.js';
import { Sound } from './ui/audio.js';

function boot() {
  const root = document.getElementById('app');
  const { settings, run } = applyUrlOverrides(loadSettings());
  const sound = new Sound();
  const controller = new GameController({ root, settings, run, sound });
  controller.start();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

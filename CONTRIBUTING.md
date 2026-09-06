# Contributing to Spades Night

Thanks for wanting to make the game better. Bug reports, rule questions, new bot personalities, coach copy, accessibility fixes and AI improvements are all welcome.

## Quick start

```
git clone https://github.com/WilburFort/spades.git
cd spades
npm install          # dev tools only: esbuild (build) and playwright (tests)
npm start            # http://localhost:8080
```

The game itself has **zero runtime dependencies**: vanilla ES modules, no framework, no images, fonts or audio files. Please keep it that way. A single self-contained HTML file is the deliverable (`npm run build` → `dist/spades.html`).

## Before you open a pull request

Run everything a reviewer will run:

```
npm test         # engine + AI unit tests
npm run e2e      # Playwright end-to-end tests in real Chromium (first time: npx playwright install chromium)
npm run build    # the single-file build must still make zero network requests
```

For AI changes, also run the simulation harness and paste the numbers in your PR:

```
npm run sim              # rookie vs solid vs expert, 40 games each
node scripts/simulate.js 30 expert,solid,expert,solid
node scripts/diagnose-nil.js expert 200
```

Skill tiers must stay honestly ordered: solid should beat rookie in roughly 100% of games and expert should beat solid in at least 85%. A change that makes the expert weaker or the rookie smarter needs a very good reason.

## Where things live

| Path | What |
|---|---|
| `src/engine/` | Pure rules: cards, seeded RNG, dealing, bidding, trick play, scoring, per-seat views. No DOM. Fully unit tested. |
| `src/ai/` | The bots. `analysis.js` (card counting, void inference), `bidding.js`, `play.js` (rookie and solid policies), `montecarlo.js` (expert search + etiquette vetoes), `bots.js` (factory), `simulate.js` (headless games). |
| `src/app/` | `controller.js` (the async game loop that drives engine, bots and UI), `coach.js` (all coach copy and triggers), `roster.js` (characters, quips, avatars), `settings.js` (persistence, URL flags). |
| `src/ui/` | `table.js` (stage layout and card animations), `dialogs.js` (lobby, bid panel, summaries), `cards.js`, `avatars.js`, `audio.js`. `styles.css` holds the whole look. |
| `tests/unit/`, `tests/e2e/` | `node --test` suites. |
| `docs/DESIGN.md` | The design specification. `docs/TODO.md` is the roadmap. |

Bots receive only a **view** (`src/engine/view.js`): their own hand plus public information. Never give a bot access to another hand. A test enforces this; keep it green.

## Good first contributions

- **A new character.** Add an entry to `src/app/roster.js`: a name, a tier (`rookie`, `solid`, `expert`), a think-time range, a parametric avatar and a handful of quips per event. No code paths per character, please: personality is copy, cadence and, for rookies, a `bidBias`.
- **Coach copy.** All prompts live in `src/app/coach.js`. Keep each under about 45 words, present tense, and fill names and cards from state. Add a limit in `LIMITS` so it can never nag.
- **Rules variants.** Options live in `DEFAULT_OPTIONS` (`src/engine/scoring.js`) and the lobby's House rules panel. Add unit tests in `tests/unit/engine.test.js` for every scoring branch you touch.
- **Accessibility.** Keyboard flow, ARIA labels, contrast, reduced motion. Test with a screen reader if you can.
- **Translations** are not wired up yet; if you want to start, the copy is concentrated in `coach.js`, `roster.js`, `dialogs.js` and the status strings in `controller.js`.

## Reporting a bug

Please include the **deal number** (shown on the game-over screen, or `__spades.getState().seed` in the browser console), the table preset, what you expected and what happened. `?seed=N` on the URL replays the same deal, which makes rules and AI bugs reproducible.

## Style

Plain modern JavaScript, two-space indentation, single quotes, semicolons, no build step for development. Small focused pull requests are much easier to review than large ones. Describe *why* in the PR, not just what.

## Code of conduct

Be kind. See `CODE_OF_CONDUCT.md`.

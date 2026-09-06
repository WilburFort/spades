# Spades Night

**Play it here:** https://wilburfort.github.io/spades/

A polished, single-player game of partnership **Spades** for the browser. You sit South with an AI partner across the table and face two AI opponents drawn from a roster of seven characters with three genuinely different skill levels. A quiet coach explains what to do next at the moments that matter, and switches off completely when you don't want it.

No framework, no build step for development, no images, fonts or audio files: the whole game ships as one self-contained HTML file that works offline.

![The table mid-hand](docs/screenshots/table.png)

## Play

- **Online:** https://wilburfort.github.io/spades/
- **Offline:** download `dist/spades.html` from the [latest CI run](../../actions) or run `npm run build`, then open the file in any modern browser.
- **Development:** `npm install`, `npm start`, then visit <http://localhost:8080>.

Pick a table in the lobby (Casual, Standard, Hard, or a custom lineup), press **Deal me in**, and bid.

![Bidding with the coach's suggestion](docs/screenshots/bidding.png)

### The table

| Character | Skill | Style |
|---|---|---|
| Rosie | ★ Rookie | Warm and chatty. Underbids, collects bags. |
| Benny | ★ Rookie | Impulsive. Overbids, leads aces, loves to trump. |
| Marcus | ★★ Solid | Tidy club player. Honest bids, hates bags. |
| Dee | ★★ Solid | Competitive league regular with good instincts. |
| Vega | ★★★ Expert | Card shark. Counts every spade, sets bids, feeds you bags. |
| Prof. Okafor | ★★★ Expert | Patient and precise. |
| Sable | ★★★ Expert | Quiet and ruthless. |

The **Standard** table (default) seats a rookie, a solid partner and one expert, so the three AI players really do vary in expertise. A competent player wins a little over half the time there; the Hard table wins about 40%.

### Rules

Standard partnership Spades: 13 cards each, spades are always trump, follow suit if you can, spades can't be led until broken. Make your team's bid for 10 points per trick (plus 1 per overtrick, which is a *bag*); miss it for −10 per trick. Nil is ±100, blind nil ±200 (offered when 100+ behind). Ten bags cost 100. First team to 500 wins. House rules (target score, bag penalty, blind nil, failed-nil tricks, 10-for-200, lose at −200) are in the lobby.

### Coach

Toggle with the lightbulb button, the **C** key, the lobby switch, or the *Turn off tips* link inside any prompt. When on, the coach suggests a bid, warns before a blunder bid, explains the rules the first few times they matter (following suit, breaking spades, nil, bags), nudges on strategy once per hand (partner already winning, covering a nil, setting the opponents), offers a **Hint** (**H**) for the current trick, and adds one line to each hand summary. Prompts retire after a few showings so it never nags. Turn indication, the status line and the "you must follow suit" feedback are game UI and always stay on.

![Hand summary with the trick review](docs/screenshots/hand-summary.png)

### Keyboard

Number keys bid (**0** = Nil; **1** then **0–3** for 10–13). Arrow keys walk your playable cards and **Enter** plays the focused one. **H** hint, **C** coach, **M** mute, **?** rules, **Esc** closes dialogs. A click or key skips the pause after a trick.

## How the AI works

Bots see only their own hand and public information (`src/engine/view.js`), so cheating is structurally impossible.

- **Rookie** counts aces and kings, plays its highest card to win (even over its partner), trumps whenever it can and throws random cards when it can't win.
- **Solid** uses protected-honour bidding, ducks under a winning partner, wins as cheaply as possible, covers and defends nils and stops taking tricks once the contract is safe.
- **Expert** adds card counting and void inference, then runs Monte Carlo rollouts: it repeatedly imagines the unseen cards dealt to the other seats (consistent with every void and bid it has observed), plays each candidate card out with the solid policy for everyone, and picks the card with the best expected team score. It bids the same way, evaluating each candidate bid (including nil) by rollout.

All tiers follow partnership etiquette that rollout noise must never override: never trump or overtake a partner's safe winning card, never win a trick while running your own nil if a losing card exists, always try to rescue a nil partner who is winning a trick, never bid a voluntary double nil.

`npm run sim` pits the tiers against each other. In 30-game series with production settings, solid beats rookie in 100% of games and expert beats solid in 93% (making 88% of its contracts, 0.6 bags per hand, and 25 of 28 nils).

## Testing

```
npm test      # engine + AI unit tests (node --test)
npm run e2e   # Playwright end-to-end tests in real Chromium (first time: npx playwright install chromium)
npm run sim   # bot-vs-bot skill comparison
npm run build # dist/spades.html (single self-contained file)
```

Continuous integration runs all of this on every push and pull request, and every push to `main` redeploys the game to GitHub Pages.

Useful URL parameters for testing and sharing a deal: `?seed=123`, `?fast=1` (instant animations), `?autostart=1`, `?autoplay=1` (the human seat plays itself), `?coach=0`, `?talk=0`, `?sound=0`, `?preset=hard`, `?partner=dee&west=rosie&east=vega`, `?target=250`. Preference flags in a URL apply to that visit only and are never saved. A debug API is exposed as `window.__spades` (`getState()`, `bid(n)`, `play('QS')`).

## Contributing

Issues and pull requests are very welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the map of the code and good first contributions, and [docs/TODO.md](docs/TODO.md) for the roadmap and known gaps. The design specification is in [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
index.html            entry page (dev)
src/engine/           rules: cards, RNG, dealing, bidding, trick play, scoring, views
src/ai/               bots: analysis, bidding, play policies, Monte Carlo, simulation runner
src/app/              controller (game loop), coach, roster, settings/persistence
src/ui/               table renderer + animations, dialogs, cards, avatars, WebAudio sounds
scripts/              serve.js, build.js, simulate.js, diagnose-nil.js
tests/unit, tests/e2e node:test suites
docs/                 DESIGN.md (spec), TODO.md (roadmap), screenshots
.github/              CI, GitHub Pages deploy, issue and PR templates
```

## License

[MIT](LICENSE). Play it, fork it, ship it, teach with it.

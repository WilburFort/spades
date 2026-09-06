# Spades Night — Final Design Specification (v1)

Status: FINAL. This document supersedes the four candidate designs. It starts from the winning strategy design (Design 2), grafts in the compatible best ideas from the onboarding, polish and product designs, and resolves every problem the three judges raised. Where a judge's problem and a design's idea conflicted, the resolution is stated inline and is not open for reinterpretation by the implementer.

Repository facts this spec is built on (verified): `src/engine` (int cards, seats 0–3, `viewFor`/`stateFromView`, `scoreHand`, `DEFAULT_OPTIONS`, `PHASE`, `playError` codes `spadesNotBroken`/`mustFollowSuit`, `cardToString` → `'10H'`, `sortHandForDisplay`, mulberry32 `Rng` + `seedFrom`), `src/ai` (`analyze`, `estimateTricks`, `nilRisk`, `rookieBid/solidBid/expertHeuristicBid`, `rookiePlay/solidPlay`, `sampleHands`, `monteCarloPlay/Bid`, `createBot(tier)` with tiers `rookie|solid|expert`), `src/app/roster.js` (7 characters with quips and parametric avatars), `src/ui/cards.js` (inline SVG suit sprite) and `src/ui/avatars.js`, `scripts/simulate.js`, 38 passing unit tests, `esbuild` + `playwright` as devDependencies, and `package.json` scripts `start/build/test/e2e/sim`. **The engine is not rewritten. The AI is refactored and extended in place, not replaced. The tier ids in code stay `rookie|solid|expert`; the UI labels them Beginner / Intermediate / Expert.**

---

## 1. Pitch & principles

**Pitch.** Spades Night is a single-file browser Spades table. You sit South with an AI partner across from you and two AI opponents who play the way real people do: the Beginners cash their aces and trump your winners, the Intermediates count voids and duck once their bid is in, and the Experts run hidden-information rollouts on every card to cover your nil, set your contract and feed you bags. A quiet coach explains exactly one thing at the moment it matters, and switches off completely. Every shuffle and every bot decision is seeded, so the table is a game to a player and a state machine to a test.

**Principles (in priority order; when two conflict, the earlier wins).**

1. **Never soft-lock, never cheat.** One controller decides who acts next, from engine state alone. Bots receive `viewFor()` output and nothing else; a test proves it. A watchdog with an in-flight token guarantees progress without double-acting.
2. **Deal within five seconds.** First launch asks one question. Returning players get one button.
3. **You always know whose turn it is and what you may play.** Three redundant turn channels; illegal cards fade and explain themselves. This is game UI and never turns off.
4. **The trick snap must feel great.** Hold → winner pulse → sweep to the winner → pip lights → chime. Everything else is polish on top of this loop.
5. **Skill tiers are real and proven.** The harness gates ship the game; personality is three bounded numbers per bot, never noise.
6. **The coach teaches, then leaves.** One bubble per trick, ids with show-caps, three-position switch, advice derived from the Intermediate policy so the Expert never plays your hand for you.
7. **Ship the single file.** Vanilla ES modules in dev; `esbuild` IIFE inlined into `dist/spades.html`; zero external requests; no images, no fonts, no audio files.

---

## 2. Screens & state machine

### 2.1 Screens

Exactly one screen is mounted at a time in `<main data-testid="screen" data-screen="lobby|table|gameover">`. Overlays (hand summary, settings, rules, menu) render on top of the table.

**LOBBY (first run).** Felt already rendered behind a frosted panel. Wordmark "SPADES NIGHT" (inline SVG). One question: **"Have you played Spades before?"** with two large buttons:
- `[Never, or just a little]` → preset **Casual** (partner Marcus; opponents Rosie & Benny), coach **Full**, Speed Normal.
- `[Yes, I know the rules]` → preset **Standard** (partner Dee; opponents Marcus & Vega), coach **Rules only**, Speed Normal.

Either button deals immediately. Small link `Customize table` opens TABLE SETUP. If a resumable save exists, a `Resume — Hand 4 · You 180 : Them 150` card sits above the question with `[Resume]` `[Discard]`.

**LOBBY (returning).** `[Play again]` (last table, new seed, autofocused), `[New table]` (TABLE SETUP), `[How to play]`. A lifetime record line: `Won 3 · Lost 1 · Nils made 2`.

**TABLE SETUP.** Three preset cards laid out spatially like the table plus **Custom**:
- **Casual** — partner Marcus (I); Rosie (B) & Benny (B).
- **Standard** — partner Dee (I); Marcus (I) & Vega (E).
- **Tournament** — partner Prof. Okafor (E); Vega (E) & Sable (E).
- **Custom** — three seat pickers (Partner / Left / Right) showing roster chips (avatar, name, stars, one-line blurb); no duplicate bots. *Rule: the default partner in every preset is at least Intermediate; a Beginner partner is only reachable through Custom, and the coach explains a Beginner partner's first blunder (prompt `partner-blunder`).*

Below: **House rules** accordion (locked with the note "Rule changes apply to the next game" once a game is under way) and **Experience** row (Coach Off / Rules only / Full; Speed Normal / Fast / Instant; Sound; Bot chatter; Spade tracker Auto/On/Off). **Advanced**: Seed field (blank = random; the seed used is shown at game over). Big gold `[Deal me in]` (`data-testid=start-game`).

**TABLE.** See §3. Sub-phases: dealing → (blind-nil choice) → bidding → playing → trick resolve → hand summary overlay.

**HAND SUMMARY** (overlay, table dimmed 40%, `data-testid=hand-summary`). Receipt-style: two team columns headed with team names in team colours. Rows print top to bottom, each counting up: `Bid` · `Took` · `Contract` (+40 / **−60 SET**) · `Nil` (per bidder: `NIL ✓ +100` / `NIL ✗ −100`, blind ±200) · `Bags` (dots dropping into the 10-dot meter) · `Bag penalty` (row appears only when the meter fills: `BAGGED −100`) · `Hand total` · `Score`. Stamps: `SET!` (red, −8° tilt) on a column that missed its bid; `NIL ✓` (gold) on a made nil; `BAGGED` on the penalty row. One bot reaction line in character; one coach line if relevant (§7). Collapsible `Review the 13 tricks` list (winner, four cards, who trumped). Footer: `[Next hand]` (`data-testid=next-hand-btn`, autofocused, Enter). **There is no auto-advance.** If `gameOver` was emitted in the same batch the button reads `[See results]`.

**GAME OVER** (`data-screen=gameover`, `data-testid=game-over`). Win: banner "You win!", 2.5 s CSS confetti (60 suit-glyph divs), four-chord fanfare. Loss: no confetti, a calm 500 ms dim, banner "Vega & Sable take this one", the winning bot's parting line, a low pad. Both: final score, hand-by-hand bar strip (one bar per team per hand), stats card (hands played, tricks you personally won, bids made exactly, nils made/failed, times you set them / were set, total bags, biggest swing, "Trick leader"), session achievements (Perfect Nil, Blind Faith, Bagged 'Em, Iron Wall, Clean Sheet), coach closing note (Full only, computed from bid accuracy). Buttons: `[Rematch]` (same table, new seed; `data-testid=rematch-btn`), `[Change table]`, `[Copy seed]`. Save cleared; lifetime record updated.

**SETTINGS DRAWER** (gear, right side, 320 px, Esc closes, focus trapped; `data-testid=settings-panel`). Live: Coach level, Sound + volume, Speed, Bot chatter, Spade tracker, Reduce motion (Auto/On/Off), Four-colour deck, Large cards, Confirm plays with a second tap (default on for coarse pointers), Auto-play forced cards (default off), Reset dismissed tips. House rules shown read-only. `[Quit to lobby]` with confirm ("Abandon this game? Your save will be discarded."). Opening the drawer never pauses the engine (turn-based; bots keep thinking, and their results are applied — the drawer is not modal to the game).

**HOW TO PLAY** (`?`): five short panels in a scroll-snap row (Teams & goal · Bidding & nil · Follow suit, highest wins · Spades are trump and must be broken · Bags & scoring), each under 40 words with a mini example rendered by the real card component. Never shown automatically.

### 2.2 Controller state machine (`src/app/controller.js`)

All game flow lives in one FSM. Human input handlers are **no-ops** unless `controller.state` is `BID_HUMAN`, `BLIND_NIL_CHOICE` or `PLAY_HUMAN` **and** the move is legal (`bidError`/`playError` return null).

```
LOBBY
  └─ start(config) ──────────────► DEALING
DEALING  (deal animation; skipped in Instant/fast)
  └─ animation done ─────────────► advance()
advance() derives from engine state:
  phase=bidding & human eligible for blind nil & not yet asked ─► BLIND_NIL_CHOICE
  phase=bidding & turn=0 ───────► BID_HUMAN
  phase=bidding & turn≠0 ───────► BID_BOT
  phase=playing & trick.length=4 (unswept) ─► TRICK_RESOLVE
  phase=playing & turn=0 ───────► PLAY_HUMAN
  phase=playing & turn≠0 ───────► PLAY_BOT
  phase=handOver ───────────────► HAND_OVER
  phase=gameOver ───────────────► GAME_OVER
BLIND_NIL_CHOICE → (Blind nil) placeBid(0,{blind:true}) → ANIMATING → advance()
                 → (Look) flip hand → BID_HUMAN
BID_BOT   → think delay → bot.chooseBid(view) → placeBid → bid bubble anim → advance()
BID_HUMAN → click/key → placeBid → advance()
PLAY_BOT  → think delay ∥ decision (sliced) → playCard → ANIMATING_PLAY → advance()
PLAY_HUMAN→ click/key → playCard → ANIMATING_PLAY → advance()
TRICK_RESOLVE → hold (skippable) → sweep anim → mark swept → advance()
HAND_OVER → summary overlay → [Next hand] → startHand → DEALING
GAME_OVER → game over screen
```

**Bidding order note:** the engine's `biddingComplete` event sets `leader = dealer+1`; the first trick is led by the player left of the dealer.

**Event application.** Engine functions return event arrays. The controller applies each batch as: mutate engine → enqueue animation steps for each event on the **sequencer** (`src/app/seq.js`) → when the batch's steps finish, `store.commit()` (UI re-render of nameplates/scoreboard/hand from state) → `persist.save()` → `advance()`.

### 2.3 What can soft-lock, and how it is prevented

| Hazard | Prevention |
|---|---|
| Bot decision promise never resolves / throws mid-rollout | Every bot decision gets an **in-flight token** `{id, handNumber, trickCount, trickLen, turn}`. The result is applied only if the token matches the live controller token and the engine still has the same `handNumber/tricks.length/trick.length/turn`. A **watchdog** (6 s Normal, 3 s Fast, 1.5 s Instant/fast-mode) fires per non-human state: it invalidates the pending token, logs `watchdog fired`, and re-drives the state with the **synchronous heuristic fallback** (`solidPlay`/`solidBid`). A late result with a stale token is dropped, so a bot can never act twice. |
| Missed `transitionend`/`animationend` | Every sequencer wait is `Promise.race([event, timeout(duration + 50 ms)])`. |
| Animation callback fires after a state change (e.g. Quit mid-flight) | `seq.cancelAll()` on Quit/Resume/unload; cancelled steps resolve immediately and their token is invalidated. |
| Double-click / stray click during animation | Handlers are no-ops outside `*_HUMAN` states; the hand also carries `aria-disabled` during `ANIMATING_PLAY`/`TRICK_RESOLVE`. |
| Re-render fighting FLIP flights | `render()` is **suspended** while `seq` is non-idle; DOM updates are queued and flushed at `commit()`. Flying card elements are owned by `fx.js`, not by the hand renderer. |
| Background-tab timer throttling | Timers are `setTimeout`-based and resume when visible; the watchdog compares wall-clock to intended durations and force-completes any step over 2× its budget. |
| Persist saving stale state | `save()` serialises the live engine object at `commit()` time only (never a captured copy), never mid-animation. |
| Corrupt/old save | `persist.load()` validates `v===1`, all 52 cards accounted for, `phase ∈ PHASE`; failure → silent discard + 2 s toast. `?seed` in the URL always starts fresh. |
| 13th trick / forced plays | When a seat has exactly one legal card and it is a bot, or trick 13, the play is immediate; for the human, trick 13 auto-plays after a 400 ms beat (always), earlier forced plays only if `Auto-play forced cards` is on. |
| Coach bubble waiting on a quip or vice versa | Feedback lives in independent regions (§4.5 presenter) with fixed priority; nothing in the game flow ever awaits a coach bubble or quip. |
| Blind-nil modal appearing mid-flow | Only in `BLIND_NIL_CHOICE`, only when `canBidBlindNil(state,0)` and the `Blind nil` option is on (default **off**). |

A unit test drives the FSM with a fake sequencer that (a) completes instantly, (b) never completes, and asserts the watchdog fires exactly once per stuck state and that the engine's `tricks.length` never exceeds the number of `trickWon` events.

---

## 3. Table layout spec

Layout is a CSS grid, **not** a scaled canvas. Sizes come from CSS variables; text never scales below 13 px.

```
:root { --card-w: clamp(72px, 7.5vw, 96px); --card-h: calc(var(--card-w) * 1.4);
        --topbar: 48px; --hand-h: 176px; --coach-h: 56px; }
@media (max-height: 720px) { :root { --hand-h: 150px; } }
```

Seats: 0 = South (human, bottom), 1 = West (left), 2 = North (partner, top), 3 = East (right). Play order 0→1→2→3.

### 3.1 ASCII layout at 1280×800

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ SPADES NIGHT  Hand 3 · Dealer: East │ ● Your turn — lead any club, diamond or heart │ You & Dee 137 ●●●○○○○○○○ bid 7·won 5  Marcus & Vega 92 ●●●●●●○○○○ bid 5·won 3 │ [Hint][Coach:Full][🔊][?][⚙] │ 48px
├──────────────────────────────────────────────────────────────────────────────────────┤
│                              ┌──────────────────┐  ▮▮▮▮▮▮▮▮▮ (N backs, 40×56)           │
│  ♠ 2 3 4 5 6 7 8 9 10 J Q K A (spade tracker)   │(◉) Dee  ★★  │ Bid 4 · ●●○○           │
│                              └──────────────────┘                                     │
│  ┌────────────┐                                                        ┌────────────┐ │
│  │ (◉) Marcus │ ▮             ┌───────────────────────┐              ▮ │ (◉) Vega   │ │
│  │ ★★  Bid 3  │ ▮             │        [N slot]        │              ▮ │ ★★★ Bid 2  │ │
│  │ ●●●○ won 3 │ ▮             │ [W slot]     [E slot]  │              ▮ │ ●○ won 1   │ │
│  └────────────┘ ▮             │        [S slot]  ▲led  │              ▮ └────────────┘ │
│    W backs      ▮             └───────────────────────┘              ▮    E backs      │
│                        (bid panel replaces the trick zone during BID_HUMAN)           │
│      ┌────────────────────────────────────────────────────────────────┐               │
│      │ 🦉 Coach: Marcus's king is winning. You don't need to beat it. │ [Why?] [×]    │ 56px slot
│      └────────────────────────────────────────────────────────────────┘               │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐        ╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮╭─╮        [Last trick]   │
│ │ (◉) You     │        │ ││ ││ ││ ││ ││ ││ ││ ││ ││ ││ ││ ││ │        [Speed 1×]     │ 176px
│ │ Bid 3 ●●●○○ │        ╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯╰─╯        [Menu]         │
│ └─────────────┘                    (13 cards, 96×134, 56px stride)                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Regions

**TOP BAR (48 px, glass).** Left: wordmark (small), `Hand n · Dealer: <name>`. Centre: **always-on status line** (`data-testid=status`, `role=status`) — `Your turn — lead any club, diamond or heart` / `Vega is thinking…` / `North won the trick with the K♠` / `Spades broken`. It is game UI, never coach, never toggles off. Right: **scoreboard** (`data-testid=scoreboard`): two rows, `You & Dee` (team colour Us) and `Marcus & Vega` (Them), each with a 20 px tabular score (`score-us`/`score-them`), a 10-dot **bag meter** (`bags-us`/`bags-them`, `data-bags=k`; dots amber at 8–9, burst at 10) and this hand's `bid 7 · won 5`. Then icon buttons ≥ 44 px: `Hint` (Full coaching only), `Coach` pill (owl + level), Sound, `?`, gear. At 1024 wide the scoreboard drops the `bid·won` text (it remains on nameplates).

**SPADE TRACKER** (under the top bar, left; Auto = on in Full coaching): 13 tiny spade indices 2…A; played ones grey out. `data-testid=spade-tracker`.

**NAMEPLATES** (`data-testid=seat-{0..3}`; 200×64 glass pill): 44 px inline-SVG avatar; name + 1–3 gold stars; second line: bid chip (`seat-{n}-bid`: `Bid 4`, `NIL` in coral with a gold **shield** icon, `BLIND NIL`, or `—`) and **tally pips** (`seat-{n}-tricks`, `data-won`): one filled pip per trick won up to the bid, then **hollow bag-coloured pips** for every trick beyond it, so overtricks read at a glance. Dealer badge: 22 px gold disc with `D`. Behind each bot nameplate a **mini-fan of remaining card backs** (40×56, 18 px stride; 30×42 at 1024) so card counts are visible; the fan shrinks with a 300 ms FLIP as cards are played. Positions: North centred at top of felt (y≈8), West at x=16 vertically centred, East mirrored, South bottom-left in the hand row.

**TRICK ZONE** (`data-testid=trick`, 440×300 centred in the felt). Slots: N (0,−82), S (0,+82), W (−96,0), E (+96,0) relative to centre; cards at 84×118 with a seeded ±4° tilt; later cards overlap earlier by z-index (play order); the led card gets a thin cream underline chip `led`; the currently winning card gets a 2 px gold outline. A small gold chevron on the zone's edge points at the acting seat. Slots: `data-testid=trick-card-{seat}`.

**BID PANEL** (inside the trick zone during `BID_HUMAN`; `data-testid=bid-panel`): title "How many tricks will you win?"; one row of 44 px round buttons `[Nil] [1]…[13]` (`bid-nil`, `bid-btn-{1..13}`) and, only when eligible, `[Blind Nil]` (`bid-blind-nil`). **One tap bids — there is no confirm step, and there is no separate `0` button (0 is Nil).** In Full coaching the suggested button wears a `Coach: 3` tag (`bid-suggested`) and a `Why?` link (`bid-why`) expands a Sure / Likely / Maybe line. While a bot bids, the panel shows `<name> is thinking…`. After all four bids the panel collapses upward (300 ms) and the scoreboard shows `bid 7 · won 0`.

**COACH SLOT** (`data-testid=coach-prompt`, `data-coach-id`): between the trick zone and the hand, centred, max-width 680 px, **min-height 56 px reserved so nothing jumps**; collapses to 12 px when Coach is Off. Cream bubble (#fff8e6), 36 px owl avatar, 15 px text ≤ 45 words, `[Why?]` when applicable, `[Got it]` and `Don't show again` (Full), or just `×` (Rules only). `aria-live=polite`. It never overlaps the south trick slot (the slot's bottom edge is ≥ 16 px above the coach slot at both viewports).

**HAND** (`data-testid=hand`): 13 cards at `--card-w`, 56 px stride (46 px at 1024), centred, fanned on a shallow arc (`rotate((i−6)·1.6deg)`, `translateY((i−6)²·1.1px)`), sorted by `sortHandForDisplay` (♦ ♣ ♥ ♠ ascending). Each card: `data-testid=hand-card-{cardToString}` (e.g. `hand-card-10H`), `data-card`, `data-legal=true|false`, `data-reason=spadesNotBroken|mustFollowSuit|notYourTurn|`, `aria-label="Queen of spades, playable"`. Legal: full opacity, lifts 18 px on hover/focus (120 ms). Illegal: 50% opacity, `saturate(.6)`, `cursor:not-allowed`, hover tooltip with the reason; click → 300 ms shake + 1.5 s toast (`data-testid=illegal-toast`) — always on. Spades carry a 1 px inset gold rim as a standing "trump" affordance. On coarse pointers with `Confirm plays` on: first tap lifts and selects, second tap plays. The fan stays anchored (no re-centre while the pointer is over it; re-centre happens at `commit()` after the play flight).

**SOUTH NAMEPLATE**: same design, name `You`, in the hand row bottom-left. A `Your turn` gold pill (`data-testid=turn-ribbon`) fades in above the hand centre on the human's turn.

**BOTTOM-RIGHT CLUSTER**: `Last trick` (`data-testid=last-trick-btn`, opens a 2 s mini panel of the previous four cards, winner marked), `Speed 1×/2×` quick toggle (maps to Normal/Fast), `Menu`.

**TURN INDICATION (three redundant channels, never coaching):** (1) the active nameplate has `.is-turn` — 3 px gold ring with 1.2 s pulse (static under reduced motion) and `<body data-turn=n>`; bots show three animated dots in their chip; (2) the status line names the actor; (3) for the human: `Your turn` pill, hand brightens from .92 to 1, legal cards lift 6 px, a soft ping. There is no spotlight overlay, no nameplate tilt, no breathing fan.

### 3.3 1024×700 fallback

`--card-w` → 80 px (hand spans 80 + 12·46 = 632 px), hand row 150 px, mini-fans 30×42, trick zone 380×260, coach slot 48 px, scoreboard drops `bid·won`. Felt height = 700 − 48 − 150 = 502 px, of which trick zone 260 + coach 48 + North plaque/fan 110 leaves ≥ 80 px margin. Playwright asserts no horizontal scroll and that every `hand-card` is fully inside the viewport at both sizes.

---

## 4. Visual & motion style

### 4.1 Palette (CSS variables on `:root`; the page paints its own background, so host theme has no effect)

| Token | Hex | Use |
|---|---|---|
| `--felt-1` / `--felt-2` | `#1f6a52` → `#0e3a2e` | radial felt gradient, centre → edge |
| `--bg` | `#0a1618` | page ground outside the felt |
| `--rail` | `#3b2419` | 14 px walnut rail around the felt oval, with 1 px inner line `--brass` |
| `--brass` | `#c9a961` | rail line, stamp outlines, deco card frames |
| `--gold` | `#ffd166` | turn ring, coach tag, spade rim, primary buttons, winner outline |
| `--glass` | `rgba(13,22,27,.84)` + 1 px `rgba(255,255,255,.09)` border + `backdrop-filter: blur(8px)` | bar, plaques, panels |
| `--text` / `--muted` | `#f3f1e9` / `#aeb9b5` | text on dark |
| `--us` / `--them` | `#5ad1b5` / `#ff7f6e` | team colours (always paired with a text label) |
| `--good` / `--bad` | `#2ed3a3` / `#ff5c72` | set inflicted / nil made; set taken / nil busted / bagged |
| `--bag` | `#d9a066` | bag dots, hollow overtrick pips |
| `--card-face` / `--card-edge` | `#fbf8f0` / `#d6d0c2` | card face and border |
| `--red` / `--black` | `#c8272e` / `#1b1b1f` | suit colours (four-colour deck: ♦ `#1f5fd0`, ♣ `#1a7f37`) |
| `--back` | `#223760` | card back navy |
| coach cream | `#fff8e6` text `#2b2a26` | coach bubble |

### 4.2 Typography

System stack only: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. Display stack `Georgia, 'Times New Roman', serif` in small caps with 0.12 em tracking for the wordmark fallback text, stamps (`SET!`, `NIL ✓`, `NIL BUSTED`, `BAGGED`) and face-card letters. All numerals `font-variant-numeric: tabular-nums`. Sizes: scores 20/700, nameplate name 15/600, chip 13/600, status 14, coach 15/400 line-height 1.35, card index 22/800 with a 20 px glyph beneath, small caps labels 12/600.

### 4.3 Cards (`src/ui/cards.js`, DOM + inline SVG)

96×134 (5:7), radius 8, face `--card-face`, 1 px `--card-edge` border, shadow `0 2px 6px rgba(0,0,0,.35)`. Suit glyphs are the four `<symbol>` paths in the existing inline sprite via `<use>` — **never Unicode glyphs** — so rendering is identical on every OS. Index (rank over glyph) top-left, rotated copy bottom-right. Centre: 2–10 one 44 px glyph; J/Q/K a 56 px serif letter inside a deco double-line frame (two 1 px `--brass` rectangles 3 px apart with 3 px corner squares) with a 20 px glyph above; Aces one 64 px glyph. **Signature card:** the A♠ additionally gets a thin gold ring and the tiny word `SPADES NIGHT` beneath the glyph. Spades carry `box-shadow: inset 0 0 0 1px rgba(255,209,102,.55)`. Back: `--back` with two `repeating-linear-gradient` lattices at ±45° (`rgba(255,255,255,.08)`, 8 px), a 3 px inset cream margin and a centred 28 px gold spade. States: `.is-legal`, `.is-illegal`, `.is-selected` (coarse pointer), `.is-winning` (2 px gold outline). Cards are flat (no 3D flip); the deal "flip" is a 200 ms cross-fade from back to face.

### 4.4 Avatars

64×64 parametric inline SVG from `src/ui/avatars.js` (bg, skin, hair shape/colour, glasses, beard, moustache, earrings, accent). Faces, not initials. Coach: an owl in a green visor.

### 4.5 Motion system

One sequencer (`src/app/seq.js`): every animation is an awaited step; durations come from one JS table multiplied by `speedFactor` (Normal 1, Fast 0.5, Instant 0.05) which is also written to the CSS variable `--t` (all CSS durations are `calc(var(--t) * Xms)`). `?fast=1` = Instant + bot think 0 + trick hold 50 ms. `prefers-reduced-motion` or the Reduce-motion setting: flights become 150 ms opacity fades, rings are static, count-ups snap, confetti is a static gold glow. `<html data-animating=true|false>` is false only when the sequencer queue is empty.

**Presenter** (`src/app/presenter.js`) owns feedback that is not game flow, with fixed priority and one item per channel: **stamp** (exclusive; suppresses new quips for its duration) > **trick sweep** (a stamp waits for the sweep to finish) > **quip** (one bubble at a time, max one per trick, never fired while `PLAY_HUMAN` is waiting on the human — it fires after the human plays) > **coach** (one bubble, fires only when `data-animating=false`). Toasts (`Spades broken`) are a fifth channel at the top and never block anything.

**Animation table (Normal speed; ×`speedFactor`):**

| Step | Duration |
|---|---|
| Nameplates slide in from their edge | 250 ms, 80 ms stagger |
| Deal: 52 backs fly from centre deck | 220 ms each, 25 ms stagger (≈1.5 s total; skipped in Instant) |
| Human hand face reveal (cross-fade) + sort FLIP | 200 ms, 30 ms stagger |
| Bid bubble pop / hold / collapse into chip | 180 ms / 900 ms / 200 ms |
| Bid panel collapse to scoreboard | 300 ms |
| Card play flight (hand or mini-fan → slot), 1.0→1.06→1.0 landing | 240 ms `cubic-bezier(.2,.8,.2,1)` |
| Trick hold (winning card outlined gold, scale 1.06) | 650 ms; any click on the felt/trick zone or any key skips |
| Trick sweep to winner's nameplate (scale to .4, fade) | 380 ms ease-in |
| Tally pip fill / `+1` float | 150 ms / 400 ms |
| Turn ring pulse | 1.2 s loop |
| `Your turn` pill fade | 200 ms |
| Illegal card shake (`translateX ±6px ×3`) | 300 ms |
| `Spades broken` toast + chip flip | 250 in / 1.8 s hold / 200 out; chip pulse 500 ms |
| Nil shield crack / nil safe tick | 350 ms / 150 ms |
| Bag dot fill + meter shake / bag burst at 10 | 300 ms / 500 ms |
| Stamps (`SET!`, `NIL ✓`, `NIL BUSTED`, `BAGGED −100`): scale 1.3→1 with −8° tilt | 250 ms in, 1.2 s hold, 200 ms out |
| Hand summary slide-up; rows print with 600 ms count-up, 200 ms stagger | 300 ms |
| Game over confetti / loss dim | 2.5 s / 500 ms |
| Settings drawer | 220 ms |
| Bot think delay (per persona, seeded) | Rosie 700–1200, Benny 350–650, Marcus 600–1000, Dee 500–900, Vega 900–1500, Okafor 1000–1600, Sable 800–1300 ms; Experts' computation runs inside this delay |

### 4.6 Sound (`src/ui/sound.js`, WebAudio only)

One `AudioContext` created and resumed on the first pointer/key event (the lobby click); every `play()` is a no-op if the context is not running or Sound is off. Master `GainNode` from the volume slider.

| Cue | Synthesis |
|---|---|
| card slide | 60 ms band-passed noise (3 kHz, Q 1), ±10% seeded pitch |
| card place | 20 ms click + 60 ms 180 Hz sine decay |
| your turn | 120 ms sine 880 Hz, fast decay (−12 dB) |
| trick won by us / by them | ascending plucks C5-E5-G5 (3×90 ms) / 120 ms 70 Hz thud |
| trump played | 110 Hz "thup", 100 ms |
| spades broken | 200 ms 90 Hz sine + 600 ms filtered-noise shimmer |
| bid confirm / bubble pop | 30 ms 1 kHz click / 80 ms sine sweep 400→900 Hz |
| score tick | 8 ms click per 10 points during count-ups |
| set (against us) / set inflicted | descending A4-F4 / 150 ms noise slap |
| nil made / nil busted | arpeggio C5-E5-G5-C6 (110 ms each) / descending A4-F4-D4 detuned |
| bag / bagged −100 | 120 ms 70 Hz thud / 250 ms 90 Hz thud + buzz |
| game win / game loss | four-chord fanfare C-F-G-C (350 ms each) with 6 Hz tremolo / 1.5 s low pad |

No heartbeat loop, no per-digit flip sounds. Every cue is redundant with a visual.

---

## 5. Bot roster

Seven characters (the existing `src/app/roster.js` cast, extended with skill knobs). Personality = think cadence + quip table + **three bounded numeric knobs** within the tier; there are no per-bot code paths.

| Bot | Tier (code) | Stars | Personality | Knobs | Avatar |
|---|---|---|---|---|---|
| **Rosie** | Beginner (`rookie`) | ★ | Warm, chatty grandmother; treats every card as a surprise; apologises after trumping your ace. "Oh dear, was that a spade?" / "Look at that, I won one!" | `bidBias −1`, `jitterUp .15`, never bids nil | rose bg, silver bun, round glasses, earrings |
| **Benny** | Beginner (`rookie`) | ★ | Eager teen who narrates his own highlights and cashes aces immediately. "Easy money." / "Wait, that counts against us?" | `bidBias +1`, `jitterUp .25`, nil chance .4 when the crude check passes | sky-blue bg, backwards cap |
| **Marcus** | Intermediate (`solid`) | ★★ | Tidy accountant who talks in totals; hates bags. "That's bag number six, partner." / "Right on the number." Default partner in Casual. | `shade .45`, `nilThreshold 1.5`, ducks one trick early once made | slate bg, bow tie, spectacles |
| **Dee** | Intermediate (`solid`) | ★★ | Competitive, honest bidder who loves to cut and says so. "Cut!" / "Not on my watch." Default partner in Standard. | `shade .15`, `nilThreshold 2.8`, blind nil at ≥200 deficit 40% | violet bg, headband |
| **Vega** | Expert (`expert`) | ★★★ | Ruthless sandbagger, the house shark. Feeds you bags "on the house", needles you at 8 bags, rarely bids nil. "That one's on the house." / "Enjoy that one. And that one." | `oppBagWeight ×1.25`, `nilMargin +15` | black bg, sharp brows, crimson streak |
| **Prof. Okafor** | Expert (`expert`) | ★★★ | Calm, exact; her quips are **true card-counting facts pulled from the tracker** so the trash talk teaches. "That was the last heart." / "Two spades unaccounted for." / "Probability favoured the club." | baseline expert | navy bg, round gold glasses, star pin |
| **Sable** | Expert (`expert`) | ★★★ | Cool, minimal nil specialist and set hunter. "Nil." / "Reckon that's a set." Tips a hat when you make yours. | `nilMargin −10`, `setBonus +20`, faster budget | plum bg, asymmetric bob, thin sunglasses |

Quip events (from `roster.js`): `greeting, bid, nil, won, trumpedPartner, set, madeBid, nilMade, nilBusted, bagged, oppSet, win, lose`, plus `fact` (Okafor only, filled from the tracker: last card of a suit, spades unaccounted). Quip chance per event: Beginners .6, Intermediates .4, Experts .25; chosen by the seeded bot rng; `Bot chatter` toggle hides them all. **No quip ever contradicts the coach** (e.g. no "don't cover me" lines).

**How the player chooses:** lobby question → Casual or Standard; `Customize table` → Casual / Standard / Tournament / Custom (three seat pickers; partner defaults to Intermediate; duplicates rejected). URL: `?table=casual|standard|tournament` or `?bots=dee,marcus,vega` (partner, west, east).

---

## 6. AI tier spec

All AI lives in `src/ai/` and is **refactored in place** (the current file names and exports remain valid; new exports are added). Bots receive only `viewFor(state, seat)`; a unit test wraps `state.hands` in a `Proxy` that throws on access from any `src/ai` frame and runs 200 seeded decisions per tier. Every bot gets its own `Rng` seeded by `seedFrom(`${seed}:ai:${seat}:${handNumber}`)` so decisions are reproducible regardless of other seats.

### 6.1 Shared infrastructure

**`bidding.js`**
- `estimateTricks(hand) → E`. Replace the current constants with this calibrated table and pin it with a test (mean E over 20 000 seeded random hands ∈ [3.0, 3.5]):
  - Spades (n = count): A♠ 1.0; K♠ 1.0 if A♠ held or n ≥ 3, else .6 (n=2) / .4 (n=1); Q♠ 1.0 if A♠&K♠, .7 if one of them and n ≥ 3, .45 if n ≥ 4, else .25; J♠ .6 if two of A/K/Q, .4 if n ≥ 4 and one of A/K/Q, .25 if n ≥ 5, else .1; length: 4th, 5th, 6th+ spade add .5, .8, 1.0 each.
  - Side suits (length L): A: L ≤ 4 → 1.0 (singleton .95), L=5 .85, L=6 .65, L ≥ 7 .45. K with A: L 2–4 .75, L=5 .55, L ≥ 6 .35. K without A: L=1 .2, L=2 .4, L 3–4 .5, L ≥ 5 .3. Q with A&K: L 3–4 .5, L ≥ 5 .3. Q with one of A/K: L 2–4 .3, L ≥ 5 .2. Q alone: L=1 .05, L 2–4 .15, L ≥ 5 .1. J with A,K,Q and L=4: .3.
  - Ruffs: `spare = n − (#spade honours scored ≥ .6)`; first void side suit +.5·min(1,spare), second void +.3, each singleton +.25 if spare ≥ 2; ruff bonus capped at .5·spare. Any side suit L ≥ 6: −.3.
- `sureTricks(hand)` = A♠ + (K♠ if A♠ held or n ≥ 2) + side-suit aces in suits with L ≤ 4. **No tier ever bids below `sureTricks` except when bidding nil.**
- `nilDanger(hand) → float` (hand-level; the existing per-card `analysis.nilDanger` is renamed `cardDanger`): A♠/K♠ → +99; Q♠ 3, J♠ 2, 10♠/9♠ 1 each (1.5 if n ≤ 2); side A 3 (singleton 4), side K 2 (1.5 with ≥ 3 lower cards in suit), side Q 1 (.5 with ≥ 3 lower), J with L ≤ 2 .5; each suit with no card ≤ 5 +1; n ≥ 5 spades +1; each void −.5; partner already bid ≥ 4 −.5; an opponent already bid nil +2; behind by ≥ 150 −.5; ahead by ≥ 150 +.5.
- `bidPlan` never shades because a team total would exceed 9; strong hands bid 10+.

**`analysis.js` → Tracker** (`analyze(view)` extended, O(52)): `unseen[]`, `remainingInSuit[4]`, `highestUnseen[suit]` (boss detection), `voids[seat][suit]` (hard: failed to follow), `noSpadesLikely[seat]` (**soft** weight .35, set when a void seat declined to trump a trick an opponent was winning cheaply — never a hard constraint), `spadesOutside`, `nilSeats`, `nilBroken[seat]`, `need[team] = teamBid − teamTricks`, `tricksRemaining`, `position` (1–4), `currentWinner`, `winningCard`, `partnerWinning`, `opponentWinning`.

**`montecarlo.js` → sampler + PIMC.** `sampleHands(view, a, rng, weights)`: deal unseen cards to the three hidden seats respecting hand sizes and **hard voids** (process the suit with the most void seats first; restart up to 20×; then relax weights but never voids). Per-seat card weights: nil bidder `w=.15` on A/K/Q of any suit and `.1` on spades ≥ J; a seat that bid `b ≥ 4` gets `w = 1 + .25·(b−3)` on A/K and `1 + .2·(b−3)` on spades, clamped to [.4, 2.5]; a seat that bid 1 gets `.6` on A/K and spades ≥ J; `noSpadesLikely` seats get `.35` on spades. Bid-consistency rejection (existing `consistentWithBids`): accept a world only if for each already-bid seat |Intermediate-formula bid on its reconstructed original hand − actual bid| ≤ 1 (slack 2 after trick 6), nil seats require `nilDanger ≤ 3.5`; up to 5 attempts then accept unfiltered.

**`play.js`**: `rookiePlay` (Beginner) and `solidPlay` = **`heuristicPlay`** (Intermediate; also the Expert's rollout policy and the coach's Hint source). `bots.js`: `createBot(tier, {seed, knobs, worlds, bidSamples})` → `{chooseBlindNil, chooseBid, choosePlay, lastThought}`; `decideAsync(view)` yields to the event loop every 25 ms of work (`await new Promise(r => setTimeout(r, 0))`) so animations stay smooth on the main thread. No Web Worker in v1.

### 6.2 Beginner (`rookie`) — Rosie, Benny

**Bidding.** `bid = round(aces + .5·kings + .5·max(0, spades − 3)) + jitter`, jitter from the bot rng: 0 (60%), +1 (`jitterUp` .15 Rosie / .25 Benny), −1 otherwise; plus `bidBias` (Rosie −1, Benny +1); clamp to [1, 7]; floor at `sureTricks`. Ignores partner's bid, table total, score and bags. Nil only if no A or K of any suit and ≤ 2 spades, then with probability .4 (Rosie never). Never blind nil.

**Play** (no memory beyond the current trick). Leading: highest card of the longest side suit (aces come out early); 20% of leads a uniformly random legal card; leads spades when broken if holding a spade ≥ J. Following: if able to beat the current winner, plays the **lowest winning card even when partner is already winning** (30% of such cases) and even after the team has made its bid (never ducks → bags). Cannot win → lowest card in suit. Void: trumps with the lowest spade whenever an opponent is winning, and 30% of the time when partner is winning; otherwise sluffs the **highest** non-spade (throws stoppers). Own nil: lowest legal card always. Ignores partner's and opponents' nils.

**Weaknesses on purpose** (each is a coachable moment): no memory (plays K with the A still out, leads into seen voids), tramples partner's winners, never ducks (harness expectation: Beginner pair ≥ 2.5 bags/hand), cashes aces first, no nil cooperation, bids from honours only.

### 6.3 Intermediate (`solid`) — Marcus, Dee

**Bidding.** `E = estimateTricks(hand)`; `bid = clamp(round(E − shade), 1, 13)`, `shade` .3 default (Marcus .45, Dee .15). Partner bid nil → `round(E + .5 − shade)`. If (bids already placed + bid) ≥ 13 → subtract 1 (floor `sureTricks`). Team bags ≥ 7 → extra shade .3. **Nil** if `nilDanger ≤ nilThreshold` (2.0 default; Marcus 1.5, Dee 2.8) AND (partner bid ≥ 3, or partner unbid and E ≤ 1.0) AND no opponent already bid nil. Blind nil: Dee only, deficit ≥ 200, 40%. Endgame: if opponents' score ≥ target − 50, no shading.

**Play** — `heuristicPlay(view, tracker, knobs)`. Definitions: `need`, `oppNeed`, `boss` (my card outranks every unseen card of its suit).
- *Leading (priority):* (1) need > 0 and I hold a boss side card in a suit no opponent has shown void → lead it; (2) need > 0, spades broken, I hold ≥ 4 spades including the boss spade → lead it to draw trumps; (3) partner (not nil) has shown void in a side suit where I hold a low card → lead it (gives partner a ruff); (4) lowest card of my longest side suit; (5) need ≤ 0 → lowest card of a suit where I hold no boss cards. Never lead spades except (2), all-spades, or when only spades are safe against an opponent nil.
- *Following:* 4th seat, partner winning → lowest card, never trump. 3rd seat, partner winning → low if partner's card is boss or 4th seat is known void of both suit and spades; else if need > 0 and I hold a boss card, overtake with it; else low. Opponent winning and need > 0: 2nd seat → boss card if held else lowest; 3rd seat → lowest winning card ("third hand high"); 4th seat → lowest winning card. Opponent winning and need ≤ 0 → duck with the **highest** non-winning card; if all legal cards win, win with the highest; **set attempt exception:** if oppNeed > 0 and oppNeed ≥ tricksRemaining − 1, win when able.
- *Void:* opponent winning and need > 0 → trump with the lowest spade that beats any spade in the trick; partner winning → sluff; need ≤ 0 → sluff unless set attempt. Sluff: highest card of my shortest non-spade suit that is not boss; never sluff a spade while holding non-spades.
- *Own nil:* following → highest card below the current winner in suit; if all higher: not last → lowest, last → highest (forced); void → discard max `rank + (spade?3:0) + (L≤2?1:0)`; leading → lowest card among suits where I hold a card ≤ 4 and no opponent is void, else lowest overall. After the nil fails, play as a 0-bid partner (avoid bags, feed partner's contract).
- *Partner nil:* leading → boss card if any, else highest of my longest suit; before partner → highest card of the led suit; after partner who is currently winning → lowest card that beats partner (trump if void); after partner who is safe → normal; void before partner with a low winner (≤ 9) in the trick → trump with the lowest spade.
- *Opponent nil (unbroken):* leading → lowest card (≤ 7) in the suit with the most unseen cards the nil bidder hasn't shown void in; following before the nil bidder with a low winner (≤ 8) → highest card below it; after the nil bidder has safely played → normal.
- Bag knob: Marcus treats `need ≤ 1` as made when team bags ≥ 6.

**Weaknesses on purpose:** one-trick lookahead (no rollouts), binary bag logic, no bid-based inference (a 5-bidder's A♠ is not inferred), mechanical nil cover, threshold nils.

### 6.4 Expert (`expert`) — Vega, Prof. Okafor, Sable

**Determinism policy (decisive).** The Expert uses **fixed world counts** in every mode: play 60 worlds (200 when ≤ 5 cards remain), bidding 40 worlds; fast/test mode uses the **same counts** (`?worlds=` can lower them for plumbing tests; skill gates never run below production counts). A wall-clock **safety cap** of 1200 ms per decision exists only to protect a frozen machine; if it trips, `lastThought.budgetHit=true` is recorded and exposed in `getState().ai.budgetHits`. With the cap untripped, `?seed` replays bot decisions bit-for-bit in every mode. Measured cost (~140 µs per heuristic rollout) puts a 6-candidate × 60-world play decision at ≈ 50 ms and a bid at ≈ 60 ms, well inside the persona think delay.

**Bidding (MC EV).** Sample bid-consistent worlds; unbid seats get Intermediate-formula bids on their sampled hands. Per world run two rollouts with `heuristicPlay` for all seats: (a) NORMAL, record team tricks `T_w`; (b) NIL (I bid nil, partner covers), record `made_w` and bags. Candidates `b ∈ [max(1, floor(E−1.5)) … ceil(E+1.5)] ∪ {sureTricks}`. `EV_b = mean_w[ scoreHand(with bid b, T_w, current bags).total − 9·bagsAdded (skipped when the −100 cliff was charged) + 1000·[our score + total ≥ target and ahead] − 1000·[their expected total reaches target while ours does not] ]`. `EV_nil = mean_w[ nilBonus·(made_w ? +1 : −1) + partner contract result − 9·bags ]`. Bid nil if `EV_nil > max_b EV_b + nilMargin` (default +5; Vega +15; Sable −10). Else `argmax EV_b` (ties → lower). Never below `sureTricks`. Team bags ≥ 7 → do not shade on borderline. **Blind nil** (option on, eligible): only when opponents' score + 50 ≥ target and our score + 60 < target. Fallback if the cap trips before 16 worlds: Intermediate formula, shade .4.

**Play (PIMC with vetoes and pruning).**
1. `legal = legalPlays`; one card → play it.
2. **Hard vetoes** (deterministic, tested): (a) own nil, 4th seat: never play a winning card when a non-winning one exists; (b) 4th seat, partner (not nil) already winning: never overtake or trump; (c) opponent nil unbroken and I play before the nil bidder with the current winner ≤ 8: never raise the winner above my lowest card under it unless need > 0 and tricksRemaining ≤ need; (d) partner nil, I can overtake partner's currently winning card: never play under it.
3. **Equivalence pruning** (`distinctCandidates`): cards of one suit adjacent among (my hand ∪ unseen) are one class — keep the lowest (the highest when the whole class cannot win, i.e. a dump). Cap at 6 candidates using `heuristicPlay`'s ranking.
4. **Worlds:** 60 (200 endgame) from the weighted, bid-consistent sampler. For each world × candidate: `stateFromView` → `playCard(candidate)` → `heuristicPlay` for every seat to hand end (each seat sees only its own view) → `U = ourHandTotal − theirHandTotal` from `scoreHand` with real bids and current bags, −9 per bag we add, +9·`oppBagWeight` per bag they add (skipped for a side whose cliff was charged), **±1000** if the resulting scores end the game in our/their favour, + `setBonus` (Sable +20) when the opponents are set.
5. Pick the highest mean `U`; ties → `heuristicPlay`'s choice, then the lower card.
6. Minimum visible think 400 ms (0 in fast) so the bot feels like a person.

`?debug=1` shows a panel with per-candidate mean U, world count, budget hits and the tracker's voids.

**Emergent, unit-tested behaviours:** covers partner's nil, forces a nil bidder to win with low leads and under-plays, dumps winners once made, feeds tricks to opponents sitting at 8–9 bags, keeps the last high spade for the trick that matters, leads through a void-marked opponent to make partner's trumps good, protects a game-winning lead.

**Accepted limits:** PIMC strategy fusion (no bluffing, undervalues information leads); rollouts model all seats as Intermediate, so a Beginner partner is flattered.

### 6.5 Simulation harness (`scripts/simulate.js` + `src/ai/simulate.js`)

```
node scripts/simulate.js --games 200 --seed 1 --seats expert,solid,expert,solid
node scripts/simulate.js --matrix --games 200 --json out/sim.json
```
Flags: `--games`, `--seed`, `--seats` (by seat 0..3), `--matrix` (S vs R, E vs S, E vs R, three mirror matches, plus each personality vs its tier baseline), `--worlds/--bidSamples` (default = production 60/40), `--target` (default 500), `--json`. Output per pairing: win rate with 95% Wilson CI, points/hand, set rate, bags/hand, nil attempts/success, blind nils, mean and p95 decision time per tier, `assertInvariants` violations (must be 0: 52 cards accounted for after every event, `tricksWon` sums to `tricks.length`, `turn === null` iff not bidding/playing, `spadesBroken` iff a spade has been played on a non-spade lead).

**Acceptance gates (CI, `npm run sim -- --matrix --games 200`, production counts):** Expert vs Intermediate ≥ 65%; Intermediate vs Beginner ≥ 70%; Expert vs Beginner ≥ 85%; mirrors within 50 ± 10; Expert set rate ≤ 15% of hands; Expert nil success ≥ 60%; Beginner pair ≥ 2.5 bags/hand; Expert bags/hand ≤ Intermediate; each personality within ±5 pts of its tier baseline; Expert mean decision ≤ 150 ms in Node. The unit-test smoke (`tests/unit/ai.test.js`) runs 20 games at 16 worlds asserting only Expert > Beginner > 55% and legality — it is a plumbing check, not the skill proof. Also: 20 seeded games run twice must produce identical event logs.

---

## 7. Coach prompt system

**Levels.** `Off` — no bubbles, no Hint, no suggestion tag (illegal-card fade/tooltip/shake/toast and the status line remain: they are game UI). `Rules only` — prompts tagged RULE, bubble has only `×`, no Hint, no bid tag. `Full` — RULE + STRATEGY, `Coach: n` bid tag with `Why?`, Hint button, idle hint (after 6 s on the human's turn, the card `heuristicPlay` would play lifts 6 px with a dotted gold outline; never auto-plays), hand-summary and game-over notes.

**Source of truth.** `coach(view, ctx, settings, shownCounts) → {id, level, text, why?} | null` is a pure function in `src/coach/coach.js` evaluated after every commit; copy lives in `src/coach/tips.js`. Every suggestion (bid tag, Hint, idle hint, `Why?`) comes from the **Intermediate** policy (`estimateTricks`, `heuristicPlay`), so the Expert never plays the human's hand and Hint and advice can never disagree.

**Display and limits.** One bubble at a time, at most one new bubble per trick and one per bidding round, only when `data-animating=false`, never blocking input. Info prompts auto-dismiss 400 ms after the action they describe or after 8 s; error prompts (illegal click) dismiss on the next legal play or after 6 s, never longer. Each id has `maxShows` (RULE ids 3, ONCE ids 1, EACH ids ∞ within its own condition; `set-chance`, `bag-danger`, `opponent-nil`, `partner-nil` once per hand). `Got it` counts as shown; `Don't show again` sets the count to ∞. Counts persist in `spadesNight.settings.v1.coachSeen`; `Reset tips` clears them. `getState().coach.shownThisHand` exposes the per-hand count for tests (asserted ≤ 6). Text ≤ 45 words, present tense, filled from state (`{partner}`, `{west}`, `{card}`, etc.).

**Toggle surfaces.** Lobby buttons set the level; header Coach pill and `C` key cycle Full → Rules → Off; Settings drawer; `?coach=0|1|2`; `Turn off tips` link in the bubble. All write the same `settings.coach`.

**Prompt table (id · level · cadence · copy).**

| id | level | cadence | copy |
|---|---|---|---|
| `welcome` | STRATEGY | ONCE, after the first deal | "Welcome to the table. Your partner is {partner}, across from you. {west} and {east} are the other team. First, everyone says how many tricks they think they'll win — that's the bid." |
| `what-is-a-trick` | RULE | ONCE, first bot bid | "{bidder} bid {n}. A trick is one round where all four of us play a card; the highest card of the suit led wins it, unless someone plays a spade. There are 13 tricks in a hand." |
| `your-first-bid` | RULE | ONCE, panel enables | "Your turn to bid. Count your sure winners: aces, kings with a backup card, and spades beyond your third. Bidding {n} looks right." (Full: `Coach: {n}` tag; `Why?` → "Sure: A♠, K♠. Likely: A♥. Maybe: 5 clubs.") |
| `bid-suggest` | STRATEGY | EACH bid (Full only) | Tag only: "Coach: {n}" + `Why?` (Sure / Likely / Maybe). Clicking the tag bids {n}. |
| `nil-explain` | RULE | max 3, on Nil hover/focus, or first bot nil | "Nil means promising to win zero tricks. Make it: +100. Take even one trick: −100. Best with low cards and few spades; your partner will try to win the tricks over you." |
| `blind-nil` | RULE | EACH eligibility | "You're behind by {deficit}, so you may bid Blind Nil before looking: +200 if you take no tricks, −200 if you take any. It's a long shot — most players look at their cards." |
| `team-target` | RULE | ONCE, after all bids | "{partner} bid {p} and you bid {b}, so your team needs {p+b} tricks for {10·(p+b)} points. Every trick past that is a bag; bags cost 100 when you reach 10." |
| `first-lead` | RULE | ONCE, first human lead | "You lead. Everyone must follow your suit if they can. Spades can't be led until spades are broken — that's why your spades are faded." |
| `must-follow-suit` | RULE | max 3, illegal click | "{suit} were led and you still hold {suit}, so you must play one. The faded cards aren't allowed this trick." |
| `spades-not-broken` | RULE | max 3, illegal spade lead | "Spades aren't broken yet — nobody has played a spade on another suit. You can't lead one until then, unless spades are all you have left." |
| `only-spades-left` | RULE | ONCE | "You only have spades left, so you're allowed to lead them." |
| `void-choice` | RULE | ONCE, first void | "You have no {suit}, so you may play anything. A spade beats every {suit} — that's trumping. If you don't need the trick, throw a low card from another suit instead." |
| `partner-winning` | STRATEGY | max 3, partner winning & you are 4th seat (3rd seat only if partner's card is boss) | "{partner}'s {card} is winning this trick and nobody can beat it. Play your lowest card and keep your good ones." |
| `about-to-trump-partner` | STRATEGY | max 3, hovering a spade while partner is winning | "{partner} is already winning this trick. Trumping it wastes a spade — play a low card instead." |
| `spades-broken` | RULE | ONCE (toast every hand) | "{seat} just trumped with the {card}, so spades are broken. From now on anyone may lead spades." |
| `trumped` | RULE | ONCE, your high card trumped | "Your {card} was trumped by {seat}'s {spade}. A spade always beats a non-spade, which is why aces in long suits are risky to count on." |
| `bid-made` | STRATEGY | once per hand | "You've made your bid of {n}. Every extra trick from here is a bag — 10 bags cost 100 points. Try to lose the rest, unless you can set {west} & {east}." |
| `bag-danger` | STRATEGY | once per hand, bags ≥ 8 & made | "Careful: {bags} bags. {10−bags} more and you lose 100. Duck tricks when you can." |
| `set-chance` | STRATEGY | once per hand | "{west} & {east} need {k} more tricks with only {r} to play. Win one and they go SET — that costs them {10·bid} points." |
| `set-risk` | STRATEGY | once per hand | "Your team bid {b} and has {t} with {r} tricks left. You need {b−t} of them or you lose {10·b} — win everything you can." |
| `partner-nil` | STRATEGY | once per hand | "{partner} bid nil and needs zero tricks. Help by playing HIGH before them and winning tricks they'd otherwise be stuck with. Lead your strong suits." |
| `opponent-nil` | STRATEGY | once per hand | "{seat} bid nil. To bust it, lead LOW cards in suits {seat} probably still holds and force them to win a trick. One is all it takes." |
| `partner-blunder` | STRATEGY | ONCE (Beginner partner only) | "{partner} trumped your ace — beginners do that. Save your winners for after their spades are gone." |
| `your-turn` | RULE | hand 1 only, each human turn | "Your turn. Tap a bright card to play it." |
| `last-trick` | RULE | ONCE | "Last trick. Everyone has one card left, so it plays itself." |
| `summary-bags` / `summary-set` / `summary-nil` / `summary-bagged` | STRATEGY | each summary where relevant (one line) | "You bid {b} and took {t}: {10·b} points plus {t−b} bag(s). Bags carry over — aim to land your bid exactly." / "You bid {b} and took {t}: SET. You lose the whole bid, −{10·b}." / "Nil made! +100 for {partner}, on top of your {10·b}." / "Ten bags: −100. Ducking tricks once your bid is made avoids this." |
| `game-note` | STRATEGY | game over | "Your bids were within one of actual on {k} of {n} hands. Next step: {tip}" where tip ∈ {try a nil when you have no aces or kings; duck once your bid is in; lead low into a nil}. |
| `hint` | STRATEGY | on Hint click (Full) | "Suggested: {card} — {reason}" with reason from `heuristicPlay` ("you can't win this trick, keep your high cards" / "cheapest card that wins" / "forces the nil bidder"). |

Always-on (not coach): illegal-click toast `Must follow suit (♥)` / `Spades aren't broken yet`; status line copy.

---

## 8. Rules & options

**Standard partnership Spades.** Four players, fixed partnerships (seats 0+2 vs 1+3), 52 cards, 13 each dealt one at a time from the dealer's left; dealer rotates clockwise (`startHand`). **Hand 1 dealer:** the human (`firstDealer: 0`) on a first-run game only, so the beginner watches three bids first; otherwise random from the seed. Bidding: one round clockwise from the dealer's left; bids 0 (nil) to 13; team bid = sum of partners' non-nil bids; no passing or re-bids. Play: the player left of the dealer leads trick 1; must follow suit if able; spades always trump; highest spade wins, else highest card of the led suit; trick winner leads next. Breaking spades: spades may not be led until a spade has been played on a non-spade lead, unless the leader holds only spades (engine `legalPlays`).

**Scoring (engine `scoreHand`).** Made team bid: +10 × bid, +1 per overtrick; each overtrick is a bag. Failed: −10 × bid, no bags. Bags accumulate; each time a team reaches 10 it loses 100 and the counter rolls over with the remainder. **Nil:** +100 made / −100 failed; a failed nil's tricks count toward the partner's bid (`nilTricksHelpPartner`, default on) and always count as bags. **Blind nil:** ±200, declared before seeing cards, only when behind by ≥ 100 (`blindNilMinDeficit`). Double nil: every trick is a bag. Game ends when a team reaches the target at the end of a hand; if both do, higher wins; tie → another hand.

**House rules (locked during a game; map 1:1 to `DEFAULT_OPTIONS`; UI defaults in bold):**

| Option | Values | Engine key |
|---|---|---|
| Target score | 250 / **500** | `targetScore` |
| Lose at −200 | **off** / on | `losingScore` |
| Bag penalty | **on (10 = −100)** / off | `bagPenaltyAt` 10 / 0 |
| Nil bids | **on** / off | `allowNil` |
| Blind nil | **off** / on (the UI overrides the engine default `true`) | `allowBlindNil` |
| Failed-nil tricks help partner | **on** / off | `nilTricksHelpPartner` |
| Ten for two hundred | **off** / on | `tenForTwoHundred` |

Deliberately not offered: jokers/deuces variants, board bid, "lead spades anytime", first-trick trump restriction, renege penalties, a separate `0` bid, undo, multiplayer.

**Experience settings (live, persisted):** Coach Off / Rules only / **Full**; Speed **Normal** / Fast / Instant; Sound **on** + volume; Bot chatter **on**; Spade tracker **Auto** / On / Off; Reduce motion **Auto** / On / Off; Four-colour deck off; Large cards off; Confirm plays with second tap (**on for coarse pointers**); Auto-play forced cards off.

---

## 9. Accessibility & robustness

**Keyboard.** Tab reaches the hand as one composite widget (roving tabindex over legal cards); ←/→ move the selection, Enter/Space plays; digits `1–9`, `0`, `-`, `=` select hand slots 1–13 left to right. Bidding: `N` nil, `1–9`, `0` = 10, ←/→ + Enter for any value (11–13 reachable by arrows), `B` blind nil when offered. `Enter` advances the summary; `H` hint; `C` cycles coach; `M` mute; `L` last trick; `?` rules; `Esc` closes overlays; any key skips the trick hold. Focus is trapped in overlays and restored on close. Every control ≥ 44 px hit target.

**Screen readers.** Cards are `<button>`s with `aria-label` ("Queen of spades, playable" / "Seven of hearts, not playable: must follow suit"); status line `role=status`; coach bubble `aria-live=polite`; stamps have visually-hidden text.

**Colour.** Team colours always paired with names; suits distinguished by glyph shape; four-colour deck option.

**Motion.** `prefers-reduced-motion` and the Reduce-motion setting map to the reduced policy in §4.5.

**Persistence & resume (`src/app/persist.js`).** Key `spadesNight.save.v1` = `{v:1, savedAt, config:{lineup, options, seed, firstRun}, game: engineState}`, written at every `commit()` (never mid-animation). Settings in `spadesNight.settings.v1`, lifetime record in `spadesNight.record.v1`. On load, the table is rebuilt statically (current trick already on the felt, no deal animation), controller state is re-derived by `advance()`; bot RNG streams are derived from `seed:ai:seat:hand`, so a resumed game plays identically. `?seed` present → always a fresh game; `?reset=1` clears all keys. Corrupt save → discard + toast.

**Fast mode.** `?fast=1`: speed Instant, bot think 0, trick hold 50 ms, sound off, confetti off, watchdog 1.5 s; Expert world counts unchanged (override with `?worlds=`). `?autoplay=1`: the human seat is played by `heuristicPlay` and the summary auto-advances — the full-game no-soft-lock smoke test.

**Robustness.** No `Math.random` anywhere (lint test greps `src/`); no `Date.now` in decision paths except the safety cap; Set/Map iteration never affects decisions (candidates are sorted by card id); AudioContext unlock on first gesture; `window.onerror` logs to `__spades.errors` and the watchdog keeps the game moving.

---

## 10. Testability hooks

**URL parameters** (read in `src/app/url.js`): `seed`, `fast=1`, `coach=0|1|2`, `table=casual|standard|tournament`, `bots=dee,marcus,vega` (partner, west, east), `target=100`, `options=blindNil:1,bags:0,tenFor200:1,loseAt:-200`, `autoplay=1`, `worlds=N`, `bidSamples=N`, `debug=1`, `reset=1`, `skipLobby=1` (implied by `seed`).

**Root attributes:** `<html data-phase=idle|bidding|playing|handOver|gameOver data-turn=0..3|none data-controller=<FSM state> data-animating=true|false data-spades-broken=true|false data-coach=0|1|2 data-fast=true|false data-trick=n>`.

**`data-testid` inventory:** `lobby`, `lobby-new`, `lobby-veteran`, `lobby-customize`, `lobby-play-again`, `resume`, `discard-save`, `start-game`, `screen`, `table`, `status`, `scoreboard`, `score-us`, `score-them`, `bags-us`, `bags-them`, `spade-tracker`, `seat-{0..3}`, `seat-{n}-bid`, `seat-{n}-tricks`, `seat-{n}-fan`, `dealer-badge`, `hand`, `hand-card-{code}` (`code` = `cardToString`, e.g. `hand-card-AS`, `hand-card-10H`), `trick`, `trick-card-{seat}`, `bid-panel`, `bid-btn-{1..13}`, `bid-nil`, `bid-blind-nil`, `blind-nil-choice`, `bid-suggested`, `bid-why`, `coach-prompt` (+`data-coach-id`), `coach-dismiss`, `coach-never`, `coach-why`, `coach-toggle`, `hint-btn`, `turn-ribbon`, `illegal-toast`, `toast`, `quip-{seat}`, `stamp`, `last-trick-btn`, `last-trick-panel`, `hand-summary`, `summary-row-{team}-{field}`, `trick-review`, `next-hand-btn`, `game-over`, `winner-banner`, `rematch-btn`, `change-table-btn`, `copy-seed-btn`, `settings-btn`, `settings-panel`, `option-{name}`, `rules-btn`, `rules-panel`, `menu-btn`, `quit-btn`.

**`window.__spades` debug API** (always present; mutating calls are guarded to `?fast=1|debug=1` or `localhost`): `getState()` (deep copy of engine state incl. hidden hands, plus `coach.shownThisHand`, `ai.budgetHits`, `controller`), `getView(seat)`, `legalMoves()`, `play('AS')` / `bid(3)` / `bid(0,{blind:true})` (perform the human action as if clicked; return engine events or the same error string the UI shows), `nextHand()`, `rematch()`, `setCoach(level)`, `setSpeed('instant')`, `dismissCoach()`, `whenIdle()` (Promise resolved when `data-animating=false` and the controller is waiting on the human or is `HAND_OVER`/`GAME_OVER`), `waitFor(phase | predicate)`, `rig(handsAsStrings)` (force the next deal's hands for scenario tests), `ai.decide(seat)` (choice + reason without playing), `events` (array of all engine events), `on(event, cb)`, `errors`, `version`, `ready` (Promise).

**Determinism contract:** same seed + same options + same human actions ⇒ identical `getState()` after each action, in every mode, unless `ai.budgetHits > 0`. A Playwright test replays a recorded action log and asserts final scores; a Node test runs 20 games twice and diffs event logs.

**Unit tests (`npm test`, `tests/unit/**/*.test.js`):** existing 38 stay green; add `estimateTricks` calibration, `nilDanger` disqualifiers, `sureTricks` floor for every tier, Proxy-based view-only test, hard vetoes on rigged hands, sampler void/size/weight properties, `distinctCandidates`, FSM/watchdog with fake sequencer, persist round-trip and rejection, coach purity (`null` when off, `maxShows` respected, never the same id twice per trick), scoring edge cases (nil + set same hand, both teams cross target, bag remainder, double nil, ten-for-200), `Math.random` lint.

**E2E (`npm run e2e`, Playwright, against `scripts/serve.js` and `dist/spades.html` via `file://`, at 1280×800 and 1024×700):** full seeded game `?seed=7&fast=1&target=100&autoplay=1` to `game-over`; illegal spade lead → `coach-prompt[data-coach-id=spades-not-broken]` and the card still in hand; must-follow-suit; one-tap bidding and keyboard bidding; blind-nil choice appears only with the option on and a deficit; refresh mid-trick → `data-phase`, trick cards and hand match the pre-reload snapshot, then finish the hand; coach Off persists and hides the slot; keyboard-only hand; reduced-motion emulation registers no transform animations; no horizontal scroll and all hand cards in viewport; summary rows equal `scoreHand` output from `getState().lastHand`; zero external requests (`page.route` assertion); screenshots of lobby / bidding / mid-trick / summary / game over for visual regression.

---

## 11. Module / file layout

```
index.html                     dev entry: <link styles.css> + <script type=module src=src/main.js>
src/
  main.js                      boot: url → settings → persist → lobby or table
  styles.css                   all CSS (tokens above); the only stylesheet
  engine/                      UNCHANGED (rng, cards, scoring, game, view, index)
  ai/
    analysis.js                analyze() → Tracker (+voids, boss, noSpadesLikely, need, position); cardDanger
    bidding.js                 estimateTricks (calibrated), sureTricks, nilDanger, rookieBid, solidBid, expertBid
    play.js                    rookiePlay, heuristicPlay (alias solidPlay), legalFromView
    montecarlo.js              sampleHands (weights + bid filter), rollout, evaluate (±1000, bag shaping), monteCarloPlay (vetoes, pruning), monteCarloBid (EV incl. nil)
    bots.js                    createBot(tier,{seed,knobs,worlds,bidSamples}) with decideAsync slicing
    simulate.js                playGame, runSeries (Wilson CI, invariants, timings), formatSeries
    index.js
  coach/
    coach.js                   pure coach(view, ctx, settings, shownCounts)
    tips.js                    copy table with ids, levels, cadences
  app/
    roster.js                  characters + knobs + PRESETS (casual/standard/tournament)
    controller.js              FSM, advance(), in-flight token, watchdog
    seq.js                     sequencer: awaited steps, --t, transitionend+timeout, cancelAll, data-animating
    presenter.js               stamp > sweep > quip > coach > toast channels
    store.js                   state, commit(), subscribe()
    persist.js                 versioned save/load, settings, record
    settings.js                defaults, speed factors, reduced motion resolution
    url.js                     URL params
    debug.js                   window.__spades
  ui/
    cards.js                   (exists) suit sprite, cardEl; add deco faces, signature ace, four-colour
    avatars.js                 (exists)
    lobby.js  table.js  nameplates.js  hand.js  bidPanel.js  scoreboard.js  trick.js
    coachSlot.js  overlays.js (summary, gameover, settings, rules, menu)  fx.js (FLIP flights, stamps, confetti)
    sound.js  a11y.js (roving tabindex, focus trap, live region)
scripts/
  serve.js                     static dev server (ES modules)
  build.js                     esbuild IIFE bundle (minify) + inline JS/CSS into dist/spades.html;
                               asserts: no http(s):// in src/href, no <link rel=stylesheet>, no <img>, < 400 KB,
                               then boots dist via Playwright with ?fast=1&autoplay=1&target=100 to game over
  simulate.js                  CLI for the harness (--games --seed --seats --matrix --json --worlds)
tests/
  unit/                        engine.test.js, ai.test.js (extended), coach.test.js, controller.test.js, persist.test.js, lint.test.js
  e2e/                         *.test.js Playwright specs + README of testids
dist/spades.html               build output (single self-contained file)
```

Rules: named exports only, no circular imports, no DOM access outside `src/ui` and `src/app`, `src/engine` + `src/ai` + `src/coach` run in Node. Single-file build is `esbuild` (already a devDependency), never a hand-rolled import stripper.

---

## 12. v1 scope cut line

**Must ship (not negotiable):** engine untouched and green; AI refactor with calibrated estimator, weighted/bid-consistent sampler, vetoes + pruning, ±1000/bag-shaped utility, fixed world counts; harness gates passing at production counts; controller FSM with token + watchdog; view-only bot test; persist/resume; one-question lobby + Table Setup with three presets and Custom; full table UI with three-channel turn indication, illegal-card fade/tooltip/shake, hollow bag pips, bag meter, nil shield, status line; one-tap bid panel (no confirm, no `0`); face-down blind-nil flow (option default off); trick hold → pulse → sweep → pip loop with click/key skip; receipt-style hand summary with stamps and `[Next hand]` (no auto-advance); game over with stats, calm loss, Rematch, Copy seed; coach with three levels, the prompt table, `Why?`, Hint, idle hint, show-caps; sequencer with `--t`, `data-animating`, reduced motion; WebAudio cue table; keyboard play; `esbuild` single-file build with the zero-external-URL check; Playwright suite at both viewports against both builds.

**Ship if time allows, in this order:** Spade tracker → trick review list in the summary → session achievements → lifetime record → confetti → four-colour deck / large cards → Okafor's tracker-fed `fact` quips → hand-by-hand bar strip.

**Cut first if behind (reverse order of the list above), and never cut:** the FSM/watchdog, the illegal-card affordance, turn indication, the harness gates, the one-tap bid panel, or persist/resume.

**Explicitly out of v1:** Web Worker AI, undo, drag-and-drop, 3D card flips, spotlight overlay, digit-flip scoreboard, breathing hand fan, nil heartbeat audio, 6-second auto-continue, jokers/deuces variants, board bid, multiplayer, custom avatars, hand-history export.

**Two-day plan (one engineer).** Day 1 AM: AI refactor + calibration test + harness matrix at production counts. Day 1 PM: controller/seq/store/persist, static table, bidding and play with zero animation, `?autoplay` smoke in Playwright. Day 2 AM: animations via the sequencer, trick loop, bid panel, hand summary, game over, coach + tips. Day 2 PM: lobby/setup, settings/a11y, sound, roster polish, `build.js`, full e2e at both viewports, tuning pass from the matrix output.
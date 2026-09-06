# Roadmap and open items

Items carried over from the release review. Each is a good candidate for a GitHub issue; pick one, comment that you're on it, and open a pull request.

## Reviews that never finished

The release review ran five playtester personas and three code reviewers. Four reports were completed and acted on (newcomer, veteran, visual designer, QA). These four never reported and their angles have had only the maintainer's own pass:

- [ ] **Accessibility review** — keyboard-only play through a full game, screen-reader semantics (roles, `aria-live`, card labels), contrast of muted text on glass, `prefers-reduced-motion`, hit-target sizes at 1024×700.
- [ ] **Rules-fidelity review** — an independent read of `src/engine/` against pagat.com conventions, especially option interactions (failed-nil tricks helping the partner × bags, double nil, ten-for-200 with a nil partner, tie at target).
- [ ] **AI review** — a second pair of eyes on `src/ai/`: the solid policy's want-trick logic, nil defence, `sampleHands` bid conditioning, `evaluate()` bag pricing, and whether the expert has exploitable habits.
- [ ] **Robustness review** — race conditions between the async loop and input, resume in every phase, localStorage failure modes, listener leaks in dialogs.

## Known gaps

- [ ] **Portrait phones** show a "turn your device" notice. A compact layout for aspect ratios under ~1.2 would make the game playable on a phone.
- [ ] **Coach levels.** Only On/Off exists. The design spec describes Off / Rules only / Full; "Rules only" (no strategy nudges, no suggested bid) would suit players who know the game but not this app.
- [ ] **Score history** could show per-hand bars and a "biggest swing" stat.
- [ ] **Four-colour deck and large cards** options for readability.
- [ ] **Session achievements** (Perfect Nil, Iron Wall, Bagged 'Em) and a lifetime record beyond won/lost/nils.
- [ ] **Expert bidding with a rookie partner.** The expert assumes its partner plays soundly when it evaluates nil; paired with a rookie its nil success drops from ~89% to ~45%. Conditioning on the partner's observed skill (or bid history) would fix it.
- [ ] **Web Worker for the expert.** Rollouts run on the main thread inside the bot's think delay. They finish in well under the delay today, but a worker would keep animations perfectly smooth on slow machines.
- [ ] **Sound design pass.** Cues are synthesized and functional; a musician could make them lovely.
- [ ] **Localization.** Copy is concentrated in `coach.js`, `roster.js`, `dialogs.js` and `controller.js` status strings but there is no string table yet.
- [ ] **Undo of an accidental card click** (a short grace window before the flight commits) was requested by the QA reviewer.
- [ ] **Auto-play forced cards** setting for the single-legal-card case (the last card already plays itself).

## Ideas

- Online play with a friend as your partner (the engine is already seedable and serializable).
- A "why did the bot do that?" explainer using the expert's rollout statistics.
- Tournament mode: a series of games against all three tables with a running record.

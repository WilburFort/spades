// End-to-end tests: the game running in real Chromium.
//   npm run e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { launchBrowser, startServer, openGame, state, waitForHuman } from './helpers.js';

let browser, server;
before(async () => {
  browser = await launchBrowser();
  server = await startServer();
  execFileSync('node', ['scripts/build.js'], { stdio: 'ignore' });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const url = (q, path = '/') => `${server.url}${path}?${q}`;
const clickCard = (page, c) => page.click(`[data-testid=hand-card-${c}] .card`, { position: { x: 14, y: 60 } });

test('an unattended game runs to completion with no console errors', async () => {
  const { page, errors, context } = await openGame(browser, url('autostart=1&autoplay=1&fast=1&seed=42&talk=0&sound=0&target=120'));
  const deadline = Date.now() + 120000;
  let s = null;
  while (Date.now() < deadline) {
    s = await state(page);
    if (await page.$('[data-testid=btn-continue]')) await page.click('[data-testid=btn-continue]');
    if (await page.$('[data-testid=game-over]')) break;
    await page.waitForTimeout(150);
  }
  assert.ok(await page.$('[data-testid=game-over]'), 'game over screen should appear');
  s = await state(page);
  assert.equal(s.phase, 'gameOver');
  assert.ok(Math.max(...s.scores) >= 120);
  assert.ok(s.history.length >= 1);
  assert.deepEqual(errors, []);
  // Play again starts a new game
  await page.click('[data-testid=btn-again]');
  await page.waitForFunction(() => globalThis.__spades.getState()?.handNumber === 1, null, { timeout: 15000 });
  await context.close();
});

test('the human bids with the keyboard, illegal cards are refused with feedback, legal cards play', async () => {
  const { page, errors, context } = await openGame(browser, url('autostart=1&fast=1&seed=7&talk=0&sound=0'));
  let s = await waitForHuman(page, 'bid');
  assert.equal(s.turn, 0);
  assert.ok(await page.$('[data-testid=bidpanel]'));
  await page.keyboard.press('3');
  s = await waitForHuman(page, 'play');
  assert.equal(s.bids[0], 3);
  assert.equal(await page.$('[data-testid=bidpanel]'), null, 'bid panel closes');
  // Illegal card: state unchanged, toast + shake
  const illegal = s.hands[0].find((c) => !s.legal.includes(c));
  assert.ok(illegal, 'seed 7 gives a hand with an illegal choice on the first play');
  const slotClass = await page.getAttribute(`[data-testid=hand-card-${illegal}]`, 'class');
  assert.match(slotClass, /illegal/);
  const opacity = await page.$eval(`[data-testid=hand-card-${illegal}] .card`, (el) => getComputedStyle(el).opacity);
  assert.ok(Number(opacity) < 0.8, `illegal card should be dimmed, got opacity ${opacity}`);
  await clickCard(page, illegal);
  await page.waitForTimeout(150);
  const s2 = await state(page);
  assert.equal(s2.hands[0].length, s.hands[0].length, 'illegal click does not play');
  // One explanation: the coach bubble when tips are on, otherwise the toast.
  const explained = await page.evaluate(() => {
    const coach = document.querySelector('[data-testid=coach]');
    const toast = document.querySelector('[data-testid=toast]');
    return (coach.classList.contains('show') && /follow suit|broken/.test(coach.textContent)) || toast.classList.contains('show');
  });
  assert.ok(explained, 'the rule is explained');
  // Legal card plays
  await clickCard(page, s.legal[0]);
  await page.waitForFunction((n) => globalThis.__spades.getState().hands[0].length === n - 1, s.hands[0].length, { timeout: 5000 });
  const s3 = await state(page);
  assert.ok(s3.trick.some((p) => p.seat === 0 && p.card === s.legal[0]) || s3.tricks.length === 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a risky bid asks for a second tap when the coach is on, and never when it is off', async () => {
  // Seed 16 deals the human two aces: Nil is a blunder there.
  const { page, context } = await openGame(browser, url('autostart=1&fast=1&seed=16&talk=0&sound=0&coach=1'));
  await waitForHuman(page, 'bid');
  await page.click('[data-testid=bid-nil]');
  await page.waitForSelector('[data-testid=bid-warning]');
  let s = await state(page);
  assert.equal(s.bids[0], null, 'the risky bid is not placed yet');
  await page.click('[data-testid=bid-confirm]');
  s = await waitForHuman(page, 'play');
  assert.equal(s.bids[0], 0, 'confirming places the Nil');
  await context.close();
  const second = await openGame(browser, url('autostart=1&fast=1&seed=16&talk=0&sound=0&coach=0'));
  await waitForHuman(second.page, 'bid');
  await second.page.click('[data-testid=bid-nil]');
  const s2 = await waitForHuman(second.page, 'play');
  assert.equal(s2.bids[0], 0, 'with the coach off, one tap bids');
  assert.equal(await second.page.$('[data-testid=bid-warning]'), null);
  await second.context.close();
});

test('coach prompts appear, can be turned off from the bubble, and stay off after reload', async () => {
  // No preference flags in the URL: those are run-only and deliberately never persisted.
  const { page, context } = await openGame(browser, url('autostart=1&seed=11'));
  await waitForHuman(page, 'bid', { timeout: 30000 });
  assert.ok(await page.$eval('[data-testid=coach]', (el) => el.classList.contains('show')), 'coach shows a bid prompt');
  assert.ok(await page.$('[data-testid=bidpanel] .bidbtn.suggest'), 'suggested bid is tagged');
  await page.click('[data-testid=coach-off]');
  assert.equal(await page.$eval('[data-testid=coach]', (el) => el.classList.contains('show')), false);
  assert.equal(await page.$eval('[data-testid=btn-hint]', (el) => getComputedStyle(el).visibility), 'hidden', 'hint button hides when coach is off');
  // Persisted: reload without URL override
  await page.goto(`${server.url}/`);
  await page.waitForSelector('[data-testid=lobby]');
  const coachOn = await page.$eval('[data-testid=toggle-coach]', (el) => el.getAttribute('aria-checked'));
  assert.equal(coachOn, 'false');
  await context.close();
});

test('a game in progress survives a reload and resumes from the lobby', async () => {
  const { page, context } = await openGame(browser, url('autostart=1&fast=1&seed=5&talk=0&sound=0'));
  await waitForHuman(page, 'bid');
  await page.keyboard.press('2');
  let s = await waitForHuman(page, 'play');
  // Play three cards
  for (let i = 0; i < 3; i++) {
    s = await waitForHuman(page, 'play');
    await clickCard(page, s.legal[0]);
    await page.waitForTimeout(400);
  }
  s = await waitForHuman(page, 'play');
  const before = { hand: s.handNumber, cards: s.hands[0].length, tricks: s.tricks.length, bids: s.bids };
  await page.goto(`${server.url}/`);
  await page.waitForSelector('[data-testid=resume]');
  await page.click('[data-testid=btn-resume]');
  const after = await waitForHuman(page, 'play', { timeout: 20000 });
  assert.equal(after.handNumber, before.hand);
  assert.deepEqual(after.bids, before.bids);
  assert.ok(after.tricks.length >= before.tricks, 'trick count did not go backwards');
  assert.ok(after.hands[0].length <= before.cards);
  await context.close();
});

test('blind nil is offered before the cards are shown when far behind', async () => {
  const { page, context } = await openGame(browser, url('autostart=1&autoplay=0&fast=1&seed=9&talk=0&sound=0&target=1000'));
  await waitForHuman(page, 'bid');
  // Rig the score during the first hand and then finish the hand unattended via the debug API.
  await page.evaluate(() => {
    const c = globalThis.__spades.controller;
    c.state.scores = [0, 150];
  });
  await page.evaluate(() => globalThis.__spades.bid(2));
  // Auto-play the human's cards through the debug API until the hand ends.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const s = await state(page);
    if (s.phase === 'handOver' || s.phase === 'gameOver') break;
    if (s.pending === 'play') await page.evaluate((c) => globalThis.__spades.play(c), s.legal[0]);
    await page.waitForTimeout(60);
  }
  await page.waitForSelector('[data-testid=btn-continue]', { timeout: 20000 });
  await page.evaluate(() => {
    globalThis.__spades.controller.state.scores = [0, 150];
  });
  await page.click('[data-testid=btn-continue]');
  await page.waitForSelector('[data-testid=blindnil-panel]', { timeout: 20000 });
  assert.equal(await page.getAttribute('[data-testid=hand]', 'data-facedown'), 'true', 'cards are face down');
  await page.click('[data-testid=blindnil-look]');
  await page.waitForFunction(() => document.querySelector('[data-testid=hand]').dataset.facedown === 'false');
  await waitForHuman(page, 'bid');
  const s = await state(page);
  assert.equal(s.handNumber, 2);
  await context.close();
});

test('layout fits a 1024x700 laptop: no horizontal scroll and every hand card is on screen', async () => {
  const { page, context } = await openGame(browser, url('autostart=1&fast=1&seed=3&talk=0&sound=0'), { width: 1024, height: 700 });
  await waitForHuman(page, 'bid');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollW <= 1024, `page should not scroll horizontally (scrollWidth ${scrollW})`);
  const boxes = await page.$$eval('[data-testid=hand] .card', (els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  assert.equal(boxes.length, 13);
  for (const b of boxes) {
    assert.ok(b.left >= 0 && b.right <= 1024, `card within width: ${JSON.stringify(b)}`);
    assert.ok(b.top >= 0 && b.bottom <= 700 + 1, `card within height: ${JSON.stringify(b)}`);
  }
  await context.close();
});

test('the single-file build plays a complete game', async () => {
  const { page, errors, context } = await openGame(browser, url('autostart=1&autoplay=1&fast=1&seed=21&talk=0&sound=0&target=60', '/dist/spades.html'));
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await page.$('[data-testid=btn-continue]')) await page.click('[data-testid=btn-continue]');
    if (await page.$('[data-testid=game-over]')) break;
    await page.waitForTimeout(150);
  }
  assert.ok(await page.$('[data-testid=game-over]'), 'built game reaches game over');
  assert.deepEqual(errors, []);
  // No external resources were requested.
  const external = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(location.origin)));
  assert.deepEqual(external, []);
  await context.close();
});

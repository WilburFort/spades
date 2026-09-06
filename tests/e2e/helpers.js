// Shared Playwright helpers for end-to-end tests and playtest scripts.
import { chromium } from 'playwright';
import { createServer } from '../../scripts/serve.js';
import { existsSync } from 'node:fs';

const BUNDLED = '/opt/pw-browsers/chromium';

export async function launchBrowser(opts = {}) {
  const executablePath = process.env.CHROMIUM_PATH || (existsSync(BUNDLED) ? BUNDLED : undefined);
  return chromium.launch({ executablePath, ...opts });
}

/** Start the static server on an ephemeral port. Returns { url, close }. */
export function startServer() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** Open a page, collecting console errors and page errors into `errors`. */
export async function openGame(browser, url, { width = 1280, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`);
  });
  await page.goto(url);
  return { page, context, errors };
}

export const state = (page) => page.evaluate(() => globalThis.__spades.getState());

/** Wait until the game is waiting on the human for `kind` ('bid' | 'play' | 'blind') or the phase changes to one in `orPhases`. */
export async function waitForHuman(page, kind, { timeout = 15000, orPhases = [] } = {}) {
  await page.waitForFunction(
    ([k, phases]) => {
      const s = globalThis.__spades.getState();
      return !!s && (s.pending === k || phases.includes(s.phase));
    },
    [kind, orPhases],
    { timeout }
  );
  return state(page);
}

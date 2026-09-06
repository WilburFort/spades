#!/usr/bin/env node
// Bundle the game into one self-contained HTML file: dist/spades.html
// (no external scripts, styles, fonts or images).

import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await fs.mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text;
const css = await fs.readFile(path.join(root, 'src/styles.css'), 'utf8');
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');

const fontLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)?.[0] || '';
const out = html
  // The offline single file makes no network requests at all: drop the web font (the CSS has a serif fallback).
  .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/, '')
  .replace(/<link rel="stylesheet" href="src\/styles.css">/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script>\n${js}\n</script>`);

if (out.includes('src/main.js') || out.includes('src/styles.css') || out.includes('fonts.googleapis')) throw new Error('Build failed to inline assets');

await fs.writeFile(path.join(dist, 'spades.html'), out);
await fs.writeFile(path.join(dist, 'index.html'), out); // same file under the name static hosts expect
const size = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`dist/spades.html written (${size} KB)`);

// Fragment variant for hosts that wrap the page in their own <html>/<head>/<body>
// skeleton (e.g. Claude Artifacts): title + style + app root + script only.
const fragment = `<title>Spades Night</title>\n${fontLink}\n<style>\n${css}\n</style>\n<div id="app" data-phase="boot"></div>\n<script>\n${js}\n</script>\n`;
await fs.writeFile(path.join(dist, 'spades-artifact.html'), fragment);
console.log(`dist/spades-artifact.html written (${(Buffer.byteLength(fragment) / 1024).toFixed(0)} KB)`);

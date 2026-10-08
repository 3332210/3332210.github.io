#!/usr/bin/env node
/**
 * Write a "compact" copy of the site for review.
 *
 * The hero is `min-height: 100svh`, so a single full-page screenshot needs a
 * viewport taller than the page — and `svh` then grows with that viewport, so
 * the hero fills the entire capture and every section below it stays unseen.
 *
 * This emits `review.html` next to index.html with the hero height pinned, so
 * one screenshot shows the whole page. Same directory, so every relative path
 * (fonts, scripts, stats.json) keeps working untouched. Review aid only — the
 * real page keeps 100svh.
 *
 * Usage: node scripts/compact-view.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = resolve(HERE, '..', 'public');
const SRC = join(PUB, 'index.html');

if (!existsSync(SRC)) {
  console.error('run scripts/build.mjs first');
  process.exit(1);
}

const html = readFileSync(SRC, 'utf8');

/** Pins the hero and freezes the fixed elements so the page photographs flat. */
const OVERRIDE = `
<style>
  /* REVIEW ONLY. Flattens the composition into one capture. */
  .hero { min-height: 420px !important; }
  .hero-rail { padding-top: 104px !important; padding-bottom: 24px !important; }
  .field-wrap { position: absolute !important; inset: 0 0 auto 0 !important; height: 1200px !important; }
  .nav { position: absolute !important; }
  .cursor, .cursor-ring { display: none !important; }
  .reveal { opacity: 1 !important; transform: none !important; }
</style>
`;

writeFileSync(
  join(PUB, 'review.html'),
  html.replace('</head>', OVERRIDE + '</head>'),
);
console.log('wrote public/review.html — open /review.html for a flat view of every section');

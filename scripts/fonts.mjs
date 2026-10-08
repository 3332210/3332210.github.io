#!/usr/bin/env node
/**
 * Download the self-hosted variable fonts the site needs.
 *
 * Self-hosted, not a CDN: no external request at runtime, no layout shift, the
 * page works offline, and the licence files stay with the repo. These are all
 * SIL Open Font License families, so redistributing them is fine — keep the
 * OFL text alongside them.
 *
 * Usage: HTTPS_PROXY=http://127.0.0.1:7897 node scripts/fonts.mjs
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
/** Fonts live in assets/, not public/: public/ is wiped by every build. */
const OUT = join(SITE, 'assets', 'fonts');

/**
 * Each entry is a variable font (one file covers every weight). Sources are the
 * upstream GitHub release/raw URLs — raw.githubusercontent is reliable and the
 * files there are the canonical builds.
 */
const FONTS = [
  {
    file: 'inter-var.woff2',
    // rsms/inter ships variable builds in the repo itself.
    urls: [
      'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.woff2',
      'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter.var.woff2',
    ],
    licence: 'SIL Open Font License 1.1 — https://github.com/rsms/inter',
  },
  {
    file: 'archivo-var.woff2',
    urls: [
      'https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf',
    ],
    licence: 'SIL Open Font License 1.1 — https://github.com/google/fonts/tree/main/ofl/archivo',
  },
  {
    file: 'jetbrainsmono-var.woff2',
    urls: [
      'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/variable/JetBrainsMono%5Bwght%5D.ttf',
    ],
    licence: 'SIL Open Font License 1.1 — https://github.com/JetBrains/JetBrainsMono',
  },
];

mkdirSync(OUT, { recursive: true });

let ok = 0;
let failed = 0;

for (const font of FONTS) {
  const dest = join(OUT, font.file);
  if (existsSync(dest) && statSync(dest).size > 20_000) {
    console.log(`  have    ${font.file} (${(statSync(dest).size / 1024).toFixed(0)} KB)`);
    ok++;
    continue;
  }

  let done = false;
  for (const url of font.urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'inkward-site' } });
      if (!res.ok) {
        console.log(`  ${res.status}   ${url}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 20_000) {
        console.log(`  tiny  ${url} (${buf.length} B)`);
        continue;
      }
      writeFileSync(dest, buf);
      console.log(`  saved   ${font.file}  ${(buf.length / 1024).toFixed(0)} KB  <- ${url.split('/').slice(-1)[0]}`);
      done = true;
      ok++;
      break;
    } catch (e) {
      console.log(`  err   ${url} :: ${e.message}`);
    }
  }
  if (!done) {
    failed++;
    console.log(`  FAILED  ${font.file} — fallback stack will be used for this family`);
  }
}

writeFileSync(join(OUT, 'LICENCES.txt'), FONTS.map((f) => `${f.file}\n  ${f.licence}`).join('\n\n') + '\n');
console.log(`\n${ok} font(s) ready, ${failed} failed -> ${OUT}`);
console.log('All families are SIL OFL 1.1; LICENCES.txt records the provenance.');

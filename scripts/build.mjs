#!/usr/bin/env node
/**
 * Build the static site into public/.
 *
 * Usage: node scripts/build.mjs
 *
 * What it does:
 *   1. copies src/ into public/ (public/ is generated — never edit it)
 *   2. copies the self-hosted fonts
 *   3. distils the profile kit's generated stats.json into the small payload the
 *      page actually fetches, so the site cannot drift from the profile README
 *   4. stamps four variant entry points (en/zh × dark/light) that differ only in
 *      their <html> attributes, so GitHub Pages can serve a language-specific
 *      URL and a crawler sees the right lang without running JS
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const SRC = join(SITE, 'src');
const OUT = join(SITE, 'public');
const KIT = resolve(SITE, '..', 'profile-kit');

/** Recursive copy that creates parents. */
function copyTree(from, to, filter = () => true) {
  if (!existsSync(from)) return 0;
  let n = 0;
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const s = join(from, e.name);
    const d = join(to, e.name);
    if (e.isDirectory()) {
      if (e.name === 'preview' || e.name === '_scratch') continue;
      mkdirSync(d, { recursive: true });
      n += copyTree(s, d, filter);
    } else if (filter(e.name)) {
      copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

console.log('building inkward site\n');

// 1. Start clean. public/ is an artifact; leaving stale files in it is how a
//    deploy ships a page nobody reviewed.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });

const files = copyTree(SRC, OUT);
console.log(`  src -> public            ${files} file(s)`);

// 2. Fonts and static assets live outside src/: fonts are downloaded, not
//    authored, and public/ is wiped on every build.
const fontCount = copyTree(join(SITE, 'assets', 'fonts'), join(OUT, 'fonts'));
console.log(`  fonts -> public/fonts    ${fontCount} file(s)`);

let staticCount = 0;
for (const name of ['robots.txt', 'sitemap.xml']) {
  const from = join(SITE, 'assets', name);
  if (existsSync(from)) { copyFileSync(from, join(OUT, name)); staticCount++; }
}
console.log(`  static files             ${staticCount} (robots.txt, sitemap.xml)`);

// 3. Stats payload. Small, fixed shape, written next to the page.
//
// repos[] is what makes the work list grow on its own: the page renders one row
// per entry, so a new repository appears with no code change. Keep the fields
// the rows actually draw, and nothing else.
const statsSrc = join(KIT, 'data', 'stats.json');
if (existsSync(statsSrc)) {
  const s = JSON.parse(readFileSync(statsSrc, 'utf8'));
  const repos = (s.repos ?? [])
    .filter((r) => !r.archived && r.name !== `${s.meta?.user ?? ''}`)
    .map((r) => ({
      name: r.name,
      description: r.description ?? '',
      url: r.htmlUrl,
      language: r.language ?? null,
      stars: r.stars ?? 0,
      forks: r.forks ?? 0,
      topics: (r.topics ?? []).slice(0, 5),
      licence: r.license ?? null,
      pushedAt: r.pushedAt ?? null,
      createdAt: r.createdAt ?? null,
    }))
    .sort((a, b) => (b.stars - a.stars) || String(b.pushedAt ?? '').localeCompare(String(a.pushedAt ?? '')));

  const payload = {
    generatedAt: s.generatedAt,
    user: s.meta?.user ?? '3332210',
    repos,
    totals: {
      publicRepos: s.totals?.publicRepos ?? 0,
      stars: s.totals?.stars ?? 0,
      forks: s.totals?.forks ?? 0,
    },
    languages: (s.languages ?? []).map((l) => ({ name: l.name, pct: l.pct })),
    activity: {
      yearTotal: s.activity?.yearTotal ?? 0,
      summary: s.activity?.summary ?? { contributions: 0, activeDays: 0, longestStreak: 0 },
    },
    featured: s.featured
      ? {
        name: s.featured.name,
        url: s.featured.htmlUrl,
        stars: s.featured.stars,
        commitCount: s.featured.commitCount,
        buildSpanDays: s.featured.buildSpanDays,
      }
      : null,
  };
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify(payload, null, 2) + '\n');
  console.log(`  stats.json               ${repos.length} repo(s) for the work list`);
} else {
  console.log('  stats.json               SKIPPED (run profile-kit/scripts/sync.mjs first)');
}

// 4. Variant entry points. The page already switches at runtime; these exist so
//    a direct link can open in a given language/theme and so <html lang> is
//    correct for crawlers and screen readers before any JS runs.
const variants = [
  ['index.html',    'en', 'dark',  'INKWARD — 守墨'],
  ['zh.html',       'zh', 'dark',  '守墨 INKWARD'],
  ['light.html',    'en', 'light', 'INKWARD — 守墨'],
  ['light-zh.html', 'zh', 'light', '守墨 INKWARD'],
];

const base = readFileSync(join(OUT, 'index.html'), 'utf8');
for (const [file, lang, theme, title] of variants) {
  let html = base;
  html = html.replace(/<html [^>]*>/, `<html lang="${lang}" data-theme="${theme}" data-lang="${lang}" class="no-js">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  // Pin the variant so the inline pre-paint script cannot override it from
  // storage — an explicit URL is a stronger signal than a remembered choice.
  html = html.replace(
    "if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);",
    "d.setAttribute('data-theme', '" + theme + "');");
  html = html.replace(
    "if (l === 'en' || l === 'zh') d.setAttribute('data-lang', l);",
    "d.setAttribute('data-lang', '" + lang + "');");
  writeFileSync(join(OUT, file), html);
}
console.log(`  variants                 ${variants.map((v) => v[0]).join(', ')}`);

// 5. Report, including the JS payload the page actually ships.
let jsBytes = 0;
for (const f of readdirSync(join(OUT)).filter((f) => f.endsWith('.js'))) {
  jsBytes += statSync(join(OUT, f)).size;
}
console.log(`\npublic/ ready — ${jsBytes} B of JS, no framework, no network calls at runtime`);
console.log('serve it:  node scripts/serve.mjs');

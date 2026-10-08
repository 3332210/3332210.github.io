#!/usr/bin/env node
/**
 * Publish public/ to GitHub Pages, and point the profile README at it.
 *
 * Two steps, because they live in two different repositories:
 *   1. push the built site to `<user>.github.io` (the root Pages site)
 *   2. rewrite the hero link in the profile repo so the README leads there
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/deploy.mjs [--user 3332210] [--no-profile]
 *                                            [--dry-run] [--message "..."]
 *
 * Notes learned the hard way with the profile repo:
 *   - A freshly created repo can have NO commits, and every Git Data endpoint
 *     (blobs, trees) then fails with 409 "Git Repository is empty". The Contents
 *     API is the one endpoint that can create the first commit, so the branch is
 *     seeded with a README before the tree is written.
 *   - Binary assets (woff2) must be uploaded as blobs, not inline tree content;
 *     commit the tree entries' content base64-encoded and let the API decode.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');

const args = process.argv.slice(2);
const has = (n) => args.includes('--' + n);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const USER = arg('user', process.env.PROFILE_USER ?? '3332210');
const SITE_REPO = arg('repo', `${USER}.github.io`);
const BRANCH = arg('branch', 'main');
const SRC = resolve(process.cwd(), arg('src', join(SITE, 'public')));
const DRY = has('dry-run');
const SKIP_PROFILE = has('no-profile');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required (repo scope)');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'inkward-deploy',
};

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json, text };
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const rel = relative(base, full).split('\\').join('/');
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push({ rel, full });
  }
  return out;
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

async function main() {
  const me = await api('GET', '/user');
  if (!me.ok) { console.error(`token rejected: ${me.status}`); process.exit(1); }
  if (me.json.login.toLowerCase() !== USER.toLowerCase()) {
    console.error(`token is for "${me.json.login}", expected "${USER}"`);
    process.exit(1);
  }
  console.log(`authenticated as ${me.json.login}`);

  if (!existsSync(SRC)) { console.error(`no built site at ${SRC} — run scripts/build.mjs`); process.exit(1); }

  /* ---- 1. the Pages repo ------------------------------------------------ */
  let repo = await api('GET', `/repos/${USER}/${SITE_REPO}`);
  if (repo.status === 404) {
    if (DRY) {
      console.log(`[dry-run] would create ${USER}/${SITE_REPO}`);
    } else {
      const created = await api('POST', '/user/repos', {
        name: SITE_REPO,
        description: 'INKWARD — 守墨 · personal site',
        homepage: `https://${SITE_REPO}`,
        private: false,
        has_issues: false,
        has_wiki: false,
        auto_init: false,
      });
      if (!created.ok) {
        console.error(`create failed: ${created.status} ${created.text.slice(0, 240)}`);
        process.exit(1);
      }
      console.log(`created ${USER}/${SITE_REPO}`);
      repo = created;
    }
  } else {
    console.log(`repo ${USER}/${SITE_REPO} exists`);
  }

  /* Seed an empty repo: no commits means no tree to write into. */
  let ref = await api('GET', `/repos/${USER}/${SITE_REPO}/git/ref/heads/${BRANCH}`);
  if (!ref.ok && !DRY) {
    console.log(`branch ${BRANCH} unreadable (HTTP ${ref.status}) — seeding via the Contents API`);
    const seed = await api('PUT', `/repos/${USER}/${SITE_REPO}/contents/README.md`, {
      message: 'chore: initialise the site repository',
      content: Buffer.from(
        `# ${USER}.github.io\n\nThe INKWARD personal site. Source lives in the workspace; \`public/\` is generated.\n`,
        'utf8',
      ).toString('base64'),
      branch: BRANCH,
    });
    if (!seed.ok) { console.error(`seed failed: ${seed.status} ${seed.text.slice(0, 240)}`); process.exit(1); }
    console.log(`  seeded, ${BRANCH} now exists`);
    ref = await api('GET', `/repos/${USER}/${SITE_REPO}/git/ref/heads/${BRANCH}`);
  }

  let parent = null;
  let baseTree = null;
  const remote = new Map();
  if (ref.ok) {
    parent = ref.json.object.sha;
    const commit = await api('GET', `/repos/${USER}/${SITE_REPO}/git/commits/${parent}`);
    baseTree = commit.json?.tree?.sha ?? null;
    const tree = await api('GET', `/repos/${USER}/${SITE_REPO}/git/trees/${baseTree}?recursive=1`);
    if (tree.ok) for (const n of tree.json.tree ?? []) if (n.type === 'blob') remote.set(n.path, n.sha);
    console.log(`branch ${BRANCH} at ${parent.slice(0, 8)}, ${remote.size} blob(s) on remote`);
  }

  /* ---- 2. plan ---------------------------------------------------------- */
  const files = walk(SRC).filter((f) => f.rel !== 'review.html');
  const plan = files.map((f) => {
    const content = readFileSync(f.full);
    const sha = sha1(Buffer.concat([Buffer.from(`blob ${content.length}\0`, 'utf8'), content]));
    return { ...f, content, changed: remote.get(f.rel) !== sha, isNew: !remote.has(f.rel) };
  });
  const changed = plan.filter((p) => p.changed);

  console.log(`\nplan: ${plan.length} file(s), ${changed.length} to write, ${plan.length - changed.length} unchanged`);
  let total = 0;
  for (const p of changed) {
    total += p.content.length;
    console.log(`  ${p.isNew ? 'add   ' : 'update'} ${p.rel.padEnd(34)} ${(p.content.length / 1024).toFixed(1)} KB`);
  }
  console.log(`  total ${(total / 1024 / 1024).toFixed(2)} MB`);

  if (DRY) { console.log('\n[dry-run] nothing written'); return; }
  if (!changed.length) {
    console.log('\nsite already up to date');
  } else {
    /* Binary files go up as blobs; the tree references them by sha. */
    console.log('\nuploading blobs…');
    const entries = [];
    for (const p of changed) {
      const blob = await api('POST', `/repos/${USER}/${SITE_REPO}/git/blobs`, {
        content: p.content.toString('base64'),
        encoding: 'base64',
      });
      if (!blob.ok) { console.error(`blob ${p.rel}: ${blob.status} ${blob.text.slice(0, 200)}`); process.exit(1); }
      entries.push({ path: p.rel, mode: '100644', type: 'blob', sha: blob.json.sha });
      process.stdout.write('.');
    }
    console.log(`\n${entries.length} blob(s) uploaded`);

    const tree = await api('POST', `/repos/${USER}/${SITE_REPO}/git/trees`, {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: entries,
    });
    if (!tree.ok) { console.error(`tree failed: ${tree.status} ${tree.text.slice(0, 240)}`); process.exit(1); }

    const message = arg('message', 'feat: INKWARD site — generative pixel field, four language/theme variants');
    const commit = await api('POST', `/repos/${USER}/${SITE_REPO}/git/commits`, {
      message, tree: tree.json.sha, ...(parent ? { parents: [parent] } : {}),
    });
    if (!commit.ok) { console.error(`commit failed: ${commit.status} ${commit.text.slice(0, 240)}`); process.exit(1); }

    const upd = parent
      ? await api('PATCH', `/repos/${USER}/${SITE_REPO}/git/refs/heads/${BRANCH}`, { sha: commit.json.sha, force: false })
      : await api('POST', `/repos/${USER}/${SITE_REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.json.sha });
    if (!upd.ok) { console.error(`ref update failed: ${upd.status} ${upd.text.slice(0, 240)}`); process.exit(1); }
    console.log(`pushed ${commit.json.sha.slice(0, 8)}`);
  }

  /* ---- 3. enable Pages -------------------------------------------------- */
  const pagesGet = await api('GET', `/repos/${USER}/${SITE_REPO}/pages`);
  if (pagesGet.ok) {
    console.log(`\nPages already enabled: ${pagesGet.json.html_url} (${pagesGet.json.status})`);
  } else {
    const enable = await api('POST', `/repos/${USER}/${SITE_REPO}/pages`, {
      source: { branch: BRANCH, path: '/' },
    });
    if (enable.ok) {
      console.log(`\nPages enabled -> ${enable.json.html_url}`);
    } else if (enable.status === 409) {
      console.log('\nPages was already configured');
    } else {
      console.error(`\ncould not enable Pages: ${enable.status} ${enable.text.slice(0, 240)}`);
      console.error('enable it once in Settings -> Pages (Source: Deploy from a branch, main / root)');
    }
  }

  const url = `https://${USER}.github.io/`;
  console.log(`\nsite: ${url}`);
  console.log('first deployment usually takes 1–2 minutes');

  /* ---- 4. point the profile README at it -------------------------------- */
  if (SKIP_PROFILE) return;

  const profRepo = USER;
  const readme = await api('GET', `/repos/${USER}/${profRepo}/contents/README.md`);
  if (!readme.ok) { console.log(`\n(no profile README to update: ${readme.status})`); return; }

  const current = Buffer.from(readme.json.content, 'base64').toString('utf8');
  if (current.includes(url)) { console.log('\nprofile README already links to the site'); return; }

  /* Insert the link beside the tagline, and wrap the hero in it, so the first
     thing a visitor sees is clickable. Non-destructive if the pattern is gone. */
  let next = current;
  const heroRe = /(<img src="assets\/hero\.svg"[^>]*>)/;
  if (heroRe.test(next)) {
    next = next.replace(heroRe, `<a href="${url}">$1</a>`);
  }
  const tagline = '我是 **3332210**。';
  if (next.includes(tagline)) {
    next = next.replace(tagline, `我是 **INKWARD / 守墨**，也叫 3332210。→ **[个人主页](${url})**\n\n_原名行保留于此以便对照：_\n\n${tagline}`);
  }

  if (next === current) { console.log('\nprofile README pattern not found — skipped'); return; }

  const put = await api('PUT', `/repos/${USER}/${profRepo}/contents/README.md`, {
    message: 'docs: link the profile to the INKWARD site',
    content: Buffer.from(next, 'utf8').toString('base64'),
    sha: readme.json.sha,
    branch: 'main',
  });
  if (!put.ok) { console.error(`profile README update failed: ${put.status} ${put.text.slice(0, 240)}`); return; }
  console.log(`\nprofile README now links to ${url}`);
}

main().catch((e) => { console.error('deploy failed:', e.stack ?? e.message); process.exit(1); });

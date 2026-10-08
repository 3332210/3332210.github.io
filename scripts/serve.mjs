#!/usr/bin/env node
/**
 * Minimal static server for local review.
 *
 * No dependencies, correct MIME types (including woff2, which a wrong type
 * silently breaks), and no caching, so a rebuild is visible on reload.
 *
 * Usage: node scripts/serve.mjs [--port 5180] [--root public]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = parseInt(arg('port', '5180'), 10);
const ROOT = resolve(SITE, arg('root', 'public'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    // Contain the path inside ROOT — a traversal guard, not a nicety.
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`404 ${path}`);
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      'content-type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': body.length,
    }).end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e.message));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`inkward site -> http://127.0.0.1:${PORT}/`);
  console.log(`  root: ${ROOT}`);
  console.log('  variants: /  /zh.html  /light.html  /light-zh.html');
});

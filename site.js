/**
 * site.js — behaviour for the Inkward landing page.
 *
 * Four jobs: build the reason matrix from the plugin's real tone table, run the
 * generative field, drive the custom cursor, and wire the theme/language
 * switches. No framework, no build step, ~6 KB.
 */
import { PixelField } from './field.js';

/* ============================================================ tone table ==
 * Lifted from dsh-notify-cues/lib/notify.ps1 (the chime definitions). Each
 * entry is [frequency Hz, duration ms]; a frequency of 0 is a rest. The contour
 * bars in the matrix are drawn from these numbers, so what you see is the sound
 * the plugin actually plays rather than an illustration of it.
 * ======================================================================== */
const TONES = {
  completed:   [[587.33, 160], [880.0, 260]],
  interrupted: [[880.0, 130], [440.0, 260]],
  error:       [[196.0, 220], [146.83, 360]],
  maxTokens:   [[1046.5, 70], [0, 55], [1046.5, 70], [0, 55], [1046.5, 70]],
  blocked:     [[311.13, 110], [0, 45], [311.13, 110]],
  attention:   [[659.25, 110], [783.99, 110], [987.77, 190]],
};

const REASONS = [
  { key: 'completed',            arg: '',                       tone: 'completed',   en: 'Finished',     zh: '任务完成', sig: 'D5→A5 rising pair' },
  { key: 'aborted', arg: '.user',                               tone: 'interrupted', en: 'Interrupted',  zh: '已中断',   sig: 'A5→A4 falling, cut short' },
  { key: 'aborted', arg: ".hook | 'blocked'",                   tone: 'blocked',     en: 'Blocked',      zh: '已被阻止', sig: 'flat double knock' },
  { key: 'aborted', arg: '.parent | .disposed',                 tone: null,          en: 'Silent',       zh: '静默',     sig: 'deliberately silent', silent: true },
  { key: 'error',    arg: '',                                   tone: 'error',       en: 'Failed',       zh: '出错了',   sig: 'low, dissonant, falling' },
  { key: 'max-tokens', arg: '',                                 tone: 'maxTokens',   en: 'Output limit', zh: '达到输出上限', sig: 'three sharp pips' },
  { key: 'approval', arg: '/asked',                             tone: 'attention',   en: 'Needs you',    zh: '需要你操作', sig: 'E5–G5–B5 arpeggio' },
];

/** Total span of a tone sequence in ms, rests included. */
function span(tone) {
  return tone ? tone.reduce((sum, [, ms]) => sum + ms, 0) : 0;
}

function buildMatrix() {
  const host = document.getElementById('matrix');
  if (!host) return;

  const max = Math.max(...REASONS.map((r) => span(TONES[r.tone])));
  const frag = document.createDocumentFragment();

  for (const r of REASONS) {
    const tone = TONES[r.tone];
    const row = document.createElement('div');
    row.className = 'row reveal' + (r.silent ? ' silent' : '');
    row.style.setProperty('--d', `${REASONS.indexOf(r) * 45}ms`);

    const code = document.createElement('code');
    code.innerHTML = `${r.key}<i>${r.arg}</i>`;

    const outcome = document.createElement('span');
    outcome.className = 'outcome';
    // Both languages ship in the DOM; CSS picks one. No re-render on switch.
    outcome.innerHTML =
      `<span data-only="en">${r.en}</span><span data-only="zh">${r.zh}</span>`;

    const contour = document.createElement('span');
    contour.className = 'contour';
    if (tone) {
      let at = 0;
      for (const [hz, ms] of tone) {
        if (hz > 0) {
          const bar = document.createElement('i');
          // width = share of the longest sequence; y = higher pitch sits higher
          bar.style.left = `${(at / max) * 100}%`;
          bar.style.width = `${Math.max(4, (ms / max) * 100)}%`;
          bar.style.top = `${50 - ((hz - 150) / 950) * 42}%`;
          contour.appendChild(bar);
        }
        at += ms;
      }
    }

    const signal = document.createElement('span');
    signal.className = 'signal';
    signal.textContent = r.sig;

    row.append(code, outcome, contour, signal);
    frag.appendChild(row);
  }
  host.appendChild(frag);
}

/**
 * Turn the topic list into real links to GitHub's topic pages.
 *
 * Each tag is a destination rather than a label — the page had almost nothing
 * clickable, and a tag that looks interactive but is not is worse than no tag.
 */
function renderTags(stats) {
  const host = document.getElementById('topic-links');
  if (!host) return;
  const seen = new Set();
  const topics = [];
  for (const r of stats.repos ?? []) {
    for (const t of r.topics ?? []) {
      if (!seen.has(t)) { seen.add(t); topics.push(t); }
    }
  }
  if (!topics.length) return;
  host.innerHTML = topics
    .slice(0, 8)
    .map((t) => `<a class="tag" href="https://github.com/topics/${encodeURIComponent(t)}" target="_blank" rel="noopener">${esc(t)}</a>`)
    .join('');
}

/* ============================================================== live data ==
 * The numbers come from the repo's own generated stats.json, refreshed by CI.
 * If the fetch fails the dashes stay — an honest "no data" beats a stale number.
 * ======================================================================== */
let STATS = null;

async function loadStats() {
  if (STATS) return STATS;
  const res = await fetch('stats.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(String(res.status));
  STATS = await res.json();
  return STATS;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** "2026-10-01T…" -> "Oct 2026". Locale-independent on purpose: the page's own
 *  language switch already carries the locale, and a runtime locale here would
 *  make the layout width jump between visits. */
function monthYear(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The work list: one row per repository, every row a real link.
 *
 * Generated from data so that ADDING A REPOSITORY MAKES IT APPEAR with no code
 * change. Nothing here is specific to a particular project — that is the whole
 * point, because this list has to keep working as the account grows.
 */
function renderWork(stats) {
  const host = document.getElementById('work-list');
  if (!host) return;

  const repos = stats.repos ?? [];
  const count = document.getElementById('work-count');
  if (count) {
    count.textContent = repos.length
      ? `${String(repos.length).padStart(2, '0')} ${repos.length === 1 ? 'repository' : 'repositories'}`
      : 'none public yet';
  }

  if (!repos.length) {
    host.innerHTML = '<p class="work-empty">Nothing public yet.</p>';
    return;
  }

  const frag = document.createDocumentFragment();

  repos.forEach((r, i) => {
    // The whole row is the anchor, so the click target is the row and not just
    // the title — a title-only link in a wide row is a poor target.
    const a = document.createElement('a');
    a.className = 'work-row reveal';
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.setProperty('--d', `${i * 60}ms`);

    const idx = document.createElement('span');
    idx.className = 'work-idx';
    idx.textContent = String(i + 1).padStart(2, '0');

    const main = document.createElement('span');
    main.className = 'work-main';
    const name = document.createElement('span');
    name.className = 'work-name';
    name.textContent = r.name;
    main.appendChild(name);
    // A repo with no description must not leave an empty gap in the row.
    if (r.description) {
      const desc = document.createElement('span');
      desc.className = 'work-desc';
      desc.textContent = r.description;
      main.appendChild(desc);
    }

    const meta = document.createElement('span');
    meta.className = 'work-meta';
    const bits = [];
    if (r.language) bits.push(`<b>${esc(r.language)}</b>`);
    if (r.stars) bits.push(`<span class="work-star">★ ${r.stars}</span>`);
    if (r.licence) bits.push(esc(r.licence));
    const when = monthYear(r.pushedAt);
    if (when) bits.push(when);
    meta.innerHTML = bits.join('<span class="work-sep">·</span>');

    const arrow = document.createElement('span');
    arrow.className = 'work-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';

    a.append(idx, main, meta, arrow);
    frag.appendChild(a);
  });

  host.replaceChildren(frag);

  // The rows are created after the first observer pass, so reveal them here.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    host.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    host.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }
}

async function hydrateStats() {
  const note = document.getElementById('generated-note');
  try {
    const s = await loadStats();
    const set = (k, v) => {
      const el = document.querySelector(`[data-stat="${k}"]`);
      if (el) el.textContent = v;
    };
    set('repos', s.totals?.publicRepos ?? '—');
    set('stars', s.totals?.stars ?? '—');
    set('contribs', s.activity?.yearTotal ?? s.activity?.summary?.contributions ?? '—');
    set('langs', (s.languages ?? []).length || '—');
    if (note && s.generatedAt) note.textContent = `live · ${s.generatedAt.slice(0, 10)}`;
    renderWork(s);
    renderTags(s);
  } catch {
    if (note) note.textContent = 'offline';
    const host = document.getElementById('work-list');
    if (host) {
      host.innerHTML = '<p class="work-empty">The list could not load. Every repository is at '
        + '<a href="https://github.com/3332210">github.com/3332210</a>.</p>';
    }
  }
}

/* ================================================================ cursor ==
 * A hard square tracks the pointer exactly; a ring lags behind it. The square
 * uses mix-blend-mode difference so it stays visible over both the field and
 * the paper without us having to detect what is underneath.
 * ======================================================================== */
function initCursor() {
  if (window.matchMedia('(hover: none)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const dot = document.querySelector('.cursor');
  const ring = document.querySelector('.cursor-ring');
  if (!dot || !ring) return;

  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let rx = mx, ry = my;

  window.addEventListener('pointermove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
  }, { passive: true });

  (function track() {
    rx += (mx - rx) * 0.14;
    ry += (my - ry) * 0.14;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(track);
  })();

  // Grow the ring over anything interactive.
  const setLink = (on) => { document.body.dataset.cursor = on ? 'link' : ''; };
  document.addEventListener('pointerover', (e) => {
    setLink(!!e.target.closest('a, button, .row, .tag'));
  });
}

/* ================================================================ reveals ==
 * One observer, staggered by a per-element CSS variable. Elements start visible
 * and are hidden by a class, so with JS off nothing disappears.
 * ======================================================================== */
function initReveal() {  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
}

/* ============================================================== switches ==
 * Theme and language live on <html> as data attributes, so every rule is plain
 * CSS and nothing has to re-render.
 * ======================================================================== */
function initSwitches() {
  const root = document.documentElement;

  const sync = () => {
    const t = root.getAttribute('data-theme');
    const l = root.getAttribute('data-lang');
    document.querySelectorAll('[data-set-theme]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.setTheme === t)));
    document.querySelectorAll('[data-set-lang]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.setLang === l)));
  };

  const save = (k, v) => { try { localStorage.setItem('inkward:' + k, v); } catch { /* private mode */ } };

  document.querySelectorAll('[data-set-theme]').forEach((b) =>
    b.addEventListener('click', () => {
      root.setAttribute('data-theme', b.dataset.setTheme);
      save('theme', b.dataset.setTheme);
      sync();
      window.dispatchEvent(new CustomEvent('inkward:theme'));
    }));

  document.querySelectorAll('[data-set-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      root.setAttribute('data-lang', b.dataset.setLang);
      save('lang', b.dataset.setLang);
      sync();
    }));

  // Keyboard: ⌘/Ctrl + J flips language, ⌘/Ctrl + K flips theme.
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'j') {
      e.preventDefault();
      const next = root.getAttribute('data-lang') === 'zh' ? 'en' : 'zh';
      root.setAttribute('data-lang', next); save('lang', next); sync();
    }
    if (e.key === 'k') {
      e.preventDefault();
      const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next); save('theme', next); sync();
    }
  });

  sync();
}

/* ============================================================ navigation ==
 * Section links are plain anchors, so they work without any of this. All this
 * adds is which one is marked current, and it does so from scroll position
 * rather than only from clicks, so the marker is honest when the reader scrolls
 * by hand or lands on a deep link.
 * ======================================================================== */
function initNav() {
  const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  if (!links.length) return;

  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);

  const mark = () => {
    // The section whose top is closest to the reading line, without going past it.
    const line = window.innerHeight * 0.35;
    let current = null;
    for (const s of sections) {
      const top = s.el.getBoundingClientRect().top;
      if (top <= line) current = s.a;
      else break;
    }
    for (const s of sections) s.a.classList.toggle('is-current', s.a === current);
  };

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { mark(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', mark);
  mark();
}

/* =================================================================== boot == */
function boot() {
  buildMatrix();
  initSwitches();
  initNav();
  initCursor();
  initReveal();
  hydrateStats();

  const canvas = document.getElementById('field');
  if (canvas) {
    const css = getComputedStyle(document.documentElement);
    const field = new PixelField(canvas, {
      accent: css.getPropertyValue('--field-accent').trim() || '#C8FF4D',
      ink: css.getPropertyValue('--field-ink').trim() || '#F5F5F0',
      paper: css.getPropertyValue('--paper').trim() || '#0E0E10',
    });
    field.start();

    // Keep the field quiet behind the display type, and re-measure when the
    // wordmark's box changes (resize, or the language switch swapping in 守墨).
    field.setExclusion(document.querySelector('.hero-display'));
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => field.exclusionRect());
      const target = document.querySelector('.hero-display');
      if (target) ro.observe(target);
    }

    // Wane: full strength at the top, down to a quarter by the project section,
    // so the artwork gets out of the way once there is something to read.
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const vh = window.innerHeight;
        field.setWane(1 - Math.min(0.75, y / (vh * 2.2)));
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Re-read the palette when the theme flips, and re-seat the canvas so the
    // field's own colours follow the paper.
    window.addEventListener('inkward:theme', () => {
      const c = getComputedStyle(document.documentElement);
      field.accent = c.getPropertyValue('--field-accent').trim() || field.accent;
      field.ink = c.getPropertyValue('--field-ink').trim() || field.ink;
      field.paper = c.getPropertyValue('--paper').trim() || field.paper;
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

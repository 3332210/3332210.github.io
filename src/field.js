/**
 * field.js — the generative pixel field. Canvas 2D, no dependencies.
 *
 * Why Canvas 2D and not WebGL: the reference effect renders a fluid shader into
 * a framebuffer and then quantises it with a post-processing pixelation pass.
 * The quantisation IS the look, so drawing the quantised result directly is
 * cheaper, has no shader-compile stall, degrades predictably on weak GPUs, and
 * costs about 7 KB instead of shipping three.js.
 *
 * ── Two hard-won facts about this effect ────────────────────────────────────
 *
 * 1. NOISE IS ZERO ON THE LATTICE. Perlin noise is exactly 0 at every integer
 *    coordinate, because the four corner gradients cancel. Sampling at
 *    `gx / scale` with a scale near the column count therefore lands almost
 *    every sample on a lattice point, the whole field evaluates to the constant
 *    0.5, and nothing ever crosses any threshold. Every sample is taken at a
 *    cell CENTRE (`(gx + 0.5) / scale`) for this reason.
 *
 * 2. THE THRESHOLD MUST BE CALIBRATED, NOT CHOSEN. Summed octaves do not reach
 *    the theoretical extremes of one octave: this 3-octave FBM actually spans
 *    0.199–0.806 with a median of 0.499. A hand-picked threshold of 0.87 on that
 *    distribution lit 5 cells out of 9240 — an invisible field that looks like a
 *    canvas bug rather than an arithmetic one. So the field measures its own
 *    distribution at startup and derives the cut-off from a target coverage.
 *
 * ── What is ours rather than the reference's ────────────────────────────────
 *   - the pointer INJECTS a gaussian depression into the density field (ink
 *     dropped into water) instead of merely swapping cell colours;
 *   - the whole field WANES with scroll depth, down to a quarter by the project
 *     section, so the content becomes the subject instead of the wallpaper.
 */
import { makePerlin, makeFbm, hash2 } from './noise.js';

/* ── quantisation ───────────────────────────────────────────────────────── */
const CELL = 5;                       // px, the square itself
const GAP = 2;                        // px between squares
const STEP = CELL + GAP;              // 7 px grid
const DPR_CAP = 2;                    // beyond this the cells stop being visible
const COARSE_BREAKPOINT = 720;        // coarser grid on phones

/* ── noise ──────────────────────────────────────────────────────────────── */
const OCTAVES = 3;

/**
 * Target fraction of cells that light up, inside the visible band.
 *
 * This is the single tuning knob that matters, and it is far more legible than a
 * raw threshold. Below ~0.05 the field reads as crumbs that look like a
 * rendering fault; above ~0.30 it becomes a wall of squares that buries the
 * typography.
 */
const COVERAGE = 0.17;

/**
 * How far the field fades where the display type sits.
 *
 * Without this the hero wordmark drowns: the first render had a fully dense
 * field behind "WARD" and the letters became unreadable, which is the exact
 * failure mode where an effect eats the message. Keeping a quiet well around the
 * type is also the most literal reading of the name — the ink is only legible
 * because of the space left around it.
 */
const EXCLUDE_ALPHA = 0.05;
const EXCLUDE_FEATHER = 150;   // px of gradient between the well and full density

/**
 * Opacity range for lit cells. Deliberately low: this is atmosphere, not
 * content, and it must never compete with text set on top of it.
 */
const ALPHA_MIN = 0.05;
const ALPHA_MAX = 0.34;

/** How many grid cells one noise unit spans, at a 1000 px viewport. Below ~30 the
 *  noise repeats inside the viewport and the result is small blobs rather than
 *  clouds; the field scales this with the grid so composition holds at any width. */
const FEATURE_SCALE = 52;
const BASE_COLS = 143;

/** Per-cell threshold jitter. This is what makes the cloud edge ragged rather
 *  than a level contour, and it is the difference between weather and a map. */
const JITTER = 0.05;

/** Share of lit cells that take the accent colour. Kept well under half: the
 *  accent is a seasoning, and a field that is half accent reads as a colour
 *  scheme rather than a material. */
const ACCENT_RATIO = 0.26;

/** The pointer well: radius as a share of the smaller viewport axis, and depth. */
const WELL_RADIUS = 0.22;
const WELL_DEPTH = 0.42;

const ADVECT_X = 0.06;
const ADVECT_Y = 0.11;

export class PixelField {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {string} [opts.accent] colour for the accent share of lit cells
   * @param {string} [opts.ink]    colour for the rest
   * @param {number} [opts.seed]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.accent = opts.accent ?? '#C8FF4D';
    this.ink = opts.ink ?? '#F5F5F0';

    const noise = makePerlin(opts.seed ?? 20261004);
    this.fbm = makeFbm(noise, { octaves: OCTAVES });

    this.time = 0;
    this.frame = 0;
    this.wane = 1;
    this.waneTarget = 1;

    this.pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    this.reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
    this.onPointer = this.onPointer.bind(this);
    this.onLeave = this.onLeave.bind(this);

    /** Threshold derived from the measured distribution; set in calibrate(). */
    this.cut = 0.6;
  }

  /**
   * Measure this FBM's actual value distribution and choose the cut-off that
   * lights COVERAGE of cells.
   *
   * Sampling on a fixed 0.031 step over a wide area, which is finer than the
   * smallest octave's feature size, so the estimate is stable and cheap (a few
   * ms, once, at startup).
   */
  calibrate(samples = 120000) {
    const vals = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i % 400) * 0.031 + 0.5;
      const y = Math.floor(i / 400) * 0.031 + 0.5;
      vals[i] = (this.fbm(x, y) + 1) * 0.5;
    }
    vals.sort();

    // The jitter shifts each cell's effective cut-off by up to -JITTER, whose
    // mean is -JITTER/2, so aim slightly lower than the target coverage.
    const q = Math.min(0.98, COVERAGE + JITTER / 2);
    this.cut = vals[Math.min(samples - 1, Math.floor(q * samples))];
    this.dist = {
      min: vals[0],
      max: vals[samples - 1],
      median: vals[Math.floor(samples / 2)],
      cut: this.cut,
    };
    return this.dist;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.cssW = Math.max(1, Math.round(rect.width));
    this.cssH = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const coarse = this.cssW < COARSE_BREAKPOINT;
    this.step = coarse ? STEP * 2 : STEP;
    this.cell = coarse ? CELL * 2 : CELL;
    this.cols = Math.ceil(this.cssW / this.step) + 1;
    this.rows = Math.ceil(this.cssH / this.step) + 1;
    this.featureScale = FEATURE_SCALE * (this.cols / BASE_COLS);
  }

  onPointer(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.tx = x - rect.left;
    this.pointer.ty = y - rect.top;
  }

  onLeave() {
    this.pointer.tx = -9999;
    this.pointer.ty = -9999;
  }

  /** Scroll depth -> wane factor. Called by the host page on scroll. */
  setWane(v) {
    this.waneTarget = Math.max(0.25, Math.min(1, v));
  }

  /**
   * Register a region the field must stay quiet inside — the display type.
   *
   * Pass the element, not a rect: the page re-measures on resize and on language
   * switch (the wordmark changes size), so a cached rect would go stale and the
   * well would drift off the letters.
   *
   * @param {Element|null} el
   */
  setExclusion(el) {
    this.excludeEl = el ?? null;
  }

  /** Current exclusion rect in canvas-local CSS pixels, or null. */
  exclusionRect() {
    if (!this.excludeEl) return null;
    const r = this.excludeEl.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x0: r.left - c.left, y0: r.top - c.top, x1: r.right - c.left, y1: r.bottom - c.top };
  }

  draw() {
    const { ctx, cssW, cssH, step, cell, cols, rows, featureScale, cut, wane } = this;
    ctx.clearRect(0, 0, cssW, cssH);
    if (wane < 0.02) return;

    const ox = this.time * ADVECT_X;
    const oy = this.time * ADVECT_Y;

    const px = this.pointer.x, py = this.pointer.y;
    const radius = Math.min(cssW, cssH) * WELL_RADIUS;
    const radiusSq = radius * radius;
    const hasPointer = px > -9000;

    const ex = this.exclusionRect();

    // Shading range: how far above the cut a cell has to be to reach full
    // opacity. Tied to the measured spread so it adapts to the seed.
    const span = Math.max(0.04, (this.dist?.max ?? 0.8) - cut);

    for (let gy = 0; gy < rows; gy++) {
      const y = gy * step;
      const ny = (gy + 0.5) / featureScale + oy;
      // Per-row vertical distance to the type well; the horizontal term is
      // added inside the inner loop.
      const dyWell = ex ? (y < ex.y0 ? ex.y0 - y : y > ex.y1 ? y - ex.y1 : 0) : 0;

      for (let gx = 0; gx < cols; gx++) {
        const x = gx * step;
        const nx = (gx + 0.5) / featureScale + ox;

        let b = (this.fbm(nx, ny) + 1) * 0.5;

        // Pointer well: a squared falloff makes a soft bowl rather than a disc.
        if (hasPointer) {
          const dx = x - px, dy = y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < radiusSq) {
            const f = 1 - d2 / radiusSq;
            b -= WELL_DEPTH * f * f;
          }
        }

        let wellFade = 1;
        if (ex) {
          const dxWell = x < ex.x0 ? ex.x0 - x : x > ex.x1 ? x - ex.x1 : 0;
          const d = (dyWell || dxWell) ? Math.hypot(dxWell, dyWell) : 0;
          // Feathered so the quiet zone never shows as a rectangle edge.
          wellFade = EXCLUDE_ALPHA + (1 - EXCLUDE_ALPHA) * Math.min(1, d / EXCLUDE_FEATHER);
        }

        if (b <= cut - hash2(gx, gy) * JITTER) continue;

        const over = Math.min(1, (b - cut) / span);
        ctx.globalAlpha = wane * wellFade * (ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * over);
        ctx.fillStyle = hash2(gy, gx) < ACCENT_RATIO ? this.accent : this.ink;
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.globalAlpha = 1;
  }

  loop() {
    this.frame++;
    // Time advances every other frame: carried over from the reference, and it
    // halves the perceived drift speed without lowering the frame rate.
    if (this.frame % 2 === 0) this.time += 0.01;

    const p = this.pointer;
    p.x += (p.tx - p.x) * 0.06;
    p.y += (p.ty - p.y) * 0.06;
    this.wane += (this.waneTarget - this.wane) * 0.08;

    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  start() {
    this.resize();
    this.calibrate();

    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    window.addEventListener('pointerleave', this.onLeave);

    // Paint one frame SYNCHRONOUSLY, before any rAF is scheduled. Not an
    // optimisation: relying on the first rAF leaves the canvas blank from load
    // until that callback, and indefinitely wherever rAF is throttled or
    // deferred. The field must exist the moment the script runs.
    this.draw();

    if (this.reduced) return; // static composition, nothing moves
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('pointerleave', this.onLeave);
  }
}

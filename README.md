# INKWARD — 守墨

Source for **https://3332210.github.io/** — the personal site.

`public/` is **generated**. Never edit it; edit `src/` and run the build.

---

## The idea

`-ward` is the Old English suffix of direction and keeping (*homeward*, *warden*).
Its stem is `ink` — a small pool of it.

> **The grandest suffix, spent on the smallest thing.**

Everything visual follows from that one sentence:

| Decision | Why |
|---|---|
| Display type at 15–18vw, metadata at 10px, nothing in between | The point is the gap between vast and tiny. A page where everything sits between 12 and 40px has no design, only order. |
| Hollow / solid alternating wordmark | Hollow = not yet written. Solid = inked. |
| A generative pixel field, and nothing else | One ornament, carrying all the atmosphere. No gradient strips, no glows, no decorative rules. |
| The field falls quiet around the wordmark | The ink is legible because of the space left around it. Also: an effect that eats the message has failed. |
| Acid green under 0.5% of the page | It is acupuncture, not paint. |
| Warm ivory `#F2EFE9`, never pure white | Paper, not screen. |

The full rationale, including the measured constants, is in
[`DESIGN.md`](DESIGN.md).

## Layout

```
src/
  index.html      the page (both languages in the DOM; CSS picks one)
  styles.css      tokens, layout, motion — all of it
  site.js         matrix construction, switches, cursor, reveals, boot
  field.js        the generative field (Canvas 2D)
  noise.js        Perlin + FBM + hash, no dependencies
assets/
  fonts/          self-hosted variable fonts (SIL OFL 1.1)
  robots.txt, sitemap.xml
scripts/
  fonts.mjs       download the fonts (once)
  build.mjs       src/ + fonts -> public/, and emit the four variants
  serve.mjs       local server for review
  compact-view.mjs  flattened view for a one-shot full-page screenshot
  deploy.mjs      push public/ to <user>.github.io and enable Pages
public/           GENERATED
```

## Four variants

`index.html` switches at runtime, and there are four stamped entry points so a
direct link opens correctly with the right `<html lang>` before any JS runs:

| URL | Language | Theme |
|---|---|---|
| `/` | English | dark *(default)* |
| `/zh.html` | 中文 | dark |
| `/light.html` | English | light |
| `/light-zh.html` | 中文 | light |

The switch lives in the top right as two pairs of 10px mono buttons (`EN / 中`,
`◐ / ◑`). It is metadata, not a call to action, so it is not a toggle or an icon.
Choice persists in `localStorage`; `⌘/Ctrl + J` flips language, `⌘/Ctrl + K`
flips theme.

## Work on it

```bash
node scripts/fonts.mjs      # once — downloads the three variable fonts
node scripts/build.mjs      # src/ -> public/
node scripts/serve.mjs      # http://127.0.0.1:5180/
```

## The field: two things that cost hours to find

Both are documented at the top of `src/field.js`, because both produce a
*silently empty* canvas rather than an error.

1. **Perlin noise is exactly zero on the integer lattice.** The four corner
   gradients cancel. Sampling at `gx / scale` with a scale near the column count
   put nearly every sample on a lattice point, so the whole field evaluated to the
   constant 0.5 and nothing ever crossed the threshold. Every sample is taken at a
   cell centre, `(gx + 0.5) / scale`.

2. **The threshold has to be calibrated, not chosen.** A 3-octave FBM does not
   span the theoretical −1..1; this one measures 0.199–0.806 with a median of
   0.499. A hand-picked cut-off of 0.87 on that distribution lit **5 cells out of
   9240**. The field now measures its own distribution at startup and derives the
   cut-off from a target coverage, so `COVERAGE = 0.17` means the same thing
   whatever the seed.

The pointer injects a gaussian depression into the density field — ink dropped
into water — rather than only recolouring cells, and the field wanes with scroll
depth so the content becomes the subject further down.

## Craft notes

- **Reduced motion is a branch, not an afterthought**: the field paints one
  static frame and stops animating.
- **No JS, no problem**: reveal animations are opt-in via a class, so the content
  is present rather than invisible if scripts never run.
- **The cursor** is a hard acid square that tracks exactly, plus a ring that lags
  by 0.14 per frame and grows over anything interactive. Hidden on touch devices
  and under reduced motion.
- **No network at runtime** beyond `stats.json`. Fonts are self-hosted.
- **Zero dependencies.** ~27 KB of JavaScript, no framework.

## Credits

Typefaces: Archivo, Inter, JetBrains Mono — all SIL Open Font License 1.1.
See `assets/fonts/LICENCES.txt`. None are redistributed by a CDN; all are served
from this repository.

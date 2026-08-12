# Gooey plus menu (Pro)

## When to use

A 40px plus button that **liquid-splits into three satellite buttons** fanned above it —
new file / add image / new folder — and merges back into itself on close. Use it for a
compact create/add affordance: a floating action button, a composer's attachment menu, a
canvas "add node" control. Three to four satellites is the sweet spot; past that the
merged silhouette stops reading as one liquid body.

The gooey read comes from an **SVG filter** (blur → alpha contrast slam → crisp source
composite) applied to a blob layer that mirrors the button geometry 1:1. The real
buttons and icons live in an unfiltered layer above, so they stay sharp while the liquid
below is the visible surface. The same filter also derives the surface shadow from the
merged silhouette, so **one** shadow follows the liquid through every state — no
handoff, nothing to flash.

Open fans the satellites out on a symmetric equal-radius arc with a per-satellite
stagger; close pulls them back and plays a vertical anticipation nudge on the whole goo
layer. The plus → X is a single 45° rotation. Flattens under reduced motion.

## HTML usage

The blob layer is SVG, the UI layer is plain buttons; both sit inside one anchor whose
box reserves the OPEN fan's footprint so nothing around it reflows.

```html
<div class="t-goo-anchor" data-open="false">
  <!-- Blob layer: carries the goo AND the shadow. Filtered INSIDE the
       <svg> via <g filter="…">, never with CSS `filter: url(#…)` on
       HTML — WebKit renders that unreliably. -->
  <svg class="t-goo-layer" viewBox="0 0 200 140" aria-hidden="true" focusable="false">
    <defs>
      <!-- color-interpolation-filters="sRGB" is required: the default
           linearRGB makes the shadow falloff diverge from CSS
           box-shadow. -->
      <filter id="t-goo-filter" x="-60%" y="-60%" width="220%" height="220%"
              color-interpolation-filters="sRGB">
        <!-- The goo: blur everything together, then slam the alpha
             contrast so overlapping soft edges snap into one hard
             silhouette with a liquid bridge between them, then
             composite the crisp source back on top ("atop") so the
             circles keep their true edges and only the bridges are
             filter-made. -->
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
        <feColorMatrix in="blur" mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
        <feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape" />

        <!-- Shadow, emulated inside the SAME filter so it hugs the
             MERGED liquid — bridges included. Each pass is built
             independently from `shape` and merged BEHIND it, exactly
             how CSS paints box-shadow. Do NOT chain feDropShadow
             primitives: each one would shadow the previous result and
             the passes would compound.
             Reproduces:
               0 0 0 1px rgba(0,0,0,0.06),
               0 2px  6px rgba(0,0,0,0.05),
               0 4px 42px rgba(0,0,0,0.06) -->

        <!-- 1px spread ring. The goo alpha carries a ~1px soft fringe
             past its opaque edge; dilating that directly pushes the
             ring a pixel out and the fringe shows as a second
             hairline. Binarize the alpha at 0.5 FIRST so the ring
             hugs the hard contour, like box-shadow hugs a border-box. -->
        <feColorMatrix in="shape" mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5" result="ring-solid" />
        <feMorphology in="ring-solid" operator="dilate" radius="1" result="ring-a" />
        <feFlood flood-color="#000000" flood-opacity="0.06" result="ring-c" />
        <feComposite in="ring-c" in2="ring-a" operator="in" result="ring" />

        <!-- 0 2px 6px @ 5% — σ = blur / 2 = 3 -->
        <feGaussianBlur in="shape" stdDeviation="3" result="s2-b" />
        <feOffset in="s2-b" dy="2" result="s2-o" />
        <feFlood flood-color="#000000" flood-opacity="0.05" result="s2-c" />
        <feComposite in="s2-c" in2="s2-o" operator="in" result="s2" />

        <!-- 0 4px 42px @ 6% — σ = blur / 2 = 21 -->
        <feGaussianBlur in="shape" stdDeviation="21" result="s3-b" />
        <feOffset in="s3-b" dy="4" result="s3-o" />
        <feFlood flood-color="#000000" flood-opacity="0.06" result="s3-c" />
        <feComposite in="s3-c" in2="s3-o" operator="in" result="s3" />

        <feMerge>
          <feMergeNode in="s3" />
          <feMergeNode in="s2" />
          <feMergeNode in="ring" />
          <feMergeNode in="shape" />
        </feMerge>
      </filter>
    </defs>
    <!-- One circle per button, all stacked at the main button's centre
         when closed. --fx/--fy is the fan offset, --i the stagger index;
         they match the buttons below 1:1. -->
    <g filter="url(#t-goo-filter)">
      <circle class="t-goo-blob" cx="100" cy="100" r="20" style="--fx: -54px; --fy: -34px; --i: 0;" />
      <circle class="t-goo-blob" cx="100" cy="100" r="20" style="--fx: 0px;   --fy: -64px; --i: 1;" />
      <circle class="t-goo-blob" cx="100" cy="100" r="20" style="--fx: 54px;  --fy: -34px; --i: 2;" />
      <circle class="t-goo-blob t-goo-blob-main" cx="100" cy="100" r="20" />
    </g>
  </svg>

  <!-- UI layer (crisp): transparent hit targets + icons only. -->
  <button type="button" class="t-goo-item" style="--fx: -54px; --fy: -34px; --i: 0;" aria-label="New file" tabindex="-1">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6z"/><path d="M9 1.5V6h4.5"/></svg>
  </button>
  <button type="button" class="t-goo-item" style="--fx: 0px;   --fy: -64px; --i: 1;" aria-label="Add image" tabindex="-1">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><circle cx="5.5" cy="5.5" r="1.25"/><path d="M14.5 10.5L11 7l-7.5 7.5"/></svg>
  </button>
  <button type="button" class="t-goo-item" style="--fx: 54px;  --fy: -34px; --i: 2;" aria-label="New folder" tabindex="-1">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5z"/></svg>
  </button>

  <!-- Main button — the plus glyph spun 45° IS the X, so one icon
       covers both states. -->
  <button type="button" class="t-goo-main" aria-expanded="false" aria-label="Open menu">
    <span class="t-goo-swap">
      <span class="t-goo-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M10 4V16M4 10H16"/></svg>
      </span>
    </span>
  </button>
</div>
```

**Geometry.** The anchor is `200 × 140`; the main button's centre sits at `(100, 100)`
and the satellites ride a symmetric equal-radius fan (r ≈ 64) centred on the vertical
axis: `(-54, -34)`, `(0, -64)`, `(54, -34)`. The SVG `viewBox` is 1:1 with those CSS
pixels, so the circles land exactly under the buttons. Change the fan by editing
`--fx/--fy` on **both** the circle and its button, or scale the whole fan with
`--goo-spread`.

**Filter id.** `t-goo-filter` is a document-global id. If you render more than one menu
per page, give each instance a unique id (see the React variant, which derives it from
`useId()`).

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--goo-open-dur` | `350ms` | fan-out duration |
| `--goo-open-ease` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | springy overshoot on open |
| `--goo-close-dur` | `250ms` | retraction duration |
| `--goo-close-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | smooth-out on close |
| `--goo-stagger` | `40ms` | per-satellite open delay (`--i` × this) |
| `--goo-spread` | `1` | multiplies every satellite's fan offset |
| `--goo-blur` | `6` | goo `stdDeviation` — JS mirrors it onto the filter |
| `--goo-contrast` | `18` | goo alpha slope — JS mirrors it onto the filter |
| `--goo-icon-dur` | `250ms` | plus → X rotation duration |
| `--goo-icon-rotate` | `45deg` | the plus spun 45° reads as the X |
| `--goo-icon-ease` | `ease-in-out` | rotation pacing |
| `--goo-anticip` | `5px` | close anticipation nudge distance (vertical) |
| `--goo-anticip-dur` | `700ms` | anticipation clock |
| `--goo-anticip-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | anticipation pacing |
| `--goo-surface` | `#ffffff` | blob fill — the visible button surface |
| `--goo-icon-color` | `#17181c` | icon colour on both layers |

```css
:root {
  --goo-open-dur: 350ms;
  --goo-open-ease: cubic-bezier(0.34, 1.56, 0.64, 1);
  --goo-close-dur: 250ms;
  --goo-close-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --goo-stagger: 40ms;
  --goo-spread: 1;
  --goo-blur: 6;
  --goo-contrast: 18;
  --goo-icon-dur: 250ms;
  --goo-icon-rotate: 45deg;
  --goo-icon-ease: ease-in-out;
  --goo-anticip: 5px;
  --goo-anticip-dur: 700ms;
  --goo-anticip-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --goo-surface: #ffffff;
  --goo-icon-color: #17181c;
}
```

`--goo-blur` and `--goo-contrast` are **unitless numbers**: they map to SVG filter
attributes, not CSS properties, so the toggle script mirrors them onto the primitives
(see the JS below). The other tokens are pure CSS and live-tweak with no re-init.

## CSS

```css
/* Anchor reserves the OPEN fan's footprint so nothing reflows when
   the menu opens. */
.t-goo-anchor {
  position: relative;
  width: 200px;
  height: 140px;
}

/* Blob layer — carries the goo AND the shadow. Plain filled circles
   mirroring the button geometry 1:1; the filter runs goo FIRST, then
   shadows the merged silhouette, so one consistent shadow hugs the
   liquid through every state. */
.t-goo-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  /* Promote the filtered layer: WebKit otherwise repaints the goo a
     frame or two behind the plain-DOM buttons, which reads as the
     icons running ahead of their surface. */
  will-change: filter, transform;
}

/* transform, NOT the individual `translate:` property — WebKit's
   support for individual transform properties on SVG elements (and
   inside keyframes) is what breaks the fan sync, the anticipation and
   the easings in Safari. Classic transform is solid everywhere. */
.t-goo-blob {
  fill: var(--goo-surface, #ffffff);
  transform: translate(0, 0);
  transform-box: fill-box;
  transition: transform var(--goo-close-dur) var(--goo-close-ease);
  will-change: transform;
}
.t-goo-anchor[data-open="true"] .t-goo-blob {
  transform: translate(calc(var(--fx, 0px) * var(--goo-spread)),
                       calc(var(--fy, 0px) * var(--goo-spread)));
  transition: transform var(--goo-open-dur) var(--goo-open-ease);
  transition-delay: calc(var(--i, 0) * var(--goo-stagger));
}

/* UI layer — transparent hit targets + crisp icons only; the goo
   liquid below is the visible surface (and its filter derives the
   shadow from the merged silhouette). */
.t-goo-item,
.t-goo-main {
  position: absolute;
  left: 80px;
  top: 80px;
  width: 40px;
  height: 40px;
  border: 0;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--goo-icon-color, #17181c);
  -webkit-tap-highlight-color: transparent;
  transform: translate(0, 0);
  transition: transform var(--goo-close-dur) var(--goo-close-ease),
              background-color 120ms ease;
  will-change: transform;
}
/* Satellites are inert while closed — they're stacked under the main
   button and must not swallow its clicks. */
.t-goo-item { pointer-events: none; }
.t-goo-anchor[data-open="true"] .t-goo-item {
  pointer-events: auto;
  transform: translate(calc(var(--fx, 0px) * var(--goo-spread)),
                       calc(var(--fy, 0px) * var(--goo-spread)));
  transition: transform var(--goo-open-dur) var(--goo-open-ease),
              background-color 120ms ease;
  transition-delay: calc(var(--i, 0) * var(--goo-stagger)), 0ms;
}
.t-goo-anchor[data-open="true"] .t-goo-item:hover { background: rgba(0, 0, 0, 0.04); }
.t-goo-main:focus-visible,
.t-goo-item:focus-visible {
  outline: 2px solid #17181c;
  outline-offset: 2px;
}

/* Satellite icons hold back while the blob is still merged with the
   main button, then cross-blur in as it pulls clear — icons floating
   free of any surface breaks the liquid illusion. On close they clear
   out inside the first stretch of the retraction, mirroring how they
   arrive a third of the way into the open; lingering icons read as
   detached the moment the goo layer repaints even a frame late. */
.t-goo-item svg {
  display: block;
  opacity: 0;
  filter: blur(2px);
  transition: opacity 120ms ease, filter 120ms ease;
}
/* Icons materialise with a 2px cross-blur early in the flight (a short
   fixed head start per satellite), so they ride the button into place
   instead of popping after it lands. */
.t-goo-anchor[data-open="true"] .t-goo-item svg {
  opacity: 1;
  filter: blur(0);
  transition: opacity 180ms ease, filter 180ms ease;
  transition-delay: calc(var(--i, 0) * var(--goo-stagger) + 120ms),
                    calc(var(--i, 0) * var(--goo-stagger) + 120ms);
}

/* Close anticipation — the button (and its blob, so the goo follows)
   nudges down into the returning satellites' momentum and settles
   back. The driver adds .is-anticipating for the keyframes' duration
   on close. */
@keyframes t-goo-anticipate {
  0%   { transform: translateY(0); }
  30%  { transform: translateY(var(--goo-anticip)); }
  100% { transform: translateY(0); }
}
/* The nudge rides the WHOLE goo layer, not just the main blob: with
   every blob stacked at the centre when closed, moving one circle
   inside the union merely stretches the silhouette vertically — the
   layer moving as one is what reads as the button physically dipping.
   Satellites still mid-flight keep their own return transitions
   relative to the moving layer. */
.t-goo-anchor.is-anticipating .t-goo-layer,
.t-goo-anchor.is-anticipating .t-goo-main {
  /* Longhands, not the `animation` shorthand: WebKit mis-parses var()
     inside the shorthand and falls back to 0s / defaults. */
  animation-name: t-goo-anticipate;
  animation-duration: var(--goo-anticip-dur);
  animation-timing-function: var(--goo-anticip-ease);
  animation-fill-mode: both;
}

/* Plus → X: pure rotation — the plus glyph spun 45° IS the X, so one
   icon covers both states with a single tween. */
.t-goo-swap {
  position: relative;
  display: inline-grid;
  place-items: center;
  transform: rotate(0deg);
  transition: transform var(--goo-icon-dur) var(--goo-icon-ease);
}
.t-goo-anchor[data-open="true"] .t-goo-swap { transform: rotate(var(--goo-icon-rotate)); }
.t-goo-icon {
  grid-area: 1 / 1;
  display: inline-flex;
}
.t-goo-icon svg { display: block; }

@media (prefers-reduced-motion: reduce) {
  .t-goo-blob,
  .t-goo-item,
  .t-goo-item svg,
  .t-goo-swap,
  .t-goo-icon { transition: none !important; }
  .t-goo-anchor.is-anticipating .t-goo-layer,
  .t-goo-anchor.is-anticipating .t-goo-main { animation: none !important; }
}
```

## JS

The CSS owns the fan, the goo, the icon cross-blur and the plus → X. The script only
has three jobs: flip `data-open` on the anchor, mirror the two goo knobs onto the SVG
filter primitives (they're attributes, not CSS properties), and add `.is-anticipating`
for the close nudge.

```js
// Read a numeric CSS custom property from :root (ms/s aware).
function readNum(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s") && !raw.endsWith("ms")) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

function createGooeyMenu(anchor) {
  const toggle = anchor.querySelector(".t-goo-main");
  if (!anchor || !toggle) return null;
  const blurEls = anchor.querySelectorAll('filter feGaussianBlur[result="blur"]');
  const matrixEls = anchor.querySelectorAll('filter feColorMatrix[result="goo"]');
  let anticipTimer = null;

  // The goo filter's blur/contrast are SVG attributes, not CSS, so the
  // tokens are mirrored onto the primitives on every toggle.
  function applyGooKnobs() {
    const blur = readNum("--goo-blur", 6);
    const slope = readNum("--goo-contrast", 18);
    // The intercept scales with the slope so the goo threshold stays at
    // the same alpha crossing (the classic goo pair is 18 / -7).
    const intercept = -((slope * 7) / 18);
    blurEls.forEach((el) => el.setAttribute("stdDeviation", String(blur)));
    matrixEls.forEach((el) => {
      el.setAttribute(
        "values",
        "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 " + slope + " " + intercept,
      );
    });
  }
  applyGooKnobs();

  function setOpen(open) {
    if ((anchor.getAttribute("data-open") === "true") === open) return;
    applyGooKnobs();
    anchor.setAttribute("data-open", String(open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    window.clearTimeout(anticipTimer);
    if (!open) {
      // The nudge rides both the goo layer and the main button, so the
      // liquid follows the dip.
      anchor.classList.add("is-anticipating");
      anticipTimer = window.setTimeout(() => {
        anchor.classList.remove("is-anticipating");
      }, readNum("--goo-anticip-dur", 700) + 50);
    } else {
      anchor.classList.remove("is-anticipating");
    }
  }

  function onToggleClick(e) {
    e.stopPropagation();
    setOpen(anchor.getAttribute("data-open") !== "true");
  }
  function onDocClick(e) {
    if (!anchor.contains(e.target)) setOpen(false);
  }
  function onKeyDown(e) {
    if (e.key === "Escape") setOpen(false);
  }

  toggle.addEventListener("click", onToggleClick);
  // Satellites are affordances — any pick closes the menu.
  const items = anchor.querySelectorAll(".t-goo-item");
  items.forEach((item) => item.addEventListener("click", () => setOpen(false)));
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeyDown);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    destroy() {
      window.clearTimeout(anticipTimer);
      toggle.removeEventListener("click", onToggleClick);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
```

Wire it up:

```js
createGooeyMenu(document.querySelector(".t-goo-anchor"));
```

Give the satellites their real handlers as usual — the click listener above only closes
the menu, it doesn't preventDefault or stop propagation.

## Notes

- **Why the filter lives on SVG shapes.** `filter="url(#t-goo-filter)"` is set on a `<g>`
  inside the `<svg>`, never as CSS `filter: url(#id)` on HTML elements: WebKit renders
  CSS url() filters on HTML content unreliably (dropped repaints, stale frames, mismatched
  layer promotion). Filtering SVG content renders identically in every engine. That's the
  whole reason for the two-layer split — circles mirroring the button geometry 1:1 below,
  the real buttons unfiltered above, so the liquid is filtered and the icons stay crisp.
- **One filter, one shadow.** Because the shadow passes are built from `shape` (the
  post-goo silhouette) and merged behind it, the shadow follows the liquid bridges as the
  satellites split and merge. Two things are easy to get wrong here: chaining
  `feDropShadow` primitives (each shadows the *previous result*, so the passes compound
  into a muddy stack), and leaving `color-interpolation-filters` at its `linearRGB`
  default (the falloff won't match the CSS `box-shadow` it's reproducing).
- **The binarize before the dilate.** The 1px spread ring is a `feMorphology dilate
  radius="1"`, but dilating the goo alpha directly also dilates its ~1px soft fringe, which
  then reads as a second hairline outside the first. The `feColorMatrix` alpha slam
  (`60 / -29.5` ≈ a 0.5 threshold) hardens the contour first, so the ring hugs the shape
  the way `box-shadow` hugs a border-box.
- **Classic `transform`, longhand `animation-*`.** Individual transform properties
  (`translate:`) on SVG elements and `var()` inside the `animation` shorthand are both
  shaky in WebKit — the fan desyncs and the anticipation silently runs at `0s`. Both are
  deliberate, not stylistic.
- **Stagger and offsets stay paired.** `--fx/--fy/--i` are declared inline on *both* the
  circle and its button. If you move one, move the other, or the icon will drift off its
  liquid.

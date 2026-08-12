# Spinner to check morph (Pro)

## When to use

A small task badge (22px) that is spinning while work is in flight and **resolves into a
green success check** when it lands — task lists, checklists, upload rows, save
indicators, anything where a row-level spinner needs an ending. The badge pops up and
falls back, the green disc fades in over the dying spinner, the whole component
cross-blurs for a moment, and the check draws itself while the green is still arriving.
After a hold it cross-fades back to the live spinner.

Everything is layered: a static ring (the track), a spinning arc (the highlight), a green
fill disc, and the check path — all four hanging off a **single `[data-state]` attribute**
on the badge. That is the whole API: `data-state="spinning"` or `data-state="done"`. JS
only calibrates the check's dash length, flips the attribute, and schedules the revert;
every transition, including the way back, lives in CSS.

## HTML usage

```html
<span class="t-check-row">
  <!-- Wrapper exists only to carry the cross-blur (see the CSS note). -->
  <span class="t-check-blur-wrap" id="check-blur-wrap">
    <span class="t-check-badge" id="check-badge" data-state="spinning"
          role="img" aria-label="In progress">
      <span class="t-check-ring" aria-hidden="true"></span>
      <span class="t-check-arc" aria-hidden="true"></span>
      <span class="t-check-fill" aria-hidden="true"></span>
      <span class="t-check-disc" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <!-- Exact design geometry, in disc-local coords. -->
          <path class="t-check-mark" d="M8 12.5L10.8 15.5L16.4 9.5" />
        </svg>
      </span>
    </span>
  </span>
  <span class="t-check-texts">
    <span class="t-check-title">Build demo page</span>
    <span class="t-check-sub">8 subtasks</span>
  </span>
</span>
```

Flip `data-state` to `"done"` to morph, back to `"spinning"` to revert. Layer order
matters: ring, arc, fill, check — the disc paints over the spinner.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--check-spin-dur` | `900ms` | one revolution of the spinner arc |
| `--check-ring-w` | `2.5px` | stroke weight of the track **and** the arc |
| `--check-hop` | `3px` | how far the badge rises during the morph |
| `--check-up-dur` | `250ms` | hop phase 1: the rise |
| `--check-up-ease` | `cubic-bezier(0.34, 1.35, 0.64, 1)` | rise curve |
| `--check-down-dur` | `300ms` | hop phase 2: the fall back |
| `--check-down-ease` | `cubic-bezier(0.14, 2.56, 0.94, 1)` | fall curve (overshoots, then settles) |
| `--check-pop-scale` | `1.09` | done size (22 → 24px disc) |
| `--check-pop-dur` | `350ms` | scale-up duration |
| `--check-pop-ease` | `cubic-bezier(0.34, 1.96, 0.94, 1)` | scale-up curve |
| `--check-fill-dur` | `350ms` | green disc fade-in — the master clock of the morph |
| `--check-fill-ease` | `cubic-bezier(0.34, 1.35, 0.64, 1)` | fill curve |
| `--check-blur` | `0.5px` | cross-blur radius during the morph |
| `--check-draw-dur` | `600ms` | check draw |
| `--check-draw-delay` | `80ms` | extra offset on top of the fill (see the sequencing note) |
| `--check-draw-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | draw curve |
| `--check-mark-w` | `2` | check stroke weight (SVG user units) |
| `--check-revert-dur` | `250ms` | the way back — every layer reverses on this clock |
| `--check-revert-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | revert curve |
| `--check-hold` | `2000ms` | time spent on the check before reverting (read by the JS) |
| `--check-green` | `#35ba00` | success colour |

```css
:root {
  --check-spin-dur:    900ms;
  --check-pop-dur:     350ms;
  --check-pop-ease:    cubic-bezier(0.34, 1.96, 0.94, 1);
  --check-fill-dur:    350ms;  /* green disc fade-in */
  --check-fill-ease:   cubic-bezier(0.34, 1.35, 0.64, 1);
  --check-draw-dur:    600ms;
  --check-draw-delay:  80ms;
  --check-draw-ease:   cubic-bezier(0.22, 1, 0.36, 1);
  --check-hold:        2000ms; /* time on the check before reverting */
  --check-revert-dur:  250ms;
  --check-revert-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --check-hop:         3px;    /* how far the badge rises on the morph */
  --check-up-dur:      250ms;  /* hop UP: the rise */
  --check-up-ease:     cubic-bezier(0.34, 1.35, 0.64, 1);
  --check-down-dur:    300ms;  /* hop DOWN: the fall back */
  --check-down-ease:   cubic-bezier(0.14, 2.56, 0.94, 1);
  --check-pop-scale:   1.09;   /* done size (22 -> 24px disc) */
  --check-blur:        0.5px;  /* cross-blur while morphing */
  --check-ring-w:      2.5px;  /* spinner track + arc stroke weight */
  --check-mark-w:      2;      /* check draw stroke weight */
  --check-green:       #35ba00;
}
```

## CSS

```css
/* Cross-blur wrapper: blurs the badge as ONE surface, so every layer
   softens together through the morph and resolves crisp — a genuine
   cross-blur, not a one-way blur on a single layer. It must be a
   SEPARATE element: CSS `filter` is applied BEFORE `mask`/clipping, so
   blurring a masked layer does nothing, and filtering the badge itself
   would also blur its own scale/translate compositing. */
.t-check-blur-wrap {
  display: inline-flex;
  filter: blur(0);
  transition: filter var(--check-revert-dur) var(--check-revert-ease);
  will-change: filter;
}
.t-check-blur-wrap.is-crossing {
  filter: blur(var(--check-blur));
  transition: filter calc(var(--check-fill-dur) * 0.45) var(--check-fill-ease);
}

/* The badge scales 22 → 24 (the done size) with the pop ease and hops
   vertically. Both live here so the ring, fill and check compose
   underneath as one object. */
.t-check-badge {
  position: relative;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  scale: 1;
  transition: scale var(--check-revert-dur) var(--check-revert-ease);
  will-change: scale, transform;
}
.t-check-badge[data-state="done"] {
  scale: var(--check-pop-scale);   /* 22 → 24, the done size */
  transition: scale var(--check-pop-dur) var(--check-pop-ease);
  /* TWO-PHASE HOP, independently controllable: up, then down, as two
     animations where the second is DELAYED by the first's duration.
     fill-mode is `forwards` (NOT `both`) — with `both` the delayed
     down-animation would apply its `from` state immediately and yank
     the badge up before the rise had a chance to play.
     Longhands, not the `animation` shorthand: WebKit mis-parses
     `var()` inside the shorthand and falls back to 0s. */
  animation-name: t-check-pop-up, t-check-pop-down;
  animation-duration: var(--check-up-dur), var(--check-down-dur);
  animation-timing-function: var(--check-up-ease), var(--check-down-ease);
  animation-delay: 0ms, var(--check-up-dur);
  animation-fill-mode: forwards, forwards;
}
/* Classic `transform` keyframes, NOT the individual `translate:`
   property — WebKit's support for individual transform properties
   inside @keyframes is recent and inconsistent, and the hop felt wrong
   in Safari. The `scale` property composes with `transform`, so the
   badge's scale transition above is unaffected. */
@keyframes t-check-pop-up {
  from { transform: translateY(0); }
  to   { transform: translateY(calc(var(--check-hop, 3px) * -1)); }
}
@keyframes t-check-pop-down {
  from { transform: translateY(calc(var(--check-hop, 3px) * -1)); }
  to   { transform: translateY(0); }
}

/* Track ring — the light circle. It never morphs; the green disc
   simply fades in over it while it fades out. */
.t-check-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: var(--check-ring-w) solid rgba(0, 0, 0, 0.1);
  transition: opacity var(--check-revert-dur) ease,
              filter var(--check-revert-dur) ease;
}
.t-check-badge[data-state="done"] .t-check-ring {
  opacity: 0;
  transition: opacity calc(var(--check-fill-dur) * 0.7) ease;
}

/* Green disc — it fades IN (opacity) rather than growing a stroke or
   flooding through a mask. Same read, far less machinery, and the fade
   is trivially tunable. */
.t-check-fill {
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  background: var(--check-green);
  /* Two declarations on purpose: p3-capable browsers take the second,
     everyone else keeps the sRGB rgba() fallback above it. */
  box-shadow:
    0 0 0 0.504px rgba(0, 0, 0, 0.05) inset,
    0 0.504px 0.504px 0 rgba(0, 0, 0, 0.10),
    0 0.504px 2.016px 0 rgba(0, 0, 0, 0.08),
    0 -0.504px 0.504px 0 rgba(0, 0, 0, 0.09) inset;
  box-shadow:
    0 0 0 0.504px color(display-p3 0 0 0 / 0.05) inset,
    0 0.504px 0.504px 0 color(display-p3 0 0 0 / 0.10),
    0 0.504px 2.016px 0 color(display-p3 0 0 0 / 0.08),
    0 -0.504px 0.504px 0 color(display-p3 0 0 0 / 0.09) inset;
  opacity: 0;
  transition: opacity var(--check-revert-dur) var(--check-revert-ease);
  will-change: opacity;
}
.t-check-badge[data-state="done"] .t-check-fill {
  opacity: 1;
  transition: opacity var(--check-fill-dur) var(--check-fill-ease);
}

/* Lead arc — the dark highlight, on its own layer so the morph never
   TRANSFORMS it: when the fill starts, the spin simply pauses in place
   and the arc fades out. (Transforming it — scaling or rotating it into
   the check — fought the morph and read as two things happening.) */
.t-check-arc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: var(--check-ring-w) solid transparent;
  border-top-color: #7a7a7a;
  animation-name: t-check-spin;
  animation-duration: var(--check-spin-dur);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  transition: opacity var(--check-revert-dur) var(--check-revert-ease);
  will-change: transform;
}
@keyframes t-check-spin {
  to { transform: rotate(360deg); }
}
.t-check-badge[data-state="done"] .t-check-arc {
  opacity: 0;
  animation-play-state: paused;
  transition: opacity calc(var(--check-fill-dur) * 0.5) ease;
}

/* Check overlay — the svg fills the badge box (22 × 1.09 = the 24px
   done disc), so the 24-viewBox check renders at exactly design size. */
.t-check-disc {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.t-check-disc svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* Check path — a stroke-dashoffset draw. The dash length is calibrated
   from the real path length in JS (getTotalLength), so the draw never
   over- or under-shoots; the 20 fallback only covers the first frame. */
.t-check-mark {
  fill: none;
  stroke: #ffffff;
  stroke-width: var(--check-mark-w);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: var(--check-mark-len, 20);
  stroke-dashoffset: var(--check-mark-len, 20);
  transition: stroke-dashoffset var(--check-revert-dur) var(--check-revert-ease);
}
.t-check-badge[data-state="done"] .t-check-mark {
  stroke-dashoffset: 0;
  /* Sequenced, not queued: the draw takes over while the green is still
     arriving — 200ms BEFORE the fill completes, plus the draw delay. It
     reads as one connected gesture instead of two steps. */
  transition: stroke-dashoffset var(--check-draw-dur) var(--check-draw-ease)
    calc(var(--check-fill-dur) + var(--check-draw-delay) - 200ms);
}

/* Row chrome — optional, matches the demo layout. */
.t-check-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.t-check-texts {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.t-check-title {
  font-size: 13px;
  font-weight: 500;
  line-height: 13px;
}
.t-check-sub {
  font-size: 13px;
  font-weight: 400;
  line-height: 13px;
  opacity: 0.5;
}

/* Reduced motion: no spin, no hop, no blur — the badge jumps straight
   to the drawn check. */
@media (prefers-reduced-motion: reduce) {
  .t-check-arc { animation: none !important; }
  .t-check-blur-wrap,
  .t-check-blur-wrap.is-crossing {
    filter: none !important;
    transition: none !important;
  }
  .t-check-ring, .t-check-arc, .t-check-fill { transition: none !important; }
  .t-check-badge, .t-check-mark {
    transition: none !important;
    animation: none !important;
  }
  .t-check-badge[data-state="done"] .t-check-mark { stroke-dashoffset: 0; }
}
```

## JavaScript

The controller does three things: calibrate the check path length, flip `data-state`, and
schedule the revert. There is deliberately **no collapse animation** — flipping the
attribute back is the entire revert, because every layer already has a reverse transition
on the `--check-revert-dur` clock, so the badge cross-fades to the spinner.

```js
// Read a numeric CSS variable off :root ("px"/"ms"/"s" suffixes ok).
function readNum(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s") && !raw.endsWith("ms")) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

// `badge` is the [data-state] element, `blurWrap` its cross-blur parent.
function createCheckMorph(badge, blurWrap) {
  const mark = badge.querySelector(".t-check-mark");
  let blurTimer = null;
  let revertTimer = null;

  // Calibrate the dash to the real path length so the draw lands
  // exactly on the last pixel of the check — no overshoot, no gap.
  const len = Math.ceil(mark.getTotalLength());
  badge.style.setProperty("--check-mark-len", String(len));

  // Cross-blur pulse: the whole badge softens as the morph starts and
  // resolves crisp as it lands. Fired in BOTH directions.
  function crossBlur() {
    if (!blurWrap) return;
    window.clearTimeout(blurTimer);
    blurWrap.classList.add("is-crossing");
    blurTimer = window.setTimeout(function () {
      blurWrap.classList.remove("is-crossing");
    }, readNum("--check-fill-dur", 350) * 0.45);
  }

  // Morph to the check. `hold` = ms before reverting; pass 0 to stay on
  // the check until you call spin() yourself (the usual real-world case).
  function done(hold) {
    window.clearTimeout(revertTimer);
    if (badge.getAttribute("data-state") === "done") {
      // Replay from zero: drop the state and force a reflow so the hop
      // keyframes restart instead of being ignored as "already applied".
      badge.setAttribute("data-state", "spinning");
      void badge.offsetWidth;
    }
    badge.setAttribute("data-state", "done");
    crossBlur();
    const ms = hold === undefined ? readNum("--check-hold", 2000) : hold;
    if (ms > 0) revertTimer = window.setTimeout(spin, ms);
  }

  // Back to the live spinner. Flipping the attribute is all it takes.
  function spin() {
    window.clearTimeout(revertTimer);
    crossBlur();
    badge.setAttribute("data-state", "spinning");
  }

  return { done: done, spin: spin };
}

const morph = createCheckMorph(
  document.getElementById("check-badge"),
  document.getElementById("check-blur-wrap"),
);

// Real use: resolve the badge when the work finishes and leave it there.
saveTask().then(function () {
  morph.done(0);
});

// Demo use: morph, hold for --check-hold, cross-fade back.
// morph.done();
```

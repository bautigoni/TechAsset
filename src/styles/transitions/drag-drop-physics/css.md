# Drag & drop with physics (Pro)

## When to use

Moving one thing into another and wanting the move to have **weight**: a file onto an
upload target, a photo onto a canvas slot, a card into a column. The chip is dragged with
real Pointer Events — it follows the finger 1:1, lifts 5% on grab, and **tilts from
horizontal velocity** so a fast flick leans into the direction of travel.

The release is the interesting part. The chip does **not** fly to the zone and it does
**not** resize: it fades out with a 2px blur exactly where it was let go, while the
**zone** morphs into the image and plays a squash-and-spring anticipation — down to 0.97,
then back to 1, as two independently tunable phases. At the bottom of the squash a ring of
turbulence-warped smoke squeezes out from under the image, the way air escapes a surface
that just took an impact. Dropping outside the zone springs the chip home.

Every piece of the drop is CSS (transitions + two keyframe phases); JS only tracks the
pointer, toggles classes, and builds the smoke rings. Reduced motion keeps the drag and
the drop but skips the smoke entirely.

## HTML usage

```html
<div class="t-drop-wrap">
  <div class="t-drop-chip">
    <img alt="" src="/your-image.jpg" draggable="false" />
  </div>

  <div class="t-drop-zone">
    <span class="t-drop-zone-label">Drag &amp; drop<br />it here</span>
    <!-- The landed image: same src, exactly the zone's box. -->
    <img class="t-drop-dropped" alt="" src="/your-image.jpg" />
    <!-- Smoke as SVG CONTENT: the turbulence filter is applied to
         shapes inside the svg, which every engine renders correctly.
         WebKit's displacement bug only affects CSS filter: url(#id)
         on HTML content — see Notes. -->
    <svg class="t-drop-puffs" viewBox="0 0 204 204" aria-hidden="true" focusable="false">
      <g class="t-drop-puff-group" filter="url(#t-drop-smoke)"></g>
    </svg>
  </div>
</div>

<!-- One filter per page is enough; the driver mirrors the --drop-smoke-*
     tokens onto these primitives before each burst. -->
<svg width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
  <filter id="t-drop-smoke" x="-150%" y="-150%" width="400%" height="400%">
    <!-- Low-frequency noise + strong displacement = long smooth
         undulations: the ring stays one CONTINUOUS wavy front
         instead of tearing into blob-like granules. -->
    <feTurbulence type="fractalNoise" baseFrequency="0.046 0.046" numOctaves="2" seed="4" result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="warped" />
    <feGaussianBlur in="warped" stdDeviation="5" />
  </filter>
</svg>
```

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--drop-zone-border` | `2px` | dashed drop-zone border width (the landed image insets by this) |
| `--drop-card-shadow` | 3-layer shadow | resting chip + filled zone elevation |
| `--drop-card-shadow-p3` | 3-layer P3 shadow | same shadow in display-p3; ignored where unsupported |
| `--drop-card-shadow-off` | same shadow at alpha 0 | the transparent end state, so the shadow *fades* |
| `--drop-lift-scale` | `1.05` | chip scale while grabbed |
| `--drop-lift-dur` | `200ms` | lift ramp |
| `--drop-tilt-max` | `10` | deg, velocity-driven tilt clamp while dragging |
| `--drop-dur` | `450ms` | chip fade + blur out on a successful drop |
| `--drop-ease` | `cubic-bezier(0.34, 1.35, 0.64, 1)` | that fade's pacing |
| `--drop-return-dur` | `500ms` | spring back home when dropped outside |
| `--drop-return-ease` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | overshooting spring |
| `--drop-morph-squash` | `0.97` | zone scale at the dip |
| `--drop-down-dur` | `250ms` | scale DOWN: the squash |
| `--drop-down-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | squash pacing |
| `--drop-up-dur` | `450ms` | scale UP: the spring back |
| `--drop-up-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | spring pacing |
| `--drop-fade-in` | `400ms` | zone → image cross-fade (and the shadow arriving) |
| `--drop-fade-ease` | `ease-in-out` | cross-fade pacing |
| `--drop-puff-dur` | `1500ms` | base smoke wave duration |
| `--drop-puff-dist` | `30` | px travel of the wavefront |
| `--drop-wave-count` | `1` | concentric shells per burst |
| `--drop-wave-width` | `50` | outermost shell stroke (px) |
| `--drop-wave-falloff` | `20` | px thinner per successive shell |
| `--drop-wave-opacity` | `0.42` | shell ink alpha |
| `--drop-wave-delay` | `0ms` | offset of the whole burst vs the squash |
| `--drop-wave-stagger` | `150ms` | delay between shells |
| `--drop-wave-grow` | `0.28` | per-shell duration growth (×) |
| `--drop-wave-gravity` | `10px` | downward drift by burst end |
| `--drop-smoke-freq-x` | `0.046` | turbulence base frequency x |
| `--drop-smoke-freq-y` | `0.046` | turbulence base frequency y |
| `--drop-smoke-warp` | `30` | displacement strength |
| `--drop-smoke-blur` | `5` | softening blur sigma |
| `--drop-hold` | `1800ms` | dropped image hold before revert |
| `--drop-out-dur` | `400ms` | dropped image fade/blur out |
| `--drop-respawn-dur` | `250ms` | chip respawn at the source spot |

```css
:root {
  --drop-zone-border: 2px;
  --drop-card-shadow:
    0 1px 2px 0 rgba(0, 0, 0, 0.15),
    0 2px 6px 0 rgba(0, 0, 0, 0.10),
    0 4px 20px 0 rgba(0, 0, 0, 0.15);
  --drop-card-shadow-p3:
    0 1px 2px 0 color(display-p3 0 0 0 / 0.15),
    0 2px 6px 0 color(display-p3 0 0 0 / 0.10),
    0 4px 20px 0 color(display-p3 0 0 0 / 0.15);
  --drop-card-shadow-off:
    0 1px 2px 0 rgba(0, 0, 0, 0),
    0 2px 6px 0 rgba(0, 0, 0, 0),
    0 4px 20px 0 rgba(0, 0, 0, 0);
  --drop-lift-scale: 1.05;
  --drop-lift-dur: 200ms;
  --drop-tilt-max: 10;
  --drop-dur: 450ms;
  --drop-ease: cubic-bezier(0.34, 1.35, 0.64, 1);
  --drop-return-dur: 500ms;
  --drop-return-ease: cubic-bezier(0.34, 1.56, 0.64, 1);
  --drop-morph-squash: 0.97;
  --drop-down-dur: 250ms;
  --drop-down-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --drop-up-dur: 450ms;
  --drop-up-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --drop-fade-in: 400ms;
  --drop-fade-ease: ease-in-out;
  --drop-puff-dur: 1500ms;
  --drop-puff-dist: 30;
  --drop-wave-count: 1;
  --drop-wave-width: 50;
  --drop-wave-falloff: 20;
  --drop-wave-opacity: 0.42;
  --drop-wave-delay: 0ms;
  --drop-wave-stagger: 150ms;
  --drop-wave-grow: 0.28;
  --drop-wave-gravity: 10px;
  --drop-smoke-freq-x: 0.046;
  --drop-smoke-freq-y: 0.046;
  --drop-smoke-warp: 30;
  --drop-smoke-blur: 5;
  --drop-hold: 1800ms;
  --drop-out-dur: 400ms;
  --drop-respawn-dur: 250ms;
}
```

## CSS

```css
/* Demo geometry: the chip is NOT stacked above the zone, it sits
   up-and-to-the-RIGHT of it. Pair bounding box 213×192; chip 72px at
   (141, 0), zone 104px at (0, 88). Any layout works — the drag maths
   is purely relative. */
.t-drop-wrap {
  position: relative;
  width: 213px;
  height: 192px;
}

/* Source chip — the draggable image. `translate` carries the drag
   offset while `rotate`/`scale` ride separate custom properties, so
   the lift and the velocity tilt compose with the drag translate
   without any of them fighting over a single `transform`. */
.t-drop-chip {
  position: absolute;
  left: 141px;
  top: 0;
  width: 72px;
  height: 72px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--drop-card-shadow);
  box-shadow: var(--drop-card-shadow-p3);
  cursor: grab;
  /* Required: without it the browser scrolls/pans instead of
     delivering pointermove to the chip on touch. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  z-index: 5;
  translate: var(--dx, 0px) var(--dy, 0px);
  rotate: var(--tilt, 0deg);
  scale: var(--lift, 1);
  /* NOTE: no transition on `translate` here — while dragging the chip
     must track the pointer 1:1. The tween is added by .is-returning
     only for the spring home. */
  transition: scale var(--drop-lift-dur) cubic-bezier(0.22, 1, 0.36, 1),
              rotate 150ms ease-out;
  will-change: translate, rotate, scale;
}
.t-drop-chip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.t-drop-chip.is-dragging {
  cursor: grabbing;
  z-index: 30;
}
/* Springing home: JS zeroes --dx/--dy and flips this class on, so the
   translate (and the levelling tilt/lift) tween back with overshoot. */
.t-drop-chip.is-returning {
  transition: translate var(--drop-return-dur) var(--drop-return-ease),
              rotate var(--drop-return-dur) var(--drop-return-ease),
              scale var(--drop-return-dur) var(--drop-return-ease);
}
/* Released over the zone: the chip doesn't fly and doesn't resize — it
   simply dissolves where it was let go while the ZONE morphs into the
   image. Two elements, one perceived object. */
.t-drop-chip.is-fading {
  opacity: 0;
  filter: blur(2px);
  transition: opacity var(--drop-dur) var(--drop-ease),
              filter var(--drop-dur) var(--drop-ease);
  pointer-events: none;
}
@keyframes t-drop-respawn {
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: scale(1); }
}
.t-drop-chip.is-respawning {
  animation-name: t-drop-respawn;
  animation-duration: var(--drop-respawn-dur);
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

/* Drop zone — 104px square, 2px dashed, r12, faint fill. */
.t-drop-zone {
  position: absolute;
  left: 0;
  top: 88px;
  width: 104px;
  height: 104px;
  border-radius: 12px;
  border: var(--drop-zone-border) dashed rgba(0, 0, 0, 0.1);
  background: rgba(234, 234, 234, 0.2);
  transition: border-color 150ms ease, background-color 150ms ease,
              box-shadow var(--drop-fade-in) var(--drop-fade-ease);
}
/* Hover feedback while a chip is over the zone. */
.t-drop-zone.is-over {
  border-color: rgba(0, 0, 0, 0.28);
  background: rgba(234, 234, 234, 0.55);
}
.t-drop-zone-label {
  position: absolute;
  left: 50%;
  top: 38px;   /* 40px from the zone's outer edge, minus the 2px border */
  transform: translateX(-50%);
  width: 76px;
  font-size: 11px;
  line-height: 15px;
  text-align: center;
  color: #767676;
  transition: opacity 150ms ease;
  pointer-events: none;
}
.t-drop-zone.is-over .t-drop-zone-label { opacity: 0.5; }
.t-drop-zone.is-filled {
  border-color: transparent;
  box-shadow: var(--drop-card-shadow);
  box-shadow: var(--drop-card-shadow-p3);
}
.t-drop-zone.is-filled .t-drop-zone-label { opacity: 0; }

/* The landed image. Inset by the zone's border width (NEGATIVE inset,
   plus twice the border added to the size) so it covers the whole
   border box — otherwise the dashed border's track shows as a white
   hairline ringing the image. */
.t-drop-dropped {
  position: absolute;
  inset: calc(var(--drop-zone-border) * -1);
  width: calc(100% + var(--drop-zone-border) * 2);
  height: calc(100% + var(--drop-zone-border) * 2);
  object-fit: cover;
  border-radius: 12px;
  display: block;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--drop-fade-in) var(--drop-fade-ease);
}
.t-drop-zone.is-filled .t-drop-dropped { opacity: 1; }

/* Anticipation landing: the zone squashes under the impact, then
   springs back. Two SEPARATE keyframe phases rather than one 0/50/100
   animation, so the squash and the spring get their own duration AND
   their own easing; the second is delayed by the first's duration and
   both are `forwards` so the chain holds its end state. */
@keyframes t-drop-zone-down {
  from { transform: scale(1); }
  to   { transform: scale(var(--drop-morph-squash, 0.97)); }
}
@keyframes t-drop-zone-up {
  from { transform: scale(var(--drop-morph-squash, 0.97)); }
  to   { transform: scale(1); }
}
.t-drop-zone.is-landing {
  /* Longhands, not the `animation` shorthand: WebKit mis-parses
     var() substitutions inside the shorthand. */
  animation-name: t-drop-zone-down, t-drop-zone-up;
  animation-duration: var(--drop-down-dur), var(--drop-up-dur);
  animation-timing-function: var(--drop-down-ease), var(--drop-up-ease);
  animation-delay: 0ms, var(--drop-down-dur);
  animation-fill-mode: forwards, forwards;
  will-change: transform;
}

/* Revert: the image blurs away and the zone returns to its dashed
   empty state. */
.t-drop-zone.is-emptying .t-drop-dropped {
  opacity: 0;
  filter: blur(4px);
  transition: opacity var(--drop-out-dur) cubic-bezier(0.22, 1, 0.36, 1),
              filter var(--drop-out-dur) cubic-bezier(0.22, 1, 0.36, 1);
}
/* Placed AFTER .is-filled (equal specificity — source order wins) so
   the shadow fades out in step with the image instead of snapping off
   once .is-filled is finally removed. */
.t-drop-zone.is-emptying {
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: var(--drop-card-shadow-off);
  transition: box-shadow var(--drop-out-dur) cubic-bezier(0.22, 1, 0.36, 1),
              border-color var(--drop-out-dur) cubic-bezier(0.22, 1, 0.36, 1);
}

/* Impact smoke. The svg overhangs the zone by 50px on every side so
   the expanding wave never clips. Its 204-unit viewBox therefore maps
   the image box to [52, 152]. */
.t-drop-puffs {
  position: absolute;
  inset: -50px;
  width: calc(100% + 100px);
  height: calc(100% + 100px);
  overflow: visible;
  pointer-events: none;
}
/* Wavefront — a rounded ring hugging the image outline that expands
   outward while fading. The whole <g> is filtered as ONE surface, so
   the shells fuse into a single undulating smoke front with wispy,
   torn edges rather than countable blurred circles. */
.t-drop-wave {
  fill: none;
  stroke: rgba(122, 122, 122, var(--drop-wave-opacity));
  opacity: 0;
  transform: translate(0, 0) scale(0.96);
  transform-box: fill-box;
  transform-origin: center;
}
/* Subtle gravity: the wave billows out AND settles downward, the way
   impact dust does, instead of expanding perfectly radially. */
@keyframes t-drop-wave {
  0%   { opacity: 0;   transform: translate(0, 0) scale(0.96); }
  16%  { opacity: 0.9; }
  100% { opacity: 0;   transform: translate(0, var(--drop-wave-gravity, 10px)) scale(var(--wscale, 1.5)); }
}
/* --wdur / --wdelay / --wscale are per-shell, written by the driver
   onto each <rect> so the shells ride staggered clocks. */
.t-drop-zone.is-bursting .t-drop-wave {
  animation-name: t-drop-wave;
  animation-duration: var(--wdur, var(--drop-puff-dur));
  animation-timing-function: ease-out;
  animation-delay: var(--wdelay, 0ms);
  animation-fill-mode: forwards;
}

@media (prefers-reduced-motion: reduce) {
  .t-drop-chip { transition: none !important; }
  .t-drop-chip.is-respawning { animation: none !important; }
  .t-drop-zone.is-bursting .t-drop-wave,
  .t-drop-zone.is-landing { animation: none !important; }
  .t-drop-chip.is-fading,
  .t-drop-dropped { transition: none !important; }
}
```

## JavaScript

The controller owns four jobs: track the pointer (with `setPointerCapture`, so the drag
survives the cursor leaving the chip), derive the velocity tilt, decide hit/miss on
release, and build the smoke rings for one burst. Everything else is the CSS above
reacting to `is-dragging` / `is-returning` / `is-fading` / `is-over` / `is-filled` /
`is-landing` / `is-bursting` / `is-emptying`.

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

const SVG_NS = "http://www.w3.org/2000/svg";

// Wire one chip to one drop zone.
//   chip  — the draggable element (.t-drop-chip)
//   zone  — the target (.t-drop-zone); all state classes land here
//   puffs — the <g> inside .t-drop-puffs; the ring shells are built
//           into it once per burst
//   onDrop — optional, fires the moment the zone accepts the chip
function createDragDrop({ chip, zone, puffs, onDrop }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  let dragging = false;
  let settling = false;    // drop/return animation in flight
  let pointerId = null;
  let startX = 0, startY = 0;
  // dx/dy are the LIVE drag offset — the JS mirror of --dx/--dy.
  // They MUST be reset together with the CSS vars (see land()).
  let dx = 0, dy = 0;
  let lastX = 0, lastT = 0;
  let revertTimer = null;

  // Every timeout is tracked so destroy() can cancel a run in flight.
  const timers = new Set();
  function after(ms, fn) {
    const id = window.setTimeout(function () {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function setVars(x, y, tilt, lift) {
    chip.style.setProperty("--dx", x.toFixed(1) + "px");
    chip.style.setProperty("--dy", y.toFixed(1) + "px");
    if (tilt !== null) chip.style.setProperty("--tilt", tilt.toFixed(2) + "deg");
    if (lift !== null) chip.style.setProperty("--lift", String(lift));
  }

  // Hit test: the chip's CENTRE inside the zone's box. Centre rather
  // than overlap, so a drop reads the same whichever corner leads.
  function overZone() {
    const c = chip.getBoundingClientRect();
    const z = zone.getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    return cx >= z.left && cx <= z.right && cy >= z.top && cy <= z.bottom;
  }

  // The turbulence lives in SVG ATTRIBUTES, not CSS, so the smoke
  // knobs are mirrored onto the filter primitives before each burst.
  const smokeTurb = document.querySelector("#t-drop-smoke feTurbulence");
  const smokeDisp = document.querySelector("#t-drop-smoke feDisplacementMap");
  const smokeBlur = document.querySelector("#t-drop-smoke feGaussianBlur");
  function applySmokeKnobs() {
    if (smokeTurb) smokeTurb.setAttribute("baseFrequency",
      readNum("--drop-smoke-freq-x", 0.046) + " " + readNum("--drop-smoke-freq-y", 0.046));
    if (smokeDisp) smokeDisp.setAttribute("scale", String(readNum("--drop-smoke-warp", 30)));
    if (smokeBlur) smokeBlur.setAttribute("stdDeviation", String(readNum("--drop-smoke-blur", 5)));
  }

  // One CONTINUOUS distorted wave: concentric ring shells hugging the
  // image outline, expanding outward on staggered clocks. The group's
  // turbulence filter bends them into a single undulating smoke front
  // — no discrete particles to count.
  function buildPuffs() {
    applySmokeKnobs();
    const dist = readNum("--drop-puff-dist", 30);
    const dur = readNum("--drop-puff-dur", 1500);
    const count = Math.max(1, Math.round(readNum("--drop-wave-count", 1)));
    const baseW = readNum("--drop-wave-width", 50);
    const falloff = readNum("--drop-wave-falloff", 20);
    const stagger = readNum("--drop-wave-stagger", 150);
    const grow = readNum("--drop-wave-grow", 0.28);
    const travel = 1 + (dist * 2) / zone.offsetWidth;  // px -> scale factor
    puffs.replaceChildren();
    for (let w = 0; w < count; w++) {
      const wave = document.createElementNS(SVG_NS, "rect");
      const sw = Math.max(2, baseW - w * falloff);
      const hw = sw / 2;
      wave.setAttribute("class", "t-drop-wave");
      // An SVG stroke STRADDLES its path, while a CSS border draws
      // inward from the border-box. Inset each rect by half its
      // stroke and shrink it by a full stroke, so the ring's OUTER
      // edge lands exactly on the image box (52..152 in the
      // 204-unit viewBox) instead of overhanging it by hw.
      wave.setAttribute("x", String(52 + hw));
      wave.setAttribute("y", String(52 + hw));
      wave.setAttribute("width", String(Math.max(1, 100 - sw)));
      wave.setAttribute("height", String(Math.max(1, 100 - sw)));
      wave.setAttribute("rx", String(Math.max(2, 14 - hw)));
      wave.setAttribute("stroke-width", String(sw));
      wave.style.setProperty("--wdur", Math.round(dur * (0.85 + w * grow)) + "ms");
      wave.style.setProperty("--wdelay", Math.round(w * stagger) + "ms");
      wave.style.setProperty("--wscale", (travel + w * 0.07).toFixed(3));
      puffs.appendChild(wave);
    }
  }

  function land() {
    // The zone morphs into the image (cross-fade) and plays the
    // squash-and-spring anticipation; the chip is meanwhile
    // dissolving wherever it was released.
    zone.classList.add("is-filled", "is-landing");
    if (!reduced.matches) {
      buildPuffs();
      // Fire at the settle's squash point — the surface compresses,
      // the smoke squeezes out from underneath.
      after(readNum("--drop-down-dur", 250) + readNum("--drop-wave-delay", 0), function () {
        zone.classList.add("is-bursting");
      });
    }
    if (onDrop) onDrop();

    // Demo revert: hold the image, blur it away, respawn the chip.
    // In a real app you'd usually stop after onDrop().
    window.clearTimeout(revertTimer);
    revertTimer = after(readNum("--drop-hold", 1800), function () {
      zone.classList.add("is-emptying");
      after(readNum("--drop-out-dur", 400) + 50, function () {
        zone.classList.remove("is-filled", "is-emptying", "is-bursting", "is-landing");
        // Reset the chip home while it's still faded out, then
        // respawn it in place. The JS-side deltas MUST reset WITH
        // the CSS vars: a stale dx/dy makes the next pointerdown
        // solve its origin (clientX - dx) against the old drop
        // offset, and the chip visibly jumps away from the cursor.
        dx = 0; dy = 0;
        setVars(0, 0, 0, 1);
        chip.offsetWidth;   // reflow, so the respawn animation restarts
        chip.classList.remove("is-fading");
        chip.classList.add("is-respawning");
        after(readNum("--drop-respawn-dur", 250) + 50, function () {
          chip.classList.remove("is-respawning");
          settling = false;
        });
      });
    });
  }

  function onPointerDown(e) {
    if (dragging || settling) return;
    dragging = true;
    pointerId = e.pointerId;
    // Capture: every subsequent move/up for this pointer is delivered
    // to the chip even when the cursor outruns it or leaves the window.
    try { chip.setPointerCapture(pointerId); } catch (_) {}
    startX = e.clientX - dx;
    startY = e.clientY - dy;
    lastX = e.clientX;
    lastT = performance.now();
    chip.classList.remove("is-returning", "is-respawning");
    chip.classList.add("is-dragging");
    chip.style.setProperty("--lift", String(readNum("--drop-lift-scale", 1.05)));
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    const now = performance.now();
    const dt = Math.max(now - lastT, 1);
    const vx = (e.clientX - lastX) / dt;   // px per ms
    lastX = e.clientX;
    lastT = now;
    // Tilt from HORIZONTAL velocity only: ~28deg per px/ms, clamped.
    // A fast flick leans into the direction of travel; a slow drag
    // stays level. The 150ms rotate transition smooths the jitter.
    const tiltMax = readNum("--drop-tilt-max", 10);
    const tilt = Math.max(-tiltMax, Math.min(tiltMax, vx * 28));
    setVars(dx, dy, tilt, null);
    zone.classList.toggle("is-over", !zone.classList.contains("is-filled") && overZone());
  }

  function release(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    chip.classList.remove("is-dragging");
    const dropIn = zone.classList.contains("is-over");
    zone.classList.remove("is-over");
    if (dropIn) {
      settling = true;
      // No flight, no resize: the chip dissolves where it was
      // released while the zone morphs into the image.
      setVars(dx, dy, 0, null);   // level out the tilt as it fades
      chip.classList.add("is-fading");
      land();
    } else {
      settling = true;
      chip.classList.add("is-returning");
      dx = 0; dy = 0;
      setVars(0, 0, 0, 1);
      after(readNum("--drop-return-dur", 500) + 50, function () {
        chip.classList.remove("is-returning");
        settling = false;
      });
    }
  }

  chip.addEventListener("pointerdown", onPointerDown);
  chip.addEventListener("pointermove", onPointerMove);
  chip.addEventListener("pointerup", release);
  chip.addEventListener("pointercancel", release);

  function destroy() {
    timers.forEach(window.clearTimeout);
    timers.clear();
    chip.removeEventListener("pointerdown", onPointerDown);
    chip.removeEventListener("pointermove", onPointerMove);
    chip.removeEventListener("pointerup", release);
    chip.removeEventListener("pointercancel", release);
  }

  return { destroy };
}
```

Wire it up:

```js
const wrap = document.querySelector(".t-drop-wrap");
const chip = wrap.querySelector(".t-drop-chip");
const zone = wrap.querySelector(".t-drop-zone");
const puffs = zone.querySelector(".t-drop-puff-group");

createDragDrop({ chip, zone, puffs, onDrop: () => console.log("dropped") });
```

## Notes

- **The filter must apply to SVG content, not to HTML.** The smoke is `<rect>` shells
  inside a `<g filter="url(#t-drop-smoke)">`. Putting the same filter on an HTML element
  via CSS `filter: url(#t-drop-smoke)` renders as an unfiltered grey slab in WebKit —
  it doesn't run `feDisplacementMap` on HTML content. Filtering SVG shapes takes one
  identical code path in Chrome, Firefox and Safari.
- **Stroke geometry.** An SVG stroke straddles its path; a CSS border draws inward from
  the border box. With a 50px stroke that's a 25px overhang on each side, so each rect is
  inset by `sw / 2` and sized `100 - sw` (and its `rx` reduced by the same half-stroke)
  to put the ring's outer edge exactly on the image box.
- **One front, not blobs.** Low base frequency (`0.046`) with a strong displacement
  (`30`) gives long, smooth undulations. Raise the frequency and the ring tears into
  countable granules; raise `--drop-wave-count` above 1 and the staggered shells read as
  a thicker, longer-lived front rather than as separate rings, helped by the downward
  `--drop-wave-gravity` drift.
- **Reset dx/dy with the CSS vars.** The single most common way to break this: respawn
  the chip by writing `--dx`/`--dy` back to `0px` but leaving the JS `dx`/`dy` at their
  drop values. The next `pointerdown` computes `startX = clientX - dx` against a stale
  offset and the chip teleports on the first move.
- **`touch-action: none` is not optional** on the chip — without it a touch drag scrolls
  the page and no `pointermove` ever arrives.
- All tokens are read at the moment they're needed, so live-tweaking `--drop-*` between
  drops works without re-initialising the controller.

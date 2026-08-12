# Drag & drop with physics — React (Pro)

`useDragDrop` — the physics drag as a hook over a framework-free core. The chip follows
the pointer 1:1 through `setPointerCapture`, lifts on grab, and tilts from horizontal
velocity; released over the zone it fades out with a 2px blur exactly where it was let
go, while the **zone** morphs into the image and plays a squash-and-spring landing with a
turbulence-warped smoke burst at the dip. Released anywhere else it springs home. Reads
the `--drop-*` tokens live. Pair with the CSS variant's styles (identical class names).

```jsx
import { useEffect, useRef } from "react";

export function useDragDrop(chipRef, zoneRef, puffsRef, opts) {
  // Latest onDrop without re-creating the controller on every render.
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    const chip = chipRef.current;
    const zone = zoneRef.current;
    const puffs = puffsRef.current;
    if (!chip || !zone || !puffs) return;
    const ctrl = createDragDrop({
      chip,
      zone,
      puffs,
      onDrop: () => cb.current?.onDrop?.(),
    });
    // destroy() also cancels the hold/revert timers, so unmounting
    // mid-drop can't touch detached nodes.
    return () => ctrl.destroy();
  }, []);
}
```

## Usage

```jsx
function DropTarget({ src, onDrop }) {
  const chipRef = useRef(null);
  const zoneRef = useRef(null);
  const puffsRef = useRef(null);
  useDragDrop(chipRef, zoneRef, puffsRef, { onDrop });

  return (
    <div className="t-drop-wrap">
      <div className="t-drop-chip" ref={chipRef}>
        <img alt="" src={src} draggable={false} />
      </div>

      <div className="t-drop-zone" ref={zoneRef}>
        <span className="t-drop-zone-label">
          Drag &amp; drop
          <br />
          it here
        </span>
        {/* The landed image: same src, exactly the zone's box. */}
        <img className="t-drop-dropped" alt="" src={src} />
        {/* Smoke as SVG CONTENT — the turbulence filter is applied to
            shapes inside the svg. WebKit renders feDisplacementMap on
            HTML content (CSS filter: url(#id)) as an unfiltered grey
            slab; filtering SVG shapes works everywhere. */}
        <svg className="t-drop-puffs" viewBox="0 0 204 204" aria-hidden focusable="false">
          <g ref={puffsRef} filter="url(#t-drop-smoke)" />
        </svg>
      </div>
    </div>
  );
}

// Mount ONCE per app — the driver mirrors the --drop-smoke-* tokens
// onto these primitives before each burst.
function DropSmokeFilter() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <filter id="t-drop-smoke" x="-150%" y="-150%" width="400%" height="400%">
        {/* Low-frequency noise + strong displacement = long smooth
            undulations: the ring stays one CONTINUOUS wavy front
            instead of tearing into blob-like granules. */}
        <feTurbulence type="fractalNoise" baseFrequency="0.046 0.046" numOctaves="2" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="warped" />
        <feGaussianBlur in="warped" stdDeviation="5" />
      </filter>
    </svg>
  );
}
```

`onDrop` fires the moment the zone accepts the chip. The core then runs the demo revert
(hold `--drop-hold`, blur the image out, respawn the chip); for a one-shot drop, commit
your state in `onDrop` and unmount the pair.

## Core

```jsx
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
export function createDragDrop({ chip, zone, puffs, onDrop }) {
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

Bind the pointer handlers imperatively (as above) rather than through React props: the
listeners must be non-passive and the drag writes `--dx`/`--dy` straight to the chip's
style on every `pointermove`, which must not go through a state update — a re-render per
frame would break the 1:1 tracking.

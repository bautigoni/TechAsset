# Spinner to check morph — React (Pro)

`<StatusBadge state="loading | done">` — the whole morph hangs off one `data-state`
attribute, so in React it is literally a prop. The component only does the two things CSS
can't: calibrate the check path's dash length from `getTotalLength()`, and pulse the
cross-blur class for the first 45% of the fill whenever the state flips (in **both**
directions). Everything else — the hop, the green fade-in, the draw, the cross-fade back
— lives in the stylesheet. Pair with the CSS variant's styles and `:root` tokens
(identical class names).

```jsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Read a numeric CSS variable off :root ("px"/"ms"/"s" suffixes ok).
function readNum(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s") && !raw.endsWith("ms")) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

export function StatusBadge({ state = "loading", label }) {
  const markRef = useRef(null);
  const [len, setLen] = useState(null);
  const [crossing, setCrossing] = useState(false);
  const mounted = useRef(false);

  // Calibrate the dash to the real path length so the draw lands exactly
  // on the last pixel of the check. useLayoutEffect: it must be set
  // before the first paint, or the check would flash fully drawn.
  useLayoutEffect(() => {
    const mark = markRef.current;
    if (mark) setLen(Math.ceil(mark.getTotalLength()));
  }, []);

  // Cross-blur pulse: the whole badge softens as the morph starts and
  // resolves crisp as it lands — a genuine cross-blur, not a one-way
  // blur on one layer. Skipped on mount so the badge doesn't blur in.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setCrossing(true);
    const t = window.setTimeout(
      () => setCrossing(false),
      readNum("--check-fill-dur", 350) * 0.45,
    );
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    // Wrapper exists only to carry the blur: CSS `filter` applies BEFORE
    // `mask`/clipping and creates its own compositing context, so it has
    // to sit above the badge that scales and hops.
    <span className={"t-check-blur-wrap" + (crossing ? " is-crossing" : "")}>
      <span
        className="t-check-badge"
        data-state={state}
        style={len ? { "--check-mark-len": len } : undefined}
        role="img"
        aria-label={label ?? (state === "done" ? "Done" : "In progress")}
      >
        <span className="t-check-ring" aria-hidden="true" />
        <span className="t-check-arc" aria-hidden="true" />
        <span className="t-check-fill" aria-hidden="true" />
        <span className="t-check-disc" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            {/* Exact design geometry, in disc-local coords. */}
            <path ref={markRef} className="t-check-mark" d="M8 12.5L10.8 15.5L16.4 9.5" />
          </svg>
        </span>
      </span>
    </span>
  );
}
```

## Usage

Driven by real async state — the badge spins while the promise is in flight and morphs
the moment it resolves. That's the whole integration: one piece of state, one prop.

```jsx
function TaskRow({ title, subtitle, run }) {
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    run().then(
      () => alive && setState("done"),
      () => alive && setState("loading"), // failed — keep spinning / show your error UI
    );
    return () => {
      alive = false;
    };
  }, [run]);

  return (
    <span className="t-check-row">
      <StatusBadge state={state} label={state === "done" ? `${title} done` : title} />
      <span className="t-check-texts">
        <span className="t-check-title">{title}</span>
        <span className="t-check-sub">{subtitle}</span>
      </span>
    </span>
  );
}

// <TaskRow title="Build demo page" subtitle="8 subtasks" run={() => saveTask(id)} />
```

Going back to `"loading"` needs no extra code and plays no separate collapse animation:
every layer already has a reverse transition on the `--check-revert-dur` clock, so the
check un-draws, the green disc fades out, and the spinner cross-fades back in.

## Auto-revert after a hold

For a transient confirmation (a poller that resolves, flashes the check, then resumes),
schedule the flip back on the `--check-hold` token:

```jsx
function useHoldThenRevert(state, setState) {
  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(
      () => setState("loading"),
      readNum("--check-hold", 2000),
    );
    return () => window.clearTimeout(t);
  }, [state, setState]);
}
```

## Notes

- **One attribute drives four layers.** The ring, the spinning arc, the green disc, and
  the check path all key off `[data-state="done"]`, so the morph stays declarative — React
  never touches a style beyond `--check-mark-len`.
- The arc is never transformed by the morph; it just pauses its spin and fades. The green
  disc fades in on opacity rather than growing a stroke. Both were deliberate
  simplifications — see the CSS variant.
- Don't wrap `StatusBadge` in another element with a `filter`, `mask`, or
  `overflow: hidden`: the hop moves the badge 3px outside its own box.

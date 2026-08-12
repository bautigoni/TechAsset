# Gooey plus menu — TypeScript / React (Pro)

Self-contained `<GooeyPlusMenu>`: a plus button that liquid-splits into three satellite
actions and merges back. The goo and the shadow are one SVG filter applied to a blob
layer of circles that mirror the button geometry 1:1; the real buttons sit unfiltered
above so their icons stay sharp. The component owns `data-open`, mirrors the goo knobs
onto the filter primitives, and plays the close anticipation nudge — everything else
(fan, stagger, icon cross-blur, plus → X, reduced motion) lives in the stylesheet.
**Pair with the CSS variant's styles and `:root` tokens (identical class names).**

Both layers are rendered from the same `items` array, so a satellite's fan offset
(`--fx/--fy`) and stagger index (`--i`) can never drift between its blob and its button.
The filter id is derived from `useId()`, so several menus can coexist on one page.

```tsx
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface GooeyMenuItem {
  id: string;
  label: string;
  /** Fan offset from the main button's centre, e.g. "-54px". */
  fx: string;
  /** Fan offset from the main button's centre, e.g. "-34px". */
  fy: string;
  icon: ReactNode;
}

export interface GooeyPlusMenuProps {
  items?: GooeyMenuItem[];
  onSelect?: (item: GooeyMenuItem) => void;
}

// Read a numeric CSS custom property from :root (ms/s aware).
function readNum(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s") && !raw.endsWith("ms")) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

// Custom properties aren't in CSSProperties, so the per-item style is
// built through this cast in one place.
function slotStyle(fx: string, fy: string, i: number): CSSProperties {
  return { "--fx": fx, "--fy": fy, "--i": i } as CSSProperties;
}

// Symmetric equal-radius fan (r ≈ 64) centred on the vertical axis
// above the main button, whose centre sits at (100, 100) in the
// 200 × 140 anchor.
const DEFAULT_ITEMS: GooeyMenuItem[] = [
  {
    id: "file",
    label: "New file",
    fx: "-54px",
    fy: "-34px",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6z" />
        <path d="M9 1.5V6h4.5" />
      </svg>
    ),
  },
  {
    id: "image",
    label: "Add image",
    fx: "0px",
    fy: "-64px",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <circle cx="5.5" cy="5.5" r="1.25" />
        <path d="M14.5 10.5L11 7l-7.5 7.5" />
      </svg>
    ),
  },
  {
    id: "folder",
    label: "New folder",
    fx: "54px",
    fy: "-34px",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5z" />
      </svg>
    ),
  },
];

export function GooeyPlusMenu({
  items = DEFAULT_ITEMS,
  onSelect,
}: GooeyPlusMenuProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const blurRef = useRef<SVGFEGaussianBlurElement | null>(null);
  const matrixRef = useRef<SVGFEColorMatrixElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // Mirrors `open` synchronously — the outside-click and Escape
  // listeners are bound once and must not close over stale state.
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [anticipating, setAnticipating] = useState(false);
  // Document-global filter id, unique per instance.
  const filterId = `t-goo-filter-${useId().replace(/:/g, "")}`;

  // The goo filter's blur/contrast are SVG attributes, not CSS
  // properties, so the tokens are mirrored onto the primitives.
  const applyGooKnobs = useCallback(() => {
    const blur = readNum("--goo-blur", 6);
    const slope = readNum("--goo-contrast", 18);
    // The intercept scales with the slope so the goo threshold stays at
    // the same alpha crossing (the classic goo pair is 18 / -7).
    const intercept = -((slope * 7) / 18);
    blurRef.current?.setAttribute("stdDeviation", String(blur));
    matrixRef.current?.setAttribute(
      "values",
      `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${slope} ${intercept}`,
    );
  }, []);

  const setMenuOpen = useCallback(
    (next: boolean) => {
      if (openRef.current === next) return;
      openRef.current = next;
      applyGooKnobs();
      setOpen(next);
      window.clearTimeout(timerRef.current);
      if (!next) {
        // The nudge rides the whole goo layer AND the main button, so
        // the liquid follows the dip instead of just stretching.
        setAnticipating(true);
        timerRef.current = window.setTimeout(
          () => setAnticipating(false),
          readNum("--goo-anticip-dur", 700) + 50,
        );
      } else {
        setAnticipating(false);
      }
    },
    [applyGooKnobs],
  );

  useEffect(() => {
    applyGooKnobs();
    return () => window.clearTimeout(timerRef.current);
  }, [applyGooKnobs]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const node = e.target as Node | null;
      if (!anchorRef.current || !node || !anchorRef.current.contains(node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [setMenuOpen]);

  return (
    <div
      ref={anchorRef}
      className={`t-goo-anchor${anticipating ? " is-anticipating" : ""}`}
      data-open={open ? "true" : "false"}
    >
      {/* Blob layer: the filter is applied INSIDE the <svg> via
          <g filter="…">, never as CSS `filter: url(#…)` on HTML —
          WebKit renders that unreliably. */}
      <svg className="t-goo-layer" viewBox="0 0 200 140" aria-hidden="true" focusable="false">
        <defs>
          {/* colorInterpolationFilters="sRGB" is required, or the
              shadow falloff won't match the CSS box-shadow it
              reproduces (the default is linearRGB). */}
          <filter
            id={filterId}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            {/* Goo: blur everything together, slam the alpha contrast
                so overlapping soft edges snap into one hard silhouette
                with a liquid bridge, then composite the crisp source
                back "atop" so the circles keep their true edges. */}
            <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              ref={matrixRef}
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape" />

            {/* Shadow emulated in the SAME filter so ONE shadow follows
                the merged liquid — bridges included. Each pass is built
                independently from `shape` and merged BEHIND it, exactly
                how CSS paints box-shadow. Chaining feDropShadow would
                shadow the previous result and compound.
                  0 0 0 1px rgba(0,0,0,0.06),
                  0 2px  6px rgba(0,0,0,0.05),
                  0 4px 42px rgba(0,0,0,0.06) */}
            {/* 1px spread ring. Binarize the alpha FIRST (≈0.5
                threshold) so the dilate hugs the hard contour: the
                goo's ~1px soft fringe would otherwise dilate too and
                show as a doubled hairline. */}
            <feColorMatrix
              in="shape"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5"
              result="ring-solid"
            />
            <feMorphology in="ring-solid" operator="dilate" radius="1" result="ring-a" />
            <feFlood floodColor="#000000" floodOpacity="0.06" result="ring-c" />
            <feComposite in="ring-c" in2="ring-a" operator="in" result="ring" />
            {/* 0 2px 6px @ 5% — σ = blur / 2 = 3 */}
            <feGaussianBlur in="shape" stdDeviation="3" result="s2-b" />
            <feOffset in="s2-b" dy="2" result="s2-o" />
            <feFlood floodColor="#000000" floodOpacity="0.05" result="s2-c" />
            <feComposite in="s2-c" in2="s2-o" operator="in" result="s2" />
            {/* 0 4px 42px @ 6% — σ = blur / 2 = 21 */}
            <feGaussianBlur in="shape" stdDeviation="21" result="s3-b" />
            <feOffset in="s3-b" dy="4" result="s3-o" />
            <feFlood floodColor="#000000" floodOpacity="0.06" result="s3-c" />
            <feComposite in="s3-c" in2="s3-o" operator="in" result="s3" />
            <feMerge>
              <feMergeNode in="s3" />
              <feMergeNode in="s2" />
              <feMergeNode in="ring" />
              <feMergeNode in="shape" />
            </feMerge>
          </filter>
        </defs>
        {/* One circle per button, all stacked at the main button's
            centre when closed. */}
        <g filter={`url(#${filterId})`}>
          {items.map((item, i) => (
            <circle
              key={item.id}
              className="t-goo-blob"
              cx="100"
              cy="100"
              r="20"
              style={slotStyle(item.fx, item.fy, i)}
            />
          ))}
          <circle className="t-goo-blob t-goo-blob-main" cx="100" cy="100" r="20" />
        </g>
      </svg>

      {/* UI layer (crisp): transparent hit targets + icons only. */}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          className="t-goo-item"
          style={slotStyle(item.fx, item.fy, i)}
          aria-label={item.label}
          tabIndex={-1}
          onClick={() => {
            onSelect?.(item);
            setMenuOpen(false);
          }}
        >
          {item.icon}
        </button>
      ))}

      {/* The plus glyph spun 45° IS the X — one icon, one tween. */}
      <button
        type="button"
        className="t-goo-main"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={(e) => {
          // Don't let the document listener above close it again.
          e.stopPropagation();
          setMenuOpen(!openRef.current);
        }}
      >
        <span className="t-goo-swap">
          <span className="t-goo-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M10 4V16M4 10H16" />
            </svg>
          </span>
        </span>
      </button>
    </div>
  );
}
```

## Usage

```tsx
<GooeyPlusMenu onSelect={(item) => console.log("picked", item.id)} />
```

Pass your own `items` to change the actions — each needs `id`, `label`, `fx`, `fy` and an
`icon`; the array order is the stagger order. Keep the fan symmetric and equal-radius
(the defaults sit on r ≈ 64 around the main button's centre at `(100, 100)` in the
`200 × 140` anchor), or the merged silhouette stops reading as one body. Scale the whole
fan with `--goo-spread` instead of editing every offset.

Include the `.t-goo-*` CSS and `:root` tokens from the CSS variant — all the motion lives
in the stylesheet, including the `prefers-reduced-motion` guard.

## Notes

- **`--fx/--fy/--i` go through `slotStyle()`** because CSS custom properties aren't part
  of `CSSProperties`; keeping the cast in one helper avoids sprinkling `as CSSProperties`
  through the tree. They drive both the blob's and the button's `transform`, and the
  satellite's stagger delay.
- `openRef` shadows the `open` state because the document-level click/Escape listeners are
  bound once; reading state through the ref keeps them correct without re-binding.
- The goo knobs are re-read on every toggle, so live-tweaking `--goo-blur` /
  `--goo-contrast` in devtools takes effect on the next open without a remount.

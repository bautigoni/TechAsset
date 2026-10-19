import type { SVGProps } from 'react';

// Íconos chicos propios (trazo 1.75, currentColor). Son pocos y fijos: así la
// librería no arrastra un set entero y el chunk base sigue liviano.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: string[], strokeWidth = 1.75) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
        {paths.map(d => <path key={d} d={d} />)}
      </svg>
    );
  };
}

export const IconCheck = /* @__PURE__ */ make(['M20 6 9 17l-5-5'], 2.25);
export const IconMinus = /* @__PURE__ */ make(['M6 12h12'], 2.25);
export const IconPlus = /* @__PURE__ */ make(['M12 5v14', 'M5 12h14']);
export const IconX = /* @__PURE__ */ make(['M18 6 6 18', 'm6 6 12 12']);
export const IconChevronDown = /* @__PURE__ */ make(['m6 9 6 6 6-6']);
export const IconChevronLeft = /* @__PURE__ */ make(['m15 18-6-6 6-6']);
export const IconChevronRight = /* @__PURE__ */ make(['m9 18 6-6-6-6']);
export const IconChevronUp = /* @__PURE__ */ make(['m18 15-6-6-6 6']);
export const IconAlert = /* @__PURE__ */ make(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 8v4', 'M12 16h.01']);
export const IconWarn = /* @__PURE__ */ make(['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01']);
export const IconInfo = /* @__PURE__ */ make(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01']);
export const IconUndo = /* @__PURE__ */ make(['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11']);
export const IconRetry = /* @__PURE__ */ make(['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5']);
export const IconCalendar = /* @__PURE__ */ make(['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z']);
export const IconClock = /* @__PURE__ */ make(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2']);
export const IconUpload = /* @__PURE__ */ make(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12']);
export const IconFile = /* @__PURE__ */ make(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6']);
export const IconSearch = /* @__PURE__ */ make(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3']);
export const IconLock = /* @__PURE__ */ make(['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M7 11V7a5 5 0 0 1 10 0v4']);
export const IconWifiOff = /* @__PURE__ */ make(['m2 2 20 20', 'M8.5 16.5a5 5 0 0 1 7 0', 'M2 8.8a15 15 0 0 1 4.2-2.6', 'M10.7 5.1A15 15 0 0 1 22 8.8', 'M16.9 10.8a10 10 0 0 1 2.1 1.6', 'M5 12.6a10 10 0 0 1 5.2-2.8', 'M12 20h.01']);

/** Spinner chico (track + arco). Gira por CSS; con reduced-motion queda quieto. */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`ui-spinner ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" className="ui-spinner-track" />
      <path d="M21 12a9 9 0 0 0-9-9" className="ui-spinner-arc" />
    </svg>
  );
}

import { lazy, Suspense, type ComponentType } from 'react';
import type { DatePickerProps, DateRangeProps } from './pickers/DatePicker';
import type { DateTimeFieldProps, TimeFieldProps } from './pickers/TimeField';
import type { ColorFieldProps } from './pickers/ColorField';
import type { FileDropProps } from './pickers/FileDrop';
import { Skeleton } from './Data';

/**
 * Envoltorios diferidos: el primer uso baja el chunk `pickers` (calendario,
 * hora, color, archivos) y mientras tanto se reserva el alto del campo, así
 * nada salta cuando llega. `preloadPickers()` lo baja antes (p. ej. al pasar
 * el mouse por "Nueva actividad").
 */
const load = () => import('./pickers/pickers');
let pending: ReturnType<typeof load> | null = null;
export function preloadPickers() {
  pending ??= load();
  return pending;
}

function deferred<P extends object>(pick: (mod: Awaited<ReturnType<typeof load>>) => ComponentType<P>, fallbackHeight: string) {
  const Lazy = lazy(() => preloadPickers().then(mod => ({ default: pick(mod) })));
  function Deferred(props: P) {
    return (
      <Suspense fallback={<span className="ui-lazy-fallback" style={{ height: fallbackHeight }}><Skeleton height="100%" radius="sm" /></span>}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return Deferred;
}

const FIELD = 'calc(var(--g-control-h) + 1.5rem)';

export const DatePicker = /* @__PURE__ */ deferred<DatePickerProps>(mod => mod.DatePicker, FIELD);
export const DateField = /* @__PURE__ */ deferred<{ value: string; onChange: (iso: string) => void; disabled?: boolean; placeholder?: string; ariaLabel?: string; className?: string }>(mod => mod.DateField, 'var(--g-control-h)');
export const DateRange = /* @__PURE__ */ deferred<DateRangeProps>(mod => mod.DateRange, FIELD);
export const TimeField = /* @__PURE__ */ deferred<TimeFieldProps>(mod => mod.TimeField, FIELD);
export const DateTimeField = /* @__PURE__ */ deferred<DateTimeFieldProps>(mod => mod.DateTimeField, FIELD);
export const ColorField = /* @__PURE__ */ deferred<ColorFieldProps>(mod => mod.ColorField, 'calc(var(--g-control-h) * 2 + 1.5rem)');
export const FileDrop = /* @__PURE__ */ deferred<FileDropProps>(mod => mod.FileDrop, '9.5rem');

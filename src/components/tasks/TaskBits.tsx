import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTabPill } from '../../hooks/useTabPill';
import { cx } from '../../ui';

/** Ancho de mobile (sin menú lateral): una columna del tablero a la vez, sin arrastrar. */
export const MOBILE_QUERY = '(max-width: 767px)';

export function useMedia(query: string) {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * Solapas con la píldora que viaja (receta `tabs-sliding`, la de siempre en
 * Tareas): Tablero / Prioridad y Equipo / Mis tareas. Flechas para moverse.
 */
export function PillTabs<V extends string>({ value, onChange, options, ariaLabel, block }: {
  value: V;
  onChange: (value: V) => void;
  options: Array<{ value: V; label: string; count?: number }>;
  ariaLabel: string;
  block?: boolean;
}) {
  const pill = useTabPill<HTMLDivElement>(value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = options.findIndex(option => option.value === value);
    const next = options[(index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length];
    onChange(next.value);
    pill.ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div ref={pill.ref} className={cx('tk-tabs', block && 'tk-tabs--block')} role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      <span className="tk-tabs-pill" style={pill.style} aria-hidden="true" />
      {options.map(option => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-value={option.value}
            data-tab-active={on ? 'true' : undefined}
            className={cx('tk-tab', on && 'is-on')}
            onClick={() => onChange(option.value)}
          >
            <span className="tk-tab-label">{option.label}</span>
            {option.count !== undefined && <span className="tk-tab-count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Opciones como botones que envuelven en filas (prioridad, turno, columna,
 * responsables). `multiple` = chips que se prenden y apagan (con ✓).
 */
export function OptionChips<V extends string>({ value, onChange, options, ariaLabel, multiple, disabled, grid }: {
  value: V | V[];
  onChange: (value: V) => void;
  options: Array<{ value: V; label: ReactNode; disabled?: boolean }>;
  ariaLabel: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Reparte en una grilla pareja (mobile). */
  grid?: boolean;
}) {
  const selected = Array.isArray(value) ? value : [value];
  return (
    <div className={cx('tk-chips', grid && 'tk-chips--grid')} role="group" aria-label={ariaLabel}>
      {options.map(option => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={cx('tk-chip', on && 'is-on')}
            aria-pressed={on}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {multiple && (
              <span className="tk-chip-check" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
            )}
            <span className="tk-chip-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Anillo fino neutro del avance de una persona (sin colores de estado). */
export function ProgressRing({ done, total, label, size = 32 }: { done: number; total: number; label: string; size?: number }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  return (
    <svg className="tk-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle className="tk-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
      {ratio > 0 && (
        <circle className="tk-ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * ratio} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
    </svg>
  );
}

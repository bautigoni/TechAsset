import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import type { Device } from '../../types';
import { getDeviceStateKey } from '../../utils/deviceState';
import { loanAgeDays } from '../../utils/formatters';
import { Button } from '../../ui/Button';
import { InlineConfirm } from '../../ui/Inline';
import { IconChevronDown } from '../../ui/icons';
import { Ring } from '../../ui/Data';
import { cx } from '../../ui/util';
import { Collapse } from '../../ui/Collapse';

/**
 * Piezas compartidas por las dos grillas de Préstamos (equipos por tipo y
 * cartelitos): desplegable que recuerda si quedó abierto, chip con su estado,
 * gramática de selección (Ctrl/Cmd/Shift + clic) y la barra de selección que
 * REEMPLAZA al encabezado de la sección (no flota).
 */

const OPEN_KEY = 'techasset_loans_open_panels';

function readOpenPanels(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

/** Abierto/cerrado por panel, recordado entre visitas (`fallback` si nunca se tocó). */
export function usePanelOpen(id: string, fallback = false) {
  const [open, setOpenState] = useState(() => {
    const saved = readOpenPanels()[id];
    return saved === undefined ? fallback : Boolean(saved);
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpenPanels(), [id]: next }));
    } catch {
      // Sin storage (modo privado): el panel funciona igual, solo no se recuerda.
    }
  }, [id]);
  return [open, setOpen] as const;
}

/**
 * Contenido que se monta recién la primera vez que se abre (cerrados, los
 * grupos no tienen sus chips en el DOM) y después queda montado para que
 * cerrar/abrir no vuelva a construirlo. Abre y cierra con Collapse: alto
 * suave hacia el encabezado, y el encabezado tocado no se mueve en pantalla.
 */
export function LazyBody({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  return <Collapse open={open} className={className}>{children}</Collapse>;
}

export type ChipKind = 'free' | 'loaned' | 'late1' | 'late2' | 'blocked';

/** Estado del chip de un equipo: misma regla que getDeviceStateKey, más la antigüedad. */
export function deviceChipKind(device: Device): ChipKind {
  const key = getDeviceStateKey(device);
  if (key === 'missing' || key === 'out') return 'blocked';
  if (key === 'available') return 'free';
  const days = loanAgeDays(device.loanedAt);
  return days >= 2 ? 'late2' : days === 1 ? 'late1' : 'loaned';
}

/** Ctrl (Windows/Linux), Cmd (Mac, metaKey) o Shift: marcan sin actuar. */
export function isMarkClick(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

export function Chevron({ open }: { open: boolean }) {
  return <span className={cx('lo-chev', open && 'is-open')} aria-hidden="true"><IconChevronDown size={16} /></span>;
}

/** Encabezado desplegable de un grupo: chevron, nombre, anillo libres/total y textos de estado. */
export function GroupToggle({ open, onToggle, title, titleAs = 'span', free, total, out, warn, loading, controls }: {
  open: boolean;
  onToggle: () => void;
  title: string;
  titleAs?: 'span' | 'h2';
  free: number;
  total: number;
  out: string;
  warn?: string;
  loading?: boolean;
  controls?: string;
}) {
  const Title = titleAs;
  return (
    <button type="button" className="lo-group-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span className="lo-group-name">
        <Chevron open={open} />
        <Title className="lo-group-title">{title}</Title>
      </span>
      <span className="lo-group-ring">
        {loading
          ? <span className="lo-ring-skel" aria-hidden="true" />
          : <Ring value={free} total={total} size={32} unit="libres" />}
        <span className="lo-group-ratio">
          <b className="g-num">{loading ? '…' : `${free}/${total}`}</b>
          <span>libres</span>
        </span>
      </span>
      <span className="lo-group-meta">
        <span className="lo-group-out">{out}</span>
        {warn && <span className="lo-group-warn">{warn}</span>}
      </span>
    </button>
  );
}

/**
 * Barra de selección: reemplaza al encabezado de la sección mientras dura el
 * modo "Seleccionar varios". "Limpiar" vacía sin salir; "Listo" vacía y sale.
 * Devolver más de uno se confirma EN la barra.
 */
export function SelectionBar({ count, hint, idleHint, actions, confirm, onClear, onDone, label }: {
  count: number;
  hint: string;
  idleHint: string;
  actions: ReactNode;
  confirm?: { message: string; detail: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean } | null;
  onClear: () => void;
  onDone: () => void;
  label: string;
}) {
  return (
    <div
      className="lo-selbar ui-enter"
      role="region"
      aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape' && !confirm) { event.stopPropagation(); onDone(); } }}
    >
      {confirm ? (
        <InlineConfirm
          className="lo-selbar-confirm"
          message={confirm.message}
          detail={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          busy={confirm.busy}
          onConfirm={confirm.onConfirm}
          onCancel={confirm.onCancel}
        />
      ) : (
        <>
          <span className="lo-selbar-text">
            <span className="lo-selbar-count" aria-live="polite">
              {count ? <><b className="g-num">{count}</b> {count === 1 ? 'seleccionado' : 'seleccionados'}</> : 'Modo selección'}
            </span>
            <span className="lo-selbar-hint">{count ? hint : idleHint}</span>
          </span>
          <span className="lo-selbar-actions">
            {actions}
            {count > 0 && <Button size="sm" variant="ghost" onClick={onClear}>Limpiar</Button>}
            <Button size="sm" variant="ghost" className="lo-selbar-done" onClick={onDone}>Listo</Button>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Encabezado de la sección y barra de selección en la MISMA celda: el bloque
 * mide lo que el más alto, así entrar o salir de la selección no corre los
 * chips que están debajo del cursor.
 */
export function SelectionSwap({ active, bar, children }: { active: boolean; bar: ReactNode; children: ReactNode }) {
  return (
    <div className="ui-selswap">
      <div className="ui-selswap-base" inert={active} aria-hidden={active || undefined}>{children}</div>
      {active && bar}
    </div>
  );
}

/** Botón "Seleccionar varios" (en mobile, "Varios"). */
export function SelectModeButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="secondary" className="lo-selmode" disabled={disabled} onClick={onClick}>
      <span className="lo-long">Seleccionar varios</span><span className="lo-short">Varios</span>
    </Button>
  );
}

/** Referencia de cómo se ve cada estado del chip (sin puntitos ni fondos de color). */
export function ChipLegend({ items }: { items: Array<[ChipKind | 'selected', string]> }) {
  return (
    <div className="lo-legend" aria-hidden="true">
      {items.map(([kind, text]) => (
        <span key={kind} className="lo-legend-item">
          <span className={cx('lo-chip', 'lo-chip--sample', `is-${kind}`)}>12</span>{text}
        </span>
      ))}
    </div>
  );
}

/** Resume una lista de errores de un lote en una sola línea. */
export function batchResultMessage(verb: string, noun: string, total: number, errors: string[]) {
  const ok = total - errors.length;
  if (!errors.length) return { tone: 'ok' as const, text: `${verb} ${ok} ${noun}.` };
  return { tone: 'warn' as const, text: `${verb} ${ok} de ${total} ${noun}. ${errors.join('; ')}` };
}

/** Botones de opción (rol, ubicación, motivo, nivel): uno marcado; tocar el marcado lo suelta. */
export function OptionGroup({ label, options, value, onChange, allowEmpty = true, disabled, className, mono }: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cx('lo-opts', className)} role="group" aria-label={label}>
      {options.map(option => {
        const on = option.value === value;
        return (
          <button
            key={option.value || '_empty'}
            type="button"
            className={cx('lo-opt', on && 'is-on', mono && 'lo-opt--mono')}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on && allowEmpty && option.value !== '' ? '' : option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Grilla de grados (1N…6S) en filas por división; lo que no sigue ese formato
 * (cursos configurados en la sede) va en una fila aparte.
 */
export function GradeGrid({ label, grades, value, onChange, disabled }: { label: string; grades: string[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const pattern = /^(\d)([A-Za-z])$/;
  const sections: string[] = [];
  const bySection = new Map<string, string[]>();
  const rest: string[] = [];
  for (const grade of grades) {
    const match = grade.match(pattern);
    if (!match) { rest.push(grade); continue; }
    const section = match[2].toUpperCase();
    if (!bySection.has(section)) { bySection.set(section, []); sections.push(section); }
    bySection.get(section)!.push(grade);
  }
  const rows = [...sections.map(section => bySection.get(section)!.sort()), ...(rest.length ? [rest] : [])];
  return (
    <div className="lo-grades" role="group" aria-label={label}>
      {rows.map((row, index) => (
        <div className="lo-grades-row" key={index}>
          {row.map(grade => {
            const on = grade === value;
            return (
              <button key={grade} type="button" className={cx('lo-opt', 'lo-opt--mono', 'lo-opt--grade', on && 'is-on')} aria-pressed={on} disabled={disabled} onClick={() => onChange(on ? '' : grade)}>
                {grade}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Interruptores de accesorios (lo que se entrega o lo que vuelve). */
export function AccessoryToggles({ label, items, checked, onToggle, prefixOn }: { label: string; items: string[]; checked: string[]; onToggle: (item: string) => void; prefixOn?: string }) {
  return (
    <div className="lo-opts" role="group" aria-label={label}>
      {items.map(item => {
        const on = checked.includes(item);
        return (
          <button key={item} type="button" role="switch" aria-checked={on} className={cx('lo-opt', on && 'is-on')} onClick={() => onToggle(item)}>
            {on && prefixOn ? `${prefixOn}${item}` : item}
          </button>
        );
      })}
    </div>
  );
}

export function toggleList(items: string[], item: string) {
  return items.includes(item) ? items.filter(value => value !== item) : [...items, item];
}

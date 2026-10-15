import { useCallback, useState, type PropsWithChildren, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Piezas compartidas por las grillas de chips de Préstamos (equipos por tipo y
 * cartelitos): sección desplegable que recuerda si quedó abierta, y barra de
 * acciones para la selección múltiple.
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

/** Abierto/cerrado por panel, recordado entre visitas. Arranca cerrado. */
export function usePanelOpen(id: string) {
  const [open, setOpenState] = useState(() => Boolean(readOpenPanels()[id]));
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

export function CollapsiblePanel({ id, title, used, total, usedLabel, loading = false, extra, className = '', children }: PropsWithChildren<{
  id: string;
  title: string;
  used: number;
  total: number;
  usedLabel: string;
  loading?: boolean;
  /** Botones que van a la derecha del encabezado, fuera del área que despliega. */
  extra?: ReactNode;
  className?: string;
}>) {
  const [open, setOpen] = usePanelOpen(id);
  // El contenido se monta recién la primera vez que se abre: cerrados, los
  // paneles de Préstamos tenían igual todos sus chips y listas en el DOM.
  // Después queda montado para que cerrar/abrir siga animando.
  const [mounted, setMounted] = useState(open);
  const toggle = () => {
    if (open) return setOpen(false);
    if (mounted) return setOpen(true);
    setMounted(true);
    // Un frame cerrado con el contenido ya montado, para que la apertura anime.
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };
  const percent = total ? Math.round((used / total) * 100) : 0;
  return (
    <section className={`chip-panel ${open ? 'is-open' : ''} ${className}`.trim()}>
      <div className="chip-panel-head">
        <button type="button" className="chip-panel-toggle" aria-expanded={open} onClick={toggle}>
          <ChevronDown className="chip-panel-chevron" size={18} aria-hidden="true" />
          <span className="chip-panel-title">{title}</span>
          <span className="chip-panel-meter" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
          <span className="chip-panel-count">
            {loading ? '…' : <><b>{used}</b>/{total} <span className="chip-panel-count-label">{usedLabel}</span></>}
          </span>
        </button>
        {open && extra}
      </div>
      <div className="chip-panel-body" inert={!open}>
        <div className="chip-panel-inner">{mounted && children}</div>
      </div>
    </section>
  );
}

/** Conjunto de claves seleccionadas, con alta/baja de a una o de a muchas. */
export function useChipSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Si ya estaban todas, las saca; si no, completa las que faltan.
  const toggleMany = useCallback((keys: string[]) => {
    setSelected(current => {
      const next = new Set(current);
      const all = keys.length > 0 && keys.every(key => next.has(key));
      for (const key of keys) {
        if (all) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, toggleMany, clear };
}

export function SelectionBar({ count, onClear, children }: PropsWithChildren<{ count: number; onClear: () => void }>) {
  if (!count) return null;
  return (
    <div className="chip-selection-bar" role="region" aria-label="Acciones sobre la selección">
      <span className="chip-selection-count"><b>{count}</b> {count === 1 ? 'seleccionado' : 'seleccionados'}</span>
      <div className="chip-selection-actions">
        {children}
        <button type="button" className="chip-selection-clear" onClick={onClear}>Limpiar</button>
      </div>
    </div>
  );
}

export function SelectModeToggle({ active, disabled, onChange }: { active: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      className={`chip-select-toggle ${active ? 'is-on' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onChange(!active)}
    >
      {active ? 'Listo' : <><span className="chip-select-long">Seleccionar varios</span><span className="chip-select-short">Varios</span></>}
    </button>
  );
}

/** Resume una lista de errores de un lote en una sola línea. */
export function batchResultMessage(verb: string, noun: string, total: number, errors: string[]) {
  const ok = total - errors.length;
  if (!errors.length) return { tone: 'ok' as const, text: `${verb} ${ok} ${noun}.` };
  return { tone: 'warn' as const, text: `${verb} ${ok} de ${total} ${noun}. ${errors.join('; ')}` };
}

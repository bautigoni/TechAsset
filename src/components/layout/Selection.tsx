import { useCallback, useState, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

/**
 * Selección múltiple compartida (Préstamos, Dispositivos...): el conjunto de
 * claves marcadas y la barra flotante con las acciones sobre la selección.
 */

/** Conjunto de claves seleccionadas, con alta/baja de a una o de a muchas. */
export function useSelection() {
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

/** floating: fija abajo de la pantalla (selección sobre toda una página); si no, pegada al final de su bloque. */
export function SelectionBar({ count, onClear, floating = false, children }: PropsWithChildren<{ count: number; onClear: () => void; floating?: boolean }>) {
  if (!count) return null;
  const bar = (
    <div className={`chip-selection-bar ${floating ? 'is-floating' : ''}`.trim()} role="region" aria-label="Acciones sobre la selección">
      <span className="chip-selection-count"><b>{count}</b> {count === 1 ? 'seleccionado' : 'seleccionados'}</span>
      <div className="chip-selection-actions">
        {children}
        <button type="button" className="chip-selection-clear" onClick={onClear}>Limpiar</button>
      </div>
    </div>
  );
  // Flotante va al body: la animación de entrada de las vistas usa transform,
  // y un ancestro con transform convierte position:fixed en relativo a él.
  return floating ? createPortal(bar, document.body) : bar;
}

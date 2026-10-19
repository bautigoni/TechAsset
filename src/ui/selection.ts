import { useCallback, useRef, useState } from 'react';

type ClickLike = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault?: () => void };

/**
 * Selección múltiple con la gramática de hoy (chips, cartelitos, filas):
 *
 * - Ctrl/Cmd+click: marca o desmarca sin hacer la acción del click y PRENDE el
 *   modo "Seleccionar varios".
 * - Shift+click: marca el RANGO desde el último marcado (ancla) hasta acá,
 *   dentro de `orderedKeys` (el orden visible). Sin ancla, se comporta como Ctrl.
 * - Con el modo prendido, el click simple también marca.
 * - `clear()` vacía y apaga el modo.
 *
 * Es un superconjunto del `useSelection` de `components/layout/Selection`
 * (`selected`, `toggle`, `toggleMany`, `clear` con la misma firma).
 */
export function useSelection(initial: Iterable<string> = []) {
  const [selected, setSelectedState] = useState<Set<string>>(() => new Set(initial));
  const [mode, setMode] = useState(false);
  const anchor = useRef<string | null>(null);

  const toggle = useCallback((key: string) => {
    anchor.current = key;
    setSelectedState(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Si ya estaban todas, las saca; si no, completa las que faltan ("Todos / Ninguno").
  const toggleMany = useCallback((keys: string[]) => {
    setSelectedState(current => {
      const next = new Set(current);
      const all = keys.length > 0 && keys.every(key => next.has(key));
      for (const key of keys) {
        if (all) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }, []);

  const setSelected = useCallback((keys: Iterable<string>) => setSelectedState(new Set(keys)), []);

  const clear = useCallback(() => {
    anchor.current = null;
    setMode(false);
    setSelectedState(new Set());
  }, []);

  const selectRange = useCallback((to: string, orderedKeys: string[]) => {
    const from = anchor.current;
    const a = from ? orderedKeys.indexOf(from) : -1;
    const b = orderedKeys.indexOf(to);
    if (a < 0 || b < 0) { toggle(to); return; }
    const [start, end] = a < b ? [a, b] : [b, a];
    setSelectedState(current => {
      const next = new Set(current);
      for (const key of orderedKeys.slice(start, end + 1)) next.add(key);
      return next;
    });
    anchor.current = to;
  }, [toggle]);

  /**
   * Para el onClick de un chip/fila. Devuelve true si el click fue de
   * selección (el llamador NO hace su acción normal: prestar, devolver, abrir).
   */
  const handleClick = useCallback((key: string, event: ClickLike, orderedKeys?: string[]) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      event.preventDefault?.();
      setMode(true);
      if (orderedKeys) selectRange(key, orderedKeys);
      else toggle(key);
      return true;
    }
    if (modifier || mode || selected.size > 0) {
      event.preventDefault?.();
      setMode(true);
      toggle(key);
      return true;
    }
    return false;
  }, [mode, selected, selectRange, toggle]);

  /** Recalcula contra el estado vivo: saca lo que ya no existe o no es elegible. */
  const prune = useCallback((validKeys: Iterable<string>) => {
    const valid = new Set(validKeys);
    setSelectedState(current => {
      let changed = false;
      const next = new Set<string>();
      for (const key of current) {
        if (valid.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const isSelected = useCallback((key: string) => selected.has(key), [selected]);

  return { selected, count: selected.size, isSelected, toggle, toggleMany, setSelected, selectRange, handleClick, prune, clear, mode: mode || selected.size > 0, setMode };
}

export type Selection = ReturnType<typeof useSelection>;

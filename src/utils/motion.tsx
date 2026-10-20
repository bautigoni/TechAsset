import { useCallback, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Collapse, COLLAPSE_MS } from '../ui/Collapse';

/*
 * Nada se abre "de golpe" (agregado del dueño, 20/10). Dos ayudas para lo que
 * no es un plegable con disparador propio:
 *
 *   - `smoothHeight(el, update)`: un contenedor que cambia de contenido (una
 *     vista que se reemplaza por otra, un formulario que pasa a confirmación)
 *     pasa de su alto viejo al nuevo con la misma curva que <Collapse>.
 *   - `useListMotion(items, keyOf)` + <ListItemMotion>: en una lista, lo que se
 *     agrega entra creciendo desde 0 y lo que se quita se pliega antes de
 *     desaparecer (lo que ya estaba al montar no se anima).
 *
 * Con `prefers-reduced-motion: reduce` todo es instantáneo.
 * (Candidatas a vivir en src/ui: se dejaron acá para no tocar lo compartido.)
 */

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function ease() {
  if (typeof document === 'undefined') return 'ease';
  return getComputedStyle(document.documentElement).getPropertyValue('--g-ease').trim() || 'ease';
}

/**
 * Aplica `update` (un setState) y anima el alto de `el` del valor anterior al
 * nuevo. Llamalo desde un evento (usa flushSync para medir el alto nuevo).
 */
export function smoothHeight(el: HTMLElement | null | undefined, update: () => void) {
  if (!el || !el.isConnected || reducedMotion() || typeof el.animate !== 'function') { update(); return; }
  const from = el.getBoundingClientRect().height;
  for (const animation of el.getAnimations()) if ((animation as Animation & { id?: string }).id === 'smooth-height') animation.cancel();
  flushSync(update);
  if (!el.isConnected) return;
  const to = el.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  const animation = el.animate(
    [{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }],
    { duration: COLLAPSE_MS, easing: ease() }
  );
  (animation as Animation & { id?: string }).id = 'smooth-height';
}

export type ListEntry<T> = { key: string; item: T; leaving: boolean; appear: boolean };

/**
 * Lista con altas y bajas animadas. Devuelve las filas a dibujar (incluidas
 * las que se están yendo, en su lugar) y `release` para soltarlas al terminar
 * de plegarse.
 */
export function useListMotion<T>(items: T[], keyOf: (item: T) => string) {
  const [last, setLast] = useState(items);
  const [leaving, setLeaving] = useState<Array<{ key: string; item: T; after: string | null }>>([]);
  // Lo que estaba al montar no entra animado; lo que se agregó después, sí.
  const initial = useRef<Set<string> | null>(null);
  if (!initial.current) initial.current = new Set(items.map(keyOf));
  if (items !== last) {
    // Ajuste durante el render (estado derivado de props, como useHeldKeys).
    const now = new Set(items.map(keyOf));
    const gone: Array<{ key: string; item: T; after: string | null }> = [];
    let after: string | null = null;
    for (const item of last) {
      const key = keyOf(item);
      if (now.has(key)) after = key;
      else { gone.push({ key, item, after }); initial.current.delete(key); }
    }
    const keep = reducedMotion() ? [] : gone;
    setLeaving(list => [...list.filter(entry => !now.has(entry.key) && !gone.some(g => g.key === entry.key)), ...keep]);
    setLast(items);
  }
  const release = useCallback((key: string) => setLeaving(list => (list.some(entry => entry.key === key) ? list.filter(entry => entry.key !== key) : list)), []);

  const entries: ListEntry<T>[] = [];
  const pending = leaving.filter(entry => !items.some(item => keyOf(item) === entry.key));
  const placeAfter = (key: string | null) => {
    for (const entry of pending.filter(g => g.after === key)) {
      entries.push({ key: entry.key, item: entry.item, leaving: true, appear: false });
      placeAfter(entry.key);
    }
  };
  placeAfter(null);
  for (const item of items) {
    const key = keyOf(item);
    entries.push({ key, item, leaving: false, appear: !initial.current.has(key) });
    placeAfter(key);
  }
  // Los que quedaron sin vecino conocido van al final.
  for (const entry of pending) if (!entries.some(e => e.key === entry.key)) entries.push({ key: entry.key, item: entry.item, leaving: true, appear: false });
  return { entries, release };
}

/** Envoltura de una fila de `useListMotion`: entra y sale con el alto del colapso compartido. */
export function ListItemMotion<T>({ entry, release, className, children }: { entry: ListEntry<T>; release: (key: string) => void; className?: string; children: ReactNode }) {
  return (
    <Collapse
      open={!entry.leaving}
      appear={entry.appear}
      lazy={false}
      reveal={false}
      outerClassName={className}
      onSettled={open => { if (!open) release(entry.key); }}
    >
      {children}
    </Collapse>
  );
}

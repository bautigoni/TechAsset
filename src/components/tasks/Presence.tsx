import { useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import type { TaskChecklistItem } from '../../types';
import { COLLAPSE_MS, Collapse } from '../../ui';

type Row<T> = { key: string; item: T; open: boolean };

/**
 * Lista donde nada aparece ni se va de golpe (agregado del dueño, 20/10): lo
 * que entra después de montar se despliega con el colapso compartido y lo que
 * sale se pliega en su lugar antes de irse. Lo que ya estaba al montar se
 * dibuja quieto. Sirve para tarjetas de una columna (mover, "Ver más",
 * búsqueda), subtareas y comentarios nuevos.
 */
export function Presence<T>({ items, keyOf, render, reveal = false }: {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  /** Llevar lo nuevo a la vista al abrir (solo si lo pidió quien tocó). */
  reveal?: boolean;
}) {
  const mounted = useRef(false);
  const committed = useRef<Array<Row<T>>>([]);
  const leaving = useRef(new Map<string, { item: T; index: number }>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const current = items.map(item => ({ key: keyOf(item), item, open: true }));
  const keys = new Set(current.map(row => row.key));
  // Lo que estaba dibujado y ya no viene: se queda plegándose en su lugar.
  committed.current.forEach((row, index) => {
    if (!keys.has(row.key) && !leaving.current.has(row.key)) leaving.current.set(row.key, { item: row.item, index });
  });
  for (const key of keys) leaving.current.delete(key);
  const rows: Array<Row<T>> = current.slice();
  for (const [key, { item, index }] of leaving.current) rows.splice(Math.min(index, rows.length), 0, { key, item, open: false });

  useLayoutEffect(() => { committed.current = rows; });
  useLayoutEffect(() => { mounted.current = true; }, []);

  return (
    <>
      {rows.map(row => (
        <Collapse
          key={row.key}
          open={row.open}
          appear={mounted.current}
          lazy={false}
          reveal={reveal}
          onSettled={open => { if (!open && leaving.current.delete(row.key)) rerender(); }}
        >
          {render(row.item)}
        </Collapse>
      ))}
    </>
  );
}

/**
 * Alto suave cuando el contenido de un bloque se reemplaza (cambiar de solapa,
 * de espacio o de columna en mobile): en vez de saltar del alto viejo al
 * nuevo en un cuadro, el bloque pasa por los intermedios (250 ms, la curva del
 * colapso), recortando mientras tanto. Con movimiento reducido no anima.
 * El control tocado lo sostiene quieto quien llama (`useAnchoredToggle`).
 */
export function useSmoothHeight<T extends HTMLElement>(key: string) {
  const ref = useRef<T | null>(null);
  const last = useRef<{ key: string; height: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = last.current;
    // Si estaba animando, se parte del alto que se ve ahora.
    const shown = el.style.height ? el.getBoundingClientRect().height : previous?.height;
    el.style.transition = '';
    el.style.height = '';
    el.style.overflow = '';
    const next = el.getBoundingClientRect().height;
    last.current = { key, height: next };
    if (!previous || previous.key === key || shown === undefined || Math.abs(shown - next) < 2) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.style.height = `${shown}px`;
    el.style.overflow = 'clip';
    void el.offsetHeight;
    el.style.transition = `height ${COLLAPSE_MS}ms var(--g-ease)`;
    el.style.height = `${next}px`;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      el.style.transition = '';
      el.style.height = '';
      el.style.overflow = '';
      last.current = { key, height: el.getBoundingClientRect().height };
    }, COLLAPSE_MS + 20);
  }, [key]);
  // Cambios de alto que no son un reemplazo (una tarjeta que se despliega): solo se anota el alto.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (!el.style.height && last.current) last.current = { ...last.current, height: el.getBoundingClientRect().height }; });
    observer.observe(el);
    return () => { observer.disconnect(); window.clearTimeout(timer.current); };
  }, []);
  return ref;
}

/**
 * Clave estable de una subtarea: la optimista (id negativo) y la que vuelve
 * del server (id real) son la misma fila, así no se pliega una y se despliega
 * la otra cuando el server contesta.
 */
export function useSubtaskKeys() {
  const keys = useRef(new Map<number, string>());
  const seen = useRef(new Map<string, { id: number; texto: string }>());
  return (items: TaskChecklistItem[]) => {
    const present = new Set(items.map(item => item.id));
    return (item: TaskChecklistItem) => {
      let key = keys.current.get(item.id);
      if (!key) {
        // Un id real nuevo toma la clave de la optimista con el mismo texto que ya no está.
        if (item.id > 0) {
          for (const [candidate, info] of seen.current) {
            if (info.id < 0 && !present.has(info.id) && info.texto === item.texto) { key = candidate; break; }
          }
        }
        key = key || `s${item.id}`;
        keys.current.set(item.id, key);
      }
      seen.current.set(key, { id: item.id, texto: item.texto });
      return key;
    };
  };
}

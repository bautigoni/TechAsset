import { useCallback, useLayoutEffect, useRef } from 'react';
import { COLLAPSE_MS } from '../../ui';

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Cambios de alto que no son un colapso (cargando → datos, "Cargar más", un
 * filtro que achica la lista, otra aula en la ficha): el bloque pasa del alto
 * que tenía al nuevo con la misma curva y duración que `Collapse`, en vez de
 * saltar en un cuadro (REGLAS-UX, agregado del dueño 20/10: "nada se abre de
 * golpe"). Con `prefers-reduced-motion` no anima (y tampoco salta el scroll:
 * lo de arriba no se mueve).
 *
 *   const { ref, smooth } = useSmoothHeight<HTMLDivElement>();
 *   smooth(); setItems(next);        // ANTES del cambio de estado
 *   <div ref={ref}>…</div>
 *
 * `hold()` sostiene el alto de ahora (min-height) mientras algo carga: lo
 * suelta el próximo `smooth()` + render (anima al alto nuevo) o `release()`.
 *
 * Solo anima cuando se lo pide (`smooth()`), así el tipeo en un campo que
 * crece o un colapso de adentro (que ya anima solo) no quedan "arrastrados".
 * Local a Aulas e Historial; si sirve en más pantallas, va a `src/ui`.
 */
export function useSmoothHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const from = useRef<number | null>(null);
  const run = useRef<{ timer: number; onEnd: (event: TransitionEvent) => void } | null>(null);

  const finish = useCallback(() => {
    const el = ref.current;
    const current = run.current;
    run.current = null;
    if (current) {
      window.clearTimeout(current.timer);
      el?.removeEventListener('transitionend', current.onEnd);
    }
    if (el) {
      el.style.transition = '';
      el.style.height = '';
      el.style.overflow = '';
    }
  }, []);

  // Después de cada render: si se pidió, del alto anterior al nuevo.
  useLayoutEffect(() => {
    const el = ref.current;
    const start = from.current;
    if (!el || start === null) return;
    from.current = null;
    el.style.minHeight = '';
    // Se mide el alto natural nuevo (sin lo que haya quedado de una animación anterior).
    if (run.current) finish();
    const end = el.getBoundingClientRect().height;
    if (Math.abs(end - start) < 1 || reducedMotion()) return;
    el.style.overflow = 'hidden';
    el.style.height = `${start}px`;
    void el.offsetHeight;
    el.style.transition = `height ${COLLAPSE_MS}ms var(--g-ease)`;
    el.style.height = `${end}px`;
    const onEnd = (event: TransitionEvent) => { if (event.target === el && event.propertyName === 'height') finish(); };
    el.addEventListener('transitionend', onEnd);
    run.current = { timer: window.setTimeout(finish, COLLAPSE_MS + 120), onEnd };
  });

  useLayoutEffect(() => finish, [finish]);

  /** Llamalo justo antes del cambio de estado: toma el alto de ahora (aunque esté a mitad de otra animación). */
  const smooth = useCallback(() => {
    const el = ref.current;
    if (el && from.current === null) from.current = el.getBoundingClientRect().height;
  }, []);
  const hold = useCallback(() => {
    const el = ref.current;
    if (el) el.style.minHeight = `${el.getBoundingClientRect().height}px`;
  }, []);
  const release = useCallback(() => {
    const el = ref.current;
    if (el) el.style.minHeight = '';
  }, []);

  return { ref, smooth, hold, release };
}

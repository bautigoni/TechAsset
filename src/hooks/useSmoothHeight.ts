import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { COLLAPSE_MS, keepInPlace, recentTrigger } from '../ui';

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Cuando cambia `key` (un filtro, un segmentado, la búsqueda, otra ficha), el
 * contenedor pasa de su alto anterior al nuevo con la misma curva que
 * `Collapse` en vez de saltar de golpe. `hold()`, llamado en el handler ANTES
 * del cambio, deja quieto el control tocado (si lo de abajo se acorta, reserva
 * alto al pie para que el scroll no se recorte). Con `prefers-reduced-motion`
 * no anima, pero el control igual queda quieto.
 *
 *   const [results, hold] = useSmoothHeight<HTMLDivElement>(filter);
 *   <Segmented onChange={next => { hold(); setFilter(next); }} />
 *   <div ref={results}>…lista…</div>
 *
 * `enabled = false` la apaga (p. ej. cuando el cambio es una navegación).
 */
export function useSmoothHeight<T extends HTMLElement>(key: unknown, enabled = true) {
  const ref = useRef<T | null>(null);
  const last = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { last.current = null; return; }
    // Si estaba animando, se parte del alto que se ve ahora (no del final anterior).
    const shown = running.current ? el.getBoundingClientRect().height : last.current;
    running.current?.cancel();
    running.current = null;
    el.style.overflow = '';
    const next = el.getBoundingClientRect().height;
    last.current = next;
    if (!enabled || shown === null || Math.abs(shown - next) < 2) return;
    if (reducedMotion() || typeof el.animate !== 'function') return;
    const animation = el.animate([{ height: `${shown}px` }, { height: `${next}px` }], { duration: COLLAPSE_MS, easing: EASE });
    running.current = animation;
    el.style.overflow = 'hidden';
    const done = () => {
      if (running.current !== animation) return;
      running.current = null;
      el.style.overflow = '';
    };
    animation.onfinish = done;
    animation.oncancel = done;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Lo que cambia de alto por otras razones (una imagen que carga, el ancho de
  // la ventana, un colapso de adentro) actualiza el punto de partida sin animar.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => { if (!running.current) last.current = el.getBoundingClientRect().height; });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hold = useCallback((trigger?: HTMLElement | null) => {
    const anchor = trigger || recentTrigger();
    if (!anchor || ref.current?.contains(anchor)) return;
    keepInPlace(anchor, { reserve: 'auto', duration: reducedMotion() ? 0 : COLLAPSE_MS + 60 });
  }, []);

  return [ref, hold] as const;
}

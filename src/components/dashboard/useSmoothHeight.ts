import { useLayoutEffect, useRef } from 'react';
import { COLLAPSE_MS } from '../../ui';

/**
 * Cambio de contenido sin salto de alto (agregado del dueño 20/10: "nada se
 * abre de golpe"). Para lo que no es un abrir/cerrar (eso es <Collapse>): una
 * lista que se filtra, "Ver más", una pestaña que cambia, el resultado de la
 * barra que pasa de "encontrado" al préstamo. Cuando cambia `key`, el
 * contenedor va del alto que tenía al nuevo con la misma duración y curva que
 * Collapse; con `prefers-reduced-motion` es instantáneo. El alto anterior sale
 * de un ResizeObserver (después del layout y antes de pintar), así el primer
 * cuadro con el contenido nuevo ya se dibuja con el alto viejo.
 *
 * Se combina con `useAnchoredToggle` (el control tocado queda quieto mientras
 * dura) y no anima si está adentro de un <Collapse> que todavía se abre o se
 * cierra (ese ya anima el alto). Candidato a `src/ui` (revisor 1).
 */
export function useSmoothHeight<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  const last = useRef<number | null>(null);
  const first = useRef(true);
  const running = useRef<(() => void) | null>(null);

  // El último alto "quieto" (no se toma mientras anima).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    last.current = el.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      if (!running.current) last.current = el.getBoundingClientRect().height;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (first.current) { first.current = false; return; }
    if (!el) return;
    // Si otra transición seguía en curso, se arranca desde el alto de ese momento.
    const mid = running.current ? el.getBoundingClientRect().height : null;
    running.current?.();
    const from = mid ?? last.current;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const collapse = el.closest<HTMLElement>('.ui-collapse');
    const busy = collapse && collapse.dataset.state !== 'open';
    const to = el.getBoundingClientRect().height;
    last.current = to;
    if (from === null || reduced || busy || Math.abs(to - from) < 2) return;
    el.style.height = `${from}px`;
    el.style.overflow = 'hidden';
    void el.offsetHeight;
    el.style.transition = `height ${COLLAPSE_MS}ms var(--g-ease, ease)`;
    el.style.height = `${to}px`;
    // Lo nuevo entra con un fundido corto (como Collapse: alto + opacidad).
    el.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: COLLAPSE_MS, easing: 'ease-out' });
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      el.removeEventListener('transitionend', onEnd);
      el.style.height = '';
      el.style.overflow = '';
      el.style.transition = '';
      running.current = null;
      last.current = el.getBoundingClientRect().height;
    };
    const onEnd = (event: TransitionEvent) => { if (event.target === el && event.propertyName === 'height') done(); };
    el.addEventListener('transitionend', onEnd);
    timer = window.setTimeout(done, COLLAPSE_MS + 80);
    running.current = done;
  }, [key]);

  useLayoutEffect(() => () => running.current?.(), []);
  return ref;
}

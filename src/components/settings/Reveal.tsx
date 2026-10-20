import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { COLLAPSE_MS, Collapse } from '../../ui';

/**
 * Lo que aparece por tocar algo (un error, un resultado, un aviso, un campo
 * que depende de otro) entra y sale con el colapso compartido: alto suave, el
 * control tocado quieto y, plegado, nada en el flujo (ni el gap del padre).
 * Mientras se pliega sigue mostrando lo último (aunque `when` ya sea falso).
 * Los hijos se escriben como siempre: `<Reveal when={error}>{error && <p>…</p>}</Reveal>`.
 * `row`: dentro de una fila flex que envuelve, ocupa la fila entera.
 */
export function Reveal({ when, children, className, row }: { when: unknown; children: ReactNode; className?: string; row?: boolean }) {
  return (
    <Collapse open={Boolean(when)} unmountOnClose gap="auto" className={className} outerClassName={row ? 'cfg-reveal-row' : undefined}>
      {children}
    </Collapse>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Un bloque cuyo contenido se reemplaza al tocar un filtro, un segmentado o
 * una solapa (la lista de usuarios, el panel de una solapa) no cambia de alto
 * de golpe: cuando `key` cambia, pasa del alto que tenía al nuevo con la misma
 * curva que el colapso (instantáneo con movimiento reducido). Se usa junto con
 * `anchored(...)` para que el control tocado quede quieto.
 *
 *   const listRef = useSmoothHeight<HTMLDivElement>(`${filter}|${query}`); // ref callback
 *   <div ref={listRef}>…</div>
 */
export function useSmoothHeight<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  const last = useRef<number | null>(null);
  const animating = useRef(false);
  const observer = useRef<ResizeObserver | null>(null);

  // El alto "de antes" se sigue con un ResizeObserver (cargas, ediciones):
  // así el cambio de `key` arranca desde lo último que se vio. Ref callback:
  // el bloque puede montarse después (cuando terminan de llegar los datos).
  const attach = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    ref.current = el;
    if (!el) { last.current = null; return; }
    last.current = el.getBoundingClientRect().height;
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => { if (!animating.current) last.current = el.getBoundingClientRect().height; });
    observer.current.observe(el);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = last.current;
    const next = el.getBoundingClientRect().height;
    last.current = next;
    if (prev === null || Math.abs(prev - next) < 2 || reducedMotion()) return;
    animating.current = true;
    const style = el.style;
    style.boxSizing = 'border-box';
    style.overflow = 'clip';
    style.height = `${prev}px`;
    void el.offsetHeight;
    style.transition = `height ${COLLAPSE_MS}ms var(--g-ease)`;
    style.height = `${next}px`;
    let timer = 0;
    let finished = false;
    // Termina la transición (o la corta un cambio nuevo). Una sola vez: si
    // corriera de nuevo como limpieza del próximo cambio, mediría el alto ya
    // nuevo y ese cambio arrancaría sin animación.
    const done = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      // El alto que se ve ahora (a mitad de camino si lo cortó otro cambio): de ahí arranca el próximo.
      const seen = el.getBoundingClientRect().height;
      el.removeEventListener('transitionend', onEnd);
      style.transition = '';
      style.height = '';
      style.overflow = '';
      style.boxSizing = '';
      animating.current = false;
      last.current = seen;
    };
    const onEnd = (event: TransitionEvent) => { if (event.target === el && event.propertyName === 'height') done(); };
    el.addEventListener('transitionend', onEnd);
    timer = window.setTimeout(done, COLLAPSE_MS + 120);
    return done;
  }, [key]);

  return attach;
}

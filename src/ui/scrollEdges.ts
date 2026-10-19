import { useEffect, useRef } from 'react';

/**
 * Contenedor interno que scrollea SIN barra visible y con un degradé en el
 * borde que avisa que hay más (CLAUDE.md: nunca se ven barras de scroll).
 * Poné la clase `ui-scroll-fade` al elemento y su ref:
 *
 *   const ref = useScrollEdges<HTMLDivElement>();
 *   <div ref={ref} className="ui-scroll-fade" style={{ maxHeight: '40dvh' }}>…</div>
 *
 * Marca `data-fade-top` / `data-fade-bottom` según haya contenido escondido
 * arriba o abajo (se recalcula al scrollear y cuando cambia el tamaño).
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      el.toggleAttribute('data-fade-top', top);
      el.toggleAttribute('data-fade-bottom', bottom);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const observeChildren = () => { resize?.observe(el); for (const child of Array.from(el.children)) resize?.observe(child); };
    observeChildren();
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { observeChildren(); schedule(); });
    mutations?.observe(el, { childList: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, []);
  return ref;
}

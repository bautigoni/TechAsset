import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { COLLAPSE_MS } from './Collapse';
import { cx } from './util';

/**
 * Bloque cuyo contenido cambia de alto SIN ser un abrir/cerrar (resultados que
 * se reemplazan mientras tipeás, "Ver anteriores" que suma filas, cargando →
 * datos): el alto pasa suave del valor anterior al nuevo en vez de saltar en un
 * cuadro. El primer pintado no se anima. Con `prefers-reduced-motion: reduce`
 * cambia al instante. Mientras anima recorta (overflow: clip) y al terminar
 * vuelve a `auto`: nunca deja un alto fijo.
 *
 *   <AutoHeight className="mi-lista">{resultados}</AutoHeight>
 */
export function AutoHeight({ children, className, innerClassName, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; innerClassName?: string }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let last = inner.getBoundingClientRect().height;
    let animation: Animation | null = null;
    // El observer avisa después del layout y antes de pintar: el cuadro con el
    // contenido nuevo ya sale con el alto viejo y desde ahí anima.
    const observer = new ResizeObserver(() => {
      const next = inner.getBoundingClientRect().height;
      if (Math.abs(next - last) < 1) return;
      const from = animation ? outer.getBoundingClientRect().height : last;
      last = next;
      animation?.cancel();
      animation = null;
      if (reduce?.matches || typeof outer.animate !== 'function') return;
      outer.style.overflow = 'clip';
      const current = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], { duration: COLLAPSE_MS, easing: 'cubic-bezier(.2, 0, 0, 1)' });
      animation = current;
      const done = () => { if (animation === current) { animation = null; outer.style.overflow = ''; } };
      current.onfinish = done;
      current.oncancel = done;
    });
    observer.observe(inner);
    return () => { observer.disconnect(); animation?.cancel(); };
  }, []);
  return (
    <div ref={outerRef} className={cx('ui-autoheight', className)} {...rest}>
      <div ref={innerRef} className={innerClassName}>{children}</div>
    </div>
  );
}

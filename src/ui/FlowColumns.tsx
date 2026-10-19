import { Children, isValidElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from './util';

/**
 * Tarjetas de alto distinto en columnas que fluyen (sin huecos): en vez de una
 * grilla, donde cada fila mide lo que la tarjeta más alta y las demás quedan
 * estiradas con una franja vacía, cada columna apila sus tarjetas con su alto
 * propio. Cuántas columnas entran sale del ancho real (`minRem` por columna);
 * los hijos se reparten en orden de lectura (1 → col 1, 2 → col 2, …), así
 * abrir algo dentro de una tarjeta solo hace crecer SU columna (nada salta de
 * una columna a otra, como pasaría con `columns:` de CSS).
 *
 *   <FlowColumns minRem={17} className="mi-grilla">{secciones}</FlowColumns>
 *
 * El gap entre columnas y entre tarjetas sale de `--ui-flow-gap` (default 12 px).
 */
export function FlowColumns({ children, minRem = 17, max = 4, className, style }: {
  children: ReactNode;
  /** Ancho mínimo de una columna, en rem. */
  minRem?: number;
  /** Tope de columnas. */
  max?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 0 = todavía sin medir: se mide antes de pintar y recién ahí se montan los
  // hijos (así no se montan dos veces ni se ve un reacomodo al entrar).
  const [count, setCount] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const fit = Math.floor((el.clientWidth + gap) / (minRem * rem + gap));
      setCount(Math.max(1, Math.min(max, fit)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minRem, max]);

  // toArray ya saca null, undefined y booleanos.
  const items = Children.toArray(children).filter(child => child !== '');
  const n = Math.max(1, Math.min(count || 1, items.length || 1));
  const columns: ReactNode[][] = Array.from({ length: n }, () => []);
  items.forEach((child, index) => columns[index % n].push(child));

  return (
    <div ref={ref} className={cx('ui-flowcols', className)} style={style}>
      {count > 0 && columns.map((column, index) => (
        <div key={index} className="ui-flowcol">
          {column.map((child, i) => (isValidElement(child) ? child : <div key={i}>{child}</div>))}
        </div>
      ))}
    </div>
  );
}

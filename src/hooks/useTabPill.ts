import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type TabPillStyle = {
  transform: string;
  width: string;
  top: string;
  height: string;
  opacity: number;
};

const HIDDEN: TabPillStyle = { transform: 'translateX(0)', width: '0px', top: '0px', height: '0px', opacity: 0 };

/**
 * Receta `tabs-sliding` de transitions.dev: en vez de que el fondo del tab
 * activo aparezca y desaparezca, una píldora viaja de un tab al otro. El
 * movimiento es lo que hace legible que son opciones del mismo grupo.
 *
 * Las medidas se leen del DOM (la píldora no puede saber el ancho de un label
 * de antemano) y se escriben inline; el tween lo hace CSS con `--tabs-dur`.
 *
 * Uso: poner el ref en el contenedor, marcar el tab activo con
 * `data-tab-active="true"` y renderizar `<span className="t-tabs-pill" style={style} />`
 * como primer hijo.
 */
/**
 * `fill` cubre todo el botón (barras tipo píldora). `underline` deja una barra
 * fina pegada al borde inferior, para las barras que marcan el activo con un
 * subrayado en vez de un fondo.
 */
export type TabPillMode = 'fill' | 'underline';

const UNDERLINE_HEIGHT = 2;

export function useTabPill<T extends HTMLElement = HTMLDivElement>(activeKey: string | number, mode: TabPillMode = 'fill') {
  const ref = useRef<T | null>(null);
  const [style, setStyle] = useState<TabPillStyle>(HIDDEN);

  const measure = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-tab-active="true"]');
    if (!active) {
      setStyle(current => ({ ...current, opacity: 0 }));
      return;
    }
    const underline = mode === 'underline';
    setStyle({
      transform: `translateX(${active.offsetLeft}px)`,
      width: `${active.offsetWidth}px`,
      top: `${underline ? active.offsetTop + active.offsetHeight - UNDERLINE_HEIGHT : active.offsetTop}px`,
      height: `${underline ? UNDERLINE_HEIGHT : active.offsetHeight}px`,
      opacity: 1
    });
  }, [mode]);

  // useLayoutEffect: medir antes del paint evita que la píldora se vea un frame
  // en la posición vieja al cambiar de tab.
  useLayoutEffect(() => { measure(); }, [measure, activeKey]);

  // Los labels cambian de ancho al cambiar el breakpoint o la tipografía.
  useEffect(() => {
    const container = ref.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, style };
}

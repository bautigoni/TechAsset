/**
 * Desde la etapa 2 la página no scrollea: la app ocupa la ventana (100dvh) y
 * lo que scrollea es el área de contenido del shell (`.shell-scroll`). Así la
 * barra superior, el menú, la barra inferior mobile y la columna del asistente
 * nunca quedan encima del contenido. Las pantallas que antes hacían
 * `window.scrollTo({ top: 0 })` usan esto.
 */
export function appScroller(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.shell-scroll');
}

export function scrollAppToTop(smooth = false) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = smooth && !reduced ? 'smooth' : 'auto';
  const scroller = appScroller();
  if (scroller) scroller.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

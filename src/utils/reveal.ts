import { appScroller } from './scroll';

/**
 * Lleva hasta un panel que se abrió en línea SOLO si quedó fuera de vista
 * (docs/redesign/REGLAS-UX.md: abrir no mueve la pantalla sin razón; lo que se
 * abre queda visible). `block: 'nearest'` mueve lo mínimo; sin animación si el
 * usuario pidió reducir el movimiento. Mide contra el área que scrollea
 * (`.shell-scroll`): la barra superior y la inferior quedan afuera.
 */
export function revealInline(element: Element | null | undefined, block: ScrollLogicalPosition = 'nearest') {
  if (!element || typeof (element as HTMLElement).scrollIntoView !== 'function') return;
  const rect = element.getBoundingClientRect();
  const area = appScroller()?.getBoundingClientRect();
  const top = area ? area.top : 0;
  const bottom = area ? area.bottom : (window.innerHeight || document.documentElement.clientHeight);
  const visibleH = bottom - top;
  // Ya se ve su comienzo con buena parte del alto: no se mueve nada.
  if (rect.top >= top && rect.top <= bottom - Math.min(rect.height, visibleH * 0.4)) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  (element as HTMLElement).scrollIntoView({ block, behavior: reduced ? 'auto' : 'smooth' });
}

/** Foco sin mover el scroll (el que mueve, si hace falta, es `revealInline`). */
export function focusQuietly(element: HTMLElement | null | undefined) {
  element?.focus({ preventScroll: true });
}

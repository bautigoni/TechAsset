import { useLayoutEffect, useRef } from 'react';

// Tiene que coincidir con --resize-dur en motion.css.
const RESIZE_MS = 300;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Receta `card-resize` de transitions.dev.
 *
 * La receta es CSS puro, pero sólo tweenea entre dos alturas concretas: contra
 * `auto` el browser no interpola. Así que acá se mide.
 *
 * Cómo: en cada cambio de `key` el efecto corre con el contenido nuevo ya
 * pintado, y `previousRef` todavía guarda la altura del contenido viejo. Se
 * fija la vieja, se fuerza un reflow para que el browser la tome como punto de
 * partida, y se suelta la nueva. Al terminar se vuelve a `auto`, que es lo que
 * permite que el contenido siga creciendo solo después.
 *
 * `overflow: hidden` va sólo durante la animación: dejarlo fijo recortaría el
 * fantasma del drag & drop del tablero.
 */
export function useCardResize<T extends HTMLElement = HTMLDivElement>(key: string | number) {
  const ref = useRef<T | null>(null);
  const previousRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Si venía una animación a medio camino, se corta y se libera el estilo
    // antes de medir: si no, se mediría la altura congelada de la anterior.
    cleanupRef.current?.();

    const to = element.offsetHeight;
    const from = previousRef.current;
    previousRef.current = to;

    if (from == null || from === to || prefersReducedMotion()) return;

    element.style.overflow = 'hidden';
    element.style.height = `${from}px`;
    // Lectura forzada: sin esto el browser agrupa los dos sets y no hay tween.
    void element.offsetHeight;
    element.style.height = `${to}px`;

    const release = () => {
      element.style.height = '';
      element.style.overflow = '';
      previousRef.current = element.offsetHeight;
      cleanupRef.current = null;
    };
    // El timer y no `transitionend`: si el contenido no llega a cambiar de
    // alto, el evento no dispara nunca y el nodo queda con height fijo.
    const timer = window.setTimeout(release, RESIZE_MS + 30);
    cleanupRef.current = () => { window.clearTimeout(timer); release(); };

    return () => { window.clearTimeout(timer); };
  }, [key]);

  useLayoutEffect(() => () => cleanupRef.current?.(), []);

  return ref;
}

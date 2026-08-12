import { useCallback, useEffect, useRef } from 'react';

/**
 * Paneo horizontal arrastrando el fondo del contenedor, tipo tablero de Canva
 * pero limitado al eje X: no es un lienzo libre, solo desplaza el scroll.
 *
 * Solo agarra cuando el arrastre empieza en el fondo, nunca sobre una tarjeta,
 * un botón o un campo: si no, se pisaría con el drag & drop de tareas.
 */
const INTERACTIVE = 'input, textarea, select, button, a, [draggable="true"], .task-card, .infinite-column-head';

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const state = useRef({ dragging: false, startX: 0, startScroll: 0, moved: false });

  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const node = ref.current;
    if (!node || node.scrollWidth <= node.clientWidth) return;
    state.current = { dragging: true, startX: event.clientX, startScroll: node.scrollLeft, moved: false };
    node.classList.add('is-panning');
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || !state.current.dragging) return;
      const delta = event.clientX - state.current.startX;
      if (Math.abs(delta) > 3) state.current.moved = true;
      node.scrollLeft = state.current.startScroll - delta;
    };
    const onUp = () => {
      const node = ref.current;
      if (!node || !state.current.dragging) return;
      state.current.dragging = false;
      node.classList.remove('is-panning');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return { ref, onPointerDown };
}

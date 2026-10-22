import { flushSync } from 'react-dom';
import { COLLAPSE_MS, keepInPlace, recentTrigger } from '../../ui';

const reduced = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const HEIGHT_ANIMATION = 'smooth-height';

/** Después de que se pintó el cuadro con el cambio (dos rAF): ahí el reloj ya no arrastra el tiempo de un render largo. */
export const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

/**
 * Cambios de alto que no son un colapso (una lista que se reemplaza al tocar un
 * filtro, una descripción que se despliega, un comentario nuevo): aplica
 * `mutate` en el mismo frame y anima el alto de `el` del valor anterior al
 * nuevo (alto + recorte, la misma duración que `Collapse`), con el control
 * tocado quieto en pantalla (`keepInPlace` de src/ui). Con movimiento
 * reducido el cambio es inmediato, sin saltos de scroll.
 *
 * Lo usan Sugerencias y Caja chica. (Si otra pantalla lo necesita, conviene
 * subirlo a src/ui junto a `useAnchoredToggle`.)
 */
export function smoothHeight(el: HTMLElement | null | undefined, mutate: () => void, anchor: HTMLElement | null = recentTrigger()) {
  const still = reduced();
  const target = el && el.isConnected ? el : null;
  // Desde lo que se ve ahora (si había otra transición a mitad de camino, desde ahí).
  const from = target ? target.getBoundingClientRect().height : 0;
  target?.getAnimations().forEach(animation => { if (animation.id === HEIGHT_ANIMATION) animation.cancel(); });
  const hold = anchor ? keepInPlace(anchor, { duration: still ? 0 : COLLAPSE_MS + 60, reserve: 'auto' }) : null;
  flushSync(mutate);
  if (still) { hold?.stop(); return; }
  if (!target || !target.isConnected) return;
  const to = target.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  const ease = getComputedStyle(document.documentElement).getPropertyValue('--g-ease').trim() || 'cubic-bezier(.2, 0, 0, 1)';
  // El primer cuadro se pinta con el alto anterior y la curva arranca en el
  // siguiente: si dibujar lo nuevo tarda, la transición no empieza "ya avanzada".
  target.style.height = `${from}px`;
  target.style.overflow = 'clip';
  afterPaint(() => {
    target.style.height = '';
    target.style.overflow = '';
    const animation = target.animate([{ height: `${from}px`, overflow: 'clip' }, { height: `${to}px`, overflow: 'clip' }], { duration: COLLAPSE_MS, easing: ease, fill: 'backwards' });
    // Arranca AHORA: el reloj del cuadro es el de su comienzo y, tras un cuadro largo, la curva empezaría ya avanzada.
    animation.startTime = performance.now();
    animation.id = HEIGHT_ANIMATION;
  });
}

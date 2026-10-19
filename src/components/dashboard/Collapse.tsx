import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../ui';
import { appScroller } from '../../utils/scroll';

/*
 * Colapso anclado del Inicio (REGLAS-UX, agregado del dueño del 19/10):
 *  - abre y cierra con una transición de alto (instantáneo con reduced motion);
 *  - el encabezado que se tocó queda quieto en la pantalla: `pinAnchor` corrige
 *    el scroll del contenedor (.shell-scroll) mientras dura la animación, y un
 *    "piso" al pie del Inicio evita que el navegador recorte el scroll cuando
 *    la página se acorta (se libera solo a medida que se sube);
 *  - lo que se abre fuera de vista se trae con scrollIntoView({ block: 'nearest' }).
 *
 * Es local del Inicio porque `src/ui` todavía no tiene la primitiva compartida
 * (otro agente la está agregando); cuando exista, esto se reemplaza por ella.
 */

const DURATION = 200;
const EASING = 'cubic-bezier(.22, 1, .36, 1)';

export const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function scroller(): HTMLElement {
  return appScroller() || (document.scrollingElement as HTMLElement) || document.documentElement;
}

/* ── Piso de scroll ──────────────────────────────────────────────────────
   Alto extra al pie del Inicio (padding de .dash vía --dash-floor) que
   conserva la posición cuando algo se achica cerca del final de la página. */

let floor = 0;
let floorHost: HTMLElement | null = null;
let floorScroller: HTMLElement | null = null;

function applyFloor() {
  if (!floorHost) return;
  if (floor > 0) floorHost.style.setProperty('--dash-floor', `${Math.ceil(floor)}px`);
  else floorHost.style.removeProperty('--dash-floor');
}

function recomputeFloor() {
  const box = floorScroller;
  if (!box || !floorHost?.isConnected) { stopFloor(); return; }
  const natural = box.scrollHeight - floor;
  floor = Math.max(0, box.scrollTop + box.clientHeight - natural);
  applyFloor();
  if (!floor) stopFloor();
}

function stopFloor() {
  floorScroller?.removeEventListener('scroll', recomputeFloor);
  window.removeEventListener('resize', recomputeFloor);
  if (floorHost) floorHost.style.removeProperty('--dash-floor');
  floor = 0;
  floorHost = null;
  floorScroller = null;
}

function hostOf(element: Element | null) {
  return (element?.closest('.dash') as HTMLElement | null) || null;
}

/** Suma `px` de piso ya (antes de que algo se achique). */
function addFloor(host: HTMLElement, px: number) {
  if (floorHost && floorHost !== host) stopFloor();
  if (!floorHost) {
    floorHost = host;
    floorScroller = scroller();
    floorScroller.addEventListener('scroll', recomputeFloor, { passive: true });
    window.addEventListener('resize', recomputeFloor);
  }
  floor += Math.max(0, px);
  applyFloor();
}

/** Deja solo el piso que hace falta; lo demás se libera al subir. */
function releaseFloor() {
  if (floorHost) recomputeFloor();
}

/**
 * Para cambios instantáneos que pueden acortar la página (Ver menos, cambiar
 * de pestaña): si en el próximo frame el documento quedó más corto, se repone
 * el alto y la posición antes de pintar.
 */
export function keepScrollOnShrink(from: Element | null) {
  const host = hostOf(from);
  if (!host) return;
  const box = scroller();
  const top = box.scrollTop;
  const before = box.scrollHeight;
  requestAnimationFrame(() => {
    const after = box.scrollHeight;
    if (after >= before) return;
    addFloor(host, before - after);
    box.scrollTop = top;
    releaseFloor();
  });
}

/**
 * Mantiene `anchor` en el mismo lugar de la pantalla mientras lo de arriba o
 * lo de abajo cambia de alto (una ficha que se cierra arriba, la que se abre).
 */
export function pinAnchor(anchor: Element | null, ms = DURATION + 60) {
  if (!anchor) return;
  const box = scroller();
  const start = anchor.getBoundingClientRect().top;
  const until = performance.now() + ms;
  const step = () => {
    if (!anchor.isConnected) return;
    const delta = anchor.getBoundingClientRect().top - start;
    if (Math.abs(delta) >= 0.5) box.scrollTop += delta;
    if (performance.now() < until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function reveal(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const view = scroller().getBoundingClientRect();
  if (rect.bottom <= view.bottom && rect.top >= view.top) return;
  element.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** Contenido plegable: crece hacia abajo desde su encabezado y se pliega hacia él. */
export function Collapse({ open, id, className, children, revealOnOpen = true }: {
  open: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
  /** Al abrir, si queda fuera de vista, se trae suavemente. */
  revealOnOpen?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const animation = useRef<Animation | null>(null);
  const mountedOpen = useRef(open);
  const [shown, setShown] = useState(open);
  // Abrir monta en el mismo render; cerrar desmonta al terminar la animación.
  if (open && !shown) setShown(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (mountedOpen.current === open) return;
    mountedOpen.current = open;
    if (!element) return;
    const running = animation.current;
    const from = running ? element.getBoundingClientRect().height : open ? 0 : element.offsetHeight;
    running?.cancel();
    animation.current = null;
    const reduced = prefersReducedMotion() || typeof element.animate !== 'function';
    const done = () => {
      animation.current = null;
      element.style.removeProperty('overflow');
    };

    if (open) {
      if (reduced) { if (revealOnOpen) reveal(element); return; }
      const to = element.scrollHeight;
      element.style.overflow = 'hidden';
      const anim = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: EASING });
      animation.current = anim;
      anim.onfinish = () => { done(); if (revealOnOpen) reveal(element); };
      return;
    }

    const host = hostOf(element);
    if (host) addFloor(host, from);
    if (reduced) { setShown(false); requestAnimationFrame(releaseFloor); return; }
    element.style.overflow = 'hidden';
    const anim = element.animate([{ height: `${from}px` }, { height: '0px' }], { duration: DURATION, easing: EASING, fill: 'forwards' });
    animation.current = anim;
    anim.onfinish = () => {
      done();
      setShown(false);
      requestAnimationFrame(releaseFloor);
    };
  }, [open, revealOnOpen]);

  if (!shown) return null;
  return <div ref={ref} id={id} className={cx('dash-collapse', className)}>{children}</div>;
}

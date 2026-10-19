import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from '../../ui/util';

/**
 * Panel en línea que se abre y se cierra con transición suave de alto (regla
 * del dueño del 19/10, REGLAS-UX "abrir y cerrar secciones"):
 *
 * - `grid-template-rows: 0fr ↔ 1fr` (--g-dur ≈ 180 ms, `--g-ease`); instantáneo con
 *   `prefers-reduced-motion`.
 * - Al cerrar, lo de ARRIBA no se mueve: se mide el borde superior del panel
 *   antes de plegar y en cada frame se corrige el scroll del contenedor que
 *   scrollea (en el shell es `.shell-scroll`, no window). Si el documento se
 *   acorta al final de la página, un relleno al pie del contenedor conserva el
 *   alto y se va liberando a medida que el usuario sube (nunca de golpe).
 * - Al abrir, si lo que aparece queda fuera de vista, se lleva hasta él
 *   (`nearest`, o `start` si es más alto que la pantalla), suave.
 * - Lo que se está cerrando queda `inert` (no toma foco) y se desmonta al
 *   terminar; si el foco estaba adentro vuelve a `returnFocus`.
 * - `gap`: el espacio que el padre (flex/grid) deja entre hijos. Se compensa
 *   con un margen negativo que también se anima, así abrir o cerrar no hace
 *   saltar 16 px de golpe.
 *
 * Helper local de la etapa 8c (Herramientas, Accesos rápidos, Caja chica);
 * genérico, para mudarlo a `src/ui` cuando se unifique.
 */

export const COLLAPSE_MS = 180; // = --g-dur

type Spacer = { base: string; extra: number; onScroll: (() => void) | null };
const spacers = new WeakMap<HTMLElement, Spacer>();

function findScroller(node: HTMLElement | null): HTMLElement {
  let current = node?.parentElement || null;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement;
}

function applySpacer(scroller: HTMLElement, state: Spacer) {
  scroller.style.paddingBottom = state.extra > 0 ? `calc(${state.base} + ${Math.ceil(state.extra)}px)` : '';
}

function addSpacer(scroller: HTMLElement, px: number) {
  let state = spacers.get(scroller);
  if (!state) {
    state = { base: getComputedStyle(scroller).paddingBottom || '0px', extra: 0, onScroll: null };
    spacers.set(scroller, state);
  }
  state.extra += px;
  applySpacer(scroller, state);
}

/** Achica el relleno a lo justo para que el scroll actual siga siendo válido; se libera al subir. */
function settleSpacer(scroller: HTMLElement) {
  const state = spacers.get(scroller);
  if (!state) return;
  const needed = Math.max(0, scroller.scrollTop + scroller.clientHeight - (scroller.scrollHeight - state.extra));
  state.extra = Math.min(state.extra, needed);
  applySpacer(scroller, state);
  if (state.extra > 0 && !state.onScroll) {
    state.onScroll = () => settleSpacer(scroller);
    scroller.addEventListener('scroll', state.onScroll, { passive: true });
  } else if (state.extra <= 0) {
    if (state.onScroll) scroller.removeEventListener('scroll', state.onScroll);
    spacers.delete(scroller);
  }
}

/** Mantiene el borde superior de `node` quieto en pantalla mientras se pliega. */
function holdTop(node: HTMLElement | null, duration: number) {
  if (!node || !node.isConnected) return () => {};
  const scroller = findScroller(node);
  const top0 = node.getBoundingClientRect().top;
  addSpacer(scroller, node.getBoundingClientRect().height);
  let frame = 0;
  let done = false;
  const end = performance.now() + duration + 60;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    settleSpacer(scroller);
  };
  const tick = () => {
    if (node.isConnected) {
      const drift = node.getBoundingClientRect().top - top0;
      if (Math.abs(drift) > 0.5) scroller.scrollTop += drift;
    }
    if (performance.now() < end) frame = requestAnimationFrame(tick);
    else finish();
  };
  tick();
  return finish;
}

export function revealInline(node: HTMLElement | null, reduced: boolean) {
  if (!node || !node.isConnected) return;
  const scroller = findScroller(node);
  const box = node.getBoundingClientRect();
  const view = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  const tall = box.height > view.bottom - view.top;
  node.scrollIntoView({ block: tall ? 'start' : 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}

export type InlineCollapseProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Espacio del contenedor padre (flex/grid gap), p. ej. 'var(--g-s-4)'. */
  gap?: string;
  /** Llevar hasta el panel al abrir si queda fuera de vista (default true). */
  reveal?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /** Rol/nombre accesible de la región. */
  label?: string;
};

export function InlineCollapse({ open, children, className, id, gap, reveal = true, returnFocus, onClosed, label }: InlineCollapseProps) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const ref = useRef<HTMLDivElement | null>(null);
  const first = useRef(true);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const node = ref.current;
    const duration = reduced ? 0 : COLLAPSE_MS;
    if (open) {
      setMounted(true);
      let raf1 = 0;
      let raf2 = 0;
      if (reduced) setExpanded(true);
      // Dos frames: el primero pinta el panel en 0fr, el segundo lo abre.
      else raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setExpanded(true)); });
      const timer = window.setTimeout(() => { if (reveal) revealInline(ref.current, reduced); }, duration + 30);
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); window.clearTimeout(timer); };
    }
    if (node && document.activeElement && node.contains(document.activeElement)) returnFocus?.current?.focus({ preventScroll: true });
    const release = holdTop(node, duration);
    setExpanded(false);
    const timer = window.setTimeout(() => { setMounted(false); closedRef.current?.(); }, duration + 20);
    return () => { window.clearTimeout(timer); release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted && !open) return null;
  const style = gap ? ({ '--ic-gap': gap } as CSSProperties) : undefined;
  return (
    <div
      ref={ref}
      id={id}
      className={`ic${expanded ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      inert={!expanded || undefined}
      role={label ? 'region' : undefined}
      aria-label={label}
    >
      <div className="ic-inner">{children}</div>
    </div>
  );
}

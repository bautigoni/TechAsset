import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { appScroller } from '../../utils/scroll';
import '../../styles/screens/smooth-collapse.css';

/**
 * Abrir y cerrar en línea con transición suave de alto (REGLAS-UX, "Agregado
 * del dueño: abrir y cerrar secciones"). Helper local de la etapa 7c hasta que
 * `src/ui` traiga el compartido: misma API mínima, fácil de reemplazar.
 *
 * - Alto con `grid-template-rows: 0fr ↔ 1fr` (~180 ms, `--g-ease`); el hijo
 *   lleva `min-height: 0; overflow: hidden`. Con reduced motion es instantáneo.
 * - Al cerrar, el contenido se pliega hacia su encabezado y el encabezado NO se
 *   mueve: antes de achicar se reserva el alto que se pierde con un espaciador al
 *   final del área que scrollea (`.shell-scroll`), así el navegador no recorta el
 *   scroll; el espaciador se libera solo cuando subís (nunca empuja nada a la vista).
 *   Si igual el ancla (`anchorRef`) se corrió, se compensa `scrollTop` en el frame.
 * - Al abrir, si lo nuevo queda fuera de vista, `scrollIntoView` nearest (suave).
 * - Mientras cierra, el contenido es `inert` (no se enfoca ni se toca).
 */
export type SmoothCollapseProps = {
  open: boolean;
  children: ReactNode;
  /** Encabezado o disparador que no se tiene que mover al cerrar. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Llevar a la vista lo que se abrió (default true). */
  reveal?: boolean;
  className?: string;
  id?: string;
};

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const SPACER = 'sc-spacer';
const trimmers = new WeakMap<HTMLElement, () => void>();

function spacerOf(scroller: HTMLElement) {
  let spacer = scroller.querySelector<HTMLElement>(`:scope > .${SPACER}`);
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = SPACER;
    spacer.setAttribute('aria-hidden', 'true');
    scroller.appendChild(spacer);
  }
  if (!trimmers.has(scroller)) {
    const trim = () => trimSpace(scroller);
    trimmers.set(scroller, trim);
    scroller.addEventListener('scroll', trim, { passive: true });
  }
  return spacer;
}

/** Deja del espaciador solo lo que hace falta para no recortar el scroll actual. */
function trimSpace(scroller: HTMLElement) {
  const spacer = scroller.querySelector<HTMLElement>(`:scope > .${SPACER}`);
  const current = spacer ? parseFloat(spacer.style.height) || 0 : 0;
  if (!spacer || !current) return;
  const content = scroller.scrollHeight - current;
  const need = Math.max(0, Math.ceil(scroller.scrollTop + scroller.clientHeight - content));
  if (need < current) spacer.style.height = `${need}px`;
}

function reserveSpace(scroller: HTMLElement, px: number) {
  const spacer = spacerOf(scroller);
  spacer.style.height = `${(parseFloat(spacer.style.height) || 0) + px}px`;
}

export function SmoothCollapse({ open, children, anchorRef, reveal = true, className, id }: SmoothCollapseProps) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [settled, setSettled] = useState(open);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastChildren = useRef(children);
  if (open) lastChildren.current = children;
  const anchorTop = useRef<number | null>(null);
  const firstRun = useRef(true);
  const fallback = useRef<number | undefined>(undefined);

  const finishClose = () => {
    window.clearTimeout(fallback.current);
    setMounted(false);
    const scroller = appScroller();
    const anchor = anchorRef?.current;
    if (scroller && anchor && anchorTop.current !== null) {
      const delta = anchor.getBoundingClientRect().top - anchorTop.current;
      if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    }
    anchorTop.current = null;
    if (scroller) window.requestAnimationFrame(() => trimSpace(scroller));
  };

  const finishOpen = () => {
    window.clearTimeout(fallback.current);
    setSettled(true);
    const root = rootRef.current;
    if (!reveal || !root) return;
    const scroller = appScroller();
    if (!scroller || !scroller.contains(root)) return;
    const box = root.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.bottom > view.bottom || box.top < view.top) {
      root.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };

  useLayoutEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    window.clearTimeout(fallback.current);
    if (open) {
      setMounted(true);
      setSettled(false);
      if (reducedMotion()) { setExpanded(true); window.requestAnimationFrame(finishOpen); return; }
      // Dos frames: el primero pinta en 0fr, el segundo dispara la transición.
      let second = 0;
      const first = window.requestAnimationFrame(() => { second = window.requestAnimationFrame(() => setExpanded(true)); });
      fallback.current = window.setTimeout(finishOpen, 450);
      return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); };
    }
    const root = rootRef.current;
    const scroller = appScroller();
    if (root && scroller && scroller.contains(root)) reserveSpace(scroller, root.offsetHeight);
    anchorTop.current = anchorRef?.current ? anchorRef.current.getBoundingClientRect().top : null;
    setSettled(false);
    setExpanded(false);
    if (reducedMotion() || !root) { finishClose(); return; }
    fallback.current = window.setTimeout(finishClose, 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => window.clearTimeout(fallback.current), []);

  if (!open && !mounted) return null;
  return (
    <div
      ref={rootRef}
      id={id}
      className={['sc-collapse', expanded && 'is-open', settled && expanded && 'is-settled', className].filter(Boolean).join(' ')}
      inert={!open || undefined}
      onTransitionEnd={event => {
        if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-rows') return;
        if (open) finishOpen();
        else finishClose();
      }}
    >
      <div className="sc-collapse-inner">{open ? children : lastChildren.current}</div>
    </div>
  );
}

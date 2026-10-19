import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './collapse.css';
import { appScroller } from '../../utils/scroll';

const DURATION = 220;

/* Espaciador al pie del área de contenido: al cerrar algo cerca del final, el
   documento se acorta y el navegador recortaría el scroll (la página "salta"
   y el encabezado tocado baja). Se suma ese alto como padding inferior del
   área que scrollea y se va liberando solo a medida que deja de hacer falta
   (cuando la persona sube), así nada se mueve de golpe. */
let spacer = 0;
let basePadding: number | null = null;
let trimming: HTMLElement | null = null;
function setSpacer(scroller: HTMLElement, px: number) {
  if (basePadding === null) basePadding = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
  spacer = Math.max(0, Math.round(px));
  if (spacer) scroller.style.paddingBottom = `${basePadding + spacer}px`;
  else { scroller.style.paddingBottom = ''; basePadding = null; }
}
function trimSpacer() {
  const scroller = trimming;
  if (!scroller) return;
  const content = scroller.scrollHeight - spacer;
  const need = scroller.scrollTop + scroller.clientHeight - content;
  setSpacer(scroller, Math.min(spacer, Math.max(0, need)));
  if (!spacer) { scroller.removeEventListener('scroll', trimSpacer); trimming = null; }
}
function holdSpacer(scroller: HTMLElement, extra: number) {
  setSpacer(scroller, spacer + extra);
  if (trimming !== scroller) {
    trimming?.removeEventListener('scroll', trimSpacer);
    trimming = scroller;
    scroller.addEventListener('scroll', trimSpacer, { passive: true });
  }
}
const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Colapso en línea con transición suave de alto (REGLAS-UX, "abrir y cerrar
 * secciones"). Helper local de la etapa 7b hasta que `src/ui` traiga el
 * compartido: misma API mínima para reemplazarlo sin tocar las llamadas.
 *
 * - Se abre creciendo hacia abajo (`grid-template-rows: 0fr → 1fr`) y, si lo
 *   nuevo queda fuera de vista, se lo trae con scrollIntoView nearest.
 * - Se cierra plegándose hacia su encabezado. Mientras se pliega, el borde de
 *   arriba del bloque queda en el mismo lugar de la pantalla: se compensa el
 *   scroll del área de contenido (`.shell-scroll`) cuadro a cuadro, así el
 *   encabezado que se tocó no se mueve.
 * - Con `prefers-reduced-motion: reduce` todo es instantáneo.
 * - Cerrado, el contenido se desmonta (salvo `keepMounted`).
 */
export function Collapse({ open, children, className, keepMounted = false, reveal = true, id }: {
  open: boolean;
  children: ReactNode;
  className?: string;
  keepMounted?: boolean;
  /** Al abrir, traerlo a la vista si quedó afuera (default true). */
  reveal?: boolean;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [settled, setSettled] = useState(open);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const reduced = reducedMotion();
    if (open) {
      setMounted(true);
      setSettled(false);
      if (reduced) { setExpanded(true); setSettled(true); return; }
      // Un cuadro cerrado y después abierto, para que la transición arranque de 0.
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      const done = window.setTimeout(() => setSettled(true), DURATION + 40);
      return () => { cancelAnimationFrame(frame); window.clearTimeout(done); };
    }
    setSettled(false);
    setExpanded(false);
    const el = ref.current;
    const scroller = appScroller();
    // Lo que está justo arriba del bloque (su encabezado) es lo que no se mueve.
    const anchorEl = el?.previousElementSibling || el?.parentElement || el;
    if (reduced) {
      if (el && scroller) { holdSpacer(scroller, el.offsetHeight + 48); requestAnimationFrame(trimSpacer); }
      if (!keepMounted) setMounted(false);
      return;
    }
    let raf = 0;
    if (el && scroller) {
      const anchorNode = anchorEl || el;
      const anchor = anchorNode.getBoundingClientRect().top;
      // + margen: el bloque cerrado también se come su gap (--cmx-gap); lo que sobre se recorta solo.
      holdSpacer(scroller, el.offsetHeight + 48);
      const started = performance.now();
      const hold = () => {
        const drift = anchorNode.getBoundingClientRect().top - anchor;
        if (Math.abs(drift) > 0.5) scroller.scrollTop += drift;
        if (performance.now() - started < DURATION + 60) raf = requestAnimationFrame(hold);
        else trimSpacer();
      };
      raf = requestAnimationFrame(hold);
    }
    const done = window.setTimeout(() => { if (!keepMounted) setMounted(false); }, DURATION + 40);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(done); };
  }, [open, keepMounted]);

  // Abierto y asentado: si quedó fuera de vista, se lo trae (sin mover nada si ya se ve).
  useEffect(() => {
    if (!open || !settled || !reveal || first.current) return;
    const el = ref.current;
    const scroller = appScroller();
    if (!el || !scroller) return;
    const box = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.bottom > view.bottom || box.top < view.top) el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [open, settled, reveal]);

  // Al salir de la vista, el espaciador se recalcula contra lo que quede (y se va si no hace falta).
  useEffect(() => () => { requestAnimationFrame(trimSpacer); }, []);

  if (!mounted && !keepMounted) return null;
  return (
    <div
      ref={ref}
      id={id}
      className={`cmx-collapse${expanded ? ' is-open' : ''}${settled && expanded ? ' is-settled' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      <div className="cmx-collapse-inner">{children}</div>
    </div>
  );
}

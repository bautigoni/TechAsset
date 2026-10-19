import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronDown } from '../../ui/icons';
import { appScroller } from '../../utils/scroll';
import { revealInline } from '../../utils/reveal';
import './softCollapse.css';

/**
 * Colapso suave de alto (docs/redesign/REGLAS-UX.md, "abrir y cerrar
 * secciones"): `grid-template-rows: 0fr ↔ 1fr` con la duración de los tokens;
 * instantáneo con `prefers-reduced-motion`. Helper local de la etapa 6b
 * (Aulas y Recordatorios) hasta que exista el compartido en `src/ui`.
 *
 * - Al abrir crece hacia abajo; si queda fuera de vista se lo trae (nearest).
 * - Al cerrar se pliega hacia arriba y lo de arriba (el encabezado que se
 *   tocó) NO se mueve: se compensa el scroll del área de contenido en cada
 *   frame y un espaciador temporal evita que el navegador recorte el scroll
 *   cuando la página se acorta (se va solo cuando sale de la vista).
 */
export function Collapse({ open, children, className, appear = true, reveal = true, onClosed, id }: {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Si arranca abierto, anima la entrada (default true). */
  appear?: boolean;
  /** Llevar hasta lo abierto si quedó fuera de vista (default true). */
  reveal?: boolean;
  onClosed?: () => void;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open && !appear);
  const [settled, setSettled] = useState(open && !appear);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const first = useRef(true);

  useLayoutEffect(() => {
    const wasFirst = first.current;
    first.current = false;
    if (open) {
      setMounted(true);
      if (wasFirst && !appear) return;
      const frame = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(frame);
    }
    if (wasFirst) return;
    if (ref.current) holdPosition(ref.current);
    setSettled(false);
    setExpanded(false);
    return undefined;
  }, [open, appear]);

  // Fin de la transición (o enseguida si no hay transición).
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const closing = wasExpanded.current && !expanded;
    wasExpanded.current = expanded;
    if (!expanded && !closing) return;
    const duration = transitionMs(el);
    const done = () => {
      if (expanded) {
        setSettled(true);
        if (reveal) revealInline(el);
      } else if (!open) {
        setMounted(false);
        closedRef.current?.();
      }
    };
    if (!duration) { done(); return; }
    const timer = window.setTimeout(done, duration + 40);
    return () => window.clearTimeout(timer);
  }, [expanded, open, reveal]);

  return (
    <div
      ref={ref}
      id={id}
      className={['ta-collapse', expanded && 'is-open', settled && expanded && 'is-settled', className].filter(Boolean).join(' ')}
      aria-hidden={!expanded || undefined}
      // Plegado: nada adentro recibe foco ni clicks.
      inert={!open || undefined}
    >
      <div className="ta-collapse-inner">{mounted ? children : null}</div>
    </div>
  );
}

/**
 * Sección que se expande (mismo aspecto que `Disclosure` de src/ui) pero con
 * el colapso suave y el encabezado quieto.
 */
export function Expander({ title, summary, defaultOpen = false, children, variant = 'plain', className, onOpenChange }: {
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  variant?: 'plain' | 'card';
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className={['ui-disclosure', `ui-disclosure--${variant}`, open && 'is-open', className].filter(Boolean).join(' ')}>
      <div className="ui-disclosure-head">
        <button type="button" className="ui-disclosure-btn" aria-expanded={open} aria-controls={contentId} onClick={() => { setOpen(!open); onOpenChange?.(!open); }}>
          <span className="ui-disclosure-chevron" aria-hidden="true"><IconChevronDown size={16} /></span>
          <span className="ui-disclosure-title">{title}</span>
          {summary !== undefined && <span className="ui-disclosure-summary">{summary}</span>}
        </button>
      </div>
      <Collapse open={open} appear={false} id={contentId}>
        <div className="ui-disclosure-body">{children}</div>
      </Collapse>
    </section>
  );
}

function transitionMs(el: HTMLElement) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const value = getComputedStyle(el).transitionDuration.split(',')[0] || '0s';
  const n = parseFloat(value);
  return Number.isFinite(n) ? (value.endsWith('ms') ? n : n * 1000) : 0;
}

/**
 * Mantiene `el` quieto en la pantalla mientras lo de abajo se achica: corrige
 * el scroll del área de contenido en cada frame y deja un espaciador al final
 * para que el recorte del scroll no lo arrastre.
 */
export function holdPosition(el: HTMLElement, ms = 360) {
  const scroller = appScroller();
  if (!scroller) return;
  const startTop = el.getBoundingClientRect().top;
  const spacer = document.createElement('div');
  spacer.className = 'ta-hold-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.height = `${Math.ceil(el.getBoundingClientRect().height)}px`;
  scroller.appendChild(spacer);
  const t0 = performance.now();
  const tick = () => {
    if (el.isConnected) {
      const delta = el.getBoundingClientRect().top - startTop;
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
    }
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else release();
  };
  const release = () => {
    const tryRemove = () => {
      if (!spacer.isConnected) return;
      if (spacer.getBoundingClientRect().top >= scroller.getBoundingClientRect().bottom - 1) {
        spacer.remove();
        scroller.removeEventListener('scroll', tryRemove);
      }
    };
    tryRemove();
    if (spacer.isConnected) scroller.addEventListener('scroll', tryRemove, { passive: true });
  };
  requestAnimationFrame(tick);
}

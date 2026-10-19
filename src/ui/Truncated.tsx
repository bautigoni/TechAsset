import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './util';

/* Un solo ResizeObserver para todos los textos truncados de la página: en una
   lista de 300 filas no hay 300 observers ni lecturas de layout por render. */
const callbacks = new Map<Element, () => void>();
let sharedObserver: ResizeObserver | null = null;
function observe(element: Element, callback: () => void) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  sharedObserver ??= new ResizeObserver(entries => {
    for (const entry of entries) callbacks.get(entry.target)?.();
  });
  callbacks.set(element, callback);
  sharedObserver.observe(element);
  return () => {
    callbacks.delete(element);
    sharedObserver?.unobserve(element);
  };
}

/**
 * Tooltip: la ÚNICA capa flotante permitida, y solo para mostrar completo un
 * texto que está cortado. Sin flecha, con --g-shadow-tooltip, posicionado
 * debajo (o arriba si no entra) sin salirse nunca del viewport.
 */
export function Tooltip({ anchor, open, children, id }: { anchor: HTMLElement | null; open: boolean; children: ReactNode; id?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    // Dos lecturas (ancla y tooltip) y una escritura: sin alternar.
    const a = anchor.getBoundingClientRect();
    const t = ref.current.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const left = Math.min(Math.max(margin, a.left), Math.max(margin, vw - t.width - margin));
    const below = a.bottom + gap;
    const top = below + t.height <= vh - margin ? below : Math.max(margin, a.top - gap - t.height);
    setStyle({ transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)` });
  }, [open, anchor, children]);

  useEffect(() => { if (!open) setStyle({ visibility: 'hidden' }); }, [open]);

  if (!open || !anchor) return null;
  return createPortal(
    <div ref={ref} id={id} role="tooltip" className="ui-tooltip" style={style}>
      {children}
    </div>,
    document.body
  );
}

export type TruncatedTextProps = {
  /** El texto completo. */
  children: string;
  as?: 'span' | 'div' | 'p' | 'strong' | 'b';
  /** Renglones antes de cortar (default 1). */
  lines?: number;
  className?: string;
  /** Contenido del tooltip si no es el mismo texto. */
  tooltip?: ReactNode;
};

/**
 * Texto que se corta con elipsis. Mide si está REALMENTE cortado (con un
 * ResizeObserver compartido) y solo entonces: en hover o foco muestra el
 * tooltip; en touch, tocarlo lo despliega en línea (la fila crece; otro toque
 * lo achica).
 */
export function TruncatedText({ children, as: Tag = 'span', lines = 1, className, tooltip }: TruncatedTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pointerType = useRef('mouse');
  const hoverTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const next = lines > 1 ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
      setCut(current => (current === next ? current : next));
    };
    // El texto pudo cambiar sin que cambie el tamaño: se mide en el próximo frame.
    const raf = requestAnimationFrame(check);
    const stop = observe(el, check);
    return () => { cancelAnimationFrame(raf); stop(); };
  }, [children, lines]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const interactive = cut || expanded;
  const style = lines > 1 && !expanded ? ({ ['--ui-lines' as string]: lines } as CSSProperties) : undefined;

  return (
    <>
      <Tag
        ref={ref as never}
        className={cx('ui-trunc', lines > 1 && 'ui-trunc--lines', expanded && 'is-expanded', interactive && 'is-cut', className)}
        style={style}
        tabIndex={cut && !expanded ? 0 : undefined}
        onPointerDown={event => { pointerType.current = event.pointerType; }}
        onPointerEnter={event => {
          if (!cut || event.pointerType !== 'mouse') return;
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => setOpen(true), 250);
        }}
        onPointerLeave={() => { window.clearTimeout(hoverTimer.current); setOpen(false); }}
        onFocus={() => { if (cut && pointerType.current === 'mouse') setOpen(true); }}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (pointerType.current === 'touch' || pointerType.current === 'pen') {
            if (cut || expanded) { setExpanded(value => !value); setOpen(false); }
          }
        }}
      >
        {children}
      </Tag>
      <Tooltip anchor={ref.current} open={open && cut && !expanded}>{tooltip ?? children}</Tooltip>
    </>
  );
}

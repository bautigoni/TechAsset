import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './util';

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

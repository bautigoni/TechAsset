import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Collapse } from './Collapse';
import { InlineConfirm } from './Inline';
import { IconX } from './icons';
import { useScrollEdges } from './scrollEdges';
import { cx } from './util';
import './dialog.css';

/* ══ Dialog: ventana emergente centrada ══════════════════════════════════

   EXCEPCIÓN documentada a "nada de modales" (CLAUDE.md): hoy solo la usan los
   cartelitos de fotos (pedido del dueño, 20/10). Cualquier otro uso lo decide
   el dueño; lo demás sigue en línea (Collapse, InlineConfirm, líneas de estado).

   - role="dialog" + aria-modal + aria-labelledby (el título) y, si hay,
     aria-describedby.
   - Foco: entra al primer campo (o a `[data-autofocus]`), Tab queda adentro y
     al cerrar vuelve a lo que lo abrió (o a `returnFocus`).
   - Esc, la X y el clic en el fondo cierran. Si hay algo escrito (`dirty`),
     antes de cerrar pregunta EN el diálogo ("¿Descartar lo escrito?").
   - Fondo atenuado sobrio, sin blur ni glow. Entra y sale con opacidad +
     escala 0.98 → 1 (receta `modal` de transitions.dev, 200 ms); con
     `prefers-reduced-motion` es instantáneo.
   - Mientras está abierto la página de atrás no scrollea (rueda y toques se
     frenan fuera del diálogo: sin tocar overflow, así no salta el layout por
     la barra) y queda inerte para el teclado y el lector de pantalla.
   - Mobile: ancho completo con márgenes; el alto sigue al viewport visible
     (con el teclado abierto) y el pie con las acciones queda siempre a la vista.

   Uso:
     <Dialog open={open} title="Entregar cartelito 4" onClose={() => setOpen(false)} dirty={Boolean(form.persona)}
       footer={<><Button variant="primary" onClick={save}>Entregar</Button><Button variant="ghost" onClick={close}>Cancelar</Button></>}>
       …campos…
     </Dialog>
*/

export const DIALOG_MS = 200;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

type Phase = 'closed' | 'opening' | 'open' | 'closing';

export type DialogProps = {
  open: boolean;
  /** Título visible (y nombre accesible del diálogo). */
  title: ReactNode;
  /** Bajada corta debajo del título (aria-describedby). */
  description?: ReactNode;
  /** El usuario pidió cerrar (Esc, X, fondo) y no había nada que perder, o confirmó descartar. */
  onClose: () => void;
  /** Hay datos escritos: cerrar con Esc / X / fondo pide confirmación en el diálogo. */
  dirty?: boolean;
  /** Acciones del pie (siempre a la vista, también con el teclado del celular abierto). */
  footer?: ReactNode;
  /** Adónde vuelve el foco al cerrar (default: lo que tenía el foco al abrir). */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Al terminar de cerrarse (después de la animación). */
  onClosed?: () => void;
  className?: string;
  children: ReactNode;
};

export function Dialog({ open, title, description, onClose, dirty = false, footer, returnFocus, onClosed, className, children }: DialogProps) {
  const [phase, setPhase] = useState<Phase>(open ? 'opening' : 'closed');
  const [asking, setAsking] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  // Abrir / cerrar con su transición.
  if (open && (phase === 'closed' || phase === 'closing')) setPhase('opening');
  if (!open && (phase === 'open' || phase === 'opening')) setPhase('closing');
  if (!open && asking) setAsking(false);

  useLayoutEffect(() => {
    if (phase === 'opening') {
      if (!opener.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (reducedMotion()) { setPhase('open'); return; }
      // Un frame en el estado inicial (opacidad 0, escala 0.98) y después abre.
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase(current => (current === 'opening' ? 'open' : current))));
      return () => cancelAnimationFrame(raf);
    }
    if (phase === 'closing') {
      const done = () => {
        setPhase(current => (current === 'closing' ? 'closed' : current));
      };
      if (reducedMotion()) { done(); return; }
      const timer = window.setTimeout(done, DIALOG_MS + 40);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  const visible = phase !== 'closed';

  // Al terminar de cerrarse: el foco vuelve a quien lo abrió.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible) { wasVisible.current = true; return; }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    const target = returnRef.current?.() || opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    closedRef.current?.();
  }, [visible]);

  // Foco inicial: [data-autofocus], el primer campo o el primer control.
  useEffect(() => {
    if (phase !== 'opening' && phase !== 'open') return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>('[data-autofocus]')
      || panel.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])')
      || panel.querySelector<HTMLElement>(FOCUSABLE);
    (first || panel).focus({ preventScroll: true });
  }, [phase]);

  // La app de atrás: inerte (teclado y lector) y sin scroll mientras está abierto.
  useEffect(() => {
    if (!visible) return;
    const app = document.getElementById('root');
    const hadInert = app?.hasAttribute('inert');
    if (app && !hadInert) app.setAttribute('inert', '');
    const blockScroll = (event: Event) => {
      const panel = panelRef.current;
      const target = event.target instanceof Node ? event.target : null;
      // Adentro del cuerpo del diálogo se scrollea normal (si hace falta).
      if (panel && target && panel.contains(target)) return;
      event.preventDefault();
    };
    document.addEventListener('wheel', blockScroll, { passive: false });
    document.addEventListener('touchmove', blockScroll, { passive: false });
    return () => {
      if (app && !hadInert) app.removeAttribute('inert');
      document.removeEventListener('wheel', blockScroll);
      document.removeEventListener('touchmove', blockScroll);
    };
  }, [visible]);

  // El alto sigue al viewport visible (teclado del celular abierto).
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewport({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, [visible]);

  // "Seguir editando" devuelve el foco al campo donde estaba (mientras pregunta, el formulario queda inerte).
  const beforeAsk = useRef<HTMLElement | null>(null);
  const requestClose = useCallback(() => {
    if (dirty) {
      const active = document.activeElement;
      beforeAsk.current = active instanceof HTMLElement && panelRef.current?.contains(active) ? active : null;
      setAsking(true);
      return;
    }
    closeRef.current();
  }, [dirty]);
  const keepEditing = useCallback(() => {
    setAsking(false);
    const target = beforeAsk.current;
    beforeAsk.current = null;
    // Después de que el formulario deja de estar inerte.
    window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const back = target?.isConnected && !target.closest('[inert]') ? target : panel.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])');
      (back || panel).focus({ preventScroll: true });
    }, 0);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (asking) keepEditing();
      else requestClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert]') && el.getClientRects().length > 0);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cx('ui-dialog-layer', phase === 'open' && 'is-open', phase === 'closing' && 'is-closing')}
      style={viewport ? { top: `${viewport.top}px`, height: `${viewport.height}px`, bottom: 'auto' } : undefined}
      data-scanner-ignore=""
    >
      <div className="ui-dialog-backdrop" aria-hidden="true" onMouseDown={event => { event.preventDefault(); if (phase !== 'closing') requestClose(); }} />
      <div
        ref={panelRef}
        className={cx('ui-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ui-dialog-head">
          <div className="ui-dialog-titles">
            <h2 id={titleId} className="ui-dialog-title">{title}</h2>
            {description && <p id={descId} className="ui-dialog-desc">{description}</p>}
          </div>
          <button type="button" className="ui-dialog-x" aria-label="Cerrar" onClick={requestClose}><IconX size={16} /></button>
        </div>
        <DialogBody inert={asking}>{children}</DialogBody>
        <Collapse open={asking} appear unmountOnClose reveal={false} anchor={false} className="ui-dialog-ask">
          <InlineConfirm
            message="¿Descartar lo escrito?"
            detail="Si cerrás ahora, se pierde lo que completaste."
            confirmLabel="Descartar"
            cancelLabel="Seguir editando"
            danger
            onConfirm={() => { setAsking(false); closeRef.current(); }}
            onCancel={keepEditing}
          />
        </Collapse>
        {footer && <div className="ui-dialog-foot" inert={asking || undefined}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Cuerpo que scrollea por dentro si no entra (sin barra, con degradé en el borde). */
function DialogBody({ inert, children }: { inert: boolean; children: ReactNode }) {
  const ref = useScrollEdges<HTMLDivElement>();
  return <div ref={ref} className="ui-dialog-body ui-scroll-fade" inert={inert || undefined}>{children}</div>;
}

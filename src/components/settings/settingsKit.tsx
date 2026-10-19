import { createContext, useCallback, useId, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Checkbox, Segmented, Select } from '../../ui';
import { IconCheck } from '../../ui/icons';
import { cx, useReducedMotion } from '../../ui/util';
import { ApiError } from '../../services/apiClient';
import { appScroller } from '../../utils/scroll';

/* ═══════════════════════════════════════════════════════════════════════
   Piezas compartidas de Configuración (etapa 8b).
   ═══════════════════════════════════════════════════════════════════════ */

/** Mensaje de error para mostrar en línea: el motivo real del server (incluido el de un 403). */
export function errorText(reason: unknown, fallback: string) {
  if (reason instanceof ApiError) {
    if (reason.status === 403) return reason.message && !/^HTTP 403/.test(reason.message) ? reason.message : 'No tenés permiso para hacer esto.';
    if (reason.status === 429) return reason.message;
    return reason.message || fallback;
  }
  if (reason instanceof Error && reason.message) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(reason.message)) return `${fallback} Revisá la conexión y probá de nuevo.`;
    return reason.message;
  }
  return fallback;
}

/* ── Reserva de scroll: que el encabezado tocado no se mueva al cerrar ─────
   Al plegar algo cerca del final de la página el documento se acorta y el
   navegador recorta el scroll: todo lo de arriba (incluido el encabezado que
   se tocó) bajaría de golpe. Se suma un espacio al final por exactamente lo
   que se iba a recortar, y se libera a medida que la persona sube. */

let reserve = 0;
const reserveListeners = new Set<() => void>();
const emitReserve = () => reserveListeners.forEach(listener => listener());

function scrollerEl(): HTMLElement {
  return appScroller() || (document.scrollingElement as HTMLElement) || document.documentElement;
}

/** Llamar ANTES de achicar algo de `shrinkBy` px. */
export function holdScrollFor(shrinkBy: number) {
  const scroller = scrollerEl();
  const maxAfter = scroller.scrollHeight - shrinkBy - scroller.clientHeight;
  const need = Math.ceil(scroller.scrollTop - maxAfter);
  if (need <= 0) return;
  reserve += need;
  emitReserve();
}

/** Espacio reservado al final de Configuración (se va solo al subir). */
export function ScrollReserve() {
  const value = useSyncExternalStore(
    listener => { reserveListeners.add(listener); return () => { reserveListeners.delete(listener); }; },
    () => reserve
  );
  useEffect(() => {
    if (!value) return;
    const scroller = scrollerEl();
    const target: HTMLElement | Window = scroller === document.documentElement ? window : scroller;
    const onScroll = () => {
      const base = scroller.scrollHeight - reserve;
      const needed = Math.max(0, Math.ceil(scroller.scrollTop + scroller.clientHeight - base));
      if (needed < reserve) { reserve = needed; emitReserve(); }
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [value]);
  useEffect(() => () => { reserve = 0; }, []);
  return <div aria-hidden="true" className="cfg-reserve" style={{ height: value }} />;
}

/**
 * Si `el` quedó (parcialmente) debajo del borde visible, lo acerca; nunca
 * tanto que su encabezado (el elemento anterior, el que se tocó) se vaya por
 * arriba.
 */
export function revealBelow(el: HTMLElement | null, reduced: boolean) {
  if (!el) return;
  const scroller = scrollerEl();
  const view = scroller === document.documentElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const overflow = rect.bottom - view.bottom + 16;
  if (overflow <= 0) return;
  const anchor = (el.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().top ?? rect.top - 48;
  const room = anchor - view.top - 12;
  const delta = Math.max(0, Math.min(overflow, room));
  if (delta > 0) scroller.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
}

/* ── Collapse: abre y cierra con transición de alto ─────────────────────────
   Contenedor `grid-template-rows: 0fr ↔ 1fr` (~200 ms, var(--g-ease)); el hijo
   con `min-height: 0; overflow: hidden`. Se pliega hacia su encabezado, el
   encabezado no se mueve (holdScrollFor) y al abrir, si lo nuevo quedó fuera
   de vista, se lo acerca. Con prefers-reduced-motion es instantáneo. Mientras
   cierra conserva el último contenido; cerrado no queda en el DOM. */

const DURATION = 200;

export function Collapse({ open, children, className, id, label, onClosed }: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Nombre accesible de la región (si corresponde). */
  label?: string;
  onClosed?: () => void;
}) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const lastChildren = useRef<ReactNode>(children);
  if (open) lastChildren.current = children;
  const firstRun = useRef(true);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  useLayoutEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    let raf = 0;
    let timer = 0;
    if (open) {
      setMounted(true);
      if (reduced) {
        setExpanded(true);
        raf = requestAnimationFrame(() => revealBelow(outerRef.current, true));
      } else {
        // Un cuadro en 0fr y recién ahí 1fr: así la transición arranca.
        raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setExpanded(true)); });
        timer = window.setTimeout(() => revealBelow(outerRef.current, false), DURATION + 40);
      }
    } else {
      const inner = outerRef.current?.firstElementChild as HTMLElement | null;
      if (inner) holdScrollFor(inner.getBoundingClientRect().height);
      setExpanded(false);
      if (reduced) { setMounted(false); closedRef.current?.(); }
      else timer = window.setTimeout(() => { setMounted(false); closedRef.current?.(); }, DURATION + 20);
    }
    return () => { cancelAnimationFrame(raf); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted && !open) return null;
  return (
    <div
      ref={outerRef}
      id={id}
      role={label ? 'region' : undefined}
      aria-label={label}
      className={cx('cfg-collapse', expanded && 'is-open', className)}
      data-scanner-ignore=""
    >
      <div className="cfg-collapse-inner" inert={!open || undefined}>{open ? children : lastChildren.current}</div>
    </div>
  );
}

/* ── Card, filas de ajuste y pie con estado ───────────────────────────────── */

export function Card({ title, meta, actions, children, className, labelledBy, ariaLabel }: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  ariaLabel?: string;
}) {
  const headId = `cfg-h${useId().replace(/:/g, '')}`;
  return (
    <section className={cx('cfg-card', className)} aria-labelledby={title ? labelledBy || headId : undefined} aria-label={title ? undefined : ariaLabel}>
      {(title || meta || actions) && (
        <div className="cfg-card-h">
          {title && <h3 id={labelledBy || headId} className="cfg-card-t">{title}</h3>}
          {meta && <span className="cfg-card-meta">{meta}</span>}
          {actions && <div className="cfg-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('cfg-card-b', className)}>{children}</div>;
}

/** Pie de card: estado a la izquierda (aria-live), acciones a la derecha. */
export function CardFoot({ status, tone, children }: { status?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'muted'; children?: ReactNode }) {
  return (
    <div className="cfg-card-f">
      <div className={cx('cfg-card-fs', tone && `is-${tone}`)} aria-live="polite">
        {tone === 'ok' && status ? <IconCheck size={14} /> : null}
        {status}
      </div>
      {children && <div className="cfg-card-fa">{children}</div>}
    </div>
  );
}

/** Fila de ajuste: nombre y descripción a la izquierda, control a la derecha (bajan en angosto). */
export function SettingRow({ name, desc, children, nameId }: { name: ReactNode; desc?: ReactNode; children?: ReactNode; nameId?: string }) {
  return (
    <div className="cfg-row">
      <div className="cfg-row-t">
        <div className="cfg-row-n" id={nameId}>{name}</div>
        {desc && <div className="cfg-row-d">{desc}</div>}
      </div>
      {children !== undefined && <div className="cfg-row-c">{children}</div>}
    </div>
  );
}

/** Aviso fijo de un bloque (no flota): una línea con borde arriba. */
export function Notice({ tone, children, role }: { tone?: 'warn' | 'bad' | 'ok' | 'info'; children: ReactNode; role?: 'status' | 'alert' }) {
  return <div className={cx('cfg-notice', tone && `is-${tone}`)} role={role}>{children}</div>;
}

/* ── Copiar al portapapeles con respuesta en el mismo botón ─────────────── */

export function CopyButton({ text, label = 'Copiar link', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('sin portapapeles');
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('error');
    }
  };
  return (
    <span className="cfg-copy">
      <Button size={size} variant="secondary" icon={state === 'ok' ? <IconCheck size={14} /> : undefined} onClick={() => void copy()}>
        {state === 'ok' ? 'Copiado' : label}
      </Button>
      {state === 'error' && <span className="cfg-copy-err" role="alert">No se pudo copiar: seleccioná el link y copialo a mano.</span>}
    </span>
  );
}

/* ── Cambios sin guardar ──────────────────────────────────────────────────
   Cada panel avisa si tiene cambios; la página pide confirmar en línea antes
   de cambiar de panel y el navegador avisa antes de recargar o cerrar. Si
   igual se sale de Configuración (menú), el borrador queda guardado en memoria
   y se recupera al volver. */

type DirtyApi = { setDirty: (key: string, dirty: boolean) => void };
export const DirtyContext = createContext<DirtyApi>({ setDirty: () => undefined });

export function useDirty(key: string, dirty: boolean) {
  const { setDirty } = useContext(DirtyContext);
  useEffect(() => { setDirty(key, dirty); }, [key, dirty, setDirty]);
  useEffect(() => () => setDirty(key, false), [key, setDirty]);
}

const drafts = new Map<string, unknown>();

/** Borrador que quedó de una visita anterior (usar en el inicializador del estado). */
export function peekDraft<T>(key: string): T | null {
  return drafts.has(key) ? drafts.get(key) as T : null;
}

export function dropDraft(key: string) {
  drafts.delete(key);
}

/**
 * Al desmontar (cambiar de sección, ir a otra pantalla), si hay cambios sin
 * guardar quedan en memoria por sede y sección; si no, se borra lo que hubiera.
 */
export function useKeepDraft<T>(key: string, value: T, dirty: boolean) {
  const valueRef = useRef(value);
  const dirtyRef = useRef(dirty);
  valueRef.current = value;
  dirtyRef.current = dirty;
  useEffect(() => () => {
    if (dirtyRef.current) drafts.set(key, valueRef.current);
    else drafts.delete(key);
  }, [key]);
}

/**
 * Casilla con nombre y descripción largos: la casilla es el control y el texto
 * va en un <label> aparte (así el texto puede ocupar dos líneas sin que el
 * botón "se parta"; tocar el texto también marca).
 */
export function CheckField({ checked, onChange, label, description, disabled, className }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = `cfg-ck${useId().replace(/:/g, '')}`;
  return (
    <div className={cx('cfg-checkf', disabled && 'is-disabled', className)}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={next => onChange(next)} />
      <label htmlFor={id} className="cfg-checkf-t">
        <span className="cfg-checkf-l">{label}</span>
        {description && <span className="cfg-checkf-d">{description}</span>}
      </label>
    </div>
  );
}

/**
 * Elegir uno entre pocos (rol, turno, estado): segmentado que envuelve si son
 * pocos y cortos; con muchos o largos, el Select propio (lista en línea).
 */
export function ChoiceField({ label, value, options, onChange, disabled, hint }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const compact = options.length <= 5 && options.every(option => option.label.length <= 22);
  return (
    <div className="cfg-choice">
      {compact
        ? <Segmented label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
        : <Select label={label} value={value} options={options} onChange={onChange} disabled={disabled} />}
      {hint && <span className="cfg-hint">{hint}</span>}
    </div>
  );
}

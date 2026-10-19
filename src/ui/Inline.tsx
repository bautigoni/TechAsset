import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { Input } from './Field';
import { Select } from './Select';
import { IconAlert, IconCheck, IconChevronDown, IconInfo, IconRetry, IconUndo, IconWarn, IconWifiOff, IconX } from './icons';
import { cx } from './util';

/* ══ Disclosure: sección que se expande en el lugar (reemplaza <details>) ══ */

export type DisclosureProps = {
  title: ReactNode;
  /** Resumen a la derecha del título (contador, estado). */
  summary?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  /** 'card' = con borde y fondo de superficie; 'plain' = solo la fila. */
  variant?: 'card' | 'plain';
  className?: string;
  /** Acciones a la derecha del encabezado (no abren/cierran). */
  actions?: ReactNode;
};

export function Disclosure({ title, summary, open: openProp, defaultOpen = false, onOpenChange, children, variant = 'card', className, actions }: DisclosureProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const contentId = useId();
  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return (
    <section className={cx('ui-disclosure', `ui-disclosure--${variant}`, open && 'is-open', className)}>
      <div className="ui-disclosure-head">
        <button type="button" className="ui-disclosure-btn" aria-expanded={open} aria-controls={contentId} onClick={toggle}>
          <span className="ui-disclosure-chevron" aria-hidden="true"><IconChevronDown size={16} /></span>
          <span className="ui-disclosure-title">{title}</span>
          {summary !== undefined && <span className="ui-disclosure-summary">{summary}</span>}
        </button>
        {actions && <div className="ui-disclosure-actions">{actions}</div>}
      </div>
      {open && <div id={contentId} className="ui-disclosure-body ui-enter">{children}</div>}
    </section>
  );
}

/* ══ InlineConfirm: "¿Borrar 3 equipos? Confirmar / Cancelar" en el lugar ══ */

export type InlineConfirmProps = {
  message: ReactNode;
  /** Detalle chico debajo (qué etiquetas, qué pasa después). */
  detail?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
};

export function InlineConfirm({ message, detail, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, busy, onConfirm, onCancel, className }: InlineConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // En las destructivas el foco arranca en Cancelar: un Enter de más no borra.
  useEffect(() => { (danger ? cancelRef : confirmRef).current?.focus({ preventScroll: true }); }, [danger]);
  return (
    <div
      className={cx('ui-confirm', danger && 'ui-confirm--danger', 'ui-enter', className)}
      role="group"
      aria-label={typeof message === 'string' ? message : 'Confirmación'}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}
    >
      <div className="ui-confirm-text">
        <span className="ui-confirm-msg">{message}</span>
        {detail && <span className="ui-confirm-detail">{detail}</span>}
      </div>
      <div className="ui-confirm-actions">
        <Button ref={confirmRef} size="sm" variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        <Button ref={cancelRef} size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </div>
  );
}

type ConfirmAsk = Omit<InlineConfirmProps, 'onConfirm' | 'onCancel' | 'busy'>;

/**
 * Reemplazo directo de `await confirmDialog({...})` sin modal:
 *
 *   const confirm = useInlineConfirm();
 *   if (!(await confirm.ask({ message: '¿Borrar 3 equipos?', danger: true, confirmLabel: 'Borrar' }))) return;
 *   …
 *   {confirm.element}   ← donde tiene que aparecer (la barra de selección, debajo de la fila)
 *
 * Mapeo de opciones: title → message, message → detail; el resto igual.
 */
export function useInlineConfirm() {
  const [request, setRequest] = useState<(ConfirmAsk & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback((options: ConfirmAsk) => new Promise<boolean>(resolve => {
    setRequest(current => { current?.resolve(false); return { ...options, resolve }; });
  }), []);
  const settle = (ok: boolean) => { request?.resolve(ok); setRequest(null); };
  const element = request ? <InlineConfirm {...request} onConfirm={() => settle(true)} onCancel={() => settle(false)} /> : null;
  return { ask, element, pending: Boolean(request), cancel: () => settle(false) };
}

/* ══ InlinePrompt: pedir un dato en línea (reemplaza promptDialog) ══ */

type PromptAsk = {
  message: ReactNode;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  required?: boolean;
  /** Si viene, se elige de esta lista (Select en línea). */
  options?: string[];
};

export function InlinePrompt({ message, label, initial = '', placeholder, confirmLabel = 'Aceptar', required = true, options, onSubmit, onCancel }: PromptAsk & { onSubmit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial || options?.[0] || '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (required && !value.trim()) return;
    onSubmit(value);
  };
  return (
    <form className="ui-confirm ui-prompt ui-enter" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
      <span className="ui-confirm-msg">{message}</span>
      <div className="ui-prompt-row">
        {options
          ? <Select label={label} value={value} onChange={setValue} options={options.map(option => ({ value: option, label: option }))} className="ui-prompt-field" />
          : <Input label={label} value={value} placeholder={placeholder} autoFocus onValueChange={setValue} className="ui-prompt-field" />}
        <div className="ui-confirm-actions">
          <Button size="sm" variant="primary" type="submit" disabled={required && !value.trim()}>{confirmLabel}</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        </div>
      </div>
    </form>
  );
}

/** `const prompt = useInlinePrompt(); const v = await prompt.ask({...}); {prompt.element}` */
export function useInlinePrompt() {
  const [request, setRequest] = useState<(PromptAsk & { resolve: (value: string | null) => void }) | null>(null);
  const ask = useCallback((options: PromptAsk) => new Promise<string | null>(resolve => {
    setRequest(current => { current?.resolve(null); return { ...options, resolve }; });
  }), []);
  const settle = (value: string | null) => { request?.resolve(value); setRequest(null); };
  const element = request ? <InlinePrompt {...request} onSubmit={value => settle(value)} onCancel={() => settle(null)} /> : null;
  return { ask, element, pending: Boolean(request) };
}

/* ══ StatusLine: línea de estado en el lugar (reemplaza los toasts) ══ */

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'offline';

export type StatusLineProps = {
  tone?: StatusTone;
  message: ReactNode;
  /** Deshacer con cuenta regresiva; al llegar a 0 se llama onExpire (si hay) y la línea se va. */
  undo?: { onUndo: () => void | Promise<unknown>; seconds?: number; label?: string };
  retry?: { onRetry: () => void | Promise<unknown>; label?: string };
  /** Otra acción (p. ej. "Ver en la lista"). */
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  /** Se va sola a los N ms (default: ok/info 8000; warn/bad/offline quedan). 0 = nunca. */
  autoHideMs?: number;
  className?: string;
};

const TONE_ICON: Record<StatusTone, ReactNode> = {
  ok: <IconCheck size={14} />,
  warn: <IconWarn size={14} />,
  bad: <IconAlert size={14} />,
  info: <IconInfo size={14} />,
  offline: <IconWifiOff size={14} />
};

export function StatusLine({ tone = 'info', message, undo, retry, action, onDismiss, autoHideMs, className }: StatusLineProps) {
  const total = undo ? undo.seconds ?? 8 : 0;
  const [left, setLeft] = useState(total);
  const [busy, setBusy] = useState<'undo' | 'retry' | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const hasUndo = Boolean(undo);
  // La cuenta arranca al montar (o al aparecer el Deshacer): un objeto `undo`
  // nuevo en cada render del padre no la reinicia.
  useEffect(() => {
    if (!hasUndo) return;
    setLeft(total);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, total - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining <= 0) { window.clearInterval(timer); dismissRef.current?.(); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [hasUndo, total]);

  const hideAfter = autoHideMs ?? (!undo && (tone === 'ok' || tone === 'info') ? 8000 : 0);
  useEffect(() => {
    if (!hideAfter) return;
    const timer = window.setTimeout(() => dismissRef.current?.(), hideAfter);
    return () => window.clearTimeout(timer);
  }, [hideAfter]);

  const run = async (kind: 'undo' | 'retry', fn: () => void | Promise<unknown>) => {
    setBusy(kind);
    try { await fn(); } finally { setBusy(null); }
  };

  const alert = tone === 'bad' || tone === 'warn';
  return (
    <div className={cx('ui-status', `ui-status--${tone}`, 'ui-enter', className)} role={alert ? 'alert' : 'status'}>
      <span className="ui-status-icon" aria-hidden="true">{TONE_ICON[tone]}</span>
      <span className="ui-status-msg">{message}</span>
      <span className="ui-status-actions">
        {undo && (
          <>
            <Button size="sm" variant="ghost" className="ui-status-undo" icon={<IconUndo size={14} />} loading={busy === 'undo'} onClick={() => run('undo', undo.onUndo)}>
              {undo.label || 'Deshacer'}
            </Button>
            <span className="ui-status-count g-num" aria-label={`${left} segundos para deshacer`}>{left} s</span>
          </>
        )}
        {retry && (
          <Button size="sm" variant="secondary" icon={<IconRetry size={14} />} loading={busy === 'retry'} onClick={() => run('retry', retry.onRetry)}>
            {retry.label || 'Reintentar'}
          </Button>
        )}
        {action && <Button size="sm" variant="ghost" onClick={action.onClick}>{action.label}</Button>}
        {onDismiss && !undo && (
          <button type="button" className="ui-icon-btn ui-btn--ghost ui-btn--sm" aria-label="Ocultar aviso" onClick={onDismiss}>
            <IconX size={14} />
          </button>
        )}
      </span>
    </div>
  );
}

export type StatusMessage = Omit<StatusLineProps, 'onDismiss' | 'className'>;

/**
 * Una línea de estado por bloque: `status.show({...})` reemplaza a la
 * anterior; `{status.element}` va debajo de donde pasó la acción.
 */
export function useStatusLine() {
  const [current, setCurrent] = useState<(StatusMessage & { key: number }) | null>(null);
  const counter = useRef(0);
  const clear = useCallback(() => setCurrent(null), []);
  const show = useCallback((message: StatusMessage) => {
    counter.current += 1;
    setCurrent({ ...message, key: counter.current });
  }, []);
  const element = current ? <StatusLine {...current} key={current.key} onDismiss={clear} /> : null;
  return { show, clear, element, current };
}

/* Puente global para migrar `toast(...)` sin tocar cada llamada: el último
   <StatusOutlet/> montado (uno por pantalla, arriba del contenido o debajo de
   la barra de acción) muestra lo que llegue por `pushStatus`. */
type OutletState = { item: (StatusMessage & { key: number }) | null };
let outletState: OutletState = { item: null };
let outletKey = 0;
const outletListeners = new Set<() => void>();
const emitOutlet = () => outletListeners.forEach(listener => listener());

export function pushStatus(message: StatusMessage | string) {
  outletKey += 1;
  outletState = { item: { ...(typeof message === 'string' ? { message } : message), key: outletKey } };
  emitOutlet();
  return outletKey;
}
export function clearStatus(key?: number) {
  if (key !== undefined && outletState.item?.key !== key) return;
  outletState = { item: null };
  emitOutlet();
}

export function StatusOutlet({ className }: { className?: string }) {
  const state = useSyncExternalStore(
    listener => { outletListeners.add(listener); return () => { outletListeners.delete(listener); }; },
    () => outletState
  );
  if (!state.item) return null;
  const { key, ...rest } = state.item;
  return <StatusLine key={key} {...rest} className={className} onDismiss={() => clearStatus(key)} />;
}

/* ══ SelectionHeader: reemplaza el encabezado de la lista mientras hay selección ══ */

export type SelectionHeaderProps = {
  count: number;
  onClear: () => void;
  /** Acciones sobre la selección ("Devolver 3", "Borrar"). */
  actions?: ReactNode;
  /** Confirmación en la misma barra: si viene, reemplaza a las acciones. */
  confirm?: ReactNode;
  /** El encabezado normal, que se ve cuando no hay nada seleccionado. */
  children?: ReactNode;
  /** "equipo"/"equipos" en vez de seleccionado/s. */
  noun?: [string, string];
  className?: string;
};

export function SelectionHeader({ count, onClear, actions, confirm, children, noun, className }: SelectionHeaderProps) {
  if (!count) return <>{children}</>;
  const word = noun ? (count === 1 ? noun[0] : noun[1]) : count === 1 ? 'seleccionado' : 'seleccionados';
  return (
    <div
      className={cx('ui-selhead', 'ui-enter', className)}
      role="region"
      aria-label="Acciones sobre la selección"
      onKeyDown={event => { if (event.key === 'Escape' && !confirm) { event.stopPropagation(); onClear(); } }}
    >
      <span className="ui-selhead-count" aria-live="polite"><b className="g-num">{count}</b> {word}</span>
      {confirm || (
        <div className="ui-selhead-actions">
          {actions}
          <Button size="sm" variant="ghost" onClick={onClear}>Limpiar</Button>
        </div>
      )}
    </div>
  );
}

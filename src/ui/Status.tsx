import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from './Button';
import { IconAlert, IconCheck, IconInfo, IconRetry, IconUndo, IconWarn, IconWifiOff, IconX } from './icons';
import { cx } from './util';

/* Separado de Inline.tsx para que la barra superior (entrada de la app) pueda
   usar la línea de estado sin arrastrar Select ni los campos. */

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
  /** Reemplaza el ícono del tono (p. ej. el tilde animado de prestar/devolver). */
  icon?: ReactNode;
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

export function StatusLine({ tone = 'info', message, undo, retry, action, onDismiss, icon, autoHideMs, className }: StatusLineProps) {
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
      <span className="ui-status-icon" aria-hidden="true">{icon ?? TONE_ICON[tone]}</span>
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

/* `useStatusLine` (una línea por bloque, con alto suave) vive en StatusSlot.tsx:
   usa el colapso compartido y así no entra al bundle de arranque. */

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

const subscribeOutlet = (listener: () => void) => { outletListeners.add(listener); return () => { outletListeners.delete(listener); }; };
const readOutlet = () => outletState;

/** Lo que muestra hoy el puente global (para envolverlo en otra cosa, p. ej. un Collapse). */
export function useStatusOutlet() {
  return useSyncExternalStore(subscribeOutlet, readOutlet).item;
}

export function StatusOutlet({ className }: { className?: string }) {
  const state = useSyncExternalStore(subscribeOutlet, readOutlet);
  if (!state.item) return null;
  const { key, ...rest } = state.item;
  return <StatusLine key={key} {...rest} className={className} onDismiss={() => clearStatus(key)} />;
}


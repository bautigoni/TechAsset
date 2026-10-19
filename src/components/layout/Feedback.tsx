import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { SelectField } from './SelectField';

/**
 * Confirmaciones, preguntas y avisos de la app, en reemplazo de window.confirm,
 * window.prompt y los mensajes sueltos de cada pantalla.
 *
 * Se usan como funciones (`await confirmDialog(...)`, `toast(...)`) desde
 * cualquier lado; el <FeedbackHost/> montado una vez en main.tsx los dibuja con
 * el Modal de la app (foco, Escape, animación) y el toast de transitions.dev.
 * Los nativos no se veían como TechAsset, bloqueaban la página entera y en el
 * celular salían con el dominio arriba.
 */

type Tone = 'info' | 'ok' | 'warn' | 'error';

type ConfirmRequest = {
  kind: 'confirm';
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (value: boolean) => void;
};

type PromptRequest = {
  kind: 'prompt';
  title: string;
  message?: string;
  label: string;
  initial: string;
  placeholder?: string;
  inputType: 'text' | 'datetime-local' | 'date' | 'url' | 'number';
  confirmLabel: string;
  required: boolean;
  /** Si viene, en vez de un campo de texto se elige de esta lista. */
  options?: string[];
  resolve: (value: string | null) => void;
};

export type ToastOptions = {
  message: string;
  tone?: Tone;
  /** Acción del toast, típicamente "Deshacer". */
  action?: { label: string; onClick: () => void | Promise<unknown> };
  durationMs?: number;
};

type ToastItem = ToastOptions & { id: number; closing: boolean };

let dialogQueue: Array<ConfirmRequest | PromptRequest> = [];
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
let snapshot = { dialog: dialogQueue[0] as ConfirmRequest | PromptRequest | undefined, toasts };
const emit = () => {
  snapshot = { dialog: dialogQueue[0], toasts };
  listeners.forEach(listener => listener());
};

export function confirmDialog(options: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    dialogQueue = [...dialogQueue, {
      kind: 'confirm', title: options.title, message: options.message,
      confirmLabel: options.confirmLabel || 'Confirmar', cancelLabel: options.cancelLabel || 'Cancelar',
      danger: Boolean(options.danger), resolve
    }];
    emit();
  });
}

export function promptDialog(options: { title: string; message?: string; label: string; initial?: string; placeholder?: string; inputType?: PromptRequest['inputType']; confirmLabel?: string; required?: boolean; options?: string[] }): Promise<string | null> {
  return new Promise(resolve => {
    dialogQueue = [...dialogQueue, {
      kind: 'prompt', title: options.title, message: options.message, label: options.label,
      initial: options.initial || '', placeholder: options.placeholder, inputType: options.inputType || 'text',
      confirmLabel: options.confirmLabel || 'Aceptar', required: options.required ?? true, options: options.options, resolve
    }];
    emit();
  });
}

let nextToastId = 1;
const TOAST_CLOSE_MS = 220;

export function toast(options: ToastOptions | string) {
  const item: ToastItem = { ...(typeof options === 'string' ? { message: options } : options), id: nextToastId++, closing: false };
  toasts = [...toasts.slice(-3), item];
  emit();
  const duration = item.durationMs ?? (item.action ? 7000 : item.tone === 'error' ? 6000 : 3500);
  window.setTimeout(() => dismissToast(item.id), duration);
  return item.id;
}

export function dismissToast(id: number) {
  if (!toasts.some(item => item.id === id && !item.closing)) return;
  toasts = toasts.map(item => item.id === id ? { ...item, closing: true } : item);
  emit();
  window.setTimeout(() => { toasts = toasts.filter(item => item.id !== id); emit(); }, TOAST_CLOSE_MS);
}

/** Mensaje de error legible de cualquier excepción. */
export function errorMessage(reason: unknown, fallback = 'No se pudo completar la acción.') {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** Toast de error para una acción del usuario que falló (en vez de tragarse el error). */
export function toastError(reason: unknown, fallback?: string) {
  return toast({ message: errorMessage(reason, fallback), tone: 'error' });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function closeDialog<T>(request: { resolve: (value: T) => void }, value: T) {
  dialogQueue = dialogQueue.filter(item => item !== request);
  emit();
  request.resolve(value);
}

export function FeedbackHost() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  return (
    <>
      {state.dialog?.kind === 'confirm' && <ConfirmView key={dialogKey(state.dialog)} request={state.dialog} />}
      {state.dialog?.kind === 'prompt' && <PromptView key={dialogKey(state.dialog)} request={state.dialog} />}
      {state.toasts.length > 0 && (
        <div className="app-toasts" aria-live="polite">
          {state.toasts.map(item => <ToastView key={item.id} item={item} />)}
        </div>
      )}
    </>
  );
}

const dialogKeys = new WeakMap<object, number>();
let nextDialogKey = 1;
function dialogKey(request: object) {
  if (!dialogKeys.has(request)) dialogKeys.set(request, nextDialogKey++);
  return dialogKeys.get(request);
}

function ConfirmView({ request }: { request: ConfirmRequest }) {
  return (
    <Modal title={request.title} onClose={() => closeDialog(request, false)}>
      <div className="stack feedback-dialog">
        {request.message && <p className="feedback-message">{request.message}</p>}
        <div className="actions">
          {/* En las destructivas el foco arranca en Cancelar: un Enter de más no borra. */}
          <Button variant={request.danger ? 'danger' : 'primary'} autoFocus={!request.danger} onClick={() => closeDialog(request, true)}>{request.confirmLabel}</Button>
          <Button autoFocus={request.danger} onClick={() => closeDialog(request, false)}>{request.cancelLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

function PromptView({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.initial || request.options?.[0] || '');
  return (
    <Modal title={request.title} onClose={() => closeDialog(request, null)}>
      <form className="stack feedback-dialog" onSubmit={event => { event.preventDefault(); if (request.required && !value.trim()) return; closeDialog(request, value); }}>
        {request.message && <p className="feedback-message">{request.message}</p>}
        <label>{request.label}
          {request.options
            ? (
              <SelectField ariaLabel={request.label} value={value} onChange={setValue} options={request.options.map(option => ({ value: option, label: option }))} />
            )
            : <input className="input" autoFocus type={request.inputType} value={value} placeholder={request.placeholder} required={request.required} onChange={event => setValue(event.target.value)} />}
        </label>
        <div className="actions">
          <Button variant="primary" type="submit" disabled={request.required && !value.trim()}>{request.confirmLabel}</Button>
          <Button onClick={() => closeDialog(request, null)}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  // Un frame cerrado antes de abrir, para que la receta del toast anime.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const tone = item.tone || 'info';
  return (
    <div className={`app-toast t-toast tone-${tone} ${open && !item.closing ? 'is-open' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="app-toast-message">{item.message}</span>
      {item.action && (
        <button type="button" className="app-toast-action" onClick={() => { dismissToast(item.id); void item.action?.onClick(); }}>
          {item.action.label}
        </button>
      )}
      <button type="button" className="app-toast-close" aria-label="Cerrar aviso" onClick={() => dismissToast(item.id)}>×</button>
    </div>
  );
}

/** Copia al portapapeles y avisa (antes los "copiar" fallaban en silencio, p. ej. sin HTTPS). */
export async function copyToClipboard(text: string, okMessage = 'Copiado al portapapeles.') {
  try {
    if (!navigator.clipboard) throw new Error('El navegador no permite copiar acá.');
    await navigator.clipboard.writeText(text);
    toast({ message: okMessage, tone: 'ok', durationMs: 2000 });
    return true;
  } catch (reason) {
    toast({ message: errorMessage(reason, 'No se pudo copiar. Seleccioná el texto y copialo a mano.'), tone: 'error' });
    return false;
  }
}

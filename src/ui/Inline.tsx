import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { Input } from './Field';
import { Select } from './Select';
import { IconChevronDown } from './icons';
import { Collapse } from './Collapse';
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
      {/* Se abre y se cierra suave hacia su encabezado, que no se mueve (Collapse). */}
      <Collapse open={open} id={contentId} className="ui-disclosure-body">{children}</Collapse>
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
      data-scanner-ignore=""
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

export { StatusLine, useStatusLine, StatusOutlet, pushStatus, clearStatus, type StatusLineProps, type StatusMessage, type StatusTone } from './Status';

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

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { FileCheck2 } from 'lucide-react';
import { Button, Collapse, Combobox, DatePicker, FileDrop, Input, Textarea, icons } from '../../ui';
import { createPettyCashExpense, createPurchaseRequest, discardPettyCashReceipt, uploadPettyCashReceipt } from '../../services/pettyCashApi';
import { todayKeyAr } from '../../utils/formatters';
import { money, parseMoney } from './money';
import { smoothHeight } from '../suggestions/smoothHeight';

const RECEIPT_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf,.png,.jpg,.jpeg,.webp';
/** El comprobante viaja en base64 dentro de un JSON de hasta 10 MB: 7 MB de archivo es el tope seguro. */
const RECEIPT_MAX_MB = 7;
const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

/** Avisa al cerrar la pestaña con un formulario a medio completar. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/**
 * Comprobante: se sube apenas se elige (como antes), con estado en línea. Si ya
 * hay uno subido se muestra con "Ver" y "Quitar"; quitarlo (o cancelar el
 * formulario) lo borra del server si no lo usa ningún gasto ni solicitud.
 */
export function ReceiptField({ url, onChange, label, hint, disabled }: { url: string; onChange: (url: string) => void; label: string; hint: string; disabled?: boolean }) {
  const [removing, setRemoving] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Subido ↔ zona para soltar: cambian de alto con transición (no de golpe).
  const swap = (next: string) => smoothHeight(boxRef.current, () => onChange(next), null);
  const upload = async (file: File) => {
    const base64 = await readDataUrl(file);
    const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    const response = await uploadPettyCashReceipt({ mimeType, base64 });
    swap(response.url);
    return response.url;
  };
  const remove = async () => {
    setRemoving(true);
    const current = url;
    swap('');
    try { await discardPettyCashReceipt(current); } catch { /* si falla, queda un archivo suelto: no bloquea el formulario */ }
    setRemoving(false);
  };
  return (
    <div className="pc-receipt" ref={boxRef}>
      <span className="pc-label">{label} <span className="pc-opt">(opcional)</span></span>
      {url ? (
        <div className="pc-receipt-done">
          <span className="pc-receipt-icon" aria-hidden="true"><FileCheck2 size={16} strokeWidth={1.6} /></span>
          <span className="pc-receipt-text">Comprobante subido · <span className="pc-mono">{url.split('/').pop()?.split('.').pop()?.toUpperCase()}</span></span>
          <a className="ui-btn ui-btn--ghost ui-btn--sm" href={url} target="_blank" rel="noopener"><span className="ui-btn-label">Ver</span></a>
          <Button size="sm" variant="ghost" loading={removing} disabled={disabled} onClick={() => void remove()}>Quitar</Button>
        </div>
      ) : (
        <FileDrop accept={RECEIPT_ACCEPT} maxSizeMB={RECEIPT_MAX_MB} upload={upload} disabled={disabled} label={label} title="Arrastrá el comprobante o tocá para elegirlo" hint={hint} />
      )}
    </div>
  );
}

/** Importe en pesos: texto con teclado decimal (acepta 1.500,50 y 1500.5). */
export function MoneyInput({ label, value, onChange, error, hint, required, autoFocus, ariaLabel }: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; required?: boolean; autoFocus?: boolean; ariaLabel?: string }) {
  return (
    <Input
      label={label}
      aria-label={ariaLabel}
      required={required}
      value={value}
      onValueChange={next => { if (/^[\d.,\s$]*$/.test(next)) onChange(next); }}
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      prefix="$"
      className="pc-money"
      error={error}
      hint={hint}
      autoFocus={autoFocus}
    />
  );
}

const onEscape = (cancel: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); cancel(); }
};

/* ══ Registrar gasto ══════════════════════════════════════════════════ */

export type ExpenseDraft = { date: string; amount: string; description: string; supplier: string; category: string; receiptUrl: string };
export const emptyExpense = (): ExpenseDraft => ({ date: todayKeyAr(), amount: '', description: '', supplier: '', category: 'General', receiptUrl: '' });

export function ExpenseForm({ draft, setDraft, balance, categories, onSaved, onCancel, onClose }: {
  draft: ExpenseDraft;
  setDraft: (updater: (current: ExpenseDraft) => ExpenseDraft) => void;
  balance: number;
  categories: string[];
  onSaved: (message: string) => Promise<void> | void;
  /** Cancelar: descarta el borrador (y el comprobante subido). */
  onCancel: () => void;
  /** Esc: cierra sin perder lo escrito. */
  onClose: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const descRef = useRef<HTMLInputElement | null>(null);
  const today = todayKeyAr();
  const amount = parseMoney(draft.amount);
  const set = (patch: Partial<ExpenseDraft>) => { setDraft(current => ({ ...current, ...patch })); setServerError(''); };
  useUnsavedWarning(Boolean(draft.description || draft.amount || draft.supplier || draft.receiptUrl));

  const amountError = amount === null ? 'Poné el importe.' : Number.isNaN(amount) || amount <= 0 ? 'El importe tiene que ser mayor a cero.' : amount > balance ? `No alcanza el saldo. Hay ${money(balance)} disponibles y el gasto es de ${money(amount)}.` : '';
  const errors = {
    description: !draft.description.trim() ? 'Contá qué se compró.' : '',
    amount: amountError,
    date: !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? 'Elegí la fecha del gasto.' : draft.date > today ? 'No puede ser una fecha futura.' : ''
  };
  const overBalance = amount !== null && !Number.isNaN(amount) && amount > balance;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setTouched(true);
    if (errors.description || errors.amount || errors.date) return;
    setBusy(true);
    try {
      await createPettyCashExpense({ expenseDate: draft.date, description: draft.description.trim(), supplier: draft.supplier.trim(), amount: amount as number, category: draft.category.trim() || 'General', receiptUrl: draft.receiptUrl });
      await onSaved(`Gasto registrado: ${draft.description.trim()} · ${money(amount as number)}.`);
    } catch (reason) {
      setServerError(errorText(reason, 'No se pudo registrar el gasto.'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { descRef.current?.focus({ preventScroll: true }); }, []);

  return (
    <form className="pc-form" onSubmit={submit} noValidate data-scanner-ignore="" onKeyDown={onEscape(onClose)} aria-label="Registrar gasto">
      <div className="pc-form-head">
        <h2 className="pc-form-title">Registrar gasto</h2>
        <span className="pc-form-keys">Enter registra · Esc cierra</span>
        <span className="pc-form-balance">Saldo disponible <b className="pc-mono">{money(balance)}</b></span>
      </div>
      <div className="pc-grid">
        <Input ref={descRef} className="pc-span" label="Descripción" required value={draft.description} onValueChange={description => set({ description })} placeholder="Qué se compró" autoComplete="off" error={touched ? errors.description || undefined : undefined} />
        <MoneyInput label="Importe" required value={draft.amount} onChange={value => set({ amount: value })} error={(touched || overBalance) && errors.amount ? errors.amount : undefined} hint={amount && !errors.amount ? `Quedan ${money(balance - amount)} después de este gasto.` : undefined} />
        <DatePicker label="Fecha" required value={draft.date} onChange={date => set({ date })} max={today} shortcuts={['yesterday', 'today']} disabledMessage="No se puede registrar un gasto con fecha futura." error={touched && errors.date ? errors.date : undefined} />
        <Input label="Proveedor" value={draft.supplier} onValueChange={supplier => set({ supplier })} placeholder="Opcional" autoComplete="off" />
        <Combobox label="Categoría" value={draft.category} onChange={category => set({ category })} options={categories} placeholder="General" />
        <div className="pc-span">
          <ReceiptField url={draft.receiptUrl} onChange={receiptUrl => set({ receiptUrl })} label="Comprobante" hint="PNG, JPG, WEBP o PDF, hasta 7 MB. Se sube apenas lo elegís." />
        </div>
      </div>
      <div className="pc-form-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button variant="primary" type="submit" loading={busy} loadingLabel="Registrando…" disabled={overBalance}>Registrar gasto</Button>
      </div>
      <Collapse open={Boolean(serverError)} unmountOnClose reveal={false} gap="auto">
        <p className="pc-error" role="alert"><icons.IconAlert size={14} /><span>{serverError}</span></p>
      </Collapse>
    </form>
  );
}

/* ══ Solicitar compra ═════════════════════════════════════════════════ */

export type RequestDraft = { description: string; category: string; estimate: string; supplier: string; justification: string; receiptUrl: string };
export const emptyRequest = (): RequestDraft => ({ description: '', category: 'General', estimate: '', supplier: '', justification: '', receiptUrl: '' });

export function RequestForm({ draft, setDraft, categories, onSaved, onCancel, onClose }: {
  draft: RequestDraft;
  setDraft: (updater: (current: RequestDraft) => RequestDraft) => void;
  categories: string[];
  onSaved: (message: string) => Promise<void> | void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const descRef = useRef<HTMLInputElement | null>(null);
  const estimate = parseMoney(draft.estimate);
  const set = (patch: Partial<RequestDraft>) => { setDraft(current => ({ ...current, ...patch })); setServerError(''); };
  useUnsavedWarning(Boolean(draft.description || draft.estimate || draft.justification || draft.receiptUrl));

  const errors = {
    description: !draft.description.trim() ? 'Contá qué hay que comprar.' : '',
    estimate: estimate !== null && (Number.isNaN(estimate) || estimate < 0) ? 'El importe estimado no es válido.' : ''
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setTouched(true);
    if (errors.description || errors.estimate) return;
    setBusy(true);
    try {
      await createPurchaseRequest({ description: draft.description.trim(), category: draft.category.trim() || 'General', estimatedAmount: estimate || 0, supplier: draft.supplier.trim(), justification: draft.justification.trim(), receiptUrl: draft.receiptUrl });
      await onSaved('Solicitud enviada al responsable de caja chica.');
    } catch (reason) {
      setServerError(errorText(reason, 'No se pudo enviar la solicitud.'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { descRef.current?.focus({ preventScroll: true }); }, []);

  return (
    <form className="pc-form" onSubmit={submit} noValidate data-scanner-ignore="" onKeyDown={onEscape(onClose)} aria-label="Solicitar compra">
      <div className="pc-form-head">
        <h2 className="pc-form-title">Solicitar compra</h2>
        <span className="pc-form-keys">Le llega al responsable de caja chica para aprobarla o rechazarla.</span>
      </div>
      <div className="pc-grid">
        <Input ref={descRef} className="pc-span" label="Qué necesitás comprar" required value={draft.description} onValueChange={description => set({ description })} placeholder="Ej.: cables HDMI para el aula" autoComplete="off" error={touched ? errors.description || undefined : undefined} />
        <Combobox label="Categoría" value={draft.category} onChange={category => set({ category })} options={categories} placeholder="General" />
        <MoneyInput label="Importe estimado" value={draft.estimate} onChange={value => set({ estimate: value })} error={errors.estimate || undefined} />
        <Input label="Proveedor sugerido" value={draft.supplier} onValueChange={supplier => set({ supplier })} placeholder="Opcional" autoComplete="off" />
        <Textarea
          className="pc-span"
          label="Justificación"
          minRows={2}
          value={draft.justification}
          onValueChange={justification => set({ justification })}
          placeholder="Para qué se necesita"
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(); } }}
        />
        <div className="pc-span">
          <ReceiptField url={draft.receiptUrl} onChange={receiptUrl => set({ receiptUrl })} label="Comprobante o presupuesto" hint="PNG, JPG, WEBP o PDF, hasta 7 MB. Si se aprueba, pasa al gasto." />
        </div>
      </div>
      <div className="pc-form-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button variant="primary" type="submit" loading={busy} loadingLabel="Enviando…">Enviar solicitud</Button>
      </div>
      <Collapse open={Boolean(serverError)} unmountOnClose reveal={false} gap="auto">
        <p className="pc-error" role="alert"><icons.IconAlert size={14} /><span>{serverError}</span></p>
      </Collapse>
    </form>
  );
}

import { useRef, useState, type FormEvent } from 'react';
import { Paperclip } from 'lucide-react';
import type { PurchaseRequest } from '../../types';
import { resolvePurchaseRequest } from '../../services/pettyCashApi';
import { Button, Collapse, Input, NumberField, StatusLine, StatusText, Switch, Textarea, icons, type StatusTextTone } from '../../ui';
import { MoneyInput, useUnsavedWarning } from './PettyForms';
import { displayDay, money, moneyDraft, parseMoney } from './money';
import { peekDraft, useKeepDraft } from '../../utils/drafts';

const STATUS_TONE: Record<PurchaseRequest['status'], StatusTextTone> = { Pendiente: 'warn', Aprobada: 'ok', Rechazada: 'bad' };
const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);
const DEFAULT_REJECT = 'Rechazada desde caja chica';

type Mode = 'none' | 'approve' | 'reject';
type ResolveDraft = { mode: Mode; cost: string; supplier: string; note: string; toInventory: boolean; qty: number | null; rejectNote: string };

/**
 * Una solicitud de compra (fila a todo el ancho). Resolver abre la aprobación
 * DEBAJO de la fila (costo, proveedor, nota, "registrar también en
 * Inventario TIC" + cantidad, control de saldo); Rechazar pide confirmación en
 * línea con la nota editable (antes rechazaba de un click con nota fija).
 * Muestra el comprobante adjunto (antes se guardaba pero no se veía).
 */
export function RequestItem({ item, manager, readOnly, balance, message, onResolved }: {
  item: PurchaseRequest;
  manager: boolean;
  readOnly: boolean;
  balance: number;
  message?: { tone: 'ok' | 'bad'; text: string } | null;
  onResolved: (id: number, message: string) => Promise<void>;
}) {
  // Aprobación o rechazo a medio cargar: sobrevive a salir por el menú y volver.
  const draftKey = `caja-chica:solicitud:${item.id}`;
  const [saved] = useState(() => peekDraft<ResolveDraft>(draftKey));
  const [mode, setMode] = useState<Mode>(saved?.mode ?? 'none');
  const [cost, setCost] = useState(() => saved?.cost ?? moneyDraft(item.estimatedAmount));
  const [supplier, setSupplier] = useState(saved?.supplier ?? (item.requestedSupplier || ''));
  const [note, setNote] = useState(saved?.note ?? '');
  const [toInventory, setToInventory] = useState(saved?.toInventory ?? false);
  const [qty, setQty] = useState<number | null>(saved?.qty ?? 1);
  const [rejectNote, setRejectNote] = useState(saved?.rejectNote ?? DEFAULT_REJECT);
  const edited = mode !== 'none' && item.status === 'Pendiente' && (
    note.trim() !== '' || toInventory || cost !== moneyDraft(item.estimatedAmount) || supplier !== (item.requestedSupplier || '') || rejectNote !== DEFAULT_REJECT
  );
  useKeepDraft<ResolveDraft>(draftKey, { mode, cost, supplier, note, toInventory, qty, rejectNote }, edited);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolveRef = useRef<HTMLButtonElement | null>(null);
  const rejectRef = useRef<HTMLButtonElement | null>(null);

  const pending = item.status === 'Pendiente';
  const finalCost = parseMoney(cost);
  const overBalance = finalCost !== null && !Number.isNaN(finalCost) && finalCost > balance;
  const costError = finalCost === null ? 'Poné el costo final.' : Number.isNaN(finalCost) || finalCost <= 0 ? 'El costo tiene que ser mayor a cero.' : overBalance ? `No alcanza el saldo para aprobarla. Disponible: ${money(balance)}.` : '';
  const supplierError = !supplier.trim() ? 'Poné el proveedor.' : '';
  useUnsavedWarning(edited);

  const toggle = (next: Mode) => { setError(''); setTouched(false); setMode(current => (current === next ? 'none' : next)); };

  const approve = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setTouched(true);
    if (costError || supplierError || (toInventory && (!qty || qty < 1))) return;
    setBusy(true);
    setError('');
    try {
      const response = await resolvePurchaseRequest(item.id, {
        status: 'Aprobada',
        finalCost,
        supplier: supplier.trim(),
        note: note.trim(),
        addToInventory: toInventory,
        inventory: { nombre: item.description, categoria: item.category, cantidad: qty || 1, unidad: 'unidades', estado: 'Nuevo' }
      }) as { inventoryItemId?: number | null };
      setMode('none');
      await onResolved(item.id, `Compra aprobada y descontada del saldo${response?.inventoryItemId ? ` · Inventario #${response.inventoryItemId}` : ''}.`);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo aprobar la compra.'));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await resolvePurchaseRequest(item.id, { status: 'Rechazada', note: rejectNote.trim() || DEFAULT_REJECT });
      setMode('none');
      await onResolved(item.id, `Rechazaste la solicitud. Se le avisó a ${item.requesterName || 'quien la pidió'}.`);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo rechazar la solicitud.'));
    } finally {
      setBusy(false);
    }
  };

  const escape = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); setMode('none'); (mode === 'reject' ? rejectRef : resolveRef).current?.focus({ preventScroll: true }); }
  };

  return (
    <li className={`pc-req${mode !== 'none' ? ' is-open' : ''}`} aria-label={`Solicitud #${item.id}: ${item.description}, ${item.status}`}>
      <div className="pc-req-row">
        <div className="pc-req-main">
          <div className="pc-req-title">
            <span className="pc-req-desc">{item.description}</span>
            <StatusText tone={STATUS_TONE[item.status] || 'normal'} strong>{item.status}</StatusText>
          </div>
          <span className="pc-req-meta"><span className="pc-mono">#{item.id}</span> · {item.requesterName || item.requesterEmail || 'Sin solicitante'} · <span className="pc-mono">{displayDay(item.createdAt)}</span> · {item.category || 'General'}</span>
          <span className="pc-req-just">{item.justification || 'Sin justificación adicional.'}</span>
          {!pending && (
            <span className="pc-req-final">
              {item.status === 'Aprobada'
                ? <>Compra final: <b className="pc-mono">{money(item.finalCost)}</b> · {item.finalSupplier || 'sin proveedor'}{item.resolutionNote ? ` · ${item.resolutionNote}` : ''}</>
                : <>Nota: {item.resolutionNote || 'sin nota'}</>}
              {item.resolvedBy ? <span className="pc-req-by">Resolvió {item.resolvedBy}{item.resolvedAt ? ` el ${displayDay(item.resolvedAt)}` : ''}</span> : null}
            </span>
          )}
        </div>
        <div className="pc-req-side">
          <span className="pc-req-est">Estimado <b className="pc-mono">{money(item.estimatedAmount)}</b></span>
          <span className="pc-req-prov">{item.requestedSupplier || 'Proveedor a definir'}</span>
          {item.receiptUrl && (
            <a className="pc-link" href={item.receiptUrl} target="_blank" rel="noopener">
              <Paperclip size={14} strokeWidth={1.6} aria-hidden="true" />
              <span>Comprobante adjunto</span>
            </a>
          )}
          {pending && manager && (
            <div className="pc-req-actions">
              <Button ref={resolveRef} size="sm" variant="primary" disabled={readOnly} aria-expanded={mode === 'approve'} aria-controls={`pc-approve-${item.id}`} onClick={() => toggle('approve')}>Resolver</Button>
              <Button ref={rejectRef} size="sm" variant="ghost" disabled={readOnly} aria-expanded={mode === 'reject'} aria-controls={`pc-reject-${item.id}`} onClick={() => toggle('reject')}>Rechazar</Button>
            </div>
          )}
        </div>
      </div>

      <Collapse unmountOnClose open={mode === 'approve'} id={`pc-approve-${item.id}`} role="region" aria-label={`Aprobar solicitud #${item.id}`} returnFocus={resolveRef}>
        <form className="pc-form pc-form--inline" onSubmit={approve} noValidate data-scanner-ignore="" onKeyDown={escape}>
          <div className="pc-form-head">
            <h3 className="pc-form-title">Aprobar solicitud <span className="pc-mono">#{item.id}</span></h3>
            <span className="pc-form-keys">Al aprobar se crea el gasto y se notifica a {item.requesterName || 'quien la pidió'}.</span>
            <span className="pc-form-balance">Saldo disponible <b className="pc-mono">{money(balance)}</b></span>
          </div>
          <div className="pc-grid">
            <MoneyInput label="Costo final" required value={cost} onChange={setCost} error={(touched || overBalance) && costError ? costError : undefined} hint={finalCost && !costError ? `Quedan ${money(balance - finalCost)} después de aprobarla.` : undefined} />
            <Input label="Proveedor" required value={supplier} onValueChange={setSupplier} autoComplete="off" error={touched && supplierError ? supplierError : undefined} />
            <Textarea className="pc-span" label="Nota de resolución" minRows={2} value={note} onValueChange={setNote} placeholder="Opcional" />
            <div className="pc-span pc-inv">
              <Switch checked={toInventory} onCheckedChange={setToInventory} label="Registrar también en Inventario TIC" description="Se crea como recurso nuevo, en unidades, con la observación de la compra." />
              {/* La cantidad aparece con alto suave al prender el switch (no de golpe). */}
              <Collapse open={toInventory} unmountOnClose reveal={false} className="pc-qty">
                <NumberField label="Cantidad" value={qty} onChange={setQty} min={1} max={9999} unit="unidades" error={touched && (!qty || qty < 1) ? 'Mínimo 1.' : undefined} />
              </Collapse>
            </div>
          </div>
          <div className="pc-form-actions">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode('none'); resolveRef.current?.focus({ preventScroll: true }); }}>Cancelar</Button>
            <Button size="sm" variant="primary" type="submit" loading={busy} loadingLabel="Aprobando…" disabled={overBalance}>Aprobar y descontar</Button>
          </div>
          <Collapse open={Boolean(error)} unmountOnClose reveal={false} gap="auto">
            <p className="pc-error" role="alert"><icons.IconAlert size={14} /><span>{error}</span></p>
          </Collapse>
        </form>
      </Collapse>

      <Collapse unmountOnClose open={mode === 'reject'} id={`pc-reject-${item.id}`} role="region" aria-label={`Rechazar solicitud #${item.id}`} returnFocus={rejectRef}>
        <form className="pc-form pc-form--inline pc-reject" onSubmit={reject} noValidate data-scanner-ignore="" onKeyDown={escape}>
          <p className="pc-reject-msg">¿Rechazar la solicitud? Se le avisa a {item.requesterName || 'quien la pidió'} con esta nota.</p>
          <Input label="Nota de rechazo" value={rejectNote} onValueChange={setRejectNote} autoComplete="off" autoFocus />
          <div className="pc-form-actions">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode('none'); rejectRef.current?.focus({ preventScroll: true }); }}>Cancelar</Button>
            <Button size="sm" variant="danger" type="submit" loading={busy} loadingLabel="Rechazando…">Rechazar solicitud</Button>
          </div>
          <Collapse open={Boolean(error)} unmountOnClose reveal={false} gap="auto">
            <p className="pc-error" role="alert"><icons.IconAlert size={14} /><span>{error}</span></p>
          </Collapse>
        </form>
      </Collapse>

      {/* El resultado (aprobada / rechazada) entra con alto suave debajo de la fila. */}
      <Collapse open={Boolean(message)} reveal={false}>
        {message && (
          <div className="pc-req-status">
            <StatusLine tone={message.tone} message={message.text} autoHideMs={0} />
          </div>
        )}
      </Collapse>
    </li>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Plus, ReceiptText, ShoppingCart, WalletCards } from 'lucide-react';
import type { PurchaseRequest } from '../../types';
import { createPettyCashExpense, createPurchaseRequest, getPettyCash, resolvePurchaseRequest, savePettyCashConfig, uploadPettyCashReceipt, type PettyCashResponse } from '../../services/pettyCashApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const EMPTY_EXPENSE = { expenseDate: displayDate(new Date().toISOString().slice(0, 10)), description: '', supplier: '', amount: 0, category: 'General', receiptUrl: '' };
const EMPTY_REQUEST = { description: '', category: 'General', estimatedAmount: 0, supplier: '', justification: '', receiptUrl: '' };

export function PettyCashPage({ consultationMode }: { consultationMode: boolean }) {
  const [data, setData] = useState<PettyCashResponse | null>(null);
  const [config, setConfig] = useState({ initialAmount: 0, requestsEnabled: true });
  const [expense, setExpense] = useState<typeof EMPTY_EXPENSE | null>(null);
  const [request, setRequest] = useState<typeof EMPTY_REQUEST | null>(null);
  const [resolving, setResolving] = useState<PurchaseRequest | null>(null);
  const [resolution, setResolution] = useState({ finalCost: 0, supplier: '', note: '', addToInventory: false, cantidad: 1 });
  const [message, setMessage] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await getPettyCash();
    setData(response);
    setConfig({ ...response.config, requestsEnabled: true });
  }, []);

  useEffect(() => {
    refresh().catch(error => setMessage(errorMessage(error, 'No se pudo cargar caja chica.')));
  }, [refresh]);

  const uploadReceipt = async (file: File) => {
    const base64 = await readFile(file);
    return (await uploadPettyCashReceipt({ mimeType: file.type, base64 })).url;
  };

  if (!data) return <section className="view active petty-cash-page"><div className="empty-state">Cargando caja chica...</div></section>;

  const openExpense = () => {
    setModalError('');
    setExpense({ ...EMPTY_EXPENSE });
  };
  const openRequest = () => {
    setModalError('');
    setRequest({ ...EMPTY_REQUEST });
  };
  const openResolution = (item: PurchaseRequest) => {
    setModalError('');
    setResolving(item);
    setResolution({ finalCost: item.estimatedAmount || 0, supplier: item.requestedSupplier || '', note: '', addToInventory: false, cantidad: 1 });
  };

  const submitExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!expense || busy) return;
    setModalError('');
    const expenseDate = isoDate(expense.expenseDate);
    if (!expenseDate) return setModalError('Ingresá una fecha válida con formato DD/MM/AAAA.');
    if (expense.amount > data.balance) return setModalError(`No alcanza el saldo. Hay ${money(data.balance)} disponibles y el gasto es de ${money(expense.amount)}.`);
    setBusy(true);
    try {
      await createPettyCashExpense({ ...expense, expenseDate });
      setExpense(null);
      setMessage('Gasto registrado.');
      await refresh();
    } catch (error) {
      setModalError(errorMessage(error, 'No se pudo registrar el gasto.'));
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!request || busy) return;
    setModalError('');
    setBusy(true);
    try {
      await createPurchaseRequest(request);
      setRequest(null);
      setMessage('Solicitud enviada al responsable de caja chica.');
      await refresh();
    } catch (error) {
      setModalError(errorMessage(error, 'No se pudo enviar la solicitud.'));
    } finally {
      setBusy(false);
    }
  };

  const submitResolution = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resolving || busy) return;
    setModalError('');
    if (resolution.finalCost > data.balance) return setModalError(`No alcanza el saldo para aprobarla. Disponible: ${money(data.balance)}.`);
    setBusy(true);
    try {
      await resolvePurchaseRequest(resolving.id, {
        status: 'Aprobada',
        finalCost: resolution.finalCost,
        supplier: resolution.supplier,
        note: resolution.note,
        addToInventory: resolution.addToInventory,
        inventory: { nombre: resolving.description, categoria: resolving.category, cantidad: resolution.cantidad, unidad: 'unidades', estado: 'Nuevo' }
      });
      setResolving(null);
      setMessage('Compra aprobada y descontada del saldo.');
      await refresh();
    } catch (error) {
      setModalError(errorMessage(error, 'No se pudo aprobar la compra.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view active petty-cash-page">
      <section className="card petty-summary">
        <div className="petty-summary-copy">
          <span className="petty-summary-icon" aria-hidden="true"><WalletCards size={22} /></span>
          <div>
            <span className="eyebrow">Fondo fijo</span>
            <h2>Caja chica</h2>
            <p>Gastos y solicitudes de compra de la sede.</p>
          </div>
        </div>
        <div className="petty-balance">
          <span>Saldo disponible</span>
          <strong>{money(data.balance)}</strong>
          <small>Fondo {money(data.config.initialAmount)} · Gastado {money(data.spent)}</small>
        </div>
      </section>

      {message && <div className="tool-info">{message}</div>}

      <div className="petty-command-bar">
        {data.permissions.manager && (
          <div className="petty-fund-editor">
            <label>Fondo inicial
              <input className="input" type="number" min="0" step="0.01" disabled={consultationMode} value={config.initialAmount} onChange={event => setConfig(value => ({ ...value, initialAmount: Number(event.target.value) }))} />
            </label>
            <Button disabled={consultationMode} onClick={async () => {
              try {
                await savePettyCashConfig({ initialAmount: config.initialAmount, requestsEnabled: true });
                setMessage('Fondo actualizado.');
                await refresh();
              } catch (error) {
                setMessage(errorMessage(error, 'No se pudo actualizar el fondo.'));
              }
            }}>Guardar fondo</Button>
          </div>
        )}
        <div className="petty-actions">
          {data.permissions.manager && <Button disabled={consultationMode} onClick={openExpense}><Plus size={16} /> Registrar gasto</Button>}
          {data.permissions.canRequest && <Button variant="primary" disabled={consultationMode} onClick={openRequest}><Plus size={16} /> Solicitar compra</Button>}
        </div>
      </div>

      <div className="petty-layout">
        <section className="card petty-section">
          <div className="petty-section-head">
            <div><span className="petty-section-icon"><ReceiptText size={18} /></span><h3>Historial de gastos</h3></div>
            <span>{data.expenses.length}</span>
          </div>
          <div className="petty-list">
            {data.expenses.map(item => (
              <article className="petty-row" key={item.id}>
                <time>{formatDate(item.expenseDate)}</time>
                <div><strong>{item.description}</strong><span>{item.supplier || 'Sin proveedor'} · {item.category}</span></div>
                <strong>{money(item.amount)}</strong>
                {item.receiptUrl ? <a href={item.receiptUrl} target="_blank" rel="noreferrer">Comprobante</a> : <span className="muted">Sin comprobante</span>}
                {item.inventoryItemId && <span className="inventory-linked">Inventario #{item.inventoryItemId}</span>}
              </article>
            ))}
            {!data.expenses.length && <EmptyPanel icon={<ReceiptText size={30} />} title="Todavía no hay gastos" text="Cuando registres uno aparecerá en este historial." />}
          </div>
        </section>

        <section className="card petty-section">
          <div className="petty-section-head">
            <div><span className="petty-section-icon"><ShoppingCart size={18} /></span><h3>Solicitudes de compra</h3></div>
            <span>{data.requests.filter(item => item.status === 'Pendiente').length} pendientes</span>
          </div>
          <div className="request-list">
            {data.requests.map(item => (
              <article className={`request-card status-${item.status.toLowerCase()}`} key={item.id}>
                <header><div><strong>{item.description}</strong><span>{item.requesterName} · {formatDate(item.createdAt)}</span></div><span>{item.status}</span></header>
                <p>{item.justification || 'Sin justificación adicional.'}</p>
                <div className="request-meta"><span>Estimado {money(item.estimatedAmount)}</span><span>{item.requestedSupplier || 'Proveedor a definir'}</span></div>
                {item.status !== 'Pendiente' && <small>{item.finalSupplier ? `${item.finalSupplier} · ${money(item.finalCost)}` : item.resolutionNote}</small>}
                {item.status === 'Pendiente' && data.permissions.manager && (
                  <div className="actions">
                    <Button disabled={consultationMode} variant="primary" onClick={() => openResolution(item)}>Resolver <ArrowRight size={15} /></Button>
                    <Button disabled={consultationMode} onClick={async () => {
                      try {
                        await resolvePurchaseRequest(item.id, { status: 'Rechazada', note: 'Rechazada desde caja chica' });
                        await refresh();
                      } catch (error) {
                        setMessage(errorMessage(error, 'No se pudo rechazar la solicitud.'));
                      }
                    }}>Rechazar</Button>
                  </div>
                )}
              </article>
            ))}
            {!data.requests.length && <EmptyPanel icon={<ShoppingCart size={30} />} title="No hay solicitudes" text="Las solicitudes del equipo se mostrarán acá." />}
          </div>
        </section>
      </div>

      {expense && (
        <Modal title="Registrar gasto" onClose={() => setExpense(null)}>
          <form className="stack" onSubmit={submitExpense}>
            {modalError && <div className="tool-error">{modalError}</div>}
            <div className="balance-context"><span>Saldo disponible</span><strong>{money(data.balance)}</strong></div>
            <label>Fecha
              <input className="input" inputMode="numeric" required value={expense.expenseDate} onChange={event => setExpense(value => ({ ...value!, expenseDate: event.target.value }))} placeholder="DD/MM/AAAA" />
            </label>
            <label>Descripción<input className="input" required value={expense.description} onChange={event => setExpense(value => ({ ...value!, description: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Proveedor<input className="input" value={expense.supplier} onChange={event => setExpense(value => ({ ...value!, supplier: event.target.value }))} /></label>
              <label>Categoría<input className="input" value={expense.category} onChange={event => setExpense(value => ({ ...value!, category: event.target.value }))} /></label>
            </div>
            <label>Importe<input className="input" type="number" min="0.01" step="0.01" required value={expense.amount || ''} onChange={event => setExpense(value => ({ ...value!, amount: Number(event.target.value) }))} /></label>
            <ReceiptField url={expense.receiptUrl} onUpload={async file => {
              try {
                const receiptUrl = await uploadReceipt(file);
                setExpense(value => ({ ...value!, receiptUrl }));
              } catch (error) {
                setModalError(errorMessage(error, 'No se pudo adjuntar el comprobante.'));
              }
            }} />
            <div className="actions"><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar gasto'}</Button><Button type="button" onClick={() => setExpense(null)}>Cancelar</Button></div>
          </form>
        </Modal>
      )}

      {request && (
        <Modal title="Solicitar compra" onClose={() => setRequest(null)}>
          <form className="stack" onSubmit={submitRequest}>
            {modalError && <div className="tool-error">{modalError}</div>}
            <label>Qué necesitás comprar<input className="input" required value={request.description} onChange={event => setRequest(value => ({ ...value!, description: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Categoría<input className="input" value={request.category} onChange={event => setRequest(value => ({ ...value!, category: event.target.value }))} /></label>
              <label>Importe estimado<input className="input" type="number" min="0" step="0.01" value={request.estimatedAmount || ''} onChange={event => setRequest(value => ({ ...value!, estimatedAmount: Number(event.target.value) }))} /></label>
            </div>
            <label>Proveedor sugerido<input className="input" value={request.supplier} onChange={event => setRequest(value => ({ ...value!, supplier: event.target.value }))} /></label>
            <label>Justificación<textarea className="input" rows={3} value={request.justification} onChange={event => setRequest(value => ({ ...value!, justification: event.target.value }))} /></label>
            <ReceiptField url={request.receiptUrl} onUpload={async file => {
              try {
                const receiptUrl = await uploadReceipt(file);
                setRequest(value => ({ ...value!, receiptUrl }));
              } catch (error) {
                setModalError(errorMessage(error, 'No se pudo adjuntar el comprobante.'));
              }
            }} />
            <div className="actions"><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar solicitud'}</Button><Button type="button" onClick={() => setRequest(null)}>Cancelar</Button></div>
          </form>
        </Modal>
      )}

      {resolving && (
        <Modal title={`Aprobar solicitud #${resolving.id}`} onClose={() => setResolving(null)}>
          <form className="stack" onSubmit={submitResolution}>
            {modalError && <div className="tool-error">{modalError}</div>}
            <p className="muted">Al aprobar se crea el gasto y se notifica a {resolving.requesterName}.</p>
            <div className="balance-context"><span>Saldo disponible</span><strong>{money(data.balance)}</strong></div>
            <div className="grid-2">
              <label>Costo final<input className="input" type="number" min="0.01" step="0.01" required value={resolution.finalCost || ''} onChange={event => setResolution(value => ({ ...value, finalCost: Number(event.target.value) }))} /></label>
              <label>Proveedor<input className="input" required value={resolution.supplier} onChange={event => setResolution(value => ({ ...value, supplier: event.target.value }))} /></label>
            </div>
            <label>Nota de resolución<textarea className="input" rows={2} value={resolution.note} onChange={event => setResolution(value => ({ ...value, note: event.target.value }))} /></label>
            <button className={`toggle-row toggle-row-button ${resolution.addToInventory ? 'active' : ''}`} type="button" role="switch" aria-checked={resolution.addToInventory} onClick={() => setResolution(value => ({ ...value, addToInventory: !value.addToInventory }))}>
              <span className="toggle-pill"><span /></span>
              <strong>Registrar también en Inventario TIC</strong>
            </button>
            {resolution.addToInventory && <label>Cantidad<input className="input" type="number" min="1" value={resolution.cantidad} onChange={event => setResolution(value => ({ ...value, cantidad: Number(event.target.value) }))} /></label>}
            <div className="actions"><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Aprobando…' : 'Aprobar y descontar'}</Button><Button type="button" onClick={() => setResolving(null)}>Cancelar</Button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function EmptyPanel({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="petty-empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>;
}

function ReceiptField({ url, onUpload }: { url: string; onUpload: (file: File) => void | Promise<void> }) {
  return (
    <div className="field">
      <span>Comprobante (opcional)</span>
      <span className="receipt-field">
        <input className="input" value={url} readOnly placeholder="Sin archivo" aria-label="Comprobante (opcional)" />
        <label className="btn btn-secondary">Adjuntar<input type="file" accept="image/*,.pdf" onChange={event => { const file = event.target.files?.[0]; if (file) void onUpload(file); }} /></label>
      </span>
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(value || 0);
}

function displayDate(value: string) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : date;
}

function isoDate(value: string) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const [, day, month, year] = match;
  const candidate = new Date(`${year}-${month}-${day}T12:00:00`);
  return candidate.getFullYear() === Number(year) && candidate.getMonth() + 1 === Number(month) && candidate.getDate() === Number(day)
    ? `${year}-${month}-${day}`
    : '';
}

function formatDate(value: string) {
  const date = String(value || '').slice(0, 10);
  return date ? date.split('-').reverse().join('/') : '—';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

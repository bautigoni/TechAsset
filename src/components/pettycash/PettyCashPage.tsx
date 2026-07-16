import { useCallback, useEffect, useState } from 'react';
import type { PurchaseRequest } from '../../types';
import { createPettyCashExpense, createPurchaseRequest, getPettyCash, resolvePurchaseRequest, savePettyCashConfig, uploadPettyCashReceipt, type PettyCashResponse } from '../../services/pettyCashApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const EMPTY_EXPENSE = { expenseDate: new Date().toISOString().slice(0, 10), description: '', supplier: '', amount: 0, category: 'General', receiptUrl: '' };
const EMPTY_REQUEST = { description: '', category: 'General', estimatedAmount: 0, supplier: '', justification: '', receiptUrl: '' };

export function PettyCashPage({ consultationMode }: { consultationMode: boolean }) {
  const [data, setData] = useState<PettyCashResponse | null>(null);
  const [config, setConfig] = useState({ initialAmount: 0, requestsEnabled: false });
  const [expense, setExpense] = useState<typeof EMPTY_EXPENSE | null>(null);
  const [request, setRequest] = useState<typeof EMPTY_REQUEST | null>(null);
  const [resolving, setResolving] = useState<PurchaseRequest | null>(null);
  const [resolution, setResolution] = useState({ finalCost: 0, supplier: '', note: '', addToInventory: false, cantidad: 1 });
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const response = await getPettyCash();
    setData(response);
    setConfig(response.config);
  }, []);
  useEffect(() => { refresh().catch(() => setMessage('No se pudo cargar caja chica.')); }, [refresh]);

  const uploadReceipt = async (file: File) => {
    const base64 = await readFile(file);
    return (await uploadPettyCashReceipt({ mimeType: file.type, base64 })).url;
  };

  if (!data) return <section className="view active"><div className="empty-state">Cargando caja chica...</div></section>;

  const openResolution = (item: PurchaseRequest) => {
    setResolving(item);
    setResolution({ finalCost: item.estimatedAmount || 0, supplier: item.requestedSupplier || '', note: '', addToInventory: false, cantidad: 1 });
  };

  return <section className="view active petty-cash-page">
    <div className="petty-hero card"><div><span className="eyebrow">Fondo fijo</span><h2>Caja chica</h2><p>Gastos, comprobantes y solicitudes de compra en un solo lugar.</p></div><div className="petty-balance"><span>Saldo actual</span><strong>{money(data.balance)}</strong><small>Fondo {money(data.config.initialAmount)} · Gastado {money(data.spent)}</small></div></div>
    {message && <div className="tool-info">{message}</div>}

    {data.permissions.manager && <div className="petty-config card"><label>Fondo inicial<input className="input" type="number" min="0" step="0.01" disabled={consultationMode} value={config.initialAmount} onChange={event => setConfig(value => ({ ...value, initialAmount: Number(event.target.value) }))} /></label><label className="switch-line"><input type="checkbox" disabled={consultationMode} checked={config.requestsEnabled} onChange={event => setConfig(value => ({ ...value, requestsEnabled: event.target.checked }))} /><span>Permitir solicitudes de asistentes</span></label><Button disabled={consultationMode} onClick={async () => { await savePettyCashConfig(config); setMessage('Configuración guardada.'); await refresh(); }}>Guardar configuración</Button></div>}

    <div className="petty-actions">{data.permissions.manager && <Button variant="primary" disabled={consultationMode} onClick={() => setExpense({ ...EMPTY_EXPENSE })}>+ Registrar gasto</Button>}{data.permissions.canRequest && <Button variant="primary" disabled={consultationMode} onClick={() => setRequest({ ...EMPTY_REQUEST })}>+ Solicitar compra</Button>}</div>

    <div className="petty-layout">
      <section className="card petty-section"><div className="card-head"><h3>Historial de gastos</h3><span>{data.expenses.length}</span></div><div className="petty-list">{data.expenses.map(item => <article className="petty-row" key={item.id}><time>{formatDate(item.expenseDate)}</time><div><strong>{item.description}</strong><span>{item.supplier || 'Sin proveedor'} · {item.category}</span></div><strong>{money(item.amount)}</strong>{item.receiptUrl ? <a href={item.receiptUrl} target="_blank" rel="noreferrer">Comprobante</a> : <span className="muted">Sin comprobante</span>}{item.inventoryItemId && <span className="inventory-linked">Inventario #{item.inventoryItemId}</span>}</article>)}{!data.expenses.length && <div className="empty-state">Todavía no hay gastos registrados.</div>}</div></section>
      <section className="card petty-section"><div className="card-head"><h3>Solicitudes de compra</h3><span>{data.requests.filter(item => item.status === 'Pendiente').length} pendientes</span></div><div className="request-list">{data.requests.map(item => <article className={`request-card status-${item.status.toLowerCase()}`} key={item.id}><header><div><strong>{item.description}</strong><span>{item.requesterName} · {formatDate(item.createdAt)}</span></div><span>{item.status}</span></header><p>{item.justification || 'Sin justificación adicional.'}</p><div className="request-meta"><span>Estimado {money(item.estimatedAmount)}</span><span>{item.requestedSupplier || 'Proveedor a definir'}</span></div>{item.status !== 'Pendiente' && <small>{item.finalSupplier ? `${item.finalSupplier} · ${money(item.finalCost)}` : item.resolutionNote}</small>}{item.status === 'Pendiente' && data.permissions.manager && <div className="actions"><Button disabled={consultationMode} variant="primary" onClick={() => openResolution(item)}>Resolver</Button><Button disabled={consultationMode} onClick={async () => { await resolvePurchaseRequest(item.id, { status: 'Rechazada', note: 'Rechazada desde caja chica' }); await refresh(); }}>Rechazar</Button></div>}</article>)}{!data.requests.length && <div className="empty-state">No hay solicitudes.</div>}</div></section>
    </div>

    {expense && <Modal title="Registrar gasto" onClose={() => setExpense(null)}><form className="stack" onSubmit={async event => { event.preventDefault(); await createPettyCashExpense(expense); setExpense(null); setMessage('Gasto registrado.'); await refresh(); }}><label>Fecha<input className="input" type="date" required value={expense.expenseDate} onChange={event => setExpense(value => ({ ...value!, expenseDate: event.target.value }))} /></label><label>Descripción<input className="input" required value={expense.description} onChange={event => setExpense(value => ({ ...value!, description: event.target.value }))} /></label><div className="grid-2"><label>Proveedor<input className="input" value={expense.supplier} onChange={event => setExpense(value => ({ ...value!, supplier: event.target.value }))} /></label><label>Categoría<input className="input" value={expense.category} onChange={event => setExpense(value => ({ ...value!, category: event.target.value }))} /></label></div><label>Importe<input className="input" type="number" min="0.01" step="0.01" required value={expense.amount || ''} onChange={event => setExpense(value => ({ ...value!, amount: Number(event.target.value) }))} /></label><ReceiptField url={expense.receiptUrl} onUpload={async file => { const receiptUrl = await uploadReceipt(file); setExpense(value => ({ ...value!, receiptUrl })); }} /><div className="actions"><Button variant="primary" type="submit">Registrar gasto</Button><Button type="button" onClick={() => setExpense(null)}>Cancelar</Button></div></form></Modal>}

    {request && <Modal title="Solicitar compra" onClose={() => setRequest(null)}><form className="stack" onSubmit={async event => { event.preventDefault(); await createPurchaseRequest(request); setRequest(null); setMessage('Solicitud enviada.'); await refresh(); }}><label>Qué necesitás comprar<input className="input" required value={request.description} onChange={event => setRequest(value => ({ ...value!, description: event.target.value }))} /></label><div className="grid-2"><label>Categoría<input className="input" value={request.category} onChange={event => setRequest(value => ({ ...value!, category: event.target.value }))} /></label><label>Importe estimado<input className="input" type="number" min="0" step="0.01" value={request.estimatedAmount || ''} onChange={event => setRequest(value => ({ ...value!, estimatedAmount: Number(event.target.value) }))} /></label></div><label>Proveedor sugerido<input className="input" value={request.supplier} onChange={event => setRequest(value => ({ ...value!, supplier: event.target.value }))} /></label><label>Justificación<textarea className="input" rows={3} value={request.justification} onChange={event => setRequest(value => ({ ...value!, justification: event.target.value }))} /></label><ReceiptField url={request.receiptUrl} onUpload={async file => { const receiptUrl = await uploadReceipt(file); setRequest(value => ({ ...value!, receiptUrl })); }} /><div className="actions"><Button variant="primary" type="submit">Enviar solicitud</Button><Button type="button" onClick={() => setRequest(null)}>Cancelar</Button></div></form></Modal>}

    {resolving && <Modal title={`Aprobar solicitud #${resolving.id}`} onClose={() => setResolving(null)}><form className="stack" onSubmit={async event => { event.preventDefault(); await resolvePurchaseRequest(resolving.id, { status: 'Aprobada', finalCost: resolution.finalCost, supplier: resolution.supplier, note: resolution.note, addToInventory: resolution.addToInventory, inventory: { nombre: resolving.description, categoria: resolving.category, cantidad: resolution.cantidad, unidad: 'unidades', estado: 'Nuevo' } }); setResolving(null); setMessage('Compra aprobada y descontada del saldo.'); await refresh(); }}><p className="muted">Al aprobar se crea el gasto automáticamente y se notifica a {resolving.requesterName}.</p><div className="grid-2"><label>Costo final<input className="input" type="number" min="0.01" step="0.01" required value={resolution.finalCost || ''} onChange={event => setResolution(value => ({ ...value, finalCost: Number(event.target.value) }))} /></label><label>Proveedor<input className="input" required value={resolution.supplier} onChange={event => setResolution(value => ({ ...value, supplier: event.target.value }))} /></label></div><label>Nota de resolución<textarea className="input" rows={2} value={resolution.note} onChange={event => setResolution(value => ({ ...value, note: event.target.value }))} /></label><label className="switch-line"><input type="checkbox" checked={resolution.addToInventory} onChange={event => setResolution(value => ({ ...value, addToInventory: event.target.checked }))} /><span>Registrar también en Inventario TIC</span></label>{resolution.addToInventory && <label>Cantidad<input className="input" type="number" min="1" value={resolution.cantidad} onChange={event => setResolution(value => ({ ...value, cantidad: Number(event.target.value) }))} /></label>}<div className="actions"><Button variant="primary" type="submit">Aprobar y descontar</Button><Button type="button" onClick={() => setResolving(null)}>Cancelar</Button></div></form></Modal>}
  </section>;
}

function ReceiptField({ url, onUpload }: { url: string; onUpload: (file: File) => void | Promise<void> }) { return <label>Comprobante (opcional)<span className="receipt-field"><input className="input" value={url} readOnly placeholder="Sin archivo" /><label className="btn">Adjuntar<input type="file" accept="image/*,.pdf" onChange={event => { const file = event.target.files?.[0]; if (file) void onUpload(file); }} /></label></span></label>; }
function money(value: number) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(value || 0); }
function formatDate(value: string) { const date = String(value || '').slice(0, 10); return date ? date.split('-').reverse().join('/') : '—'; }
function readFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

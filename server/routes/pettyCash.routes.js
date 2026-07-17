import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { canEditModule, canViewModule, isSiteManager, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins, notifyUser } from '../services/notifications.service.js';

export const pettyCashRouter = Router();
const RECEIPT_TYPES = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['application/pdf', 'pdf']]);
const REQUEST_STATES = new Set(['Aprobada', 'Rechazada']);

pettyCashRouter.get('/petty-cash', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'pettycash', siteCode)) return forbidden(res);
  ensureConfig(siteCode);
  const configRow = getDb().prepare('SELECT * FROM petty_cash_config WHERE site_code=?').get(siteCode);
  const expenses = getDb().prepare('SELECT * FROM petty_cash_expenses WHERE site_code=? ORDER BY expense_date DESC, id DESC').all(siteCode).map(rowToExpense);
  const requests = getDb().prepare('SELECT * FROM purchase_requests WHERE site_code=? ORDER BY CASE status WHEN \'Pendiente\' THEN 0 ELSE 1 END, id DESC').all(siteCode).map(rowToRequest);
  const spent = expenses.reduce((total, item) => total + item.amount, 0);
  res.json({
    ok: true,
    config: { initialAmount: Number(configRow.initial_amount || 0), requestsEnabled: true },
    balance: Number(configRow.initial_amount || 0) - spent,
    spent,
    expenses,
    requests,
    permissions: { manager: isSiteManager(req, siteCode), canRequest: canEditModule(req, 'pettycash', siteCode) }
  });
});

pettyCashRouter.patch('/petty-cash/config', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return forbidden(res, 'Solo un administrador puede configurar la caja chica.');
  ensureConfig(siteCode);
  const amount = Number(req.body?.initialAmount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ ok: false, error: 'El fondo inicial debe ser un importe válido.' });
  getDb().prepare('UPDATE petty_cash_config SET initial_amount=?, requests_enabled=1, updated_by=?, updated_at=? WHERE site_code=?')
    .run(amount, req.user?.nombre || req.user?.email || '', nowIso(), siteCode);
  res.json({ ok: true, config: { initialAmount: amount, requestsEnabled: true } });
});

pettyCashRouter.post('/petty-cash/expenses', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return forbidden(res, 'Solo un administrador puede registrar gastos directos.');
  const payload = normalizeExpense(req.body);
  const error = validateExpense(payload);
  if (error) return res.status(400).json({ ok: false, error });
  ensureConfig(siteCode);
  const balance = currentBalance(siteCode);
  if (payload.amount > balance) return res.status(400).json({ ok: false, error: 'El gasto supera el saldo disponible.' });
  const info = insertExpense(siteCode, payload, req.user?.nombre || req.user?.email || '');
  try { notifySiteAdmins({ siteCode, kind: 'pettycash.expense', title: 'Nuevo gasto de caja chica', body: `${payload.description} · $${payload.amount.toLocaleString('es-AR')}`, link: `/sede/${siteCode}/pettycash`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToExpense(getDb().prepare('SELECT * FROM petty_cash_expenses WHERE id=?').get(info.lastInsertRowid)), balance: currentBalance(siteCode) });
});

pettyCashRouter.post('/petty-cash/requests', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'pettycash', siteCode)) return forbidden(res);
  ensureConfig(siteCode);
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ ok: false, error: 'La descripción es obligatoria.' });
  const estimated = Number(req.body?.estimatedAmount || 0);
  if (!Number.isFinite(estimated) || estimated < 0) return res.status(400).json({ ok: false, error: 'El importe estimado no es válido.' });
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO purchase_requests (site_code, description, category, estimated_amount, requested_supplier, justification, receipt_url, status, requester_email, requester_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?)
  `).run(siteCode, description, String(req.body?.category || 'General').trim(), estimated, String(req.body?.supplier || '').trim(), String(req.body?.justification || '').trim(), String(req.body?.receiptUrl || '').trim(), req.user?.email || '', req.user?.nombre || req.user?.email || '', ts, ts);
  try { notifySiteAdmins({ siteCode, kind: 'pettycash.requested', title: 'Nueva solicitud de compra', body: `${req.user?.nombre || req.user?.email}: ${description}`, link: `/sede/${siteCode}/pettycash`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToRequest(getDb().prepare('SELECT * FROM purchase_requests WHERE id=?').get(info.lastInsertRowid)) });
});

pettyCashRouter.patch('/petty-cash/requests/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return forbidden(res, 'Solo un administrador puede aprobar o rechazar solicitudes.');
  const request = getDb().prepare("SELECT * FROM purchase_requests WHERE id=? AND site_code=? AND status='Pendiente'").get(req.params.id, siteCode);
  if (!request) return res.status(404).json({ ok: false, error: 'Solicitud pendiente no encontrada.' });
  const status = String(req.body?.status || '');
  if (!REQUEST_STATES.has(status)) return res.status(400).json({ ok: false, error: 'Resolución inválida.' });
  const ts = nowIso();
  let expenseId = null;
  let inventoryItemId = null;
  if (status === 'Aprobada') {
    const finalCost = Number(req.body?.finalCost);
    const supplier = String(req.body?.supplier || '').trim();
    if (!Number.isFinite(finalCost) || finalCost <= 0 || !supplier) return res.status(400).json({ ok: false, error: 'Costo final y proveedor son obligatorios para aprobar.' });
    if (finalCost > currentBalance(siteCode)) return res.status(400).json({ ok: false, error: 'La compra supera el saldo disponible.' });
    getDb().transaction(() => {
      const expense = insertExpense(siteCode, {
        expenseDate: String(req.body?.expenseDate || ts.slice(0, 10)),
        description: request.description,
        supplier,
        amount: finalCost,
        category: request.category || 'General',
        receiptUrl: String(req.body?.receiptUrl || request.receipt_url || ''),
        purchaseRequestId: request.id
      }, req.user?.nombre || req.user?.email || '');
      expenseId = expense.lastInsertRowid;
      if (req.body?.addToInventory) {
        const inv = req.body?.inventory || {};
        const inventory = getDb().prepare(`
          INSERT INTO inventory_items (site_code, nombre, categoria, cantidad, unidad, imagen_url, estado, observaciones, activo, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(siteCode, String(inv.nombre || request.description).trim(), String(inv.categoria || request.category || 'Otro').trim(), Math.max(1, Number(inv.cantidad || 1)), String(inv.unidad || 'unidades').trim(), String(inv.imagenUrl || '').trim(), String(inv.estado || 'Nuevo').trim(), `Compra aprobada #${request.id} · ${supplier} · $${finalCost}`, ts, ts);
        inventoryItemId = inventory.lastInsertRowid;
        getDb().prepare('UPDATE petty_cash_expenses SET inventory_item_id=? WHERE id=?').run(inventoryItemId, expenseId);
      }
      getDb().prepare(`
        UPDATE purchase_requests SET status='Aprobada', final_cost=?, final_supplier=?, resolution_note=?, resolved_by=?, resolved_at=?, updated_at=?
        WHERE id=? AND site_code=?
      `).run(finalCost, supplier, String(req.body?.note || ''), req.user?.nombre || req.user?.email || '', ts, ts, request.id, siteCode);
    })();
  } else {
    getDb().prepare(`
      UPDATE purchase_requests SET status='Rechazada', resolution_note=?, resolved_by=?, resolved_at=?, updated_at=?
      WHERE id=? AND site_code=?
    `).run(String(req.body?.note || ''), req.user?.nombre || req.user?.email || '', ts, ts, request.id, siteCode);
  }
  try {
    notifyUser({ siteCode, email: request.requester_email, kind: `pettycash.${status === 'Aprobada' ? 'approved' : 'rejected'}`, title: `Solicitud ${status.toLowerCase()}`, body: request.description, link: `/sede/${siteCode}/pettycash`, payload: { requestId: request.id, expenseId, inventoryItemId } });
  } catch { /* noop */ }
  res.json({ ok: true, item: rowToRequest(getDb().prepare('SELECT * FROM purchase_requests WHERE id=? AND site_code=?').get(request.id, siteCode)), expenseId, inventoryItemId, balance: currentBalance(siteCode) });
});

pettyCashRouter.post('/petty-cash/upload-receipt', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'pettycash', siteCode)) return forbidden(res);
  const mime = String(req.body?.mimeType || '').toLowerCase();
  const ext = RECEIPT_TYPES.get(mime);
  const raw = String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!ext || !raw) return res.status(400).json({ ok: false, error: 'El comprobante debe ser una imagen o PDF.' });
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > config.maxUploadMb * 1024 * 1024) return res.status(400).json({ ok: false, error: `El archivo supera ${config.maxUploadMb} MB.` });
  const dir = path.join(config.rootDir, 'data', 'uploads', 'petty-cash', siteCode);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  res.json({ ok: true, url: `/uploads/petty-cash/${siteCode}/${name}` });
});

function ensureConfig(siteCode) {
  getDb().prepare('INSERT INTO petty_cash_config (site_code, initial_amount, requests_enabled, updated_at) VALUES (?, 0, 1, ?) ON CONFLICT(site_code) DO NOTHING').run(siteCode, nowIso());
}

function currentBalance(siteCode) {
  ensureConfig(siteCode);
  const cfg = getDb().prepare('SELECT initial_amount FROM petty_cash_config WHERE site_code=?').get(siteCode);
  const sum = getDb().prepare('SELECT COALESCE(SUM(amount),0) AS total FROM petty_cash_expenses WHERE site_code=?').get(siteCode);
  return Number(cfg?.initial_amount || 0) - Number(sum?.total || 0);
}

function normalizeExpense(raw = {}) {
  return { expenseDate: String(raw.expenseDate || raw.date || nowIso().slice(0, 10)), description: String(raw.description || '').trim(), supplier: String(raw.supplier || '').trim(), amount: Number(raw.amount), category: String(raw.category || 'General').trim(), receiptUrl: String(raw.receiptUrl || '').trim(), purchaseRequestId: raw.purchaseRequestId || null };
}
function validateExpense(item) { if (!item.description) return 'La descripción es obligatoria.'; if (!Number.isFinite(item.amount) || item.amount <= 0) return 'El importe debe ser mayor a cero.'; if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expenseDate)) return 'La fecha no es válida.'; return ''; }
function insertExpense(siteCode, item, createdBy) { const ts = nowIso(); return getDb().prepare('INSERT INTO petty_cash_expenses (site_code, expense_date, description, supplier, amount, category, receipt_url, purchase_request_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(siteCode, item.expenseDate, item.description, item.supplier || '', item.amount, item.category || 'General', item.receiptUrl || '', item.purchaseRequestId || null, createdBy, ts, ts); }
function rowToExpense(row) { return { id: row.id, expenseDate: row.expense_date, description: row.description, supplier: row.supplier || '', amount: Number(row.amount || 0), category: row.category || 'General', receiptUrl: row.receipt_url || '', purchaseRequestId: row.purchase_request_id || null, inventoryItemId: row.inventory_item_id || null, createdBy: row.created_by || '', createdAt: row.created_at || '' }; }
function rowToRequest(row) { return { id: row.id, description: row.description, category: row.category || 'General', estimatedAmount: Number(row.estimated_amount || 0), requestedSupplier: row.requested_supplier || '', justification: row.justification || '', receiptUrl: row.receipt_url || '', status: row.status || 'Pendiente', requesterEmail: row.requester_email || '', requesterName: row.requester_name || '', finalCost: Number(row.final_cost || 0), finalSupplier: row.final_supplier || '', resolutionNote: row.resolution_note || '', resolvedBy: row.resolved_by || '', resolvedAt: row.resolved_at || '', createdAt: row.created_at || '' }; }
function forbidden(res, error = 'No tenés permiso para acceder a caja chica.') { return res.status(403).json({ ok: false, error }); }

import { Router } from 'express';
import { proxyAppsScript } from '../services/appsScript.service.js';
import { addLocalMovement, getDb, nowIso, setLocalState } from '../db.js';
import { invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const loansRouter = Router();

const WRITE_TIMEOUT_MS = 20000;

loansRouter.post('/loans/lend', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    const payload = {
      ...req.body,
      etiqueta,
      siteCode,
      estado: 'Prestado',
      prestada: req.body.person || '',
      prestadoA: req.body.person || '',
      persona: req.body.person || '',
      fechaPrestado: new Date().toISOString()
    };
    let syncResult = { synced: true, message: 'Sincronizado con Google Sheets.' };
    try {
      await proxyAppsScript('loan', payload, 'POST', { siteCode, timeoutMs: WRITE_TIMEOUT_MS });
    } catch (error) {
      syncResult = markPendingSync(siteCode, 'loan', etiqueta, payload, error);
    }
    setLocalState(etiqueta, {
      estado: 'Prestado',
      prestadoA: req.body.person || '',
      rol: req.body.role || '',
      ubicacion: req.body.location || '',
      ubicacionDetalle: req.body.locationDetail || '',
      curso: req.body.course || '',
      motivo: req.body.reason || '',
      motivoDetalle: req.body.reasonDetail || '',
      comentarios: req.body.comment || '',
      loanedAt: payload.fechaPrestado,
      returnedAt: '',
      siteCode
    });
    invalidateDeviceInventoryCache('loan-lend', siteCode);
    addLocalMovement({ tipo: 'préstamo', descripcion: `${etiqueta} prestada a ${req.body.person || ''}`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, syncing: !syncResult.synced, synced: syncResult.synced, message: syncResult.message, pendingSyncId: syncResult.pendingSyncId || null });
  } catch (error) {
    next(error);
  }
});

loansRouter.post('/loans/return', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    const payload = {
      ...req.body,
      etiqueta,
      siteCode,
      estado: 'Devuelto',
      prestada: '',
      prestadoA: '',
      persona: '',
      person: '',
      comment: '',
      role: '',
      location: '',
      reason: '',
      fechaDevuelto: new Date().toISOString()
    };
    let syncResult = { synced: true, message: 'Sincronizado con Google Sheets.' };
    try {
      await proxyAppsScript('return', payload, 'POST', { siteCode, timeoutMs: WRITE_TIMEOUT_MS });
    } catch (error) {
      syncResult = markPendingSync(siteCode, 'return', etiqueta, payload, error);
    }
    setLocalState(etiqueta, {
      estado: 'Disponible',
      prestadoA: '',
      rol: '',
      ubicacion: '',
      motivo: '',
      comentarios: '',
      loanedAt: '',
      returnedAt: payload.fechaDevuelto,
      siteCode
    });
    invalidateDeviceInventoryCache('loan-return', siteCode);
    addLocalMovement({ tipo: 'devolución', descripcion: `${etiqueta} devuelta`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, syncing: !syncResult.synced, synced: syncResult.synced, message: syncResult.message, pendingSyncId: syncResult.pendingSyncId || null });
  } catch (error) {
    next(error);
  }
});

function markPendingSync(siteCode, action, etiqueta, payload, error) {
  const ts = nowIso();
  const message = error instanceof Error ? error.message : String(error || 'Error desconocido');
  const result = getDb().prepare(`
    INSERT INTO pending_sheet_sync (site_code, action, etiqueta, payload_json, status, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(siteCode, action, String(etiqueta || ''), JSON.stringify(payload || {}), message, ts, ts);
  console.warn(`[loans/${action} sync:${siteCode}] pendiente de sincronizar: ${message}`);
  return {
    synced: false,
    pendingSyncId: result.lastInsertRowid,
    message: `No se pudo sincronizar con Google Sheets. La operación quedó local pendiente de sincronización. Detalle: ${message}`
  };
}

function normalizeEtiqueta(value) {
  return String(value || '').trim().toUpperCase();
}

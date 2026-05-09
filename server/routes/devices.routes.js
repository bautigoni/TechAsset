import { Router } from 'express';
import { proxyAppsScript } from '../services/appsScript.service.js';
import { addLocalMovement, getDb, nowIso, setLocalState } from '../db.js';
import { getDeviceInventoryDiagnostics, getMergedDevices, invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const devicesRouter = Router();

devicesRouter.get('/devices', async (_req, res, next) => {
  try {
    const forceRefresh = _req.query.refresh === '1' || _req.query.refresh === 'true';
    const waitForFresh = _req.query.wait === '1' || _req.query.wait === 'true';
    const { items, source, loadedAt, diagnostics } = await getMergedDevices({ forceRefresh, waitForFresh, siteCode: requireSite(_req) });
    res.json({ ok: true, items, loadedAt: loadedAt || new Date().toISOString(), source, diagnostics });
  } catch (error) {
    next(error);
  }
});

devicesRouter.get('/devices/diagnostics', (_req, res) => {
  res.json({ ok: true, diagnostics: getDeviceInventoryDiagnostics(requireSite(_req)) });
});

devicesRouter.get('/devices/debug', async (_req, res) => {
  const siteCode = requireSite(_req);
  try {
    const debug = await proxyAppsScript('debug', { siteCode }, 'GET', { siteCode, timeoutMs: 12000 });
    res.json({ ok: true, siteCode, debug });
  } catch (error) {
    res.status(502).json({
      ok: false,
      siteCode,
      error: error instanceof Error ? error.message : 'No se pudo consultar el diagnóstico de Apps Script.'
    });
  }
});

devicesRouter.get('/devices/pending-sync', (_req, res) => {
  const siteCode = requireSite(_req);
  const items = getDb().prepare(`
    SELECT id, site_code AS siteCode, action, etiqueta, status, error, created_at AS createdAt, updated_at AS updatedAt
    FROM pending_sheet_sync
    WHERE site_code=? AND status='pending'
    ORDER BY id DESC
  `).all(siteCode);
  res.json({ ok: true, items });
});

devicesRouter.post('/devices/pending-sync/:id/retry', async (_req, res) => {
  const siteCode = requireSite(_req);
  const id = Number(_req.params.id);
  const row = getDb().prepare('SELECT * FROM pending_sheet_sync WHERE id=? AND site_code=?').get(id, siteCode);
  if (!row) return res.status(404).json({ ok: false, error: 'Sincronización pendiente no encontrada.' });
  try {
    const payload = JSON.parse(row.payload_json || '{}');
    await proxyAppsScript(row.action, payload, 'POST', { siteCode, timeoutMs: 20000 });
    getDb().prepare("UPDATE pending_sheet_sync SET status='synced', error='', updated_at=? WHERE id=?").run(nowIso(), id);
    invalidateDeviceInventoryCache('pending-sync-retry', siteCode);
    res.json({ ok: true, synced: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Error desconocido');
    getDb().prepare("UPDATE pending_sheet_sync SET error=?, updated_at=? WHERE id=?").run(message, nowIso(), id);
    res.status(502).json({ ok: false, error: message });
  }
});

devicesRouter.get('/device-categories', async (_req, res, next) => {
  try {
    const siteCode = requireSite(_req);
    const dbRows = getDb().prepare('SELECT nombre, color, icono FROM device_categories WHERE activo=1 AND site_code=? ORDER BY nombre').all(siteCode);
    const { items } = await getMergedDevices({ siteCode });
    const names = new Set(['Plani', 'Touch', 'TIC', 'Dell', 'Tablet', 'Notebook', 'Chromebook', 'Camara', 'Proyector', 'Router', 'Impresora', 'Otro']);
    dbRows.forEach(row => row.nombre && names.add(row.nombre));
    items.forEach(item => item.categoria && names.add(item.categoria));
    res.json({ ok: true, items: [...names].sort().map(nombre => ({ nombre })) });
  } catch (error) {
    next(error);
  }
});

// Borra del estado local SQLite las filas triviales (Disponible/Devuelto/vacías),
// dejando solo los préstamos activos. Útil cuando la planilla es la fuente de verdad
// y local_states acumuló restos de pruebas.
devicesRouter.post('/devices/sync-from-sheet', (_req, res) => {
  const result = getDb().prepare(`
    DELETE FROM local_states
    WHERE site_code=?
      AND (
        estado IS NULL
        OR TRIM(estado) = ''
        OR TRIM(estado) = 'Disponible'
        OR TRIM(estado) = 'Devuelto'
      )
  `).run(requireSite(_req));
  invalidateDeviceInventoryCache('sync-from-sheet', requireSite(_req));
  res.json({ ok: true, removed: result.changes });
});

devicesRouter.get('/devices/state', async (_req, res, next) => {
  try {
    const { items, source } = await getMergedDevices({ siteCode: requireSite(_req) });
    res.json({ ok: true, rows: items.map(item => ({
      etiqueta: item.etiqueta,
      estado: item.estado,
      prestadoA: item.prestadoA,
      rol: item.rol,
      ubicacion: item.ubicacion,
      motivo: item.motivo,
      loanedAt: item.loanedAt,
      returnedAt: item.returnedAt
    })), source });
  } catch (error) {
    next(error);
  }
});

devicesRouter.post('/devices/add', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const payload = normalizeDevicePayload({ ...req.body, siteCode });
    if (!payload.etiqueta) return res.status(400).json({ ok: false, error: 'La etiqueta es obligatoria.' });
    if (!payload.categoria) return res.status(400).json({ ok: false, error: 'La categoría es obligatoria.' });
    saveCategory(payload.categoria, siteCode);
    saveLocalDevice(payload, siteCode);
    invalidateDeviceInventoryCache('device-added', siteCode);
    addLocalMovement({ tipo: 'dispositivo agregado', descripcion: `${payload.etiqueta || ''} agregado`, operador: payload.operator, origen: 'Google Sheets', etiqueta: payload.etiqueta, siteCode });
    res.json({ ok: true, item: payload, syncing: true });
    proxyAppsScript('adddevice', payload, 'POST', { siteCode }).catch(error => console.warn(`[devices/add sync:${siteCode}]`, error?.message || error));
  } catch (error) {
    next(error);
  }
});

devicesRouter.patch('/devices/:etiqueta', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const originalEtiqueta = String(req.params.etiqueta || req.body?.originalEtiqueta || '').trim().toUpperCase().replace(/\s+/g, '');
    const payload = normalizeDevicePayload({ ...req.body, etiqueta: req.body?.etiqueta || originalEtiqueta, siteCode });
    if (!originalEtiqueta || !payload.etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    saveCategory(payload.categoria, siteCode);
    if (payload.etiqueta !== originalEtiqueta) {
      getDb().prepare('DELETE FROM local_devices WHERE etiqueta=? AND site_code=?').run(originalEtiqueta, siteCode);
      getDb().prepare('DELETE FROM hidden_devices WHERE etiqueta=? AND site_code=?').run(payload.etiqueta, siteCode);
    }
    saveLocalDevice(payload, siteCode);
    invalidateDeviceInventoryCache('device-updated', siteCode);
    addLocalMovement({ tipo: 'dispositivo editado', descripcion: `${originalEtiqueta} actualizado`, operador: payload.operator, origen: 'Local', etiqueta: payload.etiqueta, siteCode });
    res.json({ ok: true, item: payload, syncing: true });
    proxyAppsScript('adddevice', payload, 'POST', { siteCode }).catch(error => console.warn(`[devices/edit sync:${siteCode}]`, error?.message || error));
  } catch (error) {
    next(error);
  }
});

devicesRouter.post('/devices/status', async (req, res, next) => {
  try {
    const estado = String(req.body.estado || '');
    const siteCode = requireSite(req);
    setLocalState(req.body.etiqueta, {
      estado,
      comentarios: req.body.comentario || req.body.comentarios || '',
      prestadoA: '',
      rol: '',
      ubicacion: '',
      motivo: '',
      loanedAt: '',
      returnedAt: estado === 'Disponible' ? nowIso() : '',
      siteCode
    });
    invalidateDeviceInventoryCache('device-status', siteCode);
    addLocalMovement({ tipo: 'estado dispositivo', descripcion: `${req.body.etiqueta} -> ${req.body.estado}`, operador: req.body.operator, origen: 'Local', etiqueta: req.body.etiqueta, siteCode });
    res.json({ ok: true, syncing: true });
    proxyAppsScript('status', { ...req.body, siteCode }, 'POST', { siteCode }).catch(error => console.warn(`[devices/status sync:${siteCode}]`, error?.message || error));
  } catch (error) {
    next(error);
  }
});

devicesRouter.delete('/devices/:etiqueta', (req, res, next) => {
  try {
    const etiqueta = String(req.params.etiqueta || '').trim().toUpperCase().replace(/\s+/g, '');
    const siteCode = requireSite(req);
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const operator = String(req.body?.operator || req.query.operator || '');
    const ts = nowIso();
    getDb().prepare(`
      INSERT INTO hidden_devices (etiqueta, site_code, deleted_at, deleted_by, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(site_code, etiqueta) DO UPDATE SET deleted_at=excluded.deleted_at, deleted_by=excluded.deleted_by, reason=excluded.reason
    `).run(etiqueta, siteCode, ts, operator, 'Borrado desde Dispositivos');
    getDb().prepare('UPDATE local_devices SET eliminado=1, deleted_at=?, deleted_by=? WHERE etiqueta=? AND site_code=?').run(ts, operator, etiqueta, siteCode);
    invalidateDeviceInventoryCache('device-deleted', siteCode);
    addLocalMovement({ tipo: 'dispositivo borrado', descripcion: `${etiqueta} ocultado de la app`, operador: operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, etiqueta });
  } catch (error) {
    next(error);
  }
});

devicesRouter.get('/devices/deleted', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM hidden_devices WHERE site_code=? ORDER BY deleted_at DESC').all(requireSite(_req));
  res.json({ ok: true, items: rows });
});

devicesRouter.get('/movements', (_req, res) => {
  const siteCode = requireSite(_req);
  const local = getDb().prepare('SELECT timestamp, tipo, descripcion, operador, origen, etiqueta FROM local_movements WHERE site_code=? ORDER BY id DESC LIMIT 100').all(siteCode);
  const agenda = getDb().prepare(`
    SELECT h.timestamp, h.accion AS tipo, COALESCE(a.curso || ' - ' || a.actividad, h.accion) AS descripcion, h.operador, 'Agenda TIC' AS origen, '' AS etiqueta
    FROM agenda_history h LEFT JOIN agenda a ON a.id=h.agenda_id AND a.site_code=h.site_code
    WHERE h.site_code=?
    ORDER BY h.id DESC LIMIT 100
  `).all(siteCode);
  const tasks = getDb().prepare(`
    SELECT timestamp, accion AS tipo, titulo AS descripcion, operador, 'Tareas TIC' AS origen, '' AS etiqueta
    FROM task_history WHERE site_code=? ORDER BY id DESC LIMIT 100
  `).all(siteCode);
  res.json({ ok: true, items: [...local, ...agenda, ...tasks].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 100) });
});

function saveLocalDevice(payload, siteCode) {
  const etiqueta = String(payload.etiqueta || '').trim();
  if (!etiqueta) return;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO local_devices (etiqueta, site_code, payload, eliminado, deleted_at, deleted_by, created_at, updated_at)
    VALUES (?, ?, ?, 0, '', '', ?, ?)
    ON CONFLICT(site_code, etiqueta) DO UPDATE SET payload=excluded.payload, eliminado=0, deleted_at='', deleted_by='', updated_at=excluded.updated_at
  `).run(etiqueta, siteCode, JSON.stringify({ ...payload, siteCode }), ts, ts);
}

function saveCategory(nombre, siteCode) {
  const clean = normalizeCategory(nombre);
  if (!clean) return;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO device_categories (site_code, nombre, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(site_code, nombre) DO UPDATE SET activo=1, updated_at=excluded.updated_at
  `).run(siteCode, clean, ts, ts);
}

function normalizeDevicePayload(raw) {
  const aliasOperativo = String(raw.aliasOperativo || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .join(', ');
  return {
    ...raw,
    etiqueta: String(raw.etiqueta || '').trim().toUpperCase().replace(/\s+/g, ''),
    categoria: normalizeCategory(raw.categoria || raw.tipo || raw.dispositivo || ''),
    dispositivo: String(raw.dispositivo || raw.categoria || 'Chromebook').trim(),
    aliasOperativo,
    aliasOperativoJson: aliasOperativo ? JSON.stringify(aliasOperativo.split(',').map(item => item.trim()).filter(Boolean)) : '',
    estado: ['Disponible', 'Prestado', 'No encontrada', 'Fuera de servicio'].includes(raw.estado) ? raw.estado : 'Disponible'
  };
}

function normalizeCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const text = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (text.includes('tablet')) return 'Tablet';
  if (text.includes('plani') || text.includes('planificacion')) return 'Plani';
  if (text === 'touch') return 'Touch';
  if (text === 'tic') return 'TIC';
  if (text === 'dell') return 'Dell';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

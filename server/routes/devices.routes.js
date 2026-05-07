import { Router } from 'express';
import { proxyAppsScript } from '../services/appsScript.service.js';
import { addLocalMovement, getDb, nowIso, setLocalState } from '../db.js';
import { getDeviceInventoryDiagnostics, getMergedDevices, invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';

export const devicesRouter = Router();

devicesRouter.get('/devices', async (_req, res, next) => {
  try {
    const forceRefresh = _req.query.refresh === '1' || _req.query.refresh === 'true';
    const waitForFresh = _req.query.wait === '1' || _req.query.wait === 'true';
    const { items, source, loadedAt, diagnostics } = await getMergedDevices({ forceRefresh, waitForFresh });
    res.json({ ok: true, items, loadedAt: loadedAt || new Date().toISOString(), source, diagnostics });
  } catch (error) {
    next(error);
  }
});

devicesRouter.get('/devices/diagnostics', (_req, res) => {
  res.json({ ok: true, diagnostics: getDeviceInventoryDiagnostics() });
});

devicesRouter.get('/device-categories', async (_req, res, next) => {
  try {
    const dbRows = getDb().prepare('SELECT nombre, color, icono FROM device_categories WHERE activo=1 ORDER BY nombre').all();
    const { items } = await getMergedDevices();
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
    WHERE estado IS NULL
       OR TRIM(estado) = ''
       OR TRIM(estado) = 'Disponible'
       OR TRIM(estado) = 'Devuelto'
  `).run();
  invalidateDeviceInventoryCache('sync-from-sheet');
  res.json({ ok: true, removed: result.changes });
});

devicesRouter.get('/devices/state', async (_req, res, next) => {
  try {
    const { items, source } = await getMergedDevices();
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
    const payload = normalizeDevicePayload(req.body);
    if (!payload.etiqueta) return res.status(400).json({ ok: false, error: 'La etiqueta es obligatoria.' });
    if (!payload.categoria) return res.status(400).json({ ok: false, error: 'La categoría es obligatoria.' });
    saveCategory(payload.categoria);
    saveLocalDevice(payload);
    invalidateDeviceInventoryCache('device-added');
    addLocalMovement({ tipo: 'dispositivo agregado', descripcion: `${payload.etiqueta || ''} agregado`, operador: payload.operator, origen: 'Google Sheets', etiqueta: payload.etiqueta });
    res.json({ ok: true, item: payload, syncing: true });
    proxyAppsScript('adddevice', payload).catch(error => console.warn('[devices/add sync]', error?.message || error));
  } catch (error) {
    next(error);
  }
});

devicesRouter.post('/devices/status', async (req, res, next) => {
  try {
    const estado = String(req.body.estado || '');
    setLocalState(req.body.etiqueta, {
      estado,
      comentarios: req.body.comentario || req.body.comentarios || '',
      prestadoA: '',
      rol: '',
      ubicacion: '',
      motivo: '',
      loanedAt: '',
      returnedAt: estado === 'Disponible' ? nowIso() : ''
    });
    invalidateDeviceInventoryCache('device-status');
    addLocalMovement({ tipo: 'estado dispositivo', descripcion: `${req.body.etiqueta} -> ${req.body.estado}`, operador: req.body.operator, origen: 'Local', etiqueta: req.body.etiqueta });
    res.json({ ok: true, syncing: true });
    proxyAppsScript('status', req.body).catch(error => console.warn('[devices/status sync]', error?.message || error));
  } catch (error) {
    next(error);
  }
});

devicesRouter.delete('/devices/:etiqueta', (req, res, next) => {
  try {
    const etiqueta = String(req.params.etiqueta || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const operator = String(req.body?.operator || req.query.operator || '');
    const ts = nowIso();
    getDb().prepare(`
      INSERT INTO hidden_devices (etiqueta, deleted_at, deleted_by, reason)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(etiqueta) DO UPDATE SET deleted_at=excluded.deleted_at, deleted_by=excluded.deleted_by, reason=excluded.reason
    `).run(etiqueta, ts, operator, 'Borrado desde Dispositivos');
    getDb().prepare('DELETE FROM local_devices WHERE etiqueta=?').run(etiqueta);
    invalidateDeviceInventoryCache('device-deleted');
    addLocalMovement({ tipo: 'dispositivo borrado', descripcion: `${etiqueta} ocultado de la app`, operador: operator, origen: 'Local', etiqueta });
    res.json({ ok: true, etiqueta });
  } catch (error) {
    next(error);
  }
});

devicesRouter.get('/devices/deleted', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM hidden_devices ORDER BY deleted_at DESC').all();
  res.json({ ok: true, items: rows });
});

devicesRouter.get('/movements', (_req, res) => {
  const local = getDb().prepare('SELECT timestamp, tipo, descripcion, operador, origen, etiqueta FROM local_movements ORDER BY id DESC LIMIT 100').all();
  const agenda = getDb().prepare(`
    SELECT h.timestamp, h.accion AS tipo, COALESCE(a.curso || ' - ' || a.actividad, h.accion) AS descripcion, h.operador, 'Agenda TIC' AS origen, '' AS etiqueta
    FROM agenda_history h LEFT JOIN agenda a ON a.id=h.agenda_id
    ORDER BY h.id DESC LIMIT 100
  `).all();
  const tasks = getDb().prepare(`
    SELECT timestamp, accion AS tipo, titulo AS descripcion, operador, 'Tareas TIC' AS origen, '' AS etiqueta
    FROM task_history ORDER BY id DESC LIMIT 100
  `).all();
  res.json({ ok: true, items: [...local, ...agenda, ...tasks].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 100) });
});

function saveLocalDevice(payload) {
  const etiqueta = String(payload.etiqueta || '').trim();
  if (!etiqueta) return;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO local_devices (etiqueta, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(etiqueta) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
  `).run(etiqueta, JSON.stringify(payload), ts, ts);
}

function saveCategory(nombre) {
  const clean = normalizeCategory(nombre);
  if (!clean) return;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO device_categories (nombre, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(nombre) DO UPDATE SET activo=1, updated_at=excluded.updated_at
  `).run(clean, ts, ts);
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

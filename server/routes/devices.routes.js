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
    saveLocalDevice(req.body);
    invalidateDeviceInventoryCache('device-added');
    addLocalMovement({ tipo: 'dispositivo agregado', descripcion: `${req.body.etiqueta || ''} agregado`, operador: req.body.operator, origen: 'Google Sheets', etiqueta: req.body.etiqueta });
    res.json({ ok: true, item: req.body, syncing: true });
    proxyAppsScript('adddevice', req.body).catch(error => console.warn('[devices/add sync]', error?.message || error));
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

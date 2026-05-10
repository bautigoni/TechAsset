import { Router } from 'express';
import { addLocalMovement, getDb, nowIso, setAppSetting, setLocalState } from '../db.js';
import { buildLocalInventory, getDeviceInventoryDiagnostics, getMergedDevices, invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { parseDevicesCsv, toCsvExportUrl } from '../services/googleSheets.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const devicesRouter = Router();

devicesRouter.get('/devices', async (_req, res, next) => {
  try {
    const { items, source, loadedAt, diagnostics } = await getMergedDevices({ siteCode: requireSite(_req) });
    res.json({ ok: true, items, loadedAt: loadedAt || new Date().toISOString(), source, diagnostics });
  } catch (error) {
    next(error);
  }
});

devicesRouter.get('/devices/diagnostics', (_req, res) => {
  res.json({ ok: true, diagnostics: getDeviceInventoryDiagnostics(requireSite(_req)) });
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

devicesRouter.post('/devices/import', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const csvText = await resolveImportCsv(req.body || {}, siteCode);
    const rows = parseDevicesCsv(csvText);
    const operador = String(
      req.user?.nombre ||
      req.user?.email ||
      req.session?.user?.nombre ||
      req.session?.user?.email ||
      req.body?.operator ||
      req.body?.operador ||
      'Sistema'
    ).trim() || 'Sistema';
    const summary = importDevices(rows, siteCode, operador);
    invalidateDeviceInventoryCache('devices-imported', siteCode);
    setAppSetting(`devices.last_import.${siteCode}`, nowIso());
    res.json({ ok: true, summary });
  } catch (error) {
    next(error);
  }
});

devicesRouter.get('/devices/export/inventory.csv', (_req, res) => {
  const siteCode = requireSite(_req);
  const rows = buildLocalInventory(siteCode);
  sendCsv(res, `techasset_inventario_${siteCode}.csv`, [
    ['Sede', 'Etiqueta', 'Categoría', 'Filtro', 'Dispositivo', 'Modelo', 'Marca', 'S/N', 'MAC', 'Número operativo', 'Alias operativo', 'Estado', 'Prestada a', 'Rol', 'Ubicación', 'Motivo', 'Comentarios', 'Fecha préstamo', 'Fecha devolución', 'Última modificación'],
    ...rows.map(item => [siteCode, item.etiqueta, item.categoria, item.filtro, item.dispositivo, item.modelo, item.marca, item.sn, item.mac, item.numero, item.aliasOperativo, item.estado, item.prestadoA, item.rol, item.ubicacion, item.motivo, item.comentarios, item.loanedAt, item.returnedAt, item.ultima])
  ]);
});

devicesRouter.get('/devices/export/summary.csv', (_req, res) => {
  const siteCode = requireSite(_req);
  const rows = buildLocalInventory(siteCode);
  const groups = new Map();
  for (const item of rows) {
    const key = `${item.filtro || item.categoria || 'Otro'}|${item.estado || 'Disponible'}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  sendCsv(res, `techasset_resumen_${siteCode}.csv`, [
    ['Sede', 'Filtro', 'Estado', 'Cantidad'],
    ...[...groups.entries()].sort().map(([key, count]) => {
      const [categoria, estado] = key.split('|');
      return [siteCode, categoria, estado, count];
    })
  ]);
});

devicesRouter.get('/movements/export.csv', (_req, res) => {
  const siteCode = requireSite(_req);
  const rows = getDb().prepare('SELECT timestamp, tipo, descripcion, operador, origen, etiqueta FROM local_movements WHERE site_code=? ORDER BY timestamp DESC').all(siteCode);
  sendCsv(res, `techasset_movimientos_${siteCode}.csv`, [
    ['Sede', 'Fecha', 'Tipo', 'Etiqueta', 'Descripción', 'Operador', 'Origen'],
    ...rows.map(row => [siteCode, row.timestamp, row.tipo, row.etiqueta, row.descripcion, row.operador, row.origen])
  ]);
});

devicesRouter.get('/loans/export/active.csv', (_req, res) => {
  const siteCode = requireSite(_req);
  const rows = buildLocalInventory(siteCode).filter(item => item.estado === 'Prestado');
  sendCsv(res, `techasset_prestamos_activos_${siteCode}.csv`, [
    ['Sede', 'Etiqueta', 'Alias', 'Prestada a', 'Rol', 'Ubicación', 'Motivo', 'Fecha préstamo'],
    ...rows.map(item => [siteCode, item.etiqueta, item.aliasOperativo, item.prestadoA, item.rol, item.ubicacion, item.motivo, item.loanedAt])
  ]);
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
    addLocalMovement({ tipo: 'dispositivo agregado', descripcion: `${payload.etiqueta || ''} agregado`, operador: payload.operator, origen: 'Local', etiqueta: payload.etiqueta, siteCode });
    res.json({ ok: true, item: payload, syncing: false });
  } catch (error) {
    next(error);
  }
});

devicesRouter.patch('/devices/:etiqueta', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const originalEtiqueta = normalizeTag(req.params.etiqueta || req.body?.originalEtiqueta || '');
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
    res.json({ ok: true, item: payload, syncing: false });
  } catch (error) {
    next(error);
  }
});

devicesRouter.post('/devices/status', async (req, res, next) => {
  try {
    const estado = normalizeDeviceState(req.body.estado || '');
    const siteCode = requireSite(req);
    const etiqueta = normalizeTag(req.body.etiqueta);
    setLocalState(etiqueta, {
      estado,
      comentarios: req.body.comentario || req.body.comentarios || '',
      prestadoA: '',
      rol: '',
      ubicacion: '',
      motivo: '',
      loanedAt: '',
      returnedAt: estado === 'Disponible' || estado === 'Devuelto' ? nowIso() : '',
      siteCode
    });
    invalidateDeviceInventoryCache('device-status', siteCode);
    addLocalMovement({ tipo: 'estado dispositivo', descripcion: `${etiqueta} -> ${estado}`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, syncing: false });
  } catch (error) {
    next(error);
  }
});

devicesRouter.delete('/devices/:etiqueta', (req, res, next) => {
  try {
    const etiqueta = normalizeTag(req.params.etiqueta || '');
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

async function resolveImportCsv(body, siteCode) {
  if (typeof body.csvText === 'string' && body.csvText.trim()) return body.csvText;
  const url = String(body.csvUrl || getDb().prepare('SELECT spreadsheet_url FROM sites WHERE site_code=?').get(siteCode)?.spreadsheet_url || '').trim();
  if (!url) throw new Error('No se indicó CSV ni hay URL CSV configurada para esta sede.');
  const response = await fetch(toCsvExportUrl(url), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`No se pudo leer el CSV: HTTP ${response.status}`);
  return await response.text();
}

function importDevices(rows, siteCode, operador = 'Sistema') {
  const existing = new Set(getDb().prepare('SELECT etiqueta FROM local_devices WHERE site_code=?').all(siteCode).map(row => normalizeTag(row.etiqueta)));
  const errors = [];
  let read = 0;
  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let skipped = 0;
  const tx = getDb().transaction(() => {
    for (const row of rows) {
      read += 1;
      const payload = normalizeDevicePayload({ ...row, siteCode });
      if (!payload.etiqueta) {
        skipped += 1;
        errors.push(`Fila ${read}: sin etiqueta`);
        continue;
      }
      if (isHiddenOrInactive(payload.etiqueta, siteCode)) reactivated += 1;
      saveCategory(payload.categoria || 'Otro', siteCode);
      saveLocalDevice(payload, siteCode);
      if (existing.has(payload.etiqueta)) updated += 1;
      else {
        existing.add(payload.etiqueta);
        created += 1;
      }
    }
  });
  tx();
  addLocalMovement({ tipo: 'importación dispositivos', descripcion: `${read} leídos, ${created} nuevos, ${updated} actualizados, ${reactivated} reactivados, ${skipped} omitidos`, operador: operador || 'Sistema', origen: 'Local', etiqueta: '', siteCode });
  return { read, created, updated, reactivated, skipped, errors: errors.length, errorDetails: errors.slice(0, 20) };
}

function isHiddenOrInactive(etiqueta, siteCode) {
  const tag = normalizeTag(etiqueta || '');
  const hidden = getDb().prepare('SELECT 1 FROM hidden_devices WHERE site_code=? AND etiqueta=?').get(siteCode, tag);
  const local = getDb().prepare('SELECT eliminado, activo, deleted_at FROM local_devices WHERE site_code=? AND etiqueta=?').get(siteCode, tag);
  return Boolean(hidden || local?.eliminado || local?.activo === 0 || String(local?.deleted_at || '').trim());
}

function saveLocalDevice(payload, siteCode) {
  const etiqueta = normalizeTag(payload.etiqueta || '');
  if (!etiqueta) return;
  const ts = nowIso();
  const normalizedPayload = { ...payload, etiqueta, siteCode };
  getDb().prepare('DELETE FROM hidden_devices WHERE site_code=? AND etiqueta=?').run(siteCode, etiqueta);
  getDb().prepare(`
    INSERT INTO local_devices (
      etiqueta, site_code, payload, categoria, filtro, modelo, marca, serial, numero_operativo, alias_operativo,
      alias_alternativos, estado, prestada_a, rol, ubicacion, motivo, comentarios, fecha_prestamo,
      fecha_devolucion, ultima_modificacion, activo, eliminado, deleted_at, deleted_by, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '', '', ?, ?)
    ON CONFLICT(site_code, etiqueta) DO UPDATE SET
      payload=excluded.payload,
      categoria=excluded.categoria,
      filtro=excluded.filtro,
      modelo=excluded.modelo,
      marca=excluded.marca,
      serial=excluded.serial,
      numero_operativo=excluded.numero_operativo,
      alias_operativo=excluded.alias_operativo,
      alias_alternativos=excluded.alias_alternativos,
      estado=excluded.estado,
      prestada_a=excluded.prestada_a,
      rol=excluded.rol,
      ubicacion=excluded.ubicacion,
      motivo=excluded.motivo,
      comentarios=excluded.comentarios,
      fecha_prestamo=excluded.fecha_prestamo,
      fecha_devolucion=excluded.fecha_devolucion,
      ultima_modificacion=excluded.ultima_modificacion,
      activo=1,
      eliminado=0,
      deleted_at='',
      deleted_by='',
      updated_at=excluded.updated_at
  `).run(
    etiqueta,
    siteCode,
    JSON.stringify(normalizedPayload),
    normalizedPayload.categoria || '',
    normalizedPayload.filtro || '',
    normalizedPayload.modelo || '',
    normalizedPayload.marca || '',
    normalizedPayload.sn || normalizedPayload.serial || '',
    normalizedPayload.numero || normalizedPayload.numeroOperativo || '',
    normalizedPayload.aliasOperativo || buildOperationalAlias(normalizedPayload.filtro || normalizedPayload.categoria, normalizedPayload.numero || normalizedPayload.numeroOperativo),
    normalizedPayload.aliasOperativoJson || normalizedPayload.aliasAlternativos || '',
    normalizedPayload.estado || 'Disponible',
    normalizedPayload.prestadoA || '',
    normalizedPayload.rol || '',
    normalizedPayload.ubicacion || '',
    normalizedPayload.motivo || '',
    normalizedPayload.comentarios || '',
    normalizedPayload.loanedAt || '',
    normalizedPayload.returnedAt || '',
    normalizedPayload.ultima || ts,
    ts,
    ts
  );
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
  const importedNumber = String(raw.numero || raw.numeroOperativo || raw.numero_operativo || raw.nro || raw.number || raw['número'] || raw['numero operativo'] || raw['número operativo'] || raw.operativo || '').trim();
  const aliasOperativo = String(raw.aliasOperativo || raw.alias_operativo || raw.alias || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .join(', ');
  const prestadoA = String(raw.prestada || raw.prestadoA || raw.persona || '').trim();
  const estadoInput = raw.estado || raw.state || raw.status || raw.devuelto || '';
  const categoria = normalizeCategory(raw.categoria || raw.tipo || raw.dispositivo || raw.modelo || '');
  const filtro = normalizeDashboardFilter(raw.filtro || raw.filter || raw.grupo || raw.tipoDashboard || raw['tipo dashboard'] || raw.categoriaDashboard || raw['categoria dashboard'] || '');
  return {
    ...raw,
    etiqueta: normalizeTag(raw.etiqueta || raw.codigo || raw.code || raw.id || ''),
    categoria: categoria || 'Otro',
    filtro,
    dispositivo: String(raw.dispositivo || raw.equipo || categoria || 'Chromebook').trim(),
    modelo: String(raw.modelo || raw.modeloTecnico || raw['modelo técnico'] || raw.model || '').trim(),
    marca: String(raw.marca || '').trim(),
    sn: String(raw.sn || raw.serial || raw['s/n'] || raw.SN || '').trim(),
    mac: String(raw.mac || raw.MAC || '').trim(),
    numero: importedNumber,
    numeroOperativo: importedNumber,
    aliasOperativo: aliasOperativo || buildOperationalAlias(filtro || categoria, importedNumber),
    aliasOperativoJson: aliasOperativo ? JSON.stringify(aliasOperativo.split(',').map(item => item.trim()).filter(Boolean)) : '',
    estado: estadoInput ? normalizeDeviceState(estadoInput) : (prestadoA ? 'Prestado' : 'Disponible'),
    prestadoA,
    rol: String(raw.rol || '').trim(),
    ubicacion: String(raw.ubicacion || raw['ubicación'] || '').trim(),
    motivo: String(raw.motivo || '').trim(),
    comentarios: String(raw.comentarios || raw.comentario || '').trim(),
    loanedAt: String(raw.loanedAt || raw.fechaPrestamo || raw.fechaPres || raw['fecha pres'] || raw.horarioPrestamo || '').trim(),
    returnedAt: String(raw.returnedAt || raw.fechaDevolucion || raw.fechaDev || raw['fecha dev'] || raw.horarioDevolucion || '').trim(),
    ultima: String(raw.ultima || raw.ultimaModificacion || raw['última mod'] || raw['ultima mod'] || '').trim()
  };
}

function normalizeDeviceState(value) {
  const text = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (text.includes('prest')) return 'Prestado';
  if (text.includes('no encontrada') || text.includes('perd')) return 'No encontrada';
  if (text.includes('fuera') || text.includes('servicio')) return 'Fuera de servicio';
  if (text.includes('repar')) return 'En reparación';
  if (text.includes('sin revisar')) return 'Sin revisar';
  return 'Disponible';
}

function buildOperationalAlias(group, number) {
  const cleanGroup = normalizeDashboardFilter(group || '');
  const cleanNumber = String(number || '').trim();
  return cleanGroup && cleanNumber ? `${cleanGroup} ${cleanNumber}` : '';
}

function normalizeDashboardFilter(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
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

function normalizeTag(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\n'));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}



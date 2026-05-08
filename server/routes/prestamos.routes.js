import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { addLocalMovement, getDb, nowIso } from '../db.js';
import { getMergedDevices } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const prestamosRouter = Router();

prestamosRouter.get('/prestamos', (req, res) => {
  const siteCode = requireSite(req);
  refreshOverdue(siteCode);
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM prestamos WHERE site_code=? ORDER BY fecha_prestamo DESC').all(siteCode) });
});

prestamosRouter.get('/prestamos/:id', (req, res) => {
  const item = getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(req.params.id, requireSite(req));
  if (!item) return res.status(404).json({ ok: false, error: 'Préstamo no encontrado.' });
  res.json({ ok: true, item });
});

prestamosRouter.post('/prestamos', async (req, res) => {
  const siteCode = requireSite(req);
  const payload = normalizeLoan({ ...req.body, siteCode });
  const missing = requiredLoanFields(payload);
  if (missing.length) return res.status(400).json({ ok: false, error: `Faltan datos: ${missing.join(', ')}` });
  const device = await findDevice(payload.codigo_dispositivo, siteCode);
  if (!device) return res.status(404).json({ ok: false, error: `No existe el dispositivo ${payload.codigo_dispositivo}.` });
  const active = activeLoan(payload.codigo_dispositivo, siteCode);
  if (active) return res.status(409).json({ ok: false, error: `${payload.codigo_dispositivo} ya tiene un préstamo activo para ${active.usuario_nombre} hasta ${active.fecha_devolucion_prevista}.`, active });

  const id = payload.id || `PR${Date.now()}`;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO prestamos (id, site_code, dispositivo_id, codigo_dispositivo, tipo_dispositivo, usuario_nombre, usuario_email, curso_o_area, sede, responsable_entrega,
      fecha_prestamo, fecha_devolucion_prevista, estado, observaciones_entrega, condicion_entrega, accesorios_entregados, created_at, updated_at)
    VALUES (@id, @siteCode, @dispositivo_id, @codigo_dispositivo, @tipo_dispositivo, @usuario_nombre, @usuario_email, @curso_o_area, @sede, @responsable_entrega,
      @fecha_prestamo, @fecha_devolucion_prevista, @estado, @observaciones_entrega, @condicion_entrega, @accesorios_entregados, @ts, @ts)
  `).run({ ...payload, id, dispositivo_id: device.id, tipo_dispositivo: device.dispositivo || device.modelo || '', ts });
  addLocalMovement({ tipo: 'préstamo local', descripcion: `${payload.codigo_dispositivo} prestado a ${payload.usuario_nombre}`, operador: payload.responsable_entrega, origen: 'Local', etiqueta: payload.codigo_dispositivo, siteCode });
  res.json({ ok: true, item: getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(id, siteCode) });
});

prestamosRouter.put('/prestamos/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Préstamo no encontrado.' });
  const payload = { ...old, ...normalizeLoan({ ...req.body, siteCode }), id: req.params.id, updated_at: nowIso(), site_code: siteCode };
  getDb().prepare(`
    UPDATE prestamos SET usuario_nombre=@usuario_nombre, usuario_email=@usuario_email, curso_o_area=@curso_o_area, sede=@sede,
      responsable_entrega=@responsable_entrega, fecha_devolucion_prevista=@fecha_devolucion_prevista, estado=@estado,
      observaciones_entrega=@observaciones_entrega, condicion_entrega=@condicion_entrega, accesorios_entregados=@accesorios_entregados, updated_at=@updated_at
    WHERE id=@id AND site_code=@site_code
  `).run(payload);
  res.json({ ok: true, item: getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(req.params.id, siteCode) });
});

prestamosRouter.delete('/prestamos/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Préstamo no encontrado.' });
  getDb().prepare("UPDATE prestamos SET estado='cancelado', updated_at=? WHERE id=? AND site_code=?").run(nowIso(), req.params.id, siteCode);
  res.json({ ok: true, id: req.params.id });
});

prestamosRouter.post('/prestamos/:id/devolver', (req, res) => {
  const siteCode = requireSite(req);
  const loan = getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!loan) return res.status(404).json({ ok: false, error: 'Préstamo no encontrado.' });
  const item = createReturn(loan, req.body, siteCode);
  res.json({ ok: true, item });
});

prestamosRouter.get('/devoluciones', (req, res) => {
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM devoluciones WHERE site_code=? ORDER BY fecha_devolucion_real DESC').all(requireSite(req)) });
});

prestamosRouter.get('/devoluciones/:id', (req, res) => {
  const item = getDb().prepare('SELECT * FROM devoluciones WHERE id=? AND site_code=?').get(req.params.id, requireSite(req));
  if (!item) return res.status(404).json({ ok: false, error: 'Devolución no encontrada.' });
  res.json({ ok: true, item });
});

prestamosRouter.post('/devoluciones', (req, res) => {
  const siteCode = requireSite(req);
  const code = normalizeCode(req.body.codigo_dispositivo || req.body.codigoDispositivo || '');
  const loan = req.body.prestamo_id
    ? getDb().prepare('SELECT * FROM prestamos WHERE id=? AND site_code=?').get(req.body.prestamo_id, siteCode)
    : activeLoan(code, siteCode);
  if (!loan && !req.body.confirmManual) return res.status(404).json({ ok: false, error: 'No hay préstamo activo para registrar la devolución. Confirmá devolución manual si corresponde.' });
  const item = createReturn(loan || { id: '', dispositivo_id: '', codigo_dispositivo: code, usuario_nombre: req.body.usuario_nombre || '' }, req.body, siteCode);
  res.json({ ok: true, item });
});

function createReturn(loan, raw, siteCode) {
  const id = `DV${Date.now()}${randomUUID().slice(0, 4)}`;
  const ts = nowIso();
  const condicion = raw.condicion_devolucion || raw.condicionDevolucion || 'bueno';
  const penalizacion = raw.penalizacion_aplicada || raw.penalizacionAplicada || (isLate(loan.fecha_devolucion_prevista) || /dan|incompleto/i.test(condicion) ? 'si' : 'no');
  getDb().prepare(`
    INSERT INTO devoluciones (id, site_code, prestamo_id, dispositivo_id, codigo_dispositivo, usuario_nombre, fecha_devolucion_real, responsable_recepcion,
      condicion_devolucion, accesorios_devueltos, observaciones_devolucion, penalizacion_aplicada, detalle_penalizacion, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, siteCode, loan.id, loan.dispositivo_id, loan.codigo_dispositivo, loan.usuario_nombre, raw.fecha_devolucion_real || ts, raw.responsable_recepcion || raw.responsableRecepcion || '', condicion, raw.accesorios_devueltos || '', raw.observaciones_devolucion || raw.observaciones || '', penalizacion, raw.detalle_penalizacion || '', ts);
  if (loan.id) getDb().prepare("UPDATE prestamos SET estado='devuelto', updated_at=? WHERE id=? AND site_code=?").run(ts, loan.id, siteCode);
  addLocalMovement({ tipo: 'devolución local', descripcion: `${loan.codigo_dispositivo} devuelto`, operador: raw.responsable_recepcion || '', origen: 'Local', etiqueta: loan.codigo_dispositivo, siteCode });
  return getDb().prepare('SELECT * FROM devoluciones WHERE id=? AND site_code=?').get(id, siteCode);
}

function activeLoan(code, siteCode) {
  refreshOverdue(siteCode);
  return getDb().prepare("SELECT * FROM prestamos WHERE site_code=? AND upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(siteCode, normalizeCode(code));
}

function refreshOverdue(siteCode) {
  getDb().prepare("UPDATE prestamos SET estado='vencido' WHERE site_code=? AND estado='activo' AND fecha_devolucion_prevista < ?").run(siteCode, new Date().toISOString().slice(0, 10));
}

async function findDevice(code, siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  return items.find(device => normalizeCode(device.etiqueta) === normalizeCode(code));
}

function normalizeLoan(raw) {
  const today = new Date().toISOString().slice(0, 10);
  const siteCode = raw.siteCode || raw.site_code || raw.sede || 'NFPT';
  return {
    id: raw.id || '',
    siteCode,
    codigo_dispositivo: normalizeCode(raw.codigo_dispositivo || raw.codigoDispositivo || raw.dispositivo || ''),
    usuario_nombre: raw.usuario_nombre || raw.usuarioNombre || raw.persona || '',
    usuario_email: raw.usuario_email || raw.email || '',
    curso_o_area: raw.curso_o_area || raw.curso || raw.area || '',
    sede: raw.sede || siteCode,
    responsable_entrega: raw.responsable_entrega || raw.responsableEntrega || raw.responsable || '',
    fecha_prestamo: raw.fecha_prestamo || today,
    fecha_devolucion_prevista: raw.fecha_devolucion_prevista || raw.fechaDevolucionPrevista || raw.hasta || '',
    estado: raw.estado || 'activo',
    observaciones_entrega: raw.observaciones_entrega || raw.observaciones || '',
    condicion_entrega: raw.condicion_entrega || 'bueno',
    accesorios_entregados: raw.accesorios_entregados || ''
  };
}

function requiredLoanFields(payload) {
  const missing = [];
  if (!payload.codigo_dispositivo) missing.push('dispositivo');
  if (!payload.usuario_nombre) missing.push('usuario');
  if (!payload.fecha_devolucion_prevista) missing.push('fecha de devolución prevista');
  if (!payload.responsable_entrega) missing.push('responsable de entrega');
  return missing;
}

function isLate(date) {
  return Boolean(date) && date < new Date().toISOString().slice(0, 10);
}

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

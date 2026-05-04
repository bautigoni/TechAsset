import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb, nowIso, addLocalMovement } from '../db.js';
import { getMergedDevices } from '../services/deviceInventory.service.js';

export const prestamosRouter = Router();

prestamosRouter.get('/prestamos', (_req, res) => {
  refreshOverdue();
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM prestamos ORDER BY fecha_prestamo DESC').all() });
});

prestamosRouter.get('/prestamos/:id', (req, res) => {
  const item = getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Prestamo no encontrado.' });
  res.json({ ok: true, item });
});

prestamosRouter.post('/prestamos', async (req, res) => {
  const payload = normalizeLoan(req.body);
  const missing = requiredLoanFields(payload);
  if (missing.length) return res.status(400).json({ ok: false, error: `Faltan datos: ${missing.join(', ')}` });
  const device = await findDevice(payload.codigo_dispositivo);
  if (!device) return res.status(404).json({ ok: false, error: `No existe el dispositivo ${payload.codigo_dispositivo}.` });
  const active = activeLoan(payload.codigo_dispositivo);
  if (active) return res.status(409).json({ ok: false, error: `${payload.codigo_dispositivo} ya tiene un prestamo activo para ${active.usuario_nombre} hasta ${active.fecha_devolucion_prevista}.`, active });
  const id = payload.id || `PR${Date.now()}`;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO prestamos (id, dispositivo_id, codigo_dispositivo, tipo_dispositivo, usuario_nombre, usuario_email, curso_o_area, sede, responsable_entrega,
      fecha_prestamo, fecha_devolucion_prevista, estado, observaciones_entrega, condicion_entrega, accesorios_entregados, created_at, updated_at)
    VALUES (@id, @dispositivo_id, @codigo_dispositivo, @tipo_dispositivo, @usuario_nombre, @usuario_email, @curso_o_area, @sede, @responsable_entrega,
      @fecha_prestamo, @fecha_devolucion_prevista, @estado, @observaciones_entrega, @condicion_entrega, @accesorios_entregados, @ts, @ts)
  `).run({ ...payload, id, dispositivo_id: device.id, tipo_dispositivo: device.dispositivo || device.modelo || '', ts });
  addLocalMovement({ tipo: 'prestamo local', descripcion: `${payload.codigo_dispositivo} prestado a ${payload.usuario_nombre}`, operador: payload.responsable_entrega, origen: 'Local', etiqueta: payload.codigo_dispositivo });
  res.json({ ok: true, item: getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(id) });
});

prestamosRouter.put('/prestamos/:id', (req, res) => {
  const old = getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Prestamo no encontrado.' });
  const payload = { ...old, ...normalizeLoan(req.body), id: req.params.id, updated_at: nowIso() };
  getDb().prepare(`
    UPDATE prestamos SET usuario_nombre=@usuario_nombre, usuario_email=@usuario_email, curso_o_area=@curso_o_area, sede=@sede,
      responsable_entrega=@responsable_entrega, fecha_devolucion_prevista=@fecha_devolucion_prevista, estado=@estado,
      observaciones_entrega=@observaciones_entrega, condicion_entrega=@condicion_entrega, accesorios_entregados=@accesorios_entregados, updated_at=@updated_at
    WHERE id=@id
  `).run(payload);
  res.json({ ok: true, item: getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(req.params.id) });
});

prestamosRouter.delete('/prestamos/:id', (req, res) => {
  const old = getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Prestamo no encontrado.' });
  getDb().prepare("UPDATE prestamos SET estado='cancelado', updated_at=? WHERE id=?").run(nowIso(), req.params.id);
  res.json({ ok: true, id: req.params.id });
});

prestamosRouter.post('/prestamos/:id/devolver', (req, res) => {
  const loan = getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(req.params.id);
  if (!loan) return res.status(404).json({ ok: false, error: 'Prestamo no encontrado.' });
  const item = createReturn(loan, req.body);
  res.json({ ok: true, item });
});

prestamosRouter.get('/devoluciones', (_req, res) => {
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM devoluciones ORDER BY fecha_devolucion_real DESC').all() });
});

prestamosRouter.get('/devoluciones/:id', (req, res) => {
  const item = getDb().prepare('SELECT * FROM devoluciones WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Devolucion no encontrada.' });
  res.json({ ok: true, item });
});

prestamosRouter.post('/devoluciones', (req, res) => {
  const code = normalizeCode(req.body.codigo_dispositivo || req.body.codigoDispositivo || '');
  const loan = req.body.prestamo_id
    ? getDb().prepare('SELECT * FROM prestamos WHERE id=?').get(req.body.prestamo_id)
    : activeLoan(code);
  if (!loan && !req.body.confirmManual) return res.status(404).json({ ok: false, error: 'No hay prestamo activo para registrar la devolucion. Confirmar devolucion manual si corresponde.' });
  const item = createReturn(loan || { id: '', dispositivo_id: '', codigo_dispositivo: code, usuario_nombre: req.body.usuario_nombre || '' }, req.body);
  res.json({ ok: true, item });
});

function createReturn(loan, raw) {
  const id = `DV${Date.now()}${randomUUID().slice(0, 4)}`;
  const ts = nowIso();
  const condicion = raw.condicion_devolucion || raw.condicionDevolucion || 'bueno';
  const penalizacion = raw.penalizacion_aplicada || raw.penalizacionAplicada || (isLate(loan.fecha_devolucion_prevista) || /dan|incompleto/i.test(condicion) ? 'si' : 'no');
  getDb().prepare(`
    INSERT INTO devoluciones (id, prestamo_id, dispositivo_id, codigo_dispositivo, usuario_nombre, fecha_devolucion_real, responsable_recepcion,
      condicion_devolucion, accesorios_devueltos, observaciones_devolucion, penalizacion_aplicada, detalle_penalizacion, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, loan.id, loan.dispositivo_id, loan.codigo_dispositivo, loan.usuario_nombre, raw.fecha_devolucion_real || ts, raw.responsable_recepcion || raw.responsableRecepcion || '', condicion, raw.accesorios_devueltos || '', raw.observaciones_devolucion || raw.observaciones || '', penalizacion, raw.detalle_penalizacion || '', ts);
  if (loan.id) getDb().prepare("UPDATE prestamos SET estado='devuelto', updated_at=? WHERE id=?").run(ts, loan.id);
  addLocalMovement({ tipo: 'devolucion local', descripcion: `${loan.codigo_dispositivo} devuelto`, operador: raw.responsable_recepcion || '', origen: 'Local', etiqueta: loan.codigo_dispositivo });
  return getDb().prepare('SELECT * FROM devoluciones WHERE id=?').get(id);
}

function activeLoan(code) {
  refreshOverdue();
  return getDb().prepare("SELECT * FROM prestamos WHERE upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(normalizeCode(code));
}

function refreshOverdue() {
  getDb().prepare("UPDATE prestamos SET estado='vencido' WHERE estado='activo' AND fecha_devolucion_prevista < ?").run(new Date().toISOString().slice(0, 10));
}

async function findDevice(code) {
  const { items } = await getMergedDevices();
  return items.find(device => normalizeCode(device.etiqueta) === normalizeCode(code));
}

function normalizeLoan(raw) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: raw.id || '',
    codigo_dispositivo: normalizeCode(raw.codigo_dispositivo || raw.codigoDispositivo || raw.dispositivo || ''),
    usuario_nombre: raw.usuario_nombre || raw.usuarioNombre || raw.persona || '',
    usuario_email: raw.usuario_email || raw.email || '',
    curso_o_area: raw.curso_o_area || raw.curso || raw.area || '',
    sede: raw.sede || 'NFPT',
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
  if (!payload.fecha_devolucion_prevista) missing.push('fecha de devolucion prevista');
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

// Auditoría de herramientas del asistente y "Deshacer" de sus escrituras.
//
// - Cada llamada a herramienta queda en assistant_audit (sede, usuario,
//   herramienta, argumentos acotados, resultado y duración).
// - Cada escritura exitosa queda en assistant_actions con lo necesario para
//   revertirla. El cliente solo manda el id de la acción: los datos de la
//   reversión salen de la base, nunca del request.
// - Deshacer pide los mismos permisos que la acción original, la misma sede, y
//   que sea del mismo usuario (o un administrador de la sede).
import { addLoanEvent, addLocalMovement, getDb, nowIso, setLocalState } from '../../db.js';
import { invalidateDeviceInventoryCache } from '../deviceInventory.service.js';
import { normalize, normalizeCode } from './utils.js';
import { ORIGEN, findDevice, isAvailableState, isLoanedState, siteOf, writePermissionError } from './tools.js';

const UNDO_WINDOW_MS = 12 * 60 * 60 * 1000;

export function auditToolCall({ access, tool, args, result, durationMs, actionId = null, provider = '' }) {
  try {
    getDb().prepare(`
      INSERT INTO assistant_audit (site_code, user_email, tool, args_json, ok, error, duration_ms, action_id, provider, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      siteOf(access), String(access?.user?.email || '').toLowerCase(), tool,
      JSON.stringify(args || {}).slice(0, 1000), result?.ok === false ? 0 : 1,
      String(result?.error || '').slice(0, 300), Math.round(durationMs || 0), actionId, provider, nowIso()
    );
  } catch (error) {
    console.warn('[assistant] no se pudo auditar la herramienta:', error?.message || error);
  }
}

export function recordAction({ access, tool, label, undo }) {
  if (!undo) return null;
  const info = getDb().prepare(`
    INSERT INTO assistant_actions (site_code, user_id, user_email, tool, label, undo_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(siteOf(access), Number(access?.user?.id || 0), String(access?.user?.email || '').toLowerCase(), tool, String(label || '').slice(0, 200), JSON.stringify(undo), nowIso());
  const id = Number(info.lastInsertRowid);
  return Number.isFinite(id) && id > 0 ? id : null;
}

class UndoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function undoAssistantAction({ actionId, access }) {
  try {
    return await runUndo(Number(actionId), access);
  } catch (error) {
    if (error instanceof UndoError) return { ok: false, status: error.status, error: error.message };
    console.error('[assistant] error al deshacer:', error);
    return { ok: false, status: 500, error: 'No se pudo deshacer por un problema técnico. Hacelo desde la pantalla correspondiente.' };
  }
}

async function runUndo(actionId, access) {
  const siteCode = siteOf(access);
  if (!Number.isInteger(actionId) || actionId <= 0) throw new UndoError(400, 'Falta la acción a deshacer.');
  const db = getDb();
  const action = db.prepare('SELECT * FROM assistant_actions WHERE id=? AND site_code=?').get(actionId, siteCode);
  if (!action) throw new UndoError(404, 'No encontré esa acción del asistente en esta sede.');
  if (action.undone_at) throw new UndoError(409, 'Esa acción ya se deshizo.');
  const denied = writePermissionError(action.tool, access);
  if (denied) throw new UndoError(403, 'Tu rol no tiene permiso para deshacer esta acción.');
  const email = String(access?.user?.email || '').toLowerCase();
  if (action.user_email && action.user_email !== email && !access?.isManager) {
    throw new UndoError(403, 'Solo quien hizo la acción (o un administrador de la sede) puede deshacerla.');
  }
  if (Date.now() - Date.parse(action.created_at || 0) > UNDO_WINDOW_MS) {
    throw new UndoError(409, 'Pasó demasiado tiempo para deshacer desde el asistente. Hacelo desde la pantalla correspondiente.');
  }

  let undo;
  try { undo = JSON.parse(action.undo_json || '{}'); } catch { undo = {}; }
  const operador = access?.user?.nombre || access?.user?.email || ORIGEN;

  // Se reserva la acción antes de ejecutar: si llegan dos "Deshacer" juntos,
  // solo uno la toma. Si la reversión falla, se libera.
  const claimed = db.prepare("UPDATE assistant_actions SET undone_at=?, undone_by=? WHERE id=? AND site_code=? AND COALESCE(undone_at,'')=''").run(nowIso(), email, actionId, siteCode);
  if (!claimed?.changes) throw new UndoError(409, 'Esa acción ya se deshizo.');
  const started = performance.now();
  let mensaje;
  try {
    switch (undo.tipo) {
      case 'devolver': mensaje = await undoLoan(undo, siteCode, operador); break;
      case 're-prestar': mensaje = await undoReturn(undo, siteCode, operador); break;
      case 'borrar_tarea': mensaje = undoTask(undo, siteCode, operador); break;
      case 'borrar_evento': mensaje = undoAgenda(undo, siteCode, operador); break;
      case 'borrar_recordatorio': mensaje = undoReminder(undo, siteCode); break;
      default: throw new UndoError(400, 'Esa acción no se puede deshacer.');
    }
  } catch (error) {
    db.prepare("UPDATE assistant_actions SET undone_at='', undone_by='' WHERE id=? AND site_code=?").run(actionId, siteCode);
    auditToolCall({ access, tool: `deshacer:${action.tool}`, args: { actionId }, result: { ok: false, error: error?.message }, durationMs: performance.now() - started, actionId });
    throw error;
  }
  auditToolCall({ access, tool: `deshacer:${action.tool}`, args: { actionId }, result: { ok: true }, durationMs: performance.now() - started, actionId });
  return { ok: true, actionId, tipo: undo.tipo, mensaje };
}

// Préstamo -> devolver, solo si sigue prestado a la misma persona.
async function undoLoan({ etiqueta, persona }, siteCode, operador) {
  const device = await findDevice(etiqueta, siteCode);
  if (!device) throw new UndoError(404, `${etiqueta} ya no está en el inventario.`);
  if (!isLoanedState(device.estado) || normalize(device.prestadoA) !== normalize(persona)) {
    throw new UndoError(409, `${etiqueta} ya no está prestado a ${persona}: cambió después. Revisalo en Préstamos.`);
  }
  const tag = normalizeCode(device.etiqueta);
  const ts = nowIso();
  setLocalState(tag, {
    estado: 'Disponible', prestadoA: '', rol: '', ubicacion: '', ubicacionDetalle: '',
    curso: '', motivo: '', motivoDetalle: '', comentarios: '', loanedAt: '', returnedAt: ts, siteCode
  });
  invalidateDeviceInventoryCache('assistant-undo', siteCode);
  const label = device.aliasOperativo ? `${tag} (${device.aliasOperativo})` : tag;
  addLocalMovement({ tipo: 'devolución', descripcion: `${label}: préstamo a ${persona} anulado (Deshacer)`, operador, origen: ORIGEN, etiqueta: tag, siteCode });
  addLoanEvent({
    siteCode, tipo: 'devolucion', etiqueta: tag, alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona: device.prestadoA || '', rol: device.rol || '', ubicacion: device.ubicacion || '', motivo: device.motivo || '',
    comentarios: 'Préstamo anulado con Deshacer del asistente', operador, origen: ORIGEN, timestamp: ts
  });
  return `Listo, deshice el préstamo: ${label} vuelve a estar disponible.`;
}

// Devolución -> volver a prestar con los mismos datos, solo si sigue disponible.
async function undoReturn({ etiqueta, prestamo = {} }, siteCode, operador) {
  const device = await findDevice(etiqueta, siteCode);
  if (!device) throw new UndoError(404, `${etiqueta} ya no está en el inventario.`);
  if (!isAvailableState(device.estado)) {
    throw new UndoError(409, `${etiqueta} ya no está disponible (está ${device.estado}): cambió después. Revisalo en Préstamos.`);
  }
  const tag = normalizeCode(device.etiqueta);
  const ts = nowIso();
  setLocalState(tag, {
    estado: 'Prestado', prestadoA: prestamo.prestadoA || '', rol: prestamo.rol || '', ubicacion: prestamo.ubicacion || '',
    ubicacionDetalle: prestamo.ubicacionDetalle || '', curso: prestamo.curso || '', motivo: prestamo.motivo || '',
    motivoDetalle: prestamo.motivoDetalle || '', comentarios: prestamo.comentarios || '',
    loanedAt: prestamo.loanedAt || ts, returnedAt: '', siteCode
  });
  invalidateDeviceInventoryCache('assistant-undo', siteCode);
  const label = device.aliasOperativo ? `${tag} (${device.aliasOperativo})` : tag;
  addLocalMovement({ tipo: 'préstamo', descripcion: `${label}: devolución anulada (Deshacer), vuelve a ${prestamo.prestadoA || 'quien lo tenía'}`, operador, origen: ORIGEN, etiqueta: tag, siteCode });
  addLoanEvent({
    siteCode, tipo: 'prestamo', etiqueta: tag, alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona: prestamo.prestadoA || '', rol: prestamo.rol || '', ubicacion: prestamo.ubicacion || '', motivo: prestamo.motivo || '',
    comentarios: 'Devolución anulada con Deshacer del asistente', operador, origen: ORIGEN, timestamp: ts
  });
  return `Listo, deshice la devolución: ${label} figura otra vez prestado a ${prestamo.prestadoA || 'quien lo tenía'}.`;
}

// Tarea / actividad -> borrado lógico, igual que DELETE /api/tasks/:id y /api/agenda/:id.
function undoTask({ id }, siteCode, operador) {
  const db = getDb();
  const old = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(id, siteCode);
  if (!old) throw new UndoError(409, 'La tarea ya no existe (¿la borraron?).');
  const ts = nowIso();
  db.prepare('UPDATE tasks SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=? AND site_code=?').run(operador, ts, id, siteCode);
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, old.titulo, 'tarea borrada (Deshacer del asistente)', old.responsable, old.estado, old.estado, old.comentario || '', operador, old.agenda_id || '');
  return `Listo, borré la tarea "${old.titulo}".`;
}

function undoAgenda({ id }, siteCode, operador) {
  const db = getDb();
  const old = db.prepare('SELECT * FROM agenda WHERE id=? AND eliminada=0 AND site_code=?').get(id, siteCode);
  if (!old) throw new UndoError(409, 'La actividad ya no existe (¿la borraron?).');
  const ts = nowIso();
  db.prepare('UPDATE agenda SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=? AND site_code=?').run(operador, ts, id, siteCode);
  db.prepare('INSERT INTO agenda_history (agenda_id, site_code, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, 'actividad borrada (Deshacer del asistente)', old.estado, old.estado, old.nota || '', operador);
  return `Listo, saqué "${old.actividad}" de la agenda.`;
}

function undoReminder({ id }, siteCode) {
  const db = getDb();
  const old = db.prepare('SELECT * FROM reminders WHERE id=? AND site_code=? AND active=1').get(id, siteCode);
  if (!old) throw new UndoError(409, 'El recordatorio ya no existe.');
  db.prepare('UPDATE reminders SET active=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), id, siteCode);
  return `Listo, borré el recordatorio "${old.title}".`;
}

import { getDb, nowIso, addLocalMovement } from '../../db.js';
import { getMergedDevices } from '../deviceInventory.service.js';
import { todayIso, normalizeCode, sameCode, normalize, isConfirmation, isCancel } from './utils.js';
import { parseLoanText, parseReturnText, loanMissing, loanKnownSummary, label, updateDataWithCorrection } from './parser.js';
import { findPerson } from './memory.js';

export async function handleLoanFlow(memory, text, action) {
  const previous = memory.activeFlow === 'loan_flow' ? memory.collectedData : {};
  const parsed = action === 'start_loan' && !extractDeviceFromText(text) ? { ...previous } : parseLoanText(text, previous);
  memory.activeFlow = 'loan_flow';

  // Si no hay dispositivo: buscar alias operacional (Touch 34, Plani 5)
  if (!parsed.codigo_dispositivo && !parsed.aliasOperativo) {
    memory.collectedData = parsed;
    return askFlow(memory, 'Perfecto. ¿Qué código de dispositivo (D####) o alias (Touch 34) querés prestar?', 'loan_flow', 'codigo_dispositivo');
  }

  // Resolver alias operacional a etiqueta D#### si es necesario
  if (!parsed.codigo_dispositivo && parsed.aliasOperativo) {
    const resolved = await resolveAliasToDevice(parsed.aliasOperativo, memory.siteCode);
    if (resolved) {
      parsed.codigo_dispositivo = resolved;
    } else {
      return response(`No encontré un equipo con alias "${parsed.aliasOperativo}" en el inventario.`, 'loan_flow', {});
    }
  }

  if (parsed.codigo_dispositivo) memory.lastDevice = parsed.codigo_dispositivo;

  // Si no hay persona: buscar por nombre parcial conocida
  if (!parsed.usuario_nombre) {
    memory.collectedData = parsed;
    return askFlow(memory, '¿A quién se lo prestamos?', 'loan_flow', 'usuario_nombre');
  }
  memory.lastPerson = parsed.usuario_nombre;

  // Buscar persona conocida para auto-completar rol
  if (!parsed.rol) {
    const known = findPerson(memory.siteCode, parsed.usuario_nombre);
    if (known && known.rol) {
      parsed.rol = known.rol;
    }
  }

  const deviceCheck = await validateDeviceForLoan(parsed.codigo_dispositivo, memory.siteCode);
  if (deviceCheck) return deviceCheck;

  const missing = loanMissing(parsed);
  if (missing.length) {
    memory.waitingFor = missing[0];
    memory.collectedData = parsed;
    return askFlow(memory, loanMissingQuestion(parsed, missing), 'loan_flow', missing[0]);
  }

  memory.collectedData = parsed;
  const pendingAction = { type: 'registrar_prestamo', payload: { ...parsed, siteCode: memory.siteCode } };
  return confirm(
    `Confirmame si registro este préstamo:\nDispositivo: ${parsed.codigo_dispositivo}\nPersona: ${parsed.usuario_nombre}\nRol: ${parsed.rol}\nUbicación: ${parsed.ubicacion}${parsed.motivo ? `\nMotivo: ${parsed.motivo}` : ''}\n\n¿Lo registro?`,
    'loan_flow', pendingAction, ['Confirmar préstamo', 'Cancelar']
  );
}

async function resolveAliasToDevice(alias, siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  const q = normalize(alias);
  const match = items.find(item => {
    const haystack = normalize([item.aliasOperativo, item.filtro, item.etiqueta, item.dispositivo].join(' '));
    return haystack.includes(q);
  });
  return match ? match.etiqueta : null;
}

export async function validateDeviceForLoan(code, siteCode) {
  const active = getActiveLoan(code, siteCode);
  if (active) return response(`${normalizeCode(code)} ya tiene un préstamo activo para ${active.usuario_nombre}.`, 'loan_flow', { activeLoan: active });
  const { items } = await getMergedDevices({ siteCode });
  if (!items.some(item => sameCode(item.etiqueta, code))) return response(`No encontré el dispositivo ${normalizeCode(code)} en el inventario real.`, 'loan_flow');
  return null;
}

function getActiveLoan(code, siteCode) {
  return getDb().prepare("SELECT * FROM prestamos WHERE site_code=? AND upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(siteCode, normalizeCode(code));
}

export async function handleReturnFlow(memory, text, action) {
  const previous = memory.activeFlow === 'return_flow' ? memory.collectedData : {};
  const parsed = action === 'start_return' && !extractDeviceFromText(text) ? { ...previous } : parseReturnText(text, previous);
  if (!parsed.codigo_dispositivo && memory.lastDevice && /devolvela|devolvelo|el de recien|la de recien|esa|ese/.test(normalize(text))) {
    parsed.codigo_dispositivo = memory.lastDevice;
  }
  memory.activeFlow = 'return_flow';
  memory.collectedData = parsed;
  if (parsed.codigo_dispositivo) memory.lastDevice = parsed.codigo_dispositivo;

  if (!parsed.codigo_dispositivo) return askFlow(memory, '¿Qué equipo querés registrar como devuelto?', 'return_flow', 'codigo_dispositivo');

  const active = getActiveLoan(parsed.codigo_dispositivo, memory.siteCode);
  const procedure = parsed.condicion_devolucion !== 'bueno' ? await searchProceduresForReturn(text) : [];
  const pendingAction = { type: 'registrar_devolucion', payload: { ...parsed, siteCode: memory.siteCode, prestamo_id: active?.id || '', usuario_nombre: active?.usuario_nombre || parsed.usuario_nombre || '' } };
  const activeText = active ? `Encontré préstamo activo para ${parsed.codigo_dispositivo} (${active.usuario_nombre}).` : `No encontré préstamo activo para ${parsed.codigo_dispositivo}; si confirmás lo registro como devolución manual.`;
  const procedureText = procedure.length ? `\nProcedimiento relacionado: ${procedure[0].excerpt}` : '';
  return confirm(`${activeText}\nCondición: ${parsed.condicion_devolucion}.${parsed.accesorios_devueltos ? `\nAccesorios: ${parsed.accesorios_devueltos}` : ''}${procedureText}\n\n¿Confirmás que guarde la devolución?`, 'return_flow', pendingAction, ['Confirmar devolución', 'Cancelar']);
}

async function searchProceduresForReturn(text) {
  try {
    const { searchProcedures } = await import('../procedureSearch.js');
    return await searchProcedures(text);
  } catch {
    return [];
  }
}

export async function executeLoan(pending, activeSite) {
  const db = getDb();
  const ts = nowIso();
  const p = pending.payload;
  const id = `PR${Date.now()}`;
  const { items } = await getMergedDevices({ siteCode: activeSite });
  const device = items.find(d => sameCode(d.etiqueta, p.codigo_dispositivo)) || {};
  const observaciones = [p.motivo, p.comentario, p.rol ? `Rol: ${p.rol}` : ''].filter(Boolean).join(' | ');
  db.prepare(`INSERT INTO prestamos (id, site_code, dispositivo_id, codigo_dispositivo, tipo_dispositivo, usuario_nombre, usuario_email, curso_o_area, sede, responsable_entrega, fecha_prestamo, fecha_devolucion_prevista, estado, observaciones_entrega, condicion_entrega, accesorios_entregados, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'Asistente TechAsset', ?, '', 'activo', ?, 'bueno', '', ?, ?)`).run(id, activeSite, device.id || '', p.codigo_dispositivo, device.dispositivo || device.modelo || '', p.usuario_nombre, p.rol || '', p.ubicacion || activeSite, todayIso(), observaciones, ts, ts);
  addLocalMovement({ tipo: 'préstamo local', descripcion: `${p.codigo_dispositivo} prestado a ${p.usuario_nombre}`, operador: 'Asistente TechAsset', origen: 'Asistente', etiqueta: p.codigo_dispositivo, siteCode: activeSite });
  return response(`Listo. ${p.codigo_dispositivo} prestada a ${p.usuario_nombre}.`, 'loan_flow', { id });
}

export async function executeReturn(pending, activeSite) {
  const db = getDb();
  const ts = nowIso();
  const p = pending.payload;
  const id = `DV${Date.now()}`;
  const condicion = p.condicion_devolucion || 'bueno';
  const penalizacion = /dan|incompleto/.test(condicion) ? 'si' : 'no';
  db.prepare(`INSERT INTO devoluciones (id, site_code, prestamo_id, dispositivo_id, codigo_dispositivo, usuario_nombre, fecha_devolucion_real, responsable_recepcion, condicion_devolucion, accesorios_devueltos, observaciones_devolucion, penalizacion_aplicada, detalle_penalizacion, created_at) VALUES (?, ?, ?, '', ?, ?, ?, 'Asistente TechAsset', ?, ?, ?, ?, '', ?)`).run(id, activeSite, p.prestamo_id || '', p.codigo_dispositivo, p.usuario_nombre || '', ts, condicion, p.accesorios_devueltos || '', p.observaciones_devolucion || '', penalizacion, ts);
  if (p.prestamo_id) db.prepare("UPDATE prestamos SET estado='devuelto', updated_at=? WHERE id=? AND site_code=?").run(ts, p.prestamo_id, activeSite);
  addLocalMovement({ tipo: 'devolución local', descripcion: `${p.codigo_dispositivo} devuelta`, operador: 'Asistente TechAsset', origen: 'Asistente', etiqueta: p.codigo_dispositivo, siteCode: activeSite });
  return response(`Listo. ${p.codigo_dispositivo} quedó devuelta.`, 'return_flow', { id });
}

function loanMissingQuestion(payload, missing) {
  if (missing.length > 1) return `Perfecto. Tengo ${loanKnownSummary(payload)}. Me falta ${missing.map(label).join(', ')}.`;
  const hints = {
    ubicacion: ' (ej: DOE, NFPT, SUM, Aula 12)',
    rol: ' (ej: Docente, DOE, Alumno, Preceptor)',
    usuario_nombre: ' (nombre de la persona)',
  };
  return `Perfecto. Me falta ${label(missing[0])}${hints[missing[0]] || ''}.`;
}

function extractDeviceFromText(text) {
  const raw = String(text || '').match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '');
  return raw ? normalizeCode(raw) : '';
}

function response(reply, intent, data = {}) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data };
}

function confirm(reply, intent, pendingAction, suggestedActions) {
  return { reply, intent, needsConfirmation: true, pendingAction, suggestedActions, data: {} };
}

function askFlow(memory, reply, intent, waitingFor) {
  memory.waitingFor = waitingFor;
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data: {} };
}

import { getDb, nowIso } from '../../db.js';
import { normalize, dayName, toLocalDate } from './utils.js';
import { parseAgendaText } from './parser.js';

export async function handleAgendaFlow(memory, text, action) {
  memory.activeFlow = 'agenda_flow';
  if (action === 'show_agenda' || /que tengo|mostrame|ver agenda|agenda hoy|agenda semana/i.test(text)) return agendaQuery(normalize(text), memory.siteCode);
  const parsed = parseAgendaText(text, memory.collectedData || {});
  memory.collectedData = parsed;
  const missing = [];
  if (!parsed.dia) missing.push('dia');
  if (!parsed.desde) missing.push('hora');
  if (missing.length) return askFlow(memory, `Para agendar me falta ${missing[0] === 'dia' ? 'día' : missing[0]}.`, 'agenda_flow', missing[0]);
  const pendingAction = { type: 'crear_evento_agenda', payload: parsed };
  return confirm(
    `Confirmame esta agenda:\nDía: ${parsed.dia}\nHora: ${parsed.desde}\nActividad: ${parsed.actividad}\nUbicación: ${parsed.ubicacion || 'Aula'}`,
    'agenda_flow', pendingAction, ['Crear agenda', 'Cancelar']
  );
}

export async function executeAgenda(pending, activeSite) {
  const db = getDb();
  const ts = nowIso();
  const id = `AG${Date.now()}`;
  const p = pending.payload;
  db.prepare(`INSERT INTO agenda (id, site_code, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, responsable_tic, estado, nota, compus_retiradas, operador_ultimo_cambio, ultima_modificacion, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Pendiente', '', 0, 'Asistente TechAsset', ?, ?)`).run(id, activeSite, p.dia, p.fecha || '', p.turno || 'Mañana', p.desde || '', p.hasta || '', p.curso || '', p.actividad || 'Actividad TIC', p.tipoDispositivo || 'Touch', p.cantidad || 1, p.ubicacion || 'Aula', ts, ts);
  return response(`Actividad creada: ${p.actividad}`, 'agenda_flow', { id });
}

function agendaQuery(lower, siteCode) {
  const rows = getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 AND site_code=? ORDER BY dia, desde LIMIT 40').all(siteCode);
  const today = dayName(new Date());
  const filtered = /hoy/.test(lower) ? rows.filter(row => normalize(row.dia) === normalize(today)) : rows;
  return response(filtered.length ? `Encontré ${filtered.length} actividades de agenda.` : 'No encontré agenda para ese criterio.', 'agenda_flow', { items: filtered });
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

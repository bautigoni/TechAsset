import { getDb, nowIso } from '../../db.js';
import { normalize } from './utils.js';
import { parseTaskText } from './parser.js';

export async function handleTaskFlow(memory, text, action) {
  memory.activeFlow = 'task_flow';
  if (/mostrame|listar|consult|pendiente|vencid/i.test(text)) return taskQuery(normalize(text), memory.siteCode);
  const parsed = parseTaskText(text, memory.collectedData || {});
  memory.collectedData = parsed;
  const pendingAction = { type: 'crear_tarea', payload: parsed };
  return confirm(
    `Puedo crear esta tarea:\n${parsed.titulo}\nResponsable: ${parsed.responsable}\nPrioridad: ${parsed.prioridad}\n\n¿Confirmás?`,
    'task_flow', pendingAction, ['Crear tarea', 'Cancelar']
  );
}

export async function executeTask(pending, activeSite) {
  const db = getDb();
  const ts = nowIso();
  const id = `TK${Date.now()}`;
  const p = pending.payload;
  db.prepare(`INSERT INTO tasks (id, site_code, titulo, descripcion, responsable, estado, prioridad, tipo, fecha_creacion, fecha_vencimiento, comentario, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion) VALUES (?, ?, ?, ?, ?, ?, ?, 'Asistente', ?, '', '', 'Asistente TechAsset', 'Asistente TechAsset', '', ?)`).run(id, activeSite, p.titulo, p.descripcion || '', p.responsable || 'Sin asignar', p.estado || 'Pendiente', p.prioridad || 'Media', ts, ts);
  return response(`Tarea creada: ${p.titulo}`, 'task_flow', { id });
}

function taskQuery(lower, siteCode) {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC LIMIT 20').all(siteCode);
  const filtered = /vencid/.test(lower)
    ? rows.filter(row => row.fecha_vencimiento && row.fecha_vencimiento < new Date().toISOString().split('T')[0] && row.estado !== 'Hecha')
    : rows;
  return response(filtered.length ? `Encontré ${filtered.length} tareas.` : 'No encontré tareas para ese criterio.', 'task_flow', { items: filtered });
}

function response(reply, intent, data = {}) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data };
}

function confirm(reply, intent, pendingAction, suggestedActions) {
  return { reply, intent, needsConfirmation: true, pendingAction, suggestedActions, data: {} };
}

import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { callOpenAiResponses, responseOutputText } from './openaiResponses.service.js';

const pendingTickets = new Map();

export function queueTicketSummary(ticketId, siteCode) {
  const key = `${siteCode}:${ticketId}`;
  if (pendingTickets.has(key)) clearTimeout(pendingTickets.get(key));
  pendingTickets.set(key, setTimeout(() => {
    pendingTickets.delete(key);
    refreshTicketSummary(ticketId, siteCode).catch(error => console.warn('[ticket-summary]', error?.message || error));
  }, 750));
}

export async function refreshTicketSummary(ticketId, siteCode, { force = false } = {}) {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE id=? AND site_code=? AND activo=1').get(ticketId, siteCode);
  if (!ticket) return null;
  const comments = db.prepare("SELECT body, author_name, created_at FROM ticket_comments WHERE ticket_id=? AND site_code=? AND COALESCE(deleted_at,'')='' ORDER BY id").all(ticketId, siteCode);
  const activity = db.prepare('SELECT action, detail, actor_name, created_at FROM ticket_activity WHERE ticket_id=? AND site_code=? ORDER BY id').all(ticketId, siteCode);
  const checklist = db.prepare('SELECT text, done FROM ticket_checklist_items WHERE ticket_id=? AND site_code=? ORDER BY position,id').all(ticketId, siteCode);
  const fallback = deterministicTicketSummary(ticket, comments, activity, checklist);
  let summary = fallback;
  if (config.openaiApiKey && (force || comments.length || activity.length)) {
    summary = await generateText({
      instructions: 'Resumí el ticket técnico en español claro y muy conciso. Incluí: qué pasó, estado actual, acciones realizadas, trabajo pendiente y resolución final si está cerrado. No inventes datos. Máximo 120 palabras.',
      input: JSON.stringify({ ticket: pickTicket(ticket), comments, activity, checklist })
    }).catch(() => fallback);
  }
  db.prepare('UPDATE tickets SET ai_summary=?, ai_summary_updated_at=? WHERE id=? AND site_code=?').run(summary, nowIso(), ticketId, siteCode);
  return summary;
}

export async function getDeviceAiSummary({ siteCode, device, events, tickets }) {
  const signature = crypto.createHash('sha256').update(JSON.stringify({ device, events: events.slice(0, 30), tickets: tickets.slice(0, 20) })).digest('hex');
  const cached = getDb().prepare('SELECT * FROM device_ai_summaries WHERE site_code=? AND device_tag=?').get(siteCode, device.etiqueta);
  if (cached?.source_signature === signature && cached.summary) return { text: cached.summary, generatedAt: cached.generated_at, cached: true };
  const fallback = deterministicDeviceSummary(device, events, tickets);
  const text = config.openaiApiKey
    ? await generateText({
      instructions: 'Redactá un resumen técnico de un dispositivo en español, una sola frase o párrafo corto. Usá únicamente los datos provistos: estado/asignación, cantidad de préstamos, reparaciones/incidentes y fechas relevantes. No inventes garantía, compra ni mantenimiento.',
      input: JSON.stringify({ device, recentEvents: events.slice(0, 25), tickets: tickets.slice(0, 15) })
    }).catch(() => fallback)
    : fallback;
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO device_ai_summaries (site_code, device_tag, source_signature, summary, generated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(site_code, device_tag) DO UPDATE SET source_signature=excluded.source_signature, summary=excluded.summary, generated_at=excluded.generated_at
  `).run(siteCode, device.etiqueta, signature, text, ts);
  return { text, generatedAt: ts, cached: false };
}

async function generateText({ instructions, input }) {
  const data = await callOpenAiResponses({ instructions, input, maxOutputTokens: 300 });
  const text = responseOutputText(data);
  if (!text) throw new Error('Respuesta de IA vacía');
  return text;
}

function deterministicTicketSummary(ticket, comments, activity, checklist) {
  const done = checklist.filter(item => Number(item.done) === 1).length;
  const lastComment = comments.at(-1)?.body || '';
  const pending = checklist.filter(item => Number(item.done) !== 1).map(item => item.text).slice(0, 3);
  const parts = [`${ticket.titulo || 'Incidente'}: ${ticket.descripcion || 'sin descripción adicional'}.`, `Estado actual: ${ticket.estado || 'No hecho'}.`];
  if (activity.length) parts.push(`Última acción: ${activity.at(-1).action}${activity.at(-1).detail ? ` (${activity.at(-1).detail})` : ''}.`);
  if (lastComment) parts.push(`Último comentario: ${lastComment.slice(0, 180)}.`);
  if (checklist.length) parts.push(`Checklist: ${done}/${checklist.length} completado${pending.length ? `; pendiente: ${pending.join(', ')}` : ''}.`);
  if (ticket.estado === 'Hecho') parts.push(`Resolución registrada${ticket.nota ? `: ${ticket.nota}` : '.'}`);
  return parts.join(' ').slice(0, 1000);
}

function deterministicDeviceSummary(device, events, tickets) {
  const loans = events.filter(event => event.tipo === 'prestamo');
  const incidents = tickets.length;
  const repairs = tickets.filter(ticket => /repar|manten|service/i.test(`${ticket.categoria} ${ticket.titulo}`)).length;
  const assignment = device.prestadoA ? `prestado a ${device.prestadoA}` : `en estado ${device.estado || 'sin revisar'}`;
  const lastLoan = loans[0]?.timestamp ? ` El último préstamo fue el ${String(loans[0].timestamp).slice(0, 10)}.` : '';
  return `${device.aliasOperativo || device.etiqueta} está ${assignment}. Registra ${loans.length} préstamo${loans.length === 1 ? '' : 's'}, ${incidents} incidente${incidents === 1 ? '' : 's'} y ${repairs} intervención${repairs === 1 ? '' : 'es'} de reparación o mantenimiento.${lastLoan}`;
}

function pickTicket(ticket) {
  return { numero: ticket.numero, titulo: ticket.titulo, descripcion: ticket.descripcion, estado: ticket.estado, prioridad: ticket.prioridad, categoria: ticket.categoria, nota: ticket.nota, createdAt: ticket.created_at, updatedAt: ticket.updated_at, resolvedAt: ticket.resolved_at };
}

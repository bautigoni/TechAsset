import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

export const analyticsRouter = Router();

const DAY_MS = 86400000;

function parseRange(query = {}) {
  const now = new Date();
  let to = query.to ? new Date(query.to) : now;
  let from = query.from ? new Date(query.from) : new Date(now.getTime() - 365 * DAY_MS);
  if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 365 * DAY_MS);
  if (Number.isNaN(to.getTime())) to = now;
  // Incluir todo el día "to".
  const toEnd = new Date(to.getTime());
  toEnd.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: toEnd.toISOString() };
}

function countBy(events, getter) {
  const map = new Map();
  for (const ev of events) {
    const label = String(getter(ev) || '').trim();
    if (!label || label === '-') continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function rowsFromMap(map) {
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function buildSeries(events, from, to) {
  const spanDays = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS));
  const monthly = spanDays > 92;
  const buckets = new Map();
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = monthly
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return {
    granularity: monthly ? 'month' : 'day',
    rows: [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }))
  };
}

function buildAnnualTrend(events) {
  const buckets = new Map();
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
  }
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

function buildHourWeekday(events) {
  const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const map = new Map();
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${days[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:00`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return rowsFromMap(map);
}

function buildAverageLoanHours(events) {
  const open = new Map();
  const totals = new Map();
  const counts = new Map();
  for (const ev of [...events].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
    const tag = String(ev.etiqueta || '').trim().toUpperCase();
    if (!tag) continue;
    const time = new Date(ev.timestamp).getTime();
    if (Number.isNaN(time)) continue;
    if (ev.tipo === 'prestamo') open.set(tag, { time, label: ev.alias || tag });
    if (ev.tipo === 'devolucion' && open.has(tag)) {
      const start = open.get(tag);
      const hours = Math.max(0, (time - start.time) / 3600000);
      totals.set(start.label, (totals.get(start.label) || 0) + hours);
      counts.set(start.label, (counts.get(start.label) || 0) + 1);
      open.delete(tag);
    }
  }
  return [...totals.entries()]
    .map(([label, total]) => ({ label, value: Math.round((total / Math.max(1, counts.get(label) || 1)) * 10) / 10 }))
    .sort((a, b) => b.value - a.value);
}

function buildAgendaOccupation(siteCode) {
  return getDb().prepare(`
    SELECT COALESCE(NULLIF(dia,''),'Sin dia') AS label, COUNT(*) AS value
    FROM agenda
    WHERE site_code=? AND eliminada=0 AND estado NOT IN ('Cancelado','Realizado')
    GROUP BY COALESCE(NULLIF(dia,''),'Sin dia')
    ORDER BY value DESC
  `).all(siteCode).map(row => ({ label: row.label, value: Number(row.value || 0) }));
}

function ticketDeviceRows(siteCode) {
  const rows = getDb().prepare(`
    SELECT titulo, descripcion, nota
    FROM tickets
    WHERE site_code=? AND activo=1
  `).all(siteCode);
  const map = new Map();
  for (const row of rows) {
    const text = `${row.titulo || ''} ${row.descripcion || ''} ${row.nota || ''}`;
    const tags = text.match(/\bD\s*0*\d{1,5}\b/gi) || [];
    for (const tag of tags) {
      const number = tag.match(/\d{1,5}/)?.[0] || '';
      if (number) map.set(`D${number.padStart(4, '0')}`, (map.get(`D${number.padStart(4, '0')}`) || 0) + 1);
    }
  }
  return rowsFromMap(map);
}

function avgTicketResponseDays(siteCode) {
  const rows = getDb().prepare(`
    SELECT created_at AS createdAt, updated_at AS updatedAt
    FROM tickets
    WHERE site_code=? AND activo=1 AND estado='Hecho' AND created_at<>'' AND updated_at<>''
  `).all(siteCode);
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => {
    const start = new Date(row.createdAt).getTime();
    const end = new Date(row.updatedAt).getTime();
    return Number.isNaN(start) || Number.isNaN(end) ? sum : sum + Math.max(0, (end - start) / DAY_MS);
  }, 0);
  return Math.round((total / rows.length) * 10) / 10;
}

function buildHourSeries(events) {
  const buckets = new Map(Array.from({ length: 12 }, (_, index) => [`${String(index + 7).padStart(2, '0')}:00`, 0]));
  for (const ev of events) {
    const date = new Date(ev.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const hour = date.getHours();
    const label = `${String(hour).padStart(2, '0')}:00`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }));
}

function buildWeekdaySeries(events) {
  const labels = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const buckets = new Map(labels.map(label => [label, 0]));
  for (const ev of events) {
    const date = new Date(ev.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const label = labels[date.getDay()];
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }));
}

analyticsRouter.get('/analytics', (req, res) => {
  const siteCode = requireSite(req);
  const { from, to } = parseRange(req.query);
  const rows = getDb().prepare(`
    SELECT id, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle AS ubicacionDetalle,
           curso, motivo, motivo_detalle AS motivoDetalle, comentarios, operador, origen, timestamp
    FROM loan_events
    WHERE site_code=? AND timestamp>=? AND timestamp<=?
    ORDER BY timestamp DESC
  `).all(siteCode, from, to);

  const prestamos = rows.filter(r => r.tipo === 'prestamo');
  const devoluciones = rows.filter(r => r.tipo === 'devolucion');
  const allEvents = getDb().prepare(`
    SELECT id, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle AS ubicacionDetalle,
           curso, motivo, motivo_detalle AS motivoDetalle, comentarios, operador, origen, timestamp
    FROM loan_events
    WHERE site_code=?
    ORDER BY timestamp ASC
  `).all(siteCode);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const ticketsAbiertos = getDb().prepare("SELECT COUNT(*) AS total FROM tickets WHERE site_code=? AND activo=1 AND estado<>'Hecho'").get(siteCode).total;
  const tareasAbiertas = getDb().prepare("SELECT COUNT(*) AS total FROM tasks WHERE site_code=? AND eliminada=0 AND estado<>'Hecha'").get(siteCode).total;
  const byTaskType = getDb().prepare(`
    SELECT COALESCE(NULLIF(tipo,''),'Sin tipo') AS label, COUNT(*) AS value
    FROM tasks
    WHERE site_code=? AND eliminada=0
    GROUP BY COALESCE(NULLIF(tipo,''),'Sin tipo')
    ORDER BY value DESC
  `).all(siteCode).map(row => ({ label: row.label, value: Number(row.value || 0) }));

  const summary = {
    totalPrestamos: prestamos.length,
    totalDevoluciones: devoluciones.length,
    prestamosHoy: allEvents.filter(r => r.tipo === 'prestamo' && String(r.timestamp || '').startsWith(today)).length,
    prestamosAyer: allEvents.filter(r => r.tipo === 'prestamo' && String(r.timestamp || '').startsWith(yesterday)).length,
    ticketsAbiertos: Number(ticketsAbiertos || 0),
    tareasAbiertas: Number(tareasAbiertas || 0),
    personasUnicas: new Set(prestamos.map(r => (r.persona || '').trim().toLowerCase()).filter(Boolean)).size,
    equiposUnicos: new Set(prestamos.map(r => (r.etiqueta || '').trim().toUpperCase()).filter(Boolean)).size,
    byPerson: countBy(prestamos, r => r.persona),
    byRole: countBy(prestamos, r => r.rol),
    byLocation: countBy(prestamos, r => r.ubicacion),
    byReason: countBy(prestamos, r => r.motivo),
    byCourse: countBy(prestamos, r => r.curso),
    byDevice: countBy(prestamos, r => r.alias || r.etiqueta),
    byOperator: countBy(rows, r => r.operador),
    byTicketDevice: ticketDeviceRows(siteCode),
    byTaskType,
    byHourWeekday: buildHourWeekday(prestamos),
    annualTrend: buildAnnualTrend(allEvents.filter(r => r.tipo === 'prestamo')),
    avgLoanHoursByDevice: buildAverageLoanHours(allEvents),
    ticketResponseDays: avgTicketResponseDays(siteCode),
    agendaOccupation: buildAgendaOccupation(siteCode),
    byHour: buildHourSeries(prestamos),
    byWeekday: buildWeekdaySeries(prestamos),
    series: buildSeries(prestamos, from, to)
  };

  res.json({ ok: true, from, to, events: rows, summary });
});

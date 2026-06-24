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

  const summary = {
    totalPrestamos: prestamos.length,
    totalDevoluciones: devoluciones.length,
    personasUnicas: new Set(prestamos.map(r => (r.persona || '').trim().toLowerCase()).filter(Boolean)).size,
    equiposUnicos: new Set(prestamos.map(r => (r.etiqueta || '').trim().toUpperCase()).filter(Boolean)).size,
    byPerson: countBy(prestamos, r => r.persona),
    byRole: countBy(prestamos, r => r.rol),
    byLocation: countBy(prestamos, r => r.ubicacion),
    byReason: countBy(prestamos, r => r.motivo),
    byCourse: countBy(prestamos, r => r.curso),
    series: buildSeries(prestamos, from, to)
  };

  res.json({ ok: true, from, to, events: rows, summary });
});

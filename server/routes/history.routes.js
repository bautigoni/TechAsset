import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { addDaysToLocalDate, localDayStartIso, localParts } from '../services/localTime.js';

/**
 * Historial con filtros y paginado.
 *
 * /api/movements trae solo los últimos 100 eventos (es lo que pinta el
 * dashboard) y no había dónde buscar "¿quién tuvo el D1436 en marzo?" o "¿qué
 * se llevó 5F esta semana?". Esto filtra en SQL y pagina por cursor (timestamp +
 * id) para que traer páginas viejas cueste lo mismo que la primera.
 *
 *   GET /api/history?kind=loans|all&q=&from=YYYY-MM-DD&to=YYYY-MM-DD&tipo=&before=<cursor>&limit=50
 */
export const historyRouter = Router();

const MAX_LIMIT = 200;

function parseFilters(query) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 50));
  const day = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '');
  // Los días son de la sede (hora argentina) y los timestamps, ISO UTC: se
  // compara contra el instante UTC en que empieza cada día local. Antes se
  // comparaba contra la fecha UTC y un préstamo de las 22 h caía al día siguiente.
  const from = localDayStartIso(day(query.from));
  const to = day(query.to);
  // El "hasta" incluye el día entero: se compara contra el inicio del día siguiente.
  const toExclusive = to ? localDayStartIso(addDaysToLocalDate(to, 1)) : '';
  const q = String(query.q || '').trim().toLowerCase().slice(0, 80);
  // Alias sin espacios: "touch34" encuentra el alias guardado "Touch 34".
  const qCompact = q.replace(/\s+/g, '');
  // Etiquetas que el front resolvió desde el texto con la búsqueda flexible
  // (touch34, 34touch, plani 5, planificación 5, 1436): se suman al LIKE.
  const tags = [...new Set(String(query.tags || '').split(',').map(tag => tag.trim().toUpperCase()).filter(tag => /^[A-Z0-9-]{1,20}$/.test(tag)))].slice(0, 40);
  const [beforeTs = '', beforeId = ''] = String(query.before || '').split('|');
  return { limit, from, toExclusive, q, qCompact, tags, beforeTs, beforeId: Number(beforeId) || 0, tipo: String(query.tipo || '').trim() };
}

/** Condición de texto: LIKE sobre las columnas + alias sin espacios + etiquetas resueltas. */
function textCondition({ q, qCompact, tags }, text, { alias, etiqueta } = {}) {
  const parts = [];
  const params = [];
  if (q) { parts.push(`lower(${text}) LIKE ?`); params.push(`%${q}%`); }
  if (q && alias && qCompact) { parts.push(`replace(lower(COALESCE(${alias},'')),' ','') LIKE ?`); params.push(`%${qCompact}%`); }
  if (tags.length && etiqueta) { parts.push(`upper(COALESCE(${etiqueta},'')) IN (${tags.map(() => '?').join(',')})`); params.push(...tags); }
  return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : null;
}

historyRouter.get('/history', (req, res) => {
  const siteCode = requireSite(req);
  const filters = parseFilters(req.query);
  const kind = req.query.kind === 'all' ? 'all' : 'loans';
  const rows = kind === 'loans' ? loanRows(siteCode, filters) : allRows(siteCode, filters);
  const hasMore = rows.length > filters.limit;
  const items = rows.slice(0, filters.limit);
  const last = items[items.length - 1];
  res.json({ ok: true, kind, items, nextCursor: hasMore && last ? `${last.timestamp}|${last.cursorId}` : '' });
});

/**
 * CSV de TODO lo filtrado (no solo lo cargado en pantalla), con BOM y fechas en
 * hora de la sede. Tope de 20.000 filas: más que eso no se abre cómodo en una
 * planilla y en Postgres sería una query muy larga.
 *   GET /api/history/export.csv?kind=loans|all&q=&from=&to=&tipo=&tags=
 */
const EXPORT_MAX = 20000;
historyRouter.get('/history/export.csv', (req, res) => {
  const siteCode = requireSite(req);
  const filters = { ...parseFilters(req.query), limit: EXPORT_MAX, beforeTs: '', beforeId: 0 };
  const kind = req.query.kind === 'all' ? 'all' : 'loans';
  const rows = (kind === 'loans' ? loanRows(siteCode, filters) : allRows(siteCode, filters)).slice(0, EXPORT_MAX);
  const day = toLocalDateLabel(new Date().toISOString()).slice(0, 10).split('/').reverse().join('-');
  const table = kind === 'loans'
    ? [
      ['Fecha', 'Tipo', 'Etiqueta', 'Alias', 'Persona', 'Rol', 'Curso', 'Ubicación', 'Motivo', 'Accesorios', 'Comentarios', 'Operador'],
      ...rows.map(item => [toLocalDateLabel(item.timestamp), item.tipo === 'prestamo' ? 'Préstamo' : item.tipo === 'devolucion' ? 'Devolución' : item.tipo, item.etiqueta, item.alias, item.persona, item.rol, item.curso, item.ubicacion, item.motivo, item.accesorios.join(' / '), item.comentarios, item.operador])
    ]
    : [
      ['Fecha', 'Origen', 'Tipo', 'Descripción', 'Etiqueta', 'Operador'],
      ...rows.map(item => [toLocalDateLabel(item.timestamp), item.origen, item.tipo, item.descripcion, item.etiqueta, item.operador])
    ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="historial_${kind === 'loans' ? 'prestamos' : 'movimientos'}_${siteCode}_${day}.csv"`);
  res.setHeader('X-Total-Rows', String(rows.length));
  res.send('﻿' + table.map(row => row.map(csvCell).join(',')).join('\n'));
});

/**
 * Resumen corto de un equipo para la mini ficha del Historial: préstamos y el
 * último. Una sola query (la ficha completa arma IA, tickets y timeline).
 */
historyRouter.get('/history/device-summary', (req, res) => {
  const siteCode = requireSite(req);
  const etiqueta = String(req.query.etiqueta || '').trim().toUpperCase().slice(0, 20);
  if (!etiqueta) return res.status(400).json({ ok: false, error: 'Falta la etiqueta.' });
  const row = getDb().prepare("SELECT COUNT(*) AS loans, MAX(timestamp) AS last FROM loan_events WHERE site_code=? AND upper(etiqueta)=? AND tipo='prestamo'").get(siteCode, etiqueta);
  res.json({ ok: true, etiqueta, loans: Number(row?.loans || 0), lastLoan: row?.last || '' });
});

function toLocalDateLabel(value) {
  const parts = localParts(value);
  if (!parts) return String(value || '');
  const pad = number => String(number).padStart(2, '0');
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function loanRows(siteCode, filters) {
  const { limit, from, toExclusive, beforeTs, beforeId, tipo } = filters;
  const where = ['site_code=?'];
  const params = [siteCode];
  if (from) { where.push('timestamp >= ?'); params.push(from); }
  if (toExclusive) { where.push('timestamp < ?'); params.push(toExclusive); }
  if (tipo === 'prestamo' || tipo === 'devolucion') { where.push('tipo=?'); params.push(tipo); }
  const text = textCondition(filters, "COALESCE(etiqueta,'') || ' ' || COALESCE(alias,'') || ' ' || COALESCE(persona,'') || ' ' || COALESCE(curso,'') || ' ' || COALESCE(ubicacion,'') || ' ' || COALESCE(operador,'') || ' ' || COALESCE(motivo,'')", { alias: 'alias', etiqueta: 'etiqueta' });
  if (text) { where.push(text.sql); params.push(...text.params); }
  if (beforeTs) { where.push('(timestamp < ? OR (timestamp = ? AND id < ?))'); params.push(beforeTs, beforeTs, beforeId); }
  params.push(limit + 1);
  return getDb().prepare(`
    SELECT id, timestamp, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle, curso,
           motivo, motivo_detalle, comentarios, operador, accessories_json
    FROM loan_events WHERE ${where.join(' AND ')}
    ORDER BY timestamp DESC, id DESC LIMIT ?
  `).all(...params).map(row => ({
    cursorId: row.id,
    timestamp: row.timestamp,
    tipo: row.tipo,
    etiqueta: row.etiqueta || '',
    alias: row.alias || '',
    filtro: row.filtro || '',
    persona: row.persona || '',
    rol: row.rol || '',
    ubicacion: [row.ubicacion, row.ubicacion_detalle].filter(Boolean).join(' · '),
    curso: row.curso || '',
    motivo: [row.motivo, row.motivo_detalle].filter(Boolean).join(' · '),
    comentarios: row.comentarios || '',
    operador: row.operador || '',
    accesorios: parseList(row.accessories_json)
  }));
}

function allRows(siteCode, filters) {
  const { limit, from, toExclusive, beforeTs, beforeId } = filters;
  // Las tres fuentes de /api/movements, con los mismos filtros en cada una. El
  // id del cursor se separa por fuente (×10 + n) para que sea único en la unión.
  const sources = [
    { table: 'local_movements', select: "id * 10 + 1 AS cursor_id, timestamp, tipo, descripcion, operador, origen, etiqueta", text: "COALESCE(descripcion,'') || ' ' || COALESCE(etiqueta,'') || ' ' || COALESCE(operador,'') || ' ' || COALESCE(tipo,'')", alias: '' },
    { table: 'agenda_history h LEFT JOIN agenda a ON a.id=h.agenda_id AND a.site_code=h.site_code', select: "h.id * 10 + 2 AS cursor_id, h.timestamp, h.accion AS tipo, COALESCE(a.curso || ' - ' || a.actividad, h.accion) AS descripcion, h.operador, 'Agenda TIC' AS origen, '' AS etiqueta", text: "COALESCE(a.curso,'') || ' ' || COALESCE(a.actividad,'') || ' ' || COALESCE(h.accion,'') || ' ' || COALESCE(h.operador,'')", alias: 'h.' },
    { table: 'task_history', select: "id * 10 + 3 AS cursor_id, timestamp, accion AS tipo, titulo AS descripcion, operador, 'Tareas TIC' AS origen, '' AS etiqueta", text: "COALESCE(titulo,'') || ' ' || COALESCE(accion,'') || ' ' || COALESCE(operador,'')", alias: '' }
  ];
  const params = [];
  const parts = sources.map((source, index) => {
    const col = name => `${source.alias}${name}`;
    const where = [`${col('site_code')}=?`];
    params.push(siteCode);
    if (from) { where.push(`${col('timestamp')} >= ?`); params.push(from); }
    if (toExclusive) { where.push(`${col('timestamp')} < ?`); params.push(toExclusive); }
    const text = textCondition(filters, source.text, index === 0 ? { etiqueta: 'etiqueta' } : {});
    if (text) { where.push(text.sql); params.push(...text.params); }
    if (beforeTs) {
      where.push(`(${col('timestamp')} < ? OR (${col('timestamp')} = ? AND ${col('id')} * 10 + ${index + 1} < ?))`);
      params.push(beforeTs, beforeTs, beforeId);
    }
    return `SELECT * FROM (SELECT ${source.select} FROM ${source.table} WHERE ${where.join(' AND ')} ORDER BY ${col('timestamp')} DESC, ${col('id')} DESC LIMIT ${limit + 1}) part${index}`;
  });
  const rows = getDb().prepare(parts.join(' UNION ALL ')).all(...params)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || b.cursor_id - a.cursor_id)
    .slice(0, limit + 1);
  return rows.map(row => ({
    cursorId: row.cursor_id,
    timestamp: row.timestamp,
    tipo: row.tipo || '',
    descripcion: row.descripcion || '',
    operador: row.operador || '',
    origen: row.origen || '',
    etiqueta: row.etiqueta || ''
  }));
}


function parseList(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

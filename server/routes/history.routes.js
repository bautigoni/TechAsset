import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

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
  const from = day(query.from);
  const to = day(query.to);
  // El "hasta" incluye el día entero: se compara contra el día siguiente.
  const toExclusive = to ? new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : '';
  const q = String(query.q || '').trim().toLowerCase().slice(0, 80);
  const [beforeTs = '', beforeId = ''] = String(query.before || '').split('|');
  return { limit, from, toExclusive, q, beforeTs, beforeId: Number(beforeId) || 0, tipo: String(query.tipo || '').trim() };
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

function loanRows(siteCode, { limit, from, toExclusive, q, beforeTs, beforeId, tipo }) {
  const where = ['site_code=?'];
  const params = [siteCode];
  if (from) { where.push('timestamp >= ?'); params.push(from); }
  if (toExclusive) { where.push('timestamp < ?'); params.push(toExclusive); }
  if (tipo === 'prestamo' || tipo === 'devolucion') { where.push('tipo=?'); params.push(tipo); }
  if (q) {
    where.push("lower(COALESCE(etiqueta,'') || ' ' || COALESCE(alias,'') || ' ' || COALESCE(persona,'') || ' ' || COALESCE(curso,'') || ' ' || COALESCE(ubicacion,'') || ' ' || COALESCE(operador,'') || ' ' || COALESCE(motivo,'')) LIKE ?");
    params.push(`%${q}%`);
  }
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

function allRows(siteCode, { limit, from, toExclusive, q, beforeTs, beforeId }) {
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
    if (q) { where.push(`lower(${source.text}) LIKE ?`); params.push(`%${q}%`); }
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

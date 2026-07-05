import { getDb } from '../../db.js';
import { config } from '../../config.js';

const conversations = new Map();

export function getMemory(conversationId) {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, {
      activeFlow: null,
      waitingFor: null,
      collectedData: {},
      pendingConfirmation: null,
      lastIntent: null,
      lastDevice: '',
      lastPerson: '',
      messages: [],
      siteCode: config.defaultSiteCode || 'NFPT'
    });
  }
  return conversations.get(conversationId);
}

export function saveMemory(conversationId, memory) {
  conversations.set(conversationId, memory);
}

export function clearMemory(conversationId) {
  conversations.delete(conversationId);
}

export function clearAllMemory() {
  conversations.clear();
}

export function getKnownPersons(siteCode, query) {
  const db = getDb();
  const q = `%${query}%`;
  const fromLoans = db.prepare(`
    SELECT DISTINCT usuario_nombre AS nombre, MIN(rol) AS ultimo_rol
    FROM prestamos
    WHERE site_code=? AND usuario_nombre LIKE ? AND LENGTH(usuario_nombre) > 1
    GROUP BY usuario_nombre
    ORDER BY MAX(fecha_prestamo) DESC
    LIMIT 10
  `).all(siteCode, q);

  const fromReturns = db.prepare(`
    SELECT DISTINCT usuario_nombre AS nombre, '' AS ultimo_rol
    FROM devoluciones
    WHERE site_code=? AND usuario_nombre LIKE ? AND LENGTH(usuario_nombre) > 1
    AND usuario_nombre NOT IN (SELECT DISTINCT usuario_nombre FROM prestamos WHERE site_code=?)
    GROUP BY usuario_nombre
    ORDER BY MAX(fecha_devolucion_real) DESC
    LIMIT 5
  `).all(siteCode, q, siteCode);

  const seen = new Set();
  const all = [...fromLoans];
  for (const row of fromReturns) {
    if (!seen.has(row.nombre)) all.push(row);
    seen.add(row.nombre);
  }
  return all.slice(0, 10);
}

export function findPerson(siteCode, nameQuery) {
  if (!nameQuery || nameQuery.length < 1) return null;
  const q = normalizeForSearch(nameQuery);
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT usuario_nombre AS nombre, MIN(rol) AS ultimo_rol,
      GROUP_CONCAT(DISTINCT ubicacion || '||' || motivo, ';;') AS ultimos_contextos
    FROM (
      SELECT usuario_nombre, rol, ubicacion, motivo
      FROM prestamos
      WHERE site_code=? AND LENGTH(usuario_nombre) > 1
      UNION ALL
      SELECT usuario_nombre, '' AS rol, '' AS ubicacion, '' AS motivo
      FROM devoluciones
      WHERE site_code=? AND LENGTH(usuario_nombre) > 1
    )
    GROUP BY usuario_nombre
    ORDER BY MAX(rowid) DESC
    LIMIT 20
  `).all(siteCode, siteCode);

  const normalizedRows = rows.map(r => ({
    ...r,
    _norm: normalizeForSearch(r.nombre)
  }));

  const exact = normalizedRows.filter(r => r._norm === q);
  if (exact.length) return { nombre: exact[0].nombre, rol: exact[0].ultimo_rol || '', contextos: exact[0].ultimos_contextos || '' };

  const startsWith = normalizedRows.filter(r => r._norm.startsWith(q) || q.startsWith(r._norm));
  if (startsWith.length) return { nombre: startsWith[0].nombre, rol: startsWith[0].ultimo_rol || '', contextos: startsWith[0].ultimos_contextos || '' };

  const partial = normalizedRows.filter(r => r._norm.includes(q) || q.includes(r._norm));
  if (partial.length) return { nombre: partial[0].nombre, rol: partial[0].ultimo_rol || '', contextos: partial[0].ultimos_contextos || '' };

  return null;
}

function normalizeForSearch(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
}

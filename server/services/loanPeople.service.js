// Personas que alguna vez recibieron un préstamo, agrupadas por nombre
// normalizado, con su rol/ubicación/curso/motivo más usados.
//
// Antes /loans/suggest y el Asistente leían TODA la tabla loan_events en cada
// letra tipeada. Con la base remota (Supabase) eso es transferir miles de filas
// por tecla mientras el resto de la app espera. Ahora se arma una vez por sede
// y se invalida cuando se registra un préstamo (o a los 2 minutos, por si
// escribió otra ruta).
import { getDb } from '../db.js';
import { normalizePersonName } from './peopleRoster.service.js';

const TTL_MS = 2 * 60 * 1000;
const cache = new Map(); // siteCode -> { at, groups }

export function invalidateLoanPeople(siteCode) {
  if (siteCode) cache.delete(siteCode); else cache.clear();
}

function build(siteCode) {
  const rows = getDb().prepare(`
    SELECT persona, rol, ubicacion, curso, motivo, timestamp
    FROM loan_events
    WHERE site_code=? AND tipo='prestamo' AND TRIM(persona)<>''
  `).all(siteCode);
  const groups = new Map();
  for (const row of rows) {
    const key = normalizePersonName(row.persona);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) { group = { key, persona: row.persona, count: 0, last: '', roles: {}, ubic: {}, cursos: {}, motivos: {} }; groups.set(key, group); }
    group.count += 1;
    const ts = String(row.timestamp || '');
    if (!group.last || ts > group.last) { group.last = ts; group.persona = row.persona; }
    bump(group.roles, row.rol);
    bump(group.ubic, row.ubicacion);
    bump(group.cursos, row.curso);
    bump(group.motivos, row.motivo);
  }
  return [...groups.values()]
    .map(group => ({
      key: group.key,
      persona: group.persona,
      count: group.count,
      lastAt: group.last,
      rol: mode(group.roles),
      ubicacion: mode(group.ubic),
      curso: mode(group.cursos),
      motivo: mode(group.motivos)
    }))
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** Todas las personas con préstamos de la sede, de la más frecuente a la menos. */
export function getLoanPeople(siteCode) {
  const hit = cache.get(siteCode);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.groups;
  const groups = build(siteCode);
  cache.set(siteCode, { at: Date.now(), groups });
  return groups;
}

/** Coincidencia por subcadena del nombre normalizado ("mili" → "Mili DOE"). */
export function searchLoanPeople(siteCode, query, limit = 8) {
  const q = normalizePersonName(query);
  if (!q) return [];
  const out = [];
  for (const group of getLoanPeople(siteCode)) {
    if (!group.key.includes(q)) continue;
    out.push(group);
    if (out.length >= limit) break;
  }
  return out;
}

function bump(map, value) {
  const key = String(value || '').trim();
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function mode(map) {
  let best = '';
  let bestCount = 0;
  for (const [key, count] of Object.entries(map)) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return best;
}

import { getDb, getLoanEventsVersion } from '../db.js';

// Directorio de personas que pidieron equipos (por sede), para la búsqueda
// rápida de Préstamos y del Inicio (DIRECTIVA §6).
//
// Antes cada sugerencia (una por tecla, tras 220 ms) leía TODO loan_events de la
// sede y agrupaba en JS: con un año de uso son miles de filas por pedido, y en
// producción eso es un viaje sincrónico a Supabase que además trae todas esas
// filas por la red. Ahora el directorio se arma una vez por sede, queda en
// memoria y se rearma solo cuando cambia loan_events (versión que sube
// addLoanEvent y el Deshacer) o a los 10 minutos (por si alguien escribió la
// base por fuera de la app). Pedir sugerencias pasa a costar 0 consultas, y el
// front puede bajarse el directorio entero (~10 KB gzip con 400 personas) y
// filtrar localmente sin esperar a la red.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // site -> { version, at, people }

export function normalizePersonName(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

export function getLoanPeople(siteCode) {
  const site = String(siteCode || '').toUpperCase();
  const version = getLoanEventsVersion();
  const hit = cache.get(site);
  if (hit && hit.version === version && Date.now() - hit.at < TTL_MS) return hit.people;
  const rows = getDb().prepare(`
    SELECT persona, rol, ubicacion, curso, motivo, timestamp
    FROM loan_events
    WHERE site_code=? AND tipo='prestamo' AND TRIM(persona)<>''
  `).all(site);
  const groups = new Map();
  for (const row of rows) {
    const key = normalizePersonName(row.persona);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) { group = { key, persona: row.persona, count: 0, last: '', roles: {}, ubic: {}, cursos: {}, motivos: {} }; groups.set(key, group); }
    group.count += 1;
    if (!group.last || String(row.timestamp) > group.last) { group.last = String(row.timestamp || ''); group.persona = row.persona; }
    bump(group.roles, row.rol);
    bump(group.ubic, row.ubicacion);
    bump(group.cursos, row.curso);
    bump(group.motivos, row.motivo);
  }
  const people = [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .map(group => ({
      key: group.key,
      persona: group.persona,
      count: group.count,
      lastAt: group.last,
      rol: mode(group.roles),
      ubicacion: mode(group.ubic),
      curso: mode(group.cursos),
      motivo: mode(group.motivos)
    }));
  cache.set(site, { version, at: Date.now(), people });
  return people;
}

/**
 * Misma regla que searchPeople en src/services/peopleDirectory.ts (si cambia
 * una, cambiar la otra): sin distinguir mayúsculas ni tildes, cada palabra
 * tipeada tiene que aparecer en el nombre ("gonz mar" encuentra a "María
 * González"); primero quien empieza con lo tipeado, después quien tiene una
 * palabra que empieza así, y dentro de cada grupo por uso y fecha.
 */
export function searchLoanPeople(people, query, limit = 8) {
  const q = normalizePersonName(query);
  if (!q) return people.slice(0, limit);
  const tokens = q.split(' ');
  const scored = [];
  for (const person of people) {
    if (!tokens.every(token => person.key.includes(token))) continue;
    const rank = person.key.startsWith(q) ? 0 : person.key.split(' ').some(word => word.startsWith(tokens[0])) ? 1 : 2;
    scored.push({ person, rank });
  }
  // people ya viene ordenado por uso y fecha: el sort estable conserva ese orden dentro de cada rango.
  return scored.sort((a, b) => a.rank - b.rank).slice(0, limit).map(item => item.person);
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

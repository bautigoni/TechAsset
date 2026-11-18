// Lista de docentes y alumnos de cada sede.
//
// Se carga pegando texto (en el chat del Asistente o en Configuración → Lista de
// personas) y sirve para dos cosas:
//  - sugerir nombres en Préstamos y en los cartelitos aunque esa persona nunca
//    haya tenido un préstamo;
//  - que el Asistente sepa el curso o si es docente/alumno al nombrar a alguien.
// Es por sede, como todo dato operativo: NFPT y NFND nunca cruzan.
//
// La lista entera vive en memoria por sede (unos cientos de filas): las
// sugerencias se piden con cada letra que se escribe, y con la base remota cada
// query bloquea el servidor. Se invalida en cada escritura.
import { getDb, nowIso } from '../db.js';

export const ROSTER_LIMITS = { maxPeople: 5000, maxNameLength: 120 };

const cache = new Map(); // siteCode -> { items }

export function normalizePersonName(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,;]+$/g, '').replace(/\s+/g, ' ');
}

function loadRoster(siteCode) {
  const hit = cache.get(siteCode);
  if (hit) return hit.items;
  const items = getDb().prepare(`
    SELECT id, nombre, nombre_norm AS nombreNorm, tipo, curso
    FROM people_roster WHERE site_code=? ORDER BY nombre
  `).all(siteCode);
  cache.set(siteCode, { items });
  return items;
}

export function invalidateRoster(siteCode) {
  if (siteCode) cache.delete(siteCode); else cache.clear();
}

export function listRoster(siteCode) {
  return loadRoster(siteCode).map(({ id, nombre, tipo, curso }) => ({ id, nombre, tipo, curso: curso || '' }));
}

export function rosterCounts(siteCode) {
  const items = loadRoster(siteCode);
  return {
    total: items.length,
    docentes: items.filter(item => item.tipo === 'docente').length,
    alumnos: items.filter(item => item.tipo === 'alumno').length
  };
}

/**
 * Busca por nombre o apellido. Todas las palabras de la consulta tienen que
 * aparecer al principio de alguna palabra del nombre ("gon bau" encuentra
 * "Goñi, Bautista"), así un apellido solo ya alcanza.
 */
export function searchRoster(siteCode, query, { limit = 8, tipo = '' } = {}) {
  const words = normalizePersonName(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const results = [];
  for (const item of loadRoster(siteCode)) {
    if (tipo && item.tipo !== tipo) continue;
    const parts = item.nombreNorm.split(/[\s,]+/).filter(Boolean);
    if (!words.every(word => parts.some(part => part.startsWith(word)))) continue;
    results.push({ nombre: item.nombre, tipo: item.tipo, curso: item.curso || '' });
    if (results.length >= limit) break;
  }
  return results;
}

/** Busca una persona exacta (por nombre normalizado) para completar curso/rol. */
export function findRosterPerson(siteCode, name) {
  const key = normalizePersonName(name);
  if (!key) return null;
  return loadRoster(siteCode).find(item => item.nombreNorm === key) || null;
}

const TEACHER_HEADER = /^(docentes?|profes(ores|oras)?|maestr[oa]s?|personal|staff)\b/;
const STUDENT_HEADER = /^(alumn[oa]s?|estudiantes?)\b/;
// Cursos al estilo del colegio: 3S, 2F, 5N, "3ro A", "5to B", "1° año", "EP 4", "ES 2N"…
const COURSE_RE = /^((?:EP|ES)\s*[-·]?\s*)?(\d{1,2})\s*(?:°|º|ro|do|er|to|mo|vo|no)?\s*(?:año|grado)?\s*([A-Z]{1,2})?$/i;

function looksLikeCourse(value) {
  const clean = String(value || '').trim();
  return clean.length > 0 && clean.length <= 14 && COURSE_RE.test(clean);
}

function cleanName(value) {
  return String(value || '')
    .replace(/^\s*(?:[-*•·]+|\d+[.)-]\s+)\s*/, '') // viñetas y "1. ", "2) "
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ROSTER_LIMITS.maxNameLength);
}

/**
 * Convierte el texto pegado en personas. Entiende:
 * - encabezados que cambian el tipo: "Docentes:", "Alumnos", "ALUMNOS 3S:";
 * - encabezados de curso solos: "3S", "5to B:";
 * - una persona por línea, con el curso al lado separado por tab, " - " o "|",
 *   o entre paréntesis: "Pérez, Juan - 3S", "Ana Gómez (2F)". Otra columna que
 *   no sea un curso ("Laura Fernández - Matemática") se descarta;
 * - varias personas en una línea separadas por ";" cuando no hay curso.
 */
export function parseRosterText(text, { defaultTipo = 'alumno' } = {}) {
  const people = [];
  let tipo = defaultTipo === 'docente' ? 'docente' : 'alumno';
  let curso = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    const header = normalizePersonName(line.replace(/:$/, ''));
    if (TEACHER_HEADER.test(header) && line.split(/\s+/).length <= 4) {
      tipo = 'docente';
      const rest = line.replace(/:$/, '').split(/\s+/).slice(1).join(' ');
      curso = looksLikeCourse(rest) ? rest.toUpperCase() : '';
      continue;
    }
    if (STUDENT_HEADER.test(header) && line.split(/\s+/).length <= 4) {
      tipo = 'alumno';
      const rest = line.replace(/:$/, '').split(/\s+/).slice(1).join(' ').replace(/^de\s+/i, '');
      curso = looksLikeCourse(rest) ? rest.toUpperCase() : '';
      continue;
    }
    if (/:$/.test(line) && looksLikeCourse(line.slice(0, -1)) || looksLikeCourse(line)) {
      curso = line.replace(/:$/, '').trim().toUpperCase();
      continue;
    }
    // "Nombre (3S)"
    let lineCourse = '';
    const paren = line.match(/\(([^)]{1,14})\)\s*$/);
    if (paren && looksLikeCourse(paren[1])) {
      lineCourse = paren[1].trim().toUpperCase();
      line = line.slice(0, paren.index).trim();
    }
    const columns = line.split(/\t|\s+[-–|]\s+|\s*\|\s*/).map(part => part.trim()).filter(Boolean);
    if (!lineCourse && columns.length > 1) {
      const courseIndex = columns.findIndex(looksLikeCourse);
      if (courseIndex >= 0) {
        lineCourse = columns[courseIndex].toUpperCase();
        columns.splice(courseIndex, 1);
      }
      // El nombre va primero; lo demás que no es curso (materia, mail…) se descarta.
      line = columns[0] || '';
    }
    const names = !lineCourse && line.includes(';') ? line.split(';') : [line];
    for (const name of names) {
      const nombre = cleanName(name);
      if (!nombre || !/[a-záéíóúñü]/i.test(nombre)) continue;
      people.push({ nombre, tipo, curso: lineCourse || curso });
    }
  }
  return people;
}

/**
 * Guarda personas en la lista de la sede.
 * mode 'agregar': suma las nuevas y actualiza curso/tipo de las que ya estaban.
 * mode 'reemplazar': borra la lista de ese tipo (o toda, con tipo 'todos') y la carga de nuevo.
 */
export function saveRoster(siteCode, people, { mode = 'agregar', replaceTipo = 'todos', createdBy = '' } = {}) {
  const db = getDb();
  const clean = [];
  const seen = new Set();
  for (const person of people || []) {
    const nombre = cleanName(person?.nombre);
    const key = normalizePersonName(nombre);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push({
      nombre,
      key,
      tipo: person?.tipo === 'docente' ? 'docente' : 'alumno',
      curso: String(person?.curso || '').trim().slice(0, 30)
    });
  }
  if (clean.length > ROSTER_LIMITS.maxPeople) {
    throw Object.assign(new Error(`La lista tiene ${clean.length} personas; el máximo es ${ROSTER_LIMITS.maxPeople}.`), { status: 400 });
  }
  const ts = nowIso();
  let added = 0;
  let updated = 0;
  let removed = 0;
  db.transaction(() => {
    if (mode === 'reemplazar') {
      const info = replaceTipo === 'docente' || replaceTipo === 'alumno'
        ? db.prepare('DELETE FROM people_roster WHERE site_code=? AND tipo=?').run(siteCode, replaceTipo)
        : db.prepare('DELETE FROM people_roster WHERE site_code=?').run(siteCode);
      removed = info.changes || 0;
    }
    // Una sola lectura de lo que ya hay, en vez de una query por persona.
    const existing = new Map(db.prepare('SELECT id, nombre_norm, tipo, curso FROM people_roster WHERE site_code=?').all(siteCode)
      .map(row => [row.nombre_norm, row]));
    const insert = db.prepare('INSERT INTO people_roster (site_code, nombre, nombre_norm, tipo, curso, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const update = db.prepare('UPDATE people_roster SET nombre=?, tipo=?, curso=? WHERE id=? AND site_code=?');
    for (const person of clean) {
      const row = existing.get(person.key);
      if (row) {
        const curso = person.curso || row.curso || '';
        if (row.tipo !== person.tipo || (row.curso || '') !== curso) {
          update.run(person.nombre, person.tipo, curso, row.id, siteCode);
          updated += 1;
        }
      } else {
        insert.run(siteCode, person.nombre, person.key, person.tipo, person.curso, createdBy, ts);
        added += 1;
      }
    }
  })();
  invalidateRoster(siteCode);
  return { added, updated, removed, ...rosterCounts(siteCode) };
}

export function deleteRosterPerson(siteCode, id) {
  const info = getDb().prepare('DELETE FROM people_roster WHERE id=? AND site_code=?').run(Number(id), siteCode);
  invalidateRoster(siteCode);
  return (info.changes || 0) > 0;
}

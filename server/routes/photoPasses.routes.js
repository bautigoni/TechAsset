import { Router } from 'express';
import { getDb, getSiteSetting, nowIso } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

// Cartelitos numerados que autorizan a usar el celular para sacar fotos a
// alumnos. Se prestan y se devuelven como los equipos, con historial de quién
// tuvo cuál. Particionados por sede: cada tenant tiene su propia numeración.
export const photoPassesRouter = Router();

const ESTADOS = ['Disponible', 'Prestado', 'Perdido', 'Fuera de uso'];

function operatorOf(req) {
  return req.user?.nombre || req.user?.email || 'Sistema';
}

function rowToPass(row) {
  return {
    id: Number(row.id),
    numero: Number(row.numero),
    estado: row.estado || 'Disponible',
    prestadoA: row.prestado_a || '',
    curso: row.curso || '',
    docente: row.docente || '',
    rol: row.rol || '',
    motivo: row.motivo || '',
    loanedAt: row.loaned_at || '',
    returnedAt: row.returned_at || '',
    notas: row.notas || '',
    activo: Boolean(row.activo ?? 1),
    updatedAt: row.updated_at || ''
  };
}

// Los cartelitos son pedazos de papel numerados: no hay nada que "dar de alta".
// La primera vez que una sede los pide se crean del 1 al 30 solos, así el
// operador nunca ve una lista vacía ni tiene que configurar nada.
const DEFAULT_RANGE = 30;

function ensureDefaultPasses(siteCode) {
  const total = getDb().prepare('SELECT COUNT(*) AS total FROM photo_passes WHERE site_code=?').get(siteCode).total;
  if (total > 0) return;
  const ts = nowIso();
  const insert = getDb().prepare(`
    INSERT INTO photo_passes (site_code, numero, estado, prestado_a, rol, motivo, loaned_at, returned_at, notas, activo, created_at, updated_at)
    VALUES (?, ?, 'Disponible', '', '', '', '', '', '', 1, ?, ?)
    ON CONFLICT(site_code, numero) DO NOTHING
  `);
  const tx = getDb().transaction(() => {
    for (let numero = 1; numero <= DEFAULT_RANGE; numero += 1) insert.run(siteCode, numero, ts, ts);
  });
  tx();
}

photoPassesRouter.get('/photo-passes', (req, res) => {
  const siteCode = requireSite(req);
  ensureDefaultPasses(siteCode);
  const rows = getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND COALESCE(activo,1)=1 ORDER BY numero').all(siteCode);
  const items = rows.map(rowToPass);
  res.json({
    ok: true,
    items,
    summary: {
      total: items.length,
      disponibles: items.filter(item => item.estado === 'Disponible').length,
      prestados: items.filter(item => item.estado === 'Prestado').length,
      fuera: items.filter(item => item.estado === 'Perdido' || item.estado === 'Fuera de uso').length
    }
  });
});

/**
 * Sugerencias para el formulario de entrega.
 *
 * No hay padrón de alumnos en la base, así que los nombres se aprenden solos:
 * cada alumno que se carga una vez queda disponible para autocompletar la
 * próxima. Docentes y cursos sí salen de datos que ya existen (horarios y el
 * historial de préstamos), para no escribirlos a mano.
 */
photoPassesRouter.get('/photo-passes/options', (req, res) => {
  const siteCode = requireSite(req);
  const uniq = rows => [...new Set(rows.map(row => String(row.value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  // El historial de préstamos tiene restos de pruebas ("123", "123123"): para
  // sugerir docentes se descarta lo que no parece un nombre.
  const parecenNombres = values => values.filter(value => value.length >= 3 && /\p{L}/u.test(value) && !/^\d+$/.test(value));

  const alumnos = uniq(getDb().prepare("SELECT DISTINCT persona AS value FROM photo_pass_events WHERE site_code=? AND COALESCE(persona,'')<>'' ORDER BY persona LIMIT 500").all(siteCode));

  const cursosDb = getDb().prepare("SELECT DISTINCT curso AS value FROM loan_events WHERE site_code=? AND COALESCE(curso,'')<>'' LIMIT 300").all(siteCode);
  const cursosPasses = getDb().prepare("SELECT DISTINCT curso AS value FROM photo_pass_events WHERE site_code=? AND COALESCE(curso,'')<>'' LIMIT 300").all(siteCode);
  let grados = [];
  try {
    const raw = getSiteSetting(siteCode, 'loan.gradeOptions');
    if (Array.isArray(raw)) grados = raw.map(value => ({ value }));
  } catch { /* si no hay setting, alcanza con lo que hay en la base */ }
  const cursos = uniq([...cursosDb, ...cursosPasses, ...grados]);

  const docentesHorarios = getDb().prepare("SELECT DISTINCT teacher AS value FROM teacher_schedule_entries WHERE site_code=? AND COALESCE(teacher,'')<>'' LIMIT 300").all(siteCode);
  const docentesPrestamos = getDb().prepare("SELECT DISTINCT persona AS value FROM loan_events WHERE site_code=? AND COALESCE(persona,'')<>'' LIMIT 500").all(siteCode);
  const docentesPasses = getDb().prepare("SELECT DISTINCT docente AS value FROM photo_pass_events WHERE site_code=? AND COALESCE(docente,'')<>'' LIMIT 300").all(siteCode);
  const docentes = parecenNombres(uniq([...docentesHorarios, ...docentesPrestamos, ...docentesPasses]));

  res.json({ ok: true, alumnos, cursos, docentes });
});

// Alta por rango: cargar del 1 al 30 de una sola vez sin repetir el formulario.
photoPassesRouter.post('/photo-passes/generate', (req, res) => {
  const siteCode = requireSite(req);
  const desde = Math.max(1, Math.floor(Number(req.body?.desde || 1)));
  const hasta = Math.floor(Number(req.body?.hasta || 0));
  if (!Number.isFinite(hasta) || hasta < desde) return res.status(400).json({ ok: false, error: 'Rango inválido.' });
  if (hasta - desde > 500) return res.status(400).json({ ok: false, error: 'El rango no puede superar los 500 cartelitos.' });
  const ts = nowIso();
  const insert = getDb().prepare(`
    INSERT INTO photo_passes (site_code, numero, estado, prestado_a, rol, motivo, loaned_at, returned_at, notas, activo, created_at, updated_at)
    VALUES (?, ?, 'Disponible', '', '', '', '', '', '', 1, ?, ?)
    ON CONFLICT(site_code, numero) DO UPDATE SET activo=1, updated_at=excluded.updated_at
  `);
  const tx = getDb().transaction(() => {
    for (let numero = desde; numero <= hasta; numero += 1) insert.run(siteCode, numero, ts, ts);
  });
  tx();
  const total = getDb().prepare('SELECT COUNT(*) AS total FROM photo_passes WHERE site_code=? AND COALESCE(activo,1)=1').get(siteCode).total;
  res.json({ ok: true, creados: hasta - desde + 1, total });
});

photoPassesRouter.post('/photo-passes/:numero/lend', (req, res) => {
  const siteCode = requireSite(req);
  const numero = Number(req.params.numero);
  const pass = getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND numero=?').get(siteCode, numero);
  if (!pass) return res.status(404).json({ ok: false, error: 'Cartelito no encontrado.' });
  if (pass.estado === 'Prestado') return res.status(409).json({ ok: false, error: `El cartelito ${numero} ya está prestado a ${pass.prestado_a || 'alguien'}.` });
  const persona = String(req.body?.persona || '').trim();
  if (!persona) return res.status(400).json({ ok: false, error: 'Falta el nombre del alumno.' });
  const curso = String(req.body?.curso || '').trim();
  const docente = String(req.body?.docente || '').trim();
  const ts = nowIso();
  getDb().prepare(`
    UPDATE photo_passes SET estado='Prestado', prestado_a=?, curso=?, docente=?, rol=?, motivo=?, loaned_at=?, returned_at='', updated_at=?
    WHERE site_code=? AND numero=?
  `).run(persona, curso, docente, String(req.body?.rol || ''), String(req.body?.motivo || ''), ts, ts, siteCode, numero);
  getDb().prepare('INSERT INTO photo_pass_events (site_code, numero, tipo, persona, curso, docente, rol, motivo, operador, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(siteCode, numero, 'prestamo', persona, curso, docente, String(req.body?.rol || ''), String(req.body?.motivo || ''), operatorOf(req), ts);
  res.json({ ok: true, item: rowToPass(getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND numero=?').get(siteCode, numero)) });
});

photoPassesRouter.post('/photo-passes/:numero/return', (req, res) => {
  const siteCode = requireSite(req);
  const numero = Number(req.params.numero);
  const pass = getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND numero=?').get(siteCode, numero);
  if (!pass) return res.status(404).json({ ok: false, error: 'Cartelito no encontrado.' });
  if (pass.estado !== 'Prestado') return res.status(409).json({ ok: false, error: `El cartelito ${numero} no está prestado.` });
  const ts = nowIso();
  getDb().prepare(`
    UPDATE photo_passes SET estado='Disponible', prestado_a='', curso='', docente='', rol='', motivo='', returned_at=?, updated_at=?
    WHERE site_code=? AND numero=?
  `).run(ts, ts, siteCode, numero);
  getDb().prepare('INSERT INTO photo_pass_events (site_code, numero, tipo, persona, curso, docente, rol, motivo, operador, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(siteCode, numero, 'devolucion', pass.prestado_a || '', pass.curso || '', pass.docente || '', pass.rol || '', pass.motivo || '', operatorOf(req), ts);
  res.json({ ok: true, item: rowToPass(getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND numero=?').get(siteCode, numero)) });
});

photoPassesRouter.patch('/photo-passes/:numero', (req, res) => {
  const siteCode = requireSite(req);
  const numero = Number(req.params.numero);
  const pass = getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND numero=?').get(siteCode, numero);
  if (!pass) return res.status(404).json({ ok: false, error: 'Cartelito no encontrado.' });
  const estado = ESTADOS.includes(String(req.body?.estado)) ? String(req.body.estado) : pass.estado;
  const notas = req.body?.notas === undefined ? pass.notas : String(req.body.notas || '');
  const ts = nowIso();
  // Marcarlo perdido o fuera de uso corta el préstamo: deja de figurar a nombre
  // de alguien, pero el historial del evento queda.
  const cortaPrestamo = estado !== 'Prestado' && pass.estado === 'Prestado';
  getDb().prepare(`
    UPDATE photo_passes SET estado=?, notas=?, prestado_a=?, rol=?, motivo=?, updated_at=?
    WHERE site_code=? AND numero=?
  `).run(estado, notas, cortaPrestamo ? '' : pass.prestado_a, cortaPrestamo ? '' : pass.rol, cortaPrestamo ? '' : pass.motivo, ts, siteCode, numero);
  if (estado !== pass.estado) {
    getDb().prepare('INSERT INTO photo_pass_events (site_code, numero, tipo, persona, rol, motivo, operador, timestamp) VALUES (?,?,?,?,?,?,?,?)')
      .run(siteCode, numero, 'estado', pass.prestado_a || '', '', estado, operatorOf(req), ts);
  }
  res.json({ ok: true, item: rowToPass(getDb().prepare('SELECT * FROM photo_passes WHERE site_code=? AND numero=?').get(siteCode, numero)) });
});

photoPassesRouter.delete('/photo-passes/:numero', (req, res) => {
  const siteCode = requireSite(req);
  const numero = Number(req.params.numero);
  const result = getDb().prepare('UPDATE photo_passes SET activo=0, updated_at=? WHERE site_code=? AND numero=?').run(nowIso(), siteCode, numero);
  res.json({ ok: true, deleted: result.changes > 0 });
});

photoPassesRouter.get('/photo-passes/:numero/history', (req, res) => {
  const siteCode = requireSite(req);
  const rows = getDb().prepare('SELECT * FROM photo_pass_events WHERE site_code=? AND numero=? ORDER BY timestamp DESC LIMIT 100').all(siteCode, Number(req.params.numero));
  res.json({ ok: true, items: rows.map(row => ({ id: Number(row.id), tipo: row.tipo, persona: row.persona || '', curso: row.curso || '', docente: row.docente || '', rol: row.rol || '', motivo: row.motivo || '', operador: row.operador || '', timestamp: row.timestamp || '' })) });
});

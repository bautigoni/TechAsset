import { Router } from 'express';
import { requireSite } from '../services/siteContext.service.js';
import { deleteRosterPerson, listRoster, parseRosterText, rosterCounts, saveRoster, searchRoster } from '../services/peopleRoster.service.js';

// Lista de docentes y alumnos de la sede (Configuración → Lista de personas).
// Leer: cualquiera con acceso a la sede. Escribir: quien puede editar Préstamos
// (lo chequea requireModuleEditor por el prefijo /people-roster).
export const peopleRosterRouter = Router();

peopleRosterRouter.get('/people-roster', (req, res) => {
  const siteCode = requireSite(req);
  const q = String(req.query.q || '').trim();
  if (q) return res.json({ ok: true, items: searchRoster(siteCode, q, { limit: 20 }) });
  res.json({ ok: true, items: listRoster(siteCode), counts: rosterCounts(siteCode) });
});

// Vista previa: muestra cómo se entendió el texto pegado, sin guardar nada.
peopleRosterRouter.post('/people-roster/preview', (req, res) => {
  requireSite(req);
  const people = parseRosterText(req.body?.text, { defaultTipo: req.body?.tipo });
  res.json({ ok: true, items: people.slice(0, 1000), total: people.length });
});

peopleRosterRouter.post('/people-roster/import', (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const people = parseRosterText(req.body?.text, { defaultTipo: req.body?.tipo });
    if (!people.length) return res.status(400).json({ ok: false, error: 'No encontré nombres en el texto. Pegá una persona por renglón.' });
    const mode = req.body?.mode === 'reemplazar' ? 'reemplazar' : 'agregar';
    const result = saveRoster(siteCode, people, {
      mode,
      replaceTipo: ['docente', 'alumno'].includes(req.body?.replaceTipo) ? req.body.replaceTipo : 'todos',
      createdBy: req.user?.nombre || req.user?.email || ''
    });
    res.json({ ok: true, ...result, items: listRoster(siteCode) });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ ok: false, error: error.message });
    next(error);
  }
});

peopleRosterRouter.delete('/people-roster/:id(\\d+)', (req, res) => {
  const siteCode = requireSite(req);
  const deleted = deleteRosterPerson(siteCode, req.params.id);
  if (!deleted) return res.status(404).json({ ok: false, error: 'Esa persona ya no está en la lista.' });
  res.json({ ok: true, counts: rosterCounts(siteCode) });
});

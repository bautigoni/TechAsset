import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { canEditModule, canViewModule, isSiteManager, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins } from '../services/notifications.service.js';

export const schedulesRouter = Router();
const DAYS = new Set([1, 2, 3, 4, 5, 6, 7]);
const SCHOOL_LEVELS = new Set(['primary_first', 'primary_second', 'secondary']);

schedulesRouter.get('/teacher-schedules', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'schedules', siteCode)) return forbidden(res);
  const rows = getDb().prepare(`
    SELECT * FROM teacher_schedule_entries
    WHERE site_code=? AND active=1
    ORDER BY day_of_week, start_time, teacher, course
  `).all(siteCode).map(rowToSchedule);
  const clock = localClock();
  res.json({ ok: true, items: rows, current: rows.filter(item => item.dayOfWeek === clock.day && item.startTime <= clock.time && item.endTime > clock.time), clock });
});

schedulesRouter.post('/teacher-schedules', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'schedules', siteCode)) return forbidden(res);
  const payload = normalizeSchedule(req.body);
  const error = validateSchedule(payload);
  if (error) return res.status(400).json({ ok: false, error });
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO teacher_schedule_entries (site_code, teacher, course, subject, room, school_level, day_of_week, start_time, end_time, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(siteCode, payload.teacher, payload.course, payload.subject, payload.room, payload.schoolLevel, payload.dayOfWeek, payload.startTime, payload.endTime, req.user?.nombre || req.user?.email || '', ts, ts);
  notifyAdmins(siteCode, req, 'schedule.created', 'Horario docente actualizado', `${payload.teacher} · ${payload.course} · ${dayLabel(payload.dayOfWeek)} ${payload.startTime}`);
  res.json({ ok: true, item: rowToSchedule(getDb().prepare('SELECT * FROM teacher_schedule_entries WHERE id=?').get(info.lastInsertRowid)) });
});

schedulesRouter.patch('/teacher-schedules/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'schedules', siteCode)) return forbidden(res);
  const old = getDb().prepare('SELECT * FROM teacher_schedule_entries WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Horario no encontrado.' });
  const payload = normalizeSchedule({ ...rowToSchedule(old), ...req.body });
  const error = validateSchedule(payload);
  if (error) return res.status(400).json({ ok: false, error });
  getDb().prepare(`
    UPDATE teacher_schedule_entries SET teacher=?, course=?, subject=?, room=?, school_level=?, day_of_week=?, start_time=?, end_time=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(payload.teacher, payload.course, payload.subject, payload.room, payload.schoolLevel, payload.dayOfWeek, payload.startTime, payload.endTime, nowIso(), req.params.id, siteCode);
  notifyAdmins(siteCode, req, 'schedule.updated', 'Horario docente actualizado', `${payload.teacher} · ${payload.course} · ${dayLabel(payload.dayOfWeek)} ${payload.startTime}`);
  res.json({ ok: true, item: rowToSchedule(getDb().prepare('SELECT * FROM teacher_schedule_entries WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

schedulesRouter.delete('/teacher-schedules/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'schedules', siteCode)) return forbidden(res);
  const result = getDb().prepare('UPDATE teacher_schedule_entries SET active=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

schedulesRouter.get('/recess-schedules', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'schedules', siteCode)) return forbidden(res);
  const groups = getDb().prepare('SELECT * FROM recess_groups WHERE site_code=? AND active=1 ORDER BY sort_order, id').all(siteCode).map(group => ({
    id: group.id,
    name: group.name,
    sortOrder: Number(group.sort_order || 0),
    slots: getDb().prepare('SELECT * FROM recess_slots WHERE group_id=? ORDER BY sort_order, start_time, id').all(group.id).map(slot => ({ id: slot.id, label: slot.label || 'Recreo', startTime: slot.start_time, endTime: slot.end_time, sortOrder: Number(slot.sort_order || 0) }))
  }));
  const clock = localClock();
  const active = groups.flatMap(group => group.slots.map(slot => ({ ...slot, groupId: group.id, groupName: group.name }))).filter(slot => slot.startTime <= clock.time && slot.endTime > clock.time);
  res.json({ ok: true, groups, active, clock, canConfigure: isSiteManager(req, siteCode) });
});

schedulesRouter.put('/recess-schedules', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return forbidden(res, 'Solo un administrador de la sede puede configurar los recreos.');
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  if (groups.some(group => !String(group?.name || '').trim())) return res.status(400).json({ ok: false, error: 'Todos los grupos necesitan un nombre.' });
  const ts = nowIso();
  const db = getDb();
  db.transaction(() => {
    const old = db.prepare('SELECT id FROM recess_groups WHERE site_code=?').all(siteCode);
    old.forEach(group => db.prepare('DELETE FROM recess_slots WHERE group_id=?').run(group.id));
    db.prepare('DELETE FROM recess_groups WHERE site_code=?').run(siteCode);
    const insertGroup = db.prepare('INSERT INTO recess_groups (site_code, name, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
    const insertSlot = db.prepare('INSERT INTO recess_slots (group_id, label, start_time, end_time, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    groups.forEach((group, groupIndex) => {
      const groupInfo = insertGroup.run(siteCode, String(group.name).trim(), groupIndex, ts, ts);
      const slots = Array.isArray(group.slots) ? group.slots : [];
      slots.forEach((slot, slotIndex) => {
        const start = String(slot.startTime || '').trim();
        const end = String(slot.endTime || '').trim();
        if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end) insertSlot.run(groupInfo.lastInsertRowid, String(slot.label || 'Recreo').trim(), start, end, slotIndex, ts, ts);
      });
    });
  })();
  notifyAdmins(siteCode, req, 'recess.updated', 'Recreos actualizados', `${groups.length} grupo${groups.length === 1 ? '' : 's'} configurados`);
  req.url = '/recess-schedules';
  req.method = 'GET';
  schedulesRouter.handle(req, res);
});

function normalizeSchedule(raw = {}) {
  return {
    teacher: String(raw.teacher || raw.docente || '').trim(),
    course: String(raw.course || raw.curso || '').trim(),
    subject: String(raw.subject || raw.materia || '').trim(),
    room: String(raw.room || raw.aula || '').trim(),
    schoolLevel: String(raw.schoolLevel || raw.school_level || 'primary_first').trim(),
    dayOfWeek: Number(raw.dayOfWeek || raw.day_of_week || 1),
    startTime: String(raw.startTime || raw.start_time || '').trim(),
    endTime: String(raw.endTime || raw.end_time || '').trim()
  };
}

function validateSchedule(item) {
  if (!item.teacher || !item.course) return 'Docente y curso son obligatorios.';
  if (!SCHOOL_LEVELS.has(item.schoolLevel)) return 'Nivel escolar inválido.';
  if (!DAYS.has(item.dayOfWeek)) return 'Día inválido.';
  if (!/^\d{2}:\d{2}$/.test(item.startTime) || !/^\d{2}:\d{2}$/.test(item.endTime) || item.startTime >= item.endTime) return 'El rango horario no es válido.';
  return '';
}

function rowToSchedule(row) {
  return { id: row.id, teacher: row.teacher, course: row.course, subject: row.subject || '', room: row.room || '', schoolLevel: SCHOOL_LEVELS.has(row.school_level) ? row.school_level : 'primary_first', dayOfWeek: Number(row.day_of_week), startTime: row.start_time, endTime: row.end_time, createdBy: row.created_by || '', updatedAt: row.updated_at || '' };
}

function localClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const days = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { day: days[parts.weekday] || 1, time: `${parts.hour}:${parts.minute}` };
}

function dayLabel(day) { return ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][day] || ''; }
function forbidden(res, error = 'No tenés permiso para usar este módulo.') { return res.status(403).json({ ok: false, error }); }
function notifyAdmins(siteCode, req, kind, title, body) {
  try { notifySiteAdmins({ siteCode, kind, title, body, link: `/sede/${siteCode}/schedules`, exceptEmail: req.user?.email }); } catch { /* no bloquea */ }
}

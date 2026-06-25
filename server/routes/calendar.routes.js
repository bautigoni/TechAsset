import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso, rowToAgenda } from '../db.js';
import { normalizeSiteCode, requireSite } from '../services/siteContext.service.js';

export const calendarRouter = Router();
export const publicCalendarRouter = Router();

calendarRouter.get('/agenda/calendar-feed', (req, res) => {
  const siteCode = requireSite(req);
  const token = ensureCalendarToken(req.user.email, siteCode);
  res.json({
    ok: true,
    siteCode,
    feedUrl: `${config.appBaseUrl}/calendar/${token}.ics`,
    token
  });
});

calendarRouter.post('/agenda/calendar-feed/rotate', (req, res) => {
  const siteCode = requireSite(req);
  const token = rotateCalendarToken(req.user.email, siteCode);
  res.json({
    ok: true,
    siteCode,
    feedUrl: `${config.appBaseUrl}/calendar/${token}.ics`,
    token
  });
});

publicCalendarRouter.get('/calendar/:token.ics', (req, res) => {
  const token = String(req.params.token || '').trim();
  const row = getDb().prepare(`
    SELECT * FROM agenda_calendar_tokens
    WHERE token=? AND COALESCE(revoked_at,'')=''
  `).get(token);
  if (!row) return res.status(404).type('text/plain').send('Calendar feed not found.');
  const siteCode = normalizeSiteCode(row.site_code);
  const rows = getDb().prepare(`
    SELECT * FROM agenda
    WHERE eliminada=0 AND site_code=?
    ORDER BY fecha, dia, desde
  `).all(siteCode);
  const items = rows.map(rowToAgenda).filter(item => item.estado !== 'Cancelado');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="techasset-${siteCode.toLowerCase()}.ics"`);
  res.send(buildIcs({ siteCode, items }));
});

function ensureCalendarToken(userEmail, siteCode) {
  const email = String(userEmail || '').trim().toLowerCase();
  const site = normalizeSiteCode(siteCode);
  const existing = getDb().prepare(`
    SELECT token FROM agenda_calendar_tokens
    WHERE user_email=? AND site_code=? AND COALESCE(revoked_at,'')=''
  `).get(email, site);
  if (existing?.token) return existing.token;
  const token = newToken();
  getDb().prepare(`
    INSERT INTO agenda_calendar_tokens (token, user_email, site_code, created_at, revoked_at)
    VALUES (?, ?, ?, ?, '')
    ON CONFLICT(user_email, site_code) DO UPDATE SET token=excluded.token, created_at=excluded.created_at, revoked_at=''
  `).run(token, email, site, nowIso());
  return token;
}

function rotateCalendarToken(userEmail, siteCode) {
  const email = String(userEmail || '').trim().toLowerCase();
  const site = normalizeSiteCode(siteCode);
  const token = newToken();
  getDb().prepare(`
    INSERT INTO agenda_calendar_tokens (token, user_email, site_code, created_at, revoked_at)
    VALUES (?, ?, ?, ?, '')
    ON CONFLICT(user_email, site_code) DO UPDATE SET token=excluded.token, created_at=excluded.created_at, revoked_at=''
  `).run(token, email, site, nowIso());
  return token;
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildIcs({ siteCode, items }) {
  const now = formatIcsDateTime(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TechAsset//Agenda TIC//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(`TechAsset ${siteCode}`)}`,
    'X-WR-TIMEZONE:America/Argentina/Buenos_Aires'
  ];
  for (const item of items) {
    const start = resolveDateTime(item, item.desde || '08:00');
    const end = resolveDateTime(item, item.hasta || item.desde || '09:00');
    if (!start || !end) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(`${siteCode}-${item.id}@techasset`)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatIcsDateTime(start)}`,
      `DTEND:${formatIcsDateTime(end)}`,
      `SUMMARY:${escapeIcs(`${item.curso || 'Actividad'} - ${item.actividad || 'Agenda TIC'}`)}`,
      `LOCATION:${escapeIcs(item.ubicacion || '')}`,
      `DESCRIPTION:${escapeIcs(describeItem(item))}`,
      `STATUS:${item.estado === 'Cancelado' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function describeItem(item) {
  const parts = [
    `Estado: ${item.estado || '-'}`,
    `Turno: ${item.turno || '-'}`,
    `Dispositivo: ${item.cantidad || 0} ${item.tipoDispositivo || ''}`.trim(),
    item.responsableTic ? `Responsable TIC: ${item.responsableTic}` : '',
    item.nota ? `Nota: ${item.nota}` : ''
  ];
  return parts.filter(Boolean).join('\n');
}

function resolveDateTime(item, timeValue) {
  const date = item.fecha || dateFromWeekday(item.dia);
  const match = String(timeValue || '').match(/^(\d{1,2}):(\d{2})/);
  if (!date || !match) return null;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, Number(match[1]), Number(match[2]), 0);
}

function dateFromWeekday(dayName) {
  const wanted = weekdayIndex(dayName);
  if (!wanted) return '';
  const today = new Date();
  const current = today.getDay() || 7;
  const diff = wanted - current;
  const date = new Date(today);
  date.setDate(today.getDate() + diff);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekdayIndex(value) {
  const text = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (text.startsWith('lun')) return 1;
  if (text.startsWith('mar')) return 2;
  if (text.startsWith('mie')) return 3;
  if (text.startsWith('jue')) return 4;
  if (text.startsWith('vie')) return 5;
  if (text.startsWith('sab')) return 6;
  if (text.startsWith('dom')) return 7;
  return 0;
}

function formatIcsDateTime(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function escapeIcs(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

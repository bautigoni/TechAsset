import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins } from '../services/notifications.service.js';

export const ticketsRouter = Router();

const FILE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf']
]);

const ESTADOS = new Set(['No hecho', 'En proceso', 'Hecho']);
const PRIORIDADES = new Set(['Baja', 'Media', 'Alta', 'Urgente']);
const ORIGENES = new Set(['tik', 'handing']);

ticketsRouter.get('/tickets', (req, res) => {
  const siteCode = requireSite(req);
  const rows = getDb().prepare(`
    SELECT * FROM tickets
    WHERE site_code=? AND COALESCE(activo,1)=1 AND (deleted_at IS NULL OR TRIM(deleted_at)='')
    ORDER BY CASE estado WHEN 'No hecho' THEN 0 WHEN 'En proceso' THEN 1 ELSE 2 END, updated_at DESC, id DESC
  `).all(siteCode);
  res.json({ ok: true, items: rows.map(rowToTicket) });
});

ticketsRouter.post('/tickets', (req, res) => {
  const siteCode = requireSite(req);
  const payload = normalizeTicketPayload(req.body);
  if (payload.origen === 'tik' && !payload.numero) return res.status(400).json({ ok: false, error: 'Cargá el número de ticket Tik/InVgate.' });
  const operador = req.user?.nombre || req.user?.email || '';
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO tickets (site_code, numero, titulo, descripcion, estado, prioridad, responsables_json, categoria, imagen_url, nota, origen, creado_por, operador_ultimo_cambio, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(siteCode, payload.numero, payload.titulo, payload.descripcion, payload.estado, payload.prioridad, payload.responsablesJson, payload.categoria, payload.imagenUrl, payload.nota, payload.origen, operador, operador, ts, ts);
  try {
    notifySiteAdmins({
      siteCode, kind: 'ticket.created',
      title: payload.origen === 'handing' ? 'Nuevo ticket Handing' : `Nuevo ticket #${payload.numero}`,
      body: payload.titulo ? payload.titulo : `Cargado por ${operador || 'el equipo'}`,
      link: `/sede/${siteCode}/tickets`,
      exceptEmail: req.user?.email
    });
  } catch { /* no bloquear la creación del ticket */ }
  res.json({ ok: true, item: rowToTicket(getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=?').get(info.lastInsertRowid, siteCode)) });
});

ticketsRouter.patch('/tickets/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Ticket no encontrado.' });
  const payload = normalizeTicketPayload({ ...rowToTicket(old), ...req.body });
  const operador = req.user?.nombre || req.user?.email || old.operador_ultimo_cambio || '';
  getDb().prepare(`
    UPDATE tickets
    SET numero=?, titulo=?, descripcion=?, estado=?, prioridad=?, responsables_json=?, categoria=?, imagen_url=?, nota=?, origen=?, operador_ultimo_cambio=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(payload.numero, payload.titulo, payload.descripcion, payload.estado, payload.prioridad, payload.responsablesJson, payload.categoria, payload.imagenUrl, payload.nota, payload.origen, operador, nowIso(), req.params.id, siteCode);
  res.json({ ok: true, item: rowToTicket(getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

ticketsRouter.delete('/tickets/:id', (req, res) => {
  const siteCode = requireSite(req);
  const ts = nowIso();
  const operador = req.user?.nombre || req.user?.email || 'Sistema';
  const result = getDb().prepare(`
    UPDATE tickets SET activo=0, deleted_at=?, deleted_by=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(ts, operador, ts, req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

ticketsRouter.post('/tickets/upload-image', (req, res) => {
  const siteCode = requireSite(req);
  const dataUrl = String(req.body?.dataUrl || '').trim();
  const fileName = String(req.body?.fileName || 'ticket').trim();
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/i);
  if (!match) return res.status(400).json({ ok: false, error: 'Formato no soportado. Usá PDF, PNG, JPG, JPEG o WEBP.' });
  const ext = FILE_TYPES.get(match[1].toLowerCase());
  if (!ext) return res.status(400).json({ ok: false, error: 'Formato no soportado.' });
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = Math.max(1, config.maxUploadMb) * 1024 * 1024;
  if (buffer.length > maxBytes) return res.status(413).json({ ok: false, error: `La imagen supera el límite de ${config.maxUploadMb} MB.` });
  const uploadDir = path.join(config.rootDir, 'data', 'uploads', 'tickets', siteCode);
  fs.mkdirSync(uploadDir, { recursive: true });
  const baseName = sanitizeFileName(fileName).replace(/\.[a-z0-9]+$/i, '') || 'ticket';
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${baseName}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, storedName), buffer);
  res.json({ ok: true, url: `/uploads/tickets/${siteCode}/${storedName}` });
});

function normalizeTicketPayload(raw = {}) {
  let responsablesJson = '';
  const responsables = raw.responsables ?? raw.responsablesJson;
  if (Array.isArray(responsables)) {
    responsablesJson = JSON.stringify(responsables.map(String).map(s => s.trim()).filter(Boolean));
  } else if (typeof responsables === 'string' && responsables.trim().startsWith('[')) {
    responsablesJson = responsables;
  }
  const estado = ESTADOS.has(String(raw.estado)) ? String(raw.estado) : 'No hecho';
  const prioridad = PRIORIDADES.has(String(raw.prioridad)) ? String(raw.prioridad) : 'Media';
  const origen = ORIGENES.has(String(raw.origen)) ? String(raw.origen) : 'tik';
  return {
    numero: String(raw.numero || '').trim(),
    titulo: String(raw.titulo || '').trim(),
    descripcion: String(raw.descripcion || '').trim(),
    estado,
    prioridad,
    responsablesJson,
    categoria: String(raw.categoria || '').trim(),
    imagenUrl: String(raw.imagenUrl || raw.imagen_url || '').trim(),
    nota: String(raw.nota || '').trim(),
    origen
  };
}

function rowToTicket(row) {
  let responsables = [];
  try { const parsed = JSON.parse(row.responsables_json || '[]'); if (Array.isArray(parsed)) responsables = parsed.map(String); }
  catch { responsables = []; }
  return {
    id: row.id,
    siteCode: row.site_code,
    numero: row.numero || '',
    titulo: row.titulo || '',
    descripcion: row.descripcion || '',
    estado: row.estado || 'No hecho',
    prioridad: row.prioridad || 'Media',
    responsables,
    categoria: row.categoria || '',
    imagenUrl: row.imagen_url || '',
    nota: row.nota || '',
    origen: ORIGENES.has(String(row.origen)) ? row.origen : 'tik',
    creadoPor: row.creado_por || '',
    operadorUltimoCambio: row.operador_ultimo_cambio || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function sanitizeFileName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

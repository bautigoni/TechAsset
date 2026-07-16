import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { canEditModule, canViewModule, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins } from '../services/notifications.service.js';

export const canvasRouter = Router();
const TYPES = new Set(['sticky', 'text', 'checklist', 'image', 'file', 'link']);
const MIME_EXT = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['application/pdf', 'pdf'], ['text/plain', 'txt'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx']
]);

canvasRouter.get('/canvas/items', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'canvas', siteCode)) return forbidden(res);
  const items = getDb().prepare('SELECT * FROM canvas_items WHERE site_code=? AND active=1 ORDER BY z_index, id').all(siteCode).map(rowToCanvasItem);
  res.json({ ok: true, items });
});

canvasRouter.post('/canvas/items', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'canvas', siteCode)) return forbidden(res);
  const item = normalizeItem(req.body);
  const ts = nowIso();
  const top = getDb().prepare('SELECT COALESCE(MAX(z_index),0) AS value FROM canvas_items WHERE site_code=?').get(siteCode).value || 0;
  const info = getDb().prepare(`
    INSERT INTO canvas_items (site_code, item_type, title, content_json, x, y, width, height, z_index, color, created_by, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(siteCode, item.itemType, item.title, JSON.stringify(item.content), item.x, item.y, item.width, item.height, Number(top) + 1, item.color, req.user?.nombre || req.user?.email || '', ts, ts);
  try { notifySiteAdmins({ siteCode, kind: 'canvas.created', title: 'Nuevo elemento en el canvas', body: item.title || labelForType(item.itemType), link: `/sede/${siteCode}/canvas`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToCanvasItem(getDb().prepare('SELECT * FROM canvas_items WHERE id=?').get(info.lastInsertRowid)) });
});

canvasRouter.patch('/canvas/items/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'canvas', siteCode)) return forbidden(res);
  const old = getDb().prepare('SELECT * FROM canvas_items WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Elemento no encontrado.' });
  const current = rowToCanvasItem(old);
  const item = normalizeItem({ ...current, ...req.body, content: req.body?.content ?? current.content });
  const zIndex = Number.isFinite(Number(req.body?.zIndex)) ? Number(req.body.zIndex) : current.zIndex;
  getDb().prepare(`
    UPDATE canvas_items SET item_type=?, title=?, content_json=?, x=?, y=?, width=?, height=?, z_index=?, color=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(item.itemType, item.title, JSON.stringify(item.content), item.x, item.y, item.width, item.height, zIndex, item.color, nowIso(), req.params.id, siteCode);
  res.json({ ok: true, item: rowToCanvasItem(getDb().prepare('SELECT * FROM canvas_items WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

canvasRouter.delete('/canvas/items/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'canvas', siteCode)) return forbidden(res);
  const result = getDb().prepare('UPDATE canvas_items SET active=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

canvasRouter.post('/canvas/upload', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'canvas', siteCode)) return forbidden(res);
  const mime = String(req.body?.mimeType || '').toLowerCase();
  const ext = MIME_EXT.get(mime);
  const raw = String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!ext || !raw) return res.status(400).json({ ok: false, error: 'Tipo de archivo no permitido.' });
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > config.maxUploadMb * 1024 * 1024) return res.status(400).json({ ok: false, error: `El archivo supera ${config.maxUploadMb} MB.` });
  const dir = path.join(config.rootDir, 'data', 'uploads', 'canvas', siteCode);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  res.json({ ok: true, url: `/uploads/canvas/${siteCode}/${name}`, name: String(req.body?.name || name), mimeType: mime, size: buffer.length });
});

function normalizeItem(raw = {}) {
  const itemType = TYPES.has(String(raw.itemType || raw.item_type)) ? String(raw.itemType || raw.item_type) : 'sticky';
  const content = raw.content && typeof raw.content === 'object' ? raw.content : {};
  return {
    itemType,
    title: String(raw.title || '').trim().slice(0, 160),
    content,
    x: finite(raw.x, 80), y: finite(raw.y, 80),
    width: clamp(finite(raw.width, 260), 140, 900),
    height: clamp(finite(raw.height, 180), 100, 800),
    color: String(raw.color || '').slice(0, 32)
  };
}

function rowToCanvasItem(row) {
  let content = {};
  try { content = JSON.parse(row.content_json || '{}'); } catch { content = {}; }
  return { id: row.id, itemType: row.item_type, title: row.title || '', content, x: Number(row.x || 0), y: Number(row.y || 0), width: Number(row.width || 240), height: Number(row.height || 180), zIndex: Number(row.z_index || 1), color: row.color || '', createdBy: row.created_by || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '' };
}

function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function labelForType(type) { return ({ sticky: 'Nota adhesiva', text: 'Texto', checklist: 'Checklist', image: 'Imagen', file: 'Archivo', link: 'Enlace' })[type] || 'Elemento'; }
function forbidden(res) { return res.status(403).json({ ok: false, error: 'No tenés permiso para usar el canvas.' }); }

import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

export const inventoryRouter = Router();

inventoryRouter.get('/inventory/items', (req, res) => {
  const siteCode = requireSite(req);
  const rows = getDb().prepare(`
    SELECT * FROM inventory_items
    WHERE site_code=? AND COALESCE(activo,1)=1
    ORDER BY lower(nombre)
  `).all(siteCode);
  res.json({ ok: true, items: rows.map(rowToInventoryItem) });
});

inventoryRouter.post('/inventory/items', (req, res) => {
  const siteCode = requireSite(req);
  const payload = normalizeInventoryPayload(req.body);
  if (!payload.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio.' });
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO inventory_items (site_code, nombre, categoria, cantidad, unidad, imagen_url, estado, observaciones, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(siteCode, payload.nombre, payload.categoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.observaciones, ts, ts);
  res.json({ ok: true, item: rowToInventoryItem(getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(info.lastInsertRowid, siteCode)) });
});

inventoryRouter.patch('/inventory/items/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Ítem no encontrado.' });
  const payload = normalizeInventoryPayload({ ...rowToInventoryItem(old), ...req.body });
  if (!payload.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio.' });
  getDb().prepare(`
    UPDATE inventory_items
    SET nombre=?, categoria=?, cantidad=?, unidad=?, imagen_url=?, estado=?, observaciones=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(payload.nombre, payload.categoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.observaciones, nowIso(), req.params.id, siteCode);
  res.json({ ok: true, item: rowToInventoryItem(getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

inventoryRouter.delete('/inventory/items/:id', (req, res) => {
  const result = getDb().prepare('UPDATE inventory_items SET activo=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), req.params.id, requireSite(req));
  res.json({ ok: true, deleted: result.changes > 0 });
});

function normalizeInventoryPayload(raw = {}) {
  const cantidad = Number(raw.cantidad ?? 0);
  return {
    nombre: String(raw.nombre || raw.name || '').trim(),
    categoria: String(raw.categoria || raw.category || 'Otro').trim() || 'Otro',
    cantidad: Number.isFinite(cantidad) && cantidad >= 0 ? Math.floor(cantidad) : 0,
    unidad: String(raw.unidad || raw.unit || 'unidades').trim() || 'unidades',
    imagenUrl: String(raw.imagenUrl || raw.imagen_url || raw.imageUrl || '').trim(),
    estado: String(raw.estado || raw.state || '').trim(),
    observaciones: String(raw.observaciones || raw.notes || '').trim()
  };
}

function rowToInventoryItem(row) {
  return {
    id: row.id,
    siteCode: row.site_code,
    nombre: row.nombre || '',
    categoria: row.categoria || 'Otro',
    cantidad: Number(row.cantidad || 0),
    unidad: row.unidad || 'unidades',
    imagenUrl: row.imagen_url || '',
    estado: row.estado || '',
    observaciones: row.observaciones || '',
    activo: Boolean(row.activo ?? 1),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

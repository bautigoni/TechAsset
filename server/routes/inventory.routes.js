import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

export const inventoryRouter = Router();

const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp']
]);

inventoryRouter.get('/inventory/items', (req, res) => {
  const siteCode = requireSite(req);
  const rows = getDb().prepare(`
    SELECT * FROM inventory_items
    WHERE site_code=?
      AND COALESCE(activo,1)=1
      AND (deleted_at IS NULL OR TRIM(deleted_at)='')
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
    INSERT INTO inventory_items (site_code, nombre, categoria, cantidad, unidad, imagen_url, estado, observaciones, activo, deleted_at, deleted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '', '', ?, ?)
  `).run(siteCode, payload.nombre, payload.categoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.observaciones, ts, ts);
  res.json({ ok: true, item: rowToInventoryItem(getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(info.lastInsertRowid, siteCode)) });
});

inventoryRouter.patch('/inventory/items/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Item no encontrado.' });
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
  const siteCode = requireSite(req);
  const ts = nowIso();
  const operator = req.user?.nombre || req.user?.email || req.session?.user?.nombre || req.session?.user?.email || 'Sistema';
  const result = getDb().prepare(`
    UPDATE inventory_items
    SET activo=0, deleted_at=?, deleted_by=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(ts, operator, ts, req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

inventoryRouter.post('/inventory/import', (req, res) => {
  const siteCode = requireSite(req);
  const csvText = String(req.body?.csvText || req.body?.csv || '').trim();
  if (!csvText) return res.status(400).json({ ok: false, error: 'No se recibió un CSV para importar.' });
  const result = importInventoryCsv(siteCode, csvText);
  res.json({ ok: true, ...result });
});

inventoryRouter.post('/inventory/upload-image', (req, res) => {
  const siteCode = requireSite(req);
  const dataUrl = String(req.body?.dataUrl || '').trim();
  const fileName = String(req.body?.fileName || 'inventario').trim();
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) return res.status(400).json({ ok: false, error: 'Formato de imagen no soportado. Usá PNG, JPG, JPEG o WEBP.' });
  const mime = match[1].toLowerCase();
  const ext = IMAGE_TYPES.get(mime);
  if (!ext) return res.status(400).json({ ok: false, error: 'Formato de imagen no soportado.' });
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = Math.max(1, config.maxUploadMb) * 1024 * 1024;
  if (buffer.length > maxBytes) return res.status(413).json({ ok: false, error: `La imagen supera el límite de ${config.maxUploadMb} MB.` });

  const uploadDir = path.join(config.rootDir, 'data', 'uploads', 'inventory', siteCode);
  fs.mkdirSync(uploadDir, { recursive: true });
  const baseName = sanitizeFileName(fileName).replace(/\.[a-z0-9]+$/i, '') || 'inventario';
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${baseName}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, storedName), buffer);
  res.json({ ok: true, url: `/uploads/inventory/${siteCode}/${storedName}` });
});

function importInventoryCsv(siteCode, csvText) {
  const rows = parseCsv(csvText);
  const [header = [], ...dataRows] = rows;
  const headerMap = buildHeaderMap(header);
  const ts = nowIso();
  const summary = { read: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  const selectExisting = getDb().prepare('SELECT * FROM inventory_items WHERE site_code=? AND lower(nombre)=lower(?) LIMIT 1');
  const insert = getDb().prepare(`
    INSERT INTO inventory_items (site_code, nombre, categoria, cantidad, unidad, imagen_url, estado, observaciones, activo, deleted_at, deleted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '', '', ?, ?)
  `);
  const update = getDb().prepare(`
    UPDATE inventory_items
    SET nombre=?, categoria=?, cantidad=?, unidad=?, imagen_url=?, estado=?, observaciones=?, activo=1, deleted_at='', deleted_by='', updated_at=?
    WHERE id=? AND site_code=?
  `);

  const tx = getDb().transaction(() => {
    dataRows.forEach((row, index) => {
      if (!row.some(cell => String(cell || '').trim())) return;
      summary.read += 1;
      try {
        const payload = normalizeInventoryPayload({
          nombre: valueAt(row, headerMap, ['nombre', 'name']),
          cantidad: valueAt(row, headerMap, ['cantidad', 'qty', 'stock']),
          categoria: valueAt(row, headerMap, ['categoria', 'categoría', 'category']),
          unidad: valueAt(row, headerMap, ['unidad', 'unit']),
          estado: valueAt(row, headerMap, ['estado', 'state']),
          observaciones: valueAt(row, headerMap, ['observaciones', 'observacion', 'observación', 'notas', 'notes']),
          imagenUrl: valueAt(row, headerMap, ['imagen url', 'imagen_url', 'imagen', 'image url', 'image'])
        });
        if (!payload.nombre) {
          summary.skipped += 1;
          return;
        }
        const old = selectExisting.get(siteCode, payload.nombre);
        if (old) {
          update.run(
            payload.nombre,
            payload.categoria,
            payload.cantidad,
            payload.unidad,
            payload.imagenUrl || old.imagen_url || '',
            payload.estado,
            payload.observaciones,
            ts,
            old.id,
            siteCode
          );
          summary.updated += 1;
        } else {
          insert.run(siteCode, payload.nombre, payload.categoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.observaciones, ts, ts);
          summary.created += 1;
        }
      } catch (error) {
        summary.errors.push({ row: index + 2, error: error.message || 'Error al importar fila.' });
      }
    });
  });
  tx();
  return summary;
}

function normalizeInventoryPayload(raw = {}) {
  const cantidad = Number(raw.cantidad ?? 0);
  return {
    nombre: String(raw.nombre || raw.name || '').trim(),
    categoria: String(raw.categoria || raw.category || 'Otro').trim() || 'Otro',
    cantidad: Number.isFinite(cantidad) && cantidad >= 0 ? Math.floor(cantidad) : 0,
    unidad: String(raw.unidad || raw.unit || 'unidades').trim() || 'unidades',
    imagenUrl: String(raw.imagenUrl || raw.imagen_url || raw.imageUrl || '').trim(),
    estado: String(raw.estado || raw.state || 'Disponible').trim(),
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
    deletedAt: row.deleted_at || '',
    deletedBy: row.deleted_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}

function buildHeaderMap(header) {
  const map = new Map();
  header.forEach((value, index) => map.set(normalizeHeader(value), index));
  return map;
}

function valueAt(row, headerMap, aliases) {
  for (const alias of aliases) {
    const index = headerMap.get(normalizeHeader(alias));
    if (index !== undefined) return row[index] || '';
  }
  return '';
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function sanitizeFileName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

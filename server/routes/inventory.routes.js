import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { CONDITIONS, recordConditionChange } from '../services/lifecycle.service.js';

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
  const stats = unitStatsBySite(siteCode);
  res.json({ ok: true, items: rows.map(row => rowToInventoryItem(row, stats.get(Number(row.id)))) });
});

inventoryRouter.post('/inventory/items', (req, res) => {
  const siteCode = requireSite(req);
  const payload = normalizeInventoryPayload(req.body);
  if (!payload.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio.' });
  // La foto es obligatoria para dar de alta: el inventario se navega mirando,
  // y un item sin imagen rompe la grilla.
  if (!payload.imagenUrl) return res.status(400).json({ ok: false, error: 'La foto del recurso es obligatoria.' });
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO inventory_items (site_code, nombre, categoria, subcategoria, cantidad, unidad, imagen_url, estado, condicion, min_stock, condicion_updated_at, observaciones, activo, deleted_at, deleted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', '', ?, ?)
  `).run(siteCode, payload.nombre, payload.categoria, payload.subcategoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.condicion, payload.minStock, payload.condicion ? ts : '', payload.observaciones, ts, ts);
  if (payload.condicion) {
    recordConditionChange({ siteCode, etiqueta: payload.nombre, condicion: payload.condicion, operador: req.user?.nombre || req.user?.email || '', origen: 'Inventario' });
  }
  res.json({ ok: true, item: readInventoryItem(siteCode, info.lastInsertRowid) });
});

inventoryRouter.patch('/inventory/items/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Item no encontrado.' });
  const payload = normalizeInventoryPayload({ ...rowToInventoryItem(old), ...req.body });
  if (!payload.nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio.' });
  const ts = nowIso();
  const condicionCambio = payload.condicion && payload.condicion !== String(old.condicion || '');
  // Confirmar la misma condición TAMBIÉN es revisar: si la fecha solo se
  // refrescara cuando el valor cambia, un recurso que siempre está "Bueno"
  // quedaría para siempre como "sin revisar hace más de 3 meses". El flag
  // `revisado` lo mandan los dos caminos que son una revisión de verdad
  // (el selector del detalle y el recorrido de revisión); editar la ficha
  // para corregir el nombre no cuenta como haber ido a mirar el recurso.
  const condicionRevisada = Boolean(payload.condicion) && (condicionCambio || req.body?.revisado === true);
  // En la edición no se puede borrar una foto ya cargada; los items viejos sin
  // imagen se pueden seguir editando y la UI los marca para que se completen.
  if (!payload.imagenUrl && old.imagen_url) return res.status(400).json({ ok: false, error: 'No se puede quitar la foto de un recurso.' });
  getDb().prepare(`
    UPDATE inventory_items
    SET nombre=?, categoria=?, subcategoria=?, cantidad=?, unidad=?, imagen_url=?, estado=?, condicion=?, min_stock=?, condicion_updated_at=?, observaciones=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(payload.nombre, payload.categoria, payload.subcategoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.condicion, payload.minStock, condicionRevisada ? ts : (old.condicion_updated_at || ''), payload.observaciones, ts, req.params.id, siteCode);
  if (condicionCambio) {
    recordConditionChange({ siteCode, etiqueta: payload.nombre, condicion: payload.condicion, operador: req.user?.nombre || req.user?.email || '', origen: 'Inventario' });
  }
  res.json({ ok: true, item: readInventoryItem(siteCode, req.params.id) });
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

/* ── Unidades individuales de un recurso ───────────────────────────────────
   Un recurso puede tener 8 unidades y que solo una esté rota. Antes la única
   forma de anotarlo era duplicar la ficha ("dash" + "dash roto"); acá cada
   unidad lleva su propio número, condición, SN, MAC y TeamViewer ID. */

inventoryRouter.get('/inventory/items/:id/units', (req, res) => {
  const siteCode = requireSite(req);
  const item = getDb().prepare('SELECT id FROM inventory_items WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!item) return res.status(404).json({ ok: false, error: 'Recurso no encontrado.' });
  res.json({ ok: true, units: listUnits(siteCode, req.params.id) });
});

inventoryRouter.post('/inventory/items/:id/units', (req, res) => {
  const siteCode = requireSite(req);
  const item = getDb().prepare('SELECT id, nombre FROM inventory_items WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!item) return res.status(404).json({ ok: false, error: 'Recurso no encontrado.' });
  const payload = normalizeUnitPayload(req.body);
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO inventory_units (site_code, item_id, numero, descripcion, sn, mac, teamviewer_id, condicion, condicion_updated_at, activo, deleted_at, deleted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', '', ?, ?)
  `).run(siteCode, item.id, payload.numero || nextUnitNumber(siteCode, item.id), payload.descripcion, payload.sn, payload.mac, payload.teamviewerId, payload.condicion, payload.condicion ? ts : '', ts, ts);
  res.json({ ok: true, units: listUnits(siteCode, item.id), item: readInventoryItem(siteCode, item.id) });
});

inventoryRouter.patch('/inventory/units/:unitId', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM inventory_units WHERE id=? AND site_code=?').get(req.params.unitId, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Unidad no encontrada.' });
  const payload = normalizeUnitPayload({ ...rowToUnit(old), ...req.body });
  const ts = nowIso();
  const condicionRevisada = Boolean(payload.condicion) && payload.condicion !== String(old.condicion || '');
  getDb().prepare(`
    UPDATE inventory_units
    SET numero=?, descripcion=?, sn=?, mac=?, teamviewer_id=?, condicion=?, condicion_updated_at=?, updated_at=?
    WHERE id=? AND site_code=?
  `).run(payload.numero, payload.descripcion, payload.sn, payload.mac, payload.teamviewerId, payload.condicion, condicionRevisada ? ts : (old.condicion_updated_at || ''), ts, req.params.unitId, siteCode);
  res.json({ ok: true, units: listUnits(siteCode, old.item_id), item: readInventoryItem(siteCode, old.item_id) });
});

inventoryRouter.delete('/inventory/units/:unitId', (req, res) => {
  const siteCode = requireSite(req);
  const old = getDb().prepare('SELECT * FROM inventory_units WHERE id=? AND site_code=?').get(req.params.unitId, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Unidad no encontrada.' });
  const ts = nowIso();
  const operator = req.user?.nombre || req.user?.email || 'Sistema';
  getDb().prepare('UPDATE inventory_units SET activo=0, deleted_at=?, deleted_by=?, updated_at=? WHERE id=? AND site_code=?')
    .run(ts, operator, ts, req.params.unitId, siteCode);
  res.json({ ok: true, units: listUnits(siteCode, old.item_id), item: readInventoryItem(siteCode, old.item_id) });
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
  const summary = { read: 0, created: 0, updated: 0, skipped: 0, preservedImages: 0, preservedConditions: 0, errors: [] };
  const selectExisting = getDb().prepare('SELECT * FROM inventory_items WHERE site_code=? AND lower(nombre)=lower(?) LIMIT 1');
  const insert = getDb().prepare(`
    INSERT INTO inventory_items (site_code, nombre, categoria, subcategoria, cantidad, unidad, imagen_url, estado, condicion, min_stock, condicion_updated_at, observaciones, activo, deleted_at, deleted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', '', ?, ?)
  `);
  const update = getDb().prepare(`
    UPDATE inventory_items
    SET nombre=?, categoria=?, subcategoria=?, cantidad=?, unidad=?, imagen_url=?, estado=?, condicion=?, min_stock=?, condicion_updated_at=?, observaciones=?, activo=1, deleted_at='', deleted_by='', updated_at=?
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
          subcategoria: valueAt(row, headerMap, ['subcategoria', 'subcategoría', 'subcategory']),
          unidad: valueAt(row, headerMap, ['unidad', 'unit']),
          estado: valueAt(row, headerMap, ['estado', 'state']),
          condicion: valueAt(row, headerMap, ['condicion', 'condición', 'condition']),
          minStock: valueAt(row, headerMap, ['stock minimo', 'stock mínimo', 'min stock', 'minimo']) || 3,
          observaciones: valueAt(row, headerMap, ['observaciones', 'observacion', 'observación', 'notas', 'notes']),
          imagenUrl: valueAt(row, headerMap, ['imagen url', 'imagen_url', 'imagen', 'image url', 'image'])
        });
        if (!payload.nombre) {
          summary.skipped += 1;
          return;
        }
        const old = selectExisting.get(siteCode, payload.nombre);
        if (old) {
          const nextImageUrl = payload.imagenUrl || old.imagen_url || '';
          if (!payload.imagenUrl && old.imagen_url) summary.preservedImages += 1;
          // Una reimportación sin columna de condición no borra la revisión ya cargada.
          const nextCondicion = payload.condicion || old.condicion || '';
          if (!payload.condicion && old.condicion) summary.preservedConditions += 1;
          update.run(
            payload.nombre,
            payload.categoria,
            payload.subcategoria,
            payload.cantidad,
            payload.unidad,
            nextImageUrl,
            payload.estado,
            nextCondicion,
            payload.minStock,
            // Una condición que viene en el CSV es una revisión con fecha de
            // hoy; si la fila no la trae, se conserva la fecha anterior.
            payload.condicion ? ts : (old.condicion_updated_at || ''),
            payload.observaciones,
            ts,
            old.id,
            siteCode
          );
          summary.updated += 1;
        } else {
          insert.run(siteCode, payload.nombre, payload.categoria, payload.subcategoria, payload.cantidad, payload.unidad, payload.imagenUrl, payload.estado, payload.condicion, payload.minStock, payload.condicion ? ts : '', payload.observaciones, ts, ts);
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
  const minStock = Number(raw.minStock ?? raw.min_stock ?? 3);
  const condicionRaw = String(raw.condicion || raw.condition || '').trim();
  return {
    nombre: String(raw.nombre || raw.name || '').trim(),
    categoria: String(raw.categoria || raw.category || 'Otro').trim() || 'Otro',
    subcategoria: String(raw.subcategoria || raw.subcategory || '').trim(),
    cantidad: Number.isFinite(cantidad) && cantidad >= 0 ? Math.floor(cantidad) : 0,
    unidad: String(raw.unidad || raw.unit || 'unidades').trim() || 'unidades',
    imagenUrl: String(raw.imagenUrl || raw.imagen_url || raw.imageUrl || '').trim(),
    // `estado` queda por compatibilidad con importaciones viejas; la condición
    // real vive en `condicion`, con la misma escala que los dispositivos.
    estado: String(raw.estado || raw.state || '').trim(),
    condicion: CONDITIONS.includes(condicionRaw) ? condicionRaw : '',
    minStock: Number.isFinite(minStock) && minStock >= 0 ? Math.floor(minStock) : 3,
    observaciones: String(raw.observaciones || raw.notes || '').trim()
  };
}

function listUnits(siteCode, itemId) {
  return getDb().prepare(`
    SELECT * FROM inventory_units
    WHERE site_code=? AND item_id=? AND COALESCE(activo,1)=1
    ORDER BY id
  `).all(siteCode, itemId).map(rowToUnit);
}

// Contadores por recurso para no pedir las unidades una por una desde la grilla.
function unitStatsBySite(siteCode) {
  const rows = getDb().prepare(`
    SELECT item_id,
           COUNT(*) AS total,
           SUM(CASE WHEN condicion IN ('Regular','Malo') THEN 1 ELSE 0 END) AS alertas
    FROM inventory_units
    WHERE site_code=? AND COALESCE(activo,1)=1
    GROUP BY item_id
  `).all(siteCode);
  return new Map(rows.map(row => [Number(row.item_id), { total: Number(row.total || 0), alertas: Number(row.alertas || 0) }]));
}

function readInventoryItem(siteCode, itemId) {
  const row = getDb().prepare('SELECT * FROM inventory_items WHERE id=? AND site_code=?').get(itemId, siteCode);
  if (!row) return null;
  const stats = unitStatsBySite(siteCode).get(Number(row.id));
  return rowToInventoryItem(row, stats);
}

// La numeración por defecto sigue el máximo existente: agregar la unidad 9 a un
// recurso de 8 no obliga a escribir el número a mano.
function nextUnitNumber(siteCode, itemId) {
  const numeros = getDb().prepare('SELECT numero FROM inventory_units WHERE site_code=? AND item_id=? AND COALESCE(activo,1)=1').all(siteCode, itemId);
  const max = numeros.reduce((acc, row) => {
    const parsed = Number(String(row.numero || '').replace(/[^0-9]/g, ''));
    return Number.isFinite(parsed) && parsed > acc ? parsed : acc;
  }, 0);
  return String(max + 1);
}

function normalizeUnitPayload(raw = {}) {
  const condicionRaw = String(raw.condicion || raw.condition || '').trim();
  return {
    numero: String(raw.numero ?? '').trim().slice(0, 40),
    descripcion: String(raw.descripcion ?? '').trim().slice(0, 300),
    sn: String(raw.sn ?? raw.serial ?? '').trim().slice(0, 120),
    mac: String(raw.mac ?? '').trim().slice(0, 60),
    // Opcional a propósito: en Chrome OS no aplica, y exigirlo obligaría a
    // inventar valores basura para poder guardar la unidad.
    teamviewerId: String(raw.teamviewerId ?? raw.teamviewer_id ?? '').trim().slice(0, 60),
    condicion: CONDITIONS.includes(condicionRaw) ? condicionRaw : ''
  };
}

function rowToUnit(row) {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    numero: row.numero || '',
    descripcion: row.descripcion || '',
    sn: row.sn || '',
    mac: row.mac || '',
    teamviewerId: row.teamviewer_id || '',
    condicion: row.condicion || '',
    condicionUpdatedAt: row.condicion_updated_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToInventoryItem(row, unitStats) {
  const minStock = Number(row.min_stock ?? 3);
  return {
    id: row.id,
    siteCode: row.site_code,
    nombre: row.nombre || '',
    categoria: row.categoria || 'Otro',
    subcategoria: row.subcategoria || '',
    cantidad: Number(row.cantidad || 0),
    unidad: row.unidad || 'unidades',
    imagenUrl: row.imagen_url || '',
    estado: row.estado || '',
    estadoLegacy: row.estado_legacy || '',
    condicion: row.condicion || '',
    minStock: Number.isFinite(minStock) ? minStock : 3,
    bajoStock: Number(row.cantidad || 0) <= (Number.isFinite(minStock) ? minStock : 3),
    condicionUpdatedAt: row.condicion_updated_at || '',
    unidadesCargadas: Number(unitStats?.total || 0),
    unidadesConFalla: Number(unitStats?.alertas || 0),
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

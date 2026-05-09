import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import path from 'node:path';
import { readTextIfExists, writeText } from './cache.service.js';

const FIELD_ALIASES = {
  siteCode: ['sede', 'site', 'site_code', 'site code'],
  etiqueta: ['etiqueta 2023', 'etiqueta', 'codigo', 'código'],
  categoria: ['categoria', 'categoría', 'tipo', 'tipo dispositivo', 'tipo de dispositivo'],
  dispositivo: ['dispositivo', 'equipo'],
  marca: ['marca'],
  modelo: ['modelo', 'model'],
  sn: ['s/n', 'serial', 'numero de serie', 'número de serie'],
  mac: ['mac', 'ma:c :ad:dr:es:s wifi', 'wifi'],
  numero: ['nombre', 'numero', 'número', 'nro', 'n°', 'numero operativo', 'número operativo', 'alias'],
  aliasOperativo: ['alias operativo', 'nombre operativo', 'alias alternativos', 'aliases', 'alias'],
  estado: ['estado', 'estado/devuelto', 'devuelto'],
  prestada: ['prestada', 'prestado a', 'persona'],
  comentarios: ['comentarios', 'comentario'],
  rol: ['rol'],
  ubicacion: ['ubicacion', 'ubicación'],
  motivo: ['motivo'],
  fechaPrestado: ['fecha prestado', 'hora prestamo', 'horario prestamo', 'prestamo horario', 'prestado fecha', 'prestado'],
  fechaDevuelto: ['fecha devuelto', 'hora devolucion', 'horario devolucion', 'devolucion horario', 'devuelto fecha'],
  ultima: ['ultima modificacion', 'última modificación']
};

export async function loadDevicesCsv(options = {}) {
  const csvUrl = options.csvUrl ?? config.googleSheetCsvUrl;
  const cachePath = options.cachePath || config.cacheCsvPath;
  if (csvUrl) {
    try {
      return await fetchDevicesCsvFromGoogle({ csvUrl, cachePath });
    } catch {
      const cached = await readTextIfExists(cachePath);
      if (cached) return { text: cached, source: 'Cache local' };
      throw new Error('No se pudo leer Google Sheets ni cache local.');
    }
  }
  const text = await readTextIfExists(cachePath);
  return { text, source: 'Cache local' };
}

export async function readCachedDevicesCsv(cachePath = config.cacheCsvPath) {
  const text = await readTextIfExists(cachePath);
  return text ? { text, source: 'Cache local' } : null;
}

export async function fetchDevicesCsvFromGoogle(options = {}) {
  const csvUrl = options.csvUrl ?? config.googleSheetCsvUrl;
  const cachePath = options.cachePath || config.cacheCsvPath;
  if (!csvUrl) throw new Error('GOOGLE_SHEET_CSV_URL no configurado.');
  if (!isAbsoluteUrl(csvUrl)) {
    throw new Error(`GOOGLE_SHEET_CSV_URL debe ser absoluta (https://...). Valor actual: "${csvUrl}".`);
  }
  const response = await fetchWithTimeout(addCacheBuster(toCsvExportUrl(csvUrl)), config.sheetFetchTimeoutMs);
  if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}`);
  const text = await response.text();
  if (looksLikeHtml(text)) throw new Error('La URL configurada no devolvió CSV.');
  await writeText(cachePath, text);
  return { text, source: 'Google CSV' };
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

export async function fetchDevicesJsonFromAppsScript(options = {}) {
  const rawUrl = options.url || config.appsScriptInventoryUrl || config.appsScriptUrl;
  if (!rawUrl) throw new Error('APPS_SCRIPT_INVENTORY_URL/APPS_SCRIPT_URL no configurado.');
  const url = new URL(rawUrl);
  if (!url.searchParams.get('action')) url.searchParams.set('action', options.action || 'inventory');
  const response = await fetchWithTimeout(addCacheBuster(url.toString()), config.sheetFetchTimeoutMs);
  if (!response.ok) throw new Error(`Apps Script inventory HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const items = parseDevicesJsonRows(rows);
  if (options.cachePath && items.length && options.writeCache !== false) {
    await writeDevicesCsvCache(options.cachePath, items);
  }
  return {
    items,
    source: 'Apps Script inventory',
    updatedAt: payload?.updatedAt || payload?.version || '',
    spreadsheet: payload?.spreadsheet || payload?.spreadsheetName || '',
    spreadsheetId: payload?.spreadsheetId || '',
    sheet: payload?.sheet || payload?.sheetName || ''
  };
}

export async function writeDevicesCsvCache(cachePath, items) {
  await writeText(cachePath, serializeDevicesCsv(items));
}

export function cachePathForSite(siteCode) {
  const ext = path.extname(config.cacheCsvPath) || '.csv';
  const base = config.cacheCsvPath.slice(0, -ext.length);
  const code = String(siteCode || config.defaultSiteCode || 'NFPT').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return `${base}_${code}${ext}`;
}

export function parseDevicesCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map(normalizeText);
  const col = key => findColumn(headers, FIELD_ALIASES[key]);
  const idx = Object.fromEntries(Object.keys(FIELD_ALIASES).map(key => [key, col(key)]));
  return rows.slice(headerIndex + 1).map(row => normalizeDevice(row, idx)).filter(device => device.etiqueta || device.sn || device.mac);
}

export function parseDevicesJsonRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeDeviceObject).filter(device => device.etiqueta || device.sn || device.mac);
}

export function toCsvExportUrl(rawUrl) {
  const value = clean(rawUrl);
  if (!value) return value;
  try {
    const url = new URL(value);
    const isGoogleSheet = url.hostname.includes('docs.google.com') && url.pathname.includes('/spreadsheets/d/');
    const alreadyCsv = url.searchParams.get('output') === 'csv' || url.searchParams.get('tqx') === 'out:csv';
    if (!isGoogleSheet || alreadyCsv) return value;

    const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
    if (!id) return value;
    const gid = url.searchParams.get('gid') || '0';
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
  } catch {
    return value;
  }
}

function normalizeDevice(row, idx) {
  const get = key => idx[key] >= 0 ? clean(row[idx[key]]) : '';
  const etiqueta = get('etiqueta');
  const prestadoA = get('prestada');
  const estado = normalizeAppState(get('estado'), prestadoA);
  const categoria = normalizeCategory(get('categoria'));
  const numero = firstOperationalNumber(get('numero'), get('aliasOperativo'));
  return {
    id: makeDeviceId(etiqueta, get('sn'), get('mac')),
    siteCode: get('siteCode'),
    etiqueta,
    numero,
    categoria,
    dispositivo: get('dispositivo') || 'Chromebook',
    marca: get('marca'),
    modelo: get('modelo'),
    sn: get('sn'),
    mac: get('mac'),
    estado,
    prestadoA,
    comentarios: get('comentarios'),
    rol: get('rol'),
    ubicacion: get('ubicacion'),
    motivo: get('motivo'),
    loanedAt: get('fechaPrestado'),
    returnedAt: get('fechaDevuelto'),
    ultima: get('ultima'),
    aliasOperativo: buildStableOperationalAlias(get('aliasOperativo'), categoria, numero)
  };
}

function normalizeDeviceObject(row) {
  const normalized = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    normalized.set(normalizeText(key), value);
  }
  const get = key => {
    for (const alias of FIELD_ALIASES[key] || []) {
      const value = normalized.get(normalizeText(alias));
      if (value != null && clean(value)) return clean(value);
    }
    return '';
  };
  const etiqueta = get('etiqueta');
  const prestadoA = get('prestada');
  const estado = normalizeAppState(get('estado'), prestadoA);
  const categoria = normalizeCategory(get('categoria'));
  const numero = firstOperationalNumber(get('numero'), get('aliasOperativo'));
  return {
    id: makeDeviceId(etiqueta, get('sn'), get('mac')),
    siteCode: get('siteCode'),
    etiqueta,
    numero,
    categoria,
    dispositivo: get('dispositivo') || 'Chromebook',
    marca: get('marca'),
    modelo: get('modelo'),
    sn: get('sn'),
    mac: get('mac'),
    estado,
    prestadoA,
    comentarios: get('comentarios'),
    rol: get('rol'),
    ubicacion: get('ubicacion'),
    motivo: get('motivo'),
    loanedAt: get('fechaPrestado'),
    returnedAt: get('fechaDevuelto'),
    ultima: get('ultima'),
    aliasOperativo: buildStableOperationalAlias(get('aliasOperativo'), categoria, numero)
  };
}

function firstOperationalNumber(...values) {
  for (const value of values) {
    const number = extractOperationalNumber(value);
    if (number) return number;
  }
  return '';
}

function extractOperationalNumber(value) {
  const raw = clean(value);
  if (!raw || /^D0*\d+$/i.test(raw)) return '';
  if (/^\d{1,3}$/.test(raw)) return String(Number(raw));
  const match = raw.match(/\b(?:plani|touch|tic|dell)\s*0*(\d{1,3})\b/i)
    || raw.match(/\b0*(\d{1,3})\s*(?:plani|touch|tic|dell)\b/i);
  return match ? String(Number(match[1])) : '';
}

function buildStableOperationalAlias(alias, category, number) {
  const firstAlias = clean(alias).split(',').map(value => value.trim()).find(Boolean) || '';
  const type = normalizeCategory(category || firstAlias);
  if (firstAlias && extractOperationalNumber(firstAlias)) {
    if (['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${type} ${extractOperationalNumber(firstAlias)}`;
    return firstAlias;
  }
  if (firstAlias && number) return `${firstAlias} ${number}`;
  if (['Plani', 'Touch', 'TIC', 'Dell'].includes(type) && number) return `${type} ${number}`;
  return firstAlias || type;
}

function fetchWithTimeout(url, timeoutMs) {
  const signal = AbortSignal.timeout(Math.max(1000, Number(timeoutMs || 4500)));
  return fetch(url, { signal });
}

function addCacheBuster(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('_ta', String(Date.now()));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => clean(value))) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(value => clean(value))) rows.push(row);
  return rows;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(25, rows.length); i += 1) {
    const headers = rows[i].map(normalizeText);
    if (findColumn(headers, FIELD_ALIASES.etiqueta) !== -1) return i;
  }
  return 0;
}

function findColumn(headers, aliases) {
  const normalized = aliases.map(normalizeText);
  return headers.findIndex(header => normalized.includes(header));
}

function normalizeAppState(rawState, prestadoA = '') {
  const state = normalizeText(rawState);
  if (state.includes('fuera')) return 'Fuera de servicio';
  if (state.includes('perd') || state.includes('no encontrada')) return 'No encontrada';
  if (state.includes('prest') || clean(prestadoA)) return 'Prestado';
  return 'Disponible';
}

function normalizeCategory(value) {
  const raw = clean(value);
  if (!raw) return '';
  const text = normalizeText(raw);
  if (text.includes('tablet')) return 'Tablet';
  if (text.includes('plani') || text.includes('planificacion')) return 'Plani';
  if (text === 'touch') return 'Touch';
  if (text === 'tic') return 'TIC';
  if (text === 'dell') return 'Dell';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

function looksLikeHtml(text) {
  return /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

function makeDeviceId(etiqueta, sn, mac) {
  return [etiqueta, sn, mac].map(clean).filter(Boolean).join('|') || randomUUID();
}

function serializeDevicesCsv(items) {
  const headers = ['site_code', 'etiqueta', 'categoria', 'dispositivo', 'marca', 'modelo', 'sn', 'mac', 'numero', 'alias_operativo', 'estado', 'prestada', 'comentarios', 'rol', 'ubicacion', 'motivo', 'fecha_prestado', 'fecha_devuelto', 'ultima_modificacion'];
  const rows = items.map(item => [
    item.siteCode || '',
    item.etiqueta || '',
    item.categoria || '',
    item.dispositivo || '',
    item.marca || '',
    item.modelo || '',
    item.sn || '',
    item.mac || '',
    item.numero || '',
    item.aliasOperativo || '',
    item.estado || '',
    item.prestadoA || '',
    item.comentarios || '',
    item.rol || '',
    item.ubicacion || '',
    item.motivo || '',
    item.loanedAt || '',
    item.returnedAt || '',
    item.ultima || ''
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

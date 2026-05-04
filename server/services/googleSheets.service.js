import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { readTextIfExists, writeText } from './cache.service.js';

const FIELD_ALIASES = {
  etiqueta: ['etiqueta 2023', 'etiqueta', 'codigo', 'código'],
  dispositivo: ['dispositivo', 'equipo'],
  marca: ['marca'],
  modelo: ['modelo', 'model'],
  sn: ['s/n', 'serial', 'numero de serie', 'número de serie'],
  mac: ['mac', 'ma:c :ad:dr:es:s wifi', 'wifi'],
  numero: ['nombre', 'numero', 'número', 'alias'],
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

export async function loadDevicesCsv() {
  if (config.googleSheetCsvUrl) {
    try {
      const response = await fetch(toCsvExportUrl(config.googleSheetCsvUrl));
      if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}`);
      const text = await response.text();
      if (looksLikeHtml(text)) throw new Error('La URL configurada no devolvio CSV.');
      await writeText(config.cacheCsvPath, text);
      return { text, source: 'Google Sheets' };
    } catch {
      const cached = await readTextIfExists(config.cacheCsvPath);
      if (cached) return { text: cached, source: 'Cache local' };
      throw new Error('No se pudo leer Google Sheets ni cache local.');
    }
  }
  const text = await readTextIfExists(config.cacheCsvPath);
  return { text, source: 'Cache local' };
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
  return {
    id: makeDeviceId(etiqueta, get('sn'), get('mac')),
    etiqueta,
    numero: get('numero'),
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
    ultima: get('ultima')
  };
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

function looksLikeHtml(text) {
  return /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

function makeDeviceId(etiqueta, sn, mac) {
  return [etiqueta, sn, mac].map(clean).filter(Boolean).join('|') || randomUUID();
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

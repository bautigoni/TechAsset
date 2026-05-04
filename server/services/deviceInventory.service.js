import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { getDb, getLocalStates } from '../db.js';
import { loadDevicesCsv, parseDevicesCsv } from './googleSheets.service.js';
import { proxyAppsScript } from './appsScript.service.js';

const STATE_CACHE_TTL_MS = 60 * 1000;
let stateCache = { rows: [], fetchedAt: 0 };
let stateInflight = null;

function refreshStateInBackground() {
  if (stateInflight) return stateInflight;
  stateInflight = (async () => {
    try {
      const result = await proxyAppsScript('state', {}, 'GET');
      const rows = Array.isArray(result?.rows) ? result.rows : Array.isArray(result?.items) ? result.items : [];
      stateCache = {
        rows: rows.map(row => normalizeStateRow(row)).filter(device => device.etiqueta),
        fetchedAt: Date.now()
      };
    } catch (error) {
      console.warn(`[devices] Apps Script state unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      stateCache = { ...stateCache, fetchedAt: Date.now() };
    } finally {
      stateInflight = null;
    }
  })();
  return stateInflight;
}

async function loadAppsScriptState({ wait = false } = {}) {
  const age = Date.now() - stateCache.fetchedAt;
  const stale = age > STATE_CACHE_TTL_MS;
  if (stale || !stateCache.fetchedAt) {
    const promise = refreshStateInBackground();
    if (wait || !stateCache.fetchedAt) await promise;
  }
  return stateCache.rows;
}

export async function getMergedDevices() {
  const { text, source } = await loadDevicesCsv();
  const sheetDevices = parseDevicesCsv(text);
  const stateDevices = await loadAppsScriptState();
  const localStates = getLocalStates();
  const masterDevices = await loadAppDevices();
  const localDevices = loadLocalDevices();
  const overrideState = mergeStateOverrides(stateDevices, localStates);
  return {
    items: mergeDevices(masterDevices.length ? masterDevices : sheetDevices, sheetDevices, overrideState, localDevices, !masterDevices.length),
    source: [source, stateDevices.length ? 'Apps Script state' : '', localStates.length ? 'Estado local' : '', masterDevices.length ? 'Dispositivos APP' : ''].filter(Boolean).join(' + ')
  };
}

function mergeStateOverrides(stateDevices, localStates) {
  const map = new Map();
  for (const device of stateDevices) {
    const key = normalizeTag(device.etiqueta);
    if (key) map.set(key, device);
  }
  for (const local of localStates) {
    const key = normalizeTag(local.etiqueta);
    if (!key) continue;
    map.set(key, {
      etiqueta: local.etiqueta,
      estado: local.estado,
      prestadoA: local.prestadoA,
      rol: local.rol,
      ubicacion: local.ubicacion,
      motivo: local.motivo,
      comentarios: local.comentarios,
      loanedAt: local.loanedAt,
      returnedAt: local.returnedAt
    });
  }
  return [...map.values()];
}

async function loadAppDevices() {
  try {
    const text = await readFile(config.devicesAppCsvPath, 'utf8');
    return parseDevicesCsv(text);
  } catch {
    return [];
  }
}

function loadLocalDevices() {
  return getDb().prepare('SELECT payload FROM local_devices').all().map(row => {
    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function normalizeStateRow(row) {
  const estado = normalizeAppState(row.estado || row.state || row.status || '', row.prestada || row.prestadoA || row.persona || '');
  return {
    etiqueta: row.etiqueta || row.codigo || row.code || '',
    numero: row.numero || row.alias || '',
    modelo: row.modelo || '',
    estado,
    prestadoA: row.prestada || row.prestadoA || row.persona || '',
    comentarios: row.comentarios || row.comentario || '',
    rol: row.rol || '',
    ubicacion: row.ubicacion || row.ubicacionActual || '',
    motivo: row.motivo || '',
    loanedAt: row.fechaPrestado || row.horarioPrestamo || row.loanedAt || '',
    returnedAt: row.fechaDevuelto || row.horarioDevolucion || row.returnedAt || '',
    ultima: row.ultima || row.ultimaModificacion || ''
  };
}

function mergeDevices(masterDevices, sheetDevices, stateDevices, localDevices, includeSheetExtras = true) {
  const sheetByTag = new Map(sheetDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const stateByTag = new Map(stateDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const localByTag = new Map(localDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const seen = new Set();
  const merged = masterDevices.map(master => {
    const key = normalizeTag(master.etiqueta);
    seen.add(key);
    return mergeDevice(master, sheetByTag.get(key), stateByTag.get(key), localByTag.get(key));
  });
  const extras = includeSheetExtras ? [...sheetDevices, ...stateDevices, ...localDevices] : [...stateDevices, ...localDevices];
  for (const device of extras) {
    const key = normalizeTag(device.etiqueta);
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(mergeDevice(device, sheetByTag.get(key), stateByTag.get(key), localByTag.get(key)));
    }
  }
  return merged;
}

function mergeDevice(master, sheet, state, local) {
  const inventory = sheet || {};
  const operational = state || {};
  const extra = local || {};
  return {
    ...master,
    ...inventory,
    ...operational,
    ...extra,
    etiqueta: master.etiqueta || inventory.etiqueta || operational.etiqueta || extra.etiqueta || '',
    dispositivo: master.dispositivo || inventory.dispositivo || extra.dispositivo || 'Chromebook',
    marca: master.marca || inventory.marca || extra.marca || '',
    modelo: master.modelo || inventory.modelo || operational.modelo || extra.modelo || '',
    sn: master.sn || inventory.sn || extra.sn || '',
    mac: master.mac || inventory.mac || extra.mac || '',
    estado: operational.estado || extra.estado || master.estado || 'Disponible',
    prestadoA: operational.prestadoA || extra.prestadoA || '',
    rol: operational.rol || extra.rol || '',
    ubicacion: operational.ubicacion || extra.ubicacion || '',
    motivo: operational.motivo || extra.motivo || '',
    loanedAt: operational.loanedAt || extra.loanedAt || '',
    returnedAt: operational.returnedAt || extra.returnedAt || '',
    comentarios: operational.comentarios || extra.comentarios || ''
  };
}

function normalizeTag(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function normalizeAppState(rawState, prestadoA = '') {
  const state = normalizeText(rawState);
  if (state.includes('fuera') || state.includes('servicio') || state.includes('mantenimiento') || state.includes('baja')) return 'Fuera de servicio';
  if (state.includes('perd') || state.includes('lost') || state.includes('no encontrada') || state.includes('no encontrado')) return 'No encontrada';
  if (state.includes('prest') || state.includes('retir') || String(prestadoA || '').trim()) return 'Prestado';
  return 'Disponible';
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { config } from '../config.js';
import { getDb, getLocalStates } from '../db.js';
import {
  fetchDevicesCsvFromGoogle,
  fetchDevicesJsonFromAppsScript,
  cachePathForSite,
  parseDevicesCsv,
  readCachedDevicesCsv
} from './googleSheets.service.js';
import { proxyAppsScript } from './appsScript.service.js';

const STATE_CACHE_TTL_MS = 60 * 1000;
const INVENTORY_CACHE_TTL_MS = Math.max(1000, Number(config.sheetCacheTtlMs || 5000));
let stateCache = { rows: [], fetchedAt: 0 };
let stateInflight = null;
const inventoryCache = new Map();
const inventoryInflight = new Map();
const diagnosticsBySite = new Map();
const baseDiagnostics = {
  source: 'sin datos',
  lastSuccessfulReadAt: '',
  lastExternalFetchMs: 0,
  lastParseMs: 0,
  lastMergeMs: 0,
  lastTotalMs: 0,
  deviceCount: 0,
  timedOut: false,
  lastError: '',
  respondedWithCache: false,
  cacheAgeSeconds: null,
  inflight: false
};

function getDiagnostics(siteCode) {
  if (!diagnosticsBySite.has(siteCode)) diagnosticsBySite.set(siteCode, { ...baseDiagnostics });
  return diagnosticsBySite.get(siteCode);
}

function setDiagnostics(siteCode, next) {
  diagnosticsBySite.set(siteCode, next);
  return next;
}

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
    if (wait) await promise;
  }
  return stateCache.rows;
}

export async function getMergedDevices({ forceRefresh = false, waitForFresh = false, siteCode = config.defaultSiteCode || 'NFPT' } = {}) {
  const now = Date.now();
  const cache = inventoryCache.get(siteCode);
  const isFresh = cache && now - cache.fetchedAt <= INVENTORY_CACHE_TTL_MS;

  if (!forceRefresh && isFresh) {
    return fromCache(cache, 'memory cache', false, siteCode);
  }

  if (!forceRefresh && cache) {
    refreshInventoryInBackground('stale-memory', siteCode);
    return fromCache(cache, 'memory cache stale-while-revalidate', true, siteCode);
  }

  if (!forceRefresh && !waitForFresh) {
    const local = await buildFromLocalCsvCache({}, siteCode);
    if (local) {
      inventoryCache.set(siteCode, local);
      refreshInventoryInBackground('bootstrap-local-cache', siteCode);
      return fromCache(local, 'local CSV cache stale-while-revalidate', true, siteCode);
    }
  }

  try {
    const fresh = await refreshInventory({ reason: forceRefresh ? 'force-refresh' : 'cold-start', siteCode });
    return fromCache(fresh, fresh.source, false, siteCode);
  } catch (error) {
    const diagnostics = getDiagnostics(siteCode);
    diagnostics.lastError = readableError(error);
    diagnostics.timedOut = isTimeoutError(error);
    if (cache) return fromCache(cache, 'memory cache after refresh error', true, siteCode);
    const local = await buildFromLocalCsvCache({}, siteCode);
    if (local) {
      inventoryCache.set(siteCode, local);
      return fromCache(local, 'local CSV cache after refresh error', true, siteCode);
    }
    throw new Error('No se pudo leer inventario desde Google Sheets, Apps Script ni cache local.');
  }
}

export function invalidateDeviceInventoryCache(reason = 'manual', siteCode = config.defaultSiteCode || 'NFPT') {
  inventoryCache.delete(siteCode);
  setDiagnostics(siteCode, { ...getDiagnostics(siteCode), source: `invalidated: ${reason}`, cacheAgeSeconds: null });
}

export function getDeviceInventoryDiagnostics(siteCode = config.defaultSiteCode || 'NFPT') {
  const cache = inventoryCache.get(siteCode);
  const diagnostics = getDiagnostics(siteCode);
  return {
    ...diagnostics,
    inflight: Boolean(inventoryInflight.get(siteCode)),
    cacheAgeSeconds: cache ? Math.round((Date.now() - cache.fetchedAt) / 1000) : null,
    cacheTtlSeconds: Math.round(INVENTORY_CACHE_TTL_MS / 1000),
    memoryCacheReady: Boolean(cache),
    localStateCacheAgeSeconds: stateCache.fetchedAt ? Math.round((Date.now() - stateCache.fetchedAt) / 1000) : null
  };
}

function refreshInventoryInBackground(reason, siteCode) {
  if (inventoryInflight.get(siteCode)) return inventoryInflight.get(siteCode);
  const promise = refreshInventory({ reason, siteCode }).catch(error => {
    const diagnostics = getDiagnostics(siteCode);
    diagnostics.lastError = readableError(error);
    diagnostics.timedOut = isTimeoutError(error);
    console.warn(`[devices] background refresh failed: ${diagnostics.lastError}`);
    return null;
  }).finally(() => {
    inventoryInflight.delete(siteCode);
  });
  inventoryInflight.set(siteCode, promise);
  return promise;
}

async function refreshInventory({ reason, siteCode }) {
  if (inventoryInflight.get(siteCode)) return inventoryInflight.get(siteCode);
  const promise = (async () => {
    const timings = {};
    const totalStart = performance.now();
    let sheetDevices = [];
    let source = '';
    let timedOut = false;
    try {
      const siteSource = getSiteInventorySource(siteCode);
      if (siteSource.appsScriptUrl) {
        const live = await timed('fetch-sheet', timings, () => fetchDevicesJsonFromAppsScript({ url: siteSource.appsScriptUrl }));
        sheetDevices = live.items;
        source = live.updatedAt ? `${live.source} (${live.updatedAt})` : live.source;
        timings['parse-csv'] = 0;
      } else if (siteSource.csvUrl) {
        const csv = await timed('fetch-sheet', timings, () => fetchDevicesCsvFromGoogle({ csvUrl: siteSource.csvUrl, cachePath: siteSource.cachePath }));
        sheetDevices = await timed('parse-csv', timings, () => parseDevicesCsv(csv.text));
        source = csv.source;
      } else {
        throw new Error(`La sede ${siteCode} no tiene Spreadsheet ni Apps Script configurado.`);
      }
    } catch (error) {
      timedOut = isTimeoutError(error);
      const diagnostics = getDiagnostics(siteCode);
      diagnostics.lastError = readableError(error);
      diagnostics.timedOut = timedOut;
      const local = await buildFromLocalCsvCache({ failedExternalFetchMs: timings['fetch-sheet'] || 0, externalError: error }, siteCode);
      if (local) {
        inventoryCache.set(siteCode, local);
        return local;
      }
      throw error;
    }

    const merged = await buildMergedResult(filterBySite(sheetDevices, siteCode), source, timings, siteCode);
    merged.fetchedAt = Date.now();
    merged.loadedAt = new Date().toISOString();
    merged.reason = reason;
    timings.total = Math.round(performance.now() - totalStart);
    updateDiagnostics(merged, timings, { timedOut, error: '' }, siteCode);
    inventoryCache.set(siteCode, merged);
    return merged;
  })().finally(() => {
    inventoryInflight.delete(siteCode);
  });
  inventoryInflight.set(siteCode, promise);
  return promise;
}

async function buildFromLocalCsvCache(extra = {}, siteCode) {
  const timings = {};
  const totalStart = performance.now();
  const cached = await timed('read-local-cache', timings, () => readCachedDevicesCsv(cachePathForSite(siteCode)));
  if (!cached?.text) return null;
  const sheetDevices = await timed('parse-csv', timings, () => parseDevicesCsv(cached.text));
  const result = await buildMergedResult(filterBySite(sheetDevices, siteCode), cached.source, timings, siteCode);
  result.fetchedAt = Date.now();
  result.loadedAt = new Date().toISOString();
  timings.total = Math.round(performance.now() - totalStart);
  if (extra.failedExternalFetchMs) timings['fetch-sheet'] = extra.failedExternalFetchMs;
  updateDiagnostics(result, timings, { timedOut: isTimeoutError(extra.externalError), error: extra.externalError ? readableError(extra.externalError) : '' }, siteCode);
  return result;
}

async function buildMergedResult(sheetDevices, source, timings, siteCode) {
  const stateDevices = filterBySite(await loadAppsScriptState(), siteCode);
  return timed('merge-local-state', timings, async () => {
    const localStates = getLocalStates(siteCode);
    const masterDevices = await loadAppDevices(siteCode);
    const localDevices = loadLocalDevices(siteCode);
    const overrideState = mergeStateOverrides(stateDevices, localStates);
    const items = mergeDevices(masterDevices.length ? masterDevices : sheetDevices, sheetDevices, overrideState, localDevices, !masterDevices.length, siteCode);
    return {
      items,
      source: [source, stateDevices.length ? 'Apps Script state' : '', localStates.length ? 'Estado local' : '', masterDevices.length ? 'Dispositivos APP' : ''].filter(Boolean).join(' + ')
    };
  });
}

async function timed(label, timings, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings[label] = Math.round(performance.now() - start);
  }
}

function fromCache(cache, source, respondedWithCache, siteCode) {
  const cacheAgeSeconds = Math.max(0, Math.round((Date.now() - cache.fetchedAt) / 1000));
  const diagnostics = setDiagnostics(siteCode, { ...getDiagnostics(siteCode), source, respondedWithCache, cacheAgeSeconds, inflight: Boolean(inventoryInflight.get(siteCode)) });
  return {
    items: cache.items,
    source,
    loadedAt: cache.loadedAt,
    diagnostics: {
      source,
      respondedWithCache,
      cacheAgeSeconds,
      lastExternalFetchMs: diagnostics.lastExternalFetchMs,
      lastParseMs: diagnostics.lastParseMs,
      lastMergeMs: diagnostics.lastMergeMs,
      lastTotalMs: diagnostics.lastTotalMs
    }
  };
}

function updateDiagnostics(result, timings, { timedOut, error }, siteCode) {
  const diagnostics = setDiagnostics(siteCode, {
    source: result.source,
    lastSuccessfulReadAt: result.loadedAt,
    lastExternalFetchMs: timings['fetch-sheet'] || 0,
    lastParseMs: timings['parse-csv'] || 0,
    lastMergeMs: timings['merge-local-state'] || 0,
    lastTotalMs: timings.total || 0,
    deviceCount: result.items.length,
    timedOut: Boolean(timedOut),
    lastError: error || '',
    respondedWithCache: result.source.includes('Cache local'),
    cacheAgeSeconds: 0,
    inflight: Boolean(inventoryInflight.get(siteCode))
  });
  if (process.env.DEBUG_DEVICE_PERF === '1' || process.env.DEBUG_DEVICE_PERF === 'true') {
    console.info(`[devices/perf] source="${result.source}" fetch=${diagnostics.lastExternalFetchMs}ms parse=${diagnostics.lastParseMs}ms merge=${diagnostics.lastMergeMs}ms total=${diagnostics.lastTotalMs}ms count=${diagnostics.deviceCount} timeout=${diagnostics.timedOut}`);
  }
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error || 'Error desconocido');
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|aborted/i.test(readableError(error));
}

const SHEET_AUTHORITATIVE_STATES = new Set(['Prestado', 'No encontrada', 'Fuera de servicio']);
const LOCAL_TRIVIAL_STATES = new Set(['', 'Disponible', 'Devuelto']);
// Ventana en la que confiamos en local por encima de la planilla (segundos para que la sincronización con GAS llegue).
const LOCAL_PRECEDENCE_WINDOW_MS = 90 * 1000;

function mergeStateOverrides(stateDevices, localStates) {
  const map = new Map();
  for (const device of stateDevices) {
    const key = normalizeTag(device.etiqueta);
    if (key) map.set(key, device);
  }
  const now = Date.now();
  for (const local of localStates) {
    const key = normalizeTag(local.etiqueta);
    if (!key) continue;
    const sheetState = map.get(key);
    const sheetEstado = String(sheetState?.estado || '').trim();
    const localEstado = String(local.estado || '').trim();
    const sheetIsAuthoritative = SHEET_AUTHORITATIVE_STATES.has(sheetEstado);
    const localIsTrivial = LOCAL_TRIVIAL_STATES.has(localEstado);
    if (sheetIsAuthoritative && localIsTrivial) {
      // La planilla marca Prestado / No encontrada / Fuera de servicio y local sólo tiene
      // "Disponible/Devuelto" remanente: gana la planilla, salvo que local sea muy reciente
      // (devolución hecha en la app que aún no terminó de sincronizar con Apps Script).
      const localTime = parseLooseTimestamp(local.updatedAt);
      const isRecent = localTime && (now - localTime) < LOCAL_PRECEDENCE_WINDOW_MS;
      if (!isRecent) continue;
    }
    map.set(key, {
      etiqueta: local.etiqueta,
      estado: localEstado,
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

function parseLooseTimestamp(value) {
  if (!value) return 0;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const match = String(value).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return 0;
  const year = Number(match[3].length === 2 ? '20' + match[3] : match[3]);
  return new Date(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)).getTime() || 0;
}

async function loadAppDevices(siteCode) {
  try {
    const text = await readFile(config.devicesAppCsvPath, 'utf8');
    return filterBySite(parseDevicesCsv(text), siteCode);
  } catch {
    return [];
  }
}

function getSiteInventorySource(siteCode) {
  const row = getDb().prepare('SELECT spreadsheet_url, apps_script_url FROM sites WHERE site_code=?').get(siteCode);
  const csvUrl = String(row?.spreadsheet_url || config.googleSheetCsvUrl || '').trim();
  const appsScriptUrl = String(row?.apps_script_url || config.appsScriptInventoryUrl || config.appsScriptUrl || '').trim();
  return {
    csvUrl: isUsableExternalUrl(csvUrl) ? csvUrl : '',
    appsScriptUrl: isUsableExternalUrl(appsScriptUrl) ? appsScriptUrl : '',
    cachePath: cachePathForSite(siteCode)
  };
}

function isUsableExternalUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function loadLocalDevices(siteCode) {
  return getDb().prepare('SELECT payload FROM local_devices WHERE site_code=? AND COALESCE(eliminado,0)=0').all(siteCode).map(row => {
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
    siteCode: row.siteCode || row.site_code || row.sede || row.Sede || '',
    etiqueta: row.etiqueta || row.codigo || row.code || '',
    numero: row.numero || row.alias || '',
    categoria: normalizeCategory(row.categoria || row.tipo || row.category || ''),
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

function mergeDevices(masterDevices, sheetDevices, stateDevices, localDevices, includeSheetExtras = true, siteCode) {
  const hidden = new Set(getDb().prepare('SELECT etiqueta FROM hidden_devices WHERE site_code=?').all(siteCode).map(row => normalizeTag(row.etiqueta)));
  const sheetByTag = new Map(sheetDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const stateByTag = new Map(stateDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const localByTag = new Map(localDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const seen = new Set();
  const merged = masterDevices.map(master => {
    const key = normalizeTag(master.etiqueta);
    seen.add(key);
    if (hidden.has(key)) return null;
    return mergeDevice(master, sheetByTag.get(key), stateByTag.get(key), localByTag.get(key));
  }).filter(Boolean);
  const extras = includeSheetExtras ? [...sheetDevices, ...stateDevices, ...localDevices] : [...stateDevices, ...localDevices];
  for (const device of extras) {
    const key = normalizeTag(device.etiqueta);
    if (key && !seen.has(key) && !hidden.has(key)) {
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
  const merged = {
    ...master,
    ...inventory,
    ...operational,
    ...extra,
    siteCode: extra.siteCode || extra.site_code || master.siteCode || master.site_code || inventory.siteCode || inventory.site_code || '',
    etiqueta: master.etiqueta || inventory.etiqueta || operational.etiqueta || extra.etiqueta || '',
    categoria: normalizeCategory(extra.categoria || master.categoria || inventory.categoria || operational.categoria || inventory.tipo || master.tipo || ''),
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
    comentarios: operational.comentarios || extra.comentarios || '',
    aliasOperativo: extra.aliasOperativo || master.aliasOperativo || inventory.aliasOperativo || operational.aliasOperativo || ''
  };
  const stateText = String(merged.estado || '').trim().toLowerCase();
  if (stateText === 'disponible' || stateText === 'devuelto') {
    merged.prestadoA = '';
    merged.rol = '';
    merged.ubicacion = '';
    merged.motivo = '';
    merged.loanedAt = '';
  }
  return merged;
}

function filterBySite(devices, siteCode) {
  const normalizedSite = String(siteCode || '').toUpperCase();
  return devices.filter(device => {
    const value = String(device.siteCode || device.site_code || device.sede || device.Sede || '').trim().toUpperCase();
    return !value || value === normalizedSite;
  }).map(device => ({ ...device, siteCode: normalizedSite }));
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

function normalizeCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const text = normalizeText(raw);
  if (text.includes('tablet')) return 'Tablet';
  if (text.includes('plani') || text.includes('planificacion')) return 'Plani';
  if (text === 'touch') return 'Touch';
  if (text === 'tic') return 'TIC';
  if (text === 'dell') return 'Dell';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

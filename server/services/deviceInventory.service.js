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
import { getAppsScriptUrlForSite, proxyAppsScript } from './appsScript.service.js';

const STATE_CACHE_TTL_MS = 60 * 1000;
const INVENTORY_CACHE_TTL_MS = Math.max(30000, Number(config.sheetCacheTtlMs || 30000));
const stateCacheBySite = new Map();
const stateInflightBySite = new Map();
const inventoryCache = new Map();
const inventoryInflight = new Map();
const inventoryRefreshGeneration = new Map();
const diagnosticsBySite = new Map();
const stateStatusBySite = new Map();
const stateWarningBySite = new Map();
const EMPTY_RETRY_MS = 2 * 60 * 1000;
const STATE_WARNING_INTERVAL_MS = 5 * 60 * 1000;
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

function getStateCache(siteCode) {
  return stateCacheBySite.get(siteCode) || { rows: [], fetchedAt: 0 };
}

function getStateStatus(siteCode) {
  return stateStatusBySite.get(siteCode) || { ok: false, lastError: '', lastAttemptAt: 0, lastOkAt: 0 };
}

function setStateStatus(siteCode, patch) {
  const next = { ...getStateStatus(siteCode), ...patch };
  stateStatusBySite.set(siteCode, next);
  return next;
}

function logStateWarning(siteCode, error) {
  const message = readableError(error);
  const now = Date.now();
  const debug = process.env.DEBUG_DEVICE_STATE === '1' || process.env.DEBUG_DEVICE_STATE === 'true';
  const last = stateWarningBySite.get(siteCode) || { at: 0, message: '' };
  if (!debug && last.message === message && now - last.at < STATE_WARNING_INTERVAL_MS) return;
  stateWarningBySite.set(siteCode, { at: now, message });
  console.warn(`[devices:${siteCode}] Apps Script state unavailable: ${message}`);
}

function refreshStateInBackground(siteCode, { force = false } = {}) {
  const current = stateInflightBySite.get(siteCode);
  if (!force && current?.promise) return current.promise;
  const generation = (current?.generation || 0) + 1;
  const stateInflight = (async () => {
    try {
      const result = await proxyAppsScript('state', { siteCode }, 'GET', { siteCode });
      if (result?.skipped) {
        setStateStatus(siteCode, { ok: false, lastError: result.message || 'APPS_SCRIPT_URL no configurado.', lastAttemptAt: Date.now() });
        return;
      }
      const rows = Array.isArray(result?.rows) ? result.rows : Array.isArray(result?.items) ? result.items : [];
      const normalizedRows = rows.map(row => normalizeStateRow(row)).filter(device => device.etiqueta);
      if (!normalizedRows.length) throw new Error('Apps Script state devolvió una respuesta vacía.');
      if (stateInflightBySite.get(siteCode)?.generation === generation) {
        stateCacheBySite.set(siteCode, {
          rows: normalizedRows,
          fetchedAt: Date.now()
        });
        setStateStatus(siteCode, { ok: true, lastError: '', lastAttemptAt: Date.now(), lastOkAt: Date.now() });
      }
    } catch (error) {
      logStateWarning(siteCode, error);
      if (stateInflightBySite.get(siteCode)?.generation === generation) {
        const currentCache = getStateCache(siteCode);
        if (currentCache.rows.length) stateCacheBySite.set(siteCode, { ...currentCache, fetchedAt: Date.now() });
        setStateStatus(siteCode, { ok: false, lastError: readableError(error), lastAttemptAt: Date.now() });
      }
    } finally {
      const current = stateInflightBySite.get(siteCode);
      if (current?.generation === generation) stateInflightBySite.delete(siteCode);
    }
  })();
  stateInflightBySite.set(siteCode, { promise: stateInflight, generation });
  return stateInflight;
}

async function loadAppsScriptState({ wait = false, force = false, siteCode } = {}) {
  const stateCache = getStateCache(siteCode);
  const age = Date.now() - stateCache.fetchedAt;
  const stale = force || age > STATE_CACHE_TTL_MS;
  if (stale || !stateCache.fetchedAt) {
    const promise = refreshStateInBackground(siteCode, { force });
    if (wait || force) await promise;
  }
  const cache = getStateCache(siteCode);
  const status = getStateStatus(siteCode);
  return {
    rows: cache.rows,
    ok: Boolean(cache.rows.length && (status.ok || status.lastOkAt)),
    fresh: Boolean(cache.rows.length && status.ok),
    lastError: status.lastError
  };
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
    const siteSource = getSiteInventorySource(siteCode);
    if (!siteSource.hasSource) {
      const empty = buildEmptyInventory(siteCode, 'Inventario no configurado para esta sede.', { source: siteSource });
      inventoryCache.set(siteCode, empty);
      return fromCache(empty, empty.source, true, siteCode);
    }
    const fresh = await refreshInventory({ reason: forceRefresh ? 'force-refresh' : 'cold-start', siteCode });
    return fromCache(fresh, fresh.source, false, siteCode);
  } catch (error) {
    const diagnostics = getDiagnostics(siteCode);
    diagnostics.lastError = readableError(error);
    diagnostics.timedOut = isTimeoutError(error);
    if (forceRefresh) {
      throw new Error(diagnostics.lastError || `No se pudo recargar la hoja de ${siteCode}.`);
    }
    if (cache) return fromCache(cache, 'memory cache after refresh error', true, siteCode);
    const local = await buildFromLocalCsvCache({}, siteCode);
    if (local) {
      inventoryCache.set(siteCode, local);
      return fromCache(local, 'local CSV cache after refresh error', true, siteCode);
    }
    const empty = buildEmptyInventory(siteCode, 'Inventario no disponible.', { error, timedOut: diagnostics.timedOut });
    inventoryCache.set(siteCode, empty);
    return fromCache(empty, empty.source, true, siteCode);
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
    localStateCacheAgeSeconds: getStateCache(siteCode).fetchedAt ? Math.round((Date.now() - getStateCache(siteCode).fetchedAt) / 1000) : null
  };
}

function refreshInventoryInBackground(reason, siteCode) {
  const cache = inventoryCache.get(siteCode);
  if (cache?.emptyFallback && Date.now() - cache.fetchedAt < EMPTY_RETRY_MS) return Promise.resolve(cache);
  const current = inventoryInflight.get(siteCode);
  if (current?.promise) return current.promise;
  const promise = refreshInventory({ reason, siteCode }).catch(error => {
    const diagnostics = getDiagnostics(siteCode);
    diagnostics.lastError = readableError(error);
    diagnostics.timedOut = isTimeoutError(error);
    console.warn(`[devices:${siteCode}] background refresh failed: ${diagnostics.lastError}`);
    return null;
  });
  return promise;
}

async function refreshInventory({ reason, siteCode }) {
  const force = reason === 'force-refresh';
  const current = inventoryInflight.get(siteCode);
  if (!force && current?.promise) return current.promise;
  const generation = (inventoryRefreshGeneration.get(siteCode) || 0) + 1;
  inventoryRefreshGeneration.set(siteCode, generation);
  const promise = (async () => {
    const timings = {};
    const totalStart = performance.now();
    let sheetDevices = [];
    let source = '';
    let timedOut = false;
    try {
      const siteSource = getSiteInventorySource(siteCode);
      if (!siteSource.hasSource) return buildEmptyInventory(siteCode, 'Inventario no configurado para esta sede.', { source: siteSource });
      if (siteSource.csvUrl) {
        const csv = await timed('fetch-sheet', timings, () => fetchDevicesCsvFromGoogle({ csvUrl: siteSource.csvUrl, cachePath: siteSource.cachePath }));
        sheetDevices = await timed('parse-csv', timings, () => parseDevicesCsv(csv.text));
        source = csv.source;
      } else if (siteSource.appsScriptUrl) {
        const live = await timed('fetch-sheet', timings, () => fetchDevicesJsonFromAppsScript({ url: siteSource.appsScriptUrl }));
        sheetDevices = live.items;
        source = live.updatedAt ? `${live.source} (${live.updatedAt})` : live.source;
        timings['parse-csv'] = 0;
      }
      if (!sheetDevices.length) throw new Error('La hoja no devolvió dispositivos.');
    } catch (error) {
      timedOut = isTimeoutError(error);
      const diagnostics = getDiagnostics(siteCode);
      diagnostics.lastError = readableError(error);
      diagnostics.timedOut = timedOut;
      if (force) {
        throw new Error(`No se pudo recargar la hoja de ${siteCode}: ${diagnostics.lastError}`);
      }
      const local = await buildFromLocalCsvCache({ failedExternalFetchMs: timings['fetch-sheet'] || 0, externalError: error }, siteCode);
      if (local) {
        inventoryCache.set(siteCode, local);
        return local;
      }
      return buildEmptyInventory(siteCode, 'Inventario no disponible.', { error, timedOut });
    }

    const merged = await buildMergedResult(filterBySite(sheetDevices, siteCode), source, timings, siteCode, reason === 'force-refresh');
    merged.fetchedAt = Date.now();
    merged.loadedAt = new Date().toISOString();
    merged.reason = reason;
    timings.total = Math.round(performance.now() - totalStart);
    if (inventoryRefreshGeneration.get(siteCode) !== generation) {
      return inventoryCache.get(siteCode) || merged;
    }
    updateDiagnostics(merged, timings, { timedOut, error: '' }, siteCode);
    inventoryCache.set(siteCode, merged);
    return merged;
  })().finally(() => {
    const current = inventoryInflight.get(siteCode);
    if (current?.generation === generation) inventoryInflight.delete(siteCode);
  });
  inventoryInflight.set(siteCode, { promise, generation, reason });
  return promise;
}

async function buildFromLocalCsvCache(extra = {}, siteCode) {
  const timings = {};
  const totalStart = performance.now();
  let cached = await timed('read-local-cache', timings, () => readCachedDevicesCsv(cachePathForSite(siteCode)));
  if (!cached?.text && String(siteCode || '').toUpperCase() === String(config.defaultSiteCode || 'NFPT').toUpperCase()) {
    cached = await timed('read-legacy-local-cache', timings, () => readCachedDevicesCsv(config.cacheCsvPath));
  }
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

async function buildMergedResult(sheetDevices, source, timings, siteCode, forceState = false) {
  const stateResult = await loadAppsScriptState({ siteCode, force: forceState, wait: forceState });
  const stateDevices = filterBySite(stateResult.rows, siteCode);
  const preferExternalState = forceState && stateResult.fresh && stateDevices.length > 0;
  return timed('merge-local-state', timings, async () => {
    const localStates = getLocalStates(siteCode);
    const masterDevices = await loadAppDevices(siteCode);
    const localDevices = loadLocalDevices(siteCode);
    const previousRuntimeStates = preferExternalState ? [] : operationalSnapshotsFromCache(siteCode);
    const overrideState = mergeStateOverrides(stateDevices, [...previousRuntimeStates, ...localStates], { preferExternal: preferExternalState });
    const items = mergeDevices(masterDevices.length ? masterDevices : sheetDevices, sheetDevices, overrideState, localDevices, !masterDevices.length, siteCode, { preferExternalState });
    return {
      items,
      source: [source, stateDevices.length ? (stateResult.fresh ? 'Apps Script state' : 'Último state válido') : '', previousRuntimeStates.length ? 'Último estado operativo' : '', localStates.length ? 'Estado local' : '', masterDevices.length ? 'Dispositivos APP' : ''].filter(Boolean).join(' + ')
    };
  });
}

function operationalSnapshotsFromCache(siteCode) {
  const cache = inventoryCache.get(siteCode);
  if (!Array.isArray(cache?.items)) return [];
  return cache.items
    .filter(device => ['Prestado', 'No encontrada', 'Fuera de servicio', 'Perdida'].includes(String(device.estado || '').trim()))
    .map(device => ({
      etiqueta: device.etiqueta,
      estado: device.estado === 'Perdida' ? 'No encontrada' : device.estado,
      prestadoA: device.prestadoA || '',
      rol: device.rol || '',
      ubicacion: device.ubicacion || '',
      motivo: device.motivo || '',
      comentarios: device.comentarios || '',
      loanedAt: device.loanedAt || '',
      returnedAt: device.returnedAt || ''
    }));
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
      lastTotalMs: diagnostics.lastTotalMs,
      timedOut: diagnostics.timedOut,
      lastError: diagnostics.lastError,
      deviceCount: diagnostics.deviceCount,
      message: cache.message || '',
      emptyFallback: Boolean(cache.emptyFallback)
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

function mergeStateOverrides(stateDevices, localStates, { preferExternal = false } = {}) {
  const map = new Map();
  for (const device of stateDevices) {
    const key = normalizeTag(device.etiqueta);
    if (key) map.set(key, device);
  }
  if (preferExternal) {
    return [...map.values()];
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
    const appPath = devicesAppPathForSite(siteCode);
    const text = await readFile(appPath, 'utf8');
    return filterBySite(parseDevicesCsv(text), siteCode);
  } catch {
    if (String(siteCode || '').toUpperCase() === String(config.defaultSiteCode || 'NFPT').toUpperCase()) {
      try {
        const text = await readFile(config.devicesAppCsvPath, 'utf8');
        return filterBySite(parseDevicesCsv(text), siteCode);
      } catch { /* ignore legacy fallback */ }
    }
    return [];
  }
}

function getSiteInventorySource(siteCode) {
  const row = getDb().prepare('SELECT spreadsheet_url, apps_script_url FROM sites WHERE site_code=?').get(siteCode);
  const isDefaultSite = String(siteCode || '').toUpperCase() === String(config.defaultSiteCode || 'NFPT').toUpperCase();
  const csvUrl = String(row?.spreadsheet_url || (isDefaultSite ? config.googleSheetCsvUrl : '') || '').trim();
  const appsScriptUrl = String(row?.apps_script_url || (isDefaultSite ? (config.appsScriptInventoryUrl || getAppsScriptUrlForSite(siteCode)) : '') || '').trim();
  const usableCsv = isUsableExternalUrl(csvUrl) ? csvUrl : '';
  const usableApps = isUsableExternalUrl(appsScriptUrl) ? appsScriptUrl : '';
  return {
    siteCode,
    csvUrl: usableCsv,
    appsScriptUrl: usableApps,
    cachePath: cachePathForSite(siteCode),
    hasSource: Boolean(usableCsv || usableApps),
    usedEnvFallback: isDefaultSite && Boolean(!row?.spreadsheet_url && !row?.apps_script_url && (config.googleSheetCsvUrl || config.appsScriptInventoryUrl || config.appsScriptUrl))
  };
}

function devicesAppPathForSite(siteCode) {
  const ext = config.devicesAppCsvPath.match(/\.[^\\.]+$/)?.[0] || '.csv';
  const base = config.devicesAppCsvPath.slice(0, -ext.length);
  const code = String(siteCode || config.defaultSiteCode || 'NFPT').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return `${base}_${code}${ext}`;
}

function buildEmptyInventory(siteCode, message, { error, timedOut = false, source } = {}) {
  const now = new Date().toISOString();
  const diagnostics = setDiagnostics(siteCode, {
    ...getDiagnostics(siteCode),
    source: message,
    lastSuccessfulReadAt: '',
    lastExternalFetchMs: 0,
    lastParseMs: 0,
    lastMergeMs: 0,
    lastTotalMs: 0,
    deviceCount: 0,
    timedOut: Boolean(timedOut || isTimeoutError(error)),
    lastError: error ? readableError(error) : message,
    respondedWithCache: true,
    cacheAgeSeconds: 0,
    inflight: false,
    siteCode,
    sourceAttempt: source || getSiteInventorySource(siteCode)
  });
  return {
    items: [],
    source: diagnostics.source,
    loadedAt: now,
    fetchedAt: Date.now(),
    emptyFallback: true,
    message,
    diagnostics
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
  const numero = firstOperationalNumber(row.numero, row.nro, row.number, row.alias, row.aliasOperativo);
  const categoria = normalizeCategory(row.categoria || row.tipo || row.category || '');
  return {
    siteCode: row.siteCode || row.site_code || row.sede || row.Sede || '',
    etiqueta: row.etiqueta || row.codigo || row.code || '',
    numero,
    categoria,
    modelo: row.modelo || '',
    estado,
    prestadoA: row.prestada || row.prestadoA || row.persona || '',
    comentarios: row.comentarios || row.comentario || '',
    rol: row.rol || '',
    ubicacion: row.ubicacion || row.ubicacionActual || '',
    motivo: row.motivo || '',
    loanedAt: row.fechaPrestado || row.horarioPrestamo || row.loanedAt || '',
    returnedAt: row.fechaDevuelto || row.horarioDevolucion || row.returnedAt || '',
    ultima: row.ultima || row.ultimaModificacion || '',
    aliasOperativo: buildStableOperationalAlias(row.aliasOperativo || row.alias || '', categoria, numero)
  };
}

function mergeDevices(masterDevices, sheetDevices, stateDevices, localDevices, includeSheetExtras = true, siteCode, options = {}) {
  const hidden = new Set(getDb().prepare('SELECT etiqueta FROM hidden_devices WHERE site_code=?').all(siteCode).map(row => normalizeTag(row.etiqueta)));
  const sheetByTag = new Map(sheetDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const stateByTag = new Map(stateDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const localByTag = new Map(localDevices.map(device => [normalizeTag(device.etiqueta), device]));
  const seen = new Set();
  const merged = masterDevices.map(master => {
    const key = normalizeTag(master.etiqueta);
    seen.add(key);
    if (hidden.has(key)) return null;
    return mergeDevice(master, sheetByTag.get(key), stateByTag.get(key), localByTag.get(key), options);
  }).filter(Boolean);
  const extras = includeSheetExtras ? [...sheetDevices, ...stateDevices, ...localDevices] : [...stateDevices, ...localDevices];
  for (const device of extras) {
    const key = normalizeTag(device.etiqueta);
    if (key && !seen.has(key) && !hidden.has(key)) {
      seen.add(key);
      merged.push(mergeDevice(device, sheetByTag.get(key), stateByTag.get(key), localByTag.get(key), options));
    }
  }
  return merged;
}

function mergeDevice(master, sheet, state, local, { preferExternalState = false } = {}) {
  const inventory = sheet || {};
  const operational = state || {};
  const extra = local || {};
  const numero = firstOperationalNumber(extra.numero, master.numero, inventory.numero, operational.numero, extra.aliasOperativo, master.aliasOperativo, inventory.aliasOperativo, operational.aliasOperativo);
  const categoria = normalizeCategory(extra.categoria || master.categoria || inventory.categoria || operational.categoria || inventory.tipo || master.tipo || '');
  const pickRuntime = (field) => preferExternalState
    ? firstNonEmpty(operational[field], inventory[field], extra[field], master[field])
    : firstNonEmpty(operational[field], extra[field], inventory[field], master[field]);
  const merged = {
    ...master,
    ...inventory,
    ...operational,
    ...extra,
    siteCode: extra.siteCode || extra.site_code || master.siteCode || master.site_code || inventory.siteCode || inventory.site_code || '',
    etiqueta: master.etiqueta || inventory.etiqueta || operational.etiqueta || extra.etiqueta || '',
    numero,
    categoria,
    dispositivo: preferExternalState
      ? firstNonEmpty(inventory.dispositivo, master.dispositivo, extra.dispositivo, operational.dispositivo, 'Chromebook')
      : firstNonEmpty(master.dispositivo, inventory.dispositivo, extra.dispositivo, operational.dispositivo, 'Chromebook'),
    marca: master.marca || inventory.marca || extra.marca || '',
    modelo: master.modelo || inventory.modelo || operational.modelo || extra.modelo || '',
    sn: master.sn || inventory.sn || extra.sn || '',
    mac: master.mac || inventory.mac || extra.mac || '',
    estado: pickRuntime('estado') || 'Disponible',
    prestadoA: pickRuntime('prestadoA'),
    rol: pickRuntime('rol'),
    ubicacion: pickRuntime('ubicacion'),
    motivo: pickRuntime('motivo'),
    loanedAt: pickRuntime('loanedAt'),
    returnedAt: pickRuntime('returnedAt'),
    comentarios: pickRuntime('comentarios'),
    aliasOperativo: buildStableOperationalAlias(firstNonEmpty(extra.aliasOperativo, master.aliasOperativo, inventory.aliasOperativo, operational.aliasOperativo), categoria, numero)
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

function firstNonEmpty(...values) {
  return values.map(value => String(value || '').trim()).find(Boolean) || '';
}

function firstOperationalNumber(...values) {
  for (const value of values) {
    const number = extractOperationalNumber(value);
    if (number) return number;
  }
  return '';
}

function extractOperationalNumber(value) {
  const raw = String(value || '').trim();
  if (!raw || /^D0*\d+$/i.test(raw)) return '';
  if (/^\d{1,3}$/.test(raw)) return String(Number(raw));
  const typed = raw.match(/\b(?:plani|touch|tic|dell)\s*0*(\d{1,3})\b/i)
    || raw.match(/\b0*(\d{1,3})\s*(?:plani|touch|tic|dell)\b/i);
  return typed ? String(Number(typed[1])) : '';
}

function buildStableOperationalAlias(alias, category, number) {
  const firstAlias = String(alias || '').split(',').map(value => value.trim()).find(Boolean) || '';
  const type = normalizeCategory(category || firstAlias);
  if (firstAlias && extractOperationalNumber(firstAlias)) {
    if (type && ['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${type} ${extractOperationalNumber(firstAlias)}`;
    return firstAlias;
  }
  if (firstAlias && number) return `${firstAlias} ${number}`;
  if (type && number && ['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${type} ${number}`;
  return firstAlias || (type && number ? `${type} ${number}` : type);
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

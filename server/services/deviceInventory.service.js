import { config } from '../config.js';
import { getDb, getLocalStates } from '../db.js';

const diagnosticsBySite = new Map();

const baseDiagnostics = {
  source: 'Base local SQLite',
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

export async function getMergedDevices({ siteCode = config.defaultSiteCode || 'NFPT' } = {}) {
  const normalizedSite = normalizeSite(siteCode);
  const started = Date.now();
  try {
    const items = buildLocalInventory(normalizedSite);
    const loadedAt = new Date().toISOString();
    const lastImport = getLastImport(normalizedSite);
    const source = lastImport ? `Base local SQLite · Última importación: ${lastImport}` : 'Base local SQLite';
    const diagnostics = setDiagnostics(normalizedSite, {
      ...baseDiagnostics,
      source,
      lastSuccessfulReadAt: loadedAt,
      lastTotalMs: Date.now() - started,
      deviceCount: items.length,
      lastError: items.length ? '' : 'No hay dispositivos importados para esta sede.',
      respondedWithCache: false
    });
    return { ok: true, items, source, loadedAt, diagnostics };
  } catch (error) {
    const loadedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error || 'Error local');
    const diagnostics = setDiagnostics(normalizedSite, {
      ...baseDiagnostics,
      source: 'Error en base local SQLite',
      lastSuccessfulReadAt: loadedAt,
      lastTotalMs: Date.now() - started,
      lastError: message
    });
    return { ok: true, items: [], source: diagnostics.source, loadedAt, diagnostics };
  }
}

export function invalidateDeviceInventoryCache(reason = 'manual', siteCode = config.defaultSiteCode || 'NFPT') {
  const normalizedSite = normalizeSite(siteCode);
  setDiagnostics(normalizedSite, { ...getDiagnostics(normalizedSite), source: `SQLite invalidado: ${reason}`, cacheAgeSeconds: null });
}

export function getDeviceInventoryDiagnostics(siteCode = config.defaultSiteCode || 'NFPT') {
  const normalizedSite = normalizeSite(siteCode);
  return {
    ...getDiagnostics(normalizedSite),
    source: getDiagnostics(normalizedSite).source || 'Base local SQLite',
    memoryCacheReady: true,
    localStateCacheAgeSeconds: null,
    lastImportAt: getLastImport(normalizedSite)
  };
}

export function buildLocalInventory(siteCode = config.defaultSiteCode || 'NFPT') {
  const normalizedSite = normalizeSite(siteCode);
  const hidden = new Set(getDb().prepare('SELECT etiqueta FROM hidden_devices WHERE site_code=?').all(normalizedSite).map(row => normalizeTag(row.etiqueta)));
  const devices = loadLocalDevices(normalizedSite).filter(device => !hidden.has(normalizeTag(device.etiqueta)));
  const statesByTag = new Map(getLocalStates(normalizedSite).map(state => [normalizeTag(state.etiqueta), state]));
  return devices.map(device => mergeLocalDevice(device, statesByTag.get(normalizeTag(device.etiqueta)), normalizedSite));
}

function loadLocalDevices(siteCode) {
  return getDb().prepare('SELECT etiqueta, payload FROM local_devices WHERE site_code=? AND COALESCE(eliminado,0)=0 ORDER BY etiqueta').all(siteCode).map(row => {
    try {
      return { etiqueta: row.etiqueta, ...JSON.parse(row.payload || '{}') };
    } catch {
      return { etiqueta: row.etiqueta };
    }
  }).filter(device => device.etiqueta);
}

function mergeLocalDevice(device, state, siteCode) {
  const categoria = normalizeCategory(device.categoria || device.tipo || device.dispositivo || '');
  const filtro = normalizeDashboardFilter(device.filtro || device.filter || '');
  const numero = firstOperationalNumber(device.numero, device.numeroOperativo, device.numero_operativo, device.nro, device.number, device.aliasOperativo, device.alias);
  const hasLocalState = Boolean(state);
  const livePrestadoA = hasLocalState ? state.prestadoA : (device.prestadoA || device.prestada || '');
  const estado = normalizeState(hasLocalState ? state.estado : (device.estado || ''), livePrestadoA);
  const merged = {
    ...device,
    id: `${siteCode}:${normalizeTag(device.etiqueta)}`,
    siteCode,
    etiqueta: normalizeTag(device.etiqueta),
    numero,
    categoria,
    filtro,
    dispositivo: device.dispositivo || categoria || 'Chromebook',
    marca: device.marca || '',
    modelo: device.modelo || '',
    sn: device.sn || device.serial || '',
    mac: device.mac || '',
    estado,
    prestadoA: hasLocalState ? state.prestadoA : (device.prestadoA || device.prestada || ''),
    rol: hasLocalState ? state.rol : (device.rol || ''),
    ubicacion: hasLocalState ? state.ubicacion : (device.ubicacion || ''),
    motivo: hasLocalState ? state.motivo : (device.motivo || ''),
    comentarios: hasLocalState ? state.comentarios : (device.comentarios || ''),
    loanedAt: hasLocalState ? state.loanedAt : (device.loanedAt || device.fechaPrestamo || device.horarioPrestamo || ''),
    returnedAt: hasLocalState ? state.returnedAt : (device.returnedAt || device.fechaDevuelto || device.horarioDevolucion || ''),
    ultima: state?.updatedAt || device.ultima || device.ultimaModificacion || '',
    numeroOperativo: numero,
    aliasOperativo: buildStableOperationalAlias(device.aliasOperativo || device.alias || '', filtro || categoria, numero)
  };
  if (isAvailableState(merged.estado)) {
    merged.prestadoA = '';
    merged.rol = '';
    merged.ubicacion = '';
    merged.motivo = '';
    merged.loanedAt = '';
  }
  return merged;
}

function normalizeDashboardFilter(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

function isAvailableState(value) {
  return ['Disponible', 'Devuelto', 'Sin revisar'].includes(String(value || '').trim());
}

function getLastImport(siteCode) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(`devices.last_import.${normalizeSite(siteCode)}`);
  return row?.value || '';
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
  if (type && number) return `${type} ${number}`;
  if (firstAlias && extractOperationalNumber(firstAlias)) {
    if (type && ['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${type} ${extractOperationalNumber(firstAlias)}`;
    return firstAlias;
  }
  if (firstAlias && number) return `${firstAlias} ${number}`;
  if (type && number && ['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${type} ${number}`;
  return firstAlias || (type && number ? `${type} ${number}` : type);
}

function normalizeState(rawState, prestadoA = '') {
  const state = normalizeText(rawState);
  if (state.includes('fuera') || state.includes('servicio') || state.includes('mantenimiento') || state.includes('baja')) return 'Fuera de servicio';
  if (state.includes('reparacion')) return 'En reparación';
  if (state.includes('sin revisar')) return 'Sin revisar';
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

function normalizeTag(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function normalizeSite(value) {
  return String(value || config.defaultSiteCode || 'NFPT').trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

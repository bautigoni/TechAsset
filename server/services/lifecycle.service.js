import { getDb, getSiteSetting, nowIso } from '../db.js';

// Escala única de condición: la comparten dispositivos (device_metadata) y
// recursos de inventario (inventory_items). '' = sin revisar.
export const CONDITIONS = ['Excelente', 'Bueno', 'Regular', 'Malo'];
export const SIN_REVISAR = 'Sin revisar';

// Vocabulario de clases de activo. La lista real sale del setting por sede
// `devices.categories` (se siembra en cada sede nueva); esto es el piso por si
// una sede todavía no lo tiene.
const FALLBACK_ASSET_CLASSES = ['Tablet', 'Notebook', 'Chromebook', 'Cámara', 'Proyector', 'Router', 'Impresora', 'Otro'];

// Baseline global de vida útil, en meses. Es el último eslabón de la cadena:
// una sede nueva funciona con CERO filas en lifecycle_defaults.
const LIFECYCLE_BASELINE = {
  tablet: 48,
  notebook: 60,
  chromebook: 48,
  camara: 72,
  proyector: 72,
  router: 60,
  impresora: 60,
  pantalla: 84,
  otro: 60
};

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getAssetClasses(siteCode) {
  const fromSettings = getSiteSetting(siteCode, 'devices.categories');
  const list = Array.isArray(fromSettings) ? fromSettings.map(item => String(item || '').trim()).filter(Boolean) : [];
  return list.length ? list : [...FALLBACK_ASSET_CLASSES];
}

export function getLifecycleOverrides(siteCode) {
  const rows = getDb().prepare('SELECT asset_class, meses FROM lifecycle_defaults WHERE site_code=?').all(siteCode);
  const map = new Map();
  for (const row of rows) {
    const meses = Number(row.meses || 0);
    if (meses > 0) map.set(normalizeKey(row.asset_class), meses);
  }
  return map;
}

// Cadena de resolución: override por equipo → override por sede → baseline global.
export function resolveExpectedLifeMonths({ assetClass, deviceOverride, overrides }) {
  const perDevice = Number(deviceOverride || 0);
  if (perDevice > 0) return { meses: perDevice, origen: 'equipo' };
  const key = normalizeKey(assetClass);
  const perSite = overrides?.get(key);
  if (perSite > 0) return { meses: perSite, origen: 'sede' };
  const baseline = LIFECYCLE_BASELINE[key];
  if (baseline > 0) return { meses: baseline, origen: 'global' };
  return { meses: LIFECYCLE_BASELINE.otro, origen: 'global' };
}

// Los valores operativos de NFPT (Touch, Plani, TIC) no generalizan a otras
// sedes: acá derivamos solo lo genérico y todo lo demás cae en 'Otro'. El
// wizard de revisión es el que confirma la clase equipo por equipo.
export function deriveAssetClass(device, assetClasses = FALLBACK_ASSET_CLASSES) {
  const byKey = new Map(assetClasses.map(item => [normalizeKey(item), item]));
  const direct = byKey.get(normalizeKey(device?.categoria));
  if (direct) return direct;
  const haystack = normalizeKey(`${device?.categoria || ''} ${device?.dispositivo || ''} ${device?.modelo || ''} ${device?.marca || ''} ${device?.filtro || ''}`);
  for (const [key, label] of byKey.entries()) {
    if (key && key !== 'otro' && haystack.includes(key)) return label;
  }
  return byKey.get('otro') || 'Otro';
}

function parseDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

// fechaAlta cae a created_at del dispositivo: nadie va a cargar 160 fechas de
// compra a mano, y sin fallback la proyección de renovación no tendría datos.
export function computeLifecycle({ fechaAlta, fallbackAlta, meses, now = new Date() }) {
  const alta = parseDate(fechaAlta) || parseDate(fallbackAlta);
  if (!alta || !(meses > 0)) {
    return { fechaAlta: alta ? alta.toISOString().slice(0, 10) : '', meses: meses || 0, fechaRenovacion: '', mesesRestantes: null, vidaConsumidaPct: null, vencido: false, estimada: !fechaAlta };
  }
  const renovacion = addMonths(alta, meses);
  const total = renovacion.getTime() - alta.getTime();
  const transcurrido = now.getTime() - alta.getTime();
  const pct = total > 0 ? Math.max(0, Math.round((transcurrido / total) * 100)) : 0;
  const mesesRestantes = Math.round((renovacion.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  return {
    fechaAlta: alta.toISOString().slice(0, 10),
    meses,
    fechaRenovacion: renovacion.toISOString().slice(0, 10),
    mesesRestantes,
    vidaConsumidaPct: pct,
    vencido: renovacion.getTime() <= now.getTime(),
    estimada: !parseDate(fechaAlta)
  };
}

export function getDeviceMetadataMap(siteCode) {
  const rows = getDb().prepare(`
    SELECT device_tag, COALESCE(condition,'') AS condition, COALESCE(notes,'') AS notes,
           COALESCE(asset_class,'') AS asset_class, expected_life_months,
           COALESCE(fecha_alta,'') AS fecha_alta, COALESCE(last_reviewed_at,'') AS last_reviewed_at,
           COALESCE(teamviewer_id,'') AS teamviewer_id
    FROM device_metadata WHERE site_code=?
  `).all(siteCode);
  return new Map(rows.map(row => [String(row.device_tag || '').trim().toUpperCase(), row]));
}

// Enriquece dispositivos ya mergeados con condición + ciclo de vida.
export function decorateDevicesWithLifecycle(devices, siteCode, now = new Date()) {
  const metaByTag = getDeviceMetadataMap(siteCode);
  const overrides = getLifecycleOverrides(siteCode);
  const assetClasses = getAssetClasses(siteCode);
  return devices.map(device => {
    const meta = metaByTag.get(String(device.etiqueta || '').trim().toUpperCase());
    const assetClass = meta?.asset_class || deriveAssetClass(device, assetClasses);
    const { meses, origen } = resolveExpectedLifeMonths({ assetClass, deviceOverride: meta?.expected_life_months, overrides });
    const lifecycle = computeLifecycle({ fechaAlta: meta?.fecha_alta, fallbackAlta: device.createdAt || device.altaAt, meses, now });
    return {
      ...device,
      condition: meta?.condition || '',
      conditionNotes: meta?.notes || '',
      lastReviewedAt: meta?.last_reviewed_at || '',
      teamviewerId: meta?.teamviewer_id || '',
      assetClass,
      assetClassConfirmed: Boolean(meta?.asset_class),
      lifecycleSource: origen,
      ...lifecycle
    };
  });
}

export function recordConditionChange({ siteCode, etiqueta, condicion, operador, origen }) {
  getDb().prepare('INSERT INTO local_movements (timestamp, tipo, descripcion, operador, origen, etiqueta, site_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), 'condicion', `Condición: ${condicion || SIN_REVISAR}`, operador || 'Sistema', origen || 'Revisión', etiqueta || '', siteCode);
}

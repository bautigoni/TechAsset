import type { Device } from '../types';
import { matchesOperationalAlias } from './classifyDevice';
import { clean } from './formatters';
import { normalizeDeviceLabel, normalizeSearchKey, parseOperationalAlias, parseScannedCode, resolveDeviceMatches } from './normalizeSearch';

// Fuera de normalizeSearch para que no pese en el chunk de entrada: solo lo usan
// pantallas diferidas (Dispositivos, Grupos, Historial).

/**
 * Búsqueda de las listas (Dispositivos, picker de Grupos, Historial): UN motor.
 *
 * - Etiqueta y alias operativo con "contiene" (como siempre): `touch 34`,
 *   `touch34`, `34touch`, `34 touch` → Touch 34; `D1436`, `1436` → D1436;
 *   `plani 5`, `planificación 5`, `plan 5` → Plani 5. Como es "contiene",
 *   `touch 3` trae también Touch 30–39.
 * - Etiqueta normalizada exacta: `D01436`, `d 1436` y el QR `TA|D1436|…`.
 * - SN, MAC, marca, modelo y la persona/ubicación del préstamo, solo cuando la
 *   consulta no es un número corto (si no, `34` traería todo SN con un 34).
 */
export function matchesDeviceSearch(device: Partial<Device>, query: string): boolean {
  const raw = clean(query);
  if (!raw) return true;
  if (matchesOperationalAlias(device, raw)) return true;
  const label = normalizeDeviceLabel(parseScannedCode(raw));
  if (/^D\d{4,}$/.test(label) && normalizeDeviceLabel(device.etiqueta) === label) return true;
  const key = normalizeSearchKey(raw);
  if (key.length < 3 || /^\d{1,4}$/.test(key)) return false;
  return [device.sn, device.mac, device.marca, device.modelo, device.dispositivo, device.prestadoA, device.ubicacion, device.curso]
    .some(value => normalizeSearchKey(value).includes(key));
}

/**
 * Etiquetas a las que apunta un texto que es un alias o una etiqueta
 * (`touch34`, `34touch`, `plani 5`, `planificación 5`, `1436`, `D01436`), con
 * coincidencia exacta. Para el Historial: el server busca con LIKE y no sabe
 * que "touch34" es "Touch 34". Vacío si el texto no es un alias ni una etiqueta.
 */
export function resolveAliasTags(devices: Device[], query: string): string[] {
  const raw = clean(query);
  if (!raw) return [];
  const alias = parseOperationalAlias(raw);
  const label = normalizeDeviceLabel(parseScannedCode(raw));
  const isLabel = /^D\d{4,}$/.test(label) && /^\s*d?\s*0*\d{1,5}\s*$/i.test(raw.replace(/^TA\|/i, '').split('|')[0]);
  if (!alias && !isLabel) return [];
  return resolveDeviceMatches(devices, raw).map(device => String(device.etiqueta || '').toUpperCase()).filter(Boolean).slice(0, 40);
}

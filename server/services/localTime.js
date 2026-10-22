// Fechas "de calendario" en la hora de la sede. Los timestamps se guardan en ISO
// UTC (nowIso), pero "hoy", "el día 12" o "las 22 h" son en hora argentina:
// cortar el ISO con slice(0, 10) hace que lo que pasa después de las 21 h caiga
// en el día siguiente.
export const SITE_TZ = 'America/Argentina/Buenos_Aires';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SITE_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short'
});

function intlParts(date) {
  const map = {};
  for (const part of partsFormatter.formatToParts(date)) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAYS.indexOf(map.weekday)
  };
}

// Intl es caro para recorrer miles de eventos (analítica): el offset de la sede
// se calcula una vez por hora UTC y el resto es aritmética.
const offsetByHour = new Map();
function offsetAt(time) {
  const hourKey = Math.floor(time / 3600000);
  let offset = offsetByHour.get(hourKey);
  if (offset == null) {
    offset = offsetMs(hourKey * 3600000);
    if (offsetByHour.size > 20000) offsetByHour.clear();
    offsetByHour.set(hourKey, offset);
  }
  return offset;
}

/** { year, month, day, hour, minute, second, weekday (0 = domingo) } en hora de la sede. */
export function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  const shifted = new Date(time + offsetAt(time));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay()
  };
}

/** YYYY-MM-DD en hora de la sede ('' si la fecha es inválida). */
export function toLocalDate(value) {
  const parts = localParts(value);
  if (!parts) return '';
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * "22/10/2026 14:18" en hora de la sede (24 h). Para mails y textos que lee una
 * persona: `toLocaleString('es-AR')` en el server usa el huso de la máquina
 * (UTC en la VM) y 12 h sin a. m./p. m. ("02:18:13" a las 14:18).
 */
export function formatLocalDateTime(value) {
  const parts = localParts(value);
  if (!parts) return '';
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Hoy (YYYY-MM-DD) en hora de la sede. */
export function todayLocal() {
  return toLocalDate(new Date());
}

/** Suma días a un YYYY-MM-DD (aritmética de calendario, sin husos). */
export function addDaysToLocalDate(day, days) {
  if (!DAY_RE.test(String(day || ''))) return '';
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Instante ISO UTC en que empieza (00:00 en hora de la sede) el día YYYY-MM-DD.
 * Sirve para filtrar columnas ISO UTC por día local con comparación de strings.
 */
export function localDayStartIso(day) {
  if (!DAY_RE.test(String(day || ''))) return '';
  const guess = Date.parse(`${day}T00:00:00Z`);
  // Offset de la sede en ese momento (Argentina hoy es -3 fijo, pero no se asume).
  let instant = guess - offsetMs(guess);
  // Si justo hay un cambio de horario, el offset del instante corregido manda.
  instant = guess - offsetMs(instant);
  return new Date(instant).toISOString();
}

/** [inicio, fin) en ISO UTC del día local YYYY-MM-DD. */
export function localDayRangeIso(day) {
  const start = localDayStartIso(day);
  if (!start) return null;
  return { start, end: localDayStartIso(addDaysToLocalDate(day, 1)) };
}

function offsetMs(instant) {
  const parts = intlParts(new Date(instant));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeText(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Formateadores de fecha cacheados. `date.toLocaleString(locale, opts)` arma un
// Intl.DateTimeFormat nuevo en CADA llamada, y eso es caro: en el perfil del
// arranque y de Préstamos el formateo de fechas de las listas era de lo que más
// CPU consumía. Mismo resultado, un formateador por combinación de opciones.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

// La app usa 24 h en todos lados ("14:15", nunca "2:15 p. m."): es-AR con
// `timeStyle` u `hour` sale en 12 h en Chrome. Si quien llama no eligió
// (`hour12`/`hourCycle`), se fuerza h23 (QA de lanzamiento, NN-37).
function with24h(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  if (options.hour12 !== undefined || options.hourCycle !== undefined) return options;
  return options.hour !== undefined || options.timeStyle !== undefined ? { ...options, hourCycle: 'h23' } : options;
}

export function dateFormatter(options: Intl.DateTimeFormatOptions = {}, locale = 'es-AR') {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, with24h(options));
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** Equivalentes de toLocaleString / toLocaleDateString / toLocaleTimeString sin opciones. */
export const DATE_TIME: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
export const DATE_ONLY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
export const TIME_HM: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
export const SHORT_DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };

/**
 * Formatea una fecha (string ISO, número o Date) con un formateador cacheado.
 * Si no es una fecha válida devuelve `invalid` (por defecto, el valor tal cual).
 */
export function formatDate(value: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions = DATE_TIME, invalid?: string): string {
  if (value === null || value === undefined || value === '') return invalid ?? '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return invalid ?? String(value);
  return dateFormatter(options).format(date);
}

const LOAN_DATE_TIME: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };

export function formatLoanDateTime(value?: string): string {
  return formatDate(value, LOAN_DATE_TIME);
}

export function formatTime(value?: string): string {
  if (!value) return '';
  if (/^\d{1,2}:\d{2}/.test(value)) return value;
  return formatDate(value, TIME_HM);
}

const TIME_HM_24: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

export function formatTimeOnly(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return dateFormatter(TIME_HM_24).format(date);
  const directTime = String(value).match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?(?:\s|$)/);
  return directTime ? `${directTime[1].padStart(2, '0')}:${directTime[2]}` : value;
}

const LOAN_TZ = 'America/Argentina/Buenos_Aires';
export const APP_TIME_ZONE = LOAN_TZ;
const DAY_KEY_FORMAT: Intl.DateTimeFormatOptions = { timeZone: LOAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' };
const HOUR_MINUTE_AR: Intl.DateTimeFormatOptions = { timeZone: LOAN_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

// Día calendario (YYYY-MM-DD) en horario de Argentina.
function localDayKey(date: Date): string {
  return dateFormatter(DAY_KEY_FORMAT, 'en-CA').format(date);
}

/**
 * Día calendario (YYYY-MM-DD) en hora argentina de una fecha/instante.
 * El server guarda los timestamps en UTC (`toISOString`): después de las 21 h
 * de Argentina la fecha UTC ya es la del día siguiente, así que nunca hay que
 * comparar `createdAt.slice(0, 10)` contra "hoy". Devuelve '' si no es válida.
 */
export function dayKeyAr(value: string | number | Date = new Date()): string {
  // Una fecha pura (sin hora) ya es un día calendario: no se convierte de zona.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  if (value === '' || value === null || value === undefined) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return localDayKey(date);
}

/** "Hoy" (YYYY-MM-DD) en hora argentina, sin importar la zona del navegador. */
export function todayKeyAr(): string {
  return localDayKey(new Date());
}

/** Día de la semana (0 = domingo … 6 = sábado) de un YYYY-MM-DD, sin zona horaria. */
export function weekdayOfKey(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** Día de la semana de hoy (0 = domingo) en hora argentina. */
export function todayWeekdayAr(): number {
  return weekdayOfKey(todayKeyAr());
}

/** Suma días a un YYYY-MM-DD (aritmética de calendario pura, sin zona horaria). */
export function addDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Minutos desde la medianoche, ahora, en hora argentina. */
export function nowMinutesAr(): number {
  const [hour, minute] = dateFormatter(HOUR_MINUTE_AR, 'en-GB').format(new Date()).split(':').map(Number);
  return (hour % 24) * 60 + (minute || 0);
}

// "Hoy" se calcula una vez por minuto, no una vez por fila.
let todayCache = { at: 0, key: 0 };
function todayStart(): number {
  const now = Date.now();
  if (now - todayCache.at > 60000) todayCache = { at: now, key: Date.parse(`${localDayKey(new Date(now))}T00:00:00Z`) };
  return todayCache.key;
}

// Diferencia en días de CALENDARIO, no en ventanas de 24 horas: un préstamo
// de ayer 20:00 visto hoy 09:00 son 13 horas, pero es "1 día", no "Hoy".
export function loanAgeDays(value?: string): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const loanDay = Date.parse(`${localDayKey(date)}T00:00:00Z`);
  const today = todayStart();
  return Math.max(0, Math.round((today - loanDay) / 86400000));
}

export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

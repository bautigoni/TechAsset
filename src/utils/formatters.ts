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

export function dateFormatter(options: Intl.DateTimeFormatOptions = {}, locale = 'es-AR') {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** Equivalentes de toLocaleString / toLocaleDateString / toLocaleTimeString sin opciones. */
export const DATE_TIME: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
export const DATE_ONLY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
export const TIME_HM: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

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

export function formatDateTime(value?: string): string {
  return formatDate(value, DATE_TIME);
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
const DAY_KEY_FORMAT: Intl.DateTimeFormatOptions = { timeZone: LOAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' };

// Día calendario (YYYY-MM-DD) en horario de Argentina.
function localDayKey(date: Date): string {
  return dateFormatter(DAY_KEY_FORMAT, 'en-CA').format(date);
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

export function loanAgeLabel(value?: string): string {
  const days = loanAgeDays(value);
  if (!value) return '';
  if (days <= 0) return 'Hoy';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

export function loanAgeTone(value?: string): 'fresh' | 'warning' | 'danger' {
  const days = loanAgeDays(value);
  if (days >= 2) return 'danger';
  if (days >= 1) return 'warning';
  return 'fresh';
}

export function todayNameEs(date = new Date()): string {
  const map = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return map[date.getDay()];
}

export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

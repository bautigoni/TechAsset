/**
 * Fechas sin sorpresas: todo es 'YYYY-MM-DD' y 'HH:mm' en hora local.
 * Nunca `new Date('2026-10-19')` (parsea en UTC y en Argentina da el día
 * anterior) ni el parser de texto libre del navegador (Safari devuelve
 * Invalid Date). Lo tipeado pasa por una máscara propia DD/MM/AAAA.
 */

export const DAYS_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const DAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n: number) => String(n).padStart(2, '0');

export function fromIso(iso: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // Rechaza 31/02 y similares (Date los "corre" al mes siguiente).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function toIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIso(offsetDays = 0) {
  const now = new Date();
  return toIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays));
}

export function addDays(iso: string, days: number) {
  const date = fromIso(iso);
  if (!date) return iso;
  return toIso(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

export function addMonths(iso: string, months: number) {
  const date = fromIso(iso);
  if (!date) return iso;
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toIso(new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last)));
}

/** 0 = lunes … 6 = domingo. */
export function weekday(iso: string) {
  const date = fromIso(iso);
  return date ? (date.getDay() + 6) % 7 : 0;
}

/** 42 días (6 semanas) empezando el lunes de la semana del día 1. */
export function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => toIso(new Date(year, month, 1 - offset + index)));
}

/** DD/MM/AAAA para mostrar. */
export function displayDate(iso: string) {
  const date = fromIso(iso);
  if (!date) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** "lunes 19 de octubre de 2026" (nombres accesibles de las celdas). */
export function longDate(iso: string) {
  const date = fromIso(iso);
  if (!date) return '';
  return `${DAYS_LONG[(date.getDay() + 6) % 7]} ${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

/** Máscara: deja solo dígitos y pone las barras solas mientras se tipea. */
export function maskDate(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** DD/MM/AAAA completo → ISO, o null si no es una fecha real. */
export function parseMasked(text: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return fromIso(iso) ? iso : null;
}

export function inRange(iso: string, min?: string, max?: string) {
  return (!min || iso >= min) && (!max || iso <= max);
}

/* ── Horas ──────────────────────────────────────────────────────────────── */

export function parseTime(value: string | null | undefined) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

export function formatTime(h: number, m: number) {
  return `${pad(h)}:${pad(m)}`;
}

export function maskTime(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function toMinutes(value: string) {
  const time = parseTime(value);
  return time ? time.h * 60 + time.m : null;
}

const TZ = 'America/Argentina/Buenos_Aires';

export function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

export function sameCode(a, b) {
  return normalizeCode(a) === normalizeCode(b);
}

export function dayName(date) {
  const name = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: TZ }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function toLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayIso() {
  return toLocalDate(new Date());
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function currentDateTimeText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
}

export function currentDateText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date());
}

export function currentTimeText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, timeStyle: 'short' }).format(new Date());
}

export function parseRelativeDate(text) {
  const lower = normalize(text);
  const base = new Date();
  if (/pasado\s+ma.{0,3}ana/.test(lower)) return dateParts(addDays(base, 2));
  if (/ma.{0,3}ana/.test(lower)) return dateParts(addDays(base, 1));
  if (/\bhoy\b/.test(lower)) return dateParts(base);
  const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const target = weekdays.findIndex(day => lower.includes(day));
  if (target >= 0) {
    const diff = (target - base.getDay() + 7) % 7 || 7;
    return dateParts(addDays(base, diff));
  }
  if (/semana que viene|proxima semana/.test(lower)) return dateParts(addDays(base, 7));
  return { fecha: '', dia: '' };
}

function dateParts(date) {
  return { fecha: toLocalDate(date), dia: dayName(date) };
}

export function extractDay(text) {
  const lower = normalize(text);
  if (/lunes/.test(lower)) return 'Lunes';
  if (/martes/.test(lower)) return 'Martes';
  if (/miercoles/.test(lower)) return 'Miércoles';
  if (/jueves/.test(lower)) return 'Jueves';
  if (/viernes/.test(lower)) return 'Viernes';
  return '';
}

export function safeError(error) {
  return error instanceof Error ? error.message : 'unknown error';
}

export function sanitizeAssistantText(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const parts = clean.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const noisy = part =>
    /^\*\*[^*\n]+\*\*$/.test(part) ||
    /\b(the user|i think|i need|i want|i'll|it's best|it's important|there's no need|it might be nice|i want to make sure|i'm going to|i should|i'll make sure|let me|i can see|i notice)\b/i.test(part);
  const filtered = parts.filter(part => !noisy(part));
  return (filtered.length ? filtered : parts).join('\n\n').trim();
}

export function isConfirmation(lower) {
  return /^(si|sí|dale|ok|confirmo|confirmar|registralo|guardalo|guardar|registrar|lo registro|mandale|adelante)\b/i.test(lower);
}

export function isCancel(lower) {
  return /^(cancelar|cancela|no|anular|dejalo|para|tampoco|cancela eso)\b/i.test(lower);
}

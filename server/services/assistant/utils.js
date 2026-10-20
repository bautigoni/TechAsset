// Fechas locales: util común del server (historial, cierre del día, notas).
import { SITE_TZ as TZ, toLocalDate as localDate, todayLocal } from '../localTime.js';

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

export function dayName(date) {
  const name = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: TZ }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function toLocalDate(date) {
  if (!(date instanceof Date)) return '';
  return localDate(date);
}

export function todayIso() {
  return todayLocal();
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function currentDateTimeText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
}

function dateParts(date) {
  return { fecha: toLocalDate(date), dia: dayName(date) };
}

export function isConfirmation(lower) {
  return /^(si|sí|dale|ok|confirmo|confirmar|registralo|guardalo|guardar|registrar|lo registro|mandale|adelante)\b/i.test(lower);
}


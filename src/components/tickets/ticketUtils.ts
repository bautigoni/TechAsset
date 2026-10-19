import type { Ticket, TicketSource, TicketState } from '../../types';
import type { StatusTextTone } from '../../ui';
import { fold } from '../../ui/util';
import { APP_TIME_ZONE, formatDate, loanAgeDays } from '../../utils/formatters';
import { getActiveSiteCode } from '../../services/activeSite';

export const ESTADOS: TicketState[] = ['No hecho', 'En proceso', 'Hecho'];
export const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente'] as const;
export const ORIGENES: Array<{ key: TicketSource; label: string; helper: string }> = [
  { key: 'tik', label: 'Tiknology', helper: 'Ticket Tik / InVgate' },
  { key: 'handing', label: 'Handing', helper: 'Ticket Handing' }
];
export const DEFAULT_INVGATE = 'https://tikno.sd.cloud.invgate.net/requests/show/index/id/';
export const DEFAULT_HANDING = 'https://techasset.bauhub.online';
export const ORDER: Record<string, number> = { 'No hecho': 0, 'En proceso': 1, Hecho: 2 };

/** El número de InVgate es solo dígitos (se va el '#' y cualquier otra cosa). */
export const normalizeNumero = (value: unknown) => String(value ?? '').replace(/\D+/g, '');
export const normalizeReference = (value: unknown, source: TicketSource) => (source === 'tik' ? normalizeNumero(value) : String(value ?? '').trim());

/** "#2103" para Tiknology; la referencia tal cual (o "Handing") para Handing. */
export function ticketNumber(ticket: Pick<Ticket, 'numero' | 'origen' | 'id'>) {
  if (ticket.origen === 'handing') return String(ticket.numero || '').trim() || 'Handing';
  const digits = normalizeNumero(ticket.numero);
  return digits ? `#${digits}` : `#${ticket.id}`;
}

export const sourceLabel = (source?: TicketSource) => (source === 'handing' ? 'Handing' : 'Tiknology');
export const systemLabel = (source?: TicketSource) => (source === 'handing' ? 'Handing' : 'InVgate');

export function sourceLine(ticket: Pick<Ticket, 'numero' | 'origen'>) {
  return ticket.origen === 'handing'
    ? `Handing${ticket.numero ? ` · ${ticket.numero}` : ''}`
    : `Tiknology / InVgate · #${normalizeNumero(ticket.numero)}`;
}

export type LinkBases = { invgate: string; handing: string };

/** Link al sistema externo: InVgate = base + número; Handing = base con `{ticket}` o la base tal cual. */
export function externalLink(ticket: Pick<Ticket, 'numero' | 'origen'>, bases: LinkBases) {
  if (ticket.origen === 'handing') {
    const base = bases.handing.trim() || DEFAULT_HANDING;
    const ref = String(ticket.numero || '').trim();
    return base.includes('{ticket}') ? base.replace('{ticket}', encodeURIComponent(ref)) : base;
  }
  return `${bases.invgate}${encodeURIComponent(normalizeNumero(ticket.numero))}`;
}

/** Estado como texto coloreado, sin pastilla: lo pendiente pide atención, lo hecho se apaga. */
export function estadoTone(estado: string): StatusTextTone {
  if (estado === 'No hecho') return 'warn';
  if (estado === 'En proceso') return 'info';
  return 'muted';
}

/** Solo Alta y Urgente se marcan; Media y Baja son el estado normal. */
export function prioridadTone(prioridad: string): StatusTextTone | null {
  if (prioridad === 'Urgente') return 'bad';
  if (prioridad === 'Alta') return 'warn';
  return null;
}

/** Antigüedad en días de calendario (hora argentina) y su tono si sigue abierto. */
export function ticketAge(ticket: Pick<Ticket, 'createdAt' | 'estado'>) {
  const days = loanAgeDays(ticket.createdAt);
  const label = !ticket.createdAt ? '' : days <= 0 ? 'hoy' : days === 1 ? '1 día' : `${days} días`;
  let tone: StatusTextTone = 'muted';
  if (ticket.estado !== 'Hecho') tone = days >= 7 ? 'bad' : days >= 3 ? 'warn' : 'normal';
  return { days, label, tone };
}

const SHORT: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const DAY_ONLY: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' };
export const shortDateTime = (value?: string) => formatDate(value, SHORT, '');
export const dayOnly = (value?: string) => formatDate(value, DAY_ONLY, '');

/** Búsqueda sin tildes por número, título, descripción, categoría, quién lo cargó y responsables. */
export function ticketHaystack(ticket: Ticket) {
  return fold([
    ticket.numero, normalizeNumero(ticket.numero), ticket.titulo, ticket.descripcion, ticket.categoria, ticket.creadoPor,
    (ticket.responsables || []).join(' '), (ticket.tags || []).join(' '), ticket.classroom, ticket.school
  ].join(' '));
}

export const isPdf = (url?: string) => /\.pdf($|\?)/i.test(String(url || ''));
export const fileNameOf = (url?: string) => decodeURIComponent(String(url || '').split('/').pop() || '').replace(/^\d+-[0-9a-f]{8}-/, '') || 'archivo';

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

export const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);

/* ── Rutas propias: /sede/<sede>/tickets[/<id>[/editar] | /nuevo | /plantillas] ── */

export type TicketRoute =
  | { kind: 'list' }
  | { kind: 'detail'; id: number }
  | { kind: 'edit'; id: number }
  | { kind: 'new' }
  | { kind: 'templates' };

export function readTicketRoute(pathname = window.location.pathname): TicketRoute {
  const rest = pathname.match(/^\/sede\/[^/]+\/tickets\/?(.*)$/i)?.[1] || '';
  const parts = rest.split('/').filter(Boolean);
  if (!parts.length) return { kind: 'list' };
  if (parts[0] === 'nuevo') return { kind: 'new' };
  if (parts[0] === 'plantillas') return { kind: 'templates' };
  const id = Number(parts[0]);
  if (!Number.isInteger(id) || id <= 0) return { kind: 'list' };
  return parts[1] === 'editar' ? { kind: 'edit', id } : { kind: 'detail', id };
}

export function ticketRoutePath(route: TicketRoute, site = getActiveSiteCode()) {
  const base = `/sede/${String(site || '').toLowerCase()}/tickets`;
  switch (route.kind) {
    case 'detail': return `${base}/${route.id}`;
    case 'edit': return `${base}/${route.id}/editar`;
    case 'new': return `${base}/nuevo`;
    case 'templates': return `${base}/plantillas`;
    default: return base;
  }
}

import type { KnowledgeArticle } from '../../types';
import { APP_TIME_ZONE, formatDate } from '../../utils/formatters';

export type KbAttachment = KnowledgeArticle['attachments'][number];

/**
 * Rutas propias de la pantalla, debajo de /sede/<sede>/knowledge:
 *   (nada)        → lista (en ancho, el lector muestra el primero sin tocar la URL)
 *   /<id>         → lector del artículo
 *   /<id>/editar  → editor del artículo
 *   /nuevo        → editor vacío
 */
export type KbRoute = { kind: 'list' } | { kind: 'read'; id: number } | { kind: 'edit'; id: number } | { kind: 'new' };

export function readRoute(pathname = window.location.pathname): KbRoute {
  const match = pathname.match(/\/knowledge(?:\/([^/]+))?(?:\/([^/]+))?\/?$/i);
  const first = match?.[1]?.toLowerCase();
  const second = match?.[2]?.toLowerCase();
  if (first === 'nuevo') return { kind: 'new' };
  const id = Number(first);
  if (first && Number.isInteger(id) && id > 0) return second === 'editar' ? { kind: 'edit', id } : { kind: 'read', id };
  return { kind: 'list' };
}

export function routeUrl(route: KbRoute, pathname = window.location.pathname) {
  const base = pathname.match(/^(.*?\/knowledge)(?:\/|$)/i)?.[1] || pathname.replace(/\/+$/, '');
  if (route.kind === 'new') return `${base}/nuevo`;
  if (route.kind === 'read') return `${base}/${route.id}`;
  if (route.kind === 'edit') return `${base}/${route.id}/editar`;
  return base;
}

export const sameRoute = (a: KbRoute, b: KbRoute) => a.kind === b.kind && ('id' in a ? a.id : 0) === ('id' in b ? b.id : 0);
export const isEditing = (route: KbRoute) => route.kind === 'edit' || route.kind === 'new';

/* ── Borrador sin guardar (sobrevive a cambiar de pantalla o recargar) ───── */

export type KbDraft = {
  id: number | null;
  title: string;
  category: string;
  tags: string[];
  attachments: KbAttachment[];
  html: string;
  savedAt: number;
};

const draftKey = (site: string) => `techasset:kb-draft:${site}`;

export function readDraft(site: string): KbDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(site)) || localStorage.getItem(draftKey(site));
    if (!raw) return null;
    const value = JSON.parse(raw) as KbDraft;
    return value && typeof value === 'object' && typeof value.html === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function writeDraft(site: string, draft: KbDraft) {
  try {
    localStorage.setItem(draftKey(site), JSON.stringify(draft));
  } catch {
    /* sin storage (modo privado lleno): el aviso de cambios sin guardar sigue */
  }
}

export function clearDraft(site: string) {
  try {
    localStorage.removeItem(draftKey(site));
    sessionStorage.removeItem(draftKey(site));
  } catch {
    /* sin storage */
  }
}

export function draftFromArticle(article: KnowledgeArticle | null): KbDraft {
  return {
    id: article?.id ?? null,
    title: article?.title || '',
    category: article ? categoryOf(article) : 'General',
    tags: [...(article?.tags || [])],
    attachments: [...(article?.attachments || [])],
    html: article?.content || '',
    savedAt: Date.now()
  };
}

/* ── Formato ─────────────────────────────────────────────────────────────── */

export const categoryOf = (article: Pick<KnowledgeArticle, 'category'>) => (article.category || '').trim() || 'General';

const DATE_AR: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: APP_TIME_ZONE };
export const articleDate = (value?: string) => formatDate(value, DATE_AR, '—');

export function excerpt(text: string, max = 200) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export function fileKind(name: string, mimeType?: string) {
  const ext = String(name || '').split('.').pop()?.toUpperCase() || '';
  if (ext && ext.length <= 5 && ext !== String(name).toUpperCase()) return ext;
  return (mimeType || '').split('/').pop()?.toUpperCase() || 'Archivo';
}

export function guessMime(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    ({
      pdf: 'application/pdf',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    } as Record<string, string>)[ext || ''] || 'application/octet-stream'
  );
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

export const errorText = (reason: unknown, fallback = 'Error de conexión.') => (reason instanceof Error && reason.message ? reason.message : fallback);

/** "hace 5 min", "hace 2 h", o la fecha. */
export function ago(ms: number) {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return formatDate(ms, DATE_AR);
}

import { ApiError, apiGet, apiSend, clearApiCache, siteHeaders } from './apiClient';

export type RequestStatus = 'draft' | 'pending' | 'in_progress' | 'done' | 'discarded';
export type RequestKind = 'fix' | 'change' | 'new';

export interface RequestSummary {
  kind: RequestKind;
  title: string;
  screen: string;
  today: string;
  desired: string;
  details: string[];
}

export interface RequestMessage {
  role: 'user' | 'assistant';
  text: string;
  imageIds: string[];
  at: string;
}

export interface RequestImage { id: string; name: string; mime: string }

/** Lo que trae la lista: sin la conversación, que pesa y la lista no usa. */
export interface RequestListItem {
  id: string;
  status: RequestStatus;
  title: string;
  summary: RequestSummary;
  ready: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  resolvedAt: string;
  /** Es de la cuenta que mira. Lo ajeno se lee pero no se escribe. */
  mine: boolean;
  requester: { nombre: string };
}

export interface ChangeRequest extends RequestListItem {
  userMessages: number;
  awaitingReply: boolean;
  messages?: RequestMessage[];
  images?: RequestImage[];
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: 'Borrador',
  pending: 'Enviado',
  in_progress: 'En curso',
  done: 'Hecho',
  discarded: 'Descartado'
};

export const KIND_LABEL: Record<RequestKind, string> = {
  fix: 'Algo no funciona',
  change: 'Cambiar algo que ya existe',
  new: 'Algo nuevo'
};

export const REQUEST_LIMITS = { textChars: 4000, imagesPerMessage: 3, imagesPerRequest: 6, imageBytes: 5 * 1024 * 1024 };

type ItemResponse = { ok: true; item: ChangeRequest };

export async function listRequests() {
  const data = await apiGet<{ ok: true; items: RequestListItem[]; truncated: boolean }>('/api/requests');
  return { items: data.items, truncated: data.truncated };
}

export async function openDraft() {
  return (await apiSend<ItemResponse>('/api/requests', 'POST')).item;
}

export async function getRequest(id: string) {
  // Sin la caché de lecturas: la pantalla del pedido tiene que estar al día.
  clearApiCache();
  return (await apiGet<ItemResponse>(`/api/requests/${encodeURIComponent(id)}`)).item;
}

/** Multipart: texto + capturas. Guarda el mensaje sin esperar a la IA. */
export async function sendMessage(id: string, text: string, files: File[]) {
  const form = new FormData();
  form.append('text', text);
  for (const file of files) form.append('file', file, file.name);
  clearApiCache();
  const response = await fetch(`/api/requests/${encodeURIComponent(id)}/messages`, { method: 'POST', headers: siteHeaders(), body: form });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok || data?.ok === false) throw new ApiError(String(data?.error || `HTTP ${response.status}`), response.status, data || {});
  return (data as ItemResponse).item;
}

export async function askReply(id: string) {
  return (await apiSend<ItemResponse>(`/api/requests/${encodeURIComponent(id)}/reply`, 'POST')).item;
}

export async function submitRequest(id: string) {
  return (await apiSend<ItemResponse>(`/api/requests/${encodeURIComponent(id)}/submit`, 'POST')).item;
}

export async function withdrawRequest(id: string) {
  return (await apiSend<ItemResponse>(`/api/requests/${encodeURIComponent(id)}/withdraw`, 'POST')).item;
}

export async function deleteRequest(id: string) {
  await apiSend<{ ok: true }>(`/api/requests/${encodeURIComponent(id)}`, 'DELETE');
}

export function imageUrl(requestId: string, imageId: string) {
  return `/api/requests/${encodeURIComponent(requestId)}/images/${encodeURIComponent(imageId)}`;
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIDE = 2000;

/**
 * Deja la captura lista para subir: las chicas pasan tal cual; las grandes se
 * achican (lado mayor 2000 px) y se pasan a JPEG hasta entrar en el límite.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!ALLOWED.has(file.type)) throw new Error(`"${file.name}" no es una imagen JPG, PNG o WEBP.`);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`No se pudo leer "${file.name}".`);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no pudo procesar la imagen.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= REQUEST_LIMITS.imageBytes) {
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    }
  }
  throw new Error(`"${file.name}" es demasiado pesada, incluso achicada.`);
}

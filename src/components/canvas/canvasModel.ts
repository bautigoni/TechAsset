import type { CanvasItem, CanvasItemType } from '../../types';

export type View = { x: number; y: number; zoom: number };

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.2;
export const ZOOM_STEP = 0.15;
export const HOME: View = { x: 140, y: 100, zoom: 1 };
export const SAVE_DELAY = 450;
export const MIN_W = 140;
export const MAX_W = 900;
export const MIN_H = 100;
export const MAX_H = 800;

/** Colores de nota que ya guarda la base (el lienzo los mezcla con la superficie del tema). */
export const NOTE_COLORS = ['#fef08a', '#bfdbfe', '#bbf7d0', '#fecdd3', '#ddd6fe'];

export const TYPE_LABEL: Record<CanvasItemType, string> = {
  sticky: 'nota', text: 'texto', checklist: 'checklist', image: 'imagen', file: 'archivo', link: 'enlace', 'task-group': 'grupo de tareas'
};

export const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function sizeFor(type: CanvasItemType) {
  if (type === 'task-group') return { width: 380, height: 260 };
  if (type === 'image') return { width: 360, height: 260 };
  if (type === 'file') return { width: 280, height: 140 };
  return { width: 260, height: 180 };
}

/** Zoom alrededor de un punto de la pantalla (relativo al lienzo). */
export function zoomAround(view: View, nextZoom: number, px: number, py: number): View {
  const zoom = clampZoom(nextZoom);
  const wx = (px - view.x) / view.zoom;
  const wy = (py - view.y) / view.zoom;
  return { zoom, x: Math.round(px - wx * zoom), y: Math.round(py - wy * zoom) };
}

/** Vista que muestra todos los nodos con un margen. */
export function fitView(items: CanvasItem[], width: number, height: number, cap = 1.5): View {
  if (!items.length || width < 10 || height < 10) return HOME;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const item of items) {
    x0 = Math.min(x0, item.x);
    y0 = Math.min(y0, item.y);
    x1 = Math.max(x1, item.x + item.width);
    y1 = Math.max(y1, item.y + item.height);
  }
  const pad = 48;
  const zoom = clampZoom(Math.min((width - pad) / Math.max(1, x1 - x0), (height - pad) / Math.max(1, y1 - y0), cap));
  return { zoom, x: Math.round((width - (x1 - x0) * zoom) / 2 - x0 * zoom), y: Math.round((height - (y1 - y0) * zoom) / 2 - y0 * zoom) };
}

/**
 * Vista al abrir: todo encuadrado (sin pasar de 100 %); si para que entre todo
 * hay que alejar por debajo de 60 % (celular), queda en 60 % mostrando desde la
 * esquina de arriba a la izquierda del contenido, que se lee.
 */
export function initialView(items: CanvasItem[], width: number, height: number): View {
  const fitted = fitView(items, width, height, 1);
  if (!items.length || fitted.zoom >= 0.6) return fitted;
  const x0 = Math.min(...items.map(item => item.x));
  const y0 = Math.min(...items.map(item => item.y));
  const zoom = 0.6;
  return { zoom, x: Math.round(16 - x0 * zoom), y: Math.round(16 - y0 * zoom) };
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: CanvasItem, gap: number) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/**
 * Lugar para un nodo nuevo: el centro de lo que estás viendo si está libre; si
 * no, el hueco libre más cercano (en anillos alrededor del centro). Así lo nuevo
 * cae a la vista y no tapa lo que ya había.
 */
export function freeSpot(view: View, boardW: number, boardH: number, width: number, height: number, items: CanvasItem[]) {
  const cx = (boardW / 2 - view.x) / view.zoom - width / 2;
  const cy = (boardH / 2 - view.y) / view.zoom - height / 2;
  const fits = (x: number, y: number) => !items.some(item => overlaps({ x, y, width, height }, item, 16));
  if (fits(cx, cy)) return { x: Math.round(cx), y: Math.round(cy) };
  const step = 40;
  for (let ring = 1; ring <= 30; ring += 1) {
    for (let i = -ring; i <= ring; i += 1) {
      const candidates = [
        [cx + i * step, cy - ring * step], [cx + i * step, cy + ring * step],
        [cx - ring * step, cy + i * step], [cx + ring * step, cy + i * step]
      ];
      for (const [x, y] of candidates) if (fits(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  const k = items.length % 4;
  return { x: Math.round(cx + k * 16), y: Math.round(cy + k * 16) };
}

export const safeLink = (url: string) => (/^https?:\/\/[^\s]+\.[^\s]+/i.test(url) ? url : '');

export function fileSize(bytes: unknown) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} kB`;
  return `${(value / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
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

export type Step = { text: string; checked: boolean };
export const stepsOf = (content: Record<string, unknown>): Step[] =>
  (Array.isArray(content.items) ? content.items : []).map(raw => {
    const value = (raw || {}) as { text?: unknown; checked?: unknown };
    return { text: String(value.text ?? ''), checked: Boolean(value.checked) };
  });

const viewKey = (site: string) => `techasset:canvas-view:${site}`;
export function readSavedView(site: string): View | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(viewKey(site)) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && Number.isFinite(raw.zoom)) return { x: raw.x, y: raw.y, zoom: clampZoom(raw.zoom) };
  } catch { /* sin storage */ }
  return null;
}
export function saveView(site: string, view: View) {
  try { sessionStorage.setItem(viewKey(site), JSON.stringify(view)); } catch { /* sin storage */ }
}

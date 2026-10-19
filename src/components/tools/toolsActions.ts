import { clearApiCache, siteHeaders } from '../../services/apiClient';

type GlifingPreview = { ok: boolean; total: number; preview: Record<string, string>[]; error?: string; missing?: string[] };
type GlifingGenerate = { ok: boolean; jobId?: string; total?: number; downloadUrl?: string; expiresAt?: string; error?: string };
type C365Preview = { ok: boolean; total?: number; validos?: number; invalidos?: number; modoPrueba?: boolean; preview?: Record<string, string>[]; invalidPreview?: Record<string, string>[]; error?: string; missing?: string[] };
type C365Send = { ok: boolean; modoPrueba?: boolean; stats?: { total: number; ok: number; prueba: number; errores: number }; jobId?: string; reportUrl?: string; expiresAt?: string; sample?: Record<string, string>[]; requireConfirm?: boolean; error?: string };

// Estas rutas devuelven { ok:false, error } y la UI lo muestra tal cual, así que
// no pasan por apiSend (que tira excepción), pero sí llevan la sede activa: sin
// el header, el server usaba la sede por defecto del usuario. Un 403/500 sin
// JSON se convierte en { ok:false, error } legible; sin red, tira.
const post = async <T extends { ok: boolean; error?: string }>(url: string, body: Record<string, unknown>): Promise<T> => {
  clearApiCache();
  const res = await fetch(url, { method: 'POST', headers: siteHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  try {
    return await res.json() as T;
  } catch {
    return { ok: false, error: res.status === 403 ? 'Tu rol no tiene permiso para usar esta herramienta.' : `El servidor respondió ${res.status}.` } as T;
  }
};

/** Plantillas: links de descarga (el server responde como adjunto); van en un <a>, no en window.open. */
export const TEMPLATE_URLS = {
  glifing: '/api/tools/glifing/template',
  santillana: '/api/tools/santillana/template',
  credentials365: '/api/tools/credentials365/template'
} as const;

export const uploadGlifingCsv = (csv: string) => post<GlifingPreview>('/api/tools/glifing/upload', { csv });
export const generateGlifing = (csv: string, tipo: 'glifing' | 'santillana' = 'glifing') => post<GlifingGenerate>('/api/tools/glifing/generate', { csv, tipo });

export const uploadC365Csv = (csv: string) => post<C365Preview>('/api/tools/credentials365/upload', { csv });
export const previewC365 = (csv: string) => post<C365Preview>('/api/tools/credentials365/preview', { csv });
export const sendC365 = (csv: string, confirm: boolean) => post<C365Send>('/api/tools/credentials365/send', { csv, confirm });

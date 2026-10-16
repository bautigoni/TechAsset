import { apiGet, clearApiCache, siteHeaders } from './apiClient';

type GlifingPreview = { ok: boolean; total: number; preview: Record<string, string>[]; error?: string };
type GlifingGenerate = { ok: boolean; jobId?: string; total?: number; downloadUrl?: string; error?: string };
type C365Preview = { ok: boolean; total?: number; validos?: number; invalidos?: number; modoPrueba?: boolean; preview?: Record<string, string>[]; invalidPreview?: Record<string, string>[]; error?: string };
type C365Send = { ok: boolean; modoPrueba?: boolean; stats?: { total: number; ok: number; prueba: number; errores: number }; jobId?: string; reportUrl?: string; sample?: Record<string, string>[]; requireConfirm?: boolean; error?: string };
type ToolsConfig = { ok: boolean; handingTicketUrl: string; modoPrueba: boolean; smtpConfigurado: boolean; resendConfigurado?: boolean; mailConfigurado?: boolean };

export type MailSettingsState = {
  smtpServer: string;
  smtpPort: number;
  smtpUser: string;
  smtpAppPasswordMasked: string;
  smtpAppPasswordSet: boolean;
  mailFrom: string;
  mailSubject: string;
  modoPrueba: boolean;
  microsoftLoginUrl: string;
};
type MailSettingsResponse = { ok: boolean; settings: MailSettingsState };

// Estas rutas devuelven { ok:false, error } y la UI lo muestra tal cual, así que
// no pasan por apiSend (que tira excepción), pero sí llevan la sede activa: sin
// el header, el server usaba la sede por defecto del usuario.
const post = async <T>(url: string, body: Record<string, unknown>): Promise<T> => {
  clearApiCache();
  const res = await fetch(url, { method: 'POST', headers: siteHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  return res.json();
};

export const fetchToolsConfig = (): Promise<ToolsConfig> => apiGet<ToolsConfig>('/api/tools/config');

export const downloadGlifingTemplate = () => window.open('/api/tools/glifing/template', '_blank');
export const downloadSantillanaTemplate = () => window.open('/api/tools/santillana/template', '_blank');
export const downloadC365Template = () => window.open('/api/tools/credentials365/template', '_blank');

export const uploadGlifingCsv = (csv: string) => post<GlifingPreview>('/api/tools/glifing/upload', { csv });
export const generateGlifing = (csv: string, tipo: 'glifing' | 'santillana' = 'glifing') => post<GlifingGenerate>('/api/tools/glifing/generate', { csv, tipo });

export const uploadC365Csv = (csv: string) => post<C365Preview>('/api/tools/credentials365/upload', { csv });
export const previewC365 = (csv: string) => post<C365Preview>('/api/tools/credentials365/preview', { csv });
export const sendC365 = (csv: string, confirm: boolean) => post<C365Send>('/api/tools/credentials365/send', { csv, confirm });

export const fetchMailSettings = (): Promise<MailSettingsResponse> => fetch('/api/settings/mail', { headers: siteHeaders() }).then(r => r.json());
export const updateMailSettings = (body: Record<string, unknown>): Promise<MailSettingsResponse> => fetch('/api/settings/mail', {
  method: 'PATCH',
  headers: siteHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify(body)
}).then(r => r.json());

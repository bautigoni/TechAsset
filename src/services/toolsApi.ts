type GlifingPreview = { ok: boolean; total: number; preview: Record<string, string>[]; error?: string };
type GlifingGenerate = { ok: boolean; jobId?: string; total?: number; downloadUrl?: string; error?: string };
type C365Preview = { ok: boolean; total?: number; validos?: number; invalidos?: number; modoPrueba?: boolean; preview?: Record<string, string>[]; invalidPreview?: Record<string, string>[]; error?: string };
type C365Send = { ok: boolean; modoPrueba?: boolean; stats?: { total: number; ok: number; prueba: number; errores: number }; jobId?: string; reportUrl?: string; sample?: Record<string, string>[]; requireConfirm?: boolean; error?: string };
type ToolsConfig = { ok: boolean; handingTicketUrl: string; modoPrueba: boolean; smtpConfigurado: boolean };

const post = async <T>(url: string, body: Record<string, unknown>): Promise<T> => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
};

export const fetchToolsConfig = (): Promise<ToolsConfig> => fetch('/api/tools/config').then(r => r.json());

export const downloadGlifingTemplate = () => window.open('/api/tools/glifing/template', '_blank');
export const downloadC365Template = () => window.open('/api/tools/credentials365/template', '_blank');

export const uploadGlifingCsv = (csv: string) => post<GlifingPreview>('/api/tools/glifing/upload', { csv });
export const generateGlifing = (csv: string) => post<GlifingGenerate>('/api/tools/glifing/generate', { csv });

export const uploadC365Csv = (csv: string) => post<C365Preview>('/api/tools/credentials365/upload', { csv });
export const previewC365 = (csv: string) => post<C365Preview>('/api/tools/credentials365/preview', { csv });
export const sendC365 = (csv: string, confirm: boolean) => post<C365Send>('/api/tools/credentials365/send', { csv, confirm });

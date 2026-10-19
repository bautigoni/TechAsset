import { apiGet, siteHeaders } from './apiClient';

// Este módulo lo importa la entrada (rayo de accesos, MailStatusChip, Tickets):
// acá queda solo lo liviano. Las acciones de Herramientas (CSV, tarjetas,
// credenciales) viven en components/tools/toolsActions.ts, en el chunk de la pantalla.

export type ToolsConfig = { ok: boolean; handingTicketUrl: string; modoPrueba: boolean; smtpConfigurado: boolean; resendConfigurado?: boolean; mailConfigurado?: boolean };

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

export const fetchToolsConfig = (): Promise<ToolsConfig> => apiGet<ToolsConfig>('/api/tools/config');

export const fetchMailSettings = (): Promise<MailSettingsResponse> => fetch('/api/settings/mail', { headers: siteHeaders() }).then(r => r.json());
export const updateMailSettings = (body: Record<string, unknown>): Promise<MailSettingsResponse> => fetch('/api/settings/mail', {
  method: 'PATCH',
  headers: siteHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify(body)
}).then(r => r.json());

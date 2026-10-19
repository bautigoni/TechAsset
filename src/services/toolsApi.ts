import { apiGet } from './apiClient';

// Este módulo lo importa la entrada (rayo de accesos, MailStatusChip, Tickets):
// acá queda solo lo liviano. Las acciones de Herramientas (CSV, tarjetas,
// credenciales) viven en components/tools/toolsActions.ts, en el chunk de la pantalla.

export type ToolsConfig = { ok: boolean; handingTicketUrl: string; modoPrueba: boolean; smtpConfigurado: boolean; resendConfigurado?: boolean; mailConfigurado?: boolean };

export const fetchToolsConfig = (): Promise<ToolsConfig> => apiGet<ToolsConfig>('/api/tools/config');

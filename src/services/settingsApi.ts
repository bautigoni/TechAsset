import { apiGet, apiSend } from './apiClient';
import type { AllowedUserItem } from './authApi';

/* Llamadas propias de Configuración (etapa 8b). Las de sede, invitaciones y
   usuarios siguen en authApi; acá lo nuevo y lo que antes iba por fetch crudo. */

export type UserStatus = 'Pendiente' | 'Activo' | 'Rechazado' | 'Inactivo';
export type ManagedUser = AllowedUserItem & { id: number; status: UserStatus; lastLoginAt?: string };

export const getManagedUsers = () => apiGet<{ ok: true; items: ManagedUser[] }>('/api/allowed-users');

/** Vuelve un usuario al estado anterior a aprobar/rechazar/desactivar/borrar y cancela el mail en espera. */
export const undoUserAction = (id: number, status: UserStatus) =>
  apiSend<{ ok: true; mailCancelled: boolean }>(`/api/allowed-users/${id}/undo`, 'POST', { status });

export type MailSettings = {
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

// Por apiGet/apiSend (y no por fetch crudo): un 403 llega con el motivo real
// del server ("Solo un superadmin puede…") en vez de un genérico.
export const getMailSettings = () => apiGet<{ ok: true; settings: MailSettings }>('/api/settings/mail');
export const saveMailSettings = (body: Partial<MailSettings> & { smtpAppPassword?: string }) =>
  apiSend<{ ok: true; settings: MailSettings }>('/api/settings/mail', 'PATCH', body);

export type MailProviderStatus = { ok: boolean; modoPrueba: boolean; smtpConfigurado: boolean; resendConfigurado?: boolean; mailConfigurado?: boolean };
export const getMailProviderStatus = () => apiGet<MailProviderStatus>('/api/tools/config');

import type { AuthUser, SiteInfo } from '../types';
import { apiGet, apiSend } from './apiClient';

export type AuthSession = {
  ok: true;
  authenticated: boolean;
  user?: AuthUser;
  sites?: SiteInfo[];
  pending?: boolean;
  message?: string;
};

export const getAuthSession = () => apiGet<AuthSession>('/api/auth/session');

export const login = (payload: { email: string; password?: string; nombre?: string; role?: string; turno?: string; siteCode?: string; siteCodes?: string[] }) =>
  apiSend<AuthSession>('/api/auth/login', 'POST', payload);

export const requestPasswordLink = (email: string) =>
  apiSend<{ ok: true; message: string }>('/api/auth/password/request', 'POST', { email });
export const confirmPasswordLink = (token: string, password: string) =>
  apiSend<{ ok: true; email: string; message: string }>('/api/auth/password/confirm', 'POST', { token, password });
/** Crea la cuenta y deja la sesión abierta (responde como /auth/session). */
export const register = (payload: { email: string; nombre: string; code: string; password: string }) =>
  apiSend<AuthSession & { activated?: boolean }>('/api/auth/register', 'POST', payload);

/** Cuenta propia: si tiene contraseña (o entra solo con Google). */
export const getAccountInfo = () =>
  apiGet<{ ok: true; hasPassword: boolean; googleEnabled: boolean }>('/api/auth/account');
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiSend<{ ok: true; message: string; closedSessions: number }>('/api/auth/password/change', 'POST', { currentPassword, newPassword });

/** Para "Privacidad y uso": qué servicios de afuera tiene prendidos este servidor. */
export const getPrivacyInfo = () =>
  apiGet<{ ok: true; ai: string; google: boolean; push: boolean; errorReports: boolean }>('/api/auth/privacy-info');

export interface Invite {
  id: number;
  code: string;
  siteCode: string;
  role: string;
  turno: string;
  kind: 'admin' | 'standard';
  email: string;
  expiresAt: string;
  usedAt: string;
  status: 'Activa' | 'Usada' | 'Vencida' | 'Revocada';
  emailSentAt?: string;
  emailError?: string;
  createdAt: string;
}

export const getInvites = () => apiGet<{ ok: true; items: Invite[] }>('/api/invites');

export const createInvite = (payload: { role: string; turno?: string; kind?: 'admin' | 'standard'; email?: string; expiresInDays?: number; siteCode?: string }) =>
  apiSend<{ ok: true; invite: Invite & { registerUrl: string }; emailSent: boolean }>('/api/invites', 'POST', payload);

export const resendInvite = (id: number) =>
  apiSend<{ ok: true; registerUrl: string; emailSent: boolean; emailError: string }>(`/api/invites/${id}/resend`, 'POST');

export const revokeInvite = (id: number) =>
  apiSend<{ ok: true; revoked: boolean }>(`/api/invites/${id}/revoke`, 'POST');

export const logout = () => apiSend<{ ok: true }>('/api/auth/logout', 'POST');

export const getSiteSettings = () => apiGet<{ ok: true; siteCode: string; settings: Record<string, unknown> }>('/api/site-settings');

export const updateSiteSettings = (settings: Record<string, unknown>) =>
  apiSend<{ ok: true; siteCode: string; settings: Record<string, unknown> }>('/api/site-settings', 'PATCH', { settings });

export const getSites = () => apiGet<{ ok: true; items: SiteInfo[] }>('/api/sites');

export const saveSite = (site: Partial<SiteInfo> & {
  siteCode: string;
  spreadsheetUrl?: string;
  inventorySheetName?: string;
  themeColor?: string;
  logoDataUrl?: string;
  activo?: boolean;
  isNew?: boolean;
}) => {
  const method = site.isNew ? 'POST' as const : 'PATCH' as const;
  const url = method === 'PATCH' ? `/api/sites/${encodeURIComponent(site.siteCode)}` : '/api/sites';
  return apiSend<{ ok: true; item: SiteInfo }>(url, method, site);
};

export type AllowedUserItem = {
  id?: number;
  email: string;
  nombre: string;
  defaultRole: string;
  turno?: string;
  defaultSiteCode?: string;
  canChooseRole?: boolean;
  activo?: boolean;
  status?: 'Pendiente' | 'Activo' | 'Rechazado' | 'Inactivo';
  sites: Array<{ siteCode: string; siteRole?: string; turno?: string; isDefault?: boolean; activo?: boolean }>;
};

export const getSiteAssistants = () => apiGet<{ ok: true; items: Array<{ name: string; email?: string; siteRole?: string; turno?: string }> }>('/api/site-assistants');

export const saveAllowedUser = (user: AllowedUserItem) =>
  apiSend<{ ok: true; item: AllowedUserItem }>(user.id ? `/api/allowed-users/${user.id}` : '/api/allowed-users', user.id ? 'PATCH' : 'POST', user);

export const updateAllowedUserStatus = (id: number, action: 'approve' | 'reject' | 'deactivate' | 'delete') =>
  apiSend<{ ok: true; item: AllowedUserItem }>(`/api/allowed-users/${id}/${action}`, 'POST');

/**
 * Devuelve si el botón "Continuar con Google" debe mostrarse en el login.
 * Si el backend no tiene configurado GOOGLE_CLIENT_ID/SECRET, devuelve enabled=false
 * y el frontend oculta el botón (no lo muestra como "deshabilitado").
 */
export const getGoogleOAuthConfig = () =>
  apiGet<{ ok: true; enabled: boolean }>('/api/auth/google/config');

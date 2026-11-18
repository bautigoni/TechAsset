import type { AuthUser, SiteInfo } from '../types';
import { apiGet, apiSend } from './apiClient';
import { getActiveSiteCode } from './activeSite';

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

export const getRegisterOptions = () =>
  apiGet<{ ok: true; requiresCode: boolean }>('/api/auth/register-options');

export const requestPasswordLink = (email: string) =>
  apiSend<{ ok: true; message: string }>('/api/auth/password/request', 'POST', { email });
export const confirmPasswordLink = (token: string, password: string) =>
  apiSend<{ ok: true; email: string; message: string }>('/api/auth/password/confirm', 'POST', { token, password });
export const register = (payload: { email: string; nombre: string; code: string; password: string }) =>
  apiSend<AuthSession & { activated?: boolean }>('/api/auth/register', 'POST', payload);

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

export const getAllowedUsers = () => apiGet<{ ok: true; items: AllowedUserItem[] }>('/api/allowed-users');

export type SiteAssistant = { name: string; email?: string; siteRole?: string; turno?: string };

// Las personas del equipo cambian muy de vez en cuando, pero el alta de tarea las
// pedía cada vez que se abría y los chips de responsables tardaban en aparecer.
// Se guardan por sede 5 minutos (la caché general de apiGet se vacía con
// cualquier escritura) y se revalidan en segundo plano: el formulario abre ya con ellas.
const ASSISTANTS_TTL_MS = 5 * 60 * 1000;
const assistantsCache = new Map<string, { at: number; items: SiteAssistant[] }>();
const assistantsInflight = new Map<string, Promise<{ ok: true; items: SiteAssistant[] }>>();

/** Lo último que se sabe de las personas del equipo de la sede activa, sin red. */
export function peekSiteAssistants(): SiteAssistant[] | null {
  return assistantsCache.get(getActiveSiteCode())?.items || null;
}

export function getSiteAssistants(): Promise<{ ok: true; items: SiteAssistant[] }> {
  const site = getActiveSiteCode();
  const load = () => {
    const pending = assistantsInflight.get(site);
    if (pending) return pending;
    const request = apiGet<{ ok: true; items: SiteAssistant[] }>('/api/site-assistants')
      .then(response => {
        assistantsCache.set(site, { at: Date.now(), items: response.items || [] });
        return response;
      })
      .finally(() => assistantsInflight.delete(site));
    assistantsInflight.set(site, request);
    return request;
  };
  const cached = assistantsCache.get(site);
  if (cached) {
    if (Date.now() - cached.at > ASSISTANTS_TTL_MS) void load().catch(() => undefined);
    return Promise.resolve({ ok: true as const, items: cached.items });
  }
  return load();
}

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

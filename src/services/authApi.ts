import type { AuthUser, SiteInfo } from '../types';
import { apiGet, apiSend } from './apiClient';

export type AuthSession = {
  ok: true;
  authenticated: boolean;
  user?: AuthUser;
  sites?: SiteInfo[];
};

export const getAuthSession = () => apiGet<AuthSession>('/api/auth/session');

export const login = (payload: { email: string; nombre?: string; role?: string; turno?: string; siteCode?: string; siteCodes?: string[] }) =>
  apiSend<AuthSession>('/api/auth/login', 'POST', payload);

export const logout = () => apiSend<{ ok: true }>('/api/auth/logout', 'POST');

export const getSiteSettings = () => apiGet<{ ok: true; siteCode: string; settings: Record<string, unknown> }>('/api/site-settings');

export const updateSiteSettings = (settings: Record<string, unknown>) =>
  apiSend<{ ok: true; siteCode: string; settings: Record<string, unknown> }>('/api/site-settings', 'PATCH', { settings });

export const getSites = () => apiGet<{ ok: true; items: SiteInfo[] }>('/api/sites');

export const saveSite = (site: Partial<SiteInfo> & {
  siteCode: string;
  spreadsheetUrl?: string;
  appsScriptUrl?: string;
  inventorySheetName?: string;
  themeColor?: string;
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
  sites: Array<{ siteCode: string; siteRole?: string; turno?: string; isDefault?: boolean; activo?: boolean }>;
};

export const getAllowedUsers = () => apiGet<{ ok: true; items: AllowedUserItem[] }>('/api/allowed-users');

export const saveAllowedUser = (user: AllowedUserItem) =>
  apiSend<{ ok: true; item: AllowedUserItem }>(user.id ? `/api/allowed-users/${user.id}` : '/api/allowed-users', user.id ? 'PATCH' : 'POST', user);

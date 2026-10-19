import { apiGet, apiSend } from './apiClient';

export type UserPrefs = {
  /** Perfil viejo (classic-* / smart-*): solo se lee para migrar. */
  themeProfile?: string;
  theme?: 'dark' | 'light' | 'system';
  density?: 'comfortable' | 'compact';
  textSize?: 'normal' | 'large' | 'xlarge';
};

export const getUserPrefs = () => apiGet<{ ok: true; prefs: UserPrefs }>('/api/user/prefs');

export const saveUserPrefs = (prefs: Partial<UserPrefs>) =>
  apiSend<{ ok: true; prefs: UserPrefs }>('/api/user/prefs', 'PATCH', prefs);

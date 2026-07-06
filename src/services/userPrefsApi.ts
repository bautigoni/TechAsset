import { apiGet, apiSend } from './apiClient';

export type UserPrefs = {
  themeProfile?: string;
};

export const getUserPrefs = () => apiGet<{ ok: true; prefs: UserPrefs }>('/api/user/prefs');

export const saveUserPrefs = (prefs: Partial<UserPrefs>) =>
  apiSend<{ ok: true; prefs: UserPrefs }>('/api/user/prefs', 'PATCH', prefs);

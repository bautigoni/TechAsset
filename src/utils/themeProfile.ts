import { saveUserPrefs } from '../services/userPrefsApi';

export type ThemeProfile = 'classic' | 'classic-stairs' | 'classic-centered' | 'classic-peek' | 'smart' | 'smart-stairs' | 'smart-centered' | 'smart-peek';
export type VariantStyle = 'normal' | 'stairs' | 'centered' | 'centered-peek';

export const THEME_PROFILE_KEY = 'techasset_theme_profile';
export const THEME_PROFILE_EVENT = 'techasset:theme-profile';

const ALL_PROFILES: ThemeProfile[] = ['classic', 'classic-stairs', 'classic-centered', 'classic-peek', 'smart', 'smart-stairs', 'smart-centered', 'smart-peek'];
const VARIANT_PROFILES: ThemeProfile[] = ['classic-stairs', 'classic-centered', 'classic-peek', 'smart-stairs', 'smart-centered', 'smart-peek'];

export function readThemeProfile(): ThemeProfile {
  const stored = localStorage.getItem(THEME_PROFILE_KEY) as ThemeProfile | null;
  return stored && ALL_PROFILES.includes(stored) ? stored : 'classic';
}

export function isSmartProfile(profile: ThemeProfile): boolean {
  return profile.startsWith('smart');
}

export function hasVariantNav(profile: ThemeProfile): boolean {
  return VARIANT_PROFILES.includes(profile);
}

export function variantStyle(profile: ThemeProfile): VariantStyle {
  if (profile === 'classic-stairs' || profile === 'smart-stairs') return 'stairs';
  if (profile === 'classic-centered' || profile === 'smart-centered') return 'centered';
  if (profile === 'classic-peek' || profile === 'smart-peek') return 'centered-peek';
  return 'normal';
}

export function profileForThemeAndStyle(isSmart: boolean, style: VariantStyle): ThemeProfile {
  const base = isSmart ? 'smart' : 'classic';
  if (style === 'stairs') return `${base}-stairs` as ThemeProfile;
  if (style === 'centered') return `${base}-centered` as ThemeProfile;
  if (style === 'centered-peek') return `${base}-peek` as ThemeProfile;
  return base as ThemeProfile;
}

export function applyThemeProfile(profile: ThemeProfile) {
  const root = document.documentElement;
  root.dataset.themeProfile = profile;
  const light = isSmartProfile(profile) || localStorage.getItem('techasset_nfpt_theme') === 'light';
  root.classList.toggle('theme-light', light);
}

export function saveThemeProfile(profile: ThemeProfile) {
  localStorage.setItem(THEME_PROFILE_KEY, profile);
  localStorage.removeItem('techasset_nfpt_theme');
  applyThemeProfile(profile);
  window.dispatchEvent(new CustomEvent(THEME_PROFILE_EVENT, { detail: profile }));
  // Fire and forget — si el usuario no está autenticado, el 401 se traga.
  try { saveUserPrefs({ themeProfile: profile }); } catch {}
}

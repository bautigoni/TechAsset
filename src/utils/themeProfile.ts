// Sistema de perfiles de tema (Configuración > Apariencia).
// - "classic": el tema A original (azul oscuro / claro con el toggle de siempre).
// - "smart*": tema B Smart Campus (crema/cálido) con variantes de navegación.
// El perfil se persiste en localStorage y se refleja en <html data-theme-profile>.

export type ThemeProfile = 'classic' | 'smart' | 'smart-stairs' | 'smart-centered' | 'smart-peek';
export type SmartSidebarStyle = 'normal' | 'stairs' | 'centered' | 'centered-peek';

export const THEME_PROFILE_KEY = 'techasset_theme_profile';
export const THEME_PROFILE_EVENT = 'techasset:theme-profile';

const VALID_PROFILES: ThemeProfile[] = ['classic', 'smart', 'smart-stairs', 'smart-centered', 'smart-peek'];

export function readThemeProfile(): ThemeProfile {
  const stored = localStorage.getItem(THEME_PROFILE_KEY) as ThemeProfile | null;
  return stored && VALID_PROFILES.includes(stored) ? stored : 'classic';
}

export function isSmartProfile(profile: ThemeProfile): boolean {
  return profile.startsWith('smart');
}

export function smartSidebarStyle(profile: ThemeProfile): SmartSidebarStyle {
  if (profile === 'smart-stairs') return 'stairs';
  if (profile === 'smart-centered') return 'centered';
  if (profile === 'smart-peek') return 'centered-peek';
  return 'normal';
}

export function applyThemeProfile(profile: ThemeProfile) {
  const root = document.documentElement;
  root.dataset.themeProfile = profile;
  // El tema B es claro: reutiliza los overrides de `.theme-light` para que los
  // colores hardcodeados del tema oscuro no queden ilegibles sobre fondo crema.
  // En classic se respeta la preferencia clásica claro/oscuro del usuario.
  const light = isSmartProfile(profile) || localStorage.getItem('techasset_nfpt_theme') === 'light';
  root.classList.toggle('theme-light', light);
}

export function saveThemeProfile(profile: ThemeProfile) {
  localStorage.setItem(THEME_PROFILE_KEY, profile);
  applyThemeProfile(profile);
  window.dispatchEvent(new CustomEvent(THEME_PROFILE_EVENT, { detail: profile }));
}

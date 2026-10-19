import { useSyncExternalStore } from 'react';
import { saveUserPrefs } from '../services/userPrefsApi';

/**
 * Preferencias de apariencia (Grafito, etapa 1). Reemplazan a los 8 perfiles
 * viejos (classic/smart × normal/escalera/centrada/peek).
 *
 *   theme     dark | light | system   → <html data-theme="dark|light"> (resuelto)
 *   density   comfortable | compact   → <html data-density>
 *   textSize  normal | large | xlarge → <html data-text-size>
 *
 * Se aplican antes de montar React (index.html adelanta lo mínimo con un
 * script en línea; main.tsx llama a initAppearance). Se guardan en
 * localStorage y en /api/user/prefs (claves theme, density, textSize).
 *
 * Compatibilidad mientras quede CSS viejo:
 *   - claro también pone la clase `.theme-light` (≈56 overrides la leen);
 *   - `data-theme-profile` queda fijo en "classic" para que el shell clásico
 *     siga igual (la nav variante desaparece en la etapa 2).
 */
export type ThemePref = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact';
export type TextSize = 'normal' | 'large' | 'xlarge';
export type Appearance = { theme: ThemePref; density: Density; textSize: TextSize };

export const THEME_KEY = 'techasset_theme';
export const DENSITY_KEY = 'techasset_density';
export const TEXT_SIZE_KEY = 'techasset_text_size';
const LEGACY_PROFILE_KEY = 'techasset_theme_profile';
const LEGACY_THEME_KEY = 'techasset_nfpt_theme';

const THEMES: ThemePref[] = ['dark', 'light', 'system'];
const DENSITIES: Density[] = ['comfortable', 'compact'];
const TEXT_SIZES: TextSize[] = ['normal', 'large', 'xlarge'];

/** Color de la barra del sistema / PWA: el fondo de la app (--g-bg). */
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0D0F12', light: '#F6F7F9' };

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', density: 'comfortable', textSize: 'normal' };

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin storage */ }
}
function storageRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* sin storage */ }
}

/** Perfil viejo → tema: classic* = oscuro, smart* = claro. */
export function themeFromLegacyProfile(profile: unknown): ThemePref | null {
  if (typeof profile !== 'string') return null;
  if (profile.startsWith('smart')) return 'light';
  if (profile.startsWith('classic')) return 'dark';
  return null;
}

/**
 * Lee lo guardado y, si todavía hay claves viejas, las migra una vez:
 * `techasset_nfpt_theme=light` → claro; perfil `smart*` → claro; `classic*` → oscuro.
 */
export function readAppearance(): Appearance {
  let theme = pick(storageGet(THEME_KEY), THEMES);
  if (!theme) {
    const legacyLight = storageGet(LEGACY_THEME_KEY) === 'light';
    theme = legacyLight ? 'light' : themeFromLegacyProfile(storageGet(LEGACY_PROFILE_KEY)) || DEFAULT_APPEARANCE.theme;
    storageSet(THEME_KEY, theme);
    storageRemove(LEGACY_THEME_KEY);
    storageRemove(LEGACY_PROFILE_KEY);
  }
  return {
    theme,
    density: pick(storageGet(DENSITY_KEY), DENSITIES) || DEFAULT_APPEARANCE.density,
    textSize: pick(storageGet(TEXT_SIZE_KEY), TEXT_SIZES) || DEFAULT_APPEARANCE.textSize
  };
}

const lightQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null);

export function resolveTheme(theme: ThemePref): ResolvedTheme {
  if (theme === 'system') return lightQuery()?.matches ? 'light' : 'dark';
  return theme;
}

let current: Appearance = DEFAULT_APPEARANCE;
let resolved: ResolvedTheme = 'dark';
const listeners = new Set<() => void>();
let snapshot: Appearance & { resolved: ResolvedTheme } = { ...current, resolved };

function applyToDocument(next: Appearance) {
  const root = document.documentElement;
  resolved = resolveTheme(next.theme);
  root.dataset.theme = resolved;
  root.dataset.density = next.density;
  root.dataset.textSize = next.textSize;
  // Compat con el CSS viejo (se va en la etapa 2 / 9).
  root.dataset.themeProfile = 'classic';
  root.classList.toggle('theme-light', resolved === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
}

function emit() {
  snapshot = { ...current, resolved };
  listeners.forEach(listener => listener());
}

/** Aplica sin persistir (lo usa el arranque y la preferencia que llega del server). */
export function applyAppearance(next: Appearance) {
  current = next;
  applyToDocument(next);
  emit();
}

let systemListenerInstalled = false;

/** Arranque: lee (migrando lo viejo), aplica y escucha prefers-color-scheme. Antes de montar React. */
export function initAppearance() {
  applyAppearance(readAppearance());
  if (systemListenerInstalled) return;
  systemListenerInstalled = true;
  const query = lightQuery();
  const onChange = () => { if (current.theme === 'system') applyAppearance(current); };
  if (query?.addEventListener) query.addEventListener('change', onChange);
  else query?.addListener?.(onChange);
}

/** Cambio del usuario: aplica, guarda local y en el server (fire and forget). */
export function setAppearance(patch: Partial<Appearance>) {
  const next: Appearance = {
    theme: pick(patch.theme, THEMES) || current.theme,
    density: pick(patch.density, DENSITIES) || current.density,
    textSize: pick(patch.textSize, TEXT_SIZES) || current.textSize
  };
  storageSet(THEME_KEY, next.theme);
  storageSet(DENSITY_KEY, next.density);
  storageSet(TEXT_SIZE_KEY, next.textSize);
  applyAppearance(next);
  const changed: Partial<Appearance> = {};
  (Object.keys(patch) as Array<keyof Appearance>).forEach(key => { (changed as Record<string, string>)[key] = next[key]; });
  // Si no hay sesión el 401 se ignora: el valor local ya quedó guardado.
  saveUserPrefs(changed).catch(() => undefined);
}

/**
 * Preferencias que vienen del server al iniciar sesión: pisan a las locales
 * (igual que antes con el perfil). Si el usuario solo tiene el perfil viejo,
 * se traduce sin escribir nada en el server.
 */
export function applyServerAppearance(prefs: { theme?: unknown; density?: unknown; textSize?: unknown; themeProfile?: unknown } | null | undefined) {
  if (!prefs) return;
  const theme = pick(prefs.theme, THEMES) || themeFromLegacyProfile(prefs.themeProfile);
  const density = pick(prefs.density, DENSITIES);
  const textSize = pick(prefs.textSize, TEXT_SIZES);
  if (!theme && !density && !textSize) return;
  const next: Appearance = {
    theme: theme || current.theme,
    density: density || current.density,
    textSize: textSize || current.textSize
  };
  storageSet(THEME_KEY, next.theme);
  storageSet(DENSITY_KEY, next.density);
  storageSet(TEXT_SIZE_KEY, next.textSize);
  applyAppearance(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Preferencias actuales + tema resuelto, reactivo. */
export function useAppearance() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

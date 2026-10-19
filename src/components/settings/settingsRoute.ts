/**
 * Rutas de Configuración: `/sede/<sede>/settings/<panel>`.
 *
 * Archivo chico y sin dependencias a propósito: lo importa `App.tsx` (para los
 * links viejos `/tenants`, `/adminusers` y `/configuracion/usuarios` de los
 * mails) sin arrastrar el chunk de Configuración.
 */
export const SETTINGS_PANELS = [
  'cuenta', 'apariencia', 'notificaciones',
  'turnos', 'modulos', 'roles', 'usuarios', 'invitaciones', 'prestamo', 'vida-util', 'sede', 'avanzado',
  'sedes', 'mail'
] as const;

export type SettingsPanelKey = typeof SETTINGS_PANELS[number];

const ALIASES: Record<string, SettingsPanelKey> = {
  tema: 'apariencia',
  notif: 'notificaciones',
  'opciones-prestamo': 'prestamo',
  vida: 'vida-util',
  smtp: 'mail',
  tenants: 'sedes'
};

export function isSettingsPanel(value: unknown): value is SettingsPanelKey {
  return typeof value === 'string' && (SETTINGS_PANELS as readonly string[]).includes(value);
}

export function normalizePanel(value: string | undefined | null): SettingsPanelKey | null {
  const key = String(value || '').toLowerCase();
  if (isSettingsPanel(key)) return key;
  return ALIASES[key] || null;
}

/** Vistas viejas que ahora son un panel de Configuración. */
export const LEGACY_VIEW_PANELS: Record<string, SettingsPanelKey> = {
  tenants: 'sedes',
  adminusers: 'usuarios'
};

/** Panel pedido por la URL: `/sede/x/(settings|configuracion)/<panel>` o una vista vieja. */
export function panelFromPath(pathname: string): SettingsPanelKey | null {
  const match = pathname.match(/^\/sede\/[^/]+\/([^/]+)(?:\/([^/]+))?/i);
  if (!match) return null;
  const view = match[1].toLowerCase();
  if (LEGACY_VIEW_PANELS[view]) return LEGACY_VIEW_PANELS[view];
  if (view === 'settings' || view === 'configuracion') return normalizePanel(match[2]);
  return null;
}

/** Vistas de la URL que hoy abren Configuración (para `readViewFromUrl`). */
export function isSettingsAlias(view: string | undefined) {
  const key = String(view || '').toLowerCase();
  return key === 'configuracion' || Boolean(LEGACY_VIEW_PANELS[key]);
}

// Panel pedido antes de que Configuración monte (el App corrige la URL a
// `/sede/x/settings` en el primer render y el chunk llega después).
let requested: SettingsPanelKey | null = null;

export function requestSettingsPanel(panel: SettingsPanelKey | null) {
  requested = panel;
}

/** Lo lee sin consumirlo: al primer arranque Configuración puede montar dos veces. */
export function peekRequestedPanel(): SettingsPanelKey | null {
  return requested;
}

export function clearRequestedPanel() {
  requested = null;
}

export function settingsPath(siteCode: string, panel: SettingsPanelKey | null) {
  return `/sede/${siteCode.toLowerCase()}/settings${panel ? `/${panel}` : ''}`;
}

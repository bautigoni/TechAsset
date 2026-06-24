import type { ViewKey } from '../types';

// Módulos que cada sede puede prender/apagar desde Configuración (rol manager).
export type ModuleKey =
  | 'devices' | 'loans' | 'inventory' | 'analytics'
  | 'agenda' | 'tasks' | 'classrooms' | 'tickets'
  | 'tools' | 'quickaccess';

export const TOGGLEABLE_MODULES: Array<{ key: ModuleKey; label: string }> = [
  { key: 'devices', label: 'Dispositivos' },
  { key: 'loans', label: 'Préstamos' },
  { key: 'inventory', label: 'Inventario TIC' },
  { key: 'analytics', label: 'Analítica' },
  { key: 'agenda', label: 'Agenda TIC' },
  { key: 'tasks', label: 'Tareas TIC' },
  { key: 'classrooms', label: 'Estado aulas' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'tools', label: 'Herramientas auxiliares' },
  { key: 'quickaccess', label: 'Accesos rápidos' },
];

export const TOGGLEABLE_KEYS = new Set<string>(TOGGLEABLE_MODULES.map(m => m.key));

// Vistas que siempre están disponibles (no se pueden apagar).
export const ALWAYS_ON_VIEWS = new Set<ViewKey>(['dashboard', 'settings', 'tenants']);

const SETTINGS_KEY = 'modules.enabled';

/**
 * Conjunto de módulos habilitados para la sede. Si la sede no tiene la clave
 * configurada (sedes legacy), se consideran TODOS habilitados (retrocompatible).
 */
export function enabledModuleSet(settings?: Record<string, unknown> | null): Set<string> {
  const raw = settings?.[SETTINGS_KEY];
  if (!Array.isArray(raw)) return new Set(TOGGLEABLE_KEYS);
  return new Set(raw.map(String).filter(key => TOGGLEABLE_KEYS.has(key)));
}

export function isViewEnabled(view: ViewKey, settings?: Record<string, unknown> | null): boolean {
  if (ALWAYS_ON_VIEWS.has(view)) return true;
  if (!TOGGLEABLE_KEYS.has(view)) return true; // vistas internas (assistant, etc.)
  return enabledModuleSet(settings).has(view);
}

export { SETTINGS_KEY as MODULES_SETTINGS_KEY };

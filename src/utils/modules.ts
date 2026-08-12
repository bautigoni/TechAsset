import type { ViewKey } from '../types';

// Módulos que cada sede puede prender/apagar desde Configuración (rol manager).
export type ModuleKey =
  | 'devices' | 'loans' | 'inventory' | 'analytics'
  | 'agenda' | 'schedules' | 'tasks' | 'pettycash' | 'classrooms' | 'tickets' | 'suggestions'
  | 'tools' | 'quickaccess';

export type ModuleCategory = 'Operación' | 'Análisis' | 'Planificación' | 'Aulas y soporte' | 'Comunicaciones';

export const MODULE_CATEGORIES: ModuleCategory[] = ['Operación', 'Análisis', 'Planificación', 'Aulas y soporte', 'Comunicaciones'];

export interface ToggleableModule { key: ModuleKey; label: string; description: string; category: ModuleCategory; icon: string }

export const TOGGLEABLE_MODULES: ToggleableModule[] = [
  { key: 'devices', label: 'Dispositivos', description: 'Inventario de equipos y su estado.', category: 'Operación', icon: '💻' },
  { key: 'loans', label: 'Préstamos', description: 'Prestar y devolver dispositivos.', category: 'Operación', icon: '🔄' },
  { key: 'inventory', label: 'Inventario TIC', description: 'Recursos maker y stock de componentes.', category: 'Operación', icon: '📦' },
  { key: 'analytics', label: 'Analítica', description: 'Métricas de préstamos y uso.', category: 'Análisis', icon: '📊' },
  { key: 'agenda', label: 'Agenda TIC', description: 'Reservas y planificación semanal.', category: 'Planificación', icon: '🗓️' },
  { key: 'schedules', label: 'Horarios', description: 'Horarios docentes y recreos por grupo.', category: 'Planificación', icon: '🕐' },
  { key: 'tasks', label: 'Tareas TIC', description: 'Tareas del equipo y seguimiento.', category: 'Planificación', icon: '✅' },
  { key: 'pettycash', label: 'Caja chica', description: 'Fondo fijo, gastos y solicitudes de compra.', category: 'Operación', icon: '💳' },
  { key: 'suggestions', label: 'Sugerencias', description: 'Ideas, votos y seguimiento transparente de mejoras.', category: 'Comunicaciones', icon: '💡' },
  { key: 'classrooms', label: 'Estado aulas', description: 'Revisión de proyectores y equipos por aula.', category: 'Aulas y soporte', icon: '🏫' },
  { key: 'tickets', label: 'Tickets', description: 'Tickets de InVgate cargados desde la app.', category: 'Aulas y soporte', icon: '🎫' },
  { key: 'tools', label: 'Herramientas auxiliares', description: 'Utilidades varias del equipo TIC.', category: 'Aulas y soporte', icon: '🛠️' },
  { key: 'quickaccess', label: 'Accesos rápidos', description: 'Links institucionales a un toque.', category: 'Comunicaciones', icon: '⚡' },
];

export const TOGGLEABLE_KEYS = new Set<string>(TOGGLEABLE_MODULES.map(m => m.key));

// Vistas que siempre están disponibles (no se pueden apagar).
export const ALWAYS_ON_VIEWS = new Set<ViewKey>(['dashboard', 'settings', 'tenants']);

const SETTINGS_KEY = 'modules.enabled';
const ORDER_SETTINGS_KEY = 'modules.order';

/**
 * Conjunto de módulos habilitados para la sede. Si la sede no tiene la clave
 * configurada (sedes legacy), se consideran TODOS habilitados (retrocompatible).
 */
export function enabledModuleSet(settings?: Record<string, unknown> | null): Set<string> {
  const raw = settings?.[SETTINGS_KEY];
  if (!Array.isArray(raw)) return new Set(TOGGLEABLE_KEYS);
  return new Set(raw.map(String).filter(key => TOGGLEABLE_KEYS.has(key)));
}

export function moduleOrder(settings?: Record<string, unknown> | null): ModuleKey[] {
  const raw = settings?.[ORDER_SETTINGS_KEY];
  const preferred = Array.isArray(raw) ? raw.map(String).filter(key => TOGGLEABLE_KEYS.has(key)) : [];
  const unique = Array.from(new Set(preferred)) as ModuleKey[];
  const missing = TOGGLEABLE_MODULES.map(mod => mod.key).filter(key => !unique.includes(key));
  return [...unique, ...missing];
}

export function orderedToggleableModules(settings?: Record<string, unknown> | null): ToggleableModule[] {
  const byKey = new Map(TOGGLEABLE_MODULES.map(mod => [mod.key, mod]));
  return moduleOrder(settings).map(key => byKey.get(key)).filter(Boolean) as ToggleableModule[];
}

export function isViewEnabled(view: ViewKey, settings?: Record<string, unknown> | null): boolean {
  if (ALWAYS_ON_VIEWS.has(view)) return true;
  if (!TOGGLEABLE_KEYS.has(view)) return true; // vistas internas (assistant, etc.)
  return enabledModuleSet(settings).has(view);
}

export { SETTINGS_KEY as MODULES_SETTINGS_KEY };
export { ORDER_SETTINGS_KEY as MODULES_ORDER_SETTINGS_KEY };

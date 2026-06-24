import type { AuthUser, SiteInfo } from '../types';

// Permisos basados en el rol REAL del usuario en la sede activa (no en nombres
// hardcodeados ni en un toggle manual). Espeja la lógica del backend.

const MANAGER_ROLES = new Set(['Superadmin', 'Jefe TIC', 'Admin', 'Administrador']);
const EDITOR_ROLES = new Set([
  'Superadmin', 'Jefe TIC', 'Admin', 'Administrador',
  'Asistente TIC mañana', 'Asistente TIC tarde', 'Asistente TIC general', 'Asistente TIC'
]);

function clean(role?: string): string {
  return String(role || '').trim();
}

export function isSuperadmin(user?: Pick<AuthUser, 'rolGlobal'> | null): boolean {
  return clean(user?.rolGlobal) === 'Superadmin';
}

/** Rol efectivo del usuario en la sede activa (Superadmin global pisa todo). */
export function activeSiteRole(user: AuthUser | null, sites: SiteInfo[], activeSite: string): string {
  if (isSuperadmin(user)) return 'Superadmin';
  const match = sites.find(site => site.siteCode === activeSite);
  return clean(match?.siteRole) || 'Consulta';
}

/** Jefe TIC de la sede o Superadmin: administra sede, usuarios, settings, módulos. */
export function isManager(role: string): boolean {
  return MANAGER_ROLES.has(clean(role));
}

/** Puede editar datos operativos (managers + asistentes). Consulta/Otro: no. */
export function isEditor(role: string): boolean {
  return EDITOR_ROLES.has(clean(role));
}

/** Solo lectura: el rol no puede editar. */
export function isReadOnlyRole(role: string): boolean {
  return !isEditor(role);
}

export interface ModuleAccess {
  admin: boolean;
  view: Set<string>;
  edit: Set<string>;
}

/**
 * Permisos del rol activo resueltos desde roles.config del tenant (espeja el backend).
 * Si no hay config para el rol, cae a heurística por nombre (manager/editor ven todo).
 */
export function roleAccess(settings: Record<string, unknown> | null | undefined, role: string, superadmin: boolean): ModuleAccess {
  if (superadmin) return { admin: true, view: new Set(['*']), edit: new Set(['*']) };
  const cfg = settings?.['roles.config'];
  const found = Array.isArray(cfg)
    ? (cfg as Array<{ name?: string; admin?: boolean; view?: unknown; edit?: unknown }>).find(r => clean(r?.name) === clean(role))
    : null;
  if (found) {
    return {
      admin: Boolean(found.admin),
      view: new Set((Array.isArray(found.view) ? found.view : []).map(String)),
      edit: new Set((Array.isArray(found.edit) ? found.edit : []).map(String))
    };
  }
  if (isManager(role)) return { admin: true, view: new Set(['*']), edit: new Set(['*']) };
  if (isEditor(role)) return { admin: false, view: new Set(['*']), edit: new Set(['*']) };
  return { admin: false, view: new Set(['*']), edit: new Set() };
}

/** Si el rol puede ver un módulo concreto (vistas no-módulo siempre visibles). */
export function canViewModule(access: ModuleAccess, key: string, toggleableKeys: Set<string>): boolean {
  if (!toggleableKeys.has(key)) return true;
  return access.admin || access.view.has('*') || access.view.has(key);
}

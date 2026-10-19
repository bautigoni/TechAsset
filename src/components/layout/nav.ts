import type { ComponentType } from 'react';
import {
  BarChart3,
  BellRing,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  Clock3,
  ClipboardCheck,
  History,
  House,
  Link2,
  Lightbulb,
  MonitorSmartphone,
  Palette,
  Repeat2,
  School,
  Settings,
  Shapes,
  Ticket,
  Users,
  WalletCards,
  Wrench
} from 'lucide-react';
import type { ViewKey } from '../../types';
import { isViewEnabled, moduleOrder, TOGGLEABLE_KEYS, type ModuleKey } from '../../utils/modules';
import { canViewModule, type ModuleAccess } from '../../utils/permissions';

/**
 * Catálogo del menú (Menú A del rediseño): una sola fuente para el menú
 * lateral, el rail, la barra inferior mobile, la vista "Más", Ctrl K y el
 * título de la barra superior.
 */
export type NavIcon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
export type NavGroupKey = 'operacion' | 'gestion' | 'datos' | 'recursos' | 'admin' | 'config';

// requiresAny: vistas que no son un módulo propio y se ven si el rol puede ver
// alguno de estos módulos (Historial = Préstamos o Dispositivos).
export type NavItem = {
  key: ViewKey;
  label: string;
  /** Contexto corto que acompaña al título en la barra superior. */
  hint: string;
  Icon: NavIcon;
  group: NavGroupKey;
  superadminOnly?: boolean;
  requiresAny?: ModuleKey[];
};

export const NAV_GROUPS: Array<{ key: NavGroupKey; label: string }> = [
  { key: 'operacion', label: 'Operación' },
  { key: 'gestion', label: 'Gestión' },
  { key: 'datos', label: 'Inventario y datos' },
  { key: 'recursos', label: 'Recursos' },
  { key: 'admin', label: 'Superadmin' }
];

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Inicio', hint: '', Icon: House, group: 'operacion' },
  { key: 'loans', label: 'Préstamos', hint: 'Prestar y devolver equipos', Icon: Repeat2, group: 'operacion' },
  { key: 'devices', label: 'Dispositivos', hint: 'Equipos y su estado', Icon: MonitorSmartphone, group: 'operacion' },
  { key: 'agenda', label: 'Agenda TIC', hint: 'Reservas de la semana', Icon: CalendarDays, group: 'operacion' },
  { key: 'schedules', label: 'Horarios', hint: 'Horarios docentes y recreos', Icon: Clock3, group: 'operacion' },
  { key: 'classrooms', label: 'Estado aulas', hint: 'Equipamiento por aula', Icon: School, group: 'operacion' },
  { key: 'tasks', label: 'Tareas TIC', hint: 'Tareas del equipo', Icon: ClipboardCheck, group: 'gestion' },
  { key: 'tickets', label: 'Tickets', hint: 'Pedidos de soporte', Icon: Ticket, group: 'gestion' },
  { key: 'reminders', label: 'Recordatorios', hint: 'Avisos con fecha', Icon: BellRing, group: 'gestion' },
  { key: 'suggestions', label: 'Sugerencias', hint: 'Ideas, votos y seguimiento', Icon: Lightbulb, group: 'gestion' },
  { key: 'history', label: 'Historial', hint: 'Préstamos y cambios de equipos', Icon: History, group: 'gestion', requiresAny: ['loans', 'devices'] },
  { key: 'inventory', label: 'Inventario TIC', hint: 'Recursos maker y stock', Icon: Boxes, group: 'datos' },
  { key: 'analytics', label: 'Analítica', hint: 'Uso y demanda de equipos', Icon: BarChart3, group: 'datos' },
  { key: 'pettycash', label: 'Caja chica', hint: 'Fondo fijo y gastos', Icon: WalletCards, group: 'datos' },
  { key: 'knowledge', label: 'Base de conocimiento', hint: 'Procedimientos internos', Icon: BookOpen, group: 'recursos' },
  { key: 'canvas', label: 'Canvas', hint: 'Pizarra libre', Icon: Shapes, group: 'recursos' },
  { key: 'tools', label: 'Herramientas', hint: 'Utilidades del equipo TIC', Icon: Wrench, group: 'recursos' },
  { key: 'quickaccess', label: 'Accesos rápidos', hint: 'Links que se abren en otra pestaña', Icon: Link2, group: 'recursos' },
  { key: 'tenants', label: 'Tenants', hint: 'Sedes, branding e importación', Icon: Building2, group: 'admin', superadminOnly: true },
  { key: 'adminusers', label: 'Usuarios', hint: 'Usuarios de todas las sedes', Icon: Users, group: 'admin', superadminOnly: true },
  // Página de muestra de la librería src/ui (interna, etapa 1 del rediseño).
  { key: 'ui', label: 'Componentes UI', hint: 'Librería Grafito', Icon: Palette, group: 'admin', superadminOnly: true },
  { key: 'settings', label: 'Configuración', hint: 'Sede, usuarios y preferencias', Icon: Settings, group: 'config' }
];

const BY_KEY = new Map(NAV.map(item => [item.key, item]));
export function navItem(view: ViewKey): NavItem | undefined {
  return BY_KEY.get(view);
}

/** Lista de navegación visible según sede, rol y módulos habilitados. */
export function visibleNavItems(settings: Record<string, unknown> | null | undefined, isSuperadmin: boolean, access: ModuleAccess | null): NavItem[] {
  const order = moduleOrder(settings);
  const rank = (key: ViewKey) => {
    if (key === 'dashboard') return -1;
    const index = order.indexOf(key as ModuleKey);
    return index === -1 ? 999 : index;
  };
  return NAV.filter(item =>
    (!item.superadminOnly || isSuperadmin) &&
    isViewEnabled(item.key, settings) &&
    (!access || canViewModule(access, item.key, TOGGLEABLE_KEYS)) &&
    (!item.requiresAny || item.requiresAny.some(key => isViewEnabled(key, settings) && (!access || canViewModule(access, key, TOGGLEABLE_KEYS))))
  ).sort((a, b) => {
    const groupDiff = groupIndex(a.group) - groupIndex(b.group);
    return groupDiff || rank(a.key) - rank(b.key);
  });
}

function groupIndex(group: NavGroupKey) {
  if (group === 'config') return 99;
  return NAV_GROUPS.findIndex(item => item.key === group);
}

/** Ítems visibles agrupados (sin Configuración, que va abajo). */
export function groupNavItems(items: NavItem[]) {
  return NAV_GROUPS
    .map(group => ({ ...group, items: items.filter(item => item.group === group.key) }))
    .filter(group => group.items.length > 0);
}

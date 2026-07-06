import type { ComponentType } from 'react';
import {
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  Link2,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat2,
  School,
  Settings,
  Ticket,
  Wrench,
  X
} from 'lucide-react';
import type { SiteInfo, ViewKey } from '../../types';
import { isViewEnabled, moduleOrder, TOGGLEABLE_KEYS, type ModuleKey } from '../../utils/modules';
import { canViewModule, type ModuleAccess } from '../../utils/permissions';
import { hasVariantNav, variantStyle, type ThemeProfile } from '../../utils/themeProfile';
import { TenantLogo } from './TenantLogo';

type NavIcon = ComponentType<{ size?: number; strokeWidth?: number }>;

export type NavItem = { key: ViewKey; label: string; Icon: NavIcon; superadminOnly?: boolean };

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', Icon: Gauge },
  { key: 'tenants', label: 'Tenants', Icon: Building2, superadminOnly: true },
  { key: 'devices', label: 'Dispositivos', Icon: MonitorSmartphone },
  { key: 'loans', label: 'Préstamos', Icon: Repeat2 },
  { key: 'inventory', label: 'Inventario TIC', Icon: Boxes },
  { key: 'analytics', label: 'Analítica', Icon: BarChart3 },
  { key: 'agenda', label: 'Agenda TIC', Icon: CalendarDays },
  { key: 'tasks', label: 'Tareas TIC', Icon: ClipboardCheck },
  { key: 'classrooms', label: 'Estado aulas', Icon: School },
  { key: 'tickets', label: 'Tickets', Icon: Ticket },
  { key: 'tools', label: 'Herramientas auxiliares', Icon: Wrench },
  { key: 'quickaccess', label: 'Accesos rápidos', Icon: Link2 },
  { key: 'settings', label: 'Configuración', Icon: Settings }
];

const BOTTOM_NAV = new Set<ViewKey>(['settings']);

// Lista de navegación visible según sede, rol y módulos habilitados.
// La comparten Sidebar (ambos temas) y el bottom nav mobile del tema B.
export function visibleNavItems(settings: Record<string, unknown> | null | undefined, isSuperadmin: boolean, access: ModuleAccess | null): NavItem[] {
  return NAV.filter(item =>
    (!item.superadminOnly || isSuperadmin) &&
    isViewEnabled(item.key, settings) &&
    (!access || canViewModule(access, item.key, TOGGLEABLE_KEYS))
  ).sort((a, b) => navSort(a.key, b.key, settings));
}

// Indentación del estilo "stairs": los items se corren según su distancia al activo.
export function getStairsMargin(index: number, activeIndex: number): number {
  if (activeIndex < 0) return 5;
  const distance = Math.abs(index - activeIndex);
  if (distance === 0) return 0;
  if (distance === 1) return 26;
  if (distance === 2) return 19;
  if (distance === 3) return 12;
  return 5;
}

export function Sidebar({ active, onNavigate, open, onClose, collapsed, onToggleCollapsed, activeSite, sites, settings, isSuperadmin = false, access = null, themeProfile = 'classic', impersonating = false }: {
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeSite: string;
  sites: SiteInfo[];
  settings?: Record<string, unknown> | null;
  isSuperadmin?: boolean;
  access?: ModuleAccess | null;
  themeProfile?: ThemeProfile;
  impersonating?: boolean;
}) {
  const siteInfo = sites.find(site => site.siteCode === activeSite);
  const visibleNav = visibleNavItems(settings, isSuperadmin, access);
  const navigate = (view: ViewKey) => {
    onNavigate(view);
    onClose();
  };

  if (hasVariantNav(themeProfile)) {
    const style = variantStyle(themeProfile);
    const activeIndex = visibleNav.findIndex(item => item.key === active);
    return (
      <aside
        className={`sidebar-rail style-${style} ${open ? 'open' : ''} ${impersonating ? 'has-impersonation' : ''}`}
        onClick={onClose}
      >
        <div className="sidebar-box" onClick={event => event.stopPropagation()}>
          <div className="sidebar-box-header">
            <div className="sidebar-box-brand">
              <TenantLogo site={siteInfo} />
              <div>
                <strong>TechAsset</strong>
                <small>{siteInfo?.nombre || activeSite}</small>
              </div>
            </div>
            <button className="sidebar-close-btn" type="button" aria-label="Cerrar menú" onClick={onClose}>
              <X size={18} strokeWidth={2.2} />
            </button>
          </div>
          <nav>
            {visibleNav.map((item, index) => {
              const Icon = item.Icon;
              const isActive = active === item.key;
              const stairs = style === 'stairs';
              const peek = style === 'centered-peek';
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item ${stairs ? 'stairs' : ''} ${peek ? 'peek' : ''} ${isActive ? 'active' : ''}`.replace(/\s+/g, ' ').trim()}
                  style={stairs ? { marginLeft: getStairsMargin(index, activeIndex) } : undefined}
                  onClick={() => navigate(item.key)}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon size={18} strokeWidth={2.1} />
                  <span className="nav-item-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    );
  }

  const mainNav = visibleNav.filter(item => !BOTTOM_NAV.has(item.key));
  const bottomNav = visibleNav.filter(item => BOTTOM_NAV.has(item.key));

  return (
    <>
      <div className={`mobile-overlay ${open ? '' : 'hidden'}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open mobile-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-lockup">
            <TenantLogo className="brand-logo" site={siteInfo} />
            <div className="brand-text">
              <h1>TechAsset</h1>
              <p>{siteInfo?.nombre || activeSite}</p>
            </div>
          </div>
          <button className="sidebar-collapse-btn brand-collapse-btn" type="button" aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'} title={collapsed ? 'Expandir menú' : 'Contraer menú'} onClick={onToggleCollapsed}>
            {collapsed ? <PanelLeftOpen size={18} strokeWidth={2.2} /> : <PanelLeftClose size={18} strokeWidth={2.2} />}
          </button>
        </div>

        <nav className="nav nav-scrollable">
          {mainNav.map(item => {
            const Icon = item.Icon;
            return (
              <button key={item.key} className={`nav-btn ${active === item.key ? 'active' : ''}`} type="button" onClick={() => navigate(item.key)} title={item.label} data-tooltip={item.label} aria-label={item.label}>
                <span className="nav-icon" aria-hidden="true"><Icon size={19} strokeWidth={2.1} /></span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <nav className="nav sidebar-bottom-nav">
          {bottomNav.map(item => {
            const Icon = item.Icon;
            return (
              <button key={item.key} className={`nav-btn ${active === item.key ? 'active' : ''}`} type="button" onClick={() => navigate(item.key)} title={item.label} data-tooltip={item.label} aria-label={item.label}>
                <span className="nav-icon" aria-hidden="true"><Icon size={19} strokeWidth={2.1} /></span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function navSort(a: ViewKey, b: ViewKey, settings?: Record<string, unknown> | null) {
  const fixed: ViewKey[] = ['dashboard', 'tenants'];
  const fixedA = fixed.indexOf(a);
  const fixedB = fixed.indexOf(b);
  if (fixedA !== -1 || fixedB !== -1) {
    if (fixedA === -1) return 1;
    if (fixedB === -1) return -1;
    return fixedA - fixedB;
  }
  if (a === 'settings') return 1;
  if (b === 'settings') return -1;
  const order = moduleOrder(settings);
  const indexA = order.indexOf(a as ModuleKey);
  const indexB = order.indexOf(b as ModuleKey);
  return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
}

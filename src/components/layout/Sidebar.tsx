import type { ComponentType } from 'react';
import {
  BarChart3,
  Boxes,
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
  Wrench
} from 'lucide-react';
import type { SiteInfo, ViewKey } from '../../types';

type NavIcon = ComponentType<{ size?: number; strokeWidth?: number }>;

const NAV: Array<{ key: ViewKey; label: string; Icon: NavIcon }> = [
  { key: 'dashboard', label: 'Dashboard', Icon: Gauge },
  { key: 'devices', label: 'Dispositivos', Icon: MonitorSmartphone },
  { key: 'loans', label: 'Préstamos', Icon: Repeat2 },
  { key: 'inventory', label: 'Inventario TIC', Icon: Boxes },
  { key: 'analytics', label: 'Analítica', Icon: BarChart3 },
  { key: 'agenda', label: 'Agenda TIC', Icon: CalendarDays },
  { key: 'tasks', label: 'Tareas TIC', Icon: ClipboardCheck },
  { key: 'classrooms', label: 'Estado aulas', Icon: School },
  { key: 'tools', label: 'Herramientas auxiliares', Icon: Wrench },
  { key: 'quickaccess', label: 'Accesos rápidos', Icon: Link2 },
  { key: 'settings', label: 'Configuración', Icon: Settings }
];

export function Sidebar({ active, onNavigate, open, onClose, collapsed, onToggleCollapsed, activeSite, sites }: {
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeSite: string;
  sites: SiteInfo[];
}) {
  const siteInfo = sites.find(site => site.siteCode === activeSite);
  const visibleNav = NAV.filter(item => item.key !== 'classrooms' || ['NFPT', 'NFND'].includes(activeSite));
  const navigate = (view: ViewKey) => {
    onNavigate(view);
    onClose();
  };

  return (
    <>
      <div className={`mobile-overlay ${open ? '' : 'hidden'}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open mobile-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-lockup">
            <img className="brand-logo" src="/northfield_logo.png" alt="Northfield" />
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
          {visibleNav.map(item => {
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

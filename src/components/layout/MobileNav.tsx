import { CalendarDays, House, LayoutGrid, Repeat2, ScanLine } from 'lucide-react';
import type { ViewKey } from '../../types';
import type { NavItem } from './nav';
import type { NavCounts } from './Sidebar';

/**
 * Barra inferior (solo < 768 px, donde no hay menú lateral): Inicio,
 * Préstamos, Escanear (al centro), Agenda y Más. "Más" abre las demás
 * secciones en una vista propia, en línea (no una hoja flotante). Se esconde
 * con el teclado abierto (clase en <body>, ver AppShell).
 */
export function MobileNav({ items, active, moreOpen, onNavigate, onPrefetch, onScan, onToggleMore, counts }: {
  items: NavItem[];
  active: ViewKey;
  moreOpen: boolean;
  onNavigate: (view: ViewKey) => void;
  onPrefetch?: (view: ViewKey) => void;
  onScan: () => void;
  onToggleMore: () => void;
  counts: NavCounts;
}) {
  const has = (key: ViewKey) => items.some(item => item.key === key);
  const slot = (key: ViewKey, label: string, Icon: typeof House) => {
    const isActive = !moreOpen && active === key;
    const count = counts[key];
    return (
      <button
        type="button"
        className={`shell-tab${isActive ? ' is-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-label={count ? `${label}, ${count}` : label}
        onClick={() => onNavigate(key)}
        onTouchStart={() => onPrefetch?.(key)}
      >
        <Icon size={20} strokeWidth={1.6} aria-hidden={true} />
        <span className="shell-tab-label">{label}{count ? <span className="shell-tab-count g-num" aria-hidden="true"> {count}</span> : null}</span>
      </button>
    );
  };
  return (
    <nav className="shell-tabbar" aria-label="Navegación principal">
      {slot('dashboard', 'Inicio', House)}
      {has('loans') ? slot('loans', 'Préstamos', Repeat2) : <span className="shell-tab is-empty" aria-hidden="true" />}
      {has('loans') ? (
        <button type="button" className="shell-tab shell-tab-scan" aria-label="Escanear un equipo" onClick={onScan} onTouchStart={() => onPrefetch?.('loans')}>
          <span className="shell-tab-scan-icon"><ScanLine size={20} strokeWidth={1.6} aria-hidden="true" /></span>
          <span className="shell-tab-label">Escanear</span>
        </button>
      ) : <span className="shell-tab is-empty" aria-hidden="true" />}
      {has('agenda') ? slot('agenda', 'Agenda', CalendarDays) : <span className="shell-tab is-empty" aria-hidden="true" />}
      <button type="button" className={`shell-tab${moreOpen ? ' is-active' : ''}`} aria-expanded={moreOpen} aria-controls="shell-more" onClick={onToggleMore}>
        <LayoutGrid size={20} strokeWidth={1.6} aria-hidden="true" />
        <span className="shell-tab-label">Más</span>
      </button>
    </nav>
  );
}

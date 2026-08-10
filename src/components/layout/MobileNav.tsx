import type { CSSProperties } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { ViewKey } from '../../types';
import { hasVariantNav, type ThemeProfile } from '../../utils/themeProfile';
import type { NavItem } from './Sidebar';

const MAX_SLOTS = 4;

// Bottom nav flotante del Tema B (solo mobile, ver nav-smart.css).
// En el tema clásico no renderiza nada, igual que siempre.
export function MobileNav({ items, active, onNavigate, onPrefetch, onMore, themeProfile = 'classic' }: {
  items: NavItem[];
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
  onPrefetch?: (view: ViewKey) => void;
  onMore: () => void;
  themeProfile?: ThemeProfile;
}) {
  if (!hasVariantNav(themeProfile) || items.length === 0) return null;

  const hasMore = items.length > MAX_SLOTS;
  const shown = hasMore ? items.slice(0, MAX_SLOTS - 1) : items;
  const slots = shown.length + (hasMore ? 1 : 0);
  const activeIndex = shown.findIndex(item => item.key === active);

  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      <div className="bottom-nav-container" style={{ '--bn-slots': slots } as CSSProperties}>
        {activeIndex >= 0 && (
          <span className="bottom-nav-pill" aria-hidden="true" style={{ transform: `translateX(${activeIndex * 100}%)` }} />
        )}
        {shown.map(item => {
          const Icon = item.Icon;
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
              onTouchStart={() => onPrefetch?.(item.key)}
            >
              <Icon size={22} strokeWidth={2.1} />
              <span>{item.label}</span>
            </button>
          );
        })}
        {hasMore && (
          <button type="button" className="bottom-nav-item more-btn" onClick={onMore} aria-label="Más secciones">
            <MoreHorizontal size={22} strokeWidth={2.1} />
            <span>Más</span>
          </button>
        )}
      </div>
    </nav>
  );
}

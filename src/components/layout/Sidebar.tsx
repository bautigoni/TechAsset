import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { ChevronsUpDown, Ellipsis, Search } from 'lucide-react';
import type { AuthUser, SiteInfo, ViewKey } from '../../types';
import { Tooltip } from '../../ui/Tooltip';
import { groupNavItems, type NavItem } from './nav';
import { TenantLogo } from './TenantLogo';

export type NavCounts = Partial<Record<ViewKey, number>>;

type SidebarProps = {
  items: NavItem[];
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
  onPrefetch?: (view: ViewKey) => void;
  counts: NavCounts;
  activeSite: string;
  sites: SiteInfo[];
  user: AuthUser;
  roleLabel: string;
  canSwitchSites: boolean;
  /** Franja abierta en la barra superior (para aria-expanded). */
  openStrip: string | null;
  onToggleStrip: (strip: 'sites' | 'account' | 'palette', trigger: HTMLElement) => void;
};

/** Densidad del menú según el alto disponible (se mide; ver shell.css). */
const DENSITIES = ['full', 'tight', 'compact', 'dense', 'scroll'];

export function initialsOf(text: string) {
  return text.split(/\s|@/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'U';
}

/**
 * Menú lateral agrupado (Menú A): selector de sede arriba, "Buscar o ir a…"
 * (Ctrl K), grupos Operación / Gestión / Inventario y datos / Recursos (y
 * Superadmin), Configuración y el usuario abajo. Contraído o bajo 1100 px es
 * un rail de 56 px: los nombres quedan en aria-label y aparecen en un tooltip
 * al pasar el mouse o con foco (el texto está "cortado": es la excepción de la
 * única capa flotante permitida). Bajo 768 px no se dibuja: manda la barra
 * inferior.
 */
export function Sidebar({ items, active, onNavigate, onPrefetch, counts, activeSite, sites, user, roleLabel, canSwitchSites, openStrip, onToggleStrip }: SidebarProps) {
  const siteInfo = sites.find(site => site.siteCode === activeSite);
  const groups = groupNavItems(items);
  const settings = items.find(item => item.group === 'config');
  const displayName = user.nombre || user.email || 'Usuario';
  const [tip, setTip] = useState<{ anchor: HTMLElement; label: string } | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  // Densidad (ver DENSITIES) y degradé de la lista: el ResizeObserver avisa al
  // observar (antes de pintar) y cada vez que cambia el alto o el modo (rail).
  useLayoutEffect(() => {
    const nav = navRef.current!;
    const list = nav.querySelector<HTMLElement>('.shell-nav-groups')!;
    const edges = () => {
      list.toggleAttribute('data-fade-top', list.scrollTop > 1);
      list.toggleAttribute('data-fade-bottom', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
    };
    const observer = new ResizeObserver(() => {
      for (const value of DENSITIES) {
        nav.dataset.density = value;
        if (list.scrollHeight <= list.clientHeight + 1) break;
      }
      edges();
    });
    observer.observe(nav);
    list.onscroll = edges;
    return () => observer.disconnect();
  }, [items.length]);

  // Lista que scrollea (ventanas muy bajas): el ítem activo siempre a la vista,
  // entero y debajo del relleno (a mano: scrollIntoView movería también el menú).
  useLayoutEffect(() => {
    const list = navRef.current?.querySelector<HTMLElement>('.shell-nav-groups');
    const item = list?.querySelector<HTMLElement>('.shell-nav-item.is-active');
    if (!list || !item || list.scrollHeight <= list.clientHeight + 1) return;
    const pad = parseFloat(getComputedStyle(list).scrollPaddingTop) || 0;
    const box = list.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.top < box.top + pad) list.scrollTop -= box.top + pad - rect.top;
    else if (rect.bottom > box.bottom - pad) list.scrollTop += rect.bottom - (box.bottom - pad);
  }, [active]);

  // El tooltip del rail solo existe si el rail está a la vista (si no, el
  // nombre ya se lee al lado del ícono); Configuración (ícono solo) lo tiene siempre.
  const showTip = (anchor: HTMLElement, label: string) => { if (anchor.matches('[data-nav="rail"] *, .shell-nav-config')) setTip({ anchor, label }); };
  const hideTip = () => setTip(null);

  const itemProps = (item: NavItem) => ({
    onMouseEnter: (event: MouseEvent<HTMLElement>) => { onPrefetch?.(item.key); showTip(event.currentTarget, item.label); },
    onMouseLeave: hideTip,
    onFocus: (event: FocusEvent<HTMLElement>) => { onPrefetch?.(item.key); if (event.currentTarget.matches(':focus-visible')) showTip(event.currentTarget, item.label); },
    onBlur: hideTip,
    onTouchStart: () => onPrefetch?.(item.key)
  });

  const renderItem = (item: NavItem, extra = '') => {
    const Icon = item.Icon;
    const isActive = active === item.key;
    const count = counts[item.key];
    return (
      <button
        key={item.key}
        type="button"
        className={`shell-nav-item${extra}${isActive ? ' is-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-label={count ? `${item.label}, ${count}` : item.label}
        data-view={item.key}
        onClick={() => { hideTip(); onNavigate(item.key); }}
        {...itemProps(item)}
      >
        <span className="shell-nav-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.6} /></span>
        <span className="shell-nav-label">{item.label}</span>
        {count ? <span className="shell-nav-count g-num" aria-hidden="true">{count}</span> : null}
      </button>
    );
  };

  const siteHead = (
    <>
      <TenantLogo className="shell-site-logo" site={siteInfo} />
      <span className="shell-site-text">
        <span className="shell-site-name">{siteInfo?.nombre || activeSite}</span>
        <span className="shell-site-code">{activeSite}</span>
      </span>
    </>
  );

  return (
    <aside className="shell-nav" aria-label="Menú principal" ref={navRef}>
      <div className="shell-nav-head">
        {canSwitchSites ? (
          <button
            type="button"
            className="shell-site"
            aria-label={`Cambiar de sede: ${siteInfo?.nombre || activeSite}`}
            aria-expanded={openStrip === 'sites'}
            aria-controls="shell-strip-sites"
            onClick={event => onToggleStrip('sites', event.currentTarget)}
            onMouseEnter={event => showTip(event.currentTarget, `Sede: ${siteInfo?.nombre || activeSite}`)}
            onMouseLeave={hideTip}
          >
            {siteHead}
            <ChevronsUpDown className="shell-site-chevron" size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
        ) : (
          <div className="shell-site is-static" aria-label={`Sede: ${siteInfo?.nombre || activeSite}`}>{siteHead}</div>
        )}
      </div>

      <div className="shell-nav-search">
        <button
          type="button"
          className="shell-search-btn"
          aria-label="Buscar o ir a una sección (Ctrl K)"
          aria-expanded={openStrip === 'palette'}
          aria-controls="shell-strip-palette"
          onClick={event => onToggleStrip('palette', event.currentTarget)}
          onMouseEnter={event => showTip(event.currentTarget, 'Buscar o ir a… (Ctrl K)')}
          onMouseLeave={hideTip}
        >
          <Search size={14} strokeWidth={1.6} aria-hidden="true" />
          <span className="shell-search-label">Buscar o ir a…</span>
          <kbd className="ui-kbd shell-search-kbd">Ctrl K</kbd>
        </button>
      </div>

      <nav className="shell-nav-groups ui-scroll-fade" aria-label="Secciones">
        {groups.map(group => (
          <div className="shell-nav-group" key={group.key} role="group" aria-label={group.label}>
            <div className="shell-nav-group-label g-eyebrow" aria-hidden="true">{group.label}</div>
            {group.items.map(item => renderItem(item))}
          </div>
        ))}
      </nav>

      {/* Pie: una sola fila (usuario · Configuración · cuenta) para que la
          lista tenga lugar; nunca se superpone a la lista: va debajo, con su borde. */}
      <div className="shell-nav-foot">
        <div className="shell-user">
          <span className="shell-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
          <span className="shell-user-text">
            <span className="shell-user-name">{displayName}</span>
            <span className="shell-user-role">{roleLabel}</span>
          </span>
          {settings && renderItem(settings, ' shell-nav-config')}
          <button
            type="button"
            className="shell-icon-btn shell-user-more"
            aria-label="Opciones de cuenta"
            aria-expanded={openStrip === 'account'}
            aria-controls="shell-strip-account"
            onClick={event => onToggleStrip('account', event.currentTarget)}
            onMouseEnter={event => showTip(event.currentTarget, displayName)}
            onMouseLeave={hideTip}
          >
            <Ellipsis size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
      {/* Al costado: debajo taparía al ítem siguiente del rail. */}
      <Tooltip anchor={tip?.anchor || null} open={Boolean(tip)} placement="right">{tip?.label}</Tooltip>
    </aside>
  );
}

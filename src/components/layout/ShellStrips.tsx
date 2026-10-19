import { useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ExternalLink, LogOut, X } from 'lucide-react';
import type { AuthUser, QuickLink, SiteInfo } from '../../types';
import type { AppNotification } from '../../services/notificationsApi';
import { setAppearance, useAppearance, type ThemePref } from '../../utils/theme';
import { Button } from '../../ui/Button';
import { TruncatedText } from '../../ui/Truncated';
import { groupLinks } from '../tools/quickLinks';
import { plainText, timeAgo } from './notifText';
import { TenantLogo } from './TenantLogo';

/**
 * Franjas en línea debajo de la barra superior (reemplazan a los popovers de
 * accesos rápidos, campana, sede y cuenta). Empujan el contenido; una a la
 * vez; Esc o el botón que la abrió la cierran (lo maneja AppShell).
 */
export function Strip({ id, title, actions, onClose, children, className = '' }: {
  id: string;
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`shell-strip ${className}`.trim()} aria-label={typeof title === 'string' ? title : undefined} data-scanner-ignore="">
      <div className="shell-strip-head">
        <h2 className="shell-strip-title">{title}</h2>
        {actions && <div className="shell-strip-actions">{actions}</div>}
        <button type="button" className="shell-icon-btn" aria-label="Cerrar" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
      <div className="shell-strip-body">{children}</div>
    </section>
  );
}

/* ── Accesos rápidos ─────────────────────────────────────────────────── */

export function QuickStrip({ links, onManage, onClose }: { links: QuickLink[]; onManage?: () => void; onClose: () => void }) {
  const groups = groupLinks(links);
  return (
    <Strip id="shell-strip-quick" title="Accesos rápidos" onClose={onClose} actions={onManage && <Button size="sm" variant="ghost" onClick={onManage}>Administrar</Button>}>
      {!links.length && <p className="shell-strip-empty">Todavía no hay accesos cargados.</p>}
      <div className="shell-quick-groups">
        {groups.map(([categoria, rows]) => (
          <div className="shell-quick-group" key={categoria}>
            <div className="g-eyebrow">{categoria}</div>
            <ul className="shell-quick-list">
              {rows.map(link => (
                <li key={link.id}>
                  <a className="shell-quick-link" href={link.url} target="_blank" rel="noreferrer" onClick={onClose}>
                    <span className="shell-quick-text">
                      <TruncatedText className="shell-quick-title">{link.titulo}</TruncatedText>
                      {link.descripcion && <TruncatedText className="shell-quick-desc">{link.descripcion}</TruncatedText>}
                    </span>
                    <ExternalLink size={14} strokeWidth={1.6} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Strip>
  );
}

/* ── Notificaciones ──────────────────────────────────────────────────── */

const SHOW_FIRST = 6;

export function NotifStrip({ items, unread, onOpen, onMarkAll, onClose }: {
  items: AppNotification[];
  unread: number;
  onOpen: (item: AppNotification) => void;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOW_FIRST);
  return (
    <Strip
      id="shell-strip-notif"
      title={unread ? <>Notificaciones <span className="shell-strip-count g-num">{unread} sin leer</span></> : 'Notificaciones'}
      onClose={onClose}
      actions={unread > 0 && <Button size="sm" variant="ghost" onClick={onMarkAll}>Marcar todas</Button>}
    >
      {items.length === 0 && <p className="shell-strip-empty">No tenés notificaciones.</p>}
      <ul className="shell-notif-list">
        {shown.map(item => (
          // La fila entera abre; el botón (una línea) es el control accesible y
          // el cuerpo va como texto debajo (un botón nunca se parte en renglones).
          <li key={item.id} className={`shell-notif${item.read ? '' : ' is-unread'}`} onClick={() => onOpen(item)}>
            <button type="button" className="shell-notif-title" onClick={event => { event.stopPropagation(); onOpen(item); }}>
              <TruncatedText>{plainText(item.title)}</TruncatedText>
            </button>
            {item.body && <TruncatedText className="shell-notif-body" lines={2}>{plainText(item.body)}</TruncatedText>}
            <span className="shell-notif-meta">
              <span className="g-num">{timeAgo(item.createdAt)}</span>
              {!item.read && <span className="shell-notif-new">sin leer</span>}
            </span>
          </li>
        ))}
      </ul>
      {items.length > SHOW_FIRST && (
        <div className="shell-strip-more">
          <Button size="sm" variant="ghost" onClick={() => setAll(value => !value)}>{all ? 'Ver menos' : `Ver anteriores (${items.length - SHOW_FIRST})`}</Button>
        </div>
      )}
    </Strip>
  );
}

/* ── Cuenta ──────────────────────────────────────────────────────────── */

const THEME_OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' }
];

export function AccountStrip({ user, roleLabel, siteLabel, onSettings, onLogout, onClose }: {
  user: AuthUser;
  roleLabel: string;
  siteLabel: string;
  onSettings?: () => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const { theme } = useAppearance();
  const [leaving, setLeaving] = useState(false);
  return (
    <Strip id="shell-strip-account" title="Tu cuenta" onClose={onClose}>
      <div className="shell-account">
        <dl className="shell-account-facts">
          <div><dt>Usuario</dt><dd><TruncatedText>{user.nombre || user.email}</TruncatedText></dd></div>
          <div><dt>Mail</dt><dd><TruncatedText>{user.email || '-'}</TruncatedText></dd></div>
          <div><dt>Rol</dt><dd>{roleLabel}</dd></div>
          <div><dt>Sede activa</dt><dd><TruncatedText>{siteLabel}</TruncatedText></dd></div>
        </dl>
        <div className="shell-account-side">
          <div className="shell-account-theme">
            <span className="shell-account-label" id="shell-theme-label">Tema</span>
            {/* El tema es una preferencia de la cuenta: vive acá y en Configuración › Apariencia. */}
            <div className="shell-seg" role="group" aria-labelledby="shell-theme-label">
              {THEME_OPTIONS.map(option => (
                <button key={option.value} type="button" className={theme === option.value ? 'is-active' : ''} aria-pressed={theme === option.value} onClick={() => { if (theme !== option.value) setAppearance({ theme: option.value }); }}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="shell-account-actions">
            {onSettings && <Button size="sm" variant="secondary" onClick={onSettings}>Configuración</Button>}
            <Button size="sm" variant="secondary" className="shell-logout" icon={<LogOut size={14} strokeWidth={1.6} />} loading={leaving} loadingLabel="Cerrando…" onClick={() => { setLeaving(true); onLogout(); }}>Cerrar sesión</Button>
          </div>
        </div>
      </div>
    </Strip>
  );
}

/* ── Sede (superadmin con más de una) ───────────────────────────────── */

export function SitesStrip({ sites, activeSite, onPick, onClose }: { sites: SiteInfo[]; activeSite: string; onPick: (code: string) => void; onClose: () => void }) {
  return (
    <Strip id="shell-strip-sites" title="Cambiar de sede" onClose={onClose}>
      <ul className="shell-sites">
        {sites.map(site => {
          const selected = site.siteCode === activeSite;
          return (
            <li key={site.siteCode}>
              <button
                type="button"
                className={`shell-site-option${selected ? ' is-active' : ''}`}
                aria-pressed={selected}
                onClick={() => onPick(site.siteCode)}
                style={site.themeColor ? { '--tenant-accent': site.themeColor } as CSSProperties : undefined}
              >
                <TenantLogo className="shell-site-logo" site={site} />
                <span className="shell-site-text">
                  <TruncatedText className="shell-site-name">{site.nombre || site.subtitulo || 'Sede'}</TruncatedText>
                  <span className="shell-site-code">{site.siteCode}{site.isDefault ? ' · tu sede' : ''}</span>
                </span>
                {selected && <Check size={16} strokeWidth={2} aria-label="Sede activa" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Strip>
  );
}

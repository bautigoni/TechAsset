import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Bell, Check, Download, ExternalLink, LogOut, RefreshCw, X, Zap } from 'lucide-react';
import type { AuthUser, QuickLink, SiteInfo } from '../../types';
import { getLatestRelease, type AppNotification } from '../../services/notificationsApi';
import { applyUpdate, dismissInstall, promptInstall, usePwaState } from '../../services/pwa';
import { setAppearance, useAppearance, type ThemePref } from '../../utils/theme';
import { Button } from '../../ui/Button';
import { TruncatedText } from '../../ui/Truncated';
import { EmptyState } from '../../ui/Data';
import { Collapse } from '../../ui/Collapse';
import { AutoHeight } from '../../ui/Collapse';
import { useScrollEdges } from '../../ui/scrollEdges';
import { StatusLine, clearStatus, useStatusOutlet } from '../../ui/Status';
import { groupLinks } from '../tools/quickLinks';
import { plainText, timeAgo } from './notifText';
import { TenantLogo } from './TenantLogo';

/**
 * Franjas en línea debajo de la barra superior (reemplazan a los popovers de
 * accesos rápidos, campana, sede y cuenta). Viven en la cabecera fija (no en
 * el área que scrollea): siempre se ven sin mover la página, se abren y se
 * cierran con Collapse (alto suave) y el contenido baja animado. Una a la
 * vez; Esc o el botón que la abrió la cierran (lo maneja AppShell). Alto
 * máximo ≈ 40 % de la pantalla: si hay más, el cuerpo scrollea por dentro sin
 * barra y con degradé.
 */
// Lo que se ancla es el contenido de la página (.shell-scroll > main): si
// estabas scrolleado, lo que mirabas queda quieto mientras la franja crece o se
// achica arriba; arriba de todo, el contenido baja animado.
const pageContent = () => document.querySelector<HTMLElement>('.shell-scroll > .shell-main');

export function StripCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <Collapse open={open} appear unmountOnClose anchor={pageContent} reserve="auto" reveal={false} outerClassName="shell-strip-wrap">
      {children}
    </Collapse>
  );
}

export function Strip({ id, title, actions, onClose, children, className = '' }: {
  id: string;
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const bodyRef = useScrollEdges<HTMLDivElement>();
  return (
    <section id={id} className={`shell-strip ${className}`.trim()} aria-label={typeof title === 'string' ? title : undefined} data-scanner-ignore="">
      <div className="shell-strip-head">
        <h2 className="shell-strip-title">{title}</h2>
        {actions && <div className="shell-strip-actions">{actions}</div>}
        <button type="button" className="shell-icon-btn" aria-label="Cerrar" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
      {/* El contenido que cambia con la franja abierta ("Ver anteriores", accesos
          que llegan) cambia de alto suave, nunca de golpe. */}
      <div className="shell-strip-body ui-scroll-fade" ref={bodyRef}><AutoHeight>{children}</AutoHeight></div>
    </section>
  );
}

/* ── Accesos rápidos ─────────────────────────────────────────────────── */

/**
 * Los accesos fluyen en columnas que usan todo el ancho (multicolumna de
 * 240 px): cada grupo arranca con su nombre y sigue en la columna de al lado
 * si no entra; título y descripción hasta 2 renglones (tooltip si igual se
 * cortan). Nunca una columna angosta con media franja vacía.
 */
export function QuickStrip({ open, links, onManage, onClose }: { open: boolean; links: QuickLink[]; onManage?: () => void; onClose: () => void }) {
  const groups = groupLinks(links);
  return (
    <StripCollapse open={open}>
      <Strip id="shell-strip-quick" title="Accesos rápidos" onClose={onClose} actions={onManage && links.length > 0 && <Button size="sm" variant="ghost" onClick={onManage}>Administrar</Button>}>
        {!links.length ? (
          <EmptyState
            compact
            icon={<Zap size={18} strokeWidth={1.6} />}
            title="Todavía no hay accesos cargados."
            description="Sumá los links que más usás: Drive, planillas, la mesa de ayuda."
            action={onManage && <Button size="sm" variant="secondary" onClick={onManage}>Agregar accesos</Button>}
          />
        ) : (
          <div className="shell-quick">
            {groups.map(([categoria, rows]) => (
              <section className="shell-quick-group" key={categoria} aria-label={categoria}>
                <h3 className="g-eyebrow shell-quick-cat">{categoria}</h3>
                <ul className="shell-quick-list">
                  {rows.map(link => (
                    <li key={link.id} className="shell-quick-item">
                      <a className="shell-quick-link" href={link.url} target="_blank" rel="noreferrer" onClick={onClose}>
                        <span className="shell-quick-text">
                          <TruncatedText className="shell-quick-title" lines={2}>{link.titulo}</TruncatedText>
                          {link.descripcion && <TruncatedText className="shell-quick-desc" lines={2}>{link.descripcion}</TruncatedText>}
                        </span>
                        <ExternalLink size={14} strokeWidth={1.6} aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Strip>
    </StripCollapse>
  );
}

/* ── Notificaciones ──────────────────────────────────────────────────── */

const SHOW_FIRST = 6;

export function NotifStrip({ open, items, unread, onOpen, onMarkAll, onClose }: {
  open: boolean;
  items: AppNotification[];
  unread: number;
  onOpen: (item: AppNotification) => void;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOW_FIRST);
  return (
    <StripCollapse open={open}>
    <Strip
      id="shell-strip-notif"
      title={unread ? <>Notificaciones <span className="shell-strip-count g-num">{unread} sin leer</span></> : 'Notificaciones'}
      onClose={onClose}
      actions={unread > 0 && <Button size="sm" variant="ghost" onClick={onMarkAll}>Marcar todas</Button>}
    >
      {items.length === 0 && <EmptyState compact icon={<Bell size={18} strokeWidth={1.6} />} title="No tenés notificaciones." description="Cuando te asignen una tarea, entre un ticket o haya una novedad, aparece acá." />}
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
    </StripCollapse>
  );
}

/* ── Cuenta ──────────────────────────────────────────────────────────── */

// "Sistema" solo no decía nada (QA, no nativo): "Como el sistema" = sigue el modo del celu o la compu.
const THEME_OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Como el sistema' }
];

export function AccountStrip({ open, user, roleLabel, siteLabel, onSettings, onLogout, onClose }: {
  open: boolean;
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
    <StripCollapse open={open}>
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
            <span className="shell-account-label" id="shell-theme-label">Tema de la pantalla</span>
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
    </StripCollapse>
  );
}

/* ── Sede (superadmin con más de una) ───────────────────────────────── */

export function SitesStrip({ open, sites, activeSite, onPick, onClose }: { open: boolean; sites: SiteInfo[]; activeSite: string; onPick: (code: string) => void; onClose: () => void }) {
  return (
    <StripCollapse open={open}>
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
    </StripCollapse>
  );
}

/* ── Línea de estado global (pushStatus) ─────────────────────────────── */

/**
 * La línea de estado de la cabecera entra y sale con alto suave (Collapse),
 * igual que las franjas: un aviso que llega solo (una notificación nueva, un
 * filtro aplicado desde Ctrl K) no empuja la página de golpe; scrolleado, lo
 * que se mira queda quieto. Mientras se pliega se sigue viendo el último aviso.
 */
export function ShellStatus({ installHere = true }: {
  /** "Instalá TechAsset" solo en el Inicio: no ocupa lugar en cada vista ni sobre un formulario. */
  installHere?: boolean;
}) {
  const item = useStatusOutlet();
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);
  const current = item || shown;
  return (
    <>
      <ReleaseStrip />
      <PwaLines installHere={installHere} />
      <StripCollapse open={Boolean(item)}>
        {current && <OutletLine item={current} />}
      </StripCollapse>
    </>
  );
}

/* ── App instalada: sin conexión, versión nueva, instalar ─────────────── */

/**
 * Avisos de la app (src/services/pwa.ts) como líneas fijas de la cabecera: no
 * los pisa un pushStatus de una acción y se van solos cuando dejan de valer.
 */
function PwaLines({ installHere }: { installHere: boolean }) {
  const { offline, updateReady, updating, installable } = usePwaState();
  return (
    <>
      <StripCollapse open={offline}>
        <StatusLine tone="offline" className="shell-status shell-status--offline" autoHideMs={0} message="Sin conexión. Lo que ves puede no estar al día y no se puede guardar nada hasta que vuelva." />
      </StripCollapse>
      <StripCollapse open={updateReady}>
        <div className="ui-status ui-status--info shell-status shell-status--update" role="status">
          <span className="ui-status-icon" aria-hidden="true"><RefreshCw size={14} strokeWidth={1.6} /></span>
          <span className="ui-status-msg">Hay una versión nueva de TechAsset.</span>
          <span className="ui-status-actions">
            <Button size="sm" variant="secondary" loading={updating} loadingLabel="Actualizando…" onClick={applyUpdate}>Actualizar</Button>
          </span>
        </div>
      </StripCollapse>
      {/* Una sola línea (≈52 px): el texto corto y los dos botones al lado. */}
      <StripCollapse open={installable && installHere}>
        <div className="shell-install" role="status">
          <Download className="shell-install-icon" size={16} strokeWidth={1.6} aria-hidden="true" />
          <TruncatedText className="shell-install-msg">Usá TechAsset como app</TruncatedText>
          <Button size="sm" variant="secondary" onClick={() => void promptInstall()}>Instalar</Button>
          <Button size="sm" variant="ghost" onClick={dismissInstall}>Más tarde</Button>
        </div>
      </StripCollapse>
    </>
  );
}

/* ── Novedades (antes un modal): franja en línea la primera vez después de un release ── */

const SEEN_RELEASE_KEY = 'techasset_last_seen_release';
type Release = { version: string; title: string; bodyMd: string };

function readSeenRelease() {
  try { return localStorage.getItem(SEEN_RELEASE_KEY) || ''; } catch { return ''; }
}

function ReleaseStrip() {
  const [release, setRelease] = useState<Release | null>(null);
  const [shown, setShown] = useState<Release | null>(null);
  if (release && release !== shown) setShown(release);

  useEffect(() => {
    let alive = true;
    const load = (force: boolean) => {
      getLatestRelease()
        .then(response => {
          if (!alive || !response.release) return;
          if (!force && readSeenRelease() === response.release.version) return;
          setRelease(response.release);
        })
        .catch(() => { /* sin releases: nada que mostrar */ });
    };
    load(false);
    // La campana (notificación de release) la vuelve a abrir.
    const open = () => load(true);
    window.addEventListener('techasset:open-release-notes', open);
    return () => { alive = false; window.removeEventListener('techasset:open-release-notes', open); };
  }, []);

  const close = () => {
    if (release) {
      try { localStorage.setItem(SEEN_RELEASE_KEY, release.version); } catch { /* sin storage */ }
    }
    setRelease(null);
  };
  const current = release || shown;
  const version = current ? (current.version.startsWith('v') ? current.version : `v${current.version}`) : '';
  return (
    <StripCollapse open={Boolean(release)}>
      {current && (
        <Strip
          id="shell-strip-release"
          className="shell-release"
          title={<>Novedades <span className="shell-strip-count">{version}</span></>}
          actions={<Button size="sm" variant="secondary" onClick={close}>Listo</Button>}
          onClose={close}
        >
          <h3 className="shell-release-title">{current.title}</h3>
          <div className="shell-release-body">
            {parseRelease(current.bodyMd).map((block, index) => (
              block.type === 'heading' ? <h4 key={index}>{block.text}</h4>
                : block.type === 'item' ? <p key={index} className="shell-release-item"><Check size={14} strokeWidth={1.8} aria-hidden="true" />{block.text}</p>
                  : <p key={index}>{block.text}</p>
            ))}
          </div>
        </Strip>
      )}
    </StripCollapse>
  );
}

function parseRelease(markdown: string) {
  return String(markdown || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    const item = line.match(/^[-*+]\s+(.+)/);
    const text = (heading?.[1] || item?.[1] || line)
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\([^)]*\)/g, '$1');
    return { type: heading ? 'heading' : item ? 'item' : 'paragraph', text } as { type: 'heading' | 'item' | 'paragraph'; text: string };
  });
}

function OutletLine({ item }: { item: NonNullable<ReturnType<typeof useStatusOutlet>> }) {
  const { key, ...rest } = item;
  return <StatusLine key={key} {...rest} className="shell-status" onDismiss={() => clearStatus(key)} />;
}

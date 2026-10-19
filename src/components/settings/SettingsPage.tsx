import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../../styles/screens/settings.css';
import type { AuthUser, Operator, SiteInfo, SyncStatus } from '../../types';
import { Button, Collapse, EmptyState, InlineConfirm, releaseScrollReserve } from '../../ui';
import { IconChevronLeft, IconChevronRight } from '../../ui/icons';
import { cx } from '../../ui/util';
import { getInvites, getSiteSettings } from '../../services/authApi';
import { getManagedUsers } from '../../services/settingsApi';
import { appScroller } from '../../utils/scroll';
import { DirtyContext, peekDraft } from './settingsKit';
import { clearRequestedPanel, panelFromPath, peekRequestedPanel, settingsPath, type SettingsPanelKey } from './settingsRoute';
import { AccountPanel } from './AccountPanel';
import { AppearancePanel } from './AppearancePanel';
import { NotificationsPanel } from './NotificationsPanel';
import { ShiftsPanel } from './ShiftsPanel';
import { ModulesPanel } from './ModulesPanel';
import { RolesPanel } from './RolesPanel';
import { UsersPanel } from './UsersPanel';
import { InvitesPanel } from './InvitesPanel';
import { LoanOptionsPanel } from './LoanOptionsPanel';
import { LifecyclePanel } from './LifecyclePanel';
import { SitePanel } from './SitePanel';
import { SitesPanel } from './SitesPanel';
import { MailPanel } from './MailPanel';
import { AdvancedPanel } from './AdvancedPanel';

type Access = 'all' | 'admin' | 'super';
type PanelMeta = { title: string; desc: string; group: 'cuenta' | 'sede' | 'sistema'; access: Access };

const PANELS: Record<SettingsPanelKey, PanelMeta> = {
  cuenta: { title: 'Cuenta', desc: 'Tu usuario, el modo consulta y la sesión.', group: 'cuenta', access: 'all' },
  apariencia: { title: 'Apariencia', desc: 'Cómo se ve TechAsset para vos: tema, densidad y tamaño de texto.', group: 'cuenta', access: 'all' },
  notificaciones: { title: 'Notificaciones', desc: 'Por dónde te avisamos y de qué.', group: 'cuenta', access: 'all' },
  turnos: { title: 'Turnos TIC', desc: 'Quién está a la mañana y quién a la tarde.', group: 'sede', access: 'all' },
  modulos: { title: 'Módulos', desc: 'Qué módulos usa esta sede y en qué orden aparecen en el menú.', group: 'sede', access: 'admin' },
  roles: { title: 'Roles y permisos', desc: 'Qué puede ver y editar cada rol, módulo por módulo.', group: 'sede', access: 'admin' },
  usuarios: { title: 'Usuarios', desc: 'Quién entra a TechAsset y con qué rol. Los pendientes aparecen primero.', group: 'sede', access: 'admin' },
  invitaciones: { title: 'Invitaciones', desc: 'Códigos para que alguien nuevo se registre con su rol ya asignado.', group: 'sede', access: 'admin' },
  prestamo: { title: 'Opciones de préstamo', desc: 'Las listas que aparecen al prestar: quién pide, dónde, para qué.', group: 'sede', access: 'admin' },
  'vida-util': { title: 'Vida útil', desc: 'Cuántos meses se espera que dure cada clase de equipo en esta sede.', group: 'sede', access: 'admin' },
  sede: { title: 'Sede y logo', desc: 'Nombre, logo, color y datos de importación de esta sede.', group: 'sede', access: 'admin' },
  avanzado: { title: 'Avanzado', desc: 'Diagnóstico y edición clave por clave de la configuración de la sede.', group: 'sede', access: 'admin' },
  sedes: { title: 'Sedes', desc: 'Todas las sedes: alta, edición, entrar y código de administrador.', group: 'sistema', access: 'super' },
  mail: { title: 'Mail y SMTP', desc: 'Con qué cuenta salen las invitaciones, los avisos y las credenciales 365.', group: 'sistema', access: 'super' }
};

const ORDER: Record<PanelMeta['group'], SettingsPanelKey[]> = {
  cuenta: ['cuenta', 'apariencia', 'notificaciones'],
  sede: ['turnos', 'modulos', 'roles', 'usuarios', 'invitaciones', 'prestamo', 'vida-util', 'sede', 'avanzado'],
  sistema: ['sedes', 'mail']
};

const NARROW = '(max-width: 719px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(NARROW).matches));
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return;
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export type SettingsPageProps = {
  operator: Operator;
  setOperator: (operator: Operator) => void;
  consultationMode: boolean;
  setConsultationMode: (value: boolean) => void;
  siteRole: string;
  roleReadOnly: boolean;
  /** `access.admin` de roles.config (no el nombre del rol). */
  isSiteAdmin: boolean;
  activeSite: string;
  sync: SyncStatus;
  user: AuthUser;
  sites: SiteInfo[];
  onSitesChanged: () => void | Promise<void>;
  onModulesChanged?: () => void;
  onSwitchSite: (siteCode: string) => void;
  onLogout: () => void | Promise<void>;
};

type Summary = { pending: number; invites: number; roles: number };

/**
 * Configuración: columna de secciones en desktop; en angosto, la lista de
 * secciones y cada una como página con Volver. La URL lleva el panel
 * (`/sede/x/settings/usuarios`), así Atrás/Adelante y los links de los mails
 * abren la sección justa. Todo en línea: nada de modales ni capas.
 */
export function SettingsPage(props: SettingsPageProps) {
  const { user, activeSite, sites, isSiteAdmin, consultationMode } = props;
  const superadmin = user.rolGlobal === 'Superadmin';
  const narrow = useNarrow();
  const site = sites.find(item => item.siteCode === activeSite);

  const canOpen = useCallback((key: SettingsPanelKey) => {
    const access = PANELS[key].access;
    return access === 'all' || (access === 'admin' && isSiteAdmin) || (access === 'super' && superadmin);
  }, [isSiteAdmin, superadmin]);

  const [panel, setPanel] = useState<SettingsPanelKey | null>(() => peekRequestedPanel() || panelFromPath(window.location.pathname));
  const effective: SettingsPanelKey | null = narrow ? panel : panel || 'cuenta';
  const allowed = effective ? canOpen(effective) : true;

  /* ── Cambios sin guardar ── */
  const dirtyRef = useRef(new Set<string>());
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const setDirty = useCallback((key: string, dirty: boolean) => {
    const set = dirtyRef.current;
    if (dirty === set.has(key)) return;
    if (dirty) set.add(key); else set.delete(key);
    setDirtyKeys([...set]);
  }, []);
  const dirtyApi = useMemo(() => ({ setDirty }), [setDirty]);
  useEffect(() => {
    if (!dirtyKeys.length) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyKeys.length]);
  const [leaving, setLeaving] = useState<SettingsPanelKey | 'list' | null>(null);

  /* ── URL ── */
  const contentRef = useRef<HTMLDivElement | null>(null);
  const goTo = useCallback((next: SettingsPanelKey | null, mode: 'push' | 'replace' = 'push') => {
    clearRequestedPanel();
    const path = settingsPath(activeSite, next);
    if (window.location.pathname.toLowerCase() !== path) {
      if (mode === 'push') window.history.pushState({ techasset: true, cfgPanel: Boolean(next) }, '', path);
      else window.history.replaceState({ techasset: true, cfgPanel: Boolean(next) }, '', path);
    }
    releaseScrollReserve();
    setPanel(next);
    setLeaving(null);
    // Cambiar de sección es cambiar de página: si el encabezado quedó arriba de
    // lo visible, se lo trae (sin animación larga).
    requestAnimationFrame(() => {
      const scroller = appScroller();
      const top = contentRef.current?.getBoundingClientRect().top ?? 0;
      const limit = scroller ? scroller.getBoundingClientRect().top : 0;
      if (top < limit && scroller) scroller.scrollBy({ top: top - limit - 8, behavior: 'auto' });
      if (narrow && next) scroller?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }, [activeSite, narrow]);

  const select = (next: SettingsPanelKey | null) => {
    if (next === effective) return;
    if (effective && dirtyRef.current.has(effective)) { setLeaving(next || 'list'); return; }
    goTo(next);
  };

  const back = () => {
    if (effective && dirtyRef.current.has(effective)) { setLeaving('list'); return; }
    if ((window.history.state as { cfgPanel?: boolean } | null)?.cfgPanel) window.history.back();
    else goTo(null, 'replace');
  };

  useEffect(() => {
    const onPop = () => {
      clearRequestedPanel();
      if (!/\/(settings|configuracion)(\/|$)/i.test(window.location.pathname)) return;
      setPanel(panelFromPath(window.location.pathname));
      setLeaving(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Al cambiar de sede el App reescribe la URL a /settings: se vuelve a poner
  // el panel que estaba abierto (después del efecto del App, que corre último).
  useEffect(() => {
    if (!panel) return;
    const timer = window.setTimeout(() => {
      const path = window.location.pathname.toLowerCase();
      if (path === settingsPath(activeSite, null)) window.history.replaceState({ techasset: true, cfgPanel: true }, '', settingsPath(activeSite, panel));
      // Ya quedó en la URL: el pedido (link viejo o de un mail) no hace falta más.
      clearRequestedPanel();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Resumen para la columna (pendientes, invitaciones) ── */
  const [summary, setSummary] = useState<Summary>({ pending: 0, invites: 0, roles: 0 });
  const refreshSummary = useCallback(() => {
    if (!isSiteAdmin) return;
    getManagedUsers().then(r => setSummary(s => ({ ...s, pending: r.items.filter(u => u.status === 'Pendiente').length }))).catch(() => undefined);
    getInvites().then(r => setSummary(s => ({ ...s, invites: (r.items || []).filter(i => i.status === 'Activa').length }))).catch(() => undefined);
    getSiteSettings().then(r => {
      const cfg = r.settings?.['roles.config'];
      setSummary(s => ({ ...s, roles: Array.isArray(cfg) ? cfg.length : 0 }));
    }).catch(() => undefined);
  }, [isSiteAdmin]);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);

  const groups = (['cuenta', 'sede', 'sistema'] as const)
    .map(group => ({ group, items: ORDER[group].filter(canOpen) }))
    .filter(entry => entry.items.length);
  const groupTitle = (group: PanelMeta['group']) => group === 'cuenta' ? 'Tu cuenta' : group === 'sede' ? `Sede ${activeSite}` : 'Sistema';
  const eyebrow = (key: SettingsPanelKey) => {
    const meta = PANELS[key];
    if (meta.group === 'cuenta') return 'Tu cuenta';
    if (meta.group === 'sistema') return 'Sistema · Solo superadmin';
    if (key === 'usuarios' && superadmin) return 'Todas las sedes · Administración';
    return meta.access === 'admin' ? `Sede ${activeSite} · Administración` : `Sede ${activeSite}`;
  };
  const count = (key: SettingsPanelKey): { text: string; warn?: boolean } | null => {
    if (key === 'usuarios' && summary.pending) return { text: `${summary.pending} pend.`, warn: true };
    if (key === 'invitaciones' && summary.invites) return { text: String(summary.invites) };
    if (key === 'roles' && summary.roles) return { text: String(summary.roles) };
    if (key === 'sedes' && superadmin) return { text: String(sites.length) };
    return null;
  };
  // Con cambios en pantalla o con un borrador guardado de antes.
  const isDirty = (key: SettingsPanelKey) => dirtyKeys.includes(key) || peekDraft(key === 'mail' ? 'global:mail' : `${activeSite}:${key}`) !== null;
  const listSummary = (key: SettingsPanelKey) => {
    if (isDirty(key)) return { text: 'Cambios sin guardar', warn: true };
    if (key === 'usuarios' && summary.pending) return { text: `${summary.pending} pendiente${summary.pending === 1 ? '' : 's'} de aprobar`, warn: true };
    if (key === 'invitaciones' && summary.invites) return { text: `${summary.invites} activa${summary.invites === 1 ? '' : 's'}` };
    return { text: PANELS[key].desc };
  };

  const header = (key: SettingsPanelKey) => (actions?: ReactNode) => (
    <header className="cfg-ph">
      {narrow && (
        <Button variant="ghost" size="sm" className="cfg-back" icon={<IconChevronLeft size={16} />} onClick={back}>Configuración</Button>
      )}
      <div className="cfg-ph-t">
        <div className="cfg-eyebrow">{eyebrow(key)}</div>
        <h2 className="cfg-h2">{PANELS[key].title}</h2>
        <p className="cfg-pd">{PANELS[key].desc}</p>
      </div>
      {actions && <div className="cfg-ph-a">{actions}</div>}
    </header>
  );

  const renderPanel = (key: SettingsPanelKey) => {
    const common = { header: header(key), readOnly: consultationMode, siteCode: activeSite };
    switch (key) {
      case 'cuenta': return <AccountPanel {...common} operator={props.operator} user={user} sites={sites} siteRole={props.siteRole} roleReadOnly={props.roleReadOnly} consultationMode={consultationMode} setConsultationMode={props.setConsultationMode} sync={props.sync} onLogout={props.onLogout} />;
      case 'apariencia': return <AppearancePanel header={common.header} />;
      case 'notificaciones': return <NotificationsPanel header={common.header} />;
      case 'turnos': return <ShiftsPanel {...common} />;
      case 'modulos': return <ModulesPanel {...common} onChanged={props.onModulesChanged} />;
      case 'roles': return <RolesPanel {...common} onChanged={() => { props.onModulesChanged?.(); refreshSummary(); }} />;
      case 'usuarios': return <UsersPanel {...common} superadmin={superadmin} sites={sites} onChanged={() => { refreshSummary(); void props.onSitesChanged(); }} />;
      case 'invitaciones': return <InvitesPanel {...common} onChanged={refreshSummary} />;
      case 'prestamo': return <LoanOptionsPanel {...common} />;
      case 'vida-util': return <LifecyclePanel {...common} />;
      case 'sede': return <SitePanel {...common} site={site} superadmin={superadmin} onChanged={props.onSitesChanged} />;
      case 'avanzado': return <AdvancedPanel {...common} onChanged={props.onModulesChanged} />;
      case 'sedes': return <SitesPanel {...common} onSwitchSite={props.onSwitchSite} onChanged={props.onSitesChanged} onEditActive={() => select('sede')} />;
      case 'mail': return <MailPanel {...common} />;
      default: return null;
    }
  };

  // Se abre suave arriba del panel (y, si estabas abajo, te lleva hasta él).
  const leavingConfirm = (
    <Collapse open={Boolean(leaving && effective)} outerClassName="cfg-leave-c" anchor={false}>
      {leaving && effective && (
        <InlineConfirm
          className="cfg-leave"
          message={`Tenés cambios sin guardar en ${PANELS[effective].title}.`}
          detail="Si salís, quedan guardados como borrador hasta que vuelvas a esta sección o los descartes."
          confirmLabel={leaving === 'list' ? 'Salir igual' : `Ir a ${PANELS[leaving].title}`}
          cancelLabel="Seguir editando"
          onConfirm={() => goTo(leaving === 'list' ? null : leaving)}
          onCancel={() => setLeaving(null)}
        />
      )}
    </Collapse>
  );

  const showList = narrow && !effective;

  return (
    <DirtyContext.Provider value={dirtyApi}>
      <section className={cx('view active cfg', narrow && 'is-narrow')} aria-label="Configuración">
        {!narrow && (
          <nav className="cfg-nav" aria-label="Secciones de Configuración">
            {groups.map(({ group, items }) => (
              <div className="cfg-nav-g" key={group}>
                <div className="cfg-nav-gt">{groupTitle(group)}</div>
                {items.map(key => {
                  const c = count(key);
                  const dirty = isDirty(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cx('cfg-nav-i', key === effective && 'is-on')}
                      aria-current={key === effective ? 'page' : undefined}
                      data-panel={key}
                      onClick={() => select(key)}
                    >
                      <span className="cfg-ell">{PANELS[key].title}</span>
                      {dirty ? <span className="cfg-nav-c is-warn">sin guardar</span> : c && <span className={cx('cfg-nav-c', c.warn && 'is-warn')}>{c.text}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {!isSiteAdmin && (
              <p className="cfg-nav-note">Tu usuario tiene acceso a: <span className="cfg-mono">{sites.map(item => item.siteCode).join(', ')}</span>. La administración de la sede la ve quien tenga un rol administrador.</p>
            )}
          </nav>
        )}

        <div className="cfg-main" ref={contentRef}>
          {showList && (
            <div className="cfg-list ui-enter">
              <header className="cfg-ph">
                <div className="cfg-ph-t">
                  <div className="cfg-eyebrow">{site?.nombre || activeSite} · <span className="cfg-mono">{activeSite}</span></div>
                  <h2 className="cfg-h2">Configuración</h2>
                </div>
              </header>
              {groups.map(({ group, items }) => (
                <section className="cfg-list-g" key={group} aria-label={groupTitle(group)}>
                  <div className="cfg-nav-gt">{groupTitle(group)}</div>
                  <div className="cfg-card cfg-list-c">
                    {items.map(key => {
                      const sum = listSummary(key);
                      return (
                        // Link de verdad (es navegación): Ctrl/Cmd+click lo abre en otra pestaña.
                        <a
                          key={key}
                          href={settingsPath(activeSite, key)}
                          className="cfg-list-i"
                          data-panel={key}
                          onClick={event => {
                            if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
                            event.preventDefault();
                            select(key);
                          }}
                        >
                          <span className="cfg-list-t">
                            <span className="cfg-ell cfg-strong">{PANELS[key].title}</span>
                            <span className={cx('cfg-ell cfg-t3', sum.warn && 'is-warn')}>{sum.text}</span>
                          </span>
                          <IconChevronRight size={16} aria-hidden="true" />
                        </a>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!isSiteAdmin && (
                <p className="cfg-hint">Tu usuario tiene acceso a: <span className="cfg-mono">{sites.map(item => item.siteCode).join(', ')}</span>. La administración de la sede la ve quien tenga un rol administrador.</p>
              )}
            </div>
          )}

          {effective && (
            <div className="cfg-panel" key={effective} data-settings-panel={effective}>
              {leavingConfirm}
              {allowed ? renderPanel(effective) : (
                <>
                  {header(effective)()}
                  <EmptyState
                    title="Esta sección es para administradores"
                    description={PANELS[effective].access === 'super' ? 'Solo un superadmin puede abrirla.' : 'Tu rol en esta sede no es administrador. Pedile acceso a quien administre la sede.'}
                    action={<Button onClick={() => goTo(narrow ? null : 'cuenta')}>{narrow ? 'Volver a Configuración' : 'Ir a Cuenta'}</Button>}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </DirtyContext.Provider>
  );
}

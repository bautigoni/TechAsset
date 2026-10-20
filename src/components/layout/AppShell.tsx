import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isViewKey, type AuthUser, type Device, type SiteInfo, type ViewKey } from '../../types';
import type { AssistantContext } from '../../services/assistantApi';
import type { AppNotification } from '../../services/notificationsApi';
import { useNotifications } from '../../hooks/useNotifications';
import { lazyView, prefetchViewsWhenIdle } from '../../utils/lazyView';
import { StatusOutlet, pushStatus } from '../../ui/Status';
import { isEditableTarget } from '../../hooks/useGlobalScanner';
import { useQuickLinks } from '../tools/quickLinks';
import { navItem, type NavItem } from './nav';
import { plainText } from './notifText';
import { Sidebar, type NavCounts } from './Sidebar';
import { Topbar, type StripKey } from './Topbar';

const AssistantPanel = lazyView('assistant', () => import('../assistant/AssistantPanel'), 'AssistantPanel');
// Ctrl K, franjas y "Más": un chunk aparte, precargado en idle (ver abajo).
const loadPanels = () => import('./ShellPanels');
const CommandPalette = lazyView('shell-palette', loadPanels, 'CommandPalette');
const QuickStrip = lazyView('shell-quick', loadPanels, 'QuickStrip');
const NotifStrip = lazyView('shell-notif', loadPanels, 'NotifStrip');
const AccountStrip = lazyView('shell-account', loadPanels, 'AccountStrip');
const SitesStrip = lazyView('shell-sites', loadPanels, 'SitesStrip');
const MoreView = lazyView('shell-more', loadPanels, 'MoreView');
const ShellStatus = lazyView('shell-status', loadPanels, 'ShellStatus');
// La barra inferior solo existe bajo 768 px: en desktop no se baja nunca.
const MobileNav = lazyView('shell-tabbar', loadPanels, 'MobileNav');
const PANEL_CHUNKS = ['shell-tabbar', 'shell-status', 'shell-palette', 'shell-quick', 'shell-notif', 'shell-account', 'shell-sites', 'shell-more'];


const COLLAPSED_KEY = 'techasset_sidebar_collapsed';
const MOBILE_MAX = 767;     // < 768: sin menú lateral, barra inferior
const RAIL_MAX = 1099;      // < 1100: rail de 56 px
const ASST_COLUMN_MIN = 1024; // >= 1024: el asistente es columna; si no, vista propia
// Con el asistente abierto y < 1600 el menú pasa a rail: a 1440 con menú
// completo + columna quedaban ~850 px de contenido y las tablas se cortaban.
const ASST_WIDE_MIN = 1600;

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

/** Ancho del viewport en vivo (solo cambia al cruzar un corte). */
function useWidthBand() {
  const read = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);
  const [width, setWidth] = useState(read);
  useEffect(() => {
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWidth(read())); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  return width;
}

/**
 * Teclado en pantalla abierto (mobile): la barra inferior se esconde para no
 * tapar el campo. Con `interactive-widget=resizes-content` el viewport se
 * achica; se compara con el alto más grande visto y se exige foco en un campo.
 */
function useKeyboardOpen(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) { setOpen(false); return; }
    const vv = window.visualViewport;
    let tallest = vv?.height || window.innerHeight;
    const check = () => {
      const height = vv?.height || window.innerHeight;
      const editing = isEditableTarget(document.activeElement);
      if (!editing) tallest = Math.max(tallest, height);
      setOpen(editing && height < tallest - 120);
    };
    const onOrientation = () => { tallest = 0; window.setTimeout(check, 300); };
    vv?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', onOrientation);
    document.addEventListener('focusin', check);
    const onFocusOut = () => window.setTimeout(check, 50);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      vv?.removeEventListener('resize', check);
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', onOrientation);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [enabled]);
  return open;
}

export type AppShellProps = {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  onPrefetch: (view: ViewKey) => void;
  navItems: NavItem[];
  counts: NavCounts;
  user: AuthUser;
  sites: SiteInfo[];
  activeSite: string;
  onSiteChange: (code: string) => void;
  roleLabel: string;
  consultationMode: boolean;
  impersonating: boolean;
  onExitImpersonation: () => void;
  onLogout: () => Promise<void> | void;
  devices: Device[];
  onJumpToDevice: (device: Device) => void;
  onLoan: (code: string) => void;
  onProfile: (device: Device) => void;
  onScan: () => void;
  assistantContext: AssistantContext;
  assistantCanEdit: boolean;
  onAssistantOpenDevice: (tag: string) => boolean;
  children: ReactNode;
};

/**
 * Caparazón de la app (etapa 2): un solo menú lateral, una sola barra
 * superior, la barra inferior mobile, las franjas en línea (accesos, campana,
 * sede, cuenta y Ctrl K) y el asistente como columna. Todo lo que se abre
 * empuja el contenido; no hay capas flotantes (salvo el tooltip del rail).
 */
export function AppShell(props: AppShellProps) {
  const { view, onNavigate, onPrefetch, navItems, counts, user, sites, activeSite, onSiteChange, roleLabel, consultationMode, impersonating, onExitImpersonation, onLogout, devices, onJumpToDevice, onLoan, onProfile, onScan, assistantContext, assistantCanEdit, onAssistantOpenDevice, children } = props;
  const width = useWidthBand();
  const isMobile = width <= MOBILE_MAX;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [strip, setStrip] = useState<StripKey | null>(null);
  // Desde que se abre la primera franja quedan montadas (vacías si están
  // cerradas) para poder animar el cierre; antes no se monta nada.
  const [stripsOn, setStripsOn] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMounted, setAssistantMounted] = useState(false);
  const [question, setQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScroll = useRef<{ top: number; view: string } | null>(null);
  const viewRef = useRef<string>(view);
  viewRef.current = view;
  const keyboardOpen = useKeyboardOpen(isMobile);
  // Con el teclado abierto el área de contenido se achica: el campo enfocado
  // tiene que seguir a la vista (no tapado por el teclado ni por la cabecera).
  useEffect(() => {
    if (!keyboardOpen) return;
    const field = document.activeElement as HTMLElement | null;
    const scroller = scrollRef.current;
    if (!field || !scroller || !scroller.contains(field)) return;
    const raf = requestAnimationFrame(() => {
      const box = scroller.getBoundingClientRect();
      const rect = field.getBoundingClientRect();
      if (rect.top < box.top || rect.bottom > box.bottom) field.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [keyboardOpen]);
  // Mientras se scrollea con la rueda o el trackpad, el contenido no recibe el
  // puntero (data-scrolling → pointer-events: none en shell.css) y vuelve
  // 150 ms después del último frame de scroll. Con el puntero encima, cada
  // frame movía el :hover de fila en fila: hit-test + repintado +
  // re-"layerizado" de toda la lista (Dispositivos con 387 filas, ver
  // docs/redesign/bench/pasada1.md). Solo si ESTE contenedor scrollea por una
  // rueda reciente: un scroll programático (Collapse que ancla, scrollIntoView)
  // no bloquea clics, y una lista interna que scrollea sola no se toca.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let timer = 0;
    let wheelAt = -Infinity;
    const release = () => { timer = 0; scroller.removeAttribute('data-scrolling'); };
    const onWheel = (event: WheelEvent) => { wheelAt = event.timeStamp; };
    const onScroll = (event: Event) => {
      if (!timer && event.timeStamp - wheelAt > 250) return;
      if (!timer) scroller.setAttribute('data-scrolling', '');
      window.clearTimeout(timer);
      timer = window.setTimeout(release, 150);
    };
    scroller.addEventListener('wheel', onWheel, { passive: true });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      scroller.removeAttribute('data-scrolling');
    };
  }, []);
  const { items: notifications, unread, toast, dismissToast, markRead, markAllRead } = useNotifications(true);
  const { links } = useQuickLinks(activeSite);

  const assistantMode: 'column' | 'view' = width >= ASST_COLUMN_MIN ? 'column' : 'view';
  const assistantColumn = assistantOpen && assistantMode === 'column';
  const assistantView = assistantOpen && assistantMode === 'view';
  const railForced = !isMobile && (width <= RAIL_MAX || (assistantColumn && width < ASST_WIDE_MIN));
  const navMode = isMobile ? 'none' : railForced || collapsed ? 'rail' : 'full';
  const canCollapse = !isMobile && !railForced;
  const canSwitchSites = user.rolGlobal === 'Superadmin' && sites.length > 1;
  const showMore = isMobile && moreOpen;
  const siteInfo = sites.find(site => site.siteCode === activeSite);
  const current = navItem(view);
  const hasQuickAccess = navItems.some(item => item.key === 'quickaccess');

  const closeStrip = useCallback((returnFocus = false) => {
    setStrip(null);
    if (returnFocus && triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
  }, []);

  const toggleStrip = useCallback((key: StripKey, trigger?: HTMLElement | null) => {
    setStripsOn(true);
    setStrip(currentStrip => {
      if (currentStrip === key) return null;
      triggerRef.current = trigger || (document.activeElement as HTMLElement | null);
      // En mobile el asistente ocupa el lugar del contenido: la franja lo reemplaza.
      if (window.innerWidth < ASST_COLUMN_MIN) setAssistantOpen(false);
      // La franja vive en la cabecera fija: se ve siempre, sin mover la página.
      return key;
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(value => {
      const next = !value;
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* sin storage */ }
      return next;
    });
  }, []);

  const openAssistant = useCallback(() => {
    // En la vista propia el contenido se esconde (display:none pierde el
    // scroll): se guarda la posición para volver a ella al cerrar.
    if (window.innerWidth < ASST_COLUMN_MIN && !savedScroll.current) {
      savedScroll.current = { top: scrollRef.current?.scrollTop ?? 0, view: viewRef.current };
    }
    setAssistantMounted(true);
    setAssistantOpen(true);
    setStrip(null);
    setMoreOpen(false);
  }, []);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);

  // Ctrl K y las franjas se precargan en idle: al abrirlas ya están.
  useEffect(() => { prefetchViewsWhenIdle(PANEL_CHUNKS); }, []);

  // La barra inferior existe: lo fijo de abajo (banner de instalar) se corre.
  useEffect(() => {
    document.body.classList.toggle('has-tabbar', isMobile && !keyboardOpen);
    return () => document.body.classList.remove('has-tabbar');
  }, [isMobile, keyboardOpen]);

  // Cambiar de vista o de sede cierra lo que estaba abierto en línea y la
  // vista nueva arranca desde arriba.
  // El alto que un colapso reservó al pie (para no recortar el scroll al cerrar)
  // no puede quedar como hueco al pie de la vista nueva: se suelta al cambiar de
  // vista, de sede o de página (Atrás/Adelante). Por evento, para no sumar el
  // colapso al bundle de arranque.
  useEffect(() => {
    setStrip(null);
    setMoreOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
    window.dispatchEvent(new Event('ui:release-scroll-reserve'));
  }, [view, activeSite]);
  useEffect(() => {
    const release = () => window.dispatchEvent(new Event('ui:release-scroll-reserve'));
    window.addEventListener('popstate', release);
    return () => window.removeEventListener('popstate', release);
  }, []);
  // Al cerrar la vista propia: misma posición (si no cambió la vista) y el
  // foco vuelve al botón Asistente si estaba adentro del panel.
  useLayoutEffect(() => {
    if (assistantView || !savedScroll.current) return;
    const saved = savedScroll.current;
    savedScroll.current = null;
    if (saved.view === view && scrollRef.current) scrollRef.current.scrollTop = saved.top;
  }, [assistantView, view]);
  const wasAssistantOpen = useRef(false);
  useEffect(() => {
    if (wasAssistantOpen.current && !assistantOpen) {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('.asst')) {
        document.querySelector<HTMLElement>('.shell-assistant-btn')?.focus({ preventScroll: true });
      }
    }
    wasAssistantOpen.current = assistantOpen;
  }, [assistantOpen]);
  // En la vista propia (mobile), ir a otra sección cierra el asistente.
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current !== view && assistantMode === 'view') setAssistantOpen(false);
    lastView.current = view;
  }, [view, assistantMode]);

  // Teclado global: Ctrl/Cmd K (paleta), Ctrl B (menú), Esc (franjas y asistente).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && !event.shiftKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        toggleStrip('palette', document.activeElement as HTMLElement | null);
        return;
      }
      if (mod && !event.altKey && !event.shiftKey && (event.key === 'b' || event.key === 'B')) {
        if (isEditableTarget(event.target) || !canCollapse) return;
        event.preventDefault();
        toggleCollapsed();
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (strip) { event.preventDefault(); closeStrip(true); return; }
      if (assistantOpen) { event.preventDefault(); setAssistantOpen(false); return; }
      if (moreOpen) { event.preventDefault(); setMoreOpen(false); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [strip, assistantOpen, moreOpen, canCollapse, closeStrip, toggleStrip, toggleCollapsed]);

  // Notificaciones: abrir una (marca leída y lleva al destino).
  const openNotification = useCallback((item: AppNotification) => {
    if (!item.read) void markRead(item.id);
    if (item.kind.startsWith('release') || item.link === '/release-notes') {
      window.dispatchEvent(new CustomEvent('techasset:open-release-notes'));
      setStrip(null);
      return;
    }
    if (item.link && /^https?:\/\//i.test(item.link)) {
      window.open(item.link, '_blank', 'noopener,noreferrer');
      setStrip(null);
      return;
    }
    const target = linkToView(item.link) || kindToView(item.kind);
    if (target) {
      // Link a algo puntual (/sede/x/tickets/123, /sede/x/tasks/TK1): se deja
      // esa URL y la vista la lee (si ya estaba abierta, relee con popstate).
      const sub = linkSubpath(item.link, target);
      if (sub && window.location.pathname.toLowerCase() !== sub.toLowerCase()) {
        window.history.pushState({ techasset: true }, '', sub);
        if (view === target) window.dispatchEvent(new PopStateEvent('popstate'));
      }
      onNavigate(target);
      setStrip(null);
    }
  }, [markRead, onNavigate, view]);

  // Notificación nueva (nunca en la primera carga): línea de estado bajo la
  // barra, con "Ver", en vez del toast flotante. Se va sola a los 6 s.
  useEffect(() => {
    if (!toast) return;
    const shown = toast;
    pushStatus({
      tone: 'info',
      message: <><b>{plainText(shown.title)}</b>{shown.body ? <> · {plainText(shown.body)}</> : null}</>,
      action: { label: 'Ver', onClick: () => openNotification(shown) },
      autoHideMs: 6000
    });
    dismissToast();
  }, [toast, dismissToast, openNotification]);

  const pickSite = (code: string) => { setStrip(null); if (code !== activeSite) onSiteChange(code); };
  const contextText = view === 'dashboard' ? todayLabel(siteInfo?.nombre) : current?.hint || '';

  return (
    <div
      className={`shell${keyboardOpen ? ' is-kb-open' : ''}`}
      data-nav={navMode}
      data-asst={assistantColumn ? 'column' : assistantView ? 'view' : 'closed'}
    >
      {!isMobile && (
        <Sidebar
          items={navItems}
          active={view}
          onNavigate={onNavigate}
          onPrefetch={onPrefetch}
          counts={counts}
          activeSite={activeSite}
          sites={sites}
          user={user}
          roleLabel={roleLabel}
          canSwitchSites={canSwitchSites}
          openStrip={strip}
          onToggleStrip={toggleStrip}
        />
      )}
      <div className="shell-body">
        <div className="shell-head">
          <Topbar
            title={showMore ? 'Más' : assistantView ? 'Asistente' : current?.label || 'TechAsset'}
            context={showMore || assistantView ? '' : contextText}
            consultationMode={consultationMode}
            user={user}
            unread={unread}
            openStrip={strip}
            onToggleStrip={toggleStrip}
            assistantOpen={assistantOpen}
            onToggleAssistant={() => (assistantOpen ? closeAssistant() : openAssistant())}
            collapsed={navMode === 'rail'}
            canCollapse={canCollapse}
            onToggleCollapsed={toggleCollapsed}
          />
          {impersonating && (
            <div className="shell-banner" role="status">
              <span className="shell-banner-text">Modo superadmin · viendo <b>{siteInfo?.nombre || activeSite}</b></span>
              <button type="button" className="shell-link-btn" onClick={onExitImpersonation}>Salir del modo</button>
            </div>
          )}
          {/* Franjas en línea (accesos, campana, sede, cuenta, Ctrl K): en la
              cabecera fija, se abren y cierran con alto suave (Collapse). */}
          <div className="shell-strips">
          {stripsOn && (
          <Suspense fallback={null}>
            <CommandPalette
              open={strip === 'palette'}
              devices={devices}
              navItems={navItems}
              links={links}
              consultationMode={consultationMode}
              canAsk
              canManageLinks={hasQuickAccess}
              onGoView={onNavigate}
              onJumpToDevice={onJumpToDevice}
              onLoan={onLoan}
              onProfile={onProfile}
              onAsk={text => { setQuestion(current => ({ text, nonce: (current?.nonce || 0) + 1 })); openAssistant(); }}
              onManageLinks={() => onNavigate('quickaccess')}
              onClose={() => closeStrip(true)}
            />
          <QuickStrip open={strip === 'quick'} links={links} onManage={hasQuickAccess ? () => onNavigate('quickaccess') : undefined} onClose={() => closeStrip(true)} />
          <NotifStrip open={strip === 'notif'} items={notifications} unread={unread} onOpen={openNotification} onMarkAll={() => void markAllRead()} onClose={() => closeStrip(true)} />
            <AccountStrip
              open={strip === 'account'}
              user={user}
              roleLabel={roleLabel}
              siteLabel={siteInfo?.nombre ? `${activeSite} · ${siteInfo.nombre}` : activeSite}
              onSettings={navItems.some(item => item.key === 'settings') && view !== 'settings' ? () => onNavigate('settings') : undefined}
              onLogout={() => void onLogout()}
              onClose={() => closeStrip(true)}
            />
          {canSwitchSites && <SitesStrip open={strip === 'sites'} sites={sites} activeSite={activeSite} onPick={pickSite} onClose={() => closeStrip(true)} />}
          </Suspense>
          )}
          </div>
          {/* Línea de estado global: entra y sale con alto suave (hasta que llega el chunk, la simple). */}
          <Suspense fallback={<StatusOutlet className="shell-status" />}><ShellStatus /></Suspense>
        </div>

        {/* Lo único que scrollea: el contenido. La barra superior (con sus
            franjas), el menú, la columna del asistente y la barra inferior
            quedan quietos y nunca se superponen al contenido. */}
        <div className="shell-scroll" ref={scrollRef} hidden={assistantView}>
        <main className="shell-main" id="main">
          {stripsOn && (
            <Suspense fallback={null}>
            <MoreView
              open={showMore}
              items={navItems}
              active={view}
              onNavigate={next => { setMoreOpen(false); onNavigate(next); }}
              onPrefetch={onPrefetch}
              counts={counts}
              user={user}
              roleLabel={roleLabel}
              sites={sites}
              activeSite={activeSite}
              canSwitchSites={canSwitchSites}
              onOpenSites={() => toggleStrip('sites')}
              onOpenPalette={() => toggleStrip('palette')}
              onOpenAccount={() => toggleStrip('account')}
            />
            </Suspense>
          )}
          <div className="shell-view">{children}</div>
        </main>
        </div>

        {assistantMounted && (
          <Suspense fallback={null}>
            <AssistantPanel
              open={assistantOpen}
              onClose={closeAssistant}
              mode={assistantMode}
              backLabel={`Volver a ${current?.label || 'la vista'}`}
              currentView={view}
              onNavigate={next => { if (isViewKey(next)) onNavigate(next); }}
              onOpenDevice={onAssistantOpenDevice}
              canEdit={assistantCanEdit}
              context={assistantContext}
              question={question}
            />
          </Suspense>
        )}
      </div>

      {isMobile && (
        <Suspense fallback={<nav className="shell-tabbar" aria-hidden="true" />}>
        <MobileNav
          items={navItems}
          active={view}
          moreOpen={moreOpen}
          onNavigate={next => { setMoreOpen(false); setAssistantOpen(false); onNavigate(next); }}
          onPrefetch={onPrefetch}
          onScan={() => { setMoreOpen(false); setAssistantOpen(false); onScan(); }}
          onToggleMore={() => { setAssistantOpen(false); setStrip(null); setStripsOn(true); setMoreOpen(value => !value); }}
          counts={counts}
        />
        </Suspense>
      )}
    </div>
  );
}

function kindToView(kind: string): ViewKey | null {
  if (kind.startsWith('task')) return 'tasks';
  if (kind.startsWith('ticket')) return 'tickets';
  if (kind.startsWith('suggestion')) return 'suggestions';
  return null;
}

/** `/sede/x/<vista>` o `/<vista>` → vista (misma lista que la URL de App). */
export function linkToView(link: string): ViewKey | null {
  const clean = String(link || '').split('?')[0].replace(/\/+$/, '');
  const match = clean.match(/\/sede\/[^/]+\/([^/]+)(?:\/.*)?$/);
  const candidate = match?.[1] || clean.replace(/^\//, '');
  return isViewKey(candidate) ? candidate : null;
}

/** `/sede/<sede>/<vista>/<algo>` de un link de notificación (o '' si apunta a la vista sola). */
function linkSubpath(link: string, view: ViewKey) {
  const clean = String(link || '').split('?')[0].replace(/\/+$/, '');
  const match = clean.match(/^\/sede\/([^/]+)\/([^/]+)\/(.+)$/);
  return match && match[2] === view ? `/sede/${match[1].toLowerCase()}/${match[2]}/${match[3]}` : '';
}

const DATE_FMT = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }) : null;
function todayLabel(siteName?: string) {
  const date = DATE_FMT ? DATE_FMT.format(new Date()) : '';
  const text = date ? date.charAt(0).toUpperCase() + date.slice(1) : '';
  return [text, siteName].filter(Boolean).join(' · ');
}

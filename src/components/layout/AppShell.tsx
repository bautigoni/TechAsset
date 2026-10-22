import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isViewKey, type AuthUser, type Device, type SiteInfo, type ViewKey } from '../../types';
import type { AssistantContext } from '../../services/assistantApi';
import type { AppNotification } from '../../services/notificationsApi';
import { useNotifications } from '../../hooks/useNotifications';
import { lazyView, prefetchView, prefetchViewsWhenIdle } from '../../utils/lazyView';
import { getDeviceStateKey } from '../../utils/deviceState';
import { pushStatus } from '../../ui/Status';
import { isEditableTarget } from '../../hooks/useGlobalScanner';
import { useQuickLinks } from '../tools/quickLinks';
import { navItem, type NavItem } from './nav';
import { plainText } from './notifText';
import { cameraBlocker, cameraBlockerText, focusLoanCode } from './scanCamera';
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
// "Más" (mobile) tiene su entrada en el historial: Atrás lo cierra.
const MORE_HASH = '#mas';
const moreInUrl = () => typeof window !== 'undefined' && window.location.hash === MORE_HASH;

/** Equipos reales de la sede para los ejemplos (asistente, Escanear): nunca uno inventado. */
export type DeviceExamples = { free?: string; freeTag?: string; loaned?: string; loanedTag?: string };
function deviceExamples(devices: Device[]): DeviceExamples {
  const label = (device?: Device) => device ? (device.aliasOperativo || device.etiqueta) : undefined;
  const free = devices.find(device => getDeviceStateKey(device) === 'available' && device.etiqueta);
  const loaned = devices.find(device => getDeviceStateKey(device) === 'loaned' && device.etiqueta);
  return { free: label(free), freeTag: free?.etiqueta, loaned: label(loaned), loanedTag: loaned?.etiqueta };
}

/** Duración de la entrada/salida de paneles (--g-dur-panel; 0 con movimiento reducido). */
function panelMs() {
  if (typeof window === 'undefined') return 0;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--g-dur-panel').trim();
  const n = parseFloat(value);
  return Number.isFinite(n) ? (value.endsWith('ms') ? n : n * 1000) : 240;
}

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
  const [stripsOn, setStripsOn] = useState(() => isMobile && moreInUrl());
  // Recargar con /…#mas en el celu vuelve a "Más" (la entrada ya está en el historial).
  const [moreOpen, setMoreOpen] = useState(() => isMobile && moreInUrl() && Boolean(window.history.state?.more));
  // Al volver con Atrás/Adelante a una entrada de "Más", el cambio de vista no la cierra.
  const moreFromPop = useRef(false);
  // Lo que se hace al salir de "Más" con Atrás (ir a otra sección, escanear): después del popstate.
  const afterMorePop = useRef<(() => void) | null>(null);
  const [viewReturning, setViewReturning] = useState(false);

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMounted, setAssistantMounted] = useState(false);
  // Entrada y salida suaves: el asistente queda dibujado mientras se va
  // ('closing') y entra desde un primer cuadro cerrado ('enter'). Lo lógico
  // (abierto/cerrado) cambia al toque; lo que se ve, con la transición.
  const [assistantSettled, setAssistantSettled] = useState<'open' | 'closed'>('closed');
  const assistantPhase: 'enter' | 'open' | 'closing' | 'closed' = assistantOpen
    ? (assistantSettled === 'open' ? 'open' : 'enter')
    : (assistantSettled === 'open' ? 'closing' : 'closed');
  // Al volver de la vista propia (mobile) el contenido entra con un fundido corto.
  const [assistantReturning, setAssistantReturning] = useState(false);
  const [question, setQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const veilRef = useRef<HTMLDivElement | null>(null);
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
  // puntero y vuelve 150 ms después del último frame de scroll. Con el puntero
  // encima, cada frame movía el :hover de fila en fila y hacía un hit-test de
  // toda la lista (Dispositivos con 387 filas, ver docs/redesign/bench/pasada1.md).
  // Lo toma un velo invisible (primer hijo de .shell-scroll, sticky, del alto
  // del área visible): el hit-test termina en él y la rueda sigue scrolleando
  // este contenedor. Antes era `pointer-events: none` sobre el contenido, pero
  // se hereda: prenderlo y apagarlo recalculaba el estilo de cada nodo (~16.000
  // en Dispositivos: 1,3 a 2 s con CPU 4×, el "peor frame" de 736 ms del scroll
  // en la suite, al empezar y al terminar cada gesto). Ver bench/pasada3.md.
  // Solo si ESTE contenedor scrollea por una rueda reciente: un scroll
  // programático (Collapse que ancla, scrollIntoView) no bloquea clics, y una
  // lista interna que scrollea sola no se toca.
  useEffect(() => {
    const scroller = scrollRef.current;
    const veil = veilRef.current;
    if (!scroller || !veil) return;
    let timer = 0;
    let wheelAt = -Infinity;
    const release = () => { timer = 0; veil.hidden = true; };
    const onWheel = (event: WheelEvent) => { wheelAt = event.timeStamp; };
    const onScroll = (event: Event) => {
      if (!timer && event.timeStamp - wheelAt > 250) return;
      if (!timer) {
        // Del alto del área visible, sin ocupar lugar (margen negativo igual).
        const height = scroller.clientHeight;
        veil.style.height = `${height}px`;
        veil.style.marginBottom = `${-height}px`;
        veil.hidden = false;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(release, 150);
    };
    scroller.addEventListener('wheel', onWheel, { passive: true });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      veil.hidden = true;
    };
  }, []);
  const { items: notifications, unread, toast, dismissToast, markRead, markAllRead } = useNotifications(true);
  const { links } = useQuickLinks(activeSite);

  const assistantMode: 'column' | 'view' = width >= ASST_COLUMN_MIN ? 'column' : 'view';
  // Dibujado (incluye la salida); el menú pasa a rail solo mientras está abierto de verdad.
  const assistantShown = assistantPhase !== 'closed';
  const assistantColumn = assistantShown && assistantMode === 'column';
  const assistantView = assistantShown && assistantMode === 'view';
  // El menú se angosta en el MISMO cuadro en que la columna empieza a crecer
  // ('open', no 'enter') y vuelve en el mismo en que empieza a achicarse
  // ('closing'): con la misma duración y curva, el ancho del contenido va
  // derecho de uno al otro. Si el menú arrancaba dos cuadros antes, el
  // contenido primero se ensanchaba y después se angostaba (re-acomodo doble).
  const railForced = !isMobile && (width <= RAIL_MAX || (assistantPhase === 'open' && assistantMode === 'column' && width < ASST_WIDE_MIN));
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

  /* ── "Más" (mobile) con su entrada en el historial ───────────────────
     Abrir suma `#mas` a la URL (pushState); cerrarlo sin ir a otro lado es
     Atrás (así el botón Atrás del celu lo cierra y no queda una entrada de
     más). Ir a otra sección desde "Más" primero saca esa entrada y después
     navega: Atrás desde la sección nueva vuelve a la vista de antes. */
  const savedMoreScroll = useRef<{ top: number; view: string } | null>(null);
  const openMore = useCallback(() => {
    // El contenido se oculta mientras "Más" está abierto: se guarda dónde estabas.
    savedMoreScroll.current = { top: scrollRef.current?.scrollTop ?? 0, view: viewRef.current };
    if (!moreInUrl()) {
      const { pathname, search } = window.location;
      window.history.pushState({ ...(window.history.state || {}), techasset: true, more: true }, '', `${pathname}${search}${MORE_HASH}`);
    }
    setStripsOn(true);
    setStrip(null);
    setMoreOpen(true);
  }, []);
  const closeMore = useCallback((then?: () => void) => {
    setMoreOpen(false);
    if (moreInUrl() && window.history.state?.more) {
      afterMorePop.current = then || null;
      window.history.back();
      return;
    }
    if (moreInUrl()) {
      // Entrada sin estado propio (link pegado con #mas): solo se limpia la URL.
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    }
    then?.();
  }, []);
  useEffect(() => {
    const onPop = () => {
      const more = moreInUrl() && Boolean(window.history.state?.more);
      moreFromPop.current = true;
      window.setTimeout(() => { moreFromPop.current = false; }, 400);
      setMoreOpen(more && window.innerWidth <= MOBILE_MAX);
      const then = afterMorePop.current;
      afterMorePop.current = null;
      // Después de que App relea la URL (mismo popstate): recién ahí se navega.
      if (then) window.setTimeout(then, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Pasar a desktop con "Más" abierto: se cierra (y su entrada se va).
  useEffect(() => {
    if (!isMobile && moreOpen) closeMore();
  }, [isMobile, moreOpen, closeMore]);
  // "Más" arranca arriba; al cerrarlo (sin cambiar de vista) se vuelve a donde estabas.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (showMore) { scroller.scrollTop = 0; return; }
    const saved = savedMoreScroll.current;
    savedMoreScroll.current = null;
    if (saved && saved.view === viewRef.current) scroller.scrollTop = saved.top;
  }, [showMore]);
  // La vista vuelve con un fundido corto al cerrar "Más" (no de golpe).
  const wasMoreOpen = useRef(moreOpen);
  useEffect(() => {
    if (wasMoreOpen.current && !moreOpen) {
      wasMoreOpen.current = false;
      setViewReturning(true);
      const timer = window.setTimeout(() => setViewReturning(false), panelMs() + 40);
      // El foco vuelve al botón "Más" si estaba adentro (o se perdió).
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('#shell-more')) {
        document.querySelector<HTMLElement>('.shell-tab[aria-controls="shell-more"]')?.focus({ preventScroll: true });
      }
      return () => window.clearTimeout(timer);
    }
    wasMoreOpen.current = moreOpen;
    return undefined;
  }, [moreOpen]);

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
    if (moreInUrl()) closeMore();
    else setMoreOpen(false);
  }, [closeMore]);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
  // El panel baja apenas el usuario apunta al botón: el primer toque ya abre animado.
  const assistantIntent = useCallback(() => prefetchView('assistant'), []);

  const examples = useMemo(() => deviceExamples(devices), [devices]);
  const examplesRef = useRef(examples);
  examplesRef.current = examples;
  // "Escanear" (barra inferior): en touch abre la cámara de Préstamos. Si no hay
  // cámara que se pueda usar (no existe, el navegador la bloqueó o la dirección
  // no la permite), no se intenta: va a Préstamos con el foco en el campo y una
  // línea de estado en criollo que se va sola (no queda un panel pegado).
  const scanBusy = useRef(false);
  const scan = useCallback(async () => {
    if (scanBusy.current) return;
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    if (!touch || consultationMode) { onScan(); return; }
    scanBusy.current = true;
    try {
      const blocked = await cameraBlocker();
      if (!blocked) { onScan(); return; }
      onNavigate('loans');
      focusLoanCode();
      pushStatus({ tone: 'info', message: cameraBlockerText(blocked, examplesRef.current.free || ''), autoHideMs: 9000 });
    } finally {
      scanBusy.current = false;
    }
  }, [consultationMode, onNavigate, onScan]);

  // Fases de la entrada/salida (ver assistantPhase). Entrar: dos cuadros en
  // 'enter' (cerrado) y recién ahí 'open', así la transición arranca de 0.
  // Salir: 'closing' dura lo que la transición; en la vista propia es al toque.
  useEffect(() => {
    if (assistantOpen && assistantSettled !== 'open') {
      let second = 0;
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setAssistantSettled('open')); });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }
    if (!assistantOpen && assistantSettled === 'open') {
      const timer = window.setTimeout(() => setAssistantSettled('closed'), assistantMode === 'view' ? 0 : panelMs());
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [assistantOpen, assistantSettled, assistantMode]);
  // Volver de la vista propia: el contenido aparece con un fundido (no de golpe).
  const wasAssistantView = useRef(false);
  useEffect(() => {
    if (wasAssistantView.current && !assistantView) {
      setAssistantReturning(true);
      const timer = window.setTimeout(() => setAssistantReturning(false), panelMs() + 40);
      wasAssistantView.current = assistantView;
      return () => window.clearTimeout(timer);
    }
    wasAssistantView.current = assistantView;
    return undefined;
  }, [assistantView]);

  // Ctrl K y las franjas se precargan en idle: al abrirlas ya están.
  useEffect(() => { prefetchViewsWhenIdle(PANEL_CHUNKS); }, []);

  // La línea de estado completa (versión nueva, sin conexión, novedades) vive
  // en el chunk de las franjas: se pide un frame después del primer pintado.
  // Pedirla en el primer render metía la precarga de ese chunk (~9 ms con CPU
  // 4×) antes del primer pintado; los avisos de pushStatus que lleguen antes
  // esperan en el store.
  const [statusOn, setStatusOn] = useState(false);
  useEffect(() => {
    let timer = 0;
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setStatusOn(true), 0); });
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, []);

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
  // (Volver con Atrás a una entrada de "Más" no la cierra: la abre el popstate.)
  const firstViewEffect = useRef(true);
  useEffect(() => {
    setStrip(null);
    if (!firstViewEffect.current && !moreFromPop.current) setMoreOpen(false);
    firstViewEffect.current = false;
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
      if (moreOpen) { event.preventDefault(); closeMore(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [strip, assistantOpen, moreOpen, canCollapse, closeStrip, closeMore, toggleStrip, toggleCollapsed]);

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
      data-asst-phase={assistantReturning ? 'returning' : assistantPhase}
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
            onAssistantIntent={assistantIntent}
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
          {/* Línea de estado global: entra y sale con alto suave. Sin fallback: un aviso que llega antes
              que el chunk (precargado en idle, pedido después del primer pintado) espera en el store y
              entra animado, nunca de golpe. */}
          {statusOn && <Suspense fallback={null}><ShellStatus installHere={view === 'dashboard' && !showMore && !assistantView && !keyboardOpen} /></Suspense>}
        </div>

        {/* Lo único que scrollea: el contenido. La barra superior (con sus
            franjas), el menú, la columna del asistente y la barra inferior
            quedan quietos y nunca se superponen al contenido. */}
        <div className="shell-scroll" ref={scrollRef} hidden={assistantView}>
        <div className="shell-scroll-veil" ref={veilRef} aria-hidden="true" hidden />
        <main className="shell-main" id="main">
          {stripsOn && (
            <Suspense fallback={null}>
            <MoreView
              open={showMore}
              items={navItems}
              active={view}
              onNavigate={next => closeMore(() => onNavigate(next))}
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
          {/* Con "Más" abierto la vista queda oculta (montada: no pierde lo escrito). */}
          <div className={`shell-view${viewReturning ? ' is-returning' : ''}`} hidden={showMore}>{children}</div>
        </main>
        </div>

        {assistantMounted && (
          <Suspense fallback={null}>
            <AssistantPanel
              open={assistantOpen}
              shown={assistantShown}
              onClose={closeAssistant}
              mode={assistantMode}
              backLabel={`Volver a ${current?.label || 'la vista'}`}
              currentView={view}
              onNavigate={next => { if (isViewKey(next)) onNavigate(next); }}
              onOpenDevice={onAssistantOpenDevice}
              canEdit={assistantCanEdit}
              context={assistantContext}
              question={question}
              examples={examples}
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
          onNavigate={next => { setAssistantOpen(false); closeMore(() => onNavigate(next)); }}
          onPrefetch={onPrefetch}
          onScan={() => { setAssistantOpen(false); closeMore(() => void scan()); }}
          onToggleMore={() => { setAssistantOpen(false); if (moreOpen) closeMore(); else openMore(); }}
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

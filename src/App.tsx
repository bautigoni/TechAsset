import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isViewKey, type AuthUser, type Device, type Movement, type SiteInfo, type ViewKey } from './types';
import { AppShell } from './components/layout/AppShell';
import { navItem, visibleNavItems } from './components/layout/nav';
import { SkeletonView } from './components/layout/Skeleton';
import { useGlobalScanner } from './hooks/useGlobalScanner';
import { clearStatus, pushStatus } from './ui/Status';
import { getOperationalAlias } from './utils/classifyDevice';
import { applyServerAppearance } from './utils/theme';
import { getUserPrefs } from './services/userPrefsApi';
import { lazyView, prefetchView, prefetchViewsWhenIdle } from './utils/lazyView';
import { useOperator } from './hooks/useOperator';
import { useDevices } from './hooks/useDevices';
import { useAgenda } from './hooks/useAgenda';
import { useTasks } from './hooks/useTasks';
import { useScrollReveal } from './hooks/useScrollReveal';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { addDevice, deleteDevice, getMovements } from './services/devicesApi';
import { lendDevice, lendDevicesBatch, returnDevice, returnDevicesBatch, type LoanBatchResponse } from './services/loansApi';
import { createTask } from './services/tasksApi';
import { getAuthSession, getSiteSettings, logout as logoutSession } from './services/authApi';
import { setActiveSiteCode } from './services/activeSite';
import { clearApiCache, SESSION_EXPIRED_EVENT } from './services/apiClient';
import { activeSiteRole, isSuperadmin, roleAccess } from './utils/permissions';
import { resolveDeviceMatches } from './utils/normalizeSearch';
import type { AssistantContext } from './services/assistantApi';
import { isSettingsAlias, panelFromPath, requestSettingsPanel } from './components/settings/settingsRoute';
import { PUBLIC_PAGE_EVENT, readPublicPageFromUrl, type PublicPageKind } from './components/auth/publicRoutes';
import { clearPersonalData } from './services/personalData';

// Cada vista viaja en su propio chunk: el bundle inicial baja de ~570 kB a lo que
// hace falta para pintar el dashboard. Los chunks del resto se precargan en idle
// (ver prefetchViewsWhenIdle más abajo), así el cambio de vista sigue siendo
// instantáneo. La clave del lazyView es la ViewKey para poder prefetchear por nav.
const Dashboard = lazyView('dashboard', () => import('./components/dashboard/Dashboard'), 'Dashboard');
const DevicesPage = lazyView('devices', () => import('./components/devices/DevicesPage'), 'DevicesPage');
const LoansPage = lazyView('loans', () => import('./components/loans/LoansPage'), 'LoansPage');
const HistoryPage = lazyView('history', () => import('./components/history/HistoryPage'), 'HistoryPage');
const InventoryPage = lazyView('inventory', () => import('./components/inventory/InventoryPage'), 'InventoryPage');
const AnalyticsPage = lazyView('analytics', () => import('./components/analytics/AnalyticsPage'), 'AnalyticsPage');
const AgendaPage = lazyView('agenda', () => import('./components/agenda/AgendaPage'), 'AgendaPage');
const SchedulesPage = lazyView('schedules', () => import('./components/schedules/SchedulesPage'), 'SchedulesPage');
const TasksPage = lazyView('tasks', () => import('./components/tasks/TasksPage'), 'TasksPage');
const PettyCashPage = lazyView('pettycash', () => import('./components/pettycash/PettyCashPage'), 'PettyCashPage');
const SuggestionsPage = lazyView('suggestions', () => import('./components/suggestions/SuggestionsPage'), 'SuggestionsPage');
const ClassroomStatusPage = lazyView('classrooms', () => import('./components/classrooms/ClassroomStatusPage'), 'ClassroomStatusPage');
const ToolsPage = lazyView('tools', () => import('./components/tools/ToolsPage'), 'ToolsPage');
const QuickAccessPage = lazyView('quickaccess', () => import('./components/tools/QuickAccessPage'), 'QuickAccessPage');
const TicketsPage = lazyView('tickets', () => import('./components/tickets/TicketsPage'), 'TicketsPage');
const KnowledgePage = lazyView('knowledge', () => import('./components/knowledge/KnowledgePage'), 'KnowledgePage');
const CanvasPage = lazyView('canvas', () => import('./components/canvas/CanvasPage'), 'CanvasPage');
const RemindersPage = lazyView('reminders', () => import('./components/reminders/RemindersPage'), 'RemindersPage');
const SettingsPage = lazyView('settings', () => import('./components/settings/SettingsPage'), 'SettingsPage');
const UiShowcase = lazyView('ui', () => import('./ui/Showcase'), 'Showcase');
// Fuera del nav: modales y pantallas de auth. La landing solo la ve quien no
// tiene sesión, así que no tiene por qué pesar en el bundle del que ya entró.
const LoginPage = lazyView('login', () => import('./components/auth/LoginPage'), 'LoginPage');
const LandingPage = lazyView('landing', () => import('./components/auth/LandingPage'), 'LandingPage');
// Privacidad y "Esta página no existe": se ven con o sin sesión, fuera del shell.
const PublicPage = lazyView('public', () => import('./components/auth/PublicPages'), 'PublicPage');

// La sesión se pide apenas se evalúa este módulo, antes del primer render: así
// sale ANTES que agenda, tareas y turnos (que se piden en los efectos de sus
// hooks) y el server, que atiende de a un pedido, la contesta primero. Sin
// sesión recordada es lo único que frena el primer pintado de la app.
let bootSession: ReturnType<typeof getAuthSession> | null = typeof window !== 'undefined' ? getAuthSession() : null;
// Marcado como atendido: si falla antes del primer render no es un rechazo sin manejar
// (el efecto de la sesión igual recibe el error y lo trata).
bootSession?.catch(() => undefined);
// (El chunk de la pantalla de entrada se pide al final del módulo, bootPrefetch.)

export function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [authMode, setAuthMode] = useState<'landing' | 'login' | 'register'>(() => readAuthModeFromUrl());
  // Privacidad / página inexistente (con o sin sesión): se pinta sin esperar la sesión.
  const [publicPage, setPublicPage] = useState<PublicPageKind | null>(() => readPublicPageFromUrl());
  // Adónde volver después de ingresar: el link con el que se llegó sin sesión
  // (/sede/nfpt/tasks/12, un mail, una notificación) o la vista en la que
  // estaba cuando venció la sesión. El login muestra "Entrás a <sede>".
  const [returnTo, setReturnTo] = useState(() => (/^\/sede\/[^/]+/i.test(window.location.pathname) ? window.location.pathname : ''));
  const [search, setSearch] = useState('');
  // Etiqueta a resaltar (Ctrl K → "ir a la fila"); el nonce repite el salto.
  const [highlight, setHighlight] = useState<{ tag: string; nonce: number } | null>(null);
  // "Escanear" de la barra inferior: abre Préstamos con la cámara / el foco.
  const [scanRequest, setScanRequest] = useState(0);
  const [assistantContext, setAssistantContext] = useState<AssistantContext | null>(null);
  const [consultationMode, setConsultationMode] = useState(false);
  // La ficha de un equipo ya no es un modal: es su página en Dispositivos
  // (/sede/x/devices/D1436). `edit` la abre en modo edición.
  const [devicePage, setDevicePage] = useState<{ tag: string; edit?: boolean } | null>(() => {
    const tag = readDeviceTagFromUrl();
    return tag ? { tag } : null;
  });
  const [loanSeed, setLoanSeed] = useState('');
  // Lote elegido en Dispositivos para prestar: llega a la lista del formulario.
  const [loanBatchSeed, setLoanBatchSeed] = useState<{ etiquetas: string[]; nonce: number } | undefined>();
  // Lector USB estando en el Inicio: cae en su barra de acción.
  const [dashScan, setDashScan] = useState<{ code: string; nonce: number } | undefined>();
  const [movements, setMovements] = useState<Movement[]>([]);
  // En la landing, sin sesión recordada ni la pista de sesión (cookie
  // techasset_signed_in, no es credencial) no hay nada que esperar: se pinta
  // ya y /api/auth/session confirma por detrás (si igual había sesión, entra).
  const [authLoading, setAuthLoading] = useState(() => !(window.location.pathname === '/' && !hasSessionHint() && !readSessionCache()));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [activeSite, setActiveSite] = useState('');
  const [siteSettings, setSiteSettings] = useState<Record<string, unknown> | null>(null);
  const { operator, setOperator } = useOperator();
  const { devices, filteredDevices, counts, sync, refresh, removeLocal } = useDevices(search, activeSite);
  // Sin sesión no se pide ni se pollea nada protegido (antes la landing pedía
  // agenda, tareas, turnos y movimientos y se comía cuatro 401 cada 15-30 s).
  const signedIn = Boolean(user);
  const agenda = useAgenda(operator, signedIn);
  const tasks = useTasks(operator, signedIn);
  useScrollReveal([view, filteredDevices.length, agenda.items.length, tasks.items.length, movements.length]);

  useEffect(() => {
    const setContext = (event: Event) => setAssistantContext((event as CustomEvent<AssistantContext>).detail || null);
    const clearContext = (event: Event) => setAssistantContext(current => {
      const detail = (event as CustomEvent<AssistantContext>).detail;
      return current?.type === detail?.type && current?.id === detail?.id ? null : current;
    });
    window.addEventListener('techasset:assistant-context', setContext);
    window.addEventListener('techasset:assistant-context-clear', clearContext);
    return () => { window.removeEventListener('techasset:assistant-context', setContext); window.removeEventListener('techasset:assistant-context-clear', clearContext); };
  }, []);

  useEffect(() => {
    const fromUrl = readSiteFromUrl();
    const fromView = readViewFromUrl();
    if (fromView) setView(fromView);

    // Elegir sede: la de la URL si el usuario la tiene, si no su default.
    const aplicarSesion = (usuario: AuthUser, sedes: SiteInfo[]) => {
      setUser(usuario);
      setSites(sedes);
      const allowed = fromUrl ? sedes.find(site => site.siteCode.toLowerCase() === fromUrl.toLowerCase()) : null;
      const fallback = sedes.find(site => site.isDefault) || sedes[0];
      const site = allowed || fallback;
      if (fromUrl && !allowed) setView('dashboard');
      setActiveSite(site.siteCode);
    };

    // Arranque optimista: si quedó la última sesión guardada, se pinta la app
    // en el primer frame y la validación contra el servidor corre por detrás.
    // Sin esto había que esperar el round-trip completo mirando el fondo vacío,
    // y encima los dispositivos ni empezaban a pedirse hasta que ese terminaba.
    // No guarda credenciales: la cookie sigue siendo la única llave, así que si
    // la sesión ya no vale el servidor la rechaza igual y esto se cae al login.
    const cache = readSessionCache();
    if (cache) {
      aplicarSesion(cache.user, cache.sites);
      setAuthLoading(false);
    }

    const pendingSession = bootSession || getAuthSession();
    bootSession = null;
    pendingSession
      .then(session => {
        if (session.authenticated && session.user && session.sites?.length) {
          aplicarSesion(session.user, session.sites);
          writeSessionCache(session.user, session.sites);
          // Cargar preferencias del usuario (tema, etc.)
          // Lo del server pisa a lo local (tema, densidad, tamaño de texto;
          // si solo tiene el perfil viejo, se traduce).
          getUserPrefs().then(data => applyServerAppearance(data.prefs)).catch(() => {});
        } else {
          // La cookie ya no vale: se limpia lo que habíamos pintado de más.
          clearSessionCache();
          setUser(null);
          setSites([]);
          setActiveSite('');
        }
      })
      // Un error de red no tiene que expulsar a alguien que ya estaba adentro.
      .catch(() => undefined)
      .finally(() => setAuthLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) setOperator(user.nombre || user.email);
  }, [user, setOperator]);

  // Movimientos: un solo pedido a la vez y sin re-render cuando el historial no
  // cambió. Antes se pedía desde el auto-refresh y además cada vez que cambiaba
  // la identidad de devices/agenda/tasks: varias llamadas por segundo al pedo.
  const movementsInFlight = useRef<Promise<void> | null>(null);
  const movementsKey = useRef('');
  // force = después de una mutación: no reusar un pedido que salió antes del cambio.
  const refreshMovements = useCallback((force = false) => {
    if (movementsInFlight.current && !force) return movementsInFlight.current;
    const promise = getMovements()
      .then(data => {
        const nextKey = JSON.stringify(data.items);
        if (nextKey === movementsKey.current) return;
        movementsKey.current = nextKey;
        setMovements(data.items);
      })
      .catch(() => { /* el historial no es crítico para operar */ })
      .finally(() => { movementsInFlight.current = null; });
    movementsInFlight.current = promise;
    return promise;
  }, []);

  /* ── Navegación con historial ─────────────────────────────────────────────
     La URL sigue siendo /sede/<sede>/<vista> (la usan mails, notificaciones y
     el login con Google). Lo que hace el usuario (menú, Ctrl K, campana,
     escáner, cambiar de sede) entra al historial con pushState, así Atrás y
     Adelante del navegador recorren las vistas; lo que corrige la app sola
     (deep link inválido, módulo apagado, login) reemplaza la entrada. */
  const viewRef = useRef(view);
  viewRef.current = view;
  const pushNext = useRef(false);
  const devicePageRef = useRef(devicePage);
  devicePageRef.current = devicePage;
  const navigate = useCallback((next: ViewKey) => {
    if (next === viewRef.current) {
      // "Dispositivos" estando en la página de un equipo vuelve a la lista.
      if (next === 'devices' && devicePageRef.current) { pushNext.current = true; setDevicePage(null); }
      return;
    }
    pushNext.current = true;
    setDevicePage(null);
    setView(next);
  }, []);
  const changeSite = useCallback((code: string) => {
    pushNext.current = true;
    setDevicePage(null);
    setActiveSite(code);
  }, []);
  const openDevicePage = useCallback((tag: string | null, edit = false) => {
    pushNext.current = true;
    setDevicePage(tag ? { tag, edit } : null);
    setView('devices');
  }, []);
  // Mismos nombres que antes (los usan Inicio, Préstamos, Inventario, Historial,
  // Ctrl K y el asistente): ahora llevan a la página del equipo.
  const setProfile = useCallback((device: Device | null) => { if (device) openDevicePage(device.etiqueta); }, [openDevicePage]);
  const setEditingDevice = useCallback((device: Device | null) => { if (device) openDevicePage(device.etiqueta, true); }, [openDevicePage]);
  // "Abrir ESTA tarea" desde otra vista (Inicio → Tus tareas): la URL de la
  // tarea y la vista Tareas; TasksPage lee /sede/x/tasks/<id> al montarse.
  const openTaskPage = useCallback((id: string) => {
    const url = `/sede/${activeSite.toLowerCase()}/tasks/${encodeURIComponent(id)}`;
    pushNext.current = false;
    if (window.location.pathname !== url) window.history.pushState({ techasset: true }, '', url);
    setDevicePage(null);
    // Ya en Tareas no se vuelve a montar: que relea la ruta.
    if (viewRef.current === 'tasks') window.dispatchEvent(new PopStateEvent('popstate'));
    else setView('tasks');
  }, [activeSite]);

  useEffect(() => {
    if (!user || !activeSite || publicPage) return;
    const next = `/sede/${activeSite.toLowerCase()}/${view}${view === 'devices' && devicePage ? `/${encodeURIComponent(devicePage.tag)}` : ''}`;
    const push = pushNext.current;
    pushNext.current = false;
    const current = window.location.pathname;
    if (current === next) return;
    // Subrutas que maneja la vista misma (/tasks/<id>, /tickets/<id>,
    // /knowledge/<id>[/editar], /settings/<panel>, etc.): se conservan, también al entrar por un
    // link directo, y solo se normaliza la sede a minúsculas. En Dispositivos
    // la página del equipo va en `next`, y volver a la lista tiene que sacar la
    // etiqueta de la URL.
    if (view !== 'devices' && current.toLowerCase().startsWith(`${next}/`)) {
      if (!current.startsWith(`${next}/`)) window.history.replaceState(window.history.state, '', `${next}${current.slice(next.length)}`);
      return;
    }
    if (push) window.history.pushState({ techasset: true }, '', next);
    else window.history.replaceState(null, '', next);
  }, [activeSite, view, user, devicePage, publicPage]);

  // Privacidad: se abre desde la landing, el ingreso o Configuración › Cuenta
  // (openPublicPage empuja /privacidad) y Atrás/Adelante la recorren, con o sin sesión.
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    const sync = () => {
      const page = readPublicPageFromUrl();
      setPublicPage(page);
      if (!page && !userRef.current) setAuthMode(readAuthModeFromUrl());
    };
    window.addEventListener(PUBLIC_PAGE_EVENT, sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener(PUBLIC_PAGE_EVENT, sync); window.removeEventListener('popstate', sync); };
  }, []);
  const leavePublicPage = useCallback(() => {
    // Si se llegó desde la app (o la landing), Atrás vuelve exactamente ahí.
    if ((window.history.state as { publicPage?: string } | null)?.publicPage) { window.history.back(); return; }
    setPublicPage(null);
    if (!userRef.current) { setAuthMode('landing'); window.history.replaceState(null, '', '/'); }
  }, []);

  useEffect(() => {
    if (!user) return;
    const onPopState = () => {
      if (readPublicPageFromUrl()) return;
      const urlView = readViewFromUrl();
      const urlSite = readSiteFromUrl();
      const site = urlSite ? sites.find(item => item.siteCode.toLowerCase() === urlSite.toLowerCase()) : null;
      if (!urlView || (urlSite && !site)) {
        // Atrás hasta algo que no es una vista (o una sede ajena): se queda
        // donde estaba, sin sumar otra entrada.
        window.history.replaceState(null, '', `/sede/${activeSite.toLowerCase()}/${viewRef.current}`);
        return;
      }
      pushNext.current = false;
      if (site && site.siteCode !== activeSite) setActiveSite(site.siteCode);
      const tag = urlView === 'devices' ? readDeviceTagFromUrl() : '';
      setDevicePage(current => (tag ? (current?.tag === tag ? current : { tag }) : null));
      setView(urlView);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [user, sites, activeSite]);

  // La sede de los requests se fija en layout effect: corre antes que los
  // useEffect de los hijos, así ninguna vista pide datos con la sede anterior.
  useLayoutEffect(() => {
    if (activeSite) setActiveSiteCode(activeSite);
  }, [activeSite]);

  // La recarga completa de datos, en cambio, solo al cambiar de sede o de usuario.
  // Antes se disparaba en cada cambio de vista: un /api/devices?refresh=1 (que
  // fuerza el merge completo del inventario) + agenda + tareas + movimientos cada
  // vez que tocabas el menú. El auto-refresh ya mantiene todo fresco.
  // Equipos: useDevices ya pide al cambiar de sede; acá se reusa ese pedido en
  // vuelo. Antes iba con force y salían DOS /api/devices al arrancar (el
  // segundo con ?refresh=1, que además salta la caché del server), y la
  // respuesta del primero se tiraba.
  useEffect(() => {
    if (!user || !activeSite) return;
    void refresh();
    // Agenda y tareas ya se pidieron al montar sus hooks (misma sede): si esa
    // respuesta llegó hace menos de 5 s no se vuelven a bajar (antes salía un
    // segundo GET /api/agenda de ~60 KB en cada arranque, según el timing).
    void agenda.refresh({ maxAgeMs: 5000 });
    void tasks.refresh({ maxAgeMs: 5000 });
    void refreshMovements(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSite, user?.id]);

  // Settings de la sede activa (incluye módulos habilitados).
  const reloadSiteSettings = () => {
    if (!user || !activeSite) return;
    getSiteSettings().then(response => setSiteSettings(response.settings || {})).catch(() => setSiteSettings({}));
  };
  useEffect(() => {
    if (!user || !activeSite) return;
    setSiteSettings(null);
    // Un pedido que falla no se toma de una como "sin módulos": eso sacaba de la
    // vista abierta (/knowledge, /reminders, /canvas → Inicio) cuando el server
    // tardaba o cortaba. Se reintenta antes de rendirse, y la respuesta de una
    // sede anterior (cambio de sede en el medio) no pisa a la actual.
    let cancelled = false;
    let timer = 0;
    const load = (attempt: number) => {
      getSiteSettings()
        .then(response => { if (!cancelled) setSiteSettings(response.settings || {}); })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) timer = window.setTimeout(() => load(attempt + 1), 400 * 2 ** attempt);
          else setSiteSettings({});
        });
    };
    load(0);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSite, user?.id]);

  // Si el módulo de la vista actual está apagado para la sede o el rol no puede verlo,
  // volver al dashboard.
  // Misma regla que el menú: módulo de la sede, permiso del rol, `requiresAny`
  // (Historial) y solo-superadmin (Tenants, Usuarios, Componentes UI).
  useEffect(() => {
    if (!user || siteSettings === null) return;
    const role = activeSiteRole(user, sites, activeSite);
    const superUser = isSuperadmin(user);
    const acc = roleAccess(siteSettings, role, superUser);
    if (!visibleNavItems(siteSettings, superUser, acc).some(item => item.key === view)) setView('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, siteSettings, user?.id, activeSite]);

  // Agenda y tareas también se refrescan solas (cada 2 vueltas, ~30 s): antes
  // solo equipos y movimientos, y un tablero compartido quedaba viejo hasta recargar.
  const refreshTick = useRef(0);
  // Sin sesión el intervalo ni se arma (0 = apagado).
  useAutoRefresh(() => {
    if (document.hidden || !userRef.current) return;
    void refresh();
    void refreshMovements();
    refreshTick.current += 1;
    if (refreshTick.current % 2 === 0) {
      void agenda.refresh().catch(() => undefined);
      void tasks.refresh().catch(() => undefined);
    }
  }, signedIn ? Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 15) : 0);

  // (El refetch de movimientos por cambio de devices/agenda/tasks se sacó: era
  // redundante con el auto-refresh y con el refresh que hace cada mutación.)

  // Ctrl K → "ir a la fila": espera a que la fila exista (la vista puede estar
  // bajando su chunk), la centra y la resalta 1,6 s.
  useEffect(() => {
    if (!highlight) return;
    let tries = 0;
    let removeTimer = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const row = document.querySelector<HTMLElement>(`[data-device-tag="${CSS.escape(highlight.tag)}"]`);
      if (!row && tries < 30) return;
      window.clearInterval(timer);
      if (!row) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      row.classList.add('row-highlight');
      removeTimer = window.setTimeout(() => row.classList.remove('row-highlight'), 1600);
    }, 100);
    return () => { window.clearInterval(timer); window.clearTimeout(removeTimer); };
  }, [highlight]);

  // El filtro de Ctrl K vale para la vista a la que llevó: al irse, se suelta.
  const searchStatus = useRef<number | null>(null);
  const clearSearch = useCallback(() => {
    setSearch('');
    if (searchStatus.current !== null) clearStatus(searchStatus.current);
    searchStatus.current = null;
  }, []);
  useEffect(() => {
    if (search && view !== 'devices') clearSearch();
  }, [view, search, clearSearch]);

  // Escáner USB global: con ritmo de lector, fuera de campos y diálogos.
  // En el Inicio lo escaneado cae en la barra de acción; en el resto, a Préstamos.
  useGlobalScanner(Boolean(user), code => {
    if (viewRef.current === 'dashboard') {
      setDashScan(current => ({ code, nonce: (current?.nonce || 0) + 1 }));
      return;
    }
    setLoanSeed('');
    window.setTimeout(() => setLoanSeed(code), 0);
    navigate('loans');
  });

  const onAddDevice = async (device: Partial<Device>) => {
    await addDevice({ ...device, operator });
    await refresh();
  };

  const onDeleteDevice = async (device: Device) => {
    await deleteDevice(device.etiqueta, operator);
    removeLocal(device.etiqueta);
    await refresh({ force: true, wait: true });
    void refreshMovements(true);
  };

  const onLend = async (payload: Record<string, unknown>) => {
    try {
      const result = await lendDevice({ ...payload, operator });
      await refresh({ force: true, wait: true });
      return result;
    } finally {
      void refreshMovements(true);
    }
  };

  const onReturn = async (payload: Record<string, unknown>) => {
    try {
      const result = await returnDevice({ ...payload, operator });
      await refresh({ force: true, wait: true });
      return result;
    } finally {
      void refreshMovements(true);
    }
  };

  // Lotes: un request y un solo refresco al final, en vez de uno por equipo.
  const onLendBatch = async (payload: Record<string, unknown> & { etiquetas: string[] }): Promise<LoanBatchResponse> => {
    try {
      const result = await lendDevicesBatch({ ...payload, operator });
      await refresh({ force: true, wait: true });
      return result;
    } finally {
      void refreshMovements(true);
    }
  };

  const onReturnBatch = async (etiquetas: string[]): Promise<LoanBatchResponse> => {
    try {
      const result = await returnDevicesBatch(etiquetas, { operator });
      await refresh({ force: true, wait: true });
      return result;
    } finally {
      void refreshMovements(true);
    }
  };

  // Después de un Deshacer del Inicio: equipos y movimientos al día.
  const afterLoanChange = async () => {
    await refresh({ force: true, wait: true });
    void refreshMovements(true);
  };

  // Devolver desde una tabla (dashboard o dispositivos) resuelve en el acto en
  // vez de mandarte a Préstamos a repetir el equipo que ya elegiste.
  const returnFromTable = async (device: Device) => {
    if (!device?.etiqueta) return;
    await onReturn({ etiqueta: device.etiqueta });
  };

  const createTaskFromAgenda = async (item: { id: string; curso: string; actividad: string }) => {
    await createTask({ titulo: `Revisar ${item.curso} - ${item.actividad}`, responsable: operator, prioridad: 'Media', agendaId: item.id, operator });
    await tasks.refresh();
    navigate('tasks');
  };

  const refreshSessionSites = async () => {
    const session = await getAuthSession();
    if (!session.authenticated || !session.user || !session.sites?.length) return;
    setUser(session.user);
    setSites(session.sites);
    if (!session.sites.some(site => site.siteCode.toLowerCase() === activeSite.toLowerCase())) {
      const nextSite = session.sites.find(site => site.isDefault) || session.sites[0];
      setActiveSite(nextSite.siteCode);
    }
  };

  // Sesión vencida (cualquier 401 de la API): limpiar y mandar al login con aviso.
  useEffect(() => {
    const onExpired = () => {
      if (!user) return;
      // Al volver a entrar, de nuevo donde estaba.
      if (/^\/sede\/[^/]+/i.test(window.location.pathname)) setReturnTo(window.location.pathname);
      clearSessionCache();
      clearApiCache();
      setUser(null);
      setSites([]);
      setActiveSite('');
      setAuthMode('login');
      window.history.replaceState(null, '', '/login?error=session_expired');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [user]);

  // Cerrar sesión: además de la cookie, se borra de este navegador lo que es de
  // la persona (nombre, sesión recordada, borradores guardados) y la página se
  // recarga en el ingreso con "Sesión cerrada": así no queda nada en memoria
  // (equipos, agenda, tareas, movimientos, formularios a medias) para quien
  // entre después en la misma compu. Los archivos de la app salen del caché.
  const handleLogout = async () => {
    await logoutSession().catch(() => undefined);
    clearSessionCache();
    clearPersonalData();
    window.location.replace('/login?sesion=cerrada');
  };

  const openLoanFlow = (deviceOrCode: Device | string) => {
    const next = typeof deviceOrCode === 'string' ? deviceOrCode : deviceOrCode.etiqueta;
    setLoanSeed('');
    window.setTimeout(() => setLoanSeed(next), 0);
    navigate('loans');
  };

  // Lo que se mandó a Préstamos se usa una vez: al salir de la vista se olvida,
  // si no, volver a Préstamos más tarde volvía a cargar el mismo equipo o lote.
  useEffect(() => {
    if (view !== 'dashboard') setDashScan(undefined);
    if (view === 'loans') return;
    setLoanSeed('');
    setLoanBatchSeed(undefined);
  }, [view]);

  const openLoanBatch = (etiquetas: string[]) => {
    setLoanBatchSeed(current => ({ etiquetas, nonce: (current?.nonce || 0) + 1 }));
    navigate('loans');
  };

  // Rol real en la sede activa → permisos efectivos de roles.config. Un rol
  // personalizado con permisos de edición no debe caer en modo consulta solo
  // porque su nombre no figure en la lista legacy de managers/asistentes.
  const currentRole = activeSiteRole(user, sites, activeSite);
  const superadmin = isSuperadmin(user);
  const access = roleAccess(siteSettings, currentRole, superadmin);
  const roleReadOnly = !access.admin && access.edit.size === 0;
  const effectiveConsultation = roleReadOnly || consultationMode;
  // Superadmin parado en una sede que no es la suya por defecto → banner de impersonación (tema B).
  const activeSiteInfo = sites.find(site => site.siteCode === activeSite);
  const impersonating = superadmin && sites.length > 1 && !!activeSiteInfo && !activeSiteInfo.isDefault;
  const exitImpersonation = () => {
    const home = sites.find(site => site.isDefault) || sites[0];
    if (home) changeSite(home.siteCode);
  };
  const navItems = visibleNavItems(siteSettings, superadmin, access);
  const navKeys = navItems.map(item => item.key).join(',');
  // Contadores en mono del menú: préstamos activos y tareas abiertas.
  const openTasks = useMemo(() => tasks.items.filter(item => item.estado !== 'Hecha' && !item.done).length, [tasks.items]);
  const navCounts = { loans: counts.loaned || 0, tasks: openTasks };

  // Ctrl K → equipo: si la fila está en la pantalla, se resalta ahí; si no,
  // se va a Dispositivos filtrando por esa etiqueta (con "Quitar filtro").
  const jumpToDevice = (device: Device) => {
    const tag = device.etiqueta;
    const onScreen = (view === 'dashboard' || view === 'devices') && document.querySelector(`[data-device-tag="${CSS.escape(tag)}"]`);
    if (!onScreen && navItems.some(item => item.key === 'devices')) {
      setSearch(tag);
      navigate('devices');
      if (searchStatus.current !== null) clearStatus(searchStatus.current);
      searchStatus.current = pushStatus({
        tone: 'info',
        message: `Dispositivos filtrado por ${getOperationalAlias(device) || tag}`,
        action: { label: 'Quitar filtro', onClick: clearSearch },
        autoHideMs: 0
      });
    }
    setHighlight(current => ({ tag, nonce: (current?.nonce || 0) + 1 }));
  };

  // Con la sesión y los módulos resueltos, bajamos en idle los chunks de las
  // vistas que este rol puede abrir + los modales que se usan en todas.
  // Al hacer click el módulo ya está en memoria: cambio de vista instantáneo.
  useEffect(() => {
    if (!user || siteSettings === null) return;
    prefetchViewsWhenIdle([...navKeys.split(',').filter(Boolean), 'assistant']);
  }, [navKeys, siteSettings, user]);

  // Primer pintado de la app: la estructura (menú, barra, esqueleto) sale en un
  // frame y la vista se arma en el siguiente. Al entrar todavía no hay datos (la
  // vista dibujaría sus vacíos) y armarla junto con la estructura demoraba el
  // primer pintado ~50 ms de JS + layout con CPU lenta. Solo la primera vez.
  const hasUser = Boolean(user);
  const [viewsOn, setViewsOn] = useState(false);
  useEffect(() => {
    if (!hasUser || viewsOn) return;
    let timer = 0;
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setViewsOn(true), 0); });
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [hasUser, viewsOn]);
  // La vista que reemplaza a ese esqueleto entra sin animación (el esqueleto ya
  // entró): si no, su animación de entrada arrancaba un frame después y lo que
  // se tocaba enseguida se movía unos px. Las vistas siguientes animan como siempre.
  const bootView = useRef<ViewKey | null>(null);
  const leftBootView = useRef(false);
  if (viewsOn && bootView.current === null) bootView.current = view;
  if (bootView.current !== null && view !== bootView.current) leftBootView.current = true;
  const enterStill = !leftBootView.current && view === bootView.current;

  // Privacidad o una dirección que no existe: no espera la sesión (la sede se
  // muestra si ya se conoce).
  if (publicPage) {
    return (
      <Suspense fallback={null}>
        <PublicPage kind={publicPage} user={user} sites={sites} activeSite={activeSite} onBack={leavePublicPage} />
      </Suspense>
    );
  }
  // Mientras se resuelve la sesión React no pinta nada y se ve la pantalla de
  // arranque de index.html (#boot: marca y "Cargando…"), que se va sola cuando
  // aparece la landing, el ingreso o la app.
  if (authLoading) return null;
  if (!user) {
    const goMode = (mode: 'landing' | 'login' | 'register') => {
      setAuthMode(mode);
      window.history.replaceState(null, '', mode === 'landing' ? '/' : `/${mode}`);
    };
    if (authMode === 'landing') {
      return (
        <Suspense fallback={null}>
          <LandingPage onLogin={() => goMode('login')} onRegister={() => goMode('register')} />
        </Suspense>
      );
    }
    const linkSite = returnTo.match(/^\/sede\/([^/]+)/i)?.[1]?.toUpperCase().slice(0, 12) || '';
    return <Suspense fallback={null}><LoginPage mode={authMode} linkSite={linkSite} onForgetLinkSite={() => setReturnTo('')} onMode={mode => {
      if (mode === 'landing') setReturnTo('');
      goMode(mode);
    }} onReady={session => {
      // Volver al link (o a donde venció la sesión) si la sede es suya; si no, su sede por defecto.
      const target = returnTo;
      const wanted = target.match(/^\/sede\/([^/]+)/i)?.[1]?.toLowerCase();
      const allowed = wanted ? session.sites.find(item => item.siteCode.toLowerCase() === wanted) : undefined;
      const site = allowed || session.sites.find(item => item.isDefault) || session.sites[0];
      let nextView: ViewKey = 'dashboard';
      let nextDevice: { tag: string } | null = null;
      if (allowed) {
        // La vista (y su subruta: /tasks/12, /settings/usuarios) se lee de la URL, como al entrar con sesión.
        window.history.replaceState(null, '', target);
        nextView = readViewFromUrl() || 'dashboard';
        const tag = nextView === 'devices' ? readDeviceTagFromUrl() : '';
        nextDevice = tag ? { tag } : null;
      }
      setReturnTo('');
      setUser(session.user);
      setOperator(session.user.nombre || session.user.email);
      setSites(session.sites);
      setActiveSite(site.siteCode);
      // Recién logueado: dejar la sesión recordada para que el próximo ingreso
      // pinte de una en vez de esperar la verificación.
      writeSessionCache(session.user, session.sites);
      setDevicePage(nextDevice);
      setView(nextView);
    }} /></Suspense>;
  }

  return (
    <AppShell
      view={view}
      onNavigate={navigate}
      onPrefetch={prefetchView}
      navItems={navItems}
      counts={navCounts}
      user={user}
      sites={sites}
      activeSite={activeSite}
      onSiteChange={changeSite}
      roleLabel={currentRole}
      consultationMode={effectiveConsultation}
      impersonating={impersonating}
      onExitImpersonation={exitImpersonation}
      onLogout={handleLogout}
      devices={devices}
      onJumpToDevice={jumpToDevice}
      onLoan={openLoanFlow}
      onProfile={setProfile}
      onScan={() => { setScanRequest(value => value + 1); navigate('loans'); }}
      assistantContext={assistantContext || { type: 'view', view, label: navItem(view)?.label || view }}
      assistantCanEdit={!effectiveConsultation}
      onAssistantOpenDevice={deviceTag => {
        const match = resolveDeviceMatches(devices, deviceTag)[0];
        if (!match) return false;
        setProfile(match);
        return true;
      }}
    >
      {/* El `key={view}` remonta este nodo en cada cambio de vista, y con eso
          se redispara la animación de entrada. Sólo hay entrada: sostener el
          árbol viejo para animar la salida agrega espera, y en una app de
          trabajo la espera se siente como lentitud. */}
      {!viewsOn ? <div className="view-enter"><section className="view active"><SkeletonView /></section></div> : (
      <div key={view} className="view-enter" style={enterStill ? STILL : undefined}>
      <Suspense fallback={<section className="view active"><SkeletonView /></section>}>
      {view === 'dashboard' && <Dashboard key={activeSite} operator={operator} consultationMode={effectiveConsultation} devices={devices} sync={sync} agenda={agenda.items} tasks={tasks.items} movements={movements} siteSettings={siteSettings} scan={dashScan} canOpen={target => navItems.some(item => item.key === target)} onNavigate={navigate} onOpenTask={openTaskPage} onOpenLoans={openLoanFlow} onProfile={setProfile} onEdit={setEditingDevice} onLend={onLend} onReturn={onReturn} onLendBatch={onLendBatch} onReturnBatch={onReturnBatch} onLoanChanged={afterLoanChange} onRefresh={() => refresh({ force: true, wait: true })} onAgendaSave={agenda.save} />}
      {view === 'devices' && <DevicesPage key={activeSite} devices={filteredDevices} allDevices={devices} siteCode={activeSite} consultationMode={effectiveConsultation} operator={operator} onAdd={onAddDevice} onLoan={openLoanFlow} onReturn={returnFromTable} onDelete={onDeleteDevice} onLoanBatch={openLoanBatch} onReturnBatch={onReturnBatch} onImported={() => refresh({ force: true, wait: true })} pageTag={devicePage?.tag} pageEdit={devicePage?.edit} onOpenPage={openDevicePage} onNavigate={navigate} />}
      {view === 'loans' && <LoansPage key={activeSite} devices={devices} movements={movements} operator={operator} consultationMode={effectiveConsultation} onLend={onLend} onReturn={onReturn} onLendBatch={onLendBatch} onReturnBatch={onReturnBatch} onRefresh={() => Promise.all([refresh({ force: true, wait: true }), refreshMovements(true)])} siteCode={activeSite} onProfile={setProfile} initialCode={loanSeed} initialBatch={loanBatchSeed} scanRequest={scanRequest} />}
      {view === 'history' && <HistoryPage key={activeSite} devices={devices} onProfile={setProfile} />}
      {view === 'inventory' && <InventoryPage key={activeSite} devices={filteredDevices} consultationMode={effectiveConsultation} onProfile={setProfile} onRefreshDevices={() => refresh({ force: true, wait: true })} />}
      {view === 'analytics' && <AnalyticsPage key={activeSite} devices={devices} onRefresh={refresh} onNavigate={navigate} />}
      {view === 'agenda' && <AgendaPage key={activeSite} items={agenda.items} olderHidden={agenda.olderHidden} onLoadOlder={agenda.loadOlder} consultationMode={effectiveConsultation} onSave={agenda.save} onDelete={agenda.remove} onTask={createTaskFromAgenda} onRefresh={agenda.refresh} />}
      {view === 'schedules' && <SchedulesPage key={activeSite} consultationMode={effectiveConsultation} />}
      {view === 'tasks' && <TasksPage key={activeSite} store={tasks} operator={operator} consultationMode={effectiveConsultation} />}
      {view === 'pettycash' && <PettyCashPage key={activeSite} siteCode={activeSite} consultationMode={effectiveConsultation} />}
      {view === 'suggestions' && <SuggestionsPage key={activeSite} />}
      {view === 'classrooms' && <ClassroomStatusPage key={activeSite} operator={operator} consultationMode={effectiveConsultation} activeSite={activeSite} sites={sites} onSiteChange={changeSite} onNavigate={navigate} />}
      {view === 'tools' && <ToolsPage key={activeSite} operator={operator} consultationMode={effectiveConsultation} canEdit={access.admin || access.edit.has('*') || access.edit.has('tools')} canSend={access.admin} onNavigate={navigate} />}
      {view === 'quickaccess' && <QuickAccessPage key={activeSite} operator={operator} consultationMode={effectiveConsultation} canEdit={access.admin || access.edit.has('*') || access.edit.has('quickaccess')} />}
      {view === 'tickets' && <TicketsPage key={activeSite} consultationMode={effectiveConsultation} />}
      {view === 'knowledge' && <KnowledgePage key={activeSite} consultationMode={effectiveConsultation} />}
      {view === 'canvas' && <CanvasPage key={activeSite} consultationMode={effectiveConsultation} />}
      {view === 'reminders' && <RemindersPage key={activeSite} consultationMode={effectiveConsultation} />}
      {view === 'ui' && superadmin && <UiShowcase />}
      {view === 'settings' && <SettingsPage key={activeSite} operator={operator} setOperator={setOperator} consultationMode={effectiveConsultation} setConsultationMode={setConsultationMode} siteRole={currentRole} roleReadOnly={roleReadOnly} isSiteAdmin={access.admin} activeSite={activeSite} sync={sync} user={user} sites={sites} onSitesChanged={refreshSessionSites} onModulesChanged={reloadSiteSettings} onSwitchSite={changeSite} onLogout={handleLogout} />}
      </Suspense>
      </div>
      )}
    </AppShell>
  );
}

/** La vista que reemplaza al esqueleto del arranque no repite la entrada. */
const STILL = { animation: 'none' } as const;

/* ── Sesión recordada ──────────────────────────────────────────────────────
   Guarda quién sos y a qué sedes entrás para poder pintar la app en el primer
   frame, en vez de esperar el round-trip de /api/auth/session mirando el fondo.
   No es una credencial: la cookie httpOnly sigue siendo lo único que autoriza,
   acá sólo vive lo necesario para dibujar el sidebar y la topbar.

   Vence a las 12 h a propósito. La cookie dura 30 días, pero estas máquinas se
   comparten: pasado el día, mejor esperar los 170 ms y no mostrarle a nadie el
   nombre ni las sedes del turno anterior mientras el servidor contesta. */
const SESSION_CACHE_KEY = 'techasset_session_cache';
const SESSION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function readSessionCache(): { user: AuthUser; sites: SiteInfo[] } | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; user?: AuthUser; sites?: SiteInfo[] };
    if (!parsed?.user?.email || !parsed.sites?.length) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > SESSION_CACHE_TTL_MS) return null;
    return { user: parsed.user, sites: parsed.sites };
  } catch {
    return null;
  }
}

function writeSessionCache(user: AuthUser, sites: SiteInfo[]) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), user, sites }));
  } catch {
    // Modo incógnito o storage lleno: se pierde el arranque rápido, nada más.
  }
}

function clearSessionCache() {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Ídem: no hay nada que hacer y no puede romper el logout.
  }
}

/** Pista de sesión abierta en este navegador (la pone el server; la llave es la cookie httpOnly). */
function hasSessionHint() {
  try { return document.cookie.split(';').some(part => part.trim().startsWith('techasset_signed_in=1')); } catch { return false; }
}

function readSiteFromUrl() {
  const match = window.location.pathname.match(/^\/sede\/([^/]+)/i);
  return match?.[1]?.toUpperCase();
}

function readViewFromUrl(): ViewKey | null {
  const view = window.location.pathname.match(/^\/sede\/[^/]+\/([^/]+)/i)?.[1];
  // Tenants y Usuarios ahora son paneles de Configuración, y los mails apuntan
  // a /configuracion/usuarios: el panel se recuerda hasta que monte la vista.
  if (isSettingsAlias(view)) {
    requestSettingsPanel(panelFromPath(window.location.pathname));
    return 'settings';
  }
  return isViewKey(view) ? view : null;
}

/** /sede/<sede>/devices/<etiqueta> → la etiqueta ('' si no hay). */
function readDeviceTagFromUrl(): string {
  const raw = window.location.pathname.match(/^\/sede\/[^/]+\/devices\/([^/]+)/i)?.[1];
  if (!raw) return '';
  try { return decodeURIComponent(raw).trim().toUpperCase().slice(0, 30); } catch { return ''; }
}

function readAuthModeFromUrl(): 'landing' | 'login' | 'register' {
  const path = window.location.pathname.toLowerCase();
  if (path === '/login') return 'login';
  if (path === '/register') return 'register';
  // Un link a una pantalla (mail, notificación, favorito) sin sesión: directo al ingreso.
  if (/^\/sede\/[^/]+/.test(path)) return 'login';
  return 'landing';
}

/**
 * El chunk de la pantalla de entrada se pide ya, en paralelo con la sesión
 * (que sale primera). Con una sesión recordada lo probable es entrar a la app:
 * el Inicio. Sin ella, la pantalla sin sesión que toca: antes la landing en
 * frío bajaba además el Inicio y ~15 chunks de íconos que no usaba, y con 3G
 * lento competían con lo único que hacía falta pintar.
 */
function bootPrefetch() {
  const path = window.location.pathname;
  const page = readPublicPageFromUrl(path);
  if (page) { prefetchView('public'); return; }
  if (readSessionCache() || hasSessionHint()) {
    if (/^\/(sede\/[^/]+\/?(dashboard)?)?$/i.test(path)) prefetchView('dashboard');
    return;
  }
  prefetchView(readAuthModeFromUrl() === 'landing' ? 'landing' : 'login');
}
if (typeof window !== 'undefined') bootPrefetch();

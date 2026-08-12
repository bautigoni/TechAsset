import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser, Device, Movement, SiteInfo, TaskState, ViewKey } from './types';
import { Sidebar, visibleNavItems } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MobileNav } from './components/layout/MobileNav';
import { SkeletonView } from './components/layout/Skeleton';
import { applyThemeProfile, isSmartProfile, profileForThemeAndStyle, readThemeProfile, saveThemeProfile, variantStyle, THEME_PROFILE_EVENT, type ThemeProfile } from './utils/themeProfile';
import { getUserPrefs } from './services/userPrefsApi';
import { lazyView, prefetchView, prefetchViewsWhenIdle } from './utils/lazyView';
import { Dashboard } from './components/dashboard/Dashboard';
import { useOperator } from './hooks/useOperator';
import { useDevices } from './hooks/useDevices';
import { useAgenda } from './hooks/useAgenda';
import { useTasks } from './hooks/useTasks';
import { useScrollReveal } from './hooks/useScrollReveal';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { addDevice, deleteDevice, getMovements } from './services/devicesApi';
import { lendDevice, returnDevice } from './services/loansApi';
import { createTask } from './services/tasksApi';
import { getAuthSession, getSiteSettings, logout as logoutSession } from './services/authApi';
import { activeSiteRole, canViewModule, isReadOnlyRole, isSuperadmin, roleAccess } from './utils/permissions';
import { isViewEnabled, TOGGLEABLE_KEYS } from './utils/modules';
import { parseScannedCode, resolveDeviceMatches } from './utils/normalizeSearch';
import type { AssistantContext } from './services/assistantApi';

// Cada vista viaja en su propio chunk: el bundle inicial baja de ~570 kB a lo que
// hace falta para pintar el dashboard. Los chunks del resto se precargan en idle
// (ver prefetchViewsWhenIdle más abajo), así el cambio de vista sigue siendo
// instantáneo. La clave del lazyView es la ViewKey para poder prefetchear por nav.
const DevicesPage = lazyView('devices', () => import('./components/devices/DevicesPage'), 'DevicesPage');
const LoansPage = lazyView('loans', () => import('./components/loans/LoansPage'), 'LoansPage');
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
const TenantsDashboard = lazyView('tenants', () => import('./components/settings/TenantsDashboard'), 'TenantsDashboard');
const UsersByTenantPage = lazyView('adminusers', () => import('./components/settings/UsersByTenantPage'), 'UsersByTenantPage');
const SettingsPage = lazyView('settings', () => import('./components/settings/SettingsPage'), 'SettingsPage');
// Fuera del nav: modales y pantallas de auth. La landing solo la ve quien no
// tiene sesión, así que no tiene por qué pesar en el bundle del que ya entró.
const DeviceProfile = lazyView('device-profile', () => import('./components/devices/DeviceProfile'), 'DeviceProfile');
const AddDeviceModal = lazyView('add-device', () => import('./components/devices/AddDeviceModal'), 'AddDeviceModal');
const AssistantPanel = lazyView('assistant', () => import('./components/assistant/AssistantPanel'), 'AssistantPanel');
const LoginPage = lazyView('login', () => import('./components/auth/LoginPage'), 'LoginPage');
const LandingPage = lazyView('landing', () => import('./components/auth/LandingPage'), 'LandingPage');

export function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [authMode, setAuthMode] = useState<'landing' | 'login' | 'register'>(() => readAuthModeFromUrl());
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('techasset_sidebar_collapsed') === '1');
  const [themeProfile, setThemeProfile] = useState<ThemeProfile>(() => readThemeProfile());
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantContext, setAssistantContext] = useState<AssistantContext | null>(null);
  const [consultationMode, setConsultationMode] = useState(false);
  const [profile, setProfile] = useState<Device | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [loanSeed, setLoanSeed] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [activeSite, setActiveSite] = useState('');
  const [siteSettings, setSiteSettings] = useState<Record<string, unknown> | null>(null);
  const scannerBufferRef = useRef('');
  const scannerTimerRef = useRef<number | null>(null);
  const { operator, setOperator } = useOperator();
  const { devices, filteredDevices, counts, sync, refresh, patchLocal, removeLocal } = useDevices(search, activeSite);
  const agenda = useAgenda(operator);
  const tasks = useTasks(operator);
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
      localStorage.setItem('techasset_active_site', site.siteCode);
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

    getAuthSession()
      .then(session => {
        if (session.authenticated && session.user && session.sites?.length) {
          aplicarSesion(session.user, session.sites);
          writeSessionCache(session.user, session.sites);
          // Cargar preferencias del usuario (tema, etc.)
          getUserPrefs().then(data => {
            if (data.prefs?.themeProfile) {
              const p = data.prefs.themeProfile as ThemeProfile;
              saveThemeProfile(p);
            }
          }).catch(() => {});
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

  // La URL sí sigue a la vista (deep link + refresh del browser).
  useEffect(() => {
    if (!user || !activeSite) return;
    const next = `/sede/${activeSite.toLowerCase()}/${view}`;
    if (window.location.pathname !== next) window.history.replaceState(null, '', next);
  }, [activeSite, view, user]);

  // La recarga completa de datos, en cambio, solo al cambiar de sede o de usuario.
  // Antes se disparaba en cada cambio de vista: un /api/devices?refresh=1 (que
  // fuerza el merge completo del inventario) + agenda + tareas + movimientos cada
  // vez que tocabas el menú. El auto-refresh ya mantiene todo fresco.
  useEffect(() => {
    if (!user || !activeSite) return;
    localStorage.setItem('techasset_active_site', activeSite);
    void refresh({ force: true });
    void agenda.refresh();
    void tasks.refresh();
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
    getSiteSettings().then(response => setSiteSettings(response.settings || {})).catch(() => setSiteSettings({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSite, user?.id]);

  // Si el módulo de la vista actual está apagado para la sede o el rol no puede verlo,
  // volver al dashboard.
  useEffect(() => {
    if (!user || siteSettings === null) return;
    const role = activeSiteRole(user, sites, activeSite);
    const acc = roleAccess(siteSettings, role, isSuperadmin(user));
    if (!isViewEnabled(view, siteSettings) || !canViewModule(acc, view, TOGGLEABLE_KEYS)) setView('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, siteSettings, user?.id, activeSite]);

  useAutoRefresh(() => {
    if (document.hidden) return;
    void refresh();
    void refreshMovements();
  }, Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 15));

  useEffect(() => {
    applyThemeProfile(themeProfile);
  }, [themeProfile]);

  // Sincroniza el perfil cuando se cambia desde Configuración > Apariencia.
  useEffect(() => {
    const onProfileChange = (event: Event) => {
      const detail = (event as CustomEvent<ThemeProfile>).detail;
      if (detail) setThemeProfile(detail);
    };
    window.addEventListener(THEME_PROFILE_EVENT, onProfileChange);
    return () => window.removeEventListener(THEME_PROFILE_EVENT, onProfileChange);
  }, []);

  // Expande la sidebar cuando se selecciona un estilo variante.
  useEffect(() => {
    const onSidebarExpand = () => {
      setSidebarCollapsed(false);
      localStorage.removeItem('techasset_sidebar_collapsed');
    };
    window.addEventListener('techasset:sidebar-expand', onSidebarExpand);
    return () => window.removeEventListener('techasset:sidebar-expand', onSidebarExpand);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-open', menuOpen);
    return () => document.body.classList.remove('mobile-menu-open');
  }, [menuOpen]);

  // (El refetch de movimientos por cambio de devices/agenda/tasks se sacó: era
  // redundante con el auto-refresh y con el refresh que hace cada mutación.)

  useEffect(() => {
    const code = search.trim().match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '').toUpperCase();
    if (!code || !['dashboard', 'devices'].includes(view)) return;
    const timer = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-device-tag="${code}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.classList.add('row-highlight');
      window.setTimeout(() => row?.classList.remove('row-highlight'), 1600);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, view, filteredDevices.length]);

  useEffect(() => {
    const text = search.trim();
    if (!/(prestar|prestamo|prestamos|pr[eé]stamo|pr[eé]stamos)/i.test(text)) return;
    const code = text.match(/\bD?\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '').toUpperCase();
    if (!code) return;
    const timer = window.setTimeout(() => {
      openLoanFlow(code);
      setSearch('');
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!user) return;
    const flushScan = () => {
      const raw = scannerBufferRef.current;
      scannerBufferRef.current = '';
      const parsed = parseScannedCode(raw).trim();
      if (!parsed || parsed.length < 2 || !/\d/.test(parsed)) return;
      setLoanSeed('');
      window.setTimeout(() => setLoanSeed(parsed), 0);
      setView('loans');
      setMenuOpen(false);
    };
    const scheduleFlush = () => {
      if (scannerTimerRef.current !== null) window.clearTimeout(scannerTimerRef.current);
      scannerTimerRef.current = window.setTimeout(flushScan, 120);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target) || target?.closest('.modal')) return;
      if (event.key === 'Enter') {
        if (scannerBufferRef.current) {
          event.preventDefault();
          flushScan();
        }
        return;
      }
      if (event.key.length !== 1) return;
      scannerBufferRef.current += event.key;
      scheduleFlush();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (scannerTimerRef.current !== null) window.clearTimeout(scannerTimerRef.current);
    };
  }, [user]);

  const toggleTheme = () => {
    const isSmart = isSmartProfile(themeProfile);
    const style = variantStyle(themeProfile);
    const next = profileForThemeAndStyle(!isSmart, style);
    saveThemeProfile(next);
  };

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

  // Devolver desde una tabla (dashboard o dispositivos) resuelve en el acto en
  // vez de mandarte a Préstamos a repetir el equipo que ya elegiste.
  const returnFromTable = async (device: Device) => {
    if (!device?.etiqueta) return;
    await onReturn({ etiqueta: device.etiqueta });
  };

  const createTaskFromAgenda = async (item: { id: string; curso: string; actividad: string }) => {
    await createTask({ titulo: `Revisar ${item.curso} - ${item.actividad}`, responsable: operator, prioridad: 'Media', agendaId: item.id, operator });
    await tasks.refresh();
    setView('tasks');
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

  const handleLogout = async () => {
    await logoutSession().catch(() => undefined);
    clearSessionCache();
    setUser(null);
    setSites([]);
    setActiveSite('');
    setView('dashboard');
    setAuthMode('landing');
    setSearch('');
    window.history.replaceState(null, '', '/');
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(value => {
      const next = !value;
      localStorage.setItem('techasset_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

  const openLoanFlow = (deviceOrCode: Device | string) => {
    const next = typeof deviceOrCode === 'string' ? deviceOrCode : deviceOrCode.etiqueta;
    setLoanSeed('');
    window.setTimeout(() => setLoanSeed(next), 0);
    setView('loans');
  };

  // Rol real en la sede activa → permisos. Consulta/Otro = solo lectura forzada;
  // editores pueden además activar el "modo consulta / vista jefe" manual.
  const currentRole = activeSiteRole(user, sites, activeSite);
  const roleReadOnly = isReadOnlyRole(currentRole);
  const effectiveConsultation = roleReadOnly || consultationMode;
  const superadmin = isSuperadmin(user);
  const access = roleAccess(siteSettings, currentRole, superadmin);
  // Superadmin parado en una sede que no es la suya por defecto → banner de impersonación (tema B).
  const activeSiteInfo = sites.find(site => site.siteCode === activeSite);
  const impersonating = superadmin && sites.length > 1 && !!activeSiteInfo && !activeSiteInfo.isDefault;
  const exitImpersonation = () => {
    const home = sites.find(site => site.isDefault) || sites[0];
    if (home) setActiveSite(home.siteCode);
  };
  const navItems = visibleNavItems(siteSettings, superadmin, access);
  const navKeys = navItems.map(item => item.key).join(',');

  // Con la sesión y los módulos resueltos, bajamos en idle los chunks de las
  // vistas que este rol puede abrir + los modales que se usan en todas.
  // Al hacer click el módulo ya está en memoria: cambio de vista instantáneo.
  useEffect(() => {
    if (!user || siteSettings === null) return;
    prefetchViewsWhenIdle([...navKeys.split(',').filter(Boolean), 'device-profile', 'assistant']);
  }, [navKeys, siteSettings, user]);

  // Nada mientras se resuelve la sesión. El pedido tarda ~170 ms: cualquier
  // cartel o placeholder alcanza a dibujarse y a irse, y ese parpadeo se nota
  // más que la espera. Queda el fondo de la página y listo.
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
    return <Suspense fallback={null}><LoginPage mode={authMode} onMode={mode => {
      setAuthMode(mode);
      window.history.replaceState(null, '', mode === 'landing' ? '/' : `/${mode}`);
    }} onReady={session => {
      setUser(session.user);
      setOperator(session.user.nombre || session.user.email);
      setSites(session.sites);
      const site = session.sites.find(item => item.isDefault) || session.sites[0];
      setActiveSite(site.siteCode);
      localStorage.setItem('techasset_active_site', site.siteCode);
      // Recién logueado: dejar la sesión recordada para que el próximo ingreso
      // pinte de una en vez de esperar la verificación.
      writeSessionCache(session.user, session.sites);
      setView('dashboard');
    }} /></Suspense>;
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar active={view} onNavigate={setView} onPrefetch={prefetchView} open={menuOpen} onClose={() => setMenuOpen(false)} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} activeSite={activeSite} sites={sites} settings={siteSettings} isSuperadmin={superadmin} access={access} themeProfile={themeProfile} impersonating={impersonating} />
      <main className="main main-content">
        <Topbar view={view} search={search} setSearch={setSearch} sync={sync} consultationMode={effectiveConsultation} onMenu={() => setMenuOpen(true)} onToggleTheme={toggleTheme} onReload={() => refresh({ force: true, wait: true })} activeSite={activeSite} sites={sites} onSiteChange={setActiveSite} user={user} onLogout={handleLogout} onNavigate={setView} themeProfile={themeProfile} impersonating={impersonating} onExitImpersonation={exitImpersonation} onOpenAssistant={() => setAssistantOpen(true)} />
        {/* El `key={view}` remonta este nodo en cada cambio de vista, y con eso
            se redispara la animación de entrada. Sólo hay entrada: sostener el
            árbol viejo para animar la salida agrega espera, y en una app de
            trabajo la espera se siente como lentitud. */}
        <div key={view} className="view-enter">
        <Suspense fallback={<section className="view active"><SkeletonView /></section>}>
        {view === 'dashboard' && <Dashboard key={activeSite} operator={operator} consultationMode={effectiveConsultation} devices={filteredDevices} counts={counts} agenda={agenda.items} tasks={tasks.items} movements={movements} onNavigate={setView} onLoan={openLoanFlow} onReturn={returnFromTable} onProfile={setProfile} onEdit={setEditingDevice} />}
        {view === 'devices' && <DevicesPage key={activeSite} devices={filteredDevices} consultationMode={effectiveConsultation} operator={operator} onAdd={onAddDevice} onLoan={openLoanFlow} onReturn={returnFromTable} onProfile={setProfile} onDelete={onDeleteDevice} onImported={() => refresh({ force: true, wait: true })} />}
        {view === 'loans' && <LoansPage key={activeSite} devices={devices} movements={movements} operator={operator} consultationMode={effectiveConsultation} onLend={onLend} onReturn={onReturn} onProfile={setProfile} initialCode={loanSeed} />}
        {view === 'inventory' && <InventoryPage key={activeSite} devices={filteredDevices} consultationMode={effectiveConsultation} onProfile={setProfile} onRefreshDevices={() => refresh({ force: true, wait: true })} />}
        {view === 'analytics' && <AnalyticsPage key={activeSite} devices={devices} onRefresh={refresh} />}
        {view === 'agenda' && <AgendaPage key={activeSite} items={agenda.items} consultationMode={effectiveConsultation} onSave={agenda.save} onDelete={agenda.remove} onTask={createTaskFromAgenda} onRefresh={agenda.refresh} />}
        {view === 'schedules' && <SchedulesPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'tasks' && <TasksPage key={activeSite} tasks={tasks.items} kpis={tasks.kpis} operator={operator} consultationMode={effectiveConsultation} onSave={tasks.save} onMove={(id: string, state: TaskState, columnId?: number | null) => tasks.move(id, state, columnId)} onDelete={tasks.remove} onRefresh={tasks.refresh} />}
        {view === 'pettycash' && <PettyCashPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'suggestions' && <SuggestionsPage key={activeSite} />}
        {view === 'classrooms' && <ClassroomStatusPage key={activeSite} operator={operator} consultationMode={effectiveConsultation} activeSite={activeSite} />}
        {view === 'tools' && <ToolsPage operator={operator} />}
        {view === 'quickaccess' && <QuickAccessPage operator={operator} consultationMode={effectiveConsultation} />}        {view === 'tickets' && <TicketsPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'tenants' && superadmin && <TenantsDashboard activeSite={activeSite} onSwitch={setActiveSite} onChanged={refreshSessionSites} />}
        {view === 'adminusers' && superadmin && <UsersByTenantPage consultationMode={effectiveConsultation} />}
        {view === 'settings' && <SettingsPage operator={operator} setOperator={setOperator} consultationMode={effectiveConsultation} setConsultationMode={setConsultationMode} siteRole={currentRole} roleReadOnly={roleReadOnly} sync={sync} user={user} sites={sites} onSitesChanged={refreshSessionSites} onModulesChanged={reloadSiteSettings} />}
        </Suspense>
        </div>
      </main>
      <MobileNav items={navItems} active={view} onNavigate={setView} onPrefetch={prefetchView} onMore={() => setMenuOpen(open => !open)} menuOpen={menuOpen} themeProfile={themeProfile} />
      <Suspense fallback={null}>
        <AssistantPanel
          onNavigate={next => setView(next as ViewKey)}
          onOpenDevice={deviceTag => {
            const match = resolveDeviceMatches(devices, deviceTag)[0];
            if (!match) return false;
            setProfile(match);
            return true;
          }}
          canEdit={!effectiveConsultation}
          context={assistantContext || { type: 'view', view, label: view }}
          open={assistantOpen}
          onOpenChange={setAssistantOpen}
          themeProfile={themeProfile}
        />
        {profile && <DeviceProfile device={profile} consultationMode={effectiveConsultation} onOpenDevice={setProfile} onClose={() => setProfile(null)} />}
        {editingDevice && <AddDeviceModal title={`Editar ${editingDevice.etiqueta}`} initialDevice={editingDevice} onClose={() => setEditingDevice(null)} onSave={onAddDevice} />}
      </Suspense>
    </div>
  );
}

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

function readSiteFromUrl() {
  const match = window.location.pathname.match(/^\/sede\/([^/]+)/i);
  return match?.[1]?.toUpperCase();
}

function readViewFromUrl(): ViewKey | null {
  const view = window.location.pathname.match(/^\/sede\/[^/]+\/([^/]+)/i)?.[1] as ViewKey | undefined;
  const allowed: ViewKey[] = ['dashboard', 'devices', 'loans', 'inventory', 'analytics', 'agenda', 'schedules', 'tasks', 'pettycash', 'classrooms', 'tickets', 'suggestions', 'tools', 'quickaccess', 'assistant', 'tenants', 'adminusers', 'settings'];
  return view && allowed.includes(view) ? view : null;
}

function readAuthModeFromUrl(): 'landing' | 'login' | 'register' {
  const path = window.location.pathname.toLowerCase();
  if (path === '/login') return 'login';
  if (path === '/register') return 'register';
  return 'landing';
}

function isTypingTarget(target: HTMLElement | null) {
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

import { useEffect, useRef, useState } from 'react';
import type { AuthUser, Device, Movement, SiteInfo, TaskState, ViewKey } from './types';
import { Sidebar, visibleNavItems } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MobileNav } from './components/layout/MobileNav';
import { AssistantPanel } from './components/assistant/AssistantPanel';
import { applyThemeProfile, isSmartProfile, profileForThemeAndStyle, readThemeProfile, saveThemeProfile, variantStyle, THEME_PROFILE_EVENT, type ThemeProfile } from './utils/themeProfile';
import { getUserPrefs } from './services/userPrefsApi';
import { Dashboard } from './components/dashboard/Dashboard';
import { DevicesPage } from './components/devices/DevicesPage';
import { DeviceProfile } from './components/devices/DeviceProfile';
import { AddDeviceModal } from './components/devices/AddDeviceModal';
import { LoansPage } from './components/loans/LoansPage';
import { InventoryPage } from './components/inventory/InventoryPage';
import { AgendaPage } from './components/agenda/AgendaPage';
import { TasksPage } from './components/tasks/TasksPage';
import { RemindersPage } from './components/reminders/RemindersPage';
import { SchedulesPage } from './components/schedules/SchedulesPage';
import { CanvasPage } from './components/canvas/CanvasPage';
import { PettyCashPage } from './components/pettycash/PettyCashPage';
import { KnowledgePage } from './components/knowledge/KnowledgePage';
import { SuggestionsPage } from './components/suggestions/SuggestionsPage';
import { AnalyticsPage } from './components/analytics/AnalyticsPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { ToolsPage } from './components/tools/ToolsPage';
import { QuickAccessPage } from './components/tools/QuickAccessPage';
import { ClassroomStatusPage } from './components/classrooms/ClassroomStatusPage';
import { TicketsPage } from './components/tickets/TicketsPage';
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
import { LoginPage } from './components/auth/LoginPage';
import { LandingPage } from './components/auth/LandingPage';
import { TenantsDashboard } from './components/settings/TenantsDashboard';
import { activeSiteRole, canViewModule, isReadOnlyRole, isSuperadmin, roleAccess } from './utils/permissions';
import { isViewEnabled, TOGGLEABLE_KEYS } from './utils/modules';
import { parseScannedCode } from './utils/normalizeSearch';
import type { AssistantContext } from './services/assistantApi';

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
    getAuthSession()
      .then(session => {
        if (session.authenticated && session.user && session.sites?.length) {
          setUser(session.user);
          setSites(session.sites);
          const allowed = fromUrl ? session.sites.find(site => site.siteCode.toLowerCase() === fromUrl.toLowerCase()) : null;
          const fallback = session.sites.find(site => site.isDefault) || session.sites[0];
          const site = allowed || fallback;
          if (fromUrl && !allowed) setView('dashboard');
          setActiveSite(site.siteCode);
          localStorage.setItem('techasset_active_site', site.siteCode);
          // Cargar preferencias del usuario (tema, etc.)
          getUserPrefs().then(data => {
            if (data.prefs?.themeProfile) {
              const p = data.prefs.themeProfile as ThemeProfile;
              saveThemeProfile(p);
            }
          }).catch(() => {});
        }
      })
      .finally(() => setAuthLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) setOperator(user.nombre || user.email);
  }, [user, setOperator]);

  useEffect(() => {
    if (!user || !activeSite) return;
    localStorage.setItem('techasset_active_site', activeSite);
    const next = `/sede/${activeSite.toLowerCase()}/${view}`;
    if (window.location.pathname !== next) window.history.replaceState(null, '', next);
    if (user) {
      void refresh({ force: true });
      void agenda.refresh();
      void tasks.refresh();
      getMovements().then(data => setMovements(data.items)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSite, view, user?.id]);

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
    getMovements().then(data => setMovements(data.items)).catch(() => {});
  }, Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 5));

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

  useEffect(() => {
    getMovements().then(data => setMovements(data.items)).catch(() => setMovements([]));
  }, [devices, agenda.items, tasks.items]);

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
    getMovements().then(data => setMovements(data.items)).catch(() => {});
  };

  const onLend = async (payload: Record<string, unknown>) => {
    try {
      const result = await lendDevice({ ...payload, operator });
      await refresh({ force: true, wait: true });
      return result;
    } finally {
      getMovements().then(data => setMovements(data.items)).catch(() => {});
    }
  };

  const onReturn = async (payload: Record<string, unknown>) => {
    try {
      const result = await returnDevice({ ...payload, operator });
      await refresh({ force: true, wait: true });
      return result;
    } finally {
      getMovements().then(data => setMovements(data.items)).catch(() => {});
    }
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

  if (authLoading) return <main className="login-shell"><section className="card login-card">Cargando sesión...</section></main>;
  if (!user) {
    const goMode = (mode: 'landing' | 'login' | 'register') => {
      setAuthMode(mode);
      window.history.replaceState(null, '', mode === 'landing' ? '/' : `/${mode}`);
    };
    if (authMode === 'landing') {
      return <LandingPage onLogin={() => goMode('login')} onRegister={() => goMode('register')} />;
    }
    return <LoginPage mode={authMode} onMode={mode => {
      setAuthMode(mode);
      window.history.replaceState(null, '', mode === 'landing' ? '/' : `/${mode}`);
    }} onReady={session => {
      setUser(session.user);
      setOperator(session.user.nombre || session.user.email);
      setSites(session.sites);
      const site = session.sites.find(item => item.isDefault) || session.sites[0];
      setActiveSite(site.siteCode);
      localStorage.setItem('techasset_active_site', site.siteCode);
      setView('dashboard');
    }} />;
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar active={view} onNavigate={setView} open={menuOpen} onClose={() => setMenuOpen(false)} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} activeSite={activeSite} sites={sites} settings={siteSettings} isSuperadmin={superadmin} access={access} themeProfile={themeProfile} impersonating={impersonating} />
      <main className="main main-content">
        <Topbar view={view} search={search} setSearch={setSearch} sync={sync} consultationMode={effectiveConsultation} onMenu={() => setMenuOpen(true)} onToggleTheme={toggleTheme} onReload={() => refresh({ force: true, wait: true })} activeSite={activeSite} sites={sites} onSiteChange={setActiveSite} user={user} onLogout={handleLogout} onNavigate={setView} themeProfile={themeProfile} impersonating={impersonating} onExitImpersonation={exitImpersonation} onOpenAssistant={() => setAssistantOpen(true)} />
        {view === 'dashboard' && <Dashboard key={activeSite} devices={filteredDevices} counts={counts} agenda={agenda.items} tasks={tasks.items} movements={movements} onNavigate={setView} onLoan={openLoanFlow} onReturn={openLoanFlow} onProfile={setProfile} onEdit={setEditingDevice} />}
        {view === 'devices' && <DevicesPage key={activeSite} devices={filteredDevices} consultationMode={effectiveConsultation} operator={operator} onAdd={onAddDevice} onLoan={openLoanFlow} onReturn={openLoanFlow} onProfile={setProfile} onDelete={onDeleteDevice} onImported={() => refresh({ force: true, wait: true })} />}
        {view === 'loans' && <LoansPage key={activeSite} devices={devices} movements={movements} operator={operator} consultationMode={effectiveConsultation} onLend={onLend} onReturn={onReturn} onProfile={setProfile} initialCode={loanSeed} />}
        {view === 'inventory' && <InventoryPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'analytics' && <AnalyticsPage key={activeSite} devices={devices} onRefresh={refresh} />}
        {view === 'agenda' && <AgendaPage key={activeSite} items={agenda.items} consultationMode={effectiveConsultation} onSave={agenda.save} onDelete={agenda.remove} onTask={createTaskFromAgenda} onRefresh={agenda.refresh} />}
        {view === 'schedules' && <SchedulesPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'tasks' && <TasksPage key={activeSite} tasks={tasks.items} kpis={tasks.kpis} operator={operator} consultationMode={effectiveConsultation} onSave={tasks.save} onMove={(id: string, state: TaskState) => tasks.move(id, state)} onDelete={tasks.remove} onRefresh={tasks.refresh} />}
        {view === 'reminders' && <RemindersPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'canvas' && <CanvasPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'pettycash' && <PettyCashPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'knowledge' && <KnowledgePage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'suggestions' && <SuggestionsPage key={activeSite} />}
        {view === 'classrooms' && <ClassroomStatusPage key={activeSite} operator={operator} consultationMode={effectiveConsultation} activeSite={activeSite} />}
        {view === 'tools' && <ToolsPage operator={operator} />}
        {view === 'quickaccess' && <QuickAccessPage operator={operator} consultationMode={effectiveConsultation} />}
        {view === 'tickets' && <TicketsPage key={activeSite} consultationMode={effectiveConsultation} />}
        {view === 'tenants' && superadmin && <TenantsDashboard activeSite={activeSite} onSwitch={setActiveSite} onChanged={refreshSessionSites} />}
        {view === 'settings' && <SettingsPage operator={operator} setOperator={setOperator} consultationMode={effectiveConsultation} setConsultationMode={setConsultationMode} siteRole={currentRole} roleReadOnly={roleReadOnly} sync={sync} user={user} sites={sites} onSitesChanged={refreshSessionSites} onModulesChanged={reloadSiteSettings} />}
      </main>
      <MobileNav items={navItems} active={view} onNavigate={setView} onMore={() => setMenuOpen(true)} themeProfile={themeProfile} />
      <AssistantPanel
        onNavigate={next => setView(next as ViewKey)}
        canEdit={!effectiveConsultation}
        context={assistantContext || { type: 'view', view, label: view }}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        themeProfile={themeProfile}
      />
      {profile && <DeviceProfile device={profile} consultationMode={effectiveConsultation} onOpenDevice={setProfile} onClose={() => setProfile(null)} />}
      {editingDevice && <AddDeviceModal title={`Editar ${editingDevice.etiqueta}`} initialDevice={editingDevice} onClose={() => setEditingDevice(null)} onSave={onAddDevice} />}
    </div>
  );
}

function readSiteFromUrl() {
  const match = window.location.pathname.match(/^\/sede\/([^/]+)/i);
  return match?.[1]?.toUpperCase();
}

function readViewFromUrl(): ViewKey | null {
  const view = window.location.pathname.match(/^\/sede\/[^/]+\/([^/]+)/i)?.[1] as ViewKey | undefined;
  const allowed: ViewKey[] = ['dashboard', 'devices', 'loans', 'inventory', 'analytics', 'agenda', 'schedules', 'tasks', 'canvas', 'pettycash', 'classrooms', 'tickets', 'knowledge', 'tools', 'quickaccess', 'assistant', 'tenants', 'settings'];
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

import { useEffect, useState } from 'react';
import type { AuthUser, Device, Movement, SiteInfo, TaskState, ViewKey } from './types';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Dashboard } from './components/dashboard/Dashboard';
import { DevicesPage } from './components/devices/DevicesPage';
import { DeviceProfile } from './components/devices/DeviceProfile';
import { AddDeviceModal } from './components/devices/AddDeviceModal';
import { LoansPage } from './components/loans/LoansPage';
import { InventoryPage } from './components/inventory/InventoryPage';
import { AgendaPage } from './components/agenda/AgendaPage';
import { TasksPage } from './components/tasks/TasksPage';
import { AnalyticsPage } from './components/analytics/AnalyticsPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { ToolsPage } from './components/tools/ToolsPage';
import { QuickAccessPage } from './components/tools/QuickAccessPage';
import { ClassroomStatusPage } from './components/classrooms/ClassroomStatusPage';
import { useOperator } from './hooks/useOperator';
import { useDevices } from './hooks/useDevices';
import { useAgenda } from './hooks/useAgenda';
import { useTasks } from './hooks/useTasks';
import { useScrollReveal } from './hooks/useScrollReveal';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { addDevice, deleteDevice, getMovements } from './services/devicesApi';
import { lendDevice, returnDevice } from './services/loansApi';
import { createTask } from './services/tasksApi';
import { getAuthSession, logout as logoutSession } from './services/authApi';
import { LoginPage } from './components/auth/LoginPage';

export function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [authMode, setAuthMode] = useState<'landing' | 'login' | 'register'>(() => readAuthModeFromUrl());
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('techasset_sidebar_collapsed') === '1');
  const [consultationMode, setConsultationMode] = useState(false);
  const [profile, setProfile] = useState<Device | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [loanSeed, setLoanSeed] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [activeSite, setActiveSite] = useState('');
  const { operator, setOperator } = useOperator();
  const { devices, filteredDevices, counts, sync, refresh, patchLocal, removeLocal } = useDevices(search, activeSite);
  const agenda = useAgenda(operator);
  const tasks = useTasks(operator);
  useScrollReveal([view, filteredDevices.length, agenda.items.length, tasks.items.length, movements.length]);

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

  useAutoRefresh(() => {
    if (document.hidden) return;
    void refresh();
    getMovements().then(data => setMovements(data.items)).catch(() => {});
  }, Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 5));

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', localStorage.getItem('techasset_nfpt_theme') === 'light');
  }, []);

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

  const toggleTheme = () => {
    const next = document.documentElement.classList.contains('theme-light') ? 'dark' : 'light';
    document.documentElement.classList.toggle('theme-light', next === 'light');
    localStorage.setItem('techasset_nfpt_theme', next);
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
    const tag = String(payload.etiqueta || '');
    if (tag) patchLocal(tag, { estado: 'Prestado', prestadoA: String(payload.person || ''), ubicacion: [payload.location, payload.course, payload.locationDetail].map(v => String(v || '').trim()).filter(Boolean).join(' · '), motivo: [payload.reason, payload.reasonDetail].map(v => String(v || '').trim()).filter(Boolean).join(' · '), rol: String(payload.role || ''), comentarios: String(payload.comment || '') });
    try {
      return await lendDevice({ ...payload, operator });
    } finally {
      void refresh();
      getMovements().then(data => setMovements(data.items)).catch(() => {});
    }
  };

  const onReturn = async (payload: Record<string, unknown>) => {
    const tag = String(payload.etiqueta || '');
    if (tag) patchLocal(tag, { estado: 'Disponible', prestadoA: '', ubicacion: '', motivo: '', rol: '' });
    try {
      return await returnDevice({ ...payload, operator });
    } finally {
      void refresh();
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
    setLoanSeed(typeof deviceOrCode === 'string' ? deviceOrCode : deviceOrCode.etiqueta);
    setView('loans');
  };

  if (authLoading) return <main className="login-shell"><section className="card login-card">Cargando sesión...</section></main>;
  if (!user) {
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
      <Sidebar active={view} onNavigate={setView} open={menuOpen} onClose={() => setMenuOpen(false)} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} activeSite={activeSite} sites={sites} />
      <main className="main main-content">
        <Topbar view={view} search={search} setSearch={setSearch} sync={sync} consultationMode={consultationMode} onMenu={() => setMenuOpen(true)} onToggleTheme={toggleTheme} onReload={() => refresh({ force: true, wait: true })} activeSite={activeSite} sites={sites} onSiteChange={setActiveSite} user={user} onLogout={handleLogout} />
        {view === 'dashboard' && <Dashboard key={activeSite} devices={filteredDevices} counts={counts} agenda={agenda.items} tasks={tasks.items} movements={movements} onNavigate={setView} onLoan={openLoanFlow} onReturn={device => onReturn({ etiqueta: device.etiqueta })} onProfile={setProfile} onEdit={setEditingDevice} />}
        {view === 'devices' && <DevicesPage key={activeSite} devices={filteredDevices} consultationMode={consultationMode} onAdd={onAddDevice} onLoan={openLoanFlow} onReturn={device => onReturn({ etiqueta: device.etiqueta })} onDelete={onDeleteDevice} />}
        {view === 'loans' && <LoansPage key={activeSite} devices={devices} movements={movements} operator={operator} consultationMode={consultationMode} onLend={onLend} onReturn={onReturn} initialCode={loanSeed} />}
        {view === 'inventory' && <InventoryPage key={activeSite} consultationMode={consultationMode} />}
        {view === 'analytics' && <AnalyticsPage key={activeSite} devices={devices} onRefresh={refresh} />}
        {view === 'agenda' && <AgendaPage key={activeSite} items={agenda.items} consultationMode={consultationMode} onSave={agenda.save} onDelete={agenda.remove} onTask={createTaskFromAgenda} onRefresh={agenda.refresh} />}
        {view === 'tasks' && <TasksPage key={activeSite} tasks={tasks.items} kpis={tasks.kpis} operator={operator} consultationMode={consultationMode} onSave={tasks.save} onMove={(id: string, state: TaskState) => tasks.move(id, state)} onDelete={tasks.remove} onRefresh={tasks.refresh} />}
        {view === 'classrooms' && <ClassroomStatusPage key={activeSite} operator={operator} consultationMode={consultationMode} activeSite={activeSite} />}
        {view === 'tools' && <ToolsPage operator={operator} />}
        {view === 'quickaccess' && <QuickAccessPage operator={operator} consultationMode={consultationMode} />}
        {view === 'settings' && <SettingsPage operator={operator} setOperator={setOperator} consultationMode={consultationMode} setConsultationMode={setConsultationMode} sync={sync} user={user} sites={sites} onSitesChanged={refreshSessionSites} />}
      </main>
      {profile && <DeviceProfile device={profile} onClose={() => setProfile(null)} />}
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
  const allowed: ViewKey[] = ['dashboard', 'devices', 'loans', 'inventory', 'analytics', 'agenda', 'tasks', 'classrooms', 'tools', 'quickaccess', 'assistant', 'settings'];
  return view && allowed.includes(view) ? view : null;
}

function readAuthModeFromUrl(): 'landing' | 'login' | 'register' {
  const path = window.location.pathname.toLowerCase();
  if (path === '/login') return 'login';
  if (path === '/register') return 'register';
  return 'landing';
}

import { useEffect, useState } from 'react';
import type { AuthUser, Device, Movement, SiteInfo, TaskState, ViewKey } from './types';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Dashboard } from './components/dashboard/Dashboard';
import { DevicesPage } from './components/devices/DevicesPage';
import { DeviceProfile } from './components/devices/DeviceProfile';
import { AddDeviceModal } from './components/devices/AddDeviceModal';
import { LoansPage } from './components/loans/LoansPage';
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
import { getAuthSession } from './services/authApi';
import { LoginPage } from './components/auth/LoginPage';

export function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [consultationMode, setConsultationMode] = useState(false);
  const [profile, setProfile] = useState<Device | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [loanSeed, setLoanSeed] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [activeSite, setActiveSite] = useState(localStorage.getItem('techasset_active_site') || readSiteFromUrl() || 'NFPT');
  const { operator, setOperator } = useOperator();
  const { devices, filteredDevices, counts, sync, refresh, patchLocal, removeLocal } = useDevices(search);
  const agenda = useAgenda(operator);
  const tasks = useTasks(operator);
  useScrollReveal([view, filteredDevices.length, agenda.items.length, tasks.items.length, movements.length]);

  useEffect(() => {
    const fromUrl = readSiteFromUrl();
    const fromView = readViewFromUrl();
    if (fromUrl) {
      setActiveSite(fromUrl);
      localStorage.setItem('techasset_active_site', fromUrl);
    }
    if (fromView) setView(fromView);
    getAuthSession()
      .then(session => {
        if (session.authenticated && session.user && session.sites?.length) {
          setUser(session.user);
          setSites(session.sites);
          const allowed = session.sites.find(site => site.siteCode.toLowerCase() === activeSite.toLowerCase()) || session.sites.find(site => site.isDefault) || session.sites[0];
          setActiveSite(allowed.siteCode);
          localStorage.setItem('techasset_active_site', allowed.siteCode);
        }
      })
      .finally(() => setAuthLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
      await lendDevice({ ...payload, operator });
    } finally {
      void refresh();
      getMovements().then(data => setMovements(data.items)).catch(() => {});
    }
  };

  const onReturn = async (payload: Record<string, unknown>) => {
    const tag = String(payload.etiqueta || '');
    if (tag) patchLocal(tag, { estado: 'Disponible', prestadoA: '', ubicacion: '', motivo: '', rol: '' });
    try {
      await returnDevice({ ...payload, operator });
    } finally {
      void refresh();
      getMovements().then(data => setMovements(data.items)).catch(() => {});
    }
  };

  const createTaskFromAgenda = async (item: { id: string; curso: string; actividad: string }) => {
    await createTask({ titulo: `Revisar ${item.curso} - ${item.actividad}`, responsable: operator === 'Equi' ? 'Equi' : 'Bauti', prioridad: 'Media', agendaId: item.id, operator });
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

  const openLoanFlow = (deviceOrCode: Device | string) => {
    setLoanSeed(typeof deviceOrCode === 'string' ? deviceOrCode : deviceOrCode.etiqueta);
    setView('loans');
  };

  if (authLoading) return <main className="login-shell"><section className="card login-card">Cargando sesión...</section></main>;
  if (!user) {
    return <LoginPage onReady={session => {
      setUser(session.user);
      setSites(session.sites);
      const site = session.sites.find(item => item.isDefault) || session.sites[0];
      setActiveSite(site.siteCode);
      localStorage.setItem('techasset_active_site', site.siteCode);
    }} />;
  }

  return (
    <div className="app-shell">
      <Sidebar active={view} onNavigate={setView} open={menuOpen} onClose={() => setMenuOpen(false)} onReload={refresh} />
      <main className="main main-content">
        <Topbar view={view} search={search} setSearch={setSearch} operator={operator} setOperator={setOperator} sync={sync} consultationMode={consultationMode} onMenu={() => setMenuOpen(true)} onToggleTheme={toggleTheme} activeSite={activeSite} sites={sites} onSiteChange={setActiveSite} user={user} />
        {view === 'dashboard' && <Dashboard devices={filteredDevices} counts={counts} agenda={agenda.items} tasks={tasks.items} movements={movements} onNavigate={setView} onLoan={openLoanFlow} onReturn={device => onReturn({ etiqueta: device.etiqueta })} onProfile={setProfile} onEdit={setEditingDevice} />}
        {view === 'devices' && <DevicesPage devices={filteredDevices} consultationMode={consultationMode} onAdd={onAddDevice} onLoan={openLoanFlow} onReturn={device => onReturn({ etiqueta: device.etiqueta })} onDelete={onDeleteDevice} />}
        {view === 'loans' && <LoansPage devices={devices} movements={movements} operator={operator} consultationMode={consultationMode} onLend={onLend} onReturn={onReturn} initialCode={loanSeed} />}
        {view === 'analytics' && <AnalyticsPage devices={devices} onRefresh={refresh} />}
        {view === 'agenda' && <AgendaPage items={agenda.items} consultationMode={consultationMode} onSave={agenda.save} onDelete={agenda.remove} onTask={createTaskFromAgenda} onRefresh={agenda.refresh} />}
        {view === 'tasks' && <TasksPage tasks={tasks.items} kpis={tasks.kpis} operator={operator} consultationMode={consultationMode} onSave={tasks.save} onMove={(id: string, state: TaskState) => tasks.move(id, state)} onDelete={tasks.remove} onRefresh={tasks.refresh} />}
        {view === 'classrooms' && <ClassroomStatusPage operator={operator} consultationMode={consultationMode} />}
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
  const allowed: ViewKey[] = ['dashboard', 'devices', 'loans', 'analytics', 'agenda', 'tasks', 'classrooms', 'tools', 'quickaccess', 'assistant', 'settings'];
  return view && allowed.includes(view) ? view : null;
}

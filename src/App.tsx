import { useEffect, useState } from 'react';
import type { Device, Movement, TaskState, ViewKey } from './types';
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
import { AssistantPanel } from './components/assistant/AssistantPanel';
import { useOperator } from './hooks/useOperator';
import { useDevices } from './hooks/useDevices';
import { useAgenda } from './hooks/useAgenda';
import { useTasks } from './hooks/useTasks';
import { useScrollReveal } from './hooks/useScrollReveal';
import { addDevice, getMovements } from './services/devicesApi';
import { lendDevice, returnDevice } from './services/loansApi';
import { createTask } from './services/tasksApi';

export function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [consultationMode, setConsultationMode] = useState(false);
  const [profile, setProfile] = useState<Device | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [loanSeed, setLoanSeed] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const { operator, setOperator } = useOperator();
  const { devices, filteredDevices, counts, sync, refresh } = useDevices(search);
  const agenda = useAgenda(operator);
  const tasks = useTasks(operator);
  useScrollReveal([view, filteredDevices.length, agenda.items.length, tasks.items.length, movements.length]);

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

  const onLend = async (payload: Record<string, unknown>) => {
    await lendDevice({ ...payload, operator });
    await refresh();
  };

  const onReturn = async (payload: Record<string, unknown>) => {
    await returnDevice({ ...payload, operator });
    await refresh();
  };

  const createTaskFromAgenda = async (item: { id: string; curso: string; actividad: string }) => {
    await createTask({ titulo: `Revisar ${item.curso} - ${item.actividad}`, responsable: operator === 'Equi' ? 'Equi' : 'Bauti', prioridad: 'Media', agendaId: item.id, operator });
    await tasks.refresh();
    setView('tasks');
  };

  const navigateFromAssistant = (target: string) => {
    const map: Record<string, ViewKey> = { dashboard: 'dashboard', devices: 'devices', loans: 'loans', agenda: 'agenda', tasks: 'tasks', analytics: 'analytics', settings: 'settings' };
    if (map[target]) setView(map[target]);
  };

  const openLoanFlow = (deviceOrCode: Device | string) => {
    setLoanSeed(typeof deviceOrCode === 'string' ? deviceOrCode : deviceOrCode.etiqueta);
    setView('loans');
  };

  return (
    <div className="app-shell">
      <Sidebar active={view} onNavigate={setView} open={menuOpen} onClose={() => setMenuOpen(false)} onReload={refresh} />
      <main className="main main-content">
        <Topbar view={view} search={search} setSearch={setSearch} operator={operator} setOperator={setOperator} sync={sync} consultationMode={consultationMode} onMenu={() => setMenuOpen(true)} onToggleTheme={toggleTheme} />
        {view === 'dashboard' && <Dashboard devices={filteredDevices} counts={counts} agenda={agenda.items} tasks={tasks.items} movements={movements} onNavigate={setView} onLoan={openLoanFlow} onReturn={device => onReturn({ etiqueta: device.etiqueta })} onProfile={setProfile} onEdit={setEditingDevice} />}
        {view === 'devices' && <DevicesPage devices={filteredDevices} consultationMode={consultationMode} onAdd={onAddDevice} onLoan={openLoanFlow} onReturn={device => onReturn({ etiqueta: device.etiqueta })} />}
        {view === 'loans' && <LoansPage devices={devices} movements={movements} consultationMode={consultationMode} onLend={onLend} onReturn={onReturn} initialCode={loanSeed} />}
        {view === 'analytics' && <AnalyticsPage devices={devices} onRefresh={refresh} />}
        {view === 'agenda' && <AgendaPage items={agenda.items} consultationMode={consultationMode} onSave={agenda.save} onDelete={agenda.remove} onTask={createTaskFromAgenda} onRefresh={agenda.refresh} />}
        {view === 'tasks' && <TasksPage tasks={tasks.items} kpis={tasks.kpis} consultationMode={consultationMode} onSave={tasks.save} onMove={(id: string, state: TaskState) => tasks.move(id, state)} onDelete={tasks.remove} onRefresh={tasks.refresh} />}
        {view === 'settings' && <SettingsPage operator={operator} setOperator={setOperator} consultationMode={consultationMode} setConsultationMode={setConsultationMode} sync={sync} />}
      </main>
      <AssistantPanel onNavigate={navigateFromAssistant} onLoanDraft={openLoanFlow} />
      {profile && <DeviceProfile device={profile} onClose={() => setProfile(null)} />}
      {editingDevice && <AddDeviceModal title={`Editar ${editingDevice.etiqueta}`} initialDevice={editingDevice} onClose={() => setEditingDevice(null)} onSave={onAddDevice} />}
    </div>
  );
}

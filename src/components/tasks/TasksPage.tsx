import { useMemo, useState } from 'react';
import type { TaskItem, TaskState } from '../../types';
import { Button } from '../layout/Button';
import { StatCard } from '../layout/StatCard';
import { TaskBoard } from './TaskBoard';
import { TaskModal } from './TaskModal';
import { TaskCard } from './TaskCard';
import { TaskAnalytics } from './TaskAnalytics';
import { InternalNotesPanel } from '../dashboard/InternalNotesPanel';

const PRIORITY_RANK: Record<string, number> = { Urgente: 0, Media: 1, Baja: 2 };

export function TasksPage({ tasks, kpis, operator, consultationMode, onSave, onMove, onDelete, onRefresh }: { tasks: TaskItem[]; kpis: Record<string, number>; operator: string; consultationMode: boolean; onSave: (task: Partial<TaskItem>) => Promise<unknown>; onMove: (id: string, state: TaskState) => void; onDelete: (id: string) => void; onRefresh?: () => Promise<unknown> | void }) {
  const [tab, setTab] = useState<'board' | 'schedule' | 'handoff'>('board');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);

  const grouped = useMemo(() => {
    const buckets: Record<string, TaskItem[]> = { Urgente: [], Media: [], Baja: [] };
    for (const task of tasks) {
      if (task.estado === 'Hecha') continue;
      const key = (task.prioridad || 'Media') as keyof typeof buckets;
      (buckets[key] || (buckets.Media)).push(task);
    }
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => (PRIORITY_RANK[a.prioridad] ?? 1) - (PRIORITY_RANK[b.prioridad] ?? 1) || a.titulo.localeCompare(b.titulo));
    }
    return buckets;
  }, [tasks]);

  const doneTasks = useMemo(() => tasks.filter(task => task.estado === 'Hecha').sort((a, b) => (b.ultimaModificacion || '').localeCompare(a.ultimaModificacion || '')), [tasks]);

  return (
    <section className="view active">
      <div className="agenda-toolbar-actions">
        <Button onClick={() => onRefresh?.()}>Actualizar</Button>
        <Button variant="primary" disabled={consultationMode} onClick={() => setCreating(true)}>+ Nueva tarea</Button>
      </div>
      <div className="agenda-tabs">
        <button className={`agenda-tab ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>Tablero</button>
        <button className={`agenda-tab ${tab === 'schedule' ? 'active' : ''}`} onClick={() => setTab('schedule')}>Por prioridad</button>
        <button className={`agenda-tab ${tab === 'handoff' ? 'active' : ''}`} onClick={() => setTab('handoff')}>Traspaso TIC</button>
      </div>
      {tab !== 'handoff' && <div className="stats-grid agenda-kpi-grid">
        <StatCard label="Total tareas" value={kpis.total || 0} />
        <StatCard label="Pendientes" value={kpis.pending || 0} />
        <StatCard label="En proceso" value={kpis.progress || 0} />
        <StatCard label="Hechas" value={kpis.done || 0} />
        <StatCard label="Vencidas" value={kpis.overdue || 0} />
        <StatCard label="Bauti" value={kpis.bauti || 0} />
        <StatCard label="Equi" value={kpis.equi || 0} />
        <StatCard label="Mis tareas" value={kpis.mine || 0} />
      </div>}
      {tab === 'handoff' ? (
        <InternalNotesPanel operator={operator} consultationMode={consultationMode} />
      ) : tab === 'board' ? (
        <TaskBoard tasks={tasks} operator={operator} consultationMode={consultationMode} onMove={onMove} onDelete={onDelete} onSave={onSave} onEdit={setEditing} onRefresh={onRefresh} />
      ) : (
        <>
          <div className="task-schedule-grid">
            {(['Urgente', 'Media', 'Baja'] as const).map(level => (
              <section className={`task-schedule-col task-priority-${level.toLowerCase()}`} key={level}>
                <header className="task-schedule-head">
                  <strong>{level}</strong>
                  <span className="badge subtle">{grouped[level].length}</span>
                </header>
                <div className="task-schedule-list">
                  {grouped[level].map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      consultationMode={consultationMode}
                      operator={operator}
                      onMove={state => onMove(task.id, state)}
                      onDelete={() => onDelete(task.id)}
                      onPatch={patch => onSave({ ...task, ...patch })}
                      onEdit={() => setEditing(task)}
                      onRefresh={onRefresh}
                    />
                  ))}
                  {!grouped[level].length && <div className="empty-state">Sin tareas</div>}
                </div>
              </section>
            ))}
          </div>
          <section className="task-done-section">
            <header className="task-schedule-head">
              <strong>Terminadas</strong>
              <span className="badge subtle">{doneTasks.length}</span>
            </header>
            <div className="task-done-list">
              {doneTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  consultationMode={consultationMode}
                  operator={operator}
                  onMove={state => onMove(task.id, state)}
                  onDelete={() => onDelete(task.id)}
                  onPatch={patch => onSave({ ...task, ...patch })}
                  onEdit={() => setEditing(task)}
                  onRefresh={onRefresh}
                />
              ))}
              {!doneTasks.length && <div className="empty-state">Aun no hay tareas terminadas</div>}
            </div>
          </section>
        </>
      )}
      {tab !== 'handoff' && <TaskAnalytics tasks={tasks} />}
      {creating && <TaskModal onClose={() => setCreating(false)} onSave={onSave} />}
      {editing && <TaskModal initial={editing} onClose={() => setEditing(null)} onSave={onSave} />}
    </section>
  );
}

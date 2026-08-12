import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskColumn, TaskItem, TaskState } from '../../types';
import { Button } from '../layout/Button';
import { TaskBoard } from './TaskBoard';
import { TaskModal } from './TaskModal';
import { TaskCard } from './TaskCard';
import { TaskAnalytics } from './TaskAnalytics';
import { createTaskColumn, deleteTaskColumn, getTaskColumns, reorderTaskColumns, updateTaskColumn } from '../../services/tasksApi';
import { useTabPill } from '../../hooks/useTabPill';
import { GooeyMenu } from '../layout/GooeyMenu';
import { Lock, Users } from 'lucide-react';

const PRIORITIES = ['Urgente', 'Media', 'Baja'];

export function TasksPage(props: { tasks: TaskItem[]; kpis: Record<string, number>; operator: string; consultationMode: boolean; onSave: (task: Partial<TaskItem>) => Promise<unknown>; onMove: (id: string, state: TaskState, columnId?: number | null) => Promise<unknown> | void; onDelete: (id: string) => void; onRefresh?: () => Promise<unknown> | void }) {
  const { tasks, operator, consultationMode, onSave, onMove, onDelete, onRefresh } = props;
  const [space, setSpace] = useState<'my' | 'team'>('team');
  const [tab, setTab] = useState<'board' | 'priority'>('board');
  const tabPill = useTabPill<HTMLDivElement>(tab);
  const spacePill = useTabPill<HTMLDivElement>(space);
  const [columns, setColumns] = useState<TaskColumn[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [message, setMessage] = useState('');

  const refreshColumns = useCallback(async () => { const response = await getTaskColumns(); setColumns(response.items); }, []);
  useEffect(() => { refreshColumns().catch(() => setMessage('No se pudieron cargar las columnas.')); }, [refreshColumns]);

  const visibleTasks = useMemo(() => tasks.filter(task => {
    if (space === 'team') return task.visibility !== 'private';
    if (task.visibility === 'private') return true;
    return task.responsables?.includes(operator) || String(task.responsable || '').split(',').map(value => value.trim()).includes(operator);
  }), [tasks, space, operator]);

  const byPriority = useMemo(() => Object.fromEntries(PRIORITIES.map(priority => [priority, visibleTasks.filter(task => !task.done && (task.prioridad || 'Media') === priority)])) as Record<string, TaskItem[]>, [visibleTasks]);

  const createColumn = async (name: string) => { await createTaskColumn({ name }); await refreshColumns(); };
  const renameColumn = async (column: TaskColumn, name: string) => { await updateTaskColumn(column.id, { name }); await refreshColumns(); await onRefresh?.(); };
  const removeColumn = async (column: TaskColumn) => { await deleteTaskColumn(column.id); await refreshColumns(); await onRefresh?.(); };
  const reorderColumns = async (ids: number[]) => { const response = await reorderTaskColumns(ids); setColumns(response.items); };

  return <section className="view active tasks-workspace">
    <div className="tasks-compact-toolbar card">
      <div className="task-space-toggle t-tabs" aria-label="Espacio de tareas" ref={spacePill.ref}>
        <span className="t-tabs-pill" style={spacePill.style} aria-hidden="true" />
        <button className={space === 'team' ? 'active' : ''} data-tab-active={space === 'team'} onClick={() => setSpace('team')}>Equipo</button>
        <button className={space === 'my' ? 'active' : ''} data-tab-active={space === 'my'} onClick={() => setSpace('my')}>Mis tareas</button>
      </div>
      <div className="tasks-subnav t-tabs" ref={tabPill.ref}>
        <span className="t-tabs-pill" style={tabPill.style} aria-hidden="true" />
        <button className={tab === 'board' ? 'active' : ''} data-tab-active={tab === 'board'} onClick={() => setTab('board')}>Tablero</button>
        <button className={tab === 'priority' ? 'active' : ''} data-tab-active={tab === 'priority'} onClick={() => setTab('priority')}>Prioridad</button>
      </div>
      {/* El "+" del gooey ES el botón de crear: ocupa su lugar en la barra en
          vez de flotar suelto por la página. */}
      <div className="tasks-primary-actions">
        <Button onClick={() => onRefresh?.()} aria-label="Actualizar">↻</Button>
        {!consultationMode && (
          <GooeyMenu
            ariaLabel="Nueva tarea"
            items={[
              { id: 'team', label: 'Nueva tarea de equipo', icon: <Users size={16} />, onSelect: () => { setSpace('team'); setCreating(true); } },
              { id: 'mine', label: 'Nueva tarea privada', icon: <Lock size={16} />, onSelect: () => { setSpace('my'); setCreating(true); } }
            ]}
          />
        )}
      </div>
    </div>
    {message && <div className="tool-info">{message}</div>}

    {tab === 'board' ? <TaskBoard tasks={visibleTasks} columns={columns} operator={operator} consultationMode={consultationMode} onSave={onSave} onMove={onMove} onDelete={onDelete} onEdit={setEditing} onRefresh={onRefresh} onCreateColumn={createColumn} onRenameColumn={renameColumn} onDeleteColumn={removeColumn} onReorderColumns={reorderColumns} /> : <div className="task-schedule-grid">{PRIORITIES.map(priority => <section className={`task-schedule-col task-priority-${priority.toLowerCase()}`} key={priority}><header className="task-schedule-head"><strong>{priority}</strong><span className="badge subtle">{byPriority[priority].length}</span></header><div className="task-schedule-list">{byPriority[priority].map(task => <TaskCard key={task.id} task={task} consultationMode={consultationMode} operator={operator} onMove={() => undefined} onDelete={() => onDelete(task.id)} onPatch={patch => onSave({ ...task, ...patch })} onEdit={() => setEditing(task)} onRefresh={onRefresh} />)}{!byPriority[priority].length && <div className="empty-state">Sin tareas</div>}</div></section>)}</div>}

    {space === 'team' && <TaskAnalytics tasks={visibleTasks} />}
    {creating && <TaskModal operator={operator} defaultVisibility={space === 'my' ? 'private' : 'team'} onClose={() => setCreating(false)} onSave={onSave} />}
    {editing && <TaskModal operator={operator} initial={editing} defaultVisibility={editing.visibility || 'team'} onClose={() => setEditing(null)} onSave={onSave} />}

  </section>;
}

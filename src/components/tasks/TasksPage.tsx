import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskColumn, TaskItem, TaskState } from '../../types';
import { Button } from '../layout/Button';
import { TaskBoard, TaskBoardSkeleton } from './TaskBoard';
import { TaskModal } from './TaskModal';
import { TaskCard } from './TaskCard';
import { TaskAnalytics } from './TaskAnalytics';
import { createTaskColumn, deleteTaskColumn, getTaskColumns, reorderTaskColumns, updateTaskColumn } from '../../services/tasksApi';
import { useTabPill } from '../../hooks/useTabPill';
import { useCardResize } from '../../hooks/useCardResize';
import { AnimatedNumber } from '../layout/AnimatedNumber';
import { GooeyMenu } from '../layout/GooeyMenu';
import { Columns3, Lock, Users } from 'lucide-react';
import { Modal } from '../layout/Modal';
import { SelectionBar, useSelection } from '../layout/Selection';
import { deleteTask } from '../../services/tasksApi';
import { confirmDialog, toast, toastError } from '../layout/Feedback';
import { clearOpenTask, peekOpenTask } from '../../utils/openTask';

const PRIORITIES = ['Urgente', 'Media', 'Baja'];

export function TasksPage(props: { tasks: TaskItem[]; kpis: Record<string, number>; operator: string; consultationMode: boolean; onSave: (task: Partial<TaskItem>) => Promise<unknown>; onMove: (id: string, state: TaskState, columnId?: number | null) => Promise<unknown> | void; onDelete: (id: string) => void; onRefresh?: () => Promise<unknown> | void }) {
  const { tasks, operator, consultationMode, onSave, onMove, onDelete, onRefresh } = props;
  const [space, setSpace] = useState<'my' | 'team'>('team');
  // Selección múltiple: mover o borrar varias tareas de una.
  const selection = useSelection();
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedTasks = tasks.filter(task => selection.selected.has(task.id));
  // Se mueve a una COLUMNA (cada sede tiene las suyas): con solo el estado, la
  // tarea conservaba su columna vieja y el server la dejaba donde estaba.
  const bulkMove = async (column: TaskColumn) => {
    setBulkBusy(true);
    try {
      for (const task of selectedTasks) if (task.columnId !== column.id) await onMove(task.id, column.name, column.id);
      toast({ message: `${selectedTasks.length} tareas en "${column.name}".`, tone: 'ok' });
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'No se pudieron mover todas.', tone: 'error' });
    } finally {
      setBulkBusy(false);
      selection.clear();
    }
  };
  const bulkDelete = async () => {
    if (!(await confirmDialog({ title: `Borrar ${selectedTasks.length} tareas`, message: selectedTasks.map(task => task.titulo).join(' · '), confirmLabel: 'Borrar', danger: true }))) return;
    setBulkBusy(true);
    const failed: string[] = [];
    for (const task of selectedTasks) {
      try { await deleteTask(task.id, operator); } catch { failed.push(task.titulo); }
    }
    setBulkBusy(false);
    selection.clear();
    await onRefresh?.();
    if (failed.length) toast({ message: `No se pudieron borrar: ${failed.join(', ')}`, tone: 'error' });
  };
  const taskSelection = consultationMode ? undefined : { selected: selection.selected, onToggle: selection.toggle };
  const [tab, setTab] = useState<'board' | 'priority'>('board');
  const tabPill = useTabPill<HTMLDivElement>(tab);
  const spacePill = useTabPill<HTMLDivElement>(space);
  const resizeRef = useCardResize<HTMLDivElement>(`${space}:${tab}`);
  const [columns, setColumns] = useState<TaskColumn[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  // Inicio → "Tus tareas": abre ESA tarea apenas llega a la lista.
  useEffect(() => {
    const id = peekOpenTask();
    if (!id) return;
    const task = tasks.find(item => String(item.id) === id);
    if (!task) return;
    clearOpenTask();
    setEditing(task);
  }, [tasks]);
  const [message, setMessage] = useState('');
  // `null` = cerrado. Un string vacío abre el modal de nueva columna.
  const [columnDraft, setColumnDraft] = useState<string | null>(null);

  // Las columnas llegan por red. Hasta que estén, el tablero se dibuja como
  // esqueleto: si no, renderiza vacío, la analítica de abajo sube hasta el tope
  // y después la empujan las columnas al llegar — parecía que cargaba dos veces.
  const [columnsLoading, setColumnsLoading] = useState(true);
  const refreshColumns = useCallback(async () => {
    try {
      const response = await getTaskColumns();
      setColumns(response.items);
    } finally {
      setColumnsLoading(false);
    }
  }, []);
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
    {/* Solapas a la izquierda, el "+" al medio, el espacio a la derecha. Sin
        la tarjeta de fondo: las dos píldoras ya se leen como controles y la
        caja alrededor sólo agregaba peso. El botón de refrescar se fue — la
        vista se actualiza sola y ese ícono suelto no sumaba. */}
    <div className="tasks-compact-toolbar">
      <div className="tasks-subnav t-tabs" ref={tabPill.ref}>
        <span className="t-tabs-pill" style={tabPill.style} aria-hidden="true" />
        <button className={tab === 'board' ? 'active' : ''} data-tab-active={tab === 'board'} onClick={() => setTab('board')}>Tablero</button>
        <button className={tab === 'priority' ? 'active' : ''} data-tab-active={tab === 'priority'} onClick={() => setTab('priority')}>Prioridad</button>
      </div>

      <div className="tasks-primary-actions">
        {!consultationMode && (
          <GooeyMenu
            ariaLabel="Nueva tarea"
            direction="down"
            items={[
              { id: 'team', label: 'Nueva tarea de equipo', icon: <Users size={16} />, onSelect: () => { setSpace('team'); setCreating(true); } },
              { id: 'mine', label: 'Nueva tarea privada', icon: <Lock size={16} />, onSelect: () => { setSpace('my'); setCreating(true); } },
              { id: 'column', label: 'Nueva columna', icon: <Columns3 size={16} />, onSelect: () => setColumnDraft('') }
            ]}
          />
        )}
      </div>

      <div className="task-space-toggle t-tabs" aria-label="Espacio de tareas" ref={spacePill.ref}>
        <span className="t-tabs-pill" style={spacePill.style} aria-hidden="true" />
        <button className={space === 'team' ? 'active' : ''} data-tab-active={space === 'team'} onClick={() => setSpace('team')}>Equipo</button>
        <button className={space === 'my' ? 'active' : ''} data-tab-active={space === 'my'} onClick={() => setSpace('my')}>Mis tareas</button>
      </div>
    </div>
    {message && <div className="tool-info">{message}</div>}

    {/* El alto entre Tablero y Prioridad (y entre Equipo y Mis tareas) cambia
        bastante. Sin esto el bloque salta de una altura a la otra y el resto de
        la página pega un tirón; ahora se estira. */}
    <div className="t-resize" ref={resizeRef}>
    {tab === 'board' && columnsLoading ? <TaskBoardSkeleton /> : tab === 'board' ? <TaskBoard tasks={visibleTasks} columns={columns} operator={operator} consultationMode={consultationMode} animKey={`${space}:${tab}`} onSave={onSave} onMove={onMove} onDelete={onDelete} onEdit={setEditing} onRefresh={onRefresh} onRenameColumn={renameColumn} onDeleteColumn={removeColumn} onReorderColumns={reorderColumns} selection={taskSelection} /> : <div className="task-schedule-grid">{PRIORITIES.map(priority => <section className={`task-schedule-col task-priority-${priority.toLowerCase()}`} key={priority}><header className="task-schedule-head"><strong>{priority}</strong><span className="badge subtle"><AnimatedNumber value={byPriority[priority].length} /></span></header><div className="task-schedule-list t-stagger" key={`${space}:${tab}`}>{byPriority[priority].map(task => <TaskCard key={task.id} task={task} consultationMode={consultationMode} operator={operator} onMove={() => undefined} onDelete={() => onDelete(task.id)} onPatch={patch => onSave({ ...task, ...patch })} onEdit={() => setEditing(task)} onRefresh={onRefresh} selected={selection.selected.has(task.id)} onToggleSelect={taskSelection ? () => selection.toggle(task.id) : undefined} />)}{!byPriority[priority].length && <div className="empty-state">Sin tareas</div>}</div></section>)}</div>}

    {space === 'team' && <TaskAnalytics tasks={visibleTasks} />}
    </div>

    {creating && <TaskModal operator={operator} defaultVisibility={space === 'my' ? 'private' : 'team'} onClose={() => setCreating(false)} onSave={onSave} />}
    {editing && <TaskModal operator={operator} initial={editing} defaultVisibility={editing.visibility || 'team'} onClose={() => setEditing(null)} onSave={onSave} />}

    {columnDraft !== null && (
      <Modal title="Nueva columna" onClose={() => setColumnDraft(null)}>
        <form className="stack" onSubmit={async event => {
          event.preventDefault();
          const name = columnDraft.trim();
          if (!name) return;
          try {
            await createColumn(name);
          } catch (reason) {
            // Ej. 409 si ya existe una columna con ese nombre: el modal queda abierto.
            toastError(reason, 'No se pudo crear la columna.');
            return;
          }
          setColumnDraft(null);
        }}>
          <label>Nombre
            <input autoFocus className="input" value={columnDraft} onChange={event => setColumnDraft(event.target.value)} placeholder="Ej. En revisión" />
          </label>
          <div className="actions">
            <Button variant="primary" type="submit">Crear columna</Button>
            <Button type="button" onClick={() => setColumnDraft(null)}>Cancelar</Button>
          </div>
        </form>
      </Modal>
    )}

  {!consultationMode && (
      <SelectionBar count={selectedTasks.length} onClear={selection.clear} floating>
        {columns.map(column => (
          <Button key={column.id} disabled={bulkBusy} variant={column.isDone ? 'success' : 'secondary'} onClick={() => void bulkMove(column)}>{column.name}</Button>
        ))}
        <Button variant="danger" disabled={bulkBusy} onClick={() => void bulkDelete()}>Borrar</Button>
      </SelectionBar>
    )}
    </section>;
}

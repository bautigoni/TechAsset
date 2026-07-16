import { useState } from 'react';
import type { TaskColumn, TaskItem } from '../../types';
import { TaskCard } from './TaskCard';

export function TaskBoard({ tasks, columns, operator, consultationMode, onSave, onDelete, onEdit, onRefresh, onCreateColumn, onRenameColumn, onDeleteColumn, onReorderColumns }: {
  tasks: TaskItem[];
  columns: TaskColumn[];
  operator: string;
  consultationMode: boolean;
  onSave: (task: Partial<TaskItem>) => Promise<unknown>;
  onDelete: (id: string) => void;
  onEdit: (task: TaskItem) => void;
  onRefresh?: () => Promise<unknown> | void;
  onCreateColumn: (name: string) => Promise<void>;
  onRenameColumn: (column: TaskColumn, name: string) => Promise<void>;
  onDeleteColumn: (column: TaskColumn) => Promise<void>;
  onReorderColumns: (ids: number[]) => Promise<void>;
}) {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const [editingColumn, setEditingColumn] = useState<number | null>(null);
  const [columnName, setColumnName] = useState('');

  const drop = async (event: React.DragEvent, column: TaskColumn) => {
    event.preventDefault();
    setDragOver(null);
    const raw = event.dataTransfer.getData('text/plain');
    if (raw.startsWith('column:')) {
      const sourceId = Number(raw.slice(7));
      if (!sourceId || sourceId === column.id) return;
      const ids = columns.map(item => item.id);
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(column.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await onReorderColumns(ids);
      return;
    }
    const taskId = raw.replace(/^task:/, '');
    const task = tasks.find(item => item.id === taskId);
    if (task && task.columnId !== column.id) await onSave({ ...task, columnId: column.id, estado: column.name });
  };

  return <div className="infinite-board-shell">
    <div className="infinite-board" role="region" aria-label="Tablero horizontal de tareas">
      {columns.map(column => {
        const group = tasks.filter(task => task.columnId === column.id || (!task.columnId && task.estado === column.name));
        return <section className={`infinite-task-column ${dragOver === column.id ? 'drag-over' : ''}`} key={column.id} onDragOver={event => { event.preventDefault(); setDragOver(column.id); }} onDragLeave={() => setDragOver(value => value === column.id ? null : value)} onDrop={event => void drop(event, column)}>
          <header className="infinite-column-head" draggable={!consultationMode && editingColumn !== column.id} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `column:${column.id}`); }} style={{ '--column-color': column.color } as React.CSSProperties}>
            {editingColumn === column.id ? <form onSubmit={event => { event.preventDefault(); void onRenameColumn(column, columnName).then(() => setEditingColumn(null)); }}><input autoFocus className="input" value={columnName} onChange={event => setColumnName(event.target.value)} /><button type="submit">✓</button></form> : <><div><span className="column-grip" aria-hidden="true">⠿</span><strong>{column.name}</strong><span className="badge subtle">{group.length}</span></div><div className="column-actions"><button disabled={consultationMode} title="Renombrar" onClick={() => { setEditingColumn(column.id); setColumnName(column.name); }}>✎</button><button disabled={consultationMode || columns.length === 1} title="Eliminar" onClick={() => void onDeleteColumn(column)}>×</button></div></>}
          </header>
          <div className="infinite-column-stack">{group.map(task => <TaskCard key={task.id} task={task} operator={operator} consultationMode={consultationMode} onMove={() => undefined} onDelete={() => onDelete(task.id)} onPatch={patch => onSave({ ...task, ...patch })} onEdit={() => onEdit(task)} onRefresh={onRefresh} />)}{!group.length && <div className="column-empty">Soltá una tarea acá</div>}</div>
        </section>;
      })}
      {!consultationMode && <section className="add-task-column"><form onSubmit={async event => { event.preventDefault(); if (!newColumn.trim()) return; await onCreateColumn(newColumn.trim()); setNewColumn(''); }}><input className="input" value={newColumn} onChange={event => setNewColumn(event.target.value)} placeholder="Nueva columna" /><button type="submit">+ Agregar</button></form></section>}
    </div>
  </div>;
}

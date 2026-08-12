import { useEffect, useState } from 'react';

// Tarjetas por columna en el primer render. Cada una trae checklist,
// formulario y acciones, así que el costo por tarjeta es alto.
const PAGE_SIZE = 8;
import type { TaskColumn, TaskItem, TaskState } from '../../types';
import { TaskCard } from './TaskCard';
import { useDragScroll } from '../../hooks/useDragScroll';
import { AnimatedNumber } from '../layout/AnimatedNumber';

export function TaskBoard({ tasks, columns, operator, consultationMode, animKey = '', onSave, onMove, onDelete, onEdit, onRefresh, onRenameColumn, onDeleteColumn, onReorderColumns }: {
  tasks: TaskItem[];
  columns: TaskColumn[];
  animKey?: string;
  operator: string;
  consultationMode: boolean;
  onSave: (task: Partial<TaskItem>) => Promise<unknown>;
  onMove: (id: string, state: TaskState, columnId?: number | null) => Promise<unknown> | void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskItem) => void;
  onRefresh?: () => Promise<unknown> | void;
  onRenameColumn: (column: TaskColumn, name: string) => Promise<void>;
  onDeleteColumn: (column: TaskColumn) => Promise<void>;
  onReorderColumns: (ids: number[]) => Promise<void>;
}) {
  const pan = useDragScroll<HTMLDivElement>();
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [moveError, setMoveError] = useState('');
  const [editingColumn, setEditingColumn] = useState<number | null>(null);
  const [columnName, setColumnName] = useState('');

  // Cuántas tarjetas se muestran por columna. Se reinicia al cambiar de
  // espacio o solapa (el animKey), así un filtro nuevo arranca corto.
  const [shown, setShown] = useState<Record<number, number>>({});
  useEffect(() => { setShown({}); }, [animKey]);
  const shownIn = (columnId: number) => shown[columnId] ?? PAGE_SIZE;
  const showMore = (columnId: number) => setShown(current => ({ ...current, [columnId]: (current[columnId] ?? PAGE_SIZE) + PAGE_SIZE }));

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
    // onMove mueve la tarjeta en el acto y sincroniza de fondo; onSave esperaba
    // el PATCH + un refetch de la lista entera antes de dibujar nada.
    if (task && task.columnId !== column.id) {
      try {
        await onMove(task.id, column.name, column.id);
        setMoveError('');
      } catch (reason) {
        // move() ya devolvio la tarjeta a su columna original; acá solo se avisa.
        setMoveError(reason instanceof Error ? reason.message : 'No se pudo mover la tarea.');
      }
    }
  };

  return <>
  {moveError && <div className="tool-error">{moveError}</div>}
  <div className="infinite-board-shell" ref={pan.ref} onPointerDown={pan.onPointerDown}>
    <div className="infinite-board" role="region" aria-label="Tablero horizontal de tareas">
      {columns.map(column => {
        const group = tasks.filter(task => task.columnId === column.id || (!task.columnId && task.estado === column.name));
        return <section className={`infinite-task-column ${dragOver === column.id ? 'drag-over' : ''}`} key={column.id} onDragOver={event => { event.preventDefault(); setDragOver(column.id); }} onDragLeave={() => setDragOver(value => value === column.id ? null : value)} onDrop={event => void drop(event, column)}>
          <header className="infinite-column-head" draggable={!consultationMode && editingColumn !== column.id} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `column:${column.id}`); }} style={{ '--column-color': column.color } as React.CSSProperties}>
            {editingColumn === column.id ? <form onSubmit={event => { event.preventDefault(); void onRenameColumn(column, columnName).then(() => setEditingColumn(null)); }}><input autoFocus className="input" value={columnName} onChange={event => setColumnName(event.target.value)} /><button type="submit">✓</button></form> : <><div><span className="column-grip" aria-hidden="true">⠿</span><strong>{column.name}</strong><span className="badge subtle"><AnimatedNumber value={group.length} /></span></div><div className="column-actions"><button disabled={consultationMode} title="Renombrar" onClick={() => { setEditingColumn(column.id); setColumnName(column.name); }}>✎</button><button disabled={consultationMode || columns.length === 1} title="Eliminar" onClick={() => void onDeleteColumn(column)}>×</button></div></>}
          </header>
          {/* `key={animKey}` remonta la pila al cambiar de espacio o de solapa:
              si React reusara las tarjetas que están en los dos conjuntos, esas
              no volverían a animar y la entrada quedaría a medias. */}
          {/* Sólo se renderizan las primeras PAGE_SIZE. Cada TaskCard trae
              checklist, formulario y acciones: con 40 tareas eran miles de
              nodos y la vista tardaba en abrir. El contador de arriba sigue
              contando el grupo COMPLETO, no lo que se ve. */}
          <div className="infinite-column-stack t-stagger" key={animKey}>{group.slice(0, shownIn(column.id)).map(task => <TaskCard key={task.id} task={task} operator={operator} consultationMode={consultationMode} onMove={() => undefined} onDelete={() => onDelete(task.id)} onPatch={patch => onSave({ ...task, ...patch })} onEdit={() => onEdit(task)} onRefresh={onRefresh} />)}{!group.length && <div className="column-empty">Soltá una tarea acá</div>}{group.length > shownIn(column.id) && (
            <button type="button" className="column-show-more" onClick={() => showMore(column.id)}>
              Ver {Math.min(PAGE_SIZE, group.length - shownIn(column.id))} más <span className="muted">({group.length - shownIn(column.id)} restantes)</span>
            </button>
          )}</div>
        </section>;
      })}
      {/* La columna-formulario "Nueva columna" se fue: crear columna ahora es
          un satélite del "+" de la barra, junto al resto de las altas. */}
    </div>
  </div>
  </>;
}

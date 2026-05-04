import { useState } from 'react';
import type { TaskItem, TaskState } from '../../types';
import { TaskCard } from './TaskCard';

const STATES: TaskState[] = ['Pendiente', 'En proceso', 'Hecha'];

export function TaskBoard({ tasks, consultationMode, onMove, onDelete, onSave }: { tasks: TaskItem[]; consultationMode: boolean; onMove: (id: string, state: TaskState) => void; onDelete: (id: string) => void; onSave?: (task: Partial<TaskItem>) => Promise<unknown> }) {
  const [dragOver, setDragOver] = useState<TaskState | null>(null);
  const [justDropped, setJustDropped] = useState<TaskState | null>(null);
  const [pointerDragId, setPointerDragId] = useState<string | null>(null);

  const dropTask = (id: string, state: TaskState) => {
    if (!id || consultationMode) return;
    setJustDropped(state);
    setTimeout(() => setJustDropped(null), 360);
    const task = tasks.find(item => item.id === id);
    if (task && onSave) {
      void onSave({ ...task, estado: state });
      return;
    }
    onMove(id, state);
  };

  return (
    <div className="task-board">
      {STATES.map(state => {
        const group = tasks.filter(task => task.estado === state);
        return (
          <section
            className={`task-column ${dragOver === state ? 'drag-over' : ''} ${justDropped === state ? 'drop-pulse' : ''}`}
            key={state}
            onDragOver={event => {
              event.preventDefault();
              setDragOver(state);
            }}
            onDragEnter={event => {
              event.preventDefault();
              setDragOver(state);
            }}
            onDragLeave={() => setDragOver(current => current === state ? null : current)}
            onDrop={event => {
              const id = event.dataTransfer.getData('text/plain');
              setDragOver(null);
              dropTask(id, state);
            }}
            onPointerEnter={() => {
              if (pointerDragId) setDragOver(state);
            }}
            onPointerUp={() => {
              if (!pointerDragId) return;
              dropTask(pointerDragId, state);
              setPointerDragId(null);
              setDragOver(null);
            }}
          >
            <div className="task-column-head"><strong>{state}</strong><span className="badge subtle">{group.length}</span></div>
            <div
              className="stack task-drop-zone"
              onDragOver={event => {
                event.preventDefault();
                setDragOver(state);
              }}
              onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData('text/plain');
                setDragOver(null);
                dropTask(id, state);
              }}
            >
              {group.map(task => <TaskCard key={task.id} task={task} consultationMode={consultationMode} onMove={next => onMove(task.id, next)} onDelete={() => onDelete(task.id)} onPatch={patch => onSave?.({ ...task, ...patch })} onPointerDragStart={() => setPointerDragId(task.id)} />)}
              {!group.length && <div className="empty-state">Sin tareas</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

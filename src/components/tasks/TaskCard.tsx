import { useState } from 'react';
import type { TaskItem, TaskState } from '../../types';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { formatDdMm } from '../../utils/taskDate';
import { createTaskItem, deleteTaskItem, updateTaskItem } from '../../services/tasksApi';

export function TaskCard({ task, operator, consultationMode, onMove, onDelete, onPatch, onEdit, onRefresh, onPointerDragStart }: { task: TaskItem; operator: string; consultationMode: boolean; onMove: (state: TaskState) => void; onDelete: () => void; onPatch?: (patch: Partial<TaskItem>) => Promise<unknown> | void; onEdit?: () => void; onRefresh?: () => Promise<unknown> | void; onPointerDragStart?: () => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [itemText, setItemText] = useState('');
  const [comment, setComment] = useState(task.comentario || '');
  const total = task.checklistTotal || task.items?.length || 0;
  const done = task.checklistDone ?? task.items?.filter(item => item.completada).length ?? 0;
  const moveTo = (state: TaskState) => {
    if (consultationMode) return;
    if (onPatch) {
      void onPatch({ estado: state });
      return;
    }
    onMove(state);
  };
  return (
    <article
      className={`task-card task-state-${task.estado.toLowerCase().replace(/\s+/g, '-')}`}
      data-task-id={task.id}
      draggable={!consultationMode}
      onPointerDown={event => {
        if (consultationMode) return;
        if ((event.target as HTMLElement).closest('button, input, textarea, select')) return;
        onPointerDragStart?.();
      }}
      onDragStart={event => {
        event.currentTarget.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
      }}
      onDragEnd={event => event.currentTarget.classList.remove('dragging')}
      style={{ viewTransitionName: `task-${task.id.replace(/[^a-zA-Z0-9_-]/g, '-')}` }}
    >
      <strong>{task.titulo}</strong>
      <div className="muted">{task.responsables?.join(', ') || task.responsable} - {task.prioridad}{task.turno ? ` · ${task.turno}` : ''}{task.fechaVencimiento ? ` · Vence ${formatDdMm(task.fechaVencimiento)}` : ''}</div>
      <div className={`task-state-pill task-state-pill-${task.estado.toLowerCase().replace(/\s+/g, '-')}`}>{task.estado === 'Hecha' ? '✓ Hecha' : task.estado}</div>
      {task.descripcion && <p>{task.descripcion}</p>}
      {task.comentario && <p className="task-note">Nota: {task.comentario}</p>}
      {total > 0 && <div className="task-progress"><span>Checklist {done}/{total}</span><progress value={done} max={total} /></div>}
      {task.items?.length ? (
        <div className="task-checklist">
          {task.items.map(item => (
            <label key={item.id} className="task-check-item">
              <input
                type="checkbox"
                checked={item.completada}
                disabled={consultationMode}
                onChange={async event => {
                  await updateTaskItem(task.id, item.id, { completada: event.target.checked, operator });
                  await onRefresh?.();
                }}
              />
              <span>{item.texto}</span>
              <button type="button" disabled={consultationMode} onClick={async event => { event.preventDefault(); await deleteTaskItem(task.id, item.id, operator); await onRefresh?.(); }}>×</button>
            </label>
          ))}
        </div>
      ) : null}
      {total > 0 && done === total && task.estado !== 'Hecha' && !consultationMode && (
        <Button className="checklist-confirm-btn" variant="success" onClick={() => moveTo('Hecha')}>Confirmar checklist</Button>
      )}
      {!consultationMode && (
        <form className="task-add-item" onSubmit={async event => {
          event.preventDefault();
          if (!itemText.trim()) return;
          await createTaskItem(task.id, { texto: itemText, operator });
          setItemText('');
          await onRefresh?.();
        }}>
          <input className="input" value={itemText} onChange={event => setItemText(event.target.value)} placeholder="Agregar subtarea" />
          <Button type="submit">+</Button>
        </form>
      )}
      <div className="task-card-actions" draggable={false} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
        {task.estado !== 'Pendiente' && <Button disabled={consultationMode} onClick={event => { event.stopPropagation(); moveTo('Pendiente'); }}>Pendiente</Button>}
        {task.estado !== 'En proceso' && <Button disabled={consultationMode} onClick={event => { event.stopPropagation(); moveTo('En proceso'); }}>Iniciar</Button>}
        {task.estado !== 'Hecha' && <Button className="task-done-btn" variant="primary" disabled={consultationMode} onClick={event => { event.stopPropagation(); moveTo('Hecha'); }}>Hecha</Button>}
        <Button disabled={consultationMode} onClick={event => { event.stopPropagation(); onEdit?.(); }}>Editar</Button>
        <Button disabled={consultationMode} onClick={event => { event.stopPropagation(); setNoteOpen(true); }}>Nota</Button>
        <Button className="task-delete-btn" disabled={consultationMode} onClick={event => { event.stopPropagation(); onDelete(); }}>Borrar</Button>
      </div>
      {noteOpen && (
        <Modal title={`Nota - ${task.titulo}`} onClose={() => setNoteOpen(false)}>
          <form className="stack" onSubmit={async event => {
            event.preventDefault();
            await onPatch?.({ comentario: comment });
            setNoteOpen(false);
          }}>
            <label>Nota<textarea className="input" rows={5} value={comment} onChange={event => setComment(event.target.value)} /></label>
            <div className="actions">
              <Button variant="primary" type="submit">Guardar nota</Button>
              <Button type="button" onClick={() => setNoteOpen(false)}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}
    </article>
  );
}

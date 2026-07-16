import { useState } from 'react';
import type { TaskComment, TaskItem, TaskState } from '../../types';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { formatDdMm } from '../../utils/taskDate';
import { createTaskComment, createTaskItem, deleteTaskItem, getTaskComments, updateTaskItem } from '../../services/tasksApi';

export function TaskCard({ task, operator, consultationMode, onDelete, onPatch, onEdit, onRefresh, onPointerDragStart }: { task: TaskItem; operator: string; consultationMode: boolean; onMove: (state: TaskState) => void; onDelete: () => void; onPatch?: (patch: Partial<TaskItem>) => Promise<unknown> | void; onEdit?: () => void; onRefresh?: () => Promise<unknown> | void; onPointerDragStart?: () => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [itemText, setItemText] = useState('');
  const [comment, setComment] = useState(task.comentario || '');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const total = task.checklistTotal || task.items?.length || 0;
  const done = task.checklistDone ?? task.items?.filter(item => item.completada).length ?? 0;
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
        event.dataTransfer.setData('text/plain', `task:${task.id}`);
      }}
      onDragEnd={event => event.currentTarget.classList.remove('dragging')}
      style={{ viewTransitionName: `task-${task.id.replace(/[^a-zA-Z0-9_-]/g, '-')}` }}
    >
      <strong>{task.titulo}</strong>
      <div className="muted">{task.responsables?.join(', ') || task.responsable} - {task.prioridad}{task.turno ? ` · ${task.turno}` : ''}{task.fechaVencimiento ? ` · Vence ${formatDdMm(task.fechaVencimiento)}` : ''}</div>
      <div className={`task-state-pill task-state-pill-${task.estado.toLowerCase().replace(/\s+/g, '-')}`}>{task.done ? `✓ ${task.estado}` : task.estado}</div>
      {task.visibility === 'private' && <span className="task-private-pill">Privada</span>}
      {task.descripcion && <p>{task.descripcion}</p>}
      {task.comentario && <p className="task-note">Nota: {task.comentario}</p>}
      {!!task.attachments?.length && <div className="task-card-attachments">{task.attachments.map((attachment, index) => <a key={`${attachment.url}-${index}`} href={attachment.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>📎 {attachment.name}</a>)}</div>}
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
        <Button disabled={consultationMode} onClick={event => { event.stopPropagation(); onEdit?.(); }}>Editar</Button>
        <Button disabled={consultationMode} onClick={event => { event.stopPropagation(); setNoteOpen(true); }}>Nota</Button>
        <Button onClick={async event => { event.stopPropagation(); const response = await getTaskComments(task.id); setComments(response.items); setCommentsOpen(true); }}>Comentarios {task.commentsCount ? `(${task.commentsCount})` : ''}</Button>
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
      {commentsOpen && <Modal title={`Comentarios · ${task.titulo}`} onClose={() => setCommentsOpen(false)}><div className="task-comments"><div className="task-comment-list">{comments.map(item => <article key={item.id}><header><strong>{item.authorName || item.authorEmail}</strong><time>{new Date(item.createdAt).toLocaleString('es-AR')}</time></header><p>{item.body}</p></article>)}{!comments.length && <div className="empty-state">Todavía no hay comentarios.</div>}</div>{!consultationMode && <form onSubmit={async event => { event.preventDefault(); if (!commentText.trim()) return; const response = await createTaskComment(task.id, commentText); setComments(value => [...value, response.item]); setCommentText(''); await onRefresh?.(); }}><textarea className="input" rows={3} value={commentText} onChange={event => setCommentText(event.target.value)} placeholder="Escribí un comentario" /><Button variant="primary" type="submit">Comentar</Button></form>}</div></Modal>}
    </article>
  );
}

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MessageSquare, MoreHorizontal, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react';
import type { TaskComment, TaskItem, TaskState } from '../../types';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { AnimatedNumber } from '../layout/AnimatedNumber';
import { useMountTransition } from '../../hooks/useMountTransition';
import { formatDdMm } from '../../utils/taskDate';
import { createTaskComment, createTaskItem, deleteTaskItem, getTaskComments, updateTaskItem } from '../../services/tasksApi';

export function TaskCard({ task, operator, consultationMode, onDelete, onPatch, onEdit, onRefresh, onPointerDragStart }: { task: TaskItem; operator: string; consultationMode: boolean; onMove: (state: TaskState) => void; onDelete: () => void; onPatch?: (patch: Partial<TaskItem>) => Promise<unknown> | void; onEdit?: () => void; onRefresh?: () => Promise<unknown> | void; onPointerDragStart?: () => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [itemText, setItemText] = useState('');
  const [comment, setComment] = useState(task.comentario || '');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const menu = useMountTransition(menuOpen, 120); // --dropdown-close-dur
  const total = task.checklistTotal || task.items?.length || 0;
  const done = task.checklistDone ?? task.items?.filter(item => item.completada).length ?? 0;
  const isDone = Boolean(task.done) || task.estado === 'Hecha';

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
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
      {/* El <progress> nativo se ve distinto en cada browser y no acepta el
          tema. Barra propia: pista + relleno con los tokens de la app, y el
          relleno fluye con la curva spring como el resto de las barras. */}
      {total > 0 && (
        <div className="task-progress">
          <span>Subtareas <b><AnimatedNumber value={done} />/<AnimatedNumber value={total} /></b></span>
          <span className="task-progress-track" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
            <span className="task-progress-fill" style={{ '--task-progress': total ? done / total : 0 } as CSSProperties} />
          </span>
        </div>
      )}
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
      {/* Una tarea terminada no admite subtareas nuevas: agregar trabajo a algo
          ya cerrado no tiene sentido y ensuciaba el contador. */}
      {!consultationMode && !isDone && (
        adding ? (
          <form className="task-add-item t-msg-enter" onSubmit={async event => {
            event.preventDefault();
            if (!itemText.trim()) return;
            await createTaskItem(task.id, { texto: itemText, operator });
            setItemText('');
            await onRefresh?.();
          }}>
            <input autoFocus className="input" value={itemText} onChange={event => setItemText(event.target.value)} placeholder="¿Qué falta hacer?" onBlur={() => { if (!itemText.trim()) setAdding(false); }} />
            <Button type="submit">Agregar</Button>
          </form>
        ) : (
          <button type="button" className="task-add-trigger" onClick={event => { event.stopPropagation(); setAdding(true); }}>
            <Plus size={14} /> Subtarea
          </button>
        )
      )}

      {/* Los cuatro botones sueltos ocupaban media tarjeta. Ahora viven en un
          menú detrás de un solo disparador; la tarjeta queda para su contenido. */}
      <div className="task-card-menu" ref={menuWrapRef} draggable={false} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
        <button
          type="button"
          className="task-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={menu.mounted}
          aria-label="Acciones de la tarea"
          onClick={event => { event.stopPropagation(); setMenuOpen(open => !open); }}
        >
          <MoreHorizontal size={16} />
        </button>
        {menu.mounted && (
          <div className={`task-menu t-dropdown ${menu.stateClass}`.trim()} data-origin="top-right" role="menu">
            <button type="button" role="menuitem" disabled={consultationMode} onClick={event => { event.stopPropagation(); setMenuOpen(false); onEdit?.(); }}><Pencil size={14} /> Editar</button>
            <button type="button" role="menuitem" disabled={consultationMode} onClick={event => { event.stopPropagation(); setMenuOpen(false); setNoteOpen(true); }}><StickyNote size={14} /> Nota</button>
            <button type="button" role="menuitem" onClick={async event => { event.stopPropagation(); setMenuOpen(false); const response = await getTaskComments(task.id); setComments(response.items); setCommentsOpen(true); }}>
              <MessageSquare size={14} /> Comentarios{task.commentsCount ? <span className="task-menu-count"><AnimatedNumber value={task.commentsCount} /></span> : null}
            </button>
            <button type="button" role="menuitem" className="is-danger" disabled={consultationMode} onClick={event => { event.stopPropagation(); setMenuOpen(false); onDelete(); }}><Trash2 size={14} /> Borrar</button>
          </div>
        )}
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

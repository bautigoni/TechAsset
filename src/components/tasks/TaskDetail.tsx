import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { TaskChecklistItem, TaskColumn, TaskComment, TaskItem } from '../../types';
import { Button, Checkbox, ErrorState, InlineConfirm, Kbd, SkeletonText, StatusText, Textarea, cx } from '../../ui';
import { createTaskComment, getTaskComments, getTaskHistory, type TaskHistoryEntry } from '../../services/tasksApi';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { formatDate, SHORT_DATE_TIME } from '../../utils/formatters';
import { OptionChips } from './TaskBits';
import { dueInfo, joinNames, responsablesOf } from './taskModel';

type Props = {
  task: TaskItem;
  column?: TaskColumn;
  columns: TaskColumn[];
  done: boolean;
  canEdit: boolean;
  moving: boolean;
  isMobile: boolean;
  status: ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (column: TaskColumn) => void;
  onSaveNote: (text: string) => Promise<void>;
  onToggleItem: (item: TaskChecklistItem, next: boolean) => void;
  onAddItem: (texto: string) => void;
  onRemoveItem: (item: TaskChecklistItem) => void;
  onCommented: () => void;
};

const ACTIONS: Record<string, string> = {
  'tarea creada': 'Creó la tarea',
  'tarea movida': 'La movió',
  'tarea modificada': 'La editó',
  'tarea borrada': 'La borró',
  'tarea restaurada': 'La restauró',
  'subtarea agregada': 'Sumó una subtarea'
};

/**
 * Página de la tarea (/sede/<sede>/tasks/<id>): reemplaza al modal de editar y
 * al menú "⋯". Editar, nota, comentarios, borrar y mover de columna en línea.
 */
export function TaskDetail({ task, column, columns, done, canEdit, moving, isMobile, status, onEdit, onDelete, onMove, onSaveNote, onToggleItem, onAddItem, onRemoveItem, onCommented }: Props) {
  useAssistantContext({ type: 'task', id: task.id, label: task.titulo || task.id, data: { estado: task.estado, prioridad: task.prioridad } });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteEdit, setNoteEdit] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [adding, setAdding] = useState(false);
  const [itemText, setItemText] = useState('');
  const itemRef = useRef<HTMLInputElement | null>(null);

  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [commentsError, setCommentsError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [history, setHistory] = useState<TaskHistoryEntry[] | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const loadComments = () => {
    setCommentsError('');
    getTaskComments(task.id).then(response => setComments(response.items)).catch(reason => setCommentsError(reason instanceof Error ? reason.message : 'No se pudieron cargar los comentarios.'));
  };
  useEffect(loadComments, [task.id]);
  // Actividad: se pide al abrir y cuando cambia algo de la tarea.
  useEffect(() => {
    let alive = true;
    getTaskHistory(task.id).then(response => { if (alive) setHistory(response.items); }).catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [task.id, task.ultimaModificacion, task.items?.length]);
  useEffect(() => { if (adding) itemRef.current?.focus({ preventScroll: true }); }, [adding]);

  const items = task.items || [];
  const doneItems = items.filter(item => item.completada).length;
  const due = dueInfo(task, done);
  const urgent = !done && (task.prioridad === 'Urgente' || task.prioridad === 'Alta');
  const created = [task.creadoPor && `Creada por ${task.creadoPor}`, task.fechaCreacion && formatDate(task.fechaCreacion, SHORT_DATE_TIME)].filter(Boolean).join(' · ');

  const addItem = () => {
    const value = itemText.trim();
    if (!value) return;
    onAddItem(value);
    setItemText('');
    itemRef.current?.focus({ preventScroll: true });
  };
  const saveNote = async () => {
    setNoteSaving(true);
    setNoteError('');
    try {
      await onSaveNote(noteText);
      setNoteEdit(false);
    } catch (reason) {
      setNoteError(reason instanceof Error ? reason.message : 'No se pudo guardar la nota.');
    } finally {
      setNoteSaving(false);
    }
  };
  const sendComment = async () => {
    const body = commentText.trim();
    if (!body || commentBusy) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const response = await createTaskComment(task.id, body);
      setComments(current => [...(current || []), response.item]);
      setCommentText('');
      onCommented();
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : 'No se pudo enviar el comentario.');
    } finally {
      setCommentBusy(false);
    }
  };

  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: 'Visibilidad', value: task.visibility === 'private' ? 'Privada (solo vos)' : 'Equipo' },
    { label: 'Responsables', value: joinNames(responsablesOf(task)) },
    { label: 'Prioridad', value: <span className={cx(urgent && 'tk-bad')}>{task.prioridad || 'Media'}</span> },
    { label: 'Turno', value: task.turno && task.turno !== 'Sin turno' ? task.turno : <span className="tk-muted">Sin turno</span> },
    { label: 'Tipo', value: task.tipo || 'Soporte' },
    { label: 'Vencimiento', value: due ? <StatusText tone={due.tone} mono>{due.text}</StatusText> : <span className="tk-muted">Sin fecha</span> }
  ];
  const attachments = task.attachments || [];
  const historyShown = showAllHistory ? history || [] : (history || []).slice(0, 6);

  const activity = (
      <div className="tk-fact tk-fact--block">
        <span className="tk-fact-label">Actividad</span>
        {history === null ? <SkeletonText lines={3} /> : history.length ? (
          <ol className="tk-activity">
            {historyShown.map(entry => (
              <li key={entry.id}>
                <span>{ACTIONS[entry.accion] || entry.accion}{entry.accion === 'tarea movida' && entry.estado_nuevo ? ` a «${entry.estado_nuevo}»` : ''}{entry.accion === 'subtarea agregada' && entry.comentario ? `: ${entry.comentario}` : ''}</span>
                <span className="tk-muted tk-activity-meta">{[entry.operador, formatDate(entry.timestamp, SHORT_DATE_TIME)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ol>
        ) : <span className="tk-muted">Sin movimientos registrados.</span>}
        {(history?.length || 0) > 6 && (
          <button type="button" className="tk-link tk-link--sm" onClick={() => setShowAllHistory(value => !value)}>{showAllHistory ? 'Ver menos' : `Ver ${(history?.length || 0) - 6} anteriores`}</button>
        )}
      </div>
  );

  const aside = (
    <aside className="tk-facts" aria-label="Datos de la tarea">
      <dl className="tk-facts-list">
        {facts.map(fact => (
          <div className="tk-fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className="tk-fact tk-fact--block">
        <span className="tk-fact-label">Adjuntos</span>
        {attachments.length ? attachments.map((attachment, index) => (
          <a key={`${attachment.url}-${index}`} className="tk-attach-link" href={attachment.url} target="_blank" rel="noreferrer">
            <Paperclip size={14} aria-hidden="true" />
            <span className="tk-ell">{attachment.name}</span>
          </a>
        )) : <span className="tk-muted">Sin adjuntos. Se suman desde Editar.</span>}
      </div>
      {!isMobile && activity}
    </aside>
  );

  return (
    <div className="tk-detail ui-enter">
      <article className="tk-detail-main" aria-labelledby="tk-detail-title">
        <header className="tk-detail-head">
          <span className="tk-eyebrow">{column?.name || task.estado} · {task.id}</span>
          <h2 id="tk-detail-title" className={cx('tk-detail-title', done && 'is-done')}>{task.titulo}</h2>
          {created && <span className="tk-muted tk-small">{created}</span>}
          <div className="tk-detail-actions">
            <Button icon={<Pencil size={16} />} disabled={!canEdit} onClick={onEdit}>Editar</Button>
            {!confirmDelete && <Button variant="ghost" className="tk-danger-link" icon={<Trash2 size={16} />} disabled={!canEdit} onClick={() => setConfirmDelete(true)}>Borrar</Button>}
          </div>
          {confirmDelete && (
            <InlineConfirm
              danger
              message="¿Borrar esta tarea?"
              detail="Vas a poder deshacerlo."
              confirmLabel="Borrar tarea"
              onConfirm={() => { setConfirmDelete(false); onDelete(); }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
        </header>

        {status}

        <section className="tk-field" aria-label="Columna">
          <span className="tk-label">Columna</span>
          <OptionChips
            ariaLabel="Mover a la columna"
            grid={isMobile}
            value={column ? String(column.id) : ''}
            disabled={!canEdit || moving}
            onChange={id => { const target = columns.find(item => String(item.id) === id); if (target && target.id !== column?.id) onMove(target); }}
            options={columns.map(item => ({ value: String(item.id), label: item.name }))}
          />
        </section>

        {isMobile && aside}

        <section className="tk-field" aria-label="Descripción">
          <span className="tk-label">Descripción</span>
          <p className={cx('tk-prose', !task.descripcion && 'tk-muted')}>{task.descripcion || 'Sin descripción.'}</p>
        </section>

        <section className="tk-detail-block" aria-label="Subtareas">
          <div className="tk-block-head">
            <span className="tk-label">Subtareas</span>
            {items.length > 0 && <span className="tk-mono tk-text-2">{doneItems}/{items.length}</span>}
          </div>
          {items.map(item => (
            <div className="tk-sub tk-sub--row" key={item.id}>
              <Checkbox checked={item.completada} disabled={!canEdit || item.id < 0} ariaLabel={`Subtarea: ${item.texto}`} onCheckedChange={next => onToggleItem(item, next)} />
              <span className={cx('tk-sub-full', item.completada && 'is-done')}>{item.texto}</span>
              {canEdit && (
                <button type="button" className="tk-sub-x is-visible" aria-label={`Quitar la subtarea «${item.texto}»`} disabled={item.id < 0} onClick={() => onRemoveItem(item)}>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {!items.length && <span className="tk-muted tk-small">Sin subtareas.</span>}
          {adding && (
            <form className="tk-card-add" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); addItem(); }}>
              <input
                ref={itemRef}
                className="tk-input"
                value={itemText}
                placeholder="¿Qué falta hacer?"
                aria-label="Nueva subtarea"
                onChange={event => setItemText(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); setItemText(''); } }}
                onBlur={() => window.setTimeout(() => { if (!itemRef.current?.value.trim()) setAdding(false); }, 150)}
              />
              <Button type="submit">Agregar</Button>
            </form>
          )}
          {canEdit && !done && !adding && <Button size="sm" variant="ghost" className="tk-inline-btn" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Subtarea</Button>}
          {canEdit && done && <span className="tk-muted tk-small">La tarea está hecha: no se suman subtareas.</span>}
        </section>

        <section className="tk-detail-block" aria-label="Nota">
          <div className="tk-block-head">
            <span className="tk-label">Nota</span>
            {!noteEdit && <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => { setNoteText(task.comentario || ''); setNoteEdit(true); }}>{task.comentario ? 'Editar nota' : 'Agregar nota'}</Button>}
          </div>
          {noteEdit ? (
            <form className="tk-note-form" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void saveNote(); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setNoteEdit(false); } }}>
              <Textarea aria-label="Nota de la tarea" minRows={5} value={noteText} autoFocus onValueChange={setNoteText} error={noteError || undefined} />
              <div className="tk-row">
                <Button size="sm" variant="primary" type="submit" loading={noteSaving}>Guardar nota</Button>
                <Button size="sm" variant="ghost" onClick={() => setNoteEdit(false)}>Cancelar</Button>
              </div>
            </form>
          ) : (
            <p className={cx('tk-prose tk-prose--sm', !task.comentario && 'tk-muted')}>{task.comentario || 'Sin nota.'}</p>
          )}
        </section>

        <section className="tk-detail-block" aria-label="Comentarios">
          <div className="tk-block-head">
            <span className="tk-label">Comentarios</span>
            <span className="tk-mono tk-muted">{comments ? comments.length : task.commentsCount || 0}</span>
          </div>
          {commentsError && <ErrorState message={commentsError} onRetry={loadComments} />}
          {comments === null && !commentsError && <SkeletonText lines={2} />}
          {comments?.map(item => (
            <article className="tk-comment" key={item.id}>
              <div className="tk-comment-head">
                <span className="tk-comment-author">{item.authorName || item.authorEmail}</span>
                <span className="tk-mono tk-muted">{formatDate(item.createdAt, SHORT_DATE_TIME)}</span>
              </div>
              <p className="tk-prose tk-prose--sm">{item.body}</p>
            </article>
          ))}
          {comments && !comments.length && <span className="tk-muted tk-small">Todavía no hay comentarios.</span>}
          {canEdit && (
            <form className="tk-comment-form" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void sendComment(); }}>
              <Textarea
                aria-label="Nuevo comentario"
                minRows={3}
                value={commentText}
                placeholder="Escribí un comentario"
                error={commentError || undefined}
                onValueChange={setCommentText}
                onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendComment(); } }}
              />
              <div className="tk-row">
                <Button size="sm" type="submit" loading={commentBusy} disabled={!commentText.trim()}>Comentar</Button>
                {!isMobile && <span className="tk-muted tk-small"><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd></span>}
              </div>
            </form>
          )}
        </section>

        {isMobile && <section className="tk-facts" aria-label="Actividad">{activity}</section>}
      </article>

      {!isMobile && aside}
    </div>
  );
}

export function TaskNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="tk-detail-missing ui-enter">
      <span className="tk-eyebrow">Tareas TIC</span>
      <h2 className="tk-h2">No encontramos esa tarea</h2>
      <p className="tk-muted">Puede que la hayan borrado, que sea privada de otra persona o que sea de otra sede.</p>
      <div className="tk-row"><Button onClick={onBack}>Volver al tablero</Button></div>
    </div>
  );
}


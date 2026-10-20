import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Classroom, Ticket, TicketChecklistItem, TicketRelation, TicketState } from '../../types';
import {
  addTicketChecklistItem, addTicketComment, addTicketRelation, deleteTicket, deleteTicketChecklistItem, deleteTicketRelation,
  getTicketDetail, regenerateTicketSummary, updateTicket, updateTicketChecklistItem
} from '../../services/ticketsApi';
import { ApiError } from '../../services/apiClient';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { Collapse } from '../../ui';
import {
  Button, Checkbox, EmptyState, ErrorState, Eyebrow, IconButton, InlineConfirm, Segmented, Select, SkeletonText, StatusText, Textarea, StatusSlot, useAnchoredToggle, useStatusLine
} from '../../ui';
import { IconPlus, IconRetry, IconX } from '../../ui/icons';
import { TruncatedText } from '../../ui/Truncated';
import { ListItemMotion, smoothHeight, useListMotion } from '../../utils/motion';
import {
  ESTADOS, errorText, externalLink, fileNameOf, isPdf, prioridadTone, shortDateTime, sourceLine, systemLabel, ticketNumber, ticketRoutePath,
  type LinkBases
} from './ticketUtils';

type Detail = Awaited<ReturnType<typeof getTicketDetail>>;
const DESC_LONG = 280;

/**
 * Ficha del ticket con URL propia (/sede/x/tickets/<id>), en la columna de la
 * derecha (o sola en angosto). Todo pasa en el lugar: cambio de estado al
 * instante con Deshacer, resumen IA, checklist, relacionados, comentarios y
 * actividad. Cada error queda escrito debajo de donde pasó.
 */
export function TicketDetail({ id, tickets, classrooms, bases, canEdit, onOpen, onEdit, onDeleted, onLocalPatch, onChanged }: {
  id: number;
  tickets: Ticket[];
  classrooms: Classroom[];
  bases: LinkBases;
  canEdit: boolean;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onDeleted: (ticket: Ticket) => void;
  onLocalPatch: (id: number, patch: Partial<Ticket>) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; missing: boolean } | null>(null);
  const [reloading, setReloading] = useState(false);
  const status = useStatusLine();
  const listed = tickets.find(item => item.id === id);
  const item = data?.item || listed;

  useAssistantContext(item ? {
    type: 'ticket',
    id: String(id),
    label: item.titulo || `Ticket ${ticketNumber(item)}`,
    data: { estado: item.estado, prioridad: item.prioridad, classroom: item.classroom }
  } : null);

  const load = useCallback(async () => {
    try {
      const response = await getTicketDetail(id);
      setData(response);
      setLoadError(null);
    } catch (reason) {
      setLoadError({ message: errorText(reason, 'No se pudo cargar el ticket.'), missing: reason instanceof ApiError && reason.status === 404 });
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const retry = async () => { setReloading(true); await load(); setReloading(false); };

  /* ── Estado al instante con Deshacer ── */
  const [estadoBusy, setEstadoBusy] = useState(false);
  const changeEstado = async (next: TicketState) => {
    if (!data || estadoBusy || data.item.estado === next) return;
    const prev = data.item.estado;
    const apply = (estado: TicketState) => {
      setData(current => (current ? { ...current, item: { ...current.item, estado } } : current));
      onLocalPatch(id, { estado });
    };
    apply(next);
    setEstadoBusy(true);
    try {
      await updateTicket(id, { estado: next });
      status.show({
        tone: 'ok',
        message: `Estado: ${prev} → ${next}.`,
        undo: {
          onUndo: async () => {
            try {
              await updateTicket(id, { estado: prev });
              apply(prev);
              status.show({ tone: 'info', message: `Volvió a «${prev}».` });
              void load();
              onChanged();
            } catch (reason) {
              status.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer el cambio de estado.') });
            }
          }
        }
      });
      void load();
      onChanged();
    } catch (reason) {
      apply(prev);
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo cambiar el estado.'), retry: { onRetry: () => changeEstado(next) } });
    } finally {
      setEstadoBusy(false);
    }
  };

  /* ── Resumen IA (va por el adaptador de IA del server) ── */
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const regenerate = async () => {
    if (summaryBusy) return;
    setSummaryBusy(true);
    setSummaryError('');
    try {
      const response = await regenerateTicketSummary(id);
      setData(current => (current ? { ...current, item: { ...current.item, aiSummary: response.summary, aiSummaryUpdatedAt: response.updatedAt } } : current));
      onLocalPatch(id, { aiSummary: response.summary, aiSummaryUpdatedAt: response.updatedAt });
    } catch (reason) {
      setSummaryError(errorText(reason, 'No se pudo actualizar el resumen.'));
    } finally {
      setSummaryBusy(false);
    }
  };

  /* ── Borrar (confirmación en línea; el Deshacer queda en la lista) ── */
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const remove = async () => {
    if (!item || deleting) return;
    setDeleting(true);
    try {
      await deleteTicket(id);
      onDeleted(item);
    } catch (reason) {
      setDeleting(false);
      setAskDelete(false);
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo borrar el ticket.'), retry: { onRetry: remove } });
    }
  };

  /* ── Descripción y archivo ── */
  const [descOpen, setDescOpen] = useState(false);
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const anchored = useAnchoredToggle();
  const [fileOpen, setFileOpen] = useState(false);

  if (!item && !loadError) {
    return (
      <div className="tkx-detail" aria-busy="true">
        <SkeletonText lines={2} />
        <SkeletonText lines={4} />
        <SkeletonText lines={3} />
      </div>
    );
  }
  if (loadError && !data) {
    return loadError.missing
      ? <EmptyState title="Este ticket no existe o fue borrado." description="Puede que alguien lo haya borrado hace un rato. Volvé a la lista para elegir otro." />
      : <ErrorState message={loadError.message} onRetry={retry} retrying={reloading} />;
  }
  if (!item) return null;

  const room = classrooms.find(entry => entry.roomKey === item.classroomKey);
  const prioTone = prioridadTone(item.prioridad);
  const desc = item.descripcion || '';
  const descLong = desc.length > DESC_LONG;
  const link = externalLink(item, bases);

  return (
    <article className="tkx-detail" aria-labelledby={`tkx-title-${id}`}>
      <header className="tkx-detail-head">
        <div className="tkx-detail-top">
          <Eyebrow className="tkx-ell tkx-grow">{sourceLine(item)}</Eyebrow>
          <div className="tkx-actions">
            <a className="ui-btn ui-btn--secondary ui-btn--sm" href={link} target="_blank" rel="noreferrer">
              <span className="ui-btn-label">Abrir en {systemLabel(item.origen)}</span>
              <span className="ui-btn-icon"><ExternalLink size={14} aria-hidden="true" /></span>
            </a>
            <Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => onEdit(id)}>Editar</Button>
            <Button ref={deleteRef} size="sm" variant="ghost" disabled={!canEdit} aria-expanded={askDelete} onClick={() => setAskDelete(open => !open)}>Borrar</Button>
          </div>
        </div>
        <h2 className="tkx-detail-title" id={`tkx-title-${id}`} tabIndex={-1}>{item.titulo || 'Ticket sin título'}</h2>
        <p className="tkx-detail-meta">
          Cargado por <span className="tkx-strong">{item.creadoPor || 'Sin usuario'}</span>
          {item.createdAt && <> · {shortDateTime(item.createdAt)}</>}
          {item.categoria && <> · {item.categoria}</>}
        </p>
      </header>

      <Collapse open={askDelete} unmountOnClose>
        <InlineConfirm
          danger
          busy={deleting}
          message={`¿Borrar el ticket ${ticketNumber(item)}?`}
          detail="Sale de la lista y queda guardado como borrado. Vas a poder deshacerlo."
          confirmLabel="Borrar ticket"
          onConfirm={() => void remove()}
          onCancel={() => { setAskDelete(false); deleteRef.current?.focus(); }}
        />
      </Collapse>
      <StatusSlot status={status} />

      <div className="tkx-dgrid">
        <div className="tkx-dmain">
          <section className="tkx-sec" aria-labelledby={`tkx-sum-${id}`}>
            <div className="tkx-sec-head">
              <h3 id={`tkx-sum-${id}`}>Resumen IA <span className="tkx-muted tkx-fw-normal">· lectura rápida</span></h3>
              <Button size="sm" variant="ghost" icon={<IconRetry size={14} />} loading={summaryBusy} loadingLabel="Actualizando…" disabled={!canEdit} onClick={() => void regenerate()}>Actualizar resumen</Button>
            </div>
            <p className="tkx-para">{item.aiSummary || 'El resumen se genera solo al registrar actividad. También podés pedirlo ahora.'}</p>
            {item.aiSummaryUpdatedAt && <span className="tkx-small tkx-muted">Actualizado {shortDateTime(item.aiSummaryUpdatedAt)}</span>}
            <Collapse open={Boolean(summaryError)}>
              <ErrorState message={summaryError || 'No se pudo actualizar el resumen.'} onRetry={() => void regenerate()} retrying={summaryBusy} />
            </Collapse>
          </section>

          <section className="tkx-sec" aria-labelledby={`tkx-desc-${id}`}>
            <div className="tkx-sec-head"><h3 id={`tkx-desc-${id}`}>Descripción</h3></div>
            <p ref={descRef} className="tkx-para tkx-pre">{!desc ? 'Sin descripción.' : descLong && !descOpen ? `${desc.slice(0, DESC_LONG).trimEnd()}…` : desc}</p>
            {descLong && (
              <button type="button" className="tkx-link" aria-expanded={descOpen} onClick={event => { const at = event.currentTarget; anchored(() => smoothHeight(descRef.current, () => setDescOpen(open => !open)), at); }}>
                {descOpen ? 'Mostrar menos' : 'Mostrar todo'}
              </button>
            )}
          </section>

          {item.imagenUrl && (
            <section className="tkx-sec" aria-labelledby={`tkx-file-${id}`}>
              <div className="tkx-sec-head"><h3 id={`tkx-file-${id}`}>Ticket exportado</h3></div>
              <div className="tkx-file">
                <span className="tkx-file-icon tkx-mono" aria-hidden="true">{isPdf(item.imagenUrl) ? 'PDF' : 'IMG'}</span>
                <span className="tkx-grow tkx-file-text"><span className="tkx-ell">{fileNameOf(item.imagenUrl)}</span></span>
                <span className="tkx-actions">
                  <Button size="sm" variant="secondary" aria-expanded={fileOpen} onClick={() => setFileOpen(open => !open)}>
                    {fileOpen ? 'Ocultar' : isPdf(item.imagenUrl) ? 'Ver PDF' : 'Ver imagen'}
                  </Button>
                  <a className="ui-btn ui-btn--ghost ui-btn--sm" href={item.imagenUrl} target="_blank" rel="noreferrer"><span className="ui-btn-label">Abrir en pestaña ↗</span></a>
                </span>
              </div>
              <Collapse open={fileOpen} unmountOnClose>{isPdf(item.imagenUrl)
                ? (
                  <object data={`${item.imagenUrl}#toolbar=0&navpanes=0`} type="application/pdf" className="tkx-embed" aria-label={`PDF del ticket ${ticketNumber(item)}`}>
                    <a href={item.imagenUrl} target="_blank" rel="noreferrer">Abrir el PDF en una pestaña nueva ↗</a>
                  </object>
                )
                : (
                  <a href={item.imagenUrl} target="_blank" rel="noreferrer" className="tkx-image">
                    <img src={item.imagenUrl} alt={`Archivo del ticket ${ticketNumber(item)}`} loading="lazy" />
                  </a>
                )}</Collapse>
            </section>
          )}

          {data
            ? <Checklist ticketId={id} items={data.checklist} canEdit={canEdit} onItems={update => setData(current => (current ? { ...current, checklist: update(current.checklist) } : current))} reload={load} />
            : <SkeletonText lines={3} />}

          {data && <Conversation ticketId={id} data={data} canEdit={canEdit} reload={load} onChanged={onChanged} />}
        </div>

        <aside className="tkx-dside" aria-label="Propiedades y relacionados">
          <section className="tkx-sec">
            <Segmented<TicketState>
              label="Estado"
              value={item.estado}
              onChange={next => void changeEstado(next)}
              disabled={!canEdit || estadoBusy || !data}
              options={ESTADOS.map(value => ({ value, label: value }))}
              className="tkx-estado"
            />
            <dl className="tkx-props">
              <Prop label="Prioridad">{prioTone ? <StatusText tone={prioTone}>{item.prioridad}</StatusText> : item.prioridad}</Prop>
              <Prop label="Responsables">{item.responsables?.length ? item.responsables.join(', ') : <span className="tkx-muted">Sin responsable</span>}</Prop>
              <Prop label="Aula">
                {room ? <>{room.nombre}{room.piso && <span className="tkx-muted"> · {room.piso}</span>}</>
                  : item.classroom ? <>{item.classroom} <span className="tkx-muted">(dato anterior)</span></>
                    : <span className="tkx-muted">Sin aula</span>}
              </Prop>
              <Prop label="Escuela">{item.school || <span className="tkx-muted">—</span>}</Prop>
              <Prop label="Categoría">{item.categoria || <span className="tkx-muted">Sin categoría</span>}</Prop>
              <Prop label="Tags">
                {item.tags?.length
                  ? <span className="tkx-chips">{item.tags.map(tag => <span key={tag} className="tkx-chip">{tag}</span>)}</span>
                  : <span className="tkx-muted">Sin tags</span>}
              </Prop>
              <Prop label="1.ª respuesta">{item.firstResponseAt ? shortDateTime(item.firstResponseAt) : <span className="tkx-muted">Sin respuesta</span>}</Prop>
              {item.resolvedAt && <Prop label="Resuelto">{shortDateTime(item.resolvedAt)}</Prop>}
              {item.operadorUltimoCambio && <Prop label="Último cambio">{item.operadorUltimoCambio}</Prop>}
            </dl>
          </section>
          {data
            ? <Relations ticketId={id} current={item} related={data.related} tickets={tickets} canEdit={canEdit} onOpen={onOpen} onRelated={related => setData(current => (current ? { ...current, related } : current))} reload={load} />
            : <SkeletonText lines={2} />}
        </aside>
      </div>
    </article>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tkx-prop">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ══ Checklist: tildar (optimista), agregar, quitar con Deshacer ══ */

function Checklist({ ticketId, items, canEdit, onItems, reload }: {
  ticketId: number;
  items: TicketChecklistItem[];
  canEdit: boolean;
  onItems: (update: (items: TicketChecklistItem[]) => TicketChecklistItem[]) => void;
  reload: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const status = useStatusLine();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const done = items.filter(item => item.done).length;
  const rows = useListMotion(items, item => String(item.id));
  const mark = (itemId: number, on: boolean) => setPending(current => { const next = new Set(current); if (on) next.add(itemId); else next.delete(itemId); return next; });

  const toggle = async (target: TicketChecklistItem) => {
    if (pending.has(target.id)) return;
    const next = !target.done;
    mark(target.id, true);
    onItems(list => list.map(item => (item.id === target.id ? { ...item, done: next } : item)));
    try {
      const response = await updateTicketChecklistItem(ticketId, target.id, { done: next });
      onItems(list => list.map(item => (item.id === target.id ? response.item : item)));
      void reload();
    } catch (reason) {
      onItems(list => list.map(item => (item.id === target.id ? target : item)));
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo actualizar el paso.') });
    } finally {
      mark(target.id, false);
    }
  };

  const remove = async (target: TicketChecklistItem) => {
    if (pending.has(target.id)) return;
    mark(target.id, true);
    try {
      await deleteTicketChecklistItem(ticketId, target.id);
      onItems(list => list.filter(item => item.id !== target.id));
      status.show({
        tone: 'ok',
        message: `Paso quitado: ${target.text}`,
        undo: {
          onUndo: async () => {
            try {
              await addTicketChecklistItem(ticketId, target.text, { position: target.position, done: target.done, completedBy: target.completedBy, completedAt: target.completedAt });
              status.show({ tone: 'info', message: `Paso recuperado: ${target.text}` });
              await reload();
            } catch (reason) {
              status.show({ tone: 'bad', message: errorText(reason, 'No se pudo recuperar el paso.') });
            }
          }
        }
      });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo quitar el paso.') });
    } finally {
      mark(target.id, false);
    }
  };

  const add = async () => {
    const clean = text.trim();
    if (!clean || adding) return;
    setAdding(true);
    try {
      const response = await addTicketChecklistItem(ticketId, clean);
      onItems(list => [...list, response.item]);
      setText('');
      status.clear();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo agregar el paso.') });
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  };

  return (
    <section className="tkx-sec" aria-labelledby={`tkx-check-${ticketId}`}>
      <div className="tkx-sec-head">
        <h3 id={`tkx-check-${ticketId}`}>Checklist</h3>
        <span className="tkx-count">{items.length ? `${done}/${items.length}` : 'Sin pasos'}</span>
      </div>
      <Collapse open={rows.entries.length > 0} lazy={false}>
        <ul className="tkx-checklist">
          {rows.entries.map(entry => {
            const item = entry.item;
            return (
            <li key={entry.key}>
              <ListItemMotion entry={entry} release={rows.release}>
              <div className="tkx-check-row">
              <Checkbox
                checked={item.done}
                disabled={!canEdit || pending.has(item.id)}
                label={<span className={item.done ? 'tkx-done' : undefined}>{item.text}</span>}
                description={item.done && item.completedBy ? `${item.completedBy}${item.completedAt ? ` · ${shortDateTime(item.completedAt)}` : ''}` : undefined}
                onCheckedChange={() => void toggle(item)}
                className="tkx-grow"
              />
              {canEdit && <IconButton size="sm" label={`Quitar el paso ${item.text}`} icon={<IconX size={14} />} disabled={pending.has(item.id)} onClick={() => void remove(item)} />}
              </div>
              </ListItemMotion>
            </li>
            );
          })}
        </ul>
      </Collapse>
      <StatusSlot status={status} />
      {canEdit && (
        <form className="tkx-inline-add" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void add(); }}>
          <div className="ui-control ui-input tkx-grow">
            <input ref={inputRef} className="ui-input-el" value={text} placeholder="Agregar paso y Enter" aria-label="Agregar paso" autoComplete="off" onChange={event => setText(event.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="secondary" icon={<IconPlus size={14} />} loading={adding} disabled={!text.trim()}>Agregar</Button>
        </form>
      )}
    </section>
  );
}

/* ══ Comentarios y actividad ══ */

function Conversation({ ticketId, data, canEdit, reload, onChanged }: { ticketId: number; data: Detail; canEdit: boolean; reload: () => Promise<void>; onChanged: () => void }) {
  const [tab, setTab] = useState<'com' | 'act'>('com');
  const comments = useListMotion(data.comments, comment => String(comment.id));
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    const clean = body.trim();
    if (!clean || sending) return;
    setSending(true);
    setError('');
    try {
      await addTicketComment(ticketId, clean);
      setBody('');
      await reload();
      onChanged();
    } catch (reason) {
      setError(errorText(reason, 'No se pudo publicar el comentario. Tu texto sigue acá.'));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); }
  };
  return (
    <section className="tkx-sec" aria-label="Comentarios y actividad">
      <Segmented
        ariaLabel="Comentarios o actividad"
        value={tab}
        onChange={setTab}
        options={[{ value: 'com', label: 'Comentarios', count: data.comments.length }, { value: 'act', label: 'Actividad', count: data.activity.length }]}
        size="sm"
      />
      {/* Comentarios / Actividad: una se pliega mientras la otra se abre (sin salto de alto). */}
      <Collapse open={tab === 'com'} lazy={false} className="tkx-tabpane">
          {comments.entries.length ? (
            <ol className="tkx-comments">
              {comments.entries.map(entry => {
                const comment = entry.item;
                return (
                <li key={entry.key}>
                <ListItemMotion entry={entry} release={comments.release}>
                <div className="tkx-comment">
                  <span className="tkx-avatar" aria-hidden="true">{initials(comment.authorName || comment.authorEmail)}</span>
                  <div className="tkx-grow">
                    <div className="tkx-comment-head">
                      <span className="tkx-strong tkx-ell">{comment.authorName || comment.authorEmail || 'Usuario'}</span>
                      <span className="tkx-muted tkx-small tkx-nowrap">{shortDateTime(comment.createdAt)}</span>
                    </div>
                    <p className="tkx-para tkx-pre">{comment.body}</p>
                  </div>
                </div>
                </ListItemMotion>
                </li>
                );
              })}
            </ol>
          ) : <p className="tkx-muted tkx-para">Todavía no hay comentarios.</p>}
          {canEdit && (
            <form className="tkx-composer" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void send(); }}>
              <Textarea aria-label="Registrar avance o respuesta" minRows={2} value={body} placeholder="Registrar avance o respuesta" onValueChange={value => { setBody(value); if (error) setError(''); }} onKeyDown={onKeyDown} error={error || undefined} />
              <div className="tkx-composer-foot">
                <span className="tkx-small tkx-muted tkx-grow">Ctrl Enter para comentar. El primer comentario marca la primera respuesta.</span>
                <Button type="submit" size="sm" variant="secondary" loading={sending} loadingLabel="Comentando…" disabled={!body.trim()}>Comentar</Button>
              </div>
            </form>
          )}
      </Collapse>
      <Collapse open={tab === 'act'} className="tkx-tabpane">
      {data.activity.length ? (
        <ol className="tkx-activity">
          {data.activity.map(entry => (
            <li key={entry.id}>
              <span className="tkx-mono tkx-small tkx-muted tkx-nowrap">{shortDateTime(entry.createdAt)}</span>
              <span className="tkx-grow tkx-activity-text">
                <span className="tkx-strong">{entry.action}</span>
                {entry.detail && <span className="tkx-muted"> · {entry.detail}</span>}
                <span className="tkx-muted"> · {entry.actorName || 'Sistema'}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="tkx-muted tkx-para">Sin actividad registrada.</p>}
      </Collapse>
    </section>
  );
}

/* ══ Relacionados / padre: navegar, vincular, desvincular con Deshacer ══ */

const ROLE_LABEL: Record<TicketRelation['role'], string> = { parent: 'Ticket padre', child: 'Ticket hijo', related: 'Relacionado' };

function Relations({ ticketId, current, related, tickets, canEdit, onOpen, onRelated, reload }: {
  ticketId: number;
  current: Ticket;
  related: TicketRelation[];
  tickets: Ticket[];
  canEdit: boolean;
  onOpen: (id: number) => void;
  onRelated: (items: TicketRelation[]) => void;
  reload: () => Promise<void>;
}) {
  const [pick, setPick] = useState('');
  const [type, setType] = useState<'related' | 'parent'>('related');
  const [linking, setLinking] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const relRows = useListMotion(related, rel => String(rel.relationId));
  const status = useStatusLine();
  const options = useMemo(() => tickets
    .filter(item => item.id !== ticketId && !related.some(rel => rel.ticket.id === item.id))
    .map(item => ({ value: String(item.id), label: `${ticketNumber(item)} · ${item.titulo || 'Sin título'}`, hint: item.estado })), [tickets, ticketId, related]);

  const link = async () => {
    if (!pick || linking) return;
    setLinking(true);
    try {
      const response = await addTicketRelation(ticketId, Number(pick), type);
      onRelated(response.items);
      const other = tickets.find(item => item.id === Number(pick));
      status.show({ tone: 'ok', message: `${type === 'parent' ? 'Ticket padre vinculado' : 'Ticket vinculado'}: ${other ? ticketNumber(other) : `#${pick}`}.` });
      setPick('');
      void reload();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo vincular el ticket.') });
    } finally {
      setLinking(false);
    }
  };

  const unlink = async (rel: TicketRelation) => {
    if (busyId !== null) return;
    setBusyId(rel.relationId);
    try {
      await deleteTicketRelation(ticketId, rel.relationId);
      onRelated(related.filter(item => item.relationId !== rel.relationId));
      status.show({
        tone: 'ok',
        message: `Desvinculado: ${ticketNumber(rel.ticket)}.`,
        undo: {
          onUndo: async () => {
            try {
              // El padre se vuelve a crear desde el hijo, así la dirección queda igual.
              if (rel.role === 'child') await addTicketRelation(rel.ticket.id, ticketId, 'parent');
              else await addTicketRelation(ticketId, rel.ticket.id, rel.role === 'parent' ? 'parent' : 'related');
              status.show({ tone: 'info', message: `Vinculado de nuevo: ${ticketNumber(rel.ticket)}.` });
              await reload();
            } catch (reason) {
              status.show({ tone: 'bad', message: errorText(reason, 'No se pudo volver a vincular.') });
            }
          }
        }
      });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo desvincular.') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="tkx-sec" aria-labelledby={`tkx-rel-${ticketId}`}>
      <div className="tkx-sec-head">
        <h3 id={`tkx-rel-${ticketId}`}>Relacionados</h3>
        <span className="tkx-count">{related.length}</span>
      </div>
      {relRows.entries.length ? (
        <ul className="tkx-rels">
          {relRows.entries.map(entry => {
            const rel = entry.item;
            return (
            <li key={entry.key}>
            <ListItemMotion entry={entry} release={relRows.release}>
            <div className="tkx-rel">
              <a className="tkx-rel-open" href={ticketRoutePath({ kind: 'detail', id: rel.ticket.id })} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return; event.preventDefault(); onOpen(rel.ticket.id); }} aria-label={`Abrir ${ROLE_LABEL[rel.role]} ${ticketNumber(rel.ticket)}: ${rel.ticket.titulo || 'sin título'}`}>
                <span className="tkx-small tkx-muted tkx-ell">{ROLE_LABEL[rel.role]} · <span className="tkx-mono">{ticketNumber(rel.ticket)}</span></span>
                <TruncatedText lines={2} className="tkx-rel-title">{rel.ticket.titulo || 'Sin título'}</TruncatedText>
              </a>
              {canEdit && <IconButton size="sm" label={`Desvincular ${ticketNumber(rel.ticket)}`} icon={<IconX size={14} />} loading={busyId === rel.relationId} onClick={() => void unlink(rel)} />}
            </div>
            </ListItemMotion>
            </li>
            );
          })}
        </ul>
      ) : <p className="tkx-muted tkx-para">Sin tickets vinculados.</p>}
      <StatusSlot status={status} />
      {canEdit && (
        <div className="tkx-relform" data-scanner-ignore="">
          <Select
            label="Vincular ticket"
            value={pick}
            onChange={setPick}
            placeholder={options.length ? 'Elegí un ticket…' : 'No quedan tickets para vincular'}
            options={options}
            disabled={!options.length}
            searchable="auto"
            maxVisible={6}
          />
          <Segmented ariaLabel="Tipo de relación" size="sm" value={type} onChange={setType} options={[{ value: 'related', label: 'Relacionado' }, { value: 'parent', label: 'Es su padre' }]} />
          <span className="tkx-small tkx-muted">{type === 'parent' ? `El elegido pasa a ser el padre de ${ticketNumber(current)}.` : 'Quedan vinculados entre sí.'}</span>
          <Button size="sm" variant="secondary" loading={linking} disabled={!pick} onClick={() => void link()}>Vincular</Button>
        </div>
      )}
    </section>
  );
}

function initials(name: string) {
  return String(name || '?').split(/[\s@.]+/).filter(Boolean).map(word => word.charAt(0)).join('').slice(0, 2).toUpperCase() || '?';
}

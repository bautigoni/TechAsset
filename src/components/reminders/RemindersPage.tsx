import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/screens/reminders.css';
import { completeReminder, createReminder, deleteReminder, getReminderPeople, getReminders, postponeReminder, undoReminder, updateReminder } from '../../services/remindersApi';
import { getActiveSiteCode } from '../../services/activeSite';
import { Button, Checkbox, EmptyState, ErrorState, Eyebrow, IconButton, InlineConfirm, Segmented, SkeletonRows, cx, useStatusLine } from '../../ui';
import { IconPlus } from '../../ui/icons';
import { errorMessage } from '../layout/Feedback';
import { dayKeyAr } from '../../utils/formatters';
import { focusQuietly } from '../../utils/reveal';
import { Collapse } from '../common/SoftCollapse';
import { EMPTY_DRAFT, ReminderForm, draftFromReminder, payloadFromDraft, type Person, type ReminderDraft } from './ReminderForm';
import { WhenField } from './WhenField';
import { formatWhen, isValidLocal, localToIso, nextHourLocal, priorityTone, relatedTypeLabel, relativeWhen, type ReminderRow } from './reminderUtils';

type Filter = 'pend' | 'over' | 'today' | 'next' | 'done' | 'all';
type Snapshot = Pick<ReminderRow, 'status' | 'remindAt' | 'notificationSentAt' | 'completedAt' | 'completedBy'>;

const snapshot = (item: ReminderRow): Snapshot => ({ status: item.status, remindAt: item.remindAt, notificationSentAt: item.notificationSentAt || '', completedAt: item.completedAt, completedBy: item.completedBy || '' });

export function IconTrash({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/**
 * Recordatorios (etapa 6b, rediseño Grafito). Lista con filtros, completar
 * con Deshacer, posponer y editar en línea, borrar con confirmación en línea
 * (y Deshacer), alta en línea con un selector de fecha propio que funciona en
 * iPhone. Nada flota.
 */
export function RemindersPage({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState<Filter>('pend');
  const [mineOnly, setMineOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ReminderDraft>(EMPTY_DRAFT);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState('');
  const [peopleError, setPeopleError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const status = useStatusLine();
  const site = getActiveSiteCode();

  const load = useCallback(async () => {
    try {
      const response = await getReminders();
      setItems(response.items || []);
      setLoadError('');
    } catch (reason) {
      setLoadError(errorMessage(reason, 'No se pudieron cargar los recordatorios.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // "Vencido", "en 20 min": se recalculan cada minuto sin pedir nada al server.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // Un alta empezada no se pierde sin aviso si se cierra o recarga la pestaña.
  const hasDraft = Boolean(draft.title.trim() || draft.description.trim());
  useEffect(() => {
    if (!hasDraft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft]);

  const peopleLoaded = useRef(false);
  const ensurePeople = useCallback(() => {
    if (peopleLoaded.current) return;
    peopleLoaded.current = true;
    getReminderPeople()
      .then(response => { setPeople((response.items || []).filter(person => person.email !== response.me)); setMe(response.me); setPeopleError(''); })
      .catch(reason => { peopleLoaded.current = false; setPeopleError(errorMessage(reason, 'No se pudo cargar la lista de personas: podés usar "Otro mail".')); });
  }, []);

  const replace = (item: ReminderRow) => setItems(current => current.map(row => (row.id === item.id ? item : row)));

  // ── Grupos ────────────────────────────────────────────────────────────
  const today = dayKeyAr(now);
  const visible = useMemo(() => (mineOnly ? items.filter(item => item.mine) : items), [items, mineOnly]);
  const isOver = (item: ReminderRow) => item.status === 'pending' && new Date(item.remindAt).getTime() < now;
  const isToday = (item: ReminderRow) => item.status === 'pending' && dayKeyAr(item.remindAt) === today;
  const pending = visible.filter(item => item.status === 'pending');
  const done = visible.filter(item => item.status === 'completed');
  const over = pending.filter(isOver);
  const todayList = pending.filter(item => isToday(item) && !isOver(item));
  const nextList = pending.filter(item => !isOver(item) && !isToday(item));
  const byDate = (a: ReminderRow, b: ReminderRow) => a.remindAt.localeCompare(b.remindAt);
  const byDone = (a: ReminderRow, b: ReminderRow) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt);

  const groups: Array<{ key: string; title: string; tone?: 'bad' | 'muted'; rows: ReminderRow[] }> = [];
  const push = (key: string, title: string, rows: ReminderRow[], tone?: 'bad' | 'muted') => { if (rows.length) groups.push({ key, title, tone, rows }); };
  if (filter === 'pend' || filter === 'all' || filter === 'over') push('over', 'Vencidos', [...over].sort(byDate), 'bad');
  if (filter === 'pend' || filter === 'all') { push('today', 'Hoy', [...todayList].sort(byDate)); push('next', 'Próximos', [...nextList].sort(byDate)); }
  if (filter === 'today') push('today', 'Hoy', pending.filter(isToday).sort(byDate));
  if (filter === 'next') push('next', 'Próximos', [...nextList].sort(byDate));
  if (filter === 'done' || filter === 'all' || (filter === 'pend' && showDone)) push('done', 'Completados', [...done].sort(byDone), 'muted');

  // ── Acciones (cada una con su Deshacer) ───────────────────────────────
  const restore = async (item: ReminderRow, previous: Snapshot, message: string) => {
    const response = await undoReminder(item.id, previous);
    setItems(current => (current.some(row => row.id === item.id) ? current.map(row => (row.id === item.id ? response.item : row)) : [...current, response.item]));
    status.show({ tone: 'info', message });
  };

  const toggleComplete = async (item: ReminderRow) => {
    const before = snapshot(item);
    if (item.status === 'pending') {
      const response = await completeReminder(item.id);
      replace(response.item);
      status.show({ tone: 'ok', message: `«${item.title}» completado.`, undo: { onUndo: () => restore(item, before, `«${item.title}» volvió a pendientes.`) } });
    } else {
      const response = await undoReminder(item.id, { ...before, status: 'pending', completedAt: '', completedBy: '' });
      replace(response.item);
      status.show({ tone: 'ok', message: `«${item.title}» volvió a pendientes.`, undo: { onUndo: () => restore(item, before, `«${item.title}» quedó completado otra vez.`) } });
    }
  };

  const postpone = async (item: ReminderRow, local: string) => {
    const before = snapshot(item);
    const response = await postponeReminder(item.id, localToIso(local));
    replace(response.item);
    status.show({ tone: 'ok', message: `«${item.title}» pospuesto a ${formatWhen(response.item.remindAt)}. Vuelve a avisar.`, undo: { onUndo: () => restore(item, before, `«${item.title}» volvió a ${formatWhen(before.remindAt)}.`) } });
  };

  const remove = async (item: ReminderRow) => {
    const before = snapshot(item);
    await deleteReminder(item.id);
    setItems(current => current.filter(row => row.id !== item.id));
    status.show({ tone: 'ok', message: `«${item.title}» borrado. Deja de avisar.`, undo: { onUndo: () => restore(item, before, `«${item.title}» recuperado.`) } });
  };

  const create = async () => {
    const payload = payloadFromDraft(draft, people, me);
    const response = await createReminder(payload);
    setItems(current => [...current, response.item]);
    setDraft(EMPTY_DRAFT);
    setFormOpen(false);
    focusQuietly(newButtonRef.current);
    if (filter === 'done') setFilter('pend');
    status.show({
      tone: 'ok',
      message: `Recordatorio guardado para ${formatWhen(response.item.remindAt)}.`,
      undo: { onUndo: async () => { await deleteReminder(response.item.id); setItems(current => current.filter(row => row.id !== response.item.id)); status.show({ tone: 'info', message: 'Se descartó el recordatorio nuevo.' }); } }
    });
  };

  const counts: Record<Filter, number> = { pend: pending.length, over: over.length, today: pending.filter(isToday).length, next: nextList.length, done: done.length, all: visible.length };

  return (
    <section className="view active rem">
      <div className="rem-head">
        <div className="rem-head-text">
          <Eyebrow>{`Gestión · ${site}`}</Eyebrow>
          <h2 className="rem-title">Recordatorios</h2>
          <p className="rem-sub">
            <span className="rem-mono">{pending.length}</span> {pending.length === 1 ? 'pendiente' : 'pendientes'} · <span className={cx('rem-mono', over.length > 0 && 'rem-tone-bad')}>{over.length}</span><span className={over.length > 0 ? 'rem-tone-bad' : undefined}> {over.length === 1 ? 'vencido' : 'vencidos'}</span> · {mineOnly ? 'solo los tuyos' : 'todos los de la sede'}
          </p>
        </div>
        <div className="rem-head-actions">
          <Checkbox label="Solo los míos" checked={mineOnly} onCheckedChange={setMineOnly} />
          <Button ref={newButtonRef} variant="primary" icon={<IconPlus size={16} />} aria-expanded={formOpen} disabled={consultationMode} onClick={() => { ensurePeople(); setFormOpen(open => !open); }}>
            Nuevo recordatorio
          </Button>
        </div>
      </div>

      <Segmented<Filter>
        ariaLabel="Mostrar"
        value={filter}
        onChange={next => { setFilter(next); setShowDone(false); }}
        className="rem-filters"
        options={[
          { value: 'pend', label: 'Pendientes', count: counts.pend },
          { value: 'over', label: 'Vencidos', count: counts.over },
          { value: 'today', label: 'Hoy', count: counts.today },
          { value: 'next', label: 'Próximos', count: counts.next },
          { value: 'done', label: 'Completados', count: counts.done },
          { value: 'all', label: 'Todos', count: counts.all }
        ]}
      />

      <div className={cx('rem-layout', formOpen && 'has-form')}>
        <div className="rem-form-col">
          <Collapse open={formOpen}>
            <section className="rem-card rem-form-card" aria-label="Nuevo recordatorio">
              <ReminderForm
                mode="create"
                draft={draft}
                onChange={setDraft}
                people={people}
                peopleError={peopleError}
                onSubmit={create}
                onCancel={() => { setFormOpen(false); focusQuietly(newButtonRef.current); }}
                onClose={() => { setFormOpen(false); focusQuietly(newButtonRef.current); }}
                disabled={consultationMode}
              />
            </section>
          </Collapse>
        </div>

        <section className="rem-list-col" aria-label="Lista de recordatorios">
          {status.element}
          {loadError && <ErrorState message={loadError} retrying={retrying} onRetry={async () => { setRetrying(true); await load(); setRetrying(false); }} />}
          {loading ? (
            <div className="rem-card"><SkeletonRows rows={4} /></div>
          ) : groups.length ? (
            groups.map(group => (
              <div key={group.key} className="rem-card rem-group">
                <div className="rem-group-head">
                  <h3 className={cx('rem-h3', group.tone && `rem-tone-${group.tone}`)}>{group.title}</h3>
                  <span className="rem-count">{group.rows.length}</span>
                </div>
                <ul className="rem-rows">
                  {group.rows.map(item => (
                    <ReminderItem
                      key={item.id}
                      item={item}
                      now={now}
                      consultationMode={consultationMode}
                      people={people}
                      me={me}
                      peopleError={peopleError}
                      ensurePeople={ensurePeople}
                      onToggle={toggleComplete}
                      onPostpone={postpone}
                      onDelete={remove}
                      onEdit={async payload => { const response = await updateReminder(item.id, payload); replace(response.item); status.show({ tone: 'ok', message: `«${response.item.title}» actualizado.` }); }}
                      onError={message => status.show({ tone: 'bad', message })}
                    />
                  ))}
                </ul>
              </div>
            ))
          ) : !loadError && (
            <div className="rem-card">
              <EmptyState
                title={visible.length ? EMPTY_TEXT[filter] : 'Todavía no hay recordatorios.'}
                description={!visible.length && !consultationMode ? 'Elegí qué y cuándo: te avisamos en la campana, con push y por mail.' : filter !== 'all' && visible.length ? 'Probá con otro filtro o mirá Todos.' : undefined}
                action={!consultationMode && !formOpen ? <Button size="sm" variant="secondary" icon={<IconPlus size={14} />} onClick={() => { ensurePeople(); setFormOpen(true); }}>Nuevo recordatorio</Button> : undefined}
              />
            </div>
          )}
          {!loading && filter === 'pend' && !showDone && done.length > 0 && (
            <Button variant="ghost" className="rem-self-start" onClick={() => setShowDone(true)}>Ver completados <span className="rem-count">{done.length}</span></Button>
          )}
        </section>
      </div>
    </section>
  );
}

const EMPTY_TEXT: Record<Filter, string> = {
  pend: 'No hay recordatorios pendientes.',
  over: 'No hay nada vencido.',
  today: 'No hay recordatorios para hoy.',
  next: 'No hay recordatorios para los próximos días.',
  done: 'Todavía no se completó ninguno.',
  all: 'No hay recordatorios.'
};

function ReminderItem({ item, now, consultationMode, people, me, peopleError, ensurePeople, onToggle, onPostpone, onDelete, onEdit, onError }: {
  item: ReminderRow;
  now: number;
  consultationMode: boolean;
  people: Person[];
  me: string;
  peopleError: string;
  ensurePeople: () => void;
  onToggle: (item: ReminderRow) => Promise<void>;
  onPostpone: (item: ReminderRow, local: string) => Promise<void>;
  onDelete: (item: ReminderRow) => Promise<void>;
  onEdit: (payload: ReturnType<typeof payloadFromDraft>) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [panel, setPanel] = useState<'none' | 'postpone' | 'edit' | 'delete'>('none');
  const [busy, setBusy] = useState(false);
  const [postponeTo, setPostponeTo] = useState(nextHourLocal());
  const [editDraft, setEditDraft] = useState<ReminderDraft | null>(null);
  const done = item.status === 'completed';
  const canAct = !consultationMode && item.canEdit !== false;
  const rel = done ? null : relativeWhen(item.remindAt, now);
  const mine = item.mine;
  const who = mine ? 'para vos' : `para ${item.ownerName || item.ownerEmail || item.createdByName || 'la sede'}`;

  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await work();
      return true;
    } catch (reason) {
      onError(errorMessage(reason, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Si la lista de personas llega después de abrir Editar, el responsable conocido deja de verse como "Otro mail".
  useEffect(() => {
    setEditDraft(current => {
      if (!current || current.owner !== '__other') return current;
      const mail = current.otherMail.trim().toLowerCase();
      if (me && mail === me) return { ...current, owner: '', otherMail: '' };
      const match = people.find(person => person.email === mail);
      return match ? { ...current, owner: match.email, otherMail: '' } : current;
    });
  }, [people, me]);

  const openPanel = (next: typeof panel) => {
    if (next === 'edit') { ensurePeople(); setEditDraft(draftFromReminder(item, people, me)); }
    if (next === 'postpone') setPostponeTo(nextHourLocal());
    setPanel(current => (current === next ? 'none' : next));
  };

  return (
    <li className={cx('rem-row', done && 'is-done')} data-reminder-id={item.id}>
      <div className="rem-row-main">
        <Checkbox
          checked={done}
          disabled={!canAct || busy}
          ariaLabel={done ? `Volver a pendiente: ${item.title}` : `Completar: ${item.title}`}
          onCheckedChange={() => void run(() => onToggle(item), 'No se pudo actualizar el recordatorio.')}
          className="rem-check"
        />
        <div className="rem-row-body">
          <span className="rem-row-title">{item.title}</span>
          {item.description && <span className="rem-row-desc">{item.description}</span>}
          <span className="rem-row-meta">
            <span className={cx(!done && `rem-tone-${priorityTone(item.priority)}`, item.priority === 'Urgente' && !done && 'rem-strong')}>{item.priority}</span>
            {item.relatedType && <span>{relatedTypeLabel(item.relatedType)} · {item.relatedLabel || item.relatedId || 'sin nombre'}</span>}
            <span>{who}</span>
            {done
              ? <span>completado {item.completedAt ? formatWhen(item.completedAt) : ''}{item.completedBy ? ` · ${item.completedBy}` : ''}</span>
              : item.notificationSentAt ? <span>aviso enviado {formatWhen(item.notificationSentAt)}</span> : null}
          </span>
        </div>
        <div className="rem-row-when">
          <span className="rem-mono rem-when-at">{formatWhen(item.remindAt)}</span>
          {rel && <span className={`rem-tone-${rel.tone} rem-when-rel`}>{rel.text}</span>}
        </div>
        {!done && (
          <div className="rem-row-actions">
            <Button size="sm" variant="ghost" aria-expanded={panel === 'postpone'} disabled={!canAct || busy} onClick={() => openPanel('postpone')}>Posponer</Button>
            <Button size="sm" variant="ghost" aria-expanded={panel === 'edit'} disabled={!canAct || busy} onClick={() => openPanel('edit')}>Editar</Button>
            <IconButton size="sm" label={`Borrar recordatorio ${item.title}`} icon={<IconTrash />} disabled={!canAct || busy} aria-expanded={panel === 'delete'} onClick={() => openPanel('delete')} />
          </div>
        )}
        {done && canAct && (
          <div className="rem-row-actions">
            <IconButton size="sm" label={`Borrar recordatorio ${item.title}`} icon={<IconTrash />} disabled={busy} aria-expanded={panel === 'delete'} onClick={() => openPanel('delete')} />
          </div>
        )}
      </div>

      <Collapse open={panel === 'postpone'}>
        <div className="rem-inline" data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setPanel('none'); } }}>
          <WhenField label="Posponer a" value={postponeTo} onChange={setPostponeTo} disabled={busy} />
          <div className="rem-actions rem-actions-end">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel('none')}>Cancelar</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!isValidLocal(postponeTo)} onClick={async () => { if (await run(() => onPostpone(item, postponeTo), 'No se pudo posponer.')) setPanel('none'); }}>Posponer</Button>
          </div>
        </div>
      </Collapse>

      <Collapse open={panel === 'edit'}>
        {editDraft && (
          <div className="rem-inline">
            <ReminderForm
              mode="edit"
              draft={editDraft}
              onChange={setEditDraft}
              people={people}
              peopleError={peopleError}
              onSubmit={async () => { await onEdit(payloadFromDraft(editDraft, people, me)); setPanel('none'); }}
              onCancel={() => setPanel('none')}
              disabled={!canAct}
            />
          </div>
        )}
      </Collapse>

      <Collapse open={panel === 'delete'}>
        <InlineConfirm
          danger
          message={`¿Borrar «${item.title}»?`}
          detail="Deja de avisar. Vas a poder deshacerlo unos segundos."
          confirmLabel="Borrar"
          busy={busy}
          onCancel={() => setPanel('none')}
          onConfirm={async () => { if (await run(() => onDelete(item), 'No se pudo borrar.')) setPanel('none'); }}
          className="rem-confirm"
        />
      </Collapse>
    </li>
  );
}

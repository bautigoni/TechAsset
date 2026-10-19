import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Lightbulb, SlidersHorizontal } from 'lucide-react';
import { IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconPlus as Plus } from '../../ui/icons';
import '../../styles/screens/suggestions.css';
import type { Suggestion, SuggestionComment, SuggestionStats, SuggestionStatus } from '../../types';
import {
  addSuggestionComment, createSuggestion, deleteSuggestion, getSuggestionComments, getSuggestions, restoreSuggestion, toggleSuggestionVote, updateSuggestion
} from '../../services/suggestionsApi';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { Button, EmptyState, ErrorState, Eyebrow, InlineConfirm, Input, Segmented, SkeletonRows, StatusText, Textarea, StatusSlot, useStatusLine, type StatusTextTone } from '../../ui';
import { TruncatedText } from '../../ui/Truncated';
import { cx, fold } from '../../ui/util';
import { APP_TIME_ZONE, formatDate } from '../../utils/formatters';
import { Collapse } from '../../ui';

// El servidor guarda el estado en inglés; la UI lo traduce siempre.
const STATUSES: Array<{ value: SuggestionStatus; label: string; tone: StatusTextTone }> = [
  { value: 'Proposed', label: 'Propuesta', tone: 'normal' },
  { value: 'Under Review', label: 'En revisión', tone: 'warn' },
  { value: 'Planned', label: 'Planificada', tone: 'info' },
  { value: 'In Progress', label: 'En progreso', tone: 'info' },
  { value: 'Implemented', label: 'Implementada', tone: 'ok' },
  { value: 'Rejected', label: 'Rechazada', tone: 'muted' }
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map(item => [item.value, item.label])) as Record<SuggestionStatus, string>;
const STATUS_TONE = Object.fromEntries(STATUSES.map(item => [item.value, item.tone])) as Record<SuggestionStatus, StatusTextTone>;
const EMPTY_STATS: SuggestionStats = { total: 0, mostVoted: null, implemented: 0, pendingReview: 0 };
const DAY: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' };
const DAY_TIME: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const NARROW = 820;
const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);
type Counts = { status: Record<string, number>; category: Record<string, number> };
type FormDraft = { title: string; category: string; description: string };

/**
 * Sugerencias: buzón de ideas votables. Todo en línea: alta arriba de la
 * lista, edición dentro de la fila, estado (para quien gestiona) y
 * comentarios que se despliegan debajo, eliminar con confirmación y Deshacer.
 * Los errores quedan escritos donde pasó la acción.
 */
export function SuggestionsPage() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [stats, setStats] = useState<SuggestionStats>(EMPTY_STATS);
  const [categories, setCategories] = useState<string[]>([]);
  const [counts, setCounts] = useState<Counts>({ status: {}, category: {} });
  const [canManage, setCanManage] = useState(false);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'newest' | 'most_voted'>('newest');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [statusOpenId, setStatusOpenId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [askId, setAskId] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const newBtnRef = useRef<HTMLButtonElement | null>(null);
  const pageStatus = useStatusLine();

  const opened = items.find(item => item.id === openId) || null;
  useAssistantContext(opened ? { type: 'suggestion', id: String(opened.id), label: opened.title, data: { status: opened.status, category: opened.category, votes: opened.voteCount } } : null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getSuggestions({ status, category, sort });
      setItems(response.items || []);
      setStats(response.stats || EMPTY_STATS);
      setCategories(response.categories || []);
      setCanManage(Boolean(response.canManage));
      setCounts(response.counts || { status: {}, category: {} });
      setLoadError('');
    } catch (reason) {
      setLoadError(errorText(reason, 'No se pudieron cargar las sugerencias.'));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [status, category, sort]);
  useEffect(() => { void load(); }, [load]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const isNarrow = (entries[0]?.contentRect.width || 0) < NARROW;
      setNarrow(current => (current === isNarrow ? current : isNarrow));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setBusy = (id: number, on: boolean) => setBusyIds(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const patchItem = (id: number, patch: Partial<Suggestion>) => setItems(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)));

  /* ── Votar / quitar voto al instante ── */
  const vote = async (item: Suggestion) => {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    patchItem(item.id, { hasVoted: !item.hasVoted, voteCount: Math.max(0, item.voteCount + (item.hasVoted ? -1 : 1)) });
    try {
      const response = await toggleSuggestionVote(item.id);
      patchItem(item.id, { hasVoted: response.voted, voteCount: response.votes });
    } catch (reason) {
      patchItem(item.id, { hasVoted: item.hasVoted, voteCount: item.voteCount });
      pageStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo registrar el voto.') });
    } finally {
      setBusy(item.id, false);
    }
  };

  /* ── Estado (quien gestiona) con Deshacer ── */
  const moveCount = (from: SuggestionStatus, to: SuggestionStatus) => setCounts(current => {
    const next = { ...current.status };
    next[from] = Math.max(0, (next[from] || 0) - 1);
    next[to] = (next[to] || 0) + 1;
    return { ...current, status: next };
  });
  const changeStatus = async (item: Suggestion, next: SuggestionStatus) => {
    if (busyIds.has(item.id) || item.status === next) return;
    setBusy(item.id, true);
    try {
      const response = await updateSuggestion(item.id, { status: next });
      patchItem(item.id, response.item);
      moveCount(item.status, next);
      setStatusOpenId(null);
      pageStatus.show({
        tone: 'ok',
        message: `«${item.title}» pasó a ${STATUS_LABEL[next]}. Se avisó al autor, a quienes votaron y a quienes comentaron.`,
        undo: {
          onUndo: async () => {
            try {
              const back = await updateSuggestion(item.id, { status: item.status });
              patchItem(item.id, back.item);
              moveCount(next, item.status);
              pageStatus.show({ tone: 'info', message: `«${item.title}» volvió a ${STATUS_LABEL[item.status]}.` });
            } catch (reason) {
              pageStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer el cambio de estado.') });
            }
          }
        }
      });
    } catch (reason) {
      pageStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo cambiar el estado.') });
    } finally {
      setBusy(item.id, false);
    }
  };

  /* ── Eliminar con confirmación en línea y Deshacer ── */
  const remove = async (item: Suggestion) => {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    try {
      await deleteSuggestion(item.id);
      setAskId(null);
      setItems(current => current.filter(entry => entry.id !== item.id));
      if (openId === item.id) setOpenId(null);
      pageStatus.show({
        tone: 'ok',
        message: `Sugerencia «${item.title}» eliminada con sus votos.`,
        undo: {
          onUndo: async () => {
            try {
              await restoreSuggestion(item.id);
              pageStatus.show({ tone: 'info', message: `«${item.title}» recuperada con sus votos.` });
            } catch (reason) {
              pageStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo recuperar la sugerencia.') });
            }
            await load();
          }
        }
      });
      void load();
    } catch (reason) {
      pageStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo eliminar la sugerencia.') });
    } finally {
      setBusy(item.id, false);
    }
  };

  const clearFilters = () => { setStatus(''); setCategory(''); };
  const statusFilters = [{ value: '', label: 'Todos' }, ...STATUSES.map(item => ({ value: item.value as string, label: item.label }))];
  const categoryFilters = [{ value: '', label: 'Todas' }, ...categories.map(item => ({ value: item, label: item }))];
  const filterSummary = [status ? STATUS_LABEL[status as SuggestionStatus] : 'Todos los estados', category || 'Todas las categorías', sort === 'most_voted' ? 'Más votadas' : 'Más nuevas'].join(' · ');
  const top = stats.mostVoted && stats.mostVoted.votes > 0 ? stats.mostVoted : null;
  const openTop = () => {
    if (!top) return;
    setStatus('');
    setCategory('');
    setOpenId(top.id);
    requestAnimationFrame(() => document.getElementById(`sgx-${top.id}`)?.scrollIntoView({ block: 'nearest' }));
  };

  const filters = (
    <div className="sgx-filters">
      <div className="sgx-fgroup" role="group" aria-label="Filtrar por estado">
        <Eyebrow>Estado</Eyebrow>
        {statusFilters.map(option => (
          <button key={option.value || 'all'} type="button" className="sgx-fi" aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>
            <span className="sgx-ell">{option.label}</span>
            <span className="sgx-count">{counts.status[option.value || 'all'] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="sgx-fgroup" role="group" aria-label="Filtrar por categoría">
        <Eyebrow>Categoría</Eyebrow>
        {categoryFilters.map(option => (
          <button key={option.value || 'all'} type="button" className="sgx-fi" aria-pressed={category === option.value} onClick={() => setCategory(option.value)}>
            <span className="sgx-ell">{option.label}</span>
            <span className="sgx-count">{counts.category[option.value || 'all'] ?? 0}</span>
          </button>
        ))}
      </div>
      <Segmented label="Orden" size="sm" value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Más nuevas' }, { value: 'most_voted', label: 'Más votadas' }]} />
    </div>
  );

  return (
    <section className="view active sgx" aria-label="Sugerencias">
      <div className="sgx-kpis" role="group" aria-label="Resumen del buzón">
        <div className="sgx-kp"><span className="sgx-kl">Total</span><span className="sgx-kv">{stats.total}</span></div>
        <div className="sgx-kp sgx-kp-wide">
          <span className="sgx-kl">Más votada</span>
          {top ? (
            <span className="sgx-kv2">
              <span className="sgx-mono sgx-nowrap">{top.votes} {top.votes === 1 ? 'voto' : 'votos'}</span>
              <button type="button" className="sgx-toplink" onClick={openTop}><TruncatedText>{top.title}</TruncatedText></button>
            </span>
          ) : <span className="sgx-kv2 sgx-muted">Sin votos</span>}
        </div>
        <div className="sgx-kp"><span className="sgx-kl">Implementadas</span><span className="sgx-kv">{stats.implemented}</span></div>
        <div className="sgx-kp">
          <span className="sgx-kl">Por revisar</span>
          <span className={cx('sgx-kv', stats.pendingReview > 0 && 'is-warn')}>{stats.pendingReview}</span>
        </div>
      </div>

      <div ref={wrapRef} className={cx('sgx-wrap', narrow && 'is-narrow')}>
        <section className="sgx-main" aria-labelledby="sgx-title">
          <div className="sgx-head">
            <div className="sgx-grow">
              <Eyebrow>Buzón de ideas</Eyebrow>
              <h2 id="sgx-title" className="sgx-title">Sugerencias <span className="sgx-count">{items.length} de {stats.total}</span></h2>
            </div>
            <Button ref={newBtnRef} variant="primary" icon={<Plus size={16} />} aria-expanded={newOpen} onClick={() => setNewOpen(open => !open)}>Nueva sugerencia</Button>
          </div>
          <StatusSlot status={pageStatus} />

          <Collapse open={newOpen} unmountOnClose>
            <SuggestionForm
              heading="Nueva sugerencia"
              categories={categories}
              initial={{ title: '', category: 'General', description: '' }}
              submitLabel="Publicar"
              onCancel={() => { setNewOpen(false); newBtnRef.current?.focus(); }}
              onSave={async draft => {
                await createSuggestion(draft);
                setNewOpen(false);
                setStatus('');
                setCategory('');
                setSort('newest');
                pageStatus.show({ tone: 'ok', message: 'Sugerencia publicada. Se avisó a quienes gestionan el buzón.' });
                if (!status && !category && sort === 'newest') await load();
              }}
            />
          </Collapse>

          <div className="sgx-list">
            {!loaded && loading ? (
              <SkeletonRows rows={5} className="sgx-skel" />
            ) : loadError && !items.length ? (
              <ErrorState message={loadError} onRetry={() => void load()} retrying={loading} />
            ) : !items.length ? (
              <EmptyState
                compact
                className="sgx-empty"
                icon={<Lightbulb size={18} strokeWidth={1.6} />}
                title={status || category ? 'No hay sugerencias para estos filtros.' : 'Todavía no hay sugerencias.'}
                description={status || category ? undefined : 'Contá qué cambiarías o agregarías: el resto puede votarla y comentarla.'}
                action={status || category ? <Button size="sm" variant="secondary" onClick={clearFilters}>Ver todas</Button> : !newOpen ? <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)}>Nueva sugerencia</Button> : undefined}
              />
            ) : (
              <>
                {loadError && <ErrorState message={loadError} onRetry={() => void load()} retrying={loading} />}
                {items.map(item => (
                  <SuggestionRow
                    key={item.id}
                    item={item}
                    canManage={canManage}
                    categories={categories}
                    busy={busyIds.has(item.id)}
                    open={openId === item.id}
                    statusOpen={statusOpenId === item.id}
                    editing={editId === item.id}
                    asking={askId === item.id}
                    onVote={() => void vote(item)}
                    onToggleOpen={() => setOpenId(current => (current === item.id ? null : item.id))}
                    onToggleStatus={() => { setStatusOpenId(current => (current === item.id ? null : item.id)); setAskId(null); }}
                    onPickStatus={next => void changeStatus(item, next)}
                    onEdit={() => { setEditId(item.id); setAskId(null); setStatusOpenId(null); }}
                    onCancelEdit={() => setEditId(null)}
                    onSaved={(updated, before) => {
                      patchItem(item.id, updated);
                      setEditId(null);
                      pageStatus.show({
                        tone: 'ok',
                        message: 'Cambios guardados.',
                        undo: {
                          onUndo: async () => {
                            try {
                              const back = await updateSuggestion(item.id, before);
                              patchItem(item.id, back.item);
                              pageStatus.show({ tone: 'info', message: 'Volvió a como estaba.' });
                            } catch (reason) {
                              pageStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer.') });
                            }
                          }
                        }
                      });
                    }}
                    onAskDelete={() => { setAskId(current => (current === item.id ? null : item.id)); setStatusOpenId(null); }}
                    onCancelDelete={() => setAskId(null)}
                    onDelete={() => void remove(item)}
                    onCommented={() => patchItem(item.id, { commentCount: item.commentCount + 1 })}
                  />
                ))}
              </>
            )}
          </div>
        </section>

        <aside className="sgx-side" aria-label="Filtros">
          {narrow ? (
            <>
              <button type="button" className="sgx-ftoggle" aria-expanded={filtersOpen} aria-controls="sgx-filters-body" onClick={() => setFiltersOpen(open => !open)}>
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span className="sgx-strong sgx-nowrap">Filtros</span>
                <span className="sgx-ell sgx-muted sgx-grow">{filterSummary}</span>
                {filtersOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
              <Collapse open={filtersOpen} id="sgx-filters-body" unmountOnClose>{filters}</Collapse>
            </>
          ) : filters}
        </aside>
      </div>
    </section>
  );
}

/* ══ Fila ══ */

function SuggestionRow({ item, canManage, categories, busy, open, statusOpen, editing, asking, onVote, onToggleOpen, onToggleStatus, onPickStatus, onEdit, onCancelEdit, onSaved, onAskDelete, onCancelDelete, onDelete, onCommented }: {
  item: Suggestion;
  canManage: boolean;
  categories: string[];
  busy: boolean;
  open: boolean;
  statusOpen: boolean;
  editing: boolean;
  asking: boolean;
  onVote: () => void;
  onToggleOpen: () => void;
  onToggleStatus: () => void;
  onPickStatus: (status: SuggestionStatus) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (item: Suggestion, before: FormDraft) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onCommented: () => void;
}) {
  const editRef = useRef<HTMLButtonElement | null>(null);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLButtonElement | null>(null);
  const author = item.authorName || item.authorEmail || 'Usuario';
  // La descripción se despliega con su propio botón, debajo del texto: abrir los
  // comentarios no cambia el alto de lo que está arriba del botón tocado.
  const [descOpen, setDescOpen] = useState(false);
  const descLong = item.description.length > 180 || item.description.split('\n').length > 2;
  return (
    <article className="sgx-row" id={`sgx-${item.id}`} aria-labelledby={`sgx-h-${item.id}`}>
      <button
        type="button"
        className="sgx-vote"
        aria-pressed={item.hasVoted}
        aria-label={`${item.hasVoted ? 'Quitar tu voto' : 'Votar'}. ${item.voteCount} ${item.voteCount === 1 ? 'voto' : 'votos'}`}
        disabled={busy}
        onClick={onVote}
      >
        <ChevronUp size={18} aria-hidden="true" />
        <span className="sgx-mono">{item.voteCount}</span>
      </button>
      <div className="sgx-body">
        {editing ? (
          <SuggestionForm
            heading="Editar sugerencia"
            categories={categories}
            initial={{ title: item.title, category: item.category, description: item.description }}
            submitLabel="Guardar"
            compact
            onCancel={() => { onCancelEdit(); requestAnimationFrame(() => editRef.current?.focus()); }}
            onSave={async draft => {
              const before = { title: item.title, category: item.category, description: item.description };
              const response = await updateSuggestion(item.id, draft);
              onSaved(response.item, before);
              requestAnimationFrame(() => editRef.current?.focus());
            }}
          />
        ) : (
          <>
            <div className="sgx-row-head">
              <h3 id={`sgx-h-${item.id}`} className="sgx-row-title">{item.title}</h3>
              <StatusText tone={STATUS_TONE[item.status]} strong className="sgx-small">{STATUS_LABEL[item.status] || item.status}</StatusText>
            </div>
            <TruncatedText className="sgx-meta">{`${item.category} · ${author} · ${formatDate(item.createdAt, DAY, '')}`}</TruncatedText>
            <p className={cx('sgx-desc', descLong && !descOpen && 'is-clamped')}>{item.description}</p>
            {descLong && (
              <button type="button" className="sgx-more" aria-expanded={descOpen} onClick={() => setDescOpen(value => !value)}>{descOpen ? 'Mostrar menos' : 'Mostrar todo'}</button>
            )}
            <div className="sgx-actions">
              <Button size="sm" variant="ghost" aria-expanded={open} onClick={onToggleOpen}>
                {open ? 'Ocultar comentarios' : 'Comentarios'} <span className="sgx-count">{item.commentCount}</span>
              </Button>
              {canManage && (
                <Button ref={statusRef} size="sm" variant="ghost" iconEnd={statusOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} aria-expanded={statusOpen} onClick={onToggleStatus}>Estado</Button>
              )}
              {item.canEdit && <Button ref={editRef} size="sm" variant="ghost" onClick={onEdit}>Editar</Button>}
              {item.canDelete && <Button ref={deleteRef} size="sm" variant="ghost" aria-expanded={asking} onClick={onAskDelete}>Eliminar</Button>}
            </div>
            <Collapse open={statusOpen && canManage} unmountOnClose>
              <div className="sgx-status-pick">
                <div className="sgx-chips" role="radiogroup" aria-label="Estado de la sugerencia">
                  {STATUSES.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      className="sgx-chip"
                      aria-checked={item.status === option.value}
                      disabled={busy}
                      onClick={() => onPickStatus(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="sgx-small sgx-muted">Al cambiarlo se avisa al autor, a quienes votaron y a quienes comentaron.</span>
              </div>
            </Collapse>
            <Collapse open={asking} unmountOnClose>
              <InlineConfirm
                danger
                busy={busy}
                message="¿Eliminar esta sugerencia y sus votos?"
                detail="Vas a poder deshacerlo."
                confirmLabel="Eliminar"
                onConfirm={onDelete}
                onCancel={() => { onCancelDelete(); deleteRef.current?.focus(); }}
              />
            </Collapse>
            <Collapse open={open} unmountOnClose>
              <Comments suggestionId={item.id} onCommented={onCommented} />
            </Collapse>
          </>
        )}
      </div>
    </article>
  );
}

/* ══ Comentarios (se cargan al abrir) ══ */

function Comments({ suggestionId, onCommented }: { suggestionId: number; onCommented: () => void }) {
  const [items, setItems] = useState<SuggestionComment[] | null>(null);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await getSuggestionComments(suggestionId);
      setItems(response.items || []);
      setError('');
    } catch (reason) {
      setError(errorText(reason, 'No se pudieron cargar los comentarios.'));
    }
  }, [suggestionId]);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    const clean = body.trim();
    if (!clean || sending) return;
    setSending(true);
    setSendError('');
    try {
      const response = await addSuggestionComment(suggestionId, clean);
      setItems(current => [...(current || []), response.item]);
      setBody('');
      onCommented();
    } catch (reason) {
      setSendError(errorText(reason, 'No se pudo publicar el comentario. Tu texto sigue acá.'));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); }
  };
  return (
    <div className="sgx-comments">
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {items === null && !error ? <SkeletonRows rows={2} /> : items && items.length ? (
        <ol className="sgx-comment-list">
          {items.map(comment => (
            <li key={comment.id} className="sgx-comment">
              <span className="sgx-avatar" aria-hidden="true">{initials(comment.authorName || comment.authorEmail)}</span>
              <div className="sgx-grow">
                <div className="sgx-comment-head">
                  <span className="sgx-strong sgx-ell">{comment.authorName || comment.authorEmail || 'Usuario'}</span>
                  <span className="sgx-small sgx-muted sgx-nowrap">{formatDate(comment.createdAt, DAY_TIME, '')}</span>
                </div>
                <p className="sgx-para">{comment.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : items ? <p className="sgx-para sgx-muted">Todavía no hay comentarios.</p> : null}
      <form className="sgx-composer" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void send(); }}>
        <Textarea label="Comentar" minRows={2} value={body} placeholder="Sumá tu opinión o un dato" onValueChange={value => { setBody(value); if (sendError) setSendError(''); }} onKeyDown={onKeyDown} error={sendError || undefined} />
        <div className="sgx-composer-foot">
          <span className="sgx-small sgx-muted sgx-grow">Ctrl Enter publica. Se avisa al autor.</span>
          <Button type="submit" size="sm" variant="secondary" loading={sending} loadingLabel="Publicando…" disabled={!body.trim()}>Publicar comentario</Button>
        </div>
      </form>
    </div>
  );
}

/* ══ Formulario (alta arriba / edición en la fila) ══ */

function SuggestionForm({ heading, initial, categories, submitLabel, compact, onSave, onCancel }: {
  heading: string;
  initial: FormDraft;
  categories: string[];
  submitLabel: string;
  compact?: boolean;
  onSave: (draft: FormDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const titleMissing = !draft.title.trim();
  const descMissing = !draft.description.trim();
  const dirty = draft.title !== initial.title || draft.category !== initial.category || draft.description !== initial.description;
  const [askDiscard, setAskDiscard] = useState(false);
  const set = (patch: Partial<FormDraft>) => setDraft(current => ({ ...current, ...patch }));
  // Categorías usadas: chips para elegir (sin datalist); se filtran por lo tipeado.
  const chips = categories.filter(item => !draft.category || categories.some(c => fold(c) === fold(draft.category)) || fold(item).startsWith(fold(draft.category)));

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setTried(true);
    if (titleMissing || descMissing) { setError('Completá título y descripción.'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave({ title: draft.title.trim(), category: draft.category.trim() || 'General', description: draft.description.trim() });
      setDraft(initial);
      setTried(false);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo guardar. Lo que escribiste sigue acá.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const cancel = () => { if (dirty && !askDiscard) { setAskDiscard(true); return; } setAskDiscard(false); setDraft(initial); setTried(false); setError(''); onCancel(); };

  return (
    <form className={cx('sgx-form', compact && 'is-compact')} onSubmit={submit} aria-label={heading} data-scanner-ignore="" noValidate>
      <span className="sgx-strong">{heading}</span>
      <Input
        label={<span className="sgx-labelrow"><span>Título</span><span className="sgx-count">{draft.title.length}/180</span></span>}
        value={draft.title}
        maxLength={180}
        autoFocus
        placeholder="Qué cambiarías o agregarías"
        error={tried && titleMissing ? 'Falta el título.' : undefined}
        onValueChange={title => set({ title: title.slice(0, 180) })}
      />
      <div className="sgx-catfield">
        <Input label="Categoría" value={draft.category} placeholder="General" maxLength={80} onValueChange={value => set({ category: value })} />
        {chips.length > 0 && (
          <div className="sgx-chips" role="group" aria-label="Categorías usadas">
            <span className="sgx-small sgx-muted">Usadas</span>
            {chips.map(item => (
              <button key={item} type="button" className="sgx-chip" aria-pressed={fold(item) === fold(draft.category)} onClick={() => set({ category: item })}>{item}</button>
            ))}
          </div>
        )}
      </div>
      <Textarea
        label="Descripción"
        minRows={compact ? 3 : 4}
        value={draft.description}
        placeholder="Contá el problema que resuelve y cómo lo imaginás"
        error={tried && descMissing ? 'Falta la descripción.' : undefined}
        onValueChange={description => set({ description })}
      />
      {error && <ErrorState message={error} />}
      <Collapse open={askDiscard} unmountOnClose>
        <InlineConfirm
          danger
          message="Tenés cambios sin guardar."
          detail="Si cancelás ahora se pierden."
          confirmLabel="Descartar"
          cancelLabel="Seguir editando"
          onConfirm={cancel}
          onCancel={() => setAskDiscard(false)}
        />
      </Collapse>
      <div className="sgx-actions">
        <Button type="submit" size={compact ? 'sm' : 'md'} variant="primary" loading={saving} loadingLabel="Guardando…">{submitLabel}</Button>
        <Button size={compact ? 'sm' : 'md'} variant="ghost" disabled={saving} onClick={cancel}>Cancelar</Button>
      </div>
    </form>
  );
}

function initials(name: string) {
  return String(name || '?').split(/[\s@.]+/).filter(Boolean).map(word => word.charAt(0)).join('').slice(0, 2).toUpperCase() || '?';
}

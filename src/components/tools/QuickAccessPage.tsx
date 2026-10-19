import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Link2, Plus, Zap } from 'lucide-react';
import type { QuickLink } from '../../types';
import { createQuickLink, deleteQuickLink, fetchQuickLinks, updateQuickLink } from '../../services/operationsApi';
import { fetchToolsConfig } from '../../services/toolsApi';
import { Button, Collapse, ErrorState, Eyebrow, InlineConfirm, Input, Kbd, Skeleton, StatusLine, TruncatedText, icons, useStatusLine } from '../../ui';
import { fold } from '../../ui/util';
import { CompactEmpty } from './CompactEmpty';
import { DownloadList } from './Downloads';
import { LinkForm, LinkTile, type LinkDraft } from './QuickAccess';
import { QUICK_LINKS_CHANGED, groupLinks } from './quickLinks';
import { apiSend } from '../../services/apiClient';
import '../../styles/screens/quickaccess.css';
import { getActiveSiteCode } from '../../services/activeSite';
import { peekDraft, useKeepDraft } from '../../utils/drafts';

const notifyQuickLinksChanged = () => window.dispatchEvent(new Event(QUICK_LINKS_CHANGED));
const restoreQuickLink = (id: number) => apiSend<{ ok: true; item: QuickLink }>(`/api/quick-links/${id}/restore`, 'POST', {});
const reorderQuickLinks = (ids: number[]) => apiSend<{ ok: true; changed: number }>('/api/quick-links/reorder', 'POST', { ids });

const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);
const EMPTY_DRAFT: LinkDraft = { titulo: '', url: '', descripcion: '', categoria: 'Institucionales' };

/**
 * Accesos rápidos (etapa 8c). Grupos por categoría en una grilla que usa todo
 * el ancho (títulos completos, hasta 2 renglones). Alta y edición en línea
 * (Enter guarda, Esc cancela, valida http(s) y sugiere "https://…"), borrar
 * con confirmación en línea + Deshacer donde estaba la tarjeta, Ordenar por
 * grupo (Subir/Bajar, nuevo), ícono por dominio, Handing y las descargas .bat
 * (también están en Herramientas). Cada cambio avisa al rayo y a Ctrl K.
 */
export function QuickAccessPage({ operator, consultationMode, canEdit = true }: { operator: string; consultationMode: boolean; canEdit?: boolean }) {
  const [links, setLinks] = useState<QuickLink[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [handingUrl, setHandingUrl] = useState('');
  const [query, setQuery] = useState('');
  // Un alta o una edición a medio tipear sobrevive a salir por el menú: vuelve abierta con lo escrito.
  const [site] = useState(() => getActiveSiteCode() || 'sede');
  const uiKey = `${site}:accesos`;
  const newKey = `${site}:accesos:nuevo`;
  const editKey = (id: number) => `${site}:accesos:editar:${id}`;
  const [savedUi] = useState(() => peekDraft<{ creating: LinkDraft | null; editingId: number | null }>(uiKey));
  const [creating, setCreating] = useState<LinkDraft | null>(() => (savedUi?.creating && peekDraft(newKey) ? savedUi.creating : null));
  const [newOpen, setNewOpen] = useState(() => Boolean(savedUi?.creating && peekDraft(newKey)));
  const [editingId, setEditingId] = useState<number | null>(() => (savedUi?.editingId != null && peekDraft(editKey(savedUi.editingId)) ? savedUi.editingId : null));
  useKeepDraft(uiKey, { creating: newOpen ? creating : null, editingId }, newOpen || editingId !== null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [ghosts, setGhosts] = useState<Record<number, QuickLink>>({});
  const [ghostClosing, setGhostClosing] = useState<Record<number, boolean>>({});
  const [sortingGroup, setSortingGroup] = useState<string | null>(null);
  const status = useStatusLine();
  const newBtnRef = useRef<HTMLButtonElement | null>(null);
  const moveRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingFocus = useRef<string | null>(null);

  const editable = canEdit && !consultationMode;

  const load = useCallback(async () => {
    try {
      const response = await fetchQuickLinks();
      setLinks(response.items || []);
      setLoadError('');
    } catch (reason) {
      setLoadError(errorText(reason, 'No se pudieron cargar los accesos rápidos.'));
    }
  }, []);

  useEffect(() => {
    void load();
    fetchToolsConfig().then(config => setHandingUrl(config.handingTicketUrl || '')).catch(() => {});
  }, [load]);

  // Foco al botón Subir/Bajar del acceso que se movió (el nodo cambia de lugar).
  useEffect(() => {
    if (!pendingFocus.current) return;
    const node = moveRefs.current.get(pendingFocus.current);
    pendingFocus.current = null;
    if (node && !node.disabled) node.focus({ preventScroll: true });
  });

  const changed = () => notifyQuickLinksChanged();

  const all = useMemo(() => {
    const live = links || [];
    const extra = Object.values(ghosts).filter(ghost => !live.some(link => link.id === ghost.id));
    return [...live, ...extra];
  }, [links, ghosts]);

  const categories = useMemo(() => {
    const set = new Set<string>(['Institucionales', 'Personalizados']);
    (links || []).forEach(link => { if (link.categoria?.trim()) set.add(link.categoria.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [links]);

  const q = fold(query);
  const visible = useMemo(() => (q ? all.filter(link => fold(`${link.titulo} ${link.descripcion || ''} ${link.url} ${link.categoria || ''}`).includes(q)) : all), [all, q]);
  const groups = useMemo(() => groupLinks(visible), [visible]);
  const liveCount = (links || []).length;
  const handingAdded = Boolean(handingUrl) && (links || []).some(link => link.url.replace(/\/+$/, '') === handingUrl.replace(/\/+$/, ''));

  const openNew = (draft: LinkDraft = EMPTY_DRAFT) => {
    setCreating(draft);
    setNewOpen(true);
  };
  const closeNew = () => { setNewOpen(false); newBtnRef.current?.focus({ preventScroll: true }); };

  const create = async (draft: LinkDraft) => {
    await createQuickLink({ ...draft, operator });
    setNewOpen(false);
    status.show({ tone: 'ok', message: `Guardaste “${draft.titulo}” en ${draft.categoria}.` });
    await load();
    changed();
  };

  const save = async (link: QuickLink, draft: LinkDraft) => {
    await updateQuickLink(link.id, { ...draft, operator });
    setEditingId(null);
    status.show({ tone: 'ok', message: `Guardaste los cambios de “${draft.titulo}”.` });
    await load();
    changed();
  };

  const remove = async (link: QuickLink) => {
    if (deletingId) return;
    setDeletingId(link.id);
    try {
      await deleteQuickLink(link.id, operator);
      setGhosts(current => ({ ...current, [link.id]: link }));
      setConfirmId(null);
      setLinks(current => (current || []).filter(item => item.id !== link.id));
      changed();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, `No se pudo borrar “${link.titulo}”.`), retry: { onRetry: () => remove(link) } });
    } finally {
      setDeletingId(null);
    }
  };

  const dropGhost = (id: number) => {
    setGhostClosing(current => ({ ...current, [id]: true }));
  };
  const forgetGhost = (id: number) => {
    setGhosts(current => { const next = { ...current }; delete next[id]; return next; });
    setGhostClosing(current => { const next = { ...current }; delete next[id]; return next; });
  };

  const undo = async (link: QuickLink) => {
    try {
      await restoreQuickLink(link.id);
      await load();
      forgetGhost(link.id);
      status.show({ tone: 'ok', message: `“${link.titulo}” volvió a la lista.` });
      changed();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, `No se pudo deshacer el borrado de “${link.titulo}”.`) });
    }
  };

  const move = async (group: QuickLink[], index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= group.length) return;
    const ordered = [...group];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const ids = ordered.map(link => link.id);
    const before = links;
    pendingFocus.current = `${ordered[target].id}:${dir}`;
    setLinks(current => (current || []).map(link => {
      const position = ids.indexOf(link.id);
      return position >= 0 ? { ...link, orden: position + 1 } : link;
    }));
    try {
      await reorderQuickLinks(ids);
      changed();
    } catch (reason) {
      setLinks(before);
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo guardar el orden.') });
    }
  };

  return (
    <section className="qa-page" aria-label="Accesos rápidos">
      <header className="qa-head">
        <div className="qa-head-text">
          <Eyebrow>Recursos</Eyebrow>
          <h1 className="qa-h1">Accesos rápidos</h1>
        </div>
        <div className="qa-tools">
          <Input
            className="qa-filter"
            type="search"
            aria-label="Filtrar accesos"
            placeholder="Filtrar por nombre, descripción o link"
            prefix={<icons.IconSearch size={14} />}
            value={query}
            onValueChange={value => { setQuery(value); if (value) setSortingGroup(null); }}
            onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }}
            data-scanner-ignore=""
          />
          {links && <span className="qa-count g-num">{q ? `${visible.length} de ${liveCount}` : `${liveCount} ${liveCount === 1 ? 'acceso' : 'accesos'}`}</span>}
          {editable && (
            <Button ref={newBtnRef} variant="primary" icon={<Plus size={16} strokeWidth={1.8} />} aria-expanded={newOpen} onClick={() => (newOpen ? closeNew() : openNew())}>
              Nuevo acceso
            </Button>
          )}
        </div>
      </header>

      {consultationMode && (
        <p className="qa-note" role="status"><icons.IconLock size={14} /><span>Modo consulta: podés abrir los accesos y bajar los scripts. Agregar, editar, ordenar y borrar quedan deshabilitados.</span></p>
      )}
      {!consultationMode && !canEdit && (
        <p className="qa-note" role="status"><icons.IconLock size={14} /><span>Tu rol puede ver los accesos pero no editarlos.</span></p>
      )}

      <p className="qa-hint">
        <Zap size={14} strokeWidth={1.6} aria-hidden="true" className="qa-inline-icon" /> Desde cualquier pantalla: el rayo de la barra superior los abre en una franja, y con <Kbd>Ctrl K</Kbd> los buscás por nombre.
      </p>

      {status.element}

      {editable && (
        <Collapse unmountOnClose open={newOpen} gap="var(--g-s-4)" returnFocus={newBtnRef} role="region" aria-label="Nuevo acceso">
          {creating && (
            <div className="qa-card qa-new">
              <LinkForm key={`${creating.url}|${creating.titulo}`} initial={creating} categories={categories} title="Nuevo acceso" submitLabel="Guardar acceso" onSubmit={create} onCancel={closeNew} draftKey={newKey} />
            </div>
          )}
        </Collapse>
      )}

      {links === null && !loadError && (
        <div className="qa-card qa-skel" aria-hidden="true">
          <Skeleton width="9rem" height="0.875rem" />
          <div className="qa-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="qa-skel-tile" key={index}><Skeleton width="2rem" height="2rem" radius="sm" index={index} /><span className="qa-skel-lines"><Skeleton width="70%" height="0.75rem" index={index} /><Skeleton width="45%" height="0.625rem" index={index} /></span></div>
            ))}
          </div>
        </div>
      )}

      {loadError && (
        <ErrorState
          message={links ? `${loadError} Mostramos lo último que se cargó.` : loadError}
          retrying={retrying}
          onRetry={async () => { setRetrying(true); await load(); setRetrying(false); }}
        />
      )}

      {links && liveCount === 0 && !Object.keys(ghosts).length && (
        <CompactEmpty
          className="qa-card"
          icon={<Link2 size={18} strokeWidth={1.6} />}
          title="Todavía no hay accesos cargados"
          description="Sumá los links que usa el equipo todos los días: aparecen acá, en el rayo de la barra superior y en Ctrl K."
          action={editable ? <Button variant="secondary" icon={<Plus size={16} />} onClick={() => openNew()}>Nuevo acceso</Button> : undefined}
        />
      )}

      {links && q && visible.length === 0 && (
        <CompactEmpty
          className="qa-card"
          icon={<icons.IconSearch size={18} />}
          title={`Ningún acceso coincide con “${query}”`}
          description="Probá con otra palabra o parte del link."
          action={<Button variant="secondary" onClick={() => setQuery('')}>Limpiar filtro</Button>}
        />
      )}

      {groups.map(([categoria, rows]) => {
        const liveRows = rows.filter(link => !ghosts[link.id]);
        const sorting = sortingGroup === categoria;
        return (
          <section className="qa-card qa-group" key={categoria} aria-label={categoria}>
            <div className="qa-group-head">
              <h2 className="qa-group-title">{categoria}</h2>
              <span className="qa-group-n g-num">{liveRows.length}</span>
              {categoria === 'Institucionales' && <span className="qa-group-note">Links de la sede para todo el equipo</span>}
              <span className="qa-spacer" />
              {editable && !q && liveRows.length > 1 && (
                <Button size="sm" variant={sorting ? 'secondary' : 'ghost'} icon={sorting ? <icons.IconCheck size={14} /> : <ArrowDownUp size={14} strokeWidth={1.6} />} aria-pressed={sorting} onClick={() => { setSortingGroup(sorting ? null : categoria); setEditingId(null); setConfirmId(null); }}>
                  {sorting ? 'Listo' : 'Ordenar'}
                </Button>
              )}
            </div>
            {sorting && <p className="qa-sort-hint">Usá Subir y Bajar: el orden se guarda al toque y se ve igual en el rayo y en Ctrl K.</p>}
            <ul className="qa-grid">
              {rows.map(link => {
                const ghost = ghosts[link.id];
                const index = liveRows.findIndex(item => item.id === link.id);
                if (ghost) {
                  return (
                    <li key={link.id} className="qa-cell">
                      <Collapse unmountOnClose open={!ghostClosing[link.id]} onSettled={open => { if (!open) forgetGhost(link.id); }} reveal={false}>
                        <StatusLine
                          tone="info"
                          className="qa-ghost"
                          message={<>Borraste “{ghost.titulo}”.</>}
                          undo={{ onUndo: () => undo(ghost), seconds: 8 }}
                          onDismiss={() => dropGhost(link.id)}
                        />
                      </Collapse>
                    </li>
                  );
                }
                return (
                  <li key={link.id} className={`qa-cell${editingId === link.id || confirmId === link.id ? ' is-active' : ''}`}>
                    <LinkTile
                      link={link}
                      editable={editable}
                      sorting={sorting}
                      isFirst={index === 0}
                      isLast={index === liveRows.length - 1}
                      editing={editingId === link.id}
                      confirming={confirmId === link.id}
                      onEdit={() => { setConfirmId(null); setEditingId(current => (current === link.id ? null : link.id)); }}
                      onDelete={() => { setEditingId(null); setConfirmId(current => (current === link.id ? null : link.id)); }}
                      onMove={dir => void move(liveRows, index, dir)}
                      registerMove={(dir, node) => { moveRefs.current.set(`${link.id}:${dir}`, node); }}
                    />
                    <Collapse unmountOnClose open={editingId === link.id} role="region" aria-label={`Editar ${link.titulo}`}>
                      <div className="qa-inline">
                        <LinkForm
                          draftKey={editKey(link.id)}
                          initial={{ titulo: link.titulo, url: link.url, descripcion: link.descripcion || '', categoria: link.categoria || '' }}
                          categories={categories}
                          submitLabel="Guardar cambios"
                          onSubmit={draft => save(link, draft)}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    </Collapse>
                    <Collapse unmountOnClose open={confirmId === link.id}>
                      <div className="qa-inline">
                        <InlineConfirm
                          danger
                          message={`¿Borrar “${link.titulo}”?`}
                          detail="Deja de verse para toda la sede. Vas a poder deshacerlo."
                          confirmLabel="Borrar"
                          busy={deletingId === link.id}
                          onConfirm={() => void remove(link)}
                          onCancel={() => setConfirmId(null)}
                        />
                      </div>
                    </Collapse>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="qa-extras">
        {handingUrl && (
          <section className="qa-card qa-extra" aria-labelledby="qa-handing">
            <h2 id="qa-handing" className="qa-extra-title">Handing está configurado</h2>
            <p className="qa-extra-text">La sede tiene un formulario de mantenimiento en Handing. {handingAdded ? 'Ya está en tus accesos.' : 'Si lo querés acá, agregalo como acceso.'}</p>
            <TruncatedText className="qa-mono qa-extra-url" lines={2}>{handingUrl}</TruncatedText>
            {editable && !handingAdded && (
              <div><Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => openNew({ titulo: 'Handing (mantenimiento)', url: handingUrl, descripcion: 'Pedido de mantenimiento edilicio', categoria: 'Institucionales' })}>Agregar como acceso</Button></div>
            )}
          </section>
        )}
        <section className="qa-card qa-extra qa-extra--dl" aria-labelledby="qa-dl">
          <div className="qa-extra-pad">
            <h2 id="qa-dl" className="qa-extra-title">Scripts .bat</h2>
            <p className="qa-extra-text">Se descargan a la compu y se ejecutan ahí. También están en Herramientas › Descargas.</p>
          </div>
          <DownloadList compact />
        </section>
      </div>
    </section>
  );
}

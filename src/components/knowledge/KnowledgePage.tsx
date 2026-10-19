import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileQuestion } from 'lucide-react';
import type { KnowledgeArticle } from '../../types';
import {
  createKnowledgeArticle, deleteKnowledgeArticle, getKnowledgeArticle, getKnowledgeArticles, restoreKnowledgeArticle, updateKnowledgeArticle,
  type KnowledgeCategoryCount
} from '../../services/knowledgeApi';
import { getActiveSiteCode } from '../../services/activeSite';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { Button, Collapse, InlineConfirm, Skeleton, SkeletonText, cx, icons, useStatusLine } from '../../ui';
import { appScroller } from '../../utils/scroll';
import { KnowledgeList } from './KnowledgeList';
import { KnowledgeReader } from './KnowledgeReader';
import { KnowledgeEditor } from './KnowledgeEditor';
import { KbEmpty } from './KbEmpty';
import {
  ago, categoryOf, clearDraft, draftFromArticle, errorText, isEditing, readDraft, readRoute, routeUrl, sameRoute,
  type KbDraft, type KbRoute
} from './knowledgeModel';
import '../../styles/screens/knowledge.css';

const PAGE = 30;
/** Debajo de este ancho (de la pantalla, no de la ventana) lista y lector son vistas propias con Volver. */
const NARROW = 860;

type ListState = { items: KnowledgeArticle[]; total: number; nextCursor: string; loading: boolean; loadingMore: boolean; error: string };
type EditorSeed = { key: number; draft: KbDraft; startDirty: boolean };

let seedCounter = 0;

export function KnowledgePage({ consultationMode }: { consultationMode: boolean }) {
  const site = getActiveSiteCode();
  const rootRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1000);
  const [sticky, setSticky] = useState(false);
  const [route, setRoute] = useState<KbRoute>(() => readRoute());
  const routeRef = useRef(route);
  routeRef.current = route;

  // Lista (server: búsqueda sin tildes, categoría, cursor)
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [list, setList] = useState<ListState>({ items: [], total: 0, nextCursor: '', loading: true, loadingMore: false, error: '' });
  const [facets, setFacets] = useState<KnowledgeCategoryCount[]>([]);
  const request = useRef(0);

  // Artículos pedidos sueltos (deep link a uno que no está en la página cargada).
  const [extra, setExtra] = useState<Record<number, KnowledgeArticle | 'missing' | 'loading'>>({});

  // Edición
  const [seed, setSeed] = useState<EditorSeed | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [pending, setPending] = useState<{ run: () => void; label: string } | null>(null);
  const [stored, setStored] = useState<KbDraft | null>(() => readDraft(site));

  const listStatus = useStatusLine();
  const mainStatus = useStatusLine();

  /* ── Ancho: dos columnas o vistas propias ─────────────────────────────── */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const measure = () => setNarrow(root.clientWidth < NARROW);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // El lector acompaña al scroll de la lista si entra entero en la vista
  // (así no queda un hueco al lado de una lista larga).
  useLayoutEffect(() => {
    const main = mainRef.current;
    const scroller = appScroller();
    if (!main || !scroller || narrow || typeof ResizeObserver === 'undefined') { setSticky(false); return; }
    const measure = () => setSticky(main.offsetHeight + 32 < scroller.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [narrow]);

  /* ── Datos ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const load = useCallback(async (append = false) => {
    const id = ++request.current;
    setList(current => ({ ...current, loading: !append, loadingMore: append, error: '' }));
    try {
      const page = await getKnowledgeArticles({ q: query, category, cursor: append ? list.nextCursor : '', limit: PAGE });
      if (id !== request.current) return;
      if (page.categories) setFacets(page.categories);
      setList(current => ({
        items: append ? [...current.items, ...page.items.filter(item => !current.items.some(old => old.id === item.id))] : page.items,
        total: page.total,
        nextCursor: page.nextCursor,
        loading: false,
        loadingMore: false,
        error: ''
      }));
    } catch (reason) {
      if (id !== request.current) return;
      setList(current => ({ ...current, loading: false, loadingMore: false, error: errorText(reason) }));
    }
  }, [query, category, list.nextCursor]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { void loadRef.current(false); }, [query, category]);
  const reload = useCallback(() => loadRef.current(false), []);

  const byId = useCallback((id: number): KnowledgeArticle | null => {
    const fromList = list.items.find(item => item.id === id);
    if (fromList) return fromList;
    const loaded = extra[id];
    return loaded && typeof loaded === 'object' ? loaded : null;
  }, [list.items, extra]);

  const routeId = 'id' in route ? route.id : null;
  useEffect(() => {
    if (routeId === null || byId(routeId) || extra[routeId] || list.loading) return;
    setExtra(current => ({ ...current, [routeId]: 'loading' }));
    getKnowledgeArticle(routeId)
      .then(response => setExtra(current => ({ ...current, [routeId]: response.item })))
      .catch(() => setExtra(current => ({ ...current, [routeId]: 'missing' })));
  }, [routeId, byId, extra, list.loading]);

  const shownId = routeId ?? (!narrow && route.kind === 'list' ? list.items[0]?.id ?? null : null);
  const shown = shownId !== null ? byId(shownId) : null;
  const shownState = shownId !== null && !shown ? extra[shownId] : undefined;

  useAssistantContext(
    shown && (route.kind === 'read' || route.kind === 'list')
      ? { type: 'knowledge', id: String(shown.id), label: shown.title, data: { category: categoryOf(shown), tags: shown.tags } }
      : null
  );

  /* ── Navegación (URL por artículo, Atrás del navegador) ──────────────── */
  const apply = useCallback((next: KbRoute, mode: 'push' | 'replace' | 'none' = 'push') => {
    const url = routeUrl(next);
    if (mode === 'push' && url !== window.location.pathname) window.history.pushState({ techasset: true, kb: true }, '', url);
    else if (mode === 'replace') window.history.replaceState({ techasset: true, kb: true }, '', url);
    const prev = routeRef.current;
    if (isEditing(prev) && !sameRoute(prev, next)) {
      setSeed(null);
      setDirty(false);
      dirtyRef.current = false;
    }
    setPending(null);
    routeRef.current = next;
    setRoute(next);
    if (narrow && (prev.kind === 'list') !== (next.kind === 'list')) appScroller()?.scrollTo({ top: 0 });
  }, [narrow]);

  /** Navegar pidiendo confirmación si hay cambios sin guardar en el editor. */
  const go = useCallback((next: KbRoute, mode: 'push' | 'replace' = 'push', after?: () => void) => {
    const current = routeRef.current;
    if (dirtyRef.current && isEditing(current) && !sameRoute(current, next)) {
      setPending({ run: () => { clearDraft(site); setStored(null); apply(next, mode); after?.(); }, label: next.kind === 'list' ? 'volver a la lista' : 'salir del editor' });
      return;
    }
    if (isEditing(current) && !sameRoute(current, next)) { clearDraft(site); setStored(null); }
    apply(next, mode);
    after?.();
  }, [apply, site]);

  useEffect(() => {
    const onPop = () => {
      if (!/\/knowledge(\/|$)/i.test(window.location.pathname)) return; // otra vista: la maneja App
      const next = readRoute();
      const current = routeRef.current;
      if (dirtyRef.current && isEditing(current) && !sameRoute(current, next)) {
        // No se puede cancelar un Atrás: se vuelve a poner la URL del editor y se pregunta.
        window.history.pushState({ techasset: true, kb: true }, '', routeUrl(current));
        setPending({ run: () => { clearDraft(site); setStored(null); apply(next, 'replace'); }, label: 'salir del editor' });
        return;
      }
      apply(next, 'none');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [apply, site]);

  // Cerrar o recargar la pestaña con cambios sin guardar: aviso del navegador
  // (el borrador además queda guardado y se ofrece al volver).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Llevar el lector a la vista si quedó arriba (lista larga scrolleada).
  const revealMain = () => {
    window.requestAnimationFrame(() => {
      const main = mainRef.current;
      const scroller = appScroller();
      if (!main || !scroller || narrow) return;
      if (main.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        main.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      }
    });
  };

  const openArticle = (id: number) => {
    mainStatus.clear();
    go({ kind: 'read', id });
    if (!sticky) revealMain();
  };

  /* ── Editor ───────────────────────────────────────────────────────────── */
  const startEdit = (target: KbRoute & { kind: 'edit' | 'new' }, draft?: KbDraft, startDirty = false) => {
    const article = target.kind === 'edit' ? byId(target.id) : null;
    mainStatus.clear();
    go(target, 'push', () => {
      setSeed({ key: ++seedCounter, draft: draft || draftFromArticle(article), startDirty });
      setDirty(startDirty);
      if (!sticky) revealMain();
    });
  };

  // Deep link a /nuevo o /<id>/editar: se arma el editor cuando está el artículo.
  useEffect(() => {
    if (seed || consultationMode) return;
    if (route.kind === 'new') setSeed({ key: ++seedCounter, draft: draftFromArticle(null), startDirty: false });
    else if (route.kind === 'edit') {
      const article = byId(route.id);
      if (article) setSeed({ key: ++seedCounter, draft: draftFromArticle(article), startDirty: false });
    }
  }, [route, seed, byId, consultationMode]);

  // En modo consulta no hay editor: /editar y /nuevo caen al lector o a la lista.
  useEffect(() => {
    if (!consultationMode) return;
    if (route.kind === 'edit') apply({ kind: 'read', id: route.id }, 'replace');
    else if (route.kind === 'new') apply({ kind: 'list' }, 'replace');
  }, [consultationMode, route, apply]);

  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);

  const save = async (draft: KbDraft) => {
    const payload = { title: draft.title, content: draft.html, category: draft.category, tags: draft.tags, attachments: draft.attachments };
    const response = draft.id ? await updateKnowledgeArticle(draft.id, payload) : await createKnowledgeArticle(payload);
    const item = response.item;
    clearDraft(site);
    setStored(null);
    setDirty(false);
    dirtyRef.current = false;
    setExtra(current => ({ ...current, [item.id]: item }));
    setList(current => ({
      ...current,
      items: [item, ...current.items.filter(old => old.id !== item.id)],
      total: draft.id ? current.total : current.total + 1
    }));
    apply({ kind: 'read', id: item.id }, draft.id ? 'replace' : 'replace');
    mainStatus.show({ tone: 'ok', message: draft.id ? 'Guardaste los cambios. El Asistente ya usa esta versión.' : 'Artículo creado. El Asistente ya lo puede consultar.' });
    void reload();
  };

  const remove = async (article: KnowledgeArticle) => {
    await deleteKnowledgeArticle(article.id);
    const index = list.items.findIndex(item => item.id === article.id);
    const rest = list.items.filter(item => item.id !== article.id);
    setList(current => ({ ...current, items: rest, total: Math.max(0, current.total - 1) }));
    setFacets(current => current.map(item => (item.name === categoryOf(article) ? { ...item, count: Math.max(0, item.count - 1) } : item)).filter(item => item.count > 0));
    setExtra(current => { const next = { ...current }; delete next[article.id]; return next; });
    const neighbour = rest[Math.min(Math.max(index, 0), rest.length - 1)];
    apply(narrow || !neighbour ? { kind: 'list' } : { kind: 'read', id: neighbour.id }, 'replace');
    listStatus.show({
      tone: 'ok',
      message: <>Eliminaste <b>«{article.title}»</b>.</>,
      undo: {
        onUndo: async () => {
          try {
            const restored = await restoreKnowledgeArticle(article.id);
            setExtra(current => ({ ...current, [article.id]: restored.item }));
            listStatus.show({ tone: 'ok', message: <>Volvió <b>«{article.title}»</b> a la base.</> });
            await reload();
            apply({ kind: 'read', id: article.id }, 'push');
          } catch (reason) {
            listStatus.show({ tone: 'bad', message: `No se pudo deshacer: ${errorText(reason)}`, retry: { onRetry: () => restoreKnowledgeArticle(article.id).then(reload) } });
          }
        }
      }
    });
  };

  /* ── Borrador recuperable ────────────────────────────────────────────── */
  const draftOpen = Boolean(seed);
  const showStored = stored && !draftOpen && !consultationMode;
  const resumeDraft = () => {
    if (!stored) return;
    const target: KbRoute & { kind: 'edit' | 'new' } = stored.id ? { kind: 'edit', id: stored.id } : { kind: 'new' };
    startEdit(target, stored, true);
  };
  const discardStored = () => { clearDraft(site); setStored(null); };

  const back = () => {
    if (window.history.state?.kb && routeRef.current.kind === 'read') window.history.back();
    else go({ kind: 'list' }, 'replace');
  };

  const categories = useMemo(
    () => [...facets].sort((a, b) => (a.name === 'General' ? -1 : b.name === 'General' ? 1 : a.name.localeCompare(b.name, 'es'))),
    [facets]
  );
  const tagSuggestions = useMemo(() => Array.from(new Set(list.items.flatMap(item => item.tags))).sort(), [list.items]);

  // Se abre suave debajo del encabezado del editor (y te lleva hasta él si quedó arriba).
  const leaveConfirm = (
    <Collapse open={Boolean(pending)} gap="var(--g-s-4)">
      {pending && (
        <div className="kb-leave">
          <InlineConfirm
            danger
            message="Tenés cambios sin guardar."
            detail={`Si querés ${pending.label}, se descartan. También podés seguir editando y guardar.`}
            confirmLabel="Descartar cambios"
            cancelLabel="Seguir editando"
            onConfirm={pending.run}
            onCancel={() => setPending(null)}
          />
        </div>
      )}
    </Collapse>
  );

  const showList = !narrow || route.kind === 'list';
  const showMain = !narrow || route.kind !== 'list';
  const editing = isEditing(route) && !consultationMode;

  let main: React.ReactNode;
  if (editing) {
    main = seed ? (
      <KnowledgeEditor
        key={seed.key}
        draft={seed.draft}
        startDirty={seed.startDirty}
        siteCode={site}
        categories={categories.map(item => item.name)}
        tagSuggestions={tagSuggestions}
        onSave={save}
        onCancel={() => go(route.kind === 'edit' ? { kind: 'read', id: route.id } : { kind: 'list' }, 'replace')}
        onDirtyChange={onDirtyChange}
        leaveConfirm={leaveConfirm}
      />
    ) : route.kind === 'edit' && extra[route.id] === 'missing' ? (
      <KbEmpty className="kb-card" icon={<FileQuestion size={20} />} title="Ese artículo no existe o se eliminó." action={<Button size="sm" onClick={() => go({ kind: 'list' }, 'replace')}>Ir a la lista</Button>} />
    ) : (
      <ReaderSkeleton />
    );
  } else if (shown) {
    main = (
      <KnowledgeReader
        key={shown.id}
        article={shown}
        consultationMode={consultationMode}
        onEdit={() => startEdit({ kind: 'edit', id: shown.id })}
        onDelete={() => remove(shown)}
        onTag={tag => { setCategory(''); setQ(tag); if (narrow) go({ kind: 'list' }); }}
      />
    );
  } else if (shownState === 'missing') {
    main = <KbEmpty className="kb-card" icon={<FileQuestion size={20} />} title="Ese artículo no existe o se eliminó." description="Puede que alguien lo haya borrado." action={<Button size="sm" onClick={() => go({ kind: 'list' }, 'replace')}>Ir a la lista</Button>} />;
  } else if (shownId !== null || list.loading) {
    main = <ReaderSkeleton />;
  } else if (!list.items.length && (query || category)) {
    main = (
      <KbEmpty
        className="kb-card"
        icon={<BookOpen size={20} />}
        title="Nada para leer con este filtro"
        description="Probá otra búsqueda o limpiá los filtros de la lista."
        action={<Button size="sm" onClick={() => { setQ(''); setCategory(''); }}>Limpiar filtros</Button>}
      />
    );
  } else {
    main = (
      <KbEmpty
        className="kb-card"
        icon={<BookOpen size={20} />}
        title={list.items.length ? 'Elegí un artículo de la lista' : 'La base todavía está vacía'}
        description="Escribí los procedimientos propios de la sede (WiFi, proyectores, altas de equipos). El Asistente los lee antes de responder."
        action={!consultationMode ? <Button size="sm" variant="primary" icon={<icons.IconPlus size={14} />} onClick={() => startEdit({ kind: 'new' })}>Nuevo artículo</Button> : undefined}
      />
    );
  }

  return (
    <section ref={rootRef} className={cx('kb-page', narrow && 'is-narrow')} aria-label="Base de conocimiento">
      {showStored && (
        <div className="kb-draftnote" role="status">
          <span className="kb-draftnote-text">
            Tenés un borrador sin guardar{stored?.title ? <> de <b>«{stored.title}»</b></> : null} · {ago(stored!.savedAt)}.
          </span>
          <span className="kb-draftnote-actions">
            <Button size="sm" variant="primary" onClick={resumeDraft}>Seguir editando</Button>
            <Button size="sm" variant="ghost" onClick={discardStored}>Descartar</Button>
          </span>
        </div>
      )}

      {showList && (
        <KnowledgeList
          items={list.items}
          total={list.total}
          loading={list.loading}
          error={list.error}
          onRetry={() => void reload()}
          hasMore={Boolean(list.nextCursor)}
          loadingMore={list.loadingMore}
          onMore={() => void load(true)}
          q={q}
          onQ={setQ}
          category={category}
          categories={categories}
          onCategory={setCategory}
          selectedId={shownId}
          onOpen={openArticle}
          onNew={() => startEdit({ kind: 'new' })}
          consultationMode={consultationMode}
          status={listStatus.element}
        />
      )}

      {showMain && (
        <div ref={mainRef} className={cx('kb-main', sticky && 'is-sticky')}>
          {narrow && (
            <div className="kb-back">
              <Button variant="ghost" size="sm" icon={<icons.IconChevronLeft size={16} />} onClick={back}>Volver a la lista</Button>
            </div>
          )}
          {mainStatus.element}
          {main}
        </div>
      )}
    </section>
  );
}

function ReaderSkeleton() {
  return (
    <div className="kb-card kb-reader" aria-busy="true" aria-label="Cargando artículo">
      <Skeleton width="30%" height="0.75rem" />
      <Skeleton width="70%" height="1.5rem" />
      <SkeletonText lines={5} />
    </div>
  );
}

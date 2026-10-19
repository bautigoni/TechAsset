import type { ReactNode } from 'react';
import { BookOpen, Paperclip, Search, SearchX } from 'lucide-react';
import type { KnowledgeArticle } from '../../types';
import { Button, ErrorState, IconButton, Input, SkeletonText, TruncatedText, cx, icons } from '../../ui';
import { articleDate, categoryOf, excerpt, routeUrl } from './knowledgeModel';

const hrefFor = (id: number) => routeUrl({ kind: 'read', id });
import { KbEmpty } from './KbEmpty';

export type KbCategoryChip = { name: string; count: number };

export function KnowledgeList({
  items, total, loading, error, onRetry, hasMore, loadingMore, onMore,
  q, onQ, category, categories, onCategory, selectedId, onOpen, onNew, consultationMode, status, hidden
}: {
  items: KnowledgeArticle[];
  total: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  q: string;
  onQ: (value: string) => void;
  category: string;
  categories: KbCategoryChip[];
  onCategory: (value: string) => void;
  selectedId: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  consultationMode: boolean;
  status: ReactNode;
  hidden?: boolean;
}) {
  const all = categories.reduce((sum, item) => sum + item.count, 0);
  const chips = [{ name: '', label: 'Todas', count: all }, ...categories.map(item => ({ name: item.name, label: item.name, count: item.count }))];
  if (category && !categories.some(item => item.name === category)) chips.push({ name: category, label: category, count: 0 });
  const filtering = Boolean(q.trim() || category);

  return (
    <section className="kb-list" aria-label="Artículos" hidden={hidden}>
      <div className="kb-list-head">
        <h2 className="kb-list-title">Artículos</h2>
        <span className="kb-count g-num" aria-label={q.trim() ? `${all} artículos coinciden con la búsqueda` : `${all} artículos en la base`}>{loading && !categories.length ? '' : all}</span>
        <span className="kb-spacer" />
        {consultationMode ? (
          <span className="kb-readonly">Solo lectura</span>
        ) : (
          <Button variant="primary" size="sm" icon={<icons.IconPlus size={14} />} onClick={onNew}>Nuevo artículo</Button>
        )}
      </div>

      <div className="kb-filters" data-scanner-ignore="">
        <Input
          type="search"
          className="kb-search"
          aria-label="Buscar en la base de conocimiento"
          placeholder="Buscar procedimiento, equipo, WiFi, proyector…"
          value={q}
          prefix={<Search size={16} aria-hidden="true" />}
          suffix={q ? <IconButton size="sm" label="Limpiar búsqueda" icon={<icons.IconX size={14} />} onClick={() => onQ('')} /> : undefined}
          onValueChange={onQ}
          onKeyDown={event => { if (event.key === 'Escape' && q) { event.preventDefault(); onQ(''); } }}
          enterKeyHint="search"
          autoComplete="off"
        />
        {chips.length > 1 && (
          <div className="kb-cats" role="group" aria-label="Filtrar por categoría">
            {chips.map(chip => (
              <button
                key={chip.name || '*'}
                type="button"
                className={cx('kb-cat', category === chip.name && 'is-on')}
                aria-pressed={category === chip.name}
                onClick={() => onCategory(chip.name)}
              >
                <span className="kb-cat-label">{chip.label}</span>
                <span className="kb-cat-n g-num">{chip.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {status}

      {error && !items.length ? (
        <ErrorState className="kb-pad" message={`No se pudo cargar la base: ${error}`} onRetry={onRetry} />
      ) : loading && !items.length ? (
        <ul className="kb-rows" aria-busy="true" aria-label="Cargando artículos">
          {[0, 1, 2, 3, 4].map(index => (
            <li key={index} className="kb-row kb-row--skel"><SkeletonText lines={3} /></li>
          ))}
        </ul>
      ) : !items.length ? (
        filtering ? (
          <KbEmpty
            icon={<SearchX size={20} />}
            title={q.trim() ? `Ningún artículo coincide con “${q.trim()}”.` : 'No hay artículos en esta categoría.'}
            description="La búsqueda mira título, categoría, tags y texto, sin importar tildes."
            action={<Button size="sm" onClick={() => { onQ(''); onCategory(''); }}>Limpiar filtros</Button>}
          />
        ) : (
          <KbEmpty
            icon={<BookOpen size={20} />}
            title="Todavía no hay artículos"
            description={consultationMode ? 'Cuando el equipo cargue procedimientos, van a aparecer acá.' : 'Escribí el primero: el Asistente lo lee antes de responder.'}
          />
        )
      ) : (
        <ul className={cx('kb-rows', loading && 'is-refreshing')} aria-busy={loading || undefined}>
          {items.map(item => {
            const current = item.id === selectedId;
            const tags = item.tags.map(tag => `#${tag}`).join(' ');
            return (
              <li key={item.id}>
                <a
                  href={hrefFor(item.id)}
                  className={cx('kb-row', current && 'is-current')}
                  aria-current={current ? 'page' : undefined}
                  onClick={event => {
                    // Ctrl/Cmd/Shift/rueda: el navegador lo abre aparte (es un link de verdad).
                    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
                    event.preventDefault();
                    onOpen(item.id);
                  }}
                >
                  <span className="kb-row-top">
                    <TruncatedText className="kb-row-title" lines={2}>{item.title || 'Sin título'}</TruncatedText>
                    <span className="kb-row-date g-num">{articleDate(item.updatedAt)}</span>
                  </span>
                  {item.contentText && <span className="kb-row-ex">{excerpt(item.contentText, 220)}</span>}
                  <span className="kb-row-meta">
                    <span className="kb-row-cat">{categoryOf(item)}</span>
                    {tags && <span className="kb-row-tags">{tags}</span>}
                    {item.attachments.length > 0 && (
                      <span className="kb-row-att" aria-label={`${item.attachments.length} ${item.attachments.length === 1 ? 'adjunto' : 'adjuntos'}`}>
                        <Paperclip size={12} aria-hidden="true" />
                        <span className="g-num">{item.attachments.length}</span>
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="kb-list-foot">
          <span className="kb-foot-text">Mostrando <b className="g-num">{items.length}</b> de <b className="g-num">{total}</b></span>
          {hasMore && <Button variant="ghost" size="sm" loading={loadingMore} onClick={onMore}>Ver más</Button>}
        </div>
      )}
      {error && items.length > 0 && <ErrorState className="kb-pad" message={error} onRetry={onRetry} />}
    </section>
  );
}

import { Fragment, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Checkbox } from './Toggle';
import { SkeletonRows } from './Data';
import { IconChevronDown, IconChevronUp } from './icons';
import { cx } from './util';

/**
 * Tabla densa propia (grid + roles ARIA de tabla, no <table>: así ninguna
 * regla vieja de `th`/`td`/`tr:hover` la toca). Orden por columna, selección,
 * filas clickeables con Enter/Espacio y paso a filas-tarjeta con
 * @container cuando el contenedor es angosto (no depende del viewport).
 */

export type SortDir = 'asc' | 'desc';
export type SortState = { key: string; dir: SortDir } | null;

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Rótulo en modo tarjeta si `header` no es texto. */
  cardLabel?: string;
  cell: (row: T) => ReactNode;
  /** Si viene, la columna se puede ordenar. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Pista de grid (default `minmax(0, 1fr)`). Ej.: `minmax(0, 2fr)`, `6rem`, `auto`. */
  width?: string;
  align?: 'start' | 'end' | 'center';
  mono?: boolean;
  /** En tarjeta: 'title' (arriba, fuerte), 'meta' (a la derecha del título), 'row' (renglón con rótulo, default), 'hide'. */
  card?: 'title' | 'meta' | 'row' | 'hide';
  /** Clase extra en el encabezado y en cada celda de la columna (estilos de la pantalla). */
  className?: string;
};

export type TableSelection = {
  selected: Set<string>;
  /** Click en la casilla o Ctrl/Cmd/Shift+click en la fila. Recibe el evento (para rango). */
  onToggle: (key: string, event: MouseEvent) => void;
  /** Casilla del encabezado: todas las visibles / ninguna. */
  onToggleAll?: (keys: string[]) => void;
  /** Filas que no se pueden marcar (bloqueadas). */
  isDisabled?: (key: string) => boolean;
};

export type TableProps<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Nombre accesible de la tabla. */
  caption: string;
  sort?: SortState;
  defaultSort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Si el padre ya ordena (p. ej. paginado en el server), no reordenar acá. */
  manualSort?: boolean;
  onRowClick?: (row: T, event: MouseEvent | KeyboardEvent) => void;
  selection?: TableSelection;
  /** Atributos pasantes de la fila: `{ 'data-device-tag': row.etiqueta }`. */
  rowAttrs?: (row: T) => Record<`data-${string}`, string | number | undefined>;
  rowClassName?: (row: T) => string | undefined;
  /** Resalta una fila (equivalente a `row-highlight`). */
  highlightedKey?: string | null;
  /** Ficha que se abre debajo de la fila, en línea. */
  expandedKey?: string | null;
  renderExpanded?: (row: T) => ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  /** Ancho del contenedor por debajo del cual pasa a tarjetas: sm 480, md 640 (default), lg 800 px. */
  cardBelow?: 'sm' | 'md' | 'lg';
  className?: string;
};

const collator = /* @__PURE__ */ new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function compare(a: unknown, b: unknown) {
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

const INTERACTIVE = 'button, a, input, textarea, select, [role="checkbox"], [role="switch"], [role="combobox"], [contenteditable="true"]';

export function Table<T>({ rows, columns, rowKey, caption, sort: sortProp, defaultSort = null, onSortChange, manualSort, onRowClick, selection, rowAttrs, rowClassName, highlightedKey, expandedKey, renderExpanded, empty, loading, loadingRows = 4, cardBelow = 'md', className }: TableProps<T>) {
  const [innerSort, setInnerSort] = useState<SortState>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : innerSort;

  const sorted = useMemo(() => {
    if (manualSort || !sort) return rows;
    const column = columns.find(item => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(column.sortValue!(a), column.sortValue!(b)) * factor);
  }, [rows, columns, sort, manualSort]);

  const keys = useMemo(() => sorted.map(rowKey), [sorted, rowKey]);
  const selectable = selection ? keys.filter(key => !selection.isDisabled?.(key)) : [];
  const selectedVisible = selection ? selectable.filter(key => selection.selected.has(key)).length : 0;

  const setSort = (key: string) => {
    const next: SortState = !sort || sort.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null;
    if (sortProp === undefined) setInnerSort(next);
    onSortChange?.(next);
  };

  const template = [selection ? 'var(--ui-check-col)' : '', ...columns.map(column => column.width || 'minmax(0, 1fr)')].filter(Boolean).join(' ');

  const activate = (row: T, key: string, event: MouseEvent | KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && target.closest(INTERACTIVE)) return;
    if (selection && 'ctrlKey' in event && (event.ctrlKey || event.metaKey || event.shiftKey) && event.type === 'click') {
      if (!selection.isDisabled?.(key)) selection.onToggle(key, event as MouseEvent);
      return;
    }
    onRowClick?.(row, event);
  };

  return (
    <div className={cx('ui-table', `ui-table--card-${cardBelow}`, className)} style={{ ['--ui-cols' as string]: template }}>
      <div role="table" aria-label={caption} aria-rowcount={loading ? undefined : sorted.length + 1} aria-busy={loading || undefined}>
        <div role="rowgroup" className="ui-thead">
          <div role="row" className="ui-tr ui-tr--head">
            {selection && (
              <div role="columnheader" className="ui-td ui-td--check">
                <Checkbox
                  ariaLabel={selectedVisible === selectable.length && selectable.length ? 'Desmarcar todas' : 'Marcar todas'}
                  checked={selectable.length > 0 && selectedVisible === selectable.length}
                  indeterminate={selectedVisible > 0 && selectedVisible < selectable.length}
                  disabled={!selectable.length || !selection.onToggleAll}
                  onCheckedChange={() => selection.onToggleAll?.(selectable)}
                />
              </div>
            )}
            {columns.map(column => {
              const active = sort?.key === column.key ? sort.dir : null;
              return (
                <div
                  key={column.key}
                  role="columnheader"
                  aria-sort={column.sortValue ? (active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none') : undefined}
                  className={cx('ui-td', 'ui-th', column.align && `ui-td--${column.align}`, column.className)}
                >
                  {column.sortValue ? (
                    <button type="button" className={cx('ui-th-sort', active && 'is-active')} onClick={() => setSort(column.key)}>
                      <span className="ui-th-text">{column.header}</span>
                      <span className="ui-th-arrow" aria-hidden="true">{active === 'desc' ? <IconChevronDown size={12} /> : <IconChevronUp size={12} />}</span>
                    </button>
                  ) : <span className="ui-th-text">{column.header}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div role="rowgroup" className="ui-tbody">
          {loading && <div role="row" className="ui-tr ui-tr--full"><div role="cell" className="ui-td"><SkeletonRows rows={loadingRows} /></div></div>}
          {!loading && !sorted.length && empty && <div role="row" className="ui-tr ui-tr--full"><div role="cell" className="ui-td">{empty}</div></div>}
          {!loading && sorted.map((row, index) => {
            const key = keys[index];
            const isSelected = selection?.selected.has(key) || false;
            const clickable = Boolean(onRowClick);
            const expanded = expandedKey === key && renderExpanded;
            return (
              <Fragment key={key}>
                <div
                  role="row"
                  aria-selected={selection ? isSelected : undefined}
                  aria-expanded={renderExpanded ? expandedKey === key : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={cx('ui-tr', clickable && 'is-clickable', isSelected && 'is-selected', highlightedKey === key && 'is-highlighted', expanded && 'is-expanded', rowClassName?.(row))}
                  onClick={clickable || selection ? event => activate(row, key, event) : undefined}
                  onKeyDown={clickable ? event => {
                    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
                      event.preventDefault();
                      onRowClick?.(row, event);
                    }
                  } : undefined}
                  {...(rowAttrs?.(row) || {})}
                >
                  {selection && (
                    <div role="cell" className="ui-td ui-td--check">
                      <Checkbox
                        ariaLabel="Seleccionar fila"
                        checked={isSelected}
                        disabled={selection.isDisabled?.(key)}
                        onCheckedChange={(_, event) => selection.onToggle(key, event)}
                      />
                    </div>
                  )}
                  {columns.map(column => (
                    <div
                      key={column.key}
                      role="cell"
                      className={cx('ui-td', column.align && `ui-td--${column.align}`, column.mono && 'ui-mono', `ui-td--card-${column.card || 'row'}`, column.className)}
                    >
                      {(column.card || 'row') === 'row' && (
                        <span className="ui-td-label" aria-hidden="true">{column.cardLabel || (typeof column.header === 'string' ? column.header : '')}</span>
                      )}
                      <span className="ui-td-value">{column.cell(row)}</span>
                    </div>
                  ))}
                </div>
                {expanded && (
                  <div role="row" className="ui-tr ui-tr--full ui-tr--detail">
                    <div role="cell" className="ui-td ui-enter">{renderExpanded!(row)}</div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { IconChevronRight } from '../../ui/icons';
import { TruncatedText } from '../../ui/Truncated';
import type { Group } from './inventoryEntries';

export type TreeSelection = { categoria: string; subcategoria: string } | null;

// Árbol de categorías: "Todo el inventario", cada categoría con su conteo y,
// si tiene subcategorías, el caret para expandirlas.
export function InventoryTree({ groups, total, selected, onSelect, expanded, onToggle, id }: {
  groups: Group[];
  total: number;
  selected: TreeSelection;
  onSelect: (next: TreeSelection) => void;
  expanded: string[];
  onToggle: (categoria: string) => void;
  id?: string;
}) {
  return (
    <nav className="ivt-tree" aria-label="Categorías" id={id}>
      <div className="ivt-tree-row">
        <span className="ivt-tree-caret-space" aria-hidden="true" />
        <button type="button" className="ivt-tree-btn" aria-current={!selected ? 'true' : undefined} onClick={() => onSelect(null)}>
          <TruncatedText className="ivt-tree-label">Todo el inventario</TruncatedText>
          <span className="ivt-count">{total}</span>
        </button>
      </div>
      {groups.map(group => {
        const subs = group.subgroups.filter(sub => sub.subcategoria);
        const isOpen = expanded.includes(group.categoria);
        return (
          <div className="ivt-tree-group" key={group.categoria}>
            <div className="ivt-tree-row">
              {subs.length > 0 ? (
                <button
                  type="button"
                  className="ivt-tree-caret"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Contraer' : 'Expandir'} ${group.categoria}`}
                  onClick={() => onToggle(group.categoria)}
                >
                  <IconChevronRight size={14} className={isOpen ? 'is-open' : undefined} />
                </button>
              ) : <span className="ivt-tree-caret-space" aria-hidden="true" />}
              <button
                type="button"
                className="ivt-tree-btn"
                aria-current={selected?.categoria === group.categoria && !selected.subcategoria ? 'true' : undefined}
                onClick={() => onSelect({ categoria: group.categoria, subcategoria: '' })}
              >
                <TruncatedText className="ivt-tree-label">{group.categoria}</TruncatedText>
                <span className="ivt-count">{group.total}</span>
              </button>
            </div>
            {isOpen && subs.map(sub => (
              <div className="ivt-tree-row ivt-tree-sub" key={sub.subcategoria}>
                <button
                  type="button"
                  className="ivt-tree-btn"
                  aria-current={selected?.categoria === group.categoria && selected.subcategoria === sub.subcategoria ? 'true' : undefined}
                  onClick={() => onSelect({ categoria: group.categoria, subcategoria: sub.subcategoria })}
                >
                  <TruncatedText className="ivt-tree-label">{sub.subcategoria}</TruncatedText>
                  <span className="ivt-count">{sub.entries.length}</span>
                </button>
              </div>
            ))}
          </div>
        );
      })}
      {!groups.length && <p className="ivt-help ivt-tree-empty">Sin categorías para este filtro.</p>}
    </nav>
  );
}

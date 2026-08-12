import type { Group } from './inventoryEntries';

// Árbol de categorías con sus subcategorías y contadores. Es el índice del
// inventario: define qué se ve en la lista de la derecha.
export function InventoryTree({ groups, selected, onSelect, expanded, onToggle }: {
  groups: Group[];
  selected: { categoria: string; subcategoria: string } | null;
  onSelect: (value: { categoria: string; subcategoria: string } | null) => void;
  expanded: string[];
  onToggle: (categoria: string) => void;
}) {
  const total = groups.reduce((acc, group) => acc + group.total, 0);

  return (
    <nav className="inv-tree" aria-label="Categorías">
      <div className="inv-tree-head"><span>Categorías</span></div>
      <button
        type="button"
        className={`inv-tree-all ${!selected ? 'is-active' : ''}`}
        onClick={() => onSelect(null)}
      >
        <span>Todo el inventario</span>
        <em>{total}</em>
      </button>
      {groups.map(group => {
        const isOpen = expanded.includes(group.categoria);
        const subs = group.subgroups.filter(sub => sub.subcategoria);
        const catActive = selected?.categoria === group.categoria && !selected.subcategoria;
        return (
          <div className="inv-tree-group" key={group.categoria}>
            <div className={`inv-tree-cat ${catActive ? 'is-active' : ''}`}>
              {subs.length > 0 ? (
                <button type="button" className="inv-tree-caret" onClick={() => onToggle(group.categoria)} aria-expanded={isOpen} aria-label={isOpen ? 'Contraer' : 'Expandir'}>
                  <i className={isOpen ? 'is-open' : ''} />
                </button>
              ) : <span className="inv-tree-caret" />}
              <button type="button" className="inv-tree-label" onClick={() => onSelect({ categoria: group.categoria, subcategoria: '' })}>
                <span>{group.categoria}</span>
                <em>{group.total}</em>
              </button>
            </div>
            {isOpen && subs.map(sub => (
              <button
                key={sub.subcategoria}
                type="button"
                className={`inv-tree-sub ${selected?.categoria === group.categoria && selected?.subcategoria === sub.subcategoria ? 'is-active' : ''}`}
                onClick={() => onSelect({ categoria: group.categoria, subcategoria: sub.subcategoria })}
              >
                <span>{sub.subcategoria}</span>
                <em>{sub.entries.length}</em>
              </button>
            ))}
          </div>
        );
      })}
      {!groups.length && <p className="muted" style={{ padding: '8px 10px', fontSize: 12 }}>Sin categorías.</p>}
    </nav>
  );
}

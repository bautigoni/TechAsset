import type { Group } from './inventoryEntries';

// Portada del inventario: primero las categorías, el detalle recién al entrar.
// Antes se abría directo con los 56 recursos planos mezclados —una botonera y
// un robot al mismo nivel visual— y no había forma de hacerse una idea de qué
// hay en la sede sin escanear la grilla entera.
export function InventoryCategoryGrid({ groups, onOpen }: {
  groups: Group[];
  onOpen: (categoria: string) => void;
}) {
  if (!groups.length) return <div className="inventory-empty">No hay nada para este filtro.</div>;

  return (
    <div className="inv-cats">
      {groups.map(group => (
        <button key={group.categoria} type="button" className="inv-cat" onClick={() => onOpen(group.categoria)}>
          <span className="inv-cat-thumb">
            {group.portada ? <img src={group.portada} alt="" loading="lazy" /> : <i aria-hidden="true" />}
          </span>
          <span className="inv-cat-body">
            <strong>{group.categoria}</strong>
            <small>{group.total} {group.total === 1 ? 'ítem' : 'ítems'}{group.equipos && group.recursos ? ` · ${group.equipos} equipos, ${group.recursos} recursos` : ''}</small>
            <span className="inv-cat-flags">
              {group.conProblema > 0 && <em className="is-warn">{group.conProblema} con problema</em>}
              {group.aRevisar > 0 && <em>{group.aRevisar} a revisar</em>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

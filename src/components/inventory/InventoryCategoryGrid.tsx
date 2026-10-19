import { TruncatedText } from '../../ui/Truncated';
import type { Group } from './inventoryEntries';
import { Tx } from './inventoryParts';

// Portada: una tarjeta por categoría con lo que hay adentro (total, mezcla de
// equipos/recursos, con problema, a revisar) para entrar sin tener que abrir.
export function InventoryCategoryGrid({ groups, onOpen }: { groups: Group[]; onOpen: (categoria: string) => void }) {
  return (
    <div className="ivt-cards ivt-portada">
      {groups.map(group => {
        const mix = group.equipos && group.recursos
          ? `${group.equipos} ${group.equipos === 1 ? 'equipo' : 'equipos'}, ${group.recursos} ${group.recursos === 1 ? 'recurso' : 'recursos'}`
          : group.equipos ? `${group.equipos} ${group.equipos === 1 ? 'equipo' : 'equipos'}` : `${group.recursos} ${group.recursos === 1 ? 'recurso' : 'recursos'}`;
        return (
          <button type="button" key={group.categoria} className="ivt-card ivt-cat" aria-label={`Abrir ${group.categoria}, ${group.total} ítems`} onClick={() => onOpen(group.categoria)}>
            {group.portada && <span className="ivt-cat-cover"><img src={group.portada} alt="" loading="lazy" /></span>}
            <span className="ivt-cat-title">
              <TruncatedText className="ivt-cat-name">{group.categoria}</TruncatedText>
              <span className="ivt-mono ivt-cat-total">{group.total}</span>
            </span>
            <Tx tone="normal" className="ivt-ell">{mix}</Tx>
            <span className="ivt-card-flags">
              {group.conProblema > 0 && <Tx tone="warn">{group.conProblema} con problema</Tx>}
              <Tx tone="normal">{group.aRevisar ? `${group.aRevisar} a revisar` : 'Todo revisado'}</Tx>
            </span>
          </button>
        );
      })}
    </div>
  );
}

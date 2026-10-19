import { ChevronDown } from 'lucide-react';
import { Ring, Skeleton, cx } from '../../ui';
import type { Counts, ListFilter, TypeStat } from './dashModel';

/**
 * Estado del momento: SOLO tres contadores (pedido del dueño), que filtran la
 * lista de abajo. Tocar "Disponibles" despliega EN LÍNEA el selector con
 * TODOS los tipos de la sede (libres/total con anillo fino; sin libres se ven
 * apagados) y "Todos los tipos". Nada de analíticas: conteos del momento.
 */
export function StatusTiles({ counts, types, filter, type, typesOpen, loading, onFilter, onToggleTypes, onType }: {
  counts: Counts;
  types: TypeStat[];
  filter: ListFilter;
  type: string;
  typesOpen: boolean;
  loading: boolean;
  onFilter: (filter: ListFilter) => void;
  onToggleTypes: () => void;
  onType: (type: string) => void;
}) {
  if (loading) {
    return (
      <section className="dash-state" aria-label="Estado de los equipos ahora" aria-busy="true">
        <div className="dash-tiles">
          {[0, 1, 2].map(index => (
            <div key={index} className="dash-tile dash-tile--skel">
              <Skeleton width="2.5rem" height="1.75rem" index={index} />
              <span className="dash-tile-text"><Skeleton width="60%" height="0.75rem" index={index} /><Skeleton width="40%" height="0.625rem" index={index} /></span>
            </div>
          ))}
        </div>
      </section>
    );
  }
  const warn = counts.overdue > 0;
  const tiles: Array<{ key: ListFilter; label: string; short?: string; value: number; detail: string; tone?: 'warn' }> = [
    { key: 'available', label: 'Disponibles', value: counts.available, detail: `de ${counts.total} · elegí el tipo` },
    { key: 'loaned', label: 'Prestados', value: counts.loaned, detail: counts.people === 1 ? '1 persona' : `${counts.people} personas` },
    { key: 'overdue', label: 'Más de 1 día afuera', short: '+1 día afuera', value: counts.overdue, detail: warn ? 'devolver o reclamar' : 'nada atrasado', tone: warn ? 'warn' : undefined }
  ];
  return (
    <section className="dash-state" aria-label="Estado de los equipos ahora">
      <div className="dash-tiles">
        {tiles.map(tile => {
          const on = filter === tile.key && (tile.key === 'available' || !type);
          const isAvail = tile.key === 'available';
          return (
            <button
              key={tile.key}
              type="button"
              className={cx('dash-tile', on && 'is-on', tile.tone === 'warn' && 'is-warn')}
              aria-pressed={on}
              aria-expanded={isAvail ? typesOpen : undefined}
              aria-controls={isAvail ? 'dash-types' : undefined}
              aria-label={`${tile.label}: ${tile.value}`}
              onClick={() => (isAvail ? onToggleTypes() : onFilter(tile.key))}
            >
              <span className="dash-tile-num g-num">{tile.value}</span>
              <span className="dash-tile-text">
                <span className="dash-tile-label">
                  {tile.short ? <><span className="dash-wide">{tile.label}</span><span className="dash-narrow">{tile.short}</span></> : tile.label}
                </span>
                <span className="dash-tile-detail">{tile.detail}</span>
              </span>
              {isAvail && <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" className={cx('dash-tile-chev', typesOpen && 'is-open')} />}
            </button>
          );
        })}
      </div>
      {typesOpen && (
        <div id="dash-types" className="dash-types ui-enter" role="group" aria-label="Disponibles por tipo">
          <TypeChip name="Todos los tipos" free={counts.available} total={counts.total} on={filter === 'available' && !type} onClick={() => onType('')} />
          {types.map(stat => (
            <TypeChip key={stat.name} name={stat.name} free={stat.free} total={stat.total} on={filter === 'available' && type === stat.name} onClick={() => onType(stat.name)} />
          ))}
        </div>
      )}
    </section>
  );
}

function TypeChip({ name, free, total, on, onClick }: { name: string; free: number; total: number; on: boolean; onClick: () => void }) {
  const off = free === 0;
  return (
    <button
      type="button"
      className={cx('dash-type', on && 'is-on', off && 'is-off')}
      aria-pressed={on}
      aria-disabled={off || undefined}
      aria-label={`${name}: ${free} libres de ${total}${off ? ', ninguno libre' : ''}`}
      onClick={() => { if (!off) onClick(); }}
    >
      <Ring value={free} total={total} size={32} />
      <span className="dash-type-text" aria-hidden="true">
        <span className="dash-type-name">{name}</span>
        <span className="dash-type-nums g-num"><b>{free}</b>/{total}</span>
      </span>
    </button>
  );
}

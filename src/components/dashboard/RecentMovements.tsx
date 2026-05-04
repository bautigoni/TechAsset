import type { Movement } from '../../types';
import { formatDateTime } from '../../utils/formatters';

export function RecentMovements({ items }: { items: Movement[] }) {
  return (
    <section className="card movements-card">
      <div className="card-head">
        <h3>Últimos movimientos globales</h3>
      </div>
      <div className="list compact scroll-list">
        {items.length === 0 && <div className="empty-state">Sin movimientos todavía.</div>}
        {items.slice(0, 20).map((item, index) => (
          <div className="list-item" key={`${item.timestamp}-${index}`}>
            <strong>{formatDateTime(item.timestamp)} · {item.tipo}</strong>
            <div>{item.descripcion}</div>
            <div className="muted">{item.operador || '-'} · {item.origen}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

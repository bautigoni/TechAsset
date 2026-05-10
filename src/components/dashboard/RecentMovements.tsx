import type { Movement } from '../../types';
import { formatDateTime } from '../../utils/formatters';

function movementTypeLabel(value: string) {
  const normalized = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'prestamo') return 'préstamo';
  if (normalized === 'devolucion') return 'devolución';
  return value;
}

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
            <strong>{formatDateTime(item.timestamp)} · {movementTypeLabel(item.tipo)}</strong>
            <div>{item.descripcion}</div>
            <div className="muted">{item.operador || '-'} · {item.origen}</div>
          </div>
        ))}
      </div>
    </section>
  );
}


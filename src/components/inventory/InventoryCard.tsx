import { useEffect, useState } from 'react';
import type { Entry } from './inventoryEntries';

// Iniciales para la placa de los equipos: no tienen foto de producto, así que
// en vez de un placeholder vacío se muestra su alias operativo en grande.
function initials(value: string) {
  const parts = String(value || '').trim().split(/\s+/).slice(0, 2);
  const letters = parts.map(part => part[0] || '').join('');
  return (letters || '?').toUpperCase();
}

function conditionClass(condicion: string) {
  const value = String(condicion || '').trim().toLowerCase();
  if (!value) return 'is-sin-revisar';
  return `is-${value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
}

export function InventoryCard({ entry, onOpen, children }: {
  entry: Entry;
  onOpen?: () => void;
  children?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [entry.imagenUrl]);
  const hasPhoto = Boolean(entry.imagenUrl) && !broken;

  return (
    <article className={`inv-card ${entry.kind === 'equipo' ? 'is-equipo' : ''}`}>
      <button type="button" className="inv-card-media" onClick={onOpen} aria-label={entry.nombre}>
        {hasPhoto
          ? <img src={entry.imagenUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
          : entry.kind === 'equipo'
            // El alias entero, no iniciales: "Touch 1" y "Touch 10" daban las
            // mismas dos letras, y el alias es lo que se busca a simple vista.
            ? <span className="inv-card-alias">{entry.nombre}</span>
            : <span className="inv-card-initials">{initials(entry.nombre)}</span>}
        {!hasPhoto && entry.kind === 'recurso' && <span className="inv-card-flag is-hint">Sin foto</span>}
        {entry.kind === 'recurso' && entry.bajoStock && <span className="inv-card-flag is-warn">Bajo stock</span>}
        {entry.kind === 'equipo' && entry.vencido && <span className="inv-card-flag is-bad">Vida útil vencida</span>}
      </button>

      <div className="inv-card-body">
        <div className="inv-card-title">
          {onOpen
            ? <button type="button" onClick={onOpen}>{entry.nombre}</button>
            : <strong>{entry.nombre}</strong>}
          {entry.detalle && <span>{entry.detalle}</span>}
        </div>

        <div className="inv-card-meta">
          <span className={`condition-dot ${conditionClass(entry.condicion)}`}>{entry.condicion || 'Sin revisar'}</span>
          {entry.kind === 'recurso'
            ? <span className={`inv-card-qty ${entry.bajoStock ? 'is-low' : ''}`}>{entry.cantidad} <small>{entry.unidad}</small></span>
            : <span className={`inv-card-life ${entry.vencido ? 'is-over' : (entry.vidaPct ?? 0) >= 80 ? 'is-due' : ''}`}>
                {entry.vidaPct === null ? '—' : entry.vencido ? 'Vencida' : `${entry.vidaPct}% de vida`}
              </span>}
        </div>

        {children && <div className="inv-card-actions">{children}</div>}
      </div>
    </article>
  );
}

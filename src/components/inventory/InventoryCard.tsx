import type { KeyboardEvent } from 'react';
import { TruncatedText } from '../../ui/Truncated';
import { conditionTone, isReviewFresh, stockInfo, thumbText, type Entry } from './inventoryEntries';
import { Tx } from './inventoryParts';

// Tarjeta del listado en vista Tarjetas. Toda la tarjeta abre (y cierra) la
// ficha en línea; los cartelitos son texto coloreado, sin fondo ni puntito.
export function InventoryCard({ entry, expanded, onOpen, className }: { entry: Entry; expanded: boolean; onOpen: () => void; className?: string }) {
  const stock = stockInfo(entry);
  const flags: Array<{ text: string; tone: 'warn' | 'bad' | 'muted' | 'normal' }> = [];
  if (entry.kind === 'recurso' && (entry.cantidad ?? 0) <= 0) flags.push({ text: 'Sin stock', tone: 'bad' });
  else if (entry.bajoStock) flags.push({ text: 'Bajo stock', tone: 'warn' });
  if (entry.vencido) flags.push({ text: 'Vida útil vencida', tone: 'bad' });
  if (entry.condicion && !isReviewFresh(entry)) flags.push({ text: 'Revisar', tone: 'warn' });
  if (entry.kind === 'recurso' && !entry.imagenUrl) flags.push({ text: 'Sin foto', tone: 'muted' });
  if (entry.kind === 'recurso' && entry.unidadesCargadas > 0) {
    flags.push({ text: `${entry.unidadesCargadas} detalladas${entry.unidadesConFalla ? ` · ${entry.unidadesConFalla} con falla` : ''}`, tone: 'normal' });
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`ivt-card${className ? ` ${className}` : ''}`}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Cerrar' : 'Abrir'} el detalle de ${entry.nombre}`}
      data-device-tag={entry.device?.etiqueta}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <span className={`ivt-card-thumb${entry.imagenUrl ? ' has-photo' : ''}`}>
        {entry.imagenUrl
          ? <img src={entry.imagenUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />
          : <span className="ivt-mono">{entry.kind === 'equipo' ? entry.nombre : thumbText(entry)}</span>}
      </span>
      <span className="ivt-card-text">
        <TruncatedText className="ivt-card-name">{entry.nombre}</TruncatedText>
        <TruncatedText className={`ivt-card-sub${entry.kind === 'equipo' ? ' ivt-mono' : ''}`}>{entry.kind === 'equipo' ? (entry.device?.etiqueta || '') : (entry.detalle || entry.categoria)}</TruncatedText>
      </span>
      <span className="ivt-card-row">
        <Tx tone={stock.tone} mono>{stock.value}</Tx>
        <Tx tone={conditionTone(entry.condicion)}>{entry.condicion || 'Sin revisar'}</Tx>
      </span>
      <span className="ivt-card-flags">
        {flags.map(flag => <Tx key={flag.text} tone={flag.tone}>{flag.text}</Tx>)}
      </span>
    </div>
  );
}

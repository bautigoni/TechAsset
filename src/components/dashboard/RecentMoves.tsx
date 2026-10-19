import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, History, Pencil, Undo2 } from 'lucide-react';
import type { Movement } from '../../types';
import { Button, Collapse, TruncatedText, cx, useAnchoredToggle } from '../../ui';
import { TIME_HM, dateFormatter, dayKeyAr, todayKeyAr, addDaysToKey } from '../../utils/formatters';
import { DashEmpty } from './DashEmpty';

const FIRST = 10;
const MAX = 20;
const TIME_AR: Intl.DateTimeFormatOptions = { ...TIME_HM, hour12: false, timeZone: 'America/Argentina/Buenos_Aires' };
const DAY_AR: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' };

function kindOf(item: Movement) {
  const tipo = String(item.tipo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (item.origen === ('Deshacer' as Movement['origen'])) return { label: 'Deshecho', Icon: Undo2 };
  if (tipo.startsWith('prestamo')) return { label: 'Préstamo', Icon: ArrowUpRight };
  if (tipo.startsWith('devolucion')) return { label: 'Devolución', Icon: ArrowDownLeft };
  return { label: item.tipo ? item.tipo.charAt(0).toUpperCase() + item.tipo.slice(1) : 'Cambio', Icon: Pencil };
}

function when(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const day = dayKeyAr(date);
  const time = dateFormatter(TIME_AR).format(date);
  const today = todayKeyAr();
  if (day === today) return time;
  if (day === addDaysToKey(today, -1)) return `Ayer ${time}`;
  return `${dateFormatter(DAY_AR).format(date)} ${time}`;
}

/**
 * Últimos movimientos de la sede (los 20 que ya trae el polling de App),
 * plegable con el encabezado anclado. Vive en la columna de "Afuera ahora":
 * así ninguna columna deja un hueco arriba de él.
 * Filas en una grilla común (subgrid): tipo e ícono enteros, descripción en
 * hasta 2 renglones, operador y hora en mono; angosto → filas apiladas.
 */
export function RecentMoves({ items, canHistory, onHistory }: { items: Movement[]; canHistory: boolean; onHistory: () => void }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const anchored = useAnchoredToggle();
  const rows = useMemo(() => items.slice(0, all ? MAX : FIRST), [items, all]);
  const toggle = () => setOpen(value => !value);
  // Ver los 20 / Ver menos: el botón tocado queda quieto (la lista crece o se achica abajo).
  const toggleAll = () => anchored(() => setAll(value => !value));
  return (
    <section className="dash-card dash-moves" aria-labelledby="mov-titulo" data-dash="movimientos">
      <header className={cx('dash-card-head', open && 'is-open')}>
        <h2 className="dash-h3" id="mov-titulo">
          <button type="button" className="dash-disclose" aria-expanded={open} aria-controls="mov-lista" onClick={toggle}>
            <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" className={cx('dash-disclose-chev', !open && 'is-closed')} />
            Últimos movimientos
          </button>
        </h2>
        <span className="dash-card-meta g-num">{Math.min(items.length, MAX) || ''}</span>
        {open && items.length > FIRST && <Button size="sm" variant="ghost" onClick={toggleAll}>{all ? 'Ver menos' : `Ver los ${Math.min(items.length, MAX)}`}</Button>}
        {canHistory && <Button size="sm" variant="ghost" className="dash-link" onClick={onHistory}>Ver historial</Button>}
      </header>
      <Collapse open={open} id="mov-lista" unmountOnClose>
        {rows.length ? (
          <ol className="dash-moves-list">
            {rows.map((item, index) => {
              const kind = kindOf(item);
              return (
                <li key={`${item.timestamp}-${index}`} className="dash-move">
                  <span className="ui-mono dash-move-time">{when(item.timestamp)}</span>
                  <span className="dash-move-kind"><kind.Icon size={14} strokeWidth={1.7} aria-hidden="true" /><span className="dash-move-kind-text">{kind.label}</span></span>
                  <TruncatedText className="dash-move-desc" lines={2}>{item.descripcion || '—'}</TruncatedText>
                  <span className="ui-mono dash-move-op">{item.operador || '—'}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <DashEmpty flat icon={<History size={18} strokeWidth={1.6} />} title="Sin movimientos todavía" description="Acá aparecen los préstamos, devoluciones y cambios de la sede." />
        )}
      </Collapse>
    </section>
  );
}

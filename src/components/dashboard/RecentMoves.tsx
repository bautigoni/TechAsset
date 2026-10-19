import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Pencil, Undo2 } from 'lucide-react';
import type { Movement } from '../../types';
import { Button, EmptyState, TruncatedText, cx } from '../../ui';
import { TIME_HM, dateFormatter, dayKeyAr, todayKeyAr, addDaysToKey } from '../../utils/formatters';

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

/** Últimos movimientos de la sede (los 20 que ya trae el polling de App), plegable. */
export function RecentMoves({ items, canHistory, onHistory }: { items: Movement[]; canHistory: boolean; onHistory: () => void }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => items.slice(0, all ? MAX : FIRST), [items, all]);
  const half = Math.max(1, Math.ceil(rows.length / 2));
  return (
    <section className="dash-card dash-moves" aria-labelledby="mov-titulo">
      <header className="dash-card-head">
        <h2 className="dash-h3" id="mov-titulo">
          <button type="button" className="dash-disclose" aria-expanded={open} aria-controls="mov-lista" onClick={() => setOpen(value => !value)}>
            <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" className={cx('dash-disclose-chev', !open && 'is-closed')} />
            Últimos movimientos
          </button>
        </h2>
        <span className="dash-card-meta g-num">{Math.min(items.length, MAX)}</span>
        {open && items.length > FIRST && <Button size="sm" variant="ghost" onClick={() => setAll(value => !value)}>{all ? 'Ver menos' : `Ver los ${Math.min(items.length, MAX)}`}</Button>}
        {canHistory && <Button size="sm" variant="ghost" className="dash-link" onClick={onHistory}>Ver historial</Button>}
      </header>
      {open && (
        rows.length ? (
          <ol id="mov-lista" className="dash-moves-list" style={{ ['--dash-move-rows' as string]: half }}>
            {rows.map((item, index) => {
              const kind = kindOf(item);
              return (
                <li key={`${item.timestamp}-${index}`} className="dash-move">
                  <span className="ui-mono dash-sub dash-move-time">{when(item.timestamp)}</span>
                  <span className="dash-move-kind"><kind.Icon size={14} strokeWidth={1.7} aria-hidden="true" /><span className="dash-move-kind-text">{kind.label}</span></span>
                  <TruncatedText className="dash-move-desc">{item.descripcion}</TruncatedText>
                  <span className="dash-sub dash-move-op">{item.operador || '—'}</span>
                </li>
              );
            })}
          </ol>
        ) : <EmptyState compact title="Sin movimientos todavía." />
      )}
    </section>
  );
}

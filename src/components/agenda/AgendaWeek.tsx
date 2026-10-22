import type { AgendaItem } from '../../types';
import { Button, Collapse, StatusText, TruncatedText, cx } from '../../ui';
import { agendaQuick, rowClickOpens, type AgendaActions } from './AgendaRow';
import { retiredInfo, statusOf, turnoLabel } from './agendaModel';

export type WeekColumn = { day: string; date: string; isToday: boolean; items: AgendaItem[] };

/** Semana de lunes a viernes: columnas que bajan a 3 y a 1 según el ancho. */
export function AgendaWeek({ columns, openId, onToggle, onOpenDay, actions }: {
  columns: WeekColumn[];
  openId: string;
  onToggle: (id: string) => void;
  onOpenDay: (item: AgendaItem, day: string) => void;
  actions: AgendaActions;
}) {
  const { clock, consultation, busy } = actions;
  return (
    <div className="ag-week">
      {columns.map(column => (
        <section key={column.day} className="ag-week-col" aria-label={`${column.day}${column.isToday ? ', hoy' : ''}`}>
          <div className="ag-week-head">
            <span className={cx('ag-week-day', column.isToday && 'is-today')}>{column.day}{column.isToday ? ' · hoy' : ''}</span>
            <span className="ag-week-date g-num">{column.date.slice(8)}/{column.date.slice(5, 7)}</span>
            <span className="ag-week-count g-num">{column.items.length}</span>
          </div>
          {column.items.map(item => {
            const open = openId === item.id;
            const st = statusOf(item, clock);
            const ret = retiredInfo(item);
            const delivered = item.estado === 'Entregado';
            return (
              <div key={item.id} className={cx('ag-wk-item', open && 'is-open')} data-agenda-id={item.id}>
                <div className="ag-wk-card" onClick={event => { if (rowClickOpens(event)) onToggle(item.id); }}>
                  <button type="button" className="ag-wk-toggle" aria-expanded={open} aria-controls={`ag-wk-detail-${item.id}`} aria-label={`${item.curso}, ${item.actividad}, ${item.desde} a ${item.hasta}, ${st.label}. ${open ? 'Ocultar' : 'Ver'} detalle`} onClick={() => onToggle(item.id)}>
                    <span className="ag-time g-num">{item.desde}–{item.hasta}</span>
                    <StatusText tone={st.tone}>{st.label}</StatusText>
                  </button>
                  <TruncatedText className={cx('ag-curso', item.estado === 'Cancelado' && 'is-cancelled')}>{item.curso || 'Sin curso'}</TruncatedText>
                  <TruncatedText className="ag-what">{`${item.actividad || 'Actividad'} · ${item.cantidad} ${item.tipoDispositivo}`}</TruncatedText>
                </div>
                <Collapse open={open} id={`ag-wk-detail-${item.id}`} className="ag-wk-detail">
                    <span className="ag-what">{item.ubicacion || 'Sin ubicación'} · {item.fecha ? 'una vez' : turnoLabel(item.turno)}</span>
                    {ret.text && <StatusText tone={ret.tone}>{ret.text}</StatusText>}
                    <span className="ag-what">{item.nota ? `Nota: ${item.nota}` : 'Sin nota'}</span>
                    <Button size="sm" variant="primary" block disabled={consultation} loading={busy[item.id] === 'deliver'} loadingLabel="Guardando…" onClick={() => void (delivered ? agendaQuick.undeliver : agendaQuick.deliver)(actions, item)}>
                      {delivered ? 'Volver a pendiente' : 'Marcar entregados'}
                    </Button>
                    <Button size="sm" variant="secondary" block disabled={consultation} loading={busy[item.id] === 'retire'} onClick={() => void (ret.all ? agendaQuick.unretire : agendaQuick.retire)(actions, item)}>
                      {ret.all ? 'Desmarcar retirados' : 'Marcar retirados'}
                    </Button>
                    <Button size="sm" variant="ghost" block onClick={() => onOpenDay(item, column.day)}>Abrir en el día</Button>
                </Collapse>
              </div>
            );
          })}
          {!column.items.length && <span className="ag-week-empty">Sin actividades</span>}
        </section>
      ))}
    </div>
  );
}

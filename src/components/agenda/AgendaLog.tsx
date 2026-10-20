import { useEffect, useState } from 'react';
import { getAgendaHistory, type AgendaHistoryEntry } from '../../services/agendaApi';
import { History } from 'lucide-react';
import { Button, Collapse, EmptyState, ErrorState, SkeletonRows, StatusText, TruncatedText, type StatusTextTone } from '../../ui';
import { DAY_SHORT, shortDateTime } from './agendaModel';

const STEP = 20;

function change(entry: AgendaHistoryEntry): { text: string; tone: StatusTextTone } {
  if (entry.accion === 'actividad creada') return { text: 'Creada', tone: 'normal' };
  if (entry.accion === 'actividad borrada') return { text: 'Borrada', tone: 'bad' };
  if (entry.accion === 'actividad restaurada') return { text: 'Restaurada', tone: 'normal' };
  if (entry.estado_anterior !== entry.estado_nuevo) return { text: `${entry.estado_anterior || '—'} → ${entry.estado_nuevo}`, tone: entry.estado_nuevo === 'Entregado' ? 'info' : 'normal' };
  return { text: 'Retiradas, nota o datos', tone: 'muted' };
}

function what(entry: AgendaHistoryEntry) {
  if (!entry.curso && !entry.actividad) return `Actividad ${entry.agenda_id}`;
  const when = entry.fecha ? entry.fecha.split('-').reverse().slice(0, 2).join('/') : DAY_SHORT[entry.dia || ''] || entry.dia || '';
  return [entry.curso, entry.actividad, `${when} ${entry.desde || ''}`.trim()].filter(Boolean).join(' · ');
}

/** Primeras FIRST filas y después tandas de STEP (cada "Ver más" entra creciendo). */
const FIRST = 6;
function pages<T>(list: T[], shown: number) {
  const out: T[][] = [list.slice(0, Math.min(FIRST, shown))];
  for (let from = FIRST; from < Math.min(shown, list.length); from += STEP) out.push(list.slice(from, Math.min(from + STEP, shown)));
  return out;
}

function row(entry: AgendaHistoryEntry) {
  const delta = change(entry);
  return (
    <li key={entry.id} className="ag-log-row">
      <span className="ag-log-when g-num">{shortDateTime(entry.timestamp)}</span>
      <TruncatedText className="ag-log-what" lines={2}>{what(entry)}</TruncatedText>
      <StatusText tone={delta.tone} className="ag-log-change">{delta.text}</StatusText>
      <TruncatedText className="ag-log-op">{entry.operador || 'sin operador'}</TruncatedText>
    </li>
  );
}

/** Registro de cambios (agenda_history): antes existía en el server y no se mostraba. */
export function AgendaLog({ version }: { version: string }) {
  const [items, setItems] = useState<AgendaHistoryEntry[] | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [shown, setShown] = useState(FIRST);

  const load = async () => {
    try {
      const data = await getAgendaHistory(200);
      setItems(data.items || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'No se pudo cargar el registro de cambios.');
    }
  };
  useEffect(() => { void load(); }, [version]);

  return (
    <section className="ag-card" aria-label="Registro de cambios">
      <div className="ag-card-head">
        <h3 className="ag-h3">Registro de cambios</h3>
        {items && <span className="ag-head-sub"><span className="g-num">{items.length}</span> cambios en la sede{items.length >= 200 ? ' (los últimos)' : ''}</span>}
      </div>
      <Collapse open={Boolean(error)}>
        <ErrorState message={error || 'No se pudo cargar el registro de cambios.'} retrying={retrying} onRetry={async () => { setRetrying(true); await load(); setRetrying(false); }} className="ag-inset" />
      </Collapse>
      {/* Cargando → datos: el esqueleto se pliega mientras la lista se abre (sin salto de alto). */}
      <Collapse open={!items && !error} lazy={false}>
        <SkeletonRows rows={4} className="ag-inset" />
      </Collapse>
      <Collapse open={Boolean(items && !items.length)}>
        <EmptyState compact className="ag-empty-state" icon={<History size={18} strokeWidth={1.6} />} title="Todavía no hay cambios registrados." description="Cada alta, entrega o cambio de una actividad queda anotado acá." />
      </Collapse>
      <Collapse open={Boolean(items && items.length)}>
        {pages(items || [], shown).map((chunk, page) => (page === 0 ? <ol key="page-0" className="ag-log">{chunk.map(row)}</ol> : (
          <Collapse key={`page-${page}`} open appear anchor={false} reveal={false}><ol className="ag-log">{chunk.map(row)}</ol></Collapse>
        )))}
      </Collapse>
      <Collapse open={Boolean(items && items.length > shown)}>
        <div className="ag-card-foot">
          <Button size="sm" variant="ghost" block onClick={() => setShown(value => value + STEP)}>Ver más cambios</Button>
        </div>
      </Collapse>
    </section>
  );
}

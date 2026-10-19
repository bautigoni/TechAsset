import { useEffect, useState } from 'react';
import { getAgendaHistory, type AgendaHistoryEntry } from '../../services/agendaApi';
import { Button, ErrorState, SkeletonRows, StatusText, TruncatedText, type StatusTextTone } from '../../ui';
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

/** Registro de cambios (agenda_history): antes existía en el server y no se mostraba. */
export function AgendaLog({ version }: { version: string }) {
  const [items, setItems] = useState<AgendaHistoryEntry[] | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [shown, setShown] = useState(6);

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
      {error && <ErrorState message={error} retrying={retrying} onRetry={async () => { setRetrying(true); await load(); setRetrying(false); }} className="ag-inset" />}
      {!items && !error && <SkeletonRows rows={4} className="ag-inset" />}
      {items && !items.length && <p className="ag-empty">Todavía no hay cambios registrados.</p>}
      {items && items.length > 0 && (
        <ol className="ag-log">
          {items.slice(0, shown).map(entry => {
            const delta = change(entry);
            return (
              <li key={entry.id} className="ag-log-row">
                <span className="ag-log-when g-num">{shortDateTime(entry.timestamp)}</span>
                <TruncatedText className="ag-log-what">{what(entry)}</TruncatedText>
                <StatusText tone={delta.tone} className="ag-log-change">{delta.text}</StatusText>
                <TruncatedText className="ag-log-op">{entry.operador || 'sin operador'}</TruncatedText>
              </li>
            );
          })}
        </ol>
      )}
      {items && items.length > shown && (
        <div className="ag-card-foot">
          <Button size="sm" variant="ghost" block onClick={() => setShown(value => value + STEP)}>Ver más cambios</Button>
        </div>
      )}
    </section>
  );
}

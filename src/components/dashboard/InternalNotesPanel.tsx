import { useEffect, useMemo, useState } from 'react';
import type { InternalNote } from '../../types';
import { createInternalNote, fetchInternalNotes, updateInternalNote } from '../../services/operationsApi';
import { Button } from '../layout/Button';

export function InternalNotesPanel({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  const [items, setItems] = useState<InternalNote[]>([]);
  const [text, setText] = useState('');
  const [important, setImportant] = useState(false);
  const [filter, setFilter] = useState<'today' | 'important' | 'all' | 'mine' | 'last30'>('last30');
  const [error, setError] = useState('');

  const refresh = () => fetchInternalNotes(filter === 'last30' ? 'last30' : filter === 'all' ? 'all' : 'active').then(r => r.ok && setItems(r.items)).catch(() => setError('No se pudieron cargar las notas.'));
  useEffect(() => { refresh(); }, [filter]);

  const visible = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return items.filter(item => {
      if (filter === 'today') return item.createdAt?.startsWith(today);
      if (filter === 'important') return item.importante;
      if (filter === 'mine') return item.operador === operator;
      if (filter === 'last30') return true;
      return true;
    });
  }, [filter, items, operator]);

  return (
    <section className="card internal-notes-card">
      <div className="card-head">
        <div>
          <h3>Traspaso TIC</h3>
          <p className="muted">Notas internas rápidas por sede para el cambio de turno</p>
        </div>
      </div>
      <div className="internal-note-filters">
        {(['today', 'important', 'all', 'mine', 'last30'] as const).map(key => (
          <button key={key} className={`small-filter ${filter === key ? 'active' : ''}`} type="button" onClick={() => setFilter(key)}>
            {key === 'today' ? 'Hoy' : key === 'important' ? 'Importantes' : key === 'mine' ? 'Por operador' : key === 'last30' ? 'Últimos 30 días' : 'Todas'}
          </button>
        ))}
      </div>
      {!consultationMode && (
        <form className="internal-note-form" onSubmit={async event => {
          event.preventDefault();
          if (!text.trim()) return;
          await createInternalNote({ texto: text, importante: important, operator });
          setText(''); setImportant(false); refresh();
        }}>
          <textarea className="input" rows={2} value={text} onChange={event => setText(event.target.value)} placeholder="Dejar nota para el próximo turno..." />
          <button type="button" className={`important-toggle ${important ? 'active' : ''}`} onClick={() => setImportant(v => !v)} aria-pressed={important}>{important ? '★' : '☆'} Importante</button>
          <Button variant="primary" type="submit">Enviar</Button>
        </form>
      )}
      <div className="internal-note-list">
        {visible.map(item => (
          <article key={item.id} className={`internal-note ${item.importante ? 'important' : ''}`}>
            <p>{item.texto}</p>
            <div className="muted">
              {item.operador || 'Sin operador'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
              {!item.visible && item.deletedAt ? ` · borrada por ${item.deletedBy || '-'} ${new Date(item.deletedAt).toLocaleString()}` : ''}
            </div>
            {!consultationMode && item.visible !== false && <button type="button" onClick={async () => { await updateInternalNote(item.id, { visible: false, operator }); refresh(); }}>Borrar</button>}
          </article>
        ))}
        {!visible.length && <div className="empty-state">Sin notas para mostrar.</div>}
      </div>
      {error && <div className="tool-error">{error}</div>}
    </section>
  );
}

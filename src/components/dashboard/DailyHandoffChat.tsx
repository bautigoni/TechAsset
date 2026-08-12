import { useEffect, useRef, useState } from 'react';
import type { InternalNote } from '../../types';
import { createInternalNote, fetchInternalNotes, updateInternalNote } from '../../services/operationsApi';

// Mini chat de traspaso del día. Reemplaza a la pestaña "Traspaso TIC": acá se
// escriben las notas del turno y arranca limpio cada día. Las notas viejas no
// se borran (siguen en internal_notes), simplemente no se muestran.
function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function DailyHandoffChat({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  const [items, setItems] = useState<InternalNote[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const refresh = () => fetchInternalNotes('active')
    .then(response => {
      if (!response.ok) return;
      const today = todayIso();
      setItems(response.items.filter(item => String(item.createdAt || '').startsWith(today)));
    })
    .catch(() => undefined);

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [items.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await createInternalNote({ texto: value, importante: false, operator });
      setText('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="handoff-chat">
      <div className="handoff-chat-head">
        <strong>Traspaso de hoy</strong>
        <span className="muted">{items.length ? `${items.length} nota${items.length === 1 ? '' : 's'}` : 'Sin notas'}</span>
      </div>
      <div className="handoff-chat-list" ref={listRef}>
        {items.map(item => (
          <article key={item.id} className={item.operador === operator ? 'is-mine' : ''}>
            <p>{item.texto}</p>
            <footer>
              <span>{item.operador || 'Sin operador'}</span>
              <time>{item.createdAt ? new Date(item.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
              {!consultationMode && (
                <button type="button" onClick={async () => { await updateInternalNote(item.id, { visible: false, operator }); await refresh(); }}>Borrar</button>
              )}
            </footer>
          </article>
        ))}
        {!items.length && <p className="handoff-chat-empty">Todavía nadie dejó notas hoy.</p>}
      </div>
      {!consultationMode && (
        <form className="handoff-chat-form" onSubmit={send}>
          <input
            className="input"
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder="Dejar una nota para el turno..."
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>Enviar</button>
        </form>
      )}
    </div>
  );
}

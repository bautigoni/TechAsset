import { useEffect, useRef, useState } from 'react';
import type { InternalNote } from '../../types';
import { createInternalNote, fetchInternalNotes, updateInternalNote } from '../../services/operationsApi';
import { TIME_HM, dayKeyAr, formatDate, todayKeyAr } from '../../utils/formatters';
import { toastError } from '../layout/Feedback';

// Mini chat de traspaso del día. Reemplaza a la pestaña "Traspaso TIC": acá se
// escriben las notas del turno y arranca limpio cada día. Las notas viejas no
// se borran (siguen en internal_notes), simplemente no se muestran.
//
// "Hoy" es en hora argentina: el server manda `localDate` (YYYY-MM-DD ya en
// hora argentina); si no viene, se convierte `createdAt` (UTC) a la fecha de
// Argentina. Comparar `createdAt` directo contra la fecha local hacía que las
// notas de después de las 21 h desaparecieran del chat.
function noteDay(item: InternalNote) {
  return item.localDate || dayKeyAr(item.createdAt || '');
}

export function DailyHandoffChat({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  const [items, setItems] = useState<InternalNote[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const refresh = () => fetchInternalNotes('active')
    .then(response => {
      if (!response.ok) return;
      const today = todayKeyAr();
      setItems(response.items.filter(item => noteDay(item) === today));
    });

  // La carga inicial no es una acción del usuario: si falla, el chat queda vacío.
  useEffect(() => { refresh().catch(() => undefined); }, []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [items.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await createInternalNote({ texto: value, importante: false, operator });
      setText('');
      await refresh().catch(() => undefined);
    } catch (reason) {
      toastError(reason, 'No se pudo enviar la nota.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await updateInternalNote(id, { visible: false, operator });
      await refresh().catch(() => undefined);
    } catch (reason) {
      toastError(reason, 'No se pudo borrar la nota.');
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
              <time>{formatDate(item.createdAt, TIME_HM)}</time>
              {!consultationMode && (
                <button type="button" onClick={() => void remove(item.id)}>Borrar</button>
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

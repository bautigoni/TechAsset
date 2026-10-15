import { useEffect, useState } from 'react';
import type { Reminder } from '../../types';
import { completeReminder, createReminder, getReminders } from '../../services/remindersApi';
import { Button } from '../layout/Button';
import { promptDialog, toast, errorMessage } from '../layout/Feedback';

export function RelatedReminders({
  type,
  id,
  label,
  consultationMode = false
}: {
  type: string;
  id: string;
  label: string;
  consultationMode?: boolean;
}) {
  const [items, setItems] = useState<Reminder[]>([]);
  const refresh = () => getReminders({ relatedType: type, relatedId: id }).then(response => setItems(response.items));
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [type, id]);
  const add = async () => {
    // Antes eran dos prompt() nativos y una fecha tipeada a mano ("YYYY-MM-DD HH:mm")
    // que en Safari/iPhone daba Invalid Date y rompía sin aviso.
    const title = await promptDialog({ title: 'Nuevo recordatorio', message: label, label: 'Qué hay que recordar', confirmLabel: 'Siguiente' });
    if (!title) return;
    const when = await promptDialog({ title: 'Nuevo recordatorio', message: title, label: 'Fecha y hora', inputType: 'datetime-local', initial: nextHourLocal(), confirmLabel: 'Guardar' });
    if (!when) return;
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return toast({ message: 'La fecha no es válida.', tone: 'error' });
    try {
      await createReminder({ title, remindAt: date.toISOString(), relatedType: type, relatedId: id, relatedLabel: label });
      toast({ message: 'Recordatorio guardado.', tone: 'ok' });
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo guardar el recordatorio.'), tone: 'error' });
    }
    await refresh();
  };
  return (
    <section className="card related-reminders">
      <div className="card-head">
        <h3>Recordatorios</h3>
        <Button disabled={consultationMode} onClick={add}>
          + Agregar
        </Button>
      </div>
      {items.length ? (
        <div>
          {items.slice(0, 5).map(item => (
            <article key={item.id}>
              <span>{item.status === 'completed' ? '✓' : '○'}</span>
              <div>
                <strong>{item.title}</strong>
                <small>{new Date(item.remindAt).toLocaleString('es-AR')}</small>
              </div>
              {item.status === 'pending' && !consultationMode && (
                <button
                  onClick={async () => {
                    await completeReminder(item.id);
                    await refresh();
                  }}
                >
                  Completar
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">Sin recordatorios vinculados.</p>
      )}
    </section>
  );
}

// Valor inicial del selector de fecha: la próxima hora en punto, en hora local.
function nextHourLocal() {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

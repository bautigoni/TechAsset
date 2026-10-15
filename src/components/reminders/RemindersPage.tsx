import { useEffect, useState } from 'react';
import type { Reminder } from '../../types';
import { completeReminder, createReminder, deleteReminder, getReminders, postponeReminder } from '../../services/remindersApi';
import { Button } from '../layout/Button';
import { confirmDialog, errorMessage, promptDialog, toast } from '../layout/Feedback';

const RELATED_TYPES: Array<[string, string]> = [
  ['device', 'Dispositivo'], ['classroom', 'Aula'], ['ticket', 'Ticket'], ['loan', 'Préstamo'],
  ['task', 'Tarea'], ['purchase', 'Compra'], ['suggestion', 'Sugerencia'], ['group', 'Grupo de equipos']
];

const initial = {
  title: '',
  description: '',
  remindAt: '',
  ownerEmail: '',
  ownerName: '',
  priority: 'Media',
  relatedType: '',
  relatedId: '',
  relatedLabel: ''
};
export function RemindersPage({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [draft, setDraft] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => {
    const response = await getReminders();
    setItems(response.items);
  };
  useEffect(() => {
    refresh().catch(() => setMessage('No se pudieron cargar los recordatorios.'));
  }, []);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const date = new Date(draft.remindAt);
    if (Number.isNaN(date.getTime())) return toast({ message: 'La fecha no es válida.', tone: 'error' });
    setSaving(true);
    try {
      await createReminder({ ...draft, remindAt: date.toISOString() });
      setDraft(initial);
      setShowForm(false);
      toast({ message: 'Recordatorio guardado.', tone: 'ok' });
      await refresh();
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo guardar el recordatorio.'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="view active reminders-page">
      <div className="card reminders-toolbar">
        <div>
          <h2>Recordatorios</h2>
          <span className="muted">{items.filter(item => item.status === 'pending').length} pendientes</span>
        </div>
        <Button variant="primary" onClick={() => setShowForm(value => !value)}>
          + Recordatorio
        </Button>
      </div>
      {showForm && (
        <form className="card reminder-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label>Qué hay que recordar
            <input className="input" required autoFocus value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label>Detalle (opcional)
            <textarea className="input" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <div className="grid-2">
            {/* Selector nativo: antes era texto libre "AAAA-MM-DD HH:mm", que en
                Safari/iPhone terminaba en Invalid Date. */}
            <label>Fecha y hora
              <input className="input" type="datetime-local" required value={draft.remindAt} onChange={e => setDraft({ ...draft, remindAt: e.target.value })} />
            </label>
            <label>Prioridad
              <select className="input" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
                {['Baja', 'Media', 'Alta', 'Urgente'].map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <label>Responsable (mail, opcional)
            <input className="input" type="email" value={draft.ownerEmail} onChange={e => setDraft({ ...draft, ownerEmail: e.target.value })} />
          </label>
          <label>Relacionado con
            <select className="input" value={draft.relatedType} onChange={e => setDraft({ ...draft, relatedType: e.target.value })}>
              <option value="">Nada en particular</option>
              {RELATED_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {draft.relatedType && (
            <div className="grid-2">
              <label>Identificador
                <input className="input" placeholder="Ej. D1436, aula 2B, ticket 1520" value={draft.relatedId} onChange={e => setDraft({ ...draft, relatedId: e.target.value })} />
              </label>
              <label>Nombre para mostrar
                <input className="input" value={draft.relatedLabel} onChange={e => setDraft({ ...draft, relatedLabel: e.target.value })} />
              </label>
            </div>
          )}
          <div className="actions">
            <Button type="button" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" disabled={!draft.title.trim() || !draft.remindAt || saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      )}
      {message && <div className="tool-info">{message}</div>}
      <div className="reminders-list">
        {items.map(item => (
          <article key={item.id} className={`card reminder-card ${item.status}`}>
            <div>
              <span className={`badge ${item.priority === 'Urgente' ? 'lost' : 'subtle'}`}>{item.priority}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {item.relatedLabel && (
                <span className="muted">
                  {item.relatedType} · {item.relatedLabel}
                </span>
              )}
            </div>
            <div className="reminder-card-side">
              <strong>{new Date(item.remindAt).toLocaleString('es-AR')}</strong>
              {item.status === 'completed' ? (
                <span>Completado</span>
              ) : (
                <div className="actions">
                  <Button
                    disabled={consultationMode}
                    onClick={async () => {
                      await completeReminder(item.id);
                      await refresh();
                    }}
                  >
                    Completar
                  </Button>
                  <Button
                    disabled={consultationMode}
                    onClick={async () => {
                      const value = await promptDialog({ title: 'Posponer recordatorio', message: item.title, label: 'Nueva fecha y hora', inputType: 'datetime-local', initial: nextHourLocal(), confirmLabel: 'Posponer' });
                      if (!value) return;
                      const date = new Date(value);
                      if (Number.isNaN(date.getTime())) return toast({ message: 'La fecha no es válida.', tone: 'error' });
                      try {
                        await postponeReminder(item.id, date.toISOString());
                      } catch (reason) {
                        toast({ message: errorMessage(reason, 'No se pudo posponer.'), tone: 'error' });
                      }
                      await refresh();
                    }}
                  >
                    Posponer
                  </Button>
                  <Button
                    disabled={consultationMode}
                    aria-label={`Borrar recordatorio ${item.title}`}
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Borrar recordatorio', message: item.title, confirmLabel: 'Borrar', danger: true }))) return;
                      await deleteReminder(item.id);
                      await refresh();
                    }}
                  >
                    ×
                  </Button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
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

import { useEffect, useState } from 'react';
import { enableBrowserPush, getNotificationPrefs, setNotificationEmailPref, setNotificationTypePrefs, type NotificationTypePrefs } from '../../services/notificationsApi';

const DEFAULT_TYPES: NotificationTypePrefs = {
  releases: true,
  tasks: true,
  tickets: true,
  suggestions: true,
  reminders: true,
  registrations: true,
  system: true
};

const TYPE_OPTIONS: Array<{ key: keyof NotificationTypePrefs; title: string; text: string }> = [
  { key: 'suggestions', title: 'Sugerencias e ideas', text: 'Comentarios y cambios de estado de las ideas que seguís.' },
  { key: 'tasks', title: 'Tareas TIC', text: 'Tareas creadas o asignadas por otros integrantes de la sede.' },
  { key: 'reminders', title: 'Recordatorios', text: 'Avisos cuando vence un recordatorio propio o asignado.' },
  { key: 'tickets', title: 'Tickets', text: 'Tickets nuevos o cambios relevantes.' },
  { key: 'releases', title: 'Novedades de TechAsset', text: 'Avisos de actualización y cambios de versión.' },
  { key: 'registrations', title: 'Altas e invitaciones', text: 'Registros, aprobaciones e invitaciones de usuarios.' },
  { key: 'system', title: 'Sistema', text: 'Avisos generales de la plataforma.' }
];

export function NotificationsPanel() {
  const [email, setEmail] = useState(false);
  const [types, setTypes] = useState<NotificationTypePrefs>(DEFAULT_TYPES);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    getNotificationPrefs()
      .then(p => {
        setEmail(p.email);
        setTypes(p.types || DEFAULT_TYPES);
        setPushSubscribed(p.pushSubscribed);
        setPushAvailable(p.pushAvailable);
      })
      .catch(() => {});
  };

  useEffect(load, []);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(''); setErr(''); }, 3500);
    return () => clearTimeout(t);
  }, [msg, err]);

  const activarPush = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    const r = await enableBrowserPush();
    if (r.ok) {
      setPushSubscribed(true);
      setMsg('Notificaciones push activadas.');
    } else {
      setErr(r.error || 'No se pudo activar.');
    }
    setBusy(false);
  };

  const toggleEmail = async () => {
    const next = !email;
    setEmail(next);
    try {
      await setNotificationEmailPref(next);
      setMsg(next ? 'Te vamos a avisar por mail.' : 'Avisos por mail desactivados.');
    } catch {
      setEmail(!next);
      setErr('No se pudo guardar.');
    }
  };

  const toggleType = async (key: keyof NotificationTypePrefs) => {
    const previous = types;
    const next = { ...types, [key]: !types[key] };
    setTypes(next);
    try {
      await setNotificationTypePrefs(next);
      setMsg('Preferencias guardadas.');
    } catch {
      setTypes(previous);
      setErr('No se pudo guardar.');
    }
  };

  return (
    <section className="card">
      <div className="card-head"><h3>Notificaciones</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>Elegi como y sobre que queres recibir avisos en TechAsset.</p>

      <div className="notif-pref-row">
        <div className="notif-pref-text">
          <strong>Notificaciones push</strong>
          <span>En este dispositivo. Llegan aunque no tengas la app abierta.</span>
          {!pushAvailable && <span className="notif-pref-warn">El servidor no tiene push configurado.</span>}
        </div>
        {pushSubscribed
          ? <span className="badge available">Activadas</span>
          : <button type="button" className="btn btn-primary" disabled={busy || !pushAvailable} onClick={activarPush}>{busy ? 'Activando...' : 'Activar'}</button>}
      </div>

      <div className="notif-pref-row">
        <div className="notif-pref-text">
          <strong>Avisos por mail</strong>
          <span>Recibi un correo cuando te asignen algo o haya novedades.</span>
        </div>
        <button type="button" role="switch" aria-checked={email} aria-label="Avisos por mail" className={`switch ${email ? 'is-on' : ''}`} onClick={toggleEmail}>
          <span className="switch-knob" />
        </button>
      </div>

      <div className="notif-type-grid">
        {TYPE_OPTIONS.map(option => (
          <button
            key={option.key}
            type="button"
            className={`notif-type-card ${types[option.key] ? 'is-on' : ''}`}
            aria-pressed={types[option.key]}
            onClick={() => toggleType(option.key)}
          >
            <span className="notif-type-copy">
              <strong>{option.title}</strong>
              <span>{option.text}</span>
            </span>
            <span className="notif-type-state">{types[option.key] ? 'Activo' : 'Pausado'}</span>
          </button>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        En iPhone, para recibir push primero instala la app desde Compartir / Agregar a pantalla de inicio.
      </p>

      {msg && <div className="tool-info" style={{ marginTop: 10 }}>{msg}</div>}
      {err && <div className="tool-error" style={{ marginTop: 10 }}>{err}</div>}
    </section>
  );
}

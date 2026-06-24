import { useEffect, useState } from 'react';
import { enableBrowserPush, getNotificationPrefs, setNotificationEmailPref } from '../../services/notificationsApi';

export function NotificationsPanel() {
  const [email, setEmail] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    getNotificationPrefs()
      .then(p => { setEmail(p.email); setPushSubscribed(p.pushSubscribed); setPushAvailable(p.pushAvailable); })
      .catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => { if (msg || err) { const t = setTimeout(() => { setMsg(''); setErr(''); }, 3500); return () => clearTimeout(t); } }, [msg, err]);

  const activarPush = async () => {
    setBusy(true); setErr(''); setMsg('');
    const r = await enableBrowserPush();
    if (r.ok) { setPushSubscribed(true); setMsg('Notificaciones push activadas ✓'); }
    else setErr(r.error || 'No se pudo activar.');
    setBusy(false);
  };

  const toggleEmail = async () => {
    const next = !email;
    setEmail(next);
    try { await setNotificationEmailPref(next); setMsg(next ? 'Te vamos a avisar por mail ✓' : 'Avisos por mail desactivados'); }
    catch { setEmail(!next); setErr('No se pudo guardar.'); }
  };

  return (
    <section className="card">
      <div className="card-head"><h3>Notificaciones</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>Elegí cómo querés que te avisemos cuando carguen tareas, tickets o haya novedades.</p>

      <div className="notif-pref-row">
        <div className="notif-pref-text">
          <strong>Notificaciones push</strong>
          <span>En este dispositivo (celular o compu). Llegan aunque no tengas la app abierta.</span>
          {!pushAvailable && <span className="notif-pref-warn">El servidor no tiene push configurado.</span>}
        </div>
        {pushSubscribed
          ? <span className="badge available">Activadas ✓</span>
          : <button type="button" className="btn btn-primary" disabled={busy || !pushAvailable} onClick={activarPush}>{busy ? 'Activando…' : 'Activar'}</button>}
      </div>

      <div className="notif-pref-row">
        <div className="notif-pref-text">
          <strong>Avisos por mail</strong>
          <span>Recibí un correo cuando te asignen algo o haya novedades.</span>
        </div>
        <button type="button" role="switch" aria-checked={email} aria-label="Avisos por mail" className={`switch ${email ? 'is-on' : ''}`} onClick={toggleEmail}>
          <span className="switch-knob" />
        </button>
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        📱 En iPhone, para recibir push primero instalá la app: <strong>Compartir → Agregar a pantalla de inicio</strong>, y abrila desde el ícono.
      </p>

      {msg && <div className="tool-info" style={{ marginTop: 10 }}>{msg}</div>}
      {err && <div className="tool-error" style={{ marginTop: 10 }}>{err}</div>}
    </section>
  );
}

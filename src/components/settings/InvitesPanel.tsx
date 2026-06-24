import { useEffect, useState } from 'react';
import { createInvite, getInvites, getSiteSettings, revokeInvite, type Invite } from '../../services/authApi';
import { Button } from '../layout/Button';

const DEFAULT_TURNOS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'];

export function InvitesPanel({ consultationMode }: { consultationMode: boolean }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<string[]>(['Administrador', 'Asistente', 'Consulta']);
  const [turnos, setTurnos] = useState<string[]>(DEFAULT_TURNOS);
  const [role, setRole] = useState('Consulta');
  const [turno, setTurno] = useState('Sin turno');
  const [email, setEmail] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastLink, setLastLink] = useState('');
  const [lastEmailSent, setLastEmailSent] = useState<boolean | null>(null);

  const load = () => getInvites().then(r => setInvites(r.items || [])).catch(() => {});
  useEffect(() => {
    load();
    getSiteSettings().then(r => {
      const cfg = (r.settings as Record<string, unknown>)?.['roles.config'];
      if (Array.isArray(cfg) && cfg.length) {
        const names = cfg.map(x => String((x as { name?: string }).name || '')).filter(Boolean);
        setRoles(names);
        setRole(names.find(n => n !== 'Administrador') || names[0]);
      }
      const sh = (r.settings as Record<string, unknown>)?.['shift.options'];
      if (Array.isArray(sh) && sh.length) setTurnos(sh.map(String));
    }).catch(() => {});
  }, []);

  const generate = async () => {
    setBusy(true);
    setError('');
    setLastLink('');
    setLastEmailSent(null);
    try {
      const response = await createInvite({ role, turno, email: email.trim() || undefined, expiresInDays });
      setLastLink(response.invite.registerUrl);
      setLastEmailSent(response.emailSent);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    await revokeInvite(id).catch(() => {});
    load();
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };

  return (
    <section className="card">
      <div className="card-head"><h3>Invitaciones</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>Generá un código de un solo uso para que alguien se registre con un rol y turno definidos.</p>
      <div className="grid-2">
        <label>Rol
          <select className="input" value={role} disabled={consultationMode} onChange={e => setRole(e.target.value)}>
            {roles.map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>Turno
          <select className="input" value={turno} disabled={consultationMode} onChange={e => setTurno(e.target.value)}>
            {turnos.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="grid-2">
        <label>Mail (opcional, para enviar la invitación)
          <input className="input" type="email" value={email} disabled={consultationMode} onChange={e => setEmail(e.target.value)} placeholder="persona@colegio.edu.ar" />
        </label>
        <label>Vence en (días)
          <input className="input" type="number" min={1} max={90} value={expiresInDays} disabled={consultationMode} onChange={e => setExpiresInDays(Number(e.target.value) || 14)} />
        </label>
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <Button variant="primary" disabled={busy || consultationMode} onClick={generate}>{busy ? 'Generando…' : 'Generar invitación'}</Button>
      </div>
      {error && <div className="tool-error">{error}</div>}
      {lastLink && (
        <div className="tool-info" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Link: <code>{lastLink}</code></span>
          <Button className="mini-action-btn" onClick={() => copy(lastLink)}>Copiar link</Button>
          {lastEmailSent === true && <span>· mail enviado ✓</span>}
          {lastEmailSent === false && email === '' && <span>· compartí el link</span>}
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="compact-table">
          <thead><tr><th>Código</th><th>Rol</th><th>Turno</th><th>Estado</th><th>Mail</th><th></th></tr></thead>
          <tbody>
            {invites.map(inv => (
              <tr key={inv.id}>
                <td><code>{inv.code}</code></td>
                <td>{inv.role}</td>
                <td>{inv.turno}</td>
                <td>{inv.status}</td>
                <td>{inv.email || '-'}</td>
                <td>{inv.status === 'Activa' && !consultationMode && <Button className="mini-action-btn" onClick={() => revoke(inv.id)}>Revocar</Button>}</td>
              </tr>
            ))}
            {!invites.length && <tr><td colSpan={6} className="empty-state">Todavía no generaste invitaciones.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

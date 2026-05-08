import { useState } from 'react';
import type { AuthUser, SiteInfo } from '../../types';
import { login } from '../../services/authApi';
import { Button } from '../layout/Button';

export function LoginPage({ onReady }: { onReady: (session: { user: AuthUser; sites: SiteInfo[] }) => void }) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [turno, setTurno] = useState('Sin turno');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await login({ email, nombre, turno, siteCode: localStorage.getItem('techasset_active_site') || 'NFPT' });
      if (!session.authenticated || !session.user || !session.sites?.length) throw new Error('No se pudo iniciar sesión.');
      onReady({ user: session.user, sites: session.sites });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <div className="card-head">
          <div>
            <h3>TechAsset</h3>
            <p className="muted">Ingresá con un mail autorizado.</p>
          </div>
        </div>
        <label>Mail
          <input className="input" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="usuario@northfield.edu.ar" />
        </label>
        <label>Nombre
          <input className="input" value={nombre} onChange={event => setNombre(event.target.value)} placeholder="Tu nombre" />
        </label>
        <label>Turno
          <select className="input" value={turno} onChange={event => setTurno(event.target.value)}>
            <option>Sin turno</option>
            <option>Mañana</option>
            <option>Tarde</option>
            <option>Todo el día</option>
          </select>
        </label>
        {error && <div className="tool-error">{error}</div>}
        <div className="actions">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Ingresando...' : 'Ingresar'}</Button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Usuario inicial si no configuraste whitelist: admin@northfield.local</p>
      </form>
    </main>
  );
}

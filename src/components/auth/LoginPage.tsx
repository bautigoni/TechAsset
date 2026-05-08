import { useEffect, useState } from 'react';
import type { AuthUser, SiteInfo } from '../../types';
import { getRegisterOptions, login, register } from '../../services/authApi';
import { Button } from '../layout/Button';

type AuthMode = 'landing' | 'login' | 'register';

const ROLES = ['Jefe TIC', 'Asistente TIC mañana', 'Asistente TIC tarde', 'Consulta', 'Otro'];

export function LoginPage({ mode, onMode, onReady }: {
  mode: AuthMode;
  onMode: (mode: AuthMode) => void;
  onReady: (session: { user: AuthUser; sites: SiteInfo[] }) => void;
}) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [turno, setTurno] = useState('Sin turno');
  const [role, setRole] = useState('Consulta');
  const [siteCode, setSiteCode] = useState('');
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'register') return;
    getRegisterOptions()
      .then(response => {
        setSites(response.sites || []);
        setSiteCode(current => current || response.sites?.[0]?.siteCode || '');
      })
      .catch(() => setError('No se pudieron cargar las sedes disponibles.'));
  }, [mode]);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await login({ email, nombre, turno });
      if (!session.authenticated || !session.user || !session.sites?.length) throw new Error('No se pudo iniciar sesión.');
      onReady({ user: session.user, sites: session.sites });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await register({ email, nombre, role, siteCode, turno });
      if (!session.authenticated || !session.user || !session.sites?.length) throw new Error('No se pudo completar el registro.');
      onReady({ user: session.user, sites: session.sites });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar el registro.');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'landing') {
    return (
      <main className="auth-shell">
        <section className="auth-hero">
          <nav className="auth-nav">
            <img src="/northfield_logo.png" alt="Northfield" />
            <div>
              <button type="button" onClick={() => onMode('register')}>Registrarse</button>
              <button type="button" className="primary" onClick={() => onMode('login')}>Login</button>
            </div>
          </nav>
          <div className="auth-hero-content">
            <span>Northfield School</span>
            <h1>TechAsset</h1>
            <p>Gestión TIC por sede, inventario y préstamos en un entorno seguro.</p>
            <div className="auth-hero-actions">
              <Button variant="primary" onClick={() => onMode('login')}>Iniciar sesión</Button>
              <Button onClick={() => onMode('register')}>Registrarse</Button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <form className="card login-card auth-card" onSubmit={mode === 'login' ? submitLogin : submitRegister}>
        <div className="card-head">
          <div>
            <h3>{mode === 'login' ? 'Login' : 'Registrarse'}</h3>
            <p className="muted">{mode === 'login' ? 'Ingresá con tu mail autorizado.' : 'Solicitá acceso a tu sede TIC.'}</p>
          </div>
          <button type="button" className="auth-link-btn" onClick={() => onMode('landing')}>TechAsset</button>
        </div>
        <label>Mail
          <input className="input" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="usuario@northfield.edu.ar" />
        </label>
        <label>Nombre
          <input className="input" required={mode === 'register'} value={nombre} onChange={event => setNombre(event.target.value)} placeholder="Tu nombre" />
        </label>
        {mode === 'register' && (
          <>
            <label>Sede
              <select className="input" required value={siteCode} onChange={event => setSiteCode(event.target.value)}>
                {sites.map(site => <option key={site.siteCode} value={site.siteCode}>{site.nombre || site.siteCode}</option>)}
              </select>
            </label>
            <label>Rol solicitado
              <select className="input" value={role} onChange={event => setRole(event.target.value)}>
                {ROLES.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
          </>
        )}
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
          <Button type="button" onClick={() => onMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta'}
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Procesando...' : mode === 'login' ? 'Ingresar' : 'Registrarme'}</Button>
        </div>
      </form>
    </main>
  );
}

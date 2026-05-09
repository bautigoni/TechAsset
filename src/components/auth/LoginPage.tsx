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
  const activeMode = mode === 'register' ? 'register' : 'login';
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [turno, setTurno] = useState('Sin turno');
  const [role, setRole] = useState('Consulta');
  const [siteCode, setSiteCode] = useState('');
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (activeMode !== 'register') return;
    getRegisterOptions()
      .then(response => {
        setSites(response.sites || []);
        setSiteCode(current => current || response.sites?.[0]?.siteCode || '');
      })
      .catch(() => setError('No se pudieron cargar las sedes disponibles.'));
  }, [activeMode]);

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

  return (
    <main className="auth-shell">
      <section className="auth-stage">
        <div className="auth-brand-panel">
          <div className="auth-logo-mark">
            <img src="/northfield_logo.png" alt="Northfield" />
          </div>
          <div>
            <h1>TechAsset</h1>
            <h2>Gestión tecnológica escolar</h2>
            <p>Dispositivos, aulas, tareas e inventarios TIC en un solo lugar.</p>
          </div>
        </div>

        <form className={`auth-card auth-card-${activeMode}`} onSubmit={activeMode === 'register' ? submitRegister : submitLogin}>
          <div className={`auth-tabs ${activeMode}`}>
            <button type="button" className={activeMode === 'login' ? 'active' : ''} onClick={() => onMode('login')}>Iniciar sesión</button>
            <button type="button" className={activeMode === 'register' ? 'active' : ''} onClick={() => onMode('register')}>Registrarse</button>
          </div>
          <div key={activeMode} className="auth-form-body">
            <div className="auth-card-head">
              <h3>{activeMode === 'register' ? 'Solicitar acceso' : 'Ingresar'}</h3>
              <p>{activeMode === 'register' ? 'El acceso queda asociado únicamente a la sede elegida.' : 'Usá el mail autorizado para tu sede.'}</p>
            </div>

            {activeMode === 'register' && (
              <label>Nombre
                <input className="input" required value={nombre} onChange={event => setNombre(event.target.value)} placeholder="Tu nombre" />
              </label>
            )}
            <label>Mail
              <input className="input" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="usuario@northfield.edu.ar" />
            </label>
            {activeMode === 'register' ? (
              <>
                <label>Sede
                  <select className="input" required value={siteCode} onChange={event => setSiteCode(event.target.value)}>
                    {sites.map(site => <option key={site.siteCode} value={site.siteCode}>{site.nombre || site.siteCode}</option>)}
                  </select>
                </label>
                <div className="grid-2">
                  <label>Rol solicitado
                    <select className="input" value={role} onChange={event => setRole(event.target.value)}>
                      {ROLES.map(item => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label>Turno
                    <select className="input" value={turno} onChange={event => setTurno(event.target.value)}>
                      <option>Sin turno</option>
                      <option>Mañana</option>
                      <option>Tarde</option>
                      <option>Todo el día</option>
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <label>Contraseña
                <input className="input" type="password" value="" placeholder="Acceso por mail autorizado" disabled />
              </label>
            )}
            {error && <div className="tool-error">{error}</div>}
            <div className="actions auth-actions">
              <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Procesando...' : activeMode === 'register' ? 'Solicitar acceso' : 'Ingresar'}</Button>
            </div>
            <p className="auth-footnote">La sesión mantiene la separación de datos por sede.</p>
          </div>
        </form>
      </section>
    </main>
  );
}

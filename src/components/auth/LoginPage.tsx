import { useEffect, useState } from 'react';
import type { AuthUser, SiteInfo } from '../../types';
import { getGoogleOAuthConfig, login, register } from '../../services/authApi';

type AuthMode = 'landing' | 'login' | 'register';

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function translateGoogleError(slug: string): string {
  switch (slug) {
    case 'google_no_code': return 'No volvimos con un código válido de Google. Probá de nuevo.';
    case 'google_bad_state': return 'La sesión con Google expiró o fue manipulada. Probá de nuevo.';
    case 'google_verify_failed': return 'No pudimos verificar tu cuenta de Google. Probá de nuevo o usá el login por mail.';
    case 'google_unavailable': return 'El login con Google no está disponible en este momento.';
    case 'not_authorized': return 'Tu mail de Google no está autorizado. Pedile a tu administrador que te agregue como usuario permitido.';
    case 'account_pending': return 'Tu cuenta está pendiente de aprobación.';
    case 'account_disabled': return 'Tu cuenta fue rechazada o está desactivada.';
    default: return 'No pudimos iniciar sesión con Google. Probá de nuevo.';
  }
}

export function LoginPage({ mode, onMode, onReady }: {
  mode: AuthMode;
  onMode: (mode: AuthMode) => void;
  onReady: (session: { user: AuthUser; sites: SiteInfo[] }) => void;
}) {
  const activeMode = mode === 'register' ? 'register' : 'login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // El link de invitación llega como /register?code=TA-XXXX-XXXX
  // Los errores de Google OAuth llegan como /login?error=<slug>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('code');
    if (fromUrl) setCode(fromUrl.toUpperCase());
    const errSlug = params.get('error');
    if (errSlug) setError(translateGoogleError(errSlug));
    if (fromUrl || errSlug) {
      // Limpiar la URL para que refresh no repita el error.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Saber si el backend tiene Google OAuth configurado para mostrar/ocultar el botón.
  useEffect(() => {
    getGoogleOAuthConfig().then(r => setGoogleEnabled(Boolean(r.enabled))).catch(() => setGoogleEnabled(false));
  }, []);

  const loginWithGoogle = () => {
    window.location.href = '/api/auth/google/login';
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const session = await login({ email, password, nombre });
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
    setSuccess('');
    try {
      const session = await register({ email, nombre, code, password });
      setSuccess(session.message || 'Cuenta creada. Ya podés iniciar sesión con tu mail y contraseña.');
      setEmail('');
      setNombre('');
      setCode('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar el registro.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <header className="auth-top">
        <button type="button" className="auth-back" onClick={() => onMode('landing')}>← TechAsset</button>
      </header>

      <form className="auth-panel" onSubmit={activeMode === 'register' ? submitRegister : submitLogin}>
        <div className="auth-heading">
          <h1>{activeMode === 'register' ? 'Crear cuenta' : 'Ingresar'}</h1>
          <p>{activeMode === 'register' ? 'Necesitás un código de invitación de tu administrador.' : 'Usá tu mail autorizado para tu sede.'}</p>
        </div>

        <div className="auth-switch" role="tablist">
          <button type="button" role="tab" aria-selected={activeMode === 'login'} className={activeMode === 'login' ? 'active' : ''} onClick={() => onMode('login')}>Iniciar sesión</button>
          <button type="button" role="tab" aria-selected={activeMode === 'register'} className={activeMode === 'register' ? 'active' : ''} onClick={() => onMode('register')}>Registrarse</button>
        </div>

        <div className="auth-fields">
          {activeMode === 'register' && (
            <label>Nombre
              <input className="auth-input" required value={nombre} onChange={event => setNombre(event.target.value)} placeholder="Tu nombre" autoComplete="name" />
            </label>
          )}
          <label>Mail
            <input className="auth-input" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="usuario@colegio.edu.ar" autoComplete="email" inputMode="email" />
          </label>
          <label>Contraseña
            <input className="auth-input" type="password" required minLength={6} value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" autoComplete={activeMode === 'register' ? 'new-password' : 'current-password'} />
            {activeMode === 'login' && <span className="auth-hint">¿Primera vez? La contraseña que pongas queda registrada para tu cuenta.</span>}
          </label>
          {activeMode === 'register' && (
            <label>Código de invitación
              <input className="auth-input" required value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="TA-XXXX-XXXX" autoComplete="off" />
            </label>
          )}

          {error && <div className="auth-msg is-error">{error}</div>}
          {success && <div className="auth-msg is-ok">{success}</div>}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Procesando…' : activeMode === 'register' ? 'Crear cuenta' : 'Ingresar'}
          </button>

          {activeMode === 'login' && googleEnabled && (
            <>
              <div className="auth-sep"><span>o</span></div>
              <button className="auth-google" type="button" onClick={loginWithGoogle}>
                <GoogleMark />
                Continuar con Google
              </button>
            </>
          )}
        </div>

        <p className="auth-note">Cada sede ve solo sus datos.</p>
      </form>
    </main>
  );
}

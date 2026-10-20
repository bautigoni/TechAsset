import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Clock, Mail } from 'lucide-react';
import type { AuthUser, SiteInfo } from '../../types';
import { confirmPasswordLink, getGoogleOAuthConfig, login, register, requestPasswordLink } from '../../services/authApi';
import { ApiError } from '../../services/apiClient';
import { Button, Collapse, Input } from '../../ui';
import { AuthFrame } from './AuthFrame';

export type AuthMode = 'landing' | 'login' | 'register';
type Screen = 'login' | 'register' | 'password';
type Tone = 'bad' | 'warn' | 'info' | 'ok';
type Message = { tone: Tone; text: string; n: number };

function translateUrlError(slug: string): { tone: Tone; text: string } {
  switch (slug) {
    case 'session_expired': return { tone: 'warn', text: 'Tu sesión venció. Volvé a ingresar.' };
    case 'google_no_code': return { tone: 'bad', text: 'No volvimos con un código válido de Google. Probá de nuevo.' };
    case 'google_bad_state': return { tone: 'bad', text: 'La sesión con Google expiró o fue manipulada. Probá de nuevo.' };
    case 'google_verify_failed': return { tone: 'bad', text: 'No pudimos verificar tu cuenta de Google. Probá de nuevo o usá el login por mail.' };
    case 'google_unavailable': return { tone: 'bad', text: 'El login con Google no está disponible en este momento.' };
    case 'not_authorized': return { tone: 'bad', text: 'Tu mail de Google no está autorizado. Pedile a tu administrador que te agregue como usuario permitido.' };
    case 'account_pending': return { tone: 'warn', text: 'Tu cuenta está pendiente de aprobación.' };
    case 'account_disabled': return { tone: 'bad', text: 'Tu cuenta fue rechazada o está desactivada.' };
    default: return { tone: 'bad', text: 'No pudimos iniciar sesión con Google. Probá de nuevo.' };
  }
}

/** Mensaje entendible: sin "Failed to fetch" ni códigos HTTP sueltos. */
function explain(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof TypeError || (error instanceof Error && /fetch|network|load failed/i.test(error.message))) {
    return 'No hay conexión con el servidor. Revisá tu internet y probá de nuevo.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

const ICONS: Record<Tone, ReactNode> = {
  bad: <CircleAlert size={16} strokeWidth={1.6} aria-hidden="true" />,
  warn: <Clock size={16} strokeWidth={1.6} aria-hidden="true" />,
  info: <Mail size={16} strokeWidth={1.6} aria-hidden="true" />,
  ok: <CircleCheck size={16} strokeWidth={1.6} aria-hidden="true" />
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const TITLES: Record<Screen, string> = { login: 'Entrá a TechAsset', register: 'Creá tu cuenta', password: 'Elegí tu contraseña' };
const SUBTITLES: Record<Screen, string> = {
  login: 'Préstamos, equipos, agenda y tareas del equipo TIC.',
  register: 'Con el código que te pasó el Jefe TIC de tu sede. Tu rol ya viene en la invitación.',
  password: 'Este link sirve una sola vez y vence a la hora de pedirlo.'
};

/**
 * Ingreso, registro con código y "Elegí tu contraseña" (link de un solo uso).
 * Todo en línea: los avisos van arriba del formulario, los campos de cada modo
 * se abren y cierran con alto suave (Collapse) y lo escrito nunca se pierde
 * ante un error. El botón queda ocupado mientras trabaja (sin doble envío).
 */
export function LoginPage({ mode, onMode, onReady, linkSite = '', onForgetLinkSite }: {
  mode: AuthMode;
  onMode: (mode: AuthMode) => void;
  onReady: (session: { user: AuthUser; sites: SiteInfo[] }) => void;
  /** Sede del link con el que se llegó (/sede/NFPT/...) o de la sesión que venció. */
  linkSite?: string;
  onForgetLinkSite?: () => void;
}) {
  // Lo que trae la URL se lee una vez y se limpia (no queda el token a la vista).
  const [initial] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { code: (params.get('code') || '').toUpperCase(), error: params.get('error') || '', token: params.get('password') || '' };
  });
  const [passwordToken, setPasswordToken] = useState(initial.token);
  const screen: Screen = passwordToken ? 'password' : mode === 'register' ? 'register' : 'login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [nombre, setNombre] = useState('');
  const [code, setCode] = useState(initial.code);
  const codeFromLink = Boolean(initial.code) && code === initial.code;
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'' | 'submit' | 'forgot' | 'google'>('');
  const [message, setMessageState] = useState<Message | null>(() => (initial.error ? { ...translateUrlError(initial.error), n: 1 } : null));
  const [fieldError, setFieldError] = useState<{ field: 'email' | 'repeat' | 'password' | 'code'; text: string } | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const repeatRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const say = (tone: Tone, text: string) => setMessageState(current => ({ tone, text, n: (current?.n || 0) + 1 }));
  const clear = () => { setMessageState(null); setFieldError(null); };

  useEffect(() => {
    if (initial.code || initial.error || initial.token) {
      const path = window.location.pathname;
      window.history.replaceState(window.history.state, '', path);
    }
  }, [initial]);

  useEffect(() => {
    let alive = true;
    getGoogleOAuthConfig().then(r => { if (alive) setGoogleEnabled(Boolean(r.enabled)); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const switchTo = (next: 'login' | 'register') => {
    if (next === screen) return;
    // El aviso de sesión vencida / link de Google sigue valiendo en Ingresar; el resto se limpia.
    setFieldError(null);
    setMessageState(current => (current && current.tone === 'warn' && next === 'login' ? current : null));
    onMode(next);
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = screen === 'login' ? 'register' : 'login';
    switchTo(next);
    tabRefs.current[next === 'login' ? 0 : 1]?.focus();
  };

  const submitLogin = async () => {
    try {
      const session = await login({ email: email.trim(), password });
      if (!session.authenticated || !session.user || !session.sites?.length) throw new Error('No se pudo iniciar sesión.');
      onReady({ user: session.user, sites: session.sites });
    } catch (err) {
      // Cuenta sin contraseña: no es un error, le llegó un link por mail.
      if (err instanceof ApiError && err.data.passwordLinkSent) say('info', err.message);
      else say('bad', explain(err, 'No se pudo iniciar sesión.'));
    }
  };

  const submitRegister = async () => {
    try {
      const response = await register({ email: email.trim(), nombre: nombre.trim(), code: code.trim(), password });
      // La cuenta queda activa: se pasa a Ingresar con el mail (y la contraseña) ya puestos.
      setNombre('');
      setCode('');
      onMode('login');
      say('ok', response.message || 'Cuenta creada. Ya podés iniciar sesión con tu mail.');
    } catch (err) {
      say('bad', explain(err, 'No se pudo completar el registro.'));
    }
  };

  const submitNewPassword = async () => {
    if (password !== passwordRepeat) {
      setFieldError({ field: 'repeat', text: 'Las contraseñas no coinciden.' });
      say('bad', 'Las contraseñas no coinciden.');
      repeatRef.current?.focus();
      return;
    }
    try {
      const response = await confirmPasswordLink(passwordToken, password);
      setPasswordToken('');
      setPasswordRepeat('');
      if (response.email) setEmail(response.email);
      onMode('login');
      say('ok', response.message || 'Listo, ya podés entrar con tu nueva contraseña.');
      window.setTimeout(() => passwordRef.current?.focus(), 0);
    } catch (err) {
      say('bad', explain(err, 'No se pudo guardar la contraseña.'));
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    clear();
    if (screen !== 'password' && !email.includes('@')) {
      setFieldError({ field: 'email', text: 'Escribí tu mail completo (con @).' });
      emailRef.current?.focus();
      return;
    }
    if (screen === 'register' && !code.trim()) {
      setFieldError({ field: 'code', text: 'Pegá o escribí el código de invitación.' });
      return;
    }
    if (password.length < 6) {
      setFieldError({ field: 'password', text: screen === 'login' ? 'Escribí tu contraseña (mínimo 6 caracteres).' : 'Mínimo 6 caracteres.' });
      passwordRef.current?.focus();
      return;
    }
    setBusy('submit');
    try {
      if (screen === 'password') await submitNewPassword();
      else if (screen === 'register') await submitRegister();
      else await submitLogin();
    } finally {
      setBusy('');
    }
  };

  const forgotPassword = async () => {
    if (busy) return;
    clear();
    if (!email.includes('@')) {
      setFieldError({ field: 'email', text: 'Escribí tu mail acá y tocá de nuevo "Olvidé mi contraseña".' });
      emailRef.current?.focus();
      return;
    }
    setBusy('forgot');
    try {
      const response = await requestPasswordLink(email.trim());
      say('info', response.message);
    } catch (err) {
      say('bad', explain(err, 'No se pudo pedir el link.'));
    } finally {
      setBusy('');
    }
  };

  const loginWithGoogle = () => {
    setBusy('google');
    window.location.href = `/api/auth/google/login${linkSite ? `?site=${encodeURIComponent(linkSite)}` : ''}`;
  };

  const passwordToggle = (
    <button type="button" className="auth-reveal" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
      {showPassword ? 'Ocultar' : 'Mostrar'}
    </button>
  );
  const err = (field: 'email' | 'repeat' | 'password' | 'code') => (fieldError?.field === field ? fieldError.text : undefined);
  const isLogin = screen === 'login';
  const isRegister = screen === 'register';
  const isPassword = screen === 'password';

  return (
    <AuthFrame onHome={isPassword ? undefined : () => onMode('landing')}>
      <div className="auth-column">
        <Collapse open={Boolean(linkSite) && !isPassword} className="auth-site" anchor={false} reveal={false}>
          <span className="auth-mark auth-mark--lg" aria-hidden="true">{linkSite.slice(0, 2)}</span>
          <span className="auth-site-text">
            <span className="auth-site-label">Entrás a</span>
            <span className="auth-site-name">la sede <span className="g-mono">{linkSite}</span></span>
          </span>
          <button type="button" className="auth-link" onClick={onForgetLinkSite}>Usar mi sede por defecto</button>
        </Collapse>

        {/* Ingresar y Registro apilan sus dos títulos en la misma celda (el que
            no va, invisible): el bloque mide lo del más alto y cambiar de
            pestaña no corre las pestañas. */}
        {isPassword ? (
          <div className="auth-heading">
            <h1>{TITLES.password}</h1>
            <p>{SUBTITLES.password}</p>
          </div>
        ) : (
          <div className="auth-heading auth-heading--stack">
            {(['login', 'register'] as const).map(key => (
              <div key={key} className={key === screen ? 'is-on' : 'is-off'} aria-hidden={key !== screen || undefined}>
                {key === screen ? <h1>{TITLES[key]}</h1> : <p className="auth-heading-title">{TITLES[key]}</p>}
                <p>{SUBTITLES[key]}</p>
              </div>
            ))}
          </div>
        )}

        {/* Al pasar a "Elegí tu contraseña" (y al volver) las pestañas se pliegan suave, no desaparecen de golpe. */}
        <Collapse open={!isPassword} lazy={false} anchor={false} reveal={false}>
          <div className="auth-tabs" role="tablist" aria-label="Cómo querés entrar" onKeyDown={onTabKey}>
            <button ref={node => { tabRefs.current[0] = node; }} type="button" role="tab" id="auth-tab-login" aria-controls="auth-form" aria-selected={isLogin} tabIndex={isLogin ? 0 : -1} className={isLogin ? 'is-on' : ''} onClick={() => switchTo('login')}>Ingresar</button>
            <button ref={node => { tabRefs.current[1] = node; }} type="button" role="tab" id="auth-tab-register" aria-controls="auth-form" aria-selected={isRegister} tabIndex={isRegister ? 0 : -1} className={isRegister ? 'is-on' : ''} onClick={() => switchTo('register')}>Tengo un código</button>
          </div>
        </Collapse>

        <form
          id="auth-form"
          className="auth-card"
          role={isPassword ? undefined : 'tabpanel'}
          aria-labelledby={isPassword ? undefined : isLogin ? 'auth-tab-login' : 'auth-tab-register'}
          aria-label={isPassword ? TITLES.password : undefined}
          onSubmit={onSubmit}
          noValidate
          data-scanner-ignore
        >
          <Collapse open={Boolean(message)} anchor={false} unmountOnClose>
            {message && (
              <div
                key={message.n}
                className={`auth-msg auth-msg--${message.tone}${message.tone === 'bad' ? ' t-input is-shaking' : ''}`}
                role={message.tone === 'bad' ? 'alert' : 'status'}
              >
                {ICONS[message.tone]}
                <span>{message.text}</span>
              </div>
            )}
          </Collapse>

          {/* Registro: código y nombre arriba del mail. */}
          <Collapse open={isRegister} className="auth-fields" anchor={false} reveal={false}>
            <Input
              label="Código de invitación"
              className="auth-code"
              value={code}
              onValueChange={value => { setCode(value.toUpperCase()); if (fieldError?.field === 'code') setFieldError(null); }}
              placeholder="TA-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              hint={codeFromLink ? 'Lo tomamos del link de tu invitación.' : 'Te llega por mail o te lo pasa el Jefe TIC.'}
              error={err('code')}
            />
            <Input
              label="Nombre"
              value={nombre}
              onValueChange={setNombre}
              placeholder="Como te van a ver los demás"
              autoComplete="name"
            />
          </Collapse>

          <Collapse open={!isPassword} className="auth-fields" anchor={false} reveal={false} lazy={false}>
            <Input
              ref={emailRef}
              label="Mail"
              type="email"
              inputMode="email"
              autoComplete={isRegister ? 'email' : 'username'}
              value={email}
              onValueChange={value => { setEmail(value); if (fieldError?.field === 'email') setFieldError(null); }}
              placeholder="nombre@colegio.edu.ar"
              hint={isRegister ? 'Si la invitación es para un mail puntual, tiene que ser ese.' : undefined}
              error={err('email')}
            />
          </Collapse>

          <Input
            ref={passwordRef}
            label={isPassword ? 'Contraseña nueva' : 'Contraseña'}
            type={showPassword ? 'text' : 'password'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password}
            onValueChange={value => { setPassword(value); if (fieldError?.field === 'password') setFieldError(null); }}
            suffix={passwordToggle}
            hint={isLogin ? undefined : 'Mínimo 6 caracteres.'}
            error={err('password')}
            autoFocus={isPassword}
          />

          <Collapse open={isPassword} className="auth-fields" anchor={false} reveal={false}>
            <Input
              ref={repeatRef}
              label="Repetila"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={passwordRepeat}
              onValueChange={value => { setPasswordRepeat(value); if (fieldError?.field === 'repeat') setFieldError(null); }}
              error={err('repeat')}
            />
          </Collapse>

          <Collapse open={isLogin} className="auth-fields auth-fields--tight" anchor={false} reveal={false} lazy={false}>
            <button type="button" className="auth-link auth-forgot" onClick={() => void forgotPassword()} disabled={!isLogin || Boolean(busy)} aria-busy={busy === 'forgot' || undefined}>
              {busy === 'forgot' ? 'Pidiendo el link…' : 'Olvidé mi contraseña o es mi primera vez'}
            </button>
          </Collapse>

          <Button type="submit" variant="primary" block loading={busy === 'submit'} disabled={Boolean(busy) && busy !== 'submit'} loadingLabel={isRegister ? 'Creando la cuenta…' : isPassword ? 'Guardando…' : 'Ingresando…'}>
            {isRegister ? 'Crear cuenta' : isPassword ? 'Guardar contraseña' : 'Ingresar'}
          </Button>

          <Collapse open={isLogin && googleEnabled} className="auth-fields" anchor={false} reveal={false}>
            <div className="auth-or" aria-hidden="true">o</div>
            <Button block icon={<GoogleMark />} onClick={loginWithGoogle} loading={busy === 'google'} loadingLabel="Abriendo Google…" disabled={Boolean(busy) && busy !== 'google'}>
              Continuar con Google
            </Button>
          </Collapse>

          <Collapse open={isPassword} className="auth-fields auth-fields--tight" anchor={false} reveal={false} lazy={false}>
            <button type="button" className="auth-link auth-back" disabled={!isPassword} onClick={() => { setPasswordToken(''); setPasswordRepeat(''); clear(); onMode('login'); }}>
              Volver a ingresar
            </button>
          </Collapse>
        </form>

        <div className="auth-notes">
          <span>{isRegister ? '¿Ya tenés cuenta? Tocá Ingresar.' : '¿No tenés cuenta? Pedile un código de invitación al Jefe TIC de tu sede.'}</span>
          <span>Cada sede ve solo sus datos.</span>
        </div>
      </div>
    </AuthFrame>
  );
}

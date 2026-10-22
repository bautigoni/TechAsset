import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Clock, Mail } from 'lucide-react';
import type { AuthUser, SiteInfo } from '../../types';
import { confirmPasswordLink, getGoogleOAuthConfig, login, register, requestPasswordLink } from '../../services/authApi';
import { ApiError } from '../../services/apiClient';
import { Button, Collapse, Input } from '../../ui';
import { newPasswordProblem, PASSWORD_HINT, PASSWORD_MAX } from '../../utils/passwordPolicy';
import { AuthFrame } from './AuthFrame';
import { PRIVACY_PATH, onPrivacyLinkClick } from './publicRoutes';

export type AuthMode = 'landing' | 'login' | 'register';
type Screen = 'login' | 'register' | 'password';
type Tone = 'bad' | 'warn' | 'info' | 'ok';
type Message = { tone: Tone; text: string; n: number };
type Field = 'email' | 'repeat' | 'password' | 'code' | 'forgot';
type FieldErrors = Partial<Record<Field, string>>;

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
  // Credenciales: además de qué pasó, qué hacer.
  if (error instanceof ApiError && error.status === 401) return `${error.message || 'Mail o contraseña incorrectos.'} Revisalos o tocá "Olvidé mi contraseña".`;
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
const FORGOT_SENT = 'Si el mail tiene acceso a TechAsset, te llega un link para elegir tu contraseña. Revisá tu casilla (y spam).';

/**
 * Ingreso, registro con código y "Elegí tu contraseña" (link de un solo uso).
 * Todo en línea: los avisos van arriba del formulario, los campos de cada modo
 * se abren y cierran con alto suave (Collapse) y lo escrito nunca se pierde
 * ante un error. El botón queda ocupado mientras trabaja (sin doble envío).
 * Registro OK: la sesión queda abierta y se entra directo (onReady).
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
    return {
      code: (params.get('code') || '').toUpperCase().slice(0, 20),
      error: params.get('error') || '',
      token: params.get('password') || '',
      // Después de Cerrar sesión (App recarga en /login?sesion=cerrada).
      loggedOut: params.get('sesion') === 'cerrada'
    };
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
  const [message, setMessageState] = useState<Message | null>(() => (
    initial.error ? { ...translateUrlError(initial.error), n: 1 }
      : initial.loggedOut ? { tone: 'ok', text: 'Sesión cerrada. En este navegador no quedó tu nombre ni lo que tenías a medio cargar.', n: 1 }
        : null
  ));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [googleEnabled, setGoogleEnabled] = useState(false);
  // "Olvidé mi contraseña": primero se confirma a qué mail mandar el link (antes salía al toque).
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const repeatRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const forgotRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const refs: Partial<Record<Field, typeof emailRef>> = { email: emailRef, password: passwordRef, repeat: repeatRef, code: codeRef, forgot: forgotRef };

  const say = (tone: Tone, text: string) => setMessageState(current => ({ tone, text, n: (current?.n || 0) + 1 }));
  const clear = () => { setMessageState(null); setFieldErrors({}); };
  const clearField = (field: Field) => setFieldErrors(current => (current[field] ? { ...current, [field]: undefined } : current));
  /** Marca todos los campos con problema a la vez; el foco va al primero. */
  const flag = (errors: FieldErrors, order: Field[]) => {
    setFieldErrors(errors);
    const first = order.find(field => errors[field]);
    if (first) refs[first]?.current?.focus();
  };
  /** Error del server que es de un campo (field: 'password' | 'code' | 'email'): va debajo de ese campo. */
  const fieldFromServer = (error: unknown) => {
    const field = error instanceof ApiError ? String(error.data.field || '') : '';
    if (field === 'password' || field === 'code' || field === 'email') flag({ [field]: (error as ApiError).message }, [field]);
  };

  useEffect(() => {
    if (initial.code || initial.error || initial.token || initial.loggedOut) {
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
    setFieldErrors({});
    setForgotOpen(false);
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
      const session = await register({ email: email.trim(), nombre: nombre.trim(), code: code.trim(), password });
      // La cuenta queda activa y la sesión abierta: se entra directo a la app.
      if (!session.authenticated || !session.user || !session.sites?.length) throw new Error('La cuenta se creó, pero no pudimos abrir la sesión. Ingresá con tu mail y tu contraseña.');
      onReady({ user: session.user, sites: session.sites });
    } catch (err) {
      say('bad', explain(err, 'No se pudo completar el registro.'));
      fieldFromServer(err);
    }
  };

  const submitNewPassword = async () => {
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
      fieldFromServer(err);
    }
  };

  /** Lo que falta o está mal, todo junto (no de a un campo por intento). */
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (screen === 'register' && !code.trim()) errors.code = 'Pegá o escribí el código de invitación.';
    if (screen !== 'password' && !email.includes('@')) errors.email = 'Escribí tu mail completo (con @).';
    if (screen === 'login') {
      if (!password) errors.password = 'Escribí tu contraseña.';
    } else {
      // Contraseña nueva (registro o link): la misma regla que el server, avisada antes de mandar.
      const problem = newPasswordProblem(password, { email, nombre });
      if (problem) errors.password = problem;
      else if (screen === 'password' && password !== passwordRepeat) errors.repeat = 'Las contraseñas no coinciden.';
    }
    return errors;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    clear();
    const errors = validate();
    if (Object.keys(errors).length) {
      flag(errors, ['code', 'email', 'password', 'repeat']);
      if (errors.repeat && !errors.password) say('bad', 'Las contraseñas no coinciden.');
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

  const toggleForgot = () => {
    if (busy) return;
    const next = !forgotOpen;
    setForgotOpen(next);
    clearField('forgot');
    // Se propone el mail que ya está escrito; se puede corregir antes de mandar.
    if (next) {
      setForgotEmail(current => current || email.trim());
      window.setTimeout(() => forgotRef.current?.focus({ preventScroll: true }), 0);
    }
  };

  const sendForgot = async () => {
    if (busy) return;
    const target = forgotEmail.trim();
    if (!target.includes('@')) {
      flag({ forgot: 'Escribí el mail de tu cuenta (con @).' }, ['forgot']);
      return;
    }
    setMessageState(null);
    setBusy('forgot');
    try {
      const response = await requestPasswordLink(target);
      setForgotOpen(false);
      if (!email.trim()) setEmail(target);
      say('info', response.message || FORGOT_SENT);
    } catch (err) {
      flag({ forgot: explain(err, 'No se pudo pedir el link.') }, ['forgot']);
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
  const err = (field: Field) => fieldErrors[field];
  const isLogin = screen === 'login';
  const isRegister = screen === 'register';
  const isPassword = screen === 'password';
  const privacyLink = <a className="auth-link auth-link--inline" href={PRIVACY_PATH} onClick={onPrivacyLinkClick}>Privacidad y uso</a>;

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
              ref={codeRef}
              label="Código de invitación"
              className="auth-code"
              value={code}
              onValueChange={value => { setCode(value.toUpperCase()); clearField('code'); }}
              placeholder="TA-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              hint={codeFromLink ? 'Lo tomamos del link de tu invitación.' : 'Te llega por mail o te lo pasa el Jefe TIC.'}
              error={err('code')}
            />
            <Input
              label="Nombre"
              value={nombre}
              onValueChange={setNombre}
              placeholder="Como te van a ver los demás"
              autoComplete="name"
              maxLength={120}
              hint="Con este nombre quedan firmados tus préstamos y cambios."
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
              onValueChange={value => { setEmail(value); clearField('email'); }}
              placeholder="nombre@colegio.edu.ar"
              maxLength={254}
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
            onValueChange={value => { setPassword(value); clearField('password'); }}
            suffix={passwordToggle}
            maxLength={PASSWORD_MAX}
            hint={isLogin ? undefined : PASSWORD_HINT}
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
              maxLength={PASSWORD_MAX}
              onValueChange={value => { setPasswordRepeat(value); clearField('repeat'); }}
              error={err('repeat')}
            />
          </Collapse>

          <Collapse open={isLogin} className="auth-fields auth-fields--tight" anchor={false} reveal={false} lazy={false}>
            <button type="button" className="auth-link auth-forgot" onClick={toggleForgot} disabled={!isLogin || Boolean(busy)} aria-expanded={forgotOpen} aria-controls="auth-forgot">
              Olvidé mi contraseña
            </button>
          </Collapse>

          {/* Antes el link mandaba el mail al toque: ahora se confirma a qué casilla. */}
          <Collapse open={isLogin && forgotOpen} id="auth-forgot" className="auth-forgot-box">
            <p className="auth-forgot-text">Te mandamos un link para elegir una contraseña nueva. Sirve una sola vez y vence en 1 hora.</p>
            <Input
              ref={forgotRef}
              label="¿A qué mail te lo mandamos?"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={forgotEmail}
              maxLength={254}
              onValueChange={value => { setForgotEmail(value); clearField('forgot'); }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void sendForgot(); } }}
              placeholder="nombre@colegio.edu.ar"
              error={err('forgot')}
            />
            <div className="auth-forgot-actions">
              <Button variant="secondary" loading={busy === 'forgot'} loadingLabel="Mandando…" disabled={Boolean(busy) && busy !== 'forgot'} onClick={() => void sendForgot()}>Mandar el link</Button>
              <Button variant="ghost" disabled={busy === 'forgot'} onClick={toggleForgot}>Cancelar</Button>
            </div>
            <p className="auth-forgot-note">¿Tu cuenta es de antes y nunca elegiste una contraseña? Es este mismo link.</p>
          </Collapse>

          <Button type="submit" variant="primary" block loading={busy === 'submit'} disabled={Boolean(busy) && busy !== 'submit'} loadingLabel={isRegister ? 'Creando la cuenta…' : isPassword ? 'Guardando…' : 'Ingresando…'}>
            {isRegister ? 'Crear cuenta y entrar' : isPassword ? 'Guardar contraseña' : 'Ingresar'}
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
          <span>{isRegister ? 'Lo que hagas en la sede queda firmado con tu nombre y lo ve tu equipo.' : 'Cada sede ve solo sus datos.'} Qué se guarda y cómo pedir la baja: {privacyLink}.</span>
        </div>
      </div>
    </AuthFrame>
  );
}

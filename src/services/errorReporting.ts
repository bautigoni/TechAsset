/**
 * Errores del front a Sentry, APAGADO por defecto: se prende solo si el build
 * tiene `VITE_SENTRY_DSN`. Sin DSN esta función no hace nada y el cliente
 * (`sentryLite.ts`) no se baja: la entrada de la app no paga nada. Con DSN se
 * importa diferido, después del primer render.
 */
const DSN: string = import.meta.env.VITE_SENTRY_DSN || '';

export function initErrorReporting() {
  if (!DSN) return;
  const start = () => { void import('./sentryLite').then(module => module.startSentryLite(DSN)).catch(() => undefined); };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 2000);
}

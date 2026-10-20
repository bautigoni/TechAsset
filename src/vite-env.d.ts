/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTO_REFRESH_SECONDS?: string;
  /** DSN público de Sentry para el front. Vacío = reporte de errores apagado. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

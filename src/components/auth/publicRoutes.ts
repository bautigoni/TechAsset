import type { MouseEvent } from 'react';

/**
 * Páginas públicas: se ven con o sin sesión y fuera del shell (App.tsx).
 *   /privacidad          → "Privacidad y uso"
 *   cualquier otra ruta  → "Esta página no existe" (el server además responde 404)
 * Este módulo es chico y va en la entrada: lo usan la landing, el ingreso,
 * Configuración › Cuenta y App; las pantallas en sí viajan en su chunk.
 */
export type PublicPageKind = 'privacy' | 'notfound';

export const PRIVACY_PATH = '/privacidad';
export const PUBLIC_PAGE_EVENT = 'techasset:public-page';

// Rutas de la app (mismas que SPA_PATHS en server/index.js): lo demás no existe.
const APP_PATHS = /^\/(|login|register|release-notes|sede(\/.*)?|configuracion(\/.*)?)\/?$/i;

export function readPublicPageFromUrl(pathname = window.location.pathname): PublicPageKind | null {
  if (/^\/privacidad\/?$/i.test(pathname)) return 'privacy';
  return APP_PATHS.test(pathname) ? null : 'notfound';
}

/** Abre Privacidad sin recargar (Atrás vuelve a donde estaba). */
export function openPrivacy() {
  window.history.pushState({ techasset: true, publicPage: 'privacy' }, '', PRIVACY_PATH);
  window.dispatchEvent(new CustomEvent(PUBLIC_PAGE_EVENT));
}

/** onClick de un <a href="/privacidad">: con Ctrl/Cmd/Shift o clic del medio deja abrir otra pestaña. */
export function onPrivacyLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openPrivacy();
}

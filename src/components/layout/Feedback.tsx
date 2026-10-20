/**
 * Lo que quedó del feedback viejo (confirmDialog, promptDialog y los toasts
 * flotantes se reemplazaron por patrones en línea de src/ui: InlineConfirm,
 * useInlinePrompt, StatusLine / pushStatus).
 */

/** Sin red el navegador tira "Failed to fetch" / "Load failed" / "NetworkError…": nadie entiende eso. */
const NETWORK_ERROR = /failed to fetch|load failed|networkerror|network request failed/i;

/** Mensaje de error legible de cualquier excepción. */
export function errorMessage(reason: unknown, fallback = 'No se pudo completar la acción.') {
  if (reason instanceof Error && NETWORK_ERROR.test(reason.message)) return 'Sin conexión con el servidor. Probá de nuevo cuando vuelva.';
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

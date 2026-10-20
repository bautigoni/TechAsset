/**
 * Lo que quedó del feedback viejo (confirmDialog, promptDialog y los toasts
 * flotantes se reemplazaron por patrones en línea de src/ui: InlineConfirm,
 * useInlinePrompt, StatusLine / pushStatus).
 */

/** Mensaje de error legible de cualquier excepción. */
export function errorMessage(reason: unknown, fallback = 'No se pudo completar la acción.') {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

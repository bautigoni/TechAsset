/**
 * Lo que quedó del feedback viejo (confirmDialog, promptDialog y los toasts
 * flotantes se reemplazaron por patrones en línea de src/ui: InlineConfirm,
 * useInlinePrompt, StatusLine / pushStatus).
 */
import { networkErrorMessage } from '../../services/apiClient';

/**
 * Sin red el navegador tira "Failed to fetch" / "Load failed" / "NetworkError…":
 * nadie entiende eso. Las llamadas de la API ya llegan traducidas (NetworkError
 * de apiClient); esto cubre las que usan `fetch` directo.
 */
const NETWORK_ERROR = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

/** Mensaje de error legible de cualquier excepción. */
export function errorMessage(reason: unknown, fallback = 'No se pudo completar la acción.') {
  if (reason instanceof Error && NETWORK_ERROR.test(reason.message)) return networkErrorMessage();
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

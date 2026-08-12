export type ScanTone = 'info' | 'warn' | 'error';

const TONE_CLASS: Record<ScanTone, string> = {
  error: 'tool-error',
  warn: 'tool-warning',
  info: 'tool-info'
};

/**
 * Mensaje del escaneo de préstamos.
 *
 * Antes el texto se reemplazaba en silencio: escaneabas tres equipos seguidos
 * y el cartel cambiaba sin que nada avisara que era un mensaje nuevo. Ahora
 * cada mensaje entra animado, y los de error usan la receta
 * `error-state-shake` de transitions.dev — el movimiento dice "esto no salió"
 * antes de que llegues a leerlo, que es justo lo que hace falta cuando estás
 * escaneando en serie y mirando el lector, no la pantalla.
 *
 * El `key` remonta el nodo en cada mensaje distinto: es lo que rearranca la
 * animación aunque el tono no cambie (dos errores seguidos también sacuden).
 */
export function ScanMessage({ tone, text, success = false }: { tone: ScanTone; text: string; success?: boolean }) {
  return (
    <div
      key={`${tone}:${text}`}
      className={`${TONE_CLASS[tone]} t-msg-enter ${tone === 'error' ? 't-input is-shaking' : ''}`.trim()}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {success && <SuccessCheck />}
      {text}
    </div>
  );
}

/**
 * Receta `success-check`. El tilde se dibuja solo mientras entra con un giro
 * corto. Va únicamente en el cierre de prestar y devolver: es el momento en
 * que el operario necesita confirmación sin llegar a leer el cartel. Meterlo
 * en cada guardado le sacaría todo el peso.
 */
function SuccessCheck() {
  return (
    <span className="t-success-check" data-state="in" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 9.5 L7.5 13 L14 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

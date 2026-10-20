import { useEffect, useRef } from 'react';
import { parseScannedCode } from '../utils/normalizeSearch';

/**
 * Escáner USB / pistola desde cualquier pantalla.
 *
 * Un lector "tipea" la etiqueta muy rápido (5–30 ms entre teclas) y suele
 * cerrar con Enter. Una persona, aun rápida, tarda 80 ms o más entre teclas.
 * Antes bastaban dos teclas en menos de 120 ms con un dígito para mandarte a
 * Préstamos; ahora se exige ritmo de lector:
 *   - la ráfaga se corta si pasan más de GAP_MS entre dos teclas;
 *   - vale si tiene al menos MIN_CHARS caracteres y el promedio entre teclas
 *     es de AVG_MS o menos;
 *   - se procesa con Enter (que entonces no hace nada más) o a los IDLE_MS
 *     sin teclas.
 * Nunca escucha dentro de un campo editable, de un role=dialog, de un
 * formulario ni de un contenedor con [data-scanner-ignore]
 * (franjas de la barra superior, Ctrl K, asistente, formularios en línea).
 */
const GAP_MS = 80;
const AVG_MS = 50;
const MIN_CHARS = 4;
const IDLE_MS = 120;

export const SCANNER_IGNORE_SELECTOR = 'form, [role="dialog"], [data-scanner-ignore]';

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

export function useGlobalScanner(enabled: boolean, onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let first = 0;
    let last = 0;
    let timer: number | null = null;

    const reset = () => { buffer = ''; first = 0; last = 0; };
    const valid = () => buffer.length >= MIN_CHARS && (last - first) / (buffer.length - 1) <= AVG_MS;
    const flush = () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      const ok = valid();
      const raw = buffer;
      reset();
      if (!ok) return false;
      const parsed = parseScannedCode(raw).trim();
      if (!parsed || parsed.length < 2 || !/\d/.test(parsed)) return false;
      onScanRef.current(parsed);
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) { reset(); return; }
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(target) || target?.closest?.(SCANNER_IGNORE_SELECTOR)) { reset(); return; }
      const now = performance.now();
      if (event.key === 'Enter') {
        if (buffer && valid()) {
          event.preventDefault();
          event.stopPropagation();
          flush();
        } else {
          reset();
        }
        return;
      }
      if (event.key.length !== 1) return;
      if (buffer && now - last > GAP_MS) reset();
      if (!buffer) first = now;
      buffer += event.key;
      last = now;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(flush, IDLE_MS);
    };

    // Captura: el Enter de una ráfaga válida no llega a ningún botón con foco.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);
}

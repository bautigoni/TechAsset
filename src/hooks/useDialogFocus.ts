import { useEffect, type RefObject } from 'react';

// Pila de diálogos abiertos: solo el de arriba responde a Escape y a Tab.
const openDialogs: object[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Manejo de foco de cualquier diálogo (el Modal genérico, el de aula, el de
 * novedades): al abrir el foco entra (al campo con autoFocus si hay, si no al
 * primer control), Tab no se escapa hacia la página de atrás, Escape cierra
 * solo el de arriba de la pila y al cerrar el foco vuelve a lo que lo abrió.
 *
 * `skipInitial` saltea un selector al elegir el primer control (p. ej. la X).
 */
export function useDialogFocus(cardRef: RefObject<HTMLElement | null>, onEscape: () => void, active = true, skipInitial = '.modal-close') {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) {
      const fields = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = fields.find(element => !element.matches(skipInitial)) || card;
      first.focus({ preventScroll: true });
    }
    return () => { if (previous && document.contains(previous)) previous.focus({ preventScroll: true }); };
    // Solo al abrir/cerrar el diálogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const token = {};
    openDialogs.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const index = openDialogs.indexOf(token);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, [cardRef, onEscape, active]);
}

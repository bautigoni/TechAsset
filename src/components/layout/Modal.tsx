import { useEffect, useId, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useCloseChoreography } from '../../hooks/useMountTransition';

type ModalSize = 'default' | 'wide' | 'full';

// Pila de modales montados: el último es el que responde a Escape y a Tab.
const openModals: object[] = [];

// Tiene que coincidir con --modal-close-dur en motion.css: es lo que
// esperamos antes de desmontar para que se vea la animación de salida.
const CLOSE_MS = 150;

const SIZE_CLASS: Record<ModalSize, string> = {
  default: '',
  wide: 'wide',
  full: 'wide-modal'
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, children, onClose, wide = false, size }: PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean; size?: ModalSize }>) {
  // Cerrar es en dos tiempos: se marca .is-closing, corre la salida y recién
  // ahí se le avisa al padre para que desmonte.
  const { stateClass, requestClose } = useCloseChoreography(onClose, CLOSE_MS);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // Foco: al abrir va adentro del modal (al campo con autoFocus si hay, si no
  // al primer control) y al cerrar vuelve a lo que lo abrió. Sin esto, con
  // teclado o lector de pantalla el foco quedaba detrás del modal.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) {
      const fields = card.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = Array.from(fields).find(element => !element.classList.contains('modal-close')) || card;
      first.focus({ preventScroll: true });
    }
    return () => { if (previous && document.contains(previous)) previous.focus({ preventScroll: true }); };
  }, []);

  // Escape cierra y Tab da la vuelta dentro del modal. Con modales encimados
  // solo responde el último abierto.
  useEffect(() => {
    const token = {};
    openModals.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
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
      const index = openModals.indexOf(token);
      if (index >= 0) openModals.splice(index, 1);
    };
  }, [requestClose]);

  const sizeClass = SIZE_CLASS[size ?? (wide ? 'wide' : 'default')];

  return createPortal(
    <div
      className={`modal t-modal ${stateClass}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      // Solo el backdrop cierra: un click que empezó adentro de la tarjeta
      // (seleccionar texto y soltar afuera) no tiene que cerrar el modal.
      onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <div className={`modal-card ${sizeClass}`.trim()} ref={cardRef} tabIndex={-1}>
        <div className="card-head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn modal-close" type="button" onClick={requestClose} aria-label="Cerrar">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

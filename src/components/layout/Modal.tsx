import { useEffect, useId, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useCloseChoreography } from '../../hooks/useMountTransition';
import { useDialogFocus } from '../../hooks/useDialogFocus';

type ModalSize = 'default' | 'wide' | 'full';


// Tiene que coincidir con --modal-close-dur en motion.css: es lo que
// esperamos antes de desmontar para que se vea la animación de salida.
const CLOSE_MS = 150;

const SIZE_CLASS: Record<ModalSize, string> = {
  default: '',
  wide: 'wide',
  full: 'wide-modal'
};


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

  // Foco adentro al abrir, Tab no se escapa, Escape cierra el de arriba y al
  // cerrar el foco vuelve a quien lo abrió (useDialogFocus, compartido con los
  // diálogos propios de aulas y novedades).
  useDialogFocus(cardRef, requestClose);

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

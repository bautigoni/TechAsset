import { useEffect, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

type ModalSize = 'default' | 'wide' | 'full';

// Pila de modales montados: el último es el que responde a Escape.
const openModals: object[] = [];

const SIZE_CLASS: Record<ModalSize, string> = {
  default: '',
  wide: 'wide',
  full: 'wide-modal'
};

export function Modal({ title, children, onClose, wide = false, size }: PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean; size?: ModalSize }>) {
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // Escape cierra, igual que el modal de aula. Antes el único escape era la "x".
  // Con modales encimados solo responde el último abierto, para no cerrar los
  // dos de un tecleo.
  useEffect(() => {
    const token = {};
    openModals.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openModals[openModals.length - 1] !== token) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const index = openModals.indexOf(token);
      if (index >= 0) openModals.splice(index, 1);
    };
  }, [onClose]);

  const sizeClass = SIZE_CLASS[size ?? (wide ? 'wide' : 'default')];

  return createPortal(
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      // Solo el backdrop cierra: un click que empezó adentro de la tarjeta
      // (seleccionar texto y soltar afuera) no tiene que cerrar el modal.
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className={`modal-card ${sizeClass}`.trim()}>
        <div className="card-head">
          <h3>{title}</h3>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

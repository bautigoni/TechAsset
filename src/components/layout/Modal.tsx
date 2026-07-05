import { useEffect, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

type ModalSize = 'default' | 'wide' | 'full';

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

  const sizeClass = SIZE_CLASS[size ?? (wide ? 'wide' : 'default')];

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true">
      <div className={`modal-card ${sizeClass}`.trim()}>
        <div className="card-head">
          <h3>{title}</h3>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Cerrar">x</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

import { useEffect, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, children, onClose, wide = false }: PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean }>) {
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true">
      <div className={`modal-card ${wide ? 'wide' : ''}`}>
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

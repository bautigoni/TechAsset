import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

type ModalSize = 'default' | 'wide' | 'full';

// Pila de modales montados: el último es el que responde a Escape.
const openModals: object[] = [];

// Tiene que coincidir con --modal-close-dur en motion.css: es lo que
// esperamos antes de desmontar para que se vea la animación de salida.
const CLOSE_MS = 150;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const SIZE_CLASS: Record<ModalSize, string> = {
  default: '',
  wide: 'wide',
  full: 'wide-modal'
};

export function Modal({ title, children, onClose, wide = false, size }: PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean; size?: ModalSize }>) {
  // Fase de la animación. `entering` sólo dura un frame: hace falta que el
  // nodo se pinte en su estado inicial (escalado y con blur) antes de que
  // llegue .is-open, si no el browser no tiene qué interpolar.
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');
  const closingRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Cerrar es en dos tiempos: marcamos .is-closing, dejamos correr la
  // salida y recién ahí avisamos al padre para que desmonte. El ref evita
  // que un doble click (o Escape + backdrop) dispare dos timers.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) { onClose(); return; }
    setPhase('closing');
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

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
      requestClose();
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
      className={`modal t-modal ${phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : ''}`.trim()}
      role="dialog"
      aria-modal="true"
      // Solo el backdrop cierra: un click que empezó adentro de la tarjeta
      // (seleccionar texto y soltar afuera) no tiene que cerrar el modal.
      onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <div className={`modal-card ${sizeClass}`.trim()}>
        <div className="card-head">
          <h3>{title}</h3>
          <button className="icon-btn" type="button" onClick={requestClose} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

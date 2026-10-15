import type { KeyboardEvent } from 'react';

/**
 * Props para que un elemento que no es <button> (fila de tabla, tarjeta) se
 * pueda usar con teclado y lo anuncie un lector de pantalla como botón: foco
 * con Tab, Enter/Espacio lo activan. Las teclas que vienen de un control de
 * adentro (un botón dentro de la fila) se ignoran para no activar los dos.
 */
export function clickableProps(onActivate: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    }
  };
}

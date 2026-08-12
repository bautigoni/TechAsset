import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { TextSwap } from './TextSwap';

type Variant = 'primary' | 'success' | 'secondary' | 'danger' | 'ghost' | 'outline';

export function Button({ children, className = '', variant = 'secondary', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
  // Los botones de la app cambian de etiqueta mientras trabajan
  // (`{busy ? 'Guardando…' : 'Guardar'}`). Envolviendo acá el label, ese cambio
  // pasa a animarse en TODA la app sin tocar un solo llamador.
  //
  // Sólo cuando el hijo es un string: un botón con ícono + texto se deja
  // intacto, porque meter un span alrededor de nodos arbitrarios rompe
  // layouts que este componente no controla.
  const label = typeof children === 'string' ? <TextSwap>{children}</TextSwap> : children;

  return (
    <button type="button" className={`btn btn-${variant} ${className}`.trim()} {...props}>
      {label}
    </button>
  );
}

import type { ReactNode } from 'react';
import { cx } from '../../ui';

/**
 * Estado vacío del Inicio: compacto, con un ícono sobrio, una frase clara y,
 * si corresponde, la acción siguiente (REGLAS-UX "vacíos diseñados"). Nunca
 * una línea suelta en una tarjeta alta.
 */
export function DashEmpty({ icon, title, description, actions, flat, className }: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Sin borde superior propio (va pegado a la cabecera de la tarjeta). */
  flat?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('dash-empty', flat && 'dash-empty--flat', className)} role="status">
      <span className="dash-empty-icon" aria-hidden="true">{icon}</span>
      <span className="dash-empty-text">
        <span className="dash-empty-title">{title}</span>
        {description && <span className="dash-empty-desc">{description}</span>}
      </span>
      {actions && <span className="dash-empty-acts">{actions}</span>}
    </div>
  );
}

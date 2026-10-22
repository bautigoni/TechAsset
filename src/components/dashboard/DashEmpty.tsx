import type { ReactNode } from 'react';
import { SkeletonText, cx } from '../../ui';

/**
 * Mientras no llegó la primera respuesta: renglones de esqueleto en el lugar
 * del contenido, nunca el vacío ("Sin actividades hoy", "Sin movimientos")
 * antes de saber que está vacío (QA ronda 1, ítem 17).
 */
export function DashLoading({ label, lines = 3, flat, className }: { label: string; lines?: number; flat?: boolean; className?: string }) {
  return (
    <div className={cx('dash-loading', flat && 'dash-loading--flat', className)} role="status" aria-busy="true" aria-label={label}>
      <SkeletonText lines={lines} />
    </div>
  );
}

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

import type { ReactNode } from 'react';

/**
 * Vacío diseñado y compacto (REGLAS-UX "vacíos diseñados"): ícono sobrio, una
 * frase clara y la acción siguiente. Una fila, no una tarjeta alta con una
 * línea suelta. Lo usan Herramientas, Accesos rápidos y Caja chica.
 */
export function CompactEmpty({ icon, title, description, action, className = '' }: { icon: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`tl-empty ${className}`.trim()} role="status">
      <span className="tl-empty-icon" aria-hidden="true">{icon}</span>
      <span className="tl-empty-text">
        <span className="tl-empty-title">{title}</span>
        {description && <span className="tl-empty-desc">{description}</span>}
      </span>
      {action && <span className="tl-empty-action">{action}</span>}
    </div>
  );
}

import type { ReactNode } from 'react';
import { cx } from '../../ui';

/** Vacío diseñado y compacto: ícono sobrio + frase + (si hay) la acción siguiente. */
export function KbEmpty({ icon, title, description, action, className }: { icon: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('kb-empty', className)} role="status">
      <span className="kb-empty-icon" aria-hidden="true">{icon}</span>
      <span className="kb-empty-text">
        <span className="kb-empty-title">{title}</span>
        {description && <span className="kb-empty-desc">{description}</span>}
      </span>
      {action && <span className="kb-empty-action">{action}</span>}
    </div>
  );
}

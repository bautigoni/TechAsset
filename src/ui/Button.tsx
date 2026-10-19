import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from './icons';
import { cx } from './util';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Variantes del Button viejo (`components/layout/Button`), aceptadas para migrar sin tocar llamadas. */
type LegacyVariant = 'success' | 'outline';
export type ButtonSize = 'sm' | 'md';

const LEGACY: Record<LegacyVariant, ButtonVariant> = { success: 'primary', outline: 'secondary' };

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant | LegacyVariant;
  size?: ButtonSize;
  /** Muestra el spinner, deshabilita y marca aria-busy. El ancho no salta. */
  loading?: boolean;
  /** Texto mientras carga ("Guardando…"). Si no viene, queda el mismo label. */
  loadingLabel?: ReactNode;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  /** Ocupa todo el ancho disponible. */
  block?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = 'secondary', size = 'md', loading = false, loadingLabel, icon, iconEnd, block, className, children, disabled, type = 'button', ref, ...rest }: ButtonProps) {
  const resolved = (LEGACY as Record<string, ButtonVariant>)[variant] || (variant as ButtonVariant);
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ui-btn', `ui-btn--${resolved}`, size === 'sm' && 'ui-btn--sm', block && 'ui-btn--block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <span className="ui-btn-icon">{icon}</span> : null}
      {(children !== undefined || loadingLabel) && <span className="ui-btn-label">{loading && loadingLabel ? loadingLabel : children}</span>}
      {iconEnd && !loading && <span className="ui-btn-icon">{iconEnd}</span>}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  /** Obligatorio: es el nombre accesible (no hay tooltip, la única capa flotante es la del texto truncado). */
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: ButtonSize;
  loading?: boolean;
  /** Para botones que alternan (p. ej. ★ importante). */
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ label, icon, variant = 'ghost', size = 'md', loading, pressed, className, disabled, type = 'button', ref, ...rest }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx('ui-icon-btn', `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm', loading && 'is-loading', className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
    </button>
  );
}

/** Tecla de atajo (`↵`, `Ctrl K`, `/`). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('ui-kbd', className)}>{children}</kbd>;
}

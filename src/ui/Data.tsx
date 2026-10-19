import type { CSSProperties, ReactNode } from 'react';
import { Button } from './Button';
import { IconAlert, IconRetry } from './icons';
import { cx } from './util';

/* ══ StatusText: estado sin pastilla ══
   El estado normal no se marca (text-2). Solo lo que pide atención va en
   color, sin fondo, y siempre con texto (nunca solo el color). */

export type StatusTextTone = 'normal' | 'muted' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';

export function StatusText({ tone = 'normal', mono, strong, children, className }: { tone?: StatusTextTone; mono?: boolean; strong?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx('ui-stext', `ui-stext--${tone}`, mono && 'ui-mono', strong && 'ui-stext--strong', className)}>{children}</span>;
}

/** Tono por antigüedad de un préstamo: hoy normal, 1 día atención, 2+ mal. */
export function ageTone(days: number): StatusTextTone {
  if (days >= 2) return 'bad';
  if (days >= 1) return 'warn';
  return 'normal';
}

/* ══ Ring: anillo fino de libres/total (reemplaza barras de progreso) ══
   Arco neutro; ámbar si queda ≤ 20 %; rojo (pista entera) si no queda nada. */

export type RingProps = {
  value: number;
  total: number;
  /** 32–40 px (default 36). */
  size?: number;
  /** Texto al lado: nombre arriba y "18 de 25" abajo. */
  label?: ReactNode;
  /** Muestra "value de total" al lado (default true si hay label). */
  showNumbers?: boolean;
  /** Palabra que sigue al número en el nombre accesible ("libres"). */
  unit?: string;
  /** Umbral de atención (default 0.2). */
  warnAt?: number;
  className?: string;
};

export function ringTone(value: number, total: number, warnAt = 0.2): 'normal' | 'warn' | 'bad' {
  if (total > 0 && value <= 0) return 'bad';
  if (total > 0 && value / total <= warnAt) return 'warn';
  return 'normal';
}

export function Ring({ value, total, size = 36, label, showNumbers = Boolean(label), unit = 'libres', warnAt = 0.2, className }: RingProps) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const tone = ringTone(value, total, warnAt);
  const name = `${typeof label === 'string' ? `${label}: ` : ''}${value} de ${total} ${unit}`;
  return (
    <span className={cx('ui-ring', `ui-ring--${tone}`, className)} role="img" aria-label={name}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="ui-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        {ratio > 0 && (
          <circle
            className="ui-ring-arc"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * ratio} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {(label || showNumbers) && (
        <span className="ui-ring-text" aria-hidden="true">
          {label && <span className="ui-ring-label">{label}</span>}
          {showNumbers && <span className="ui-ring-nums"><b className="g-num">{value}</b> de <span className="g-num">{total}</span></span>}
        </span>
      )}
    </span>
  );
}

/* ══ Skeleton ══ */

const delay = (index: number): CSSProperties => ({ animationDelay: `calc(${index} * var(--g-dur-fast))` });

export function Skeleton({ width = '100%', height = '1rem', radius, index = 0, className }: { width?: number | string; height?: number | string; radius?: 'sm' | 'md' | 'pill'; index?: number; className?: string }) {
  return <span className={cx('ui-skel', radius && `ui-skel--${radius}`, className)} aria-hidden="true" style={{ width, height, ...delay(index) }} />;
}

/** Renglones de texto con anchos variados (no parecen una tabla vacía). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['92%', '78%', '64%', '85%', '56%'];
  return (
    <span className={cx('ui-skel-text', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => <Skeleton key={index} width={widths[index % widths.length]} height="0.75rem" index={index} />)}
    </span>
  );
}

/** Filas de lista/tabla con la forma real (alias + etiqueta | quién). */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('ui-skel-rows', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-skel-row" key={index}>
          <Skeleton width={`${24 + ((index * 7) % 14)}%`} height="0.75rem" index={index} />
          <Skeleton width={`${16 + ((index * 5) % 12)}%`} height="0.75rem" index={index} />
        </div>
      ))}
    </div>
  );
}

/* ══ EmptyState / ErrorState ══ */

/**
 * Vacío diseñado: "dice qué pasa, no 'sin datos'". Una frase concreta, un
 * ícono sobrio opcional (sin caja ni color) y, si aplica, la acción siguiente.
 * `compact` = una fila (ícono · texto · acción) para tarjetas y franjas: nunca
 * una línea perdida en una tarjeta alta ni un hueco grande.
 *
 *   <EmptyState compact icon={<Bell size={18} />} title="No tenés notificaciones." description="Te avisamos acá cuando pase algo." />
 */
export function EmptyState({ title, description, action, icon, compact, center, className }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Ícono de 18–24 px (lucide o `icons`); va en gris, sin fondo. */
  icon?: ReactNode;
  compact?: boolean;
  /** Centrado (para un bloque vacío que ocupa toda una columna). */
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('ui-empty', compact && 'ui-empty--compact', center && 'ui-empty--center', className)} role="status">
      {icon && <span className="ui-empty-icon" aria-hidden="true">{icon}</span>}
      <span className="ui-empty-text">
        <span className="ui-empty-title">{title}</span>
        {description && <span className="ui-empty-desc">{description}</span>}
      </span>
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

/** Línea roja en el bloque, con Reintentar; los datos de antes siguen a la vista. */
export function ErrorState({ message, onRetry, retrying, updatedAt, className }: { message: ReactNode; onRetry?: () => void; retrying?: boolean; updatedAt?: ReactNode; className?: string }) {
  return (
    <div className={cx('ui-error', className)} role="alert">
      <span className="ui-status-icon" aria-hidden="true"><IconAlert size={14} /></span>
      <span className="ui-error-msg">{message}</span>
      {updatedAt && <span className="ui-error-when">{updatedAt}</span>}
      {onRetry && <Button size="sm" variant="secondary" icon={<IconRetry size={14} />} loading={retrying} onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

/* ══ Eyebrow / SectionHeader ══ */

export function Eyebrow({ children, className, as: Tag = 'span' }: { children: ReactNode; className?: string; as?: 'span' | 'p' | 'div' }) {
  return <Tag className={cx('ui-eyebrow', className)}>{children}</Tag>;
}

export function SectionHeader({ eyebrow, title, description, actions, as: Heading = 'h2', id, className }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  id?: string;
  className?: string;
}) {
  return (
    <header className={cx('ui-sechead', `ui-sechead--${Heading}`, className)}>
      <div className="ui-sechead-text">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Heading className="ui-sechead-title" id={id}>{title}</Heading>
        {description && <p className="ui-sechead-desc">{description}</p>}
      </div>
      {actions && <div className="ui-sechead-actions">{actions}</div>}
    </header>
  );
}

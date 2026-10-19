import type { ReactNode } from 'react';
import { CONDITION_VALUES } from '../../types';
import { cx } from '../../ui';
import { TruncatedText } from '../../ui/Truncated';
import { conditionTone } from './inventoryEntries';

/* Piezas chicas de la pantalla: chips de filtro/elección (texto con conteo en
   mono, sin puntitos ni fondos tintados) y el selector de condición. */

export function Chip({ pressed, onClick, count, tone, disabled, children, thumb, ariaLabel }: {
  pressed?: boolean;
  onClick: () => void;
  count?: ReactNode;
  /** Color del texto cuando no está elegido (Regular ámbar, Malo rojo). */
  tone?: 'normal' | 'muted' | 'warn' | 'bad';
  disabled?: boolean;
  children: ReactNode;
  thumb?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={cx('ivt-chip', tone && !pressed && `is-${tone}`)}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {thumb && <img className="ivt-chip-thumb" src={thumb} alt="" loading="lazy" />}
      {typeof children === 'string'
        ? <TruncatedText className="ivt-chip-label">{children}</TruncatedText>
        : <span className="ivt-chip-label">{children}</span>}
      {count !== undefined && <span className="ivt-count">{count}</span>}
    </button>
  );
}

export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={cx('ivt-chips', className)} role="group" aria-label={label}>{children}</div>;
}

/** Sin revisar + Excelente / Bueno / Regular / Malo, como chips que se eligen. */
export function ConditionChips({ value, onChange, disabled, label = 'Condición' }: {
  value: string;
  onChange: (condicion: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <ChipGroup label={label}>
      {['', ...CONDITION_VALUES].map(condicion => (
        <Chip
          key={condicion || 'sin'}
          pressed={value === condicion}
          tone={condicion ? conditionTone(condicion) : 'normal'}
          disabled={disabled}
          onClick={() => onChange(condicion)}
        >
          {condicion || 'Sin revisar'}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** Texto de estado sin pastilla, con el tono de la pantalla. */
export function Tx({ tone = 'normal', mono, strong, children, className }: { tone?: 'normal' | 'muted' | 'warn' | 'bad' | 'strong'; mono?: boolean; strong?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx('ivt-tx', `is-${tone}`, mono && 'ivt-mono', strong && 'is-bold', className)}>{children}</span>;
}

export function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

export const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

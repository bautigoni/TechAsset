import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { FieldShell, useFieldIds, type FieldProps } from './Field';
import { IconCheck, IconMinus } from './icons';
import { cx } from './util';

/* ── Checkbox propio ──────────────────────────────────────────────────────
   Borde gris; marcado = --g-check-bg con tilde --g-check-fg (nunca azul
   brillante). Es un <button role="checkbox">: el label va adentro, así toda
   la fila es tocable (44 px en touch) y no le pegan las reglas viejas de
   `input[type=checkbox]`. */

export type CheckboxProps = {
  checked: boolean;
  /** Estado mixto ("algunos"): se dibuja la raya y aria-checked="mixed". */
  indeterminate?: boolean;
  /** Recibe el evento para la gramática de selección (Shift+click = rango). */
  onCheckedChange?: (next: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** Obligatorio si no hay label visible (celda de tabla, "Todos"). */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'data-force'?: string;
};

export function Checkbox({ checked, indeterminate, onCheckedChange, label, description, ariaLabel, disabled, id, className, 'data-force': force }: CheckboxProps) {
  const state = indeterminate ? 'mixed' : checked;
  const on = indeterminate || checked;
  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={state}
      aria-label={ariaLabel}
      disabled={disabled}
      data-force={force}
      className={cx('ui-check', !label && 'ui-check--bare', className)}
      onClick={event => onCheckedChange?.(indeterminate ? true : !checked, event)}
      // Enter no tilda (como el nativo): dentro de un formulario es "enviar".
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
    >
      <span className={cx('ui-check-box', on && 'is-on')} aria-hidden="true">
        {indeterminate ? <IconMinus size={12} /> : checked ? <IconCheck size={12} /> : null}
      </span>
      {(label || description) && (
        <span className="ui-check-text">
          {label && <span className="ui-check-label">{label}</span>}
          {description && <span className="ui-check-desc">{description}</span>}
        </span>
      )}
    </button>
  );
}

/* ── Switch ─────────────────────────────────────────────────────────────── */

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  /** El texto a la izquierda y el switch al final de la fila (filas de Configuración). */
  labelPosition?: 'start' | 'end';
  loading?: boolean;
  id?: string;
  className?: string;
  'data-force'?: string;
};

export function Switch({ checked, onCheckedChange, label, description, ariaLabel, disabled, labelPosition = 'end', loading, id, className, 'data-force': force }: SwitchProps) {
  const track = <span className={cx('ui-switch-track', checked && 'is-on')} aria-hidden="true"><span className="ui-switch-thumb" /></span>;
  const text = (label || description) && (
    <span className="ui-check-text">
      {label && <span className="ui-check-label">{label}</span>}
      {description && <span className="ui-check-desc">{description}</span>}
    </span>
  );
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      data-force={force}
      className={cx('ui-switch', labelPosition === 'start' && 'ui-switch--start', !label && 'ui-check--bare', className)}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
    >
      {labelPosition === 'start' ? <>{text}{track}</> : <>{track}{text}</>}
    </button>
  );
}

/* ── Grupos con flechas (radio y segmentado) ────────────────────────────── */

export type ChoiceOption<V extends string = string> = {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  /** Contador al lado del label (mono, text-3). */
  count?: ReactNode;
};

/** Flechas / Home / End mueven y eligen (semántica de radio: la selección sigue al foco). */
function useRovingKeys<V extends string>(options: ChoiceOption<V>[], value: V | undefined, onChange: (value: V) => void) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent) => {
    const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter(index => index >= 0);
    if (!enabled.length) return;
    const current = Math.max(0, options.findIndex(option => option.value === value));
    const position = enabled.indexOf(current);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = enabled[(position + 1) % enabled.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = enabled[(position - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  // Solo el elegido (o el primero habilitado) entra en el orden de Tab.
  const tabStop = (() => {
    const selected = options.findIndex(option => option.value === value && !option.disabled);
    return selected >= 0 ? selected : options.findIndex(option => !option.disabled);
  })();
  return { refs, onKeyDown, tabStop };
}

export type RadioGroupProps<V extends string = string> = FieldProps & {
  value: V | undefined;
  onChange: (value: V) => void;
  options: ChoiceOption<V>[];
  ariaLabel?: string;
  direction?: 'row' | 'column';
  disabled?: boolean;
  id?: string;
};

export function RadioGroup<V extends string = string>({ value, onChange, options, ariaLabel, direction = 'column', disabled, id: idProp, label, hint, error, success, required, reserveHelp, className }: RadioGroupProps<V>) {
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  const { refs, onKeyDown, tabStop } = useRovingKeys(options, value, onChange);
  const labelId = `${id}-label`;
  return (
    <FieldShell id={id} helpId={helpId} label={label} labelAs="span" labelId={labelId} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div
        role="radiogroup"
        id={id}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        className={cx('ui-radio-group', direction === 'row' && 'ui-radio-group--row')}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={node => { refs.current[index] = node; }}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || option.disabled}
              tabIndex={index === tabStop ? 0 : -1}
              className="ui-check ui-radio"
              onClick={() => onChange(option.value)}
            >
              <span className={cx('ui-radio-dot', selected && 'is-on')} aria-hidden="true" />
              <span className="ui-check-text">
                <span className="ui-check-label">{option.label}</span>
                {option.hint && <span className="ui-check-desc">{option.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

export type SegmentedProps<V extends string = string> = {
  value: V;
  onChange: (value: V) => void;
  options: ChoiceOption<V>[];
  /** Obligatorio si no hay label visible. */
  ariaLabel?: string;
  label?: ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Ocupa todo el ancho y reparte los segmentos. */
  block?: boolean;
  className?: string;
};

export function Segmented<V extends string = string>({ value, onChange, options, ariaLabel, label, size = 'md', disabled, block, className }: SegmentedProps<V>) {
  const { refs, onKeyDown, tabStop } = useRovingKeys(options, value, onChange);
  const { id } = useFieldIds(undefined, {});
  const group = (
    <div
      role="radiogroup"
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? `${id}-label` : undefined}
      className={cx('ui-seg', size === 'sm' && 'ui-seg--sm', block && 'ui-seg--block', !label && className)}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={node => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            tabIndex={index === tabStop ? 0 : -1}
            className={cx('ui-seg-item', selected && 'is-on')}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <span className="ui-btn-icon">{option.icon}</span>}
            <span className="ui-seg-label">{option.label}</span>
            {option.count !== undefined && <span className="ui-seg-count g-num">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
  if (!label) return group;
  return (
    <div className={cx('ui-field', className)}>
      <span className="ui-label" id={`${id}-label`}><span className="ui-label-text">{label}</span></span>
      {group}
    </div>
  );
}

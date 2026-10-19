import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { IconAlert, IconCheck, IconMinus, IconPlus } from './icons';
import { cx } from './util';

/** Lo común a todo campo: label arriba, ayuda / error / éxito abajo. */
export type FieldProps = {
  label?: ReactNode;
  /** Texto chico debajo (se reemplaza por el error o el éxito cuando hay). */
  hint?: ReactNode;
  /** true = solo borde rojo; un texto = borde + mensaje (role="alert"). */
  error?: ReactNode | boolean;
  /** true = solo borde verde y tilde; un texto = además el mensaje. */
  success?: ReactNode | boolean;
  required?: boolean;
  /** Reserva la línea de ayuda aunque esté vacía: el error no empuja lo de abajo. */
  reserveHelp?: boolean;
  className?: string;
};

export function useFieldIds(idProp: string | undefined, props: Pick<FieldProps, 'hint' | 'error' | 'success'>) {
  const auto = useId();
  const id = idProp || `ui${auto.replace(/:/g, '')}`;
  const helpId = `${id}-help`;
  const hasHelp = Boolean((props.error && props.error !== true) || (props.success && props.success !== true) || props.hint);
  return { id, helpId, describedBy: hasHelp ? helpId : undefined, invalid: Boolean(props.error) };
}

export function FieldShell({ id, helpId, label, hint, error, success, required, reserveHelp, className, labelAs = 'label', labelId, children }: FieldProps & {
  id: string;
  helpId: string;
  /** 'span' para grupos (radios, segmentado), que se rotulan con aria-labelledby. */
  labelAs?: 'label' | 'span';
  labelId?: string;
  children: ReactNode;
}) {
  const message = error && error !== true ? error : success && success !== true ? success : hint;
  const tone = error && error !== true ? 'bad' : success && success !== true ? 'ok' : 'hint';
  const Label = labelAs;
  return (
    <div className={cx('ui-field', className)}>
      {label && (
        <Label className="ui-label" id={labelId} {...(labelAs === 'label' ? { htmlFor: id } : {})}>
          <span className="ui-label-text">{label}</span>
          {required && <span className="ui-label-req" aria-hidden="true">*</span>}
        </Label>
      )}
      {children}
      {(message || reserveHelp) && (
        <span id={helpId} className={cx('ui-help', `ui-help--${tone}`)} role={tone === 'bad' ? 'alert' : undefined}>
          {message}
        </span>
      )}
    </div>
  );
}

function StatusIcon({ error, success }: { error?: unknown; success?: unknown }) {
  if (error) return <span className="ui-field-status ui-field-status--bad"><IconAlert size={14} /></span>;
  if (success) return <span className="ui-field-status ui-field-status--ok"><IconCheck size={14} /></span>;
  return null;
}

/* ── Input ─────────────────────────────────────────────────────────────── */

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & FieldProps & {
  /** Ícono o texto fijo a la izquierda (lupa, "$"). */
  prefix?: ReactNode;
  /** A la derecha (un Kbd, un botón chico). */
  suffix?: ReactNode;
  size?: 'sm' | 'md';
  /** Atajo: recibe el string en vez del evento. */
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
  /** Fuerza un estado visual (solo para la página de muestra). */
  'data-force'?: string;
};

export function Input({ id: idProp, label, hint, error, success, required, reserveHelp, className, prefix, suffix, size = 'md', onValueChange, onChange, ref, disabled, 'data-force': force, ...rest }: InputProps) {
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div className={cx('ui-control', 'ui-input', size === 'sm' && 'ui-control--sm', invalid && 'is-error', !invalid && success && 'is-success', disabled && 'is-disabled')} data-force={force}>
        {prefix && <span className="ui-input-affix">{prefix}</span>}
        <input
          ref={ref}
          id={id}
          className="ui-input-el"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          disabled={disabled}
          onChange={event => { onChange?.(event); onValueChange?.(event.target.value); }}
          {...rest}
        />
        <StatusIcon error={invalid} success={success} />
        {suffix && <span className="ui-input-affix">{suffix}</span>}
      </div>
    </FieldShell>
  );
}

/* ── Textarea (autoalto, sin barra) ───────────────────────────────────── */

const supportsFieldSizing = /* @__PURE__ */ (() => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content'))();

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & FieldProps & {
  /** Alto mínimo en renglones (default 3). Crece con el texto, nunca muestra barra. */
  minRows?: number;
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
};

export function Textarea({ id: idProp, label, hint, error, success, required, reserveHelp, className, minRows = 3, onValueChange, onChange, ref, value, style, ...rest }: TextareaProps) {
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const fit = () => {
    const el = inner.current;
    if (!el || supportsFieldSizing) return;
    // Una escritura + una lectura por cambio de texto: no hay loop que alterne.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, [value]);

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <textarea
        ref={node => {
          inner.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        rows={minRows}
        value={value}
        className={cx('ui-control', 'ui-textarea', invalid && 'is-error', !invalid && success && 'is-success')}
        style={{ ...style, ['--ui-rows' as string]: minRows }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        onChange={event => { onChange?.(event); onValueChange?.(event.target.value); if (value === undefined) fit(); }}
        {...rest}
      />
    </FieldShell>
  );
}

/* ── NumberField ──────────────────────────────────────────────────────── */

export type NumberFieldProps = FieldProps & {
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  /** Nombre accesible si no hay label visible. */
  ariaLabel?: string;
  /** Unidad a la derecha ("equipos", "$"). */
  unit?: ReactNode;
  name?: string;
};

function decimals(step: number) {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

export function NumberField({ id: idProp, value, onChange, min, max, step = 1, disabled, readOnly, placeholder, ariaLabel, unit, name, label, hint, error, success, required, reserveHelp, className }: NumberFieldProps) {
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  const format = (n: number | null) => (n === null || Number.isNaN(n) ? '' : String(n).replace('.', ','));
  const [text, setText] = useState(() => format(value));
  const editing = useRef(false);

  // Si el valor cambia desde afuera (reset, +/−) y no se está tipeando, se redibuja.
  useEffect(() => { if (!editing.current) setText(format(value)); }, [value]);

  const clamp = (n: number) => {
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return Number(next.toFixed(decimals(step)));
  };
  const parse = (raw: string): number | null => {
    const clean = raw.replace(/\s/g, '').replace(',', '.');
    if (!clean || clean === '-') return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  };
  const commit = (n: number | null) => {
    const next = n === null ? null : clamp(n);
    setText(format(next));
    if (next !== value) onChange(next);
  };
  const bump = (delta: number) => {
    if (disabled || readOnly) return;
    const base = value ?? (min !== undefined ? min : 0);
    commit(value === null && delta > 0 && min !== undefined ? min : base + delta);
  };

  const atMin = value !== null && min !== undefined && value <= min;
  const atMax = value !== null && max !== undefined && value >= max;

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div className={cx('ui-control', 'ui-number', invalid && 'is-error', !invalid && success && 'is-success', disabled && 'is-disabled')}>
        <button type="button" className="ui-number-btn" tabIndex={-1} aria-label="Restar" disabled={disabled || readOnly || atMin} onClick={() => bump(-step)}>
          <IconMinus size={14} />
        </button>
        <input
          id={id}
          name={name}
          className="ui-input-el ui-number-el g-num"
          type="text"
          inputMode={decimals(step) ? 'decimal' : 'numeric'}
          role="spinbutton"
          aria-label={ariaLabel}
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          autoComplete="off"
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          value={text}
          onFocus={() => { editing.current = true; }}
          onChange={event => {
            const raw = event.target.value;
            if (!/^-?[\d\s]*[.,]?\d*$/.test(raw)) return;
            setText(raw);
            const n = parse(raw);
            // Mientras se tipea se avisa el valor si ya está en rango (no se recorta a mitad de escritura).
            if (n !== null && (min === undefined || n >= min) && (max === undefined || n <= max) && n !== value) onChange(n);
            if (n === null && raw === '' && value !== null) onChange(null);
          }}
          onBlur={() => { editing.current = false; commit(parse(text)); }}
          onKeyDown={event => {
            const big = step * 10;
            const keys: Record<string, () => void> = {
              ArrowUp: () => bump(step),
              ArrowDown: () => bump(-step),
              PageUp: () => bump(big),
              PageDown: () => bump(-big),
              Home: () => { if (min !== undefined) commit(min); },
              End: () => { if (max !== undefined) commit(max); },
              Enter: () => commit(parse(text))
            };
            const action = keys[event.key];
            if (!action) return;
            if (event.key !== 'Enter') event.preventDefault();
            editing.current = false;
            action();
            editing.current = true;
          }}
        />
        {unit && <span className="ui-input-affix">{unit}</span>}
        <button type="button" className="ui-number-btn" tabIndex={-1} aria-label="Sumar" disabled={disabled || readOnly || atMax} onClick={() => bump(step)}>
          <IconPlus size={14} />
        </button>
      </div>
    </FieldShell>
  );
}

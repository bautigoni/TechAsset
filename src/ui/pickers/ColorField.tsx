import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FieldShell, useFieldIds, type FieldProps } from '../Field';
import { IconCheck } from '../icons';
import { cx } from '../util';

/**
 * Color de sede (Tenants): paleta acotada + hex. Sin `input type=color` (su
 * popup lo dibuja el sistema y no respeta el tema). Los colores son datos
 * (el color propio de cada sede), no estilos de la app.
 */
export const DEFAULT_PALETTE = [
  '#2F6FE0', '#5B9BFF', '#0F8A80', '#4FD1C5', '#16804A', '#5BD68A',
  '#A15C00', '#F5C04E', '#C8641E', '#FF9F5A', '#C93636', '#FF6B6B',
  '#7A5BD6', '#B79CFF', '#C2489A', '#F28FD0', '#4A525E', '#A7AEB8'
];

export function normalizeHex(raw: string) {
  const clean = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(clean)) return `#${clean.split('').map(char => char + char).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean}`.toUpperCase();
  return null;
}

export type ColorFieldProps = FieldProps & {
  id?: string;
  /** '#RRGGBB' o ''. */
  value: string;
  onChange: (hex: string) => void;
  palette?: string[];
  /** Campo hex para un color fuera de la paleta (default true). */
  allowCustom?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
};

export function ColorField({ id: idProp, value, onChange, palette = DEFAULT_PALETTE, allowCustom = true, disabled, ariaLabel, label, hint, error, success, required, reserveHelp, className }: ColorFieldProps) {
  const current = normalizeHex(value || '') || '';
  const [text, setText] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { setText(current); setProblem(null); }, [current]);
  const { id, helpId, describedBy } = useFieldIds(idProp, { hint, error: problem || error, success });
  const labelId = `${id}-label`;
  const index = palette.findIndex(color => normalizeHex(color) === current);
  const tabStop = index >= 0 ? index : 0;

  const onKeyDown = (event: KeyboardEvent) => {
    const from = Math.max(0, index);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (from + 1) % palette.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (from - 1 + palette.length) % palette.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = palette.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(normalizeHex(palette[next])!);
    refs.current[next]?.focus();
  };

  return (
    <FieldShell id={id} helpId={helpId} label={label} labelAs="span" labelId={labelId} hint={hint} error={problem || error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div className="ui-color">
        <div role="radiogroup" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel || 'Color'} aria-describedby={describedBy} className="ui-swatches" onKeyDown={onKeyDown}>
          {palette.map((color, i) => {
            const hex = normalizeHex(color)!;
            const on = hex === current;
            return (
              <button
                key={hex}
                ref={node => { refs.current[i] = node; }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={hex}
                tabIndex={i === tabStop ? 0 : -1}
                disabled={disabled}
                className={cx('ui-swatch', on && 'is-on')}
                style={{ ['--ui-swatch' as string]: hex }}
                onClick={() => onChange(hex)}
              >
                {on && <IconCheck size={12} />}
              </button>
            );
          })}
        </div>
        {allowCustom && (
          <div className={cx('ui-control', 'ui-input', 'ui-color-hex', problem && 'is-error', disabled && 'is-disabled')}>
            <span className="ui-color-preview" aria-hidden="true" style={{ ['--ui-swatch' as string]: current || 'transparent' }} />
            <input
              id={id}
              className="ui-input-el ui-mono"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              aria-label="Color en hexadecimal"
              aria-invalid={Boolean(problem) || undefined}
              placeholder="#RRGGBB"
              disabled={disabled}
              value={text}
              onChange={event => {
                const raw = `#${event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)}`.toUpperCase();
                setText(raw === '#' ? '' : raw);
                const hex = raw.length === 7 ? normalizeHex(raw) : null;
                if (hex) { setProblem(null); if (hex !== current) onChange(hex); }
              }}
              onBlur={() => {
                if (!text) { setProblem(null); if (current) onChange(''); return; }
                const hex = normalizeHex(text);
                if (hex) { setProblem(null); if (hex !== current) onChange(hex); setText(hex); }
                else setProblem('Usá 3 o 6 dígitos hexadecimales (#2F6FE0)');
              }}
            />
          </div>
        )}
      </div>
    </FieldShell>
  );
}

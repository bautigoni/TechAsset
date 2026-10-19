import { useId, useMemo, useState } from 'react';
import './reminderFields.css';
import { Collapse, DateTimeField, cx } from '../../ui';
import { dayKeyAr } from '../../utils/formatters';
import { isValidLocal, localToIso, longWhen, nextHourLocal, quickWhens, relativeWhen } from './reminderUtils';

/**
 * Fecha y hora de un recordatorio: atajos (en 1 hora, hoy a la tarde, mañana,
 * el lunes) y "Otra fecha" con el DateTimeField propio de src/ui, que nunca
 * parsea texto del navegador (en iPhone/Safari `new Date('AAAA-MM-DD HH:mm')`
 * da Invalid Date). El valor es 'YYYY-MM-DDTHH:mm' en hora argentina.
 */
export function WhenField({ value, onChange, label = 'Fecha y hora', error, disabled, idPrefix }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const autoId = useId();
  const id = idPrefix || autoId;
  const quick = useMemo(() => quickWhens(), []);
  const quickId = quick.find(item => item.value === value)?.id;
  const [custom, setCustom] = useState(Boolean(value) && !quickId);
  const valid = isValidLocal(value);
  const rel = valid ? relativeWhen(localToIso(value)) : null;

  return (
    <div className="rem-when" role="group" aria-labelledby={`${id}-label`}>
      <span className="ui-label" id={`${id}-label`}><span className="ui-label-text">{label}</span></span>
      <div className="rem-quick" role="radiogroup" aria-label="Atajos de fecha">
        {quick.map(item => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={!custom && quickId === item.id}
            disabled={disabled}
            className={cx('rem-chip', !custom && quickId === item.id && 'is-on')}
            onClick={() => { setCustom(false); onChange(item.value); }}
          >
            <span className="rem-chip-label">{item.label}</span>
            <span className="rem-chip-sub">{item.sub}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          aria-expanded={custom}
          disabled={disabled}
          className={cx('rem-chip', custom && 'is-on')}
          onClick={() => { setCustom(true); if (!valid) onChange(nextHourLocal()); }}
        >
          <span className="rem-chip-label">Otra fecha…</span>
        </button>
      </div>
      <Collapse open={custom}>
        <DateTimeField
          value={value}
          onChange={onChange}
          min={dayKeyAr()}
          minHour={7}
          maxHour={21}
          disabled={disabled}
          className="rem-when-custom"
        />
      </Collapse>
      {error
        ? <span className="rem-when-error" role="alert">{error}</span>
        : valid
          ? (
            <span className="rem-when-readout" aria-live="polite">
              <span className="rem-when-long">{longWhen(value)}</span>
              {rel && <span className={`rem-tone-${rel.tone}`}>{rel.tone === 'bad' ? 'ya pasó: avisa apenas lo guardes' : rel.text}</span>}
              <span className="rem-when-tz">hora de Argentina</span>
            </span>
          )
          : <span className="rem-when-readout rem-muted">Elegí un atajo u otra fecha.</span>}
    </div>
  );
}

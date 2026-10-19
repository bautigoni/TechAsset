import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Button } from '../Button';
import { FieldShell, useFieldIds, type FieldProps } from '../Field';
import { IconClock } from '../icons';
import { Collapse } from '../Collapse';
import { cx } from '../util';
import { DatePicker, type DatePickerProps } from './DatePicker';
import { formatTime, maskTime, parseTime, toMinutes } from './dates';

/** Fila de chips con flechas (radiogroup, roving tabindex). */
function ChipRow({ label, values, selected, onPick, format = String }: { label: string; values: number[]; selected: number | null; onPick: (value: number) => void; format?: (value: number) => string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = selected === null ? -1 : values.indexOf(selected);
  const tabStop = current >= 0 ? current : 0;
  const onKeyDown = (event: KeyboardEvent) => {
    const index = Math.max(0, current);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(values.length - 1, index + (current < 0 ? 0 : 1));
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = values.length - 1;
    if (next === null) return;
    event.preventDefault();
    onPick(values[next]);
    refs.current[next]?.focus();
  };
  return (
    <div className="ui-time-row">
      <span className="ui-time-row-label" id={`${label}-l`}>{label}</span>
      <div role="radiogroup" aria-label={label} className="ui-chips" onKeyDown={onKeyDown}>
        {values.map((value, index) => (
          <button
            key={value}
            ref={node => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={value === selected}
            tabIndex={index === tabStop ? 0 : -1}
            className={cx('ui-chip', 'g-num', value === selected && 'is-on')}
            onClick={() => onPick(value)}
          >
            {format(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

export type TimeFieldProps = FieldProps & {
  id?: string;
  /** 'HH:mm' o ''. */
  value: string;
  onChange: (value: string) => void;
  /** Horas que se ofrecen en el selector (default 7–18, el horario escolar). Tipeando vale cualquiera. */
  minHour?: number;
  maxHour?: number;
  /** Paso de minutos en el selector (default 5). */
  minuteStep?: number;
  /** Límites duros 'HH:mm' (p. ej. Hasta > Desde). */
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  defaultOpen?: boolean;
};

export function TimeField({ id: idProp, value, onChange, minHour = 7, maxHour = 18, minuteStep = 5, min, max, disabled, placeholder = 'hh:mm', ariaLabel, defaultOpen = false, label, hint, error, success, required, reserveHelp, className }: TimeFieldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Cambio desde afuera (chips, reset): si el texto no lo representa, se redibuja.
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => { if (textRef.current !== value) { setText(value); setProblem(null); } }, [value]);

  const shownError = problem || error;
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error: shownError, success });
  const panelId = `${id}-time`;
  const time = parseTime(value);

  const check = (next: string) => {
    const minutes = toMinutes(next);
    if (minutes === null) return 'Hora inválida';
    if (min && minutes < (toMinutes(min) ?? 0)) return `Tiene que ser después de las ${min}`;
    if (max && minutes > (toMinutes(max) ?? 1440)) return `Tiene que ser antes de las ${max}`;
    return null;
  };
  const commit = (next: string) => {
    const why = next ? check(next) : null;
    setProblem(why);
    if (!why && next !== value) onChange(next);
  };

  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, index) => minHour + index);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, index) => index * minuteStep);
  const setPart = (part: 'h' | 'm', n: number) => {
    const h = part === 'h' ? n : time?.h ?? minHour;
    const m = part === 'm' ? n : time?.m ?? 0;
    const next = formatTime(h, m);
    setText(next);
    commit(next);
  };

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={shownError} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div
        className={cx('ui-time', open && 'is-open')}
        ref={rootRef}
        onBlur={(event: FocusEvent<HTMLDivElement>) => { if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
      >
        <div className={cx('ui-control', 'ui-input', 'ui-time-input', invalid && 'is-error', !invalid && success && 'is-success', disabled && 'is-disabled')}>
          <input
            ref={inputRef}
            id={id}
            className="ui-input-el g-num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            disabled={disabled}
            value={text}
            onBlur={() => {
              // "9" o "930" se completan; lo incompleto vuelve al valor anterior.
              const digits = text.replace(/\D/g, '');
              if (!digits) { if (value) onChange(''); setProblem(null); return; }
              const normalized = digits.length <= 2 ? `${pad(Number(digits))}:00` : digits.length === 3 ? `0${digits[0]}:${digits.slice(1)}` : `${digits.slice(0, 2)}:${digits.slice(2)}`;
              if (parseTime(normalized)) { setText(normalized); commit(normalized); } else { setText(value); setProblem(null); }
            }}
            onChange={event => {
              const masked = maskTime(event.target.value);
              setText(masked);
              if (masked.length === 5) commit(masked);
              else setProblem(null);
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); setOpen(true); }
              if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
            }}
          />
          <button
            type="button"
            className="ui-input-btn"
            aria-label={open ? 'Cerrar selector de hora' : 'Abrir selector de hora'}
            aria-expanded={open}
            aria-controls={panelId}
            disabled={disabled}
            onClick={() => setOpen(current => !current)}
          >
            <IconClock size={16} />
          </button>
        </div>
        <Collapse
            open={open}
            unmountOnClose
            className="ui-picker-panel ui-time-panel"
            id={panelId}
            role="group"
            aria-label={typeof label === 'string' ? label : ariaLabel || 'Elegir hora'}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); inputRef.current?.focus(); } }}
          >
            <div className="ui-time-head">
              <span className="ui-time-value g-num">{value || '--:--'}</span>
              <Button size="sm" variant="secondary" onClick={() => { setOpen(false); inputRef.current?.focus(); }}>Listo</Button>
            </div>
            <ChipRow label="Hora" values={hours} selected={time?.h ?? null} onPick={n => setPart('h', n)} format={pad} />
            <ChipRow label="Minutos" values={minutes} selected={time && time.m % minuteStep === 0 ? time.m : null} onPick={n => setPart('m', n)} format={pad} />
        </Collapse>
      </div>
    </FieldShell>
  );
}

/* ══ DateTimeField: fecha + hora ('YYYY-MM-DDTHH:mm', compatible con datetime-local) ══ */

export type DateTimeFieldProps = FieldProps & Pick<DatePickerProps, 'min' | 'max' | 'isDateDisabled' | 'shortcuts'> & {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Hora que se usa al elegir solo la fecha (default 08:00). */
  defaultTime?: string;
  disabled?: boolean;
  dateLabel?: string;
  timeLabel?: string;
  minHour?: number;
  maxHour?: number;
  minuteStep?: number;
};

export function DateTimeField({ id, value, onChange, defaultTime = '08:00', disabled, dateLabel = 'Fecha', timeLabel = 'Hora', min, max, isDateDisabled, shortcuts = true, minHour, maxHour, minuteStep, label, hint, error, success, required, reserveHelp, className }: DateTimeFieldProps) {
  const [date = '', rawTime = ''] = String(value || '').split('T');
  const time = rawTime.slice(0, 5);
  const { id: baseId, helpId } = useFieldIds(id, { hint, error, success });
  return (
    <FieldShell id={baseId} helpId={helpId} label={label} labelAs="span" hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div className="ui-datetime" role="group" aria-label={typeof label === 'string' ? label : undefined}>
        <DatePicker
          id={baseId}
          label={dateLabel}
          value={date}
          min={min}
          max={max}
          isDateDisabled={isDateDisabled}
          shortcuts={shortcuts}
          disabled={disabled}
          required={required}
          clearable={!required}
          onChange={nextDate => onChange(nextDate ? `${nextDate}T${time || defaultTime}` : '')}
          className="ui-datetime-date"
        />
        <TimeField
          label={timeLabel}
          value={time}
          minHour={minHour}
          maxHour={maxHour}
          minuteStep={minuteStep}
          disabled={disabled || !date}
          hint={!date ? 'Elegí la fecha primero' : undefined}
          onChange={nextTime => { if (date) onChange(`${date}T${nextTime || defaultTime}`); }}
          className="ui-datetime-time"
        />
      </div>
    </FieldShell>
  );
}

import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton } from '../Button';
import { FieldShell, useFieldIds, type FieldProps } from '../Field';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '../icons';
import { cx } from '../util';
import { DAYS_LONG, DAYS_SHORT, MONTHS, addDays, addMonths, displayDate, fromIso, inRange, longDate, maskDate, monthGrid, parseMasked, todayIso, weekday } from './dates';

/* ══ Calendar: grilla de un mes, lunes primero, teclado completo ══ */

type CalendarProps = {
  /** Día con foco (roving tabindex); define el mes que se ve. */
  focusIso: string;
  onFocusIso: (iso: string) => void;
  selected?: string;
  range?: { from: string; to: string };
  min?: string;
  max?: string;
  isDateDisabled?: (iso: string) => boolean;
  onPick: (iso: string) => void;
  onEscape: () => void;
  /** Mover el foco del DOM a la celda (al abrir con teclado / al navegar). */
  autoFocus?: boolean;
};

export function Calendar({ focusIso, onFocusIso, selected, range, min, max, isDateDisabled, onPick, onEscape, autoFocus }: CalendarProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const keyboard = useRef(Boolean(autoFocus));
  const focusDate = fromIso(focusIso) || new Date();
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const today = todayIso();
  const disabled = (iso: string) => !inRange(iso, min, max) || Boolean(isDateDisabled?.(iso));

  useEffect(() => {
    if (!keyboard.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focusIso}"]`)?.focus({ preventScroll: true });
  }, [focusIso]);

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusIso, -1),
      ArrowRight: () => addDays(focusIso, 1),
      ArrowUp: () => addDays(focusIso, -7),
      ArrowDown: () => addDays(focusIso, 7),
      Home: () => addDays(focusIso, -weekday(focusIso)),
      End: () => addDays(focusIso, 6 - weekday(focusIso)),
      PageUp: () => addMonths(focusIso, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusIso, event.shiftKey ? 12 : 1)
    };
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && !disabled(focusIso)) { event.preventDefault(); event.stopPropagation(); onPick(focusIso); return; }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    keyboard.current = true;
    onFocusIso(move());
  };

  const label = `${MONTHS[month]} ${year}`;
  const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));

  return (
    <div className="ui-cal">
      <div className="ui-cal-head">
        <IconButton size="sm" label="Mes anterior" icon={<IconChevronLeft size={16} />} onClick={() => { keyboard.current = false; onFocusIso(addMonths(focusIso, -1)); }} />
        <span className="ui-cal-title" aria-live="polite">{label}</span>
        <IconButton size="sm" label="Mes siguiente" icon={<IconChevronRight size={16} />} onClick={() => { keyboard.current = false; onFocusIso(addMonths(focusIso, 1)); }} />
      </div>
      <div ref={gridRef} role="grid" aria-label={label} className="ui-cal-grid" onKeyDown={onKeyDown}>
        <div role="row" className="ui-cal-row">
          {DAYS_SHORT.map((day, index) => <span key={index} role="columnheader" aria-label={DAYS_LONG[index]} className="ui-cal-dow">{day}</span>)}
        </div>
        {weeks.map((week, row) => (
          <div role="row" className="ui-cal-row" key={row}>
            {week.map(iso => {
              const outside = Number(iso.slice(5, 7)) - 1 !== month;
              const isSelected = iso === selected || (range && (iso === range.from || iso === range.to));
              const between = range && range.from && range.to && iso > range.from && iso < range.to;
              const off = disabled(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  data-iso={iso}
                  tabIndex={iso === focusIso ? 0 : -1}
                  aria-selected={Boolean(isSelected) || Boolean(between)}
                  aria-current={iso === today ? 'date' : undefined}
                  aria-disabled={off || undefined}
                  aria-label={`${longDate(iso)}${off ? ', no disponible' : ''}`}
                  className={cx('ui-cal-day', 'g-num', outside && 'is-outside', isSelected && 'is-selected', between && 'is-between', iso === today && 'is-today', off && 'is-disabled')}
                  onClick={() => { if (!off) onPick(iso); }}
                  onFocus={() => { if (iso !== focusIso) onFocusIso(iso); }}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══ Campo de fecha con máscara propia ══ */

function useMaskedDate(value: string, onCommit: (iso: string) => void, validate: (iso: string) => string | null) {
  const [text, setText] = useState(displayDate(value));
  const [problem, setProblem] = useState<string | null>(null);
  // Si el valor cambió y el texto no lo representa (elegido en el calendario,
  // atajo, reset desde afuera), se redibuja. Lo que el usuario tipeó y ya se
  // guardó coincide con el valor, así que no se le pisa la escritura.
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    if ((parseMasked(textRef.current) || '') !== (value || '')) { setText(displayDate(value)); setProblem(null); }
  }, [value]);

  const onChange = (raw: string) => {
    const masked = maskDate(raw);
    setText(masked);
    if (!masked) { setProblem(null); if (value) onCommit(''); return; }
    if (masked.length < 10) { setProblem(null); return; }
    const iso = parseMasked(masked);
    if (!iso) { setProblem('Esa fecha no existe'); return; }
    const why = validate(iso);
    if (why) { setProblem(why); return; }
    setProblem(null);
    if (iso !== value) onCommit(iso);
  };
  const onBlur = () => {
    // A medio tipear no se guarda nada: vuelve a la fecha que había.
    if (text.length > 0 && text.length < 10) { setText(displayDate(value)); setProblem(null); }
  };
  return { text, problem, onChange, onFocus: () => {}, onBlur };
}

export type DateShortcut = 'today' | 'tomorrow' | 'yesterday';
const SHORTCUT_LABEL: Record<DateShortcut, [string, number]> = { yesterday: ['Ayer', -1], today: ['Hoy', 0], tomorrow: ['Mañana', 1] };

export type DatePickerProps = FieldProps & {
  id?: string;
  /** 'YYYY-MM-DD' o '' (vacío). */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  isDateDisabled?: (iso: string) => boolean;
  /** Atajos Hoy / Mañana / Ayer (true = Hoy y Mañana). */
  shortcuts?: boolean | DateShortcut[];
  /** Botón Borrar (default true si no es required). */
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** false = sin campo de texto, solo el botón (como el DateField viejo). */
  textInput?: boolean;
  /** Mensaje si cae en un día deshabilitado (p. ej. "Sábados y domingos no se agendan"). */
  disabledMessage?: string;
  /** Nota debajo del calendario. */
  calendarNote?: ReactNode;
  defaultOpen?: boolean;
};

export function DatePicker({ id: idProp, value, onChange, min, max, isDateDisabled, shortcuts = false, clearable, disabled, placeholder = 'DD/MM/AAAA', ariaLabel, textInput = true, disabledMessage = 'Ese día no está disponible', calendarNote, defaultOpen = false, label, hint, error, success, required, reserveHelp, className }: DatePickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [focusIso, setFocusIso] = useState(value || todayIso());
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const validate = (iso: string) => {
    if (!inRange(iso, min, max)) return min && iso < min ? `Tiene que ser desde el ${displayDate(min)}` : `Tiene que ser hasta el ${displayDate(max!)}`;
    if (isDateDisabled?.(iso)) return disabledMessage;
    return null;
  };
  const masked = useMaskedDate(value, onChange, validate);
  const shownError = masked.problem || error;
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error: shownError, success });
  const panelId = `${id}-cal`;

  const openCalendar = (keyboard: boolean) => {
    if (disabled) return;
    setFocusIso(value || todayIso());
    setViaKeyboard(keyboard);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) (textInput ? inputRef : buttonRef).current?.focus({ preventScroll: true });
  };
  const pick = (iso: string) => {
    onChange(iso);
    close(true);
  };
  const shortcutList: DateShortcut[] = shortcuts === true ? ['today', 'tomorrow'] : shortcuts || [];
  const canClear = clearable ?? !required;

  const onRootBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={shownError} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div className={cx('ui-date', open && 'is-open')} ref={rootRef} onBlur={onRootBlur}>
        {textInput ? (
          <div className={cx('ui-control', 'ui-input', invalid && 'is-error', !invalid && success && 'is-success', disabled && 'is-disabled')}>
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
              value={masked.text}
              onFocus={masked.onFocus}
              onBlur={masked.onBlur}
              onChange={event => masked.onChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'ArrowDown' || (event.key === 'ArrowDown' && event.altKey)) { event.preventDefault(); openCalendar(true); }
                if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(false); }
              }}
            />
            <button
              ref={buttonRef}
              type="button"
              className="ui-input-btn"
              aria-label={open ? 'Cerrar calendario' : 'Abrir calendario'}
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              disabled={disabled}
              onClick={event => (open ? close(false) : openCalendar(event.detail === 0))}
            >
              <IconCalendar size={16} />
            </button>
          </div>
        ) : (
          <button
            ref={buttonRef}
            id={id}
            type="button"
            className={cx('ui-control', 'ui-select-trigger', invalid && 'is-error')}
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={event => (open ? close(false) : openCalendar(event.detail === 0))}
          >
            <span className={cx('ui-select-value', 'g-num', !value && 'is-placeholder')}>{displayDate(value) || placeholder}</span>
            <span className="ui-select-chevron" aria-hidden="true"><IconCalendar size={16} /></span>
          </button>
        )}
        {open && (
          <div className="ui-picker-panel ui-enter" id={panelId} role="group" aria-label="Elegir fecha">
            <Calendar
              focusIso={focusIso}
              onFocusIso={setFocusIso}
              selected={value}
              min={min}
              max={max}
              isDateDisabled={isDateDisabled}
              onPick={pick}
              onEscape={() => close(true)}
              autoFocus={viaKeyboard}
            />
            {calendarNote && <span className="ui-picker-note">{calendarNote}</span>}
            {(shortcutList.length > 0 || canClear) && (
              <div className="ui-picker-foot">
                {shortcutList.map(key => {
                  const [text, offset] = SHORTCUT_LABEL[key];
                  const iso = todayIso(offset);
                  const off = Boolean(validate(iso));
                  return <Button key={key} size="sm" variant="ghost" disabled={off} onClick={() => pick(iso)}>{text}</Button>;
                })}
                {canClear && value && <Button size="sm" variant="ghost" className="ui-picker-clear" onClick={() => pick('')}>Borrar</Button>}
              </div>
            )}
          </div>
        )}
      </div>
    </FieldShell>
  );
}

/**
 * Adaptador 1:1 del DateField viejo (`components/layout/DateField`): mismas
 * props; se ve como botón (sin campo de texto) y Hoy / Borrar al pie.
 */
export function DateField(props: { value: string; onChange: (iso: string) => void; disabled?: boolean; placeholder?: string; ariaLabel?: string; className?: string }) {
  return <DatePicker {...props} textInput={false} shortcuts={['today']} clearable placeholder={props.placeholder || 'dd/mm/aaaa'} />;
}

/* ══ DateRange: desde / hasta con un solo calendario ══ */

export type DateRangeValue = { from: string; to: string };
export type DateRangePreset = { label: string; from: string; to: string };

export function defaultRangePresets(): DateRangePreset[] {
  const today = todayIso();
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastMonthFirst = addMonths(firstOfMonth, -1);
  return [
    { label: 'Hoy', from: today, to: today },
    { label: 'Últimos 7 días', from: addDays(today, -6), to: today },
    { label: 'Este mes', from: firstOfMonth, to: today },
    { label: 'Mes pasado', from: lastMonthFirst, to: addDays(firstOfMonth, -1) }
  ];
}

export type DateRangeProps = FieldProps & {
  id?: string;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  min?: string;
  max?: string;
  presets?: DateRangePreset[] | false;
  disabled?: boolean;
  fromLabel?: string;
  toLabel?: string;
};

export function DateRange({ id: idProp, value, onChange, min, max, presets, disabled, fromLabel = 'Desde', toLabel = 'Hasta', label, hint, error, success, required, reserveHelp, className }: DateRangeProps) {
  const { id, helpId } = useFieldIds(idProp, { hint, error, success });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<'from' | 'to'>('from');
  const [focusIso, setFocusIso] = useState(value.from || todayIso());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const validate = (iso: string) => (inRange(iso, min, max) ? null : 'Fuera del rango permitido');
  const fromField = useMaskedDate(value.from, iso => onChange({ from: iso, to: value.to && iso && value.to < iso ? iso : value.to }), validate);
  const toField = useMaskedDate(value.to, iso => onChange({ from: value.from && iso && iso < value.from ? iso : value.from, to: iso }), validate);
  const list = presets === false ? [] : presets || defaultRangePresets();

  const pick = (iso: string) => {
    if (editing === 'from' || !value.from || iso < value.from) {
      onChange({ from: iso, to: value.to && value.to >= iso ? value.to : '' });
      setEditing('to');
      return;
    }
    onChange({ from: value.from, to: iso });
    setEditing('from');
    setOpen(false);
  };

  const field = (which: 'from' | 'to', masked: ReturnType<typeof useMaskedDate>, text: string) => (
    <div className="ui-range-field">
      <span className="ui-range-label">{text}</span>
      <div className={cx('ui-control', 'ui-input', masked.problem && 'is-error', open && editing === which && 'is-current', disabled && 'is-disabled')}>
        <input
          id={which === 'from' ? id : `${id}-to`}
          className="ui-input-el g-num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/AAAA"
          aria-label={text}
          aria-invalid={Boolean(masked.problem) || undefined}
          disabled={disabled}
          value={masked.text}
          onFocus={() => { masked.onFocus(); setEditing(which); setFocusIso((which === 'from' ? value.from : value.to) || value.from || todayIso()); setOpen(true); }}
          onBlur={masked.onBlur}
          onChange={event => masked.onChange(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}
        />
      </div>
    </div>
  );

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={fromField.problem || toField.problem || error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div
        className={cx('ui-range', open && 'is-open')}
        ref={rootRef}
        onBlur={event => { if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
      >
        <div className="ui-range-fields">
          {field('from', fromField, fromLabel)}
          {field('to', toField, toLabel)}
        </div>
        {open && (
          <div className="ui-picker-panel ui-enter" role="group" aria-label={editing === 'from' ? 'Elegir desde' : 'Elegir hasta'}>
            <Calendar focusIso={focusIso} onFocusIso={setFocusIso} range={value} min={min} max={max} onPick={pick} onEscape={() => setOpen(false)} />
            <span className="ui-picker-note">{editing === 'from' ? 'Elegí el primer día' : 'Elegí el último día'}</span>
            {list.length > 0 && (
              <div className="ui-picker-foot">
                {list.map(preset => (
                  <Button key={preset.label} size="sm" variant="ghost" onClick={() => { onChange({ from: preset.from, to: preset.to }); setOpen(false); }}>{preset.label}</Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </FieldShell>
  );
}

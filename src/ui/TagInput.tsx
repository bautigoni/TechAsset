import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { FieldShell, useFieldIds, type FieldProps } from './Field';
import { IconX } from './icons';
import { cx, fold } from './util';

/**
 * Chips que se tipean de corrido (arregla el bug 10 del PLAN): coma o Enter
 * agregan, Backspace con el campo vacío borra el último, pegar "a, b, c" agrega
 * los tres. Sugerencias opcionales debajo, en línea (no flotan).
 *
 * Reemplaza a ListTextInput separator="comma": recibe y devuelve el mismo
 * string[] que ya guardan las pantallas.
 */
export type TagInputProps = FieldProps & {
  id?: string;
  value: string[] | undefined;
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
  ariaLabel?: string;
  /** Tope de chips. */
  max?: number;
  /** Normaliza cada chip (p. ej. minúsculas para tags). */
  transform?: (tag: string) => string;
};

export function TagInput({ id: idProp, value, onChange, placeholder = 'Escribí y apretá Enter o coma', suggestions = [], disabled, ariaLabel, max, transform, label, hint, error, success, required, reserveHelp, className }: TagInputProps) {
  const tags = value || [];
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const full = max !== undefined && tags.length >= max;

  const add = (raw: string[]) => {
    const next = [...tags];
    const added: string[] = [];
    for (const item of raw) {
      const clean = (transform ? transform(item) : item).trim();
      if (!clean) continue;
      if (next.some(tag => fold(tag) === fold(clean))) continue;
      if (max !== undefined && next.length >= max) break;
      next.push(clean);
      added.push(clean);
    }
    if (added.length) {
      onChange(next);
      setAnnounce(`Agregado: ${added.join(', ')}`);
    }
    setText('');
  };
  const remove = (index: number) => {
    const removed = tags[index];
    onChange(tags.filter((_, i) => i !== index));
    setAnnounce(`Quitado: ${removed}`);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Enter' || event.key === ',' || event.key === ';') && text.trim()) {
      event.preventDefault();
      add([text]);
    } else if (event.key === 'Enter' && !text.trim()) {
      // Enter vacío no envía el formulario de golpe mientras se cargan tags.
      event.preventDefault();
    } else if (event.key === 'Backspace' && !text && tags.length) {
      event.preventDefault();
      remove(tags.length - 1);
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[,;\n]/.test(pasted)) return;
    event.preventDefault();
    add(pasted.split(/[,;\n]/));
  };

  const pending = useMemo(() => {
    const q = fold(text);
    return suggestions.filter(item => !tags.some(tag => fold(tag) === fold(item)) && (!q || fold(item).includes(q))).slice(0, 8);
  }, [suggestions, tags, text]);

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div
        className={cx('ui-control', 'ui-tags', invalid && 'is-error', !invalid && success && 'is-success', disabled && 'is-disabled')}
        onClick={event => { if (event.target === event.currentTarget) inputRef.current?.focus(); }}
      >
        {tags.map((tag, index) => (
          <span className="ui-tag" key={`${tag}-${index}`}>
            <span className="ui-tag-text">{tag}</span>
            {!disabled && (
              <button type="button" className="ui-tag-x" aria-label={`Quitar ${tag}`} tabIndex={-1} onClick={() => remove(index)}>
                <IconX size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className="ui-input-el ui-tags-el"
          type="text"
          value={text}
          disabled={disabled || full}
          placeholder={full ? `Máximo ${max}` : tags.length ? '' : placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          enterKeyHint="enter"
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (text.trim()) add([text]); }}
          onChange={event => {
            const next = event.target.value;
            // En mobile la coma llega por onChange (sin keydown confiable).
            if (/[,;]/.test(next)) { add(next.split(/[,;]/)); return; }
            setText(next);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
      {focused && pending.length > 0 && !disabled && !full && (
        <div className="ui-tag-suggest" aria-label="Sugerencias">
          {pending.map(item => (
            <button key={item} type="button" className="ui-tag-option" onMouseDown={event => event.preventDefault()} onClick={() => add([item])}>
              {item}
            </button>
          ))}
        </div>
      )}
      <span className="ui-sr" aria-live="polite">{announce}</span>
    </FieldShell>
  );
}

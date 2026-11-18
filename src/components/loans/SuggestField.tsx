import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type SuggestOption = {
  key: string;
  title: string;
  detail?: string;
  /** Marca corta a la derecha del título, ej. "Lista" para la lista de docentes y alumnos. */
  tag?: string;
};

/**
 * Campo de texto con sugerencias que se manejan también con teclado.
 *
 * Antes la lista se cerraba con un `setTimeout` en el blur del input: al tocar
 * Tab el foco pasaba al primer botón de la lista, el input perdía el foco y la
 * lista desaparecía al instante, sin llegar a elegir con Enter. Ahora la lista
 * vive mientras el foco esté adentro del campo (input o lista):
 * - Flechas ↑/↓ recorren las opciones desde el input; Enter elige la marcada.
 * - Tab entra a la lista; ahí flechas, Enter o Espacio, y Tab sigue de largo.
 * - Esc o un click afuera la cierran. Elegir una también.
 */
export const SuggestField = forwardRef<HTMLInputElement | null, {
  value: string;
  onChange: (value: string) => void;
  options: SuggestOption[];
  onPick: (index: number) => void;
  className?: string;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  ariaLabel?: string;
}>(function SuggestField({ value, onChange, options, onPick, className = 'loan-person-field', id, placeholder, autoFocus, required, ariaLabel }, ref) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(ref, () => inputRef.current, []);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Después de elegir (o de Esc) la lista no se reabre sola al volver el foco al
  // input: recién cuando se vuelve a escribir.
  const dismissed = useRef(false);
  const listId = useRef(`suggest-${Math.random().toString(36).slice(2, 9)}`).current;
  const visible = open && options.length > 0;

  // Lista nueva = sin opción marcada. Se compara por claves: el padre puede
  // armar el array en cada render y eso no tiene que perder la marca.
  const optionsKey = options.map(option => option.key).join('\n');
  useEffect(() => { setActive(-1); }, [optionsKey]);

  const pick = (index: number) => {
    if (index < 0 || index >= options.length) return;
    dismissed.current = true;
    setOpen(false);
    setActive(-1);
    onPick(index);
    inputRef.current?.focus();
  };

  const close = () => {
    dismissed.current = true;
    setOpen(false);
    setActive(-1);
  };

  const focusOption = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    const next = (index + buttons.length) % buttons.length;
    setActive(next);
    buttons[next].focus();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      dismissed.current = false;
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(current => {
        if (current < 0) return step > 0 ? 0 : options.length - 1;
        return (current + step + options.length) % options.length;
      });
      return;
    }
    if (event.key === 'Enter' && visible && active >= 0) {
      event.preventDefault();
      pick(active);
      return;
    }
    if (event.key === 'Escape' && visible) {
      // Que el Esc cierre la lista y no el modal/panel que la contiene.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const onOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(index + 1); return; }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0) { setActive(-1); inputRef.current?.focus(); } else focusOption(index - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      inputRef.current?.focus();
    }
  };

  // El campo entero (input + lista) es una sola zona de foco: la lista se cierra
  // recién cuando el foco sale de las dos.
  const onBlur = (event: React.FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setOpen(false);
    setActive(-1);
  };

  return (
    <span className={className} onBlur={onBlur} data-scanner-ignore="">
      <input
        ref={inputRef}
        id={id}
        className="input"
        value={value}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={event => { dismissed.current = false; onChange(event.target.value); setOpen(true); }}
        onFocus={() => { if (!dismissed.current) setOpen(true); }}
        onKeyDown={onInputKeyDown}
      />
      {visible && (
        <ul className="loan-suggest" id={listId} ref={listRef} role="listbox">
          {options.map((option, index) => (
            <li key={option.key} role="presentation">
              <button
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? 'is-active' : undefined}
                // Sin esto el mousedown le saca el foco al input antes del click.
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(index)}
                onFocus={() => setActive(index)}
                onKeyDown={event => onOptionKeyDown(event, index)}
              >
                <strong>{option.title}{option.tag && <span className="loan-suggest-tag"> · {option.tag}</span>}</strong>
                {option.detail && <span>{option.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
});

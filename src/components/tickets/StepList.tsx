import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button, IconButton } from '../../ui';
import { IconPlus, IconX } from '../../ui/icons';

/**
 * Lista de pasos editable (checklist inicial del ticket y checklist de las
 * plantillas). Arregla el bug de "uno por línea": se tipea de corrido, Enter
 * agrega y el campo queda listo para el siguiente; pegar varias líneas agrega
 * una por paso. Cada paso se puede corregir en el lugar o quitar.
 */
export function StepList({ value, onChange, label, placeholder = 'Escribí un paso y Enter', disabled }: {
  value: string[];
  onChange: (steps: string[]) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const add = (raw: string[], refocus = true) => {
    const clean = raw.map(item => item.trim()).filter(Boolean);
    if (clean.length) onChange([...value, ...clean]);
    setDraft('');
    if (refocus) inputRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (draft.trim()) add([draft]);
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/\n/.test(text)) return;
    event.preventDefault();
    add(text.split(/\r?\n/));
  };

  return (
    <div className="tkx-steps" role="group" aria-label={label}>
      {value.length > 0 && (
        <ol className="tkx-steps-list">
          {value.map((step, index) => (
            <li className="tkx-step" key={index}>
              <span className="tkx-step-n tkx-mono" aria-hidden="true">{index + 1}</span>
              <input
                className="tkx-step-input"
                value={step}
                disabled={disabled}
                aria-label={`Paso ${index + 1}`}
                onChange={event => onChange(value.map((item, i) => (i === index ? event.target.value : item)))}
                onBlur={() => { if (!step.trim()) onChange(value.filter((_, i) => i !== index)); }}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); inputRef.current?.focus(); } }}
              />
              {!disabled && <IconButton size="sm" label={`Quitar el paso ${index + 1}`} icon={<IconX size={14} />} onClick={() => onChange(value.filter((_, i) => i !== index))} />}
            </li>
          ))}
        </ol>
      )}
      {!disabled && (
        <div className="tkx-steps-add">
          <div className="ui-control ui-input tkx-grow">
            <input
              ref={inputRef}
              className="ui-input-el"
              value={draft}
              placeholder={placeholder}
              aria-label={`Agregar paso a ${label.toLowerCase()}`}
              enterKeyHint="enter"
              autoComplete="off"
              onChange={event => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => { if (draft.trim()) add([draft], false); }}
            />
          </div>
          <Button size="sm" variant="secondary" icon={<IconPlus size={14} />} disabled={!draft.trim()} onMouseDown={event => event.preventDefault()} onClick={() => add([draft])}>Agregar</Button>
        </div>
      )}
    </div>
  );
}

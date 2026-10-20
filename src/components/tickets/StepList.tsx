import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button, Collapse, IconButton } from '../../ui';
import { IconPlus, IconX } from '../../ui/icons';
import { ListItemMotion, useListMotion } from '../../utils/motion';

let stepSeq = 0;
const newStepId = () => `s${(stepSeq += 1)}`;

/**
 * Lista de pasos editable (checklist inicial del ticket y checklist de las
 * plantillas). Arregla el bug de "uno por línea": se tipea de corrido, Enter
 * agrega y el campo queda listo para el siguiente; pegar varias líneas agrega
 * una por paso. Cada paso se puede corregir en el lugar o quitar. Lo que se
 * agrega entra creciendo y lo que se quita se pliega (nada de golpe).
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
  // Identidad estable de cada paso (el texto se edita en el lugar y puede repetirse).
  const ids = useRef<string[]>([]);
  if (ids.current.length !== value.length) ids.current = value.map((_, index) => ids.current[index] || newStepId());
  const steps = useMemo(() => value.map((text, index) => ({ id: ids.current[index], text, index })), [value]);
  const rows = useListMotion(steps, step => step.id);

  const change = (next: string[], nextIds: string[]) => { ids.current = nextIds; onChange(next); };
  const removeAt = (index: number) => change(value.filter((_, i) => i !== index), ids.current.filter((_, i) => i !== index));
  const add = (raw: string[], refocus = true) => {
    const clean = raw.map(item => item.trim()).filter(Boolean);
    if (clean.length) change([...value, ...clean], [...ids.current, ...clean.map(newStepId)]);
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
      <Collapse open={rows.entries.length > 0} lazy={false}>
        <ol className="tkx-steps-list">
          {rows.entries.map(entry => {
            const { text: step, index } = entry.item;
            return (
              <li key={entry.key}>
                <ListItemMotion entry={entry} release={rows.release}>
                  <div className="tkx-step">
                    <span className="tkx-step-n tkx-mono" aria-hidden="true">{index + 1}</span>
                    <input
                      className="tkx-step-input"
                      value={step}
                      disabled={disabled}
                      aria-label={`Paso ${index + 1}`}
                      onChange={event => onChange(value.map((item, i) => (i === index ? event.target.value : item)))}
                      onBlur={() => { if (!entry.leaving && !step.trim()) removeAt(index); }}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); inputRef.current?.focus(); } }}
                    />
                    {!disabled && <IconButton size="sm" label={`Quitar el paso ${index + 1}`} icon={<IconX size={14} />} onClick={() => removeAt(index)} />}
                  </div>
                </ListItemMotion>
              </li>
            );
          })}
        </ol>
      </Collapse>
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

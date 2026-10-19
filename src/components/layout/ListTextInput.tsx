import { useState } from 'react';

type Separator = 'comma' | 'line';

function parseList(text: string, separator: Separator): string[] {
  return text.split(separator === 'line' ? '\n' : ',').map(item => item.trim()).filter(Boolean);
}

function formatList(items: string[], separator: Separator): string {
  return items.join(separator === 'line' ? '\n' : ', ');
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Campo de texto para listas "separadas por coma" o "una por línea" (tags,
 * responsables, pasos de checklist).
 *
 * Antes cada campo hacía `split → trim → filter` en el onChange y se volvía a
 * dibujar con `join`: la coma, el Enter o el espacio del final se borraban en el
 * acto y no se podía tipear un segundo ítem de corrido. Ahora se guarda el texto
 * crudo mientras se edita y el array que recibe el padre es el parseado (el
 * mismo de siempre, así guardar no cambia). Si el array cambia desde afuera
 * (plantilla aplicada, formulario reseteado), el texto se rearma.
 */
export function ListTextInput({ value, onChange, separator = 'comma', className = 'input', rows, placeholder }: {
  value: string[] | undefined;
  onChange: (items: string[]) => void;
  separator?: Separator;
  className?: string;
  /** Solo con separator="line" (se dibuja un textarea). */
  rows?: number;
  placeholder?: string;
}) {
  const items = value || [];
  const [text, setText] = useState(() => formatList(items, separator));
  // Patrón "ajustar estado durante el render": si el array externo ya no es lo
  // que dice el texto, manda el de afuera.
  const shown = sameList(parseList(text, separator), items) ? text : formatList(items, separator);
  if (shown !== text) setText(shown);

  const handle = (next: string) => {
    setText(next);
    onChange(parseList(next, separator));
  };

  if (separator === 'line') {
    return <textarea className={className} rows={rows} value={shown} placeholder={placeholder} onChange={event => handle(event.target.value)} />;
  }
  return <input className={className} value={shown} placeholder={placeholder} onChange={event => handle(event.target.value)} />;
}

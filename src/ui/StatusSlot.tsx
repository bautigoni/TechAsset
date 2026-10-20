import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Collapse } from './Collapse';
import { StatusLine, type StatusMessage } from './Status';

type Item = StatusMessage & { key: number };

/**
 * La línea de estado de un bloque entra y sale con el colapso compartido: alto
 * suave (nada empuja de golpe lo de abajo), el control tocado queda quieto y,
 * si quedó fuera de vista, se la trae. Mientras se pliega sigue mostrando el
 * último mensaje; plegada, se desmonta (no queda nada en el flujo). El gap del
 * padre se lee solo (`gap="auto"`), así tampoco salta el espacio entre bloques.
 */
function StatusFold({ item, open, onDismiss, onClosed, className, outerClassName }: {
  item: Item;
  open: boolean;
  onDismiss: () => void;
  onClosed: () => void;
  className?: string;
  outerClassName?: string;
}) {
  return (
    <Collapse open={open} appear gap="auto" className={className ? `ui-status-slot ${className}` : 'ui-status-slot'} outerClassName={outerClassName} onSettled={value => { if (!value) onClosed(); }}>
      <StatusLine {...item} key={item.key} onDismiss={onDismiss} />
    </Collapse>
  );
}

/**
 * Una línea de estado por bloque: `status.show({...})` reemplaza a la
 * anterior; `{status.element}` va debajo de donde pasó la acción (o
 * `status.slot('mi-clase')` si el lugar lleva margen o padding propio: la
 * clase va adentro del colapso y se anima con el alto). `element` es `null`
 * solo cuando no hay nada que mostrar ni que plegar.
 */
export function useStatusLine() {
  const [current, setCurrent] = useState<Item | null>(null);
  const [shown, setShown] = useState<Item | null>(null);
  if (current && current !== shown) setShown(current);
  const counter = useRef(0);
  const clear = useCallback(() => setCurrent(null), []);
  const show = useCallback((message: StatusMessage) => {
    counter.current += 1;
    setCurrent({ ...message, key: counter.current });
  }, []);
  const currentRef = useRef(current);
  currentRef.current = current;
  // Terminó de plegarse: se suelta (salvo que haya llegado otro mensaje mientras tanto).
  const release = useCallback(() => { if (!currentRef.current) setShown(null); }, []);
  const slot = (className?: string, outerClassName?: string): ReactNode => (shown
    ? <StatusFold item={shown} open={Boolean(current)} onDismiss={clear} onClosed={release} className={className} outerClassName={outerClassName} />
    : null);
  return { show, clear, element: slot(), slot, current };
}

export type StatusLineApi = ReturnType<typeof useStatusLine>;

/**
 * Lugar fijo para la línea de estado de un bloque (`useStatusLine`): lo mismo
 * que `{status.slot(className, outerClassName)}`.
 *
 *   const status = useStatusLine();
 *   <StatusSlot status={status} />
 */
export function StatusSlot({ status, className, outerClassName }: { status: StatusLineApi; className?: string; outerClassName?: string }) {
  return <>{status.slot(className, outerClassName)}</>;
}

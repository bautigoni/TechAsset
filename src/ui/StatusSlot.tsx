import { useRef } from 'react';
import { Collapse } from './Collapse';
import { StatusLine, type StatusMessage } from './Status';

type StatusLineApi = { current: (StatusMessage & { key: number }) | null; clear: () => void };

/**
 * Lugar fijo para la línea de estado de un bloque (`useStatusLine`), que
 * aparece y se va con el colapso compartido (alto suave, sin empujar de golpe
 * lo de abajo; el control tocado queda quieto y, si quedó fuera de vista, se
 * la trae). Mientras se cierra conserva el último mensaje.
 *
 *   const status = useStatusLine();
 *   <StatusSlot status={status} />
 */
export function StatusSlot({ status, className, outerClassName }: { status: StatusLineApi; className?: string; outerClassName?: string }) {
  const last = useRef(status.current);
  if (status.current) last.current = status.current;
  const shown = status.current || last.current;
  return (
    <Collapse open={Boolean(status.current)} className={className} outerClassName={outerClassName} unmountOnClose>
      {shown && <StatusLine {...shown} key={shown.key} onDismiss={status.clear} />}
    </Collapse>
  );
}

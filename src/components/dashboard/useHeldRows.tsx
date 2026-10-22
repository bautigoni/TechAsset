import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { Device } from '../../types';
import { COLLAPSE_MS, StatusLine, cx, keepInPlace, scrollParentOf, type StatusMessage } from '../../ui';
import { aliasOf } from './dashModel';

/*
 * Filas que se quedan en su lugar después de una acción (QA ronda 1, ítem 4).
 *
 * Antes, devolver desde "Prestados" sacaba la fila de la lista en el acto y
 * metía la línea "Touch 8 devuelto · Deshacer" ARRIBA de las filas (+74 px):
 * todo lo de abajo saltaba bajo el puntero. Un segundo clic a 250 ms del
 * primero (el impaciente) cayó en la fila de Dell 2 y abrió su ficha; en
 * mobile el aviso quedaba arriba, fuera de la vista.
 *
 * Ahora la fila tocada se convierte en su propio aviso, con el mismo alto:
 *   - nada de lo que está bajo el puntero o el dedo se mueve al devolver;
 *   - el aviso (y el Deshacer) aparece donde se tocó, siempre a la vista;
 *   - recién cuando terminó la cuenta del Deshacer Y el usuario dejó la lista
 *     (el mouse salió, o 1,5 s sin tocarla en touch) la fila se pliega suave
 *     (250 ms; instantáneo con movimiento reducido). Si quedó arriba de lo
 *     que se ve, lo visible no se corre (keepInPlace).
 *   - el Deshacer no responde en los primeros 500 ms desde el clic que devolvió:
 *     un doble clic sobre "Devolver" nunca lo deshace.
 */

export type HeldRow = {
  tag: string;
  /** El equipo como estaba al tocarlo (para el alias del aviso). */
  device: Device;
  message: StatusMessage;
  /** Cambia con cada aviso nuevo: remonta la línea (cuenta del Deshacer nueva). */
  key: number;
  /** Alto que tenía la fila: el aviso lo conserva (lo de abajo no sube). */
  height: number;
  /** Fila que estaba arriba al tocarla: la retenida se dibuja debajo de ella. */
  after: string | null;
  index: number;
  /** Antes de esto no se va (lo que dura el Deshacer). */
  until: number;
  /** El Deshacer no responde antes de esto (doble clic sobre Devolver). */
  armedAt: number;
  /** El foco estaba en la fila: pasa al Deshacer. */
  focus: boolean;
  expired: boolean;
  leaving: boolean;
};

type Snapshot = Pick<HeldRow, 'tag' | 'device' | 'height' | 'after' | 'index' | 'focus'>;

const HOT_MS = 1500;
const ARM_MS = 500;
const MIN_SHOW_MS = 4000;
const ALERT_SHOW_MS = 8000;

/** Aviso corto para las otras filas de un lote (el completo, con Deshacer, va en la primera). */
function compact(device: Device, message: StatusMessage): StatusMessage {
  const verb = message.tone === 'ok' ? 'devuelto' : message.tone === 'info' ? 'deshecho' : 'mirá el aviso de arriba';
  return { tone: message.tone, message: <><b>{aliasOf(device)}</b> · {verb}</>, autoHideMs: 0 };
}

export function useHeldRows(listRef: RefObject<HTMLUListElement | null>, byTag: Map<string, Device>, resetKey: string) {
  const [held, setHeld] = useState<Map<string, HeldRow>>(() => new Map());
  const heldRef = useRef(held);
  heldRef.current = held;
  const counter = useRef(0);
  const hovering = useRef(false);
  const lastDown = useRef(0);
  const [tick, setTick] = useState(0);

  // Otra pestaña, tipo o búsqueda: es otra lista, lo retenido se suelta.
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    setHeld(current => (current.size ? new Map() : current));
  }, [resetKey]);

  /** Cómo estaban las filas al tocarlas (alto, lugar, foco). Antes de mandar nada. */
  const snapshot = useCallback((tags: string[]) => {
    const list = listRef.current;
    const rows = list ? [...list.children] as HTMLElement[] : [];
    const out = new Map<string, Snapshot>();
    for (const tag of tags) {
      const li = rows.find(row => row.dataset.deviceTag === tag);
      const device = byTag.get(tag);
      if (!li || !device) continue;
      const index = rows.indexOf(li);
      const previous = rows[index - 1];
      out.set(tag, {
        tag,
        device,
        height: li.getBoundingClientRect().height,
        after: previous?.dataset.deviceTag || null,
        index,
        focus: Boolean(document.activeElement && li.contains(document.activeElement))
      });
    }
    return out;
  }, [byTag, listRef]);

  /**
   * Muestra `message` EN las filas tocadas (la primera lleva el aviso completo).
   * Devuelve false si ninguna está dibujada (quien llama usa otro lugar).
   */
  const pin = useCallback((tags: string[], snap: Map<string, Snapshot>, message: StatusMessage, clickedAt: number) => {
    const current = heldRef.current;
    const known = tags.filter(tag => snap.has(tag) || current.has(tag));
    if (!known.length) return false;
    known.sort((a, b) => (current.get(a)?.index ?? snap.get(a)!.index) - (current.get(b)?.index ?? snap.get(b)!.index));
    counter.current += 1;
    const key = counter.current;
    const now = Date.now();
    // Un aviso nuevo en una fila retenida (el resultado del Deshacer) conserva el foco que tenía.
    const focusedHeld = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-held]') || [])]
      .find(li => document.activeElement && li.contains(document.activeElement))?.dataset.deviceTag;
    const life = message.undo ?(message.undo.seconds ?? 8) * 1000 : message.tone === 'bad' || message.tone === 'warn' ? ALERT_SHOW_MS : MIN_SHOW_MS;
    setHeld(previous => {
      const next = new Map(previous);
      known.forEach((tag, order) => {
        const base = previous.get(tag) || snap.get(tag);
        if (!base) return;
        const msg = order === 0 ? { ...message, autoHideMs: 0 } : compact(base.device, message);
        next.set(tag, {
          ...base,
          message: msg,
          key: key * 1000 + order,
          until: now + life,
          armedAt: clickedAt + ARM_MS,
          focus: order === 0 && (Boolean(base.focus) || focusedHeld === tag),
          expired: false,
          leaving: false
        });
      });
      return next;
    });
    return true;
  }, [listRef]);

  /** Terminó la cuenta del Deshacer: queda la confirmación sin el botón. */
  const expire = useCallback((tag: string, key: number) => {
    setHeld(previous => {
      const row = previous.get(tag);
      if (!row || row.key !== key || row.expired) return previous;
      const next = new Map(previous);
      const { undo: _undo, ...rest } = row.message;
      next.set(tag, { ...row, message: rest, expired: true, focus: false });
      return next;
    });
  }, []);

  const drop = useCallback((tag: string) => {
    setHeld(previous => {
      if (!previous.has(tag)) return previous;
      const next = new Map(previous);
      next.delete(tag);
      return next;
    });
  }, []);

  // ¿Se puede ir? Pasó su tiempo y el usuario no está usando la lista.
  // `live`: equipos que igual están en la lista (pestaña Todos, o el Deshacer
  // lo volvió a prestar): esos no se pliegan, la fila vuelve a ser la de siempre.
  const settle = useCallback((live: Set<string>) => {
    const now = Date.now();
    const hot = hovering.current || now - lastDown.current < HOT_MS;
    let wake = Infinity;
    const leave: string[] = [];
    const release: string[] = [];
    for (const row of heldRef.current.values()) {
      if (row.leaving) continue;
      if (now < row.until) { wake = Math.min(wake, row.until); continue; }
      if (hot) { if (!hovering.current) wake = Math.min(wake, lastDown.current + HOT_MS); continue; }
      (live.has(row.tag) ? release : leave).push(row.tag);
    }
    if (leave.length || release.length) {
      setHeld(previous => {
        const next = new Map(previous);
        release.forEach(tag => next.delete(tag));
        leave.forEach(tag => { const row = next.get(tag); if (row) next.set(tag, { ...row, leaving: true }); });
        return next;
      });
    }
    return wake;
  }, []);

  const pointer = {
    onPointerEnter: (event: PointerEvent) => { if (event.pointerType === 'mouse') hovering.current = true; },
    onPointerLeave: (event: PointerEvent) => { if (event.pointerType === 'mouse') { hovering.current = false; setTick(value => value + 1); } },
    onPointerDown: () => { lastDown.current = Date.now(); }
  };

  return { held, snapshot, pin, expire, drop, settle, pointer, tick, setTick };
}

/** Programa la próxima revisión de lo retenido (fin del Deshacer o del "en uso"). */
export function useHeldTimer(held: Map<string, HeldRow>, tick: number, live: Set<string>, settle: (live: Set<string>) => number, bump: () => void) {
  useEffect(() => {
    if (!held.size) return;
    const wake = settle(live);
    if (wake === Infinity) return;
    const timer = window.setTimeout(bump, Math.max(60, wake - Date.now() + 20));
    return () => window.clearTimeout(timer);
  }, [held, tick, live, settle, bump]);
}

/** La fila convertida en su aviso: mismo alto, el aviso centrado, se pliega suave al irse. */
export function HeldRowView({ row, onExpire, onLeft }: { row: HeldRow; onExpire: () => void; onLeft: () => void }) {
  const ref = useRef<HTMLLIElement | null>(null);
  const leftRef = useRef(onLeft);
  leftRef.current = onLeft;

  // El foco estaba en la fila (teclado): pasa al Deshacer, no se pierde en el body.
  useEffect(() => {
    if (!row.focus) return;
    const target = ref.current?.querySelector<HTMLElement>('.ui-status-undo, button');
    target?.focus({ preventScroll: true });
  }, [row.focus, row.key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!row.leaving || !el) return;
    // Si el foco estaba adentro, pasa a la fila siguiente (o la anterior).
    if (document.activeElement && el.contains(document.activeElement)) {
      const near = (el.nextElementSibling || el.previousElementSibling) as HTMLElement | null;
      near?.querySelector<HTMLElement>('.dash-row-hit')?.focus({ preventScroll: true });
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Si la fila quedó arriba de lo que se ve, lo visible no se corre al plegarla.
    const scroller = scrollParentOf(el);
    const doc = scroller === document.scrollingElement || scroller === document.documentElement;
    const viewTop = doc ? 0 : scroller.getBoundingClientRect().top;
    const rect = el.getBoundingClientRect();
    const below = el.nextElementSibling as HTMLElement | null;
    if (rect.bottom <= viewTop + 1 && below) keepInPlace(below, { duration: reduced ? 0 : COLLAPSE_MS + 60 });
    if (reduced) { leftRef.current(); return; }
    el.style.height = `${rect.height}px`;
    el.style.minHeight = '0px';
    el.style.overflow = 'hidden';
    void el.offsetHeight;
    el.style.transition = `height ${COLLAPSE_MS}ms var(--g-ease, ease), opacity ${COLLAPSE_MS}ms var(--g-ease, ease)`;
    el.style.height = '0px';
    el.style.opacity = '0';
    const timer = window.setTimeout(() => leftRef.current(), COLLAPSE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [row.leaving]);

  const { message } = row;
  const undo = message.undo;
  return (
    <li ref={ref} className={cx('dash-row', 'dash-row--held', row.leaving && 'is-leaving')} data-device-tag={row.tag} data-held="" style={{ minHeight: row.height }}>
      <div className="dash-held">
        <StatusLine
          key={row.key}
          {...message}
          className="dash-held-line"
          autoHideMs={0}
          undo={undo && !row.expired ? {
            ...undo,
            // Un doble clic sobre "Devolver" no puede caer en el Deshacer que aparece en su lugar.
            onUndo: () => (Date.now() < row.armedAt ? undefined : undo.onUndo())
          } : undefined}
          onDismiss={undo && !row.expired ? onExpire : undefined}
        />
      </div>
    </li>
  );
}

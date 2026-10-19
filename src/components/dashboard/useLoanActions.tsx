import { useCallback, useRef, useState } from 'react';
import type { Device } from '../../types';
import type { LoanBatchResponse } from '../../services/loansApi';

/** Respuesta de POST /api/loans/undo (loansUndo.routes.js). */
type UndoResponse = { ok: true; done?: number; results: Array<{ etiqueta: string; ok: boolean; error?: string; persona?: string }> };
import type { StatusMessage } from '../../ui';
import { errorMessage } from '../layout/Feedback';
import { aliasOf } from './dashModel';

export type LoanHandlers = {
  onReturn: (payload: Record<string, unknown>) => Promise<unknown>;
  onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  onLend: (payload: Record<string, unknown>) => Promise<unknown>;
  onLendBatch: (payload: Record<string, unknown> & { etiquetas: string[] }) => Promise<LoanBatchResponse>;
  onUndo: (kind: 'return' | 'lend', etiquetas: string[]) => Promise<UndoResponse>;
};

type Show = (message: StatusMessage) => void;

const UNDO_SECONDS = 8;

/**
 * Prestar y devolver desde el Inicio (barra de acción y lista), con el
 * resultado en una línea de estado: éxito con Deshacer de 8 s, parcial con
 * Deshacer + Reintentar lo que falló, error con Reintentar. Un equipo no se
 * manda dos veces mientras está en vuelo (`busy`).
 */
export function useLoanActions(devices: Device[], handlers: LoanHandlers) {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const busyRef = useRef(new Set<string>());
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const nameOf = useCallback((tag: string) => {
    const device = devicesRef.current.find(item => item.etiqueta === tag);
    return device ? aliasOf(device) : tag;
  }, []);
  const personOf = (tag: string) => devicesRef.current.find(item => item.etiqueta === tag)?.prestadoA || '';
  const names = (tags: string[]) => tags.map(nameOf).join(', ');

  const mark = (tags: string[], on: boolean) => {
    tags.forEach(tag => (on ? busyRef.current.add(tag) : busyRef.current.delete(tag)));
    setBusy(new Set(busyRef.current));
  };

  const undo = useCallback(async (kind: 'return' | 'lend', tags: string[], show: Show, people?: Map<string, string>) => {
    try {
      const result = await handlersRef.current.onUndo(kind, tags);
      const failed = result.results.filter(item => !item.ok);
      const ok = result.results.filter(item => item.ok);
      if (!ok.length) {
        show({ tone: 'bad', message: <>No se pudo deshacer · {failed.map(item => item.error).join(' · ')}</> });
        return;
      }
      const label = ok.length === 1
        ? kind === 'return'
          ? <>Deshecho: <b>{nameOf(ok[0].etiqueta)}</b> sigue con {ok[0].persona || people?.get(ok[0].etiqueta) || 'la misma persona'}</>
          : <>Deshecho: <b>{nameOf(ok[0].etiqueta)}</b> vuelve a estar libre</>
        : <>Deshecho: {ok.length} equipos {kind === 'return' ? 'siguen prestados' : 'vuelven a estar libres'}</>;
      show({ tone: failed.length ? 'warn' : 'info', message: failed.length ? <>{label} · {failed.map(item => item.error).join(' · ')}</> : label });
    } catch (reason) {
      show({ tone: 'bad', message: <>No se pudo deshacer · {errorMessage(reason, 'Error del servidor')}</>, retry: { onRetry: () => undo(kind, tags, show, people) } });
    }
  }, [nameOf]);

  /** Devuelve uno (POST /loans/return) o varios en un request (/return-batch). */
  const returnDevices = useCallback(async (tags: string[], show: Show): Promise<boolean> => {
    const list = tags.filter(tag => !busyRef.current.has(tag));
    if (!list.length) return false;
    const people = new Map(list.map(tag => [tag, personOf(tag)]));
    mark(list, true);
    try {
      let okTags = list;
      let failed: Array<{ etiqueta: string; error?: string }> = [];
      if (list.length === 1) {
        await handlersRef.current.onReturn({ etiqueta: list[0] });
      } else {
        const result = await handlersRef.current.onReturnBatch(list);
        okTags = result.results.filter(item => item.ok && !item.idempotent).map(item => item.etiqueta);
        failed = result.results.filter(item => !item.ok);
      }
      const retry = failed.length ? { label: failed.length === 1 ? `Reintentar ${nameOf(failed[0].etiqueta)}` : `Reintentar ${failed.length}`, onRetry: () => returnDevices(failed.map(item => item.etiqueta), show) } : undefined;
      const undoAction = okTags.length ? { seconds: UNDO_SECONDS, onUndo: () => undo('return', okTags, show, people) } : undefined;
      if (failed.length) {
        show({
          tone: 'bad',
          message: <>{list.length - failed.length} de {list.length} devueltos · {failed.map(item => `${nameOf(item.etiqueta)}: ${item.error || 'error'}`).join(' · ')}</>,
          undo: undoAction,
          retry,
          autoHideMs: 0
        });
      } else if (list.length === 1) {
        const person = people.get(list[0]);
        show({ tone: 'ok', message: <><b>{nameOf(list[0])}</b> devuelto{person ? <span className="dash-status-sub"> · {person}</span> : null}</>, undo: undoAction });
      } else {
        show({ tone: 'ok', message: <><b>{list.length} devueltos</b><span className="dash-status-sub"> · {names(list)}</span></>, undo: undoAction });
      }
      return !failed.length;
    } catch (reason) {
      show({
        tone: 'bad',
        message: <>No se pudo devolver {names(list)} · {errorMessage(reason, 'Error del servidor')}</>,
        retry: { onRetry: () => returnDevices(list, show) },
        autoHideMs: 0
      });
      return false;
    } finally {
      mark(list, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameOf, undo]);

  /** Presta uno (/loans/lend) o varios con los mismos datos (/lend-batch). */
  const lendDevices = useCallback(async (tags: string[], payload: Record<string, unknown>, show: Show): Promise<{ ok: boolean; error?: string }> => {
    const list = tags.filter(tag => !busyRef.current.has(tag));
    if (!list.length) return { ok: false, error: 'Ya se está prestando.' };
    const person = String(payload.person || '');
    mark(list, true);
    try {
      let okTags = list;
      let failed: Array<{ etiqueta: string; error?: string }> = [];
      if (list.length === 1) {
        await handlersRef.current.onLend({ ...payload, etiqueta: list[0] });
      } else {
        const result = await handlersRef.current.onLendBatch({ ...payload, etiquetas: list });
        okTags = result.results.filter(item => item.ok).map(item => item.etiqueta);
        failed = result.results.filter(item => !item.ok);
      }
      const undoAction = okTags.length ? { seconds: UNDO_SECONDS, onUndo: () => undo('lend', okTags, show) } : undefined;
      if (failed.length) {
        show({
          tone: 'bad',
          message: <>{okTags.length} de {list.length} prestados a {person} · {failed.map(item => `${nameOf(item.etiqueta)}: ${item.error || 'error'}`).join(' · ')}</>,
          undo: undoAction,
          autoHideMs: 0
        });
      } else {
        show({
          tone: 'ok',
          message: list.length === 1
            ? <><b>{nameOf(list[0])}</b> prestado<span className="dash-status-sub"> · {person}</span></>
            : <><b>{list.length} prestados</b><span className="dash-status-sub"> · {person} · {names(list)}</span></>,
          undo: undoAction
        });
      }
      return { ok: true };
    } catch (reason) {
      // El error del préstamo (validación, 409) se muestra en el formulario.
      return { ok: false, error: errorMessage(reason, 'No se pudo registrar el préstamo.') };
    } finally {
      mark(list, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameOf, undo]);

  return { busy, returnDevices, lendDevices };
}

export type LoanActions = ReturnType<typeof useLoanActions>;

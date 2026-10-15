import { useMemo, useState, type MouseEvent } from 'react';
import type { Device } from '../../types';
import { getDeviceNumber, getOperationalAlias, getOperationalGroup, getOperationalNumber } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';
import { Button } from '../layout/Button';
import { CollapsiblePanel, SelectModeToggle, SelectionBar, batchResultMessage, useChipSelection } from './ChipPanelKit';
import { TIME_HM, formatDate } from '../../utils/formatters';
import type { LoanBatchResponse } from '../../services/loansApi';

/**
 * Grilla de equipos por tipo dentro de Préstamos, con la misma mecánica que los
 * cartelitos: un botón por equipo, clic en uno libre carga su etiqueta en el
 * formulario de arriba y clic en uno prestado lo devuelve en el acto.
 *
 * Cada tipo es un desplegable (cerrado de entrada, recuerda cuáles dejaste
 * abiertos). Con "Seleccionar varios" —o Ctrl/Shift+clic— los clics marcan en
 * vez de actuar, y la barra de abajo presta el lote (lo pasa a la lista del
 * formulario, que pide persona una sola vez) o lo devuelve de una.
 *
 * No tiene API propia: dibuja los mismos `devices` que el resto de la página y
 * presta/devuelve por los mismos caminos, así que todo termina en la misma base.
 */
export function DeviceChipsPanel({ devices, consultationMode, onReturnBatch, onSeedCode, onBatchLend }: {
  devices: Device[];
  consultationMode: boolean;
  onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  onSeedCode: (etiqueta: string) => void;
  onBatchLend: (etiquetas: string[]) => void;
}) {
  const [busyTags, setBusyTags] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const { selected, toggle, toggleMany, clear } = useChipSelection();

  // Los grupos grandes primero (Touch antes que TIC): el total por tipo no
  // cambia al prestar, así que el orden queda quieto mientras se opera.
  const groups = useMemo(() => {
    const byGroup = new Map<string, Device[]>();
    for (const device of devices) {
      const key = getOperationalGroup(device) || 'Otro';
      const list = byGroup.get(key);
      if (list) list.push(device);
      else byGroup.set(key, [device]);
    }
    return [...byGroup.entries()]
      .map(([nombre, items]) => ({
        nombre,
        items: [...items].sort((a, b) =>
          getOperationalNumber(a) - getOperationalNumber(b)
          || String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es', { numeric: true })),
        prestados: items.filter(device => getDeviceStateKey(device) === 'loaned')
      }))
      .sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre, 'es'));
  }, [devices]);

  // La selección se resuelve contra el estado actual: si alguien devolvió un
  // equipo marcado mientras tanto, pasa solo de "devolver" a "prestar".
  const selectedDevices = useMemo(
    () => devices.filter(device => selected.has(device.etiqueta)),
    [devices, selected]
  );
  const toLend = selectedDevices.filter(device => getDeviceStateKey(device) === 'available');
  const toReturn = selectedDevices.filter(device => getDeviceStateKey(device) === 'loaned');
  const busy = busyTags.size > 0;

  const exitSelection = () => {
    clear();
    setSelectMode(false);
  };

  const returnDevices = async (list: Device[]) => {
    if (busy || !list.length) return;
    setBusyTags(new Set(list.map(device => device.etiqueta)));
    setMessage(null);
    // Todo el lote en un solo request (antes: uno por equipo + recarga del inventario cada vez).
    let errors: string[] = [];
    try {
      const response = await onReturnBatch(list.map(device => device.etiqueta));
      errors = response.results.filter(item => !item.ok).map(item => `${item.etiqueta}: ${item.error || 'no se pudo registrar'}`);
    } catch (reason) {
      errors = [reason instanceof Error ? reason.message : 'No se pudo registrar la devolución.'];
    }
    setBusyTags(new Set());
    if (list.length === 1) {
      setMessage(errors.length ? { tone: 'error', text: errors[0] } : null);
    } else {
      setMessage(batchResultMessage('Se devolvieron', 'equipos', list.length, errors));
    }
  };

  const returnSelected = async () => {
    const list = toReturn;
    if (list.length > 1 && !window.confirm(`¿Devolver ${list.length} equipos?`)) return;
    exitSelection();
    await returnDevices(list);
  };

  const lendSelected = () => {
    if (!toLend.length) return;
    onBatchLend(toLend.map(device => device.etiqueta));
    exitSelection();
  };

  const onChipClick = (event: MouseEvent, device: Device, prestado: boolean) => {
    if (selectMode || event.ctrlKey || event.metaKey || event.shiftKey) {
      if (!selectMode) setSelectMode(true);
      toggle(device.etiqueta);
      return;
    }
    if (prestado) void returnDevices([device]);
    else onSeedCode(device.etiqueta);
  };

  if (!groups.length) return null;

  return (
    <div className="device-pass-stack">
      <div className="chip-stack-head">
        <div>
          <h3>Equipos por tipo</h3>
          <span className="muted">
            {selectMode ? 'Tocá los equipos que quieras marcar.' : 'Tocá un tipo para desplegarlo. Ctrl+clic marca varios.'}
          </span>
        </div>
        <SelectModeToggle
          active={selectMode}
          disabled={consultationMode}
          onChange={next => { if (next) setSelectMode(true); else exitSelection(); }}
        />
      </div>
      {message && <div className={message.tone === 'ok' ? 'tool-info' : message.tone === 'warn' ? 'tool-warning' : 'tool-error'}>{message.text}</div>}
      {groups.map(group => {
        const seleccionables = group.items
          .filter(device => getDeviceStateKey(device) === 'available' || getDeviceStateKey(device) === 'loaned')
          .map(device => device.etiqueta);
        const marcados = seleccionables.filter(tag => selected.has(tag)).length;
        return (
          <CollapsiblePanel
            key={group.nombre}
            id={`devices:${group.nombre}`}
            className="device-pass-panel"
            title={group.nombre}
            used={group.prestados.length}
            total={group.items.length}
            usedLabel="prestados"
            extra={selectMode && seleccionables.length > 0 && (
              <button type="button" className="chip-select-all" onClick={() => toggleMany(seleccionables)}>
                {marcados === seleccionables.length ? 'Ninguno' : 'Todos'}
              </button>
            )}
          >
            <div className="pass-chips">
              {group.items.map(device => {
                const estado = getDeviceStateKey(device);
                const numero = getDeviceNumber(device);
                const alias = getOperationalAlias(device) || device.etiqueta;
                const bloqueado = estado === 'missing' || estado === 'out';
                const prestado = estado === 'loaned';
                const marcado = selected.has(device.etiqueta);
                return (
                  <button
                    key={device.id || device.etiqueta}
                    type="button"
                    className={`pass-chip ${numero ? '' : 'is-wide'} ${prestado ? 'is-prestado' : ''} ${bloqueado ? 'is-bloqueado' : ''} ${marcado ? 'is-selected' : ''} ${busyTags.has(device.etiqueta) ? 'is-busy' : ''}`}
                    disabled={consultationMode || bloqueado || busyTags.has(device.etiqueta)}
                    aria-pressed={selectMode ? marcado : undefined}
                    title={bloqueado
                      ? `${alias} · ${device.etiqueta} — ${device.estado || 'no disponible'}`
                      : selectMode
                        ? `${alias} · ${device.etiqueta} — clic para ${marcado ? 'desmarcar' : 'marcar'}`
                        : prestado
                          ? `${alias} · ${device.etiqueta} — ${device.prestadoA || 'sin persona'}${device.curso ? ` · ${device.curso}` : ''}${device.ubicacion ? ` · ${device.ubicacion}` : ''} — clic para devolver`
                          : `${alias} · ${device.etiqueta} — clic para prestar`}
                    onClick={event => onChipClick(event, device, prestado)}
                  >
                    {numero || device.etiqueta}
                  </button>
                );
              })}
            </div>
            {group.prestados.length > 0 && (
              <ul className="pass-lent-list">
                {group.prestados.map(device => (
                  <li key={device.id || device.etiqueta}>
                    <b>{getDeviceNumber(device) || device.etiqueta}</b>
                    <span>
                      {device.prestadoA || 'Sin persona'}
                      {device.curso && <em>{device.curso}</em>}
                      {device.ubicacion && <i>{device.ubicacion}</i>}
                    </span>
                    <time>{formatDate(device.loanedAt, TIME_HM)}</time>
                  </li>
                ))}
              </ul>
            )}
          </CollapsiblePanel>
        );
      })}
      <SelectionBar count={selectedDevices.length} onClear={clear}>
        {toLend.length > 0 && <Button variant="primary" disabled={busy} onClick={lendSelected}>Prestar {toLend.length}</Button>}
        {toReturn.length > 0 && <Button variant="success" disabled={busy} onClick={() => void returnSelected()}>Devolver {toReturn.length}</Button>}
      </SelectionBar>
    </div>
  );
}

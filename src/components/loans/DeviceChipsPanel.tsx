import { useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Device } from '../../types';
import { getDeviceNumber, getOperationalAlias, getOperationalGroup, getOperationalNumber } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';
import { formatLoanDateTime, formatTimeOnly, loanAgeDays } from '../../utils/formatters';
import type { LoanBatchResponse } from '../../services/loansApi';
import { Button } from '../../ui/Button';
import { useStatusLine } from '../../ui/Status';
import { TruncatedText } from '../../ui/Truncated';
import { cx } from '../../ui/util';
import { keepInPlace } from '../../ui/Collapse';
import {
  ChipLegend, GroupToggle, LazyBody, SelectModeButton, SelectionBar, SelectionSwap, batchResultMessage, deviceChipKind, isMarkClick, usePanelOpen
} from './ChipPanelKit';
import { SuccessCheck } from './ScanMessage';
import type { UndoFn } from './LoanForm';

type Group = { nombre: string; items: Device[]; prestados: Device[]; libres: number; selectable: string[] };

/**
 * Grilla de equipos por tipo. Cada tipo es un desplegable (cerrado de
 * entrada, recuerda cuáles dejaste abiertos) con un anillo de libres/total.
 *
 * Gramática del clic (la misma de siempre, la de los cartelitos):
 * - clic en uno libre → carga su etiqueta en el formulario de arriba (no presta);
 * - clic en uno prestado → lo devuelve en el acto (con Deshacer en línea);
 * - Ctrl, Cmd o Shift + clic → lo marca sin prestar ni devolver y prende solo
 *   el modo selección; Shift + clic sobre otro del mismo tipo marca el RANGO;
 * - en modo selección, el clic simple marca/desmarca;
 * - fuera de servicio / no encontrados: deshabilitados, no responden a nada.
 *
 * La barra de selección reemplaza al encabezado: "Prestar N" manda el lote al
 * escaneo continuo del formulario (con foco en Persona), "Devolver N" devuelve
 * en UN request (confirmando en la barra si son más de uno).
 */
export function DeviceChipsPanel({ devices, consultationMode, onReturnBatch, onUndo, onSeedCode, onBatchLend }: {
  devices: Device[];
  consultationMode: boolean;
  onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  onUndo: UndoFn;
  onSeedCode: (etiqueta: string) => void;
  onBatchLend: (etiquetas: string[]) => void;
}) {
  const [busyTags, setBusyTags] = useState<Set<string>>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const anchor = useRef<{ key: string; group: string } | null>(null);
  const status = useStatusLine();

  // Los grupos grandes primero (Touch antes que TIC): el total por tipo no
  // cambia al prestar, así que el orden queda quieto mientras se opera.
  const groups = useMemo<Group[]>(() => {
    const byGroup = new Map<string, Device[]>();
    for (const device of devices) {
      const key = getOperationalGroup(device) || 'Otro';
      const list = byGroup.get(key);
      if (list) list.push(device);
      else byGroup.set(key, [device]);
    }
    return [...byGroup.entries()]
      .map(([nombre, list]) => {
        const items = [...list].sort((a, b) =>
          getOperationalNumber(a) - getOperationalNumber(b)
          || String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es', { numeric: true }));
        const keys = items.map(device => getDeviceStateKey(device));
        return {
          nombre,
          items,
          prestados: items.filter((_, index) => keys[index] === 'loaned'),
          libres: keys.filter(key => key === 'available').length,
          selectable: items.filter((_, index) => keys[index] === 'available' || keys[index] === 'loaned').map(device => device.etiqueta)
        };
      })
      .sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre, 'es'));
  }, [devices]);

  // La selección se resuelve contra el estado actual: si alguien devolvió un
  // equipo marcado mientras tanto, pasa solo de "Devolver" a "Prestar".
  const selectedDevices = useMemo(() => devices.filter(device => selected.has(device.etiqueta)), [devices, selected]);
  const toLend = selectedDevices.filter(device => getDeviceStateKey(device) === 'available');
  const toReturn = selectedDevices.filter(device => getDeviceStateKey(device) === 'loaned');
  const busy = busyTags.size > 0;

  const exitSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
    setConfirming(false);
    anchor.current = null;
  };

  const toggle = (key: string, group: string) => {
    anchor.current = { key, group };
    setConfirming(false);
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setMany = (keys: string[], on: boolean) => {
    setConfirming(false);
    setSelected(current => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const returnDevices = async (list: Device[]) => {
    if (busy || !list.length) return;
    setBusyTags(new Set(list.map(device => device.etiqueta)));
    status.clear();
    // Todo el lote en un solo request.
    let errors: string[] = [];
    let done: string[] = [];
    let idempotent = false;
    try {
      const response = await onReturnBatch(list.map(device => device.etiqueta));
      errors = response.results.filter(item => !item.ok).map(item => `${item.etiqueta}: ${item.error || 'no se pudo registrar'}`);
      done = response.results.filter(item => item.ok && !item.idempotent).map(item => item.etiqueta);
      idempotent = response.results.some(item => item.idempotent);
    } catch (reason) {
      errors = [reason instanceof Error ? reason.message : 'No se pudo registrar la devolución.'];
    }
    setBusyTags(new Set());
    if (list.length === 1) {
      const device = list[0];
      if (errors.length) { status.show({ tone: 'bad', message: errors[0] }); return; }
      if (!done.length && idempotent) { status.show({ tone: 'warn', message: `${device.etiqueta} ya estaba disponible. No se registró otra devolución.` }); return; }
      const text = `${getOperationalAlias(device) || device.etiqueta} (${device.etiqueta}) devuelto${device.prestadoA ? ` · lo tenía ${device.prestadoA}` : ''}`;
      status.show({ tone: 'ok', icon: <SuccessCheck />, message: text, undo: { seconds: 8, onUndo: () => undo(done, text) } });
      return;
    }
    const result = batchResultMessage('Se devolvieron', 'equipos', list.length, errors);
    const text = result.text;
    status.show({
      tone: result.tone === 'ok' ? 'ok' : 'warn',
      icon: result.tone === 'ok' ? <SuccessCheck /> : undefined,
      message: text,
      undo: done.length ? { seconds: 8, onUndo: () => undo(done, `se devolvieron ${done.length} equipos`) } : undefined
    });
  };

  const undo = async (etiquetas: string[], text: string) => {
    try {
      const response = await onUndo(etiquetas, 'return');
      const errors = response.results.filter(item => !item.ok).map(item => item.error || item.etiqueta);
      status.show(errors.length ? { tone: 'bad', message: `No se pudo deshacer: ${errors.join('; ')}` } : { tone: 'info', message: `Se deshizo: ${text}` });
    } catch (error) {
      status.show({ tone: 'bad', message: error instanceof Error ? error.message : 'No se pudo deshacer.' });
    }
  };

  const returnSelected = async () => {
    const list = toReturn;
    exitSelection();
    await returnDevices(list);
  };

  const lendSelected = () => {
    if (!toLend.length) return;
    onBatchLend(toLend.map(device => device.etiqueta));
    exitSelection();
  };

  const onChipClick = (event: MouseEvent, device: Device, group: Group) => {
    if (selectMode || isMarkClick(event)) {
      event.preventDefault();
      // Al entrar en selección aparecen "Todos / Ninguno": el chip tocado no se corre.
      if (!selectMode) { keepInPlace(event.currentTarget as HTMLElement, { duration: 120 }); setSelectMode(true); }
      // Mejora: Shift + clic sobre otro del mismo tipo marca desde el último marcado hasta acá.
      const from = anchor.current;
      if (event.shiftKey && from && from.group === group.nombre && from.key !== device.etiqueta) {
        const a = group.selectable.indexOf(from.key);
        const b = group.selectable.indexOf(device.etiqueta);
        if (a >= 0 && b >= 0) {
          setMany(group.selectable.slice(Math.min(a, b), Math.max(a, b) + 1), true);
          anchor.current = { key: device.etiqueta, group: group.nombre };
          return;
        }
      }
      toggle(device.etiqueta, group.nombre);
      return;
    }
    if (getDeviceStateKey(device) === 'loaned') void returnDevices([device]);
    else onSeedCode(device.etiqueta);
  };

  if (!groups.length) return null;

  return (
    <section className="lo-card lo-chips" aria-labelledby="lo-chips-title" data-loans-grid="devices" data-select-mode={selectMode ? 'on' : 'off'}>
      <SelectionSwap active={selectMode} bar={(
        <SelectionBar
          label="Selección de equipos"
          count={selectedDevices.length}
          hint="Seguí marcando o elegí qué hacer."
          idleHint="Tocá los equipos que quieras marcar."
          onClear={() => { setSelected(new Set()); setConfirming(false); anchor.current = null; }}
          onDone={exitSelection}
          confirm={confirming && toReturn.length > 1 ? {
            message: `¿Devolver ${toReturn.length} equipos?`,
            detail: toReturn.map(device => `${getOperationalAlias(device) || ''} ${device.etiqueta}`.trim()).join(' · '),
            confirmLabel: `Devolver ${toReturn.length}`,
            onConfirm: () => void returnSelected(),
            onCancel: () => setConfirming(false)
          } : null}
          actions={(
            <>
              {toLend.length > 0 && <Button size="sm" variant="primary" disabled={busy || consultationMode} onClick={lendSelected}>Prestar {toLend.length}</Button>}
              {toReturn.length > 0 && <Button size="sm" variant="secondary" disabled={busy || consultationMode} onClick={() => { if (toReturn.length > 1) setConfirming(true); else void returnSelected(); }}>Devolver {toReturn.length}</Button>}
            </>
          )}
        />
      )}>
        <div className="lo-card-head lo-chips-head">
          <div className="lo-head-text">
            <h2 id="lo-chips-title" className="lo-h2">Equipos por tipo</h2>
            <p className="lo-help">
              <span className="lo-long">Clic: libre lo carga arriba, prestado lo devuelve. Ctrl/⌘/Shift + clic marca varios.</span>
              <span className="lo-short">Tocá uno libre para cargarlo arriba; uno prestado, para devolverlo. "Varios" marca varios.</span>
            </p>
          </div>
          <SelectModeButton disabled={consultationMode} onClick={() => setSelectMode(true)} />
        </div>
      </SelectionSwap>

      {status.element && <div className="lo-card-status">{status.element}</div>}

      <ChipLegend items={[['free', 'Libre'], ['loaned', 'Prestado'], ['late1', '1 día afuera'], ['late2', '2 días o más'], ['blocked', 'Fuera de servicio o no encontrado'], ['selected', 'Marcado']]} />

      <div className="lo-groups">
        {groups.map(group => (
          <ChipGroup
            key={group.nombre}
            group={group}
            selectMode={selectMode}
            selected={selected}
            busyTags={busyTags}
            consultationMode={consultationMode}
            onChipClick={onChipClick}
            onAll={() => setMany(group.selectable, true)}
            onNone={() => setMany(group.selectable, false)}
          />
        ))}
      </div>
    </section>
  );
}

function ChipGroup({ group, selectMode, selected, busyTags, consultationMode, onChipClick, onAll, onNone }: {
  group: Group;
  selectMode: boolean;
  selected: Set<string>;
  busyTags: Set<string>;
  consultationMode: boolean;
  onChipClick: (event: MouseEvent, device: Device, group: Group) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const [open, setOpen] = usePanelOpen(`devices:${group.nombre}`);
  const late = group.prestados.filter(device => loanAgeDays(device.loanedAt) >= 1).length;
  const bodyId = `lo-group-${group.nombre.replace(/\W+/g, '-')}`;
  return (
    <div className={cx('lo-group', open && 'is-open')} data-group={group.nombre}>
      <div className="lo-group-head">
        <GroupToggle
          open={open}
          onToggle={() => setOpen(!open)}
          title={group.nombre}
          free={group.libres}
          total={group.items.length}
          out={group.prestados.length ? `${group.prestados.length} ${group.prestados.length === 1 ? 'prestado' : 'prestados'}` : 'nada afuera'}
          warn={late ? `${late} hace más de 1 día` : ''}
          controls={bodyId}
        />
        {selectMode && open && !consultationMode && group.selectable.length > 0 && (
          <span className="lo-group-all">
            <Button size="sm" variant="ghost" onClick={onAll}>Todos</Button>
            <Button size="sm" variant="ghost" onClick={onNone}>Ninguno</Button>
          </span>
        )}
      </div>
      <LazyBody open={open} className="lo-group-body">
        <div className="lo-chip-grid" role="group" aria-label={`Equipos ${group.nombre}`} id={bodyId}>
          {group.items.map(device => {
            const kind = deviceChipKind(device);
            const numero = getDeviceNumber(device);
            const alias = getOperationalAlias(device) || device.etiqueta;
            const blocked = kind === 'blocked';
            const marked = selected.has(device.etiqueta);
            const base = `${alias} · ${device.etiqueta}`;
            const label = blocked
              ? `${base} — ${device.estado || 'no disponible'}, no se puede operar`
              : selectMode
                ? `${base} — clic para ${marked ? 'desmarcar' : 'marcar'}`
                : kind === 'free'
                  ? `${base} — libre, clic para prestar`
                  : `${base} — ${[device.prestadoA || 'sin persona', device.curso, device.ubicacion].filter(Boolean).join(' · ')}, clic para devolver`;
            return (
              <button
                key={device.id || device.etiqueta}
                type="button"
                className={cx('lo-chip', `is-${kind}`, !numero && 'is-wide', marked && 'is-selected', busyTags.has(device.etiqueta) && 'is-busy')}
                data-device-tag={device.etiqueta}
                disabled={consultationMode || blocked || busyTags.has(device.etiqueta)}
                aria-pressed={selectMode && !blocked ? marked : undefined}
                aria-label={label}
                onMouseDown={event => { if (event.shiftKey) event.preventDefault(); }}
                onClick={event => onChipClick(event, device, group)}
              >
                {numero || device.etiqueta}
              </button>
            );
          })}
        </div>
        {group.prestados.length > 0 && (
          <div className="lo-out-list">
            {group.prestados.map(device => {
              const days = loanAgeDays(device.loanedAt);
              return (
                <div className="lo-out-row" key={device.id || device.etiqueta}>
                  <span className={cx('lo-out-num g-num', days >= 2 ? 'is-late2' : days === 1 ? 'is-late1' : 'is-loaned')}>{getDeviceNumber(device) || device.etiqueta}</span>
                  <TruncatedText className="lo-out-who">{[device.prestadoA || 'Sin persona', device.curso, device.ubicacion].filter(Boolean).join(' · ')}</TruncatedText>
                  <span className="lo-out-time g-num">{days ? formatLoanDateTime(device.loanedAt) : formatTimeOnly(device.loanedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </LazyBody>
    </div>
  );
}

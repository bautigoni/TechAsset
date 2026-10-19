import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Device, InventoryItem } from '../../types';
import { Button, Eyebrow, InlineConfirm, Input, Kbd, useStatusLine } from '../../ui';
import { isEditableTarget } from '../../hooks/useGlobalScanner';
import { formatDay, isReviewFresh, reviewLabel, stockInfo, type Entry } from './inventoryEntries';
import { ConditionChips, errorText, Tx } from './inventoryParts';
import { InventoryUnits } from './InventoryUnits';
import { ResourceForm } from './ResourceForm';

/**
 * Ficha de un ítem, EN LÍNEA debajo de su fila o tarjeta (empuja el resto).
 * Condición con chips (se guarda al tocar), Ver ficha (equipos), Editar y
 * Ocultar con confirmación en el lugar (recursos), identificación del equipo
 * con TeamViewer editable, y las unidades del recurso. Escape la cierra.
 */
export function InventoryDetail({ entry, items, consultationMode, editing, onStartEdit, onCancelEdit, onSaved, onCondition, onHide, onProfile, onItemChange, onTeamviewer, onClose, initialMessage }: {
  entry: Entry;
  items: InventoryItem[];
  consultationMode: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (item: InventoryItem) => void;
  onCondition: (condicion: string) => Promise<void>;
  onHide: (item: InventoryItem) => Promise<void>;
  onProfile?: (device: Device) => void;
  onItemChange: (item: InventoryItem) => void;
  onTeamviewer: (device: Device, value: string) => Promise<void>;
  onClose: () => void;
  /** Aviso con el que abre (p. ej. "Se agregó X." o "Se volvió a mostrar."). */
  initialMessage?: string;
}) {
  const status = useStatusLine();
  const [hideAsk, setHideAsk] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [savingCond, setSavingCond] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const isRes = entry.kind === 'recurso';
  const stock = stockInfo(entry);
  const fresh = isReviewFresh(entry);

  useEffect(() => {
    if (initialMessage) status.show({ tone: 'ok', message: initialMessage });
    // Al abrir, que la ficha quede a la vista sin saltar (solo si no se ve).
    const node = ref.current;
    if (node && typeof node.scrollIntoView === 'function') {
      const rect = node.getBoundingClientRect();
      if (rect.top > window.innerHeight - 80) node.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.key]);

  useEffect(() => { setHideAsk(false); }, [entry.key, editing]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || isEditableTarget(event.target)) return;
    event.preventDefault();
    onClose();
  };

  const setCondition = async (condicion: string) => {
    if (consultationMode || savingCond) return;
    setSavingCond(true);
    status.clear();
    try {
      await onCondition(condicion);
      status.show({ tone: 'ok', message: `${entry.nombre}: ${condicion || 'sin revisar'}.` });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo guardar la condición.') });
    } finally {
      setSavingCond(false);
    }
  };

  const hide = async () => {
    if (!entry.item) return;
    setHiding(true);
    try {
      await onHide(entry.item);
    } catch (reason) {
      setHiding(false);
      setHideAsk(false);
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo ocultar el recurso.') });
    }
  };

  if (editing && entry.item) {
    return (
      <div className="ivt-detail" ref={ref} role="region" aria-label={`Editar ${entry.nombre}`}>
        <ResourceForm
          item={entry.item}
          items={items}
          consultationMode={consultationMode}
          onSaved={item => { onSaved(item); status.show({ tone: 'ok', message: 'Cambios guardados.' }); }}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  const facts: Array<{ k: string; v: string; tone?: 'normal' | 'warn' | 'bad' | 'strong' | 'muted'; mono?: boolean }> = isRes
    ? [
      { k: 'Stock', v: `${stock.value} ${entry.unidad}`, tone: stock.tone === 'normal' ? 'strong' : stock.tone, mono: true },
      { k: 'Bajo stock', v: (entry.cantidad ?? 0) <= 0 ? 'Sí, sin stock' : entry.bajoStock ? 'Sí' : 'No', tone: (entry.cantidad ?? 0) <= 0 ? 'bad' : entry.bajoStock ? 'warn' : 'strong' },
      { k: 'Seguimiento', v: 'Por stock', tone: 'strong' },
      { k: 'Revisión', v: reviewLabel(entry), tone: fresh ? 'strong' : entry.condicion ? 'warn' : 'normal' }
    ]
    : [
      { k: 'Vida útil', v: entry.vidaPct === null ? '—' : entry.vencido ? 'Vencida' : `${entry.vidaPct} % consumida`, tone: entry.vencido ? 'bad' : 'strong' },
      { k: 'Renovación', v: entry.renovacion ? formatDay(entry.renovacion) : '—', tone: 'strong', mono: true },
      { k: 'Seguimiento', v: 'Individual', tone: 'strong' },
      { k: 'Revisión', v: reviewLabel(entry), tone: fresh ? 'strong' : entry.condicion ? 'warn' : 'normal' }
    ];

  return (
    <div className="ivt-detail" ref={ref} role="region" aria-label={`Detalle de ${entry.nombre}`} onKeyDown={onKeyDown}>
      <div className="ivt-detail-top">
        <div className="ivt-detail-media">
          <div className={`ivt-photo${entry.imagenUrl ? ' has-photo' : ''}${isRes && !entry.imagenUrl ? ' is-missing' : ''}`}>
            {entry.imagenUrl
              ? <img src={entry.imagenUrl} alt="" />
              : <span className={isRes ? '' : 'ivt-mono ivt-photo-alias'}>{isRes ? 'Sin foto' : entry.nombre}</span>}
          </div>
          {isRes && (
            <Button size="sm" disabled={consultationMode} onClick={onStartEdit}>{entry.imagenUrl ? 'Cambiar foto' : 'Subir foto'}</Button>
          )}
        </div>

        <div className="ivt-detail-info">
          <Eyebrow>{`${entry.categoria} · ${entry.subcategoria || 'sin subcategoría'}`}</Eyebrow>
          <h3 className="ivt-detail-name">{entry.nombre}</h3>
          <Tx tone="muted" mono={!isRes} className="ivt-detail-sub">{isRes ? (entry.detalle || 'Sin observaciones') : entry.detalle}</Tx>
          <dl className="ivt-facts">
            {facts.map(fact => (
              <div key={fact.k}>
                <dt>{fact.k}</dt>
                <dd><Tx tone={fact.tone} mono={fact.mono}>{fact.v}</Tx></dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="ivt-detail-side">
          <span className="ivt-label">Condición</span>
          <ConditionChips value={entry.condicion} onChange={condicion => void setCondition(condicion)} disabled={consultationMode || savingCond} />
          <span className="ivt-help">
            {consultationMode
              ? 'Modo consulta: la condición no se puede cambiar.'
              : isRes
                ? 'Se guarda al tocarla. En recursos cuenta como revisión aunque elijas la misma.'
                : 'Se guarda al tocarla y actualiza la fecha de revisión del equipo.'}
          </span>
          {status.element}
          <div className="ivt-actions">
            {entry.device && onProfile && <Button onClick={() => onProfile(entry.device as Device)}>Ver ficha</Button>}
            {isRes && (
              <>
                <Button disabled={consultationMode} onClick={onStartEdit}>Editar</Button>
                <Button className="ivt-danger-text" disabled={consultationMode} aria-expanded={hideAsk} onClick={() => setHideAsk(value => !value)}>Ocultar</Button>
              </>
            )}
            <Button variant="ghost" onClick={onClose} iconEnd={<Kbd>Esc</Kbd>}>Cerrar</Button>
          </div>
          {hideAsk && entry.item && (
            <InlineConfirm
              danger
              message={`¿Ocultar ${entry.nombre} del inventario?`}
              detail="Deja de aparecer en listas y conteos. Se puede volver a mostrar desde Ocultos."
              confirmLabel="Ocultar"
              busy={hiding}
              onConfirm={() => void hide()}
              onCancel={() => setHideAsk(false)}
            />
          )}
        </div>
      </div>

      {entry.device && <DeviceIdentity device={entry.device} entry={entry} consultationMode={consultationMode} onSave={onTeamviewer} />}
      {entry.item && <InventoryUnits item={entry.item} consultationMode={consultationMode} onItemChange={onItemChange} />}
    </div>
  );
}

// Identificación física del equipo: sin esto no hay forma de saber cuál de
// los 50 Chromebook tenés en la mano. "—" es normal (parte del parque no tiene
// MAC y Chrome OS no usa TeamViewer).
function DeviceIdentity({ device, entry, consultationMode, onSave }: {
  device: Device;
  entry: Entry;
  consultationMode: boolean;
  onSave: (device: Device, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(entry.teamviewerId);
  const [busy, setBusy] = useState(false);
  const status = useStatusLine();

  useEffect(() => { setValue(entry.teamviewerId); }, [device.etiqueta, entry.teamviewerId]);

  const changed = value.trim() !== entry.teamviewerId.trim();
  const save = async () => {
    if (consultationMode || !changed || busy) return;
    setBusy(true);
    try {
      await onSave(device, value.trim());
      status.show({ tone: 'ok', message: 'TeamViewer ID guardado.' });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo guardar el TeamViewer ID.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ivt-sec" aria-label="Identificación">
      <Eyebrow>Identificación</Eyebrow>
      <div className="ivt-idgrid">
        <div><span className="ivt-help">Etiqueta</span><Tx tone="strong" mono>{device.etiqueta}</Tx></div>
        <div><span className="ivt-help">Número de serie</span><Tx tone={device.sn ? 'strong' : 'muted'} mono>{device.sn || '—'}</Tx></div>
        <div><span className="ivt-help">MAC</span><Tx tone={device.mac ? 'strong' : 'muted'} mono>{device.mac || '—'}</Tx></div>
        <form className="ivt-tv" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void save(); }}>
          <Input
            size="sm"
            label="TeamViewer ID"
            autoComplete="off"
            className="ivt-mono-field"
            value={value}
            placeholder="No aplica en Chrome OS"
            disabled={consultationMode || busy}
            onValueChange={setValue}
            suffix={undefined}
          />
          <Button type="submit" size="sm" loading={busy} disabled={consultationMode || !changed}>Guardar</Button>
        </form>
      </div>
      {status.element}
    </section>
  );
}

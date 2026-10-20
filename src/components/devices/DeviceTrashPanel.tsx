import { useEffect, useState } from 'react';
import { Button, Collapse, EmptyState, ErrorState, Input, SkeletonRows, TruncatedText, icons, useStatusLine } from '../../ui';
import { getDeletedDevices, restoreDevice, type DeletedDevice } from '../../services/devicesApi';
import { fold } from '../../ui/util';
import { errorMessage } from '../layout/Feedback';
import { DevicePanel } from './DevicePanels';
import { shortWhen } from './deviceView';
import { useRevealedRows } from './revealRows';

const PAGE = 12;

/**
 * Papelera en línea: equipos borrados (ocultos, con su historial), quién y
 * cuándo, y Restaurar. El buscador aparece con más de 6. Restaurar un equipo
 * lo saca de la lista sin recargarla.
 */
export function DeviceTrashPanel({ consultationMode, onRestored, onCount, onClose }: {
  consultationMode: boolean;
  onRestored: (etiqueta: string) => Promise<unknown> | void;
  onCount?: (count: number) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DeletedDevice[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const status = useStatusLine();
  const revealed = useRevealedRows();

  const load = () => {
    setError('');
    return getDeletedDevices()
      .then(response => { setItems(response.items); onCount?.(response.items.length); })
      .catch(reason => { setItems(current => current || []); setError(errorMessage(reason, 'No se pudo cargar la papelera.')); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const restore = async (item: DeletedDevice) => {
    setBusy(item.etiqueta);
    try {
      await restoreDevice(item.etiqueta);
      setItems(current => {
        const next = (current || []).filter(entry => entry.etiqueta !== item.etiqueta);
        onCount?.(next.length);
        return next;
      });
      status.show({ tone: 'ok', message: `${item.etiqueta} restaurado.` });
      await onRestored(item.etiqueta);
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo restaurar.') });
    } finally {
      setBusy('');
    }
  };

  const needle = fold(query);
  const visible = (items || []).filter(item => !needle || fold([item.etiqueta, item.alias, item.categoria, item.modelo, item.deletedBy].join(' ')).includes(needle));

  return (
    <DevicePanel title="Papelera" label="Papelera de dispositivos" note="Ocultos de la app, con su historial intacto. Restaurar los deja como estaban." onClose={onClose}>
      {/* Lo que llega al cargar (buscador, lista, vacío o error) entra suave: el panel no salta de alto. */}
      <Collapse open={Boolean(items && items.length > 6)} reveal={false}>
        <Input
          aria-label="Buscar en la papelera"
          prefix={<icons.IconSearch size={14} />}
          value={query}
          onValueChange={value => { setQuery(value); setLimit(PAGE); }}
          placeholder="Etiqueta, alias, modelo o quién lo borró"
          autoComplete="off"
          className="dv-panel-search"
        />
      </Collapse>
      <Collapse open={Boolean(error)} reveal={false}>
        <ErrorState message={error} onRetry={() => void load()} />
      </Collapse>
      <Collapse open={!items} lazy={false} reveal={false}>
        <SkeletonRows rows={2} />
      </Collapse>
      <Collapse open={Boolean(items && !items.length && !error)} reveal={false}>
        <EmptyState compact title="La papelera está vacía." />
      </Collapse>
      <Collapse open={Boolean(items && items.length > 0 && !visible.length)} reveal={false}>
        <EmptyState compact title="Nada en la papelera coincide con esa búsqueda." />
      </Collapse>
      <Collapse open={visible.length > 0} reveal={false}>
        <ul className="dv-trash-list">
          {visible.slice(0, limit).map(item => (
            <li key={item.etiqueta} className={`dv-trash-item${revealed.isNew(item.etiqueta) ? ' dv-row-in' : ''}`}>
              <span className="dv-trash-main">
                <span className="dv-trash-name"><span className="ui-mono">{item.etiqueta}</span>{item.alias ? <TruncatedText>{` · ${item.alias}`}</TruncatedText> : null}</span>
                <TruncatedText lines={2} className="dv-muted">{[item.categoria, item.modelo].filter(Boolean).join(' · ') || 'Sin datos del equipo'}</TruncatedText>
              </span>
              <span className="dv-muted dv-trash-when">Borrado <span className="ui-mono">{shortWhen(item.deletedAt) || 'sin fecha'}</span>{item.deletedBy ? ` por ${item.deletedBy}` : ''}</span>
              <Button size="sm" disabled={consultationMode} loading={busy === item.etiqueta} loadingLabel="Restaurando…" onClick={() => void restore(item)}>Restaurar</Button>
            </li>
          ))}
        </ul>
      </Collapse>
      {visible.length > limit && (
        <div className="dv-more">
          <span className="dv-muted">Mostrando <span className="ui-mono">{limit}</span> de <span className="ui-mono">{visible.length}</span></span>
          <Button size="sm" onClick={() => { revealed.reveal(visible.slice(limit, limit + PAGE).map(item => item.etiqueta), () => setLimit(value => value + PAGE)); }}>Ver más</Button>
        </div>
      )}
      {status.element}
    </DevicePanel>
  );
}

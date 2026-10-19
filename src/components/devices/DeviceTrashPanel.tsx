import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Input, SkeletonRows, icons, useStatusLine } from '../../ui';
import { getDeletedDevices, restoreDevice, type DeletedDevice } from '../../services/devicesApi';
import { fold } from '../../ui/util';
import { errorMessage } from '../layout/Feedback';
import { DevicePanel } from './DevicePanels';
import { shortWhen } from './deviceView';

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
      {items && items.length > 6 && (
        <Input
          aria-label="Buscar en la papelera"
          prefix={<icons.IconSearch size={14} />}
          value={query}
          onValueChange={value => { setQuery(value); setLimit(PAGE); }}
          placeholder="Etiqueta, alias, modelo o quién lo borró"
          autoComplete="off"
          className="dv-panel-search"
        />
      )}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {!items && <SkeletonRows rows={2} />}
      {items && !items.length && !error && <EmptyState compact title="La papelera está vacía." />}
      {items && items.length > 0 && !visible.length && <EmptyState compact title="Nada en la papelera coincide con esa búsqueda." />}
      {visible.length > 0 && (
        <ul className="dv-trash-list">
          {visible.slice(0, limit).map(item => (
            <li key={item.etiqueta} className="dv-trash-item">
              <span className="dv-trash-main">
                <span className="dv-ell"><span className="ui-mono">{item.etiqueta}</span>{item.alias ? ` · ${item.alias}` : ''}</span>
                <span className="dv-muted dv-ell">{[item.categoria, item.modelo].filter(Boolean).join(' · ') || 'Sin datos del equipo'}</span>
              </span>
              <span className="dv-muted dv-trash-when">Borrado <span className="ui-mono">{shortWhen(item.deletedAt) || 'sin fecha'}</span>{item.deletedBy ? ` por ${item.deletedBy}` : ''}</span>
              <Button size="sm" disabled={consultationMode} loading={busy === item.etiqueta} loadingLabel="Restaurando…" onClick={() => void restore(item)}>Restaurar</Button>
            </li>
          ))}
        </ul>
      )}
      {visible.length > limit && (
        <div className="dv-more">
          <span className="dv-muted">Mostrando <span className="ui-mono">{limit}</span> de <span className="ui-mono">{visible.length}</span></span>
          <Button size="sm" onClick={() => setLimit(value => value + PAGE)}>Ver más</Button>
        </div>
      )}
      {status.element}
    </DevicePanel>
  );
}

import { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../../types';
import { getHiddenInventoryItems, importInventoryCsv, restoreInventoryItem } from '../../services/inventoryApi';
import { Button, Collapse, EmptyState, ErrorState, FileDrop, Input, SkeletonRows, useStatusLine } from '../../ui';
import { TruncatedText } from '../../ui/Truncated';
import { IconSearch } from '../../ui/icons';
import { formatDate, DATE_ONLY } from '../../utils/formatters';
import { errorText, readFileAsText, Tx } from './inventoryParts';
import { normalizeQuery } from './inventoryEntries';

/** Importar / exportar, desplegado en línea debajo del encabezado. */
export function ImportExportPanel({ count, consultationMode, onExport, onTemplate, onImported }: {
  count: number;
  consultationMode: boolean;
  onExport: () => void;
  onTemplate: () => void;
  onImported: () => Promise<unknown> | void;
}) {
  const [importing, setImporting] = useState(false);
  const status = useStatusLine();

  const runImport = async (file: File) => {
    status.clear();
    try {
      const result = await importInventoryCsv(await readFileAsText(file));
      const preserved = [
        result.preservedImages ? `${result.preservedImages} fotos` : '',
        result.preservedConditions ? `${result.preservedConditions} condiciones` : ''
      ].filter(Boolean).join(' y ');
      status.show({
        tone: result.errors.length ? 'warn' : 'ok',
        autoHideMs: 0,
        message: `Importado ${file.name}: ${result.read} leídos · ${result.created} nuevos · ${result.updated} actualizados${preserved ? ` · ${preserved} conservadas` : ''} · ${result.skipped} omitidos · ${result.errors.length} errores.`
      });
      await onImported();
      return result;
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo importar el inventario.') });
      throw reason;
    }
  };

  return (
    <section className="ivt-panel" id="ivt-ie" aria-label="Importar y exportar">
      <div className="ivt-ie-row">
        <Button size="sm" onClick={onExport}>Exportar CSV <span className="ivt-count">{count}</span></Button>
        <Button size="sm" onClick={onTemplate}>Descargar plantilla</Button>
        <Button size="sm" disabled={consultationMode} aria-expanded={importing} onClick={() => setImporting(value => !value)}>Importar CSV…</Button>
        <span className="ivt-help ivt-ie-note">
          Exporta lo filtrado. Importar coincide por nombre: si una fila no trae foto o condición se conservan las cargadas, y una condición en el CSV cuenta como revisión de hoy.
        </span>
      </div>
      <Collapse open={importing && !consultationMode}>
        <FileDrop
          accept=".csv,text/csv"
          label="Elegir el CSV del inventario"
          title="Arrastrá el CSV acá o tocá para elegir"
          hint="Un CSV con las columnas de la plantilla · también podés pegar con Ctrl V"
          upload={file => runImport(file)}
        />
      </Collapse>
      {status.element}
    </section>
  );
}

type HiddenItem = InventoryItem & { deletedAt?: string; deletedBy?: string };

/** Recursos ocultos (la papelera del inventario), con Restaurar. */
export function HiddenPanel({ consultationMode, onRestored }: {
  consultationMode: boolean;
  onRestored: (item: InventoryItem) => void;
}) {
  const [list, setList] = useState<HiddenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const status = useStatusLine();

  const load = () => {
    setLoading(true);
    setError('');
    getHiddenInventoryItems()
      .then(response => setList(response.items as HiddenItem[]))
      .catch(reason => setError(errorText(reason, 'No se pudieron cargar los recursos ocultos.')))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const visible = useMemo(() => {
    const needle = normalizeQuery(query);
    if (!needle) return list;
    return list.filter(item => [item.nombre, item.categoria, item.subcategoria, item.deletedBy].some(value => normalizeQuery(value).includes(needle)));
  }, [list, query]);

  const restore = async (item: HiddenItem) => {
    setBusyId(item.id);
    try {
      const response = await restoreInventoryItem(item.id);
      setList(current => current.filter(entry => entry.id !== item.id));
      if (response.item) onRestored(response.item);
      status.show({ tone: 'ok', message: `${item.nombre} se volvió a mostrar.` });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo restaurar el recurso.') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="ivt-panel" id="ivt-hidden" aria-label="Recursos ocultos">
      <div className="ivt-panel-head">
        <h3>Recursos ocultos</h3>
        <span className="ivt-help">Ocultar no borra nada: el recurso vuelve tal cual estaba. Reimportar el CSV con el mismo nombre también lo vuelve a mostrar.</span>
      </div>
      {list.length > 6 && (
        <Input size="sm" label="Buscar en ocultos" autoComplete="off" value={query} onValueChange={setQuery} prefix={<IconSearch size={14} />} placeholder="Nombre, categoría o quién lo ocultó" className="ivt-hidden-search" />
      )}
      {loading && <SkeletonRows rows={2} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && !list.length && <EmptyState compact title="No hay recursos ocultos." />}
      {!loading && visible.length > 0 && (
        <ul className="ivt-hidden-list">
          {visible.map(item => (
            <li key={item.id} className="ivt-hidden-row">
              <span className="ivt-hidden-text">
                <TruncatedText className="ivt-strong">{item.nombre}</TruncatedText>
                <Tx tone="muted" className="ivt-ell">
                  {[item.categoria, item.subcategoria].filter(Boolean).join(' › ')}
                  {item.deletedAt ? ` · Oculto ${formatDate(item.deletedAt, DATE_ONLY)}${item.deletedBy ? ` por ${item.deletedBy}` : ''}` : ''}
                </Tx>
              </span>
              <Button size="sm" disabled={consultationMode} loading={busyId === item.id} loadingLabel="Restaurando…" onClick={() => void restore(item)}>Restaurar</Button>
            </li>
          ))}
        </ul>
      )}
      {!loading && list.length > 0 && !visible.length && <EmptyState compact title="Nada coincide con esa búsqueda." />}
      {status.element}
    </section>
  );
}

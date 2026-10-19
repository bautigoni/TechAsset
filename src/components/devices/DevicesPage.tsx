import { useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType, matchesOperationalAlias, sortByOperationalAlias } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { SelectField } from '../layout/SelectField';

const ORDENES = [
  { value: 'default', label: 'Orden original' },
  { value: 'operational', label: 'Ordenar por número operativo' }
];
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from './DeviceTable';
import { DeviceGroupsManager } from './DeviceGroupsManager';
import { DeviceTrashModal } from './DeviceTrashModal';
import { restoreDevice } from '../../services/devicesApi';
import { errorMessage, toast } from '../layout/Feedback';
import { AddDeviceModal } from './AddDeviceModal';
import { downloadDevicesCsv, importDevicesFromCsv } from '../../services/devicesApi';
import { promptDialog } from '../layout/Feedback';
import { getDeviceStateKey } from '../../utils/deviceState';
import { useSelection } from '../layout/Selection';
import { DeviceBulkBar } from './DeviceBulkBar';
import type { LoanBatchResponse } from '../../services/loansApi';

type DeviceFilter = string;
type DeviceSort = 'default' | 'operational';

const FILTER_LABELS: Record<string, string> = {
  all: 'Todos los dispositivos',
  available: 'Disponibles',
  loaned: 'Prestados',
  missing: 'No encontradas',
  out: 'Fuera de servicio'
};

function matchesFilter(device: Device, filter: DeviceFilter) {
  if (filter === 'all') return true;
  if (filter === 'available' || filter === 'loaned' || filter === 'missing' || filter === 'out') return getDeviceStateKey(device) === filter;
  return classifyDeviceType(device) === filter;
}

export function DevicesPage({ devices, consultationMode, operator, onAdd, onLoan, onReturn, onProfile, onDelete, onImported, onLoanBatch, onReturnBatch }: {
  devices: Device[];
  consultationMode: boolean;
  operator: string;
  onAdd: (device: Partial<Device>) => Promise<void>;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => Promise<unknown> | void;
  onProfile: (device: Device) => void;
  onDelete?: (device: Device) => Promise<void> | void;
  onImported?: () => Promise<void> | void;
  onLoanBatch?: (etiquetas: string[]) => void;
  onReturnBatch?: (etiquetas: string[]) => Promise<LoanBatchResponse>;
}) {
  // Selección para acciones en lote (barra flotante abajo).
  const selection = useSelection();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');
  const [sort, setSort] = useState<DeviceSort>('default');
  const [aliasQuery, setAliasQuery] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const visibleDevices = useMemo(() => {
    const base = devices
      .filter(device => matchesFilter(device, deviceFilter))
      .filter(device => matchesOperationalAlias(device, aliasQuery));
    if (sort !== 'operational' && !aliasQuery.trim()) return base;
    return sortByOperationalAlias(base);
  }, [aliasQuery, devices, deviceFilter, sort]);
  // Las acciones en lote actúan SOLO sobre lo que se ve: antes se calculaba sobre
  // todos los equipos y, si marcabas, cambiabas el filtro y apretabas "Borrar",
  // también se borraban los marcados que ya no se veían.
  const selectedDevices = useMemo(() => visibleDevices.filter(device => selection.selected.has(device.etiqueta)), [visibleDevices, selection.selected]);
  const count = (filter: DeviceFilter) => devices.filter(device => matchesFilter(device, filter)).length;
  const categories = useMemo(() => Array.from(new Set(devices.map(classifyDeviceType).filter(Boolean))).sort(), [devices]);
  const handleDelete = async (device: Device) => {
    if (consultationMode) {
      setMessage({ tone: 'error', text: 'Modo consulta activo.' });
      return;
    }
    if (!onDelete) return;
    setMessage(null);
    try {
      await onDelete(device);
      // Borrar es ocultar: se puede deshacer al toque o restaurar después desde la papelera.
      toast({
        message: `${device.etiqueta} se movió a la papelera.`,
        action: {
          label: 'Deshacer',
          onClick: async () => {
            try {
              await restoreDevice(device.etiqueta);
              await onImported?.();
              toast({ message: `${device.etiqueta} restaurado.`, tone: 'ok' });
            } catch (reason) {
              toast({ message: errorMessage(reason, 'No se pudo restaurar.'), tone: 'error' });
            }
          }
        }
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo borrar el dispositivo.' });
    }
  };

  const importCsv = async () => {
    if (consultationMode) {
      setMessage({ tone: 'error', text: 'Modo consulta activo.' });
      return;
    }
    const csvUrl = await promptDialog({ title: 'Importar dispositivos', message: 'Pegá la URL CSV publicada de esta sede. Si la dejás vacía se usa la URL configurada en la sede.', label: 'URL del CSV', inputType: 'url', placeholder: 'https://docs.google.com/...', confirmLabel: 'Importar', required: false });
    if (csvUrl === null) return;
    setMessage({ tone: 'info', text: 'Importando dispositivos a la base local...' });
    try {
      const result = await importDevicesFromCsv({ csvUrl: csvUrl.trim(), operator });
      const summary = result.summary;
      setMessage({
        tone: summary.errors ? 'error' : 'info',
        text: `Importación finalizada: ${summary.read} leídos, ${summary.created} nuevos, ${summary.updated} actualizados, ${summary.reactivated || 0} reactivados, ${summary.skipped} omitidos, ${summary.errors} errores.`
      });
      await onImported?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo importar el CSV.' });
    }
  };

  const exportCsv = async (path: string, filename: string) => {
    try {
      await downloadDevicesCsv(path, filename);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo exportar el CSV.' });
    }
  };

  // Los QR se generan en el navegador (antes se pedían a api.qrserver.com, y
  // con eso se mandaban etiqueta, SN y MAC de cada equipo a un tercero; además
  // sin internet no salía ningún QR). La librería se baja recién al exportar.
  const exportQrPdf = async () => {
    // La ventana se abre antes de cualquier await: si no, el bloqueador de
    // ventanas emergentes la frena por no venir "directo" del clic.
    const popup = window.open('', '_blank', 'width=980,height=720');
    if (!popup) {
      setMessage({ tone: 'error', text: 'El navegador bloqueó la ventana de exportación.' });
      return;
    }
    const qrcode = await import('qrcode-generator')
      .then(module => module.default)
      .catch((reason: unknown) => {
        popup.close();
        setMessage({ tone: 'error', text: errorMessage(reason, 'No se pudieron generar los códigos QR.') });
        return null;
      });
    if (!qrcode) return;
    const qrImage = (payload: string) => {
      // Bytes UTF-8 como "cadena binaria": el modo Byte de la librería toma cada
      // carácter como un byte, así los acentos no se rompen.
      const binary = Array.from(new TextEncoder().encode(payload), byte => String.fromCharCode(byte)).join('');
      const qr = qrcode(0, 'M');
      qr.addData(binary, 'Byte');
      qr.make();
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }))}`;
    };
    const rows = visibleDevices.map(device => {
      const payload = ['TA', device.etiqueta, device.sn || '', device.mac || ''].join('|');
      return `
        <article class="qr-card">
          <img src="${qrImage(payload)}" alt="QR ${escapeHtml(device.etiqueta)}" />
          <strong>${escapeHtml(device.etiqueta)}</strong>
          <span>${escapeHtml(device.aliasOperativo || device.categoria || '')}</span>
        </article>
      `;
    }).join('') || '<p>No hay dispositivos visibles para exportar.</p>';
    // Sin document.write: se arma el documento de la ventana nueva con el DOM.
    const doc = popup.document;
    doc.documentElement.lang = 'es';
    doc.title = 'QR TechAsset';
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    const style = doc.createElement('style');
    style.textContent = `
        body{font-family:Arial,sans-serif;margin:24px;color:#0f172a}
        h1{font-size:20px;margin:0 0 18px}
        .qr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
        .qr-card{border:1px solid #cbd5e1;border-radius:12px;padding:12px;display:grid;place-items:center;gap:6px;break-inside:avoid}
        .qr-card img{width:132px;height:132px}
        .qr-card strong{font-size:18px}
        .qr-card span{font-size:12px;color:#475569}
        @media print{body{margin:10mm}.qr-grid{grid-template-columns:repeat(3,1fr)}}
    `;
    doc.head.append(charset, style);
    doc.body.innerHTML = `<h1>TechAsset · códigos QR</h1><section class="qr-grid">${rows}</section>`;
    popup.focus();
    window.setTimeout(() => popup.print(), 600);
  };

  return (
    <section className="view active">
      <div className="stats-grid device-filter-grid">
        <StatCard label="Total" value={count('all')} active={deviceFilter === 'all'} onClick={() => setDeviceFilter('all')} />
        <StatCard label="Disponibles" value={count('available')} active={deviceFilter === 'available'} onClick={() => setDeviceFilter('available')} />
        <StatCard label="Prestados" value={count('loaned')} active={deviceFilter === 'loaned'} onClick={() => setDeviceFilter('loaned')} />
        {categories.map(category => (
          <StatCard key={category} label={category} value={count(category)} active={deviceFilter === category} onClick={() => setDeviceFilter(category)} />
        ))}
        <StatCard label="No encontradas" value={count('missing')} active={deviceFilter === 'missing'} onClick={() => setDeviceFilter('missing')} />
        <StatCard label="Fuera de servicio" value={count('out')} active={deviceFilter === 'out'} onClick={() => setDeviceFilter('out')} />
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>{FILTER_LABELS[deviceFilter] || deviceFilter}</h3>
            <span className="muted">{visibleDevices.length} equipos visibles</span>
          </div>
          <div className="actions">
            <input
              className="input compact-search"
              type="search"
              placeholder="Filtrar etiqueta o alias" aria-label="Filtrar dispositivos por etiqueta o alias"
              value={aliasQuery}
              onChange={event => setAliasQuery(event.target.value)}
              title="Buscar D1433, Touch 31, touch31, Plani 5..."
            />
            <SelectField
              className="compact-select"
              ariaLabel="Ordenar dispositivos"
              value={sort}
              options={ORDENES}
              onChange={value => setSort(value as DeviceSort)}
            />
            {!consultationMode && <Button onClick={importCsv}>Importar CSV</Button>}
            <Button onClick={() => exportCsv('/api/devices/export/inventory.csv', 'techasset_inventario.csv')}>Exportar inventario</Button>
            <Button onClick={() => exportCsv('/api/devices/export/summary.csv', 'techasset_resumen.csv')}>Exportar resumen</Button>
            <Button onClick={() => exportCsv('/api/movements/export.csv', 'techasset_movimientos.csv')}>Exportar movimientos</Button>
            <Button onClick={() => exportCsv('/api/loans/export/active.csv', 'techasset_prestamos_activos.csv')}>Exportar préstamos</Button>
            <Button onClick={() => void exportQrPdf()}>Exportar PDF QR</Button>
            <Button onClick={() => setGroupsOpen(true)}>Grupos</Button>
            <Button onClick={() => setTrashOpen(true)}>Papelera</Button>
            {!consultationMode && <Button variant="primary" onClick={() => setAdding(true)}>+ Añadir dispositivo</Button>}
          </div>
        </div>
        {message && <div className={message.tone === 'error' ? 'tool-error' : 'tool-info'}>{message.text}</div>}
        {visibleDevices.length ? (
          <DeviceTable devices={visibleDevices} onLoan={consultationMode ? undefined : onLoan} onReturn={consultationMode ? undefined : onReturn} onProfile={onProfile} onEdit={consultationMode ? undefined : setEditing} onDelete={consultationMode ? undefined : handleDelete} selection={consultationMode ? undefined : { selected: selection.selected, onToggle: selection.toggle, onToggleMany: selection.toggleMany }} />
        ) : (
          <div className="empty-state">No hay dispositivos para este filtro o búsqueda.</div>
        )}
      </section>
      {!consultationMode && (
        <DeviceBulkBar
          selectedDevices={selectedDevices}
          operator={operator}
          onClear={selection.clear}
          onLoanBatch={onLoanBatch}
          onReturnBatch={onReturnBatch}
          onChanged={() => onImported?.()}
        />
      )}
      {trashOpen && <DeviceTrashModal consultationMode={consultationMode} onRestored={() => onImported?.()} onClose={() => setTrashOpen(false)} />}
      {groupsOpen && <DeviceGroupsManager devices={devices} consultationMode={consultationMode} onOpenDevice={device => { setGroupsOpen(false); onProfile(device); }} onClose={() => setGroupsOpen(false)} />}
      {adding && <AddDeviceModal onClose={() => setAdding(false)} onSave={onAdd} />}
      {editing && <AddDeviceModal title={`Editar ${editing.etiqueta}`} initialDevice={editing} onClose={() => setEditing(null)} onSave={onAdd} />}

    </section>
  );
}

function escapeHtml(value: string) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] || char));
}

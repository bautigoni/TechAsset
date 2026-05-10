import { useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType, matchesOperationalAlias, sortByOperationalAlias } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from './DeviceTable';
import { DeviceProfile } from './DeviceProfile';
import { AddDeviceModal } from './AddDeviceModal';
import { downloadDevicesCsv, importDevicesFromCsv } from '../../services/devicesApi';

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
  if (filter === 'available') return device.estado !== 'Prestado' && device.estado !== 'No encontrada' && device.estado !== 'Fuera de servicio' && device.estado !== 'Perdida';
  if (filter === 'loaned') return device.estado === 'Prestado';
  if (filter === 'missing') return device.estado === 'No encontrada' || device.estado === 'Perdida';
  if (filter === 'out') return device.estado === 'Fuera de servicio';
  return classifyDeviceType(device) === filter;
}

export function DevicesPage({ devices, consultationMode, operator, onAdd, onLoan, onReturn, onDelete, onImported }: {
  devices: Device[];
  consultationMode: boolean;
  operator: string;
  onAdd: (device: Partial<Device>) => Promise<void>;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => void;
  onDelete?: (device: Device) => Promise<void> | void;
  onImported?: () => Promise<void> | void;
}) {
  const [profile, setProfile] = useState<Device | null>(null);
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
      setMessage({ tone: 'info', text: 'Dispositivo borrado' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo borrar el dispositivo.' });
    }
  };

  const importCsv = async () => {
    if (consultationMode) {
      setMessage({ tone: 'error', text: 'Modo consulta activo.' });
      return;
    }
    const csvUrl = window.prompt('Pegá la URL CSV publicada de esta sede. Si dejás vacío, se usa la URL configurada en la sede.');
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

  const exportQrPdf = () => {
    const rows = visibleDevices.map(device => {
      const payload = ['TA', device.etiqueta, device.sn || '', device.mac || ''].join('|');
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=132x132&data=${encodeURIComponent(payload)}`;
      return `
        <article class="qr-card">
          <img src="${qrUrl}" alt="QR ${escapeHtml(device.etiqueta)}" />
          <strong>${escapeHtml(device.etiqueta)}</strong>
          <span>${escapeHtml(device.aliasOperativo || device.categoria || '')}</span>
        </article>
      `;
    }).join('') || '<p>No hay dispositivos visibles para exportar.</p>';
    const popup = window.open('', '_blank', 'width=980,height=720');
    if (!popup) {
      setMessage({ tone: 'error', text: 'El navegador bloqueó la ventana de exportación.' });
      return;
    }
    popup.document.write(`<!doctype html>
      <html><head><meta charset="utf-8" /><title>QR TechAsset</title>
      <style>
        body{font-family:Arial,sans-serif;margin:24px;color:#0f172a}
        h1{font-size:20px;margin:0 0 18px}
        .qr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
        .qr-card{border:1px solid #cbd5e1;border-radius:12px;padding:12px;display:grid;place-items:center;gap:6px;break-inside:avoid}
        .qr-card img{width:132px;height:132px}
        .qr-card strong{font-size:18px}
        .qr-card span{font-size:12px;color:#475569}
        @media print{body{margin:10mm}.qr-grid{grid-template-columns:repeat(3,1fr)}}
      </style></head><body><h1>TechAsset · códigos QR</h1><section class="qr-grid">${rows}</section></body></html>`);
    popup.document.close();
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
              placeholder="Filtrar etiqueta o alias"
              value={aliasQuery}
              onChange={event => setAliasQuery(event.target.value)}
              title="Buscar D1433, Touch 31, touch31, Plani 5..."
            />
            <select className="input compact-select" value={sort} onChange={event => setSort(event.target.value as DeviceSort)} title="Ordenar dispositivos">
              <option value="default">Orden original</option>
              <option value="operational">Ordenar por número operativo</option>
            </select>
            {!consultationMode && <Button onClick={importCsv}>Importar CSV</Button>}
            <Button onClick={() => exportCsv('/api/devices/export/inventory.csv', 'techasset_inventario.csv')}>Exportar inventario</Button>
            <Button onClick={() => exportCsv('/api/devices/export/summary.csv', 'techasset_resumen.csv')}>Exportar resumen</Button>
            <Button onClick={() => exportCsv('/api/movements/export.csv', 'techasset_movimientos.csv')}>Exportar movimientos</Button>
            <Button onClick={() => exportCsv('/api/loans/export/active.csv', 'techasset_prestamos_activos.csv')}>Exportar préstamos</Button>
            <Button onClick={exportQrPdf}>Exportar PDF QR</Button>
            {!consultationMode && <Button variant="primary" onClick={() => setAdding(true)}>+ Añadir dispositivo</Button>}
          </div>
        </div>
        {message && <div className={message.tone === 'error' ? 'tool-error' : 'tool-info'}>{message.text}</div>}
        {visibleDevices.length ? (
          <DeviceTable devices={visibleDevices} onLoan={consultationMode ? undefined : onLoan} onReturn={consultationMode ? undefined : onReturn} onProfile={setProfile} onEdit={consultationMode ? undefined : setEditing} onDelete={consultationMode ? undefined : handleDelete} />
        ) : (
          <div className="empty-state">No hay dispositivos para este filtro o búsqueda.</div>
        )}
      </section>
      {profile && <DeviceProfile device={profile} onClose={() => setProfile(null)} />}
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


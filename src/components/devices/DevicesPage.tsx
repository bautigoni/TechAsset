import { useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType, getDeviceNumber, getOperationalAlias } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from './DeviceTable';
import { DeviceProfile } from './DeviceProfile';
import { AddDeviceModal } from './AddDeviceModal';

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

export function DevicesPage({ devices, consultationMode, onAdd, onLoan, onReturn, onDelete }: {
  devices: Device[];
  consultationMode: boolean;
  onAdd: (device: Partial<Device>) => Promise<void>;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => void;
  onDelete?: (device: Device) => Promise<void> | void;
}) {
  const [profile, setProfile] = useState<Device | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');
  const [sort, setSort] = useState<DeviceSort>('default');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const visibleDevices = useMemo(() => {
    const base = devices.filter(device => matchesFilter(device, deviceFilter));
    if (sort !== 'operational') return base;
    return [...base].sort(compareOperational);
  }, [devices, deviceFilter, sort]);
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
            <select className="input compact-select" value={sort} onChange={event => setSort(event.target.value as DeviceSort)} title="Ordenar dispositivos">
              <option value="default">Orden original</option>
              <option value="operational">Ordenar por número operativo</option>
            </select>
            {!consultationMode && <Button variant="primary" onClick={() => setAdding(true)}>+ Anadir dispositivo</Button>}
          </div>
        </div>
        {message && <div className={message.tone === 'error' ? 'tool-error' : 'tool-info'}>{message.text}</div>}
        {visibleDevices.length ? (
          <DeviceTable devices={visibleDevices} onLoan={consultationMode ? undefined : onLoan} onReturn={consultationMode ? undefined : onReturn} onProfile={setProfile} onEdit={consultationMode ? undefined : setEditing} onDelete={consultationMode ? undefined : handleDelete} />
        ) : (
          <div className="empty-state">No hay dispositivos para este filtro o busqueda.</div>
        )}
      </section>
      {profile && <DeviceProfile device={profile} onClose={() => setProfile(null)} />}
      {adding && <AddDeviceModal onClose={() => setAdding(false)} onSave={onAdd} />}
      {editing && <AddDeviceModal title={`Editar ${editing.etiqueta}`} initialDevice={editing} onClose={() => setEditing(null)} onSave={onAdd} />}
    </section>
  );
}

function compareOperational(a: Device, b: Device) {
  const type = (device: Device) => classifyDeviceType(device).toLowerCase();
  const num = (device: Device) => {
    const direct = Number(getDeviceNumber(device));
    if (Number.isFinite(direct) && direct > 0) return direct;
    const match = getOperationalAlias(device).match(/(\d+)/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  const typeCompare = type(a).localeCompare(type(b), 'es');
  if (typeCompare) return typeCompare;
  const numberCompare = num(a) - num(b);
  if (numberCompare) return numberCompare;
  return String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es', { numeric: true });
}

import { useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from './DeviceTable';
import { DeviceProfile } from './DeviceProfile';
import { AddDeviceModal } from './AddDeviceModal';

type DeviceFilter = 'all' | 'available' | 'loaned' | 'PLANI' | 'TOUCH' | 'TIC' | 'DELL' | 'missing' | 'out';

const FILTER_LABELS: Record<DeviceFilter, string> = {
  all: 'Todos los dispositivos',
  available: 'Disponibles',
  loaned: 'Prestados',
  PLANI: 'Plani',
  TOUCH: 'Touch',
  TIC: 'TIC',
  DELL: 'Dell',
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

export function DevicesPage({ devices, consultationMode, onAdd, onLoan, onReturn }: {
  devices: Device[];
  consultationMode: boolean;
  onAdd: (device: Partial<Device>) => Promise<void>;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => void;
}) {
  const [profile, setProfile] = useState<Device | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');

  const visibleDevices = useMemo(() => devices.filter(device => matchesFilter(device, deviceFilter)), [devices, deviceFilter]);
  const count = (filter: DeviceFilter) => devices.filter(device => matchesFilter(device, filter)).length;

  return (
    <section className="view active">
      <div className="stats-grid device-filter-grid">
        <StatCard label="Total" value={count('all')} active={deviceFilter === 'all'} onClick={() => setDeviceFilter('all')} />
        <StatCard label="Disponibles" value={count('available')} active={deviceFilter === 'available'} onClick={() => setDeviceFilter('available')} />
        <StatCard label="Prestados" value={count('loaned')} active={deviceFilter === 'loaned'} onClick={() => setDeviceFilter('loaned')} />
        <StatCard label="Plani" value={count('PLANI')} active={deviceFilter === 'PLANI'} onClick={() => setDeviceFilter('PLANI')} />
        <StatCard label="Touch" value={count('TOUCH')} active={deviceFilter === 'TOUCH'} onClick={() => setDeviceFilter('TOUCH')} />
        <StatCard label="TIC" value={count('TIC')} active={deviceFilter === 'TIC'} onClick={() => setDeviceFilter('TIC')} />
        <StatCard label="Dell" value={count('DELL')} active={deviceFilter === 'DELL'} onClick={() => setDeviceFilter('DELL')} />
        <StatCard label="No encontradas" value={count('missing')} active={deviceFilter === 'missing'} onClick={() => setDeviceFilter('missing')} />
        <StatCard label="Fuera de servicio" value={count('out')} active={deviceFilter === 'out'} onClick={() => setDeviceFilter('out')} />
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>{FILTER_LABELS[deviceFilter]}</h3>
            <span className="muted">{visibleDevices.length} equipos visibles</span>
          </div>
          {!consultationMode && <Button variant="primary" onClick={() => setAdding(true)}>+ Anadir dispositivo</Button>}
        </div>
        {visibleDevices.length ? (
          <DeviceTable devices={visibleDevices} onLoan={consultationMode ? undefined : onLoan} onReturn={consultationMode ? undefined : onReturn} onProfile={setProfile} onEdit={consultationMode ? undefined : setEditing} />
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

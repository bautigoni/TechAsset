import type { Device } from '../../types';
import { Badge } from '../layout/Badge';
import { getOperationalAlias } from '../../utils/classifyDevice';

export function DeviceCard({ device, onClick }: { device: Device; onClick?: () => void }) {
  return (
    <article className="list-item" onClick={onClick}>
      <strong>{device.etiqueta} · {getOperationalAlias(device)}</strong>
      <div className="muted">{device.dispositivo || 'Chromebook'} {device.marca || ''} {device.modelo || ''}</div>
      <Badge tone={device.estado === 'Prestado' ? 'loaned' : 'available'}>{device.estado}</Badge>
    </article>
  );
}

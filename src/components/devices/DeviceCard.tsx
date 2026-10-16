import type { Device } from '../../types';
import { Badge } from '../layout/Badge';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { clickableProps } from '../../utils/a11y';

export function DeviceCard({ device, onClick }: { device: Device; onClick?: () => void }) {
  return (
    <article className="list-item" {...(onClick ? clickableProps(onClick, `Abrir ficha de ${device.etiqueta}`) : {})}>
      <strong>{device.etiqueta} · {getOperationalAlias(device)}</strong>
      <div className="muted">{device.dispositivo || 'Chromebook'} {device.marca || ''} {device.modelo || ''}</div>
      <Badge tone={device.estado === 'Prestado' ? 'loaned' : 'available'}>{device.estado}</Badge>
    </article>
  );
}

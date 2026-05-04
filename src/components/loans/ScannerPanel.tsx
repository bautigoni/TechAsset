import type { Device } from '../../types';
import { getOperationalAlias } from '../../utils/classifyDevice';

export function ScannerPanel({ device, message }: { device?: Device; message?: string }) {
  if (!device) return <div className="scan-preview empty">{message || 'Todavía no hay dispositivo detectado.'}</div>;
  return (
    <div className="scan-preview">
      <div className="scan-preview-title">{device.etiqueta} · {getOperationalAlias(device)}</div>
      <div className="scan-preview-meta">{device.dispositivo || 'Chromebook'} {device.marca || ''} {device.modelo || ''}</div>
      <div className="scan-preview-meta">Estado: {device.estado}{device.prestadoA ? ` · ${device.prestadoA}` : ''}</div>
    </div>
  );
}

import type { Device } from '../../types';
import { Modal } from '../layout/Modal';
import { getOperationalAlias, classifyDeviceType } from '../../utils/classifyDevice';

export function DeviceProfile({ device, onClose }: { device: Device; onClose: () => void }) {
  const rows = [
    ['Etiqueta', device.etiqueta],
    ['Alias operativo', getOperationalAlias(device)],
    ['Tipo', classifyDeviceType(device)],
    ['Dispositivo', device.dispositivo],
    ['Marca', device.marca],
    ['Modelo', device.modelo],
    ['Serial', device.sn],
    ['MAC', device.mac],
    ['Estado', device.estado],
    ['Prestada a', device.prestadoA],
    ['Rol', device.rol],
    ['Ubicación', device.ubicacion],
    ['Motivo', device.motivo],
    ['Comentarios', device.comentarios],
    ['Última modificación', device.changedAt || device.ultima]
  ];

  return (
    <Modal title={`Ficha dispositivo - ${device.etiqueta}`} onClose={onClose} wide>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{value || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

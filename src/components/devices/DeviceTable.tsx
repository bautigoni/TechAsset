import { useEffect, useState } from 'react';
import type { Device } from '../../types';
import { Badge } from '../layout/Badge';
import { Button } from '../layout/Button';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { formatLoanDateTime, loanAgeLabel, loanAgeTone } from '../../utils/formatters';

type ActionMode = 'full' | 'dashboard';

function badgeTone(state: string) {
  if (state === 'Prestado') return 'loaned';
  if (state === 'No encontrada' || state === 'Perdida') return 'lost';
  if (state === 'Fuera de servicio') return 'out-service';
  return 'available';
}

function normalizeState(value?: string): 'available' | 'loaned' | 'unavailable' {
  const v = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (v === 'prestado' || v === 'prestada') return 'loaned';
  if (v === 'fuera de servicio' || v === 'fuera servicio'
      || v === 'no encontrada' || v === 'no encontrado'
      || v === 'perdida' || v === 'perdido'
      || v === 'en reparacion' || v === 'mantenimiento'
      || v === 'baja' || v === 'no disponible') return 'unavailable';
  return 'available';
}

function tableValue(value?: string) {
  const clean = String(value || '').trim();
  if (!clean || /^(devuelto|prestado|disponible)$/i.test(clean)) return '-';
  return clean;
}

function deviceModel(device: Device) {
  const parts = [device.marca, device.modelo].map(item => String(item || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}

export function DeviceTable({ devices, compact = false, actionMode = 'full', onLoan, onReturn, onProfile, onEdit, onDelete }: {
  devices: Device[];
  compact?: boolean;
  actionMode?: ActionMode;
  onLoan?: (device: Device) => Promise<unknown> | void;
  onReturn?: (device: Device) => Promise<unknown> | void;
  onProfile?: (device: Device) => void;
  onEdit?: (device: Device) => void;
  onDelete?: (device: Device) => Promise<void> | void;
}) {
  const [deletingTag, setDeletingTag] = useState('');
  // Se renderizaban las 81 filas siempre (1948 nodos, 6300px de scroll). Ahora
  // entran de a 30 y se van sumando: mismo contenido, un tercio del DOM.
  const PAGE = 30;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [devices.length]);
  const shown = devices.slice(0, limit);
  const [returningTag, setReturningTag] = useState('');

  const handleReturn = async (device: Device) => {
    if (!onReturn || returningTag) return;
    setReturningTag(device.etiqueta);
    try {
      await onReturn(device);
    } finally {
      setReturningTag('');
    }
  };

  return (
    <div className="table-wrap no-scroll-table device-table-wrap">
      <table className="compact-table device-table">
        <thead>
          <tr>
            <th>Etiqueta</th>
            <th>Dispositivo</th>
            <th>SN</th>
            <th>Prestado a</th>
            <th>Horario préstamo</th>
            <th>Última devolución</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(device => (
            <tr key={device.id} data-device-tag={device.etiqueta} className={onProfile ? 'device-row-clickable' : ''} role={onProfile ? 'button' : undefined} tabIndex={onProfile ? 0 : undefined} onClick={() => onProfile?.(device)} onKeyDown={event => { if (onProfile && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onProfile(device); } }}>
              <td data-label="Etiqueta">
                <strong>{device.etiqueta}</strong>
                <div className="cell-sub operational-alias">{getOperationalAlias(device)}</div>
              </td>
              <td data-label="Dispositivo">
                <div>{device.categoria || device.dispositivo || 'Chromebook'}</div>
                {device.categoria && device.dispositivo && device.categoria !== device.dispositivo && <div className="cell-sub">{device.dispositivo}</div>}
                <div className="cell-sub">{deviceModel(device)}</div>
              </td>
              <td data-label="SN">{tableValue(device.sn || device.mac)}</td>
              <td data-label="Prestado a">
                <div>{tableValue(device.prestadoA)}</div>
                {device.estado === 'Prestado' && <div className="cell-sub">{[device.ubicacion, device.curso].filter(Boolean).join(' · ') || '-'}</div>}
              </td>
              <td data-label="Horario préstamo">
                {device.estado === 'Prestado' ? (
                  <div className="loan-time-cell">
                    <strong>{tableValue(formatLoanDateTime(device.loanedAt))}</strong>
                    {device.loanedAt && <span className={`loan-age-pill loan-age-${loanAgeTone(device.loanedAt)}`}>{loanAgeLabel(device.loanedAt)}</span>}
                  </div>
                ) : '-'}
              </td>
              <td data-label="Última devolución">{tableValue(formatLoanDateTime(device.returnedAt))}</td>
              <td data-label="Estado"><Badge tone={badgeTone(device.estado)}>{device.estado === 'Perdida' ? 'No encontrada' : device.estado}</Badge></td>
              <td data-label="Acciones" className="device-actions-cell" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                <div className="table-actions device-actions">
                  {onLoan && normalizeState(device.estado) === 'available' && <Button className="mini-action-btn" variant="primary" onClick={() => onLoan(device)}>Prestar</Button>}
                  {onReturn && normalizeState(device.estado) === 'loaned' && <Button className="mini-action-btn" variant="success" disabled={returningTag === device.etiqueta} onClick={() => handleReturn(device)}>{returningTag === device.etiqueta ? 'Devolviendo...' : 'Devolver'}</Button>}
                  {actionMode !== 'dashboard' && onProfile && <Button className="mini-action-btn" onClick={() => onProfile(device)}>Ficha</Button>}
                  {onEdit && <Button className="mini-action-btn" onClick={() => onEdit(device)}>Editar</Button>}
                  {onDelete && actionMode !== 'dashboard' && <Button className="mini-action-btn device-delete-btn" disabled={deletingTag === device.etiqueta} onClick={async () => {
                    if (!window.confirm(`¿Borrar ${device.etiqueta}? Se ocultará de la app sin borrar el historial.`)) return;
                    setDeletingTag(device.etiqueta);
                    try {
                      await onDelete(device);
                    } finally {
                      setDeletingTag('');
                    }
                  }}>{deletingTag === device.etiqueta ? 'Borrando...' : 'Borrar'}</Button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {devices.length > shown.length && (
        <div className="device-table-more">
          <span>{shown.length} de {devices.length}</span>
          <button type="button" onClick={() => setLimit(value => value + PAGE)}>Ver más</button>
          <button type="button" onClick={() => setLimit(devices.length)}>Ver todos</button>
        </div>
      )}
    </div>
  );
}

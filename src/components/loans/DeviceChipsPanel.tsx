import { useMemo, useState } from 'react';
import type { Device } from '../../types';
import { getDeviceNumber, getOperationalAlias, getOperationalGroup, getOperationalNumber } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';

type LoanActionResult = { synced?: boolean; message?: string } | void;

/**
 * Grilla de equipos por tipo dentro de Préstamos, con la misma mecánica que los
 * cartelitos: un botón por equipo, clic en uno libre carga su etiqueta en el
 * formulario de arriba y clic en uno prestado lo devuelve en el acto.
 *
 * No tiene estado propio ni API propia: dibuja los mismos `devices` que el resto
 * de la página y devuelve con el mismo `onReturn`, así que prestar por acá, por
 * el formulario o por el escáner termina siempre en la misma base y se refleja
 * en los tres lados.
 */
export function DeviceChipsPanel({ devices, consultationMode, onReturn, onSeedCode }: {
  devices: Device[];
  consultationMode: boolean;
  onReturn: (payload: Record<string, unknown>) => Promise<LoanActionResult>;
  onSeedCode: (etiqueta: string) => void;
}) {
  const [busyTag, setBusyTag] = useState('');
  const [error, setError] = useState('');

  // Los grupos grandes primero (Touch antes que TIC): el total por tipo no
  // cambia al prestar, así que el orden queda quieto mientras se opera.
  const groups = useMemo(() => {
    const byGroup = new Map<string, Device[]>();
    for (const device of devices) {
      const key = getOperationalGroup(device) || 'Otro';
      const list = byGroup.get(key);
      if (list) list.push(device);
      else byGroup.set(key, [device]);
    }
    return [...byGroup.entries()]
      .map(([nombre, items]) => ({
        nombre,
        items: [...items].sort((a, b) =>
          getOperationalNumber(a) - getOperationalNumber(b)
          || String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es', { numeric: true })),
        prestados: items.filter(device => getDeviceStateKey(device) === 'loaned')
      }))
      .sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre, 'es'));
  }, [devices]);

  const devolver = async (device: Device) => {
    if (busyTag) return;
    setBusyTag(device.etiqueta);
    setError('');
    try {
      await onReturn({ etiqueta: device.etiqueta });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `No se pudo devolver ${device.etiqueta}.`);
    } finally {
      setBusyTag('');
    }
  };

  if (!groups.length) return null;

  return (
    <div className="device-pass-stack">
      {error && <div className="tool-error">{error}</div>}
      {groups.map(group => (
        <section className="card pass-panel device-pass-panel" key={group.nombre}>
          <div className="card-head">
            <div>
              <h3>{group.nombre}</h3>
              <span className="muted">{group.prestados.length} de {group.items.length} prestados</span>
            </div>
          </div>
          <div className="pass-chips">
            {group.items.map(device => {
              const estado = getDeviceStateKey(device);
              const numero = getDeviceNumber(device);
              const alias = getOperationalAlias(device) || device.etiqueta;
              const bloqueado = estado === 'missing' || estado === 'out';
              const prestado = estado === 'loaned';
              return (
                <button
                  key={device.id || device.etiqueta}
                  type="button"
                  className={`pass-chip ${numero ? '' : 'is-wide'} ${prestado ? 'is-prestado' : ''} ${bloqueado ? 'is-bloqueado' : ''}`}
                  disabled={consultationMode || bloqueado || busyTag === device.etiqueta}
                  title={bloqueado
                    ? `${alias} · ${device.etiqueta} — ${device.estado || 'no disponible'}`
                    : prestado
                      ? `${alias} · ${device.etiqueta} — ${device.prestadoA || 'sin persona'}${device.curso ? ` · ${device.curso}` : ''}${device.ubicacion ? ` · ${device.ubicacion}` : ''} — clic para devolver`
                      : `${alias} · ${device.etiqueta} — clic para prestar`}
                  onClick={() => {
                    if (prestado) void devolver(device);
                    else onSeedCode(device.etiqueta);
                  }}
                >
                  {numero || device.etiqueta}
                </button>
              );
            })}
          </div>
          {group.prestados.length > 0 && (
            <ul className="pass-lent-list">
              {group.prestados.map(device => (
                <li key={device.id || device.etiqueta}>
                  <b>{getDeviceNumber(device) || device.etiqueta}</b>
                  <span>
                    {device.prestadoA || 'Sin persona'}
                    {device.curso && <em>{device.curso}</em>}
                    {device.ubicacion && <i>{device.ubicacion}</i>}
                  </span>
                  <time>{device.loanedAt ? new Date(device.loanedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

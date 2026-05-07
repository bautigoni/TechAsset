import type { Device, Movement } from '../../types';
import { classifyDeviceType, getOperationalAlias } from '../../utils/classifyDevice';
import { LoanForm } from './LoanForm';
import { RecentMovements } from '../dashboard/RecentMovements';
import { DailyClosurePanel } from '../dashboard/DailyClosurePanel';

function countBy(devices: Device[], getter: (device: Device) => string) {
  return Object.entries(devices.reduce<Record<string, number>>((acc, device) => {
    const key = getter(device) || '-';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
}

export function LoansPage({ devices, movements, operator, consultationMode, onLend, onReturn, initialCode = '' }: { devices: Device[]; movements: Movement[]; operator: string; consultationMode: boolean; onLend: (payload: Record<string, unknown>) => Promise<void>; onReturn: (payload: Record<string, unknown>) => Promise<void>; initialCode?: string }) {
  const loaned = devices.filter(device => device.estado === 'Prestado');
  const available = devices.filter(device => device.estado === 'Disponible');
  const byType = countBy(devices, device => classifyDeviceType(device));
  const byLocation = countBy(loaned, device => device.ubicacion || 'Sin ubicacion');
  const recentLoaned = loaned.slice(0, 8);

  return (
    <section className="view active">
      <div className="panel two-col loans-layout">
        <section className="card">
          <div className="card-head">
            <h3>Prestamo / devolucion</h3>
            <DailyClosurePanel operator={operator} consultationMode={consultationMode} />
          </div>
          <LoanForm devices={devices} consultationMode={consultationMode} onLend={onLend} onReturn={onReturn} initialCode={initialCode} />
        </section>
        <div className="loans-side-stack">
          <section className="card loan-summary-card">
            <div className="card-head"><h3>Resumen rapido</h3></div>
            <div className="loan-summary-grid">
              <div><span>Prestados</span><strong>{loaned.length}</strong></div>
              <div><span>Disponibles</span><strong>{available.length}</strong></div>
              <div><span>Mas usado</span><strong>{byType[0]?.[0] || '-'}</strong></div>
              <div><span>Ubicacion</span><strong>{byLocation[0]?.[0] || '-'}</strong></div>
            </div>
            <div className="loan-filter-chips">
              {byType.map(([label, value]) => <span key={label}>{label}: {value}</span>)}
            </div>
          </section>
          <section className="card loaned-now-card">
            <div className="card-head"><h3>Actualmente prestados</h3><span className="muted">{loaned.length}</span></div>
            <div className="loaned-now-list">
              {recentLoaned.map(device => (
                <div className="loaned-now-item" key={device.id}>
                  <strong>{device.etiqueta} · {getOperationalAlias(device)}</strong>
                  <span>{device.prestadoA || 'Sin persona'} · {device.ubicacion || 'Sin ubicacion'}</span>
                  <button type="button" onClick={() => onReturn({ etiqueta: device.etiqueta })} disabled={consultationMode}>Devolver</button>
                </div>
              ))}
              {!loaned.length && <div className="empty-state">No hay equipos prestados ahora.</div>}
            </div>
          </section>
          <RecentMovements items={movements} />
        </div>
      </div>
    </section>
  );
}

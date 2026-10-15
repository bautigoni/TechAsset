import { useCallback, useEffect, useState } from 'react';
import type { Device, Movement, PreviousDayLoan } from '../../types';
import { classifyDeviceType, getOperationalAlias } from '../../utils/classifyDevice';
import { formatLoanDateTime, formatTimeOnly, loanAgeDays, loanAgeLabel, loanAgeTone, formatDate } from '../../utils/formatters';
import { getPreviousDayLoans, type LoanBatchResponse } from '../../services/loansApi';
import { LoanForm } from './LoanForm';
import { PhotoPassPanel } from './PhotoPassPanel';
import { DeviceChipsPanel } from './DeviceChipsPanel';
import { DailyClosurePanel } from '../dashboard/DailyClosurePanel';
import { clickableProps } from '../../utils/a11y';
import { getLoanState } from '../../utils/deviceState';

function countBy(devices: Device[], getter: (device: Device) => string) {
  return Object.entries(devices.reduce<Record<string, number>>((acc, device) => {
    const key = getter(device) || '-';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
}

type LoanActionResult = { synced?: boolean; message?: string } | void;

export function LoansPage({ devices, operator, consultationMode, onLend, onReturn, onLendBatch, onReturnBatch, onProfile, initialCode = '' }: { devices: Device[]; movements: Movement[]; operator: string; consultationMode: boolean; onLend: (payload: Record<string, unknown>) => Promise<LoanActionResult>; onReturn: (payload: Record<string, unknown>) => Promise<LoanActionResult>; onLendBatch: (payload: Record<string, unknown> & { etiquetas: string[] }) => Promise<LoanBatchResponse>; onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>; onProfile?: (device:Device)=>void; initialCode?: string }) {
  const [returnSeed, setReturnSeed] = useState(initialCode);
  const [batchSeed, setBatchSeed] = useState<{ etiquetas: string[]; nonce: number } | undefined>();
  const [previousLoans, setPreviousLoans] = useState<PreviousDayLoan[]>([]);
  const [previousDate, setPreviousDate] = useState('');
  const [previousError, setPreviousError] = useState('');
  const [previousLoading, setPreviousLoading] = useState(false);
  const loaned = devices.filter(device => getLoanState(device.estado) === 'loaned');
  const available = devices.filter(device => getLoanState(device.estado) === 'available');
  const byType = countBy(devices, device => classifyDeviceType(device));
  const byLocation = countBy(loaned, device => device.ubicacion || 'Sin ubicación');
  const recentLoaned = [...loaned]
    .sort((a, b) => loanAgeDays(b.loanedAt) - loanAgeDays(a.loanedAt) || String(a.loanedAt || '').localeCompare(String(b.loanedAt || '')))
    .slice(0, 8);

  // Carga una etiqueta en el formulario de arriba y sube la vista. El paso por
  // '' fuerza que LoanForm reaccione aunque sea la misma etiqueta que la vez
  // anterior (su efecto depende del valor recibido).
  const seedLoanCode = useCallback((etiqueta: string) => {
    setReturnSeed('');
    window.setTimeout(() => setReturnSeed(etiqueta), 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Lote marcado en la grilla: va a la lista del escaneo continuo del formulario.
  const seedLoanBatch = useCallback((etiquetas: string[]) => {
    setBatchSeed(current => ({ etiquetas, nonce: (current?.nonce || 0) + 1 }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const loadPreviousLoans = useCallback(async (alive: () => boolean = () => true) => {
    setPreviousLoading(true);
    setPreviousError('');
    try {
      const response = await getPreviousDayLoans();
      if (!alive()) return;
      setPreviousLoans(response.items || []);
      setPreviousDate(response.date || '');
    } catch (error) {
      if (!alive()) return;
      setPreviousLoans([]);
      const message = error instanceof Error ? error.message : '';
      setPreviousError(message.includes('API') || message.includes('JSON') || message.includes('inválida')
        ? 'No se pudo cargar el resumen de ayer. Reintentá en un momento.'
        : message || 'No se pudo cargar el resumen de ayer.');
    } finally {
      if (alive()) setPreviousLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void loadPreviousLoans(() => alive);
    return () => { alive = false; };
  }, [loadPreviousLoans]);

  return (
    <section className="view active">
      <div className="panel two-col loans-layout">
        <section className="card">
          <div className="card-head">
            <h3>Préstamo / devolución</h3>
            <DailyClosurePanel operator={operator} consultationMode={consultationMode} />
          </div>
          <LoanForm devices={devices} consultationMode={consultationMode} onLend={onLend} onReturn={onReturn} onLendBatch={onLendBatch} initialCode={returnSeed || initialCode} batchSeed={batchSeed} />
          {/* Equipos y cartelitos van abajo del formulario, donde sobraba lugar,
              en vez de apretar la columna lateral. */}
          <DeviceChipsPanel devices={devices} consultationMode={consultationMode} onReturnBatch={onReturnBatch} onSeedCode={seedLoanCode} onBatchLend={seedLoanBatch} />
          <PhotoPassPanel consultationMode={consultationMode} />
        </section>
        <div className="loans-side-stack">
          <section className="card loan-summary-card">
            <div className="card-head"><h3>Resumen rápido</h3></div>
            <div className="loan-summary-grid">
              <div><span>Prestados</span><strong>{loaned.length}</strong></div>
              <div><span>Disponibles</span><strong>{available.length}</strong></div>
              <div><span>Más usado</span><strong>{byType[0]?.[0] || '-'}</strong></div>
              <div><span>Ubicación</span><strong>{byLocation[0]?.[0] || '-'}</strong></div>
            </div>
            <div className="loan-filter-chips">
              {byType.map(([label, value]) => <span key={label}>{label}: {value}</span>)}
            </div>
          </section>
          <section className="card previous-loans-card">
            <div className="card-head">
              <div>
                <h3>Último día con préstamos</h3>
                <span className="muted">{previousDate ? formatShortDate(previousDate) : 'Actualización diaria'}</span>
              </div>
              <span className="badge loaned">{previousLoading ? '...' : previousLoans.length}</span>
            </div>
            {previousError && (
              <div className="tool-error previous-loans-error">
                <span>{previousError}</span>
                <button type="button" onClick={() => void loadPreviousLoans()} disabled={previousLoading}>
                  Reintentar
                </button>
              </div>
            )}
            {!previousError && previousLoans.length > 0 && (
              <div className="previous-loans-table-wrap">
                <table className="previous-loans-table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Equipo</th>
                      <th>Persona</th>
                      <th>Ubicación</th>
                      <th>Motivo</th>
                      <th>Accesorios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previousLoans.map(item => (
                      <tr key={item.id} className="device-row-clickable" {...clickableProps(() => { const device = devices.find(value => value.etiqueta === item.etiqueta); if (device) onProfile?.(device); }, `Abrir ficha de ${item.etiqueta}`)}>
                        <td>{formatTimeOnly(item.timestamp) || '-'}</td>
                        <td>
                          <strong>{item.etiqueta}</strong>
                          {item.alias && <span>{item.alias}</span>}
                        </td>
                        <td>{item.persona || '-'}</td>
                        <td>{[item.ubicacion, item.curso].filter(Boolean).join(' · ') || '-'}</td>
                        <td>{item.motivo || '-'}</td>
                        <td>{item.accessories?.length ? item.accessories.join(', ') : 'Sin accesorios'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!previousError && !previousLoans.length && <div className="empty-state previous-loans-empty">Sin préstamos registrados en días anteriores.</div>}
          </section>
          <section className="card loaned-now-card">
            <div className="card-head"><h3>Actualmente prestados</h3><span className="muted">{loaned.length}</span></div>
            <div className="loaned-now-list">
              {recentLoaned.map(device => (
                <div className={`loaned-now-item loan-age-${loanAgeTone(device.loanedAt)} device-row-clickable`} key={device.id} {...clickableProps(() => onProfile?.(device), `Abrir ficha de ${device.etiqueta}`)}>
                  <strong>{device.etiqueta} · {getOperationalAlias(device)}</strong>
                  <span>{device.prestadoA || 'Sin persona'} · {[device.ubicacion, device.curso].filter(Boolean).join(' · ') || 'Sin ubicación'}</span>
                  <span className="loaned-now-time">{formatLoanDateTime(device.loanedAt) || 'Sin fecha'} · {loanAgeLabel(device.loanedAt) || 'sin antiguedad'}</span>
                  <button type="button" onClick={event => { event.stopPropagation(); seedLoanCode(device.etiqueta); }} disabled={consultationMode}>Revisar devolución</button>
                </div>
              ))}
              {!loaned.length && <div className="empty-state">No hay equipos prestados ahora.</div>}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return Number.isNaN(date.getTime()) ? value : formatDate(date, { day: '2-digit', month: 'short' });
}


import { useEffect, useState } from 'react';
import type { Operator, SyncStatus } from '../../types';
import { OPERATORS } from '../../utils/permissions';
import { AdvancedSettings } from './AdvancedSettings';
import { fetchShiftSettings, updateShiftSettings } from '../../services/operationsApi';

export function SettingsPage({ operator, setOperator, consultationMode, setConsultationMode, sync }: { operator: Operator; setOperator: (operator: Operator) => void; consultationMode: boolean; setConsultationMode: (value: boolean) => void; sync: SyncStatus }) {
  const [shifts, setShifts] = useState({ morningOperator: 'Bauti', afternoonOperator: 'Equi' });
  useEffect(() => { fetchShiftSettings().then(r => r.ok && setShifts(r.settings)).catch(() => {}); }, []);
  return (
    <section className="view active">
      <div className="panel settings-single">
        <section className="card">
          <div className="card-head"><h3>Configuración</h3></div>
          <div className="grid-2">
            <label>Operador actual
              <select className="input" value={operator} onChange={event => setOperator(event.target.value as Operator)}>
                {OPERATORS.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Modo consulta / vista jefe
              <select className="input" value={consultationMode ? 'si' : 'no'} onChange={event => setConsultationMode(event.target.value === 'si')}>
                <option value="no">Desactivado</option>
                <option value="si">Activado</option>
              </select>
            </label>
          </div>
          <div className="sync-status ok">Estado de sincronización: {sync.state === 'ok' ? 'OK' : sync.state === 'error' ? 'Error' : 'Sincronizando'}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3>Turnos TIC</h3></div>
          <div className="grid-2">
            <label>Mañana<select className="input" value={shifts.morningOperator} onChange={e => setShifts(s => ({ ...s, morningOperator: e.target.value }))}>{OPERATORS.map(item => <option key={item}>{item}</option>)}</select></label>
            <label>Tarde<select className="input" value={shifts.afternoonOperator} onChange={e => setShifts(s => ({ ...s, afternoonOperator: e.target.value }))}>{OPERATORS.map(item => <option key={item}>{item}</option>)}</select></label>
          </div>
          <div className="actions"><button className="btn btn-primary" disabled={consultationMode} type="button" onClick={() => updateShiftSettings(shifts)}>Guardar turnos</button></div>
        </section>
        <AdvancedSettings />
      </div>
    </section>
  );
}

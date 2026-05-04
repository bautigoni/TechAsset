import type { Operator, SyncStatus } from '../../types';
import { OPERATORS } from '../../utils/permissions';
import { AdvancedSettings } from './AdvancedSettings';

export function SettingsPage({ operator, setOperator, consultationMode, setConsultationMode, sync }: { operator: Operator; setOperator: (operator: Operator) => void; consultationMode: boolean; setConsultationMode: (value: boolean) => void; sync: SyncStatus }) {
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
        <AdvancedSettings />
        <section className="card">
          <div className="card-head"><h3>Procedimientos</h3></div>
          <div className="procedures-list">
            {['Cómo prestar computadoras', 'Cómo hacer cierre del día', 'Qué hacer si falla localtunnel', 'Qué hacer si una compu queda no encontrada', 'Qué hacer si una tarea queda vencida', 'Qué hacer si se marca Faltaron equipos'].map(item => <div className="list-item" key={item}>{item}</div>)}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h3>Mapa del colegio</h3></div>
          <div className="map-placeholder">Placeholder para plano y ubicaciones: Aula, DOE, Preceptoría, Planificación, Laboratorio, Biblioteca.</div>
        </section>
      </div>
    </section>
  );
}

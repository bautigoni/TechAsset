import { useEffect, useState } from 'react';
import type { AuthUser, Operator, SiteInfo, SyncStatus } from '../../types';
import { AdvancedSettings } from './AdvancedSettings';
import { fetchShiftSettings, updateShiftSettings } from '../../services/operationsApi';
import { SiteAdminPanel } from './SiteAdminPanel';
import { AllowedUsersPanel } from './AllowedUsersPanel';
import { LoanSettingsPanel } from './LoanSettingsPanel';
import { getDevicesDebug } from '../../services/devicesApi';

export function SettingsPage({ operator, consultationMode, setConsultationMode, sync, user, sites, onSitesChanged }: { operator: Operator; setOperator: (operator: Operator) => void; consultationMode: boolean; setConsultationMode: (value: boolean) => void; sync: SyncStatus; user: AuthUser; sites: SiteInfo[]; onSitesChanged: () => void }) {
  const [shifts, setShifts] = useState({ morningOperator: '', afternoonOperator: '' });
  const [debugMessage, setDebugMessage] = useState('');
  const isAdmin = ['Superadmin', 'Jefe TIC', 'Admin', 'Administrador'].includes(user.rolGlobal);
  useEffect(() => { fetchShiftSettings().then(r => r.ok && setShifts(r.settings)).catch(() => {}); }, []);
  return (
    <section className="view active">
      <div className="panel settings-single">
        <section className="card">
          <div className="card-head"><h3>Configuración</h3></div>
          <div className="grid-2">
            <label>Usuario actual
              <input className="input" value={operator} readOnly />
            </label>
            <label>Modo consulta / vista jefe
              <select className="input" value={consultationMode ? 'si' : 'no'} onChange={event => setConsultationMode(event.target.value === 'si')}>
                <option value="no">Desactivado</option>
                <option value="si">Activado</option>
              </select>
            </label>
          </div>
          <div className="sync-status ok">Estado de sincronización: {sync.state === 'ok' ? 'OK' : sync.state === 'warning' ? 'Con advertencia' : sync.state === 'error' ? 'Error' : 'Sincronizando'}</div>
          <div className="actions">
            <button className="btn" type="button" onClick={() => {
              setDebugMessage('Consultando Apps Script...');
              getDevicesDebug()
                .then(result => {
                  if (!result.ok) throw new Error(result.error || 'No se pudo diagnosticar Apps Script.');
                  const debug = result.debug || {};
                  setDebugMessage(`Apps Script: ${debug.spreadsheetName || '-'} · ${debug.sheetName || '-'} · filas: ${debug.rowsCount ?? '-'}`);
                })
                .catch(error => setDebugMessage(error instanceof Error ? error.message : 'No se pudo diagnosticar Apps Script.'));
            }}>Diagnosticar Apps Script</button>
          </div>
          {debugMessage && <div className={debugMessage.includes('No se pudo') ? 'tool-warning' : 'tool-info'}>{debugMessage}</div>}
        </section>
        <section className="card">
          <div className="card-head"><h3>Turnos TIC</h3></div>
          <div className="grid-2">
            <label>Mañana<input className="input" value={shifts.morningOperator} onChange={e => setShifts(s => ({ ...s, morningOperator: e.target.value }))} /></label>
            <label>Tarde<input className="input" value={shifts.afternoonOperator} onChange={e => setShifts(s => ({ ...s, afternoonOperator: e.target.value }))} /></label>
          </div>
          <div className="actions"><button className="btn btn-primary" disabled={consultationMode} type="button" onClick={() => updateShiftSettings(shifts)}>Guardar turnos</button></div>
        </section>
        {isAdmin && (
          <>
            <LoanSettingsPanel />
            <SiteAdminPanel user={user} onChanged={onSitesChanged} />
            <AllowedUsersPanel canAssignSuperadmin={user.rolGlobal === 'Superadmin'} onChanged={onSitesChanged} />
            <AdvancedSettings />
          </>
        )}
        {!isAdmin && <div className="tool-info">Tu usuario tiene acceso a: {sites.map(site => site.siteCode).join(', ')}</div>}
      </div>
    </section>
  );
}

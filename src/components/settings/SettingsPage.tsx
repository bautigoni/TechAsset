import { useEffect, useState } from 'react';
import type { AuthUser, Operator, SiteInfo, SyncStatus } from '../../types';
import { AdvancedSettings } from './AdvancedSettings';
import { fetchShiftSettings, updateShiftSettings } from '../../services/operationsApi';
import { AllowedUsersPanel } from './AllowedUsersPanel';
import { AppearancePanel } from './AppearancePanel';
import { LoanSettingsPanel } from './LoanSettingsPanel';
import { ModulesPanel } from './ModulesPanel';
import { RolesPanel } from './RolesPanel';
import { InvitesPanel } from './InvitesPanel';
import { NotificationsPanel } from './NotificationsPanel';

export function SettingsPage({ operator, consultationMode, setConsultationMode, siteRole, roleReadOnly, sync, user, sites, onSitesChanged, onModulesChanged }: {
  operator: Operator;
  setOperator: (operator: Operator) => void;
  consultationMode: boolean;
  setConsultationMode: (value: boolean) => void;
  siteRole: string;
  roleReadOnly: boolean;
  sync: SyncStatus;
  user: AuthUser;
  sites: SiteInfo[];
  onSitesChanged: () => void;
  onModulesChanged?: () => void;
}) {
  const [shifts, setShifts] = useState({ morningOperator: '', afternoonOperator: '' });
  // Permisos por rol en la sede activa (Superadmin global incluido).
  const isAdmin = ['Superadmin', 'Jefe TIC', 'Admin', 'Administrador'].includes(siteRole);

  useEffect(() => {
    fetchShiftSettings().then(r => r.ok && setShifts(r.settings)).catch(() => {});
  }, []);

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
              <select className="input" value={consultationMode ? 'si' : 'no'} disabled={roleReadOnly} onChange={event => setConsultationMode(event.target.value === 'si')}>
                <option value="no">Desactivado</option>
                <option value="si">Activado</option>
              </select>
              {roleReadOnly
                ? <small className="muted">Tu rol ({siteRole || 'Consulta'}) es de solo lectura: el modo consulta está siempre activo.</small>
                : <small className="muted">Activalo para previsualizar la app en modo solo lectura.</small>}
            </label>
          </div>
          <div className="sync-status ok">
            Base local: {sync.state === 'ok' ? 'OK' : sync.state === 'warning' ? 'Con advertencia' : sync.state === 'error' ? 'Error' : 'Cargando'}
            {sync.message ? ` · ${sync.message}` : ''}
          </div>
        </section>
        <AppearancePanel />
        <section className="card">
          <div className="card-head"><h3>Turnos TIC</h3></div>
          <div className="grid-2">
            <label>Mañana<input className="input" value={shifts.morningOperator} onChange={e => setShifts(s => ({ ...s, morningOperator: e.target.value }))} /></label>
            <label>Tarde<input className="input" value={shifts.afternoonOperator} onChange={e => setShifts(s => ({ ...s, afternoonOperator: e.target.value }))} /></label>
          </div>
          <div className="actions"><button className="btn btn-primary" disabled={consultationMode} type="button" onClick={() => updateShiftSettings(shifts)}>Guardar turnos</button></div>
        </section>
        <NotificationsPanel />
        {isAdmin && (
          <>
            <ModulesPanel consultationMode={consultationMode} onChanged={onModulesChanged} />
            <RolesPanel consultationMode={consultationMode} onChanged={onModulesChanged} />
            <InvitesPanel consultationMode={consultationMode} />
            <LoanSettingsPanel />
            <AllowedUsersPanel canAssignSuperadmin={user.rolGlobal === 'Superadmin'} onChanged={onSitesChanged} />
            <AdvancedSettings />
          </>
        )}
        {!isAdmin && <div className="tool-info">Tu usuario tiene acceso a: {sites.map(site => site.siteCode).join(', ')}</div>}
      </div>
    </section>
  );
}

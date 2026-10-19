import { useState, type ReactNode } from 'react';
import type { AuthUser, Operator, SiteInfo, SyncStatus } from '../../types';
import { Button, Switch } from '../../ui';
import { cx } from '../../ui/util';
import { Card, SettingRow } from './settingsKit';

const SYNC_LABEL: Record<SyncStatus['state'], string> = { ok: 'OK', warning: 'Con advertencia', error: 'Error', loading: 'Sincronizando' };

export function AccountPanel({ header, operator, user, sites, siteRole, roleReadOnly, consultationMode, setConsultationMode, sync, onLogout }: {
  header: (actions?: ReactNode) => ReactNode;
  operator: Operator;
  user: AuthUser;
  sites: SiteInfo[];
  siteRole: string;
  roleReadOnly: boolean;
  consultationMode: boolean;
  setConsultationMode: (value: boolean) => void;
  sync: SyncStatus;
  onLogout: () => void | Promise<void>;
}) {
  const [leaving, setLeaving] = useState(false);
  const syncTone = sync.state === 'error' ? 'is-bad' : sync.state === 'warning' ? 'is-warn' : '';
  return (
    <>
      {header()}
      <Card ariaLabel="Cuenta">
        <SettingRow name="Usuario actual" desc="Con este nombre quedan firmados tus préstamos y cambios.">
          <span className="cfg-value">
            <span className="cfg-strong">{operator || user.nombre || user.email}</span>
            <span className="cfg-t3 cfg-break">{user.email}</span>
          </span>
        </SettingRow>
        <SettingRow name="Rol en esta sede" desc="Lo asigna quien administra la sede.">
          <span className="cfg-strong">{siteRole || 'Consulta'}</span>
        </SettingRow>
        <SettingRow
          name="Modo consulta"
          desc={roleReadOnly
            ? `Tu rol (${siteRole || 'Consulta'}) es de solo lectura: el modo consulta está siempre activo.`
            : 'Previsualizá la app en solo lectura, como la ve el jefe. Se apaga al recargar.'}
        >
          <span className="cfg-inline">
            <span className="cfg-t2">{consultationMode ? 'Activado' : 'Apagado'}</span>
            <Switch checked={consultationMode} disabled={roleReadOnly} ariaLabel="Modo consulta" onCheckedChange={setConsultationMode} />
          </span>
        </SettingRow>
        <SettingRow name="Base de datos" desc="Estado de la conexión para esta sede.">
          <span className="cfg-value">
            <span className={cx('cfg-strong', syncTone)}>{SYNC_LABEL[sync.state]}</span>
            {sync.message && <span className="cfg-t3 cfg-break">{sync.message}</span>}
          </span>
        </SettingRow>
        <SettingRow name="Sedes" desc="Tu usuario tiene acceso a estas sedes.">
          <span className="cfg-mono cfg-break">{sites.map(site => site.siteCode).join(' · ') || '—'}</span>
        </SettingRow>
        <SettingRow name="Sesión" desc="Queda abierta 30 días en este navegador.">
          <Button loading={leaving} loadingLabel="Cerrando…" onClick={async () => { setLeaving(true); try { await onLogout(); } finally { setLeaving(false); } }}>Cerrar sesión</Button>
        </SettingRow>
      </Card>
    </>
  );
}

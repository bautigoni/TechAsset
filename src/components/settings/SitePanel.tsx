import { useEffect, useState, type ReactNode } from 'react';
import type { SiteInfo } from '../../types';
import { ErrorState, SkeletonRows } from '../../ui';
import { getSites } from '../../services/authApi';
import { Card, CardBody, errorText } from './settingsKit';
import { SiteForm } from './SiteForm';

/** Sede y logo de la sede activa (admin de la sede o superadmin). */
export function SitePanel({ header, readOnly, siteCode, site: sessionSite, superadmin, onChanged }: {
  header: (actions?: ReactNode) => ReactNode;
  readOnly: boolean;
  siteCode: string;
  site?: SiteInfo;
  superadmin: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoadError('');
    getSites()
      .then(response => setSite((response.items || []).find(item => item.siteCode === siteCode) || sessionSite || null))
      .catch(reason => { setLoadError(errorText(reason, 'No se pudieron cargar los datos de la sede.')); if (sessionSite) setSite(sessionSite); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  return (
    <>
      {header()}
      {loadError && !site && <ErrorState message={loadError} onRetry={load} />}
      <Card title="Datos de la sede" heightKey={Boolean(site)} meta={<span className="cfg-mono">{siteCode}</span>}>
        <CardBody>
          {!site ? <SkeletonRows rows={5} /> : (
            <SiteForm
              site={site}
              mode="edit"
              superadmin={superadmin}
              readOnly={readOnly}
              dirtyKey="sede"
              onSaved={async saved => { setSite(saved); await onChanged(); }}
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}

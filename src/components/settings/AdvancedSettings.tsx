import { useState } from 'react';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { getDevicesDiagnostics } from '../../services/devicesApi';
import { Button } from '../layout/Button';

export function AdvancedSettings() {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [siteSettingsText, setSiteSettingsText] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');

  const loadDiagnostics = async () => {
    setLoadingDiagnostics(true);
    setDiagnosticsError('');
    try {
      const response = await getDevicesDiagnostics();
      setDiagnostics(response.diagnostics);
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : 'No se pudo cargar el diagnostico');
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const loadSettings = async () => {
    const response = await getSiteSettings();
    setSiteSettingsText(JSON.stringify(response.settings, null, 2));
    setSettingsMessage('');
  };

  const saveSettings = async () => {
    try {
      const parsed = JSON.parse(siteSettingsText || '{}');
      const response = await updateSiteSettings(parsed);
      setSiteSettingsText(JSON.stringify(response.settings, null, 2));
      setSettingsMessage('Configuración de sede guardada.');
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.');
    }
  };

  return (
    <details className="card">
      <summary><strong>Avanzado</strong></summary>
      <div className="stack" style={{ marginTop: 14 }}>
        <label>URL lectura /sheet.csv<input className="input" placeholder="GOOGLE_SHEET_CSV_URL" /></label>
        <label>URL Apps Script<input className="input" placeholder="APPS_SCRIPT_URL" /></label>
        <div className="actions">
          <Button>Exportar CSV</Button>
          <Button>Exportar PDF QR</Button>
          <Button onClick={loadDiagnostics} disabled={loadingDiagnostics}>Diagnostico</Button>
          <Button onClick={loadSettings}>Configuración de sede</Button>
          <Button>Backup SQLite</Button>
          <Button>Reset datos demo/prueba</Button>
        </div>
        {diagnosticsError && <div className="tool-error">{diagnosticsError}</div>}
        {siteSettingsText && (
          <section className="site-settings-editor">
            <label>Configuración de sede (JSON)
              <textarea className="input" rows={12} value={siteSettingsText} onChange={event => setSiteSettingsText(event.target.value)} />
            </label>
            <div className="actions"><Button variant="primary" onClick={saveSettings}>Guardar configuración</Button></div>
            {settingsMessage && <div className={settingsMessage.includes('guardada') ? 'tool-info' : 'tool-error'}>{settingsMessage}</div>}
          </section>
        )}
        {diagnostics && (
          <div className="diagnostics-grid">
            <Diagnostic label="Fuente" value={diagnostics.source} />
            <Diagnostic label="Ultima lectura OK" value={diagnostics.lastSuccessfulReadAt} />
            <Diagnostic label="Fetch externo" value={`${diagnostics.lastExternalFetchMs ?? 0} ms`} />
            <Diagnostic label="Parse CSV/JSON" value={`${diagnostics.lastParseMs ?? 0} ms`} />
            <Diagnostic label="Merge SQLite" value={`${diagnostics.lastMergeMs ?? 0} ms`} />
            <Diagnostic label="Total backend" value={`${diagnostics.lastTotalMs ?? 0} ms`} />
            <Diagnostic label="Equipos" value={diagnostics.deviceCount} />
            <Diagnostic label="Respondio cache" value={diagnostics.respondedWithCache ? 'Si' : 'No'} />
            <Diagnostic label="Edad cache" value={diagnostics.cacheAgeSeconds == null ? 'Sin cache' : `${diagnostics.cacheAgeSeconds} s`} />
            <Diagnostic label="Timeout" value={diagnostics.timedOut ? 'Si' : 'No'} />
            <Diagnostic label="Refresh en curso" value={diagnostics.inflight ? 'Si' : 'No'} />
            <Diagnostic label="Ultimo error" value={diagnostics.lastError || 'Sin error'} />
          </div>
        )}
      </div>
    </details>
  );
}

function Diagnostic({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="diagnostic-item">
      <span>{label}</span>
      <strong>{String(value || '-')}</strong>
    </div>
  );
}

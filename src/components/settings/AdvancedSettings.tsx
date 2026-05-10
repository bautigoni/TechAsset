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
      setDiagnosticsError(error instanceof Error ? error.message : 'No se pudo cargar el diagnóstico');
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
        <p className="muted">TechAsset usa SQLite como fuente principal. Google Sheets queda solo para importación CSV manual por sede.</p>
        <div className="actions">
          <Button onClick={loadDiagnostics} disabled={loadingDiagnostics}>Diagnóstico local</Button>
          <Button onClick={loadSettings}>Configuración de sede</Button>
          <Button>Backup SQLite</Button>
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
            <Diagnostic label="Sede" value={diagnostics.siteCode} />
            <Diagnostic label="Equipos" value={diagnostics.deviceCount} />
            <Diagnostic label="Última importación" value={diagnostics.lastImportAt || 'Sin importación registrada'} />
            <Diagnostic label="Último error" value={diagnostics.lastError || 'Sin error'} />
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

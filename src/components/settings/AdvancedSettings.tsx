import { Button } from '../layout/Button';

export function AdvancedSettings() {
  return (
    <details className="card">
      <summary><strong>Avanzado</strong></summary>
      <div className="stack" style={{ marginTop: 14 }}>
        <label>URL lectura /sheet.csv<input className="input" placeholder="GOOGLE_SHEET_CSV_URL" /></label>
        <label>URL Apps Script<input className="input" placeholder="APPS_SCRIPT_URL" /></label>
        <div className="actions">
          <Button>Exportar CSV</Button>
          <Button>Exportar PDF QR</Button>
          <Button>Diagnóstico</Button>
          <Button>Backup SQLite</Button>
          <Button>Reset datos demo/prueba</Button>
        </div>
      </div>
    </details>
  );
}

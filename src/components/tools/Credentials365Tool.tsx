import { useEffect, useState } from 'react';
import { Button } from '../layout/Button';
import { downloadC365Template, fetchToolsConfig, previewC365, sendC365, uploadC365Csv } from '../../services/toolsApi';

const REQUIRED = ['Nombre para mostrar', 'Nombre de usuario', 'mail', 'Contraseña', 'Sede', 'Licencias'];

export function Credentials365Tool() {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [invalidPreview, setInvalidPreview] = useState<Record<string, string>[]>([]);
  const [total, setTotal] = useState(0);
  const [validos, setValidos] = useState(0);
  const [invalidos, setInvalidos] = useState(0);
  const [modoPrueba, setModoPrueba] = useState(true);
  const [smtpOk, setSmtpOk] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportUrl, setReportUrl] = useState('');
  const [stats, setStats] = useState<{ total: number; ok: number; prueba: number; errores: number } | null>(null);

  useEffect(() => {
    fetchToolsConfig().then(c => { setModoPrueba(c.modoPrueba); setSmtpOk(c.smtpConfigurado); }).catch(() => {});
  }, []);

  const reset = () => { setError(''); setInfo(''); setReportUrl(''); setStats(null); };

  const onFile = async (file: File | null) => {
    if (!file) return;
    reset(); setPreview([]); setInvalidPreview([]); setTotal(0); setValidos(0); setInvalidos(0);
    const text = await file.text();
    setCsv(text); setFilename(file.name);
    setBusy(true);
    try {
      const r = await uploadC365Csv(text);
      if (!r.ok) { setError(r.error || 'CSV inválido'); return; }
      setPreview(r.preview || []); setTotal(r.total || 0);
      setInfo(`${r.total} fila(s) detectadas. Generá la vista previa para validar emails.`);
    } finally { setBusy(false); }
  };

  const onPreview = async () => {
    if (!csv) { setError('Subí un CSV primero'); return; }
    reset(); setBusy(true);
    try {
      const r = await previewC365(csv);
      if (!r.ok) { setError(r.error || 'No se pudo procesar'); return; }
      setTotal(r.total || 0); setValidos(r.validos || 0); setInvalidos(r.invalidos || 0);
      setPreview(r.preview || []); setInvalidPreview(r.invalidPreview || []);
      setModoPrueba(Boolean(r.modoPrueba));
      setInfo(`Vista previa lista. ${r.validos} válidos · ${r.invalidos} inválidos.`);
    } finally { setBusy(false); }
  };

  const onSend = async () => {
    if (!csv) { setError('Subí un CSV primero'); return; }
    if (!modoPrueba) {
      const ok = window.confirm(`Vas a enviar credenciales reales a ${validos} destinatario(s). ${invalidos} se descartan por inválidos. ¿Confirmás el envío?`);
      if (!ok) return;
    }
    reset(); setBusy(true);
    try {
      const r = await sendC365(csv, !modoPrueba);
      if (!r.ok) { setError(r.error || 'Error al enviar'); return; }
      setStats(r.stats || null);
      if (r.reportUrl) setReportUrl(r.reportUrl);
      setInfo(r.modoPrueba ? 'MODO PRUEBA: no se enviaron correos reales. Reporte generado.' : 'Envío finalizado. Reporte disponible.');
    } finally { setBusy(false); }
  };

  return (
    <section className="card tool-card">
      <div className="card-head"><h3>Envío de credenciales 365</h3></div>
      <p className="muted">Subí un CSV con cuentas de Microsoft 365, validá los datos y enviá las credenciales por mail. Se genera un reporte CSV exportable.</p>

      <div className="tool-warning">
        <strong>Atención:</strong> revisá los destinatarios antes de enviar. {modoPrueba ? 'MODO_PRUEBA está activado: no se enviarán correos reales.' : (smtpOk ? 'MODO_PRUEBA está desactivado: el envío será real.' : 'SMTP sin configurar: completá las variables en .env antes de enviar.')}
      </div>

      <div className="tool-format">
        <strong>Formato CSV requerido:</strong>
        <code>{REQUIRED.join(',')}</code>
      </div>

      <div className="actions wrap-actions">
        <Button onClick={downloadC365Template}>Descargar plantilla CSV</Button>
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
          {filename ? `Cambiar archivo (${filename})` : 'Subir CSV'}
          <input type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0] || null)} />
        </label>
        <Button onClick={onPreview} disabled={!csv || busy}>Generar vista previa</Button>
        <Button variant="primary" onClick={onSend} disabled={!csv || busy || (!modoPrueba && !smtpOk)}>
          {modoPrueba ? 'Enviar (modo prueba)' : 'Enviar correos'}
        </Button>
        {reportUrl && <a className="btn btn-secondary" href={reportUrl} target="_blank" rel="noreferrer">Descargar reporte</a>}
      </div>

      {error && <div className="tool-error">{error}</div>}
      {info && <div className="tool-info">{info}</div>}

      {(total > 0) && (
        <div className="tool-counters">
          <div><span>Total</span><strong>{total}</strong></div>
          <div className="ok"><span>Válidos</span><strong>{validos}</strong></div>
          <div className="bad"><span>Inválidos</span><strong>{invalidos}</strong></div>
          {stats && <>
            <div className="ok"><span>Enviados OK</span><strong>{stats.ok}</strong></div>
            <div><span>Prueba</span><strong>{stats.prueba}</strong></div>
            <div className="bad"><span>Errores</span><strong>{stats.errores}</strong></div>
          </>}
        </div>
      )}

      {preview.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr>{REQUIRED.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {preview.map((row, idx) => (
                <tr key={idx}>{REQUIRED.map(c => <td key={c}>{c === 'Contraseña' ? '••••' : (row[c] || '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invalidPreview.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <h4 className="muted" style={{ padding: '8px 12px 0' }}>Filas inválidas</h4>
          <table>
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Mail</th><th>Motivo</th></tr></thead>
            <tbody>
              {invalidPreview.map((row, idx) => (
                <tr key={idx}>
                  <td>{row['Nombre para mostrar']}</td>
                  <td>{row['Nombre de usuario']}</td>
                  <td>{row.mail}</td>
                  <td>{row.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

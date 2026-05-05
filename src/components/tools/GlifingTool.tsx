import { useState } from 'react';
import { Button } from '../layout/Button';
import { downloadGlifingTemplate, downloadSantillanaTemplate, generateGlifing, uploadGlifingCsv } from '../../services/toolsApi';

const REQUIRED = ['Username', 'Nombre', 'Apellido', 'Grupo', 'Contraseña'];

type CardKind = 'glifing' | 'santillana';

export function GlifingTool() {
  const [kind, setKind] = useState<CardKind>('glifing');
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(''); setInfo(''); setPreview([]); setTotal(0);
    const text = await file.text();
    setCsv(text); setFilename(file.name);
    setBusy(true);
    try {
      const r = await uploadGlifingCsv(text);
      if (!r.ok) { setError(r.error || 'CSV inválido'); return; }
      setPreview(r.preview || []); setTotal(r.total || 0);
      setInfo(`${r.total} fila(s) detectadas correctamente.`);
    } finally { setBusy(false); }
  };

  const onGenerate = async () => {
    if (!csv) { setError('Subí un CSV primero'); return; }
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await generateGlifing(csv, kind);
      if (!r.ok) { setError(r.error || 'No se pudo generar'); return; }
      if (r.downloadUrl) {
        window.open(r.downloadUrl, '_blank');
        setInfo(`Tarjetas (${kind}) generadas para ${r.total} usuario(s). Descarga iniciada.`);
      }
    } finally { setBusy(false); }
  };

  const onDownloadTemplate = () => {
    if (kind === 'santillana') downloadSantillanaTemplate();
    else downloadGlifingTemplate();
  };

  return (
    <section className="card tool-card">
      <div className="card-head"><h3>Creador de tarjetas</h3></div>
      <p className="muted">Subí un CSV con los datos. Se valida el formato y se genera un HTML A4 listo para imprimir (aprox. 8 tarjetas por hoja).</p>

      <label style={{ display: 'block', marginTop: 8 }}>Tipo de tarjeta</label>
      <div className="tool-type-selector">
        <button type="button" className={kind === 'glifing' ? 'active' : ''} onClick={() => setKind('glifing')}>Glifing</button>
        <button type="button" className={kind === 'santillana' ? 'active' : ''} onClick={() => setKind('santillana')}>Santillana</button>
      </div>

      <div className="tool-format">
        <strong>Formato CSV requerido ({kind === 'santillana' ? 'Santillana' : 'Glifing'}):</strong>
        <code>{REQUIRED.join(',')}</code>
      </div>

      <div className="actions wrap-actions">
        <Button onClick={onDownloadTemplate}>Descargar plantilla CSV ({kind})</Button>
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
          {filename ? `Cambiar archivo (${filename})` : 'Subir CSV'}
          <input type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0] || null)} />
        </label>
        <Button variant="primary" onClick={onGenerate} disabled={!csv || busy}>Generar tarjetas {kind === 'santillana' ? 'Santillana' : 'Glifing'}</Button>
      </div>

      {error && <div className="tool-error">{error}</div>}
      {info && <div className="tool-info">{info}</div>}

      {preview.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr>{REQUIRED.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {preview.map((row, idx) => (
                <tr key={idx}>{REQUIRED.map(c => <td key={c}>{row[c] || ''}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {total > preview.length && <p className="muted" style={{ padding: 8 }}>Mostrando {preview.length} de {total} filas.</p>}
        </div>
      )}
    </section>
  );
}

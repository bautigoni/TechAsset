import { useMemo, useState } from 'react';
import { Download, ExternalLink, FileSpreadsheet, Printer } from 'lucide-react';
import { CompactEmpty } from './CompactEmpty';
import { Button, Collapse, FileDrop, Segmented, StatusText, Table, icons, type Column, type FileDropItem } from '../../ui';
import { TEMPLATE_URLS, generateGlifing, uploadGlifingCsv } from './toolsActions';
import { formatTimeOnly } from '../../utils/formatters';
import { canRetryCsv, errorText, readCsv, useExpired } from './useExpiry';
import { getActiveSiteCode } from '../../services/activeSite';
import { peekDraft, useKeepDraft } from '../../utils/drafts';

const REQUIRED = ['Username', 'Nombre', 'Apellido', 'Grupo', 'Contraseña'];
type CardKind = 'glifing' | 'santillana';
const KIND_NAME: Record<CardKind, string> = { glifing: 'Glifing', santillana: 'Santillana' };
type Row = Record<string, string>;
type Result = { url: string; kind: CardKind; total: number; expiresAt: string };
type GlifingDraft = { kind: CardKind; csv: string; preview: Row[]; total: number; result: Result | null; file: File | null };

/**
 * Tarjetas Glifing / Santillana: tipo → CSV (FileDrop, se valida al soltarlo)
 * → generar. El HTML se abre con un CLICK aparte ("Abrir para imprimir", un
 * <a target=_blank> común): así ningún bloqueador de pop-ups lo frena (antes
 * se abría con window.open después de un await y Safari lo bloqueaba). El
 * resultado se puede volver a abrir o bajar hasta que vence (30 min).
 */
export function GlifingTool({ readOnly }: { readOnly: boolean }) {
  // El CSV subido (y lo generado) sobrevive a salir de Herramientas por el menú y volver.
  const [draftKey] = useState(() => `${getActiveSiteCode() || 'sede'}:herramientas:tarjetas`);
  const [saved] = useState(() => peekDraft<GlifingDraft>(draftKey));
  const [kind, setKind] = useState<CardKind>(saved?.kind ?? 'glifing');
  const [csv, setCsv] = useState(saved?.csv ?? '');
  const [preview, setPreview] = useState<Row[]>(saved?.preview ?? []);
  const [total, setTotal] = useState(saved?.total ?? 0);
  const [file, setFile] = useState<File | null>(saved?.file ?? null);
  const [csvError, setCsvError] = useState('');
  const [genError, setGenError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(saved?.result ?? null);
  const [showPass, setShowPass] = useState(false);
  const expired = useExpired(result?.expiresAt);
  useKeepDraft<GlifingDraft>(draftKey, { kind, csv, preview, total, result, file }, Boolean(csv));
  const [restoredFile] = useState(() => (saved?.file ? [{ id: 'restaurado', file: saved.file, status: 'done' as const, progress: 1 }] : undefined));

  const reset = () => {
    setCsv(''); setPreview([]); setTotal(0); setFile(null); setCsvError(''); setGenError(''); setResult(null); setShowPass(false);
  };

  const upload = async (file: File) => {
    reset();
    const text = await readCsv(file);
    const response = await uploadGlifingCsv(text);
    if (!response.ok) {
      const message = response.error || 'El CSV no es válido.';
      setCsvError(message);
      throw new Error(message);
    }
    if (!response.total) {
      setCsvError('El CSV no tiene filas: solo el encabezado.');
      throw new Error('El CSV no tiene filas.');
    }
    setCsv(text);
    setFile(file);
    setTotal(response.total || 0);
    setPreview((response.preview || []).map((row, index) => ({ ...row, __i: String(index) })));
    return response;
  };

  const generate = async () => {
    if (!csv || busy || readOnly) return;
    setBusy(true);
    setGenError('');
    try {
      const response = await generateGlifing(csv, kind);
      if (!response.ok || !response.downloadUrl) { setGenError(response.error || 'No se pudieron generar las tarjetas.'); return; }
      setResult({ url: response.downloadUrl, kind, total: response.total || total, expiresAt: response.expiresAt || new Date(Date.now() + 30 * 60_000).toISOString() });
    } catch (reason) {
      setGenError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo<Column<Row>[]>(() => REQUIRED.map((key, index) => ({
    key,
    header: key,
    card: index === 0 ? 'title' : 'row',
    mono: key === 'Username' || key === 'Contraseña',
    width: key === 'Grupo' ? 'minmax(0, .6fr)' : undefined,
    cell: (row: Row) => (key === 'Contraseña' && !showPass ? '••••••' : row[key] || '—')
  })), [showPass]);

  const disabledReason = readOnly ? 'Deshabilitado en modo consulta o sin permiso.' : !csv ? 'Primero subí el CSV.' : '';

  return (
    <div className="tl-flow">
      <section className="tl-card tl-steps" aria-label="Pasos para generar tarjetas">
        <div className="tl-steps-row">
        <div className="tl-step">
          <span className="tl-step-n" aria-hidden="true">1</span>
          <div className="tl-step-b">
            <h2 className="tl-step-title">Tipo y CSV de alumnos</h2>
            <Segmented ariaLabel="Tipo de tarjeta" value={kind} onChange={next => { setKind(next); setGenError(''); }} options={[{ value: 'glifing', label: 'Glifing' }, { value: 'santillana', label: 'Santillana' }]} />
            <div className="tl-format">
              <span className="tl-format-label">Columnas obligatorias (iguales para los dos tipos)</span>
              <code className="tl-code">{REQUIRED.join(',​')}</code>
            </div>
            <FileDrop
              accept=".csv,text/csv"
              label="Subir el CSV de alumnos"
              title="Arrastrá el .csv acá o tocá para elegirlo"
              hint="Se valida apenas lo soltás"
              disabled={readOnly}
              pasteable={false}
              upload={upload}
              canRetry={canRetryCsv}
              onRemove={(_item: FileDropItem) => reset()}
              defaultItems={restoredFile}
            />
            <a className="tl-link" href={TEMPLATE_URLS[kind]} download>
              <Download size={14} strokeWidth={1.6} aria-hidden="true" />
              <span>Descargar plantilla {KIND_NAME[kind]}</span>
            </a>
          </div>
        </div>
        <div className="tl-step">
          <span className="tl-step-n" aria-hidden="true">2</span>
          <div className="tl-step-b">
            <h2 className="tl-step-title">Generar e imprimir</h2>
            <p className="tl-muted">Hoja A4 con 8 tarjetas (2 × 4), el fondo de la plantilla y borde punteado para recortar.</p>
            <div className="tl-actions">
              <Button variant="primary" icon={<Printer size={16} strokeWidth={1.6} />} loading={busy} loadingLabel="Generando…" disabled={!csv || readOnly} onClick={() => void generate()}>
                Generar tarjetas {KIND_NAME[kind]}
              </Button>
            </div>
            {disabledReason && !busy && <span className="tl-muted tl-small">{disabledReason}</span>}
            {genError && <p className="tl-error" role="alert"><icons.IconAlert size={14} /><span>{genError}</span></p>}
            <Collapse unmountOnClose open={Boolean(result)} role="region" aria-label="Tarjetas generadas">
              {result && (
                <div className="tl-result" role="status">
                  {expired ? (
                    <span className="tl-result-line"><StatusText tone="warn">El resultado venció.</StatusText> Generalas de nuevo para abrirlas.</span>
                  ) : (
                    <>
                      <span className="tl-result-line">
                        <span className="tl-ok-icon" aria-hidden="true"><icons.IconCheck size={14} /></span>
                        <span>Tarjetas {KIND_NAME[result.kind]} listas para <b className="g-num">{result.total}</b> {result.total === 1 ? 'alumno' : 'alumnos'}.</span>
                      </span>
                      <div className="tl-actions">
                        <a className="ui-btn ui-btn--secondary" href={result.url} target="_blank" rel="noopener">
                          <span className="ui-btn-icon"><ExternalLink size={16} strokeWidth={1.6} /></span>
                          <span className="ui-btn-label">Abrir para imprimir</span>
                        </a>
                        <a className="ui-btn ui-btn--ghost" href={`${result.url}?descargar=1`} download>
                          <span className="ui-btn-icon"><Download size={16} strokeWidth={1.6} /></span>
                          <span className="ui-btn-label">Bajar HTML</span>
                        </a>
                      </div>
                      <span className="tl-muted tl-small">Se abre con tu clic, así el navegador no la bloquea. Disponible hasta las <span className="g-num">{formatTimeOnly(result.expiresAt)}</span>.</span>
                    </>
                  )}
                </div>
              )}
            </Collapse>
          </div>
        </div>
        </div>
      </section>

      <div className="tl-out">
        {csvError && (
          <div className="tl-card tl-alert" role="alert">
            <span className="tl-alert-title"><icons.IconAlert size={14} />{csvError}</span>
            <span className="tl-muted">Revisá el encabezado del CSV o bajá la plantilla y pegá los datos ahí.</span>
          </div>
        )}
        {preview.length > 0 ? (
          <section className="tl-card tl-table-card" aria-label="Vista previa del CSV">
            <div className="tl-card-head">
              <h2 className="tl-card-title">Vista previa</h2>
              <span className="tl-card-sub">Mostrando <span className="g-num">{preview.length}</span> de <span className="g-num">{total}</span> {total === 1 ? 'fila' : 'filas'}</span>
              <Button size="sm" variant="ghost" aria-pressed={showPass} onClick={() => setShowPass(value => !value)}>{showPass ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}</Button>
            </div>
            <Table rows={preview} columns={columns} rowKey={row => row.__i} caption="Primeras filas del CSV de alumnos" cardBelow="md" />
            <p className="tl-foot tl-foot--in">Las tarjetas se generan con todas las filas, no solo con estas {preview.length}.</p>
          </section>
        ) : !csvError && (
          <CompactEmpty className="tl-card" icon={<FileSpreadsheet size={18} strokeWidth={1.6} />} title="Todavía no subiste el CSV" description="Cuando lo subas vas a ver acá las primeras 10 filas para revisarlas antes de generar." />
        )}
      </div>
    </div>
  );
}

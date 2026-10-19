import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Send } from 'lucide-react';
import { CompactEmpty } from './CompactEmpty';
import { Button, FileDrop, InlineConfirm, StatusText, Table, icons, type Column } from '../../ui';
import type { ToolsConfig } from '../../services/toolsApi';
import { TEMPLATE_URLS, previewC365, sendC365, uploadC365Csv } from './toolsActions';
import { formatTimeOnly } from '../../utils/formatters';
import { InlineCollapse } from '../common/InlineCollapse';
import { canRetryCsv, errorText, readCsv, useExpired } from './useExpiry';

const REQUIRED = ['Nombre para mostrar', 'Nombre de usuario', 'mail', 'Contraseña', 'Sede', 'Licencias'];
type Row = Record<string, string>;
type Validation = { total: number; validos: number; invalidos: number; preview: Row[]; invalid: Row[] };
type SendResult = { stats: { total: number; ok: number; prueba: number; errores: number }; reportUrl: string; expiresAt: string; modoPrueba: boolean };

const withIndex = (rows: Record<string, string>[] = []) => rows.map((row, index) => ({ ...row, __i: String(index) }));

/**
 * Credenciales 365: CSV → Validar (cuenta válidas/inválidas con motivo) →
 * Enviar. Enviar exige haber validado (antes la confirmación podía decir "0
 * destinatarios"). En envío REAL pide confirmación en línea; en modo prueba no.
 * El modo que vale es el guardado en la base (lo devuelve la validación, el
 * mismo que usa el envío). Después de un envío real el botón queda bloqueado
 * hasta subir otro CSV: un doble click no manda los mails dos veces.
 */
export function Credentials365Tool({ readOnly, canSend, config, onConfig, onOpenMailSettings }: {
  readOnly: boolean;
  canSend: boolean;
  config: ToolsConfig | null;
  onConfig: (next: ToolsConfig) => void;
  onOpenMailSettings?: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [uploadTotal, setUploadTotal] = useState(0);
  const [csvError, setCsvError] = useState('');
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SendResult | null>(null);
  const [sentReal, setSentReal] = useState(false);
  const expired = useExpired(result?.expiresAt);

  const modoPrueba = config?.modoPrueba ?? true;
  const providerOk = Boolean(config?.mailConfigurado ?? config?.smtpConfigurado);

  const reset = () => {
    setCsv(''); setUploadTotal(0); setCsvError(''); setValidation(null); setConfirming(false); setError(''); setResult(null); setSentReal(false);
  };

  const upload = async (file: File) => {
    reset();
    const text = await readCsv(file);
    const response = await uploadC365Csv(text);
    if (!response.ok) {
      const message = response.error || 'El CSV no es válido.';
      setCsvError(message);
      throw new Error(message);
    }
    setCsv(text);
    setUploadTotal(response.total || 0);
    return response;
  };

  const validate = async () => {
    if (!csv || validating || readOnly) return;
    setValidating(true);
    setError('');
    setConfirming(false);
    try {
      const response = await previewC365(csv);
      if (!response.ok) { setError(response.error || 'No se pudo validar el CSV.'); return; }
      setValidation({
        total: response.total || 0,
        validos: response.validos || 0,
        invalidos: response.invalidos || 0,
        preview: withIndex(response.preview),
        invalid: withIndex(response.invalidPreview)
      });
      if (config && typeof response.modoPrueba === 'boolean') onConfig({ ...config, modoPrueba: response.modoPrueba });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setValidating(false);
    }
  };

  const send = async () => {
    if (!csv || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await sendC365(csv, !modoPrueba);
      if (!response.ok) {
        // El modo cambió en la base desde que se validó: se pide confirmar de nuevo.
        if (response.requireConfirm && config) onConfig({ ...config, modoPrueba: false });
        setError(response.error || 'No se pudo enviar.');
        return;
      }
      setConfirming(false);
      setResult({
        stats: response.stats || { total: 0, ok: 0, prueba: 0, errores: 0 },
        reportUrl: response.reportUrl || '',
        expiresAt: response.expiresAt || new Date(Date.now() + 30 * 60_000).toISOString(),
        modoPrueba: Boolean(response.modoPrueba)
      });
      if (!response.modoPrueba) setSentReal(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSending(false);
    }
  };

  const blocked = !csv ? 'Primero subí el CSV.'
    : readOnly ? 'Deshabilitado en modo consulta o sin permiso.'
    : !canSend ? 'Solo un administrador de la sede (Jefe TIC) puede enviar credenciales.'
    : !validation ? 'Primero validá las filas.'
    : validation.validos === 0 ? 'No hay filas válidas para enviar.'
    : !modoPrueba && !providerOk ? 'No hay proveedor de mail configurado: no se puede hacer un envío real.'
    : sentReal ? 'Ya se envió este CSV. Para volver a enviar, subí el archivo de nuevo.'
    : '';

  const onAskSend = () => {
    if (blocked) return;
    if (modoPrueba) void send();
    else setConfirming(true);
  };

  const validColumns = useMemo<Column<Row>[]>(() => REQUIRED.map((key, index) => ({
    key,
    header: key === 'Nombre de usuario' ? 'Usuario' : key === 'mail' ? 'Mail' : key === 'Nombre para mostrar' ? 'Nombre' : key,
    card: index === 0 ? 'title' : 'row',
    mono: key === 'Contraseña',
    width: key === 'mail' ? 'minmax(0, 1.5fr)' : key === 'Sede' ? 'minmax(0, .5fr)' : undefined,
    cell: (row: Row) => (key === 'Contraseña' ? '••••••' : row[key] || '—')
  })), []);

  const invalidColumns = useMemo<Column<Row>[]>(() => [
    { key: 'n', header: 'Nombre', card: 'title', cell: row => row['Nombre para mostrar'] || '—' },
    { key: 'u', header: 'Usuario', cell: row => row['Nombre de usuario'] || '—' },
    { key: 'm', header: 'Mail', width: 'minmax(0, 1.4fr)', cell: row => row.mail || '—' },
    { key: 'why', header: 'Motivo', width: 'minmax(0, 1.2fr)', cell: row => <StatusText tone="bad">{row.motivo || 'Inválida'}</StatusText> }
  ], []);

  const previewRows = validation?.preview || [];

  return (
    <div className="tl-flow">
      <section className="tl-card tl-steps" aria-label="Pasos para enviar credenciales">
        <div className="tl-mode" role="status">
          {modoPrueba
            ? <><StatusText tone="normal" strong>Modo prueba: no sale ningún mail</StatusText><span className="tl-muted">Se genera el reporte como si se enviara. Para enviar de verdad, pasá a modo real en Configuración › Correo.</span></>
            : providerOk
              ? <><StatusText tone="warn" strong>Envío real: los mails salen de verdad</StatusText><span className="tl-muted">Revisá los destinatarios antes de enviar. Para probar sin mandar nada, pasá a modo prueba en Configuración › Correo.</span></>
              : <><StatusText tone="bad" strong>Mail sin configurar</StatusText><span className="tl-muted">Configurá Resend o SMTP antes de enviar.</span></>}
          {onOpenMailSettings && <Button size="sm" variant="ghost" onClick={onOpenMailSettings}>Abrir Configuración › Correo</Button>}
        </div>
        <div className="tl-steps-row">
        <div className="tl-step">
          <span className="tl-step-n" aria-hidden="true">1</span>
          <div className="tl-step-b">
            <h2 className="tl-step-title">CSV de cuentas</h2>
            <div className="tl-format">
              <span className="tl-format-label">Columnas obligatorias</span>
              <code className="tl-code">{REQUIRED.join(',​')}</code>
            </div>
            <FileDrop
              accept=".csv,text/csv"
              label="Subir el CSV de cuentas"
              title="Arrastrá el .csv acá o tocá para elegirlo"
              hint="Se revisan las columnas apenas lo soltás"
              disabled={readOnly}
              pasteable={false}
              upload={upload}
              canRetry={canRetryCsv}
              onRemove={() => reset()}
            />
            {csv && <span className="tl-muted tl-small"><b className="g-num">{uploadTotal}</b> {uploadTotal === 1 ? 'fila detectada' : 'filas detectadas'}.</span>}
            {csvError && <p className="tl-error" role="alert"><icons.IconAlert size={14} /><span>{csvError}</span></p>}
            <a className="tl-link" href={TEMPLATE_URLS.credentials365} download>
              <Download size={14} strokeWidth={1.6} aria-hidden="true" />
              <span>Descargar plantilla (credenciales 365)</span>
            </a>
          </div>
        </div>
        <div className="tl-step">
          <span className="tl-step-n" aria-hidden="true">2</span>
          <div className="tl-step-b">
            <h2 className="tl-step-title">Validar y enviar</h2>
            <div className="tl-actions">
              <Button variant="secondary" loading={validating} loadingLabel="Validando…" disabled={!csv || readOnly} onClick={() => void validate()}>
                {validation ? 'Validar de nuevo' : 'Validar filas'}
              </Button>
            </div>
            {validation && (
              <dl className="tl-counters">
                <div><dt>Total</dt><dd className="g-num">{validation.total}</dd></div>
                <div><dt>Válidas</dt><dd className="g-num">{validation.validos}</dd></div>
                <div><dt>Inválidas</dt><dd className={`g-num${validation.invalidos ? ' is-bad' : ''}`}>{validation.invalidos}</dd></div>
              </dl>
            )}
            <div className="tl-actions tl-send">
              <Button
                variant="primary"
                icon={<Send size={16} strokeWidth={1.6} />}
                loading={sending && !confirming}
                loadingLabel="Enviando…"
                disabled={Boolean(blocked) || confirming}
                aria-expanded={!modoPrueba ? confirming : undefined}
                onClick={onAskSend}
              >
                {modoPrueba ? 'Enviar (modo prueba)' : 'Enviar correos'}
              </Button>
            </div>
            {blocked && <span className="tl-muted tl-small">{blocked}</span>}
            <InlineCollapse open={confirming && Boolean(validation)}>
              {validation && (
                <InlineConfirm
                  danger
                  message="Enviar credenciales reales"
                  detail={`Vas a mandar usuario y contraseña por mail a ${validation.validos} ${validation.validos === 1 ? 'destinatario' : 'destinatarios'}.${validation.invalidos ? ` ${validation.invalidos} ${validation.invalidos === 1 ? 'fila se descarta' : 'filas se descartan'} por inválidas.` : ''}`}
                  confirmLabel={`Enviar a ${validation.validos}`}
                  busy={sending}
                  onConfirm={() => void send()}
                  onCancel={() => setConfirming(false)}
                />
              )}
            </InlineCollapse>
            {error && <p className="tl-error" role="alert"><icons.IconAlert size={14} /><span>{error}</span></p>}
            <InlineCollapse open={Boolean(result)} label="Resultado del envío">
              {result && (
                <div className="tl-result" role="status">
                  <span className="tl-result-line">
                    <span className="tl-ok-icon" aria-hidden="true"><icons.IconCheck size={14} /></span>
                    <span>{result.modoPrueba ? 'Modo prueba: no se envió ningún correo. Reporte generado.' : 'Envío terminado.'}</span>
                  </span>
                  <dl className="tl-counters">
                    <div><dt>Enviados</dt><dd className="g-num">{result.stats.ok}</dd></div>
                    <div><dt>Prueba</dt><dd className="g-num">{result.stats.prueba}</dd></div>
                    <div><dt>Errores</dt><dd className={`g-num${result.stats.errores ? ' is-bad' : ''}`}>{result.stats.errores}</dd></div>
                  </dl>
                  {expired || !result.reportUrl
                    ? <span className="tl-muted tl-small">El reporte venció.</span>
                    : (
                      <>
                        <a className="tl-link" href={result.reportUrl} download>
                          <Download size={14} strokeWidth={1.6} aria-hidden="true" />
                          <span>Descargar reporte CSV</span>
                        </a>
                        <span className="tl-muted tl-small">Mail, usuario, nombre, estado (OK / PRUEBA / ERROR) y detalle. Disponible hasta las <span className="g-num">{formatTimeOnly(result.expiresAt)}</span>.</span>
                      </>
                    )}
                </div>
              )}
            </InlineCollapse>
          </div>
        </div>
        </div>
      </section>

      <div className="tl-out">
        {previewRows.length > 0 ? (
          <section className="tl-card tl-table-card" aria-label="Primeras filas">
            <div className="tl-card-head">
              <h2 className="tl-card-title">Primeras filas</h2>
              <span className="tl-card-sub"><span className="g-num">{previewRows.length}</span> de <span className="g-num">{validation?.total || 0}</span> · contraseña oculta</span>
            </div>
            <Table rows={previewRows} columns={validColumns} rowKey={row => row.__i} caption="Primeras filas del CSV de cuentas" cardBelow="lg" />
          </section>
        ) : (
          <CompactEmpty
            className="tl-card"
            icon={<FileSpreadsheet size={18} strokeWidth={1.6} />}
            title={csv ? 'Validá las filas para revisarlas' : 'Todavía no subiste el CSV'}
            description={csv ? 'Vas a ver acá las primeras filas y, aparte, las inválidas con su motivo.' : 'Subilo y validalo: acá vas a ver las filas antes de enviar.'}
          />
        )}
        {validation && validation.invalid.length > 0 && (
          <section className="tl-card tl-table-card" aria-label="Filas inválidas">
            <div className="tl-card-head">
              <h2 className="tl-card-title">Filas inválidas</h2>
              <span className="tl-card-sub">No se envían · corregilas en el CSV y volvé a subirlo{validation.invalidos > validation.invalid.length ? ` · primeras ${validation.invalid.length} de ${validation.invalidos}` : ''}</span>
            </div>
            <Table rows={validation.invalid} columns={invalidColumns} rowKey={row => row.__i} caption="Filas inválidas con su motivo" cardBelow="md" />
          </section>
        )}
      </div>
    </div>
  );
}

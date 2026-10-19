import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, SkeletonRows, Textarea } from '../../ui';
import { TruncatedText } from '../../ui/Truncated';
import { cx } from '../../ui/util';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { getDevicesDiagnostics } from '../../services/devicesApi';
import { formatDate, SHORT_DATE_TIME } from '../../utils/formatters';
import { Card, CardBody, CardFoot, Collapse, Notice, errorText, useDirty } from './settingsKit';

type Diag = Record<string, unknown>;

const STRING_LISTS = new Set(['modules.enabled', 'modules.order', 'loan.roles', 'loan.gradeOptions', 'devices.categories', 'shift.options']);
const OPTION_LISTS = new Set(['loan.locations', 'loan.motives']);

/** Mismas reglas que el server (validateSiteSetting): el error se ve antes de mandar. */
export function validateSetting(key: string, value: unknown): string {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) return 'La clave solo puede tener letras, números, punto, guion y guion bajo.';
  if (STRING_LISTS.has(key)) return Array.isArray(value) && value.every(item => typeof item === 'string') ? '' : 'Tiene que ser una lista de textos: ["a", "b"].';
  if (OPTION_LISTS.has(key)) {
    if (!Array.isArray(value)) return 'Tiene que ser una lista.';
    const ok = value.every(item => typeof item === 'string' || (item && typeof item === 'object' && typeof ((item as { label?: unknown }).label ?? (item as { nombre?: unknown }).nombre) === 'string'));
    return ok ? '' : 'Cada opción tiene que ser un texto o {"label": "..."}.';
  }
  if (key === 'roles.config') {
    if (!Array.isArray(value) || !value.length) return 'Tiene que ser una lista con al menos un rol.';
    for (const raw of value) {
      const role = raw as { name?: unknown; admin?: unknown; view?: unknown; edit?: unknown };
      if (!role || typeof role !== 'object' || typeof role.name !== 'string' || !role.name.trim()) return 'Cada rol necesita un "name".';
      if (role.admin !== undefined && typeof role.admin !== 'boolean') return `"admin" de ${role.name} tiene que ser true o false.`;
      for (const field of ['view', 'edit'] as const) {
        const list = role[field];
        if (list !== undefined && (!Array.isArray(list) || list.some(item => typeof item !== 'string'))) return `"${field}" de ${role.name} tiene que ser una lista de módulos.`;
      }
    }
    if (!value.some(role => (role as { admin?: unknown }).admin === true)) return 'Tiene que quedar al menos un rol administrador.';
    return '';
  }
  if (key === 'shift.morningOperator' || key === 'shift.afternoonOperator') return typeof value === 'string' ? '' : 'Tiene que ser un texto entre comillas.';
  return '';
}

function preview(value: unknown) {
  const text = JSON.stringify(value);
  return text === undefined ? 'null' : text;
}

function diagValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') {
    if (key === 'lastImportAt') return 'Sin importación registrada';
    if (key === 'lastError') return 'Ninguno';
    return '—';
  }
  if (key === 'lastImportAt' && typeof value === 'string') return formatDate(value, SHORT_DATE_TIME, value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Avanzado: diagnóstico del inventario y la configuración de la sede clave por
 * clave, cada una con su editor que valida antes de guardar (sin el textarea
 * gigante con todo junto). El botón "Backup SQLite" que no hacía nada se fue.
 */
export function AdvancedPanel({ header, readOnly, onChanged }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string; onChanged?: () => void }) {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagError, setDiagError] = useState('');
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');
  const [results, setResults] = useState<Record<string, { tone: 'ok' | 'bad'; text: string }>>({});
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newText, setNewText] = useState('');

  const runDiag = async () => {
    setDiagBusy(true);
    setDiagError('');
    try {
      const response = await getDevicesDiagnostics();
      setDiag(response.diagnostics);
    } catch (reason) {
      setDiagError(errorText(reason, 'No se pudo cargar el diagnóstico.'));
    } finally {
      setDiagBusy(false);
    }
  };
  const loadSettings = () => {
    setLoadError('');
    getSiteSettings().then(response => setSettings(response.settings || {})).catch(reason => setLoadError(errorText(reason, 'No se pudo cargar la configuración de la sede.')));
  };
  useEffect(() => { void runDiag(); loadSettings(); }, []);

  const keys = useMemo(() => Object.keys(settings || {}).sort(), [settings]);
  const dirtyKeys = keys.filter(key => texts[key] !== undefined && texts[key] !== JSON.stringify(settings?.[key], null, 2));
  useDirty('avanzado', dirtyKeys.length > 0 || (adding && Boolean(newKey || newText)));

  const parse = (key: string, text: string): { value?: unknown; error: string } => {
    let value: unknown;
    try { value = JSON.parse(text); } catch (reason) { return { error: `JSON inválido: ${reason instanceof Error ? reason.message : 'revisá comillas y comas.'}` }; }
    const problem = validateSetting(key, value);
    return problem ? { error: problem } : { value, error: '' };
  };

  const toggle = (key: string) => {
    if (open === key) { setOpen(''); return; }
    setOpen(key);
    setTexts(current => (current[key] !== undefined ? current : { ...current, [key]: JSON.stringify(settings?.[key], null, 2) }));
  };

  const saveKey = async (key: string, text: string, isNew = false) => {
    const parsed = parse(key, text);
    if (parsed.error) return;
    setSaving(key);
    try {
      const response = await updateSiteSettings({ [key]: parsed.value });
      setSettings(response.settings || {});
      setTexts(current => ({ ...current, [key]: JSON.stringify(response.settings?.[key], null, 2) }));
      setResults(current => ({ ...current, [key]: { tone: 'ok', text: `${key} guardada.` } }));
      if (isNew) { setAdding(false); setNewKey(''); setNewText(''); setOpen(key); }
      onChanged?.();
    } catch (reason) {
      setResults(current => ({ ...current, [key]: { tone: 'bad', text: errorText(reason, 'No se pudo guardar la clave.') } }));
    } finally {
      setSaving('');
    }
  };

  const newProblem = newKey ? (keys.includes(newKey.trim()) ? 'Esa clave ya existe: editala en la lista.' : newText ? parse(newKey.trim(), newText).error : '') : '';

  return (
    <>
      {header()}
      <Card title="Diagnóstico de inventario" actions={<Button size="sm" variant="secondary" icon={<RefreshCw size={14} aria-hidden="true" />} loading={diagBusy} loadingLabel="Corriendo…" onClick={() => void runDiag()}>Correr de nuevo</Button>}>
        <CardBody>
          {diagError && <ErrorState message={diagError} onRetry={() => void runDiag()} retrying={diagBusy} />}
          {!diag && !diagError && <SkeletonRows rows={2} />}
          {diag && (
            <dl className="cfg-diag">
              <div><dt>Fuente</dt><dd className="cfg-mono">{diagValue('source', diag.source)}</dd></div>
              <div><dt>Sede</dt><dd className="cfg-mono">{diagValue('siteCode', diag.siteCode)}</dd></div>
              <div><dt>Equipos</dt><dd className="cfg-mono">{diagValue('deviceCount', diag.deviceCount)}</dd></div>
              <div><dt>Última importación</dt><dd className="cfg-mono">{diagValue('lastImportAt', diag.lastImportAt)}</dd></div>
              <div><dt>Último error</dt><dd className={cx(diag.lastError ? 'is-bad' : 'cfg-t2')}>{diagValue('lastError', diag.lastError)}</dd></div>
              <div><dt>Base</dt><dd className="cfg-t2">Postgres en producción · SQLite en local. La base es la fuente de verdad; las planillas solo se importan a mano.</dd></div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card
        title="Configuración de la sede, clave por clave"
        meta={settings ? <span className="cfg-mono">{keys.length} claves</span> : undefined}
        actions={<Button size="sm" variant="ghost" disabled={readOnly || !settings} aria-expanded={adding} onClick={() => setAdding(value => !value)}>Agregar clave</Button>}
      >
        <Notice tone="warn"><span><span className="is-warn cfg-strong">Edición cruda.</span> Un valor mal escrito en roles o módulos puede dejar a alguien sin acceso. Usá las otras secciones siempre que puedas.</span></Notice>
        <Collapse open={adding}>
          <div className="cfg-uform" data-scanner-ignore="">
            <Input label="Clave nueva" className="cfg-mono-input" value={newKey} placeholder="ej. quickLinks" autoComplete="off" onValueChange={setNewKey} />
            <Textarea label="Valor (JSON)" className="cfg-json" minRows={3} spellCheck={false} value={newText} placeholder='["valor"]' error={newProblem || undefined} onValueChange={setNewText} />
            <div className="cfg-uform-f">
              <Button variant="primary" loading={saving === newKey.trim() && Boolean(newKey)} disabled={readOnly || !newKey.trim() || !newText.trim() || Boolean(newProblem)} onClick={() => void saveKey(newKey.trim(), newText, true)}>Guardar clave</Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setNewKey(''); setNewText(''); }}>Cancelar</Button>
            </div>
            {results[newKey.trim()]?.tone === 'bad' && <p className="cfg-error" role="alert">{results[newKey.trim()].text}</p>}
          </div>
        </Collapse>
        {loadError && <div className="cfg-pad"><ErrorState message={loadError} onRetry={loadSettings} /></div>}
        {!settings && !loadError && <div className="cfg-pad"><SkeletonRows rows={6} /></div>}
        {settings && !keys.length && <div className="cfg-pad"><EmptyState compact title="Esta sede no tiene claves guardadas." description="Se crean solas al guardar en las otras secciones." /></div>}
        {keys.length > 0 && <div className="cfg-table cfg-tk" role="list" aria-label="Claves de la sede">
        {keys.map(key => {
          const isOpen = open === key;
          const text = texts[key] ?? '';
          const parsed = isOpen ? parse(key, text) : { error: '' };
          const changed = texts[key] !== undefined && text !== JSON.stringify(settings?.[key], null, 2);
          const result = results[key];
          return (
            <div className="cfg-tgroup" role="listitem" key={key}>
              <div className="cfg-trow">
                <span className="cfg-mono cfg-wrap cfg-strong">{key}</span>
                <TruncatedText className="cfg-mono cfg-t3">{preview(settings?.[key])}</TruncatedText>
                <span className="cfg-cell-end">
                  <Button size="sm" variant="ghost" aria-expanded={isOpen} onClick={() => toggle(key)}>{isOpen ? 'Cerrar' : changed ? 'Editar · sin guardar' : 'Editar'}</Button>
                </span>
              </div>
              <Collapse open={isOpen}>
                <div className="cfg-uform" data-scanner-ignore="">
                  <Textarea
                    label={`Valor de ${key} (JSON)`}
                    className="cfg-json"
                    minRows={3}
                    spellCheck={false}
                    value={text}
                    disabled={readOnly}
                    error={parsed.error || undefined}
                    success={!parsed.error && changed ? 'JSON válido. Se guarda solo esta clave.' : undefined}
                    onValueChange={value => { setTexts(current => ({ ...current, [key]: value })); setResults(current => { const next = { ...current }; delete next[key]; return next; }); }}
                  />
                  <div className="cfg-uform-f">
                    <Button variant="primary" loading={saving === key} loadingLabel="Guardando…" disabled={readOnly || !changed || Boolean(parsed.error)} onClick={() => void saveKey(key, text)}>Guardar clave</Button>
                    <Button variant="ghost" disabled={!changed || saving === key} onClick={() => setTexts(current => ({ ...current, [key]: JSON.stringify(settings?.[key], null, 2) }))}>Descartar</Button>
                    {result && <span className={cx('cfg-inline', result.tone === 'bad' ? 'is-bad' : 'cfg-t2')} role={result.tone === 'bad' ? 'alert' : 'status'}>{result.text}</span>}
                  </div>
                </div>
              </Collapse>
            </div>
          );
        })}
        </div>}
        <CardFoot status={readOnly ? 'Modo consulta: se ve, no se edita.' : 'Cada clave se guarda por separado y se valida antes de mandarla.'} tone="muted" />
      </Card>
    </>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, ErrorState, Input, SkeletonRows, TagInput } from '../../ui';
import { fold } from '../../ui/util';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { Card, CardBody, CardFoot, Notice, dropDraft, errorText, peekDraft, useDirty, useKeepDraft } from './settingsKit';

type Option = { uid: string; label: string; requiresDetail?: boolean; requiresCourse?: boolean };
type Draft = { roles: string[]; locations: Option[]; motives: Option[]; extraGrades: string[]; categories: string[] };
type Status = { tone: 'ok' | 'bad'; text: string } | null;

// Cursos base: están siempre (al leer se mezclan con lo configurado, como antes).
const BASE_GRADES = ['1N', '1F', '1S', '2N', '2F', '2S', '3N', '3F', '3S', '4N', '4F', '4S', '5N', '5F', '5S', '6N', '6F', '6S'];
const DEFAULTS = {
  roles: ['DOE', 'Alumno', 'Maestra', 'Profesor', 'Directivo', 'Preceptor', 'Otro'],
  locations: [
    { label: 'Aula', requiresCourse: true },
    { label: 'DOE' },
    { label: 'Planificación móvil' },
    { label: 'Dirección / Coordinación' },
    { label: 'Departamento' },
    { label: 'Otro', requiresDetail: true }
  ],
  motives: [
    { label: 'Planificación' },
    { label: 'Préstamo autorizado' },
    { label: 'Proyecto / actividad de aula' },
    { label: 'Evaluación' },
    { label: 'Soporte temporal' },
    { label: 'Otro', requiresDetail: true }
  ],
  categories: ['Tablet', 'Notebook', 'Chromebook', 'Camara', 'Proyector', 'Router', 'Impresora', 'Otro']
};

let seq = 0;
const uid = () => `o${Date.now().toString(36)}${(seq += 1)}`;

function readStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(item => (typeof item === 'string' ? item : String((item as { label?: string; nombre?: string })?.label || (item as { nombre?: string })?.nombre || ''))).map(item => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function readOptions(value: unknown, fallback: Array<Omit<Option, 'uid'>>): Option[] {
  const source = Array.isArray(value) ? value : fallback;
  const items = source.map(item => {
    if (typeof item === 'string') return { uid: uid(), label: item.trim() };
    const option = item as { label?: string; nombre?: string; requiresDetail?: boolean; requiresCourse?: boolean };
    return { uid: uid(), label: String(option.label || option.nombre || '').trim(), requiresDetail: Boolean(option.requiresDetail), requiresCourse: Boolean(option.requiresCourse) };
  }).filter(item => item.label);
  return items.length ? items : fallback.map(item => ({ ...item, uid: uid() }));
}

function extraGrades(value: unknown) {
  const base = new Set(BASE_GRADES.map(grade => grade.toLowerCase()));
  const seen = new Set<string>();
  return readStringList(value, []).filter(item => {
    const key = item.toLowerCase();
    if (key === 'ep' || key === 'es' || base.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const cleanOptions = (items: Option[], course: boolean) => items
  .map(item => ({ label: item.label.trim(), ...(item.requiresDetail ? { requiresDetail: true } : {}), ...(course && item.requiresCourse ? { requiresCourse: true } : {}) }))
  .filter(item => item.label);

const toSettings = (draft: Draft) => ({
  'loan.roles': draft.roles,
  'loan.locations': cleanOptions(draft.locations, true),
  'loan.motives': cleanOptions(draft.motives, false),
  'loan.gradeOptions': [...BASE_GRADES, ...draft.extraGrades],
  'devices.categories': draft.categories
});
const signature = (draft: Draft | null) => JSON.stringify(draft ? toSettings(draft) : null);

/**
 * Opciones de préstamo: roles de quien pide, ubicaciones (piden detalle y/o
 * curso), motivos (piden detalle), cursos y categorías de dispositivos. Se
 * guardan las cinco juntas. Las filas tienen key estable (el bug viejo de
 * perder el foco en cada tecla no vuelve).
 */
export function LoanOptionsPanel({ header, readOnly, siteCode }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string }) {
  const draftKey = `${siteCode}:prestamo`;
  const [restored, setRestored] = useState(() => peekDraft<Draft>(draftKey));
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(() => restored);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [newLocation, setNewLocation] = useState('');
  const [newMotive, setNewMotive] = useState('');
  const [addError, setAddError] = useState<{ which: 'loc' | 'mot'; text: string } | null>(null);

  const load = () => {
    setLoadError('');
    getSiteSettings()
      .then(response => {
        const settings = response.settings || {};
        const fresh: Draft = {
          roles: readStringList(settings['loan.roles'], DEFAULTS.roles),
          locations: readOptions(settings['loan.locations'], DEFAULTS.locations),
          motives: readOptions(settings['loan.motives'], DEFAULTS.motives),
          extraGrades: extraGrades(settings['loan.gradeOptions']),
          categories: readStringList(settings['devices.categories'], DEFAULTS.categories)
        };
        setSaved(fresh);
        setDraft(current => current || fresh);
      })
      .catch(reason => setLoadError(errorText(reason, 'No se pudo cargar la configuración de préstamos.')));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const changed = Boolean(saved && draft) && signature(saved) !== signature(draft);
  useDirty('prestamo', changed);
  useKeepDraft(draftKey, draft, changed);

  const edit = (fn: (current: Draft) => Draft) => {
    if (readOnly) return;
    setDraft(current => (current ? fn(current) : current));
    setStatus(null);
  };
  const patchOption = (list: 'locations' | 'motives', id: string, change: Partial<Option>) => edit(current => ({ ...current, [list]: current[list].map(item => (item.uid === id ? { ...item, ...change } : item)) }));
  const removeOption = (list: 'locations' | 'motives', id: string) => edit(current => ({ ...current, [list]: current[list].filter(item => item.uid !== id) }));
  const addOption = (list: 'locations' | 'motives') => {
    const value = (list === 'locations' ? newLocation : newMotive).trim();
    const which = list === 'locations' ? 'loc' : 'mot';
    if (!value || !draft) return;
    if (draft[list].some(item => fold(item.label) === fold(value))) { setAddError({ which, text: `"${value}" ya está en la lista.` }); return; }
    edit(current => ({ ...current, [list]: [...current[list], { uid: uid(), label: value }] }));
    if (list === 'locations') setNewLocation(''); else setNewMotive('');
    setAddError(null);
  };

  const problem = draft && (draft.locations.some(item => !item.label.trim()) || draft.motives.some(item => !item.label.trim()))
    ? 'Hay una opción sin nombre: escribile uno o quitala.' : '';

  const save = async () => {
    if (!draft || problem) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateSiteSettings(toSettings(draft));
      setSaved(draft);
      setRestored(null);
      dropDraft(draftKey);
      setStatus({ tone: 'ok', text: 'Opciones de préstamo guardadas. Ya aparecen al prestar.' });
    } catch (reason) {
      setStatus({ tone: 'bad', text: errorText(reason, 'No se pudieron guardar las opciones de préstamo.') });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    if (saved) setDraft(saved);
    setRestored(null);
    dropDraft(draftKey);
    setStatus(null);
  };

  if (loadError && !saved) return <>{header()}<ErrorState message={loadError} onRetry={load} /></>;
  if (!draft) return <>{header()}<div className="cfg-card cfg-pad"><SkeletonRows rows={6} /></div></>;

  const optionTable = (list: 'locations' | 'motives') => {
    const course = list === 'locations';
    const noun = course ? 'ubicación' : 'motivo';
    const value = course ? newLocation : newMotive;
    const which = course ? 'loc' : 'mot';
    return (
      <>
        <div className={`cfg-table ${course ? 'cfg-tl' : 'cfg-tm'}`} role="table" aria-label={course ? 'Ubicaciones' : 'Motivos'}>
          <div className="cfg-trow is-head" role="row">
            <span role="columnheader">Nombre</span>
            <span role="columnheader">Pide detalle</span>
            {course && <span role="columnheader">Pide curso</span>}
            <span role="columnheader" className="ui-sr">Acciones</span>
          </div>
          {draft[list].map(item => (
            <div className="cfg-trow" role="row" key={item.uid}>
              <span role="cell"><Input size="sm" aria-label={course ? 'Nombre de la ubicación' : 'Nombre del motivo'} value={item.label} disabled={readOnly} error={!item.label.trim()} onValueChange={next => patchOption(list, item.uid, { label: next })} /></span>
              <span role="cell"><Checkbox checked={Boolean(item.requiresDetail)} disabled={readOnly} label="Detalle" onCheckedChange={next => patchOption(list, item.uid, { requiresDetail: next })} /></span>
              {course && <span role="cell"><Checkbox checked={Boolean(item.requiresCourse)} disabled={readOnly} label="Curso" onCheckedChange={next => patchOption(list, item.uid, { requiresCourse: next })} /></span>}
              <span role="cell" className="cfg-cell-end"><Button size="sm" variant="ghost" disabled={readOnly} aria-label={`Quitar ${item.label || noun}`} onClick={() => removeOption(list, item.uid)}>Quitar</Button></span>
            </div>
          ))}
        </div>
        <div className="cfg-add" data-scanner-ignore="">
          <Input
            size="sm"
            aria-label={course ? 'Nueva ubicación' : 'Nuevo motivo'}
            placeholder={`Agregar ${noun} y Enter`}
            value={value}
            disabled={readOnly}
            error={addError?.which === which ? addError.text : undefined}
            onValueChange={next => { if (course) setNewLocation(next); else setNewMotive(next); setAddError(null); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addOption(list); } }}
          />
          <Button size="sm" variant="secondary" disabled={readOnly || !value.trim()} onClick={() => addOption(list)}>Agregar</Button>
        </div>
      </>
    );
  };

  return (
    <>
      {header()}
      {restored && changed && <Notice tone="warn">Recuperamos cambios que no habías guardado.</Notice>}
      <div className="cfg-cols">
        <Card title="Quién pide" meta={<span className="cfg-mono">{draft.roles.length}</span>}>
          <CardBody>
            <TagInput ariaLabel="Roles de préstamo" value={draft.roles} disabled={readOnly} placeholder="Agregar rol y Enter" onChange={roles => edit(current => ({ ...current, roles }))} />
          </CardBody>
        </Card>
        <Card title="Categorías de dispositivos" meta={<span className="cfg-mono">{draft.categories.length}</span>}>
          <CardBody>
            <TagInput ariaLabel="Categorías de dispositivos" value={draft.categories} disabled={readOnly} placeholder="Agregar categoría y Enter" onChange={categories => edit(current => ({ ...current, categories }))} />
          </CardBody>
        </Card>
      </div>
      <Card title="Ubicaciones" meta="Qué se pide al elegir cada una">
        {optionTable('locations')}
      </Card>
      <Card title="Motivos" meta={<span className="cfg-mono">{draft.motives.length}</span>}>
        {optionTable('motives')}
      </Card>
      <Card title="Cursos y grados" meta={<span className="cfg-mono">{BASE_GRADES.length + draft.extraGrades.length}</span>}>
        <CardBody>
          <div className="cfg-chips" aria-label="Cursos base">
            {BASE_GRADES.map(grade => <span key={grade} className="cfg-chip cfg-mono">{grade}</span>)}
          </div>
          <TagInput label="Otros cursos" value={draft.extraGrades} disabled={readOnly} placeholder="Agregar curso y Enter" transform={value => value.toUpperCase()} onChange={grades => edit(current => ({ ...current, extraGrades: grades.filter(grade => !BASE_GRADES.includes(grade.toUpperCase())) }))} />
          <p className="cfg-hint">Los cursos base (1N a 6S) están siempre. Los que sumes acá se pueden quitar.</p>
        </CardBody>
      </Card>
      <div className="cfg-savebar">
        <CardFoot
          status={problem || status?.text || (readOnly ? 'Modo consulta: se ve, no se edita.' : changed ? 'Hay cambios sin guardar en las opciones de préstamo.' : 'Estas listas son las que aparecen al prestar. Se guardan las cinco juntas.')}
          tone={problem ? 'bad' : status ? status.tone : changed ? 'warn' : 'muted'}
        >
          {changed && <Button variant="ghost" disabled={saving} onClick={discard}>Descartar</Button>}
          <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={readOnly || !changed || Boolean(problem)} onClick={() => void save()}>Guardar opciones</Button>
        </CardFoot>
      </div>
    </>
  );
}

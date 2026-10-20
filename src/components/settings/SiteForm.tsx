import { useState } from 'react';
import type { SiteInfo } from '../../types';
import { Button, ColorField, FileDrop, Input } from '../../ui';
import { cx } from '../../ui/util';
import { saveSite } from '../../services/authApi';
import { TenantLogo } from '../layout/TenantLogo';
import { CheckField, Reveal, errorText, useDirty } from './settingsKit';

type Draft = {
  siteCode: string;
  nombre: string;
  subtitulo: string;
  themeColor: string;
  spreadsheetUrl: string;
  inventorySheetName: string;
  logo: string;
  logoDataUrl: string;
  activo: boolean;
};

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function toDraft(site?: Partial<SiteInfo> | null): Draft {
  return {
    siteCode: site?.siteCode || '',
    nombre: site?.nombre && site.nombre !== site.siteCode ? site.nombre : site?.nombre || '',
    subtitulo: site?.subtitulo || '',
    themeColor: site?.themeColor || '',
    spreadsheetUrl: site?.spreadsheetUrl || '',
    inventorySheetName: site?.inventorySheetName || '',
    logo: site?.logo || '',
    logoDataUrl: '',
    activo: site?.activo !== false
  };
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el logo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Datos de una sede (crear o editar): logo con arrastrar y soltar (PNG, JPG o
 * WEBP hasta 2 MB), marca TA, código (mayúsculas, fijo al editar), nombre,
 * subtítulo, color propio (paleta + hex, sin input nativo), URL del CSV para
 * importar a mano, hoja de inventario y activa. Crear con un código que ya
 * existe devuelve 409 y el mensaje se muestra acá, sin pisar nada.
 */
export function SiteForm({ site, mode, superadmin, readOnly, onSaved, onCancel, dirtyKey }: {
  site?: Partial<SiteInfo> | null;
  mode: 'create' | 'edit';
  superadmin: boolean;
  readOnly: boolean;
  onSaved: (site: SiteInfo) => void | Promise<void>;
  onCancel?: () => void;
  /** Clave de "cambios sin guardar" del panel que lo contiene. */
  dirtyKey: string;
}) {
  const [initial, setInitial] = useState(() => toDraft(site));
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [ok, setOk] = useState('');
  const [logoProblem, setLogoProblem] = useState('');
  const [dropKey, setDropKey] = useState(0);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  useDirty(dirtyKey, changed);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(current => ({ ...current, [key]: value })); setError(''); setOk(''); };

  const onLogoFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) {
      // Se quitó el archivo elegido: vuelve el logo que tenía.
      setDraft(current => (current.logoDataUrl ? { ...current, logoDataUrl: '', logo: initial.logo } : current));
      return;
    }
    if (!LOGO_TYPES.includes(file.type)) { setLogoProblem('El logo tiene que ser PNG, JPG o WEBP.'); return; }
    if (file.size > 2 * 1024 * 1024) { setLogoProblem('El logo no puede superar 2 MB.'); return; }
    setLogoProblem('');
    try {
      const dataUrl = await readAsDataUrl(file);
      setDraft(current => ({ ...current, logoDataUrl: dataUrl, logo: dataUrl }));
      setOk('');
    } catch (reason) {
      setLogoProblem(errorText(reason, 'No se pudo leer el logo.'));
    }
  };

  const save = async () => {
    const code = draft.siteCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!code) { setCodeError('Falta el código de la sede.'); return; }
    setSaving(true);
    setError('');
    setOk('');
    try {
      const response = await saveSite({
        siteCode: code,
        nombre: draft.nombre.trim() || code,
        subtitulo: draft.subtitulo.trim(),
        themeColor: draft.themeColor,
        spreadsheetUrl: draft.spreadsheetUrl.trim(),
        inventorySheetName: draft.inventorySheetName.trim(),
        logo: draft.logoDataUrl ? undefined : draft.logo,
        logoDataUrl: draft.logoDataUrl || undefined,
        activo: draft.activo,
        isNew: mode === 'create'
      });
      setOk(mode === 'create' ? `Sede ${code} creada.` : 'Sede guardada. Ya se ve en el selector de sede y el menú.');
      const fresh = toDraft(response.item);
      setInitial(fresh);
      setDraft(fresh);
      setDropKey(value => value + 1);
      await onSaved(response.item);
    } catch (reason) {
      const message = errorText(reason, 'No se pudo guardar la sede.');
      if (/c[oó]digo/i.test(message) && mode === 'create') setCodeError(message);
      else setError(message);
    } finally {
      setSaving(false);
    }
  };

  const disabled = readOnly || saving;
  const preview: Partial<SiteInfo> = { ...site, logo: draft.logo, nombre: draft.nombre || draft.siteCode };

  return (
    <div className="cfg-siteform" data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Escape' && onCancel) { event.stopPropagation(); onCancel(); } }}>
      <div className="cfg-logo">
        <div className="cfg-logo-prv">
          {draft.logo ? <TenantLogo className="cfg-logo-img" site={preview} /> : <span className="cfg-logo-ta cfg-mono" aria-label="Marca TA">TA</span>}
          <span className="cfg-t3">{draft.logo ? (draft.logoDataUrl ? 'Logo nuevo (sin guardar)' : 'Logo propio') : 'Marca TA'}</span>
        </div>
        <div className="cfg-logo-drop">
          <FileDrop
            key={dropKey}
            accept="image/png,image/jpeg,image/webp"
            maxSizeMB={2}
            disabled={disabled}
            label="Subir logo"
            title="Arrastrá el logo acá o tocá para elegirlo"
            hint="PNG, JPG o WEBP · hasta 2 MB · cuadrado se ve mejor · también podés pegarlo con Ctrl V"
            onFilesChange={files => { void onLogoFiles(files); }}
          />
          <Reveal when={logoProblem}>{logoProblem && <p className="cfg-error" role="alert">{logoProblem}</p>}</Reveal>
          <div className="cfg-inline">
            <Button size="sm" variant="ghost" disabled={disabled || !draft.logo} onClick={() => { set('logo', ''); set('logoDataUrl', ''); setDropKey(value => value + 1); }}>Usar marca TA</Button>
            <span className="cfg-t3">Sin logo propio se usa la marca TA. El logo se ve en el menú, los mails y antes de entrar.</span>
          </div>
        </div>
      </div>

      <div className="cfg-grid">
        <Input
          label="Código"
          className="cfg-mono-input"
          value={draft.siteCode}
          readOnly={mode === 'edit'}
          disabled={readOnly}
          autoFocus={mode === 'create'}
          autoComplete="off"
          placeholder="NFXX"
          error={codeError || undefined}
          hint={mode === 'edit' ? 'No se cambia: separa los datos de cada sede.' : 'Letras, números o guion bajo. No se puede cambiar después.'}
          onValueChange={value => { set('siteCode', value.toUpperCase()); setCodeError(''); }}
        />
        <Input label="Nombre" value={draft.nombre} disabled={disabled} placeholder="Nombre del colegio o la sede" onValueChange={value => set('nombre', value)} />
        <Input label="Subtítulo" value={draft.subtitulo} disabled={disabled} placeholder="Ej. Sede principal" onValueChange={value => set('subtitulo', value)} />
        <Input label="Hoja de inventario" value={draft.inventorySheetName} disabled={disabled} placeholder="Ej. APP" onValueChange={value => set('inventorySheetName', value)} />
        <Input
          className="cfg-span2"
          label="URL del CSV para importar inventario"
          value={draft.spreadsheetUrl}
          disabled={disabled}
          inputMode="url"
          placeholder="https://docs.google.com/spreadsheets/…output=csv"
          hint="Solo para importar a mano desde Dispositivos. La base es la fuente de verdad: prestar y devolver no escriben en la planilla."
          onValueChange={value => set('spreadsheetUrl', value)}
        />
        <ColorField
          className="cfg-span2"
          label="Color de la sede"
          value={draft.themeColor}
          disabled={disabled}
          hint="Se usa en el logo y el selector de sede. Vacío usa el azul de la app."
          onChange={hex => set('themeColor', hex)}
        />
        {superadmin && (
          <div className="cfg-span2">
            <CheckField checked={draft.activo} disabled={disabled} label="Sede activa" description="Una sede inactiva no aparece en el selector ni deja entrar a sus usuarios." onChange={value => set('activo', value)} />
          </div>
        )}
      </div>

      <div className="cfg-uform-f">
        <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={readOnly || (mode === 'edit' && !changed)} onClick={() => void save()}>{mode === 'create' ? 'Crear sede' : 'Guardar sede'}</Button>
        {onCancel && <Button variant="ghost" disabled={saving} onClick={onCancel}>Cancelar</Button>}
        {mode === 'edit' && !onCancel && <Button variant="ghost" disabled={!changed || saving} onClick={() => { setDraft(initial); setDropKey(value => value + 1); setError(''); }}>Descartar</Button>}
        <span className="cfg-hint">Al guardar se actualizan el selector de sede, el menú y la barra superior.</span>
      </div>
      {/* Debajo de los botones: aparece sin correr lo que se tocó. */}
      <Reveal when={error || ok}>
        {(error || ok) && <p className={cx(error ? 'cfg-error' : 'cfg-okmsg')} role={error ? 'alert' : 'status'}>{error || ok}</p>}
      </Reveal>
    </div>
  );
}

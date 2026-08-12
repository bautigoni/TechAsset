import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SiteInfo } from '../../types';
import { createInvite, getSites, saveSite } from '../../services/authApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { StatCard } from '../layout/StatCard';
import { TenantLogo } from '../layout/TenantLogo';
import { SkeletonPanel } from '../layout/Skeleton';

type TenantDraft = Partial<SiteInfo> & {
  isNew?: boolean;
  logoDataUrl?: string;
};

const blankDraft: TenantDraft = {
  siteCode: '',
  nombre: '',
  subtitulo: '',
  themeColor: '#3b82f6',
  spreadsheetUrl: '',
  inventorySheetName: '',
  logo: '',
  activo: true,
  isNew: true
};

export function TenantsDashboard({ activeSite, onSwitch, onChanged }: { activeSite: string; onSwitch: (siteCode: string) => void; onChanged?: () => Promise<void> | void }) {
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<TenantDraft>(blankDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adminCodes, setAdminCodes] = useState<Record<string, string>>({});
  const [adminEmails, setAdminEmails] = useState<Record<string, string>>({});
  const [adminMailSent, setAdminMailSent] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState('');

  const filteredSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(site => `${site.siteCode} ${site.nombre} ${site.subtitulo}`.toLowerCase().includes(q));
  }, [query, sites]);

  const activos = sites.filter(site => site.activo !== false).length;

  const load = () => getSites().then(response => setSites(response.items || []));
  useEffect(() => {
    load()
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar las sedes.'))
      .finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setError('');
    setDraft(blankDraft);
    setEditorOpen(true);
  };

  const openEdit = (site: SiteInfo) => {
    setError('');
    setDraft({ ...site, isNew: false, logoDataUrl: '' });
    setEditorOpen(true);
  };

  const saveTenant = async () => {
    const code = String(draft.siteCode || '').trim().toUpperCase();
    if (!code) { setError('Falta el código del tenant.'); return; }
    setSaving(true);
    setError('');
    try {
      await saveSite({
        ...draft,
        siteCode: code,
        nombre: String(draft.nombre || code).trim(),
        subtitulo: String(draft.subtitulo || '').trim(),
        themeColor: draft.themeColor || '#3b82f6',
        spreadsheetUrl: String(draft.spreadsheetUrl || '').trim(),
        inventorySheetName: String(draft.inventorySheetName || '').trim(),
        logo: draft.logo || '',
        logoDataUrl: draft.logoDataUrl || undefined,
        activo: draft.activo !== false,
        isNew: draft.isNew
      });
      setEditorOpen(false);
      setDraft(blankDraft);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el tenant.');
    } finally {
      setSaving(false);
    }
  };

  const generateAdminCode = async (code: string) => {
    setGenerating(code);
    setError('');
    try {
      const email = String(adminEmails[code] || '').trim();
      const response = await createInvite({ siteCode: code, role: 'Administrador', kind: 'admin', email: email || undefined, expiresInDays: 30 });
      setAdminCodes(prev => ({ ...prev, [code]: response.invite.registerUrl }));
      setAdminMailSent(prev => ({ ...prev, [code]: Boolean(response.emailSent) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el código.');
    } finally {
      setGenerating('');
    }
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('El logo tiene que ser PNG, JPG o WEBP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('El logo no puede superar 2 MB.');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setDraft(current => ({ ...current, logoDataUrl: dataUrl, logo: dataUrl }));
  };

  return (
    <section className="view active tenants-view">
      <div className="tenants-hero">
        <div>
          <span className="section-eyebrow">Multi-tenant</span>
          <h2>Tenants</h2>
          <p>Administrá sedes, branding, accesos de administrador y datos de importación desde un solo lugar.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>Crear tenant</Button>
      </div>

      <div className="stats-grid analytics-kpi-grid">
        <StatCard label="Tenants totales" value={sites.length} />
        <StatCard label="Activos" value={activos} />
        <StatCard label="Inactivos" value={sites.length - activos} />
        <StatCard label="Sede actual" value={activeSite} />
      </div>

      <div className="tenant-toolbar">
        <input className="input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar tenant por código o nombre" />
      </div>

      {error && <div className="tool-error">{error}</div>}
      {loading && <SkeletonPanel rows={3} head={false} rowHeight={110} />}

      <div className="tenant-grid">
        {filteredSites.map(site => (
          <section className="tenant-card" key={site.siteCode} style={{ '--tenant-accent': site.themeColor || '#3b82f6' } as CSSProperties}>
            <div className="tenant-card-head">
              <TenantLogo className="tenant-card-logo" site={site} />
              <div>
                <h3>{site.nombre || site.siteCode}</h3>
                <p>{site.siteCode}{site.subtitulo ? ` · ${site.subtitulo}` : ''}</p>
              </div>
              <span className={`badge ${site.activo === false ? 'off' : 'available'}`}>
                {site.activo === false ? 'Inactivo' : 'Activo'}
              </span>
            </div>
            <div className="tenant-meta">
              <span>CSV: <strong>{site.spreadsheetUrl ? 'Configurado' : 'Sin configurar'}</strong></span>
              <span>Logo: <strong>{site.logo ? 'Personalizado' : 'TA'}</strong></span>
              <span>Color: <strong>{site.themeColor || '#3b82f6'}</strong></span>
            </div>
            <div className="tenant-actions">
              <Button variant="primary" disabled={site.siteCode === activeSite} onClick={() => onSwitch(site.siteCode)}>
                {site.siteCode === activeSite ? 'Sede actual' : 'Entrar'}
              </Button>
              <Button onClick={() => openEdit(site)}>Editar</Button>
            </div>
            <div className="tenant-admin-code">
              <input
                className="input"
                type="email"
                value={adminEmails[site.siteCode] || ''}
                onChange={event => setAdminEmails(prev => ({ ...prev, [site.siteCode]: event.target.value }))}
                placeholder="mail admin opcional"
              />
              <Button disabled={generating === site.siteCode} onClick={() => generateAdminCode(site.siteCode)}>
                {generating === site.siteCode ? 'Generando...' : 'Código admin'}
              </Button>
            </div>
            {adminCodes[site.siteCode] && (
              <div className="tool-info tenant-code-result">
                <code>{adminCodes[site.siteCode]}</code>
                <Button className="mini-action-btn" onClick={() => copy(adminCodes[site.siteCode])}>Copiar</Button>
                {adminMailSent[site.siteCode] && <span>Mail enviado</span>}
              </div>
            )}
          </section>
        ))}
        {!filteredSites.length && !loading && <div className="empty-state">No hay tenants para ese filtro.</div>}
      </div>

      {editorOpen && (
        <Modal title={draft.isNew ? 'Crear tenant' : `Editar ${draft.siteCode}`} onClose={() => setEditorOpen(false)}>
          <div className="tenant-editor">
            <div className="tenant-logo-editor">
              <TenantLogo className="tenant-logo-preview" site={draft} />
              <div>
                <strong>Logo dentro de la app</strong>
                <p className="muted">El login mantiene la marca TA. Este logo se usa en sidebar, topbar y selector de sede.</p>
                <div className="actions">
                  <label className="btn btn-secondary tenant-upload-btn">
                    Subir logo
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void handleLogoFile(event.target.files?.[0] || null)} />
                  </label>
                  <Button onClick={() => setDraft(current => ({ ...current, logo: '', logoDataUrl: '' }))}>Usar TA</Button>
                </div>
              </div>
            </div>
            <div className="grid-2">
              <label>Código
                <input className="input" value={draft.siteCode || ''} disabled={!draft.isNew} onChange={event => setDraft(current => ({ ...current, siteCode: event.target.value.toUpperCase() }))} placeholder="NFXX" autoFocus={draft.isNew} />
              </label>
              <label>Color
                <input className="input" type="color" value={draft.themeColor || '#3b82f6'} onChange={event => setDraft(current => ({ ...current, themeColor: event.target.value }))} />
              </label>
            </div>
            <label>Nombre
              <input className="input" value={draft.nombre || ''} onChange={event => setDraft(current => ({ ...current, nombre: event.target.value }))} placeholder="Nombre del colegio / sede" />
            </label>
            <label>Subtítulo
              <input className="input" value={draft.subtitulo || ''} onChange={event => setDraft(current => ({ ...current, subtitulo: event.target.value }))} placeholder="Ej. Sede principal" />
            </label>
            <label>URL CSV para importación manual
              <input className="input" value={draft.spreadsheetUrl || ''} onChange={event => setDraft(current => ({ ...current, spreadsheetUrl: event.target.value }))} placeholder="https://docs.google.com/spreadsheets/...output=csv" />
            </label>
            <label>Inventory sheet name
              <input className="input" value={draft.inventorySheetName || ''} onChange={event => setDraft(current => ({ ...current, inventorySheetName: event.target.value }))} />
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={draft.activo !== false} onChange={event => setDraft(current => ({ ...current, activo: event.target.checked }))} />
              <span>Tenant activo</span>
            </label>
            {error && <div className="tool-error">{error}</div>}
            <div className="actions">
              <Button variant="primary" disabled={saving} onClick={saveTenant}>{saving ? 'Guardando...' : 'Guardar tenant'}</Button>
              <Button onClick={() => setEditorOpen(false)}>Cancelar</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el logo.'));
    reader.readAsDataURL(file);
  });
}

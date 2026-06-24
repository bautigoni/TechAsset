import { useEffect, useState } from 'react';
import type { SiteInfo } from '../../types';
import { createInvite, getSites, saveSite } from '../../services/authApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { StatCard } from '../layout/StatCard';

export function TenantsDashboard({ activeSite, onSwitch }: { activeSite: string; onSwitch: (siteCode: string) => void }) {
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ siteCode: '', nombre: '', subtitulo: '', themeColor: '#3b82f6' });
  const [saving, setSaving] = useState(false);
  const [adminCodes, setAdminCodes] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState('');

  const generateAdminCode = async (code: string) => {
    setGenerating(code);
    try {
      const response = await createInvite({ siteCode: code, role: 'Administrador', kind: 'admin', expiresInDays: 30 });
      setAdminCodes(prev => ({ ...prev, [code]: response.invite.registerUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el código.');
    } finally {
      setGenerating('');
    }
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };

  const load = () => getSites().then(response => setSites(response.items || []));
  useEffect(() => {
    load()
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar las sedes.'))
      .finally(() => setLoading(false));
  }, []);

  const createTenant = async () => {
    const code = draft.siteCode.trim().toUpperCase();
    if (!code) { setError('Falta el código del tenant.'); return; }
    setSaving(true);
    setError('');
    try {
      await saveSite({ siteCode: code, nombre: draft.nombre.trim() || code, subtitulo: draft.subtitulo.trim(), themeColor: draft.themeColor, activo: true, isNew: true });
      setCreateOpen(false);
      setDraft({ siteCode: '', nombre: '', subtitulo: '', themeColor: '#3b82f6' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el tenant.');
    } finally {
      setSaving(false);
    }
  };

  const activos = sites.filter(site => site.activo !== false).length;

  return (
    <section className="view active">
      <div className="card-head" style={{ marginBottom: 12 }}>
        <h3>Tenants</h3>
        <Button variant="primary" onClick={() => { setError(''); setCreateOpen(true); }}>Crear tenant</Button>
      </div>

      <div className="stats-grid analytics-kpi-grid">
        <StatCard label="Tenants totales" value={sites.length} />
        <StatCard label="Activos" value={activos} />
        <StatCard label="Inactivos" value={sites.length - activos} />
        <StatCard label="Sede actual" value={activeSite} />
      </div>

      {error && <div className="tool-error">{error}</div>}
      {loading && <div className="tool-info">Cargando tenants…</div>}

      <div className="analytics-grid">
        {sites.map(site => (
          <section className="card" key={site.siteCode} style={{ borderLeft: `4px solid ${site.themeColor || 'var(--blue)'}` }}>
            <div className="card-head" style={{ alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0 }}>{site.nombre || site.siteCode}</h3>
                <p className="muted" style={{ margin: '4px 0 0' }}>{site.siteCode}{site.subtitulo ? ` · ${site.subtitulo}` : ''}</p>
              </div>
              <span className={`badge ${site.activo === false ? 'off' : 'available'}`}>
                {site.activo === false ? 'Inactivo' : 'Activo'}
              </span>
            </div>
            <div className="actions" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" disabled={site.siteCode === activeSite} onClick={() => onSwitch(site.siteCode)}>
                {site.siteCode === activeSite ? 'Sede actual' : 'Entrar'}
              </Button>
              <Button disabled={generating === site.siteCode} onClick={() => generateAdminCode(site.siteCode)}>
                {generating === site.siteCode ? 'Generando…' : 'Código admin'}
              </Button>
            </div>
            {adminCodes[site.siteCode] && (
              <div className="tool-info" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span><code>{adminCodes[site.siteCode]}</code></span>
                <Button className="mini-action-btn" onClick={() => copy(adminCodes[site.siteCode])}>Copiar</Button>
              </div>
            )}
          </section>
        ))}
      </div>

      {createOpen && (
        <Modal title="Crear tenant" onClose={() => setCreateOpen(false)}>
          <div className="grid-2">
            <label>Código (ej. NFPT)
              <input className="input" value={draft.siteCode} onChange={e => setDraft(d => ({ ...d, siteCode: e.target.value.toUpperCase() }))} placeholder="NFXX" autoFocus />
            </label>
            <label>Color
              <input className="input" type="color" value={draft.themeColor} onChange={e => setDraft(d => ({ ...d, themeColor: e.target.value }))} />
            </label>
          </div>
          <label>Nombre
            <input className="input" value={draft.nombre} onChange={e => setDraft(d => ({ ...d, nombre: e.target.value }))} placeholder="Nombre del colegio / sede" />
          </label>
          <label>Subtítulo (opcional)
            <input className="input" value={draft.subtitulo} onChange={e => setDraft(d => ({ ...d, subtitulo: e.target.value }))} placeholder="Ej. Sede principal" />
          </label>
          {error && <div className="tool-error">{error}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            <Button variant="primary" disabled={saving} onClick={createTenant}>{saving ? 'Creando…' : 'Crear tenant'}</Button>
            <Button onClick={() => setCreateOpen(false)}>Cancelar</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

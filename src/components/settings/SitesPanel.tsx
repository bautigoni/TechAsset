import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, Plus, Search } from 'lucide-react';
import type { SiteInfo } from '../../types';
import { Button, Collapse, EmptyState, ErrorState, Input, SkeletonRows } from '../../ui';
import { cx, fold } from '../../ui/util';
import { createInvite, getSites } from '../../services/authApi';
import { TenantLogo } from '../layout/TenantLogo';
import { Card, CardFoot, CopyButton, errorText } from './settingsKit';
import { SiteForm } from './SiteForm';

type AdminCode = { email: string; busy: boolean; link: string; mailSent: boolean; error: string };

/**
 * Sedes (solo superadmin): reemplaza a la pantalla Tenants. Crear (409 si el
 * código ya existe), editar en línea, entrar a otra sede y generar el código
 * de administrador (invitación de 30 días, con mail opcional).
 */
export function SitesPanel({ header, readOnly, siteCode, onSwitchSite, onChanged }: {
  header: (actions?: ReactNode) => ReactNode;
  readOnly: boolean;
  siteCode: string;
  onSwitchSite: (siteCode: string) => void;
  onChanged: () => void | Promise<void>;
  onEditActive?: () => void;
}) {
  const [sites, setSites] = useState<SiteInfo[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState('');
  const [codeOpen, setCodeOpen] = useState('');
  const [codes, setCodes] = useState<Record<string, AdminCode>>({});
  const [created, setCreated] = useState('');

  const load = () => {
    setLoadError('');
    return getSites().then(response => setSites(response.items || [])).catch(reason => setLoadError(errorText(reason, 'No se pudieron cargar las sedes.')));
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = fold(query);
    if (!q) return sites || [];
    return (sites || []).filter(site => fold(`${site.siteCode} ${site.nombre} ${site.subtitulo || ''}`).includes(q));
  }, [sites, query]);
  const active = (sites || []).filter(site => site.activo !== false).length;

  const code = (key: string): AdminCode => codes[key] || { email: '', busy: false, link: '', mailSent: false, error: '' };
  const patchCode = (key: string, change: Partial<AdminCode>) => setCodes(current => ({ ...current, [key]: { ...code(key), ...current[key], ...change } }));

  const generate = async (site: SiteInfo) => {
    const state = code(site.siteCode);
    const email = state.email.trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { patchCode(site.siteCode, { error: 'El mail no parece válido. Dejalo vacío si solo querés el link.' }); return; }
    patchCode(site.siteCode, { busy: true, error: '', link: '' });
    try {
      const response = await createInvite({ siteCode: site.siteCode, role: 'Administrador', kind: 'admin', email: email || undefined, expiresInDays: 30 });
      patchCode(site.siteCode, { busy: false, link: response.invite.registerUrl, mailSent: Boolean(response.emailSent), email: '' });
    } catch (reason) {
      patchCode(site.siteCode, { busy: false, error: errorText(reason, 'No se pudo generar el código.') });
    }
  };

  return (
    <>
      {header(<Button variant="primary" icon={<Plus size={15} aria-hidden="true" />} disabled={readOnly} aria-expanded={creating} onClick={() => setCreating(value => !value)}>Crear sede</Button>)}
      <Collapse open={creating} gap="var(--g-s-4)" unmountOnClose data-scanner-ignore="">
        <Card title="Nueva sede">
          <div className="cfg-pad">
            <SiteForm
              mode="create"
              superadmin
              readOnly={readOnly}
              dirtyKey="sedes"
              onCancel={() => setCreating(false)}
              onSaved={async site => {
                setCreating(false);
                setCreated(site.siteCode);
                await load();
                await onChanged();
              }}
            />
          </div>
        </Card>
      </Collapse>

      <Card ariaLabel="Todas las sedes">
        <div className="cfg-toolbar">
          <span className="cfg-t2 cfg-nowrap">
            <span className="cfg-mono">{sites?.length ?? '–'}</span> sedes · <span className="cfg-mono">{active}</span> activas · <span className="cfg-mono">{sites ? sites.length - active : '–'}</span> inactivas
          </span>
          <Input
            className="cfg-search"
            size="sm"
            enterKeyHint="search"
            aria-label="Buscar sede por código o nombre"
            placeholder="Código o nombre"
            prefix={<Search size={14} aria-hidden="true" />}
            value={query}
            data-scanner-ignore=""
            onValueChange={setQuery}
          />
        </div>
        {created && <p className="cfg-okmsg cfg-pad-x" role="status">Sede {created} creada. Ya podés entrar o generar su código de administrador.</p>}
        {loadError && <div className="cfg-pad"><ErrorState message={loadError} onRetry={() => void load()} /></div>}
        {!sites && !loadError && <div className="cfg-pad"><SkeletonRows rows={3} /></div>}
        {sites && !filtered.length && (
          <div className="cfg-pad">
            <EmptyState compact icon={query ? <Search size={18} aria-hidden="true" /> : <Building2 size={18} aria-hidden="true" />} title={query ? 'No hay sedes para esa búsqueda.' : 'Todavía no hay sedes.'} action={query ? <Button size="sm" onClick={() => setQuery('')}>Ver todas</Button> : undefined} />
          </div>
        )}
        {filtered.length > 0 && <div className="cfg-table cfg-ts" role="list" aria-label="Sedes">
        {filtered.map(site => {
          const isHere = site.siteCode === siteCode;
          const state = code(site.siteCode);
          return (
            <div className="cfg-tgroup" role="listitem" key={site.siteCode} data-site-row={site.siteCode}>
              <div className="cfg-trow">
                <span className="cfg-ts-logo">
                  {site.logo ? <TenantLogo className="cfg-ts-img" site={site} /> : <span className="cfg-logo-ta is-sm cfg-mono" aria-hidden="true">TA</span>}
                </span>
                <span className="cfg-stack-xs">
                  <span className="cfg-strong cfg-wrap">{site.nombre || site.siteCode}</span>
                  <span className="cfg-t3 cfg-wrap"><span className="cfg-mono">{site.siteCode}</span>{site.subtitulo ? ` · ${site.subtitulo}` : ''} · <span className={cx(site.activo === false && 'is-warn')}>{site.activo === false ? 'inactiva' : 'activa'}</span></span>
                </span>
                <span className="cfg-ts-meta cfg-t2 cfg-wrap">
                  CSV {site.spreadsheetUrl ? 'configurado' : 'sin configurar'} · {site.logo ? 'logo propio' : 'marca TA'} · {site.themeColor ? <span className="cfg-mono">{site.themeColor}</span> : 'sin color'}
                </span>
                <span className="cfg-ts-act">
                  {isHere ? <span className="cfg-t3 cfg-nowrap">Estás acá</span> : <Button size="sm" variant="secondary" onClick={() => onSwitchSite(site.siteCode)}>Entrar</Button>}
                  <Button size="sm" variant="ghost" aria-expanded={editing === site.siteCode} disabled={readOnly} onClick={() => { setEditing(editing === site.siteCode ? '' : site.siteCode); setCodeOpen(''); }}>{editing === site.siteCode ? 'Cerrar' : 'Editar'}</Button>
                  <Button size="sm" variant="ghost" aria-expanded={codeOpen === site.siteCode} disabled={readOnly} onClick={() => { setCodeOpen(codeOpen === site.siteCode ? '' : site.siteCode); setEditing(''); }}>Código admin</Button>
                </span>
              </div>
              <Collapse open={editing === site.siteCode} unmountOnClose data-scanner-ignore="">
                <div className="cfg-uform">
                  <SiteForm
                    site={site}
                    mode="edit"
                    superadmin
                    readOnly={readOnly}
                    dirtyKey="sedes"
                    onCancel={() => setEditing('')}
                    onSaved={async () => { await load(); await onChanged(); }}
                  />
                </div>
              </Collapse>
              <Collapse open={codeOpen === site.siteCode} unmountOnClose data-scanner-ignore="">
                <div className="cfg-uform" role="group" aria-label={`Código de administrador para ${site.siteCode}`} data-scanner-ignore="">
                  <div className="cfg-add">
                    <Input
                      label="Mail del administrador (opcional)"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      value={state.email}
                      placeholder="Si lo completás, le mandamos el código"
                      onValueChange={value => patchCode(site.siteCode, { email: value, error: '' })}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void generate(site); } }}
                    />
                    <Button variant="secondary" loading={state.busy} loadingLabel="Generando…" onClick={() => void generate(site)}>Generar código admin</Button>
                  </div>
                  <span className="cfg-hint">Invitación de Administrador para {site.siteCode}, vence en 30 días.</span>
                  {state.error && <p className="cfg-error" role="alert">{state.error}</p>}
                  {state.link && (
                    <div className="cfg-result" role="status">
                      <span className="cfg-strong cfg-nowrap">Código listo</span>
                      <span className="cfg-t2">{state.mailSent ? '· mail enviado' : '· compartí el link'}</span>
                      <code className="cfg-link">{state.link}</code>
                      <CopyButton text={state.link} label="Copiar" />
                    </div>
                  )}
                </div>
              </Collapse>
            </div>
          );
        })}
        </div>}
        <CardFoot status="Crear una sede con un código que ya existe avisa en vez de pisar sus datos." tone="muted" />
      </Card>
    </>
  );
}

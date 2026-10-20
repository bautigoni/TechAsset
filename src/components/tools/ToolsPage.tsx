import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Eyebrow, StatusText, Tabs, icons, useAnchoredToggle } from '../../ui';
import { fetchToolsConfig, type ToolsConfig } from '../../services/toolsApi';
import type { ViewKey } from '../../types';
import { requestSettingsPanel } from '../settings/settingsRoute';
import { GlifingTool } from './GlifingTool';
import { Credentials365Tool } from './Credentials365Tool';
import { DownloadList } from './Downloads';
import { useSmoothHeight } from '../settings/Reveal';
import '../../styles/screens/tools.css';

type TabKey = 'cards' | 'creds' | 'dl';
const TAB_KEY = 'techasset_tools_tab';
const TABS: Array<{ value: TabKey; label: string }> = [
  { value: 'cards', label: 'Tarjetas de acceso' },
  { value: 'creds', label: 'Credenciales 365' },
  { value: 'dl', label: 'Descargas' }
];

function readTab(): TabKey {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved === 'cards' || saved === 'creds' || saved === 'dl') return saved;
  } catch { /* sin storage */ }
  return 'cards';
}

/** Texto del proveedor de mail (sin pastillas): qué pasa si se envía. */
function mailState(config: ToolsConfig | null) {
  if (!config) return null;
  const provider = config.resendConfigurado ? 'Resend' : config.mailConfigurado || config.smtpConfigurado ? 'SMTP' : '';
  if (config.modoPrueba) return { tone: 'muted' as const, text: `Mail: ${provider || 'sin proveedor'} · modo prueba (no se envía nada)` };
  if (!provider) return { tone: 'bad' as const, text: 'Mail sin configurar: no se puede enviar' };
  return { tone: 'warn' as const, text: `Mail: ${provider} · envío real${provider === 'SMTP' ? ' (Resend no configurado)' : ''}` };
}

/**
 * Herramientas auxiliares (etapa 8c): solapas Tarjetas / Credenciales 365 /
 * Descargas. Las tres quedan montadas al cambiar de solapa (no se pierde el CSV
 * subido). El formulario de correo (SMTP) se mudó a Configuración: acá queda
 * el estado del proveedor y el link.
 */
export function ToolsPage({ consultationMode = false, canEdit = true, canSend = true, onNavigate }: {
  operator?: string;
  consultationMode?: boolean;
  /** Permiso de edición del módulo Herramientas (las rutas POST /api/tools lo exigen). */
  canEdit?: boolean;
  /** Admin de la sede: el server solo deja enviar credenciales a ellos. */
  canSend?: boolean;
  onNavigate?: (view: ViewKey) => void;
}) {
  const [tab, setTab] = useState<TabKey>(readTab);
  const panelsRef = useSmoothHeight<HTMLDivElement>(tab);
  const anchored = useAnchoredToggle();
  const [config, setConfig] = useState<ToolsConfig | null>(null);
  const [configError, setConfigError] = useState(false);

  const loadConfig = () => {
    setConfigError(false);
    fetchToolsConfig().then(setConfig).catch(() => setConfigError(true));
  };
  useEffect(loadConfig, []);

  const pick = (next: TabKey) => {
    anchored(() => setTab(next));
    try { sessionStorage.setItem(TAB_KEY, next); } catch { /* sin storage */ }
  };

  const readOnly = consultationMode || !canEdit;
  // Abre Configuración directo en el panel de Mail y SMTP (/sede/<sede>/settings/mail).
  const openMailSettings = onNavigate ? () => { requestSettingsPanel('mail'); onNavigate('settings'); } : undefined;
  const mail = mailState(config);

  return (
    <section className="tl-page" aria-label="Herramientas auxiliares">
      <header className="tl-head">
        <div className="tl-head-text">
          <Eyebrow>Herramientas</Eyebrow>
          <h1 className="tl-title">Herramientas auxiliares</h1>
        </div>
        <div className="tl-mail" aria-live="polite">
          {mail && <StatusText tone={mail.tone}>{mail.text}</StatusText>}
          {configError && (
            <span className="tl-mail-err">
              <StatusText tone="bad">No se pudo leer el estado del mail.</StatusText>
              <Button size="sm" variant="ghost" icon={<icons.IconRetry size={14} />} onClick={loadConfig}>Reintentar</Button>
            </span>
          )}
          {openMailSettings && (
            <Button size="sm" variant="ghost" iconEnd={<ArrowRight size={14} strokeWidth={1.6} />} onClick={openMailSettings}>
              Configurar correo en Configuración
            </Button>
          )}
        </div>
      </header>

      {readOnly && (
        <p className="tl-note" role="status">
          <icons.IconLock size={14} />
          <span>{consultationMode
            ? 'Modo consulta: podés bajar plantillas y scripts. Subir CSV, generar y enviar quedan deshabilitados.'
            : 'Tu rol no edita Herramientas: podés bajar plantillas y scripts, pero no generar ni enviar.'}</span>
        </p>
      )}

      <Tabs tabs={TABS} value={tab} onChange={pick} ariaLabel="Herramientas" className="tl-tabs" />

      {/* Cambiar de solapa pasa del alto de una al de la otra con transición (las solapas quedan quietas). */}
      <div className="tl-panels" ref={panelsRef}>
      <div role="tabpanel" aria-label="Tarjetas de acceso" hidden={tab !== 'cards'} className="tl-panel">
        <GlifingTool readOnly={readOnly} />
      </div>
      <div role="tabpanel" aria-label="Credenciales 365" hidden={tab !== 'creds'} className="tl-panel">
        <Credentials365Tool readOnly={readOnly} canSend={canSend} config={config} onConfig={setConfig} onOpenMailSettings={openMailSettings} />
      </div>
      <div role="tabpanel" aria-label="Descargas" hidden={tab !== 'dl'} className="tl-panel">
        <section className="tl-card tl-dl-card" aria-labelledby="tl-dl-title">
          <div className="tl-card-head">
            <h2 id="tl-dl-title" className="tl-card-title">Scripts para las PC</h2>
            <span className="tl-card-sub">Se descargan a la compu; nunca se ejecutan desde la web.</span>
          </div>
          <DownloadList />
        </section>
        <p className="tl-foot">Antes de mostrar Descargar se verifica que el archivo exista en el servidor. También están en Accesos rápidos.</p>
      </div>
      </div>
    </section>
  );
}

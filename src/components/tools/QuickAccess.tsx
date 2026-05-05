import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';

type QuickLink = { name: string; description: string; url: string };

const STATIC_LINKS: QuickLink[] = [
  { name: 'Listas EP', description: 'Planilla de listas de Escuela Primaria', url: 'https://docs.google.com/spreadsheets/d/1ppF2IBLxlLUTZ5HS35_C8SOy07VsjtI2WC9JGlqec7U/edit?gid=1611662790#gid=1611662790' },
  { name: 'Listas ES', description: 'Planilla de listas de Escuela Secundaria', url: 'https://docs.google.com/spreadsheets/d/1uVsdBk3McaT8WQI7Svv3e2wRvx6i5XpV52GlEasVJ0w/edit?gid=1617997660#gid=1617997660' },
  { name: 'Hosking', description: 'Portal Northfield Hosking', url: 'https://northfield.hosking.ar/' },
  { name: 'Tiknology / InvGate', description: 'Crear incidente en mesa de ayuda', url: 'https://tikno.sd.cloud.invgate.net/incident/create' }
];

export function QuickAccess() {
  const [handingUrl, setHandingUrl] = useState('');

  useEffect(() => {
    fetchToolsConfig().then(c => setHandingUrl(c.handingTicketUrl || '')).catch(() => {});
  }, []);

  const links: QuickLink[] = [
    ...STATIC_LINKS,
    { name: 'Handing', description: handingUrl ? 'Crear ticket en Handing' : 'Configurar HANDING_TICKET_URL en .env', url: handingUrl }
  ];

  return (
    <section className="card tool-card">
      <div className="card-head"><h3>Accesos rápidos institucionales</h3></div>
      <div className="quick-access-grid">
        {links.map(link => (
          <article key={link.name} className="quick-access-card">
            <div>
              <h4>{link.name}</h4>
              <p className="muted">{link.description}</p>
            </div>
            {link.url ? (
              <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">Abrir</a>
            ) : (
              <button className="btn btn-secondary" type="button" disabled title="URL no configurada">Sin configurar</button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

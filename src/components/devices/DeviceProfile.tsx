import { useEffect, useState } from 'react';
import type { Device } from '../../types';
import { getDeviceOverview, updateDeviceMetadata, type DeviceOverviewResponse } from '../../services/devicesApi';
import { Modal } from '../layout/Modal';
import { getOperationalAlias, classifyDeviceType } from '../../utils/classifyDevice';
import { RelatedReminders } from '../reminders/RelatedReminders';

export function DeviceProfile({ device, consultationMode = false, onOpenDevice, onClose }: { device: Device; consultationMode?: boolean; onOpenDevice?: (device:Device)=>void; onClose: () => void }) {
  const [overview, setOverview] = useState<DeviceOverviewResponse | null>(null);
  const [error, setError] = useState('');
  const [condition, setCondition] = useState('Excelente');
  useEffect(() => { setOverview(null); setError(''); getDeviceOverview(device.etiqueta).then(response=>{setOverview(response);setCondition(response.condition||'Excelente');}).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo cargar el resumen.')); }, [device.etiqueta]);
  useEffect(()=>{window.dispatchEvent(new CustomEvent('techasset:assistant-context',{detail:{type:'device',id:device.etiqueta,label:getOperationalAlias(device)||device.etiqueta,data:{estado:device.estado,ubicacion:device.ubicacion}}}));return()=>{window.dispatchEvent(new CustomEvent('techasset:assistant-context-clear',{detail:{type:'device',id:device.etiqueta}}));};},[device.etiqueta]);
  const current = overview?.device || device;
  const siteCode = current.siteCode || localStorage.getItem('techasset_active_site') || 'NFPT';
  const basic = [
    ['Nombre', getOperationalAlias(current) || current.dispositivo], ['Activo', current.etiqueta], ['Número operativo', current.numeroOperativo || current.numero],
    ['Serie', current.sn], ['Modelo', current.modelo], ['Fabricante', current.marca], ['Tipo', classifyDeviceType(current)], ['Estado', current.estado],
    ['Ubicación', current.ubicacion], ['Asignado a', current.prestadoA]
  ];
  return (
    <Modal title={`Overview · ${getOperationalAlias(current) || current.etiqueta}`} onClose={onClose} wide>
      <div className="device-overview">
        {error && <div className="tool-error">{error}</div>}
        {!overview && !error && <div className="tool-info">Armando el historial del dispositivo…</div>}
        <section className="device-overview-hero">
          <div><span className="eyebrow">{current.etiqueta}</span><h2>{getOperationalAlias(current) || current.dispositivo || current.etiqueta}</h2><p>{classifyDeviceType(current)} · {current.marca || 'Sin fabricante'} {current.modelo || ''}</p></div>
          <div className="device-profile-status"><span className={`badge ${current.estado === 'Disponible' ? 'available' : current.estado === 'Prestado' ? 'loaned' : 'off'}`}>{current.estado || 'Sin revisar'}</span><label>Condición<select className="input" disabled={consultationMode} value={condition} onChange={async event=>{const value=event.target.value;setCondition(value);try{await updateDeviceMetadata(current.etiqueta,{condition:value});}catch{setError('No se pudo guardar la condición.');}}}>{['Excelente','Bueno','Regular','Malo'].map(value=><option key={value}>{value}</option>)}</select></label></div>
        </section>
        {overview?.aiSummary && <section className="card device-ai-summary"><div><span className="eyebrow">Resumen IA</span><p>{overview.aiSummary.text}</p></div><small>Actualizado {formatDate(overview.aiSummary.generatedAt)}</small></section>}
        <section className="device-overview-grid">
          <article className="card device-overview-section"><h3>Información básica</h3><dl>{basic.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl></article>
          <article className="card device-overview-section"><h3>Estadísticas</h3><div className="device-stat-grid"><Stat label="Préstamos" value={overview?.stats.totalLoans ?? '—'} /><Stat label="Reparaciones" value={overview?.stats.totalRepairs ?? '—'} /><Stat label="Incidentes" value={overview?.stats.incidents ?? '—'} /><Stat label="Último préstamo" value={shortDate(overview?.stats.lastLoan)} /><Stat label="Última reparación" value={shortDate(overview?.stats.lastRepair)} /><Stat label="Mantenimiento" value={shortDate(overview?.stats.lastMaintenance)} /></div></article>
        </section>
        {overview?.activeLoan && <section className="card device-active-loan"><h3>Préstamo activo</h3><p><strong>{overview.activeLoan.person || 'Sin persona'}</strong> · {overview.activeLoan.role || 'Sin rol'} · {overview.activeLoan.location || 'Sin ubicación'}</p><small>Desde {formatDate(overview.activeLoan.since)}</small></section>}
        {overview?.group && <section className="card device-overview-section"><h3>Grupo · {overview.group.name}</h3><p className="muted">{overview.group.description || 'Dispositivos relacionados'}</p><div className="device-group-members">{overview.group.members.map(member=><button key={member.etiqueta} onClick={()=>onOpenDevice?.(member)}><strong>{member.etiqueta}</strong><span>{getOperationalAlias(member)||member.dispositivo||member.estado}</span></button>)}</div></section>}
        <section className="device-overview-grid">
          <article className="card device-overview-section"><h3>Actividad reciente</h3><div className="device-timeline">{overview?.timeline.slice(0,12).map((item,index)=><div key={`${item.date}-${index}`}><span /><div><strong>{item.action}</strong><p>{item.notes || item.source}</p><small>{formatDate(item.date)} · {item.user || 'Sistema'}</small></div></div>)}{overview && !overview.timeline.length && <p className="muted">Sin movimientos registrados.</p>}</div></article>
          <article className="card device-overview-section"><h3>Tickets relacionados</h3><div className="device-related-list">{overview?.recentTickets.map(ticket=><a key={ticket.id} href={`/sede/${siteCode}/tickets`}><span>#{ticket.numero || ticket.id} · {ticket.estado}</span><strong>{ticket.titulo || ticket.categoria}</strong><small>{formatDate(ticket.updatedAt)}</small></a>)}{overview && !overview.recentTickets.length && <p className="muted">No se detectaron tickets para esta etiqueta.</p>}</div></article>
        </section>
        <section className="card device-overview-section"><h3>Mantenimiento y datos de compra</h3>{overview?.maintenanceHistory.length ? <div className="device-related-list">{overview.maintenanceHistory.map(item=><div key={item.id}><span>{item.status}</span><strong>{item.title}</strong><small>{formatDate(item.date)} {item.notes ? `· ${item.notes}` : ''}</small></div>)}</div> : <p className="muted">No hay mantenimientos vinculados.</p>}<div className="device-data-gaps"><span>Compra: no registrada</span><span>Garantía: no registrada</span></div></section>
        <RelatedReminders type="device" id={current.etiqueta} label={getOperationalAlias(current)||current.etiqueta} consultationMode={consultationMode}/>
      </div>
    </Modal>
  );
}

function Stat({label,value}:{label:string;value:string|number}){return <div><strong>{value}</strong><span>{label}</span></div>;}
function shortDate(value?:string){return value?String(value).slice(0,10).split('-').reverse().join('/'):'—';}
function formatDate(value?:string){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?shortDate(value):date.toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'});}

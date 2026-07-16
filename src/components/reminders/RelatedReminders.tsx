import { useEffect, useState } from 'react';
import type { Reminder } from '../../types';
import { completeReminder, createReminder, getReminders } from '../../services/remindersApi';
import { Button } from '../layout/Button';

export function RelatedReminders({type,id,label,consultationMode=false}:{type:string;id:string;label:string;consultationMode?:boolean}){
  const [items,setItems]=useState<Reminder[]>([]);const refresh=()=>getReminders({relatedType:type,relatedId:id}).then(response=>setItems(response.items));useEffect(()=>{refresh().catch(()=>undefined);},[type,id]);
  const add=async()=>{const title=prompt(`Recordatorio para ${label}`);if(!title)return;const when=prompt('Fecha y hora (YYYY-MM-DD HH:mm)');if(!when)return;await createReminder({title,remindAt:new Date(when).toISOString(),relatedType:type,relatedId:id,relatedLabel:label});await refresh();};
  return <section className="card related-reminders"><div className="card-head"><h3>Recordatorios</h3><Button disabled={consultationMode} onClick={add}>+ Agregar</Button></div>{items.length?<div>{items.slice(0,5).map(item=><article key={item.id}><span>{item.status==='completed'?'✓':'○'}</span><div><strong>{item.title}</strong><small>{new Date(item.remindAt).toLocaleString('es-AR')}</small></div>{item.status==='pending'&&!consultationMode&&<button onClick={async()=>{await completeReminder(item.id);await refresh();}}>Completar</button>}</article>)}</div>:<p className="muted">Sin recordatorios vinculados.</p>}</section>;
}

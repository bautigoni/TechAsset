import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasItem, CanvasItemType, TaskItem } from '../../types';
import { createCanvasItem, deleteCanvasItem, getCanvasItems, updateCanvasItem, uploadCanvasFile } from '../../services/canvasApi';
import { Button } from '../layout/Button';
import { getTasks } from '../../services/tasksApi';

const COLORS = ['#fef08a', '#bfdbfe', '#bbf7d0', '#fecdd3', '#ddd6fe'];

export function CanvasPage({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [viewport, setViewport] = useState({ x: 140, y: 100, zoom: 1 });
  const [message, setMessage] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef(viewport);
  const pendingRef = useRef(new Map<number, Partial<CanvasItem>>());
  const timersRef = useRef(new Map<number, number>());
  viewportRef.current = viewport;

  const refresh = useCallback(async () => { const response = await getCanvasItems(); setItems(response.items); }, []);
  useEffect(() => { refresh().catch(() => setMessage('No se pudo cargar el canvas.')); getTasks('team').then(response => setTasks(response.items)).catch(() => undefined); }, [refresh]);
  useEffect(() => () => { timersRef.current.forEach(timer => window.clearTimeout(timer)); pendingRef.current.forEach((patch, id) => { void updateCanvasItem(id, patch); }); }, []);

  const addItem = async (itemType: CanvasItemType) => {
    const center = screenToWorld(surfaceRef.current?.clientWidth ? surfaceRef.current.clientWidth / 2 : 400, surfaceRef.current?.clientHeight ? surfaceRef.current.clientHeight / 2 : 300, viewportRef.current);
    const defaults: Record<CanvasItemType, Record<string, unknown>> = {
      sticky: { text: 'Nueva idea' }, text: { text: 'Bloque de texto' }, checklist: { items: [{ text: 'Primer paso', checked: false }] }, image: {}, file: {}, link: { url: 'https://', text: 'Enlace' }, 'task-group': { taskIds: [] }
    };
    const response = await createCanvasItem({ itemType, title: itemType === 'sticky' ? 'Nota' : itemType === 'task-group' ? 'Grupo de tareas' : '', content: defaults[itemType], x: center.x - 120, y: center.y - 90, width: itemType === 'task-group' ? 380 : 260, height: itemType === 'task-group' ? 260 : 180, color: COLORS[items.length % COLORS.length] });
    setItems(current => [...current, response.item]);
  };

  const patchItem = (id: number, patch: Partial<CanvasItem>) => {
    setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    pendingRef.current.set(id, { ...(pendingRef.current.get(id) || {}), ...patch });
    const currentTimer = timersRef.current.get(id);
    if (currentTimer) window.clearTimeout(currentTimer);
    timersRef.current.set(id, window.setTimeout(async () => {
      const queued = pendingRef.current.get(id); pendingRef.current.delete(id); timersRef.current.delete(id);
      if (!queued) return;
      try { await updateCanvasItem(id, queued); } catch { setMessage('No se pudo guardar el cambio.'); void refresh(); }
    }, 450));
  };

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.canvas-node')) return;
    const start = { x: event.clientX, y: event.clientY, viewport: viewportRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: React.PointerEvent<HTMLDivElement>) => setViewport({ ...start.viewport, x: start.viewport.x + next.clientX - start.x, y: start.viewport.y + next.clientY - start.y });
    const up = (next: React.PointerEvent<HTMLDivElement>) => { next.currentTarget.releasePointerCapture(next.pointerId); next.currentTarget.onpointermove = null; next.currentTarget.onpointerup = null; };
    event.currentTarget.onpointermove = move as unknown as ((this: GlobalEventHandlers, ev: PointerEvent) => unknown);
    event.currentTarget.onpointerup = up as unknown as ((this: GlobalEventHandlers, ev: PointerEvent) => unknown);
  };

  const startDrag = (event: React.PointerEvent, item: CanvasItem) => {
    if (consultationMode || (event.target as HTMLElement).closest('button,input,textarea,a,label')) return;
    event.stopPropagation();
    const start = { clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y };
    const pointerId = event.pointerId;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(pointerId);
    const onMove = (next: PointerEvent) => {
      const zoom = viewportRef.current.zoom;
      const x = start.x + (next.clientX - start.clientX) / zoom;
      const y = start.y + (next.clientY - start.clientY) / zoom;
      setItems(current => current.map(value => value.id === item.id ? { ...value, x, y } : value));
    };
    const onUp = (next: PointerEvent) => {
      target.releasePointerCapture(pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      const zoom = viewportRef.current.zoom;
      void patchItem(item.id, { x: start.x + (next.clientX - start.clientX) / zoom, y: start.y + (next.clientY - start.clientY) / zoom });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
    const surface = surfaceRef.current?.getBoundingClientRect();
    const px = (clientX ?? (surface ? surface.left + surface.width / 2 : 0)) - (surface?.left || 0);
    const py = (clientY ?? (surface ? surface.top + surface.height / 2 : 0)) - (surface?.top || 0);
    setViewport(current => {
      const zoom = Math.min(2.2, Math.max(.35, nextZoom));
      const worldX = (px - current.x) / current.zoom;
      const worldY = (py - current.y) / current.zoom;
      return { zoom, x: px - worldX * zoom, y: py - worldY * zoom };
    });
  };

  const upload = async (file: File) => {
    const base64 = await fileToBase64(file);
    const stored = await uploadCanvasFile({ name: file.name, mimeType: file.type || 'application/octet-stream', base64 });
    const type: CanvasItemType = stored.mimeType.startsWith('image/') ? 'image' : 'file';
    const response = await createCanvasItem({ itemType: type, title: file.name, content: { url: stored.url, name: stored.name, mimeType: stored.mimeType, size: stored.size }, x: 120, y: 120, width: type === 'image' ? 360 : 280, height: type === 'image' ? 260 : 140 });
    setItems(current => [...current, response.item]);
  };

  return (
    <section className="view active canvas-page">
      <div className="canvas-toolbar card">
        <div><span className="eyebrow">Espacio visual compartido</span><h2>Canvas de proyectos</h2></div>
        <div className="canvas-tools">
          <Button disabled={consultationMode} onClick={() => addItem('sticky')}>Nota</Button>
          <Button disabled={consultationMode} onClick={() => addItem('text')}>Texto</Button>
          <Button disabled={consultationMode} onClick={() => addItem('checklist')}>Checklist</Button>
          <Button disabled={consultationMode} onClick={() => addItem('task-group')}>Grupo de tareas</Button>
          <Button disabled={consultationMode} onClick={() => addItem('link')}>Enlace</Button>
          <label className={`btn ${consultationMode ? 'disabled' : ''}`}>Archivo<input type="file" disabled={consultationMode} accept="image/*,.pdf,.docx,.xlsx,.txt" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} /></label>
        </div>
        <div className="canvas-zoom"><button onClick={() => zoomAt(viewport.zoom - .15)}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button onClick={() => zoomAt(viewport.zoom + .15)}>+</button><button onClick={() => setViewport({ x: 140, y: 100, zoom: 1 })}>Centrar</button></div>
      </div>
      {message && <div className="tool-info">{message}</div>}
      <div ref={surfaceRef} className="infinite-canvas" onPointerDown={startPan} onWheel={event => { event.preventDefault(); zoomAt(viewport.zoom * (event.deltaY > 0 ? .9 : 1.1), event.clientX, event.clientY); }}>
        <div className="canvas-origin" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          {items.map(item => <CanvasNode key={item.id} item={item} tasks={tasks} consultationMode={consultationMode} onDrag={startDrag} onPatch={patch => patchItem(item.id, patch)} onDelete={async () => { await deleteCanvasItem(item.id); setItems(current => current.filter(value => value.id !== item.id)); }} />)}
        </div>
        {!items.length && <div className="canvas-empty"><strong>El canvas está vacío</strong><span>Agregá una nota, un checklist, un enlace o un archivo.</span></div>}
      </div>
    </section>
  );
}

function CanvasNode({ item, tasks, consultationMode, onDrag, onPatch, onDelete }: { item: CanvasItem; tasks: TaskItem[]; consultationMode: boolean; onDrag: (event: React.PointerEvent, item: CanvasItem) => void; onPatch: (patch: Partial<CanvasItem>) => void; onDelete: () => void }) {
  const content = item.content || {};
  const updateText = (text: string) => onPatch({ content: { ...content, text } });
  return <article className={`canvas-node canvas-node-${item.itemType}`} onPointerDown={event => onDrag(event, item)} style={{ transform: `translate(${item.x}px, ${item.y}px)`, width: item.width, minHeight: item.height, zIndex: item.zIndex, '--node-color': item.color || '#bfdbfe' } as React.CSSProperties}>
    <header><input value={item.title} disabled={consultationMode} placeholder="Sin título" onChange={event => onPatch({ title: event.target.value })} /><button disabled={consultationMode} onClick={onDelete}>×</button></header>
    {(item.itemType === 'sticky' || item.itemType === 'text') && <textarea value={String(content.text || '')} disabled={consultationMode} onChange={event => updateText(event.target.value)} />}
    {item.itemType === 'checklist' && <div className="canvas-checklist">{(Array.isArray(content.items) ? content.items : []).map((raw, index) => { const value = raw as { text?: string; checked?: boolean }; return <label key={index}><input type="checkbox" checked={Boolean(value.checked)} disabled={consultationMode} onChange={event => { const list = [...(content.items as Array<Record<string, unknown>> || [])]; list[index] = { ...list[index], checked: event.target.checked }; onPatch({ content: { ...content, items: list } }); }} /><input value={String(value.text || '')} disabled={consultationMode} onChange={event => { const list = [...(content.items as Array<Record<string, unknown>> || [])]; list[index] = { ...list[index], text: event.target.value }; onPatch({ content: { ...content, items: list } }); }} /></label>; })}<button disabled={consultationMode} onClick={() => onPatch({ content: { ...content, items: [...(content.items as unknown[] || []), { text: 'Nuevo paso', checked: false }] } })}>+ Paso</button></div>}
    {item.itemType === 'image' && <img src={String(content.url || '')} alt={item.title || 'Imagen del canvas'} />}
    {item.itemType === 'file' && <a href={String(content.url || '#')} target="_blank" rel="noreferrer"><span>📎</span>{String(content.name || item.title || 'Abrir archivo')}</a>}
    {item.itemType === 'link' && <div className="canvas-link"><input value={String(content.text || '')} disabled={consultationMode} onChange={event => onPatch({ content: { ...content, text: event.target.value } })} /><input value={String(content.url || '')} disabled={consultationMode} onChange={event => onPatch({ content: { ...content, url: event.target.value } })} /><a href={safeLink(String(content.url || ''))} target="_blank" rel="noreferrer">Abrir enlace</a></div>}
    {item.itemType === 'task-group' && <TaskGroup content={content} tasks={tasks} disabled={consultationMode} onChange={taskIds => onPatch({ content: { ...content, taskIds } })} />}
  </article>;
}

function TaskGroup({ content, tasks, disabled, onChange }: { content: Record<string, unknown>; tasks: TaskItem[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const ids = Array.isArray(content.taskIds) ? content.taskIds.map(String) : [];
  const selected = ids.map(id => tasks.find(task => task.id === id)).filter(Boolean) as TaskItem[];
  return <div className="canvas-task-group"><details><summary>Agregar tareas</summary><div className="canvas-task-picker">{tasks.filter(task => !task.done).map(task => <label key={task.id}><input type="checkbox" disabled={disabled} checked={ids.includes(task.id)} onChange={event => onChange(event.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} /><span>{task.titulo}</span></label>)}</div></details><div className="canvas-task-list">{selected.map(task => <div key={task.id} className={task.done ? 'done' : ''}><span>{task.done ? '✓' : '○'}</span><strong>{task.titulo}</strong><small>{task.prioridad}</small></div>)}{!selected.length && <p>Elegí tareas para armar este grupo.</p>}</div></div>;
}

function screenToWorld(x: number, y: number, viewport: { x: number; y: number; zoom: number }) { return { x: (x - viewport.x) / viewport.zoom, y: (y - viewport.y) / viewport.zoom }; }
function safeLink(url: string) { return /^https?:\/\//i.test(url) ? url : '#'; }
function fileToBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

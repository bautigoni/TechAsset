import { useEffect, useMemo, useState } from 'react';
import type { Device } from '../../types';
import { Button, Collapse, Checkbox, EmptyState, ErrorState, Input, InlineConfirm, icons, useStatusLine } from '../../ui';
import { createDeviceGroup, deleteDeviceGroup, getDeviceGroups, updateDeviceGroup, type DeviceGroup } from '../../services/devicesApi';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { matchesDeviceSearch } from '../../utils/deviceSearch';
import { errorMessage } from '../layout/Feedback';
import { DevicePanel } from './DevicePanels';
import { sortDevices } from './deviceView';

const PICKER_PAGE = 24;

/**
 * Grupos de equipos (ej. "Carro móvil 5to"), en línea. Un equipo está en un
 * solo grupo: agregarlo acá lo saca del anterior (se avisa al lado del equipo).
 * El nombre de cada equipo abre su ficha.
 */
export function DeviceGroupsPanel({ devices, consultationMode, onOpenDevice, onCount, onClose }: {
  devices: Device[];
  consultationMode: boolean;
  onOpenDevice: (etiqueta: string) => void;
  onCount?: (count: number) => void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<DeviceGroup[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<DeviceGroup | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PICKER_PAGE);
  const [askDelete, setAskDelete] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const status = useStatusLine();

  useAssistantContext(selected ? { type: 'group', id: String(selected.id), label: selected.name, data: { members: selected.members.map(item => item.etiqueta), description: selected.description } } : null);

  const refresh = async () => {
    const response = await getDeviceGroups();
    setGroups(response.items);
    onCount?.(response.items.length);
    return response.items;
  };
  useEffect(() => {
    refresh().catch(reason => { setGroups([]); setLoadError(errorMessage(reason, 'No se pudieron cargar los grupos.')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (group: DeviceGroup | null) => {
    setSelected(group);
    setName(group?.name || '');
    setDescription(group?.description || '');
    setTags(group?.members.map(item => item.etiqueta) || []);
    setAskDelete(false);
  };

  // Equipo → grupo actual (para avisar que agregarlo lo mueve).
  const groupOf = useMemo(() => {
    const map = new Map<string, DeviceGroup>();
    for (const group of groups || []) for (const member of group.members) map.set(member.etiqueta, group);
    return map;
  }, [groups]);

  const sorted = useMemo(() => sortDevices(devices, 'operational'), [devices]);
  // Marcados primero, después el resto filtrado por la búsqueda flexible.
  const pickerList = useMemo(() => {
    const filtered = sorted.filter(device => matchesDeviceSearch(device, query));
    return [...filtered.filter(device => tags.includes(device.etiqueta)), ...filtered.filter(device => !tags.includes(device.etiqueta))];
  }, [sorted, query, tags]);

  const save = async () => {
    if (!name.trim() || consultationMode) return;
    setBusy('save');
    try {
      if (selected) await updateDeviceGroup(selected.id, { name: name.trim(), description, deviceTags: tags });
      else await createDeviceGroup({ name: name.trim(), description, deviceTags: tags });
      const savedName = name.trim();
      const items = await refresh();
      edit(items.find(group => group.name === savedName) || null);
      status.show({ tone: 'ok', message: `Grupo "${savedName}" guardado.` });
    } catch (reason) {
      // Ej. 409 "Ya existe un grupo con ese nombre.".
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo guardar el grupo.') });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy('delete');
    try {
      await deleteDeviceGroup(selected.id);
      const removed = selected.name;
      await refresh();
      edit(null);
      status.show({ tone: 'ok', message: `Grupo "${removed}" eliminado. Los equipos no se borraron.` });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo eliminar el grupo.') });
    } finally {
      setBusy(null);
      setAskDelete(false);
    }
  };

  const toggle = (tag: string) => setTags(current => (current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]));

  return (
    <DevicePanel title="Grupos" label="Grupos de dispositivos" note="Un equipo está en un solo grupo: si lo agregás acá, sale del anterior." onClose={onClose}>
      {loadError && <ErrorState message={loadError} />}
      <div className="dv-groups">
        <div className="dv-groups-list" role="group" aria-label="Grupos">
          <Button size="sm" disabled={consultationMode} icon={<icons.IconPlus size={14} />} onClick={() => edit(null)}>Nuevo grupo</Button>
          {(groups || []).map(group => (
            <button key={group.id} type="button" className="dv-group-item" aria-pressed={selected?.id === group.id} onClick={() => edit(group)}>
              <span className="dv-ell">{group.name}</span>
              <span className="ui-mono dv-muted">{group.members.length}</span>
            </button>
          ))}
          {groups && !groups.length && !loadError && <span className="dv-muted">Todavía no hay grupos. Ejemplo: “Carro móvil 5to”.</span>}
        </div>
        <div className="dv-groups-editor" data-scanner-ignore="">
          <div className="dv-two">
            <Input label={selected ? `Nombre (editando ${selected.name})` : 'Nombre del grupo nuevo'} value={name} onValueChange={setName} placeholder="Ej. Carro móvil 5to" disabled={consultationMode} autoComplete="off" />
            <Input label="Descripción" value={description} onValueChange={setDescription} placeholder="Opcional" disabled={consultationMode} autoComplete="off" />
          </div>
          <div className="dv-picker-head">
            <span className="dv-label">Miembros <span className="ui-mono dv-muted">{tags.length}</span></span>
            <Input aria-label="Filtrar equipos para el grupo" prefix={<icons.IconSearch size={14} />} value={query} onValueChange={value => { setQuery(value); setLimit(PICKER_PAGE); }} placeholder="touch 3, D14…" autoComplete="off" className="dv-picker-search" />
          </div>
          <div className="dv-picker">
            {pickerList.slice(0, limit).map(device => {
              const other = groupOf.get(device.etiqueta);
              const moving = other && other.id !== selected?.id && tags.includes(device.etiqueta);
              return (
                <div key={device.etiqueta} className="dv-pick">
                  <Checkbox ariaLabel={`Incluir ${device.etiqueta} en el grupo`} checked={tags.includes(device.etiqueta)} disabled={consultationMode} onCheckedChange={() => toggle(device.etiqueta)} />
                  <button type="button" className="dv-pick-name" onClick={() => onOpenDevice(device.etiqueta)} aria-label={`Abrir la ficha de ${device.etiqueta}`}>
                    <span className="dv-nowrap">{getOperationalAlias(device) || device.dispositivo}</span>
                    <span className="ui-mono dv-muted dv-nowrap">{device.etiqueta}</span>
                    {other && other.id !== selected?.id && <span className={`dv-ell ${moving ? 'dv-warn' : 'dv-muted'}`}>{moving ? `sale de ${other.name}` : `en ${other.name}`}</span>}
                  </button>
                </div>
              );
            })}
            {!pickerList.length && <EmptyState compact title="Ningún equipo coincide con esa búsqueda." />}
          </div>
          {pickerList.length > limit && (
            <div className="dv-more">
              <span className="dv-muted">Mostrando <span className="ui-mono">{limit}</span> de <span className="ui-mono">{pickerList.length}</span></span>
              <Button size="sm" onClick={() => setLimit(value => value + PICKER_PAGE * 2)}>Ver más</Button>
            </div>
          )}
          <Collapse open={Boolean(askDelete && selected)} unmountOnClose>
            <InlineConfirm danger message={`¿Eliminar el grupo “${selected?.name || ''}”?`} detail="Los equipos no se borran." confirmLabel="Eliminar grupo" busy={busy === 'delete'} onConfirm={() => void remove()} onCancel={() => setAskDelete(false)} />
          </Collapse>
          <div className="dv-form-actions">
            <Button variant="primary" disabled={consultationMode || !name.trim()} loading={busy === 'save'} onClick={() => void save()}>Guardar grupo</Button>
            {selected && !consultationMode && <Button variant="danger" aria-expanded={askDelete} onClick={() => setAskDelete(true)}>Eliminar</Button>}
          </div>
          {status.element}
        </div>
      </div>
    </DevicePanel>
  );
}

import { useEffect, useState } from 'react';
import type { Device } from '../../types';
import { createDeviceGroup, deleteDeviceGroup, getDeviceGroups, updateDeviceGroup, type DeviceGroup } from '../../services/devicesApi';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { confirmDialog, toastError } from '../layout/Feedback';

export function DeviceGroupsManager({
  devices,
  consultationMode,
  onOpenDevice,
  onClose
}: {
  devices: Device[];
  consultationMode: boolean;
  onOpenDevice: (device: Device) => void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [selected, setSelected] = useState<DeviceGroup | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  useAssistantContext(
    selected
      ? {
          type: 'group',
          id: String(selected.id),
          label: selected.name,
          data: { members: selected.members.map(item => item.etiqueta), description: selected.description }
        }
      : null
  );
  const refresh = async () => {
    const response = await getDeviceGroups();
    setGroups(response.items);
  };
  useEffect(() => {
    refresh().catch(() => setMessage('No se pudieron cargar los grupos.'));
  }, []);
  const edit = (group: DeviceGroup | null) => {
    setSelected(group);
    setName(group?.name || '');
    setDescription(group?.description || '');
    setTags(group?.members.map(item => item.etiqueta) || []);
  };
  const save = async () => {
    if (!name.trim()) return;
    try {
      if (selected) await updateDeviceGroup(selected.id, { name, description, deviceTags: tags });
      else await createDeviceGroup({ name, description, deviceTags: tags });
    } catch (reason) {
      // Ej. 409 "Ya existe un grupo con ese nombre.": antes no se avisaba nada.
      toastError(reason, 'No se pudo guardar el grupo.');
      return;
    }
    await refresh().catch(reason => toastError(reason, 'No se pudieron recargar los grupos.'));
    edit(null);
    setMessage('Grupo guardado.');
  };
  return (
    <Modal title="Grupos de dispositivos" onClose={onClose} wide>
      <div className="device-groups-layout">
        <aside className="device-groups-list">
          <Button disabled={consultationMode} variant="primary" onClick={() => edit(null)}>
            + Nuevo grupo
          </Button>
          {groups.map(group => (
            <button key={group.id} className={selected?.id === group.id ? 'active' : ''} onClick={() => edit(group)}>
              <strong>{group.name}</strong>
              <span>{group.members.length} dispositivos</span>
            </button>
          ))}
        </aside>
        <section className="device-group-editor">
          <label>
            Nombre
            <input
              className="input"
              disabled={consultationMode}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Ej. Carro móvil 5to"
            />
          </label>
          <label>
            Descripción
            <textarea
              className="input"
              disabled={consultationMode}
              value={description}
              onChange={event => setDescription(event.target.value)}
            />
          </label>
          <div className="device-group-picker">
            {devices.map(device => (
              <label key={device.etiqueta}>
                <input
                  type="checkbox"
                  disabled={consultationMode}
                  checked={tags.includes(device.etiqueta)}
                  onChange={event =>
                    setTags(event.target.checked ? [...tags, device.etiqueta] : tags.filter(tag => tag !== device.etiqueta))
                  }
                />
                <button type="button" onClick={() => onOpenDevice(device)}>
                  {device.etiqueta} · {getOperationalAlias(device) || device.dispositivo}
                </button>
              </label>
            ))}
          </div>
          <div className="actions">
            {selected && !consultationMode && (
              <Button
                onClick={async () => {
                  if (await confirmDialog({ title: 'Eliminar grupo', message: `¿Eliminar el grupo ${selected.name}? Los equipos no se borran.`, confirmLabel: 'Eliminar', danger: true })) {
                    try {
                      await deleteDeviceGroup(selected.id);
                    } catch (reason) {
                      toastError(reason, 'No se pudo eliminar el grupo.');
                      return;
                    }
                    await refresh().catch(reason => toastError(reason, 'No se pudieron recargar los grupos.'));
                    edit(null);
                  }
                }}
              >
                Eliminar
              </Button>
            )}
            <Button variant="primary" disabled={consultationMode || !name.trim()} onClick={save}>
              Guardar grupo
            </Button>
          </div>
          {message && <div className="tool-info">{message}</div>}
        </section>
      </div>
    </Modal>
  );
}

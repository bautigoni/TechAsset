import { useEffect, useState } from 'react';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { Button } from '../layout/Button';

type ToggleOption = { label: string; requiresDetail?: boolean; requiresCourse?: boolean };

const defaults = {
  roles: ['DOE', 'Alumno', 'Maestra', 'Profesor', 'Directivo', 'Preceptor', 'Otro'],
  locations: [
    { label: 'Aula', requiresCourse: true },
    { label: 'DOE' },
    { label: 'Planificacion movil' },
    { label: 'Direccion / Coordinacion' },
    { label: 'Departamento' },
    { label: 'Otro', requiresDetail: true }
  ],
  motives: [
    { label: 'Planificacion' },
    { label: 'Prestamo autorizado' },
    { label: 'Proyecto / actividad de aula' },
    { label: 'Evaluacion' },
    { label: 'Soporte temporal' },
    { label: 'Otro', requiresDetail: true }
  ],
  grades: ['1N', '1F', '2N', '2F', '3N', '3F', '4N', '4F', '5N', '5F', '6N', '6F'],
  categories: ['Tablet', 'Notebook', 'Chromebook', 'Camara', 'Proyector', 'Router', 'Impresora', 'Otro']
};

export function LoanSettingsPanel() {
  const [roles, setRoles] = useState<string[]>(defaults.roles);
  const [locations, setLocations] = useState<ToggleOption[]>(defaults.locations);
  const [motives, setMotives] = useState<ToggleOption[]>(defaults.motives);
  const [grades, setGrades] = useState<string[]>(defaults.grades);
  const [categories, setCategories] = useState<string[]>(defaults.categories);
  const [newRole, setNewRole] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newMotive, setNewMotive] = useState('');
  const [newGrade, setNewGrade] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getSiteSettings().then(response => {
      const settings = response.settings || {};
      setRoles(readStringList(settings['loan.roles'], defaults.roles));
      setLocations(readOptionList(settings['loan.locations'], defaults.locations));
      setMotives(readOptionList(settings['loan.motives'], defaults.motives));
      setGrades(readStringList(settings['loan.gradeOptions'], defaults.grades));
      setCategories(readStringList(settings['devices.categories'], defaults.categories));
    }).catch(() => {});
  }, []);

  const save = async () => {
    await updateSiteSettings({
      'loan.roles': roles,
      'loan.locations': locations,
      'loan.motives': motives,
      'loan.gradeOptions': grades,
      'devices.categories': categories
    });
    setMessage('Configuracion de prestamos guardada.');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Configuracion de sede</h3>
        <Button variant="primary" onClick={save}>Guardar opciones</Button>
      </div>
      <div className="settings-grid">
        <StringEditor title="Roles de prestamo" items={roles} value={newRole} onValue={setNewRole} onAdd={() => addString(newRole, roles, setRoles, setNewRole)} onRemove={item => setRoles(values => values.filter(value => value !== item))} />
        <StringEditor title="Cursos / grados" items={grades} value={newGrade} onValue={setNewGrade} onAdd={() => addString(newGrade, grades, setGrades, setNewGrade)} onRemove={item => setGrades(values => values.filter(value => value !== item))} />
        <StringEditor title="Categorias de dispositivos" items={categories} value={newCategory} onValue={setNewCategory} onAdd={() => addString(newCategory, categories, setCategories, setNewCategory)} onRemove={item => setCategories(values => values.filter(value => value !== item))} />
        <OptionEditor title="Ubicaciones" items={locations} value={newLocation} onValue={setNewLocation} onAdd={() => addOption(newLocation, locations, setLocations, setNewLocation)} onChange={setLocations} />
        <OptionEditor title="Motivos" items={motives} value={newMotive} onValue={setNewMotive} onAdd={() => addOption(newMotive, motives, setMotives, setNewMotive)} onChange={setMotives} showCourse={false} />
      </div>
      {message && <div className="tool-info">{message}</div>}
    </section>
  );
}

function StringEditor({ title, items, value, onValue, onAdd, onRemove }: { title: string; items: string[]; value: string; onValue: (value: string) => void; onAdd: () => void; onRemove: (item: string) => void }) {
  return (
    <div className="settings-editor">
      <h4>{title}</h4>
      <div className="inline-add">
        <input className="input" value={value} onChange={event => onValue(event.target.value)} placeholder="Agregar opcion" />
        <Button onClick={onAdd}>Agregar</Button>
      </div>
      <div className="pill-list">
        {items.map(item => (
          <span className="setting-pill" key={item}>
            {item}
            <button type="button" onClick={() => onRemove(item)}>Desactivar</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function OptionEditor({ title, items, value, onValue, onAdd, onChange, showCourse = true }: { title: string; items: ToggleOption[]; value: string; onValue: (value: string) => void; onAdd: () => void; onChange: (items: ToggleOption[]) => void; showCourse?: boolean }) {
  const update = (index: number, patch: Partial<ToggleOption>) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return (
    <div className="settings-editor wide">
      <h4>{title}</h4>
      <div className="inline-add">
        <input className="input" value={value} onChange={event => onValue(event.target.value)} placeholder="Agregar opcion" />
        <Button onClick={onAdd}>Agregar</Button>
      </div>
      <div className="option-list">
        {items.map((item, index) => (
          <div className="option-row" key={item.label}>
            <input className="input" value={item.label} onChange={event => update(index, { label: event.target.value })} />
            <label><input type="checkbox" checked={Boolean(item.requiresDetail)} onChange={event => update(index, { requiresDetail: event.target.checked })} /> Detalle</label>
            {showCourse && <label><input type="checkbox" checked={Boolean(item.requiresCourse)} onChange={event => update(index, { requiresCourse: event.target.checked })} /> Curso</label>}
            <button type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>Desactivar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function addString(value: string, items: string[], onChange: (items: string[]) => void, clear: (value: string) => void) {
  const clean = value.trim();
  if (!clean || items.some(item => item.toLowerCase() === clean.toLowerCase())) return;
  onChange([...items, clean]);
  clear('');
}

function addOption(value: string, items: ToggleOption[], onChange: (items: ToggleOption[]) => void, clear: (value: string) => void) {
  const clean = value.trim();
  if (!clean || items.some(item => item.label.toLowerCase() === clean.toLowerCase())) return;
  onChange([...items, { label: clean }]);
  clear('');
}

function readStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(item => {
    const option = item as { label?: string; nombre?: string };
    return typeof item === 'string' ? item : String(option.label || option.nombre || '');
  }).map(item => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function readOptionList(value: unknown, fallback: ToggleOption[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(item => {
    const option = item as { label?: string; nombre?: string; requiresDetail?: boolean; requiresCourse?: boolean };
    return typeof item === 'string' ? { label: item } : {
      label: String(option.label || option.nombre || '').trim(),
      requiresDetail: Boolean(option.requiresDetail),
      requiresCourse: Boolean(option.requiresCourse)
    };
  }).filter(item => item.label);
  return items.length ? items : fallback;
}

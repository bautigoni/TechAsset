import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Button, ErrorState, IconButton, SkeletonRows, Switch } from '../../ui';
import { cx } from '../../ui/util';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { appScroller } from '../../utils/scroll';
import {
  TOGGLEABLE_MODULES, enabledModuleSet, moduleOrder, MODULES_ORDER_SETTINGS_KEY, MODULES_SETTINGS_KEY, type ModuleKey
} from '../../utils/modules';
import { Card, CardFoot, Notice, dropDraft, errorText, peekDraft, useDirty, useKeepDraft } from './settingsKit';

type Draft = { order: ModuleKey[]; enabled: ModuleKey[] };
type Status = { tone: 'ok' | 'bad'; text: string } | null;

const META = new Map(TOGGLEABLE_MODULES.map(mod => [mod.key, mod]));

function countChanges(saved: Draft, draft: Draft) {
  let changes = 0;
  draft.order.forEach((key, index) => { if (saved.order[index] !== key) changes += 1; });
  const on = new Set(saved.enabled);
  const next = new Set(draft.enabled);
  TOGGLEABLE_MODULES.forEach(mod => { if (on.has(mod.key) !== next.has(mod.key)) changes += 1; });
  return changes;
}

/**
 * Módulos de la sede: prender/apagar y ordenar (flechas, arrastrando la
 * manija o con las flechas del teclado sobre ella). Se guarda todo junto, con
 * conteo de cambios, Descartar y aviso de cambios sin guardar. Al guardar el
 * menú se reordena en el momento (onChanged → reloadSiteSettings del App).
 */
export function ModulesPanel({ header, readOnly, siteCode, onChanged }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string; onChanged?: () => void }) {
  const draftKey = `${siteCode}:modulos`;
  const [restored, setRestored] = useState(() => peekDraft<Draft>(draftKey));
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(() => restored);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [dragging, setDragging] = useState<ModuleKey | null>(null);
  const [announce, setAnnounce] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = () => {
    setLoadError('');
    getSiteSettings()
      .then(response => {
        const fresh: Draft = { order: moduleOrder(response.settings), enabled: [...enabledModuleSet(response.settings)] as ModuleKey[] };
        setSaved(fresh);
        setDraft(current => current || fresh);
      })
      .catch(reason => setLoadError(errorText(reason, 'No se pudo cargar la configuración de módulos.')));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const changes = saved && draft ? countChanges(saved, draft) : 0;
  useDirty('modulos', changes > 0);
  useKeepDraft(draftKey, draft, changes > 0);

  const enabled = useMemo(() => new Set(draft?.enabled || []), [draft]);

  const edit = (fn: (current: Draft) => Draft) => {
    if (readOnly) return;
    setDraft(current => (current ? fn(current) : current));
    setStatus(null);
  };
  const toggle = (key: ModuleKey) => edit(current => ({ ...current, enabled: enabled.has(key) ? current.enabled.filter(item => item !== key) : [...current.enabled, key] }));
  const moveTo = (key: ModuleKey, target: number) => edit(current => {
    const from = current.order.indexOf(key);
    if (from < 0 || target < 0 || target >= current.order.length || target === from) return current;
    const order = [...current.order];
    order.splice(from, 1);
    order.splice(target, 0, key);
    setAnnounce(`${META.get(key)?.label} en la posición ${target + 1} de ${order.length}.`);
    return { ...current, order };
  });

  /* ── Arrastrar desde la manija (pointer events: mouse, lápiz y touch) ── */
  const drag = useRef<{ key: ModuleKey; mids: number[]; startScroll: number; pointerId: number } | null>(null);
  const onGripDown = (event: PointerEvent<HTMLButtonElement>, key: ModuleKey) => {
    if (readOnly || event.button !== 0) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-module-row]') || [])];
    // Una sola lectura de layout al empezar; después se compensa el scroll.
    const mids = rows.map(row => { const rect = row.getBoundingClientRect(); return rect.top + rect.height / 2; });
    drag.current = { key, mids, startScroll: appScroller()?.scrollTop || 0, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(key);
  };
  const onGripMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || !draft) return;
    const scroller = appScroller();
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (event.clientY < box.top + 48) scroller.scrollBy({ top: -12 });
      else if (event.clientY > box.bottom - 48) scroller.scrollBy({ top: 12 });
    }
    const y = event.clientY + ((scroller?.scrollTop || 0) - state.startScroll);
    // Destino = cuántos de los OTROS lugares quedaron por encima del puntero.
    const current = draft.order.indexOf(state.key);
    const target = state.mids.filter((mid, index) => index !== current && mid < y).length;
    if (current !== target) moveTo(state.key, target);
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(null);
  };
  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>, key: ModuleKey, index: number) => {
    if (event.key === 'ArrowUp') { event.preventDefault(); moveTo(key, index - 1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); moveTo(key, index + 1); }
    else if (event.key === 'Home') { event.preventDefault(); moveTo(key, 0); }
    else if (event.key === 'End') { event.preventDefault(); moveTo(key, (draft?.order.length || 1) - 1); }
  };
  // El foco sigue a la manija del módulo que se movió con el teclado.
  const focusKey = useRef<ModuleKey | null>(null);
  useEffect(() => {
    if (!focusKey.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-grip="${focusKey.current}"]`)?.focus();
    focusKey.current = null;
  }, [draft]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateSiteSettings({ [MODULES_SETTINGS_KEY]: draft.enabled, [MODULES_ORDER_SETTINGS_KEY]: draft.order });
      setSaved(draft);
      setRestored(null);
      dropDraft(draftKey);
      setStatus({ tone: 'ok', text: 'Guardado. El menú ya muestra el orden nuevo.' });
      onChanged?.();
    } catch (reason) {
      setStatus({ tone: 'bad', text: errorText(reason, 'No se pudieron guardar los módulos.') });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    if (saved) setDraft(saved);
    setRestored(null);
    dropDraft(draftKey);
    setStatus(null);
  };

  if (loadError && !saved) return <>{header()}<ErrorState message={loadError} onRetry={load} /></>;

  const footStatus = status?.text
    || (readOnly ? 'Modo consulta: se ve, no se edita.' : changes ? `Hay ${changes} cambio${changes === 1 ? '' : 's'} sin guardar.` : 'Sin cambios.');
  const footTone = status ? status.tone : changes ? 'warn' : 'muted';

  return (
    <>
      {header()}
      <Card title="Orden del menú" heightKey={Boolean(draft)} meta={draft ? <span className="cfg-mono">{draft.enabled.length} de {TOGGLEABLE_MODULES.length} prendidos</span> : undefined}>
        {restored && changes > 0 && <Notice tone="warn">Recuperamos cambios que no habías guardado.</Notice>}
        {!draft ? <div className="cfg-pad"><SkeletonRows rows={6} /></div> : (
          <div className={cx('cfg-mods', dragging && 'is-dragging')} ref={listRef} role="list" aria-label="Módulos en el orden del menú">
            {draft.order.map((key, index) => {
              const mod = META.get(key);
              if (!mod) return null;
              const on = enabled.has(key);
              return (
                <div key={key} role="listitem" data-module-row={key} className={cx('cfg-mod', dragging === key && 'is-lifted', !on && 'is-off')}>
                  <button
                    type="button"
                    className="cfg-grip"
                    data-grip={key}
                    aria-label={`Mover ${mod.label} (posición ${index + 1}). Arrastrá o usá las flechas.`}
                    disabled={readOnly}
                    onPointerDown={event => onGripDown(event, key)}
                    onPointerMove={onGripMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={event => { focusKey.current = key; onGripKey(event, key, index); }}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </button>
                  <span className="cfg-mono cfg-t3 cfg-mod-pos">{index + 1}</span>
                  <span className="cfg-mod-t">
                    <span className={cx('cfg-strong', !on && 'cfg-t2')}>{mod.label}</span>
                    <span className="cfg-t3 cfg-mod-d">{mod.description}</span>
                  </span>
                  <span className="cfg-t3 cfg-mod-cat">{mod.category}</span>
                  <span className="cfg-mod-arrows">
                    <IconButton size="sm" label={`Subir ${mod.label}`} icon={<ArrowUp size={15} aria-hidden="true" />} disabled={readOnly || index === 0} onClick={() => moveTo(key, index - 1)} />
                    <IconButton size="sm" label={`Bajar ${mod.label}`} icon={<ArrowDown size={15} aria-hidden="true" />} disabled={readOnly || index === draft.order.length - 1} onClick={() => moveTo(key, index + 1)} />
                  </span>
                  <Switch checked={on} disabled={readOnly} ariaLabel={`${on ? 'Apagar' : 'Prender'} ${mod.label}`} onCheckedChange={() => toggle(key)} />
                </div>
              );
            })}
          </div>
        )}
        <span className="ui-sr" aria-live="polite">{announce}</span>
        <CardFoot status={footStatus} tone={footTone}>
          <Button variant="ghost" disabled={!changes || saving || readOnly} onClick={discard}>Descartar</Button>
          <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={!changes || readOnly} onClick={() => void save()}>Guardar módulos</Button>
        </CardFoot>
      </Card>
      <p className="cfg-hint">Inicio y Configuración están siempre. Al guardar, el menú se reordena en el momento para todos los usuarios de la sede.</p>
    </>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, EmptyState, ErrorState, InlineConfirm, Input, NumberField, SkeletonRows, StatusLine } from '../../ui';
import { cx } from '../../ui/util';
import { createInvite, getInvites, getSiteSettings, resendInvite, revokeInvite, type Invite } from '../../services/authApi';
import { formatDate, DATE_ONLY } from '../../utils/formatters';
import { Card, CardBody, CardFoot, ChoiceField, Collapse, CopyButton, errorText } from './settingsKit';
import { MailStatusLine } from './MailStatusLine';

const DEFAULT_TURNOS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'];
const FALLBACK_ROLES = ['Administrador', 'Asistente', 'Consulta'];

type Result = { link: string; emailSent: boolean; hadEmail: boolean; emailError: string } | null;
type RowNote = { key: number; tone: 'ok' | 'bad'; text: string };

const daysLeft = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  const days = Math.ceil(ms / 86400000);
  return days <= 0 ? 'vence hoy' : `vence en ${days} día${days === 1 ? '' : 's'}`;
};

/**
 * Invitaciones de la sede: generar (rol, turno, mail opcional, vencimiento de
 * 1 a 90 días), copiar el link, reenviar la misma invitación y revocar con
 * confirmación en línea. El server limita a 20 por hora (429 con el motivo).
 */
export function InvitesPanel({ header, readOnly, onChanged }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string; onChanged?: () => void }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [roles, setRoles] = useState<string[]>(FALLBACK_ROLES);
  const [turnos, setTurnos] = useState<string[]>(DEFAULT_TURNOS);
  const [role, setRole] = useState('Consulta');
  const [turno, setTurno] = useState('Sin turno');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState<number | null>(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [rowBusy, setRowBusy] = useState(0);
  const [revoking, setRevoking] = useState(0);
  const [notes, setNotes] = useState<Record<number, RowNote>>({});
  const noteSeq = useRef(0);

  const load = () => {
    setLoadError('');
    return getInvites()
      .then(response => setInvites(response.items || []))
      .catch(reason => setLoadError(errorText(reason, 'No se pudieron cargar las invitaciones.')));
  };
  useEffect(() => {
    void load();
    getSiteSettings().then(response => {
      const cfg = response.settings?.['roles.config'];
      if (Array.isArray(cfg) && cfg.length) {
        const names = cfg.map(item => String((item as { name?: string }).name || '')).filter(Boolean);
        if (names.length) {
          setRoles(names);
          setRole(names.find(name => name !== 'Administrador') || names[0]);
        }
      }
      const shifts = response.settings?.['shift.options'];
      if (Array.isArray(shifts) && shifts.length) setTurnos(shifts.map(String));
    }).catch(() => undefined);
  }, []);

  const note = (id: number, value: Omit<RowNote, 'key'>) => {
    noteSeq.current += 1;
    const key = noteSeq.current;
    setNotes(current => ({ ...current, [id]: { ...value, key } }));
  };
  const dropNote = (id: number) => setNotes(current => { const next = { ...current }; delete next[id]; return next; });

  const generate = async () => {
    if (busy || readOnly) return;
    const mail = email.trim().toLowerCase();
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { setError('El mail no parece válido. Dejalo vacío si solo querés el link.'); return; }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await createInvite({ role, turno, email: mail || undefined, expiresInDays: Math.min(90, Math.max(1, days || 14)) });
      setResult({ link: response.invite.registerUrl, emailSent: response.emailSent, hadEmail: Boolean(mail), emailError: (response as { emailError?: string }).emailError || '' });
      setEmail('');
      await load();
      onChanged?.();
    } catch (reason) {
      setError(errorText(reason, 'No se pudo crear la invitación.'));
    } finally {
      setBusy(false);
    }
  };

  // Reenvía la MISMA invitación (no genera un código nuevo).
  const resend = async (invite: Invite) => {
    setRowBusy(invite.id);
    try {
      const response = await resendInvite(invite.id);
      note(invite.id, response.emailSent ? { tone: 'ok', text: `Reenviada a ${invite.email}.` } : { tone: 'bad', text: response.emailError || 'No se pudo reenviar el mail.' });
      await load();
    } catch (reason) {
      note(invite.id, { tone: 'bad', text: errorText(reason, 'No se pudo reenviar la invitación.') });
    } finally {
      setRowBusy(0);
    }
  };

  const revoke = async (invite: Invite) => {
    setRowBusy(invite.id);
    try {
      await revokeInvite(invite.id);
      setRevoking(0);
      note(invite.id, { tone: 'ok', text: `Invitación ${invite.code} revocada: el link ya no sirve.` });
      await load();
      onChanged?.();
    } catch (reason) {
      note(invite.id, { tone: 'bad', text: errorText(reason, 'No se pudo revocar la invitación.') });
    } finally {
      setRowBusy(0);
    }
  };

  const active = (invites || []).filter(invite => invite.status === 'Activa').length;

  return (
    <>
      {header()}
      <MailStatusLine context="invites" />
      <Card title="Nueva invitación" meta="Hasta 20 por hora">
        <CardBody>
          <div className="cfg-stack" data-scanner-ignore="">
            <ChoiceField label="Rol" value={role} disabled={readOnly} options={roles.map(name => ({ value: name, label: name }))} onChange={setRole} />
            <ChoiceField label="Turno" value={turno} disabled={readOnly} options={turnos.map(name => ({ value: name, label: name }))} onChange={setTurno} />
            <div className="cfg-grid">
              <Input
                label="Mail (opcional)"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                disabled={readOnly}
                placeholder="Si lo completás, le mandamos la invitación"
                onValueChange={value => { setEmail(value); setError(''); }}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void generate(); } }}
              />
              <NumberField label="Vence en" unit="días" min={1} max={90} value={days} disabled={readOnly} hint="De 1 a 90 días." onChange={setDays} />
            </div>
          </div>
        </CardBody>
        <CardFoot status={error || (readOnly ? 'Modo consulta: no se pueden generar invitaciones.' : '')} tone={error ? 'bad' : 'muted'}>
          <Button variant="primary" loading={busy} loadingLabel="Generando…" disabled={readOnly} onClick={() => void generate()}>Generar invitación</Button>
        </CardFoot>
        <Collapse open={Boolean(result)}>
          {result && (
            <div className="cfg-result" role="status">
              <span className="cfg-nowrap cfg-strong">Link listo</span>
              <span className="cfg-t2">
                {result.emailSent ? '· mail enviado' : result.hadEmail ? `· el mail no salió${result.emailError ? ` (${result.emailError})` : ''}: compartí el link` : '· compartí el link'}
              </span>
              <code className="cfg-link">{result.link}</code>
              <CopyButton text={result.link} />
            </div>
          )}
        </Collapse>
      </Card>

      <Card title="Invitaciones de la sede" meta={invites ? <span className="cfg-mono">{active} activa{active === 1 ? '' : 's'} · {invites.length} en total</span> : undefined}>
        {loadError && <div className="cfg-pad"><ErrorState message={loadError} onRetry={() => void load()} /></div>}
        {!invites && !loadError && <div className="cfg-pad"><SkeletonRows rows={3} /></div>}
        {invites && !invites.length && (
          <div className="cfg-pad"><EmptyState compact title="Todavía no generaste invitaciones." description="Generá una arriba: el link sirve aunque no cargues mail." /></div>
        )}
        {invites && invites.length > 0 && (
          <div className="cfg-table cfg-ti" role="table" aria-label="Invitaciones">
            <div className="cfg-trow is-head" role="row">
              <span role="columnheader">Código</span><span role="columnheader">Rol y turno</span><span role="columnheader" className="cfg-ti-mail">Mail y envío</span><span role="columnheader">Estado</span><span role="columnheader" className="cfg-ti-act">Acciones</span>
            </div>
            {invites.map(invite => {
              const isActive = invite.status === 'Activa';
              const rowNote = notes[invite.id];
              return (
                <div className="cfg-tgroup" key={invite.id}>
                  <div className="cfg-trow" role="row">
                    <span role="cell" className="cfg-stack-xs">
                      <span className="cfg-mono cfg-break">{invite.code}</span>
                      <span className="cfg-t3">{isActive ? daysLeft(invite.expiresAt) : `creada ${formatDate(invite.createdAt, DATE_ONLY, '')}`}</span>
                    </span>
                    <span role="cell" className="cfg-stack-xs">
                      <span className="cfg-wrap">{invite.role}{invite.kind === 'admin' && <span className="cfg-t3"> · código admin</span>}</span>
                      <span className="cfg-t3">{invite.turno}</span>
                    </span>
                    <span role="cell" className="cfg-stack-xs cfg-ti-mail">
                      <span className={cx('cfg-break', !invite.email && 'cfg-t3')}>{invite.email || 'Solo link'}</span>
                      <span className="cfg-t3">
                        {invite.emailSentAt ? `Enviado ${formatDate(invite.emailSentAt, DATE_ONLY)}` : invite.emailError ? <span className="is-bad">{invite.emailError}</span> : invite.email ? 'Sin registro de envío' : 'sin envío'}
                      </span>
                    </span>
                    <span role="cell" className={cx('cfg-nowrap', isActive ? 'cfg-t2' : 'cfg-t3')}>{invite.status}</span>
                    <span role="cell" className="cfg-ti-act">
                      {isActive && !readOnly && (
                        <>
                          {invite.email && <Button size="sm" variant="ghost" loading={rowBusy === invite.id && revoking !== invite.id} disabled={Boolean(rowBusy)} onClick={() => void resend(invite)}>Reenviar</Button>}
                          <Button size="sm" variant="ghost" className="cfg-danger-text" disabled={Boolean(rowBusy)} aria-expanded={revoking === invite.id} onClick={() => setRevoking(revoking === invite.id ? 0 : invite.id)}>Revocar</Button>
                        </>
                      )}
                    </span>
                  </div>
                  <Collapse open={revoking === invite.id}>
                    <InlineConfirm
                      danger
                      className="cfg-row-confirm"
                      message={`¿Revocar la invitación ${invite.code}?`}
                      detail="El link deja de servir. Si la persona todavía la necesita, vas a tener que generar otra."
                      confirmLabel="Revocar"
                      busy={rowBusy === invite.id}
                      onConfirm={() => void revoke(invite)}
                      onCancel={() => setRevoking(0)}
                    />
                  </Collapse>
                  <Collapse open={Boolean(rowNote)}>
                    {rowNote && <StatusLine key={rowNote.key} className="cfg-row-status" tone={rowNote.tone} message={rowNote.text} onDismiss={() => dropNote(invite.id)} />}
                  </Collapse>
                </div>
              );
            })}
          </div>
        )}
        <CardFoot status="Reenviar manda la misma invitación (no cambia el código). Revocar pide confirmación acá mismo." tone="muted" />
      </Card>
    </>
  );
}

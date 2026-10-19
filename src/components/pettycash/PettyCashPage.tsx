import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, ReceiptText, ShoppingCart } from 'lucide-react';
import type { PettyCashExpense } from '../../types';
import { discardPettyCashReceipt, getPettyCash, savePettyCashConfig, type PettyCashResponse } from '../../services/pettyCashApi';
import { Button, Collapse, ErrorState, Eyebrow, Ring, Skeleton, SkeletonRows, StatusText, Table, TruncatedText, icons, useStatusLine, type Column, type SortState } from '../../ui';
import { CompactEmpty } from '../tools/CompactEmpty';
import { ExpenseForm, MoneyInput, RequestForm, emptyExpense, emptyRequest, useUnsavedWarning, type ExpenseDraft, type RequestDraft } from './PettyForms';
import { RequestItem } from './RequestItem';
import { displayDay, money, moneyDraft, parseMoney } from './money';
import { peekDraft, useKeepDraft } from '../../utils/drafts';
import '../../styles/screens/pettycash.css';

type PettyDraft = { fundOpen: boolean; fundDraft: string; expenseOpen: boolean; expenseDraft: ExpenseDraft; requestOpen: boolean; requestDraft: RequestDraft };
const expenseFilled = (draft: ExpenseDraft) => Boolean(draft.description || draft.amount || draft.supplier || draft.receiptUrl);
const requestFilled = (draft: RequestDraft) => Boolean(draft.description || draft.estimate || draft.supplier || draft.justification || draft.receiptUrl);

const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);
const EXPENSES_STEP = 15;
const RESOLVED_STEP = 6;

/** Mantiene el orden de las solicitudes mientras la pantalla está abierta: resolver una no la hace saltar de lugar. */
function stableOrder(previous: number[], next: number[]) {
  const set = new Set(next);
  const kept = previous.filter(id => set.has(id));
  const known = new Set(kept);
  return [...next.filter(id => !known.has(id)), ...kept];
}

/**
 * Caja chica (etapa 8c). Resumen con anillo de saldo/fondo; "Editar fondo"
 * (solo Jefe TIC), "Registrar gasto" y "Solicitar compra" como botones que
 * abren formularios EN LÍNEA (reemplazan al menú gooey flotante y a los
 * modales). Los borradores sobreviven a cerrar el panel; Cancelar los
 * descarta (y borra el comprobante subido). Gastos en tabla que pasa a
 * filas en angosto; solicitudes a todo el ancho con aprobar/rechazar debajo.
 */
export function PettyCashPage({ consultationMode, siteCode }: { consultationMode: boolean; siteCode?: string }) {
  const [data, setData] = useState<PettyCashResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [retrying, setRetrying] = useState(false);
  // Lo que se estaba cargando sobrevive a salir por el menú y volver (borrador en memoria por sede).
  const draftKey = `${siteCode || 'sede'}:caja-chica`;
  const [saved] = useState(() => peekDraft<PettyDraft>(draftKey));
  const [fundOpen, setFundOpen] = useState(saved?.fundOpen ?? false);
  const [fundDraft, setFundDraft] = useState(saved?.fundDraft ?? '');
  const [fundBusy, setFundBusy] = useState(false);
  const [fundError, setFundError] = useState('');
  const [expenseOpen, setExpenseOpen] = useState(saved?.expenseOpen ?? false);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>(() => saved?.expenseDraft ?? emptyExpense());
  const [requestOpen, setRequestOpen] = useState(saved?.requestOpen ?? false);
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(() => saved?.requestDraft ?? emptyRequest());
  const [order, setOrder] = useState<number[]>([]);
  const [itemMsgs, setItemMsgs] = useState<Record<number, { tone: 'ok' | 'bad'; text: string }>>({});
  const [expensesShown, setExpensesShown] = useState(EXPENSES_STEP);
  const [resolvedShown, setResolvedShown] = useState(RESOLVED_STEP);
  const [sort, setSort] = useState<SortState>(null);
  const status = useStatusLine();
  const fundBtn = useRef<HTMLButtonElement | null>(null);
  const expenseBtn = useRef<HTMLButtonElement | null>(null);
  const requestBtn = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    const response = await getPettyCash();
    setData(response);
    setOrder(current => stableOrder(current, response.requests.map(item => item.id)));
    setLoadError('');
    return response;
  }, []);

  const load = useCallback(async () => {
    try { await refresh(); } catch (reason) { setLoadError(errorText(reason, 'No se pudo cargar la caja chica.')); }
  }, [refresh]);

  useEffect(() => { void load(); }, [load]);

  const retry = async () => { setRetrying(true); await load(); setRetrying(false); };

  const categories = useMemo(() => {
    const set = new Set<string>(['General']);
    data?.expenses.forEach(item => item.category && set.add(item.category));
    data?.requests.forEach(item => item.category && set.add(item.category));
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data]);

  const requests = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.requests.map(item => [item.id, item]));
    return order.map(id => byId.get(id)).filter(Boolean) as PettyCashResponse['requests'];
  }, [data, order]);

  // El orden se aplica a TODOS los gastos y después se recorta ("Ver más"), no solo a los visibles.
  const sortedExpenses = useMemo(() => {
    const list = data?.expenses || [];
    if (!sort) return list;
    const pick = (row: PettyCashExpense) => (sort.key === 'imp' ? row.amount : sort.key === 'desc' ? row.description.toLowerCase() : row.expenseDate);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => { const x = pick(a); const y = pick(b); return (x < y ? -1 : x > y ? 1 : b.id - a.id) * dir; });
  }, [data, sort]);

  const fundAmount = parseMoney(fundDraft);
  const fundDirty = fundOpen && data !== null && fundAmount !== data.config.initialAmount;
  const expenseDirty = expenseFilled(expenseDraft);
  const requestDirty = requestFilled(requestDraft);
  // El aviso del navegador vale aunque el formulario esté plegado (el borrador sigue acá).
  useUnsavedWarning(fundDirty || expenseDirty || requestDirty);
  useKeepDraft<PettyDraft>(draftKey, { fundOpen, fundDraft, expenseOpen, expenseDraft, requestOpen, requestDraft }, fundDirty || expenseDirty || requestDirty);
  const restoredNote = useRef(Boolean(saved));
  useEffect(() => {
    if (!restoredNote.current) return;
    restoredNote.current = false;
    status.show({ tone: 'info', message: 'Recuperamos lo que estabas cargando antes de salir de la caja chica.' });
  }, [status]);

  if (!data) {
    return (
      <section className="pc-page" aria-label="Caja chica" aria-busy={!loadError}>
        <header className="pc-head"><div><Eyebrow>Fondo fijo{siteCode ? ` · ${siteCode}` : ''}</Eyebrow><h1 className="pc-h1">Caja chica</h1></div></header>
        {loadError ? (
          <ErrorState message={<>{loadError} No mostramos un saldo viejo para no confundir.</>} retrying={retrying} onRetry={() => void retry()} />
        ) : (
          <>
            <div className="pc-card pc-sum" aria-hidden="true">
              <Skeleton width="8rem" height="0.75rem" />
              <Skeleton width="12rem" height="2.25rem" />
              <Skeleton width="16rem" height="0.75rem" />
            </div>
            <div className="pc-card pc-skel-list" aria-hidden="true"><SkeletonRows rows={4} /></div>
          </>
        )}
      </section>
    );
  }

  const { manager, canRequest } = data.permissions;
  const fund = data.config.initialAmount;
  const balance = data.balance;
  const pendingCount = data.requests.filter(item => item.status === 'Pendiente').length;
  const pendingList = requests.filter(item => item.status === 'Pendiente' || itemMsgs[item.id]);
  const resolvedList = requests.filter(item => item.status !== 'Pendiente' && !itemMsgs[item.id]);
  const pct = fund > 0 ? Math.round((Math.max(0, balance) / fund) * 100) : 0;

  const saveFund = async (event?: FormEvent) => {
    event?.preventDefault();
    if (fundBusy) return;
    if (fundAmount === null || Number.isNaN(fundAmount) || fundAmount < 0) { setFundError('Poné un importe válido (0 o más).'); return; }
    setFundBusy(true);
    setFundError('');
    try {
      await savePettyCashConfig({ initialAmount: fundAmount, requestsEnabled: true });
      setFundOpen(false);
      fundBtn.current?.focus({ preventScroll: true });
      status.show({ tone: 'ok', message: `Fondo actualizado a ${money(fundAmount)}.` });
      await refresh().catch(() => status.show({ tone: 'warn', message: 'El fondo se guardó, pero no se pudo recargar el saldo.', retry: { onRetry: () => load() } }));
    } catch (reason) {
      setFundError(errorText(reason, 'No se pudo actualizar el fondo.'));
    } finally {
      setFundBusy(false);
    }
  };

  const afterSave = async (message: string, which: 'expense' | 'request') => {
    if (which === 'expense') { setExpenseOpen(false); setExpenseDraft(emptyExpense()); expenseBtn.current?.focus({ preventScroll: true }); }
    else { setRequestOpen(false); setRequestDraft(emptyRequest()); requestBtn.current?.focus({ preventScroll: true }); }
    status.show({ tone: 'ok', message });
    await refresh().catch(() => status.show({ tone: 'warn', message: `${message} No se pudo recargar la lista.`, retry: { onRetry: () => load() } }));
  };

  const cancelExpense = () => {
    if (expenseDraft.receiptUrl) void discardPettyCashReceipt(expenseDraft.receiptUrl).catch(() => {});
    setExpenseOpen(false);
    setExpenseDraft(emptyExpense());
    expenseBtn.current?.focus({ preventScroll: true });
  };
  const cancelRequest = () => {
    if (requestDraft.receiptUrl) void discardPettyCashReceipt(requestDraft.receiptUrl).catch(() => {});
    setRequestOpen(false);
    setRequestDraft(emptyRequest());
    requestBtn.current?.focus({ preventScroll: true });
  };

  const onResolved = async (id: number, message: string) => {
    setItemMsgs(current => ({ ...current, [id]: { tone: 'ok', text: message } }));
    await refresh().catch(() => status.show({ tone: 'warn', message: 'Se resolvió, pero no se pudo recargar el saldo.', retry: { onRetry: () => load() } }));
  };

  const expenseColumns: Column<PettyCashExpense>[] = [
    { key: 'fecha', header: 'Fecha', width: '6.5rem', mono: true, card: 'meta', sortValue: row => row.expenseDate, cell: row => displayDay(row.expenseDate) },
    {
      key: 'desc', header: 'Descripción', width: 'minmax(0, 2.4fr)', card: 'title', sortValue: row => row.description,
      cell: row => (
        <span className="pc-exp-desc">
          <TruncatedText className="pc-exp-title" lines={2}>{row.description}</TruncatedText>
          <span className="pc-exp-sub">{row.supplier || 'Sin proveedor'} · {row.category || 'General'}{row.inventoryItemId ? <> · <StatusText tone="info">Inventario #{row.inventoryItemId}</StatusText></> : null}</span>
        </span>
      )
    },
    { key: 'imp', header: 'Importe', width: '8.5rem', align: 'end', mono: true, sortValue: row => row.amount, cell: row => money(row.amount) },
    {
      key: 'comp', header: 'Comprobante', width: '8rem', cell: row => (row.receiptUrl
        ? <a className="pc-link" href={row.receiptUrl} target="_blank" rel="noopener">Ver comprobante</a>
        : <span className="pc-none">Sin comprobante</span>)
    }
  ];

  const disabledWhy = consultationMode ? 'Modo consulta' : '';

  return (
    <section className="pc-page" aria-label="Caja chica">
      <header className="pc-head">
        <div>
          <Eyebrow>Fondo fijo{siteCode ? ` · ${siteCode}` : ''}</Eyebrow>
          <h1 className="pc-h1">Caja chica</h1>
        </div>
      </header>

      {consultationMode && (
        <p className="pc-note" role="status"><icons.IconLock size={14} /><span>Modo consulta: podés ver saldo, gastos y solicitudes. Registrar, solicitar y resolver quedan deshabilitados.</span></p>
      )}
      {loadError && <ErrorState message={`${loadError} Lo que ves puede estar desactualizado.`} retrying={retrying} onRetry={() => void retry()} />}

      <section className="pc-card pc-sum" aria-label="Saldo de la caja chica">
        <div className="pc-sum-row">
          <div className="pc-sum-main">
            <span className="pc-sum-label">Saldo disponible</span>
            <span className={`pc-sum-balance pc-mono${balance < 0 ? ' is-bad' : ''}`}>{money(balance)}</span>
            <span className="pc-sum-facts">
              <span>Fondo <b className="pc-mono">{money(fund)}</b></span>
              <span>Gastado <b className="pc-mono">{money(data.spent)}</b></span>
            </span>
            {fund <= 0 && <StatusText tone="muted">Todavía no hay un fondo cargado.{manager ? ' Usá “Editar fondo”.' : ''}</StatusText>}
            {balance < 0 && <StatusText tone="bad">El saldo es negativo: lo gastado supera el fondo.</StatusText>}
          </div>
          {fund > 0 && (
            <div className="pc-sum-ring">
              <Ring value={Math.max(0, balance)} total={fund} size={40} unit="pesos disponibles" />
              <span className="pc-sum-pct"><b className="pc-mono">{pct} %</b><span>del fondo disponible</span></span>
            </div>
          )}
          <div className="pc-sum-acts">
            {manager && (
              <Button ref={fundBtn} variant="ghost" icon={<Pencil size={15} strokeWidth={1.6} />} disabled={consultationMode} aria-expanded={fundOpen} aria-controls="pc-fund" onClick={() => { if (!fundOpen) { setFundDraft(moneyDraft(fund)); setFundError(''); } setFundOpen(open => !open); }}>
                Editar fondo
              </Button>
            )}
            {manager && (
              <Button ref={expenseBtn} variant="secondary" icon={<ReceiptText size={16} strokeWidth={1.6} />} disabled={consultationMode} aria-expanded={expenseOpen} aria-controls="pc-expense" onClick={() => setExpenseOpen(open => !open)}>
                Registrar gasto
              </Button>
            )}
            {canRequest && (
              <Button ref={requestBtn} variant="primary" icon={<ShoppingCart size={16} strokeWidth={1.6} />} disabled={consultationMode} aria-expanded={requestOpen} aria-controls="pc-request" onClick={() => setRequestOpen(open => !open)}>
                Solicitar compra
              </Button>
            )}
          </div>
        </div>
        {disabledWhy && (manager || canRequest) && <span className="pc-why">Botones deshabilitados: {disabledWhy.toLowerCase()}.</span>}

        <Collapse unmountOnClose open={fundOpen && manager} id="pc-fund" role="region" aria-label="Editar fondo" returnFocus={fundBtn}>
          <form className="pc-fund" onSubmit={saveFund} noValidate data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setFundOpen(false); fundBtn.current?.focus({ preventScroll: true }); } }}>
            <MoneyInput
              label="Fondo inicial"
              value={fundDraft}
              onChange={value => { setFundDraft(value); setFundError(''); }}
              autoFocus
              error={fundError || undefined}
              hint={fundAmount !== null && !Number.isNaN(fundAmount) && fundAmount < data.spent ? `Con este fondo el saldo queda en ${money(fundAmount - data.spent)}.` : 'El saldo se recalcula: fondo menos lo gastado.'}
            />
            <div className="pc-form-actions">
              <Button variant="ghost" disabled={fundBusy} onClick={() => { setFundOpen(false); fundBtn.current?.focus({ preventScroll: true }); }}>Cancelar</Button>
              <Button variant="primary" type="submit" loading={fundBusy} loadingLabel="Guardando…">Guardar fondo</Button>
            </div>
          </form>
        </Collapse>
      </section>

      {status.element}

      {manager && (
        <Collapse unmountOnClose open={expenseOpen && !consultationMode} id="pc-expense" gap="var(--g-s-4)" returnFocus={expenseBtn} role="region" aria-label="Registrar gasto">
          <div className="pc-card pc-form-card">
            <ExpenseForm
              draft={expenseDraft}
              setDraft={setExpenseDraft}
              balance={balance}
              categories={categories}
              onSaved={message => afterSave(message, 'expense')}
              onCancel={cancelExpense}
              onClose={() => { setExpenseOpen(false); expenseBtn.current?.focus({ preventScroll: true }); }}
            />
          </div>
        </Collapse>
      )}
      {canRequest && (
        <Collapse unmountOnClose open={requestOpen && !consultationMode} id="pc-request" gap="var(--g-s-4)" returnFocus={requestBtn} role="region" aria-label="Solicitar compra">
          <div className="pc-card pc-form-card">
            <RequestForm
              draft={requestDraft}
              setDraft={setRequestDraft}
              categories={categories}
              onSaved={message => afterSave(message, 'request')}
              onCancel={cancelRequest}
              onClose={() => { setRequestOpen(false); requestBtn.current?.focus({ preventScroll: true }); }}
            />
          </div>
        </Collapse>
      )}

      <section className="pc-card pc-section" aria-labelledby="pc-req-title">
        <div className="pc-section-head">
          <h2 id="pc-req-title" className="pc-section-title">Solicitudes de compra</h2>
          <span className={`pc-section-count${pendingCount ? ' is-warn' : ''}`}>{pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'pendiente' : 'pendientes'}` : 'Sin pendientes'}</span>
        </div>
        {data.requests.length === 0 ? (
          <CompactEmpty
            icon={<ShoppingCart size={18} strokeWidth={1.6} />}
            title="No hay solicitudes"
            description="Las solicitudes de compra del equipo aparecen acá para aprobarlas o rechazarlas."
            action={canRequest && !consultationMode ? <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setRequestOpen(true)}>Solicitar compra</Button> : undefined}
          />
        ) : (
          <>
            <ul className="pc-req-list">
              {[...pendingList, ...resolvedList.slice(0, resolvedShown)].map(item => (
                <RequestItem key={item.id} item={item} manager={manager} readOnly={consultationMode} balance={balance} message={itemMsgs[item.id] || null} onResolved={onResolved} />
              ))}
            </ul>
            {resolvedList.length > resolvedShown && (
              <div className="pc-more">
                <Button size="sm" variant="ghost" onClick={() => setResolvedShown(count => count + RESOLVED_STEP * 2)}>Ver anteriores ({resolvedList.length - resolvedShown})</Button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="pc-card pc-section" aria-labelledby="pc-exp-title">
        <div className="pc-section-head">
          <h2 id="pc-exp-title" className="pc-section-title">Gastos</h2>
          <span className="pc-section-count pc-mono">{data.expenses.length}</span>
          <span className="pc-section-hint">Más nuevos primero · ordená tocando el encabezado</span>
        </div>
        {data.expenses.length === 0 ? (
          <CompactEmpty
            icon={<ReceiptText size={18} strokeWidth={1.6} />}
            title="Todavía no hay gastos"
            description="Cuando registres uno (o se apruebe una solicitud) aparece en este historial."
            action={manager && !consultationMode ? <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setExpenseOpen(true)}>Registrar gasto</Button> : undefined}
          />
        ) : (
          <>
            <Table rows={sortedExpenses.slice(0, expensesShown)} columns={expenseColumns} sort={sort} onSortChange={setSort} manualSort rowKey={row => String(row.id)} caption="Gastos de la caja chica" cardBelow="md" className="pc-table" />
            {data.expenses.length > expensesShown && (
              <div className="pc-more">
                <Button size="sm" variant="ghost" onClick={() => setExpensesShown(count => count + EXPENSES_STEP * 2)}>Ver más ({data.expenses.length - expensesShown})</Button>
              </div>
            )}
          </>
        )}
      </section>
    </section>
  );
}

/**
 * The fit-out estimate — BuilderTrend's Estimate screen, edited in place like a sheet.
 *
 * Every cell saves on its own when you leave it (selects save on change). The estimate is
 * DRAFT -> SUBMITTED -> LOCKED; locking turns it into the ORIGINAL budget and freezes it,
 * after which money moves only through change orders. Who may lock and unlock is set by
 * Super Admin (Founder and PM by default, client 2026-10-17).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, addToast } from '@heroui/react';
import { FiLock, FiPlus, FiTrash2, FiUnlock } from 'react-icons/fi';
import {
  useEstimateAction, useInteriorCostCodes, useInteriorCostingSettings, useRemoveEstimateLine, useSaveEstimateLine,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import {
  COST_TYPES, CostCodeSelect, Note, PayerToggle, PlainSelect, SectionCard, StatusTag, TD, TH, NUM,
  fmtDay, money, roleList, type CostCode, type Payer,
} from './InteriorCostingParts';

const INPUT = 'h-8 w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none focus:border-blue-500';
const UNITS = ['ls', 'sqft', 'ea', 'lf', 'hr', 'set', 'sqm'];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "" -> null, "1,200.5" -> 1200.5; undefined when it is not a number at all. */
function parseNum(s: string): number | null | undefined {
  const t = s.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? r2(n) : undefined;
}

export function InteriorEstimatePanel({ costing }: { costing: any }) {
  const est = costing.estimate;
  const can = costing.can ?? {};
  const { data: codesData } = useInteriorCostCodes(true);
  const codes: CostCode[] = Array.isArray(codesData) ? codesData : [];
  const { data: settings } = useInteriorCostingSettings();
  const save = useSaveEstimateLine();
  const remove = useRemoveEstimateLine();
  const action = useEstimateAction();
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState('');

  const lines: any[] = est?.lines ?? [];
  const edit = !!can.editEstimate;
  const totals = useMemo(() => {
    let prime = 0; let tenant = 0;
    for (const l of lines) (l.paidBy === 'TENANT' ? (tenant += l.total) : (prime += l.total));
    return { prime, tenant, all: prime + tenant };
  }, [lines]);
  const sf = Number(costing.area) || 0;

  const patch = async (lineId: string, data: Record<string, any>) => {
    try {
      await save.mutateAsync({ id: costing.id, lineId, data });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not save the line'), color: 'danger' });
      throw e;
    }
  };

  const run = async (a: 'submit' | 'send-back' | 'lock' | 'unlock', done: string) => {
    try {
      await action.mutateAsync({ id: costing.id, action: a, reason: a === 'unlock' ? reason.trim() : undefined });
      addToast({ title: done, color: 'success' });
      setUnlocking(false); setReason('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not update the estimate'), color: 'danger' });
    }
  };

  const lockers = settings?.lockRoles ? roleList(settings.lockRoles) : 'a Founder or PM';

  let bar: React.ReactNode;
  if (est?.status === 'LOCKED') {
    bar = (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
        <StatusTag status="LOCKED" />
        <span className="text-xs text-blue-700">
          <strong>Approved and locked</strong>{est.lockedBy?.name ? ` by ${est.lockedBy.name}` : ''} on {fmtDay(est.lockedAt)}.
          The original budget is fixed — changes go through change orders.
        </span>
        <span className="flex-1" />
        {can.unlockEstimate && (unlocking ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input
              autoFocus aria-label="Why unlock the estimate" placeholder="Why unlock? (required)" value={reason}
              onChange={(e) => setReason(e.target.value)} className={`${INPUT} sm:w-64`}
              onKeyDown={(e) => { if (e.key === 'Enter' && reason.trim()) run('unlock', 'Estimate unlocked'); }}
            />
            <Button size="sm" color="danger" isDisabled={!reason.trim()} isLoading={action.isPending} onPress={() => run('unlock', 'Estimate unlocked')}>Unlock</Button>
            <Button size="sm" variant="light" onPress={() => { setUnlocking(false); setReason(''); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="flat" startContent={<FiUnlock className="h-3.5 w-3.5" />} onPress={() => setUnlocking(true)}>Unlock</Button>
        ))}
      </div>
    );
  } else if (est?.status === 'SUBMITTED') {
    bar = (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
        <StatusTag status="SUBMITTED" />
        <span className="text-xs text-amber-700">
          Sent{est.submittedBy?.name ? ` by ${est.submittedBy.name}` : ''} on {fmtDay(est.submittedAt)}. {lockers} approves and locks it.
        </span>
        <span className="flex-1" />
        {can.lockEstimate ? (
          <>
            <Button size="sm" variant="flat" isLoading={action.isPending} onPress={() => run('send-back', 'Estimate sent back to draft')}>Send back</Button>
            <Button size="sm" color="primary" startContent={<FiLock className="h-3.5 w-3.5" />} isLoading={action.isPending} onPress={() => run('lock', 'Estimate approved and locked')}>Approve & lock</Button>
          </>
        ) : <span className="text-xs text-gray-700">Only {lockers} can approve it.</span>}
      </div>
    );
  } else {
    bar = (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <StatusTag status="DRAFT" />
        <span className="text-xs text-gray-700">Being prepared. Nothing is committed against it until it is approved and locked.</span>
        <span className="flex-1" />
        {can.submitEstimate && (
          <Button size="sm" variant="flat" color="primary" isDisabled={!lines.length} isLoading={action.isPending} onPress={() => run('submit', 'Estimate sent for approval')}>
            Send for approval
          </Button>
        )}
        {can.lockEstimate && (
          <Button size="sm" color="primary" startContent={<FiLock className="h-3.5 w-3.5" />} isDisabled={!lines.length} isLoading={action.isPending} onPress={() => run('lock', 'Estimate approved and locked')}>
            Approve & lock now
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {bar}
      <SectionCard
        title="Estimate"
        hint={`${lines.length} line${lines.length === 1 ? '' : 's'}${sf && totals.all ? ` · ${money(r2(totals.all / sf))} / SF` : ''}`}
        right={<span className="text-sm font-bold tabular-nums text-gray-900">{money(totals.all)}</span>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className={`${TH} text-left w-[220px]`}>Cost code</th>
                <th className={`${TH} text-left`}>Description</th>
                <th className={`${TH} text-right w-[80px]`}>Qty</th>
                <th className={`${TH} text-left w-[80px]`}>Unit</th>
                <th className={`${TH} text-right w-[110px]`}>Unit cost</th>
                <th className={`${TH} text-left w-[130px]`}>Cost type</th>
                <th className={`${TH} text-left w-[150px]`}>Supplier</th>
                <th className={`${TH} text-left w-[120px]`}>Paid by</th>
                <th className={`${TH} text-right w-[120px]`}>Total</th>
                <th className="w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <EstimateRow
                  key={l.id} line={l} codes={codes} edit={edit} onPatch={(d) => patch(l.id, d)}
                  onRemove={async () => {
                    try { await remove.mutateAsync({ id: costing.id, lineId: l.id }); }
                    catch (e) { addToast({ title: errMsg(e, 'Could not remove the line'), color: 'danger' }); }
                  }}
                />
              ))}
              {edit && <NewLineRow costingId={costing.id} codes={codes} lastCodeId={lines[lines.length - 1]?.costCodeId ?? null} />}
              {!lines.length && !edit && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500">No estimate lines yet.</td></tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td className={`${TD} font-bold text-gray-900`} colSpan={7}>Total</td>
                  <td className={`${TD} text-[11px] text-gray-700`}>
                    <div>Prime <span className="tabular-nums text-blue-700">{money(totals.prime)}</span></div>
                    <div>Tenant <span className="tabular-nums text-purple-700">{money(totals.tenant)}</span></div>
                  </td>
                  <td className={`${TD} ${NUM} font-bold text-gray-900`}>{money(totals.all)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {est?.status === 'LOCKED' && (
          <div className="px-4 pb-3 pt-2"><Note>Locked lines cannot be edited. Raise a change order to move the budget, or unlock with a reason.</Note></div>
        )}
      </SectionCard>
    </div>
  );
}

function EstimateRow({ line, codes, edit, onPatch, onRemove }: {
  line: any; codes: CostCode[]; edit: boolean;
  onPatch: (d: Record<string, any>) => Promise<void>; onRemove: () => void;
}) {
  const fromLine = () => ({
    description: line.description ?? '', quantity: line.quantity == null ? '' : String(line.quantity),
    unit: line.unit ?? '', unitPrice: line.unitPrice == null ? '' : String(line.unitPrice), supplier: line.supplier ?? '',
  });
  const [d, setD] = useState(fromLine);
  // Re-sync when the server's copy changes (after a save, or another user's edit).
  useEffect(() => { setD(fromLine()); }, [line.description, line.quantity, line.unit, line.unitPrice, line.supplier]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveTotal = (() => {
    const q = parseNum(d.quantity); const p = parseNum(d.unitPrice);
    return q != null && p != null ? r2(q * p) : line.total;
  })();

  const commit = async (key: keyof typeof d) => {
    const raw = d[key];
    const before = fromLine()[key];
    if (raw.trim() === before.trim()) return;
    let value: any = raw.trim() || null;
    if (key === 'quantity' || key === 'unitPrice') {
      value = parseNum(raw);
      if (value === undefined) { addToast({ title: 'Enter a number of zero or more', color: 'warning' }); setD(fromLine()); return; }
    }
    if (key === 'description' && !value) { setD(fromLine()); return; }
    try { await onPatch({ [key]: value }); } catch { setD(fromLine()); }
  };

  if (!edit) {
    return (
      <tr className="border-t border-gray-100">
        <td className={TD}>{line.costCode ? (line.costCode.code ? `${line.costCode.code} - ${line.costCode.name}` : line.costCode.name) : <span className="text-gray-500">No cost code</span>}</td>
        <td className={TD}>{line.description}</td>
        <td className={`${TD} ${NUM}`}>{line.quantity ?? '—'}</td>
        <td className={TD}>{line.unit ?? '—'}</td>
        <td className={`${TD} ${NUM}`}>{line.unitPrice == null ? '—' : money(line.unitPrice)}</td>
        <td className={TD}>{line.costType ?? '—'}</td>
        <td className={TD}>{line.supplier || <span className="text-gray-500">—</span>}</td>
        <td className={TD}>{line.paidBy === 'TENANT' ? <span className="font-semibold text-purple-700">Tenant</span> : <span className="font-semibold text-blue-700">Prime</span>}</td>
        <td className={`${TD} ${NUM} font-semibold`}>{money(line.total)}</td>
        <td />
      </tr>
    );
  }

  const text = (key: keyof typeof d, label: string, cls = '') => (
    <input
      aria-label={label} value={d[key]} className={`${INPUT} ${cls}`}
      onChange={(e) => setD((s) => ({ ...s, [key]: e.target.value }))}
      onBlur={() => commit(key)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setD(fromLine()); }}
    />
  );

  return (
    <tr className="border-t border-gray-100">
      <td className="px-2 py-1.5"><CostCodeSelect label="Cost code" value={line.costCodeId} codes={codes} onChange={(v) => onPatch({ costCodeId: v }).catch(() => undefined)} /></td>
      <td className="px-2 py-1.5">{text('description', 'Description')}</td>
      <td className="px-2 py-1.5">{text('quantity', 'Quantity', 'text-right tabular-nums')}</td>
      <td className="px-2 py-1.5">
        <PlainSelect
          label="Unit" value={line.unit ?? ''} onChange={(v) => onPatch({ unit: v || null }).catch(() => undefined)}
          options={[...new Set([...(line.unit ? [line.unit] : []), ...UNITS])].map((u) => ({ value: u, label: u }))}
        />
      </td>
      <td className="px-2 py-1.5">{text('unitPrice', 'Unit cost', 'text-right tabular-nums')}</td>
      <td className="px-2 py-1.5">
        <PlainSelect
          label="Cost type" value={line.costType ?? ''} onChange={(v) => onPatch({ costType: v || null }).catch(() => undefined)}
          options={[{ value: '', label: '—' }, ...COST_TYPES.map((c) => ({ value: c, label: c }))]}
        />
      </td>
      <td className="px-2 py-1.5">{text('supplier', 'Supplier')}</td>
      <td className="px-2 py-1.5"><PayerToggle value={line.paidBy} onChange={(v) => onPatch({ paidBy: v }).catch(() => undefined)} /></td>
      <td className={`${TD} ${NUM} font-semibold`}>{money(liveTotal)}</td>
      <td className="px-1 py-1.5 text-center">
        <button type="button" aria-label={`Remove ${line.description}`} onClick={onRemove} className="rounded p-1.5 text-red-700 hover:bg-red-50">
          <FiTrash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

const BLANK = { description: '', quantity: '1', unit: 'ls', unitPrice: '', costType: 'Subcontractor', supplier: '' };

/** The last row of the sheet: type and press Enter (or Add) to append a line. */
function NewLineRow({ costingId, codes, lastCodeId }: { costingId: string; codes: CostCode[]; lastCodeId: string | null }) {
  const save = useSaveEstimateLine();
  const [d, setD] = useState(BLANK);
  const [codeId, setCodeId] = useState<string | null>(lastCodeId);
  const [paidBy, setPaidBy] = useState<Payer>('PRIME');
  const descRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement>) => setD((s) => ({ ...s, [k]: e.target.value }));

  const add = async () => {
    if (!d.description.trim()) { addToast({ title: 'Describe the line first', color: 'warning' }); return; }
    const quantity = parseNum(d.quantity); const unitPrice = parseNum(d.unitPrice);
    if (quantity === undefined || unitPrice === undefined) { addToast({ title: 'Quantity and unit cost must be numbers', color: 'warning' }); return; }
    try {
      await save.mutateAsync({
        id: costingId,
        data: {
          costCodeId: codeId, description: d.description.trim(), quantity: quantity ?? 1, unit: d.unit || 'ls',
          unitPrice: unitPrice ?? 0, costType: d.costType || null, supplier: d.supplier.trim() || null, paidBy,
        },
      });
      setD({ ...BLANK, unit: d.unit, costType: d.costType });
      descRef.current?.focus(); // ready for the next line, like a sheet
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not add the line'), color: 'danger' });
    }
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') add(); };
  const q = parseNum(d.quantity); const p = parseNum(d.unitPrice);

  return (
    <tr className="border-t border-dashed border-gray-200 bg-blue-50/40">
      <td className="px-2 py-1.5"><CostCodeSelect label="New line cost code" value={codeId} codes={codes} onChange={setCodeId} /></td>
      <td className="px-2 py-1.5"><input ref={descRef} aria-label="New line description" placeholder="Add a line…" value={d.description} onChange={set('description')} onKeyDown={enter} className={INPUT} /></td>
      <td className="px-2 py-1.5"><input aria-label="New line quantity" value={d.quantity} onChange={set('quantity')} onKeyDown={enter} className={`${INPUT} text-right tabular-nums`} /></td>
      <td className="px-2 py-1.5">
        <PlainSelect label="New line unit" value={d.unit} onChange={(v) => setD((s) => ({ ...s, unit: v }))} options={UNITS.map((u) => ({ value: u, label: u }))} />
      </td>
      <td className="px-2 py-1.5"><input aria-label="New line unit cost" placeholder="0" value={d.unitPrice} onChange={set('unitPrice')} onKeyDown={enter} className={`${INPUT} text-right tabular-nums`} /></td>
      <td className="px-2 py-1.5">
        <PlainSelect label="New line cost type" value={d.costType} onChange={(v) => setD((s) => ({ ...s, costType: v }))} options={COST_TYPES.map((c) => ({ value: c, label: c }))} />
      </td>
      <td className="px-2 py-1.5"><input aria-label="New line supplier" value={d.supplier} onChange={set('supplier')} onKeyDown={enter} className={INPUT} /></td>
      <td className="px-2 py-1.5"><PayerToggle label="New line paid by" value={paidBy} onChange={setPaidBy} /></td>
      <td className={`${TD} ${NUM} text-gray-700`}>{q != null && p != null ? money(r2(q * p)) : ''}</td>
      <td className="px-1 py-1.5 text-center">
        <button type="button" aria-label="Add line" onClick={add} disabled={save.isPending} className="rounded bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-50">
          <FiPlus className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

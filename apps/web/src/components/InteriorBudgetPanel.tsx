/**
 * The fit-out's job-costing budget — BuilderTrend's "Job Costing Budget" screen, with two
 * columns BuilderTrend does not have: what Prime pays and what the tenant pays (client,
 * 2026-10-17). Every figure is computed on the server (interior-budget.ts); this only lays
 * it out, grouped by division, with a drill-down showing what makes up each number.
 */
import { Fragment, useState } from 'react';
import { addToast } from '@heroui/react';
import { FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { useUpdateInterior } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { money, PayerTag, SectionCard, StatusTag, TD, TH, NUM, Note } from './InteriorCostingParts';

const COLS: { key: string; label: string; hint?: string }[] = [
  { key: 'original', label: 'Original', hint: 'The estimate as it was locked' },
  { key: 'coApproved', label: 'Change orders', hint: 'Approved change orders' },
  { key: 'revised', label: 'Revised', hint: 'Original + approved change orders' },
  { key: 'revisedPrime', label: 'Prime pays', hint: 'Revised budget paid by Prime' },
  { key: 'revisedTenant', label: 'Tenant pays', hint: 'Revised budget billed to the tenant' },
  { key: 'pending', label: 'Pending', hint: 'Purchase orders waiting for approval' },
  { key: 'committed', label: 'Committed', hint: 'Approved purchase orders' },
  { key: 'actual', label: 'Actual', hint: 'Approved and paid bills' },
  { key: 'projected', label: 'Projected', hint: 'The larger of revised, committed and actual' },
  { key: 'toComplete', label: 'To complete', hint: 'Projected − actual' },
  { key: 'overUnder', label: 'Over / under', hint: 'Revised − projected; negative is over budget' },
];

const sum = (rows: any[], k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

export function InteriorCostingSummary({ costing, canEdit }: { costing: any; canEdit: boolean }) {
  const t = costing.budget?.totals;
  if (!t) return null;
  const locked = costing.estimateStatus === 'LOCKED';
  const sf = Number(costing.area) || 0;
  const tiles: { k: string; v: number; f: string; bad?: boolean }[] = [
    { k: 'Original', v: t.original, f: locked ? 'locked estimate' : 'estimate — not locked yet' },
    { k: 'Change orders', v: t.coApproved, f: t.coPending ? `${money(t.coPending)} waiting` : 'approved' },
    { k: 'Revised budget', v: t.revised, f: sf && t.revised ? `${money(Math.round((t.revised / sf) * 100) / 100)} / SF` : 'original + change orders' },
    { k: 'Committed', v: t.committed, f: t.pending ? `${money(t.pending)} pending` : 'approved POs' },
    { k: 'Actual', v: t.actual, f: `${money(t.paid)} paid` },
    { k: 'Projected', v: t.projected, f: `${money(t.toComplete)} to complete` },
    { k: 'Over / under', v: t.overUnder, f: 'revised − projected', bad: t.overUnder < -0.5 },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((x) => (
          <div key={x.k} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{x.k}</div>
            <div className={`mt-0.5 truncate text-base font-bold tabular-nums ${x.bad ? 'text-red-700' : 'text-gray-900'}`}>{money(x.v)}</div>
            <div className="truncate text-[11px] text-gray-500">{x.f}</div>
          </div>
        ))}
      </div>
      <TiSplit costing={costing} canEdit={canEdit} />
    </div>
  );
}

/**
 * TI allowance vs what Prime is actually paying. The allowance is the fit-out's own figure
 * when set, else the linked lease's `tiAllowance`; clearing the fit-out's figure falls back.
 */
function TiSplit({ costing, canEdit }: { costing: any; canEdit: boolean }) {
  const ti = costing.ti ?? {};
  const update = useUpdateInterior();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const over = ti.overAllowance;

  const save = async () => {
    const raw = draft.trim();
    const value = raw === '' ? null : Number(raw.replace(/[$,]/g, ''));
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      addToast({ title: 'Enter an amount of zero or more, or leave it blank to use the lease', color: 'warning' });
      return;
    }
    try {
      await update.mutateAsync({ id: costing.id, data: { tiAllowance: value } });
      setEditing(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not save the TI allowance'), color: 'danger' });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-4">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">TI allowance</div>
        {editing ? (
          <div className="mt-1 flex items-center gap-1">
            <input
              autoFocus aria-label="TI allowance" inputMode="decimal" value={draft} placeholder="Blank = from the lease"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              className="h-8 w-full rounded border border-blue-500 px-2 text-xs tabular-nums outline-none"
            />
            <button type="button" onClick={save} className="h-8 rounded bg-blue-600 px-2 text-xs font-semibold text-white">Save</button>
          </div>
        ) : (
          <button
            type="button" disabled={!canEdit}
            onClick={() => { setDraft(costing.ti?.allowanceSource === 'FIT_OUT' ? String(ti.allowance ?? '') : ''); setEditing(true); }}
            className="mt-0.5 block max-w-full truncate rounded text-left text-base font-bold tabular-nums text-gray-900 enabled:hover:ring-1 enabled:hover:ring-gray-300"
            aria-label={canEdit ? 'Edit the TI allowance' : undefined}
          >
            {ti.allowance == null ? <span className="text-sm font-medium text-gray-500">Not set</span> : money(ti.allowance)}
          </button>
        )}
        <div className="text-[11px] text-gray-500">
          {ti.allowanceSource === 'LEASE' ? 'from the lease' : ti.allowanceSource === 'FIT_OUT' ? 'set on this fit-out' : 'what Prime contributes'}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Prime pays</div>
        <div className="mt-0.5 text-base font-bold tabular-nums text-blue-700">{money(ti.primePays)}</div>
        <div className="text-[11px] text-gray-500">revised budget, Prime lines</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tenant pays</div>
        <div className="mt-0.5 text-base font-bold tabular-nums text-purple-700">{money(ti.tenantPays)}</div>
        <div className="text-[11px] text-gray-500">billed back to the tenant</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Against allowance</div>
        <div className={`mt-0.5 text-base font-bold tabular-nums ${over != null && over > 0.5 ? 'text-red-700' : 'text-emerald-700'}`}>
          {over == null ? '—' : over > 0.5 ? `${money(over)} over` : `${money(-over)} left`}
        </div>
        <div className="text-[11px] text-gray-500">Prime pays − allowance</div>
      </div>
    </div>
  );
}

export function InteriorBudgetPanel({ costing }: { costing: any }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const rows: any[] = costing.budget?.rows ?? [];
  const totals = costing.budget?.totals;

  if (!rows.length) {
    return (
      <SectionCard title="Job costing budget">
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          No budget yet. Build the estimate, then a Founder or PM approves and locks it.
        </p>
      </SectionCard>
    );
  }

  const groups: { name: string; code: string | null; rows: any[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.name === r.groupName);
    if (!g) { g = { name: r.groupName, code: r.groupCode, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }

  const cells = (o: any, strong = false) => COLS.map((c) => {
    const v = Number(o[c.key]) || 0;
    const bad = c.key === 'overUnder' && v < -0.5;
    return (
      <td key={c.key} className={`${TD} ${NUM} ${bad ? 'bg-red-50 font-semibold text-red-700' : ''} ${strong ? 'font-semibold' : ''} ${c.key === 'revisedTenant' && v ? 'text-purple-700' : ''}`}>
        {c.key === 'overUnder' ? money(v) : money(v, { blankZero: true })}
        {c.key === 'coApproved' && o.coPending ? <div className="text-[11px] font-normal text-amber-700">+{money(o.coPending)} waiting</div> : null}
      </td>
    );
  });

  return (
    <SectionCard
      title="Job costing budget"
      hint={costing.estimateStatus === 'LOCKED' ? 'Click a cost code to see what makes up each number.' : 'Not locked yet — the original column is the live estimate.'}
    >
      {costing.estimateStatus !== 'LOCKED' && (
        <div className="px-4 pt-3"><Note tone="warn">The estimate is not locked. Lock it to fix the original budget; change orders and purchase orders start after that.</Note></div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className={`${TH} text-left`}>Cost code</th>
              {COLS.map((c) => <th key={c.key} title={c.hint} className={`${TH} text-right`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.name}>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td className={`${TD} font-semibold text-gray-900`}>{g.code ? `${g.code} · ` : ''}{g.name}</td>
                  {cells(Object.fromEntries(COLS.map((c) => [c.key, sum(g.rows, c.key)]).concat([['coPending', sum(g.rows, 'coPending')]])), true)}
                </tr>
                {g.rows.map((r) => {
                  const key = r.costCodeId ?? '';
                  const isOpen = !!open[key];
                  return (
                    <Fragment key={key}>
                      <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                        <td className={`${TD} pl-6`}>
                          <button type="button" aria-expanded={isOpen} className="inline-flex items-center gap-1 text-left">
                            {isOpen ? <FiChevronDown className="h-3.5 w-3.5 shrink-0" /> : <FiChevronRight className="h-3.5 w-3.5 shrink-0" />}
                            <span>{r.label}</span>
                          </button>
                        </td>
                        {cells(r)}
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={COLS.length + 1} className="px-6 py-3">
                            {/* Pinned to the left edge so it stays readable while the wide table is scrolled. */}
                            <div className="sticky left-6 w-[min(1100px,calc(100vw-7rem))]"><BudgetSources costing={costing} codeId={r.costCodeId} /></div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
            {totals && (
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className={`${TD} font-bold text-gray-900`}>All cost codes</td>
                {cells(totals, true)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function BudgetSources({ costing, codeId }: { costing: any; codeId: string | null }) {
  const same = (x: string | null | undefined) => (x ?? null) === (codeId ?? null);
  const lines = (costing.estimate?.lines ?? []).filter((l: any) => same(l.costCodeId));
  const cos = (costing.changeOrders ?? []).filter((c: any) => same(c.costCodeId));
  const pos = (costing.purchaseOrders ?? [])
    .map((p: any) => ({ ...p, onCode: (p.lines ?? []).filter((l: any) => same(l.costCodeId)).reduce((t: number, l: any) => t + l.amount, 0) }))
    .filter((p: any) => (p.lines ?? []).some((l: any) => same(l.costCodeId)));
  const poIds = new Set(pos.map((p: any) => p.id));
  const bills = (costing.bills ?? []).filter((b: any) => (b.purchaseOrderId ? poIds.has(b.purchaseOrderId) : codeId === null));

  const Col = ({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) => (
    <div className="min-w-0">
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {empty ? <p className="text-xs text-gray-500">None</p> : <ul className="space-y-1 text-xs text-gray-800">{children}</ul>}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <Col title="Estimate" empty={!lines.length}>
        {lines.map((l: any) => (
          <li key={l.id} className="flex items-baseline gap-1.5">
            <span className="truncate">{l.description}</span><PayerTag value={l.paidBy} />
            <span className="ml-auto tabular-nums">{money(l.total)}</span>
          </li>
        ))}
      </Col>
      <Col title="Change orders" empty={!cos.length}>
        {cos.map((c: any) => (
          <li key={c.id} className="flex items-baseline gap-1.5">
            <span className="tabular-nums">{c.number}</span><span className="truncate">{c.reason}</span><StatusTag status={c.status} />
            <span className="ml-auto tabular-nums">{money(c.amount)}</span>
          </li>
        ))}
      </Col>
      <Col title="Purchase orders" empty={!pos.length}>
        {pos.map((p: any) => (
          <li key={p.id} className="flex items-baseline gap-1.5">
            <span className="tabular-nums">{p.number}</span><span className="truncate">{p.vendor?.name}</span><StatusTag status={p.status} />
            <span className="ml-auto tabular-nums">{money(p.onCode)}</span>
          </li>
        ))}
      </Col>
      <Col title="Bills on these POs" empty={!bills.length}>
        {bills.map((b: any) => (
          <li key={b.id} className="flex items-baseline gap-1.5">
            <span className="truncate">{b.invoiceNo || 'Bill'}</span>
            {b.purchaseOrderNumber && <span className="tabular-nums text-gray-500">{b.purchaseOrderNumber}</span>}
            <StatusTag status={b.status} labels={{ PENDING: 'Received' }} />
            <span className="ml-auto tabular-nums">{money(b.amount)}</span>
          </li>
        ))}
      </Col>
    </div>
  );
}

/**
 * Change orders, purchase orders and bills for a fit-out — BuilderTrend's CO / PO / Bills
 * screens, kept inside the tracker (client, 2026-10-17: "skip Bill.com for now").
 *
 *   Change order   moves the revised budget of one cost code once approved. Above the limit
 *                  (Super Admin sets it; $60,000 by default) a different role list approves.
 *   Purchase order the committed cost. Checked against what is left on each cost code; going
 *                  over needs a change order first, or a variance PO a variance approver signs.
 *   Bill           the actual cost, always against an approved PO and never more than is
 *                  left unbilled on it. Received -> Approved -> Paid.
 *
 * Every rule is enforced by the API; the screens show the same checks up front so nobody
 * fills in a form only to be refused.
 */
import { Fragment, useMemo, useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, addToast } from '@heroui/react';
import { FiCheck, FiChevronDown, FiChevronRight, FiPlus, FiRotateCcw, FiTrash2, FiX } from 'react-icons/fi';
import {
  useAddInteriorInvoice, useCreateInteriorChangeOrder, useCreateInteriorPurchaseOrder, useDecideInteriorChangeOrder,
  useInteriorCostCodes, useInteriorCostingSettings, useInteriorPurchaseOrderAction, useUpdateInteriorInvoice,
  useVendors, useVoidInteriorInvoice,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import {
  CO_REASONS, CostCodeSelect, Note, PayerTag, PayerToggle, SectionCard, StatusTag, Tag, TD, TH, NUM,
  codeLabel, fmtDay, money, roleList, type CostCode, type Payer,
} from './InteriorCostingParts';

const INPUT = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-blue-500';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const r2 = (n: number) => Math.round(n * 100) / 100;
const toNum = (s: string) => { const n = Number(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };

function useCodes() {
  const { data } = useInteriorCostCodes(true);
  return (Array.isArray(data) ? data : []) as CostCode[];
}

// ───────────────────────────── change orders ─────────────────────────────

export function InteriorChangeOrdersPanel({ costing }: { costing: any }) {
  const can = costing.can ?? {};
  const codes = useCodes();
  const { data: settings } = useInteriorCostingSettings();
  const create = useCreateInteriorChangeOrder();
  const decide = useDecideInteriorChangeOrder();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ costCodeId: null as string | null, amount: '', reason: 'Scope add', note: '', paidBy: 'PRIME' as Payer });
  const cos: any[] = costing.changeOrders ?? [];
  const limit = Number(costing.settings?.coLimit ?? 60000);
  const above = settings?.coAboveLimitRoles ? roleList(settings.coAboveLimitRoles) : 'a Founder or PM';
  const upTo = settings?.coApproverRoles ? roleList(settings.coApproverRoles) : 'a Founder or PM';

  if (costing.estimateStatus !== 'LOCKED') {
    return <Note tone="warn">Change orders start once the estimate is approved and locked. Until then, edit the estimate itself.</Note>;
  }

  const amt = toNum(f.amount);
  const row = (costing.budget?.rows ?? []).find((r: any) => (r.costCodeId ?? null) === (f.costCodeId ?? null));
  const revisedNow = row?.revised ?? 0;

  const submit = async () => {
    if (!Number.isFinite(amt) || amt === 0) return addToast({ title: 'Enter the amount (negative for a credit)', color: 'warning' });
    if (!f.note.trim()) return addToast({ title: 'Say what changed', color: 'warning' });
    try {
      await create.mutateAsync({ id: costing.id, data: { costCodeId: f.costCodeId, amount: r2(amt), reason: f.reason, note: f.note.trim(), paidBy: f.paidBy } });
      addToast({ title: 'Change order sent for approval', color: 'success' });
      setOpen(false);
      setF({ costCodeId: f.costCodeId, amount: '', reason: 'Scope add', note: '', paidBy: 'PRIME' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not raise the change order'), color: 'danger' });
    }
  };

  const doDecide = async (coId: string, decision: 'APPROVE' | 'REJECT') => {
    try {
      await decide.mutateAsync({ id: costing.id, coId, decision });
      addToast({ title: decision === 'APPROVE' ? 'Change order approved' : 'Change order rejected', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not decide the change order'), color: 'danger' });
    }
  };

  return (
    <div className="space-y-3">
      {open && (
        <SectionCard title="New change order" hint="The number is given automatically.">
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <div>
              <span className={LABEL}>Cost code</span>
              <CostCodeSelect label="Cost code" value={f.costCodeId} codes={codes} onChange={(v) => setF((s) => ({ ...s, costCodeId: v }))} />
            </div>
            <div>
              <span className={LABEL}>Amount (negative for a credit)</span>
              <input aria-label="Amount" inputMode="decimal" placeholder="0" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} className={`${INPUT} tabular-nums`} />
            </div>
            <div className="sm:col-span-2">
              <span className={LABEL}>Reason</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Reason">
                {CO_REASONS.map((r) => (
                  <button
                    key={r} type="button" role="radio" aria-checked={f.reason === r}
                    onClick={() => setF((s) => ({ ...s, reason: r, paidBy: r === 'Tenant request' ? 'TENANT' : s.reason === 'Tenant request' ? 'PRIME' : s.paidBy }))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${f.reason === r ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className={LABEL}>What changed</span>
              <textarea aria-label="What changed" rows={2} placeholder="e.g. Second rooftop unit after the mechanical redesign" value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} className={`${INPUT} h-auto py-2`} />
            </div>
            <div>
              <span className={LABEL}>Paid by</span>
              <PayerToggle value={f.paidBy} onChange={(v) => setF((s) => ({ ...s, paidBy: v }))} />
            </div>
            {Number.isFinite(amt) && amt !== 0 && (
              <div className="sm:col-span-2">
                <Note tone={Math.abs(amt) > limit ? 'warn' : 'info'}>
                  Revised on {codeLabel(codes.find((c) => c.id === f.costCodeId))}: <strong className="tabular-nums">{money(revisedNow)} → {money(r2(revisedNow + amt))}</strong> once approved.{' '}
                  {Math.abs(amt) > limit ? <>Over the {money(limit)} limit, so <strong>{above}</strong> approves it.</> : <>{upTo} can approve it.</>}
                </Note>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button size="sm" variant="light" onPress={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" color="primary" isLoading={create.isPending} onPress={submit}>Send for approval</Button>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Change orders"
        hint={`Approved change orders raise the revised budget. Over ${money(limit)} needs ${above}.`}
        right={can.raiseChangeOrder && !open && (
          <Button size="sm" color="primary" startContent={<FiPlus className="h-3.5 w-3.5" />} onPress={() => setOpen(true)}>New change order</Button>
        )}
      >
        {!cos.length ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">No change orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${TH} text-left`}>#</th>
                  <th className={`${TH} text-left`}>Cost code</th>
                  <th className={`${TH} text-right`}>Amount</th>
                  <th className={`${TH} text-left`}>Paid by</th>
                  <th className={`${TH} text-left`}>Reason</th>
                  <th className={`${TH} text-left`}>What changed</th>
                  <th className={`${TH} text-left`}>Raised by</th>
                  <th className={`${TH} text-left`}>Status</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {cos.map((c) => {
                  const mayDecide = c.needsAboveLimit ? can.approveChangeOrderAboveLimit : can.approveChangeOrderUpToLimit;
                  return (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className={`${TD} tabular-nums font-semibold`}>{c.number}</td>
                      <td className={TD}>{c.costCode}</td>
                      <td className={`${TD} ${NUM} font-semibold`}>{money(c.amount)}</td>
                      <td className={TD}><PayerTag value={c.paidBy} /></td>
                      <td className={TD}>{c.reason}</td>
                      <td className={`${TD} min-w-[220px]`}>{c.note}</td>
                      <td className={TD}>{c.requestedBy?.name ?? '—'}<div className="text-[11px] text-gray-500">{fmtDay(c.createdAt)}</div></td>
                      <td className={TD}>
                        <StatusTag status={c.status} />
                        {c.decidedBy?.name && <div className="text-[11px] text-gray-500">{c.decidedBy.name} · {fmtDay(c.decidedAt)}</div>}
                        {c.status === 'PENDING' && c.needsAboveLimit && <div className="text-[11px] text-amber-700">over the {money(limit)} limit</div>}
                      </td>
                      <td className={`${TD} text-right`}>
                        {c.status === 'PENDING' && (mayDecide ? (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="flat" color="danger" isLoading={decide.isPending} onPress={() => doDecide(c.id, 'REJECT')}>Reject</Button>
                            <Button size="sm" color="primary" isLoading={decide.isPending} onPress={() => doDecide(c.id, 'APPROVE')}>Approve</Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-500">Needs {c.needsAboveLimit ? above : upTo}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ───────────────────────────── purchase orders ─────────────────────────────

const PO_STATUS = { DRAFT: 'Draft', PENDING: 'Waiting', APPROVED: 'Approved', VOID: 'Void' };
const blankLine = (costCodeId: string | null = null) => ({ costCodeId, description: '', amount: '', paidBy: 'PRIME' as Payer });

export function InteriorPurchaseOrdersPanel({ costing, onAddBill }: { costing: any; onAddBill?: (poId: string) => void }) {
  const can = costing.can ?? {};
  const seeMoney = !!can.seeMoney;
  const pos: any[] = costing.purchaseOrders ?? [];
  const action = useInteriorPurchaseOrderAction();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [voiding, setVoiding] = useState<any | null>(null);
  const { data: settings } = useInteriorCostingSettings();
  const varianceBy = settings?.varianceRoles ? roleList(settings.varianceRoles) : 'a Founder or PM';
  const approvers = settings?.poApproverRoles ? roleList(settings.poApproverRoles) : 'a Founder or PM';

  const run = async (poId: string, a: 'send' | 'approve' | 'void' | 'complete', done: string, complete?: boolean) => {
    try {
      await action.mutateAsync({ id: costing.id, poId, action: a, complete });
      addToast({ title: done, color: 'success' });
      return true;
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not update the purchase order'), color: 'danger' });
      return false;
    }
  };

  if (seeMoney && costing.estimateStatus !== 'LOCKED' && !pos.length) {
    return <Note tone="warn">Purchase orders start once the estimate is approved and locked — every PO is checked against the budget.</Note>;
  }

  return (
    <div className="space-y-3">
      {open && <NewPurchaseOrder costing={costing} onClose={() => setOpen(false)} varianceBy={varianceBy} />}

      <SectionCard
        title="Purchase orders"
        hint={seeMoney
          ? 'Approved POs are the committed cost. Going over a cost code needs a change order or a variance PO.'
          : 'Mark the work complete when it is done on site.'}
        right={can.createPurchaseOrder && !open && (
          <Button size="sm" color="primary" startContent={<FiPlus className="h-3.5 w-3.5" />} onPress={() => setOpen(true)}>New purchase order</Button>
        )}
      >
        {!pos.length ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">No purchase orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full border-collapse ${seeMoney ? 'min-w-[1180px]' : 'min-w-[760px]'}`}>
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${TH} text-left`}>PO #</th>
                  <th className={`${TH} text-left`}>Title</th>
                  <th className={`${TH} text-left`}>Performed by</th>
                  {seeMoney && <th className={`${TH} text-left`}>Cost codes</th>}
                  <th className={`${TH} text-left`}>Status</th>
                  <th className={`${TH} text-left`}>Work</th>
                  {seeMoney && <th className={`${TH} text-right`}>Cost</th>}
                  {seeMoney && <th className={`${TH} text-left`}>Paid</th>}
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => {
                  const isOpen = !!expanded[p.id];
                  const codesOn = seeMoney ? [...new Set((p.lines ?? []).map((l: any) => l.costCode))] : [];
                  const waiting = p.status === 'PENDING' || p.status === 'DRAFT';
                  const mayApprove = can.approvePurchaseOrder && (!p.variance || can.approveVariance);
                  const left = seeMoney ? r2(p.cost - p.billed) : 0;
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-t border-gray-100">
                        <td className={TD}>
                          <button type="button" aria-expanded={isOpen} onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))} className="inline-flex items-center gap-1 font-semibold tabular-nums text-blue-600 hover:underline">
                            {isOpen ? <FiChevronDown className="h-3.5 w-3.5" /> : <FiChevronRight className="h-3.5 w-3.5" />}{p.number}
                          </button>
                        </td>
                        <td className={`${TD} min-w-[160px]`}>
                          <span className="font-medium text-gray-900">{p.title}</span>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {p.variance && <Tag tone="red">Variance</Tag>}
                            {p.materialsOnly && <Tag>Materials only</Tag>}
                          </div>
                        </td>
                        <td className={`${TD} min-w-[150px]`}>{p.vendor?.name ?? '—'}</td>
                        {seeMoney && <td className={`${TD} max-w-[220px] text-[11px] text-gray-700`}>{codesOn.join(', ')}</td>}
                        <td className={TD}><StatusTag status={p.status} labels={PO_STATUS} /></td>
                        <td className={TD}>
                          {p.status !== 'APPROVED' ? <span className="text-[11px] text-gray-500">—</span>
                            : p.workCompletedAt ? <Tag tone="green">Complete</Tag> : <Tag tone="amber">Incomplete</Tag>}
                          {p.scheduledCompletion && <div className="text-[11px] text-gray-500">due {fmtDay(p.scheduledCompletion)}</div>}
                        </td>
                        {seeMoney && <td className={`${TD} ${NUM} font-semibold`}>{money(p.cost)}</td>}
                        {seeMoney && (
                          <td className={`${TD} min-w-[150px]`}>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100" title={`${money(p.paid)} paid of ${money(p.cost)}`}>
                              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${p.cost ? Math.min(100, (p.paid / p.cost) * 100) : 0}%` }} />
                            </div>
                            <div className="mt-1 text-[11px] tabular-nums text-gray-700">{money(p.paid)} paid · {money(r2(p.cost - p.paid))} open</div>
                          </td>
                        )}
                        <td className={`${TD} text-right`}>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {seeMoney && waiting && (mayApprove
                              ? <Button size="sm" color="primary" isLoading={action.isPending} onPress={() => run(p.id, 'approve', `${p.number} approved`)}>Approve</Button>
                              : <span className="self-center text-[11px] text-gray-500">Needs {p.variance ? varianceBy : approvers}</span>)}
                            {seeMoney && p.status === 'DRAFT' && can.createPurchaseOrder && (
                              <Button size="sm" variant="flat" isLoading={action.isPending} onPress={() => run(p.id, 'send', `${p.number} sent for approval`)}>Send</Button>
                            )}
                            {p.status === 'APPROVED' && can.markWorkComplete && (p.workCompletedAt
                              ? <Button size="sm" variant="light" startContent={<FiRotateCcw className="h-3.5 w-3.5" />} isLoading={action.isPending} onPress={() => run(p.id, 'complete', `${p.number} reopened`, false)}>Reopen</Button>
                              : <Button size="sm" variant="flat" color="success" startContent={<FiCheck className="h-3.5 w-3.5" />} isLoading={action.isPending} onPress={() => run(p.id, 'complete', `${p.number} work marked complete`, true)}>Work complete</Button>)}
                            {seeMoney && p.status === 'APPROVED' && can.addBill && left > 0.005 && onAddBill && (
                              <Button size="sm" variant="flat" startContent={<FiPlus className="h-3.5 w-3.5" />} onPress={() => onAddBill(p.id)}>Bill</Button>
                            )}
                            {seeMoney && p.status !== 'VOID' && can.createPurchaseOrder && !p.billed && (
                              <Button size="sm" variant="light" color="danger" isIconOnly aria-label={`Void ${p.number}`} onPress={() => setVoiding(p)}>
                                <FiTrash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={seeMoney ? 9 : 6} className="px-6 py-3">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                              <div>
                                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Scope of work</h4>
                                <p className="whitespace-pre-wrap text-xs text-gray-800">{p.scope || 'None written.'}</p>
                                {seeMoney && (
                                  <p className="mt-1 text-[11px] text-gray-500">
                                    {p.createdBy?.name ? `Created by ${p.createdBy.name}` : ''}{p.approvedBy?.name ? ` · approved by ${p.approvedBy.name} ${fmtDay(p.approvedAt)}` : ''}
                                  </p>
                                )}
                              </div>
                              {seeMoney && (
                                <div>
                                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cost lines</h4>
                                  <ul className="space-y-1 text-xs text-gray-800">
                                    {(p.lines ?? []).map((l: any) => (
                                      <li key={l.id} className="flex items-baseline gap-1.5">
                                        <span className="truncate">{l.description || l.costCode}</span>
                                        <span className="text-[11px] text-gray-500">{l.description ? l.costCode : ''}</span>
                                        <PayerTag value={l.paidBy} />
                                        <span className="ml-auto tabular-nums">{money(l.amount)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {seeMoney && (
                                <div>
                                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bills</h4>
                                  {(costing.bills ?? []).filter((b: any) => b.purchaseOrderId === p.id).map((b: any) => (
                                    <div key={b.id} className="flex items-baseline gap-1.5 text-xs text-gray-800">
                                      <span>{b.invoiceNo || 'Bill'}</span><StatusTag status={b.status} labels={{ PENDING: 'Received' }} />
                                      <span className="ml-auto tabular-nums">{money(b.amount)}</span>
                                    </div>
                                  ))}
                                  {!(costing.bills ?? []).some((b: any) => b.purchaseOrderId === p.id) && <p className="text-xs text-gray-500">None yet.</p>}
                                  <p className="mt-1 text-[11px] text-gray-500">{money(left)} not yet billed</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal isOpen={!!voiding} onClose={() => setVoiding(null)} size="sm">
        <ModalContent>
          <ModalHeader>Void {voiding?.number}?</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-700">
              {voiding?.title} · {voiding?.vendor?.name} · <strong>{money(voiding?.cost)}</strong>
            </p>
            <p className="text-sm text-gray-700">
              A void PO stops counting as {voiding?.status === 'APPROVED' ? 'committed' : 'pending'} cost. The number is not reused.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setVoiding(null)}>Cancel</Button>
            <Button
              size="sm" color="danger" isLoading={action.isPending}
              onPress={async () => { if (await run(voiding.id, 'void', `${voiding.number} voided`)) setVoiding(null); }}
            >
              Void purchase order
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function NewPurchaseOrder({ costing, onClose, varianceBy }: { costing: any; onClose: () => void; varianceBy: string }) {
  const codes = useCodes();
  const { data: vendorsData } = useVendors();
  const vendors: any[] = Array.isArray(vendorsData) ? vendorsData : [];
  const create = useCreateInteriorPurchaseOrder();
  const firstCode = (costing.budget?.rows ?? []).find((r: any) => r.costCodeId)?.costCodeId ?? null;
  const [f, setF] = useState({ vendor: '', title: '', scope: '', scheduledCompletion: '', materialsOnly: false, variance: false });
  const [lines, setLines] = useState([blankLine(firstCode)]);
  const leftBy: Record<string, number> = costing.leftByCode ?? {};

  // The same check the API makes: each cost code's lines on this PO against what is left.
  const checks = useMemo(() => lines.map((l, i) => {
    const left = leftBy[l.costCodeId ?? ''] ?? 0;
    const sameBefore = lines.slice(0, i).filter((x) => x.costCodeId === l.costCodeId).reduce((t, x) => t + (toNum(x.amount) || 0), 0);
    const amt = toNum(l.amount) || 0;
    return { left: r2(left - sameBefore), exceeds: amt > 0 && amt + sameBefore > left + 0.005 };
  }), [lines, leftBy]);
  const over = checks.some((c) => c.exceeds);
  const total = r2(lines.reduce((t, l) => t + (toNum(l.amount) || 0), 0));

  const setLine = (i: number, patch: Partial<ReturnType<typeof blankLine>>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (status: 'DRAFT' | 'PENDING') => {
    if (!f.vendor.trim()) return addToast({ title: 'Name the supplier or sub-contractor', color: 'warning' });
    if (!f.title.trim()) return addToast({ title: 'Give the purchase order a title', color: 'warning' });
    if (lines.some((l) => !(toNum(l.amount) > 0))) return addToast({ title: 'Every cost line needs an amount above zero', color: 'warning' });
    if (status === 'PENDING' && over && !f.variance) return addToast({ title: 'Over budget — raise a change order first, or mark this as a variance PO', color: 'warning' });
    const match = vendors.find((v) => v.name.trim().toLowerCase() === f.vendor.trim().toLowerCase());
    try {
      await create.mutateAsync({
        id: costing.id,
        data: {
          title: f.title.trim(), ...(match ? { vendorId: match.id } : { vendorName: f.vendor.trim() }),
          scope: f.scope.trim() || undefined, scheduledCompletion: f.scheduledCompletion || undefined,
          materialsOnly: f.materialsOnly, variance: over && f.variance, status,
          lines: lines.map((l) => ({ costCodeId: l.costCodeId, description: l.description.trim() || undefined, amount: r2(toNum(l.amount)), paidBy: l.paidBy })),
        },
      });
      addToast({ title: status === 'DRAFT' ? 'Purchase order saved as a draft' : 'Purchase order sent for approval', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not create the purchase order'), color: 'danger' });
    }
  };

  return (
    <SectionCard title="New purchase order" hint={`Numbered ${costing.poPrefix}-#### automatically.`}>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Supplier / sub-contractor</span>
            <input aria-label="Supplier" list="interior-po-vendors" placeholder="e.g. Bluesky Building Supplies LLC" value={f.vendor} onChange={(e) => setF((s) => ({ ...s, vendor: e.target.value }))} className={INPUT} />
            <datalist id="interior-po-vendors">{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist>
            {f.vendor.trim() && !vendors.some((v) => v.name.trim().toLowerCase() === f.vendor.trim().toLowerCase()) && (
              <p className="mt-1 text-[11px] text-gray-500">New supplier — it will be added to the vendor list.</p>
            )}
          </div>
          <div>
            <span className={LABEL}>Title</span>
            <input aria-label="Title" placeholder="e.g. Doors" value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} className={INPUT} />
          </div>
          <div>
            <span className={LABEL}>Scheduled completion</span>
            <input aria-label="Scheduled completion" type="date" value={f.scheduledCompletion} onChange={(e) => setF((s) => ({ ...s, scheduledCompletion: e.target.value }))} className={INPUT} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-800">
            <input type="checkbox" checked={f.materialsOnly} onChange={(e) => setF((s) => ({ ...s, materialsOnly: e.target.checked }))} className="h-4 w-4" />
            Materials only
          </label>
          <div className="sm:col-span-2">
            <span className={LABEL}>Scope of work</span>
            <textarea aria-label="Scope of work" rows={2} placeholder="What is being bought or done, and payment terms" value={f.scope} onChange={(e) => setF((s) => ({ ...s, scope: e.target.value }))} className={`${INPUT} h-auto py-2`} />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className={`${TH} text-left w-[240px]`}>Cost code</th>
                <th className={`${TH} text-left`}>Description</th>
                <th className={`${TH} text-right w-[130px]`}>Amount</th>
                <th className={`${TH} text-left w-[120px]`}>Paid by</th>
                <th className={`${TH} text-right w-[150px]`}>Budget check</th>
                <th className="w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1.5"><CostCodeSelect label={`Line ${i + 1} cost code`} value={l.costCodeId} codes={codes} onChange={(v) => setLine(i, { costCodeId: v })} /></td>
                  <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={`${INPUT} h-8 text-xs`} /></td>
                  <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} amount`} inputMode="decimal" placeholder="0" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} className={`${INPUT} h-8 text-right text-xs tabular-nums`} /></td>
                  <td className="px-2 py-1.5"><PayerToggle label={`Line ${i + 1} paid by`} value={l.paidBy} onChange={(v) => setLine(i, { paidBy: v })} /></td>
                  <td className={`${TD} ${NUM} ${checks[i].exceeds ? 'bg-red-50' : ''}`}>
                    <span className={checks[i].exceeds || checks[i].left < 0 ? 'font-semibold text-red-700' : ''}>{money(checks[i].left)}</span>
                    <div className="text-[11px] text-gray-500">left on this code</div>
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    {lines.length > 1 && (
                      <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded p-1.5 text-red-700 hover:bg-red-50">
                        <FiX className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-2 py-1.5" colSpan={2}>
                  <Button size="sm" variant="flat" startContent={<FiPlus className="h-3.5 w-3.5" />} onPress={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.costCodeId ?? null)])}>Add cost line</Button>
                </td>
                <td className={`${TD} ${NUM} font-bold`}>{money(total)}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>

        {over && (
          <Note tone="bad">
            <strong>Over the budget on a cost code.</strong> Raise a change order first, or mark this as a variance PO — {varianceBy} must approve a variance.
            <label className="mt-2 flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={f.variance} onChange={(e) => setF((s) => ({ ...s, variance: e.target.checked }))} className="h-4 w-4" />
              This is a variance PO
            </label>
          </Note>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" variant="flat" isLoading={create.isPending} onPress={() => save('DRAFT')}>Save draft</Button>
          <Button size="sm" color="primary" isLoading={create.isPending} isDisabled={over && !f.variance} onPress={() => save('PENDING')}>Send for approval</Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ───────────────────────────── bills ─────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

/** `presetPoId` opens the form on that PO; the page remounts this panel (key) to apply a new one. */
export function InteriorBillsPanel({ costing, presetPoId }: { costing: any; presetPoId?: string | null }) {
  const can = costing.can ?? {};
  const bills: any[] = costing.bills ?? [];
  const billable = (costing.purchaseOrders ?? []).filter((p: any) => p.status === 'APPROVED' && p.cost - p.billed > 0.005);
  const add = useAddInteriorInvoice();
  const update = useUpdateInteriorInvoice();
  const voidBill = useVoidInteriorInvoice();
  const { data: settings } = useInteriorCostingSettings();
  const approvers = settings?.billApproverRoles ? roleList(settings.billApproverRoles) : 'a Founder or PM';
  const [open, setOpen] = useState(!!presetPoId);
  const [f, setF] = useState({ poId: presetPoId ?? billable[0]?.id ?? '', invoiceNo: '', invoiceDate: today(), amount: '' });
  const [voiding, setVoiding] = useState<any | null>(null);

  const po = billable.find((p: any) => p.id === f.poId);
  const room = po ? r2(po.cost - po.billed) : 0;
  const amt = toNum(f.amount);
  const tooMuch = Number.isFinite(amt) && amt > room + 0.005;

  const submit = async () => {
    if (!po) return addToast({ title: 'Pick the purchase order this bill is for', color: 'warning' });
    if (!(amt > 0)) return addToast({ title: 'Enter the bill amount', color: 'warning' });
    if (tooMuch) return addToast({ title: `More than is left on ${po.number}`, color: 'warning' });
    try {
      await add.mutateAsync({
        id: costing.id,
        data: { purchaseOrderId: po.id, amount: r2(amt), invoiceNo: f.invoiceNo.trim() || undefined, invoiceDate: f.invoiceDate || undefined },
      });
      addToast({ title: 'Bill added', color: 'success' });
      setOpen(false);
      setF({ poId: '', invoiceNo: '', invoiceDate: today(), amount: '' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not add the bill'), color: 'danger' });
    }
  };

  const move = async (b: any, status: string, done: string) => {
    try {
      await update.mutateAsync({ id: costing.id, invoiceId: b.id, data: { status } });
      addToast({ title: done, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not update the bill'), color: 'danger' });
    }
  };

  return (
    <div className="space-y-3">
      {open && (
        <SectionCard title="Add a bill" hint={`Accounts enters bills; ${approvers} approves; Accounts marks them paid.`}>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={LABEL}>Against purchase order</span>
              <select aria-label="Purchase order" value={f.poId} onChange={(e) => setF((s) => ({ ...s, poId: e.target.value }))} className={INPUT}>
                <option value="">Pick a purchase order…</option>
                {billable.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.number} · {p.title} · {p.vendor?.name} · {money(r2(p.cost - p.billed))} not yet billed</option>
                ))}
              </select>
            </div>
            <div>
              <span className={LABEL}>Bill / invoice #</span>
              <input aria-label="Invoice number" placeholder="Supplier's invoice number" value={f.invoiceNo} onChange={(e) => setF((s) => ({ ...s, invoiceNo: e.target.value }))} className={INPUT} />
            </div>
            <div>
              <span className={LABEL}>Bill date</span>
              <input aria-label="Bill date" type="date" value={f.invoiceDate} onChange={(e) => setF((s) => ({ ...s, invoiceDate: e.target.value }))} className={INPUT} />
            </div>
            <div>
              <span className={LABEL}>Amount</span>
              <input aria-label="Bill amount" inputMode="decimal" placeholder="0" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} className={`${INPUT} tabular-nums`} />
            </div>
            {po && (
              <div className="sm:col-span-2">
                <Note tone={tooMuch ? 'bad' : 'info'}>
                  {tooMuch
                    ? <><strong>More than is left on {po.number}.</strong> {money(room)} has not been billed yet. The extra needs a change order and a new PO.</>
                    : <>{money(room)} of {po.number} has not been billed yet.</>}
                </Note>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button size="sm" variant="light" onPress={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" color="primary" isLoading={add.isPending} isDisabled={!po || tooMuch} onPress={submit}>Add bill</Button>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Bills"
        hint="Approved and paid bills are the actual cost."
        right={can.addBill && !open && (billable.length
          ? <Button size="sm" color="primary" startContent={<FiPlus className="h-3.5 w-3.5" />} onPress={() => { setF((s) => ({ ...s, poId: s.poId || billable[0].id })); setOpen(true); }}>Add bill</Button>
          : <span className="text-[11px] text-gray-500">Bills go against an approved purchase order.</span>)}
      >
        {!bills.length ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">No bills yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${TH} text-left`}>Bill #</th>
                  <th className={`${TH} text-left`}>PO</th>
                  <th className={`${TH} text-left`}>Supplier</th>
                  <th className={`${TH} text-left`}>Date</th>
                  <th className={`${TH} text-right`}>Amount</th>
                  <th className={`${TH} text-left`}>Status</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t border-gray-100">
                    <td className={`${TD} tabular-nums`}>{b.invoiceNo || <span className="text-gray-500">—</span>}</td>
                    <td className={`${TD} tabular-nums`}>{b.purchaseOrderNumber ?? <span className="text-gray-500">No PO</span>}</td>
                    <td className={TD}>{b.vendor?.name ?? '—'}</td>
                    <td className={TD}>{fmtDay(b.invoiceDate)}</td>
                    <td className={`${TD} ${NUM} font-semibold`}>{money(b.amount)}</td>
                    <td className={TD}>
                      <StatusTag status={b.status} labels={{ PENDING: 'Received' }} />
                      {b.paidAt && <div className="text-[11px] text-gray-500">paid {fmtDay(b.paidAt)}</div>}
                    </td>
                    <td className={`${TD} text-right`}>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {b.status === 'PENDING' && (can.approveBill
                          ? <Button size="sm" variant="flat" color="primary" isLoading={update.isPending} onPress={() => move(b, 'APPROVED', 'Bill approved')}>Approve</Button>
                          : <span className="self-center text-[11px] text-gray-500">Needs {approvers}</span>)}
                        {b.status === 'APPROVED' && can.payBill && (
                          <Button size="sm" color="success" isLoading={update.isPending} onPress={() => move(b, 'PAID', 'Bill marked paid')}>Mark paid</Button>
                        )}
                        {b.status === 'APPROVED' && can.approveBill && (
                          <Button size="sm" variant="light" isIconOnly aria-label="Undo approval" onPress={() => move(b, 'PENDING', 'Approval undone')}>
                            <FiRotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {can.addBill && (
                          <Button size="sm" variant="light" color="danger" isIconOnly aria-label="Void bill" onPress={() => setVoiding(b)}>
                            <FiTrash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal isOpen={!!voiding} onClose={() => setVoiding(null)} size="sm">
        <ModalContent>
          <ModalHeader>Void this bill?</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-700">
              {voiding?.vendor?.name ?? 'Supplier'}{voiding?.invoiceNo ? ` · #${voiding.invoiceNo}` : ''} · <strong>{money(voiding?.amount)}</strong>
            </p>
            <p className="text-sm text-gray-700">This deletes the bill and reverses the actual cost it recorded.</p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setVoiding(null)}>Cancel</Button>
            <Button
              size="sm" color="danger" isLoading={voidBill.isPending}
              onPress={async () => {
                try {
                  await voidBill.mutateAsync({ id: costing.id, invoiceId: voiding.id });
                  addToast({ title: 'Bill voided', color: 'success' });
                  setVoiding(null);
                } catch (e) {
                  addToast({ title: errMsg(e, 'Could not void the bill'), color: 'danger' });
                }
              }}
            >
              Void bill
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ───────────────────────────── activity ─────────────────────────────

export function InteriorActivityPanel({ costing }: { costing: any }) {
  const items: any[] = costing.activity ?? [];
  return (
    <SectionCard title="Activity" hint="Locks, unlocks (with the reason), approvals, purchase orders and bills.">
      {!items.length ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-sm">
              <span className="font-semibold text-gray-900">{a.actor?.name ?? 'System'}</span>
              <span className="min-w-0 flex-1 text-gray-800">{a.text}</span>
              <span className="text-[11px] tabular-nums text-gray-500">
                {new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * LeaseObligationsPanel — the obligation ledger on a lease.
 *
 * Two kinds of money live in this one panel and they flow in OPPOSITE
 * directions:
 *   SECURITY_DEPOSIT  tenant → Prime  (FROM_TENANT)  — money we collect
 *   TI_ALLOWANCE      Prime → tenant  (TO_TENANT)    — money we disburse
 * Mixing those up is the single easiest mistake a user can make here, so
 * direction is carried redundantly: separate colour-coded sections, an arrow
 * glyph, and the literal "Tenant → Prime" / "Prime → Tenant" party string on
 * every row. Nothing relies on the user remembering which kind means which.
 *
 * Direction is IMPLIED by kind and rejected by the API if inverted, so there is
 * no direction picker for the two fixed kinds — only for OTHER.
 *
 * TI is a FIXED AGREED AMOUNT disbursed in phases — never a percentage. There
 * is deliberately no percentage field anywhere in this file; several payment
 * rows against one obligation is the normal case.
 *
 * `status` and `paidAmount` are derived server-side and are display-only here.
 *
 * MONEY IS A STRING: Prisma Decimal serialises to JSON as a string, so `+`
 * concatenates ("0" + "500" = "0500"). Every amount goes through `num()` before
 * arithmetic and `fmt()` for display.
 */

import { useMemo, useState } from 'react';
import {
  Button, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Progress, Select, SelectItem, Textarea, Tooltip, useDisclosure, addToast,
} from '@heroui/react';
import {
  FiArrowDownLeft, FiArrowUpRight, FiChevronDown, FiChevronRight, FiPlus,
  FiEdit2, FiTrash2, FiSlash, FiCalendar, FiAlertTriangle, FiCornerUpLeft,
} from 'react-icons/fi';
import {
  useLeaseObligations,
  useCreateLeaseObligation,
  useUpdateLeaseObligation,
  useDeleteLeaseObligation,
  useWaiveLeaseObligation,
  useRecordObligationPayment,
  useDeleteObligationPayment,
} from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';
import { LoadingState, ErrorState, EmptyState } from './ui';
import { FormError } from './FormError';

// ─── types (money fields arrive as strings — see file header) ─────────────────

type Money = string | number | null | undefined;

interface ObligationPayment {
  id: string;
  amount: Money;
  paidAt: string;
  method?: string | null;
  reference?: string | null;
  documentId?: string | null;
  notes?: string | null;
  createdAt?: string;
  recordedBy?: { id: string; name?: string | null; email?: string | null } | null;
}

interface LeaseObligation {
  id: string;
  leaseId: string;
  kind: string;
  direction: string;
  totalAmount: Money;
  dueDate?: string | null;
  status: string;
  paidAmount: Money;
  notes?: string | null;
  payments?: ObligationPayment[];
}

// ─── money helpers ───────────────────────────────────────────────────────────

/** Decimal-as-string → number. NEVER sum raw API money values with `+`. */
function num(v: Money): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── direction / kind config ─────────────────────────────────────────────────

const DIRECTIONS = {
  FROM_TENANT: {
    parties: 'Tenant → Prime',
    heading: 'Money in · collected from tenant',
    icon: FiArrowDownLeft,
    accent: 'border-l-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    text: 'text-emerald-700',
    tile: 'bg-emerald-50 border-emerald-200',
    bar: 'success' as const,
    paidWord: 'Collected',
    openWord: 'Still to collect',
    actionWord: 'Record payment received',
  },
  TO_TENANT: {
    parties: 'Prime → Tenant',
    heading: 'Money out · disbursed to tenant',
    icon: FiArrowUpRight,
    accent: 'border-l-amber-500',
    chip: 'bg-amber-100 text-amber-700 border-amber-200',
    text: 'text-amber-700',
    tile: 'bg-amber-50 border-amber-200',
    bar: 'warning' as const,
    paidWord: 'Disbursed',
    openWord: 'Still to disburse',
    actionWord: 'Record disbursement',
  },
} as const;

type DirectionKey = keyof typeof DIRECTIONS;

const DIRECTION_ORDER: DirectionKey[] = ['FROM_TENANT', 'TO_TENANT'];

function dirMeta(direction: string) {
  return DIRECTIONS[(direction as DirectionKey)] ?? DIRECTIONS.FROM_TENANT;
}

const KIND_LABELS: Record<string, string> = {
  SECURITY_DEPOSIT: 'Security Deposit',
  TI_ALLOWANCE: 'TI Allowance',
  OTHER: 'Other',
};

/** Direction each kind is locked to server-side. `null` = caller must state it. */
const IMPLIED_DIRECTION: Record<string, DirectionKey | null> = {
  SECURITY_DEPOSIT: 'FROM_TENANT',
  TI_ALLOWANCE: 'TO_TENANT',
  OTHER: null,
};

const STATUS_CHIP: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600 border-gray-200',
  PARTIAL: 'bg-blue-100 text-blue-700 border-blue-200',
  SETTLED: 'bg-green-100 text-green-700 border-green-200',
  WAIVED: 'bg-purple-100 text-purple-700 border-purple-200',
};

const PAYMENT_METHODS = ['WIRE', 'CHECK', 'ACH', 'CASH', 'ADJUSTMENT'];

// ─── small helpers ───────────────────────────────────────────────────────────

const todayInput = () => new Date().toISOString().slice(0, 10);

function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Past due and still owing. Waived / settled obligations are never overdue. */
function isOverdue(o: LeaseObligation): boolean {
  if (!o.dueDate || o.status === 'SETTLED' || o.status === 'WAIVED') return false;
  const due = new Date(o.dueDate);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

const EMPTY_OBLIGATION = { kind: 'SECURITY_DEPOSIT', direction: 'FROM_TENANT', totalAmount: '', dueDate: '', notes: '' };
const EMPTY_PAYMENT = { amount: '', paidAt: todayInput(), method: '', reference: '', notes: '' };

// ─── component ───────────────────────────────────────────────────────────────

interface LeaseObligationsPanelProps {
  leaseId: string;
  canEdit: boolean;
  /** Passed straight into mutation vars so the rollup summaries invalidate. */
  unitId: string | undefined;
  buildingId: string | undefined;
}

export function LeaseObligationsPanel({ leaseId, canEdit, unitId, buildingId }: LeaseObligationsPanelProps) {
  const { data, isLoading, error } = useLeaseObligations(leaseId);
  const obligations = useMemo<LeaseObligation[]>(
    () => (Array.isArray(data) ? (data as LeaseObligation[]) : []),
    [data],
  );

  const createObligation = useCreateLeaseObligation();
  const updateObligation = useUpdateLeaseObligation();
  const deleteObligation = useDeleteLeaseObligation();
  const waiveObligation = useWaiveLeaseObligation();
  const recordPayment = useRecordObligationPayment();
  const deletePayment = useDeleteObligationPayment();

  // Every id we have travels with every write — the unit/building deposit
  // rollups on other screens go stale otherwise.
  const scope = { leaseId, unitId, buildingId };

  const obligationModal = useDisclosure();
  const paymentModal = useDisclosure();
  const waiveModal = useDisclosure();

  const [editing, setEditing] = useState<LeaseObligation | null>(null);
  const [target, setTarget] = useState<LeaseObligation | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [obForm, setObForm] = useState<Record<string, string>>(EMPTY_OBLIGATION);
  const [payForm, setPayForm] = useState<Record<string, string>>(EMPTY_PAYMENT);
  const [waiveReason, setWaiveReason] = useState('');

  const [obErr, setObErr] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [waiveErr, setWaiveErr] = useState<string | null>(null);

  const setOb = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setObForm((p) => ({ ...p, [f]: e.target.value }));
  const setPay = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setPayForm((p) => ({ ...p, [f]: e.target.value }));

  // The API rejects a second deposit on a lease — don't offer the option at all.
  const hasDeposit = obligations.some((o) => o.kind === 'SECURITY_DEPOSIT');

  const grouped = useMemo(() => {
    const out: Record<DirectionKey, LeaseObligation[]> = { FROM_TENANT: [], TO_TENANT: [] };
    for (const o of obligations) {
      const key: DirectionKey = o.direction === 'TO_TENANT' ? 'TO_TENANT' : 'FROM_TENANT';
      out[key].push(o);
    }
    return out;
  }, [obligations]);

  /** Mirrors the server rollup: a waived obligation is no longer owed, but
   *  anything actually paid against it still counts as money that moved. */
  const totalsFor = (rows: LeaseObligation[]) => {
    let agreed = 0;
    let paid = 0;
    for (const o of rows) {
      if (o.status !== 'WAIVED') agreed += num(o.totalAmount);
      paid += num(o.paidAmount);
    }
    return { agreed, paid, open: agreed - paid };
  };

  // ── handlers ───────────────────────────────────────────────────────────────

  const openCreate = () => {
    const kind = hasDeposit ? 'TI_ALLOWANCE' : 'SECURITY_DEPOSIT';
    setEditing(null);
    setObForm({ ...EMPTY_OBLIGATION, kind, direction: IMPLIED_DIRECTION[kind] ?? 'FROM_TENANT' });
    setObErr(null);
    obligationModal.onOpen();
  };

  const openEdit = (o: LeaseObligation) => {
    setEditing(o);
    setObForm({
      kind: o.kind,
      direction: o.direction,
      totalAmount: String(num(o.totalAmount)),
      dueDate: toDateInput(o.dueDate),
      notes: o.notes ?? '',
    });
    setObErr(null);
    obligationModal.onOpen();
  };

  const saveObligation = async () => {
    setObErr(null);
    const total = Number(obForm.totalAmount);
    if (!Number.isFinite(total) || total <= 0) {
      setObErr('Enter an agreed amount greater than zero.');
      return;
    }
    if (obForm.kind === 'OTHER' && !obForm.direction) {
      setObErr('Choose which way this money flows.');
      return;
    }

    try {
      if (editing) {
        // `kind` and `direction` are immutable server-side — not sent.
        await updateObligation.mutateAsync({
          ...scope,
          obligationId: editing.id,
          data: {
            totalAmount: total,
            dueDate: obForm.dueDate || null,
            notes: obForm.notes || null,
          },
        });
        addToast({ title: 'Obligation updated', color: 'success' });
      } else {
        await createObligation.mutateAsync({
          ...scope,
          leaseId,
          data: {
            kind: obForm.kind,
            // Only OTHER states a direction; the API infers (and enforces) the rest.
            ...(obForm.kind === 'OTHER' ? { direction: obForm.direction } : {}),
            totalAmount: total,
            dueDate: obForm.dueDate || undefined,
            notes: obForm.notes || undefined,
          },
        });
        addToast({ title: 'Obligation added', color: 'success' });
      }
      obligationModal.onClose();
    } catch (e) {
      setObErr(errMsg(e, 'Failed to save obligation'));
    }
  };

  const removeObligation = async (o: LeaseObligation) => {
    const count = o.payments?.length ?? 0;
    const warn = count
      ? `Delete this ${KIND_LABELS[o.kind] ?? o.kind}? Its ${count} recorded payment${count === 1 ? '' : 's'} will be deleted too.`
      : `Delete this ${KIND_LABELS[o.kind] ?? o.kind}?`;
    if (!confirm(warn)) return;
    try {
      await deleteObligation.mutateAsync({ ...scope, obligationId: o.id });
      addToast({ title: 'Obligation deleted', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete obligation'), color: 'danger' });
    }
  };

  const openPayment = (o: LeaseObligation) => {
    setTarget(o);
    setPayForm({ ...EMPTY_PAYMENT, paidAt: todayInput() });
    setPayErr(null);
    paymentModal.onOpen();
  };

  const savePayment = async () => {
    if (!target) return;
    setPayErr(null);
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayErr('Enter an amount greater than zero.');
      return;
    }
    try {
      await recordPayment.mutateAsync({
        ...scope,
        obligationId: target.id,
        data: {
          amount,
          paidAt: payForm.paidAt ? new Date(payForm.paidAt).toISOString() : undefined,
          method: payForm.method || undefined,
          reference: payForm.reference || undefined,
          notes: payForm.notes || undefined,
        },
      });
      addToast({
        title: target.direction === 'TO_TENANT' ? 'Disbursement recorded' : 'Payment recorded',
        color: 'success',
      });
      setExpanded((p) => ({ ...p, [target.id]: true }));
      paymentModal.onClose();
    } catch (e) {
      setPayErr(errMsg(e, 'Failed to record payment'));
    }
  };

  const removePayment = async (p: ObligationPayment) => {
    if (!confirm(`Delete this ${fmt(num(p.amount))} payment? The paid total will be recalculated.`)) return;
    try {
      await deletePayment.mutateAsync({ ...scope, paymentId: p.id });
      addToast({ title: 'Payment deleted', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete payment'), color: 'danger' });
    }
  };

  const openWaive = (o: LeaseObligation) => {
    setTarget(o);
    setWaiveReason('');
    setWaiveErr(null);
    waiveModal.onOpen();
  };

  const saveWaive = async () => {
    if (!target) return;
    setWaiveErr(null);
    // `reason` is REQUIRED by the API — block rather than round-trip a 400.
    if (!waiveReason.trim()) {
      setWaiveErr('A reason is required to waive an obligation.');
      return;
    }
    try {
      await waiveObligation.mutateAsync({
        ...scope,
        obligationId: target.id,
        data: { reason: waiveReason.trim() },
      });
      addToast({ title: 'Obligation waived', color: 'success' });
      waiveModal.onClose();
    } catch (e) {
      setWaiveErr(errMsg(e, 'Failed to waive obligation'));
    }
  };

  // ── states ─────────────────────────────────────────────────────────────────

  if (isLoading) return <LoadingState message="Loading obligations…" />;
  if (error) return <ErrorState message={errMsg(error, 'Failed to load lease obligations')} />;

  const inTotals = totalsFor(grouped.FROM_TENANT);
  const outTotals = totalsFor(grouped.TO_TENANT);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Deposits &amp; Allowances</p>
          <p className="text-xs text-gray-400">Money owed in both directions on this lease</p>
        </div>
        {canEdit && (
          <Button size="sm" color="primary" startContent={<FiPlus size={14} />} onPress={openCreate}>
            Add obligation
          </Button>
        )}
      </div>

      {/* Two direction tiles, always both rendered — the contrast between
          "money in" and "money out" is the point, so neither is hidden. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DIRECTION_ORDER.map((key) => {
          const meta = DIRECTIONS[key];
          const t = key === 'FROM_TENANT' ? inTotals : outTotals;
          const Icon = meta.icon;
          const rows = grouped[key];
          return (
            <div key={key} className={`rounded-xl border p-3.5 ${meta.tile}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-md bg-white/70 ${meta.text}`}>
                  <Icon size={13} />
                </span>
                <div className="min-w-0">
                  <p className={`text-[11px] font-bold uppercase tracking-wide ${meta.text}`}>{meta.heading}</p>
                  <p className="text-[11px] text-gray-500">{meta.parties}</p>
                </div>
              </div>
              <p className="mt-2.5 text-xl font-semibold text-gray-900">{fmt(t.agreed)}</p>
              <p className="text-[11px] text-gray-500">
                agreed across {rows.length} item{rows.length === 1 ? '' : 's'}
              </p>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-gray-600">
                  {meta.paidWord} <span className="font-semibold text-gray-900">{fmt(t.paid)}</span>
                </span>
                {t.open < 0 ? (
                  <span className="font-semibold text-violet-700">Refund due {fmt(Math.abs(t.open))}</span>
                ) : (
                  <span className="text-gray-600">
                    {meta.openWord} <span className="font-semibold text-gray-900">{fmt(t.open)}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {obligations.length === 0 ? (
        <EmptyState
          title="No obligations yet"
          message="Add the security deposit the tenant owes, or the TI allowance Prime owes the tenant."
          action={
            canEdit ? (
              <Button size="sm" color="primary" startContent={<FiPlus size={14} />} onPress={openCreate}>
                Add obligation
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {DIRECTION_ORDER.map((key) => {
            const rows = grouped[key];
            if (!rows.length) return null;
            const meta = DIRECTIONS[key];
            const Icon = meta.icon;
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
                    <Icon size={11} />
                    {meta.heading}
                  </span>
                  <span className="text-[11px] text-gray-400">{meta.parties}</span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                {rows.map((o) => (
                  <ObligationRow
                    key={o.id}
                    obligation={o}
                    canEdit={canEdit}
                    expanded={!!expanded[o.id]}
                    onToggle={() => setExpanded((p) => ({ ...p, [o.id]: !p[o.id] }))}
                    onEdit={() => openEdit(o)}
                    onDelete={() => removeObligation(o)}
                    onWaive={() => openWaive(o)}
                    onRecord={() => openPayment(o)}
                    onDeletePayment={removePayment}
                    deletingPayment={deletePayment.isPending}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── create / edit obligation ───────────────────────────────────────── */}
      <Modal isOpen={obligationModal.isOpen} onClose={obligationModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader>{editing ? `Edit ${KIND_LABELS[editing.kind] ?? editing.kind}` : 'Add obligation'}</ModalHeader>
          <ModalBody className="space-y-3">
            <FormError message={obErr} />

            {editing ? (
              <ReadOnlyKind kind={editing.kind} direction={editing.direction} />
            ) : (
              <>
                <Select
                  size="sm"
                  label="Kind"
                  selectedKeys={obForm.kind ? [obForm.kind] : []}
                  onSelectionChange={(keys) => {
                    const k = Array.from(keys)[0] as string;
                    if (!k) return;
                    setObForm((p) => ({
                      ...p,
                      kind: k,
                      // Direction is implied for the two fixed kinds; OTHER must state it.
                      direction: IMPLIED_DIRECTION[k] ?? (p.direction || 'FROM_TENANT'),
                    }));
                  }}
                >
                  {/* One deposit per lease — drop the option entirely once one exists. */}
                  {(hasDeposit
                    ? ['TI_ALLOWANCE', 'OTHER']
                    : ['SECURITY_DEPOSIT', 'TI_ALLOWANCE', 'OTHER']
                  ).map((k) => (
                    <SelectItem key={k} textValue={KIND_LABELS[k] ?? k}>
                      {KIND_LABELS[k] ?? k}
                    </SelectItem>
                  ))}
                </Select>

                {hasDeposit && (
                  <p className="-mt-1 text-[11px] text-gray-400">
                    This lease already has a security deposit — edit the existing one instead.
                  </p>
                )}

                {obForm.kind === 'OTHER' ? (
                  <Select
                    size="sm"
                    label="Direction"
                    description="Which way does this money move?"
                    selectedKeys={obForm.direction ? [obForm.direction] : []}
                    onSelectionChange={(keys) => {
                      const d = Array.from(keys)[0] as string;
                      if (d) setObForm((p) => ({ ...p, direction: d }));
                    }}
                  >
                    {DIRECTION_ORDER.map((d) => (
                      <SelectItem key={d} textValue={`${DIRECTIONS[d].parties} — ${DIRECTIONS[d].heading}`}>
                        {`${DIRECTIONS[d].parties} — ${DIRECTIONS[d].heading}`}
                      </SelectItem>
                    ))}
                  </Select>
                ) : (
                  <DirectionNotice kind={obForm.kind} />
                )}
              </>
            )}

            <Input
              size="sm"
              type="number"
              label="Agreed amount"
              placeholder="0.00"
              startContent={<span className="text-sm text-gray-400">$</span>}
              value={obForm.totalAmount}
              onChange={setOb('totalAmount')}
              description={
                obForm.kind === 'TI_ALLOWANCE'
                  ? 'The full agreed allowance. It is disbursed in phases — record each disbursement as a payment.'
                  : undefined
              }
            />

            <Input
              size="sm"
              type="date"
              label="Due date"
              value={obForm.dueDate}
              onChange={setOb('dueDate')}
              startContent={<FiCalendar size={13} className="shrink-0 text-gray-400" />}
            />

            <Textarea size="sm" label="Notes" minRows={2} value={obForm.notes} onChange={setOb('notes')} />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={obligationModal.onClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={saveObligation}
              isLoading={createObligation.isPending || updateObligation.isPending}
            >
              {editing ? 'Save changes' : 'Add obligation'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── record payment / disbursement ──────────────────────────────────── */}
      <Modal isOpen={paymentModal.isOpen} onClose={paymentModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader>
            {target ? dirMeta(target.direction).actionWord : 'Record payment'}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <FormError message={payErr} />

            {target && (
              <div className={`rounded-lg border-l-4 bg-gray-50 p-3 ${dirMeta(target.direction).accent}`}>
                <p className="text-xs font-semibold text-gray-800">
                  {KIND_LABELS[target.kind] ?? target.kind}
                </p>
                <p className={`text-[11px] font-medium ${dirMeta(target.direction).text}`}>
                  {dirMeta(target.direction).parties}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  {fmt(num(target.paidAmount))} of {fmt(num(target.totalAmount))}{' '}
                  {dirMeta(target.direction).paidWord.toLowerCase()} so far
                  {(target.payments?.length ?? 0) > 0 &&
                    ` across ${target.payments?.length} entr${(target.payments?.length ?? 0) === 1 ? 'y' : 'ies'}`}
                </p>
              </div>
            )}

            <Input
              size="sm"
              type="number"
              label="Amount"
              placeholder="0.00"
              startContent={<span className="text-sm text-gray-400">$</span>}
              value={payForm.amount}
              onChange={setPay('amount')}
            />
            <Input size="sm" type="date" label="Paid on" value={payForm.paidAt} onChange={setPay('paidAt')} />

            <Select
              size="sm"
              label="Method"
              placeholder="Select a method"
              selectedKeys={payForm.method ? [payForm.method] : []}
              onSelectionChange={(keys) => {
                const m = Array.from(keys)[0] as string;
                setPayForm((p) => ({ ...p, method: m ?? '' }));
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} textValue={m}>{m}</SelectItem>
              ))}
            </Select>

            <Input
              size="sm"
              label="Reference"
              placeholder="Wire ref / cheque no."
              value={payForm.reference}
              onChange={setPay('reference')}
            />
            <Textarea size="sm" label="Notes" minRows={2} value={payForm.notes} onChange={setPay('notes')} />

            <p className="text-[11px] text-gray-400">
              Overpayments are allowed — the balance simply flips to a refund due.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={paymentModal.onClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={savePayment} isLoading={recordPayment.isPending}>
              {target ? dirMeta(target.direction).actionWord : 'Record'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── waive ──────────────────────────────────────────────────────────── */}
      <Modal isOpen={waiveModal.isOpen} onClose={waiveModal.onClose}>
        <ModalContent>
          <ModalHeader>Waive obligation</ModalHeader>
          <ModalBody className="space-y-3">
            <FormError message={waiveErr} />
            <p className="text-sm text-gray-600">
              Waiving forgives the outstanding balance on{' '}
              <span className="font-semibold">{target ? KIND_LABELS[target.kind] ?? target.kind : 'this obligation'}</span>.
              Payments already recorded are kept.
            </p>
            <Textarea
              size="sm"
              label="Reason"
              isRequired
              minRows={3}
              placeholder="e.g. Deposit waived at signing in exchange for a longer term"
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={waiveModal.onClose}>Cancel</Button>
            <Button
              size="sm"
              color="warning"
              onPress={saveWaive}
              isDisabled={!waiveReason.trim()}
              isLoading={waiveObligation.isPending}
            >
              Waive
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

/** Kind + its locked direction, shown read-only when editing. */
function ReadOnlyKind({ kind, direction }: { kind: string; direction: string }) {
  const meta = dirMeta(direction);
  const Icon = meta.icon;
  return (
    <div className={`rounded-lg border-l-4 bg-gray-50 p-3 ${meta.accent}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md bg-white ${meta.text}`}>
          <Icon size={13} />
        </span>
        <div>
          <p className="text-xs font-semibold text-gray-800">{KIND_LABELS[kind] ?? kind}</p>
          <p className={`text-[11px] font-medium ${meta.text}`}>{meta.parties}</p>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">
        Kind and direction can&apos;t be changed — delete and re-create if this was mis-filed.
      </p>
    </div>
  );
}

/** Reassures the user which way the money flows for a direction-locked kind. */
function DirectionNotice({ kind }: { kind: string }) {
  const key = IMPLIED_DIRECTION[kind];
  if (!key) return null;
  const meta = DIRECTIONS[key];
  const Icon = meta.icon;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${meta.chip}`}>
      <Icon size={13} className="shrink-0" />
      <p className="text-[11px] font-medium">
        {meta.parties} — {meta.heading}. Direction is fixed for a {(KIND_LABELS[kind] ?? kind).toLowerCase()}.
      </p>
    </div>
  );
}

interface ObligationRowProps {
  obligation: LeaseObligation;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onWaive: () => void;
  onRecord: () => void;
  onDeletePayment: (p: ObligationPayment) => void;
  deletingPayment: boolean;
}

function ObligationRow({
  obligation: o, canEdit, expanded, onToggle, onEdit, onDelete, onWaive, onRecord,
  onDeletePayment, deletingPayment,
}: ObligationRowProps) {
  const meta = dirMeta(o.direction);
  const Icon = meta.icon;

  const total = num(o.totalAmount);
  const paid = num(o.paidAmount);
  const pending = total - paid;          // may be NEGATIVE — overpayment is allowed
  const overpaid = pending < 0;
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  const payments = o.payments ?? [];
  const waived = o.status === 'WAIVED';
  const overdue = isOverdue(o);

  return (
    <div className={`rounded-xl border border-gray-200 border-l-4 bg-white ${meta.accent}`}>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.chip} border`}>
              <Icon size={14} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-gray-900">{KIND_LABELS[o.kind] ?? o.kind}</p>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CHIP[o.status] ?? STATUS_CHIP.PENDING}`}>
                  {o.status}
                </span>
                {overdue && (
                  <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                    <FiAlertTriangle size={9} /> OVERDUE
                  </span>
                )}
              </div>
              {/* Direction stated in words on every row — never inferred from colour alone. */}
              <p className={`text-[11px] font-medium ${meta.text}`}>{meta.parties}</p>
              {o.dueDate && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-400">
                  <FiCalendar size={10} /> Due {fmtDate(o.dueDate)}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-base font-semibold text-gray-900">{fmt(total)}</p>
            <p className="text-[11px] text-gray-500">
              {meta.paidWord.toLowerCase()} {fmt(paid)}
            </p>
          </div>
        </div>

        <div className="mt-2.5">
          <Progress
            size="sm"
            aria-label={`${meta.paidWord} progress`}
            value={pct}
            color={waived ? 'secondary' : overpaid ? 'primary' : meta.bar}
            className="max-w-full"
          />
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-400">
              {waived
                ? 'Waived — no balance owed'
                : `${Math.round(pct)}% ${meta.paidWord.toLowerCase()}`}
            </span>
            {/* Overpayment is legal, so a negative pending is a REFUND, not an error. */}
            {overpaid ? (
              <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-700">
                <FiCornerUpLeft size={10} />
                Overpaid by {fmt(Math.abs(pending))} — refund due
              </span>
            ) : (
              <span className="font-medium text-gray-600">
                {meta.openWord} <span className="text-gray-900">{fmt(waived ? 0 : pending)}</span>
              </span>
            )}
          </div>
        </div>

        {o.notes && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
            {o.notes}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="light"
            className="h-7 min-w-0 px-2 text-[11px]"
            startContent={expanded ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
            onPress={onToggle}
          >
            {payments.length} payment{payments.length === 1 ? '' : 's'}
          </Button>

          <div className="flex-1" />

          {canEdit && !waived && (
            <Button size="sm" color="primary" variant="flat" className="h-7 min-w-0 px-2.5 text-[11px]" onPress={onRecord}>
              {payments.length > 0 ? `Record another · ${meta.actionWord.replace('Record ', '')}` : meta.actionWord}
            </Button>
          )}
          {canEdit && (
            <>
              <Tooltip content="Edit" size="sm">
                <Button size="sm" variant="light" isIconOnly className="h-7 w-7 min-w-0" onPress={onEdit} aria-label="Edit obligation">
                  <FiEdit2 size={12} />
                </Button>
              </Tooltip>
              {!waived && (
                <Tooltip content="Waive" size="sm">
                  <Button size="sm" variant="light" isIconOnly className="h-7 w-7 min-w-0" onPress={onWaive} aria-label="Waive obligation">
                    <FiSlash size={12} />
                  </Button>
                </Tooltip>
              )}
              <Tooltip content="Delete" size="sm">
                <Button size="sm" variant="light" color="danger" isIconOnly className="h-7 w-7 min-w-0" onPress={onDelete} aria-label="Delete obligation">
                  <FiTrash2 size={12} />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
          {payments.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-gray-400">
              Nothing recorded yet.
              {o.kind === 'TI_ALLOWANCE' && ' A TI allowance is normally disbursed across several phases.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-900">{fmt(num(p.amount))}</span>
                      <span className="text-[11px] text-gray-500">{fmtDate(p.paidAt)}</span>
                      {p.method && (
                        <Chip size="sm" variant="flat" className="h-4 px-1 text-[10px]">{p.method}</Chip>
                      )}
                      {p.reference && (
                        <span className="truncate text-[10px] text-gray-400">ref {p.reference}</span>
                      )}
                    </div>
                    {p.notes && <p className="truncate text-[10px] text-gray-400">{p.notes}</p>}
                  </div>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      isIconOnly
                      className="h-6 w-6 min-w-0 shrink-0"
                      isDisabled={deletingPayment}
                      onPress={() => onDeletePayment(p)}
                      aria-label="Delete payment"
                    >
                      <FiTrash2 size={11} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

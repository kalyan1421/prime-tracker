/**
 * The two ways a unit changes hands, as dialogs.
 *
 *   EndTenancyDialog    the tenancy ENDS — turnover, renewal or relocation
 *   AssignTenantDialog  the lease SURVIVES, only the party changes
 *
 * Keeping them in one file is deliberate: the hardest thing for a user here is
 * choosing between them, and the choice is easier to keep coherent when the two
 * dialogs are written side by side. Each one opens with a plain sentence saying what
 * it will and will not do.
 *
 * Ending a tenancy is a multi-aggregate write — it caps the rent schedule, voids the
 * unpaid invoices past the move-out date and releases the unit — so the dialog states
 * those consequences BEFORE the button is pressed rather than reporting them after.
 * The server refuses outright if rent has already been collected past the date, and
 * that message is surfaced verbatim; it names the months, which is what makes it
 * actionable.
 */

import { useMemo, useState } from 'react';
import {
  Button, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Select, SelectItem, Textarea, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiArrowRight, FiLogOut, FiRepeat } from 'react-icons/fi';
import { useEndTenancy, useAssignTenant, useLeases } from '../hooks/useApi';
import { errMsg, fmtDate } from '../utils/fmt';

// Values must match TERMINATION_REASONS in leases.service.ts. Ordered by how often
// Prime will reach for them, not alphabetically.
const TERMINATION_REASONS = [
  { key: 'EXPIRED', label: 'Lease expired', hint: 'Ran to the end of the term' },
  { key: 'NON_RENEWAL', label: 'Not renewed', hint: 'Term ended, neither side renewed' },
  { key: 'EARLY_TERMINATION', label: 'Ended early', hint: 'Tenant left before the term ended' },
  { key: 'MUTUAL', label: 'Mutual agreement', hint: 'Both sides agreed to end it' },
  { key: 'RENEWED', label: 'Renewed onto a new lease', hint: 'Same tenant, new paperwork' },
  { key: 'RELOCATED', label: 'Tenant relocated', hint: 'Same tenant, different unit' },
  { key: 'LANDLORD_TERMINATED', label: 'Terminated by Prime', hint: 'Prime ended the lease' },
  { key: 'EVICTION', label: 'Eviction', hint: 'Tenant removed for cause' },
  { key: 'TENANT_BOUGHT', label: 'Tenant bought the unit', hint: 'Lease ends at closing' },
];

/** The reasons that assert the tenancy CONTINUES — these want a successor lease. */
const CONTINUING_REASONS = ['RENEWED', 'RELOCATED'];

const DEPOSIT_DISPOSITIONS = [
  { key: 'DECIDE_LATER', label: 'Decide later', hint: 'Leave the deposit open for Finance' },
  { key: 'REFUND', label: 'Refund to tenant', hint: 'Records the decision; Finance books the payment' },
  { key: 'FORFEIT', label: 'Forfeited to Prime', hint: 'Records the decision; the money stays' },
  { key: 'TRANSFER', label: 'Transfer to the next lease', hint: 'Moves the held balance across' },
];

const ASSIGNMENT_REASONS = [
  { key: 'BUSINESS_SALE', label: 'Business sold' },
  { key: 'NOVATION', label: 'Novation' },
  { key: 'ENTITY_RESTRUCTURE', label: 'Entity restructure' },
  { key: 'OTHER', label: 'Other' },
];

const today = () => new Date().toISOString().slice(0, 10);

interface LeaseLike {
  id: string;
  unitId?: string | null;
  tenantName?: string | null;
  tenantBrand?: string | null;
  leaseStart?: string;
  leaseEnd?: string;
  terminationDate?: string | null;
}

// ---------------------------------------------------------------------------
// End tenancy
// ---------------------------------------------------------------------------

export function EndTenancyDialog({
  lease, isOpen, onClose, projectId,
}: {
  lease: LeaseLike | null;
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}) {
  const endTenancy = useEndTenancy();
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Candidate successors: any other lease, so a relocation can point at a lease on a
  // different unit. Filtered to those that have not themselves ended.
  const { data: leases } = useLeases(projectId ?? '');
  const successors = useMemo(
    () =>
      (Array.isArray(leases) ? leases : []).filter(
        (l: LeaseLike) => l.id !== lease?.id && !l.terminationDate,
      ),
    [leases, lease?.id],
  );

  if (!lease) return null;

  const reason = form.terminationReason ?? '';
  const wantsSuccessor = CONTINUING_REASONS.includes(reason);
  const terminationDate = form.terminationDate ?? today();
  const contractedEnd = lease.leaseEnd ? lease.leaseEnd.slice(0, 10) : null;
  // Shown before submitting, because "will this count as early?" is the question the
  // date field raises and the answer is derivable right here.
  const isEarly = !!contractedEnd && terminationDate < contractedEnd;
  const isHoldover = !!contractedEnd && terminationDate > contractedEnd;

  const submit = async () => {
    if (!reason) {
      addToast({ title: 'Choose why the tenancy ended', color: 'warning' });
      return;
    }
    if (form.depositDisposition === 'TRANSFER' && !form.successorLeaseId) {
      addToast({ title: 'Transferring the deposit needs a successor lease', color: 'warning' });
      return;
    }
    try {
      const res = await endTenancy.mutateAsync({
        id: lease.id,
        data: {
          terminationDate,
          terminationReason: reason,
          terminationNote: form.terminationNote || undefined,
          successorLeaseId: form.successorLeaseId || undefined,
          depositDisposition: form.depositDisposition || undefined,
          depositNote: form.depositNote || undefined,
        },
      });
      // Report what actually happened rather than a generic success — the voided
      // invoice count is the number a user will want to sanity-check.
      const bits = [
        res?.unitReleased ? 'unit released' : 'unit kept (tenancy continues)',
        res?.invoicesVoided ? `${res.invoicesVoided} invoice(s) voided` : null,
      ].filter(Boolean);
      addToast({ title: `Tenancy ended — ${bits.join(', ')}`, color: 'success' });
      setForm({});
      onClose();
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not end the tenancy'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FiLogOut className="text-rose-500" />
          End tenancy — {lease.tenantBrand || lease.tenantName}
        </ModalHeader>
        <ModalBody className="gap-4">
          <p className="text-sm text-gray-600">
            Records when the tenant actually left. The rent schedule is cut off at that
            date, unpaid invoices billed after it are voided, and the unit is released —
            unless another lease continues the tenancy.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              type="date"
              label="Move-out date"
              description="When they actually left — not the contracted expiry"
              value={terminationDate}
              onValueChange={set('terminationDate')}
              isRequired
            />
            <Select
              label="Reason"
              selectedKeys={reason ? [reason] : []}
              onSelectionChange={(k) => set('terminationReason')(String(Array.from(k)[0] ?? ''))}
              isRequired
            >
              {TERMINATION_REASONS.map((r) => (
                <SelectItem key={r.key} textValue={r.label} description={r.hint}>
                  {r.label}
                </SelectItem>
              ))}
            </Select>
          </div>

          {isEarly && (
            <div className="flex items-start gap-2 rounded-md bg-rose-50 p-3 text-sm text-rose-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" />
              <span>
                This is an early exit — the term runs to {fmtDate(contractedEnd!)}. The
                lease keeps its contracted end date; the difference is recorded as the
                early-termination gap.
              </span>
            </div>
          )}
          {isHoldover && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" />
              <span>
                This is after the contracted end of {fmtDate(contractedEnd!)} — it will be
                recorded as holdover.
              </span>
            </div>
          )}

          {/* A successor has to EXIST before it can be linked — this dialog cannot
              create one, and an empty dropdown with no explanation is the single most
              confusing thing in the flow. So when there is nothing to pick, say what to
              do instead of offering an empty list. */}
          {successors.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 p-3 text-sm text-gray-600">
              <p className="font-medium text-gray-700">No successor lease to link</p>
              <p className="mt-1">
                {wantsSuccessor ? (
                  <>
                    A {reason === 'RENEWED' ? 'renewal' : 'relocation'} continues the
                    tenancy, so it needs the new lease to exist first. Create it —{' '}
                    <strong>+ Add Lease</strong> on the unit for a renewal, or on the new
                    unit for a relocation — then end this tenancy and link it here.
                  </>
                ) : (
                  <>
                    Only needed for a renewal or relocation. Create the new lease first,
                    then it will appear here. Leave this alone for a genuine turnover.
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                You can also end the tenancy now and link the successor later by editing
                the lease — nothing here is one-way.
              </p>
            </div>
          ) : (
            <Select
              label="Successor lease (optional)"
              description={
                wantsSuccessor
                  ? 'Required for a renewal or relocation — links the two tenancies so the timeline shows continuous occupancy'
                  : 'Only for a renewal or relocation. Leave empty for a genuine turnover.'
              }
              selectedKeys={form.successorLeaseId ? [form.successorLeaseId] : []}
              onSelectionChange={(k) => set('successorLeaseId')(String(Array.from(k)[0] ?? ''))}
            >
              {successors.map((l: LeaseLike) => (
                <SelectItem
                  key={l.id}
                  textValue={`${l.tenantBrand || l.tenantName} — from ${l.leaseStart?.slice(0, 10)}`}
                >
                  {`${l.tenantBrand || l.tenantName} — from ${l.leaseStart?.slice(0, 10)}`}
                </SelectItem>
              ))}
            </Select>
          )}

          {/* Chosen a continuing reason but not linked anything: the tenancy would be
              recorded as continuing with nothing to continue INTO, and the timeline
              would show a vacancy that did not happen. */}
          {wantsSuccessor && successors.length > 0 && !form.successorLeaseId && (
            <p className="-mt-2 text-xs text-amber-700">
              Pick the lease this tenancy continues into, or the unit will be released and
              the timeline will show a vacancy.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Security deposit"
              selectedKeys={[form.depositDisposition || 'DECIDE_LATER']}
              onSelectionChange={(k) => set('depositDisposition')(String(Array.from(k)[0] ?? ''))}
            >
              {DEPOSIT_DISPOSITIONS.map((d) => (
                <SelectItem key={d.key} textValue={d.label} description={d.hint}>
                  {d.label}
                </SelectItem>
              ))}
            </Select>
            <Input
              label="Deposit note"
              value={form.depositNote ?? ''}
              onValueChange={set('depositNote')}
            />
          </div>
          {/* Says plainly that this is a record, not a payment — otherwise "Refund to
              tenant" reads like the money has been sent. */}
          {['REFUND', 'FORFEIT'].includes(form.depositDisposition ?? '') && (
            <p className="text-xs text-gray-500 -mt-2">
              This records the decision only. The actual refund is booked as a payment on
              the deposit in Deposits &amp; Allowances.
            </p>
          )}

          <Textarea
            label="Notes"
            value={form.terminationNote ?? ''}
            onValueChange={set('terminationNote')}
            minRows={2}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button color="danger" onPress={submit} isLoading={endTenancy.isPending}>
            End tenancy
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Assign tenant
// ---------------------------------------------------------------------------

export function AssignTenantDialog({
  lease, isOpen, onClose,
}: {
  lease: LeaseLike | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const assign = useAssignTenant();
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (!lease) return null;

  const submit = async () => {
    if (!form.toTenantName?.trim()) {
      addToast({ title: 'The new tenant name is required', color: 'warning' });
      return;
    }
    try {
      await assign.mutateAsync({
        id: lease.id,
        data: {
          effectiveDate: form.effectiveDate || today(),
          toTenantName: form.toTenantName.trim(),
          toTenantLegalName: form.toTenantLegalName || undefined,
          toTenantContact: form.toTenantContact || undefined,
          toTenantEmail: form.toTenantEmail || undefined,
          toTenantPhone: form.toTenantPhone || undefined,
          reason: form.reason || undefined,
          note: form.note || undefined,
        },
      });
      addToast({ title: 'Lease assigned to the new tenant', color: 'success' });
      setForm({});
      onClose();
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not assign the lease'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FiRepeat className="text-violet-500" />
          Assign lease to a new tenant
        </ModalHeader>
        <ModalBody className="gap-4">
          {/* The single most important sentence in this dialog. Users reach for
              "assign" when they mean "new tenant", and the two are not the same. */}
          <div className="rounded-md bg-violet-50 p-3 text-sm text-violet-900">
            <p className="font-medium flex items-center gap-2">
              {lease.tenantBrand || lease.tenantName}
              <FiArrowRight className="shrink-0" />
              {form.toTenantName || 'new tenant'}
            </p>
            <p className="mt-1 text-violet-800">
              The lease itself does not change — same rent, same dates, same term, and the
              invoice history stays intact. Use this for a business sale or a change of
              legal entity. If the tenancy is ending and someone new is taking the space,
              end the tenancy and create a new lease instead.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              type="date"
              label="Effective date"
              description="When the assignment takes legal effect"
              value={form.effectiveDate ?? today()}
              onValueChange={set('effectiveDate')}
              isRequired
            />
            <Select
              label="Reason"
              selectedKeys={form.reason ? [form.reason] : []}
              onSelectionChange={(k) => set('reason')(String(Array.from(k)[0] ?? ''))}
            >
              {ASSIGNMENT_REASONS.map((r) => (
                <SelectItem key={r.key} textValue={r.label}>{r.label}</SelectItem>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="New tenant name"
              value={form.toTenantName ?? ''}
              onValueChange={set('toTenantName')}
              isRequired
            />
            <Input
              label="Legal entity (LLC)"
              value={form.toTenantLegalName ?? ''}
              onValueChange={set('toTenantLegalName')}
            />
            <Input
              label="Contact person"
              value={form.toTenantContact ?? ''}
              onValueChange={set('toTenantContact')}
            />
            <Input
              label="Email"
              type="email"
              value={form.toTenantEmail ?? ''}
              onValueChange={set('toTenantEmail')}
            />
            <Input
              label="Phone"
              value={form.toTenantPhone ?? ''}
              onValueChange={set('toTenantPhone')}
            />
          </div>
          {/* Contact fields left blank are NOT cleared server-side — worth saying, or
              users will retype details that are already correct. */}
          <p className="text-xs text-gray-500 -mt-2">
            Leave a contact field blank to keep the existing value.
          </p>

          <Textarea
            label="Notes"
            value={form.note ?? ''}
            onValueChange={set('note')}
            minRows={2}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button color="secondary" onPress={submit} isLoading={assign.isPending}>
            Assign lease
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

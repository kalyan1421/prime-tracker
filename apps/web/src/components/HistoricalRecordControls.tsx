/**
 * Deleting a backfilled record takes a Founder (R27, generalized to sales by R6).
 *
 * The asymmetry this UI expresses: a live lease/sale can be rebuilt or re-entered from
 * its own terms, so deleting one loses nothing. A backfilled record carries a ledger or
 * deal somebody typed in from paper the system never witnessed — its deletion is
 * unrecoverable, so it takes a second person.
 *
 * The approve/reject controls sit HERE, on the record, rather than in a separate admin
 * queue. An approver who cannot see the record they are erasing is rubber-stamping, and
 * the whole point of the gate is that somebody actually looks.
 *
 * Two shapes, same rules. The `card` variant explains itself and suits a panel that has
 * room for a paragraph. The `inline` variant is a single icon for a dense list — the
 * unit history timeline, where every backfilled row needs its own control and a stack of
 * amber panels would bury the history it is meant to annotate. Inline moves the same
 * copy into the modal rather than dropping it: the explanation appears when it matters,
 * at the point of deciding, instead of permanently.
 */

import { useState } from 'react';
import {
  Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, Tooltip, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiArchive, FiClock, FiTrash2 } from 'react-icons/fi';
import {
  useCancelHistoricalDeletion,
  useDecideHistoricalDeletion,
  useDeleteLease,
  useDeleteSale,
  useHistoricalDeletionRequests,
  useRequestHistoricalDeletion,
  useRequestSaleHistoricalDeletion,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmtDate } from '../utils/fmt';

export interface HistoricalRecord {
  kind: 'lease' | 'sale';
  id: string;
  /** Tenant name for a lease, buyer for a sale — what the confirmation copy names. */
  label: string;
  /** e.g. "Jan 1, 2019 – Jan 1, 2022" for a lease, "Closed Mar 15, 2021" for a sale. */
  dateRangeLabel: string;
}

export function HistoricalRecordControls({ record, onDeleted, variant = 'card' }: {
  record: HistoricalRecord;
  onDeleted?: () => void;
  /** `card` for a panel with room to explain; `inline` for one icon in a dense list. */
  variant?: 'card' | 'inline';
}) {
  const { kind, id, label, dateRangeLabel } = record;
  const { user, hasPermission } = useAuthStore();
  const canRequest = hasPermission('unit:history:backfill');
  const canDecide = hasPermission('unit:history:delete');

  const requestLease = useRequestHistoricalDeletion();
  const requestSale = useRequestSaleHistoricalDeletion();
  const decide = useDecideHistoricalDeletion();
  const cancel = useCancelHistoricalDeletion();
  const deleteLease = useDeleteLease();
  const deleteSale = useDeleteSale();
  const del = kind === 'lease' ? deleteLease : deleteSale;
  // Both queues, because the state this record is in is either pending or approved and
  // the card has to say which. Each is a cheap list and only loads for an approver.
  const { data: pending } = useHistoricalDeletionRequests('PENDING');
  const { data: approved } = useHistoricalDeletionRequests('APPROVED');

  const [askOpen, setAskOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Inline has no room for the pending-request card, so the same decision moves here.
  const [manageOpen, setManageOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const matches = (r: any) => (kind === 'lease' ? r.leaseId === id : r.saleId === id);
  const pendingReq = (pending ?? []).find(matches);
  const approvedReq = (approved ?? []).find(matches);
  const ownRequest = pendingReq && pendingReq.requestedById === user?.id;

  const submitRequest = async () => {
    if (reason.trim().length < 10) {
      addToast({ title: 'Say why in a sentence — the approver sees only this', color: 'warning' });
      return;
    }
    try {
      if (kind === 'lease') await requestLease.mutateAsync({ leaseId: id, reason: reason.trim() });
      else await requestSale.mutateAsync({ saleId: id, reason: reason.trim() });
      addToast({ title: 'Sent for Founder approval', color: 'success' });
      setAskOpen(false);
      setReason('');
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not send the request'), color: 'danger' });
    }
  };

  const submitDecision = async (approve: boolean) => {
    try {
      await decide.mutateAsync({ requestId: pendingReq.id, approve, note: note.trim() || undefined });
      addToast({
        title: approve
          ? 'Approved — the record can now be deleted'
          : 'Rejected — the record stays',
        color: approve ? 'success' : 'default',
      });
      setNote('');
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not record the decision'), color: 'danger' });
    }
  };

  const doDelete = async () => {
    try {
      await del.mutateAsync(id);
      addToast({ title: 'Historical record deleted', color: 'success' });
      onDeleted?.();
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not delete the record'), color: 'danger' });
    }
  };

  const doWithdraw = async () => {
    try {
      await cancel.mutateAsync(pendingReq.id);
      addToast({ title: 'Request withdrawn', color: 'default' });
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not withdraw the request'), color: 'danger' });
    }
  };

  const modals = (
    <>
      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>Delete this historical record?</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-gray-600">{label} · {dateRangeLabel}</p>
            <p className="text-sm text-gray-700">
              This {kind === 'lease' ? 'tenancy and its whole rent ledger were' : 'sale and its whole deal record were'}
              {' '}typed in from records, so nothing here can be regenerated. You hold the
              approval permission, so this is recorded as self-approved against your name.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              color="danger"
              isLoading={del.isPending}
              onPress={async () => { await doDelete(); setConfirmOpen(false); }}
            >
              Delete record
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={askOpen} onClose={() => setAskOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>Request deletion of a historical record</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-gray-600">{label} · {dateRangeLabel}</p>
            <Textarea
              label="Why should this be deleted?"
              description="A Founder sees only this sentence and the record itself."
              value={reason}
              onValueChange={setReason}
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setAskOpen(false)}>Cancel</Button>
            <Button
              color="danger"
              isLoading={kind === 'lease' ? requestLease.isPending : requestSale.isPending}
              onPress={submitRequest}
            >
              Send for approval
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Inline only — the card shows this state in place, so it never opens this. */}
      <Modal isOpen={manageOpen} onClose={() => setManageOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>Deletion awaiting approval</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-gray-600">{label} · {dateRangeLabel}</p>
            {pendingReq && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">
                  Requested {fmtDate(pendingReq.requestedAt)}
                  {pendingReq.requestedBy?.name ? ` by ${pendingReq.requestedBy.name}` : ''}
                </p>
                <p className="text-sm text-gray-800 mt-1">“{pendingReq.reason}”</p>
              </div>
            )}
            {canDecide && !ownRequest && (
              <Textarea
                size="sm"
                minRows={1}
                label="Note for the record (optional)"
                value={note}
                onValueChange={setNote}
              />
            )}
            {canDecide && ownRequest && (
              <p className="flex items-center gap-1.5 text-xs text-amber-800">
                <FiAlertTriangle className="w-3.5 h-3.5 shrink-0" />
                You raised this request, so somebody else has to approve it.
              </p>
            )}
            {!canDecide && !ownRequest && (
              <p className="text-xs text-gray-500">Waiting on a Founder.</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setManageOpen(false)}>Close</Button>
            {ownRequest && (
              <Button
                variant="flat"
                isLoading={cancel.isPending}
                onPress={async () => { await doWithdraw(); setManageOpen(false); }}
              >
                Withdraw request
              </Button>
            )}
            {canDecide && !ownRequest && (
              <>
                <Button
                  variant="flat"
                  isLoading={decide.isPending}
                  onPress={async () => { await submitDecision(false); setManageOpen(false); }}
                >
                  Reject
                </Button>
                <Button
                  color="danger"
                  isLoading={decide.isPending}
                  onPress={async () => { await submitDecision(true); setManageOpen(false); }}
                >
                  Approve deletion
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );

  if (variant === 'inline') {
    return (
      <span className="shrink-0">
        {/* Pending outranks everything: the record is already spoken for, and the only
            useful action is to advance or withdraw that request, not raise a second. */}
        {pendingReq && (
          <Tooltip content={canDecide && !ownRequest ? 'Deletion requested — decide' : 'Deletion requested'}>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label="Deletion requested"
              onPress={() => setManageOpen(true)}
            >
              <FiClock className="w-4 h-4 text-amber-600" />
            </Button>
          </Tooltip>
        )}
        {!pendingReq && approvedReq && canRequest && (
          <Tooltip content="Approved — delete now">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              aria-label="Delete now"
              isLoading={del.isPending}
              onPress={doDelete}
            >
              <FiTrash2 className="w-4 h-4" />
            </Button>
          </Tooltip>
        )}
        {!pendingReq && !approvedReq && (canDecide || canRequest) && (
          <Tooltip content={canDecide ? 'Delete this historical record' : 'Request deletion'}>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              aria-label={canDecide ? 'Delete this historical record' : 'Request deletion'}
              onPress={() => (canDecide ? setConfirmOpen(true) : setAskOpen(true))}
            >
              <FiTrash2 className="w-4 h-4" />
            </Button>
          </Tooltip>
        )}
        {modals}
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <FiArchive className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">Entered from records</p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              This {kind === 'lease' ? 'tenancy' : 'sale'} was typed in after the fact, so its
              {kind === 'lease' ? ' ledger' : ' deal'} cannot be rebuilt. Deleting it needs a
              Founder's approval.
            </p>
          </div>
        </div>

        {/* An approver IS the second pair of eyes, so they delete directly and it is
            recorded as self-approved. Everyone else asks. */}
        {!pendingReq && !approvedReq && canDecide && (
          <Button size="sm" variant="light" color="danger" onPress={() => setConfirmOpen(true)}>
            Delete record
          </Button>
        )}
        {!pendingReq && !approvedReq && canRequest && !canDecide && (
          <Button size="sm" variant="light" color="danger" onPress={() => setAskOpen(true)}>
            Request deletion
          </Button>
        )}

        {/* Approved and waiting for the deliberate second act. */}
        {approvedReq && canRequest && (
          <Button
            size="sm"
            color="danger"
            startContent={<FiTrash2 className="w-3.5 h-3.5" />}
            isLoading={del.isPending}
            onPress={doDelete}
          >
            Delete now
          </Button>
        )}
      </div>

      {pendingReq && (
        <div className="mt-2.5 rounded-md bg-white border border-amber-200 p-2.5">
          <p className="text-[11px] text-gray-500">
            Deletion requested {fmtDate(pendingReq.requestedAt)}
            {pendingReq.requestedBy?.name ? ` by ${pendingReq.requestedBy.name}` : ''}
          </p>
          <p className="text-xs text-gray-800 mt-1">“{pendingReq.reason}”</p>

          {canDecide && !ownRequest && (
            <div className="mt-2.5 space-y-2">
              <Textarea
                size="sm"
                minRows={1}
                placeholder="Note for the record (optional)"
                value={note}
                onValueChange={setNote}
              />
              <div className="flex gap-2">
                <Button size="sm" color="danger" isLoading={decide.isPending}
                  onPress={() => submitDecision(true)}>
                  Approve deletion
                </Button>
                <Button size="sm" variant="flat" isLoading={decide.isPending}
                  onPress={() => submitDecision(false)}>
                  Reject
                </Button>
              </div>
            </div>
          )}
          {canDecide && ownRequest && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-800">
              <FiAlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You raised this request, so somebody else has to approve it.
            </p>
          )}
          {!canDecide && !ownRequest && (
            <p className="mt-2 text-[11px] text-gray-500">Waiting on a Founder.</p>
          )}
          {/* Withdrawing is the requester's own — changing your mind should not need a
              Founder to say no on your behalf. */}
          {ownRequest && (
            <div className="mt-2 flex items-center gap-2">
              {!canDecide && <span className="text-[11px] text-gray-500">Waiting on a Founder.</span>}
              <Button
                size="sm"
                variant="light"
                isLoading={cancel.isPending}
                onPress={doWithdraw}
              >
                Withdraw request
              </Button>
            </div>
          )}
        </div>
      )}

      {approvedReq && (
        <p className="mt-2 text-[11px] text-emerald-700">
          Approved {fmtDate(approvedReq.decidedAt)}
          {approvedReq.decidedBy?.name ? ` by ${approvedReq.decidedBy.name}` : ''}
          {approvedReq.decisionNote ? ` — “${approvedReq.decisionNote}”` : ''}
        </p>
      )}

      {modals}
    </div>
  );
}

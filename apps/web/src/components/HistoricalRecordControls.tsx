/**
 * Deleting a backfilled tenancy takes a Founder (R27).
 *
 * The asymmetry this UI expresses: a live lease can be rebuilt from its own terms, so
 * deleting one loses nothing. A backfilled tenancy carries a ledger somebody typed in
 * from paper the system never witnessed — its deletion is unrecoverable, so it takes a
 * second person.
 *
 * The approve/reject controls sit HERE, on the record, rather than in a separate admin
 * queue. An approver who cannot see the tenancy they are erasing is rubber-stamping, and
 * the whole point of the gate is that somebody actually looks.
 */

import { useState } from 'react';
import {
  Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiArchive, FiTrash2 } from 'react-icons/fi';
import {
  useCancelHistoricalDeletion,
  useDecideHistoricalDeletion,
  useDeleteLease,
  useHistoricalDeletionRequests,
  useRequestHistoricalDeletion,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg, fmtDate } from '../utils/fmt';

export function HistoricalRecordControls({ lease, onDeleted }: {
  lease: any;
  onDeleted?: () => void;
}) {
  const { user, hasPermission } = useAuthStore();
  const canRequest = hasPermission('unit:history:backfill');
  const canDecide = hasPermission('unit:history:delete');

  const request = useRequestHistoricalDeletion();
  const decide = useDecideHistoricalDeletion();
  const cancel = useCancelHistoricalDeletion();
  const del = useDeleteLease();
  // Both queues, because the state this record is in is either pending or approved and
  // the card has to say which. Each is a cheap list and only loads for an approver.
  const { data: pending } = useHistoricalDeletionRequests('PENDING');
  const { data: approved } = useHistoricalDeletionRequests('APPROVED');

  const [askOpen, setAskOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const pendingReq = (pending ?? []).find((r: any) => r.leaseId === lease.id);
  const approvedReq = (approved ?? []).find((r: any) => r.leaseId === lease.id);
  const ownRequest = pendingReq && pendingReq.requestedById === user?.id;

  const submitRequest = async () => {
    if (reason.trim().length < 10) {
      addToast({ title: 'Say why in a sentence — the approver sees only this', color: 'warning' });
      return;
    }
    try {
      await request.mutateAsync({ leaseId: lease.id, reason: reason.trim() });
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
      await del.mutateAsync(lease.id);
      addToast({ title: 'Historical record deleted', color: 'success' });
      onDeleted?.();
    } catch (err) {
      addToast({ title: errMsg(err, 'Could not delete the record'), color: 'danger' });
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <FiArchive className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">Entered from records</p>
            <p className="text-[11px] text-amber-800/80 mt-0.5">
              This tenancy was typed in after the fact, so its ledger cannot be rebuilt.
              Deleting it needs a Founder's approval.
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
                onPress={async () => {
                  try {
                    await cancel.mutateAsync(pendingReq.id);
                    addToast({ title: 'Request withdrawn', color: 'default' });
                  } catch (err) {
                    addToast({ title: errMsg(err, 'Could not withdraw the request'), color: 'danger' });
                  }
                }}
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

      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>Delete this historical record?</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-gray-600">
              {lease.tenantName || 'This tenancy'} · {fmtDate(lease.leaseStart)} – {fmtDate(lease.leaseEnd)}
            </p>
            <p className="text-sm text-gray-700">
              This tenancy and its whole rent ledger were typed in from records, so nothing
              here can be regenerated. You hold the approval permission, so this is recorded
              as self-approved against your name.
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
            <p className="text-sm text-gray-600">
              {lease.tenantName || 'This tenancy'} · {fmtDate(lease.leaseStart)} – {fmtDate(lease.leaseEnd)}
            </p>
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
            <Button color="danger" isLoading={request.isPending} onPress={submitRequest}>
              Send for approval
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

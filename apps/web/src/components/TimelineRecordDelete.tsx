/**
 * The delete control for one row of a unit's history timeline.
 *
 * Two records, two rules, one button — because the person looking at a wrong row does not
 * care which kind it is, and asking them to know is how "where is the delete button?"
 * happens.
 *
 *   BACKFILLED — hand-entered from paper the system never witnessed. Its ledger cannot be
 *   rebuilt, so deletion goes through the Founder gate (HistoricalRecordControls).
 *
 *   LIVE — recorded by the app as it happened. Deleting one loses nothing that cannot be
 *   re-entered from its own terms, so it takes a confirmation rather than a second person.
 *
 * The confirmation for a live record names what does NOT happen, which is the part people
 * get wrong: a delete is a soft delete and does not touch the unit's status. Deleting a
 * lease to "free up" a unit leaves it reading LEASED with no tenant — the exact broken
 * state the history banner then complains about. End tenancy is the tool for that, and this
 * dialog says so rather than letting the mistake be made quietly.
 */

import { useState } from 'react';
import {
  Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip, addToast,
} from '@heroui/react';
import { FiTrash2 } from 'react-icons/fi';
import { useDeleteLease, useDeleteSale } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';
import { HistoricalRecordControls } from './HistoricalRecordControls';

export interface TimelineRecord {
  kind: 'lease' | 'sale';
  id: string;
  isHistorical: boolean;
  /** Tenant name for a lease, buyer for a sale. */
  label: string;
  dateRangeLabel: string;
  /** True while this tenancy is the current one — deleting it is the riskier case. */
  isOngoing?: boolean;
}

export function TimelineRecordDelete({ record }: { record: TimelineRecord }) {
  const { hasPermission } = useAuthStore();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteLease = useDeleteLease();
  const deleteSale = useDeleteSale();
  const del = record.kind === 'lease' ? deleteLease : deleteSale;

  // A backfilled record keeps its own gate, unchanged.
  if (record.isHistorical) {
    return <HistoricalRecordControls variant="inline" record={record} />;
  }

  const canDelete = hasPermission(record.kind === 'lease' ? 'lease:edit' : 'sales:edit');
  if (!canDelete) return null;

  const isLease = record.kind === 'lease';

  const doDelete = async () => {
    try {
      await del.mutateAsync(record.id);
      addToast({ title: isLease ? 'Tenancy deleted' : 'Sale deleted', color: 'success' });
      setConfirmOpen(false);
    } catch (e) {
      // The server has its own rules on top of the permission — a CLOSED sale is
      // Founder-only — so a refusal here is information, not a bug.
      addToast({ title: errMsg(e, 'Could not delete the record'), color: 'danger' });
    }
  };

  return (
    <span className="shrink-0">
      <Tooltip content={isLease ? 'Delete this tenancy' : 'Delete this sale'}>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          color="danger"
          aria-label={isLease ? 'Delete this tenancy' : 'Delete this sale'}
          onPress={() => setConfirmOpen(true)}
        >
          <FiTrash2 className="w-4 h-4" />
        </Button>
      </Tooltip>

      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>{isLease ? 'Delete this tenancy?' : 'Delete this sale?'}</ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-gray-600">{record.label} · {record.dateRangeLabel}</p>

            <p className="text-sm text-gray-700">
              {isLease
                ? 'The tenancy and its whole rent ledger — schedule, invoices and collections — '
                  + 'stop appearing anywhere: this timeline, the rent roll, cash flow and reports.'
                : 'The sale and its payment schedule stop appearing anywhere: this timeline, '
                  + 'the pipeline, and revenue reports.'}
            </p>

            {/* The correction people actually need, said before they make the mistake. */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs text-amber-900">
                {isLease ? (
                  <>
                    <span className="font-semibold">The unit's status does not change.</span> It
                    will still read as leased, with no tenant on it. If the tenant actually moved
                    out, close the tenancy with <span className="font-semibold">End tenancy</span>{' '}
                    instead — that records the move-out date and releases the unit. Delete is for a
                    tenancy that should never have been entered.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">The unit's status does not change.</span> A
                    sold unit stays sold. If the deal fell through, use{' '}
                    <span className="font-semibold">Cancel</span> on the sale instead — that
                    records why and handles the deposit. Delete is for a sale that should never
                    have been entered.
                  </>
                )}
              </p>
            </div>

            {isLease && record.isOngoing && (
              <p className="text-xs text-rose-700">
                This is the tenancy currently in occupation.
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setConfirmOpen(false)}>Cancel</Button>
            <Button color="danger" isLoading={del.isPending} onPress={doDelete}>
              {isLease ? 'Delete tenancy' : 'Delete sale'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </span>
  );
}

import React, { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Chip, Tabs, Tab, Textarea, Input, addToast,
} from '@heroui/react';
import { FiSend, FiCheckCircle, FiXCircle, FiArrowRight, FiCornerUpLeft } from 'react-icons/fi';
import { DrawApprovalStepper, type DrawApprovalStep } from './DrawApprovalStepper';
import { DocumentChecklist, type DrawDocType, type ChecklistItem, type AttachedDocument } from './DocumentChecklist';
import {
  useDraw, useDrawChecklist, useDrawWorkflow, useAttachDrawDocument, useRemoveDrawDocument,
  useRenameDrawDocument, usePresignedUpload,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

/**
 * Detail modal for a single Draw Request.
 *
 * Three tabs:
 *   - Workflow:   approval stepper + workflow action buttons
 *   - Documents:  required-doc checklist + upload + remove
 *   - Details:    metadata (loan, amount, dates, notes)
 *
 * Workflow buttons map to the state-machine transitions on the API.
 * The button availability comes from the draw's current status.
 */

interface Props {
  drawId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** project name used for filing uploads under the right Supabase folder */
  projectName?: string;
  projectId?: string;
  /** Which tab to open on — e.g. 'documents' right after creating a draw, so the
   * user lands straight on the upload step instead of Workflow. */
  defaultTab?: 'workflow' | 'documents' | 'details';
}

const DRAW_STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'primary',
  APPROVED: 'warning',
  FUNDED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'danger',
};

export function DrawDetailModal({ drawId, isOpen, onClose, projectName, projectId, defaultTab }: Props) {
  const { data: draw, isLoading } = useDraw(drawId ?? undefined);
  const { data: checklist = [] } = useDrawChecklist(drawId ?? undefined);
  const workflow = useDrawWorkflow();
  const attachDoc = useAttachDrawDocument();
  const removeDoc = useRemoveDrawDocument();
  const renameDoc = useRenameDrawDocument();
  const presigned = usePresignedUpload();
  const [uploadingType, setUploadingType] = useState<DrawDocType | null>(null);
  const { hasPermission } = useAuthStore();
  // draw:edit gates submit/return/cancel/document uploads; draw:approve gates
  // approve-internal/mark-funded/reject — mirrors the backend RBAC split in
  // draws.controller.ts (see class-level comment there).
  const canEdit = hasPermission('draw:edit');
  const canApprove = hasPermission('draw:approve');

  const [comment, setComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  if (!drawId) return null;

  const d = (draw ?? {}) as any;
  const status = d.status as string | undefined;

  const approvals = (d.approvals ?? []) as DrawApprovalStep[];
  const documents = (d.documents ?? []) as AttachedDocument[];
  const checklistItems = checklist as ChecklistItem[];

  // Available workflow actions per state — mirrors backend draw-state-machine.ts,
  // gated by permission so read-only roles (e.g. CONSTRUCTION, draw:view only) never
  // see action buttons they'd be rejected for by the API.
  const can = {
    submit:          canEdit && status === 'DRAFT',
    approveInternal: canApprove && status === 'SUBMITTED',
    submitToLender:  canEdit && status === 'APPROVED' && !d.submittedToLenderAt,
    markFunded:      canApprove && status === 'APPROVED',
    reject:          canApprove && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(status ?? ''),
    returnForInfo:   canEdit && status === 'SUBMITTED',
    cancel:          canEdit && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(status ?? ''),
  };

  const fire = (mutation: any, args: any, successText: string) => {
    mutation.mutate(args, {
      onSuccess: () => {
        addToast({ title: successText, color: 'success' });
        setComment('');
        setRejectReason('');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.message || 'Action failed';
        addToast({ title: Array.isArray(msg) ? msg[0] : msg, color: 'danger' });
      },
    });
  };

  const handleUpload = async (type: DrawDocType, file: File) => {
    setUploadingType(type);
    try {
      const { storagePath, filename } = await presigned.mutateAsync({
        file, projectId, projectName, category: 'draws',
      });
      await attachDoc.mutateAsync({ drawId, documentType: type, storagePath, filename });
      addToast({ title: `Uploaded ${filename}`, color: 'success' });
    } catch (err: any) {
      addToast({ title: err?.message || 'Upload failed', color: 'danger' });
    } finally {
      setUploadingType(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="3xl">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span>Draw Request #{d.drawNumber ?? '…'}</span>
            {status && (
              <Chip size="sm" variant="flat" color={DRAW_STATUS_COLOR[status] ?? 'default'}>
                {status}
              </Chip>
            )}
          </div>
          {d.loan?.lender && (
            <p className="text-xs text-gray-500 font-normal">{d.loan.lender}</p>
          )}
          {defaultTab === 'documents' && (
            <p className="text-xs text-primary-600 font-normal">Draw created — attach supporting documents below</p>
          )}
        </ModalHeader>

        <ModalBody className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">Loading draw…</div>
          ) : (
            <Tabs
              key={drawId}
              color="primary"
              size="sm"
              defaultSelectedKey={defaultTab ?? 'workflow'}
              classNames={{
                tabList: 'overflow-x-auto scrollbar-none flex-nowrap px-6 pt-3',
                panel: 'px-6 py-4',
              }}
            >
              {/* Workflow */}
              <Tab key="workflow" title="Workflow">
                <DrawApprovalStepper approvals={approvals} />

                {/* Action panel — hidden entirely for view-only roles (e.g. CONSTRUCTION) */}
                {(can.submit || can.approveInternal || can.submitToLender || can.markFunded || can.returnForInfo) && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <Textarea
                    size="sm"
                    label="Comment (optional)"
                    placeholder="Add context for this transition…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    minRows={2}
                    maxRows={4}
                  />
                  <div className="flex flex-wrap gap-2 mt-3">
                    {can.submit && (
                      <Button
                        size="sm" color="primary" startContent={<FiSend />}
                        onPress={() => fire(workflow.submit, { id: drawId, comment }, 'Submitted for review')}
                        isLoading={workflow.submit.isPending}
                      >
                        Submit
                      </Button>
                    )}
                    {can.approveInternal && (
                      <Button
                        size="sm" color="success" startContent={<FiCheckCircle />}
                        onPress={() => fire(workflow.approveInternal, { id: drawId, comment }, 'Approved internally')}
                        isLoading={workflow.approveInternal.isPending}
                      >
                        Approve internally
                      </Button>
                    )}
                    {can.submitToLender && (
                      <Button
                        size="sm" color="primary" variant="flat" startContent={<FiArrowRight />}
                        onPress={() => fire(workflow.submitToLender, { id: drawId, comment }, 'Sent to lender')}
                        isLoading={workflow.submitToLender.isPending}
                      >
                        Submit to lender
                      </Button>
                    )}
                    {can.markFunded && (
                      <Button
                        size="sm" color="success" variant="flat" startContent={<FiCheckCircle />}
                        onPress={() => fire(workflow.markFunded, { id: drawId }, 'Marked as funded — actuals posted')}
                        isLoading={workflow.markFunded.isPending}
                      >
                        Mark funded
                      </Button>
                    )}
                    {can.returnForInfo && (
                      <Button
                        size="sm" variant="flat" startContent={<FiCornerUpLeft />}
                        onPress={() => fire(workflow.returnForInfo, { id: drawId, comment }, 'Returned for info')}
                        isLoading={workflow.returnForInfo.isPending}
                      >
                        Return for info
                      </Button>
                    )}
                  </div>
                </div>
                )}

                {/* Reject panel — separated, requires reason. Cancel sits alongside it but
                    is gated independently (draw:edit) since it's not an approval action. */}
                {(can.reject || can.cancel) && (
                  <div className="mt-6 border-t border-gray-100 pt-4">
                    {can.reject && (
                      <>
                        <p className="text-xs font-semibold text-red-600 uppercase mb-2">Reject draw</p>
                        <Input
                          size="sm"
                          placeholder="Reason for rejection (required)"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                      </>
                    )}
                    <div className="flex gap-2 mt-2">
                      {can.reject && (
                        <Button
                          size="sm" color="danger" variant="flat" startContent={<FiXCircle />}
                          isDisabled={!rejectReason.trim()}
                          onPress={() => fire(workflow.reject, { id: drawId, reason: rejectReason }, 'Draw rejected')}
                          isLoading={workflow.reject.isPending}
                        >
                          Reject
                        </Button>
                      )}
                      {can.cancel && (
                        <Button
                          size="sm" variant="light" color="danger"
                          onPress={() => fire(workflow.cancel, { id: drawId, comment }, 'Draw cancelled')}
                          isLoading={workflow.cancel.isPending}
                        >
                          Cancel draw
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Tab>

              {/* Documents */}
              <Tab key="documents" title={`Documents · ${documents.length}`}>
                <DocumentChecklist
                  checklist={checklistItems}
                  attachments={documents}
                  uploadingType={uploadingType}
                  readOnly={!canEdit}
                  onUpload={handleUpload}
                  onRemove={(id) => {
                    removeDoc.mutate(id, {
                      onSuccess: () => addToast({ title: 'Document removed', color: 'success' }),
                      onError: () => addToast({ title: 'Failed to remove document', color: 'danger' }),
                    });
                  }}
                  onRename={(id, filename) => {
                    renameDoc.mutate({ documentId: id, filename }, {
                      onSuccess: () => addToast({ title: 'Document renamed', color: 'success' }),
                      onError: (err: any) => addToast({ title: err?.response?.data?.message || 'Failed to rename document', color: 'danger' }),
                    });
                  }}
                />
              </Tab>

              {/* Details */}
              <Tab key="details" title="Details">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <Detail label="Draw #" value={String(d.drawNumber ?? '—')} />
                  <Detail label="Lender" value={d.loan?.lender ?? '—'} />
                  <Detail label="Requested" value={fmtMoney(d.requestedAmount ?? d.amount)} />
                  <Detail label="Approved" value={d.approvedAmount ? fmtMoney(d.approvedAmount) : '—'} />
                  <Detail label="Request date" value={fmtDate(d.requestDate)} />
                  <Detail label="Expected funding" value={fmtDate(d.expectedFundingDate)} />
                  <Detail label="Submitted to lender" value={fmtDate(d.submittedToLenderAt)} />
                  <Detail label="Funded at" value={fmtDate(d.fundedAt)} />
                  {d.rejectionReason && (
                    <div className="sm:col-span-2 rounded bg-red-50 border border-red-200 p-3">
                      <p className="text-xs font-semibold text-red-700 mb-0.5">Rejection reason</p>
                      <p className="text-sm text-red-800">{d.rejectionReason}</p>
                    </div>
                  )}
                  {d.notes && (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-gray-500 mb-0.5">Notes</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{d.notes}</p>
                    </div>
                  )}
                </dl>
              </Tab>
            </Tabs>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-800">{value}</dd>
    </div>
  );
}

function fmtMoney(n: any): string {
  const num = Number(n ?? 0);
  if (!num) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
}
function fmtDate(d?: string | Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

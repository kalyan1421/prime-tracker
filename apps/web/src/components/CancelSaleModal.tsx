/**
 * CancelSaleModal — Structured sale cancellation flow.
 *
 * Collects: reason, reason note, refund amount, penalty amount.
 * Shows a consequences summary before confirming.
 * Uses the existing useUpdateSale hook — sets status = CANCELLED.
 */

import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Select, SelectItem, Input, Textarea, Chip, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiDollarSign, FiInfo } from 'react-icons/fi';
import { useUpdateSale } from '../hooks/useApi';

// ─── types ────────────────────────────────────────────────────────────────────

interface CancelSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: {
    id: string;
    projectId: string;
    unitNumber?: string;
    buyerName?: string;
    salePrice?: number;
  };
}

const LOST_REASONS = [
  { key: 'PRICE_TOO_HIGH',         label: 'Price too high' },
  { key: 'FINANCING_FELL_THROUGH', label: 'Financing fell through' },
  { key: 'CHOSE_COMPETITOR',       label: 'Chose competitor' },
  { key: 'TIMING_OFF',             label: 'Timing / project delays' },
  { key: 'NO_RESPONSE',            label: 'No response from buyer' },
  { key: 'OTHER',                  label: 'Other' },
];

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// ─── component ────────────────────────────────────────────────────────────────

export function CancelSaleModal({ isOpen, onClose, sale }: CancelSaleModalProps) {
  const updateSale = useUpdateSale();

  const [step, setStep]   = useState<'form' | 'confirm'>('form');
  const [form, setForm]   = useState({
    lostReason:     '',
    lostReasonNote: '',
    refundAmount:   '',
    penaltyAmount:  '',
  });
  const set = (f: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [f]: e.target.value }));

  const refund  = parseFloat(form.refundAmount)  || 0;
  const penalty = parseFloat(form.penaltyAmount) || 0;

  const handleProceed = () => {
    if (!form.lostReason) {
      addToast({ title: 'Select a cancellation reason', color: 'warning' });
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    try {
      await updateSale.mutateAsync({
        id: sale.id,
        data: {
          status:         'CANCELLED',
          lostReason:     form.lostReason,
          lostReasonNote: form.lostReasonNote || undefined,
          refundAmount:   refund  > 0 ? refund  : undefined,
          penaltyAmount:  penalty > 0 ? penalty : undefined,
        },
      });
      addToast({ title: 'Sale cancelled and unit released', color: 'success' });
      onClose();
      setStep('form');
      setForm({ lostReason: '', lostReasonNote: '', refundAmount: '', penaltyAmount: '' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to cancel sale'), color: 'danger' });
    }
  };

  const handleClose = () => {
    setStep('form');
    setForm({ lostReason: '', lostReasonNote: '', refundAmount: '', penaltyAmount: '' });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <ModalContent>
        {/* ── STEP 1: form ── */}
        {step === 'form' && (
          <>
            <ModalHeader className="flex items-center gap-2 text-red-600">
              <FiAlertTriangle className="shrink-0" />
              Cancel Sale
            </ModalHeader>
            <ModalBody className="space-y-4 pb-2">
              {/* context chip */}
              <div className="flex flex-wrap gap-2">
                {sale.unitNumber && (
                  <Chip size="sm" variant="flat" color="default">Unit {sale.unitNumber}</Chip>
                )}
                {sale.buyerName && (
                  <Chip size="sm" variant="flat" color="default">{sale.buyerName}</Chip>
                )}
                {sale.salePrice && (
                  <Chip size="sm" variant="flat" color="primary">{fmt(sale.salePrice)}</Chip>
                )}
              </div>

              {/* reason */}
              <Select
                label="Cancellation reason *"
                selectedKeys={form.lostReason ? [form.lostReason] : []}
                onSelectionChange={(k) => setForm((p) => ({ ...p, lostReason: Array.from(k)[0] as string }))}
                size="sm"
              >
                {LOST_REASONS.map((r) => <SelectItem key={r.key}>{r.label}</SelectItem>)}
              </Select>

              <Textarea
                label="Additional notes (optional)"
                placeholder="Any details about why this sale was cancelled…"
                value={form.lostReasonNote}
                onChange={set('lostReasonNote')}
                size="sm" minRows={2}
              />

              {/* financials */}
              <div className="rounded-xl bg-gray-50 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  <FiDollarSign size={12} /> Financial Settlement (optional)
                </p>
                <div className="flex gap-2">
                  <Input
                    size="sm" type="number" label="Refund to buyer ($)"
                    placeholder="0"
                    value={form.refundAmount} onChange={set('refundAmount')}
                  />
                  <Input
                    size="sm" type="number" label="Penalty / forfeiture ($)"
                    placeholder="0"
                    value={form.penaltyAmount} onChange={set('penaltyAmount')}
                  />
                </div>
                {(refund > 0 || penalty > 0) && (
                  <p className="text-xs text-gray-400">
                    Net: {fmt(penalty - refund)} {penalty > refund ? 'retained' : 'refunded'}
                  </p>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={handleClose}>Keep sale</Button>
              <Button color="danger" onPress={handleProceed}>
                Review cancellation →
              </Button>
            </ModalFooter>
          </>
        )}

        {/* ── STEP 2: confirm ── */}
        {step === 'confirm' && (
          <>
            <ModalHeader className="flex items-center gap-2 text-red-600">
              <FiAlertTriangle className="shrink-0" />
              Confirm Cancellation
            </ModalHeader>
            <ModalBody className="space-y-4">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700">What will happen:</p>
                <ul className="space-y-2 text-sm text-red-700">
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">•</span>
                    Sale status → <span className="font-semibold">CANCELLED</span>
                  </li>
                  {sale.unitNumber && (
                    <li className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span>
                      Unit {sale.unitNumber} → released back to <span className="font-semibold">AVAILABLE</span>
                    </li>
                  )}
                  {refund > 0 && (
                    <li className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span>
                      Refund of <span className="font-semibold">{fmt(refund)}</span> recorded
                    </li>
                  )}
                  {penalty > 0 && (
                    <li className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span>
                      Penalty of <span className="font-semibold">{fmt(penalty)}</span> recorded
                    </li>
                  )}
                </ul>
              </div>

              {/* summary row */}
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" variant="flat" color="default">
                  {LOST_REASONS.find((r) => r.key === form.lostReason)?.label}
                </Chip>
                {form.lostReasonNote && (
                  <Chip size="sm" variant="flat" color="default">"{form.lostReasonNote}"</Chip>
                )}
              </div>

              <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5">
                <FiInfo size={12} className="shrink-0 mt-0.5" />
                <p>This action cannot be undone. Sale history and payment records are preserved for audit purposes.</p>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={() => setStep('form')}>← Back</Button>
              <Button
                color="danger" isLoading={updateSale.isPending}
                onPress={handleConfirm}
              >
                Confirm cancellation
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

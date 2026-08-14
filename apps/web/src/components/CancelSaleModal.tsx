/**
 * CancelSaleModal — Structured sale cancellation flow.
 *
 * Collects the reason and, when money has been collected, what happens to it: refunded,
 * forfeited, or split. Those amounts are now PERSISTED as a SaleCancellation ledger row —
 * until 2026-08-14 they were collected here and silently discarded, which is why this file
 * used to tell the user they were "not saved".
 *
 * The server enforces `refundAmount + penaltyAmount === totalCollected` for every
 * disposition except DECIDE_LATER, as a service check AND a DB constraint. This modal
 * mirrors that rule locally so the failure is caught before the round trip — but the server
 * is the authority, and it recomputes the collected total inside its own transaction rather
 * than trusting anything sent from here.
 */

import { useMemo, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Select, SelectItem, Input, Textarea, Chip, addToast,
} from '@heroui/react';
import { FiAlertTriangle, FiDollarSign, FiInfo } from 'react-icons/fi';
import { useUpdateSale, useSalePayments } from '../hooks/useApi';

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

/**
 * What happens to money already collected. Mirrors the server's
 * `SaleCancellationDisposition` enum.
 *
 * DECIDE_LATER is the DEFAULT and is client-locked: it is what lets someone cancel at 6pm
 * without Finance in the room. Forcing a decision here would just produce zeros typed in to
 * clear the dialog, which is worse than no data because it looks like a record.
 */
const DISPOSITIONS = [
  { key: 'DECIDE_LATER', label: 'Decide later — leave it to Finance',
    hint: 'Records the amount collected and leaves the outcome open. Finance settles it from the sale later.' },
  { key: 'REFUND', label: 'Refund everything to the buyer',
    hint: 'The whole collected amount goes back to the buyer.' },
  { key: 'FORFEIT', label: 'Prime retains everything',
    hint: 'The whole collected amount is forfeited by the buyer and retained.' },
  { key: 'NET', label: 'Split — part refunded, part retained',
    hint: 'Enter both figures. They must add up to exactly what was collected.' },
];

import { errMsg } from '../utils/fmt';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Cents-accurate money compare — avoids 0.1 + 0.2 style drift rejecting a valid split. */
const money = (n: number) => Math.round(n * 100);

// ─── component ────────────────────────────────────────────────────────────────

export function CancelSaleModal({ isOpen, onClose, sale }: CancelSaleModalProps) {
  const updateSale = useUpdateSale();

  // The collected total is what the invariant reconciles against. It is derived from the
  // payment schedule rather than passed in, because the caller renders a sale row that does
  // not carry it — and a stale number here would produce a confusing server-side refusal.
  const { data: payments, isLoading: paymentsLoading } = useSalePayments(isOpen ? sale.id : undefined);
  const totalCollected = useMemo(
    () => ((payments as any[]) ?? []).reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0),
    [payments],
  );
  const nothingCollected = totalCollected <= 0;

  const [step, setStep]   = useState<'form' | 'confirm'>('form');
  const [form, setForm]   = useState({
    lostReason:     '',
    lostReasonNote: '',
    disposition:    'DECIDE_LATER',
    refundAmount:   '',
    penaltyAmount:  '',
    refundReference: '',
  });
  const set = (f: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [f]: e.target.value }));

  const EMPTY = {
    lostReason: '', lostReasonNote: '', disposition: 'DECIDE_LATER',
    refundAmount: '', penaltyAmount: '', refundReference: '',
  };

  // REFUND and FORFEIT are fully determined by the collected total, so the amounts are
  // derived rather than typed. Only NET needs two free figures — which is also the only
  // disposition where the operator can get the sum wrong.
  const { refund, penalty } = useMemo(() => {
    switch (form.disposition) {
      case 'REFUND':  return { refund: totalCollected, penalty: 0 };
      case 'FORFEIT': return { refund: 0, penalty: totalCollected };
      case 'NET':     return {
        refund: parseFloat(form.refundAmount) || 0,
        penalty: parseFloat(form.penaltyAmount) || 0,
      };
      default:        return { refund: 0, penalty: 0 };
    }
  }, [form.disposition, form.refundAmount, form.penaltyAmount, totalCollected]);

  const decided = form.disposition !== 'DECIDE_LATER';
  // Mirrors the server invariant. Compared in cents so a 30000.00 + 20000.00 split is not
  // rejected by binary floating point.
  const reconciles = !decided || money(refund + penalty) === money(totalCollected);
  const outBy = refund + penalty - totalCollected;

  const handleProceed = () => {
    if (!form.lostReason) {
      addToast({ title: 'Select a cancellation reason', color: 'warning' });
      return;
    }
    if (!reconciles) {
      addToast({
        title: `Refund and penalty must add up to ${fmt(totalCollected)} — currently ${
          outBy > 0 ? 'over' : 'short'} by ${fmt(Math.abs(outBy))}`,
        color: 'warning',
      });
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    try {
      // The ledger fields ride along with the cancellation so the server does both in ONE
      // transaction: a sale can never be cancelled — and its unit released back to market —
      // with the collected money unaccounted for. Amounts are omitted entirely for
      // DECIDE_LATER, where the invariant deliberately does not apply.
      await updateSale.mutateAsync({
        id: sale.id,
        data: {
          status:         'CANCELLED',
          lostReason:     form.lostReason,
          lostReasonNote: form.lostReasonNote || undefined,
          cancellationDisposition: form.disposition,
          ...(decided ? { refundAmount: refund, penaltyAmount: penalty } : {}),
          // Only accepted when there is actually a refund to reference.
          ...(decided && refund > 0 && form.refundReference
            ? { refundReference: form.refundReference }
            : {}),
        },
      });
      addToast({
        title: decided
          ? 'Sale cancelled, unit released, settlement recorded'
          : 'Sale cancelled and unit released — settlement left for Finance',
        color: 'success',
      });
      onClose();
      setStep('form');
      setForm(EMPTY);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to cancel sale'), color: 'danger' });
    }
  };

  const handleClose = () => {
    setStep('form');
    setForm(EMPTY);
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

              {/* financial settlement — only meaningful when money has actually arrived */}
              <div className="rounded-xl bg-gray-50 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  <FiDollarSign size={12} /> Financial settlement
                </p>

                {paymentsLoading ? (
                  <p className="text-xs text-gray-400">Checking what has been collected…</p>
                ) : nothingCollected ? (
                  // No money in, nothing to settle. Showing a disposition picker here would
                  // be asking a question with no answer.
                  <p className="text-xs text-gray-500">
                    Nothing has been collected on this sale, so there is nothing to settle.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Collected so far</span>
                      <span className="font-semibold text-gray-700">{fmt(totalCollected)}</span>
                    </div>

                    <Select
                      label="What happens to it?"
                      size="sm"
                      selectedKeys={[form.disposition]}
                      onSelectionChange={(k) =>
                        setForm((p) => ({
                          ...p,
                          disposition: (Array.from(k)[0] as string) || 'DECIDE_LATER',
                          // Clear the free figures when leaving NET, so a stale split cannot
                          // be submitted under a disposition that derives its own amounts.
                          refundAmount: '', penaltyAmount: '',
                        }))
                      }
                    >
                      {DISPOSITIONS.map((d) => (
                        <SelectItem key={d.key} textValue={d.label}>{d.label}</SelectItem>
                      ))}
                    </Select>
                    <p className="text-[11px] text-gray-400">
                      {DISPOSITIONS.find((d) => d.key === form.disposition)?.hint}
                    </p>

                    {/* Only NET needs two typed figures — the others are fully determined
                        by the collected total, so deriving them removes the only way to get
                        the sum wrong. */}
                    {form.disposition === 'NET' && (
                      <>
                        <div className="flex gap-2">
                          <Input
                            size="sm" type="number" label="Refund to buyer ($)" placeholder="0"
                            value={form.refundAmount} onChange={set('refundAmount')}
                          />
                          <Input
                            size="sm" type="number" label="Prime retains ($)" placeholder="0"
                            value={form.penaltyAmount} onChange={set('penaltyAmount')}
                          />
                        </div>
                        <p className={`text-xs ${reconciles ? 'text-green-600' : 'text-amber-600'}`}>
                          {reconciles
                            ? `Balances against ${fmt(totalCollected)} collected.`
                            : `${outBy > 0 ? 'Over' : 'Short'} by ${fmt(Math.abs(outBy))} — must total ${fmt(totalCollected)}.`}
                        </p>
                      </>
                    )}

                    {decided && refund > 0 && (
                      <Input
                        size="sm" label="Refund reference (optional)"
                        placeholder="Cheque no., ACH reference…"
                        value={form.refundReference} onChange={set('refundReference')}
                      />
                    )}
                  </>
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
                  {/* These ARE persisted now, as a SaleCancellation ledger row. The old
                      copy said "not saved" and was correct at the time — the amounts were
                      collected and discarded. Saying it now would be the opposite lie. */}
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>
                      Unpaid installments → <span className="font-semibold">CANCELLED</span>; anything
                      already paid is left untouched
                    </span>
                  </li>
                  {!nothingCollected && decided && (
                    <li className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span>
                      <span>
                        Of {fmt(totalCollected)} collected:{' '}
                        {refund > 0 && <><span className="font-semibold">{fmt(refund)}</span> refunded to the buyer</>}
                        {refund > 0 && penalty > 0 && ', '}
                        {penalty > 0 && <><span className="font-semibold">{fmt(penalty)}</span> retained by Prime</>}
                        {' '}— recorded against this sale
                      </span>
                    </li>
                  )}
                  {!nothingCollected && !decided && (
                    <li className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">•</span>
                      <span>
                        <span className="font-semibold">{fmt(totalCollected)}</span> collected is recorded as
                        outstanding — <span className="font-semibold">Finance still has to decide</span> whether
                        it is refunded or retained
                      </span>
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

/**
 * Attach a loan to a specific building.
 *
 * A loan may sit on the project or on a single building (Loan.buildingId) — a per-asset
 * construction loan is the normal case for Prime. The Draws tab's form can already do
 * this, but only by picking the building from a dropdown after navigating there; here the
 * building comes from the page and is fixed.
 *
 * Create-only. Editing a loan touches encrypted fields and the draw schedule, and lives
 * with the Draws tab where that context is.
 *
 * Note on scope: the project's loan list ALREADY includes building-level loans
 * (LoansService.findByProject ORs on building.projectId), so a loan added here also shows
 * up at project level. That is intended — it is the same debt seen at two altitudes.
 */
import React, { useEffect, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, addToast,
} from '@heroui/react';
import { useCreateLoan, useCustomOptions } from '../hooks/useApi';

const EMPTY = {
  loanType: 'CONSTRUCTION', lender: '', principalAmt: '', interestRate: '',
  termMonths: '', maturityDate: '', currentBalance: '', monthlyPayment: '', notes: '',
};

function errMsg(err: any, fallback: string): string {
  const m = err?.response?.data?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  if (typeof m === 'string') return m;
  return err?.message ?? fallback;
}

export function AddLoanModal({ isOpen, onClose, projectId, building, onCreated }: {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  building: { id: string; name: string };
  onCreated?: () => void;
}) {
  const createLoan = useCreateLoan();
  const { data: loanTypes = [] } = useCustomOptions('loan_type');

  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY });
    setErrors({});
  }, [isOpen]);

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.lender.trim()) errs.lender = 'Lender is required';
    const p = parseFloat(form.principalAmt);
    if (!form.principalAmt || isNaN(p) || p <= 0) errs.principalAmt = 'Enter a positive amount';
    if (form.interestRate) {
      const r = parseFloat(form.interestRate);
      if (isNaN(r) || r < 0 || r > 100) errs.interestRate = 'Enter a rate between 0 and 100';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      await createLoan.mutateAsync({
        projectId,
        buildingId: building.id,
        loanType: form.loanType,
        lender: form.lender.trim(),
        principalAmt: parseFloat(form.principalAmt) || 0,
        interestRate: parseFloat(form.interestRate) || 0,
        termMonths: parseInt(form.termMonths, 10) || 0,
        maturityDate: form.maturityDate || undefined,
        currentBalance: form.currentBalance ? parseFloat(form.currentBalance) : undefined,
        monthlyPayment: form.monthlyPayment ? parseFloat(form.monthlyPayment) : undefined,
        notes: form.notes.trim() || undefined,
      });
      addToast({ title: 'Loan attached to building', color: 'success' });
      onCreated?.();
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to attach loan'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span>Attach loan</span>
          <span className="text-xs font-normal text-gray-500">secured on {building.name}</span>
        </ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              size="sm" label="Loan Type"
              selectedKeys={form.loanType ? [form.loanType] : []}
              onSelectionChange={(k) => {
                const v = Array.from(k)[0] as string;
                if (v) setForm((f) => ({ ...f, loanType: v }));
              }}
            >
              {(loanTypes as any[]).map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm" label="Lender" isRequired autoFocus
              value={form.lender} onChange={set('lender')}
              isInvalid={!!errors.lender} errorMessage={errors.lender}
            />
            <Input
              size="sm" label="Principal ($)" type="number" min={0} isRequired
              value={form.principalAmt} onChange={set('principalAmt')}
              isInvalid={!!errors.principalAmt} errorMessage={errors.principalAmt}
            />
            <Input
              size="sm" label="Interest Rate (%)" type="number" step="0.01" min={0}
              value={form.interestRate} onChange={set('interestRate')}
              isInvalid={!!errors.interestRate} errorMessage={errors.interestRate}
            />
            <Input
              size="sm" label="Term (months)" type="number" min={0}
              value={form.termMonths} onChange={set('termMonths')}
            />
            <Input
              size="sm" label="Maturity Date" type="date"
              value={form.maturityDate} onChange={set('maturityDate')}
            />
            <Input
              size="sm" label="Current Balance ($)" type="number" min={0}
              value={form.currentBalance} onChange={set('currentBalance')}
              description="Defaults to the principal if left blank"
            />
            <Input
              size="sm" label="Monthly Payment ($)" type="number" min={0}
              value={form.monthlyPayment} onChange={set('monthlyPayment')}
            />
            <Input
              size="sm" label="Notes" className="sm:col-span-2"
              value={form.notes} onChange={set('notes')}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={handleSave} isLoading={createLoan.isPending}>
            Attach loan
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

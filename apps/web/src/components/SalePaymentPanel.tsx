import { useState } from 'react';
import {
  Chip, Button, Input, Select, SelectItem, Progress,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast,
} from '@heroui/react';
import { FiPlus, FiDollarSign } from 'react-icons/fi';
import {
  useSalePayments, useApplyPaymentTemplate, useAddSalePayment, useLogPayment, useDeleteSalePayment,
} from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { PermissionGate } from './ui';

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'warning' | 'success' | 'danger'> = {
  SCHEDULED: 'default',
  DUE: 'primary',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  WAIVED: 'default',
};

const TRIGGERS = ['FIXED_DATE', 'ON_SIGNING', 'ON_MILESTONE', 'ON_HANDOVER'];

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

export function SalePaymentPanel({ saleId, salePrice }: { saleId: string; salePrice?: number }) {
  const { data, isLoading } = useSalePayments(saleId);
  const applyTemplate = useApplyPaymentTemplate();
  const addPayment = useAddSalePayment();
  const logPayment = useLogPayment();
  const del = useDeleteSalePayment();

  const payments: any[] = Array.isArray(data) ? data : [];
  const totalScheduled = payments.reduce((s, p) => s + Number(p.amount), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.paidAmount), 0);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ label: '', amount: '', trigger: 'FIXED_DATE', dueDate: '' });

  const logModal = useDisclosure();
  const [logTarget, setLogTarget] = useState<any>(null);
  const [logAmount, setLogAmount] = useState('');

  const seed = async (template: string) => {
    if (!salePrice) return addToast({ title: 'Set a sale price first to use % templates', color: 'warning' });
    try {
      await applyTemplate.mutateAsync({ saleId, template });
      addToast({ title: `Applied ${template} schedule`, color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to apply template'), color: 'danger' });
    }
  };

  const submitAdd = async () => {
    if (!form.label.trim()) return addToast({ title: 'Label is required', color: 'warning' });
    try {
      await addPayment.mutateAsync({
        saleId,
        data: {
          label: form.label.trim(),
          amount: form.amount ? Number(form.amount) : undefined,
          trigger: form.trigger,
          dueDate: form.trigger === 'FIXED_DATE' && form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        },
      });
      setForm({ label: '', amount: '', trigger: 'FIXED_DATE', dueDate: '' });
      setAdding(false);
      addToast({ title: 'Installment added', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add installment'), color: 'danger' });
    }
  };

  const submitLog = async () => {
    const amt = Number(logAmount);
    if (!(amt > 0)) return addToast({ title: 'Enter a positive amount', color: 'warning' });
    try {
      await logPayment.mutateAsync({ id: logTarget.id, amount: amt, saleId });
      addToast({ title: 'Payment logged', color: 'success' });
      logModal.onClose();
      setLogAmount('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to log payment'), color: 'danger' });
    }
  };

  const dueLabel = (p: any) => {
    const d = p.effectiveDueDate ?? p.dueDate;
    if (d) return fmtDate(d);
    if (p.trigger === 'ON_MILESTONE') return p.milestone?.title ? `on "${p.milestone.title}"` : 'on milestone';
    if (p.trigger === 'ON_HANDOVER') return 'on handover';
    if (p.trigger === 'ON_SIGNING') return 'on signing';
    return '—';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Payment schedule</p>
        <Button size="sm" variant="flat" startContent={<FiPlus />} onPress={() => setAdding((v) => !v)}>
          Add installment
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && payments.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center space-y-2">
          <p className="text-sm text-gray-400">No schedule yet. Seed one from a template:</p>
          <div className="flex justify-center gap-2">
            <Button size="sm" variant="flat" color="primary" onPress={() => seed('10-40-50')} isLoading={applyTemplate.isPending}>
              10 / 40 / 50
            </Button>
            <Button size="sm" variant="flat" color="primary" onPress={() => seed('30-40-30')} isLoading={applyTemplate.isPending}>
              30 / 40 / 30
            </Button>
          </div>
        </div>
      )}

      {payments.length > 0 && (
        <div className="space-y-2">
          {payments.map((p) => {
            const amount = Number(p.amount);
            const paid = Number(p.paidAmount);
            const pct = amount > 0 ? Math.min(100, Math.round((paid / amount) * 100)) : 0;
            return (
              <div key={p.id} className="rounded-lg border border-gray-100 p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{dueLabel(p)}</span>
                  </div>
                  <Chip size="sm" variant="flat" color={STATUS_COLOR[p.status] ?? 'default'}>{p.status}</Chip>
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <Progress aria-label="paid" size="sm" value={pct} className="flex-1" color={pct >= 100 ? 'success' : 'primary'} />
                  <span className="text-xs text-gray-500 whitespace-nowrap">{fmt(paid)} / {fmt(amount)}</span>
                  {p.status !== 'PAID' && p.status !== 'WAIVED' && (
                    <PermissionGate permission="payment:log">
                      <Button size="sm" variant="light" color="primary" startContent={<FiDollarSign />}
                        onPress={() => { setLogTarget(p); setLogAmount(String(amount - paid)); logModal.onOpen(); }}>
                        Log
                      </Button>
                    </PermissionGate>
                  )}
                  <Button size="sm" variant="light" color="danger" onPress={() => del.mutate({ id: p.id, saleId })}>✕</Button>
                </div>
              </div>
            );
          })}
          <div className="flex justify-between text-xs text-gray-500 px-1 pt-1">
            <span>Paid {fmt(totalPaid)} of {fmt(totalScheduled)}</span>
            <span>{salePrice ? `Sale price ${fmt(salePrice)}` : ''}</span>
          </div>
        </div>
      )}

      {adding && (
        <div className="rounded-lg border border-gray-100 p-3 space-y-2">
          <div className="flex gap-2">
            <Input size="sm" label="Label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            <Input size="sm" type="number" label="Amount ($)" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="flex gap-2 items-end">
            <Select size="sm" label="Trigger" selectedKeys={[form.trigger]}
              onSelectionChange={(k) => setForm((f) => ({ ...f, trigger: Array.from(k)[0] as string }))} className="flex-1">
              {TRIGGERS.map((t) => <SelectItem key={t}>{t}</SelectItem>)}
            </Select>
            {form.trigger === 'FIXED_DATE' && (
              <Input size="sm" type="date" label="Due date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className="flex-1" />
            )}
            <Button size="sm" color="primary" onPress={submitAdd} isLoading={addPayment.isPending}>Add</Button>
          </div>
        </div>
      )}

      <Modal isOpen={logModal.isOpen} onClose={logModal.onClose} size="sm">
        <ModalContent>
          <ModalHeader>Log payment — {logTarget?.label}</ModalHeader>
          <ModalBody>
            <Input type="number" label="Amount ($)" value={logAmount} onChange={(e) => setLogAmount(e.target.value)} autoFocus />
            <p className="text-xs text-gray-400">Partial payments are supported; the installment flips to PAID when fully covered.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={logModal.onClose}>Cancel</Button>
            <Button color="primary" onPress={submitLog} isLoading={logPayment.isPending}>Log payment</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

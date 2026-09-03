/**
 * Edit the factual details of a sale — buyer, price, deposit, dates, broker, notes.
 *
 * Lifted out of SoldUnitPanel so the unit's History timeline can reach the same form.
 * A sale entry there used to offer only a delete button: the record could be read and
 * erased but not corrected, so a mistyped closing date meant deleting the sale and
 * entering it again (client, 2026-09-02).
 *
 * Changing the sale's STATUS (e.g. cancelling a close) deliberately stays in the Sales
 * tab's dedicated cancel flow, which also releases the unit; this form never touches it.
 */
import { useState } from 'react';
import {
  Button, Input, Select, SelectItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { useUpdateSale, useBrokers } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { FormError } from './FormError';

export interface EditableSale {
  id: string;
  buyer?: string | null;
  salePrice?: number | string | null;
  depositAmt?: number | string | null;
  loiDate?: string | null;
  contractDate?: string | null;
  closingDate?: string | null;
  notes?: string | null;
  brokerId?: string | null;
  broker?: { id: string; name: string } | null;
  brokerCommissionPct?: number | string | null;
}

const toFormDate = (d?: string | null) => (d ? d.slice(0, 10) : '');
// Prisma DateTime needs a full ISO string, not a bare "YYYY-MM-DD" — same coercion the
// API's create-sale path applies server-side, done here so the payload is unambiguous
// regardless of local timezone.
const toApiDate = (d: string) => (d ? new Date(`${d}T12:00:00.000Z`).toISOString() : undefined);

export function saleToForm(sale: EditableSale): Record<string, string> {
  return {
    buyer: sale.buyer || '',
    salePrice: sale.salePrice != null ? String(Number(sale.salePrice)) : '',
    depositAmt: sale.depositAmt != null ? String(Number(sale.depositAmt)) : '',
    loiDate: toFormDate(sale.loiDate),
    contractDate: toFormDate(sale.contractDate),
    closingDate: toFormDate(sale.closingDate),
    brokerId: sale.brokerId || sale.broker?.id || '',
    brokerCommissionPct: sale.brokerCommissionPct != null ? String(Number(sale.brokerCommissionPct)) : '',
    notes: sale.notes || '',
  };
}

export function EditSaleDetailsModal({ sale, isOpen, onClose }: {
  sale: EditableSale;
  isOpen: boolean;
  onClose: () => void;
}) {
  const updateSale = useUpdateSale();
  const { data: brokersData } = useBrokers();
  const brokers = (brokersData as any[]) || [];

  const [form, setForm] = useState<Record<string, string>>(() => saleToForm(sale));
  const [formError, setFormError] = useState<string | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    setFormError(null);
    try {
      await updateSale.mutateAsync({
        id: sale.id,
        data: {
          buyer: form.buyer.trim() || undefined,
          salePrice: form.salePrice ? Number(form.salePrice) : undefined,
          depositAmt: form.depositAmt ? Number(form.depositAmt) : undefined,
          loiDate: toApiDate(form.loiDate),
          contractDate: toApiDate(form.contractDate),
          closingDate: toApiDate(form.closingDate),
          brokerId: form.brokerId || null,
          brokerCommissionPct: form.brokerCommissionPct ? Number(form.brokerCommissionPct) : null,
          notes: form.notes.trim() || undefined,
        },
      });
      addToast({ title: 'Sale details updated', color: 'success' });
      onClose();
    } catch (e) {
      setFormError(errMsg(e, 'Failed to update sale'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>Edit Sale Details</ModalHeader>
        <ModalBody>
          <FormError message={formError} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input size="sm" label="Buyer" value={form.buyer} onChange={set('buyer')} />
            <Input size="sm" type="number" label="Sale Price ($)" value={form.salePrice} onChange={set('salePrice')} />
            <Input size="sm" type="number" label="Deposit Amount ($)" value={form.depositAmt} onChange={set('depositAmt')} />
            <Input size="sm" type="date" label="LOI Date" value={form.loiDate} onChange={set('loiDate')} />
            <Input size="sm" type="date" label="Contract Date" value={form.contractDate} onChange={set('contractDate')} />
            <Input size="sm" type="date" label="Closing Date" value={form.closingDate} onChange={set('closingDate')} />
            <Select
              size="sm"
              label="Broker (optional)"
              selectedKeys={form.brokerId ? [form.brokerId] : []}
              onSelectionChange={(keys) => setForm((f) => ({ ...f, brokerId: (Array.from(keys)[0] as string) || '' }))}
            >
              {[{ id: '', name: '— none —', company: '' }, ...brokers].map((b: any) => (
                <SelectItem key={b.id} textValue={b.id ? `${b.name}${b.company ? ` · ${b.company}` : ''}` : '— none —'}>
                  {b.id ? `${b.name}${b.company ? ` · ${b.company}` : ''}` : '— none —'}
                </SelectItem>
              ))}
            </Select>
            {form.brokerId && (
              <Input
                size="sm" type="number" label="Commission % override"
                value={form.brokerCommissionPct} onChange={set('brokerCommissionPct')}
                description="Blank = broker default"
              />
            )}
            <div className="sm:col-span-2">
              <Input size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={handleSave} isLoading={updateSale.isPending}>Save Changes</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

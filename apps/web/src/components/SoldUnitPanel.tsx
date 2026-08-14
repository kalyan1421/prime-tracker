import { useState } from 'react';
import {
  Card, CardBody, CardHeader, Chip, Button, Input, Select, SelectItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast,
} from '@heroui/react';
import { FiUser, FiDollarSign, FiCalendar, FiEdit2 } from 'react-icons/fi';
import { fmt, fmtDate, errMsg } from '../utils/fmt';
import { useUpdateSale, useBrokers } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { SalePaymentPanel } from './SalePaymentPanel';
import { FormError } from './FormError';

interface SoldUnitPanelProps {
  sale: {
    id: string;
    projectId: string;
    buyer?: string | null;
    salePrice?: number | null;
    depositAmt?: number | null;
    loiDate?: string | null;
    contractDate?: string | null;
    closingDate?: string | null;
    notes?: string | null;
    brokerId?: string | null;
    broker?: { id: string; name: string } | null;
    brokerCommissionPct?: number | null;
    brokerCommissionAmt?: number | null;
  };
}

function DetailRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
      <dt className="text-sm text-gray-400 w-36 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value ?? '—'}</dd>
    </div>
  );
}

const toFormDate = (d?: string | null) => (d ? d.slice(0, 10) : '');
// Prisma DateTime needs a full ISO string, not a bare "YYYY-MM-DD" — same coercion
// the API's create-lease/create-sale paths already apply server-side, done here too
// so the payload is unambiguous regardless of local timezone.
const toApiDate = (d: string) => (d ? new Date(`${d}T12:00:00.000Z`).toISOString() : undefined);

function emptyFormFrom(sale: SoldUnitPanelProps['sale']): Record<string, string> {
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

export function SoldUnitPanel({ sale }: SoldUnitPanelProps) {
  const salePriceNum = sale.salePrice != null ? Number(sale.salePrice) : null;
  const canEditSale = useAuthStore((s) => s.hasPermission('sales:edit'));
  const updateSale = useUpdateSale();
  const { data: brokersData } = useBrokers();
  const brokers = (brokersData as any[]) || [];

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>(() => emptyFormFrom(sale));
  const [formError, setFormError] = useState<string | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const openEdit = () => {
    setForm(emptyFormFrom(sale));
    setFormError(null);
    onOpen();
  };

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
    <Card className="mb-5 sm:mb-6 border border-gray-200 shadow-none rounded-2xl">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <FiDollarSign className="w-4 h-4 text-emerald-600" />
          <h2 className="font-semibold text-sm text-gray-800">Sale Details</h2>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" color="success" variant="flat" className="font-medium">CLOSED</Chip>
          {canEditSale && (
            <button
              onClick={openEdit}
              className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded"
              title="Edit sale details"
              aria-label="Edit sale details"
            >
              <FiEdit2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </CardHeader>
      <CardBody className="px-5 pb-5 pt-1">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 mb-5">
          <DetailRow
            label={<span className="flex items-center gap-1"><FiUser className="w-3 h-3" /> Buyer</span>}
            value={sale.buyer || '—'}
          />
          <DetailRow
            label={<span className="flex items-center gap-1"><FiDollarSign className="w-3 h-3" /> Sale Price</span>}
            value={salePriceNum != null ? <span className="text-emerald-600 tabular-nums">{fmt(salePriceNum)}</span> : '—'}
          />
          <DetailRow
            label={<span className="flex items-center gap-1"><FiDollarSign className="w-3 h-3" /> Deposit</span>}
            value={sale.depositAmt != null ? <span className="tabular-nums">{fmt(Number(sale.depositAmt))}</span> : '—'}
          />
          <DetailRow
            label={<span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" /> LOI Date</span>}
            value={fmtDate(sale.loiDate)}
          />
          <DetailRow
            label={<span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" /> Contract Date</span>}
            value={fmtDate(sale.contractDate)}
          />
          <DetailRow
            label={<span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" /> Closed</span>}
            value={fmtDate(sale.closingDate)}
          />
          <DetailRow
            label="Broker"
            value={sale.broker?.name || '—'}
          />
          <DetailRow
            label="Commission"
            value={sale.brokerCommissionAmt != null ? <span className="tabular-nums">{fmt(Number(sale.brokerCommissionAmt))}</span> : '—'}
          />
          {sale.notes && (
            <div className="sm:col-span-2 py-2 border-t border-gray-50 mt-1">
              <dt className="text-sm text-gray-400 mb-1">Notes</dt>
              <dd className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{sale.notes}</dd>
            </div>
          )}
        </dl>

        <div className="border-t border-gray-100 pt-4">
          <SalePaymentPanel saleId={sale.id} salePrice={salePriceNum ?? undefined} />
        </div>
      </CardBody>

      {/* Edit modal — factual details of an already-closed sale. Changing the sale's
          STATUS (e.g. cancelling a close) stays in the Sales tab's dedicated cancel
          flow, which also releases the unit; this form never touches status. */}
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
    </Card>
  );
}

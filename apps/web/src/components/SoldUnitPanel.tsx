import { Card, CardBody, CardHeader, Chip, useDisclosure } from '@heroui/react';
import { FiUser, FiDollarSign, FiCalendar, FiEdit2 } from 'react-icons/fi';
import { fmt, fmtDate } from '../utils/fmt';
import { useAuthStore } from '../store/authStore';
import { SalePaymentPanel } from './SalePaymentPanel';
import { SaleGateDocuments } from './SaleGateDocuments';
import { EditSaleDetailsModal } from './EditSaleDetailsModal';
import { HistoricalRecordControls } from './HistoricalRecordControls';

interface SoldUnitPanelProps {
  sale: {
    id: string;
    projectId: string;
    buyer?: string | null;
    seller?: string | null;
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
    isHistorical?: boolean;
  };
}

function DetailRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
      <dt className="text-sm text-gray-500 w-36 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value ?? '—'}</dd>
    </div>
  );
}

export function SoldUnitPanel({ sale }: SoldUnitPanelProps) {
  const salePriceNum = sale.salePrice != null ? Number(sale.salePrice) : null;
  const canEditSale = useAuthStore((s) => s.hasPermission('sales:edit'));

  // The form itself lives in EditSaleDetailsModal, which the History timeline opens too.
  const { isOpen, onOpen, onClose } = useDisclosure();

  return (
    <Card className="mb-5 sm:mb-6 border border-gray-200 shadow-none rounded-2xl">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <FiDollarSign className="w-4 h-4 text-emerald-600" />
          <h2 className="font-semibold text-sm text-gray-800">Sale Details</h2>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" color="success" variant="flat" className="font-medium">CLOSED</Chip>
          {sale.isHistorical && (
            <Chip size="sm" color="warning" variant="flat" className="font-medium">RECORDED</Chip>
          )}
          {canEditSale && (
            <button
              onClick={onOpen}
              className="text-gray-500 hover:text-blue-600 transition-colors p-1 rounded"
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
          {sale.seller && (
            <DetailRow
              label={<span className="flex items-center gap-1"><FiUser className="w-3 h-3" /> Seller</span>}
              value={sale.seller}
            />
          )}
          <DetailRow
            label={<span className="flex items-center gap-1"><FiDollarSign className="w-3 h-3" /> Sale Price</span>}
            value={salePriceNum != null ? <span className="text-emerald-700 tabular-nums">{fmt(salePriceNum)}</span> : '—'}
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
              <dt className="text-sm text-gray-500 mb-1">Notes</dt>
              <dd className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{sale.notes}</dd>
            </div>
          )}
        </dl>

        {/* The deal's paperwork, on the unit rather than only inside the Sales tab's edit
            dialog. Every document is filed against the sale AND its unit (see
            DocumentsService.create), so this is the second of the two places it "shows on
            both" — and the place somebody looking at a sold unit actually asks whether the
            Deed is on file. No stage move is pending here, so nothing is marked required;
            the header chip reads "No documents uploaded" until one is. */}
        <div className="border-t border-gray-100 pt-4">
          <SaleGateDocuments saleId={sale.id} />
        </div>

        <div className="border-t border-gray-100 pt-4 mt-4">
          <SalePaymentPanel saleId={sale.id} salePrice={salePriceNum ?? undefined} />
        </div>

        {/* Last, below the deal detail it governs — the approver should have scrolled
            past what they are about to erase (R6, mirrors the lease side). */}
        {sale.isHistorical && (
          <div className="border-t border-gray-100 pt-4 mt-4">
            <HistoricalRecordControls
              record={{
                kind: 'sale', id: sale.id, label: sale.buyer || 'This sale',
                dateRangeLabel: sale.closingDate ? `Closed ${fmtDate(sale.closingDate)}` : 'Closed',
              }}
            />
          </div>
        )}
      </CardBody>

      {/* Extracted so the History timeline can open the same form — a sale entry there
          could be deleted but not corrected. See EditSaleDetailsModal. */}
      <EditSaleDetailsModal sale={sale} isOpen={isOpen} onClose={onClose} />

    </Card>
  );
}

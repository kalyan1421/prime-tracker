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
          <FiDollarSign className="w-4 h-4 text-gray-500" />
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
        {/* Only what is on record (design audit, 2026-10-18). A sold unit with a bare
            record showed six of eight rows as "—"; the missing ones are now named once,
            on one line, with the way to add them right beside it. */}
        {(() => {
          const icon = (I: typeof FiUser) => <I className="w-3 h-3" />;
          const rows: { label: string; icon?: React.ReactNode; value: React.ReactNode | null; missing: string }[] = [
            { label: 'Buyer', icon: icon(FiUser), value: sale.buyer || null, missing: 'buyer' },
            { label: 'Seller', icon: icon(FiUser), value: sale.seller || null, missing: '' },
            { label: 'Sale Price', icon: icon(FiDollarSign), value: salePriceNum != null ? <span className="text-emerald-700 tabular-nums">{fmt(salePriceNum)}</span> : null, missing: 'sale price' },
            { label: 'Deposit', icon: icon(FiDollarSign), value: sale.depositAmt != null ? <span className="tabular-nums">{fmt(Number(sale.depositAmt))}</span> : null, missing: 'deposit' },
            { label: 'LOI Date', icon: icon(FiCalendar), value: sale.loiDate ? fmtDate(sale.loiDate) : null, missing: 'LOI date' },
            { label: 'Contract Date', icon: icon(FiCalendar), value: sale.contractDate ? fmtDate(sale.contractDate) : null, missing: 'contract date' },
            { label: 'Closed', icon: icon(FiCalendar), value: sale.closingDate ? fmtDate(sale.closingDate) : null, missing: 'closing date' },
            { label: 'Broker', value: sale.broker?.name || null, missing: 'broker' },
            // Commission only means anything once there is a broker to pay it to.
            { label: 'Commission', value: sale.brokerCommissionAmt != null ? <span className="tabular-nums">{fmt(Number(sale.brokerCommissionAmt))}</span> : null, missing: sale.broker ? 'commission' : '' },
          ];
          const shown = rows.filter((r) => r.value !== null);
          const missing = rows.filter((r) => r.value === null && r.missing).map((r) => r.missing);
          return (
            <>
              {shown.length > 0 && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                  {shown.map((r) => (
                    <DetailRow
                      key={r.label}
                      label={r.icon ? <span className="flex items-center gap-1">{r.icon} {r.label}</span> : r.label}
                      value={r.value}
                    />
                  ))}
                </dl>
              )}
              {missing.length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Not recorded: {missing.join(', ')}
                  {canEditSale && (
                    <button type="button" onClick={onOpen} className="ml-2 font-medium text-blue-600 hover:underline">
                      Add
                    </button>
                  )}
                </p>
              )}
              {sale.notes && (
                <div className="py-2 border-t border-gray-50 mt-2">
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{sale.notes}</p>
                </div>
              )}
            </>
          );
        })()}

        {/* The deal's paperwork, on the unit rather than only inside the Sales tab's edit
            dialog. Every document is filed against the sale AND its unit (see
            DocumentsService.create), so this is the second of the two places it "shows on
            both" — and the place somebody looking at a sold unit actually asks whether the
            Deed is on file. No stage move is pending here, so nothing is marked required;
            the header chip reads "No documents uploaded" until one is. */}
        <div className="mt-5 border-t border-gray-100 pt-4">
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

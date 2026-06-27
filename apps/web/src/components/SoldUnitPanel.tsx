import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { FiUser, FiDollarSign, FiCalendar } from 'react-icons/fi';
import { fmt, fmtDate } from '../utils/fmt';
import { SalePaymentPanel } from './SalePaymentPanel';

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
    broker?: { name: string } | null;
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

export function SoldUnitPanel({ sale }: SoldUnitPanelProps) {
  const salePriceNum = sale.salePrice != null ? Number(sale.salePrice) : null;

  return (
    <Card className="mb-5 sm:mb-6 border border-gray-200 shadow-none rounded-2xl">
      <CardHeader className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <FiDollarSign className="w-4 h-4 text-emerald-600" />
          <h2 className="font-semibold text-sm text-gray-800">Sale Details</h2>
        </div>
        <Chip size="sm" color="success" variant="flat" className="font-medium">CLOSED</Chip>
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
    </Card>
  );
}

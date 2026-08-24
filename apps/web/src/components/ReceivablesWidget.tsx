import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardBody, Chip, Button } from '@heroui/react';
import { FiDollarSign } from 'react-icons/fi';
import { useReceivables } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';

const WEEKS_OPTIONS = [2, 4, 8] as const;
type WeeksOption = (typeof WEEKS_OPTIONS)[number];

const STATUS_CHIP: Record<string, { color: 'danger' | 'warning' | 'success' | 'default'; label: string }> = {
  OVERDUE:        { color: 'danger',  label: 'Overdue' },
  DUE:            { color: 'warning', label: 'Due' },
  PARTIALLY_PAID: { color: 'warning', label: 'Partial' },
  SCHEDULED:      { color: 'default', label: 'Scheduled' },
  PAID:           { color: 'success', label: 'Paid' },
};

export default function ReceivablesWidget() {
  const [weeks, setWeeks] = useState<WeeksOption>(4);
  const navigate = useNavigate();
  const { data, isLoading } = useReceivables(weeks);

  const items: any[] = data ?? [];

  const totalOutstanding = items.reduce((sum: number, r: any) => sum + (r.outstanding ?? 0), 0);

  return (
    <Card shadow="sm" className="col-span-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between w-full gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FiDollarSign className="text-blue-500" />
            <p className="font-semibold text-sm text-gray-600">Upcoming Receivables</p>
            {items.length > 0 && (
              <span className="text-xs text-gray-500">
                — {fmt(totalOutstanding)} outstanding across {items.length} installment{items.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {WEEKS_OPTIONS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={weeks === w ? 'solid' : 'flat'}
                color={weeks === w ? 'primary' : 'default'}
                className="min-w-0 px-3 h-7 text-xs"
                onPress={() => setWeeks(w)}
              >
                {w}w
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardBody className="pt-0">
        {isLoading ? (
          <div className="space-y-2 py-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 rounded-md bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            No receivables due in the next {weeks} weeks
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Buyer</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Payment</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Paid</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Outstanding</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Due Date</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r: any) => {
                    const chip = STATUS_CHIP[r.status] ?? { color: 'default', label: r.status };
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                        onClick={() => navigate(`/projects/${r.projectId}`)}
                      >
                        <td className="py-2.5 px-3 font-medium text-blue-600 hover:underline">
                          {r.buyer ?? '—'}
                        </td>
                        <td className="py-2.5 px-3 text-gray-700">{r.label}</td>
                        <td className="py-2.5 px-3 text-right text-gray-700">{fmt(r.amount)}</td>
                        <td className="py-2.5 px-3 text-right text-green-700">{fmt(r.paidAmount)}</td>
                        <td className={`py-2.5 px-3 text-right font-semibold ${r.outstanding > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                          {fmt(r.outstanding)}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">{r.due ? fmtDate(r.due) : '—'}</td>
                        <td className="py-2.5 px-3 text-center">
                          <Chip size="sm" color={chip.color} variant="flat">{chip.label}</Chip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

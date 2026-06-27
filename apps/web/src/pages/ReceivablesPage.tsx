import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, Select, SelectItem, Chip,
} from '@heroui/react';
import { FiDollarSign, FiAlertCircle, FiCalendar, FiClock, FiInbox } from 'react-icons/fi';
import { useReceivables, useProjects } from '../hooks/useApi';
import { fmt, fmtDate } from '../utils/fmt';
import { StatCard, LoadingState } from '../components/ui';

const STATUS_ORDER: Record<string, number> = {
  OVERDUE: 0,
  DUE: 1,
  PARTIALLY_PAID: 2,
  SCHEDULED: 3,
};

const STATUS_COLOR: Record<string, 'danger' | 'warning' | 'default' | 'success'> = {
  OVERDUE: 'danger',
  DUE: 'warning',
  PARTIALLY_PAID: 'warning',
  SCHEDULED: 'default',
  PAID: 'success',
  WAIVED: 'default',
};

const STATUS_LABELS: Record<string, string> = {
  OVERDUE: 'Overdue',
  DUE: 'Due',
  PARTIALLY_PAID: 'Partial',
  SCHEDULED: 'Scheduled',
  PAID: 'Paid',
  WAIVED: 'Waived',
};

const WEEK_OPTIONS = [
  { value: '4', label: '4 weeks' },
  { value: '8', label: '8 weeks' },
  { value: '12', label: '12 weeks' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'DUE', label: 'Due' },
  { value: 'PARTIALLY_PAID', label: 'Partially Paid' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

export default function ReceivablesPage() {
  const navigate = useNavigate();
  const [weeks, setWeeks] = useState('4');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');

  const { data: rawData, isLoading } = useReceivables(Number(weeks));
  const { data: projectsData } = useProjects();

  const receivables: any[] = rawData ?? [];
  const projectList: any[] = Array.isArray(projectsData)
    ? projectsData
    : (projectsData as any)?.data ?? [];

  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projectList) m[p.id] = p.name;
    return m;
  }, [projectList]);

  const projectsInData = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    for (const r of receivables) {
      if (!seen.has(r.projectId)) {
        seen.add(r.projectId);
        result.push({ id: r.projectId, name: projectMap[r.projectId] ?? r.projectId });
      }
    }
    return result;
  }, [receivables, projectMap]);

  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);

  const stats = useMemo(() => {
    const totalOutstanding = receivables.reduce((s, r) => s + (r.outstanding ?? 0), 0);
    const overdueCount = receivables.filter((r) => r.status === 'OVERDUE').length;
    const dueThisWeek = receivables.filter((r) => {
      const d = r.due ? new Date(r.due) : null;
      return d && d >= now && d <= weekEnd;
    }).length;
    const highPriority = receivables.filter((r) =>
      r.status === 'OVERDUE' || r.status === 'DUE'
    ).length;
    return { totalOutstanding, overdueCount, dueThisWeek, highPriority };
  }, [receivables]);

  const filtered = useMemo(() => {
    let rows = [...receivables];
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (projectFilter) rows = rows.filter((r) => r.projectId === projectFilter);
    rows.sort((a, b) => {
      const orderA = STATUS_ORDER[a.status] ?? 99;
      const orderB = STATUS_ORDER[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      const dA = a.due ? new Date(a.due).getTime() : 0;
      const dB = b.due ? new Date(b.due).getTime() : 0;
      return dA - dB;
    });
    return rows;
  }, [receivables, statusFilter, projectFilter]);

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Receivables</h1>
        <p className="text-sm text-gray-500 mt-1">Outstanding sale payment installments</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Outstanding"
          value={fmt(stats.totalOutstanding)}
          colorScheme="blue"
          helpText="Non-paid installments in window"
        />
        <StatCard
          label="Overdue"
          value={String(stats.overdueCount)}
          colorScheme="red"
          helpText="Past due date"
        />
        <StatCard
          label="Due This Week"
          value={String(stats.dueThisWeek)}
          colorScheme="orange"
          helpText="Within next 7 days"
        />
        <StatCard
          label="High Priority"
          value={String(stats.highPriority)}
          colorScheme="purple"
          helpText="Overdue + Due combined"
        />
      </div>

      <Card shadow="sm" className="border border-gray-100">
        <CardBody className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="w-44">
              <Select
                size="sm"
                label="Window"
                selectedKeys={new Set([weeks])}
                onSelectionChange={(keys) => {
                  const v = [...keys][0];
                  if (v) setWeeks(String(v));
                }}
              >
                {WEEK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                ))}
              </Select>
            </div>
            <div className="w-52">
              <Select
                size="sm"
                label="Status"
                selectedKeys={new Set([statusFilter])}
                onSelectionChange={(keys) => {
                  const v = [...keys][0];
                  setStatusFilter(v == null ? '' : String(v));
                }}
              >
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                ))}
              </Select>
            </div>
            {projectsInData.length > 1 && (
              <div className="w-56">
                <Select
                  size="sm"
                  label="Project"
                  selectedKeys={new Set([projectFilter])}
                  onSelectionChange={(keys) => {
                    const v = [...keys][0];
                    setProjectFilter(v == null ? '' : String(v));
                  }}
                >
                  {[{ id: '', name: 'All Projects' }, ...projectsInData].map((p) => (
                    <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card shadow="sm" className="border border-gray-100">
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <FiInbox className="text-3xl mb-3" />
              <p className="text-sm font-medium text-gray-500">No receivables in the selected window.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Installment</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Buyer</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Project</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Amount</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Paid</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Outstanding</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((r) => {
                    const isOverdue = r.status === 'OVERDUE';
                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => navigate(`/projects/${r.projectId}/revenue`)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isOverdue && <FiAlertCircle className="text-red-500 shrink-0" size={14} />}
                            <span className="font-medium text-gray-800">{r.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.buyer || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {projectMap[r.projectId] ?? r.projectId}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800">{fmt(r.amount)}</td>
                        <td className="px-4 py-3 text-right text-green-700">{r.paidAmount > 0 ? fmt(r.paidAmount) : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(r.outstanding)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-gray-600">
                            <FiCalendar size={12} className="shrink-0" />
                            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>{fmtDate(r.due)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Chip
                            size="sm"
                            color={STATUS_COLOR[r.status] ?? 'default'}
                            variant="flat"
                          >
                            {STATUS_LABELS[r.status] ?? r.status}
                          </Chip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400 flex items-center gap-1">
                <FiClock size={11} />
                <span>Showing {filtered.length} installment{filtered.length !== 1 ? 's' : ''} in next {weeks} weeks</span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

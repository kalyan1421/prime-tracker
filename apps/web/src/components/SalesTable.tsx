/**
 * The Sales pipeline as a sheet: one row per sale, sortable columns, filters, grouped by
 * status (the kanban's columns) and exportable to CSV. Same data and the same row actions
 * as the board — it is a second view of the pipeline, not a second source of it.
 */

import { useMemo, useState } from 'react';
import { Button, Input, Select, SelectItem, Switch } from '@heroui/react';
import { FiDollarSign, FiEdit2, FiX, FiTrash2, FiDownload, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { StatusBadge } from './ui';
import { fmt, fmtDate } from '../utils/fmt';

const STAGES = ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED', 'CANCELLED'] as const;
const STAGE_LABEL: Record<string, string> = {
  PROSPECT: 'Prospect', LOI_SIGNED: 'LOI Signed', UNDER_CONTRACT: 'Under Contract',
  CLOSED: 'Closed', CANCELLED: 'Cancelled',
};

type SortKey = 'stage' | 'buyer' | 'asset' | 'price' | 'psf' | 'deposit' | 'closing' | 'broker';

interface Row {
  sale: any;
  stage: string;
  buyer: string;
  asset: string;
  building: string;
  price: number | null;
  sqft: number | null;
  psf: number | null;
  deposit: number | null;
  closing: string | null;
  broker: string;
}

function toRow(s: any, brokerName: (id?: string | null) => string): Row {
  const isBuilding = (s.buildingId || s.building?.id) && !(s.unitId || s.unit?.id);
  const price = s.salePrice != null && s.salePrice !== '' ? Number(s.salePrice) : null;
  const sqft = Number((isBuilding ? s.building?.totalSqft : s.unit?.sqft) ?? 0) || null;
  return {
    sale: s,
    stage: s.status,
    buyer: s.buyer || s.buyerName || '',
    asset: isBuilding ? 'Whole building' : `Unit ${s.unit?.unitNumber ?? '—'}`,
    building: (isBuilding ? s.building?.name : s.unit?.building?.name) ?? '',
    price,
    sqft,
    psf: price != null && sqft ? price / sqft : null,
    deposit: s.depositAmt != null && s.depositAmt !== '' ? Number(s.depositAmt) : null,
    closing: s.closingDate ?? null,
    broker: brokerName(s.brokerId),
  };
}

const csvCell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function SalesTable({
  sales, brokers, onPayments, onEdit, onCancel, onDelete,
}: {
  sales: any[];
  brokers: any[];
  onPayments: (sale: any) => void;
  onEdit: (sale: any) => void;
  onCancel: (sale: any) => void;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [stages, setStages] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState('');
  const [broker, setBroker] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'stage', dir: 'asc' });

  const brokerName = (id?: string | null) =>
    (id && brokers.find((b: any) => b.id === id)?.name) || '';

  const rows = useMemo(() => sales.map((s) => toRow(s, brokerName)), [sales, brokers]); // eslint-disable-line react-hooks/exhaustive-deps
  const buildingNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.building).filter(Boolean))).sort(),
    [rows],
  );
  const brokerNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.broker).filter(Boolean))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) =>
      (stages.size === 0 || stages.has(r.stage))
      && (!building || r.building === building)
      && (!broker || r.broker === broker)
      && (!q || `${r.buyer} ${r.asset} ${r.building}`.toLowerCase().includes(q)));
    const val = (r: Row): string | number => {
      switch (sort.key) {
        case 'stage': return STAGES.indexOf(r.stage as any);
        case 'buyer': return r.buyer.toLowerCase();
        case 'asset': return `${r.building} ${r.asset}`.toLowerCase();
        case 'price': return r.price ?? -1;
        case 'psf': return r.psf ?? -1;
        case 'deposit': return r.deposit ?? -1;
        case 'closing': return r.closing ? new Date(r.closing).getTime() : -1;
        default: return r.broker.toLowerCase();
      }
    };
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign;
    });
  }, [rows, search, stages, building, broker, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const toggleStage = (st: string) =>
    setStages((prev) => { const n = new Set(prev); if (n.has(st)) n.delete(st); else n.add(st); return n; });

  const total = (list: Row[]) => list.reduce((sum, r) => sum + (r.price ?? 0), 0);

  const exportCsv = () => {
    const head = ['Status', 'Buyer', 'Building', 'Asset', 'Price', 'Sqft', 'Price PSF', 'Deposit', 'Closing date', 'Broker'];
    const lines = [head, ...visible.map((r) => [
      STAGE_LABEL[r.stage] ?? r.stage, r.buyer, r.building, r.asset, r.price ?? '', r.sqft ?? '',
      r.psf != null ? r.psf.toFixed(2) : '', r.deposit ?? '', r.closing ? String(r.closing).slice(0, 10) : '', r.broker,
    ])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sales.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const Th = ({ k, children, right = false }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-gray-900 ${right ? 'flex-row-reverse' : ''}`}>
        {children}
        {sort.key === k && (sort.dir === 'asc' ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );

  const renderRow = (r: Row) => (
    <tr key={r.sale.id} className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2"><StatusBadge status={r.stage} /></td>
      <td className="px-3 py-2 font-medium text-gray-800">{r.buyer || 'Unnamed'}</td>
      <td className="px-3 py-2 text-gray-700">
        {r.asset}
        {r.building && <span className="block text-xs text-gray-600">{r.building}</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-800">{r.price != null ? fmt(r.price) : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.psf != null ? `$${r.psf.toFixed(2)}` : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.deposit != null ? fmt(r.deposit) : '—'}</td>
      <td className="px-3 py-2 text-gray-700">{r.closing ? fmtDate(r.closing) : '—'}</td>
      <td className="px-3 py-2 text-gray-700">{r.broker || '—'}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="light" isIconOnly aria-label="Payments" onPress={() => onPayments(r.sale)}><FiDollarSign /></Button>
          <Button size="sm" variant="light" isIconOnly aria-label="Edit sale" onPress={() => onEdit(r.sale)}><FiEdit2 /></Button>
          {r.stage !== 'CANCELLED' && r.stage !== 'CLOSED' && (
            <Button size="sm" variant="light" color="warning" isIconOnly aria-label="Cancel sale" onPress={() => onCancel(r.sale)}><FiX /></Button>
          )}
          <Button size="sm" variant="light" color="danger" isIconOnly aria-label="Delete sale" onPress={() => onDelete(r.sale.id)}><FiTrash2 /></Button>
        </div>
      </td>
    </tr>
  );

  // Grouping follows the status order, not the sort — the sort orders rows WITHIN a group.
  const groups = grouped
    ? STAGES.map((st) => ({ stage: st, list: visible.filter((r) => r.stage === st) })).filter((g) => g.list.length > 0)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input size="sm" label="Search" placeholder="Buyer, unit or building" value={search}
          onValueChange={setSearch} isClearable onClear={() => setSearch('')} className="max-w-xs" />
        <Select size="sm" label="Building" className="max-w-[12rem]" selectedKeys={building ? [building] : []}
          onSelectionChange={(k) => setBuilding((Array.from(k)[0] as string) || '')}>
          {[{ n: '' }, ...buildingNames.map((n) => ({ n }))].map((b) => (
            <SelectItem key={b.n} textValue={b.n || 'All buildings'}>{b.n || 'All buildings'}</SelectItem>
          ))}
        </Select>
        {brokerNames.length > 0 && (
          <Select size="sm" label="Broker" className="max-w-[12rem]" selectedKeys={broker ? [broker] : []}
            onSelectionChange={(k) => setBroker((Array.from(k)[0] as string) || '')}>
            {[{ n: '' }, ...brokerNames.map((n) => ({ n }))].map((b) => (
              <SelectItem key={b.n} textValue={b.n || 'All brokers'}>{b.n || 'All brokers'}</SelectItem>
            ))}
          </Select>
        )}
        <Switch size="sm" isSelected={grouped} onValueChange={setGrouped}>Group by status</Switch>
        <Button size="sm" variant="flat" startContent={<FiDownload />} onPress={exportCsv} isDisabled={visible.length === 0}>
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STAGES.map((st) => {
          const on = stages.has(st);
          const n = rows.filter((r) => r.stage === st).length;
          return (
            <button key={st} type="button" aria-pressed={on} onClick={() => toggleStage(st)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on
                ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {STAGE_LABEL[st]} <span className={on ? 'text-blue-100' : 'text-gray-600'}>{n}</span>
            </button>
          );
        })}
        {stages.size > 0 && (
          <button type="button" onClick={() => setStages(new Set())} className="px-2 py-1 text-xs font-medium text-blue-700 hover:underline">
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-700">
            <tr>
              <Th k="stage">Status</Th>
              <Th k="buyer">Buyer</Th>
              <Th k="asset">Asset</Th>
              <Th k="price" right>Price</Th>
              <Th k="psf" right>Price PSF</Th>
              <Th k="deposit" right>Deposit</Th>
              <Th k="closing">Closing</Th>
              <Th k="broker">Broker</Th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-600">No sales match these filters.</td></tr>
            )}
            {grouped
              ? groups.map((g) => (
                <GroupBlock key={g.stage} label={STAGE_LABEL[g.stage]} count={g.list.length} sum={total(g.list)}>
                  {g.list.map(renderRow)}
                </GroupBlock>
              ))
              : visible.map(renderRow)}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-800">
                <td className="px-3 py-2" colSpan={3}>{visible.length} sale{visible.length === 1 ? '' : 's'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(total(visible))}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function GroupBlock({ label, count, sum, children }: { label: string; count: number; sum: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-gray-200 bg-gray-100">
        <td colSpan={3} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
          {label} · {count}
        </td>
        <td className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-gray-700">{fmt(sum)}</td>
        <td colSpan={5} />
      </tr>
      {children}
    </>
  );
}

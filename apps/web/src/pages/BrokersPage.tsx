import { useMemo, useState } from 'react';
import {
  Card, CardBody, Button, Chip, Input, Textarea,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast,
} from '@heroui/react';
import { FiBriefcase, FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import {
  useBrokers, useBrokerReport, useCreateBroker, useUpdateBroker, useDeleteBroker,
} from '../hooks/useApi';
import { fmt, fmtPct, errMsg } from '../utils/fmt';
import { StatCard, LoadingState, EmptyState, PermissionGate } from '../components/ui';


const EMPTY: Record<string, string> = { name: '', company: '', email: '', phone: '', commissionRate: '', commissionFlat: '', notes: '' };

export default function BrokersPage() {
  const { data: brokersData, isLoading } = useBrokers(true);
  const { data: reportData } = useBrokerReport();
  const create = useCreateBroker();
  const update = useUpdateBroker();
  const del = useDeleteBroker();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const brokers: any[] = Array.isArray(brokersData) ? brokersData : [];
  const reportMap = useMemo(
    () => new Map((Array.isArray(reportData) ? reportData : []).map((r: any) => [r.brokerId, r])),
    [reportData],
  );

  const totals = useMemo(() => {
    const rows = Array.isArray(reportData) ? reportData : [];
    return {
      brokers: brokers.length,
      leads: rows.reduce((s: number, r: any) => s + r.leads, 0),
      closed: rows.reduce((s: number, r: any) => s + r.closedSales, 0),
      commission: rows.reduce((s: number, r: any) => s + r.commissionEarned, 0),
    };
  }, [reportData, brokers.length]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => { setEditId(null); setForm(EMPTY); onOpen(); };
  const openEdit = (b: any) => {
    setEditId(b.id);
    setForm({
      name: b.name || '', company: b.company || '', email: b.email || '', phone: b.phone || '',
      commissionRate: b.commissionRate != null ? String(b.commissionRate) : '',
      commissionFlat: b.commissionFlat != null ? String(b.commissionFlat) : '',
      notes: b.notes || '',
    });
    onOpen();
  };

  const save = async () => {
    if (!form.name.trim()) return addToast({ title: 'Name is required', color: 'warning' });
    const data: Record<string, any> = {
      name: form.name.trim(),
      company: form.company || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      commissionRate: form.commissionRate ? Number(form.commissionRate) : undefined,
      commissionFlat: form.commissionFlat ? Number(form.commissionFlat) : undefined,
      notes: form.notes || undefined,
    };
    try {
      if (editId) await update.mutateAsync({ id: editId, data });
      else await create.mutateAsync(data);
      addToast({ title: editId ? 'Broker updated' : 'Broker added', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save broker'), color: 'danger' });
    }
  };

  if (isLoading) return <LoadingState message="Loading brokers…" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiBriefcase className="text-2xl text-indigo-600" />
          <h1 className="text-2xl font-bold">Brokers</h1>
        </div>
        <PermissionGate permission="broker:edit">
          <Button color="primary" startContent={<FiPlus />} onPress={openCreate}>Add broker</Button>
        </PermissionGate>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Brokers" value={String(totals.brokers)} />
        <StatCard label="Leads brought" value={String(totals.leads)} />
        <StatCard label="Closed sales" value={String(totals.closed)} />
        <StatCard label="Commission earned" value={fmt(totals.commission)} />
      </div>

      {brokers.length === 0 ? (
        <EmptyState title="No brokers yet" message="Add the brokers who bring you leads to track their performance + commissions." />
      ) : (
        <Card shadow="sm">
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Broker</th>
                  <th className="text-left px-4 py-3">Commission</th>
                  <th className="text-right px-4 py-3">Leads</th>
                  <th className="text-right px-4 py-3">Closed</th>
                  <th className="text-right px-4 py-3">Closed value</th>
                  <th className="text-right px-4 py-3">Commission earned</th>
                  <th className="text-right px-4 py-3">Conversion</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((b) => {
                  const r: any = reportMap.get(b.id) || {};
                  const rate = b.commissionRate != null
                    ? `${b.commissionRate}%`
                    : b.commissionFlat != null ? fmt(Number(b.commissionFlat)) : '—';
                  return (
                    <tr key={b.id} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        <div className="font-medium flex items-center gap-2">
                          {b.name}
                          {!b.isActive && <Chip size="sm" variant="flat" color="default">inactive</Chip>}
                        </div>
                        <div className="text-xs text-gray-500">{b.company || b.email || b.phone || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{rate}</td>
                      <td className="px-4 py-3 text-right">{r.leads ?? 0}</td>
                      <td className="px-4 py-3 text-right">{r.closedSales ?? 0}</td>
                      <td className="px-4 py-3 text-right">{fmt(r.closedValue ?? 0)}</td>
                      <td className="px-4 py-3 text-right font-medium text-indigo-700">{fmt(r.commissionEarned ?? 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtPct(r.conversionPct ?? 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <PermissionGate permission="broker:edit">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(b)}><FiEdit2 className="text-xs" /></Button>
                            <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => del.mutate(b.id)}><FiTrash2 className="text-xs" /></Button>
                          </div>
                        </PermissionGate>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit broker' : 'Add broker'}</ModalHeader>
          <ModalBody className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input size="sm" label="Name" value={form.name} onChange={set('name')} isRequired />
              <Input size="sm" label="Company" value={form.company} onChange={set('company')} />
              <Input size="sm" label="Email" value={form.email} onChange={set('email')} />
              <Input size="sm" label="Phone" value={form.phone} onChange={set('phone')} />
              <Input size="sm" type="number" label="Commission rate (%)" value={form.commissionRate} onChange={set('commissionRate')} description="Default % of sale price" />
              <Input size="sm" type="number" label="Flat fee ($)" value={form.commissionFlat} onChange={set('commissionFlat')} description="Used when no % is set" />
            </div>
            <Textarea size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={save} isLoading={create.isPending || update.isPending}>
              {editId ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

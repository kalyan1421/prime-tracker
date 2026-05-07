import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Button,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiPlus } from 'react-icons/fi';
import { useInvestors, useInvestorSummary, useCreateInvestor } from '../hooks/useApi';
import { StatCard, LoadingState, ErrorState, EmptyState, fmt, fmtDate } from '../components/ui';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
};

const EMPTY = { name: '', email: '', phone: '', entityName: '' };

export default function InvestorsPage() {
  const navigate = useNavigate();
  const { data: investors, isLoading, error } = useInvestors();
  const { data: summary } = useInvestorSummary();
  const createInvestor = useCreateInvestor();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const set = (f: string) => (e: any) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const s = summary as any;

  const handleSave = async () => {
    try {
      const inv = await createInvestor.mutateAsync(form);
      addToast({ title: 'Investor created', color: 'success' });
      setForm(EMPTY);
      onClose();
      navigate(`/investors/${(inv as any).id}`);
    } catch (e) { addToast({ title: errMsg(e, 'Failed to create investor'), color: 'danger' }); }
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState />;

  const list = (investors as any[]) || [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Investors</h1>
          <p className="text-sm text-gray-500 mt-0.5">Equity positions, capital calls, and distributions</p>
        </div>
        <Button color="primary" startContent={<FiPlus />} onPress={onOpen} className="self-start sm:self-auto">Add Investor</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Investors" value={String(s?.totalInvestors || 0)} />
        <StatCard label="Total Committed" value={fmt(s?.totalCommitted || 0)} variant="construction" />
        <StatCard label="Total Called" value={fmt(s?.totalCalled || 0)} variant="revenue" />
        <StatCard label="Distributions" value={fmt(s?.totalDistributions || 0)} variant="neutral" />
      </div>

      <Card shadow="sm">
        <CardHeader>
          <span className="font-semibold text-sm">Investor Roster</span>
        </CardHeader>
        <CardBody className="p-0">
          {list.length === 0 ? (
            <div className="p-6"><EmptyState message="No investors yet" /></div>
          ) : (
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Name', 'Entity', '# Projects', 'Committed', 'Called', 'Distributions', ''].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((inv: any) => (
                  <tr
                    key={inv.id}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/investors/${inv.id}`)}
                  >
                    <td className="px-4 py-3 font-medium">{inv.name}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.entityName || '—'}</td>
                    <td className="px-4 py-3">{inv.projectCount}</td>
                    <td className="px-4 py-3 font-mono">{fmt(inv.totalCommitted)}</td>
                    <td className="px-4 py-3 font-mono">{fmt(inv.totalCalled)}</td>
                    <td className="px-4 py-3 font-mono">{fmt(inv.totalDistributions)}</td>
                    <td className="px-4 py-3 text-blue-600 text-xs">View →</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="md">
        <ModalContent>
          <ModalHeader>Add Investor</ModalHeader>
          <ModalBody className="space-y-3">
            <Input label="Name" value={form.name} onChange={set('name')} isRequired />
            <Input label="Entity / LLC Name" value={form.entityName} onChange={set('entityName')} />
            <Input label="Email" type="email" value={form.email} onChange={set('email')} />
            <Input label="Phone" value={form.phone} onChange={set('phone')} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={createInvestor.isPending}>Create</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

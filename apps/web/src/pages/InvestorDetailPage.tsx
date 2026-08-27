import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Button, Tabs, Tab, Chip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Input, Select, SelectItem, Textarea, useDisclosure, addToast,
} from '@heroui/react';
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { FiArrowLeft, FiPlus } from 'react-icons/fi';
import {
  useInvestor, useAddPosition, useCreateCapitalCall, useMarkCapitalCallPaid,
  useCreateDistribution, useProjects,
} from '../hooks/useApi';
import { fmt, fmtDate, fmtPct, errMsg } from '../utils/fmt';
import { StatCard, LoadingState, ErrorState, EmptyState } from '../components/ui';


const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];
const CALL_STATUS_COLORS: Record<string, 'default' | 'success' | 'danger'> = {
  PENDING: 'default', PAID: 'success', OVERDUE: 'danger',
};
const DIST_TYPES = ['RETURN_OF_CAPITAL', 'PREFERRED_RETURN', 'PROFIT_SHARE'];

export default function InvestorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: investor, isLoading, error } = useInvestor(id!);
  const { data: projects = [] } = useProjects();
  const addPosition = useAddPosition();
  const createCall = useCreateCapitalCall();
  const markPaid = useMarkCapitalCallPaid();
  const createDist = useCreateDistribution();

  const { isOpen: isPosOpen, onOpen: onPosOpen, onClose: onPosClose } = useDisclosure();
  const { isOpen: isCallOpen, onOpen: onCallOpen, onClose: onCallClose } = useDisclosure();
  const { isOpen: isDistOpen, onOpen: onDistOpen, onClose: onDistClose } = useDisclosure();

  const [posForm, setPosForm] = useState<Record<string, string>>({ projectId: '', pctOwnership: '', committedAmt: '' });
  const [posFormErrors, setPosFormErrors] = useState<Record<string, string>>({});
  const [callForm, setCallForm] = useState<Record<string, string>>({ projectId: '', amount: '', dueDate: '', notes: '' });
  const [callFormErrors, setCallFormErrors] = useState<Record<string, string>>({});
  const [distForm, setDistForm] = useState<Record<string, string>>({ projectId: '', amount: '', distDate: '', distType: 'RETURN_OF_CAPITAL', notes: '' });
  const [distFormErrors, setDistFormErrors] = useState<Record<string, string>>({});

  const setPos = (f: string) => (e: any) => setPosForm((p) => ({ ...p, [f]: e.target.value }));
  const setCall = (f: string) => (e: any) => setCallForm((p) => ({ ...p, [f]: e.target.value }));
  const setDist = (f: string) => (e: any) => setDistForm((p) => ({ ...p, [f]: e.target.value }));

  if (isLoading) return <LoadingState />;
  if (error || !investor) return <ErrorState />;

  const inv = investor as any;
  const positions = inv.positions || [];
  const capitalCalls = inv.capitalCalls || [];
  const distributions = inv.distributions || [];

  const totalCommitted = positions.reduce((s: number, p: any) => s + p.committedAmt, 0);
  const totalCalled = positions.reduce((s: number, p: any) => s + p.calledAmt, 0);
  const totalDist = distributions.reduce((s: number, d: any) => s + d.amount, 0);
  const pendingCalls = capitalCalls.filter((c: any) => c.status === 'PENDING').reduce((s: number, c: any) => s + c.amount, 0);

  // Pie data for allocation
  const pieData = positions.map((p: any) => ({
    name: p.project?.name || 'Unknown',
    value: p.committedAmt,
    pct: p.pctOwnership,
  }));

  // Bar chart of distributions by year
  const distByYear = distributions.reduce((acc: Record<string, number>, d: any) => {
    const y = new Date(d.distDate).getFullYear().toString();
    acc[y] = (acc[y] || 0) + d.amount;
    return acc;
  }, {});
  const distChartData = Object.entries(distByYear).sort().map(([year, amount]) => ({ year, amount }));

  const validatePosForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!posForm.projectId) errs.projectId = 'Project is required';
    const pct = parseFloat(posForm.pctOwnership);
    if (!posForm.pctOwnership || isNaN(pct)) errs.pctOwnership = 'Ownership % is required';
    else if (pct < 0 || pct > 100) errs.pctOwnership = 'Must be between 0 and 100';
    const amt = parseFloat(posForm.committedAmt);
    if (!posForm.committedAmt || isNaN(amt) || amt <= 0) errs.committedAmt = 'Committed amount is required';
    setPosFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddPosition = async () => {
    if (!validatePosForm()) return;
    try {
      await addPosition.mutateAsync({ investorId: inv.id, ...posForm, pctOwnership: parseFloat(posForm.pctOwnership), committedAmt: parseFloat(posForm.committedAmt) });
      addToast({ title: 'Position added', color: 'success' });
      setPosForm({ projectId: '', pctOwnership: '', committedAmt: '' });
      onPosClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to add position'), color: 'danger' }); }
  };

  const validateCallForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!callForm.projectId) errs.projectId = 'Project is required';
    const amt = parseFloat(callForm.amount);
    if (!callForm.amount || isNaN(amt) || amt <= 0) errs.amount = 'Amount is required';
    if (!callForm.dueDate) errs.dueDate = 'Due date is required';
    setCallFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateCall = async () => {
    if (!validateCallForm()) return;
    try {
      await createCall.mutateAsync({ investorId: inv.id, ...callForm, amount: parseFloat(callForm.amount) });
      addToast({ title: 'Capital call created', color: 'success' });
      setCallForm({ projectId: '', amount: '', dueDate: '', notes: '' });
      onCallClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to create capital call'), color: 'danger' }); }
  };

  const validateDistForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!distForm.projectId) errs.projectId = 'Project is required';
    const amt = parseFloat(distForm.amount);
    if (!distForm.amount || isNaN(amt) || amt <= 0) errs.amount = 'Amount is required';
    if (!distForm.distDate) errs.distDate = 'Date is required';
    setDistFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateDist = async () => {
    if (!validateDistForm()) return;
    try {
      await createDist.mutateAsync({ investorId: inv.id, ...distForm, amount: parseFloat(distForm.amount) });
      addToast({ title: 'Distribution recorded', color: 'success' });
      setDistForm({ projectId: '', amount: '', distDate: '', distType: 'RETURN_OF_CAPITAL', notes: '' });
      onDistClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to record distribution'), color: 'danger' }); }
  };

  const handleMarkPaid = async (callId: string) => {
    try {
      await markPaid.mutateAsync({ id: callId, investorId: inv.id });
      addToast({ title: 'Capital call marked paid', color: 'success' });
    } catch (e) { addToast({ title: errMsg(e, 'Failed to mark paid'), color: 'danger' }); }
  };

  return (
    <div>
      <button
        className="flex items-center gap-1 text-blue-600 text-sm font-medium mb-4 cursor-pointer hover:underline"
        onClick={() => navigate('/investors')}
      >
        <FiArrowLeft />
        All Investors
      </button>

      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold break-words">{inv.name}</h1>
        {inv.entityName && <p className="text-gray-500 text-sm mt-0.5">{inv.entityName}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mt-1">
          {inv.email && <span className="break-all">{inv.email}</span>}
          {inv.phone && <span>{inv.phone}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Committed" value={fmt(totalCommitted)} variant="construction" />
        <StatCard label="Total Called" value={fmt(totalCalled)} variant="revenue" />
        <StatCard label="Pending Calls" value={fmt(pendingCalls)} variant="neutral" />
        <StatCard label="Distributions" value={fmt(totalDist)} />
      </div>

      <Tabs color="primary" size="sm" classNames={{ tabList: "overflow-x-auto scrollbar-none flex-nowrap" }}>
        {/* Overview */}
        <Tab key="overview" title="Overview">
          <div className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card shadow="sm">
              <CardHeader className="flex justify-between items-center">
                <span className="font-semibold text-sm">Equity Positions</span>
                <Button size="sm" color="primary" startContent={<FiPlus />} onPress={() => { setPosFormErrors({}); onPosOpen(); }}>Add Position</Button>
              </CardHeader>
              <CardBody className="p-0">
                {positions.length === 0 ? <div className="p-4"><EmptyState message="No positions yet" /></div> : (
                  <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {['Project', 'Ownership %', 'Committed', 'Called'].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p: any) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="px-4 py-3 font-medium">{p.project?.name}</td>
                          <td className="px-4 py-3">{fmtPct(p.pctOwnership)}</td>
                          <td className="px-4 py-3 font-mono">{fmt(p.committedAmt)}</td>
                          <td className="px-4 py-3 font-mono">{fmt(p.calledAmt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </CardBody>
            </Card>

            {pieData.length > 0 && (
              <Card shadow="sm">
                <CardHeader><span className="font-semibold text-sm">Allocation by Project</span></CardHeader>
                <CardBody>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, pct }) => `${name} (${fmtPct(pct)})`}>
                        {pieData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => fmt(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}
          </div>
        </Tab>

        {/* Capital Calls */}
        <Tab key="calls" title="Capital Calls">
          <div className="pt-4 space-y-4">
            <div className="flex justify-end">
              <Button size="sm" color="primary" startContent={<FiPlus />} onPress={() => { setCallFormErrors({}); onCallOpen(); }}>New Capital Call</Button>
            </div>
            <Card shadow="sm">
              <CardBody className="p-0">
                {capitalCalls.length === 0 ? <div className="p-6"><EmptyState message="No capital calls" /></div> : (
                  <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {['Project', 'Amount', 'Due Date', 'Paid Date', 'Status', 'Action'].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {capitalCalls.map((c: any) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="px-4 py-3">{c.project?.name}</td>
                          <td className="px-4 py-3 font-mono font-medium">{fmt(c.amount)}</td>
                          <td className="px-4 py-3">{fmtDate(c.dueDate)}</td>
                          <td className="px-4 py-3">{c.paidDate ? fmtDate(c.paidDate) : '—'}</td>
                          <td className="px-4 py-3">
                            <Chip size="sm" color={CALL_STATUS_COLORS[c.status] || 'default'} variant="flat">{c.status}</Chip>
                          </td>
                          <td className="px-4 py-3">
                            {c.status === 'PENDING' && (
                              <Button size="sm" color="success" variant="flat" onPress={() => handleMarkPaid(c.id)}>Mark Paid</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </CardBody>
            </Card>
          </div>
        </Tab>

        {/* Distributions */}
        <Tab key="distributions" title="Distributions">
          <div className="pt-4 space-y-4">
            <div className="flex justify-end">
              <Button size="sm" color="primary" startContent={<FiPlus />} onPress={() => { setDistFormErrors({}); onDistOpen(); }}>Record Distribution</Button>
            </div>

            {distChartData.length > 0 && (
              <Card shadow="sm">
                <CardHeader><span className="font-semibold text-sm">Distributions by Year</span></CardHeader>
                <CardBody>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={distChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: any) => fmt(v)} />
                      <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            )}

            <Card shadow="sm">
              <CardBody className="p-0">
                {distributions.length === 0 ? <div className="p-6"><EmptyState message="No distributions yet" /></div> : (
                  <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {['Project', 'Amount', 'Date', 'Type', 'Notes'].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {distributions.map((d: any) => (
                        <tr key={d.id} className="border-b last:border-0">
                          <td className="px-4 py-3">{d.project?.name}</td>
                          <td className="px-4 py-3 font-mono font-medium">{fmt(d.amount)}</td>
                          <td className="px-4 py-3">{fmtDate(d.distDate)}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{d.distType?.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{d.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </CardBody>
            </Card>
          </div>
        </Tab>
      </Tabs>

      {/* Add Position Modal */}
      <Modal isOpen={isPosOpen} onClose={onPosClose} scrollBehavior="inside" size="md">
        <ModalContent>
          <ModalHeader>Add Equity Position</ModalHeader>
          <ModalBody className="space-y-3">
            <Select label="Project" selectedKeys={posForm.projectId ? [posForm.projectId] : []} onSelectionChange={(k) => setPosForm((p) => ({ ...p, projectId: Array.from(k)[0] as string }))} isInvalid={!!posFormErrors.projectId} errorMessage={posFormErrors.projectId}>
              {(projects as any[]).map((pr: any) => <SelectItem key={pr.id}>{pr.name}</SelectItem>)}
            </Select>
            <Input label="Ownership %" type="number" min={0} max={100} value={posForm.pctOwnership} onChange={setPos('pctOwnership')} endContent="%" isInvalid={!!posFormErrors.pctOwnership} errorMessage={posFormErrors.pctOwnership} />
            <Input label="Committed Amount" type="number" min={0} value={posForm.committedAmt} onChange={setPos('committedAmt')} isInvalid={!!posFormErrors.committedAmt} errorMessage={posFormErrors.committedAmt} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onPosClose}>Cancel</Button>
            <Button color="primary" onPress={handleAddPosition} isLoading={addPosition.isPending}>Add</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* New Capital Call Modal */}
      <Modal isOpen={isCallOpen} onClose={onCallClose} scrollBehavior="inside" size="md">
        <ModalContent>
          <ModalHeader>New Capital Call</ModalHeader>
          <ModalBody className="space-y-3">
            <Select label="Project" selectedKeys={callForm.projectId ? [callForm.projectId] : []} onSelectionChange={(k) => setCallForm((p) => ({ ...p, projectId: Array.from(k)[0] as string }))} isInvalid={!!callFormErrors.projectId} errorMessage={callFormErrors.projectId}>
              {(projects as any[]).map((pr: any) => <SelectItem key={pr.id}>{pr.name}</SelectItem>)}
            </Select>
            <Input label="Amount" type="number" min={0} value={callForm.amount} onChange={setCall('amount')} isInvalid={!!callFormErrors.amount} errorMessage={callFormErrors.amount} />
            <Input label="Due Date" type="date" value={callForm.dueDate} onChange={setCall('dueDate')} isInvalid={!!callFormErrors.dueDate} errorMessage={callFormErrors.dueDate} />
            <Textarea label="Notes" value={callForm.notes} onChange={setCall('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onCallClose}>Cancel</Button>
            <Button color="primary" onPress={handleCreateCall} isLoading={createCall.isPending}>Create</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Record Distribution Modal */}
      <Modal isOpen={isDistOpen} onClose={onDistClose} scrollBehavior="inside" size="md">
        <ModalContent>
          <ModalHeader>Record Distribution</ModalHeader>
          <ModalBody className="space-y-3">
            <Select label="Project" selectedKeys={distForm.projectId ? [distForm.projectId] : []} onSelectionChange={(k) => setDistForm((p) => ({ ...p, projectId: Array.from(k)[0] as string }))} isInvalid={!!distFormErrors.projectId} errorMessage={distFormErrors.projectId}>
              {(projects as any[]).map((pr: any) => <SelectItem key={pr.id}>{pr.name}</SelectItem>)}
            </Select>
            <Input label="Amount" type="number" min={0} value={distForm.amount} onChange={setDist('amount')} isInvalid={!!distFormErrors.amount} errorMessage={distFormErrors.amount} />
            <Input label="Distribution Date" type="date" value={distForm.distDate} onChange={setDist('distDate')} isInvalid={!!distFormErrors.distDate} errorMessage={distFormErrors.distDate} />
            <Select label="Type" selectedKeys={[distForm.distType]} onSelectionChange={(k) => setDistForm((p) => ({ ...p, distType: Array.from(k)[0] as string }))}>
              {DIST_TYPES.map((t) => <SelectItem key={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
            </Select>
            <Textarea label="Notes" value={distForm.notes} onChange={setDist('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDistClose}>Cancel</Button>
            <Button color="primary" onPress={handleCreateDist} isLoading={createDist.isPending}>Record</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

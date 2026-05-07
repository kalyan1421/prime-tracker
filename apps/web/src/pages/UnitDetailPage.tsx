import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Card, CardBody, CardHeader, Chip, Button, Avatar, Textarea, Select, SelectItem, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast,
} from '@heroui/react';
import { FiArrowLeft, FiSend, FiTrash2, FiMessageSquare, FiEdit2 } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUnit, useUnitComments, useCreateComment, useDeleteComment, useUpdateUnit,
} from '../hooks/useApi';

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};
import { StatCard, StatusBadge, LoadingState, ErrorState, fmt, fmtDate } from '../components/ui';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { TimeOnMarketBar } from '../components/TimeOnMarketBar';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
};

const UNIT_TYPES = ['RETAIL', 'MEDICAL', 'FLEX', 'RESIDENTIAL_LOT', 'OFFICE', 'RESTAURANT', 'EVENT_CENTER'];
const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];

export default function UnitDetailPage() {
  const { id: projectId, unitId } = useParams<{ id: string; unitId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: unit, isLoading, error } = useUnit(unitId!);
  const updateUnit = useUpdateUnit();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>({});
  const [primeOwned, setPrimeOwned] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error || !unit) return <ErrorState />;

  const u = unit as any;
  const activeLease = u.leases?.find((l: any) => l.status === 'ACTIVE');
  const psf = u.askingPrice && u.sqft ? (Number(u.askingPrice) / u.sqft).toFixed(2) : null;

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const openEdit = () => {
    setForm({
      unitNumber: u.unitNumber ?? '',
      unitType: u.unitType ?? 'RETAIL',
      status: u.status ?? 'AVAILABLE',
      sqft: u.sqft != null ? String(u.sqft) : '',
      askingPrice: u.askingPrice != null ? String(u.askingPrice) : '',
      askingRent: u.askingRent != null ? String(u.askingRent) : '',
      notes: u.notes ?? '',
    });
    setPrimeOwned(u.primeOwned ?? false);
    onOpen();
  };

  const handleSave = async () => {
    try {
      await updateUnit.mutateAsync({
        id: unitId!,
        data: {
          unitNumber: form.unitNumber || undefined,
          unitType: form.unitType || undefined,
          status: form.status || undefined,
          sqft: form.sqft ? parseInt(form.sqft, 10) : null,
          askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : null,
          askingRent: form.askingRent ? parseFloat(form.askingRent) : null,
          primeOwned,
          notes: form.notes || null,
        },
      });
      await qc.invalidateQueries({ queryKey: ['unit', unitId] });
      addToast({ title: 'Unit updated', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update unit'), color: 'danger' });
    }
  };

  return (
    <div>
      <button
        className="flex items-center gap-1 text-blue-600 text-sm font-medium mb-4 cursor-pointer hover:underline"
        onClick={() => navigate(`/projects/${projectId}/units`)}
      >
        <FiArrowLeft />
        Back to Units
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Unit {u.unitNumber}</h1>
          <p className="text-sm text-gray-500 mt-1 break-words">
            {u.building?.name}
            {u.building?.project?.name && <> &middot; {u.building.project.name}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={u.unitType} />
          <StatusBadge status={u.status} />
          {/* Slice 4: time-on-market shown only for AVAILABLE units */}
          {u.status === 'AVAILABLE' && u.availableSince && (
            <TimeOnMarketBar availableSince={u.availableSince} />
          )}
          {u.primeOwned && <Chip size="sm" color="success" variant="flat">Prime Owned</Chip>}
          <Button size="sm" variant="flat" color="primary" startContent={<FiEdit2 />} onPress={openEdit}>
            Edit
          </Button>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="lg">
        <ModalContent>
          <ModalHeader>Edit Unit {u.unitNumber}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Unit Number"
                value={form.unitNumber ?? ''}
                onChange={set('unitNumber')}
                size="sm"
              />
              <Select
                label="Unit Type"
                size="sm"
                selectedKeys={form.unitType ? [form.unitType] : []}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as string;
                  if (v) setForm((f) => ({ ...f, unitType: v }));
                }}
              >
                {UNIT_TYPES.map((t) => <SelectItem key={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
              </Select>
              <Select
                label="Status"
                size="sm"
                selectedKeys={form.status ? [form.status] : []}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as string;
                  if (v) setForm((f) => ({ ...f, status: v }));
                }}
              >
                {UNIT_STATUSES.map((s) => <SelectItem key={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
              </Select>
              <Input
                label="Size (sqft)"
                type="number"
                value={form.sqft ?? ''}
                onChange={set('sqft')}
                size="sm"
              />
              <Input
                label="Asking Price ($)"
                type="number"
                value={form.askingPrice ?? ''}
                onChange={set('askingPrice')}
                size="sm"
              />
              <Input
                label="Asking Rent ($/mo)"
                type="number"
                value={form.askingRent ?? ''}
                onChange={set('askingRent')}
                size="sm"
              />
            </div>
            <div className="mt-4">
              <Textarea
                label="Notes"
                value={form.notes ?? ''}
                onChange={set('notes')}
                size="sm"
                minRows={2}
                maxRows={5}
              />
            </div>
            <div className="mt-3">
              <Switch isSelected={primeOwned} onValueChange={setPrimeOwned} size="sm">
                Prime Owned
              </Switch>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={updateUnit.isPending}>Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <StatCard label="Size" value={u.sqft ? `${u.sqft.toLocaleString()} sqft` : '\u2014'} />
        <StatCard label="Asking Price" value={u.askingPrice ? fmt(u.askingPrice) : '\u2014'} />
        <StatCard label="Price PSF" value={psf ? `$${psf}` : '\u2014'} />
        <StatCard label="Asking Rent" value={u.askingRent ? `${fmt(u.askingRent)}/mo` : '\u2014'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Active Lease */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Active Lease</p>
          </CardHeader>
          <CardBody className="pt-0">
            {activeLease ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Tenant</span>
                  <span className="font-medium">{activeLease.tenantName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Monthly Rent</span>
                  <span className="font-medium">{fmt(activeLease.monthlyRent)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Start</span>
                  <span>{fmtDate(activeLease.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">End</span>
                  <span>{fmtDate(activeLease.endDate)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No active lease</p>
            )}
          </CardBody>
        </Card>

        {/* Linked Loans */}
        <Card shadow="sm">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Linked Loans</p>
          </CardHeader>
          <CardBody className="pt-0">
            {u.loans?.length > 0 ? (
              <div className="space-y-3">
                {u.loans.map((loan: any) => (
                  <div key={loan.id} className="text-sm space-y-1 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Lender</span>
                      <span className="font-medium">{loan.lender || '\u2014'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type</span>
                      <span>{loan.loanType?.replace(/_/g, ' ') || '\u2014'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Monthly Payment</span>
                      <span>{loan.monthlyPayment ? fmt(loan.monthlyPayment) : '\u2014'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Principal</span>
                      <span>{loan.principalAmt ? fmt(loan.principalAmt) : '\u2014'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No linked loans</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Notes */}
      {u.notes && (
        <Card shadow="sm" className="mb-6">
          <CardHeader className="pb-2">
            <p className="font-semibold text-sm text-gray-600">Notes</p>
          </CardHeader>
          <CardBody className="pt-0">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{u.notes}</p>
          </CardBody>
        </Card>
      )}

      {/* Comments Section */}
      <Card shadow="sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <FiMessageSquare className="text-purple-600" />
            <p className="font-semibold text-sm text-gray-600">
              Comments {u._count?.comments > 0 && `(${u._count.comments})`}
            </p>
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          <InlineComments unitId={unitId!} />
        </CardBody>
      </Card>
    </div>
  );
}

function InlineComments({ unitId }: { unitId: string }) {
  const { data, isLoading } = useUnitComments(unitId);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment();
  const [text, setText] = useState('');
  const [commentType, setCommentType] = useState('MARKETING');

  const comments = ((data as any[]) || []).slice().sort((a: any, b: any) => {
    const ORDER = ['MARKETING', 'SALES', 'FINANCIAL'];
    const ai = ORDER.indexOf(a.commentType);
    const bi = ORDER.indexOf(b.commentType);
    if (ai !== bi) return ai - bi;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const handleSubmit = async () => {
    if (!text.trim()) return;
    try {
      await createComment.mutateAsync({ unitId, content: text.trim(), commentType });
      setText('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add comment'), color: 'danger' });
    }
  };

  return (
    <div>
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-gray-400 mb-3">No comments yet</p>
      ) : (
        <div className="space-y-3 mb-4">
          {comments.map((c: any) => (
            <div key={c.id} className="flex gap-2">
              <Avatar size="sm" name={c.user?.name} src={c.user?.avatarUrl} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{c.user?.name}</span>
                  <CommentChip type={c.commentType as CommentType} size="sm" />
                  <span className="text-xs text-gray-400">{fmtDate(c.createdAt)}</span>
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isIconOnly
                    className="ml-auto h-5 w-5 min-w-5"
                    onPress={() => deleteComment.mutate({ id: c.id, source: 'unit' })}
                  >
                    <FiTrash2 className="text-[10px]" />
                  </Button>
                </div>
                <p className="text-sm text-gray-700 break-words">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Select
          size="sm"
          className="w-full sm:w-[140px]"
          selectedKeys={[commentType]}
          onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setCommentType(v); }}
        >
          {['MARKETING', 'SALES', 'FINANCIAL'].map((t) => <SelectItem key={t}>{t}</SelectItem>)}
        </Select>
        <Textarea
          size="sm"
          minRows={1}
          maxRows={3}
          placeholder="Add a comment..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
        />
        <Button size="sm" color="primary" isIconOnly onPress={handleSubmit} isLoading={createComment.isPending} className="self-start sm:self-auto">
          <FiSend />
        </Button>
      </div>
    </div>
  );
}

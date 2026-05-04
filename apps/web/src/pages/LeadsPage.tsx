import { useState } from 'react';
import {
  Card, CardBody, Button, Input, Select, SelectItem, Chip, Avatar,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Textarea, useDisclosure, addToast,
} from '@heroui/react';
import {
  FiTarget, FiPlus, FiEdit2, FiTrash2, FiPhone, FiMail,
  FiMessageSquare, FiRefreshCw, FiSearch,
} from 'react-icons/fi';
import {
  useLeads, useLeadActivities, useProjects, useUnits,
  useCreateLead, useUpdateLead, useDeleteLead, useAddLeadActivity, useConvertLead,
} from '../hooks/useApi';
import { LoadingState, ErrorState, EmptyState, fmtDate } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const LEAD_SOURCES = ['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'WALK_IN', 'BROKER', 'EVENT', 'OTHER'];
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATING', 'CONVERTED', 'LOST', 'DEAD'];
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'FOLLOW_UP', 'NOTE', 'STATUS_CHANGE'];

const STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  NEW: 'default',
  CONTACTED: 'primary',
  QUALIFIED: 'secondary',
  PROPOSAL_SENT: 'warning',
  NEGOTIATING: 'warning',
  CONVERTED: 'success',
  LOST: 'danger',
  DEAD: 'danger',
};

const SOURCE_LABELS: Record<string, string> = {
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  SOCIAL_MEDIA: 'Social Media',
  WALK_IN: 'Walk-In',
  BROKER: 'Broker',
  EVENT: 'Event',
  OTHER: 'Other',
};

function ActivityTimeline({ leadId }: { leadId: string }) {
  const { data: activities, isLoading } = useLeadActivities(leadId);
  const addActivity = useAddLeadActivity();
  const [type, setType] = useState('NOTE');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!note.trim()) return;
    try {
      await addActivity.mutateAsync({ leadId, data: { type, note: note.trim() } });
      setNote('');
      setType('NOTE');
      setAdding(false);
    } catch {
      addToast({ title: 'Failed to add activity', color: 'danger' });
    }
  };

  const ACTIVITY_ICONS: Record<string, string> = {
    CALL: '📞',
    EMAIL: '📧',
    MEETING: '🤝',
    SITE_VISIT: '🏗️',
    FOLLOW_UP: '🔔',
    NOTE: '📝',
    STATUS_CHANGE: '🔄',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Activity Timeline</p>
        <Button size="sm" variant="flat" color="primary" onPress={() => setAdding((v) => !v)}>
          <FiPlus /> Log Activity
        </Button>
      </div>

      {adding && (
        <Card shadow="sm" className="border border-blue-100">
          <CardBody className="space-y-3">
            <Select
              size="sm"
              label="Activity Type"
              selectedKeys={new Set([type])}
              onSelectionChange={(keys) => setType(Array.from(keys)[0] as string)}
            >
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t}>{t.replace('_', ' ')}</SelectItem>
              ))}
            </Select>
            <Textarea
              size="sm"
              label="Notes"
              placeholder="Add a note..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minRows={2}
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="light" onPress={() => { setAdding(false); setNote(''); }}>Cancel</Button>
              <Button size="sm" color="primary" onPress={handleAdd} isLoading={addActivity.isPending} isDisabled={!note.trim()}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {isLoading && <p className="text-sm text-gray-400 text-center py-4">Loading...</p>}
      {!isLoading && (!activities || activities.length === 0) && (
        <p className="text-sm text-gray-400 text-center py-4">No activities yet</p>
      )}
      <div className="space-y-2">
        {(activities || []).map((act: any) => (
          <div key={act.id} className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm shrink-0">
              {ACTIVITY_ICONS[act.type] || '📝'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-gray-700">{act.type.replace('_', ' ')}</p>
                <span className="text-[10px] text-gray-400">{fmtDate(act.createdAt)}</span>
                {act.createdByUser && (
                  <span className="text-[10px] text-gray-400">· {act.createdByUser.name}</span>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{act.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConvertToSaleModal({ isOpen, onClose, lead }: { isOpen: boolean; onClose: () => void; lead: any }) {
  const { data: units } = useUnits(lead?.projectId || '');
  const convertLead = useConvertLead();
  const [form, setForm] = useState({ unitId: '', buyer: lead?.name || '', salePrice: lead?.budget ? String(Number(lead.budget)) : '', contractDate: '', closingDate: '' });
  const setF = (f: string, v: string) => setForm((prev) => ({ ...prev, [f]: v }));

  const availableUnits = ((units as any[]) || []).filter((u: any) => u.status !== 'SOLD');

  const handleConvert = async () => {
    if (!form.unitId || !form.buyer || !form.salePrice) {
      addToast({ title: 'Unit, buyer name, and sale price are required', color: 'warning' });
      return;
    }
    try {
      await convertLead.mutateAsync({
        id: lead.id,
        unitId: form.unitId,
        saleData: { buyer: form.buyer, salePrice: parseFloat(form.salePrice), contractDate: form.contractDate || undefined, closingDate: form.closingDate || undefined },
      });
      addToast({ title: 'Lead converted to sale!', color: 'success' });
      onClose();
    } catch {
      addToast({ title: 'Failed to convert lead', color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>Convert Lead to Sale</ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">This will create a new sale record and mark the lead as Converted.</p>
            <Select
              size="sm"
              label="Unit *"
              selectedKeys={form.unitId ? new Set([form.unitId]) : new Set()}
              onSelectionChange={(k) => setF('unitId', Array.from(k)[0] as string)}
            >
              {availableUnits.map((u: any) => (
                <SelectItem key={u.id}>{u.unitNumber} — {u.building?.name || ''} ({u.status})</SelectItem>
              ))}
            </Select>
            <Input size="sm" label="Buyer Name *" value={form.buyer} onChange={(e) => setF('buyer', e.target.value)} />
            <Input size="sm" label="Sale Price ($) *" type="number" value={form.salePrice} onChange={(e) => setF('salePrice', e.target.value)} />
            <Input size="sm" label="Contract Date" type="date" value={form.contractDate} onChange={(e) => setF('contractDate', e.target.value)} />
            <Input size="sm" label="Expected Close Date" type="date" value={form.closingDate} onChange={(e) => setF('closingDate', e.target.value)} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="success" onPress={handleConvert} isLoading={convertLead.isPending}>
            Convert to Sale
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function LeadDetailPanel({ lead }: { lead: any }) {
  const { isOpen: isConvertOpen, onOpen: onConvertOpen, onClose: onConvertClose } = useDisclosure();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800">{lead.name || 'Unnamed Lead'}</h3>
          <p className="text-xs text-gray-500">{lead.project?.name}</p>
        </div>
        <Chip size="sm" color={STATUS_COLORS[lead.status] || 'default'} variant="flat">
          {lead.status.replace('_', ' ')}
        </Chip>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        {lead.email && (
          <div className="flex items-center gap-1.5 text-gray-600">
            <FiMail className="shrink-0" />
            <span className="truncate text-xs">{lead.email}</span>
          </div>
        )}
        {lead.phone && (
          <div className="flex items-center gap-1.5 text-gray-600">
            <FiPhone className="shrink-0" />
            <span className="text-xs">{lead.phone}</span>
          </div>
        )}
        {lead.source && (
          <div className="text-xs text-gray-500">
            <span className="font-medium">Source:</span> {SOURCE_LABELS[lead.source] || lead.source}
          </div>
        )}
        {lead.budget && (
          <div className="text-xs text-gray-500">
            <span className="font-medium">Budget:</span> ${Number(lead.budget).toLocaleString()}
          </div>
        )}
        {lead.unitInterest && (
          <div className="text-xs text-gray-500 col-span-2">
            <span className="font-medium">Interest:</span> {lead.unitInterest}
          </div>
        )}
        {lead.assignedUser && (
          <div className="text-xs text-gray-500 col-span-2 flex items-center gap-1.5">
            <span className="font-medium">Assigned:</span>
            <Avatar size="sm" name={lead.assignedUser.name} src={lead.assignedUser.avatarUrl} className="w-4 h-4" />
            {lead.assignedUser.name}
          </div>
        )}
      </div>

      {lead.notes && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">{lead.notes}</div>
      )}

      {lead.status !== 'CONVERTED' && lead.status !== 'LOST' && lead.status !== 'DEAD' && (
        <div className="mb-4">
          <Button size="sm" color="success" variant="flat" onPress={onConvertOpen} className="w-full">
            Convert to Sale
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <ActivityTimeline leadId={lead.id} />
      </div>

      <ConvertToSaleModal isOpen={isConvertOpen} onClose={onConvertClose} lead={lead} />
    </div>
  );
}

function LeadFormModal({
  isOpen,
  onClose,
  lead,
  projectId: defaultProjectId,
}: {
  isOpen: boolean;
  onClose: () => void;
  lead?: any;
  projectId?: string;
}) {
  const { data: projects } = useProjects();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const isEdit = !!lead;

  const [form, setForm] = useState({
    projectId: lead?.projectId || defaultProjectId || '',
    name: lead?.name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    source: lead?.source || 'WEBSITE',
    status: lead?.status || 'NEW',
    unitInterest: lead?.unitInterest || '',
    budget: lead?.budget ? String(Number(lead.budget)) : '',
    notes: lead?.notes || '',
    assignedTo: lead?.assignedTo || '',
  });

  const set = (field: string, val: string) => setForm((f) => ({ ...f, [field]: val }));

  const handleSubmit = async () => {
    if (!form.projectId || !form.source) {
      addToast({ title: 'Project and Source are required', color: 'warning' });
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        projectId: form.projectId,
        source: form.source,
        status: form.status,
        name: form.name || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        unitInterest: form.unitInterest || undefined,
        budget: form.budget ? parseFloat(form.budget) : undefined,
        notes: form.notes || undefined,
        assignedTo: form.assignedTo || undefined,
      };
      if (isEdit) {
        await updateLead.mutateAsync({ id: lead.id, data: payload });
        addToast({ title: 'Lead updated', color: 'success' });
      } else {
        await createLead.mutateAsync(payload);
        addToast({ title: 'Lead created', color: 'success' });
      }
      onClose();
    } catch {
      addToast({ title: `Failed to ${isEdit ? 'update' : 'create'} lead`, color: 'danger' });
    }
  };

  const isPending = createLead.isPending || updateLead.isPending;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>{isEdit ? 'Edit Lead' : 'New Lead'}</ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-2 gap-3">
            {!defaultProjectId && (
              <div className="col-span-2">
                <Select
                  size="sm"
                  label="Project *"
                  selectedKeys={form.projectId ? new Set([form.projectId]) : new Set()}
                  onSelectionChange={(keys) => set('projectId', Array.from(keys)[0] as string)}
                >
                  {(projects || []).map((p: any) => (
                    <SelectItem key={p.id}>{p.name}</SelectItem>
                  ))}
                </Select>
              </div>
            )}
            <Input size="sm" label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input size="sm" label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input size="sm" label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input size="sm" label="Budget ($)" type="number" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
            <Select
              size="sm"
              label="Source *"
              selectedKeys={new Set([form.source])}
              onSelectionChange={(keys) => set('source', Array.from(keys)[0] as string)}
            >
              {LEAD_SOURCES.map((s) => (
                <SelectItem key={s}>{SOURCE_LABELS[s] || s}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              label="Status"
              selectedKeys={new Set([form.status])}
              onSelectionChange={(keys) => set('status', Array.from(keys)[0] as string)}
            >
              {LEAD_STATUSES.map((s) => (
                <SelectItem key={s}>{s.replace('_', ' ')}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm"
              label="Unit Interest"
              placeholder="e.g. 2BR, Unit 4A"
              value={form.unitInterest}
              onChange={(e) => set('unitInterest', e.target.value)}
              className="col-span-2"
            />
            <Textarea
              size="sm"
              label="Notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              minRows={2}
              className="col-span-2"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={handleSubmit} isLoading={isPending}>
            {isEdit ? 'Save Changes' : 'Create Lead'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default function LeadsPage() {
  const { hasPermission } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const [editLead, setEditLead] = useState<any>(null);

  const { data: leads, isLoading, error } = useLeads({
    status: statusFilter || undefined,
    search: search || undefined,
  } as any);
  const deleteLead = useDeleteLead();

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this lead?')) return;
    try {
      await deleteLead.mutateAsync(id);
      if (selectedLead?.id === id) setSelectedLead(null);
      addToast({ title: 'Lead deleted', color: 'success' });
    } catch {
      addToast({ title: 'Failed to delete lead', color: 'danger' });
    }
  };

  const openEdit = (lead: any) => {
    setEditLead(lead);
    onFormOpen();
  };

  const openNew = () => {
    setEditLead(null);
    onFormOpen();
  };

  const handleFormClose = () => {
    setEditLead(null);
    onFormClose();
  };

  const leadsArr = (leads as any[]) || [];

  return (
    <div className="flex gap-6 h-full">
      {/* Lead list */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FiTarget className="text-xl text-blue-600" />
            <h1 className="text-xl font-bold text-gray-800">Leads</h1>
            {leadsArr.length > 0 && (
              <Chip size="sm" variant="flat">{leadsArr.length}</Chip>
            )}
          </div>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNew}>
            New Lead
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <Input
            size="sm"
            placeholder="Search name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            startContent={<FiSearch className="text-gray-400" />}
            className="max-w-xs"
            isClearable
            onClear={() => setSearch('')}
          />
          <Select
            size="sm"
            placeholder="All statuses"
            className="max-w-[160px]"
            selectedKeys={statusFilter ? new Set([statusFilter]) : new Set()}
            onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0] as string || '')}
          >
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s}>{s.replace('_', ' ')}</SelectItem>
            ))}
          </Select>
          {statusFilter && (
            <Button size="sm" variant="light" onPress={() => setStatusFilter('')}>
              <FiRefreshCw /> Clear
            </Button>
          )}
        </div>

        {isLoading && <LoadingState />}
        {error && <ErrorState message="Failed to load leads" />}
        {!isLoading && leadsArr.length === 0 && (
          <EmptyState
            title="No leads yet"
            message="Start adding marketing leads to track your pipeline"
            action={<Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNew}>New Lead</Button>}
          />
        )}

        <div className="space-y-2">
          {leadsArr.map((lead: any) => (
            <Card
              key={lead.id}
              shadow="sm"
              isPressable
              onPress={() => setSelectedLead(lead)}
              className={`cursor-pointer transition-all ${selectedLead?.id === lead.id ? 'ring-2 ring-blue-500' : ''}`}
            >
              <CardBody className="py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-800">
                        {lead.name || <span className="text-gray-400 italic">Unnamed</span>}
                      </p>
                      <Chip size="sm" color={STATUS_COLORS[lead.status] || 'default'} variant="flat" className="text-[10px]">
                        {lead.status.replace('_', ' ')}
                      </Chip>
                      <Chip size="sm" variant="bordered" className="text-[10px]">
                        {SOURCE_LABELS[lead.source] || lead.source}
                      </Chip>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {lead.email && <span className="flex items-center gap-1"><FiMail />{lead.email}</span>}
                      {lead.phone && <span className="flex items-center gap-1"><FiPhone />{lead.phone}</span>}
                      {lead.project?.name && <span className="text-blue-600">{lead.project.name}</span>}
                      {lead.budget && <span>${Number(lead.budget).toLocaleString()}</span>}
                      {lead._count?.activities > 0 && (
                        <span className="flex items-center gap-1">
                          <FiMessageSquare />{lead._count.activities} activities
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {lead.assignedUser && (
                      <Avatar size="sm" name={lead.assignedUser.name} src={lead.assignedUser.avatarUrl} className="w-6 h-6" />
                    )}
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      onPress={(e) => { (e as any).stopPropagation?.(); openEdit(lead); }}
                    >
                      <FiEdit2 />
                    </Button>
                    {hasPermission('unit:manage') && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={(e) => { (e as any).stopPropagation?.(); handleDelete(lead.id); }}
                      >
                        <FiTrash2 />
                      </Button>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selectedLead && (
        <div className="w-[380px] shrink-0">
          <Card shadow="sm" className="h-full">
            <CardBody className="overflow-auto">
              <LeadDetailPanel lead={selectedLead} />
            </CardBody>
          </Card>
        </div>
      )}

      <LeadFormModal
        isOpen={isFormOpen}
        onClose={handleFormClose}
        lead={editLead}
      />
    </div>
  );
}

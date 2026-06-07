import { useParams, useNavigate, Link } from 'react-router-dom';
import React, { useState, useMemo } from 'react';
import {
  Card, CardBody, CardHeader, Button, Tabs, Tab, Progress, Chip, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Input, Select, SelectItem, Textarea, Avatar, Skeleton,
  useDisclosure, addToast,
} from '@heroui/react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { FiArrowLeft, FiMapPin, FiCalendar, FiPlus, FiEdit2, FiTrash2, FiMessageSquare, FiSend, FiTarget, FiPhone, FiMail, FiUpload, FiDownload, FiFile, FiImage, FiFileText, FiCheck, FiX, FiChevronDown, FiChevronUp, FiChevronRight, FiChevronLeft, FiDollarSign, FiSearch, FiUsers, FiAlertTriangle, FiLock } from 'react-icons/fi';
import { SalePaymentPanel } from '../components/SalePaymentPanel';
import { DailyLogFeed } from '../components/DailyLogFeed';
import { CombineUnitsModal } from '../components/CombineUnitsModal';
import { CashflowForecastView } from '../components/CashflowForecastView';
import { ObligationsPanel } from '../components/ObligationsPanel';
import { CancelSaleModal } from '../components/CancelSaleModal';
import { TenantProfilePanel } from '../components/TenantProfilePanel';
import { DocumentGateChip, SALE_STAGE_DOCS } from '../components/DocumentGateChip';
import {
  useProject, useFinancialSummary, useMilestones, useUnits, useLeases, useActuals,
  useRentRoll, useSalesPipeline, useLoans, useCommitments, useBuildings,
  useBudgetLines,
  useUpdateProject,
  useCreateUnit, useUpdateUnit, useUpdateUnitStatus, useDeleteUnit,
  useCreateMilestone, useUpdateMilestone, useDeleteMilestone,
  useCreateLease, useUpdateLease, useDeleteLease,
  useCreateSale, useUpdateSale, useDeleteSale, useApproveSaleDiscount, useBrokers,
  useCreateCommitment, useUpdateCommitment, useDeleteCommitment,
  useCreateBudget, useUpdateBudget, useDeleteBudget, useProjectBudgetRevisions,
  useUnitComments, useProjectComments, useCreateComment, useDeleteComment,
  useCreateBuilding, useUpdateBuilding, useDeleteBuilding,
  useMonthlyLeaseIncome, useMonthlyPayments,
  useLeads, useCreateLead, useUpdateLead, useDeleteLead, useAddLeadActivity, useLeadActivities, useConvertLead,
  useProjectDraws, useCreateDraw, useUpdateDrawStatus, useDeleteDraw,
  useVendors, useCreateVendor, useContracts, useContractSummary, useCreateContract, useUpdateContract, useDeleteContract,
  useAddChangeOrder, useApproveChangeOrder, useAddContractPayment,
  useDocuments, useUploadDocument, useDeleteDocument,
  useUsers, useProjectMembers, useAddProjectMember, useRemoveProjectMember,
  useProjectHealth, useSalesForecast, useExceptions,
  useSetMilestoneDependency, useMilestonePhotos, useAttachMilestonePhoto, useDeleteMilestonePhoto,
  usePresignedUpload, useProjectDrawSchedules,
} from '../hooks/useApi';
import { TasksPageInner } from './TasksPage';
import { HealthScoreRing } from '../components/HealthScoreRing';
import { ProjectHealthHeader } from '../components/ProjectHealthHeader';
import { VarianceBar } from '../components/VarianceBar';
import { ProbabilityChip } from '../components/ProbabilityChip';
import { PhaseChip } from '../components/PhaseChip';
import { DrawDetailModal } from '../components/DrawDetailModal';
import { BudgetRevisionHistory } from '../components/BudgetRevisionHistory';
import { CommentChip, type CommentType } from '../components/CommentChip';
import { ExceptionFeed } from '../components/ExceptionFeed';
import { apiAssetUrl } from '../lib/api';

/** Project-scoped exception feed used at the top of the Overview tab. */
function ProjectExceptions({ projectId }: { projectId: string }) {
  const { data: items = [] } = useExceptions(projectId);
  const navigate = useNavigate();
  if (items.length === 0) return null; // hide if nothing to show — saves vertical space
  return (
    <ExceptionFeed
      items={items.map((i) => ({ ...i, severity: i.severity as 'critical' | 'warning' | 'info' }))}
      onItemClick={(item) => item.href && navigate(item.href)}
    />
  );
}

/**
 * Slice 1: Building cover photo uploader.
 * Same presigned-upload pattern as milestone photos — but only one photo per
 * building, stored as `coverPhotoPath` on the Building row itself (no separate
 * table). Pass the current path in; receives the new path via onChange.
 */
function BuildingCoverPhotoUploader({
  storagePath,
  onChange,
}: {
  storagePath: string;
  onChange: (path: string) => void;
}) {
  const presigned = usePresignedUpload();
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://dxkqrwxixjyzxhtxdkht.supabase.co';

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { storagePath: path } = await presigned.mutateAsync({ file, category: 'buildings' });
      onChange(path);
      addToast({ title: `Uploaded ${file.name}`, color: 'success' });
    } catch (err: any) {
      addToast({ title: err?.message || 'Upload failed', color: 'danger' });
    }
  };

  return (
    <div>
      <p className="text-xs font-medium text-gray-700 mb-1.5">Cover photo</p>
      <div className="flex items-center gap-3">
        {storagePath ? (
          <div className="relative w-32 h-20 rounded border border-gray-200 overflow-hidden bg-gray-100">
            <img
              src={`${supabaseUrl}/storage/v1/object/public/documents/${storagePath}`}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
            />
          </div>
        ) : (
          <div className="w-32 h-20 rounded border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">
            No photo
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm" variant="flat"
            onPress={() => fileRef.current?.click()}
            isLoading={presigned.isPending}
            startContent={<FiPlus className="text-xs" />}
          >
            {storagePath ? 'Replace' : 'Upload'}
          </Button>
          {storagePath && (
            <Button size="sm" variant="light" color="danger" onPress={() => onChange('')}>
              Remove
            </Button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

/**
 * Slice 7: Milestone photo strip.
 * Inline thumbnails with a "+ Upload" button. Uses presigned URLs so the file
 * lands directly in Supabase — the API only stores the metadata row.
 */
function MilestonePhotoStrip({ milestoneId }: { milestoneId: string }) {
  const { data: photos = [] } = useMilestonePhotos(milestoneId);
  const attach = useAttachMilestonePhoto();
  const remove = useDeleteMilestonePhoto();
  const presigned = usePresignedUpload();
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { storagePath } = await presigned.mutateAsync({ file, category: 'milestones' });
      await attach.mutateAsync({ milestoneId, storagePath });
      addToast({ title: `Uploaded ${file.name}`, color: 'success' });
    } catch (err: any) {
      addToast({ title: err?.message || 'Upload failed', color: 'danger' });
    }
  };

  const list = photos as Array<{ id: string; storagePath: string; uploadedBy?: { name: string } }>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Photos</p>
        <Button
          size="sm" variant="flat"
          onPress={() => fileRef.current?.click()}
          isLoading={presigned.isPending || attach.isPending}
          startContent={<FiPlus className="text-xs" />}
        >
          Upload
        </Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400">No photos yet — useful for inspector / lender packages.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {list.map((p) => (
            <div key={p.id} className="relative group rounded border border-gray-200 overflow-hidden w-24 h-24 bg-gray-100">
              <img
                src={`${import.meta.env.VITE_SUPABASE_URL || ''}/storage/v1/object/public/documents/${p.storagePath}`}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
              />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => remove.mutate(p.id)}
                className="absolute top-0.5 right-0.5 bg-white/80 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <FiTrash2 className="text-xs text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
import {
  StatCard, StatusBadge, PhaseProgress, LoadingState, ErrorState, EmptyState,
  PermissionGate, fmt, fmtPct, fmtDate,
} from '../components/ui';
import { useAuthStore } from '../store/authStore';

const TAB_MAP = ['overview', 'construction', 'budget', 'revenue', 'units', 'milestones', 'leads', 'draws', 'vendors', 'documents', 'tasks', 'comments'];

const TAB_TITLE_MAP: Record<string, string> = {
  overview: 'Overview',
  construction: 'Construction',
  budget: 'Budget',
  revenue: 'Revenue',
  units: 'Units',
  milestones: 'Milestones',
  leads: 'Leads',
  draws: 'Draws',
  vendors: 'Vendors',
  documents: 'Documents',
  tasks: 'Tasks',
  comments: 'Comments',
};

const ALL_ROLES = [
  'SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP',
  'PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING', 'LEGAL', 'VIEWER',
];

const TAB_ROLES: Record<string, string[]> = {
  overview: ALL_ROLES,
  construction: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'PROJECT_MANAGER', 'CONSTRUCTION'],
  budget: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'PROJECT_MANAGER'],
  revenue: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'SALES'],
  units: ALL_ROLES,
  milestones: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'PROJECT_MANAGER', 'CONSTRUCTION', 'VIEWER'],
  leads: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'SALES', 'MARKETING'],
  draws: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'PROJECT_MANAGER'],
  vendors: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'PROJECT_MANAGER', 'CONSTRUCTION', 'LEGAL'],
  documents: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING', 'LEGAL'],
  tasks: ALL_ROLES,
  comments: ALL_ROLES,
};

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? fallback;
  if (typeof msg === 'string') return msg;
  return fallback;
};

export default function ProjectDetailPage() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const role = user?.role || '';
  const { data: project, isLoading, error } = useProject(id!);
  const { data: health } = useProjectHealth(id ?? '');

  if (isLoading) return <LoadingState />;
  if (error || !project) return <ErrorState />;

  const p = project as any;
  const healthBreakdown = health?.breakdown
    ? Object.entries(health.breakdown).map(([k, v]) => ({
      label: k.charAt(0).toUpperCase() + k.slice(1),
      value: `${v.score} · ${v.reason}`,
    }))
    : undefined;

  const visibleTabs = TAB_MAP.filter((t) => (TAB_ROLES[t] ?? ALL_ROLES).includes(role));
  const requestedTab = tab || 'overview';
  const activeTab = visibleTabs.includes(requestedTab) ? requestedTab : (visibleTabs[0] || 'overview');

  return (
    <div>
      <button
        className="flex items-center gap-1 text-blue-600 text-sm font-medium mb-4 cursor-pointer hover:underline"
        onClick={() => navigate('/projects')}
      >
        <FiArrowLeft />
        All Projects
      </button>

      {/* Unified project header — identity (left zone) + financial/occupancy summary
          (right zone) live in ONE card, split by a hairline. Stacks on mobile. */}
      <Card shadow="none" className="border border-gray-200/80 rounded-xl overflow-hidden mb-4 sm:mb-6">
        <CardBody className="p-0">
          <div className="flex flex-col lg:flex-row">
            {/* Left zone — project identity */}
            <div className="lg:flex-1 min-w-0 p-5">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {/* Slice 2: project health ring next to title */}
                  {health && (
                    <div className="shrink-0 mt-1">
                      <HealthScoreRing score={health.score} size="lg" breakdown={healthBreakdown} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold break-words">{p.name}</h1>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                      {p.location?.trim() && (
                        <div className="flex items-center gap-1 min-w-0">
                          <FiMapPin className="text-gray-400 text-xs shrink-0" />
                          <span className="text-sm text-gray-500 truncate">{p.location}</span>
                        </div>
                      )}
                      {p.acreage && <span className="text-sm text-gray-500">{p.acreage} acres</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={p.status} />
                  <StatusBadge status={p.phase} />
                </div>
              </div>

              <div className="mt-4 max-w-full sm:max-w-[400px]">
                <PhaseProgress current={p.phase} />
              </div>
            </div>

            {/* Right zone — budget / units / leases / loans + inline phase update.
                Hairline divider: horizontal on mobile, vertical on desktop. */}
            <div className="w-full lg:w-[440px] lg:shrink-0 border-t lg:border-t-0 lg:border-l border-gray-100">
              <ProjectHealthHeader project={p} />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Scrollable tab bar — extends to screen edges on mobile */}
      <div className="relative -mx-4 sm:mx-0 mb-4">
        <div className="flex overflow-x-auto scrollbar-none border-b border-gray-200 px-4 sm:px-0">
          {visibleTabs.map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => navigate(`/projects/${id}/${tabKey}`, { replace: true })}
              className={`shrink-0 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tabKey
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {TAB_TITLE_MAP[tabKey]}
            </button>
          ))}
        </div>
        {/* Fade hint that more tabs exist to the right */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab project={p} />}
        {activeTab === 'construction' && <ConstructionTab projectId={id!} />}
        {activeTab === 'budget' && <BudgetTab projectId={id!} />}
        {activeTab === 'revenue' && <RevenueTab projectId={id!} />}
        {activeTab === 'units' && <UnitsTab projectId={id!} role={role} />}
        {activeTab === 'milestones' && <MilestonesTab projectId={id!} />}
        {activeTab === 'leads' && <ProjectLeadsTab projectId={id!} />}
        {activeTab === 'draws' && <DrawsTab projectId={id!} />}
        {activeTab === 'vendors' && <VendorsTab projectId={id!} role={role} />}
        {activeTab === 'documents' && <DocumentsTab projectId={id!} />}
        {activeTab === 'tasks' && <TasksPageInner projectId={id!} />}
        {activeTab === 'comments' && <ProjectCommentsTab projectId={id!} />}
      </div>
    </div>
  );
}

// ---- Overview Tab ----
const PROJECT_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL'];
const EMPTY_PROJECT = {
  name: '', description: '', location: '', address: '', acreage: '',
  status: 'ACTIVE', phase: 'PRE_DEVELOPMENT', projectType: '', startDate: '', targetEnd: '',
};

const MEMBER_ROLES = ['PROJECT_MANAGER', 'CONSTRUCTION', 'FINANCE', 'SALES', 'LEGAL', 'VIEWER', 'TEAM_MEMBER'];

function TeamMembersCard({ projectId }: { projectId: string }) {
  const { user: currentUser } = useAuthStore();
  const canEdit = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'].includes(currentUser?.role ?? '');

  const { data: members = [] } = useProjectMembers(projectId);
  const { data: allUsers = [] } = useUsers();
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberRole, setMemberRole] = useState('TEAM_MEMBER');

  const memberIds = new Set((members as any[]).map((m: any) => m.userId));
  const availableUsers = (allUsers as any[]).filter((u: any) => !memberIds.has(u.id) && u.id !== currentUser?.id);

  const handleAdd = async () => {
    if (!selectedUserId) return;
    try {
      await addMember.mutateAsync({ projectId, data: { userId: selectedUserId, role: memberRole } });
      addToast({ title: 'Team member added', color: 'success' });
      setSelectedUserId('');
      setMemberRole('TEAM_MEMBER');
      onClose();
    } catch {
      addToast({ title: 'Failed to add member', color: 'danger' });
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeMember.mutateAsync({ projectId, userId });
      addToast({ title: 'Member removed', color: 'success' });
    } catch {
      addToast({ title: 'Failed to remove member', color: 'danger' });
    }
  };

  return (
    <Card shadow="sm">
      <CardHeader className="pb-0 flex justify-between items-center">
        <p className="font-semibold text-sm text-gray-700">
          Team Members
          <span className="ml-2 text-xs font-normal text-gray-400">{(members as any[]).length}</span>
        </p>
        {canEdit && (
          <Button size="sm" variant="light" color="primary" startContent={<FiPlus className="text-xs" />} onPress={onOpen}>
            Add Member
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {(members as any[]).length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No team members assigned yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(members as any[]).map((m: any) => (
              <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    size="sm"
                    name={m.user?.name}
                    src={m.user?.avatarUrl}
                    className="shrink-0"
                  />
                  <div>
                    <p className="text-xs font-medium text-gray-800">{m.user?.name}</p>
                    <p className="text-[11px] text-gray-400">{m.user?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="flat" color="default" className="text-[10px]">
                    {(m.role || 'TEAM_MEMBER').replace(/_/g, ' ')}
                  </Chip>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      isIconOnly
                      onPress={() => handleRemove(m.userId)}
                      aria-label="Remove member"
                    >
                      <FiX className="text-xs" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>

      <Modal isOpen={isOpen} onClose={onClose} size="sm">
        <ModalContent>
          <ModalHeader className="border-b border-gray-100 text-sm">Add Team Member</ModalHeader>
          <ModalBody className="py-5">
            <Select
              size="sm"
              label="User"
              placeholder="Select a user"
              selectedKeys={selectedUserId ? [selectedUserId] : []}
              onSelectionChange={(keys) => setSelectedUserId((Array.from(keys)[0] as string) || '')}
            >
              {availableUsers.map((u: any) => (
                <SelectItem key={u.id} description={u.role?.replace(/_/g, ' ')}>
                  {u.name}
                </SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              label="Role on Project"
              className="mt-3"
              selectedKeys={[memberRole]}
              onSelectionChange={(keys) => setMemberRole((Array.from(keys)[0] as string) || 'TEAM_MEMBER')}
            >
              {MEMBER_ROLES.map((r) => (
                <SelectItem key={r}>{r.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter className="border-t border-gray-100">
            <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleAdd}
              isDisabled={!selectedUserId}
              isLoading={addMember.isPending}
            >
              Add to Project
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}

const PHASE_STEPS = [
  { key: 'PRE_DEVELOPMENT', label: 'Pre-Dev' },
  { key: 'PERMITTING', label: 'Permitting' },
  { key: 'CONSTRUCTION', label: 'Construction' },
  { key: 'LEASE_UP', label: 'Lease-Up' },
  { key: 'STABILIZED', label: 'Stabilized' },
  { key: 'SOLD_REFI', label: 'Sold / Refi' },
];

function PhaseTimeline({ current }: { current: string }) {
  const currentIdx = PHASE_STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-start gap-0 w-full">
      {PHASE_STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const upcoming = i > currentIdx;
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center relative">
            {/* Connector line left */}
            {i > 0 && (
              <div
                className={`absolute left-0 top-[13px] w-1/2 h-0.5 ${done || active ? 'bg-blue-500' : 'bg-gray-200'}`}
              />
            )}
            {/* Connector line right */}
            {i < PHASE_STEPS.length - 1 && (
              <div
                className={`absolute right-0 top-[13px] w-1/2 h-0.5 ${done ? 'bg-blue-500' : 'bg-gray-200'}`}
              />
            )}
            {/* Circle */}
            <div
              className={`relative z-10 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold border-2 transition-all ${done
                  ? 'bg-blue-500 border-blue-500 text-white'
                  : active
                    ? 'bg-white border-blue-500 text-blue-600 shadow-[0_0_0_3px_rgba(0,115,230,0.15)]'
                    : 'bg-white border-gray-300 text-gray-400'
                }`}
            >
              {done ? (
                <FiCheck className="text-[10px]" />
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            {/* Label */}
            <p
              className={`mt-1.5 text-[10px] text-center leading-tight ${active ? 'text-blue-600 font-semibold' : done ? 'text-gray-500' : 'text-gray-400'
                }`}
            >
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function OverviewTab({ project: p }: { project: any }) {
  const updateProject = useUpdateProject();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>(EMPTY_PROJECT);

  const openEdit = () => {
    setForm({
      name: p.name || '',
      description: p.description || '',
      location: p.location || '',
      address: p.address || '',
      acreage: p.acreage?.toString() || '',
      status: p.status || 'ACTIVE',
      phase: p.phase || 'PRE_DEVELOPMENT',
      projectType: p.projectType || '',
      startDate: p.startDate ? p.startDate.slice(0, 10) : '',
      targetEnd: p.targetEnd ? p.targetEnd.slice(0, 10) : '',
    });
    onOpen();
  };

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        location: form.location,
        address: form.address || undefined,
        acreage: form.acreage ? parseFloat(form.acreage) : undefined,
        status: form.status,
        phase: form.phase,
        projectType: form.projectType || undefined,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
        targetEnd: form.targetEnd ? new Date(form.targetEnd).toISOString() : undefined,
      };
      await updateProject.mutateAsync({ id: p.id, data: payload });
      addToast({ title: 'Project updated', color: 'success' });
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update project'), color: 'danger' });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // Financial calculations \u2014 always compute, show $0 when no data
  const totalBudget = (p.budgetLines || []).reduce(
    (s: number, b: any) => s + Number(b.revisedAmt ?? b.baselineAmt ?? 0), 0,
  );
  const totalActuals = (p.actuals || []).reduce((s: number, a: any) => s + Number(a.amount ?? 0), 0);
  const budgetRemaining = totalBudget - totalActuals;
  const pctSpent = totalBudget > 0 ? (totalActuals / totalBudget) * 100 : 0;

  const unitCount = (p.buildings || []).reduce(
    (s: number, b: any) => s + (b.units?.length ?? b._count?.units ?? 0), 0,
  );

  return (
    <div className="space-y-5 mt-4">
      {/* Row 1: Details + Financial Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Project Details */}
        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Project Details</p>
            <Button size="sm" variant="light" onPress={openEdit} startContent={<FiEdit2 className="text-[11px]" />}>
              Edit
            </Button>
          </CardHeader>
          <CardBody>
            {p.description && (
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">{p.description}</p>
            )}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {([
                ['Type', p.projectType ? p.projectType.replace(/_/g, ' ') : '\u2014'],
                ['Acreage', p.acreage ? `${p.acreage} ac` : '\u2014'],
                ['Start Date', fmtDate(p.startDate)],
                ['Target Completion', fmtDate(p.targetEnd)],
                ['Last Updated', fmtDate(p.updatedAt)],
                ['Buildings', p.buildings?.length ?? 0],
                ['Total Units', unitCount],
              ] as [string, string | number][]).map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Financial Snapshot \u2014 always visible */}
        <Card shadow="sm">
          <CardHeader className="pb-0">
            <p className="font-semibold text-sm text-gray-700">Financial Snapshot</p>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Total Budget</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(totalBudget)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Total Spent</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(totalActuals)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">% Spent</p>
                <p className={`text-lg font-semibold mt-0.5 ${pctSpent >= 100 ? 'text-red-600' : pctSpent >= 80 ? 'text-amber-600' : 'text-gray-900'}`}>
                  {pctSpent > 0 ? `${pctSpent.toFixed(1)}%` : '\u2014'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Remaining</p>
                <p className={`text-lg font-semibold mt-0.5 ${budgetRemaining >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totalBudget > 0 ? fmt(budgetRemaining) : '\u2014'}
                </p>
              </div>
            </div>
            {totalBudget > 0 && (
              <div className="mt-4">
                <Progress
                  value={Math.min(pctSpent, 100)}
                  color={pctSpent >= 100 ? 'danger' : pctSpent >= 80 ? 'warning' : 'success'}
                  size="sm"
                  aria-label="Budget utilization"
                />
              </div>
            )}
            {(p.loans || []).length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium mb-2">Loans</p>
                {p.loans.map((l: any) => (
                  <div key={l.id} className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-gray-600">{l.loanType?.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-semibold tabular-nums">{fmt(l.principalAmt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Row 2: Phase Timeline */}
      <Card shadow="sm">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-700">Project Phase</p>
        </CardHeader>
        <CardBody className="pt-4 pb-5">
          <PhaseTimeline current={p.phase || 'PRE_DEVELOPMENT'} />
        </CardBody>
      </Card>

      {/* Row 3: Team Members */}
      <TeamMembersCard projectId={p.id} />

      {/* Slice 9: project-scoped exception feed at bottom of Overview */}
      <ProjectExceptions projectId={p.id} />

      {/* Edit Project Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="border-b border-gray-100">Edit Project</ModalHeader>
          <ModalBody className="py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input size="sm" label="Name" isRequired value={form.name} onChange={set('name')} />
              <Input size="sm" label="Location" value={form.location} onChange={set('location')} />
              <div className="sm:col-span-2">
                <Textarea size="sm" label="Description" value={form.description} onChange={set('description')} minRows={2} />
              </div>
              <Input size="sm" label="Address" value={form.address} onChange={set('address')} />
              <Input size="sm" label="Acreage" type="number" value={form.acreage} onChange={set('acreage')} />
              <Select
                size="sm"
                label="Project Type"
                selectedKeys={form.projectType ? [form.projectType] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setForm((f) => ({ ...f, projectType: val || '' }));
                }}
              >
                {PROJECT_TYPES.map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Status"
                selectedKeys={form.status ? [form.status] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, status: val }));
                }}
              >
                {['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Phase"
                selectedKeys={form.phase ? [form.phase] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, phase: val }));
                }}
              >
                {['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Start Date" type="date" value={form.startDate} onChange={set('startDate')} />
              <Input size="sm" label="Target Completion" type="date" value={form.targetEnd} onChange={set('targetEnd')} />
            </div>
          </ModalBody>
          <ModalFooter className="border-t border-gray-100">
            <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSave} isLoading={updateProject.isPending}>
              Save Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Financials Tab ----
const BUDGET_CATEGORIES = [
  'LAND_ACQUISITION', 'SITE_WORK', 'HARD_COSTS', 'SOFT_COSTS', 'FINANCING',
  'PERMITS_FEES', 'CONTINGENCY', 'MARKETING', 'LEGAL', 'OTHER',
];

const EMPTY_BUDGET = {
  category: 'HARD_COSTS', description: '', baselineAmt: '', revisedAmt: '', notes: '',
};

const EMPTY_COMMITMENT = {
  vendor: '', description: '', category: 'HARD_COSTS', contractAmt: '',
  paidToDate: '', retainage: '', contractDate: '', notes: '',
};

function FinancialsTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canEditBudget = hasPermission('budget:edit');

  const { data, isLoading, error } = useFinancialSummary(projectId);
  const { data: commitments } = useCommitments(projectId);
  const { data: monthlyPaymentsData } = useMonthlyPayments(projectId);
  const { data: loans } = useLoans(projectId);
  const { data: budgetData } = useBudgetLines(projectId);
  const { data: actualsData } = useActuals(projectId);

  // Slice 5: per-line variance — sum actuals + commitments by category, then
  // divide proportionally across lines in that category by their share of budget.
  const varianceByLine = useMemo(() => {
    const categoryActuals: Record<string, number> = {};
    const categoryCommits: Record<string, number> = {};
    const categoryBudgetSum: Record<string, number> = {};
    for (const a of (actualsData as any[]) || []) {
      categoryActuals[a.category] = (categoryActuals[a.category] ?? 0) + Number(a.amount ?? 0);
    }
    for (const c of (commitments as any[]) || []) {
      categoryCommits[c.category] = (categoryCommits[c.category] ?? 0) + Number(c.contractAmt ?? 0);
    }
    for (const b of (budgetData as any[]) || []) {
      categoryBudgetSum[b.category] = (categoryBudgetSum[b.category] ?? 0) + Number(b.revisedAmt ?? b.baselineAmt ?? 0);
    }
    const out: Record<string, { actuals: number; committed: number }> = {};
    for (const b of (budgetData as any[]) || []) {
      const lineBudget = Number(b.revisedAmt ?? b.baselineAmt ?? 0);
      const catBudget = categoryBudgetSum[b.category] || 1;
      const share = lineBudget / catBudget;
      out[b.id] = {
        actuals: (categoryActuals[b.category] ?? 0) * share,
        committed: (categoryCommits[b.category] ?? 0) * share,
      };
    }
    return out;
  }, [actualsData, commitments, budgetData]);

  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const deleteBudget = useDeleteBudget();
  const createCommitment = useCreateCommitment();
  const updateCommitment = useUpdateCommitment();
  const deleteCommitment = useDeleteCommitment();

  // Budget line CRUD state
  const { isOpen: isBudgetFormOpen, onOpen: onBudgetFormOpen, onClose: onBudgetFormClose } = useDisclosure();
  const { isOpen: isBudgetDeleteOpen, onOpen: onBudgetDeleteOpen, onClose: onBudgetDeleteClose } = useDisclosure();
  const [budgetForm, setBudgetForm] = useState<Record<string, string>>(EMPTY_BUDGET);
  const [budgetFormErrors, setBudgetFormErrors] = useState<Record<string, string>>({});
  const [budgetEditId, setBudgetEditId] = useState<string | null>(null);
  const [budgetDeleteTarget, setBudgetDeleteTarget] = useState<{ id: string; category: string; description: string; amount: number } | null>(null);

  // Commitment CRUD state
  const { isOpen: isCommitFormOpen, onOpen: onCommitFormOpen, onClose: onCommitFormClose } = useDisclosure();
  const { isOpen: isCommitDeleteOpen, onOpen: onCommitDeleteOpen, onClose: onCommitDeleteClose } = useDisclosure();
  const [commitForm, setCommitForm] = useState<Record<string, string>>(EMPTY_COMMITMENT);
  const [commitEditId, setCommitEditId] = useState<string | null>(null);
  const [commitDeleteId, setCommitDeleteId] = useState<string | null>(null);

  // Budget line handlers
  const openBudgetCreate = () => {
    setBudgetEditId(null);
    setBudgetForm({ ...EMPTY_BUDGET });
    setBudgetFormErrors({});
    onBudgetFormOpen();
  };

  const openBudgetEdit = (b: any) => {
    setBudgetEditId(b.id);
    setBudgetForm({
      category: b.category || 'HARD_COSTS',
      description: b.description || '',
      baselineAmt: b.baselineAmt?.toString() || '',
      revisedAmt: b.revisedAmt?.toString() || '',
      notes: b.notes || '',
    });
    setBudgetFormErrors({});
    onBudgetFormOpen();
  };

  const openBudgetDelete = (b: any) => {
    setBudgetDeleteTarget({
      id: b.id,
      category: (b.category || '').replace(/_/g, ' '),
      description: b.description || '',
      amount: Number(b.revisedAmt ?? b.baselineAmt ?? 0),
    });
    onBudgetDeleteOpen();
  };

  const validateBudgetForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!budgetForm.category) errs.category = 'Category is required';
    if (!budgetForm.description.trim()) errs.description = 'Description is required';
    else if (budgetForm.description.length > 200) errs.description = 'Max 200 characters';

    const baseline = parseFloat(budgetForm.baselineAmt);
    if (!budgetForm.baselineAmt || isNaN(baseline)) errs.baselineAmt = 'Baseline amount is required';
    else if (baseline < 0) errs.baselineAmt = 'Cannot be negative';

    if (budgetForm.revisedAmt) {
      const revised = parseFloat(budgetForm.revisedAmt);
      if (isNaN(revised) || revised < 0) errs.revisedAmt = 'Cannot be negative';
    }
    if (budgetForm.notes && budgetForm.notes.length > 2000) errs.notes = 'Max 2000 characters';

    setBudgetFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleBudgetSave = async () => {
    if (!validateBudgetForm()) return;
    try {
      const baselineAmt = parseFloat(budgetForm.baselineAmt);
      const payload: Record<string, unknown> = {
        category: budgetForm.category,
        description: budgetForm.description.trim(),
        baselineAmt,
        revisedAmt: budgetForm.revisedAmt ? parseFloat(budgetForm.revisedAmt) : undefined,
        notes: budgetForm.notes.trim() || undefined,
      };
      if (budgetEditId) {
        // Update DTO omits projectId
        await updateBudget.mutateAsync({ id: budgetEditId, data: payload });
        addToast({ title: 'Budget line updated', color: 'success' });
      } else {
        await createBudget.mutateAsync({ ...payload, projectId });
        addToast({ title: 'Budget line created', color: 'success' });
      }
      onBudgetFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save budget line'), color: 'danger' });
    }
  };

  const handleBudgetDelete = async () => {
    if (!budgetDeleteTarget) return;
    try {
      await deleteBudget.mutateAsync(budgetDeleteTarget.id);
      addToast({ title: 'Budget line deleted', color: 'success' });
      onBudgetDeleteClose();
      setBudgetDeleteTarget(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete budget line'), color: 'danger' });
    }
  };

  // Commitment handlers
  const openCommitCreate = () => { setCommitEditId(null); setCommitForm({ ...EMPTY_COMMITMENT }); onCommitFormOpen(); };
  const openCommitEdit = (c: any) => {
    setCommitEditId(c.id);
    setCommitForm({
      vendor: c.vendor || c.vendorName || '',
      description: c.description || '',
      category: c.category || 'HARD_COSTS',
      contractAmt: c.contractAmt?.toString() || c.amount?.toString() || '',
      paidToDate: c.paidToDate?.toString() || '',
      retainage: c.retainage?.toString() || '',
      contractDate: c.contractDate ? c.contractDate.slice(0, 10) : '',
      notes: c.notes || '',
    });
    onCommitFormOpen();
  };
  const openCommitDelete = (id: string) => { setCommitDeleteId(id); onCommitDeleteOpen(); };

  const handleCommitSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        projectId,
        vendor: commitForm.vendor,
        description: commitForm.description,
        category: commitForm.category,
        contractAmt: commitForm.contractAmt ? parseFloat(commitForm.contractAmt) : 0,
        paidToDate: commitForm.paidToDate ? parseFloat(commitForm.paidToDate) : 0,
        retainage: commitForm.retainage ? parseFloat(commitForm.retainage) : 0,
        contractDate: commitForm.contractDate ? new Date(commitForm.contractDate).toISOString() : undefined,
        notes: commitForm.notes || undefined,
      };
      if (commitEditId) {
        await updateCommitment.mutateAsync({ id: commitEditId, data: payload });
        addToast({ title: 'Commitment updated', color: 'success' });
      } else {
        await createCommitment.mutateAsync(payload);
        addToast({ title: 'Commitment created', color: 'success' });
      }
      onCommitFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save commitment'), color: 'danger' });
    }
  };

  const handleCommitDelete = async () => {
    if (!commitDeleteId) return;
    try {
      await deleteCommitment.mutateAsync(commitDeleteId);
      addToast({ title: 'Commitment deleted', color: 'success' });
      onCommitDeleteClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete commitment'), color: 'danger' });
    }
  };

  const setBudget = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setBudgetForm((f) => ({ ...f, [field]: e.target.value }));
    if (budgetFormErrors[field]) setBudgetFormErrors((errs) => ({ ...errs, [field]: '' }));
  };
  const setCommit = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCommitForm((f) => ({ ...f, [field]: e.target.value }));

  if (isLoading) {
    return (
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} shadow="sm">
              <CardBody className="space-y-2">
                <Skeleton className="h-3 w-1/2 rounded" />
                <Skeleton className="h-7 w-3/4 rounded" />
              </CardBody>
            </Card>
          ))}
        </div>
        <Card shadow="sm">
          <CardBody>
            <Skeleton className="h-72 rounded" />
          </CardBody>
        </Card>
      </div>
    );
  }
  if (error) return <ErrorState message="Could not load financial summary." />;
  if (!data) return <EmptyState title="No financial data" />;

  const fin = data as any;
  const budgetLines = (budgetData as any[]) || [];
  const commitmentList = (commitments as any[]) || [];
  const chartData = (fin.byCategory || []).map((c: any) => ({
    category: (c.category || '').replace(/_/g, ' '),
    Budget: c.budget,
    Actual: c.actual,
    Committed: c.committed,
  }));

  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Budget" value={fmt(fin.budgetTotal)} colorScheme="brand" variant="construction" />
        {/* Actuals/Committed/Variance are spend data — financial:view only (PM sees budget only). */}
        <PermissionGate permission="financial:view">
          <StatCard label="Actuals" value={fmt(fin.actualTotal)} colorScheme="orange" variant="construction" />
        </PermissionGate>
        <PermissionGate permission="financial:view">
          <StatCard label="Committed" value={fmt(fin.committedTotal)} colorScheme="purple" variant="construction" />
        </PermissionGate>
        <PermissionGate permission="financial:view">
          <StatCard
            label="Variance"
            value={fmt(fin.variance)}
            helpText={fmtPct(fin.variancePercent)}
            trend={fin.variance >= 0 ? 'increase' : 'decrease'}
            colorScheme={fin.variance >= 0 ? 'green' : 'red'}
            variant="construction"
          />
        </PermissionGate>
      </div>

      {/* Budget — Cash Needs (forward obligations by category, M/Q/A) */}
      <div className="mb-6">
        <ObligationsPanel projectId={projectId} />
      </div>

      {/* Budget vs Actual Chart */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Budget vs Actual by Category</p>
        </CardHeader>
        <CardBody>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" fontSize={10} angle={-20} textAnchor="end" height={60} />
              <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="Budget" fill="#3182CE" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Actual" fill="#DD6B20" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Committed" fill="#805AD5" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>

      {/* Budget Lines Table */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0 flex justify-between items-center">
          <div>
            <p className="font-semibold text-sm text-gray-600">Budget Lines</p>
            <p className="text-xs text-gray-400 mt-0.5">{budgetLines.length} line{budgetLines.length !== 1 ? 's' : ''}{!canEditBudget && ' \u00b7 read-only'}</p>
          </div>
          {canEditBudget && (
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openBudgetCreate}>
              Add Budget Line
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {budgetLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-gray-600">No budget lines yet</p>
              <p className="text-xs text-gray-400 mt-1">
                {canEditBudget
                  ? 'Add the first budget line by category to start tracking spend.'
                  : 'No budget lines have been added for this project.'}
              </p>
              {canEditBudget && (
                <Button size="sm" color="primary" startContent={<FiPlus />} className="mt-3" onPress={openBudgetCreate}>
                  Add Budget Line
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Baseline</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Revised</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase w-[160px]">Spend vs Budget</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Notes</th>
                    {canEditBudget && (
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {budgetLines.map((b: any) => {
                    const lineBudget = Number(b.revisedAmt ?? b.baselineAmt ?? 0);
                    const v = varianceByLine[b.id] ?? { actuals: 0, committed: 0 };
                    return (
                      <tr key={b.id} className="border-b border-gray-50">
                        <td className="py-2 px-2">{(b.category || '').replace(/_/g, ' ')}</td>
                        <td className="py-2 px-2">{b.description}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmt(b.baselineAmt)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{b.revisedAmt != null ? fmt(b.revisedAmt) : '\u2014'}</td>
                        <td className="py-2 px-2">
                          <VarianceBar budget={lineBudget} actuals={v.actuals} committed={v.committed} />
                        </td>
                        <td className="py-2 px-2">{b.notes || '\u2014'}</td>
                        {canEditBudget && (
                          <td className="py-2 px-2">
                            <div className="flex gap-1">
                              <Button size="sm" variant="light" isIconOnly onPress={() => openBudgetEdit(b)} aria-label="Edit budget line">
                                <FiEdit2 className="text-xs" />
                              </Button>
                              <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openBudgetDelete(b)} aria-label="Delete budget line">
                                <FiTrash2 className="text-xs" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Category Breakdown */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Category Breakdown</p>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actual</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Committed</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Forecast</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Variance</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">% Used</th>
                </tr>
              </thead>
              <tbody>
                {(fin.byCategory || []).map((c: any) => {
                  const pct = c.budget > 0 ? (c.actual / c.budget) * 100 : 0;
                  return (
                    <tr key={c.category} className="border-b border-gray-50">
                      <td className="py-2 px-2">{(c.category || '').replace(/_/g, ' ')}</td>
                      <td className="py-2 px-2 text-right">{fmt(c.budget)}</td>
                      <td className="py-2 px-2 text-right">{fmt(c.actual)}</td>
                      <td className="py-2 px-2 text-right">{fmt(c.committed)}</td>
                      <td className="py-2 px-2 text-right">{fmt(c.forecast)}</td>
                      <td className={`py-2 px-2 text-right ${c.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmt(c.variance)}
                      </td>
                      <td className="py-2 px-2 w-[120px]">
                        <Progress
                          value={Math.min(pct, 100)}
                          size="sm"
                          color={pct > 90 ? 'danger' : pct > 70 ? 'warning' : 'primary'}
                          className="max-w-[100px]"
                        />
                        <span className="text-xs text-gray-500">{pct.toFixed(0)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        </CardBody>
      </Card>

      {/* Loans */}
      <PermissionGate permission="loan:view">
        {loans && (loans as any[]).length > 0 && (
          <Card shadow="sm" className="mb-6">
            <CardHeader className="pb-0">
              <p className="font-semibold text-sm text-gray-600">Loans</p>
            </CardHeader>
            <CardBody>
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Lender</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Principal</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Rate</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Pmt</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Maturity</th>
                  </tr>
                </thead>
                <tbody>
                  {(loans as any[]).map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="py-2 px-2"><StatusBadge status={l.loanType} /></td>
                      <td className="py-2 px-2">{l.lender || '\u2014'}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.principalAmt)}</td>
                      <td className="py-2 px-2 text-right">{l.interestRate ? `${l.interestRate}%` : '\u2014'}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.currentBalance)}</td>
                      <td className="py-2 px-2 text-right">{l.monthlyPayment ? fmt(l.monthlyPayment) : '\u2014'}</td>
                      <td className="py-2 px-2">{l.unit ? `${l.unit.building?.name} - ${l.unit.unitNumber}` : '\u2014'}</td>
                      <td className="py-2 px-2">{fmtDate(l.maturityDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </CardBody>
          </Card>
        )}

        {/* Monthly Debt Service */}
        {monthlyPaymentsData && (monthlyPaymentsData as any).total > 0 && (
          <Card shadow="sm" className="mb-6">
            <CardHeader className="pb-0">
              <p className="font-semibold text-sm text-gray-600">Monthly Debt Service</p>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <StatCard label="Monthly Debt Service" value={fmt((monthlyPaymentsData as any).total)} colorScheme="red" variant="construction" />
                <StatCard label="Annual Debt Service" value={fmt((monthlyPaymentsData as any).annualTotal)} colorScheme="orange" variant="construction" />
              </div>
              <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Loan Type</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Lender</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {((monthlyPaymentsData as any).perLoan || []).map((l: any) => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="py-2 px-2"><StatusBadge status={l.loanType} /></td>
                      <td className="py-2 px-2">{l.lender || '\u2014'}</td>
                      <td className="py-2 px-2">{l.unitNumber ? `${l.buildingName} - ${l.unitNumber}` : '\u2014'}</td>
                      <td className="py-2 px-2 text-right">{fmt(l.monthlyPayment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </CardBody>
          </Card>
        )}
      </PermissionGate>

      {/* Commitments — vendor spend, financial:view only */}
      <PermissionGate permission="financial:view">
      <Card shadow="sm">
        <CardHeader className="pb-0 flex justify-between items-center">
          <p className="font-semibold text-sm text-gray-600">Contracts & Commitments</p>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCommitCreate}>
            Add Commitment
          </Button>
        </CardHeader>
        <CardBody>
          {commitmentList.length === 0 ? (
            <EmptyState title="No commitments" />
          ) : (
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Vendor</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Description</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Paid</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Retainage</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {commitmentList.map((c: any) => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className="py-2 px-2">{c.vendor || c.vendorName}</td>
                    <td className="py-2 px-2">{c.description}</td>
                    <td className="py-2 px-2">{(c.category || '').replace(/_/g, ' ')}</td>
                    <td className="py-2 px-2 text-right">{fmt(c.contractAmt || c.amount)}</td>
                    <td className="py-2 px-2 text-right">{fmt(c.paidToDate)}</td>
                    <td className="py-2 px-2 text-right">{fmt(c.retainage)}</td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="light" isIconOnly onPress={() => openCommitEdit(c)}><FiEdit2 className="text-xs" /></Button>
                        <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openCommitDelete(c.id)}><FiTrash2 className="text-xs" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardBody>
      </Card>
      </PermissionGate>

      {/* Cashflow Forecast — financial:view only */}
      <PermissionGate permission="financial:view">
      <Card shadow="sm">
        <CardHeader className="pb-0">
          <p className="font-semibold text-sm text-gray-600">Cashflow Projection</p>
        </CardHeader>
        <CardBody>
          <CashflowForecastView projectId={projectId} />
        </CardBody>
      </Card>
      </PermissionGate>

      {/* Budget Line Modal */}
      <Modal isOpen={isBudgetFormOpen} onClose={onBudgetFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{budgetEditId ? 'Edit Budget Line' : 'Add Budget Line'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                size="sm"
                label="Category"
                isRequired
                selectedKeys={budgetForm.category ? [budgetForm.category] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setBudgetForm((f) => ({ ...f, category: val }));
                  if (budgetFormErrors.category) setBudgetFormErrors((errs) => ({ ...errs, category: '' }));
                }}
                isInvalid={!!budgetFormErrors.category}
                errorMessage={budgetFormErrors.category}
              >
                {BUDGET_CATEGORIES.map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input
                size="sm" label="Description" isRequired
                value={budgetForm.description} onChange={setBudget('description')}
                isInvalid={!!budgetFormErrors.description} errorMessage={budgetFormErrors.description}
              />
              <Input
                size="sm" label="Baseline Amount" isRequired type="number" min={0} step="0.01"
                value={budgetForm.baselineAmt} onChange={setBudget('baselineAmt')}
                description="Original approved budget"
                isInvalid={!!budgetFormErrors.baselineAmt} errorMessage={budgetFormErrors.baselineAmt}
              />
              <Input
                size="sm" label="Revised Amount" type="number" min={0} step="0.01"
                value={budgetForm.revisedAmt} onChange={setBudget('revisedAmt')}
                description="Current approved budget (defaults to baseline)"
                isInvalid={!!budgetFormErrors.revisedAmt} errorMessage={budgetFormErrors.revisedAmt}
              />
              <div className="sm:col-span-2">
                <Input
                  size="sm" label="Notes"
                  value={budgetForm.notes} onChange={setBudget('notes')}
                  isInvalid={!!budgetFormErrors.notes} errorMessage={budgetFormErrors.notes}
                />
              </div>
            </div>

            {/* Slice 5: revision history (read-only) — shown only when editing existing line */}
            {budgetEditId && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <BudgetRevisionHistory budgetLineId={budgetEditId} />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onBudgetFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleBudgetSave} isLoading={createBudget.isPending || updateBudget.isPending}>
              {budgetEditId ? 'Save Changes' : 'Add Budget Line'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Budget Line Delete — shows what's being removed */}
      <Modal isOpen={isBudgetDeleteOpen} onClose={onBudgetDeleteClose} isDismissable={false} size="sm">
        <ModalContent>
          <ModalHeader>Delete Budget Line</ModalHeader>
          <ModalBody>
            {budgetDeleteTarget && (
              <>
                <p className="text-sm text-gray-700 mb-2">Delete this budget line?</p>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs">
                  <p><strong className="text-gray-500 uppercase tracking-wide text-[10px]">Category:</strong> {budgetDeleteTarget.category}</p>
                  <p className="mt-1"><strong className="text-gray-500 uppercase tracking-wide text-[10px]">Description:</strong> {budgetDeleteTarget.description}</p>
                  <p className="mt-1"><strong className="text-gray-500 uppercase tracking-wide text-[10px]">Amount:</strong> {fmt(budgetDeleteTarget.amount)}</p>
                </div>
                <p className="text-xs text-amber-700 mt-3">
                  Actuals already booked against this category will keep their records, but the planned amount will be lost.
                </p>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onBudgetDeleteClose}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleBudgetDelete} isLoading={deleteBudget.isPending}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Commitment Modal */}
      <Modal isOpen={isCommitFormOpen} onClose={onCommitFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{commitEditId ? 'Edit Commitment' : 'Add Commitment'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input size="sm" label="Vendor" isRequired value={commitForm.vendor} onChange={setCommit('vendor')} />
              <Input size="sm" label="Description" isRequired value={commitForm.description} onChange={setCommit('description')} />
              <Select
                size="sm"
                label="Category"
                isRequired
                selectedKeys={commitForm.category ? [commitForm.category] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setCommitForm((f) => ({ ...f, category: val }));
                }}
              >
                {BUDGET_CATEGORIES.map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Contract Amount" isRequired type="number" value={commitForm.contractAmt} onChange={setCommit('contractAmt')} />
              <Input size="sm" label="Paid to Date" type="number" value={commitForm.paidToDate} onChange={setCommit('paidToDate')} />
              <Input size="sm" label="Retainage" type="number" value={commitForm.retainage} onChange={setCommit('retainage')} />
              <Input size="sm" label="Contract Date" type="date" value={commitForm.contractDate} onChange={setCommit('contractDate')} />
              <Input size="sm" label="Notes" value={commitForm.notes} onChange={setCommit('notes')} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onCommitFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleCommitSave} isLoading={createCommitment.isPending || updateCommitment.isPending}>
              {commitEditId ? 'Save Changes' : 'Add Commitment'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Commitment Delete */}
      <Modal isOpen={isCommitDeleteOpen} onClose={onCommitDeleteClose} isDismissable={false}>
        <ModalContent>
          <ModalHeader>Delete Commitment</ModalHeader>
          <ModalBody><p>This will permanently delete the commitment. Are you sure?</p></ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onCommitDeleteClose}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleCommitDelete} isLoading={deleteCommitment.isPending}>Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Units Tab ----
const UNIT_TYPES = ['RETAIL', 'MEDICAL', 'FLEX', 'RESIDENTIAL_LOT', 'OFFICE', 'RESTAURANT', 'EVENT_CENTER'];
const UNIT_STATUSES = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASED', 'SOLD', 'OCCUPIED', 'UNDER_CONSTRUCTION'];

const EMPTY_UNIT = {
  unitNumber: '', buildingId: '', unitType: 'RETAIL', sqft: '', status: 'AVAILABLE',
  askingRent: '', askingPrice: '', askingPsf: '', notes: '', tenantName: '', primeOwned: 'false',
};

const COMMENT_TYPE_COLORS: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  SALES: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
};

function UnitCommentsPanel({ unitId, unitLabel }: { unitId: string; unitLabel: string }) {
  const { data, isLoading } = useUnitComments(unitId);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment();
  const [text, setText] = useState('');
  const [commentType, setCommentType] = useState('MARKETING');

  const comments = (data as any[]) || [];

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
      <p className="text-sm text-gray-500 mb-3">Comments for {unitLabel}</p>
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-gray-400 mb-3">No comments yet</p>
      ) : (
        <div className="max-h-[300px] overflow-auto mb-3 space-y-3">
          {comments.map((c: any) => (
            <div key={c.id} className="flex gap-2">
              <Avatar size="sm" name={c.user?.name} src={c.user?.avatarUrl} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
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
        <Button size="sm" color="primary" isIconOnly onPress={handleSubmit} isLoading={createComment.isPending}>
          <FiSend />
        </Button>
      </div>
    </div>
  );
}

// Status transition state machine — kept in sync with units.service.ts.
// SALES role uses this to filter the Status dropdown to only valid next-states.
// SUPER_ADMIN/FOUNDER bypass this on the server, so we show all statuses for them.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  AVAILABLE: ['UNDER_CONTRACT', 'LEASED', 'SOLD', 'UNDER_CONSTRUCTION', 'OCCUPIED'],
  UNDER_CONTRACT: ['AVAILABLE', 'LEASED', 'SOLD'],
  LEASED: ['AVAILABLE', 'OCCUPIED', 'UNDER_CONTRACT'],
  OCCUPIED: ['AVAILABLE', 'LEASED'],
  SOLD: ['AVAILABLE'],
  UNDER_CONSTRUCTION: ['AVAILABLE'],
};

function UnitsTab({ projectId, role = '' }: { projectId: string; role?: string }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();
  const isSales = role === 'SALES';
  const isOverrideRole = role === 'SUPER_ADMIN' || role === 'FOUNDER';
  // Sales has unit:edit but is restricted server-side to status only — model that here too.
  const canFullEdit = hasPermission('unit:edit') && !isSales;
  const canStatusEdit = hasPermission('unit:edit'); // Sales falls into this branch
  const canDelete = hasPermission('unit:edit') && !isSales;
  const canCreate = canFullEdit;

  const { data, isLoading, error } = useUnits(projectId);
  const { data: buildingsData } = useBuildings(projectId);
  const { data: leaseIncome } = useMonthlyLeaseIncome(projectId);
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit();
  const updateUnitStatus = useUpdateUnitStatus();
  const deleteUnit = useDeleteUnit();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isStatusOpen, onOpen: onStatusOpen, onClose: onStatusClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const { isOpen: isCommentsOpen, onOpen: onCommentsOpen, onClose: onCommentsClose } = useDisclosure();
  const { isOpen: isCombineOpen, onOpen: onCombineOpen, onClose: onCombineClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_UNIT);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ id: string; unitNumber: string; currentStatus: string; newStatus: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; unitNumber: string; leaseCount: number; saleCount: number } | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [commentUnit, setCommentUnit] = useState<{ id: string; label: string } | null>(null);
  const [filterBuildingId, setFilterBuildingId] = useState<string>('');
  const [unitSearch, setUnitSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const buildings = (buildingsData as any[]) || [];
  const li = leaseIncome as any;
  const isConstruction = role === 'CONSTRUCTION';

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_UNIT, buildingId: buildings[0]?.id || '' });
    setFormErrors({});
    onFormOpen();
  };

  const openEdit = (u: any) => {
    // SALES uses the status-only modal
    if (isSales) {
      setStatusTarget({
        id: u.id,
        unitNumber: u.unitNumber || '',
        currentStatus: u.status || 'AVAILABLE',
        newStatus: u.status || 'AVAILABLE',
      });
      onStatusOpen();
      return;
    }
    setEditId(u.id);
    setForm({
      unitNumber: u.unitNumber || '',
      buildingId: u.buildingId || u.building?.id || '',
      unitType: u.unitType || 'RETAIL',
      sqft: u.sqft?.toString() || '',
      status: u.status || 'AVAILABLE',
      askingRent: u.askingRent?.toString() || '',
      askingPrice: u.askingPrice?.toString() || '',
      askingPsf: u.askingPrice && u.sqft ? (Number(u.askingPrice) / Number(u.sqft)).toFixed(2) : '',
      notes: u.notes || '',
      tenantName: u.leases?.[0]?.tenantName || '',
      primeOwned: u.primeOwned ? 'true' : 'false',
    });
    setFormErrors({});
    onFormOpen();
  };

  const openDelete = (u: any) => {
    setDeleteTarget({
      id: u.id,
      unitNumber: u.unitNumber || '',
      leaseCount: u._count?.leases ?? u.leases?.length ?? 0,
      saleCount: u._count?.sales ?? u.sales?.length ?? 0,
    });
    setForceDelete(false);
    onDeleteOpen();
  };

  const openComments = (u: any) => {
    setCommentUnit({ id: u.id, label: `${u.building?.name || ''} - ${u.unitNumber}` });
    onCommentsOpen();
  };

  // Build the list of allowed statuses for the SALES status-edit modal
  const allowedStatusesForSales = (current: string) => {
    if (isOverrideRole) return UNIT_STATUSES;
    return [current, ...(STATUS_TRANSITIONS[current] ?? [])];
  };

  // PSF <-> Price bidirectional calc
  const handlePsfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const psf = e.target.value;
    setForm((f) => {
      const sqft = parseFloat(f.sqft);
      const newPrice = psf && sqft ? (parseFloat(psf) * sqft).toFixed(2) : f.askingPrice;
      return { ...f, askingPsf: psf, askingPrice: psf ? newPrice : f.askingPrice };
    });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const price = e.target.value;
    setForm((f) => {
      const sqft = parseFloat(f.sqft);
      const newPsf = price && sqft ? (parseFloat(price) / sqft).toFixed(2) : f.askingPsf;
      return { ...f, askingPrice: price, askingPsf: price ? newPsf : f.askingPsf };
    });
  };

  const handleSqftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sqftVal = e.target.value;
    setForm((f) => {
      const sqft = parseFloat(sqftVal);
      const psf = parseFloat(f.askingPsf);
      const newPrice = psf && sqft ? (psf * sqft).toFixed(2) : f.askingPrice;
      return { ...f, sqft: sqftVal, askingPrice: psf ? newPrice : f.askingPrice };
    });
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.unitNumber.trim()) errs.unitNumber = 'Unit number is required';
    else if (form.unitNumber.length > 40) errs.unitNumber = 'Max 40 characters';

    if (!form.buildingId) errs.buildingId = 'Building is required';
    if (!form.unitType) errs.unitType = 'Unit type is required';

    if (form.sqft) {
      const v = parseInt(form.sqft);
      if (isNaN(v) || v < 1) errs.sqft = 'Must be a positive integer';
    }
    if (form.askingRent) {
      const v = parseFloat(form.askingRent);
      if (isNaN(v) || v <= 0) errs.askingRent = 'Must be positive';
    }
    if (form.askingPrice) {
      const v = parseFloat(form.askingPrice);
      if (isNaN(v) || v <= 0) errs.askingPrice = 'Must be positive';
    }
    if (form.notes && form.notes.length > 2000) errs.notes = 'Max 2000 characters';

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    try {
      const basePayload: Record<string, unknown> = {
        unitNumber: form.unitNumber.trim(),
        unitType: form.unitType,
        status: form.status,
        sqft: form.sqft ? parseInt(form.sqft) : undefined,
        askingRent: form.askingRent ? parseFloat(form.askingRent) : undefined,
        askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : undefined,
        primeOwned: form.primeOwned === 'true',
        notes: form.notes.trim() || undefined,
      };
      if (editId) {
        // Update DTO omits buildingId (units can't move between buildings)
        await updateUnit.mutateAsync({ id: editId, data: basePayload });
        addToast({ title: 'Unit updated', color: 'success' });
      } else {
        await createUnit.mutateAsync({ ...basePayload, buildingId: form.buildingId });
        addToast({ title: 'Unit created', color: 'success' });
      }
      onFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save unit'), color: 'danger' });
    }
  };

  const handleStatusSave = async () => {
    if (!statusTarget || statusTarget.newStatus === statusTarget.currentStatus) {
      onStatusClose();
      return;
    }
    try {
      await updateUnitStatus.mutateAsync({ id: statusTarget.id, status: statusTarget.newStatus });
      addToast({ title: `Unit ${statusTarget.unitNumber} → ${statusTarget.newStatus.replace(/_/g, ' ')}`, color: 'success' });
      onStatusClose();
      setStatusTarget(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update status'), color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const hasAttached = deleteTarget.leaseCount > 0 || deleteTarget.saleCount > 0;
    try {
      await deleteUnit.mutateAsync({
        id: deleteTarget.id,
        force: hasAttached ? forceDelete : undefined,
      });
      addToast({ title: 'Unit deleted', color: 'success' });
      onDeleteClose();
      setDeleteTarget(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete unit'), color: 'danger' });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (formErrors[field]) setFormErrors((errs) => ({ ...errs, [field]: '' }));
  };

  const allUnits = (data as any[]) || [];
  const searchLower = unitSearch.trim().toLowerCase();
  const filteredUnits = allUnits.filter((u: any) => {
    if (filterBuildingId && u.buildingId !== filterBuildingId && u.building?.id !== filterBuildingId) return false;
    if (statusFilter && u.status !== statusFilter) return false;
    if (searchLower) {
      const hay = `${u.unitNumber || ''} ${u.notes || ''} ${u.leases?.[0]?.tenantName || ''}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  // Group by building — must be called before any early return to satisfy React hooks rules
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; units: any[] }>();
    for (const u of filteredUnits) {
      const bId = u.buildingId || u.building?.id || 'unknown';
      const bName = u.building?.name || 'Unknown Building';
      if (!map.has(bId)) map.set(bId, { name: bName, units: [] });
      map.get(bId)!.units.push(u);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [filteredUnits]);

  if (isLoading) {
    return (
      <div className="mt-4 space-y-4">
        <Skeleton className="h-9 w-48 rounded" />
        <Card shadow="sm">
          <CardBody className="space-y-2">
            <Skeleton className="h-4 w-1/3 rounded" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </CardBody>
        </Card>
      </div>
    );
  }
  if (error) return <ErrorState message="Could not load units." />;

  const unitTableHeaders = (
    <tr className="border-b border-gray-200">
      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
      <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Size (sqft)</th>
      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
      <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Prime</th>
      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
      {!isConstruction && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Rent</th>}
      {!isConstruction && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Asking Price</th>}
      {!isConstruction && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">PSF</th>}
      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
    </tr>
  );

  const renderUnitRow = (u: any) => {
    const monthlyRent = u.leases?.[0]?.monthlyRent;
    const psf = u.askingPrice && u.sqft ? (Number(u.askingPrice) / u.sqft).toFixed(2) : null;
    return (
      <tr
        key={u.id}
        className="border-b border-gray-50 cursor-pointer hover:bg-gray-50"
        onClick={() => navigate(`/projects/${projectId}/units/${u.id}`)}
      >
        <td className="py-2 px-2 font-medium">{u.unitNumber || u.name}</td>
        <td className="py-2 px-2"><StatusBadge status={u.unitType} /></td>
        <td className="py-2 px-2 text-right">{u.sqft?.toLocaleString() || '\u2014'}</td>
        <td className="py-2 px-2"><StatusBadge status={u.status} /></td>
        <td className="py-2 px-2 text-center">
          {u.primeOwned && <Chip size="sm" color="success" variant="flat">Prime</Chip>}
        </td>
        <td className="py-2 px-2">{u.leases?.[0]?.tenantName || '\u2014'}</td>
        {!isConstruction && <td className="py-2 px-2 text-right">{monthlyRent ? fmt(monthlyRent) : '\u2014'}</td>}
        {!isConstruction && <td className="py-2 px-2 text-right">{u.askingPrice ? fmt(u.askingPrice) : '\u2014'}</td>}
        {!isConstruction && <td className="py-2 px-2 text-right">{psf ? `$${psf}` : '\u2014'}</td>}
        <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1">
            <Button size="sm" variant="light" isIconOnly onPress={() => openComments(u)} aria-label="Comments">
              <div className="relative">
                <FiMessageSquare className="text-xs" />
                {u._count?.comments > 0 && (
                  <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
                    {u._count.comments}
                  </span>
                )}
              </div>
            </Button>
            {(canFullEdit || canStatusEdit) && (
              <Button
                size="sm" variant="light" isIconOnly onPress={() => openEdit(u)}
                aria-label={isSales ? 'Update status' : 'Edit unit'}
              >
                <FiEdit2 className="text-xs" />
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openDelete(u)} aria-label="Delete unit">
                <FiTrash2 className="text-xs" />
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Unit inventory heat map counts
  const statusCounts = allUnits.reduce((acc: Record<string, number>, u: any) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {});
  const HEAT_COLORS: Record<string, string> = {
    AVAILABLE: 'bg-green-100 border-green-300 text-green-800',
    UNDER_CONTRACT: 'bg-blue-100 border-blue-300 text-blue-800',
    LEASED: 'bg-teal-100 border-teal-300 text-teal-800',
    OCCUPIED: 'bg-purple-100 border-purple-300 text-purple-800',
    SOLD: 'bg-gray-100 border-gray-300 text-gray-500',
    UNDER_CONSTRUCTION: 'bg-orange-100 border-orange-300 text-orange-800',
  };

  return (
    <div className="mt-4">
      {/* Unit Inventory Heat Map — pills double as status filter chips */}
      {allUnits.length > 0 && (
        <Card shadow="sm" className="mb-4">
          <CardBody className="py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase">Unit Inventory</p>
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('')}
                  className="text-[11px] text-blue-600 hover:underline"
                >
                  Clear status filter
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusCounts).map(([status, count]) => {
                const isActive = statusFilter === status;
                return (
                  <button
                    type="button"
                    key={status}
                    onClick={() => setStatusFilter(isActive ? '' : status)}
                    aria-pressed={isActive}
                    aria-label={`Filter by ${status.replace(/_/g, ' ')}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-shadow ${HEAT_COLORS[status] || 'bg-gray-100 border-gray-300'} ${isActive ? 'ring-2 ring-offset-1 ring-blue-400 shadow-sm' : 'hover:shadow-sm'}`}
                  >
                    <span className="font-bold">{count as number}</span>
                    <span>{status.replace(/_/g, ' ')}</span>
                  </button>
                );
              })}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-xs font-medium text-gray-600">
                <span className="font-bold">{allUnits.length}</span>
                <span>Total</span>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Lease Income Summary */}
      {li && li.total > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <StatCard label="Monthly Lease Income" value={fmt(li.total)} colorScheme="green" variant="revenue" />
          <StatCard label="Annual Projection" value={fmt(li.annualProjection)} colorScheme="brand" variant="revenue" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <p className="font-semibold text-sm text-gray-600">
            {filteredUnits.length} unit{filteredUnits.length === 1 ? '' : 's'}
            {filteredUnits.length !== allUnits.length && (
              <span className="text-gray-400 font-normal"> of {allUnits.length}</span>
            )}
          </p>
          {allUnits.length > 0 && (
            <Input
              size="sm"
              placeholder="Search unit #, tenant, notes…"
              value={unitSearch}
              onChange={(e) => setUnitSearch(e.target.value)}
              startContent={<FiSearch className="text-gray-400 w-3.5 h-3.5" />}
              className="w-full sm:w-[240px]"
              isClearable
              onClear={() => setUnitSearch('')}
              aria-label="Search units"
            />
          )}
          {buildings.length > 1 && (
            <Select
              size="sm"
              label="Filter by Building"
              className="w-full sm:w-[200px]"
              selectedKeys={filterBuildingId ? [filterBuildingId] : []}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;
                setFilterBuildingId(val || '');
              }}
            >
              {[{ id: '', name: 'All Buildings' }, ...buildings].map((b: any) => (
                <SelectItem key={b.id}>{b.name}</SelectItem>
              ))}
            </Select>
          )}
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Button size="sm" variant="flat" onPress={onCombineOpen}>Combine units</Button>
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
              Add Unit
            </Button>
          </div>
        )}
      </div>

      {filteredUnits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {(() => {
            const hasFilters = filterBuildingId || statusFilter || unitSearch.trim();
            if (allUnits.length === 0) {
              return (
                <>
                  <p className="text-sm font-medium text-gray-600">No units yet</p>
                  <p className="text-xs text-gray-400 mt-1">Add the first unit to start tracking availability and revenue.</p>
                </>
              );
            }
            if (hasFilters) {
              return (
                <>
                  <p className="text-sm font-medium text-gray-600">No units match your filters</p>
                  <Button
                    size="sm"
                    variant="flat"
                    className="mt-3"
                    onPress={() => { setFilterBuildingId(''); setStatusFilter(''); setUnitSearch(''); }}
                  >
                    Clear filters
                  </Button>
                </>
              );
            }
            return null;
          })()}
          {canCreate && buildings.length > 0 && allUnits.length === 0 && (
            <Button size="sm" color="primary" startContent={<FiPlus />} className="mt-3" onPress={openCreate}>
              Add Unit
            </Button>
          )}
          {buildings.length === 0 && (
            <p className="text-xs text-amber-700 mt-2">Add a building first.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([buildingId, { name, units: bUnits }]) => (
            <Card key={buildingId} shadow="sm">
              <CardHeader className="pb-0">
                <p className="font-semibold text-sm text-gray-600">{name} ({bUnits.length} units)</p>
              </CardHeader>
              <CardBody className="pt-2">
                <div className="overflow-x-auto">
                  <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
                    <thead>{unitTableHeaders}</thead>
                    <tbody>{bUnits.map(renderUnitRow)}</tbody>
                  </table></div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Combine Units Modal */}
      <CombineUnitsModal isOpen={isCombineOpen} onClose={onCombineClose} units={allUnits} buildings={buildings} />

      {/* Create / Edit Unit Modal */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit Unit' : 'Add Unit'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                size="sm" label="Unit Number" isRequired
                value={form.unitNumber} onChange={set('unitNumber')}
                isInvalid={!!formErrors.unitNumber} errorMessage={formErrors.unitNumber}
              />
              <Select
                size="sm"
                label="Building"
                isRequired
                isDisabled={!!editId}
                description={editId ? "Building can't be changed after creation" : undefined}
                selectedKeys={form.buildingId ? [form.buildingId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, buildingId: val }));
                  if (formErrors.buildingId) setFormErrors((errs) => ({ ...errs, buildingId: '' }));
                }}
                isInvalid={!!formErrors.buildingId}
                errorMessage={formErrors.buildingId}
              >
                {buildings.map((b: any) => (
                  <SelectItem key={b.id}>{b.name}</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Unit Type"
                selectedKeys={form.unitType ? [form.unitType] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, unitType: val }));
                }}
              >
                {UNIT_TYPES.map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input
                size="sm" label="Sqft" type="number" min={1}
                value={form.sqft} onChange={handleSqftChange}
                isInvalid={!!formErrors.sqft} errorMessage={formErrors.sqft}
              />
              <Select
                size="sm"
                label="Status"
                description={editId && !isOverrideRole ? `From ${form.status}: only valid transitions allowed` : undefined}
                selectedKeys={form.status ? [form.status] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, status: val }));
                }}
              >
                {UNIT_STATUSES.map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input
                size="sm" label="Asking Rent ($/mo)" type="number" min={0}
                value={form.askingRent} onChange={set('askingRent')}
                isInvalid={!!formErrors.askingRent} errorMessage={formErrors.askingRent}
              />
              <Input size="sm" label="Asking Price PSF ($)" type="number" value={form.askingPsf} onChange={handlePsfChange} />
              <Input
                size="sm" label="Asking Price ($)" type="number" min={0}
                value={form.askingPrice} onChange={handlePriceChange}
                isInvalid={!!formErrors.askingPrice} errorMessage={formErrors.askingPrice}
              />
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  size="sm"
                  isSelected={form.primeOwned === 'true'}
                  onValueChange={(v) => setForm((f) => ({ ...f, primeOwned: v ? 'true' : 'false' }))}
                />
                <span className="text-sm">Prime Developer Owned</span>
              </div>
              {editId && (
                <Input size="sm" label="Current Tenant" value={form.tenantName} isReadOnly description="Managed via Leases tab" />
              )}
              <Input
                size="sm" label="Notes"
                value={form.notes} onChange={set('notes')}
                className={editId ? '' : 'sm:col-span-2'}
                isInvalid={!!formErrors.notes} errorMessage={formErrors.notes}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSave} isLoading={createUnit.isPending || updateUnit.isPending}>
              {editId ? 'Save Changes' : 'Add Unit'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Comments Modal */}
      <Modal isOpen={isCommentsOpen} onClose={onCommentsClose} size="lg">
        <ModalContent>
          <ModalHeader>Unit Comments</ModalHeader>
          <ModalBody>
            {commentUnit && <UnitCommentsPanel unitId={commentUnit.id} unitLabel={commentUnit.label} />}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onCommentsClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Status-only Modal (SALES role) */}
      <Modal isOpen={isStatusOpen} onClose={onStatusClose} size="sm">
        <ModalContent>
          <ModalHeader>Update Unit Status</ModalHeader>
          <ModalBody>
            {statusTarget && (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  Unit <strong>{statusTarget.unitNumber}</strong> · current status:{' '}
                  <Chip size="sm" variant="flat">{statusTarget.currentStatus.replace(/_/g, ' ')}</Chip>
                </div>
                <Select
                  size="sm"
                  label="New Status"
                  selectedKeys={[statusTarget.newStatus]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) setStatusTarget((s) => s ? { ...s, newStatus: val } : null);
                  }}
                >
                  {allowedStatusesForSales(statusTarget.currentStatus).map((v) => (
                    <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </Select>
                {!isOverrideRole && (
                  <p className="text-xs text-gray-400">Only valid status transitions are shown.</p>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onStatusClose}>Cancel</Button>
            <Button
              size="sm" color="primary"
              onPress={handleStatusSave}
              isLoading={updateUnitStatus.isPending}
              isDisabled={!statusTarget || statusTarget.newStatus === statusTarget.currentStatus}
            >
              Update Status
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation — shows attached lease/sale counts and requires explicit force */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} isDismissable={false} size="sm">
        <ModalContent>
          <ModalHeader>Delete Unit</ModalHeader>
          <ModalBody>
            {deleteTarget && (() => {
              const hasAttached = deleteTarget.leaseCount > 0 || deleteTarget.saleCount > 0;
              return (
                <>
                  <p className="text-sm text-gray-700">
                    Delete unit <strong>{deleteTarget.unitNumber}</strong>?
                  </p>
                  {hasAttached ? (
                    <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                      <p className="font-semibold mb-1">⚠ This unit has attached records</p>
                      <ul className="list-disc list-inside mb-2">
                        {deleteTarget.leaseCount > 0 && <li>{deleteTarget.leaseCount} lease{deleteTarget.leaseCount === 1 ? '' : 's'}</li>}
                        {deleteTarget.saleCount > 0 && <li>{deleteTarget.saleCount} sale{deleteTarget.saleCount === 1 ? '' : 's'}</li>}
                      </ul>
                      <p>Deleting will permanently remove all attached records. This cannot be undone.</p>
                      <label className="flex items-start gap-2 mt-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={forceDelete}
                          onChange={(e) => setForceDelete(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>Yes, I understand — delete the unit and all attached records</span>
                      </label>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 mt-2">No leases or sales attached. Safe to delete.</p>
                  )}
                </>
              );
            })()}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onDeleteClose}>Cancel</Button>
            <Button
              size="sm"
              color="danger"
              onPress={handleDelete}
              isLoading={deleteUnit.isPending}
              isDisabled={
                !!deleteTarget &&
                (deleteTarget.leaseCount > 0 || deleteTarget.saleCount > 0) &&
                !forceDelete
              }
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Milestones Tab ----
const EMPTY_MILESTONE = {
  title: '', description: '', phase: 'CONSTRUCTION', dueDate: '',
  status: 'NOT_STARTED', sortOrder: '0', ownerId: '', dependsOnId: '',
  linkedDrawScheduleId: '',
};

const MILESTONE_STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: '#94a3b8',
  IN_PROGRESS: '#3b82f6',
  COMPLETED: '#22c55e',
  OVERDUE: '#ef4444',
  BLOCKED: '#f97316',
};

function MilestonesTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useMilestones(projectId);
  const { data: usersData } = useUsers();
  const { data: drawSchedules = [] } = useProjectDrawSchedules(projectId);
  const createMilestone = useCreateMilestone();
  const updateMilestone = useUpdateMilestone();
  const deleteMilestone = useDeleteMilestone();
  const setDependency = useSetMilestoneDependency();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [showGantt, setShowGantt] = useState(false);

  const [form, setForm] = useState<Record<string, string>>(EMPTY_MILESTONE);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const users = (usersData as any[]) || [];

  const openCreate = () => { setEditId(null); setForm({ ...EMPTY_MILESTONE }); onFormOpen(); };
  const openEdit = (m: any) => {
    setEditId(m.id);
    setForm({
      title: m.title || '',
      description: m.description || '',
      phase: m.phase || 'CONSTRUCTION',
      dueDate: m.dueDate ? m.dueDate.slice(0, 10) : '',
      status: m.status || 'NOT_STARTED',
      sortOrder: m.sortOrder?.toString() || '0',
      ownerId: m.ownerId || '',
      dependsOnId: m.dependsOnId || '',
      linkedDrawScheduleId: m.linkedDrawScheduleId || '',
    });
    onFormOpen();
  };
  const openDelete = (id: string) => { setDeleteId(id); onDeleteOpen(); };

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        projectId,
        title: form.title,
        description: form.description || undefined,
        phase: form.phase,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        status: form.status,
        sortOrder: form.sortOrder ? parseInt(form.sortOrder) : 0,
        ownerId: form.ownerId || undefined,
        // Slice 9: when this milestone is marked COMPLETED, the wire-up handler
        // auto-drafts a DrawRequest from the schedule line. Empty string clears.
        linkedDrawScheduleId: form.linkedDrawScheduleId || null,
      };
      if (editId) {
        await updateMilestone.mutateAsync({ id: editId, data: payload });
        // Slice 7: dependency is set via a separate route to allow cycle validation.
        // Always send when editing — the server compares to existing and is a no-op
        // if unchanged. Empty string means "clear the dependency".
        await setDependency.mutateAsync({ id: editId, dependsOnId: form.dependsOnId || null });
        addToast({ title: 'Milestone updated', color: 'success' });
      } else {
        await createMilestone.mutateAsync(payload);
        addToast({ title: 'Milestone created', color: 'success' });
      }
      onFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save milestone'), color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMilestone.mutateAsync(deleteId);
      addToast({ title: 'Milestone deleted', color: 'success' });
      onDeleteClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete milestone'), color: 'danger' });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  if (isLoading) return <LoadingState />;
  const milestones = (data as any[]) || [];

  const sorted = [...milestones].sort((a, b) => {
    if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
    if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const completed = milestones.filter((m: any) => m.status === 'COMPLETED').length;
  const total = milestones.length;

  // Gantt data: each milestone maps to a bar starting at "days from first milestone" to due date
  const ganttData = (() => {
    if (milestones.length === 0) return [];
    const dates = milestones.map((m: any) => new Date(m.dueDate).getTime()).filter(Boolean);
    const minDate = Math.min(...dates);
    return sorted.map((m: any) => {
      const due = new Date(m.dueDate).getTime();
      return {
        name: m.title.length > 22 ? m.title.slice(0, 22) + '…' : m.title,
        daysFromStart: Math.round((due - minDate) / 86400000),
        status: m.status,
        fill: MILESTONE_STATUS_COLOR[m.status] || '#94a3b8',
      };
    });
  })();

  return (
    <div className="mt-4">
      <div className="flex justify-between items-center mb-4">
        <p className="font-semibold text-sm text-gray-600">{milestones.length} milestones</p>
        <div className="flex gap-2">
          <Button size="sm" variant="flat" onPress={() => setShowGantt(!showGantt)}>
            {showGantt ? 'List View' : 'Timeline'}
          </Button>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
            Add Milestone
          </Button>
        </div>
      </div>

      {total > 0 && (
        <Card shadow="sm" className="mb-4">
          <CardBody>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">{completed} of {total} completed</span>
              <span className="text-sm text-gray-500">{((completed / total) * 100).toFixed(0)}%</span>
            </div>
            <Progress value={(completed / total) * 100} size="sm" color="primary" />
          </CardBody>
        </Card>
      )}

      {milestones.length === 0 ? (
        <EmptyState title="No milestones" />
      ) : showGantt ? (
        <Card shadow="sm" className="mb-4">
          <CardBody>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Timeline (days from earliest due date)</p>
            <ResponsiveContainer width="100%" height={Math.max(200, ganttData.length * 36)}>
              <BarChart data={ganttData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" unit="d" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: any) => [`${v} days from start`]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="daysFromStart" radius={[0, 4, 4, 0]}>
                  {ganttData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-3 mt-3 flex-wrap">
              {Object.entries(MILESTONE_STATUS_COLOR).map(([s, c]) => (
                <div key={s} className="flex items-center gap-1 text-xs">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
                  {s.replace(/_/g, ' ')}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Milestone</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Owner</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Phase</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Due Date</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Completed</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m: any) => {
              // Slice 7: blocked-by indicator
              const blockedBy = m.dependsOn && m.dependsOn.status !== 'COMPLETED' ? m.dependsOn : null;
              // Days late = days past due for non-completed milestones
              const daysLate = m.status !== 'COMPLETED' && m.dueDate
                ? Math.floor((Date.now() - new Date(m.dueDate).getTime()) / 86_400_000)
                : 0;
              return (
                <tr key={m.id} className={`border-b border-gray-50 ${m.status === 'OVERDUE' ? 'bg-red-50' : ''}`}>
                  <td className="py-2 px-2 font-medium">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{m.title}</span>
                      {blockedBy && (
                        <Chip size="sm" variant="flat" className="bg-orange-100 text-orange-700 text-[10px]">
                          ⛔ blocked by "{blockedBy.title}"
                        </Chip>
                      )}
                      {(m._count?.photos ?? 0) > 0 && (
                        <Chip size="sm" variant="flat" className="bg-blue-50 text-blue-600 text-[10px]">
                          📷 {m._count.photos}
                        </Chip>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    {m.owner ? (
                      <div className="flex items-center gap-1">
                        <Avatar src={m.owner.avatarUrl} name={m.owner.name} size="sm" className="w-5 h-5 text-xs" />
                        <span className="text-xs text-gray-600">{m.owner.name}</span>
                      </div>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="py-2 px-2"><StatusBadge status={m.phase} /></td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <FiCalendar className="text-gray-400 text-xs" />
                      <span>{fmtDate(m.dueDate)}</span>
                      {daysLate > 0 && (
                        <Chip size="sm" variant="flat" className="bg-red-100 text-red-700 text-[10px]">
                          +{daysLate}d
                        </Chip>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2">{fmtDate(m.completedAt || m.completedDate)}</td>
                  <td className="py-2 px-2"><StatusBadge status={m.status} /></td>
                  <td className="py-2 px-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(m)}><FiEdit2 className="text-xs" /></Button>
                      <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openDelete(m.id)}><FiTrash2 className="text-xs" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}

      {/* Create / Edit Milestone Modal */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit Milestone' : 'Add Milestone'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input size="sm" label="Title" isRequired value={form.title} onChange={set('title')} />
              <Input size="sm" label="Description" value={form.description} onChange={set('description')} />
              <Select
                size="sm"
                label="Phase"
                isRequired
                selectedKeys={form.phase ? [form.phase] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, phase: val }));
                }}
              >
                {['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Due Date" isRequired type="date" value={form.dueDate} onChange={set('dueDate')} />
              <Select
                size="sm"
                label="Status"
                selectedKeys={form.status ? [form.status] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, status: val }));
                }}
              >
                {['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'BLOCKED'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Owner"
                selectedKeys={form.ownerId ? [form.ownerId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setForm((f) => ({ ...f, ownerId: val || '' }));
                }}
              >
                {users.map((u: any) => (
                  <SelectItem key={u.id}>{u.name}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Sort Order" type="number" value={form.sortOrder} onChange={set('sortOrder')} />

              {/* Slice 7: dependency picker — choose another milestone in same project */}
              <Select
                size="sm"
                label="Depends on (blocks until complete)"
                selectedKeys={form.dependsOnId ? [form.dependsOnId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setForm((f) => ({ ...f, dependsOnId: val || '' }));
                }}
                description="Cannot start until the chosen milestone is COMPLETED"
              >
                <>
                  <SelectItem key="">— None —</SelectItem>
                  {((data as any[]) || [])
                    .filter((m: any) => m.id !== editId)
                    .map((m: any) => (
                      <SelectItem key={m.id}>{m.title}</SelectItem>
                    ))}
                </>
              </Select>

              {/* Slice 9: link to a draw schedule line. On COMPLETED, the
                  wire-up handler auto-drafts a DrawRequest with the right amount. */}
              <Select
                size="sm"
                label="Linked draw (auto-drafts on completion)"
                selectedKeys={form.linkedDrawScheduleId ? [form.linkedDrawScheduleId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setForm((f) => ({ ...f, linkedDrawScheduleId: val || '' }));
                }}
                description={
                  drawSchedules.length === 0
                    ? 'Define a draw schedule on a loan first'
                    : 'Marking complete creates a DRAFT draw request'
                }
                isDisabled={drawSchedules.length === 0}
              >
                <>
                  <SelectItem key="">— None —</SelectItem>
                  {drawSchedules.map((s) => (
                    <SelectItem key={s.id}>
                      {s.loanLabel} #{s.drawNumber} — ${Number(s.plannedAmount).toLocaleString()}
                    </SelectItem>
                  ))}
                </>
              </Select>
            </div>

            {/* Slice 7: photo strip — only when editing existing milestone */}
            {editId && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <MilestonePhotoStrip milestoneId={editId} />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSave} isLoading={createMilestone.isPending || updateMilestone.isPending}>
              {editId ? 'Save Changes' : 'Add Milestone'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} isDismissable={false}>
        <ModalContent>
          <ModalHeader>Delete Milestone</ModalHeader>
          <ModalBody><p>This will permanently delete the milestone. Are you sure?</p></ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onDeleteClose}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleDelete} isLoading={deleteMilestone.isPending}>Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Leases Tab ----
const EMPTY_LEASE = {
  unitId: '', tenantName: '', tenantContact: '', monthlyRent: '',
  leaseStart: '', leaseEnd: '', termMonths: '', escalationPct: '',
  securityDeposit: '', status: 'DRAFT', notes: '',
};

function LeasesTab({ projectId }: { projectId: string }) {
  const { data: leases, isLoading: ll } = useLeases(projectId);
  const { data: rentRoll, isLoading: rl } = useRentRoll(projectId);
  const { data: unitsData } = useUnits(projectId);
  const createLease = useCreateLease();
  const updateLease = useUpdateLease();
  const deleteLease = useDeleteLease();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_LEASE);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const units = (unitsData as any[]) || [];

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_LEASE, unitId: units[0]?.id || '' });
    onFormOpen();
  };
  const openEdit = (l: any) => {
    setEditId(l.id);
    setForm({
      unitId: l.unitId || l.unit?.id || '',
      tenantName: l.tenantName || '',
      tenantContact: l.tenantContact || '',
      monthlyRent: l.monthlyRent?.toString() || '',
      leaseStart: (l.leaseStart || l.startDate) ? (l.leaseStart || l.startDate).slice(0, 10) : '',
      leaseEnd: (l.leaseEnd || l.endDate) ? (l.leaseEnd || l.endDate).slice(0, 10) : '',
      termMonths: l.termMonths?.toString() || '',
      escalationPct: (l.escalationPct ?? l.annualEscalation)?.toString() || '',
      securityDeposit: l.securityDeposit?.toString() || '',
      status: l.status || 'DRAFT',
      notes: l.notes || '',
    });
    onFormOpen();
  };
  const openDelete = (id: string) => { setDeleteId(id); onDeleteOpen(); };

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        tenantName: form.tenantName,
        tenantContact: form.tenantContact || undefined,
        monthlyRent: form.monthlyRent ? parseFloat(form.monthlyRent) : 0,
        leaseStart: form.leaseStart ? new Date(form.leaseStart).toISOString() : undefined,
        leaseEnd: form.leaseEnd ? new Date(form.leaseEnd).toISOString() : undefined,
        termMonths: form.termMonths ? parseInt(form.termMonths) : undefined,
        escalationPct: form.escalationPct ? parseFloat(form.escalationPct) : undefined,
        securityDeposit: form.securityDeposit ? parseFloat(form.securityDeposit) : undefined,
        status: form.status,
        notes: form.notes || undefined,
      };
      if (editId) {
        // unitId is immutable on a lease — the UpdateLeaseDto rejects it (forbidNonWhitelisted).
        await updateLease.mutateAsync({ id: editId, data: payload });
        addToast({ title: 'Lease updated', color: 'success' });
      } else {
        await createLease.mutateAsync({ ...payload, unitId: form.unitId });
        addToast({ title: 'Lease created', color: 'success' });
      }
      onFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save lease'), color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteLease.mutateAsync(deleteId);
      addToast({ title: 'Lease deleted', color: 'success' });
      onDeleteClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete lease'), color: 'danger' });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  if (ll || rl) return <LoadingState />;
  const leaseList = (leases as any[]) || [];
  const rr = rentRoll as any;

  return (
    <div className="mt-4">
      <div className="flex justify-between items-center mb-4">
        <p className="font-semibold text-sm text-gray-600">{leaseList.length} leases</p>
        <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
          Add Lease
        </Button>
      </div>

      {rr && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="Active Leases" value={String(rr.activeLeases || rr.leaseCount || 0)} colorScheme="green" variant="revenue" />
          <StatCard label="Monthly Rent" value={fmt(rr.totalMonthlyRent)} colorScheme="brand" variant="revenue" />
          <StatCard label="Annual Rent" value={fmt((rr.totalMonthlyRent || 0) * 12)} colorScheme="purple" variant="revenue" />
        </div>
      )}

      {leaseList.length === 0 ? (
        <EmptyState title="No leases" />
      ) : (
        <Card shadow="sm">
          <CardBody>
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Monthly Rent</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Start</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">End</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Escalation</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leaseList.map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">
                      <div>
                        <span>{l.tenantBrand || l.tenantName}</span>
                        {l.tenantBrand && l.tenantName !== l.tenantBrand && (
                          <span className="text-xs text-gray-400 ml-1">({l.tenantName})</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2">{l.unit?.unitNumber || l.unit?.name || '\u2014'}</td>
                    <td className="py-2 px-2 text-right">{fmt(l.monthlyRent)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseStart || l.startDate)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseEnd || l.endDate)}</td>
                    <td className="py-2 px-2 text-right">{(l.escalationPct ?? l.annualEscalation) ? `${l.escalationPct ?? l.annualEscalation}%` : '\u2014'}</td>
                    <td className="py-2 px-2"><StatusBadge status={l.status} /></td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(l)}><FiEdit2 className="text-xs" /></Button>
                        <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openDelete(l.id)}><FiTrash2 className="text-xs" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </CardBody>
        </Card>
      )}

      {/* Create / Edit Lease Modal */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit Lease' : 'Add Lease'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                size="sm"
                label="Unit"
                isRequired
                selectedKeys={form.unitId ? [form.unitId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, unitId: val }));
                }}
              >
                {units.map((u: any) => (
                  <SelectItem key={u.id}>{u.unitNumber || u.name}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Tenant Name" isRequired value={form.tenantName} onChange={set('tenantName')} />
              <Input size="sm" label="Tenant Contact" value={form.tenantContact} onChange={set('tenantContact')} />
              <Input size="sm" label="Monthly Rent ($)" isRequired type="number" value={form.monthlyRent} onChange={set('monthlyRent')} />
              <Input size="sm" label="Lease Start" isRequired type="date" value={form.leaseStart} onChange={set('leaseStart')} />
              <Input size="sm" label="Lease End" isRequired type="date" value={form.leaseEnd} onChange={set('leaseEnd')} />
              <Input size="sm" label="Term (months)" isRequired type="number" value={form.termMonths} onChange={set('termMonths')} />
              <Input size="sm" label="Escalation %" type="number" value={form.escalationPct} onChange={set('escalationPct')} />
              <Input size="sm" label="Security Deposit ($)" type="number" value={form.securityDeposit} onChange={set('securityDeposit')} />
              <Select
                size="sm"
                label="Status"
                selectedKeys={form.status ? [form.status] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, status: val }));
                }}
              >
                {['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'].map((v) => (
                  <SelectItem key={v}>{v}</SelectItem>
                ))}
              </Select>
              <div className="sm:col-span-2">
                <Input size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSave} isLoading={createLease.isPending || updateLease.isPending}>
              {editId ? 'Save Changes' : 'Add Lease'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} isDismissable={false}>
        <ModalContent>
          <ModalHeader>Delete Lease</ModalHeader>
          <ModalBody><p>This will permanently delete the lease. Are you sure?</p></ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onDeleteClose}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleDelete} isLoading={deleteLease.isPending}>Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Tenant Profiles — inline below each lease row */}
      {leaseList.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-gray-100">
            <FiUsers className="w-4 h-4 text-blue-600" />
            <h2 className="font-semibold text-sm text-gray-800">
              Tenant Profiles <span className="text-gray-400 font-normal">({leaseList.length})</span>
            </h2>
          </div>
          <div className="p-4 sm:p-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
            {leaseList.map((l: any) => (
              <div
                key={`profile-${l.id}`}
                className="rounded-xl border border-gray-200 bg-gray-50/40 p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    Unit {l.unit?.unitNumber || '—'}
                  </span>
                  <span className="text-xs text-gray-400 truncate">{l.tenantBrand || l.tenantName}</span>
                </div>
                <TenantProfilePanel lease={l} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Sales Tab ----
const EMPTY_SALE = {
  unitId: '', buyer: '', salePrice: '', depositAmt: '', status: 'PROSPECT',
  loiDate: '', contractDate: '', closingDate: '', notes: '',
  lostReason: '', lostReasonNote: '', expectedCloseDate: '',
  brokerId: '', brokerCommissionPct: '',
};

const LOST_REASONS = [
  { key: 'PRICE_TOO_HIGH', label: 'Price too high' },
  { key: 'FINANCING_FELL_THROUGH', label: 'Financing fell through' },
  { key: 'CHOSE_COMPETITOR', label: 'Chose a competitor' },
  { key: 'TIMING_OFF', label: 'Timing off' },
  { key: 'NO_RESPONSE', label: 'No response / went cold' },
  { key: 'OTHER', label: 'Other' },
];

function SalesTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSalesPipeline(projectId);
  const { data: forecast } = useSalesForecast(projectId);
  const { data: unitsData } = useUnits(projectId);
  const createSale = useCreateSale();
  const updateSale = useUpdateSale();
  const deleteSale = useDeleteSale();
  const approveDiscount = useApproveSaleDiscount();
  const { data: brokersData } = useBrokers();
  const brokers = (brokersData as any[]) || [];

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const { isOpen: isPayOpen, onOpen: onPayOpen, onClose: onPayClose } = useDisclosure();
  const { isOpen: isCancelOpen, onOpen: onCancelOpen, onClose: onCancelClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_SALE);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [paySale, setPaySale] = useState<any>(null);
  const [cancelSale, setCancelSale] = useState<any>(null);
  // Board UX: collapse a column to a slim rail, expand a card to reveal full detail + actions.
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const toggleStage = (stage: string) =>
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      next.has(stage) ? next.delete(stage) : next.add(stage);
      return next;
    });

  const units = (unitsData as any[]) || [];

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_SALE, unitId: units[0]?.id || '' });
    onFormOpen();
  };
  const openEdit = (s: any) => {
    setEditId(s.id);
    setForm({
      unitId: s.unitId || s.unit?.id || '',
      buyer: s.buyer || s.buyerName || '',
      salePrice: s.salePrice?.toString() || '',
      depositAmt: s.depositAmt?.toString() || '',
      status: s.status || 'PROSPECT',
      loiDate: s.loiDate ? s.loiDate.slice(0, 10) : '',
      contractDate: s.contractDate ? s.contractDate.slice(0, 10) : '',
      closingDate: s.closingDate ? s.closingDate.slice(0, 10) : '',
      notes: s.notes || '',
      brokerId: s.brokerId || '',
      brokerCommissionPct: s.brokerCommissionPct != null ? String(s.brokerCommissionPct) : '',
    });
    onFormOpen();
  };
  const openDelete = (id: string) => { setDeleteId(id); onDeleteOpen(); };

  const handleSave = async () => {
    // Slice 6: forced lost-reason picker — frontend insists before submit so the
    // user understands the audit captures *why* deals die.
    if (form.status === 'CANCELLED' && !form.lostReason) {
      addToast({ title: 'Pick a reason — why was this deal lost?', color: 'warning' });
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        projectId,
        unitId: form.unitId,
        buyer: form.buyer || undefined,
        salePrice: form.salePrice ? parseFloat(form.salePrice) : undefined,
        depositAmt: form.depositAmt ? parseFloat(form.depositAmt) : undefined,
        status: form.status,
        loiDate: form.loiDate ? new Date(form.loiDate).toISOString() : undefined,
        contractDate: form.contractDate ? new Date(form.contractDate).toISOString() : undefined,
        closingDate: form.closingDate ? new Date(form.closingDate).toISOString() : undefined,
        expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate).toISOString() : undefined,
        notes: form.notes || undefined,
        lostReason: form.status === 'CANCELLED' ? form.lostReason : undefined,
        lostReasonNote: form.status === 'CANCELLED' ? (form.lostReasonNote || undefined) : undefined,
        brokerId: form.brokerId || undefined,
        brokerCommissionPct: form.brokerCommissionPct ? parseFloat(form.brokerCommissionPct) : undefined,
      };
      if (editId) {
        await updateSale.mutateAsync({ id: editId, data: payload });
        addToast({ title: 'Sale updated', color: 'success' });
      } else {
        await createSale.mutateAsync(payload);
        addToast({ title: 'Sale created', color: 'success' });
      }
      onFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save sale'), color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteSale.mutateAsync(deleteId);
      addToast({ title: 'Sale deleted', color: 'success' });
      onDeleteClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete sale'), color: 'danger' });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  if (isLoading) return <LoadingState />;

  const pipeline = data as any;
  const byStatus = pipeline?.byStatus || pipeline || {};
  const stages = ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED', 'CANCELLED'];
  const allSales = stages.flatMap((stage) => (byStatus[stage] || []));

  const STAGE_TOP_COLOR: Record<string, string> = {
    PROSPECT: 'border-t-gray-400',
    LOI_SIGNED: 'border-t-blue-400',
    UNDER_CONTRACT: 'border-t-orange-400',
    CLOSED: 'border-t-green-500',
    CANCELLED: 'border-t-red-400',
  };
  const STAGE_BG: Record<string, string> = {
    PROSPECT: 'bg-gray-50',
    LOI_SIGNED: 'bg-blue-50',
    UNDER_CONTRACT: 'bg-orange-50',
    CLOSED: 'bg-green-50',
    CANCELLED: 'bg-red-50',
  };

  return (
    <div className="mt-4">
      {/* Velocity metrics */}
      {allSales.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard label="Total Pipeline" value={fmt(pipeline?.totalPipelineValue || 0)} colorScheme="brand" variant="revenue" />
          {/* Slice 6: weighted forecast \u2014 what you actually pitch to lenders */}
          <StatCard
            label="Weighted Forecast"
            value={fmt(forecast?.weightedForecast || 0)}
            helpText="Probability-adjusted"
            colorScheme="blue"
            variant="revenue"
          />
          <StatCard label="Avg Days to Close" value={pipeline?.avgDaysToClose != null ? `${pipeline.avgDaysToClose}d` : '\u2014'} colorScheme="gray" variant="neutral" />
          <StatCard label="Total Deals" value={String(allSales.length)} colorScheme="gray" variant="neutral" />
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <p className="font-semibold text-sm text-gray-600">{allSales.length} sales</p>
        <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
          Add Sale
        </Button>
      </div>

      {!allSales.length ? (
        <EmptyState title="No sales activity" />
      ) : (
        /* Kanban board \u2014 horizontal scroll keeps the funnel intact at any width;
           columns collapse to a slim rail, cards expand inline for full detail + actions. */
        <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
          {stages.map((stage) => {
            const sales = byStatus[stage] || [];
            const colValue = sales.reduce((s: number, x: any) => s + Number(x.salePrice || 0), 0);
            const collapsed = collapsedStages.has(stage);
            const label = stage.replace(/_/g, ' ');

            // Collapsed: slim vertical rail \u2014 click anywhere to expand.
            if (collapsed) {
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => toggleStage(stage)}
                  title={`Expand ${label}`}
                  className={`group flex w-11 shrink-0 flex-col items-center gap-2 rounded-lg border-2 border-t-4 ${STAGE_TOP_COLOR[stage]} ${STAGE_BG[stage]} py-3 transition hover:brightness-95`}
                >
                  <FiChevronRight className="text-gray-400 group-hover:text-gray-600" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 [writing-mode:vertical-rl] rotate-180">{label}</span>
                  <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/70 px-1.5 text-[11px] font-bold text-gray-600">{sales.length}</span>
                </button>
              );
            }

            return (
              <div key={stage} className={`flex min-w-[250px] flex-1 flex-col rounded-lg border-2 border-t-4 ${STAGE_TOP_COLOR[stage]} ${STAGE_BG[stage]}`}>
                {/* Column header */}
                <div className="flex items-center justify-between gap-1 p-3 pb-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button type="button" onClick={() => toggleStage(stage)} title="Collapse column" className="shrink-0 text-gray-400 hover:text-gray-600">
                      <FiChevronLeft />
                    </button>
                    <StatusBadge status={stage} />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {/* Slice 6: probability chip on column header */}
                    <ProbabilityChip stage={stage} size="sm" />
                    {/* Document gate chip: aggregate status for all sales in this stage */}
                    {(SALE_STAGE_DOCS[stage]?.length ?? 0) > 0 && sales.length > 0 && (
                      <DocumentGateChip docs={sales.flatMap((s: any) => s.documents ?? [])} required={SALE_STAGE_DOCS[stage]} compact />
                    )}
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/70 px-1.5 text-[11px] font-bold text-gray-600">{sales.length}</span>
                  </div>
                </div>
                {colValue > 0 && (
                  <p className="-mt-1 mb-1 px-3 text-xs font-semibold tabular-nums text-gray-500">{fmt(colValue)}</p>
                )}
                {/* Scrollable card list \u2014 caps board height even with 50+ closed deals */}
                <div className="max-h-[58vh] flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                  {sales.map((s: any) => {
                    const isOpen = expandedSale === s.id;
                    const asking = s.unit?.askingPrice ? Number(s.unit.askingPrice) : null;
                    const price = s.salePrice ? Number(s.salePrice) : null;
                    const discountPct = asking && price && price < asking ? ((asking - price) / asking) * 100 : null;
                    return (
                      <div key={s.id} className="rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow">
                        {/* Compact summary \u2014 click to expand */}
                        <button type="button" onClick={() => setExpandedSale(isOpen ? null : s.id)} className="flex w-full items-start gap-2 p-2.5 text-left">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-800">{s.buyer || s.buyerName || 'Unnamed'}</p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              Unit {s.unit?.unitNumber || '\u2014'}
                              {price != null && <span className="ml-1.5 font-medium text-gray-700">{fmt(price)}</span>}
                            </p>
                            {discountPct != null && (
                              s.discountApprovedAt ? (
                                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-green-600">
                                  <FiCheck className="shrink-0" /> {discountPct.toFixed(0)}% discount approved
                                </span>
                              ) : (
                                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                                  <FiAlertTriangle className="shrink-0" /> {discountPct.toFixed(0)}% discount
                                </span>
                              )
                            )}
                          </div>
                          <FiChevronDown className={`mt-0.5 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {/* Expanded detail + actions */}
                        {isOpen && (
                          <div className="space-y-1.5 border-t border-gray-100 px-2.5 py-2">
                            {s.closingDate && (
                              <div className="flex justify-between text-xs"><span className="text-gray-400">Closes</span><span className="text-gray-600">{fmtDate(s.closingDate)}</span></div>
                            )}
                            {s.depositAmt && (
                              <div className="flex justify-between text-xs"><span className="text-gray-400">Deposit</span><span className="text-gray-600">{fmt(Number(s.depositAmt))}</span></div>
                            )}
                            {discountPct != null && !s.discountApprovedAt && (
                              <PermissionGate permission="sales:approve-discount">
                                <Button
                                  size="sm" variant="flat" color="warning" fullWidth className="h-7 text-xs"
                                  startContent={<FiCheck />}
                                  isLoading={approveDiscount.isPending}
                                  onPress={() => approveDiscount.mutate(s.id, {
                                    onSuccess: () => addToast({ title: 'Discount approved', color: 'success' }),
                                    onError: (e) => addToast({ title: errMsg(e, 'Failed to approve'), color: 'danger' }),
                                  })}
                                >
                                  Approve {discountPct.toFixed(0)}% discount
                                </Button>
                              </PermissionGate>
                            )}
                            <div className="flex items-center gap-1 pt-1">
                              <Button size="sm" variant="flat" className="h-7 flex-1 text-xs" startContent={<FiDollarSign />} onPress={() => { setPaySale(s); onPayOpen(); }}>Payments</Button>
                              <Button size="sm" variant="flat" className="h-7 flex-1 text-xs" startContent={<FiEdit2 />} onPress={() => openEdit(s)}>Edit</Button>
                              {s.status !== 'CANCELLED' && s.status !== 'CLOSED' && (
                                <Button size="sm" variant="light" color="warning" isIconOnly className="h-7 w-7 min-w-7" aria-label="Cancel sale" onPress={() => { setCancelSale(s); onCancelOpen(); }}><FiX /></Button>
                              )}
                              <Button size="sm" variant="light" color="danger" isIconOnly className="h-7 w-7 min-w-7" aria-label="Delete sale" onPress={() => openDelete(s.id)}><FiTrash2 /></Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {sales.length === 0 && (
                    <p className="py-6 text-center text-xs italic text-gray-400">Empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sale Payment Schedule Modal */}
      <Modal isOpen={isPayOpen} onClose={onPayClose} size="lg">
        <ModalContent>
          <ModalHeader>
            Payment schedule — {paySale?.buyer || paySale?.buyerName || 'Sale'}
          </ModalHeader>
          <ModalBody className="pb-6">
            {paySale && (
              <SalePaymentPanel saleId={paySale.id} salePrice={paySale.salePrice ? Number(paySale.salePrice) : undefined} />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Create / Edit Sale Modal */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit Sale' : 'Add Sale'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                size="sm"
                label="Unit"
                isRequired
                selectedKeys={form.unitId ? [form.unitId] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, unitId: val }));
                }}
              >
                {units.map((u: any) => (
                  <SelectItem key={u.id}>{u.unitNumber || u.name}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Buyer" value={form.buyer} onChange={set('buyer')} />
              <Input size="sm" label="Sale Price ($)" type="number" value={form.salePrice} onChange={set('salePrice')} />
              <Input size="sm" label="Deposit Amount ($)" type="number" value={form.depositAmt} onChange={set('depositAmt')} />
              <Select
                size="sm"
                label="Status"
                selectedKeys={form.status ? [form.status] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, status: val }));
                }}
              >
                {['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT', 'CLOSED', 'CANCELLED'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="LOI Date" type="date" value={form.loiDate} onChange={set('loiDate')} />
              <Input size="sm" label="Contract Date" type="date" value={form.contractDate} onChange={set('contractDate')} />
              <Input size="sm" label="Closing Date" type="date" value={form.closingDate} onChange={set('closingDate')} />
              <Input size="sm" label="Expected Close" type="date" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} />

              {/* Phase 4: broker attribution — commission is stamped on close */}
              <Select
                size="sm"
                label="Broker (optional)"
                selectedKeys={form.brokerId ? [form.brokerId] : []}
                onSelectionChange={(keys) => setForm((f) => ({ ...f, brokerId: (Array.from(keys)[0] as string) || '' }))}
              >
                {[{ id: '', name: '— none —', company: '' }, ...brokers].map((b: any) => (
                  <SelectItem key={b.id}>{b.id ? `${b.name}${b.company ? ` · ${b.company}` : ''}` : '— none —'}</SelectItem>
                ))}
              </Select>
              {form.brokerId && (
                <Input
                  size="sm" type="number" label="Commission % override"
                  value={form.brokerCommissionPct} onChange={set('brokerCommissionPct')}
                  description="Blank = broker default; stamped on close"
                />
              )}

              {/* Slice 6: lost-reason picker — only shown when cancelling */}
              {form.status === 'CANCELLED' && (
                <>
                  <Select
                    size="sm"
                    label="Why lost?"
                    isRequired
                    description="Captured for the lost-deal heatmap"
                    selectedKeys={form.lostReason ? [form.lostReason] : []}
                    onSelectionChange={(keys) => {
                      const val = Array.from(keys)[0] as string;
                      if (val) setForm((f) => ({ ...f, lostReason: val }));
                    }}
                  >
                    {LOST_REASONS.map((r) => (
                      <SelectItem key={r.key}>{r.label}</SelectItem>
                    ))}
                  </Select>
                  <Input size="sm" label="Reason note (optional)" value={form.lostReasonNote} onChange={set('lostReasonNote')} />
                </>
              )}

              <div className="sm:col-span-2">
                <Input size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSave} isLoading={createSale.isPending || updateSale.isPending}>
              {editId ? 'Save Changes' : 'Add Sale'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} isDismissable={false}>
        <ModalContent>
          <ModalHeader>Delete Sale</ModalHeader>
          <ModalBody><p>This will permanently delete the sale record. Are you sure?</p></ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onDeleteClose}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleDelete} isLoading={deleteSale.isPending}>Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Cancel Sale — structured flow */}
      {cancelSale && (
        <CancelSaleModal
          isOpen={isCancelOpen}
          onClose={() => { onCancelClose(); setCancelSale(null); }}
          sale={{
            id: cancelSale.id,
            projectId,
            unitNumber: cancelSale.unit?.unitNumber,
            buyerName: cancelSale.buyer || cancelSale.buyerName,
            salePrice: cancelSale.salePrice ? Number(cancelSale.salePrice) : undefined,
          }}
        />
      )}
    </div>
  );
}

// ---- Buildings Tab ----
const EMPTY_BUILDING = { name: '', totalSqft: '', stories: '', buildingType: '', phase: 'PRE_DEVELOPMENT', coverPhotoPath: '' };

function BuildingsTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('building:edit');

  const { data, isLoading, error } = useBuildings(projectId);
  const createBuilding = useCreateBuilding();
  const updateBuilding = useUpdateBuilding();
  const deleteBuilding = useDeleteBuilding();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_BUILDING);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; unitCount: number } | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [buildingSearch, setBuildingSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_BUILDING });
    setFormErrors({});
    onFormOpen();
  };

  const openEdit = (b: any) => {
    setEditId(b.id);
    setForm({
      name: b.name || '',
      totalSqft: b.totalSqft?.toString() || '',
      stories: b.stories?.toString() || '',
      buildingType: b.buildingType || '',
      phase: b.phase || 'PRE_DEVELOPMENT',
      coverPhotoPath: b.coverPhotoPath || '',
    });
    setFormErrors({});
    onFormOpen();
  };

  const openDelete = (b: any) => {
    setDeleteTarget({
      id: b.id,
      name: b.name,
      unitCount: b._count?.units ?? b.units?.length ?? 0,
    });
    setForceDelete(false);
    onDeleteOpen();
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Building name is required';
    else if (form.name.length > 120) errs.name = 'Max 120 characters';

    if (form.totalSqft) {
      const v = parseFloat(form.totalSqft);
      if (isNaN(v) || v <= 0) errs.totalSqft = 'Must be a positive number';
    }
    if (form.stories) {
      const v = parseInt(form.stories);
      if (isNaN(v) || v < 1 || v > 200) errs.stories = 'Must be between 1 and 200';
    }
    // buildingType is now an enum — no length check needed

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    try {
      const payload: Record<string, unknown> = {
        projectId,
        name: form.name.trim(),
        totalSqft: form.totalSqft ? parseFloat(form.totalSqft) : undefined,
        stories: form.stories ? parseInt(form.stories) : undefined,
        buildingType: form.buildingType.trim() || undefined,
        phase: form.phase || undefined,
        coverPhotoPath: form.coverPhotoPath || undefined,
      };
      if (editId) {
        // Don't send projectId on update (the API DTO omits it)
        const { projectId: _omit, ...updateData } = payload;
        await updateBuilding.mutateAsync({ id: editId, data: updateData });
        addToast({ title: 'Building updated', color: 'success' });
      } else {
        await createBuilding.mutateAsync(payload);
        addToast({ title: 'Building created', color: 'success' });
      }
      onFormClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save building'), color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteBuilding.mutateAsync({
        id: deleteTarget.id,
        force: deleteTarget.unitCount > 0 ? forceDelete : undefined,
      });
      addToast({ title: 'Building deleted', color: 'success' });
      onDeleteClose();
      setDeleteTarget(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete building'), color: 'danger' });
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (formErrors[field]) setFormErrors((errs) => ({ ...errs, [field]: '' }));
  };

  const allBuildings = (data as any[]) || [];
  const searchLower = buildingSearch.trim().toLowerCase();
  const buildings = allBuildings.filter((b: any) => {
    if (typeFilter && b.buildingType !== typeFilter) return false;
    if (searchLower && !(b.name || '').toLowerCase().includes(searchLower)) return false;
    return true;
  });
  const buildingTypes = Array.from(new Set(allBuildings.map((b: any) => b.buildingType).filter(Boolean))) as string[];

  return (
    <div className="mt-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          {!isLoading && (
            <p className="font-semibold text-sm text-gray-600">
              {buildings.length} building{buildings.length !== 1 ? '' : ''}
              {buildings.length !== allBuildings.length && (
                <span className="text-gray-400 font-normal"> of {allBuildings.length}</span>
              )}
            </p>
          )}
          {allBuildings.length > 0 && (
            <Input
              size="sm"
              placeholder="Search building name…"
              value={buildingSearch}
              onChange={(e) => setBuildingSearch(e.target.value)}
              startContent={<FiSearch className="text-gray-400 w-3.5 h-3.5" />}
              className="w-full sm:w-[220px]"
              isClearable
              onClear={() => setBuildingSearch('')}
              aria-label="Search buildings by name"
            />
          )}
          {buildingTypes.length > 1 && (
            <Select
              size="sm"
              aria-label="Filter by building type"
              placeholder="All types"
              className="w-full sm:w-[160px]"
              selectedKeys={typeFilter ? new Set([typeFilter]) : new Set()}
              onSelectionChange={(keys) => setTypeFilter((Array.from(keys)[0] as string) || '')}
            >
              {buildingTypes.map((t) => (
                <SelectItem key={t}>{t.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
          )}
          {(buildingSearch || typeFilter) && (
            <Button
              size="sm"
              variant="light"
              onPress={() => { setBuildingSearch(''); setTypeFilter(''); }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {canEdit && (
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
            Add Building
          </Button>
        )}
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} shadow="sm">
              <CardBody className="space-y-2">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-3">
                  <Skeleton className="h-6 rounded" />
                  <Skeleton className="h-6 rounded" />
                  <Skeleton className="h-6 rounded" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && error && <ErrorState message="Could not load buildings." />}

      {!isLoading && !error && buildings.length === 0 && allBuildings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-gray-600">No buildings yet</p>
          <p className="text-xs text-gray-400 mt-1">Add the first building to start tracking units.</p>
          {canEdit && (
            <Button size="sm" color="primary" startContent={<FiPlus />} className="mt-3" onPress={openCreate}>
              Add Building
            </Button>
          )}
        </div>
      )}

      {!isLoading && !error && buildings.length === 0 && allBuildings.length > 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-gray-600">No buildings match your filters</p>
          <Button
            size="sm"
            variant="flat"
            className="mt-3"
            onPress={() => { setBuildingSearch(''); setTypeFilter(''); }}
          >
            Clear filters
          </Button>
        </div>
      )}

      {!isLoading && !error && buildings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buildings.map((b: any) => (
            <Card key={b.id} shadow="sm">
              {/* Slice 1: cover photo — bleeds to card edges as visual identity */}
              {b.coverPhotoPath && (
                <div className="w-full h-28 bg-gray-100 overflow-hidden">
                  <img
                    src={`${import.meta.env.VITE_SUPABASE_URL || 'https://dxkqrwxixjyzxhtxdkht.supabase.co'}/storage/v1/object/public/documents/${b.coverPhotoPath}`}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                  />
                </div>
              )}
              <CardHeader className="pb-0 flex justify-between items-start">
                <div className="flex-1 min-w-0 pr-2">
                  {/* Sprint B: building name links to the per-building dashboard */}
                  <Link
                    to={`/projects/${projectId}/buildings/${b.id}`}
                    className="font-semibold text-sm truncate text-gray-900 hover:text-blue-600 hover:underline block"
                  >
                    {b.name}
                  </Link>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {b.buildingType && (
                      <span className="text-xs text-gray-400 truncate">{b.buildingType}</span>
                    )}
                    {/* Slice 3: building-level phase chip */}
                    {b.phase && <PhaseChip phase={b.phase} size="sm" />}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(b)} aria-label="Edit building">
                      <FiEdit2 className="text-xs" />
                    </Button>
                    <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openDelete(b)} aria-label="Delete building">
                      <FiTrash2 className="text-xs" />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardBody className="pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Units</p>
                    <p className="font-medium">{b._count?.units ?? b.units?.length ?? 0}</p>
                  </div>
                  {b.totalSqft && (
                    <div>
                      <p className="text-xs text-gray-400">Total sqft</p>
                      <p className="font-medium">{Number(b.totalSqft).toLocaleString()}</p>
                    </div>
                  )}
                  {b.stories && (
                    <div>
                      <p className="text-xs text-gray-400">Stories</p>
                      <p className="font-medium">{b.stories}</p>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Building Modal */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="md">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit Building' : 'Add Building'}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Input
                  size="sm" label="Building Name" isRequired
                  value={form.name} onChange={set('name')}
                  isInvalid={!!formErrors.name} errorMessage={formErrors.name}
                />
              </div>
              <Select
                size="sm" label="Building Type"
                selectedKeys={form.buildingType ? [form.buildingType] : []}
                onSelectionChange={(k) => {
                  const val = Array.from(k)[0] as string;
                  setForm((f) => ({ ...f, buildingType: val || '' }));
                }}
              >
                {['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL', 'PARKING', 'AMENITY', 'RETAIL', 'OFFICE'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input
                size="sm" label="Total Sqft" type="number" step="1"
                value={form.totalSqft} onChange={set('totalSqft')}
                isInvalid={!!formErrors.totalSqft} errorMessage={formErrors.totalSqft}
              />
              <Input
                size="sm" label="Stories" type="number" min={1} max={200}
                value={form.stories} onChange={set('stories')}
                isInvalid={!!formErrors.stories} errorMessage={formErrors.stories}
              />
              {/* Slice 3: building-level phase — Project.phase is derived from max of buildings */}
              <div className="sm:col-span-2">
                <Select
                  size="sm" label="Phase"
                  description="Project phase is automatically the most-advanced building"
                  selectedKeys={form.phase ? [form.phase] : []}
                  onSelectionChange={(k) => {
                    const val = Array.from(k)[0] as string;
                    if (val) setForm((f) => ({ ...f, phase: val }));
                  }}
                >
                  {['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'].map((v) => (
                    <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </Select>
              </div>

              {/* Slice 1: cover photo — visual identity for the building card */}
              <div className="sm:col-span-2">
                <BuildingCoverPhotoUploader
                  storagePath={form.coverPhotoPath}
                  onChange={(path) => setForm((f) => ({ ...f, coverPhotoPath: path }))}
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onFormClose}>Cancel</Button>
            <Button size="sm" color="primary" onPress={handleSave} isLoading={createBuilding.isPending || updateBuilding.isPending}>
              {editId ? 'Save Changes' : 'Add Building'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation — shows unit count and requires explicit force checkbox */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} isDismissable={false} size="sm">
        <ModalContent>
          <ModalHeader>Delete Building</ModalHeader>
          <ModalBody>
            {deleteTarget && (
              <>
                <p className="text-sm text-gray-700">
                  Delete <strong>{deleteTarget.name}</strong>?
                </p>
                {deleteTarget.unitCount > 0 ? (
                  <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                    <p className="font-semibold mb-1">⚠ This building has {deleteTarget.unitCount} unit{deleteTarget.unitCount === 1 ? '' : 's'}</p>
                    <p>Deleting will permanently remove all units, leases, and sales attached to this building. This cannot be undone.</p>
                    <label className="flex items-start gap-2 mt-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={forceDelete}
                        onChange={(e) => setForceDelete(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>Yes, I understand — delete the building and all {deleteTarget.unitCount} unit{deleteTarget.unitCount === 1 ? '' : 's'}</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-2">This building has no units. Safe to delete.</p>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onDeleteClose}>Cancel</Button>
            <Button
              size="sm"
              color="danger"
              onPress={handleDelete}
              isLoading={deleteBuilding.isPending}
              isDisabled={!!deleteTarget && deleteTarget.unitCount > 0 && !forceDelete}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Construction Tab (Buildings + Budget & Costs) ----
function ConstructionTab({ projectId }: { projectId: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-0">🏗️ Buildings</p>
      <BuildingsTab projectId={projectId} />
      <PermissionGate permission="dailylog:view">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mt-8 mb-2">📋 Daily Logs</p>
        <DailyLogFeed projectId={projectId} />
      </PermissionGate>
      {/* Budget & Costs now lives in its own top-level Budget tab. */}
    </div>
  );
}

// ---- Budget Tab (locked total budget + Budget & Costs + day-wise change log) ----
function BudgetTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  // Admin (Super Admin), Founder, Finance & Accounting hold budget:edit and may revise the total.
  const canEditBudget = hasPermission('budget:edit');
  const budgetLinesRef = React.useRef<HTMLDivElement>(null);
  const scrollToLines = () => budgetLinesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const { data: summary } = useFinancialSummary(projectId);
  const { data: revisions = [] } = useProjectBudgetRevisions(projectId);
  const s = summary as any;

  // Total = sum of revised budget across all lines (mirrors FinancialsTab's totals).
  const totalBudget = Number(s?.budgetTotal ?? 0);
  const totalActuals = Number(s?.actualTotal ?? 0);
  const totalCommitted = Number(s?.committedTotal ?? 0);
  const remaining = totalBudget - totalActuals - totalCommitted;
  const usedPct = totalBudget > 0 ? Math.round(((totalActuals + totalCommitted) / totalBudget) * 100) : 0;

  const revList = revisions as any[];
  const reasonLabel = (r: string) => (r || '').replace(/_/g, ' ').toLowerCase();

  return (
    <div className="mt-4 space-y-6">
      <PermissionGate
        permission="budget:view"
        fallback={<EmptyState title="No access" message="You don't have permission to view budget data." />}
      >
        {/* Total budget banner — editable by Admin / Finance / Founder (budget:edit). */}
        <Card shadow="sm" className="border border-amber-100 bg-amber-50">
          <CardBody className="p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Total Project Budget</p>
              {canEditBudget ? (
                <Button size="sm" color="warning" variant="flat" startContent={<FiEdit2 className="text-[11px]" />} onPress={scrollToLines}>
                  Edit budget
                </Button>
              ) : (
                <Chip size="sm" variant="flat" startContent={<FiLock className="text-[11px]" />} className="bg-amber-100 text-amber-700">
                  Read-only
                </Chip>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{fmt(totalBudget)}</p>
            <Progress aria-label="Budget used" value={usedPct} size="sm" className="mt-3" color={usedPct > 100 ? 'danger' : 'warning'} />
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Actuals</p>
                <p className="text-sm font-semibold text-orange-600 tabular-nums">{fmt(totalActuals)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Committed</p>
                <p className="text-sm font-semibold text-purple-600 tabular-nums">{fmt(totalCommitted)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Remaining</p>
                <p className={`text-sm font-semibold tabular-nums ${remaining >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(remaining)}</p>
              </div>
            </div>
            <p className="text-[11px] text-amber-700/80 mt-3">
              {canEditBudget
                ? 'The total is the sum of the budget lines below — add or revise a line to change it. Every change is logged.'
                : 'The total is set by the budget lines below. Editing is limited to Admin, Finance and Founder.'}
            </p>
          </CardBody>
        </Card>

        {/* Existing Budget & Costs (moved here from the Construction tab) */}
        <div ref={budgetLinesRef}>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-0">📊 Budget &amp; Costs</p>
          <FinancialsTab projectId={projectId} />
        </div>

        {/* Day-wise budget change log (append-only revision history) */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-2">🗓️ Budget Change Log</p>
          {revList.length === 0 ? (
            <EmptyState title="No changes yet" message="Budget line revisions will appear here as a dated timeline." />
          ) : (
            <Card shadow="sm">
              <CardBody className="p-0 divide-y divide-gray-100">
                {revList.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 p-3">
                    <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[11px] font-bold">
                      v{r.revisionNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {r.budgetLine?.description || 'Budget line'}
                          {r.budgetLine?.category && (
                            <span className="ml-2 text-[11px] text-gray-400">{(r.budgetLine.category as string).replace(/_/g, ' ')}</span>
                          )}
                        </p>
                        <span className="text-sm font-semibold tabular-nums text-gray-900 shrink-0">{fmt(Number(r.amount))}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="capitalize">{reasonLabel(r.changeReason)}</span>
                        {r.reason ? ` — ${r.reason}` : ''}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {r.createdBy?.name || 'Someone'} · {fmtDate(r.createdAt)}
                        {r.approvedAt ? ` · approved ${fmtDate(r.approvedAt)}` : ' · pending approval'}
                      </p>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </PermissionGate>
    </div>
  );
}

// ---- Revenue Tab (Sales Pipeline + Leases / Ren t Roll) ----
function RevenueTab({ projectId }: { projectId: string }) {
  const { data: pipeline } = useSalesPipeline(projectId);
  const { data: leaseIncome } = useMonthlyLeaseIncome(projectId);

  const pip = pipeline as any;
  const li = leaseIncome as any;

  const closedSalesValue = (pip?.CLOSED || []).reduce((s: number, sale: any) => s + (sale.salePrice || 0), 0);
  const underContractCount = (pip?.UNDER_CONTRACT || []).length;
  const monthlyLease = li?.total || 0;

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-3">Revenue & Sales</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Closed Sales" value={fmt(closedSalesValue)} variant="revenue" colorScheme="green" />
        <StatCard label="Under Contract" value={String(underContractCount)} variant="revenue" colorScheme="brand" />
        <StatCard label="Monthly Lease Income" value={fmt(monthlyLease)} variant="revenue" colorScheme="teal" />
        <StatCard label="Annual Rent" value={fmt(monthlyLease * 12)} variant="revenue" colorScheme="blue" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-0">Sales Pipeline</p>
      <SalesTab projectId={projectId} />
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mt-8 mb-0">Leases / Rent Roll</p>
      <LeasesTab projectId={projectId} />
    </div>
  );
}

// ---- Project Leads Tab ----
const LEAD_STATUSES_TAB = ['NEW', 'CONTACTED', 'POTENTIAL', 'QUALIFIED', 'SITE_VISIT', 'PROPOSAL_SENT', 'NEGOTIATING', 'CONVERTED', 'LOST', 'DEAD'];
const LEAD_SOURCES_TAB = ['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'WALK_IN', 'BROKER', 'EVENT', 'OTHER'];
const SOURCE_LABELS_TAB: Record<string, string> = {
  WEBSITE: 'Website', REFERRAL: 'Referral', SOCIAL_MEDIA: 'Social Media',
  WALK_IN: 'Walk-In', BROKER: 'Broker', EVENT: 'Event', OTHER: 'Other',
};
const LEAD_STATUS_COLORS_TAB: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  NEW: 'default', CONTACTED: 'primary', POTENTIAL: 'primary', QUALIFIED: 'secondary', SITE_VISIT: 'secondary',
  PROPOSAL_SENT: 'warning', NEGOTIATING: 'warning', CONVERTED: 'success', LOST: 'danger', DEAD: 'danger',
};
const ACTIVITY_TYPES_TAB = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'FOLLOW_UP', 'NOTE', 'STATUS_CHANGE'];
const ACTIVITY_ICONS_TAB: Record<string, string> = {
  CALL: '📞', EMAIL: '📧', MEETING: '🤝', SITE_VISIT: '🏗️', FOLLOW_UP: '🔔', NOTE: '📝', STATUS_CHANGE: '🔄',
};

function ProjectLeadsTab({ projectId }: { projectId: string }) {
  const { data: leads, isLoading } = useLeads({ projectId } as any);
  const { data: projectUnits } = useUnits(projectId);
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const addActivity = useAddLeadActivity();
  const convertLead = useConvertLead();

  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [editLead, setEditLead] = useState<any>(null);
  const [activityNote, setActivityNote] = useState('');
  const [activityType, setActivityType] = useState('NOTE');
  const [convertForm, setConvertForm] = useState({ unitId: '', buyer: '', salePrice: '', contractDate: '', closingDate: '' });
  const setCF = (f: string, v: string) => setConvertForm((prev) => ({ ...prev, [f]: v }));

  const { data: activities } = useLeadActivities(selectedLead?.id || '');

  const [form, setForm] = useState({ name: '', email: '', phone: '', source: 'WEBSITE', status: 'NEW', unitId: '', unitInterest: '', budget: '', notes: '' });
  const setF = (f: string, v: string) => setForm((prev) => ({ ...prev, [f]: v }));

  const resetForm = () => setForm({ name: '', email: '', phone: '', source: 'WEBSITE', status: 'NEW', unitId: '', unitInterest: '', budget: '', notes: '' });

  const openNewForm = () => { resetForm(); setEditLead(null); setShowForm(true); };
  const openEditForm = (lead: any) => {
    setForm({ name: lead.name || '', email: lead.email || '', phone: lead.phone || '', source: lead.source || 'WEBSITE', status: lead.status || 'NEW', unitId: lead.unitId || '', unitInterest: lead.unitInterest || '', budget: lead.budget ? String(Number(lead.budget)) : '', notes: lead.notes || '' });
    setEditLead(lead);
    setShowForm(true);
  };

  const handleSubmitLead = async () => {
    if (!form.source) return;
    try {
      const payload: Record<string, unknown> = { projectId, source: form.source, status: form.status, name: form.name || undefined, email: form.email || undefined, phone: form.phone || undefined, unitId: form.unitId || (editLead ? null : undefined), unitInterest: form.unitInterest || undefined, budget: form.budget ? parseFloat(form.budget) : undefined, notes: form.notes || undefined };
      if (editLead) {
        await updateLead.mutateAsync({ id: editLead.id, data: payload });
        addToast({ title: 'Lead updated', color: 'success' });
      } else {
        await createLead.mutateAsync(payload);
        addToast({ title: 'Lead created', color: 'success' });
      }
      setShowForm(false);
    } catch { addToast({ title: 'Failed to save lead', color: 'danger' }); }
  };

  const handleDeleteLead = async (id: string) => {
    if (!confirm('Delete this lead?')) return;
    try {
      await deleteLead.mutateAsync(id);
      if (selectedLead?.id === id) setSelectedLead(null);
      addToast({ title: 'Deleted', color: 'success' });
    } catch { addToast({ title: 'Failed to delete', color: 'danger' }); }
  };

  const handleConvert = async () => {
    if (!convertForm.unitId || !convertForm.buyer || !convertForm.salePrice) {
      addToast({ title: 'Unit, buyer name, and sale price are required', color: 'warning' });
      return;
    }
    try {
      await convertLead.mutateAsync({
        id: selectedLead.id,
        unitId: convertForm.unitId,
        saleData: { buyer: convertForm.buyer, salePrice: parseFloat(convertForm.salePrice), contractDate: convertForm.contractDate || undefined, closingDate: convertForm.closingDate || undefined },
      });
      addToast({ title: 'Lead converted to sale!', color: 'success' });
      setShowConvert(false);
      setConvertForm({ unitId: '', buyer: '', salePrice: '', contractDate: '', closingDate: '' });
    } catch { addToast({ title: 'Failed to convert lead', color: 'danger' }); }
  };

  const handleAddActivity = async () => {
    if (!activityNote.trim() || !selectedLead) return;
    try {
      await addActivity.mutateAsync({ leadId: selectedLead.id, data: { type: activityType, note: activityNote.trim() } });
      setActivityNote('');
      setActivityType('NOTE');
    } catch { addToast({ title: 'Failed to log activity', color: 'danger' }); }
  };

  const leadsArr = (leads as any[]) || [];

  return (
    <div className="mt-4 flex gap-4">
      {/* Leads list */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FiTarget className="text-blue-600" />
            <p className="font-semibold text-gray-700">Leads</p>
            <Chip size="sm" variant="flat">{leadsArr.length}</Chip>
          </div>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNewForm}>New Lead</Button>
        </div>

        {isLoading && <div className="text-sm text-gray-400 text-center py-6">Loading...</div>}
        {!isLoading && leadsArr.length === 0 && (
          <EmptyState title="No leads for this project" message="Add leads to track marketing interest" action={<Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNewForm}>New Lead</Button>} />
        )}

        <div className="space-y-2">
          {leadsArr.map((lead: any) => (
            <Card key={lead.id} shadow="sm" isPressable onPress={() => setSelectedLead(lead)} className={`cursor-pointer ${selectedLead?.id === lead.id ? 'ring-2 ring-blue-500' : ''}`}>
              <CardBody className="py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-800">{lead.name || <span className="text-gray-400 italic">Unnamed</span>}</p>
                      <Chip size="sm" color={LEAD_STATUS_COLORS_TAB[lead.status] || 'default'} variant="flat" className="text-[10px]">{lead.status.replace('_', ' ')}</Chip>
                      <Chip size="sm" variant="bordered" className="text-[10px]">{SOURCE_LABELS_TAB[lead.source] || lead.source}</Chip>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                      {lead.email && <span className="flex items-center gap-1"><FiMail />{lead.email}</span>}
                      {lead.phone && <span className="flex items-center gap-1"><FiPhone />{lead.phone}</span>}
                      {lead.budget && <span>${Number(lead.budget).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button isIconOnly size="sm" variant="light" onPress={() => openEditForm(lead)}><FiEdit2 /></Button>
                    <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => handleDeleteLead(lead.id)}><FiTrash2 /></Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* Lead Form Modal */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} size="lg">
          <ModalContent>
            <ModalHeader>{editLead ? 'Edit Lead' : 'New Lead'}</ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input size="sm" label="Name" value={form.name} onChange={(e) => setF('name', e.target.value)} />
                <Input size="sm" label="Email" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} />
                <Input size="sm" label="Phone" value={form.phone} onChange={(e) => setF('phone', e.target.value)} />
                <Input size="sm" label="Budget ($)" type="number" value={form.budget} onChange={(e) => setF('budget', e.target.value)} />
                <Select size="sm" label="Source" selectedKeys={new Set([form.source])} onSelectionChange={(k) => setF('source', Array.from(k)[0] as string)}>
                  {LEAD_SOURCES_TAB.map((s) => <SelectItem key={s}>{SOURCE_LABELS_TAB[s] || s}</SelectItem>)}
                </Select>
                <Select size="sm" label="Status" selectedKeys={new Set([form.status])} onSelectionChange={(k) => setF('status', Array.from(k)[0] as string)}>
                  {LEAD_STATUSES_TAB.map((s) => <SelectItem key={s}>{s.replace('_', ' ')}</SelectItem>)}
                </Select>
                <Select
                  size="sm"
                  label="Unit"
                  placeholder="No specific unit"
                  selectedKeys={form.unitId ? new Set([form.unitId]) : new Set()}
                  onSelectionChange={(k) => setF('unitId', (Array.from(k)[0] as string) || '')}
                  className="sm:col-span-2"
                >
                  {((projectUnits as any[]) || []).map((u: any) => (
                    <SelectItem key={u.id}>{u.unitNumber}{u.status ? ` · ${u.status.replace('_', ' ')}` : ''}</SelectItem>
                  ))}
                </Select>
                <Input size="sm" label="Notes on interest" placeholder="e.g. 2BR preference" value={form.unitInterest} onChange={(e) => setF('unitInterest', e.target.value)} className="sm:col-span-2" />
                <Textarea size="sm" label="Notes" value={form.notes} onChange={(e) => setF('notes', e.target.value)} minRows={2} className="sm:col-span-2" />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="light" onPress={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" color="primary" onPress={handleSubmitLead} isLoading={createLead.isPending || updateLead.isPending}>
                {editLead ? 'Save Changes' : 'Create Lead'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>

      {/* Activity panel */}
      {selectedLead && (
        <div className="w-full lg:w-[320px] lg:shrink-0">
          <Card shadow="sm">
            <CardHeader className="pb-0">
              <div>
                <p className="text-sm font-semibold text-gray-800">{selectedLead.name || 'Unnamed Lead'}</p>
                <Chip size="sm" color={LEAD_STATUS_COLORS_TAB[selectedLead.status] || 'default'} variant="flat" className="mt-1 text-[10px]">{selectedLead.status.replace('_', ' ')}</Chip>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {selectedLead.notes && <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">{selectedLead.notes}</p>}
              {!['CONVERTED', 'LOST', 'DEAD'].includes(selectedLead.status) && (
                <Button size="sm" color="success" variant="flat" className="w-full" onPress={() => { setShowConvert(true); setConvertForm((f) => ({ ...f, buyer: selectedLead.name || '', salePrice: selectedLead.budget ? String(Number(selectedLead.budget)) : '' })); }}>
                  Convert to Sale
                </Button>
              )}
              <p className="text-xs font-semibold text-gray-700">Log Activity</p>
              <Select size="sm" label="Type" selectedKeys={new Set([activityType])} onSelectionChange={(k) => setActivityType(Array.from(k)[0] as string)}>
                {ACTIVITY_TYPES_TAB.map((t) => <SelectItem key={t}>{t.replace('_', ' ')}</SelectItem>)}
              </Select>
              <div className="flex gap-2">
                <Input size="sm" placeholder="Note..." value={activityNote} onChange={(e) => setActivityNote(e.target.value)} className="flex-1" onKeyDown={(e) => { if (e.key === 'Enter') handleAddActivity(); }} />
                <Button size="sm" color="primary" isIconOnly onPress={handleAddActivity} isLoading={addActivity.isPending}><FiSend /></Button>
              </div>
              <div className="space-y-2 max-h-[280px] overflow-auto">
                {(activities as any[] || []).map((act: any) => (
                  <div key={act.id} className="flex gap-2 items-start">
                    <span className="text-sm">{ACTIVITY_ICONS_TAB[act.type] || '📝'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] font-medium text-gray-600">{act.type.replace('_', ' ')}</p>
                        <span className="text-[10px] text-gray-400">· {fmtDate(act.createdAt)}</span>
                      </div>
                      <p className="text-xs text-gray-600">{act.note}</p>
                    </div>
                  </div>
                ))}
                {(!activities || (activities as any[]).length === 0) && (
                  <p className="text-xs text-gray-400 text-center py-4">No activities yet</p>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Convert to Sale Modal */}
      <Modal isOpen={showConvert} onClose={() => setShowConvert(false)} size="md">
        <ModalContent>
          <ModalHeader>Convert Lead to Sale</ModalHeader>
          <ModalBody>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">This will create a sale record and mark the lead as Converted.</p>
              <Select size="sm" label="Unit *" selectedKeys={convertForm.unitId ? new Set([convertForm.unitId]) : new Set()} onSelectionChange={(k) => setCF('unitId', Array.from(k)[0] as string)}>
                {((projectUnits as any[]) || []).filter((u: any) => u.status !== 'SOLD').map((u: any) => (
                  <SelectItem key={u.id}>{u.unitNumber} — {u.building?.name || ''} ({u.status})</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Buyer Name *" value={convertForm.buyer} onChange={(e) => setCF('buyer', e.target.value)} />
              <Input size="sm" label="Sale Price ($) *" type="number" value={convertForm.salePrice} onChange={(e) => setCF('salePrice', e.target.value)} />
              <Input size="sm" label="Contract Date" type="date" value={convertForm.contractDate} onChange={(e) => setCF('contractDate', e.target.value)} />
              <Input size="sm" label="Expected Close Date" type="date" value={convertForm.closingDate} onChange={(e) => setCF('closingDate', e.target.value)} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setShowConvert(false)}>Cancel</Button>
            <Button size="sm" color="success" onPress={handleConvert} isLoading={convertLead.isPending}>Convert to Sale</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Project Comments Tab ----
function ProjectCommentsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectComments(projectId);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment();
  const [text, setText] = useState('');
  const [commentType, setCommentType] = useState('MARKETING');
  const [filterType, setFilterType] = useState('');

  const allComments = (data as any[]) || [];
  const TYPE_ORDER = ['MARKETING', 'SALES', 'FINANCIAL'];

  const displayed = (filterType ? allComments.filter((c: any) => c.commentType === filterType) : allComments)
    .slice()
    .sort((a: any, b: any) => {
      const aIdx = TYPE_ORDER.indexOf(a.commentType);
      const bIdx = TYPE_ORDER.indexOf(b.commentType);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const handleSubmit = async () => {
    if (!text.trim()) return;
    try {
      await createComment.mutateAsync({ projectId, content: text.trim(), commentType });
      setText('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add comment'), color: 'danger' });
    }
  };

  const countByType = TYPE_ORDER.reduce((acc, t) => {
    acc[t] = allComments.filter((c: any) => c.commentType === t).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="mt-4">
      {/* Type filter chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilterType('')}
          className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${!filterType ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
            }`}
        >
          All ({allComments.length})
        </button>
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(filterType === t ? '' : t)}
            className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${filterType === t
              ? t === 'MARKETING' ? 'bg-purple-600 text-white border-purple-600'
                : t === 'SALES' ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-green-600 text-white border-green-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
              }`}
          >
            {t} ({countByType[t]})
          </button>
        ))}
      </div>

      {/* Comment list */}
      <Card shadow="sm" className="mb-4">
        <CardBody>
          {isLoading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : displayed.length === 0 ? (
            <p className="text-xs text-gray-400">No comments yet</p>
          ) : (
            <div className="max-h-[500px] overflow-auto space-y-3">
              {displayed.map((c: any) => (
                <div key={c.id} className="flex gap-3 p-2 rounded-md hover:bg-gray-50">
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
                        onPress={() => deleteComment.mutate({ id: c.id, source: 'project' })}
                      >
                        <FiTrash2 className="text-[10px]" />
                      </Button>
                    </div>
                    <p className="text-sm text-gray-700 break-words mt-0.5">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Add comment */}
      <Card shadow="sm">
        <CardBody>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Add Comment</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select
              size="sm"
              className="w-full sm:w-[150px]"
              selectedKeys={[commentType]}
              onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setCommentType(v); }}
            >
              {TYPE_ORDER.map((t) => <SelectItem key={t}>{t}</SelectItem>)}
            </Select>
            <Textarea
              size="sm"
              minRows={1}
              maxRows={4}
              placeholder="Write a comment..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            />
            <Button size="sm" color="primary" isIconOnly onPress={handleSubmit} isLoading={createComment.isPending}>
              <FiSend />
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Draws Tab ----
const DRAW_STATUS_COLORS: Record<string, 'default' | 'primary' | 'success' | 'secondary' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'primary',
  APPROVED: 'success',
  FUNDED: 'secondary',
  REJECTED: 'danger',
};

const NEXT_DRAW_STATUS: Record<string, string> = {
  DRAFT: 'SUBMITTED',
  SUBMITTED: 'APPROVED',
  APPROVED: 'FUNDED',
};

const EMPTY_DRAW = { loanId: '', requestedAmount: '', notes: '' };

function DrawsTab({ projectId }: { projectId: string }) {
  const { data: draws = [], isLoading } = useProjectDraws(projectId);
  const { data: loans = [] } = useLoans(projectId);
  const createDraw = useCreateDraw();
  const updateStatus = useUpdateDrawStatus();
  const deleteDraw = useDeleteDraw();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isAdvanceOpen, onOpen: onAdvanceOpen, onClose: onAdvanceClose } = useDisclosure();
  const { isOpen: isRejectOpen, onOpen: onRejectOpen, onClose: onRejectClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_DRAW);
  const [advanceDraw, setAdvanceDraw] = useState<any>(null);
  const [approvedAmount, setApprovedAmount] = useState('');
  const [rejectDraw, setRejectDraw] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  // Slice 8 — detail modal with stepper + checklist + workflow buttons
  const [detailDrawId, setDetailDrawId] = useState<string | null>(null);

  const set = (f: string) => (e: any) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const drawList = draws as any[];
  const totalDraws = drawList.length;
  const funded = drawList.filter((d) => d.status === 'FUNDED').reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
  const pending = drawList.filter((d) => ['SUBMITTED', 'APPROVED'].includes(d.status)).reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  const handleSave = async () => {
    try {
      await createDraw.mutateAsync({ loanId: form.loanId, projectId, requestedAmount: form.requestedAmount, notes: form.notes });
      addToast({ title: 'Draw request created', color: 'success' });
      setForm(EMPTY_DRAW);
      onClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to create draw'), color: 'danger' }); }
  };

  const openAdvance = (draw: any) => {
    setAdvanceDraw(draw);
    setApprovedAmount(String(draw.requestedAmount || draw.amount || ''));
    onAdvanceOpen();
  };

  const handleAdvance = async () => {
    if (!advanceDraw) return;
    const next = NEXT_DRAW_STATUS[advanceDraw.status];
    if (!next) return;
    try {
      const payload: any = { id: advanceDraw.id, status: next, projectId };
      if (next === 'APPROVED') payload.approvedAmount = parseFloat(approvedAmount) || undefined;
      await updateStatus.mutateAsync(payload);
      addToast({ title: `Draw moved to ${next}`, color: 'success' });
      onAdvanceClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to update status'), color: 'danger' }); }
  };

  const openReject = (draw: any) => {
    setRejectDraw(draw);
    setRejectionReason('');
    onRejectOpen();
  };

  const handleReject = async () => {
    if (!rejectDraw || !rejectionReason.trim()) return;
    try {
      await updateStatus.mutateAsync({ id: rejectDraw.id, status: 'REJECTED', projectId, rejectionReason });
      addToast({ title: 'Draw rejected', color: 'warning' });
      onRejectClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to reject draw'), color: 'danger' }); }
  };

  const handleDelete = async (draw: any) => {
    try {
      await deleteDraw.mutateAsync({ id: draw.id, projectId });
      addToast({ title: 'Draw deleted', color: 'success' });
    } catch (e) { addToast({ title: errMsg(e, 'Failed to delete draw'), color: 'danger' }); }
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Draws" value={totalDraws.toString()} />
        <StatCard label="Funded Total" value={fmt(funded)} variant="construction" />
        <StatCard label="Pending" value={fmt(pending)} variant="neutral" />
      </div>

      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center">
          <span className="font-semibold text-sm">Draw Requests</span>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={onOpen}>Add Draw</Button>
        </CardHeader>
        <CardBody className="p-0">
          {drawList.length === 0 ? (
            <div className="p-6"><EmptyState message="No draw requests yet" /></div>
          ) : (
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[560px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['#', 'Loan', 'Requested', 'Approved', 'Status', 'Rejection Reason', 'Date', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drawList.map((d: any) => (
                  <tr
                    key={d.id}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setDetailDrawId(d.id)}
                  >
                    <td className="px-4 py-3 text-gray-500">#{d.drawNumber}</td>
                    <td className="px-4 py-3">{d.loan?.lender || d.loan?.loanType || '—'}</td>
                    <td className="px-4 py-3 font-mono">{fmt(Number(d.requestedAmount || d.amount || 0))}</td>
                    <td className="px-4 py-3 font-mono">{d.approvedAmount ? fmt(Number(d.approvedAmount)) : '—'}</td>
                    <td className="px-4 py-3">
                      <Chip size="sm" color={DRAW_STATUS_COLORS[d.status] || 'default'} variant="flat">{d.status}</Chip>
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">
                      {d.rejectionReason || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(d.requestDate)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button size="sm" variant="flat" onPress={() => setDetailDrawId(d.id)}>
                          Open
                        </Button>
                        {d.status === 'DRAFT' && (
                          <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => handleDelete(d)}>
                            <FiTrash2 />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardBody>
      </Card>

      {/* Create Draw Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalContent>
          <ModalHeader>Add Draw Request</ModalHeader>
          <ModalBody className="space-y-3">
            <Select label="Loan" selectedKeys={form.loanId ? [form.loanId] : []} onSelectionChange={(k) => setForm((p) => ({ ...p, loanId: Array.from(k)[0] as string }))}>
              {(loans as any[]).map((l: any) => (
                <SelectItem key={l.id}>{l.lender || l.loanType} — {fmt(Number(l.principalAmt || 0))}</SelectItem>
              ))}
            </Select>
            <Input label="Requested Amount ($)" type="number" value={form.requestedAmount} onChange={set('requestedAmount')} />
            <Textarea label="Notes" value={form.notes} onChange={set('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={createDraw.isPending}>Create</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Advance / Approve Modal */}
      <Modal isOpen={isAdvanceOpen} onClose={onAdvanceClose} size="sm">
        <ModalContent>
          <ModalHeader>
            Confirm: Move to {advanceDraw ? NEXT_DRAW_STATUS[advanceDraw.status] : ''}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <p className="text-sm text-gray-600">
              Draw #{advanceDraw?.drawNumber} — Requested {fmt(Number(advanceDraw?.requestedAmount || 0))}
            </p>
            {advanceDraw?.status === 'SUBMITTED' && (
              <Input
                label="Approved Amount ($)"
                type="number"
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
                description="Leave unchanged to approve full requested amount"
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onAdvanceClose}>Cancel</Button>
            <Button color="primary" onPress={handleAdvance} isLoading={updateStatus.isPending}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Reject Modal */}
      <Modal isOpen={isRejectOpen} onClose={onRejectClose} size="sm">
        <ModalContent>
          <ModalHeader>Reject Draw #{rejectDraw?.drawNumber}</ModalHeader>
          <ModalBody>
            <Textarea
              label="Rejection Reason"
              placeholder="Explain why this draw is being rejected..."
              isRequired
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onRejectClose}>Cancel</Button>
            <Button color="danger" onPress={handleReject} isLoading={updateStatus.isPending}
              isDisabled={!rejectionReason.trim()}>
              Reject Draw
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Slice 8: rich detail modal — stepper + checklist + workflow buttons */}
      <DrawDetailModal
        drawId={detailDrawId}
        isOpen={!!detailDrawId}
        onClose={() => setDetailDrawId(null)}
        projectId={projectId}
      />
    </div>
  );
}

// ---- Vendors Tab ----
const CONTRACT_STATUS_COLORS: Record<string, 'default' | 'primary' | 'success' | 'danger'> = {
  DRAFT: 'default', ACTIVE: 'primary', COMPLETED: 'success', TERMINATED: 'danger',
};
const CO_STATUS_COLORS: Record<string, 'default' | 'success' | 'danger'> = {
  PENDING: 'default', APPROVED: 'success', REJECTED: 'danger',
};
const EMPTY_CONTRACT = { vendorId: '', description: '', originalAmount: '', status: 'ACTIVE', startDate: '', endDate: '' };
const EMPTY_CO = { description: '', amount: '' };
const EMPTY_PAYMENT = { amount: '', paidDate: '', notes: '' };

function VendorsTab({ projectId, role }: { projectId: string; role: string }) {
  const canEdit = ['FOUNDER', 'FINANCE', 'PROJECT_MANAGER'].includes(role);
  const { data: contracts = [], isLoading } = useContracts(projectId);
  const { data: summary } = useContractSummary(projectId);
  const { data: vendors = [] } = useVendors();
  const createContract = useCreateContract();
  const deleteContract = useDeleteContract();
  const addCO = useAddChangeOrder();
  const approveCO = useApproveChangeOrder();
  const addPayment = useAddContractPayment();
  const { isOpen: isContractOpen, onOpen: onContractOpen, onClose: onContractClose } = useDisclosure();
  const { isOpen: isCOOpen, onOpen: onCOOpen, onClose: onCOClose } = useDisclosure();
  const { isOpen: isPmtOpen, onOpen: onPmtOpen, onClose: onPmtClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>(EMPTY_CONTRACT);
  const [coForm, setCOForm] = useState<Record<string, string>>(EMPTY_CO);
  const [pmtForm, setPmtForm] = useState<Record<string, string>>(EMPTY_PAYMENT);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const set = (f: string) => (e: any) => setForm((p) => ({ ...p, [f]: e.target.value }));
  const setCO = (f: string) => (e: any) => setCOForm((p) => ({ ...p, [f]: e.target.value }));
  const setPmt = (f: string) => (e: any) => setPmtForm((p) => ({ ...p, [f]: e.target.value }));

  const toggleExpand = (id: string) => setExpandedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const s = summary as any;

  const handleSaveContract = async () => {
    try {
      await createContract.mutateAsync({ projectId, ...form, originalAmount: parseFloat(form.originalAmount) });
      addToast({ title: 'Contract created', color: 'success' });
      setForm(EMPTY_CONTRACT);
      onContractClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to create contract'), color: 'danger' }); }
  };

  const handleSaveCO = async () => {
    try {
      await addCO.mutateAsync({ contractId: selectedContractId, projectId, ...coForm, amount: parseFloat(coForm.amount) });
      addToast({ title: 'Change order added', color: 'success' });
      setCOForm(EMPTY_CO);
      onCOClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to add CO'), color: 'danger' }); }
  };

  const handleSavePayment = async () => {
    try {
      await addPayment.mutateAsync({ contractId: selectedContractId, projectId, ...pmtForm, amount: parseFloat(pmtForm.amount) });
      addToast({ title: 'Payment recorded', color: 'success' });
      setPmtForm(EMPTY_PAYMENT);
      onPmtClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to record payment'), color: 'danger' }); }
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Original Value" value={fmt(s?.totalOriginal || 0)} />
        <StatCard label="Current (w/ COs)" value={fmt(s?.totalCurrent || 0)} variant="construction" />
        <StatCard label="Paid to Date" value={fmt(s?.totalPaid || 0)} variant="revenue" />
        <StatCard label="% Complete" value={fmtPct(s?.pctComplete || 0)} variant="neutral" />
      </div>

      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center">
          <span className="font-semibold text-sm">Contracts</span>
          {canEdit && <Button size="sm" color="primary" startContent={<FiPlus />} onPress={onContractOpen}>Add Contract</Button>}
        </CardHeader>
        <CardBody className="p-0">
          {(contracts as any[]).length === 0 ? (
            <div className="p-6"><EmptyState message="No contracts yet" /></div>
          ) : (
            <div className="divide-y">
              {(contracts as any[]).map((c: any) => {
                const paid = (c.payments || []).reduce((s: number, p: any) => s + p.amount, 0);
                const pct = c.currentAmount > 0 ? (paid / c.currentAmount) * 100 : 0;
                const expanded = expandedIds.has(c.id);
                return (
                  <div key={c.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{c.vendor?.name}</span>
                          <Chip size="sm" color={CONTRACT_STATUS_COLORS[c.status] || 'default'} variant="flat">{c.status}</Chip>
                          {c.vendor?.trade && <span className="text-xs text-gray-400">{c.vendor.trade}</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>
                        <div className="flex gap-4 mt-2 text-xs text-gray-600">
                          <span>Original: <span className="font-mono font-medium">{fmt(c.originalAmount)}</span></span>
                          <span>Current: <span className="font-mono font-medium">{fmt(c.currentAmount)}</span></span>
                          <span>Paid: <span className="font-mono font-medium">{fmt(paid)}</span></span>
                          <span className="font-medium">{fmtPct(pct)}</span>
                        </div>
                        <Progress value={pct} size="sm" color="success" className="mt-1 max-w-xs" />
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        {canEdit && (
                          <>
                            <Button size="sm" variant="flat" onPress={() => { setSelectedContractId(c.id); onCOOpen(); }}>+ CO</Button>
                            <Button size="sm" variant="flat" color="success" onPress={() => { setSelectedContractId(c.id); onPmtOpen(); }}>$ Pay</Button>
                            <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => deleteContract.mutate({ id: c.id, projectId })}>
                              <FiTrash2 />
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="light" isIconOnly onPress={() => toggleExpand(c.id)}>
                          {expanded ? <FiChevronUp /> : <FiChevronDown />}
                        </Button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-3 pl-2 space-y-3">
                        {(c.changeOrders || []).length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">Change Orders</p>
                            <div className="responsive-table-wrap"><table className="w-full text-xs min-w-[480px]">
                              <thead><tr className="text-gray-400">
                                <th className="text-left py-1">#</th><th className="text-left py-1">Description</th>
                                <th className="text-right py-1">Amount</th><th className="text-left py-1 pl-2">Status</th>
                                {canEdit && <th />}
                              </tr></thead>
                              <tbody>
                                {c.changeOrders.map((co: any) => (
                                  <tr key={co.id} className="border-t border-gray-100">
                                    <td className="py-1">{co.number}</td>
                                    <td className="py-1">{co.description}</td>
                                    <td className="py-1 text-right font-mono">{fmt(co.amount)}</td>
                                    <td className="py-1 pl-2">
                                      <Chip size="sm" color={CO_STATUS_COLORS[co.status] || 'default'} variant="flat">{co.status}</Chip>
                                    </td>
                                    {canEdit && co.status === 'PENDING' && (
                                      <td className="py-1 pl-2">
                                        <div className="flex gap-1">
                                          <Button size="sm" color="success" variant="flat" isIconOnly onPress={() => approveCO.mutate({ id: co.id, status: 'APPROVED', projectId })}><FiCheck /></Button>
                                          <Button size="sm" color="danger" variant="flat" isIconOnly onPress={() => approveCO.mutate({ id: co.id, status: 'REJECTED', projectId })}><FiX /></Button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table></div>
                          </div>
                        )}
                        {(c.payments || []).length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1">Payments</p>
                            <div className="responsive-table-wrap"><table className="w-full text-xs min-w-[480px]">
                              <thead><tr className="text-gray-400">
                                <th className="text-left py-1">Date</th><th className="text-right py-1">Amount</th><th className="text-left py-1 pl-2">Notes</th>
                              </tr></thead>
                              <tbody>
                                {c.payments.map((p: any) => (
                                  <tr key={p.id} className="border-t border-gray-100">
                                    <td className="py-1">{fmtDate(p.paidDate)}</td>
                                    <td className="py-1 text-right font-mono">{fmt(p.amount)}</td>
                                    <td className="py-1 pl-2 text-gray-500">{p.notes || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Add Contract Modal */}
      <Modal isOpen={isContractOpen} onClose={onContractClose} size="lg">
        <ModalContent>
          <ModalHeader>New Contract</ModalHeader>
          <ModalBody className="space-y-3">
            <Select label="Vendor" selectedKeys={form.vendorId ? [form.vendorId] : []} onSelectionChange={(k) => setForm((p) => ({ ...p, vendorId: Array.from(k)[0] as string }))}>
              {(vendors as any[]).map((v: any) => <SelectItem key={v.id}>{v.name}{v.trade ? ` (${v.trade})` : ''}</SelectItem>)}
            </Select>
            <Input label="Description" value={form.description} onChange={set('description')} />
            <Input label="Contract Amount" type="number" value={form.originalAmount} onChange={set('originalAmount')} />
            <Select label="Status" selectedKeys={[form.status]} onSelectionChange={(k) => setForm((p) => ({ ...p, status: Array.from(k)[0] as string }))}>
              {['DRAFT', 'ACTIVE', 'COMPLETED', 'TERMINATED'].map((s) => <SelectItem key={s}>{s}</SelectItem>)}
            </Select>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Start Date" type="date" value={form.startDate} onChange={set('startDate')} />
              <Input label="End Date" type="date" value={form.endDate} onChange={set('endDate')} />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onContractClose}>Cancel</Button>
            <Button color="primary" onPress={handleSaveContract} isLoading={createContract.isPending}>Create</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add Change Order Modal */}
      <Modal isOpen={isCOOpen} onClose={onCOClose} size="md">
        <ModalContent>
          <ModalHeader>Add Change Order</ModalHeader>
          <ModalBody className="space-y-3">
            <Input label="Description" value={coForm.description} onChange={setCO('description')} />
            <Input label="Amount" type="number" value={coForm.amount} onChange={setCO('amount')} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onCOClose}>Cancel</Button>
            <Button color="primary" onPress={handleSaveCO} isLoading={addCO.isPending}>Submit CO</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Record Payment Modal */}
      <Modal isOpen={isPmtOpen} onClose={onPmtClose} size="md">
        <ModalContent>
          <ModalHeader>Record Payment</ModalHeader>
          <ModalBody className="space-y-3">
            <Input label="Amount" type="number" value={pmtForm.amount} onChange={setPmt('amount')} />
            <Input label="Payment Date" type="date" value={pmtForm.paidDate} onChange={setPmt('paidDate')} />
            <Textarea label="Notes" value={pmtForm.notes} onChange={setPmt('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onPmtClose}>Cancel</Button>
            <Button color="primary" onPress={handleSavePayment} isLoading={addPayment.isPending}>Record</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Documents Tab ----
const DOC_CATEGORIES = ['GENERAL', 'PERMIT', 'CONTRACT', 'FINANCIAL', 'DRAWING', 'PHOTO', 'LEGAL'];
const DOC_CATEGORY_COLORS: Record<string, string> = {
  GENERAL: 'bg-gray-100 text-gray-600',
  PERMIT: 'bg-yellow-100 text-yellow-700',
  CONTRACT: 'bg-blue-100 text-blue-700',
  FINANCIAL: 'bg-green-100 text-green-700',
  DRAWING: 'bg-purple-100 text-purple-700',
  PHOTO: 'bg-pink-100 text-pink-700',
  LEGAL: 'bg-red-100 text-red-700',
};

function docIcon(mime: string) {
  if (!mime) return <FiFile />;
  if (mime.startsWith('image/')) return <FiImage />;
  if (mime.includes('pdf')) return <FiFileText />;
  return <FiFile />;
}

function DocumentsTab({ projectId }: { projectId: string }) {
  const { data: docs = [], isLoading } = useDocuments({ projectId });
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [filterCat, setFilterCat] = useState('ALL');
  const [uploadCategory, setUploadCategory] = useState('GENERAL');
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');

  const filtered = filterCat === 'ALL' ? (docs as any[]) : (docs as any[]).filter((d: any) => d.category === filterCat);

  const handleUpload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', projectId);
    fd.append('category', uploadCategory);
    if (displayName.trim()) fd.append('displayName', displayName.trim());
    try {
      await uploadDoc.mutateAsync(fd);
      addToast({ title: 'Document uploaded', color: 'success' });
      setFile(null);
      setDisplayName('');
      onClose();
    } catch (e) { addToast({ title: errMsg(e, 'Upload failed'), color: 'danger' }); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc.mutateAsync(id);
      addToast({ title: 'Document deleted', color: 'success' });
    } catch (e) { addToast({ title: errMsg(e, 'Delete failed'), color: 'danger' }); }
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {['ALL', ...DOC_CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterCat === cat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {cat}
            </button>
          ))}
        </div>
        <Button size="sm" color="primary" startContent={<FiUpload />} onPress={onOpen}>Upload</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No documents yet" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((doc: any) => (
            <Card key={doc.id} shadow="sm">
              <CardBody className="p-4">
                <div className="flex items-start gap-3">
                  <div className="text-2xl text-gray-400 mt-0.5">{docIcon(doc.mimeType)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.fileName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${DOC_CATEGORY_COLORS[doc.category] || 'bg-gray-100 text-gray-600'}`}>{doc.category}</span>
                      {doc.fileSize && <span className="text-xs text-gray-400">{(doc.fileSize / 1024).toFixed(0)} KB</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{doc.uploadedBy?.name} · {fmtDate(doc.createdAt)}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <a href={apiAssetUrl(doc.fileUrl)} target="_blank" rel="noreferrer" className="flex-1">
                    <Button size="sm" variant="flat" className="w-full" startContent={<FiFileText />}>View</Button>
                  </a>
                  <a href={apiAssetUrl(doc.fileUrl)} download={doc.fileName} className="flex-1">
                    <Button size="sm" variant="flat" className="w-full" startContent={<FiDownload />}>Download</Button>
                  </a>
                  <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => handleDelete(doc.id)}>
                    <FiTrash2 />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalContent>
          <ModalHeader>Upload Document</ModalHeader>
          <ModalBody className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File</label>
              <input
                type="file"
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <Input
              label="Document name (optional)"
              placeholder={file ? file.name : 'e.g. Floor Plan — Tower A'}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              description="Leave blank to keep the original file name. The file extension is preserved."
            />
            <Select label="Category" selectedKeys={[uploadCategory]} onSelectionChange={(k) => setUploadCategory(Array.from(k)[0] as string)}>
              {DOC_CATEGORIES.map((c) => <SelectItem key={c}>{c}</SelectItem>)}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleUpload} isLoading={uploadDoc.isPending} isDisabled={!file}>Upload</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

import { useParams, useNavigate, Link } from 'react-router-dom';
import React, { useState, useMemo, useEffect } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import {
  Card, CardBody, CardHeader, Button, Tabs, Tab, Progress, Chip, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Input, Select, SelectItem, Textarea, Avatar, Skeleton,
  useDisclosure, addToast,
} from '@heroui/react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { FiArrowLeft, FiMapPin, FiCalendar, FiPlus, FiEdit2, FiTrash2, FiMessageSquare, FiSend, FiTarget, FiPhone, FiMail, FiUpload, FiDownload, FiFile, FiImage, FiFileText, FiCheck, FiX, FiChevronDown, FiChevronUp, FiChevronRight, FiChevronLeft, FiDollarSign, FiSearch, FiUsers, FiAlertTriangle, FiLock, FiHome, FiFlag, FiKey, FiLayers, FiBarChart2, FiActivity, FiCheckSquare, FiMove } from 'react-icons/fi';
import { SalePaymentPanel } from '../components/SalePaymentPanel';
import { DailyLogFeed } from '../components/DailyLogFeed';
import { CombineUnitsModal } from '../components/CombineUnitsModal';
import { CashflowForecastView } from '../components/CashflowForecastView';
import { ObligationsPanel } from '../components/ObligationsPanel';
// Lease-scoped deposits / TI — distinct from ObligationsPanel above, which is budget cash obligations.
import { LeaseObligationsPanel } from '../components/LeaseObligationsPanel';
import { LeaseRentSchedule } from '../components/LeaseRentSchedule';
import { RentCollectionPanel } from '../components/RentCollectionPanel';
import { CancelSaleModal } from '../components/CancelSaleModal';
import { TenantProfilePanel } from '../components/TenantProfilePanel';
import { DocumentGateChip, SALE_STAGE_DOCS } from '../components/DocumentGateChip';
import {
  useProject, useFinancialSummary, useBudgetByBuildingUnitReport, useMilestones, useUnits, useLeases, useActuals,
  useRentRoll, useSalesPipeline, useLoans, useCreateLoan, useUpdateLoan, useDeleteLoan, useCommitments, useBuildings,
  useBudgetLines,
  useUpdateProject,
  useCreateUnit, useUpdateUnit, useDeleteUnit,
  useCreateMilestone, useUpdateMilestone, useDeleteMilestone,
  useCreateLease, useUpdateLease, useDeleteLease,
  useCreateSale, useUpdateSale, useDeleteSale, useApproveSaleDiscount, useBrokers, useCampaigns,
  useCreateCommitment, useUpdateCommitment, useDeleteCommitment,
  useCreateBudget, useUpdateBudget, useDeleteBudget, useProjectBudgetRevisions, useSetApprovedBudget,
  useUnitComments, useProjectComments, useCreateComment, useDeleteComment,
  useCreateBuilding, useUpdateBuilding, useDeleteBuilding, useReorderBuildings,
  useMonthlyLeaseIncome, useMonthlyPayments,
  useLeads, useCreateLead, useUpdateLead, useDeleteLead, useAddLeadActivity, useLeadActivities, useConvertLead,
  useProjectDraws, useCreateDraw, useUpdateDraw, useDeleteDraw,
  useDrawSchedule, useUpsertDrawScheduleLine, useDeleteDrawScheduleLine,
  useVendors, useCreateVendor, useUpdateVendor, useContracts, useContractSummary, useCreateContract, useUpdateContract, useDeleteContract,
  useAddChangeOrder, useApproveChangeOrder, useAddContractPayment,
  useDocuments, useUploadDocument, useDeleteDocument, useRenameDocument, useReplaceDocument,
  useUsers, useAssignableUsers, useProjectMembers, useAddProjectMember, useRemoveProjectMember,
  useProjectHealth, useSalesForecast, useExceptions, useProjectActivity,
  useSetMilestoneDependency, useMilestonePhotos, useAttachMilestonePhoto, useDeleteMilestonePhoto,
  usePresignedUpload, useProjectDrawSchedules, useCustomOptions,
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
  const [previewSrc, setPreviewSrc] = React.useState<string>('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      const { storagePath: path } = await presigned.mutateAsync({ file, category: 'buildings' });
      setPreviewSrc(objectUrl);
      onChange(path);
      addToast({ title: `Uploaded ${file.name}`, color: 'success' });
    } catch (err: any) {
      URL.revokeObjectURL(objectUrl);
      addToast({ title: err?.message || 'Upload failed', color: 'danger' });
    }
  };

  const showPreview = previewSrc || storagePath;

  return (
    <div>
      <p className="text-xs font-medium text-gray-700 mb-1.5">Cover photo</p>
      <div className="flex items-center gap-3">
        {showPreview ? (
          <div className="relative w-32 h-20 rounded border border-gray-200 overflow-hidden bg-gray-100">
            {previewSrc ? (
              <img src={previewSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Photo saved</div>
            )}
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
            <Button size="sm" variant="light" color="danger" onPress={() => { setPreviewSrc(''); onChange(''); }}>
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
                src={(p as any).url || ''}
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
import { fmt, fmtPct, fmtDate, errMsg } from '../utils/fmt';
import { EMPTY_LEASE, validateLeaseForm, buildLeasePayload, LeaseFormFields } from '../components/LeaseFormFields';
import { FormError } from '../components/FormError';
import {
  StatCard, StatusBadge, PhaseProgress, LoadingState, ErrorState, EmptyState,
  PermissionGate, STATUS_COLORS,
} from '../components/ui';
import { useAuthStore } from '../store/authStore';

const TAB_MAP = ['overview', 'construction', 'budget', 'revenue', 'units', 'milestones', 'leads', 'draws', 'vendors', 'documents', 'tasks', 'comments', 'activity'];

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
  activity: 'Activity Log',
};

/**
 * Which permission(s) a tab needs. A tab shows when the viewer holds ANY of them.
 *
 * This replaced a hardcoded ROLE list. Two gating systems had drifted apart: the role
 * lists were stricter than the permission map, so roles were denied tabs their own
 * permissions granted — LEGAL/MARKETING/SALES/VIEWER held building:view but could not
 * open Construction, a PROJECT_MANAGER with sales:view could not open Revenue, AR_AP
 * could not reach Documents, and an EXECUTIVE with audit:view could not see the
 * Activity Log. The permission map is the source of truth the API enforces, so the UI
 * now reads from it and there is only one place left to change.
 *
 * Each permission below is the one the tab's own list endpoint actually enforces —
 * verified against the controllers, not inferred from the name. Notably `tasks` is
 * gated by project:view (task:view is defined but never enforced) and `comments` by
 * unit:view.
 */
const TAB_PERMISSIONS: Record<string, string[]> = {
  overview: [],                    // reachable by anyone who can open the project
  construction: ['building:view'],
  budget: ['budget:view'],
  // Composed tab: Sales pipeline + Leases. Visible with EITHER, and each section is
  // gated separately below so a lease-only role never triggers a sales 403.
  revenue: ['sales:view', 'lease:view'],
  units: ['unit:view'],
  milestones: ['milestone:view'],
  leads: ['lead:view'],
  draws: ['draw:view'],
  vendors: ['vendor:view'],
  documents: ['document:view'],
  tasks: ['project:view'],
  comments: ['unit:view'],
  activity: ['audit:view'],
};


export default function ProjectDetailPage() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { user, hasAnyPermission } = useAuthStore();
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

  const visibleTabs = TAB_MAP.filter((t) => {
    const needed = TAB_PERMISSIONS[t] ?? [];
    return needed.length === 0 || hasAnyPermission(...needed);
  });
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
        {activeTab === 'vendors' && <VendorsTab projectId={id!} />}
        {activeTab === 'documents' && <DocumentsTab projectId={id!} />}
        {activeTab === 'tasks' && <TasksPageInner projectId={id!} />}
        {activeTab === 'comments' && <ProjectCommentsTab projectId={id!} />}
        {activeTab === 'activity' && <ProjectActivityTab projectId={id!} />}
      </div>
    </div>
  );
}

// ---- Overview Tab ----
const PROJECT_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL'];
// Canonical left-to-right order for the Overview tab's unit-status breakdown — object key
// order otherwise follows whichever unit was scanned first, so the chip order would shuffle
// project to project.
const UNIT_STATUS_ORDER = ['AVAILABLE', 'UNDER_CONTRACT', 'LEASE_PENDING', 'LEASED', 'OCCUPIED', 'SOLD', 'UNDER_CONSTRUCTION'];
const EMPTY_PROJECT = {
  name: '', description: '', location: '', address: '', acreage: '',
  status: 'ACTIVE', phase: 'PRE_DEVELOPMENT', projectType: '', startDate: '', targetEnd: '',
};

const MEMBER_ROLES = ['PROJECT_MANAGER', 'CONSTRUCTION', 'FINANCE', 'SALES', 'LEGAL', 'VIEWER', 'TEAM_MEMBER'];

/**
 * A sensible project role for someone, derived from the role they already hold in the
 * system — picking "Team member" for a Finance user every time is just friction. Falls
 * back to TEAM_MEMBER for anything without an obvious project-side equivalent.
 */
const PROJECT_ROLE_FROM_SYSTEM_ROLE: Record<string, string> = {
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  CONSTRUCTION: 'CONSTRUCTION',
  FINANCE: 'FINANCE',
  ACCOUNTING: 'FINANCE',
  AR_AP: 'FINANCE',
  SALES: 'SALES',
  MARKETING: 'SALES',
  LEGAL: 'LEGAL',
  VIEWER: 'VIEWER',
};
const defaultProjectRole = (systemRole?: string) =>
  PROJECT_ROLE_FROM_SYSTEM_ROLE[systemRole ?? ''] ?? 'TEAM_MEMBER';

/**
 * A membership's roles. `roles[]` is the source of truth; `role` is the mirrored primary
 * kept for older rows and readers, so fall back to it when the array is empty.
 */
const memberRoles = (m: any): string[] =>
  (m?.roles?.length ? m.roles : [m?.role || 'TEAM_MEMBER']) as string[];

function TeamMembersCard({ projectId }: { projectId: string }) {
  const { user: currentUser, hasPermission } = useAuthStore();
  // Gate on the permission the API actually enforces (project:edit) rather than a
  // hardcoded role list, which drifted from the backend and silently hid the controls
  // from roles that were in fact allowed to use them.
  const canEdit = hasPermission('project:edit');

  const { data: members = [] } = useProjectMembers(projectId);
  // /users requires user:manage — only fetched when the viewer can actually add
  // someone, otherwise every role without it 403s just by rendering this card.
  const { data: allUsers = [] } = useUsers(canEdit);
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [search, setSearch] = useState('');
  // userId -> the project roles staged for them. Several people can be added in one go,
  // and each may hold SEVERAL roles on this project (Finance AND Legal, say).
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);

  const memberList = members as any[];
  const memberIds = new Set(memberList.map((m) => m.userId));
  // The current user is deliberately NOT excluded — a PM adding themselves to a project
  // they just created is normal, and leaving it out forced a trip to the admin screens.
  const candidates = (allUsers as any[]).filter((u: any) => !memberIds.has(u.id) && u.isActive !== false);

  const q = search.trim().toLowerCase();
  const visible = q
    ? candidates.filter((u: any) =>
        [u.name, u.email, u.role].some((f: string) => (f || '').toLowerCase().includes(q)))
    : candidates;

  const pickedIds = Object.keys(picked);

  const toggle = (u: any) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[u.id]) delete next[u.id];
      else next[u.id] = [defaultProjectRole(u.role)];
      return next;
    });

  const closeAdd = () => { setPicked({}); setSearch(''); onClose(); };

  const handleAdd = async () => {
    if (pickedIds.length === 0) return;
    // Added one call per person so a single failure cannot silently drop the rest —
    // the toast reports exactly how many landed.
    const results = await Promise.allSettled(
      pickedIds.map((userId) =>
        addMember.mutateAsync({ projectId, data: { userId, roles: picked[userId] } })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    if (ok > 0) {
      addToast({ title: `${ok} member${ok === 1 ? '' : 's'} added`, color: 'success' });
    }
    if (failed > 0) {
      addToast({ title: `${failed} could not be added`, color: 'danger' });
    }
    closeAdd();
  };

  /** POST /members is an upsert, so re-posting with new roles changes them in place. */
  const handleRoleChange = async (userId: string, roles: string[]) => {
    if (roles.length === 0) return; // a member with no role at all is meaningless
    setSavingRoleFor(userId);
    try {
      await addMember.mutateAsync({ projectId, data: { userId, roles } });
      addToast({ title: 'Role updated', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update role'), color: 'danger' });
    } finally {
      setSavingRoleFor(null);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeMember.mutateAsync({ projectId, userId: removeTarget.userId });
      addToast({ title: `${removeTarget.user?.name || 'Member'} removed from project`, color: 'success' });
      setRemoveTarget(null);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to remove member'), color: 'danger' });
    }
  };

  return (
    <Card shadow="sm">
      <CardHeader className="pb-0 flex justify-between items-center">
        <p className="font-semibold text-sm text-gray-700">
          Team Members
          <span className="ml-2 text-xs font-normal text-gray-400">{memberList.length}</span>
        </p>
        {canEdit && (
          <Button size="sm" variant="light" color="primary" startContent={<FiPlus className="text-xs" />} onPress={onOpen}>
            Add Member
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {memberList.length === 0 ? (
          <div className="py-4 text-center">
            <FiUsers className="mx-auto text-gray-300 w-6 h-6 mb-1.5" />
            <p className="text-xs text-gray-400">No team members assigned yet.</p>
            {canEdit && (
              <p className="text-[11px] text-gray-400 mt-1">
                Project-scoped roles only see projects they are a member of.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {memberList.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar size="sm" name={m.user?.name} src={m.user?.avatarUrl} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">
                      {m.user?.name}
                      {m.userId === currentUser?.id && <span className="text-gray-400 font-normal">{' (you)'}</span>}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">{m.user?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* OWNER is assigned automatically to whoever created the project and is
                      not one of the assignable MEMBER_ROLES. Rendering it through the
                      Select left the control BLANK (no matching option) and would have
                      let someone silently demote the owner — show it read-only instead. */}
                  {canEdit && !memberRoles(m).includes('OWNER') ? (
                    <Select
                      size="sm"
                      selectionMode="multiple"
                      aria-label={`Project roles for ${m.user?.name}`}
                      className="w-[190px]"
                      selectedKeys={new Set(memberRoles(m))}
                      isDisabled={savingRoleFor === m.userId}
                      onSelectionChange={(keys) => {
                        const next = Array.from(keys as Set<string>);
                        if (next.join() !== memberRoles(m).join()) handleRoleChange(m.userId, next);
                      }}
                    >
                      {MEMBER_ROLES.map((r) => (
                        <SelectItem key={r} textValue={r.replace(/_/g, ' ')}>{r.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <div className="flex flex-wrap gap-1 justify-end max-w-[190px]">
                      {memberRoles(m).map((r: string) => (
                        <Chip
                          key={r} size="sm" variant="flat"
                          color={r === 'OWNER' ? 'primary' : 'default'}
                          className="text-[10px]"
                        >
                          {r.replace(/_/g, ' ')}
                        </Chip>
                      ))}
                    </div>
                  )}
                  {canEdit && m.role !== 'OWNER' && (
                    <Button
                      size="sm" variant="light" color="danger" isIconOnly
                      onPress={() => setRemoveTarget(m)}
                      aria-label={`Remove ${m.user?.name}`}
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

      {/* ── Add members ─────────────────────────────────────────────────────── */}
      <Modal isOpen={isOpen} onClose={closeAdd} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="border-b border-gray-100 text-sm flex-col items-start gap-0.5">
            <span>Add Team Members</span>
            <span className="text-[11px] font-normal text-gray-400">
              Members are what project-scoped roles are allowed to see — a PM or Sales user
              only sees projects they are on.
            </span>
          </ModalHeader>
          <ModalBody className="py-4">
            <Input
              size="sm"
              autoFocus
              placeholder="Search by name, email or role"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              startContent={<FiSearch className="text-gray-400 text-sm" />}
              isClearable
              onClear={() => setSearch('')}
            />

            {pickedIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {pickedIds.map((id) => {
                  const u = (allUsers as any[]).find((x: any) => x.id === id);
                  return (
                    <Chip key={id} size="sm" variant="flat" color="primary" onClose={() => toggle({ id })}>
                      {u?.name || id}
                    </Chip>
                  );
                })}
              </div>
            )}

            <div className="mt-3 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-[340px] overflow-y-auto">
              {visible.length === 0 ? (
                <div className="py-8 text-center">
                  <FiUsers className="mx-auto text-gray-300 w-6 h-6 mb-1.5" />
                  <p className="text-xs text-gray-400">
                    {candidates.length === 0
                      ? 'Everyone is already on this project.'
                      : 'No one matches that search.'}
                  </p>
                </div>
              ) : (
                visible.map((u: any) => {
                  const isPicked = !!picked[u.id];
                  return (
                    <div
                      key={u.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(u)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(u); } }}
                      className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer transition-colors ${
                        isPicked ? 'bg-blue-50/60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar size="sm" name={u.name} src={u.avatarUrl} className="shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {u.name}
                            {u.id === currentUser?.id && <span className="text-gray-400 font-normal">{' (you)'}</span>}
                          </p>
                          <p className="text-[11px] text-gray-400 truncate">{u.email}</p>
                        </div>
                        <Chip size="sm" variant="flat" className="text-[10px] shrink-0">
                          {(u.role || '').replace(/_/g, ' ')}
                        </Chip>
                      </div>

                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {isPicked && (
                          <Select
                            size="sm"
                            selectionMode="multiple"
                            aria-label={`Project roles for ${u.name}`}
                            className="w-[190px]"
                            selectedKeys={new Set(picked[u.id])}
                            onSelectionChange={(keys) => {
                              const next = Array.from(keys as Set<string>);
                              // Never leave someone staged with zero roles.
                              setPicked((p) => ({ ...p, [u.id]: next.length ? next : [defaultProjectRole(u.role)] }));
                            }}
                          >
                            {MEMBER_ROLES.map((r) => (
                              <SelectItem key={r} textValue={r.replace(/_/g, ' ')}>{r.replace(/_/g, ' ')}</SelectItem>
                            ))}
                          </Select>
                        )}
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                          isPicked ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                        }`}>
                          {isPicked && <FiCheck className="text-white text-[10px]" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ModalBody>
          <ModalFooter className="border-t border-gray-100">
            <Button size="sm" variant="light" onPress={closeAdd}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleAdd}
              isDisabled={pickedIds.length === 0}
              isLoading={addMember.isPending}
            >
              {pickedIds.length > 1 ? `Add ${pickedIds.length} members` : 'Add to Project'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── Remove confirmation ─────────────────────────────────────────────── */}
      <Modal isOpen={!!removeTarget} onClose={() => setRemoveTarget(null)} size="sm">
        <ModalContent>
          <ModalHeader className="text-sm">Remove from project?</ModalHeader>
          <ModalBody className="py-4">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-800">{removeTarget?.user?.name}</span> will lose
              access to this project if their role is project-scoped. Their work and comments stay.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={() => setRemoveTarget(null)}>Cancel</Button>
            <Button size="sm" color="danger" onPress={handleRemove} isLoading={removeMember.isPending}>
              Remove
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}

// Small "jump to the tab this card summarizes" affordance, used consistently
// across every Overview section that mirrors another tab's data.
function CardNavLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="text-xs text-blue-600 hover:text-blue-700 hover:underline font-medium flex items-center gap-0.5 shrink-0"
    >
      {label}
      <FiChevronRight className="text-[10px]" />
    </button>
  );
}

// The dollar figure a draw actually represents. DrawRequest carries amount, requestedAmount
// AND approvedAmount — approvedAmount is what the lender signed off on, so it wins whenever
// it is set (a lender funding less than requested would otherwise be overstated). Decimals
// arrive from the API as strings, so always coerce with Number().
// Single source of truth: Overview and Draws must never disagree for the same project.
function fundedAmount(d: any): number {
  return Number(d?.approvedAmount ?? d?.amount ?? 0);
}

function OverviewTab({ project: p }: { project: any }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();
  const goTab = (tab: string) => navigate(`/projects/${p.id}/${tab}`);
  const updateProject = useUpdateProject();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>(EMPTY_PROJECT);
  const { data: projectStatusOpts = [] } = useCustomOptions('project_status');
  const { data: projectPhaseOpts = [] } = useCustomOptions('project_phase');

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

  // Financial calculations \u2014 sourced from /budgets/summary, the same endpoint the page
  // header uses. Previously this recomputed its own totals from p.budgetLines/p.actuals,
  // which don't exclude soft-deleted budget lines or interior/TI-tagged actuals the way
  // the summary endpoint does \u2014 the header and this card could show two different
  // "budget"/"spent" numbers for the same project. Pulling from the shared endpoint keeps
  // them always in agreement and adds Committed (contracted-but-unpaid), which wasn't
  // shown anywhere on Overview before.
  const { data: finSummary } = useFinancialSummary(hasPermission('budget:view') ? p.id : '');
  const fin = (finSummary as any) || { budgetTotal: 0, actualTotal: 0, committedTotal: 0 };
  const totalBudget = Number(fin.budgetTotal || 0);
  const totalActuals = Number(fin.actualTotal || 0);
  const totalCommitted = Number(fin.committedTotal || 0);
  const budgetRemaining = totalBudget - totalActuals;
  const pctSpent = totalBudget > 0 ? (totalActuals / totalBudget) * 100 : 0;

  // Every building/unit needed for the counts below already comes from
  // GET /projects/:id (p.buildings[].units[]) \u2014 no extra fetch needed, and both
  // are already deletedAt-filtered server-side so archived/merged-away records
  // can't inflate these numbers.
  const buildings = p.buildings || [];
  const allUnits = buildings.flatMap((b: any) => (b.units || []).map((u: any) => ({ ...u, buildingName: b.name })));
  const unitCount = allUnits.length;
  const unitStatusCounts = allUnits.reduce((acc: Record<string, number>, u: any) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {});

  // p.milestones already comes from GET /projects/:id (no extra fetch) but was never
  // surfaced on Overview — this project's schedule health was invisible without opening
  // the Milestones tab. Status is kept current by a daily cron that flips past-due
  // NOT_STARTED/IN_PROGRESS milestones to OVERDUE, so counting by status is reliable.
  const milestonesArr = p.milestones || [];
  const milestonesCompleted = milestonesArr.filter((m: any) => m.status === 'COMPLETED').length;
  const milestonesOverdue = milestonesArr.filter((m: any) => m.status === 'OVERDUE').length;

  // Revenue, debt service, leads, and draws aren't part of the project payload \u2014
  // one lightweight query each, reusing the same hooks/shapes the Revenue/Leads/Draws
  // tabs already use (server-pre-aggregated where possible).
  //
  // Every one of these is permission-gated on the API, and Overview is the one tab
  // EVERY role can open — so firing them unconditionally guaranteed a wall of
  // "Missing permissions: loan:view / draw:view / budget:view" for anyone without
  // the full set. SALES hit three of them just by opening a project. Passing an empty
  // id disables the query (each hook is `enabled: !!projectId`), so an unpermitted
  // role makes no request at all and the matching card is hidden below.
  const canSeeBudget = hasPermission('budget:view');
  const canSeeSales = hasPermission('sales:view');
  const canSeeLease = hasPermission('lease:view');
  const canSeeLoans = hasPermission('loan:view');
  const canSeeLeads = hasPermission('lead:view');
  const canSeeDraws = hasPermission('draw:view');

  const { data: pipeline } = useSalesPipeline(canSeeSales ? p.id : '');
  const { data: leaseIncome } = useMonthlyLeaseIncome(canSeeLease ? p.id : '');
  const { data: monthlyPayments } = useMonthlyPayments(canSeeLoans ? p.id : '');
  const { data: leadsData } = useLeads({ projectId: p.id }, canSeeLeads);
  const { data: drawsData } = useProjectDraws(canSeeDraws ? p.id : '');

  const pip = (pipeline as any) || { totalPipelineValue: 0, closedRevenue: 0 };
  const li = (leaseIncome as any) || { total: 0, annualProjection: 0 };
  const mp = (monthlyPayments as any) || { total: 0, annualTotal: 0 };
  const leadsArr = (leadsData as any[]) || [];
  const leadsConverted = leadsArr.filter((l) => l.status === 'CONVERTED').length;
  const leadsLost = leadsArr.filter((l) => ['LOST', 'DEAD'].includes(l.status)).length;
  const leadsActive = leadsArr.length - leadsConverted - leadsLost;
  const drawsArr = (drawsData as any[]) || [];
  const drawsFunded = drawsArr.filter((d) => d.status === 'FUNDED').reduce((s: number, d: any) => s + fundedAmount(d), 0);
  const drawsPending = drawsArr.filter((d) => ['SUBMITTED', 'APPROVED'].includes(d.status)).reduce((s: number, d: any) => s + fundedAmount(d), 0);

  return (
    <div className="space-y-5 mt-4">
      {/* Row 0: KPI strip \u2014 quick-glance numbers for the whole project */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Buildings" value={String(buildings.length)} colorScheme="brand" onClick={() => goTab('construction')} />
        <StatCard label="Total Units" value={String(unitCount)} colorScheme="brand" onClick={() => goTab('units')} />
        <StatCard label="Available" value={String(unitStatusCounts.AVAILABLE || 0)} colorScheme="green" onClick={() => goTab('units')} />
        <StatCard label="Sold" value={String(unitStatusCounts.SOLD || 0)} colorScheme="gray" onClick={() => goTab('units')} />
        <StatCard label="Active Leads" value={String(leadsActive)} colorScheme="purple" onClick={() => goTab('leads')} />
        {/* Same reasoning as the header Loan tile: $0 would read as "no debt". */}
        {canSeeLoans && (
          <StatCard label="Monthly Debt Service" value={fmt(mp.total)} colorScheme="red" onClick={() => goTab('draws')} />
        )}
      </div>

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
                ['Address', p.address || '\u2014'],
                ['Start Date', fmtDate(p.startDate)],
                ['Target Completion', fmtDate(p.targetEnd)],
                ['Last Updated', fmtDate(p.updatedAt)],
              ] as [string, string | number][]).map(([label, value]) => {
                // "Last Updated" is system metadata, not a business fact like the other
                // fields here — de-emphasized so it doesn't compete for attention with
                // dates/counts the user actually came to this card to read.
                const isMeta = label === 'Last Updated';
                return (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
                    <p className={`text-sm mt-0.5 ${isMeta ? 'font-normal text-gray-400' : 'font-medium text-gray-800'}`}>{value}</p>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Financial Snapshot — budget:view. Overview is the one tab every role can
            open, so each card here has to gate itself or it 403s for someone. */}
        {canSeeBudget && <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Financial Snapshot</p>
            <CardNavLink label="View Budget" onPress={() => goTab('budget')} />
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Total Budget</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(totalBudget)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Committed</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(totalCommitted)}</p>
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
          </CardBody>
        </Card>}
      </div>

      {/* Row 2: Buildings breakdown + Unit status mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Buildings</p>
            <CardNavLink label="View Construction" onPress={() => goTab('construction')} />
          </CardHeader>
          <CardBody>
            {buildings.length > 0 ? (
              <div className="space-y-3">
                {buildings.map((b: any) => {
                  const bUnits = b.units || [];
                  const sold = bUnits.filter((u: any) => u.status === 'SOLD').length;
                  const available = bUnits.filter((u: any) => u.status === 'AVAILABLE').length;
                  return (
                    <div key={b.id} className="flex items-center justify-between border-b border-gray-50 last:border-0 pb-3 last:pb-0">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{b.name}</p>
                        <p className="text-[11px] text-gray-400">{b.buildingType?.replace(/_/g, ' ') || '\u2014'}{' \u00b7 '}{bUnits.length} unit{bUnits.length === 1 ? '' : 's'}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {available > 0 && <Chip size="sm" variant="flat" color={STATUS_COLORS.AVAILABLE} className="text-[10px]">{available} available</Chip>}
                        {sold > 0 && <Chip size="sm" variant="flat" color={STATUS_COLORS.SOLD} className="text-[10px]">{sold} sold</Chip>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No buildings yet" message="Add a building to start tracking units." />
            )}
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Unit Status Mix</p>
            <CardNavLink label="View Units" onPress={() => goTab('units')} />
          </CardHeader>
          <CardBody>
            {unitCount > 0 ? (
              <div className="flex flex-wrap gap-2">
                {UNIT_STATUS_ORDER.filter((status) => unitStatusCounts[status] > 0).map((status) => (
                  <Chip key={status} size="sm" variant="flat" color={STATUS_COLORS[status] || 'default'} className="text-[10px]">
                    <span className="font-bold">{unitStatusCounts[status]}</span> {status.replace(/_/g, ' ')}
                  </Chip>
                ))}
              </div>
            ) : (
              <EmptyState title="No units yet" message="Units appear here once buildings have units." />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Row 2.5: Milestones — schedule health at a glance, previously absent from Overview */}
      <Card shadow="sm">
        <CardHeader className="pb-0 flex justify-between items-center">
          <p className="font-semibold text-sm text-gray-700">Milestones</p>
          <CardNavLink label="View Milestones" onPress={() => goTab('milestones')} />
        </CardHeader>
        <CardBody>
          {milestonesArr.length > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Total</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{milestonesArr.length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Completed</p>
                <p className="text-lg font-semibold text-green-700 mt-0.5">{milestonesCompleted}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Overdue</p>
                <p className={`text-lg font-semibold mt-0.5 ${milestonesOverdue > 0 ? 'text-red-600' : 'text-gray-900'}`}>{milestonesOverdue}</p>
              </div>
            </div>
          ) : (
            <EmptyState title="No milestones yet" message="Milestones for this project will show up here." />
          )}
        </CardBody>
      </Card>

      {/* Row 3: Revenue + Leads */}
      {(canSeeSales || canSeeLease || canSeeLeads) && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Revenue</p>
            <CardNavLink label="View Revenue" onPress={() => goTab('revenue')} />
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Closed Sales</p>
                <p className="text-lg font-semibold text-green-700 mt-0.5">{fmt(pip.closedRevenue)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Pipeline Value</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(pip.totalPipelineValue)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Monthly Lease Income</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(li.total)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Annual Projection</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(li.annualProjection)}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Leads</p>
            <CardNavLink label="View Leads" onPress={() => goTab('leads')} />
          </CardHeader>
          <CardBody>
            {leadsArr.length > 0 ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Active</p>
                  <p className="text-lg font-semibold text-blue-700 mt-0.5">{leadsActive}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Converted</p>
                  <p className="text-lg font-semibold text-green-700 mt-0.5">{leadsConverted}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Lost</p>
                  <p className="text-lg font-semibold text-gray-500 mt-0.5">{leadsLost}</p>
                </div>
              </div>
            ) : (
              <EmptyState title="No leads yet" message="Leads for this project will show up here." />
            )}
          </CardBody>
        </Card>
      </div>
      )}

      {/* Row 4: Draws + Loans */}
      {(canSeeDraws || canSeeLoans) && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Draws</p>
            <CardNavLink label="View Draws" onPress={() => goTab('draws')} />
          </CardHeader>
          <CardBody>
            {drawsArr.length > 0 ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Total Draws</p>
                  <p className="text-lg font-semibold text-gray-900 mt-0.5">{drawsArr.length}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Funded</p>
                  <p className="text-lg font-semibold text-green-700 mt-0.5">{fmt(drawsFunded)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Pending</p>
                  <p className="text-lg font-semibold text-amber-600 mt-0.5">{fmt(drawsPending)}</p>
                </div>
              </div>
            ) : (
              <EmptyState title="No draws yet" message="Draw requests against this project's loans will show up here." />
            )}
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="pb-0 flex justify-between items-center">
            <p className="font-semibold text-sm text-gray-700">Loans</p>
            <CardNavLink label="View Draws" onPress={() => goTab('draws')} />
          </CardHeader>
          <CardBody>
            {(p.loans || []).length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-3 pb-3 border-b border-gray-100">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Monthly Debt Service</p>
                    <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(mp.total)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Annual Debt Service</p>
                    <p className="text-lg font-semibold text-gray-900 mt-0.5">{fmt(mp.annualTotal)}</p>
                  </div>
                </div>
                {p.loans.map((l: any) => (
                  <div key={l.id} className="flex justify-between items-center mb-1.5">
                    <span className="text-xs text-gray-600">{l.lender || '\u2014'}{' \u00b7 '}{l.loanType?.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-semibold tabular-nums">{fmt(l.principalAmt)}</span>
                  </div>
                ))}
              </>
            ) : (
              <EmptyState title="No loans yet" message="Loans attached to this project will show up here." />
            )}
          </CardBody>
        </Card>
      </div>
      )}

      {/* Row 5: Team Members */}
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
                {projectStatusOpts.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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
                {projectPhaseOpts.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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
// Budget categories used to be a fixed list here — they're now org-customizable via
// the CustomOption system (category="budget_category"), fetched with useCustomOptions.

const EMPTY_BUDGET = {
  category: 'HARD_COSTS', description: '', baselineAmt: '', revisedAmt: '', notes: '',
  buildingId: '', unitId: '',
};

const EMPTY_COMMITMENT = {
  vendor: '', description: '', category: 'HARD_COSTS', contractAmt: '',
  paidToDate: '', retainage: '', contractDate: '', notes: '', buildingId: '', unitId: '',
};

/** Budget/committed/actual/remaining rollup for every building and unit in a project, side-by-side. */
function BuildingUnitBudgetReport({ report, canViewFinancial, onSelectBuilding, onSelectUnit }: {
  report: any; canViewFinancial: boolean;
  onSelectBuilding?: (buildingId: string) => void;
  onSelectUnit?: (buildingId: string, unitId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const buildings = (report?.buildings || []) as any[];
  const unassigned = report?.unassigned;

  const varianceCell = (v: number) => (
    <td className={`py-2 px-2 text-right tabular-nums ${v >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(v)}</td>
  );

  const row = (opts: { key: string; label: string; sub?: string; indent?: boolean; bold?: boolean; row: any; onToggle?: () => void; isExpanded?: boolean; hasChildren?: boolean; onSelect?: () => void }) => (
    <tr key={opts.key} className="border-b border-gray-50">
      <td className={`py-2 px-2 ${opts.indent ? 'pl-8' : ''}`}>
        <div className="flex items-center gap-1.5">
          {opts.hasChildren ? (
            <button type="button" onClick={opts.onToggle} className="text-gray-400 hover:text-gray-600" aria-label={opts.isExpanded ? 'Collapse' : 'Expand'}>
              {opts.isExpanded ? <FiChevronDown className="w-3.5 h-3.5" /> : <FiChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : opts.indent ? <span className="w-3.5" /> : null}
          {opts.onSelect ? (
            <button
              type="button"
              onClick={opts.onSelect}
              className={`hover:underline hover:text-blue-600 text-left ${opts.bold ? 'font-semibold text-gray-700' : 'text-gray-600'}`}
              title={`Filter budget to ${opts.label}`}
            >
              {opts.label}
            </button>
          ) : (
            <span className={opts.bold ? 'font-semibold text-gray-700' : 'text-gray-600'}>{opts.label}</span>
          )}
          {opts.sub && <span className="text-xs text-gray-400">{opts.sub}</span>}
        </div>
      </td>
      <td className="py-2 px-2 text-right tabular-nums">{fmt(opts.row.budgetTotal)}</td>
      {canViewFinancial && <td className="py-2 px-2 text-right tabular-nums">{fmt(opts.row.actualTotal)}</td>}
      {canViewFinancial && <td className="py-2 px-2 text-right tabular-nums">{fmt(opts.row.committedTotal)}</td>}
      {canViewFinancial && <td className="py-2 px-2 text-right tabular-nums">{fmt(opts.row.remaining)}</td>}
      {canViewFinancial && varianceCell(opts.row.variance)}
      {canViewFinancial && <td className="py-2 px-2 text-right text-xs text-gray-500">{fmtPct(opts.row.variancePercent)}</td>}
    </tr>
  );

  if (buildings.length === 0) {
    return <EmptyState title="No buildings" message="Add a building to see budget tracking by building/unit." />;
  }

  return (
    <div className="overflow-x-auto">
      <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Building / Unit</th>
            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Budget</th>
            {canViewFinancial && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Actual</th>}
            {canViewFinancial && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Committed</th>}
            {canViewFinancial && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Remaining</th>}
            {canViewFinancial && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Variance</th>}
            {canViewFinancial && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase">% Used</th>}
          </tr>
        </thead>
        <tbody>
          {buildings.map((b: any) => {
            const isOpen = !!expanded[b.id];
            const units = (b.units || []) as any[];
            return (
              <React.Fragment key={b.id}>
                {row({
                  key: b.id, label: b.name, bold: true, row: b,
                  hasChildren: units.length > 0,
                  isExpanded: isOpen,
                  onToggle: () => setExpanded((e) => ({ ...e, [b.id]: !e[b.id] })),
                  onSelect: onSelectBuilding ? () => onSelectBuilding(b.id) : undefined,
                })}
                {isOpen && units.map((u: any) => row({
                  key: u.id, label: `Unit ${u.unitNumber}`, indent: true, row: u,
                  onSelect: onSelectUnit ? () => onSelectUnit(b.id, u.id) : undefined,
                }))}
              </React.Fragment>
            );
          })}
          {unassigned && (unassigned.budgetTotal || unassigned.actualTotal || unassigned.committedTotal) ? (
            row({ key: 'unassigned', label: 'Project-level (unassigned)', sub: 'not tied to a building/unit', row: unassigned })
          ) : null}
          {report?.project && row({ key: 'total', label: 'Project Total', bold: true, row: report.project })}
        </tbody>
      </table></div>
    </div>
  );
}

function FinancialsTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canEditBudget = hasPermission('budget:edit');
  const canViewFinancial = hasPermission('financial:view');

  const { data: buildings = [] } = useBuildings(projectId);
  const { data: units = [] } = useUnits(projectId);

  // Building/unit filter — scopes every panel below (stat cards, chart, tables) down
  // to one building or unit. "" means unfiltered/project-wide (existing behavior).
  const [filterBuildingId, setFilterBuildingId] = useState('');
  const [filterUnitId, setFilterUnitId] = useState('');
  const scopeBuildingId = filterBuildingId || undefined;
  const scopeUnitId = filterUnitId || undefined;
  const unitsInFilterBuilding = useMemo(
    () => (units as any[]).filter((u: any) => u.buildingId === filterBuildingId),
    [units, filterBuildingId],
  );
  const filterBuilding = (buildings as any[]).find((b: any) => b.id === filterBuildingId);
  const filterUnit = unitsInFilterBuilding.find((u: any) => u.id === filterUnitId);
  const clearFilter = () => { setFilterBuildingId(''); setFilterUnitId(''); };
  const selectFilterBuilding = (buildingId: string) => { setFilterBuildingId(buildingId); setFilterUnitId(''); };

  const { data, isLoading, error } = useFinancialSummary(projectId, scopeBuildingId, scopeUnitId);
  const { data: buildingUnitReport } = useBudgetByBuildingUnitReport(projectId);
  const { data: commitments } = useCommitments(projectId, scopeBuildingId, scopeUnitId);
  const { data: monthlyPaymentsData } = useMonthlyPayments(projectId);
  const { data: loans } = useLoans(projectId);
  const { data: budgetData } = useBudgetLines(projectId, scopeBuildingId, scopeUnitId);
  const { data: actualsData } = useActuals(projectId, scopeBuildingId, scopeUnitId);
  const { data: budgetCategories = [] } = useCustomOptions('budget_category');

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
  const [isCustomBudgetCategory, setIsCustomBudgetCategory] = useState(false);
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
    setIsCustomBudgetCategory(false);
    onBudgetFormOpen();
  };

  const openBudgetEdit = (b: any) => {
    setBudgetEditId(b.id);
    const category = b.category || 'HARD_COSTS';
    setBudgetForm({
      category,
      description: b.description || '',
      baselineAmt: b.baselineAmt?.toString() || '',
      revisedAmt: b.revisedAmt?.toString() || '',
      notes: b.notes || '',
      buildingId: b.buildingId || '',
      unitId: b.unitId || '',
    });
    setBudgetFormErrors({});
    // If the existing category isn't one of the known options (e.g. a category that
    // was later deactivated in Admin, or entered as free text), open in custom-text mode.
    setIsCustomBudgetCategory(!(budgetCategories as any[]).some((opt: any) => opt.value === category));
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
        // Empty selection clears the scope on edit (explicit null); on create, omit it
        // and the line stays project-level.
        buildingId: budgetForm.buildingId || (budgetEditId ? null : undefined),
        unitId: budgetForm.unitId || (budgetEditId ? null : undefined),
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
      buildingId: c.buildingId || '',
      unitId: c.unitId || '',
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
        buildingId: commitForm.buildingId || (commitEditId ? null : undefined),
        unitId: commitForm.unitId || (commitEditId ? null : undefined),
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
      {/* Building/Unit filter — scopes every panel below (stat cards, chart, tables) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          size="sm"
          label="Building"
          className="max-w-[220px]"
          selectedKeys={[filterBuildingId || '__ALL__']}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as string;
            selectFilterBuilding(val === '__ALL__' ? '' : val);
          }}
        >
          {[{ id: '__ALL__', name: 'All Buildings' }, ...(buildings as any[])].map((b: any) => (
            <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
          ))}
        </Select>
        {filterBuildingId && (
          <Select
            size="sm"
            label="Unit"
            className="max-w-[220px]"
            selectedKeys={[filterUnitId || '__ALL__']}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              setFilterUnitId(val === '__ALL__' ? '' : val);
            }}
          >
            {[{ id: '__ALL__', unitNumber: null }, ...unitsInFilterBuilding].map((u: any) => {
              const label = u.id === '__ALL__' ? `All Units in ${filterBuilding?.name ?? 'building'}` : `Unit ${u.unitNumber}`;
              return <SelectItem key={u.id} textValue={label}>{label}</SelectItem>;
            })}
          </Select>
        )}
        {(filterBuildingId || filterUnitId) && (
          <Chip variant="flat" color="primary" onClose={clearFilter}>
            Filtered to {filterUnit ? `Unit ${filterUnit.unitNumber}` : filterBuilding?.name}
          </Chip>
        )}
      </div>

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

      {/* Budget Tracking by Building/Unit */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0">
          <div>
            <p className="font-semibold text-sm text-gray-600">Budget Tracking by Building/Unit</p>
            <p className="text-xs text-gray-400 mt-0.5">Budget, committed, and actual costs for every building and unit — click the chevron to expand units, click a name to filter this whole page to it.</p>
          </div>
        </CardHeader>
        <CardBody>
          <BuildingUnitBudgetReport
            report={buildingUnitReport}
            canViewFinancial={canViewFinancial}
            onSelectBuilding={selectFilterBuilding}
            onSelectUnit={(buildingId, unitId) => { setFilterBuildingId(buildingId); setFilterUnitId(unitId); }}
          />
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
      <Card shadow="sm" className="mb-6">
        <CardHeader className="pb-0 flex justify-between items-center">
          <p className="font-semibold text-sm text-gray-600">Contracts & Commitments</p>
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCommitCreate}>
            Add Commitment
          </Button>
        </CardHeader>
        <CardBody>
          {commitmentList.length === 0 ? (
            <div className="flex items-center gap-2 py-4 px-1 text-sm text-gray-400">
              <FiPlus className="text-gray-300 shrink-0" />
              <span>No commitments yet — add the first vendor contract above.</span>
            </div>
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
      <Card shadow="sm" className="mb-6">
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
              <div>
                {isCustomBudgetCategory ? (
                  <Input
                    size="sm"
                    label="Category"
                    isRequired
                    placeholder="e.g. Interior Fit-Out"
                    value={budgetForm.category}
                    onChange={(e) => {
                      setBudget('category')(e);
                      if (budgetFormErrors.category) setBudgetFormErrors((errs) => ({ ...errs, category: '' }));
                    }}
                    isInvalid={!!budgetFormErrors.category}
                    errorMessage={budgetFormErrors.category}
                  />
                ) : (
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
                    {(budgetCategories as any[]).map((opt: any) => (
                      <SelectItem key={opt.value} textValue={opt.label}>{opt.label}</SelectItem>
                    ))}
                  </Select>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomBudgetCategory((v) => !v);
                    setBudgetForm((f) => ({ ...f, category: '' }));
                    if (budgetFormErrors.category) setBudgetFormErrors((errs) => ({ ...errs, category: '' }));
                  }}
                  className="mt-1 text-[11px] text-blue-600 hover:underline"
                >
                  {isCustomBudgetCategory ? 'Choose from list instead' : '+ Add custom category'}
                </button>
              </div>
              <Input
                size="sm" label="Description" isRequired
                value={budgetForm.description} onChange={setBudget('description')}
                isInvalid={!!budgetFormErrors.description} errorMessage={budgetFormErrors.description}
              />
              <Select
                size="sm"
                label="Building (optional)"
                selectedKeys={budgetForm.buildingId ? [budgetForm.buildingId] : []}
                onSelectionChange={(k) => {
                  const buildingId = (Array.from(k)[0] as string) || '';
                  setBudgetForm((f) => ({ ...f, buildingId, unitId: '' }));
                }}
                description="Leave blank for a project-level line"
              >
                {(buildings as any[]).map((b: any) => (
                  <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Unit (optional)"
                selectedKeys={budgetForm.unitId ? [budgetForm.unitId] : []}
                onSelectionChange={(k) => setBudgetForm((f) => ({ ...f, unitId: (Array.from(k)[0] as string) || '' }))}
                isDisabled={!budgetForm.buildingId}
                description={!budgetForm.buildingId ? 'Select a building first' : undefined}
              >
                {(units as any[]).filter((u: any) => (u.buildingId || u.building?.id) === budgetForm.buildingId).map((u: any) => (
                  <SelectItem key={u.id} textValue={u.unitNumber}>{u.unitNumber}</SelectItem>
                ))}
              </Select>
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
                {(budgetCategories as any[]).map((opt: any) => (
                  <SelectItem key={opt.value} textValue={opt.label}>{opt.label}</SelectItem>
                ))}
              </Select>
              <Input size="sm" label="Contract Amount" isRequired type="number" value={commitForm.contractAmt} onChange={setCommit('contractAmt')} />
              <Input size="sm" label="Paid to Date" type="number" value={commitForm.paidToDate} onChange={setCommit('paidToDate')} />
              <Input size="sm" label="Retainage" type="number" value={commitForm.retainage} onChange={setCommit('retainage')} />
              <Input size="sm" label="Contract Date" type="date" value={commitForm.contractDate} onChange={setCommit('contractDate')} />
              <Select
                size="sm"
                label="Building (optional)"
                selectedKeys={commitForm.buildingId ? [commitForm.buildingId] : []}
                onSelectionChange={(k) => {
                  const buildingId = (Array.from(k)[0] as string) || '';
                  setCommitForm((f) => ({ ...f, buildingId, unitId: '' }));
                }}
                description="Leave blank for a project-level commitment"
              >
                {(buildings as any[]).map((b: any) => (
                  <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                ))}
              </Select>
              <Select
                size="sm"
                label="Unit (optional)"
                selectedKeys={commitForm.unitId ? [commitForm.unitId] : []}
                onSelectionChange={(k) => setCommitForm((f) => ({ ...f, unitId: (Array.from(k)[0] as string) || '' }))}
                isDisabled={!commitForm.buildingId}
                description={!commitForm.buildingId ? 'Select a building first' : undefined}
              >
                {(units as any[]).filter((u: any) => (u.buildingId || u.building?.id) === commitForm.buildingId).map((u: any) => (
                  <SelectItem key={u.id} textValue={u.unitNumber}>{u.unitNumber}</SelectItem>
                ))}
              </Select>
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
  const { data: unitStatusOpts = [] } = useCustomOptions('unit_status');
  const UNIT_STATUSES = unitStatusOpts.map((o) => o.value);
  const UNIT_STATUS_LABELS: Record<string, string> = Object.fromEntries(unitStatusOpts.map((o) => [o.value, o.label]));
  const { data: unitTypeOpts = [] } = useCustomOptions('unit_type');
  const canStatusEdit = hasPermission('unit:edit'); // Sales falls into this branch
  const canDelete = hasPermission('unit:edit') && !isSales;
  const canCreate = canFullEdit;
  // A unit flipping to SOLD / LEASED should capture the deal behind it — but only for
  // users who are actually allowed to write that record.
  const canCreateSale = hasPermission('sales:edit');
  const canCreateLease = hasPermission('lease:edit');

  const { data, isLoading, error } = useUnits(projectId);
  const { data: buildingsData } = useBuildings(projectId);
  const { data: leaseIncome } = useMonthlyLeaseIncome(projectId);
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit();
  const deleteUnit = useDeleteUnit();
  const updateLease = useUpdateLease();
  const createSale = useCreateSale();
  const createLease = useCreateLease();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isStatusOpen, onOpen: onStatusOpen, onClose: onStatusClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const { isOpen: isCommentsOpen, onOpen: onCommentsOpen, onClose: onCommentsClose } = useDisclosure();
  const { isOpen: isCombineOpen, onOpen: onCombineOpen, onClose: onCombineClose } = useDisclosure();
  const { isOpen: isDealOpen, onOpen: onDealOpen, onClose: onDealClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_UNIT);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ id: string; unitNumber: string; currentStatus: string; newStatus: string; notes: string } | null>(null);
  const [activeLeaseId, setActiveLeaseId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; unitNumber: string; leaseCount: number; saleCount: number } | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [commentUnit, setCommentUnit] = useState<{ id: string; label: string } | null>(null);
  const [filterBuildingId, setFilterBuildingId] = useState<string>('');
  const [unitSearch, setUnitSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  // Follow-up deal capture after a unit flips to SOLD / LEASED.
  const [dealPrompt, setDealPrompt] = useState<{ kind: 'SALE' | 'LEASE'; unit: any } | null>(null);
  const [dealForm, setDealForm] = useState<Record<string, string>>(EMPTY_SALE);
  const [dealErrors, setDealErrors] = useState<Record<string, string>>({});
  const [dealError, setDealError] = useState<string | null>(null);

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
    // SALES uses the status + notes modal
    if (isSales) {
      setStatusTarget({
        id: u.id,
        unitNumber: u.unitNumber || '',
        currentStatus: u.status || 'AVAILABLE',
        newStatus: u.status || 'AVAILABLE',
        notes: u.notes || '',
      });
      onStatusOpen();
      return;
    }
    setEditId(u.id);
    setActiveLeaseId(u.leases?.[0]?.id || null);
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

  // ---- Post-status-change deal capture ---------------------------------------------
  // Runs only AFTER the unit status write has succeeded. The prompt is a bonus capture
  // step, never a gate: skipping it leaves the new status exactly as saved.
  const maybePromptForDeal = (unitBefore: any, prevStatus: string, newStatus: string) => {
    if (!unitBefore || newStatus === prevStatus) return;
    if (newStatus !== 'SOLD' && newStatus !== 'LEASED') return;
    const label = `Unit ${unitBefore.unitNumber || ''}`.trim();

    if (newStatus === 'SOLD') {
      if (!canCreateSale) return;
      // The unit list carries every non-deleted sale. A CANCELLED one is a dead deal and
      // shouldn't block a fresh record; anything else means the sale is already tracked,
      // and a second row would double-count the pipeline — so we point at it instead.
      const existing = (unitBefore.sales || []).find((s: any) => s.status !== 'CANCELLED');
      if (existing) {
        addToast({
          title: `${label} already has a sale record (${String(existing.status || '').replace(/_/g, ' ')}) — update it in the Revenue tab.`,
          color: 'warning',
        });
        return;
      }
      setDealForm({
        ...EMPTY_SALE,
        unitId: unitBefore.id,
        status: 'CLOSED',
        salePrice: unitBefore.askingPrice != null ? String(unitBefore.askingPrice) : '',
      });
      setDealErrors({});
      setDealError(null);
      setDealPrompt({ kind: 'SALE', unit: unitBefore });
      onDealOpen();
      return;
    }

    if (!canCreateLease) return;
    // `leases` on the project unit list is ACTIVE-only, so an expired or terminated
    // tenancy correctly does NOT block recording the new one.
    const activeLease = (unitBefore.leases || [])[0];
    if (activeLease) {
      addToast({
        title: `${label} already has an active lease (${activeLease.tenantName || 'tenant'}) — update it in the Revenue tab.`,
        color: 'warning',
      });
      return;
    }
    setDealForm({
      ...EMPTY_LEASE,
      unitId: unitBefore.id,
      status: 'ACTIVE',
      monthlyRent: unitBefore.askingRent != null ? String(unitBefore.askingRent) : '',
    });
    setDealErrors({});
    setDealError(null);
    setDealPrompt({ kind: 'LEASE', unit: unitBefore });
    onDealOpen();
  };

  const closeDealPrompt = () => {
    setDealPrompt(null);
    setDealError(null);
    setDealErrors({});
    onDealClose();
  };

  const skipDealPrompt = () => {
    // Guards against the modal's dismiss handler firing again after a successful save.
    if (!dealPrompt) return;
    const kind = dealPrompt.kind === 'SALE' ? 'sale' : 'lease';
    closeDealPrompt();
    addToast({ title: `Status saved. You can add the ${kind} details later from the Revenue tab.`, color: 'default' });
  };

  const handleDealSave = async () => {
    if (!dealPrompt) return;
    setDealError(null);
    try {
      if (dealPrompt.kind === 'SALE') {
        if (dealForm.status === 'CANCELLED' && !dealForm.lostReason) {
          setDealError('Please select a reason — why was this deal lost?');
          return;
        }
        await createSale.mutateAsync(buildSalePayload(dealForm, projectId));
        addToast({ title: 'Sale recorded', color: 'success' });
      } else {
        const errs = validateLeaseForm(dealForm);
        if (Object.keys(errs).length) { setDealErrors(errs); return; }
        await createLease.mutateAsync({ ...buildLeasePayload(dealForm), unitId: dealForm.unitId });
        addToast({ title: 'Lease recorded', color: 'success' });
      }
      closeDealPrompt();
    } catch (e) {
      const msg = errMsg(e, dealPrompt.kind === 'SALE' ? 'Failed to save sale' : 'Failed to save lease');
      setDealError(msg);
      addToast({ title: msg, color: 'danger' });
    }
  };

  const clearDealError = (field: string) => {
    if (dealErrors[field]) setDealErrors((errs) => ({ ...errs, [field]: '' }));
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    const unitBefore = editId ? allUnits.find((u: any) => u.id === editId) : null;
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
        // If tenant name was provided and an active lease exists, update it there.
        if (activeLeaseId && form.tenantName.trim()) {
          await updateLease.mutateAsync({ id: activeLeaseId, data: { tenantName: form.tenantName.trim() } });
        }
        addToast({ title: 'Unit updated', color: 'success' });
      } else {
        await createUnit.mutateAsync({ ...basePayload, buildingId: form.buildingId });
        addToast({ title: 'Unit created', color: 'success' });
      }
      onFormClose();
      if (unitBefore) maybePromptForDeal(unitBefore, unitBefore.status || '', form.status);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save unit'), color: 'danger' });
    }
  };

  const handleStatusSave = async () => {
    if (!statusTarget) { onStatusClose(); return; }
    const statusChanged = statusTarget.newStatus !== statusTarget.currentStatus;
    // Snapshot the unit BEFORE the write — the query cache is invalidated by the mutation.
    const unitBefore = allUnits.find((u: any) => u.id === statusTarget.id);
    const originalNotes = unitBefore?.notes || '';
    const notesChanged = statusTarget.notes !== originalNotes;
    if (!statusChanged && !notesChanged) { onStatusClose(); return; }
    try {
      const payload: Record<string, unknown> = {};
      if (statusChanged) payload.status = statusTarget.newStatus;
      if (notesChanged) payload.notes = statusTarget.notes;
      await updateUnit.mutateAsync({ id: statusTarget.id, data: payload });
      addToast({ title: statusChanged ? `Unit ${statusTarget.unitNumber} → ${statusTarget.newStatus.replace(/_/g, ' ')}` : 'Unit notes updated', color: 'success' });
      onStatusClose();
      const newStatus = statusTarget.newStatus;
      const prevStatus = statusTarget.currentStatus;
      setStatusTarget(null);
      if (statusChanged) maybePromptForDeal(unitBefore, prevStatus, newStatus);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update unit'), color: 'danger' });
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
                {(unitTypeOpts as any[]).map((opt: any) => (
                  <SelectItem key={opt.value} textValue={opt.label}>{opt.label}</SelectItem>
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
                {unitStatusOpts.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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
                <Input
                  size="sm"
                  label="Current Tenant"
                  value={form.tenantName}
                  onChange={set('tenantName')}
                  description={activeLeaseId ? 'Updates the active lease tenant name' : 'Add a lease in the Leases tab first to set a tenant'}
                  isDisabled={!activeLeaseId}
                />
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

      {/* Status + Notes Modal (SALES role) */}
      <Modal isOpen={isStatusOpen} onClose={onStatusClose} size="sm">
        <ModalContent>
          <ModalHeader>Edit Unit</ModalHeader>
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
                <Textarea
                  size="sm"
                  label="Notes"
                  value={statusTarget.notes}
                  onChange={(e) => setStatusTarget((s) => s ? { ...s, notes: e.target.value } : null)}
                  minRows={2}
                  placeholder="Add notes about this unit…"
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onStatusClose}>Cancel</Button>
            <Button
              size="sm" color="primary"
              onPress={handleStatusSave}
              isLoading={updateUnit.isPending}
            >
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Deal capture — opens AFTER a unit flips to SOLD / LEASED. Entirely optional:
          the status change is already persisted, so skipping loses nothing. */}
      <Modal isOpen={isDealOpen} onClose={skipDealPrompt} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>{dealPrompt?.kind === 'SALE' ? 'Record the sale details' : 'Record the lease details'}</span>
            <span className="text-xs font-normal text-gray-500">
              Unit {dealPrompt?.unit?.unitNumber || ''} is now{' '}
              {dealPrompt?.kind === 'SALE' ? 'SOLD' : 'LEASED'}
            </span>
          </ModalHeader>
          <ModalBody>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              The status change is already saved. Filling this in is optional — press
              <strong> Skip for now</strong> and add the {dealPrompt?.kind === 'SALE' ? 'sale' : 'lease'} later
              from the Revenue tab. The unit will stay {dealPrompt?.kind === 'SALE' ? 'SOLD' : 'LEASED'} either way.
            </div>
            <FormError message={dealError} />
            {dealPrompt?.kind === 'SALE' ? (
              <SaleFormFields
                form={dealForm}
                setForm={setDealForm}
                unitOptions={dealPrompt.unit ? [dealPrompt.unit] : []}
                formError={dealError}
                lockUnit
              />
            ) : dealPrompt ? (
              <LeaseFormFields
                form={dealForm}
                setForm={setDealForm}
                errors={dealErrors}
                clearError={clearDealError}
                unitOptions={dealPrompt.unit ? [dealPrompt.unit] : []}
                lockUnit
              />
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={skipDealPrompt}>Skip for now</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleDealSave}
              isLoading={createSale.isPending || createLease.isPending}
            >
              {dealPrompt?.kind === 'SALE' ? 'Save Sale' : 'Save Lease'}
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
  const { data: usersData } = useAssignableUsers();
  const { data: drawSchedules = [] } = useProjectDrawSchedules(projectId);
  const { data: projectPhaseOpts = [] } = useCustomOptions('project_phase');
  const { data: milestoneStatusOpts = [] } = useCustomOptions('milestone_status');
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
                {projectPhaseOpts.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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
                {milestoneStatusOpts.map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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
/** Local date input (YYYY-MM-DD) -> midday UTC ISO, so no timezone shifts the day. */
const toApiDate = (d: string) => new Date(`${d}T12:00:00.000Z`).toISOString();

function LeasesTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canEditLease = hasPermission('lease:edit');
  // Recording rent is deliberately a separate permission: AR/AP marks rent received
  // without also being able to rewrite the lease terms.
  const canCollectRent = hasPermission('rent:collect');
  // Rent schedule + deposits are per-lease detail: one row expanded at a time, mirroring
  // the SalesTab card-expansion pattern rather than opening yet another modal.
  const [expandedLease, setExpandedLease] = useState<string | null>(null);
  const { data: leases, isLoading: ll } = useLeases(projectId);
  const { data: rentRoll, isLoading: rl } = useRentRoll(projectId);
  const { data: unitsData } = useUnits(projectId);
  const createLease = useCreateLease();
  const updateLease = useUpdateLease();
  const deleteLease = useDeleteLease();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_LEASE);
  const [leaseFormError, setLeaseFormError] = useState<string | null>(null);
  const [leaseErrors, setLeaseErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const units = (unitsData as any[]) || [];

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_LEASE, unitId: units[0]?.id || '' });
    setLeaseErrors({});
    setLeaseFormError(null);
    onFormOpen();
  };
  const openEdit = (l: any) => {
    setEditId(l.id);
    setForm({
      unitId: l.unitId || l.unit?.id || '',
      tenantName: l.tenantName || '',
      tenantLegalName: l.tenantLegalName || '',
      tenantBrand: l.tenantBrand || '',
      tenantContact: l.tenantContact || '',
      tenantEmail: l.tenantEmail || '',
      tenantPhone: l.tenantPhone || '',
      monthlyRent: l.monthlyRent?.toString() || '',
      leaseStart: (l.leaseStart || l.startDate) ? (l.leaseStart || l.startDate).slice(0, 10) : '',
      leaseEnd: (l.leaseEnd || l.endDate) ? (l.leaseEnd || l.endDate).slice(0, 10) : '',
      termMonths: l.termMonths?.toString() || '',
      rentPerSqft: l.rentPerSqft?.toString() || '',
      escalationPct: (l.escalationPct ?? l.annualEscalation)?.toString() || '',
      escalationFreq: l.escalationFreq != null ? String(l.escalationFreq) : '',
      securityDeposit: l.securityDeposit?.toString() || '',
      rentDueDay: l.rentDueDay != null ? String(l.rentDueDay) : '',
      freeRentMonths: l.freeRentMonths ? String(l.freeRentMonths) : '',
      freeRentStartDate: l.freeRentStartDate ? String(l.freeRentStartDate).slice(0, 10) : '',
      status: l.status || 'DRAFT',
      notes: l.notes || '',
    });
    setLeaseErrors({});
    setLeaseFormError(null);
    onFormOpen();
  };
  const openDelete = (id: string) => { setDeleteId(id); onDeleteOpen(); };

  const handleSave = async () => {
    const errs = validateLeaseForm(form);
    if (Object.keys(errs).length) { setLeaseErrors(errs); return; }
    try {
      const payload = buildLeasePayload(form);
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
      const msg = errMsg(e, 'Failed to save lease');
      setLeaseFormError(msg);
      addToast({ title: msg, color: 'danger' });
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

  const clearLeaseError = (field: string) => {
    if (leaseErrors[field]) setLeaseErrors((errs) => ({ ...errs, [field]: '' }));
  };

  if (ll || rl) return <LoadingState />;
  const leaseList = (leases as any[]) || [];
  const rr = rentRoll as any;

  // Units already leased (any non-terminated/expired lease) or sold — excluded from the
  // "Add Lease" dropdown. When editing, the current unit is always kept in the list.
  const leasedUnitIds = new Set(
    leaseList
      .filter((l: any) => !['EXPIRED', 'TERMINATED'].includes(l.status))
      .map((l: any) => l.unitId)
      .filter(Boolean),
  );
  const availableForLease = units.filter(
    (u: any) => u.status !== 'SOLD' && (!leasedUnitIds.has(u.id) || u.id === form.unitId),
  );

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
          {/* totalMonthlyRent is the EFFECTIVE roll — the rent period covering today, so a
              lease inside a free-rent month contributes 0. contractedMonthlyRent is the sum
              of headline rents. Surfacing the gap stops the effective number looking like a
              bug when abatement kicks in. */}
          <StatCard
            label="Monthly Rent"
            value={fmt(rr.totalMonthlyRent)}
            colorScheme="brand"
            variant="revenue"
            helpText={
              rr.freeRentLeaseCount
                ? `${fmt(rr.contractedMonthlyRent)} contracted · ${rr.freeRentLeaseCount} in free rent`
                : undefined
            }
          />
          {/* Walks the actual rent schedule month by month — NOT monthly x 12, which
              over-states any lease with free months or a mid-year escalation. */}
          <StatCard
            label="Next 12 Months"
            value={fmt(rr.forwardYearRent ?? (rr.totalMonthlyRent || 0) * 12)}
            colorScheme="purple"
            variant="revenue"
            helpText="Scheduled rent, free-rent and escalations applied"
          />
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
                  <React.Fragment key={l.id}>
                  <tr className="border-b border-gray-50">
                    <td className="py-2 px-2 font-medium">
                      <div>
                        <span>{l.tenantBrand || l.tenantName}</span>
                        {l.tenantBrand && l.tenantName !== l.tenantBrand && (
                          <span className="text-xs text-gray-400 ml-1">({l.tenantName})</span>
                        )}
                      </div>
                      {/* Contact links live inside the Tenant cell rather than as two extra
                          columns — the table is already 8 columns wide at min-w-[560px]. */}
                      {(l.tenantEmail || l.tenantPhone) && (
                        <div className="flex items-center gap-2 mt-0.5 text-xs font-normal">
                          {l.tenantEmail && (
                            <a href={`mailto:${l.tenantEmail}`} className="text-blue-600 hover:underline truncate">{l.tenantEmail}</a>
                          )}
                          {l.tenantPhone && (
                            <a href={`tel:${l.tenantPhone}`} className="text-blue-600 hover:underline whitespace-nowrap">{l.tenantPhone}</a>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2">{l.unit?.unitNumber || l.unit?.name || '\u2014'}</td>
                    <td className="py-2 px-2 text-right">{fmt(l.monthlyRent)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseStart || l.startDate)}</td>
                    <td className="py-2 px-2">{fmtDate(l.leaseEnd || l.endDate)}</td>
                    <td className="py-2 px-2 text-right">{(l.escalationPct ?? l.annualEscalation) ? `${l.escalationPct ?? l.annualEscalation}%` : '\u2014'}</td>
                    <td className="py-2 px-2"><StatusBadge status={l.status} /></td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="light"
                          isIconOnly
                          onPress={() => setExpandedLease((cur) => (cur === l.id ? null : l.id))}
                          title={expandedLease === l.id ? 'Hide rent schedule & deposits' : 'Rent schedule & deposits'}
                          aria-label="Toggle rent schedule and deposits"
                          aria-expanded={expandedLease === l.id}
                        >
                          {expandedLease === l.id ? <FiChevronUp className="text-xs" /> : <FiChevronDown className="text-xs" />}
                        </Button>
                        <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(l)}><FiEdit2 className="text-xs" /></Button>
                        <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openDelete(l.id)}><FiTrash2 className="text-xs" /></Button>
                      </div>
                    </td>
                  </tr>
                  {expandedLease === l.id && (
                    <tr key={`${l.id}-detail`} className="border-b border-gray-100 bg-gray-50/60">
                      <td colSpan={8} className="p-4">
                        <div className="space-y-6">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Rent schedule &amp; history</p>
                            <LeaseRentSchedule leaseId={l.id} canEdit={canEditLease} />
                          </div>
                          <div>
                            {/* The schedule above says what is OWED each month; this says what
                                was PAID. Two different models, deliberately shown together. */}
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Rent collection</p>
                            <RentCollectionPanel
                              leaseId={l.id}
                              canCollect={canCollectRent}
                              unitId={l.unitId ?? l.unit?.id}
                            />
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Security deposit &amp; TI allowance</p>
                            <LeaseObligationsPanel
                              leaseId={l.id}
                              canEdit={canEditLease}
                              unitId={l.unitId ?? l.unit?.id}
                              buildingId={l.buildingId ?? l.building?.id}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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
            <FormError message={leaseFormError} />
            <LeaseFormFields
              form={form}
              setForm={setForm}
              errors={leaseErrors}
              clearError={clearLeaseError}
              unitOptions={availableForLease}
            />
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
                <TenantProfilePanel lease={l} unitNumber={l.unit?.unitNumber} />
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

// `mode` matters: projectId/unitId are create-only. A sale's project and asset link are
// fixed once it exists, so UpdateSaleDto rejects them outright — sending them on edit
// failed every save with "property projectId should not exist".
function buildSalePayload(
  form: Record<string, string>,
  projectId: string,
  mode: 'create' | 'update' = 'create',
): Record<string, unknown> {
  return {
    ...(mode === 'create' ? { projectId, unitId: form.unitId } : {}),
    buyer: form.buyer || undefined,
    salePrice: form.salePrice ? parseFloat(form.salePrice) : undefined,
    depositAmt: form.depositAmt ? parseFloat(form.depositAmt) : undefined,
    status: form.status,
    loiDate: form.loiDate ? toApiDate(form.loiDate) : undefined,
    contractDate: form.contractDate ? toApiDate(form.contractDate) : undefined,
    closingDate: form.closingDate ? toApiDate(form.closingDate) : undefined,
    expectedCloseDate: form.expectedCloseDate ? toApiDate(form.expectedCloseDate) : undefined,
    notes: form.notes || undefined,
    lostReason: form.status === 'CANCELLED' ? form.lostReason : undefined,
    lostReasonNote: form.status === 'CANCELLED' ? (form.lostReasonNote || undefined) : undefined,
    brokerId: form.brokerId || undefined,
    brokerCommissionPct: form.brokerCommissionPct ? parseFloat(form.brokerCommissionPct) : undefined,
  };
}

/**
 * The one and only sale field set. Rendered by the SalesTab create/edit modal and by the
 * UnitsTab post-status-change prompt so the two can never drift apart.
 */
function SaleFormFields({
  form, setForm, unitOptions, formError = null, lockUnit = false,
}: {
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  unitOptions: any[];
  formError?: string | null;
  lockUnit?: boolean;
}) {
  // Fetched here rather than passed in, so every caller gets the same option lists without
  // firing a broker:view request on tabs that never open this form.
  const { data: saleStatusOpts = [] } = useCustomOptions('sale_status');
  const { data: brokersData } = useBrokers();
  const brokers = (brokersData as any[]) || [];
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Select
        size="sm"
        label="Unit"
        isRequired
        isDisabled={lockUnit}
        description={lockUnit ? 'Locked to the unit you just updated' : undefined}
        selectedKeys={form.unitId ? [form.unitId] : []}
        onSelectionChange={(keys) => {
          const val = Array.from(keys)[0] as string;
          if (val) setForm((f) => ({ ...f, unitId: val }));
        }}
      >
        {unitOptions.map((u: any) => (
          <SelectItem key={u.id} textValue={u.unitNumber || u.name}>{u.unitNumber || u.name}</SelectItem>
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
        {saleStatusOpts.map((o) => (
          <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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
          <SelectItem key={b.id} textValue={b.id ? `${b.name}${b.company ? ` · ${b.company}` : ''}` : '— none —'}>
            {b.id ? `${b.name}${b.company ? ` · ${b.company}` : ''}` : '— none —'}
          </SelectItem>
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
            isInvalid={!form.lostReason && formError !== null}
            errorMessage="Required when cancelling"
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              if (val) setForm((f) => ({ ...f, lostReason: val }));
            }}
          >
            {LOST_REASONS.map((r) => (
              <SelectItem key={r.key} textValue={r.label}>{r.label}</SelectItem>
            ))}
          </Select>
          <Input size="sm" label="Reason note (optional)" value={form.lostReasonNote} onChange={set('lostReasonNote')} />
        </>
      )}

      <div className="sm:col-span-2">
        <Input size="sm" label="Notes" value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}

function SalesTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSalesPipeline(projectId);
  const { data: forecast } = useSalesForecast(projectId);
  const { data: unitsData } = useUnits(projectId);
  const createSale = useCreateSale();
  const updateSale = useUpdateSale();
  const deleteSale = useDeleteSale();
  const approveDiscount = useApproveSaleDiscount();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const { isOpen: isPayOpen, onOpen: onPayOpen, onClose: onPayClose } = useDisclosure();
  const { isOpen: isCancelOpen, onOpen: onCancelOpen, onClose: onCancelClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_SALE);
  const [saleFormError, setSaleFormError] = useState<string | null>(null);
  const handleSaleFormClose = () => { setSaleFormError(null); onFormClose(); };
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
    setSaleFormError(null);
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
    setSaleFormError(null);
    onFormOpen();
  };
  const openDelete = (id: string) => { setDeleteId(id); onDeleteOpen(); };

  const handleSave = async () => {
    setSaleFormError(null);
    // Slice 6: forced lost-reason picker — frontend insists before submit so the
    // user understands the audit captures *why* deals die.
    if (form.status === 'CANCELLED' && !form.lostReason) {
      setSaleFormError('Please select a reason — why was this deal lost?');
      return;
    }
    try {
      const payload = buildSalePayload(form, projectId, editId ? 'update' : 'create');
      if (editId) {
        await updateSale.mutateAsync({ id: editId, data: payload });
        addToast({ title: 'Sale updated', color: 'success' });
      } else {
        await createSale.mutateAsync(payload);
        addToast({ title: 'Sale created', color: 'success' });
      }
      handleSaleFormClose();
    } catch (e) {
      const msg = errMsg(e, 'Failed to save sale');
      setSaleFormError(msg);
      addToast({ title: msg, color: 'danger' });
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
      <Modal isOpen={isFormOpen} onClose={handleSaleFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{editId ? 'Edit Sale' : 'Add Sale'}</ModalHeader>
          <ModalBody>
            <FormError message={saleFormError} />
            <SaleFormFields
              form={form}
              setForm={setForm}
              unitOptions={units}
              formError={saleFormError}
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={handleSaleFormClose}>Cancel</Button>
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
const EMPTY_BUILDING = { name: '', llcName: '', totalSqft: '', acreage: '', stories: '', buildingType: '', phase: 'PRE_DEVELOPMENT', coverPhotoPath: '' };

function BuildingsTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('building:edit');
  const { data: projectPhaseOpts = [] } = useCustomOptions('project_phase');

  const { data, isLoading, error } = useBuildings(projectId);
  const createBuilding = useCreateBuilding();
  const updateBuilding = useUpdateBuilding();
  const deleteBuilding = useDeleteBuilding();
  const reorderBuildings = useReorderBuildings();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_BUILDING);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; unitCount: number } | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [buildingSearch, setBuildingSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [orderedBuildings, setOrderedBuildings] = useState<any[]>([]);

  const allBuildingsRaw = (data as any[]) || [];
  // Reorder mode always works on the full, unfiltered, server-order list — dragging
  // within a filtered/search subset would silently corrupt the persisted order for
  // buildings that are hidden by the current filter.
  useEffect(() => {
    if (!isReorderMode) setOrderedBuildings(allBuildingsRaw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isReorderMode]);

  const handleReorderDragEnd = () => {
    reorderBuildings.mutate(
      { projectId, buildingIds: orderedBuildings.map((b) => b.id) },
      {
        onError: (e) => {
          addToast({ title: errMsg(e, 'Failed to save building order — reverted'), color: 'danger' });
          setOrderedBuildings(allBuildingsRaw);
        },
      },
    );
  };

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
      llcName: b.llcName || '',
      totalSqft: b.totalSqft?.toString() || '',
      acreage: b.acreage?.toString() || '',
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
        llcName: form.llcName.trim() || undefined,
        totalSqft: form.totalSqft ? parseFloat(form.totalSqft) : undefined,
        acreage: form.acreage ? parseFloat(form.acreage) : undefined,
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

  const allBuildings = allBuildingsRaw;
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
          {!isLoading && !isReorderMode && (
            <p className="font-semibold text-sm text-gray-600">
              {buildings.length} building{buildings.length !== 1 ? '' : ''}
              {buildings.length !== allBuildings.length && (
                <span className="text-gray-400 font-normal"> of {allBuildings.length}</span>
              )}
            </p>
          )}
          {isReorderMode && (
            <p className="text-sm text-gray-500 flex items-center gap-1.5">
              <FiMove className="text-gray-400" /> Drag a building by its handle to reorder.
            </p>
          )}
          {!isReorderMode && allBuildings.length > 0 && (
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
          {!isReorderMode && buildingTypes.length > 1 && (
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
          {!isReorderMode && (buildingSearch || typeFilter) && (
            <Button
              size="sm"
              variant="light"
              onPress={() => { setBuildingSearch(''); setTypeFilter(''); }}
            >
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && allBuildings.length > 1 && (
            <Button
              size="sm"
              variant={isReorderMode ? 'solid' : 'flat'}
              color={isReorderMode ? 'primary' : 'default'}
              startContent={<FiMove />}
              onPress={() => setIsReorderMode((v) => !v)}
            >
              {isReorderMode ? 'Done Reordering' : 'Reorder Buildings'}
            </Button>
          )}
          {canEdit && !isReorderMode && (
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
              Add Building
            </Button>
          )}
        </div>
      </div>

      {/* Reorder mode: single-column drag list. framer-motion's Reorder.Group assumes
          a single axis, so it can't drive the multi-column card grid below directly —
          this mode swaps to a single-column list for the duration of the drag session
          instead of fighting that mismatch. */}
      {isReorderMode && (
        <Reorder.Group as="div" axis="y" values={orderedBuildings} onReorder={setOrderedBuildings} className="flex flex-col gap-2">
          {orderedBuildings.map((b: any) => (
            <ReorderableBuildingRow key={b.id} building={b} onDragEnd={handleReorderDragEnd} />
          ))}
        </Reorder.Group>
      )}

      {/* Loading skeletons */}
      {!isReorderMode && isLoading && (
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

      {!isReorderMode && !isLoading && error && <ErrorState message="Could not load buildings." />}

      {!isReorderMode && !isLoading && !error && buildings.length === 0 && allBuildings.length === 0 && (
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

      {!isReorderMode && !isLoading && !error && buildings.length === 0 && allBuildings.length > 0 && (
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

      {!isReorderMode && !isLoading && !error && buildings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buildings.map((b: any) => (
            <Card key={b.id} shadow="sm">
              {/* Slice 1: cover photo — bleeds to card edges as visual identity */}
              {b.coverPhotoPath && (
                <div className="w-full h-28 bg-gray-100 overflow-hidden">
                  <img
                    src={(b as any).coverPhotoUrl || ''}
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
                  {b.llcName && (
                    <p className="text-xs text-gray-400 truncate mt-0.5" title={b.llcName}>{b.llcName}</p>
                  )}
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
              <div className="sm:col-span-2">
                <Input
                  size="sm" label="LLC Name"
                  placeholder="e.g. Prime Leander I LLC"
                  description="Legal entity that owns this building"
                  value={form.llcName} onChange={set('llcName')}
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
                {/* LOT is a real BuildingType (raw-land parcel, sold by acreage, usually no
                    units inside) and was missing here, so land parcels could not be created
                    or corrected from the UI at all. */}
                {['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL', 'PARKING', 'AMENITY', 'RETAIL', 'OFFICE', 'LOT'].map((v) => (
                  <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>
                ))}
              </Select>
              <Input
                size="sm" label="Total Sqft" type="number" step="1"
                value={form.totalSqft} onChange={set('totalSqft')}
                isInvalid={!!formErrors.totalSqft} errorMessage={formErrors.totalSqft}
              />
              <Input
                size="sm" label="Acreage" type="number" step="0.01" min={0}
                value={form.acreage} onChange={set('acreage')}
                description="Land area — the key figure for LOT parcels"
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
                  {projectPhaseOpts.map((o) => (
                    <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
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

// A row in the Buildings reorder-mode list. Dragging only starts from the handle
// icon (dragListener={false} + manual dragControls.start on the handle's pointerdown)
// so the row's own click targets (e.g. a future link) aren't hijacked by drag.
function ReorderableBuildingRow({ building, onDragEnd }: { building: any; onDragEnd: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={building} dragListener={false} dragControls={controls} onDragEnd={onDragEnd}>
      <Card shadow="sm">
        <CardBody className="flex flex-row items-center gap-3 py-2.5">
          <div
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab active:cursor-grabbing shrink-0 text-gray-400 touch-none p-1"
            aria-label="Drag to reorder"
          >
            <FiMove />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900 truncate">{building.name}</span>
            {building.buildingType && (
              <span className="text-xs text-gray-400">{building.buildingType}</span>
            )}
            <span className="text-xs text-gray-400 ml-auto">
              {building._count?.units ?? building.units?.length ?? 0} unit{(building._count?.units ?? building.units?.length ?? 0) === 1 ? '' : 's'}
            </span>
          </div>
        </CardBody>
      </Card>
    </Reorder.Item>
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
  // Admin (Super Admin), Founder, Finance & Accounting hold budget:edit and may set the approved total.
  const canEditBudget = hasPermission('budget:edit');
  const budgetLinesRef = React.useRef<HTMLDivElement>(null);
  const scrollToLines = () => budgetLinesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const { data: project } = useProject(projectId);
  const { data: summary } = useFinancialSummary(projectId);
  const { data: revisions = [] } = useProjectBudgetRevisions(projectId);
  const setApprovedBudget = useSetApprovedBudget();
  const { isOpen: isApprovedOpen, onOpen: onApprovedOpen, onClose: onApprovedClose } = useDisclosure();
  const [approvedInput, setApprovedInput] = useState('');
  const s = summary as any;
  const proj = project as any;

  // Top-down approved total (control total) vs bottom-up planned (sum of lines).
  const approvedBudget = proj?.approvedBudget != null ? Number(proj.approvedBudget) : null;
  const planned = Number(s?.budgetTotal ?? 0);        // sum of budget lines
  const totalActuals = Number(s?.actualTotal ?? 0);
  const totalCommitted = Number(s?.committedTotal ?? 0);
  const baseTotal = approvedBudget ?? planned;        // headline number; falls back to planned if unset
  const remaining = baseTotal - totalActuals - totalCommitted;
  const usedPct = baseTotal > 0 ? Math.round(((totalActuals + totalCommitted) / baseTotal) * 100) : 0;
  const planVsApproved = approvedBudget != null ? planned - approvedBudget : null; // >0 means over-planned

  const openApprovedEdit = () => {
    setApprovedInput(approvedBudget != null ? String(approvedBudget) : (planned ? String(planned) : ''));
    onApprovedOpen();
  };
  const saveApproved = async () => {
    const val = approvedInput.trim() === '' ? undefined : parseFloat(approvedInput);
    if (val != null && (isNaN(val) || val < 0)) {
      addToast({ title: 'Enter a valid amount', color: 'warning' });
      return;
    }
    try {
      await setApprovedBudget.mutateAsync({ id: projectId, approvedBudget: val ?? null });
      addToast({ title: 'Approved budget updated', color: 'success' });
      onApprovedClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to update'), color: 'danger' }); }
  };

  const revList = revisions as any[];
  const reasonLabel = (r: string) => (r || '').replace(/_/g, ' ').toLowerCase();

  return (
    <div className="mt-4 space-y-6">
      <PermissionGate
        permission="budget:view"
        fallback={<EmptyState title="No access" message="You don't have permission to view budget data." />}
      >
        {/* Approved Budget banner — top-down control total, editable by Admin / Finance / Founder. */}
        <Card shadow="sm" className="border border-amber-100 bg-amber-50">
          <CardBody className="p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                {approvedBudget != null ? 'Approved Budget' : 'Total Project Budget'}
              </p>
              {canEditBudget ? (
                <Button size="sm" color="warning" variant="flat" startContent={<FiEdit2 className="text-[11px]" />} onPress={openApprovedEdit}>
                  {approvedBudget != null ? 'Edit approved budget' : 'Set approved budget'}
                </Button>
              ) : (
                <Chip size="sm" variant="flat" startContent={<FiLock className="text-[11px]" />} className="bg-amber-100 text-amber-700">
                  Read-only
                </Chip>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{fmt(baseTotal)}</p>
            {approvedBudget == null && (
              <p className="text-[11px] text-amber-700/80 mt-1">No approved total set — showing the sum of budget lines. {canEditBudget ? 'Set an approved budget to track plan-vs-approved.' : ''}</p>
            )}
            <Progress aria-label="Budget used" value={usedPct} size="sm" className="mt-3" color={usedPct > 100 ? 'danger' : 'warning'} />
            {/* Reconciliation: Approved → Planned → Committed → Actual */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Planned (lines)</p>
                <p className="text-sm font-semibold text-blue-600 tabular-nums">{fmt(planned)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Committed</p>
                <p className="text-sm font-semibold text-purple-600 tabular-nums">{fmt(totalCommitted)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Actuals</p>
                <p className="text-sm font-semibold text-orange-600 tabular-nums">{fmt(totalActuals)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Remaining</p>
                <p className={`text-sm font-semibold tabular-nums ${remaining >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(remaining)}</p>
              </div>
            </div>
            {/* Plan-vs-approved signal — the headline number for planning discipline. */}
            {planVsApproved != null && (
              <div className={`mt-4 rounded-lg px-3 py-2 text-xs font-medium ${planVsApproved > 0.5 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {planVsApproved > 0.5
                  ? `⚠ Planned lines exceed the approved budget by ${fmt(planVsApproved)} — re-plan or raise the approved total.`
                  : `✓ Planned lines are within the approved budget (${fmt(Math.abs(planVsApproved))} headroom).`}
              </div>
            )}
            <p className="text-[11px] text-amber-700/80 mt-3">
              {canEditBudget
                ? 'Approved budget is the top-down control total. The budget lines below are tracked against it — each line change is logged.'
                : 'Approved budget editing is limited to Admin, Finance and Founder.'}
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

      {/* Approved budget edit modal */}
      <Modal isOpen={isApprovedOpen} onClose={onApprovedClose} size="sm">
        <ModalContent>
          <ModalHeader>{approvedBudget != null ? 'Edit Approved Budget' : 'Set Approved Budget'}</ModalHeader>
          <ModalBody>
            <Input
              type="number"
              label="Approved budget ($)"
              placeholder="e.g. 18300000"
              value={approvedInput}
              onChange={(e) => setApprovedInput(e.target.value)}
              startContent={<span className="text-gray-400 text-sm">$</span>}
              description="The top-down control total approved by Finance/Founder. Leave blank to clear."
            />
            {planned > 0 && (
              <p className="text-xs text-gray-500">Current planned (sum of budget lines): <span className="font-semibold text-gray-700">{fmt(planned)}</span></p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onApprovedClose}>Cancel</Button>
            <Button color="primary" onPress={saveApproved} isLoading={setApprovedBudget.isPending}>Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ---- Revenue Tab (Sales Pipeline + Leases / Ren t Roll) ----
function RevenueTab({ projectId }: { projectId: string }) {
  const { data: pipeline } = useSalesPipeline(projectId);
  const { data: leaseIncome } = useMonthlyLeaseIncome(projectId);

  const pip = pipeline as any;
  const li = leaseIncome as any;

  // GET /sales/pipeline returns { byStatus, avgDaysToClose, totalPipelineValue, closedRevenue }.
  // The per-status sale arrays are nested under `byStatus` — NOT at the root — and salePrice
  // arrives as a Decimal-serialized string, so never sum it with a bare `+`. Use the totals the
  // API already computes (see SalesTab / OverviewTab, which read it the same way).
  const closedSalesValue = pip?.closedRevenue || 0;
  const underContractCount = pip?.byStatus?.UNDER_CONTRACT?.length || 0;
  const monthlyLease = li?.total || 0;

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-3">Revenue & Sales</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Closed Sales" value={fmt(closedSalesValue)} variant="revenue" colorScheme="green" />
        <StatCard label="Under Contract" value={String(underContractCount)} variant="revenue" colorScheme="brand" />
        <StatCard label="Monthly Lease Income" value={fmt(monthlyLease)} variant="revenue" colorScheme="teal" />
        {/* Run-rate, not a forecast: the lease-income endpoint returns monthly x 12 and is
            not free-rent or escalation aware. The schedule-accurate figure lives on the
            Leases rent roll below ("Next 12 Months"). */}
        <StatCard label="Annual Run-Rate" value={fmt(monthlyLease * 12)} variant="revenue" colorScheme="blue" helpText="Current monthly x 12" />
      </div>
      {/* Gated per section: the tab opens with sales:view OR lease:view, so without
          these a role holding only one of them would load the other half and 403. */}
      <PermissionGate permission="sales:view">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-0">Sales Pipeline</p>
        <SalesTab projectId={projectId} />
      </PermissionGate>
      <PermissionGate permission="lease:view">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mt-8 mb-0">Leases / Rent Roll</p>
        <LeasesTab projectId={projectId} />
      </PermissionGate>
    </div>
  );
}

// ---- Project Leads Tab ----
const LEAD_SOURCES_TAB = ['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'WALK_IN', 'SIGNAGE', 'COLD_CALL', 'EMAIL_CAMPAIGN', 'BROKER', 'LOOPNET', 'CREXI', 'OTHER'];
const SOURCE_LABELS_TAB: Record<string, string> = {
  WEBSITE: 'Website', REFERRAL: 'Referral', SOCIAL_MEDIA: 'Social Media',
  WALK_IN: 'Walk-In', SIGNAGE: 'Signage', COLD_CALL: 'Cold Call',
  EMAIL_CAMPAIGN: 'Email Campaign', BROKER: 'Broker',
  LOOPNET: 'LoopNet', CREXI: 'Crexi',
  EVENT: 'Event', OTHER: 'Other',
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
  // Campaigns attributable from inside a project: those linked to it, plus portfolio-wide
  // ones. PLANNED counts as well as ACTIVE — a campaign is created PLANNED, so filtering
  // to ACTIVE alone hid one you had just set up. PAUSED/COMPLETED stay out.
  const { data: projectCampaignList } = useCampaigns({ projectId });
  const { data: allCampaignList } = useCampaigns();
  const leadCampaignOptions = (() => {
    const ok = ['PLANNED', 'ACTIVE'];
    const out: any[] = []; const seen = new Set<string>();
    for (const c of ((projectCampaignList as any[]) || [])) {
      if (ok.includes(c.status) && !seen.has(c.id)) { out.push(c); seen.add(c.id); }
    }
    for (const c of ((allCampaignList as any[]) || [])) {
      if (ok.includes(c.status) && (!c.projects || c.projects.length === 0) && !seen.has(c.id)) {
        out.push(c); seen.add(c.id);
      }
    }
    return out;
  })();
  const deleteLead = useDeleteLead();
  const addActivity = useAddLeadActivity();
  const convertLead = useConvertLead();
  const { data: leadStatusOpts = [] } = useCustomOptions('lead_status');

  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [editLead, setEditLead] = useState<any>(null);
  const [activityNote, setActivityNote] = useState('');
  const [activityType, setActivityType] = useState('NOTE');
  const [convertForm, setConvertForm] = useState({ unitId: '', buyer: '', salePrice: '', contractDate: '', closingDate: '' });
  const setCF = (f: string, v: string) => setConvertForm((prev) => ({ ...prev, [f]: v }));
  const [filterGroup, setFilterGroup] = useState<'all' | 'active' | 'converted' | 'lost'>('all');
  const [search, setSearch] = useState('');
  const [popoverLeadId, setPopoverLeadId] = useState<string | null>(null);
  const [stageSuggestion, setStageSuggestion] = useState<{ leadId: string; suggestedStatus: string; label: string } | null>(null);

  const { data: activities } = useLeadActivities(selectedLead?.id || '');

  const [form, setForm] = useState({ name: '', email: '', phone: '', source: 'WEBSITE', status: 'NEW', unitId: '', unitInterest: '', budget: '', notes: '', campaignId: '' });
  const setF = (f: string, v: string) => setForm((prev) => ({ ...prev, [f]: v }));

  const resetForm = () => setForm({ name: '', email: '', phone: '', source: 'WEBSITE', status: 'NEW', unitId: '', unitInterest: '', budget: '', notes: '', campaignId: '' });

  const openNewForm = () => { resetForm(); setEditLead(null); setShowForm(true); };
  const openEditForm = (lead: any) => {
    setForm({ name: lead.name || '', email: lead.email || '', phone: lead.phone || '', source: lead.source || 'WEBSITE', status: lead.status || 'NEW', unitId: lead.unitId || '', unitInterest: lead.unitInterest || '', budget: lead.budget ? String(Number(lead.budget)) : '', notes: lead.notes || '', campaignId: lead.campaignId || '' });
    setEditLead(lead);
    setShowForm(true);
  };

  const handleSubmitLead = async () => {
    if (!form.source) return;
    try {
      const payload: Record<string, unknown> = {
        // projectId is create-only — a lead cannot move project, and UpdateLeadDto
        // has no such field, so sending it on edit is a 400.
        ...(editLead ? {} : { projectId }),
        source: form.source, status: form.status,
        name: form.name || undefined, email: form.email || undefined, phone: form.phone || undefined,
        unitId: form.unitId || (editLead ? null : undefined),
        unitInterest: form.unitInterest || undefined,
        budget: form.budget ? parseFloat(form.budget) : undefined,
        notes: form.notes || undefined,
        // Campaign attribution was missing from this form entirely, so a lead created
        // or edited from inside a project could never be attributed.
        campaignId: form.campaignId || (editLead ? null : undefined),
      };
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

  const STAGE_ORDER = ['NEW', 'CONTACTED', 'POTENTIAL', 'QUALIFIED', 'SITE_VISIT', 'PROPOSAL_SENT', 'NEGOTIATING'];
  const ACTIVITY_TO_STAGE: Record<string, string> = {
    CALL: 'CONTACTED', MEETING: 'QUALIFIED', SITE_VISIT: 'SITE_VISIT',
  };

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    setPopoverLeadId(null);
    try {
      await updateLead.mutateAsync({ id: leadId, data: { status: newStatus } });
      if (selectedLead?.id === leadId) setSelectedLead((prev: any) => ({ ...prev, status: newStatus }));
    } catch { addToast({ title: 'Failed to update status', color: 'danger' }); }
  };

  const getOtherStages = (currentStatus: string) => STAGE_ORDER.filter(s => s !== currentStatus);

  const handleAddActivity = async () => {
    if (!activityNote.trim() || !selectedLead) return;
    try {
      await addActivity.mutateAsync({ leadId: selectedLead.id, data: { type: activityType, note: activityNote.trim() } });
      setActivityNote('');
      const suggestedStage = ACTIVITY_TO_STAGE[activityType];
      if (suggestedStage && STAGE_ORDER.indexOf(suggestedStage) > STAGE_ORDER.indexOf(selectedLead.status)) {
        setStageSuggestion({ leadId: selectedLead.id, suggestedStatus: suggestedStage, label: suggestedStage.replace('_', ' ') });
      }
      setActivityType('NOTE');
    } catch { addToast({ title: 'Failed to log activity', color: 'danger' }); }
  };

  const leadsArr = (leads as any[]) || [];
  const ACTIVE_STATUSES = ['NEW', 'CONTACTED', 'POTENTIAL', 'QUALIFIED', 'SITE_VISIT', 'PROPOSAL_SENT', 'NEGOTIATING'];
  const PIPELINE_STAGES = ['NEW', 'CONTACTED', 'POTENTIAL', 'QUALIFIED', 'SITE_VISIT', 'PROPOSAL_SENT', 'NEGOTIATING'];
  const pipelineCounts = PIPELINE_STAGES.map(s => ({ status: s, count: leadsArr.filter((l: any) => l.status === s).length }));
  const pipelineTotal = pipelineCounts.reduce((sum, p) => sum + p.count, 0);
  const convertedCount = leadsArr.filter((l: any) => l.status === 'CONVERTED').length;
  const lostCount = leadsArr.filter((l: any) => ['LOST', 'DEAD'].includes(l.status)).length;

  const filtered = leadsArr.filter((l: any) => {
    const matchesGroup = filterGroup === 'all' ? true
      : filterGroup === 'active' ? ACTIVE_STATUSES.includes(l.status)
      : filterGroup === 'converted' ? l.status === 'CONVERTED'
      : ['LOST', 'DEAD'].includes(l.status);
    const matchesSearch = !search || [l.name, l.email, l.phone].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()));
    return matchesGroup && matchesSearch;
  });

  const STATUS_BAR: Record<string, string> = {
    NEW: 'bg-slate-400', CONTACTED: 'bg-blue-400', POTENTIAL: 'bg-blue-500',
    QUALIFIED: 'bg-violet-500', SITE_VISIT: 'bg-indigo-500',
    PROPOSAL_SENT: 'bg-amber-500', NEGOTIATING: 'bg-orange-500',
    CONVERTED: 'bg-emerald-500', LOST: 'bg-rose-400', DEAD: 'bg-stone-300',
  };
  const STATUS_BORDER: Record<string, string> = {
    NEW: 'border-l-slate-300', CONTACTED: 'border-l-blue-400', POTENTIAL: 'border-l-blue-500',
    QUALIFIED: 'border-l-violet-500', SITE_VISIT: 'border-l-indigo-500',
    PROPOSAL_SENT: 'border-l-amber-500', NEGOTIATING: 'border-l-orange-500',
    CONVERTED: 'border-l-emerald-500', LOST: 'border-l-rose-400', DEAD: 'border-l-stone-400',
  };
  const STATUS_LABEL: Record<string, string> = {
    NEW: 'New', CONTACTED: 'Contacted', POTENTIAL: 'Potential', QUALIFIED: 'Qualified',
    SITE_VISIT: 'Site Visit', PROPOSAL_SENT: 'Proposal', NEGOTIATING: 'Negotiating',
    CONVERTED: 'Converted', LOST: 'Lost', DEAD: 'Dead',
  };
  const STATUS_TEXT: Record<string, string> = {
    NEW: 'text-slate-500', CONTACTED: 'text-blue-600', POTENTIAL: 'text-blue-700',
    QUALIFIED: 'text-violet-600', SITE_VISIT: 'text-indigo-600',
    PROPOSAL_SENT: 'text-amber-600', NEGOTIATING: 'text-orange-600',
    CONVERTED: 'text-emerald-600', LOST: 'text-rose-500', DEAD: 'text-stone-400',
  };
  const ACT_ICON: Record<string, React.ReactNode> = {
    CALL: <FiPhone size={11} />, EMAIL: <FiMail size={11} />, MEETING: <FiUsers size={11} />,
    SITE_VISIT: <FiHome size={11} />, FOLLOW_UP: <FiCalendar size={11} />,
    NOTE: <FiMessageSquare size={11} />, STATUS_CHANGE: <FiCheck size={11} />,
  };
  const ACT_BG: Record<string, string> = {
    CALL: 'bg-blue-100 text-blue-600', EMAIL: 'bg-violet-100 text-violet-600',
    MEETING: 'bg-emerald-100 text-emerald-600', SITE_VISIT: 'bg-amber-100 text-amber-600',
    FOLLOW_UP: 'bg-orange-100 text-orange-600', NOTE: 'bg-stone-100 text-stone-600',
    STATUS_CHANGE: 'bg-indigo-100 text-indigo-600',
  };
  const daysSince = (lead: any) => {
    const d = lead.lastActivityAt || lead.createdAt;
    if (!d) return null;
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  };

  return (
    <div className="mt-2">
      {/* Pipeline Funnel Bar */}
      <div className="mb-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Pipeline</p>
          <div className="flex items-center gap-3 text-[11px] text-stone-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              {convertedCount} converted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-rose-400" />
              {lostCount} lost
            </span>
          </div>
        </div>
        <div className="flex gap-0.5 h-5 rounded-md overflow-hidden">
          {pipelineTotal === 0 ? (
            <div className="flex-1 bg-stone-200 flex items-center justify-center">
              <span className="text-[10px] text-stone-400">No active leads</span>
            </div>
          ) : (
            pipelineCounts.map(({ status, count }) => count > 0 ? (
              <div
                key={status}
                className={`${STATUS_BAR[status]} flex items-center justify-center text-white text-[9px] font-bold`}
                style={{ flex: count }}
                title={`${STATUS_LABEL[status]}: ${count}`}
              >
                {count}
              </div>
            ) : null)
          )}
        </div>
        <div className="flex gap-3 mt-2 flex-wrap">
          {pipelineCounts.filter(p => p.count > 0).map(({ status, count }) => (
            <span key={status} className="flex items-center gap-1 text-[10px] text-stone-500">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_BAR[status]}`} />
              {STATUS_LABEL[status]} ({count})
            </span>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-0.5 bg-stone-100 rounded-lg p-0.5">
          {(['all', 'active', 'converted', 'lost'] as const).map((g) => {
            const counts: Record<string, number> = {
              all: leadsArr.length,
              active: leadsArr.filter((l: any) => ACTIVE_STATUSES.includes(l.status)).length,
              converted: convertedCount,
              lost: lostCount,
            };
            return (
              <button
                key={g}
                onClick={() => setFilterGroup(g)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all capitalize ${filterGroup === g ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                {g} <span className="opacity-50">{counts[g]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 relative min-w-[140px]">
          <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" size={12} />
          <input
            type="text"
            placeholder="Search leads…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-[11px] border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-stone-300 text-stone-700 placeholder-stone-400"
          />
        </div>
        <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openNewForm} className="shrink-0">
          New Lead
        </Button>
      </div>

      {/* Main Layout */}
      <div className="flex gap-3 items-start">
        {/* Lead list */}
        <div className={`flex-1 min-w-0 space-y-1.5 ${selectedLead ? 'hidden lg:block' : ''}`}>
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 rounded-lg bg-stone-100 animate-pulse border-l-4 border-l-stone-200" />
              ))}
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="py-12 text-center">
              <FiTarget className="mx-auto text-stone-300 mb-2" size={28} />
              <p className="text-sm text-stone-400">
                {search ? 'No leads match your search' : leadsArr.length === 0 ? 'No leads yet — add your first' : 'No leads in this group'}
              </p>
              {leadsArr.length === 0 && (
                <Button size="sm" color="primary" className="mt-3" startContent={<FiPlus />} onPress={openNewForm}>Add Lead</Button>
              )}
            </div>
          )}

          {filtered.map((lead: any) => {
            const days = daysSince(lead);
            const isSelected = selectedLead?.id === lead.id;
            return (
              <div
                key={lead.id}
                onClick={() => { setSelectedLead(isSelected ? null : lead); setPopoverLeadId(null); }}
                className={`group relative flex items-center gap-3 rounded-lg border border-l-[3px] bg-white px-3.5 py-2.5 cursor-pointer transition-all ${STATUS_BORDER[lead.status] || 'border-l-stone-300'} ${isSelected ? 'border-stone-300 shadow-md ring-1 ring-stone-200' : 'border-stone-200 hover:border-stone-300 hover:shadow-sm'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-stone-800 truncate">
                      {lead.name || <span className="text-stone-400 font-normal italic text-xs">Unnamed</span>}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPopoverLeadId(popoverLeadId === lead.id ? null : lead.id); }}
                      className={`text-[9px] font-bold uppercase tracking-[0.08em] hover:opacity-70 transition-opacity ${STATUS_TEXT[lead.status] || 'text-stone-500'}`}
                    >
                      {STATUS_LABEL[lead.status] || lead.status} ▾
                    </button>
                    {popoverLeadId === lead.id && (
                      <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-stone-200 rounded-xl shadow-lg py-1.5 min-w-[172px]">
                        <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-stone-400">Set Stage</p>
                        {STAGE_ORDER.map(s => {
                          const isCurrent = s === lead.status;
                          const isBack = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(lead.status);
                          return (
                            <button key={s} onClick={(e) => { e.stopPropagation(); if (!isCurrent) handleStatusChange(lead.id, s); else setPopoverLeadId(null); }}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${isCurrent ? 'bg-stone-50 text-stone-800 font-semibold cursor-default' : isBack ? 'text-stone-500 hover:bg-stone-50' : 'text-stone-700 hover:bg-stone-50'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_BAR[s]}`} />
                              <span className="flex-1">{STATUS_LABEL[s]}</span>
                              {isCurrent && <FiCheck size={10} className="text-stone-500 shrink-0" />}
                              {isBack && !isCurrent && <span className="text-[9px] text-stone-300">↩</span>}
                            </button>
                          );
                        })}
                        {!['LOST', 'DEAD'].includes(lead.status) && (
                          <>
                            <div className="my-1 border-t border-stone-100" />
                            <button onClick={(e) => { e.stopPropagation(); handleStatusChange(lead.id, 'LOST'); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-rose-400" />
                              Mark as Lost
                            </button>
                          </>
                        )}
                        {['LOST', 'DEAD'].includes(lead.status) && (
                          <>
                            <div className="my-1 border-t border-stone-100" />
                            <button onClick={(e) => { e.stopPropagation(); handleStatusChange(lead.id, 'NEW'); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-slate-400" />
                              Reopen as New
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-stone-400">{SOURCE_LABELS_TAB[lead.source] || lead.source}</span>
                    {lead.email && <span className="text-[11px] text-stone-400 truncate max-w-[140px]">{lead.email}</span>}
                    {lead.unit?.unitNumber && (
                      <span className="text-[11px] text-stone-500 flex items-center gap-0.5">
                        <FiHome size={9} /> {lead.unit.unitNumber}
                      </span>
                    )}
                    {days !== null && days > 3 && (
                      <span className={`text-[10px] ${days > 14 ? 'text-rose-500' : days > 7 ? 'text-amber-500' : 'text-stone-400'}`}>
                        {days}d idle
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.budget && (
                    <span className="text-xs font-semibold text-stone-600 tabular-nums">${Number(lead.budget).toLocaleString()}</span>
                  )}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditForm(lead); }}
                      className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                    >
                      <FiEdit2 size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteLead(lead.id); }}
                      className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                    >
                      <FiTrash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Activity Panel */}
        {selectedLead && (
          <div className="w-full lg:w-[288px] lg:shrink-0">
            <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
              {/* Header */}
              <div className={`px-4 pt-4 pb-3 border-b border-stone-100 border-l-4 ${STATUS_BORDER[selectedLead.status] || 'border-l-stone-300'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-800 text-sm truncate">{selectedLead.name || 'Unnamed Lead'}</p>
                    <p className={`text-[9px] font-bold uppercase tracking-[0.1em] mt-0.5 ${STATUS_TEXT[selectedLead.status] || 'text-stone-500'}`}>
                      {STATUS_LABEL[selectedLead.status] || selectedLead.status}
                    </p>
                  </div>
                  <button onClick={() => setSelectedLead(null)} className="text-stone-400 hover:text-stone-600 mt-0.5 shrink-0">
                    <FiX size={14} />
                  </button>
                </div>
                <div className="mt-2 space-y-0.5">
                  {selectedLead.email && <p className="text-[11px] text-stone-400 flex items-center gap-1.5"><FiMail size={9} />{selectedLead.email}</p>}
                  {selectedLead.phone && <p className="text-[11px] text-stone-400 flex items-center gap-1.5"><FiPhone size={9} />{selectedLead.phone}</p>}
                  {selectedLead.budget && <p className="text-[11px] font-semibold text-stone-600 mt-1">${Number(selectedLead.budget).toLocaleString()} budget</p>}
                  {selectedLead.unit?.unitNumber && <p className="text-[11px] text-stone-400 flex items-center gap-1.5"><FiHome size={9} />Unit {selectedLead.unit.unitNumber}</p>}
                </div>
                {!['CONVERTED', 'LOST', 'DEAD'].includes(selectedLead.status) && (
                  <button
                    onClick={() => { setShowConvert(true); setConvertForm((f) => ({ ...f, unitId: selectedLead.unitId || '', buyer: selectedLead.name || '', salePrice: selectedLead.budget ? String(Number(selectedLead.budget)) : '' })); }}
                    className="mt-3 w-full text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg py-1.5 transition-colors"
                  >
                    Convert to Sale →
                  </button>
                )}
              </div>

              {/* Log Activity */}
              <div className="px-4 py-3 border-b border-stone-100">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400 mb-2">Log Activity</p>
                <div className="flex gap-1 mb-2">
                  {ACTIVITY_TYPES_TAB.map((t) => (
                    <button
                      key={t}
                      onClick={() => setActivityType(t)}
                      className={`flex items-center justify-center w-6 h-6 rounded transition-all ${activityType === t ? `${ACT_BG[t] || 'bg-stone-200 text-stone-600'} ring-1 ring-current` : 'text-stone-400 hover:bg-stone-100'}`}
                      title={t.replace('_', ' ')}
                    >
                      {ACT_ICON[t]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder={`${activityType.replace('_', ' ').toLowerCase()}…`}
                    value={activityNote}
                    onChange={(e) => setActivityNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddActivity(); }}
                    className="flex-1 px-2.5 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-300 text-stone-700 placeholder-stone-400 min-w-0"
                  />
                  <button
                    onClick={handleAddActivity}
                    disabled={!activityNote.trim() || addActivity.isPending}
                    className="px-2.5 py-1.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 disabled:opacity-40 transition-colors shrink-0"
                  >
                    <FiSend size={11} />
                  </button>
                </div>
              </div>

              {/* Stage promotion suggestion */}
              {stageSuggestion && stageSuggestion.leadId === selectedLead?.id && (
                <div className="px-4 py-2.5 border-b border-stone-100 bg-indigo-50 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-indigo-700">
                    Move to <strong className="capitalize">{stageSuggestion.label.toLowerCase()}</strong>?
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => { handleStatusChange(stageSuggestion.leadId, stageSuggestion.suggestedStatus); setStageSuggestion(null); }}
                      className="px-2 py-0.5 bg-indigo-600 text-white rounded text-[11px] font-medium hover:bg-indigo-700 transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setStageSuggestion(null)}
                      className="px-2 py-0.5 text-indigo-600 hover:bg-indigo-100 rounded text-[11px] transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {/* Activity Timeline */}
              <div className="px-4 py-3 max-h-[260px] overflow-y-auto">
                {(!activities || (activities as any[]).length === 0) ? (
                  <p className="text-[11px] text-stone-400 text-center py-4">No activities logged yet</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-[10px] top-1 bottom-1 w-px bg-stone-100" />
                    <div className="space-y-3">
                      {(activities as any[]).map((act: any) => (
                        <div key={act.id} className="flex gap-2.5 relative">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 ${ACT_BG[act.type] || 'bg-stone-100 text-stone-500'}`}>
                            {ACT_ICON[act.type] || <FiMessageSquare size={10} />}
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <span className="text-[10px] font-semibold text-stone-600">{act.type.replace('_', ' ')}</span>
                              <span className="text-[10px] text-stone-400">{fmtDate(act.createdAt)}</span>
                            </div>
                            <p className="text-xs text-stone-600 leading-snug mt-0.5">{act.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
                {LEAD_SOURCES_TAB.map((s) => <SelectItem key={s} textValue={SOURCE_LABELS_TAB[s] || s}>{SOURCE_LABELS_TAB[s] || s}</SelectItem>)}
              </Select>
              <Select size="sm" label="Status" selectedKeys={new Set([form.status])} onSelectionChange={(k) => setF('status', Array.from(k)[0] as string)}>
                {leadStatusOpts.map((o) => <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>)}
              </Select>
              <Select
                size="sm"
                label="Unit"
                placeholder="No specific unit"
                selectedKeys={form.unitId ? new Set([form.unitId]) : new Set()}
                onSelectionChange={(k) => setF('unitId', (Array.from(k)[0] as string) || '')}
                className="sm:col-span-2"
              >
                {((projectUnits as any[]) || []).map((u: any) => {
                  const label = `${u.unitNumber}${u.status ? ` · ${u.status.replace('_', ' ')}` : ''}`;
                  return <SelectItem key={u.id} textValue={label}>{label}</SelectItem>;
                })}
              </Select>
              <Input size="sm" label="Notes on interest" placeholder="e.g. 2BR preference" value={form.unitInterest} onChange={(e) => setF('unitInterest', e.target.value)} className="sm:col-span-2" />
              <Select
                size="sm"
                label="Campaign"
                placeholder="No specific campaign"
                className="sm:col-span-2"
                selectedKeys={form.campaignId ? new Set([form.campaignId]) : new Set()}
                onSelectionChange={(k) => setF('campaignId', (Array.from(k)[0] as string) || '')}
                description={leadCampaignOptions.length === 0
                  ? 'No planned or active campaign is linked to this project yet.'
                  : undefined}
              >
                {leadCampaignOptions.map((c: any) => (
                  <SelectItem key={c.id} textValue={c.name}>
                    {c.name} · {String(c.channel).replace('_', ' ')}
                  </SelectItem>
                ))}
              </Select>
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

      {/* Convert to Sale Modal */}
      <Modal isOpen={showConvert} onClose={() => setShowConvert(false)} size="md">
        <ModalContent>
          <ModalHeader>Convert Lead to Sale</ModalHeader>
          <ModalBody>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">This will create a sale record and mark the lead as Converted.</p>
              <Select size="sm" label="Unit *" selectedKeys={convertForm.unitId ? new Set([convertForm.unitId]) : new Set()} onSelectionChange={(k) => setCF('unitId', Array.from(k)[0] as string)}>
                {((projectUnits as any[]) || []).filter((u: any) => u.status !== 'SOLD').map((u: any) => {
                  const label = `${u.unitNumber}${u.building?.name ? ` — ${u.building.name}` : ''} (${u.status})`;
                  return <SelectItem key={u.id} textValue={label}>{label}</SelectItem>;
                })}
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

const EMPTY_DRAW = { loanId: '', requestedAmount: '', requestDate: '', expectedFundingDate: '', notes: '' };
const EMPTY_SCHEDULE_LINE = { drawNumber: '', plannedAmount: '', plannedDate: '', description: '' };

const EMPTY_LOAN = {
  loanType: 'CONSTRUCTION', lender: '', principalAmt: '', interestRate: '', termMonths: '',
  maturityDate: '', currentBalance: '', monthlyPayment: '', notes: '', buildingId: '', unitId: '',
};

function DrawsTab({ projectId }: { projectId: string }) {
  const { data: draws = [], isLoading } = useProjectDraws(projectId);
  const { data: loans = [] } = useLoans(projectId);
  const { data: buildings = [] } = useBuildings(projectId);
  const { data: units = [] } = useUnits(projectId);
  const { data: loanTypes = [] } = useCustomOptions('loan_type');
  const createDraw = useCreateDraw();
  const updateDraw = useUpdateDraw();
  const deleteDraw = useDeleteDraw();
  const createLoan = useCreateLoan();
  const updateLoan = useUpdateLoan();
  const deleteLoan = useDeleteLoan();
  const { hasPermission } = useAuthStore();
  // Same permission the API requires for POST /loans/:loanId/draws, DELETE /loans/draws/:id,
  // and the draw-schedule mutating routes — one gate for every mutating action in this tab.
  const canEdit = hasPermission('draw:edit');
  const canEditLoans = hasPermission('loan:edit');

  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isLoanOpen, onOpen: onLoanOpen, onClose: onLoanClose } = useDisclosure();
  const { isOpen: isLoanDeleteOpen, onOpen: onLoanDeleteOpen, onClose: onLoanDeleteClose } = useDisclosure();
  const [loanDeleteTarget, setLoanDeleteTarget] = useState<{ id: string; lender: string; principalAmt: number } | null>(null);

  const [form, setForm] = useState<Record<string, string>>(EMPTY_DRAW);
  const [editingDrawId, setEditingDrawId] = useState<string | null>(null);
  // Slice 8 — detail modal with stepper + checklist + workflow buttons
  const [detailDrawId, setDetailDrawId] = useState<string | null>(null);
  // 'documents' right after creating a draw so the modal lands on the upload step;
  // 'workflow' (the modal's own default) for every other way of opening it.
  const [detailDrawDefaultTab, setDetailDrawDefaultTab] = useState<'workflow' | 'documents' | undefined>(undefined);

  const [loanForm, setLoanForm] = useState<Record<string, string>>(EMPTY_LOAN);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [isCustomLoanType, setIsCustomLoanType] = useState(false);

  const set = (f: string) => (e: any) => setForm((p) => ({ ...p, [f]: e.target.value }));
  const setLoanField = (f: string) => (e: any) => setLoanForm((p) => ({ ...p, [f]: e.target.value }));

  const drawList = draws as any[];
  const totalDraws = drawList.length;
  const funded = drawList.filter((d) => d.status === 'FUNDED').reduce((s: number, d: any) => s + fundedAmount(d), 0);
  const pending = drawList.filter((d) => ['SUBMITTED', 'APPROVED'].includes(d.status)).reduce((s: number, d: any) => s + fundedAmount(d), 0);

  const openAddDraw = () => {
    setEditingDrawId(null);
    setForm(EMPTY_DRAW);
    onOpen();
  };

  const openDrawDetail = (id: string, tab?: 'workflow' | 'documents') => {
    setDetailDrawDefaultTab(tab);
    setDetailDrawId(id);
  };

  const openEditDraw = (draw: any) => {
    setEditingDrawId(draw.id);
    setForm({
      loanId: draw.loanId || '',
      requestedAmount: String(draw.requestedAmount ?? draw.amount ?? ''),
      requestDate: draw.requestDate ? String(draw.requestDate).slice(0, 10) : '',
      expectedFundingDate: draw.expectedFundingDate ? String(draw.expectedFundingDate).slice(0, 10) : '',
      notes: draw.notes || '',
    });
    onOpen();
  };

  const handleSave = async () => {
    try {
      if (editingDrawId) {
        await updateDraw.mutateAsync({
          id: editingDrawId,
          projectId,
          requestedAmount: form.requestedAmount ? parseFloat(form.requestedAmount) : undefined,
          requestDate: form.requestDate || undefined,
          expectedFundingDate: form.expectedFundingDate || undefined,
          notes: form.notes,
        });
        addToast({ title: 'Draw request updated', color: 'success' });
        setForm(EMPTY_DRAW);
        setEditingDrawId(null);
        onClose();
      } else {
        const created = await createDraw.mutateAsync({
          loanId: form.loanId, projectId, requestedAmount: form.requestedAmount,
          expectedFundingDate: form.expectedFundingDate || undefined, notes: form.notes,
        });
        addToast({ title: 'Draw request created', color: 'success' });
        setForm(EMPTY_DRAW);
        onClose();
        // Land straight on the Documents tab so the user can attach the lender's
        // required docs (lien waiver, invoice, etc.) right after creating the draw,
        // instead of having to find and reopen it from the table.
        openDrawDetail(created.id, 'documents');
      }
    } catch (e) { addToast({ title: errMsg(e, `Failed to ${editingDrawId ? 'update' : 'create'} draw`), color: 'danger' }); }
  };

  const handleDelete = async (draw: any) => {
    try {
      await deleteDraw.mutateAsync({ id: draw.id, projectId });
      addToast({ title: 'Draw deleted', color: 'success' });
    } catch (e) { addToast({ title: errMsg(e, 'Failed to delete draw'), color: 'danger' }); }
  };

  const openAddLoan = () => {
    setEditingLoanId(null);
    setLoanForm(EMPTY_LOAN);
    setIsCustomLoanType(false);
    onLoanOpen();
  };

  const openEditLoan = (loan: any) => {
    setEditingLoanId(loan.id);
    const loanType = loan.loanType || 'CONSTRUCTION';
    setLoanForm({
      loanType,
      lender: loan.lender || '',
      principalAmt: loan.principalAmt != null ? String(loan.principalAmt) : '',
      interestRate: loan.interestRate != null ? String(loan.interestRate) : '',
      termMonths: loan.termMonths != null ? String(loan.termMonths) : '',
      maturityDate: loan.maturityDate ? loan.maturityDate.slice(0, 10) : '',
      currentBalance: loan.currentBalance != null ? String(loan.currentBalance) : '',
      monthlyPayment: loan.monthlyPayment != null ? String(loan.monthlyPayment) : '',
      notes: loan.notes || '',
      buildingId: loan.buildingId || '',
      unitId: loan.unitId || '',
    });
    // If the existing type isn't one of the known options (e.g. deactivated in Admin,
    // or entered as free text), open the form in custom-text mode.
    setIsCustomLoanType(!(loanTypes as any[]).some((opt: any) => opt.value === loanType));
    onLoanOpen();
  };

  const handleSaveLoan = async () => {
    const payload: Record<string, unknown> = {
      loanType: loanForm.loanType,
      lender: loanForm.lender,
      principalAmt: parseFloat(loanForm.principalAmt) || 0,
      interestRate: parseFloat(loanForm.interestRate) || 0,
      termMonths: parseInt(loanForm.termMonths, 10) || 0,
      maturityDate: loanForm.maturityDate || undefined,
      currentBalance: loanForm.currentBalance ? parseFloat(loanForm.currentBalance) : undefined,
      monthlyPayment: loanForm.monthlyPayment ? parseFloat(loanForm.monthlyPayment) : undefined,
      notes: loanForm.notes || undefined,
      // Empty selection clears the linkage on edit (explicit null); on create, just omit it
      // and let the project-level linkage stand.
      buildingId: loanForm.buildingId || (editingLoanId ? null : undefined),
      unitId: loanForm.unitId || (editingLoanId ? null : undefined),
    };
    try {
      if (editingLoanId) {
        await updateLoan.mutateAsync({ id: editingLoanId, projectId, ...payload });
        addToast({ title: 'Loan updated', color: 'success' });
      } else {
        await createLoan.mutateAsync({ projectId, ...payload });
        addToast({ title: 'Loan created', color: 'success' });
      }
      setLoanForm(EMPTY_LOAN);
      setEditingLoanId(null);
      onLoanClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to save loan'), color: 'danger' }); }
  };

  const openLoanDelete = (loan: any) => {
    setLoanDeleteTarget({ id: loan.id, lender: loan.lender, principalAmt: Number(loan.principalAmt || 0) });
    onLoanDeleteOpen();
  };

  const handleDeleteLoan = async () => {
    if (!loanDeleteTarget) return;
    try {
      await deleteLoan.mutateAsync({ id: loanDeleteTarget.id, projectId });
      addToast({ title: 'Loan deleted', color: 'success' });
      onLoanDeleteClose();
      setLoanDeleteTarget(null);
    } catch (e) { addToast({ title: errMsg(e, 'Failed to delete loan'), color: 'danger' }); }
  };

  // ---- Draw Schedule sub-view ----
  const loanList = loans as any[];
  const [scheduleLoanId, setScheduleLoanId] = useState<string>('');
  const effectiveScheduleLoanId = scheduleLoanId || loanList[0]?.id || '';
  const { data: schedule = [] } = useDrawSchedule(effectiveScheduleLoanId);
  const upsertScheduleLine = useUpsertDrawScheduleLine();
  const deleteScheduleLine = useDeleteDrawScheduleLine();

  const { isOpen: isScheduleOpen, onOpen: onScheduleOpen, onClose: onScheduleClose } = useDisclosure();
  const [scheduleForm, setScheduleForm] = useState<Record<string, string>>(EMPTY_SCHEDULE_LINE);
  const [editingScheduleLine, setEditingScheduleLine] = useState<any>(null);
  const setSchedule = (f: string) => (e: any) => setScheduleForm((p) => ({ ...p, [f]: e.target.value }));

  const scheduleList = (schedule as any[]).slice().sort((a, b) => a.drawNumber - b.drawNumber);

  const openAddScheduleLine = () => {
    setEditingScheduleLine(null);
    setScheduleForm({ ...EMPTY_SCHEDULE_LINE, drawNumber: String(scheduleList.length + 1) });
    onScheduleOpen();
  };

  const openEditScheduleLine = (line: any) => {
    setEditingScheduleLine(line);
    setScheduleForm({
      drawNumber: String(line.drawNumber),
      plannedAmount: String(line.plannedAmount ?? ''),
      plannedDate: line.plannedDate ? String(line.plannedDate).slice(0, 10) : '',
      description: line.description || '',
    });
    onScheduleOpen();
  };

  const handleSaveScheduleLine = async () => {
    try {
      await upsertScheduleLine.mutateAsync({
        loanId: effectiveScheduleLoanId,
        drawNumber: parseInt(scheduleForm.drawNumber, 10),
        plannedAmount: parseFloat(scheduleForm.plannedAmount) || 0,
        plannedDate: scheduleForm.plannedDate,
        description: scheduleForm.description || undefined,
      });
      addToast({ title: editingScheduleLine ? 'Schedule line updated' : 'Schedule line added', color: 'success' });
      onScheduleClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to save schedule line'), color: 'danger' }); }
  };

  const handleDeleteScheduleLine = async (line: any) => {
    try {
      await deleteScheduleLine.mutateAsync({ id: line.id, loanId: effectiveScheduleLoanId });
      addToast({ title: 'Schedule line deleted', color: 'success' });
    } catch (e) { addToast({ title: errMsg(e, 'Failed to delete schedule line'), color: 'danger' }); }
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
          <span className="font-semibold text-sm">Loans</span>
          {canEditLoans && (
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openAddLoan}>Add Loan</Button>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {(loans as any[]).length === 0 ? (
            <div className="p-6"><EmptyState message="No loans yet — add a loan before creating draw requests" /></div>
          ) : (
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Lender', 'Type', 'Linked To', 'Principal', 'Rate', 'Term', 'Maturity', ...(canEditLoans ? ['Actions'] : [])].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(loans as any[]).map((l: any) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">{l.lender}</td>
                    <td className="px-4 py-3"><Chip size="sm" variant="flat">{l.loanType}</Chip></td>
                    <td className="px-4 py-3 text-gray-500">
                      {l.unit ? `${l.unit.building?.name || ''} - ${l.unit.unitNumber}` : l.building?.name || 'Project-level'}
                    </td>
                    <td className="px-4 py-3 font-mono">{fmt(Number(l.principalAmt || 0))}</td>
                    <td className="px-4 py-3">{l.interestRate != null ? `${l.interestRate}%` : '—'}</td>
                    <td className="px-4 py-3">{l.termMonths} mo</td>
                    <td className="px-4 py-3 text-gray-500">{l.maturityDate ? fmtDate(l.maturityDate) : '—'}</td>
                    {canEditLoans && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="light" isIconOnly onPress={() => openEditLoan(l)} aria-label="Edit loan">
                            <FiEdit2 />
                          </Button>
                          <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => openLoanDelete(l)} aria-label="Delete loan">
                            <FiTrash2 />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center">
          <span className="font-semibold text-sm">Draw Requests</span>
          {canEdit && (
            <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openAddDraw}>Add Draw</Button>
          )}
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
                    onClick={() => openDrawDetail(d.id)}
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
                        <Button size="sm" variant="flat" onPress={() => openDrawDetail(d.id)}>
                          Open
                        </Button>
                        {canEdit && d.status === 'DRAFT' && (
                          <>
                            <Button size="sm" variant="light" isIconOnly onPress={() => openEditDraw(d)}>
                              <FiEdit2 />
                            </Button>
                            <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => handleDelete(d)}>
                              <FiTrash2 />
                            </Button>
                          </>
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

      {/* Create/Edit Draw Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalContent>
          <ModalHeader>{editingDrawId ? 'Edit Draw Request' : 'Add Draw Request'}</ModalHeader>
          <ModalBody className="space-y-3">
            <Select
              label="Loan"
              selectedKeys={form.loanId ? [form.loanId] : []}
              onSelectionChange={(k) => setForm((p) => ({ ...p, loanId: Array.from(k)[0] as string }))}
              isDisabled={!!editingDrawId}
              description={editingDrawId ? 'Loan cannot be changed once a draw is created' : undefined}
            >
              {(loans as any[]).map((l: any) => (
                <SelectItem key={l.id} textValue={`${l.lender || l.loanType} — ${fmt(Number(l.principalAmt || 0))}`}>{l.lender || l.loanType} — {fmt(Number(l.principalAmt || 0))}</SelectItem>
              ))}
            </Select>
            <Input label="Requested Amount ($)" type="number" value={form.requestedAmount} onChange={set('requestedAmount')} />
            <Input label="Request Date" type="date" value={form.requestDate} onChange={set('requestDate')} />
            <Input
              label="Expected Funding Date" type="date" value={form.expectedFundingDate} onChange={set('expectedFundingDate')}
              description="If not funded by this date, Founder/Finance/AR-AP get an overdue alert"
            />
            <Textarea label="Notes" value={form.notes} onChange={set('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={createDraw.isPending || updateDraw.isPending}>
              {editingDrawId ? 'Save' : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Draw Schedule sub-view — planned draws per loan, feeds the Milestones "Linked Draw" picker */}
      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-sm">Draw Schedule</span>
            {loanList.length > 1 && (
              <Select
                size="sm"
                className="w-56"
                aria-label="Loan"
                selectedKeys={effectiveScheduleLoanId ? [effectiveScheduleLoanId] : []}
                onSelectionChange={(k) => setScheduleLoanId(Array.from(k)[0] as string)}
              >
                {loanList.map((l: any) => (
                  <SelectItem key={l.id} textValue={l.lender || l.loanType}>{l.lender || l.loanType}</SelectItem>
                ))}
              </Select>
            )}
          </div>
          {canEdit && (
            <Button size="sm" color="primary" variant="flat" startContent={<FiPlus />} onPress={openAddScheduleLine} isDisabled={!effectiveScheduleLoanId}>
              Add Line
            </Button>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {!effectiveScheduleLoanId ? (
            <div className="p-6"><EmptyState message="No loan available for this project yet" /></div>
          ) : scheduleList.length === 0 ? (
            <div className="p-6"><EmptyState message="No draw schedule lines yet" /></div>
          ) : (
            <div className="responsive-table-wrap"><table className="w-full text-sm min-w-[520px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['#', 'Planned Amount', 'Planned Date', 'Description', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleList.map((line: any) => (
                  <tr key={line.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">#{line.drawNumber}</td>
                    <td className="px-4 py-3 font-mono">{fmt(Number(line.plannedAmount || 0))}</td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(line.plannedDate)}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[220px] truncate">{line.description || '—'}</td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="flat" isIconOnly onPress={() => openEditScheduleLine(line)}>
                            <FiEdit2 />
                          </Button>
                          <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => handleDeleteScheduleLine(line)}>
                            <FiTrash2 />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardBody>
      </Card>

      {/* Add / Edit Schedule Line Modal */}
      <Modal isOpen={isScheduleOpen} onClose={onScheduleClose} size="md">
        <ModalContent>
          <ModalHeader>{editingScheduleLine ? `Edit Schedule Line #${editingScheduleLine.drawNumber}` : 'Add Schedule Line'}</ModalHeader>
          <ModalBody className="space-y-3">
            <Input
              label="Draw #"
              type="number"
              value={scheduleForm.drawNumber}
              onChange={setSchedule('drawNumber')}
              isDisabled={!!editingScheduleLine}
              description={editingScheduleLine ? 'Draw number cannot be changed once created' : undefined}
            />
            <Input label="Planned Amount ($)" type="number" value={scheduleForm.plannedAmount} onChange={setSchedule('plannedAmount')} />
            <Input label="Planned Date" type="date" value={scheduleForm.plannedDate} onChange={setSchedule('plannedDate')} />
            <Textarea label="Description" value={scheduleForm.description} onChange={setSchedule('description')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onScheduleClose}>Cancel</Button>
            <Button
              color="primary"
              onPress={handleSaveScheduleLine}
              isLoading={upsertScheduleLine.isPending}
              isDisabled={!scheduleForm.drawNumber || !scheduleForm.plannedAmount || !scheduleForm.plannedDate}
            >
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Slice 8: rich detail modal — stepper + checklist + workflow buttons */}
      <DrawDetailModal
        drawId={detailDrawId}
        isOpen={!!detailDrawId}
        onClose={() => { setDetailDrawId(null); setDetailDrawDefaultTab(undefined); }}
        projectId={projectId}
        defaultTab={detailDrawDefaultTab}
      />

      {/* Add/Edit Loan Modal */}
      <Modal isOpen={isLoanOpen} onClose={onLoanClose} size="lg">
        <ModalContent>
          <ModalHeader>{editingLoanId ? 'Edit Loan' : 'Add Loan'}</ModalHeader>
          <ModalBody className="space-y-3">
            <div>
              {isCustomLoanType ? (
                <Input
                  label="Loan Type"
                  isRequired
                  placeholder="e.g. SBA 504"
                  value={loanForm.loanType}
                  onChange={setLoanField('loanType')}
                />
              ) : (
                <Select
                  label="Loan Type"
                  selectedKeys={loanForm.loanType ? [loanForm.loanType] : []}
                  onSelectionChange={(k) => setLoanForm((p) => ({ ...p, loanType: Array.from(k)[0] as string }))}
                >
                  {(loanTypes as any[]).map((opt: any) => (
                    <SelectItem key={opt.value} textValue={opt.label}>{opt.label}</SelectItem>
                  ))}
                </Select>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsCustomLoanType((v) => !v);
                  setLoanForm((p) => ({ ...p, loanType: '' }));
                }}
                className="mt-1 text-[11px] text-blue-600 hover:underline"
              >
                {isCustomLoanType ? 'Choose from list instead' : '+ Add custom loan type'}
              </button>
            </div>
            <Input label="Lender" value={loanForm.lender} onChange={setLoanField('lender')} isRequired />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Building (optional)"
                selectedKeys={loanForm.buildingId ? [loanForm.buildingId] : []}
                onSelectionChange={(k) => {
                  const buildingId = (Array.from(k)[0] as string) || '';
                  setLoanForm((p) => ({ ...p, buildingId, unitId: '' }));
                }}
                description="Leave blank for a project-level loan"
              >
                {(buildings as any[]).map((b: any) => (
                  <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
                ))}
              </Select>
              <Select
                label="Unit (optional)"
                selectedKeys={loanForm.unitId ? [loanForm.unitId] : []}
                onSelectionChange={(k) => setLoanForm((p) => ({ ...p, unitId: (Array.from(k)[0] as string) || '' }))}
                isDisabled={!loanForm.buildingId}
                description={!loanForm.buildingId ? 'Select a building first' : undefined}
              >
                {(units as any[]).filter((u: any) => (u.buildingId || u.building?.id) === loanForm.buildingId).map((u: any) => (
                  <SelectItem key={u.id} textValue={u.unitNumber}>{u.unitNumber}</SelectItem>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Principal Amount ($)" type="number" step="0.01" value={loanForm.principalAmt} onChange={setLoanField('principalAmt')} isRequired />
              <Input label="Interest Rate (%)" type="number" step="0.0001" value={loanForm.interestRate} onChange={setLoanField('interestRate')} isRequired />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Term (months)" type="number" value={loanForm.termMonths} onChange={setLoanField('termMonths')} isRequired />
              <Input label="Maturity Date" type="date" value={loanForm.maturityDate} onChange={setLoanField('maturityDate')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Current Balance ($)" type="number" step="0.01" value={loanForm.currentBalance} onChange={setLoanField('currentBalance')} />
              <Input label="Monthly Payment ($)" type="number" step="0.01" value={loanForm.monthlyPayment} onChange={setLoanField('monthlyPayment')} />
            </div>
            <Textarea label="Notes" value={loanForm.notes} onChange={setLoanField('notes')} minRows={2} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onLoanClose}>Cancel</Button>
            <Button
              color="primary"
              onPress={handleSaveLoan}
              isLoading={createLoan.isPending || updateLoan.isPending}
              isDisabled={!loanForm.lender || !loanForm.principalAmt || !loanForm.interestRate || !loanForm.termMonths}
            >
              {editingLoanId ? 'Save' : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Loan Confirm */}
      <Modal isOpen={isLoanDeleteOpen} onClose={onLoanDeleteClose} size="sm">
        <ModalContent>
          <ModalHeader>Delete Loan</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">
              Delete the loan from <span className="font-medium text-gray-800">{loanDeleteTarget?.lender}</span>
              {' '}({fmt(loanDeleteTarget?.principalAmt ?? 0)})? This can't be undone from here.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onLoanDeleteClose}>Cancel</Button>
            <Button color="danger" onPress={handleDeleteLoan} isLoading={deleteLoan.isPending}>Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
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
const EMPTY_VENDOR = { name: '', contactName: '', email: '', phone: '', trade: '' };

function VendorsTab({ projectId }: { projectId: string }) {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('vendor:edit');
  const { data: contracts = [], isLoading } = useContracts(projectId);
  const { data: summary } = useContractSummary(projectId);
  const { data: vendors = [] } = useVendors();
  const createContract = useCreateContract();
  const deleteContract = useDeleteContract();
  const addCO = useAddChangeOrder();
  const approveCO = useApproveChangeOrder();
  const addPayment = useAddContractPayment();
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const { isOpen: isContractOpen, onOpen: onContractOpen, onClose: onContractClose } = useDisclosure();
  const { isOpen: isCOOpen, onOpen: onCOOpen, onClose: onCOClose } = useDisclosure();
  const { isOpen: isPmtOpen, onOpen: onPmtOpen, onClose: onPmtClose } = useDisclosure();
  const { isOpen: isVendorOpen, onOpen: onVendorOpen, onClose: onVendorClose } = useDisclosure();
  const [form, setForm] = useState<Record<string, string>>(EMPTY_CONTRACT);
  const [coForm, setCOForm] = useState<Record<string, string>>(EMPTY_CO);
  const [pmtForm, setPmtForm] = useState<Record<string, string>>(EMPTY_PAYMENT);
  const [vendorForm, setVendorForm] = useState<Record<string, string>>(EMPTY_VENDOR);
  const [editVendorId, setEditVendorId] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const set = (f: string) => (e: any) => setForm((p) => ({ ...p, [f]: e.target.value }));
  const setCO = (f: string) => (e: any) => setCOForm((p) => ({ ...p, [f]: e.target.value }));
  const setPmt = (f: string) => (e: any) => setPmtForm((p) => ({ ...p, [f]: e.target.value }));
  const setVendor = (f: string) => (e: any) => setVendorForm((p) => ({ ...p, [f]: e.target.value }));

  const openCreateVendor = () => {
    setEditVendorId(null);
    setVendorForm(EMPTY_VENDOR);
    onVendorOpen();
  };

  const openEditVendor = (v: any) => {
    setEditVendorId(v.id);
    setVendorForm({
      name: v.name || '',
      contactName: v.contactName || '',
      email: v.email || '',
      phone: v.phone || '',
      trade: v.trade || '',
    });
    onVendorOpen();
  };

  const handleSaveVendor = async () => {
    try {
      const payload = {
        name: vendorForm.name.trim(),
        contactName: vendorForm.contactName.trim() || undefined,
        email: vendorForm.email.trim() || undefined,
        phone: vendorForm.phone.trim() || undefined,
        trade: vendorForm.trade.trim() || undefined,
      };
      if (editVendorId) {
        await updateVendor.mutateAsync({ id: editVendorId, ...payload });
        addToast({ title: 'Vendor updated', color: 'success' });
      } else {
        await createVendor.mutateAsync(payload);
        addToast({ title: 'Vendor created', color: 'success' });
      }
      setVendorForm(EMPTY_VENDOR);
      onVendorClose();
    } catch (e) { addToast({ title: errMsg(e, 'Failed to save vendor'), color: 'danger' }); }
  };

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
          <span className="font-semibold text-sm">Vendors</span>
          {canEdit && <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreateVendor}>Add Vendor</Button>}
        </CardHeader>
        <CardBody className="p-0">
          {(vendors as any[]).length === 0 ? (
            <div className="p-6"><EmptyState message="No vendors yet" /></div>
          ) : (
            <div className="divide-y">
              {(vendors as any[]).map((v: any) => (
                <div key={v.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{v.name}</span>
                      {v.trade && <span className="text-xs text-gray-400">{v.trade}</span>}
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
                      {v.contactName && <span>{v.contactName}</span>}
                      {v.email && <span>{v.email}</span>}
                      {v.phone && <span>{v.phone}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="light" isIconOnly onPress={() => openEditVendor(v)}>
                      <FiEdit2 />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

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
              {(vendors as any[]).map((v: any) => <SelectItem key={v.id} textValue={v.name}>{v.name}{v.trade ? ` (${v.trade})` : ''}</SelectItem>)}
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

      {/* Add/Edit Vendor Modal */}
      <Modal isOpen={isVendorOpen} onClose={onVendorClose} size="md">
        <ModalContent>
          <ModalHeader>{editVendorId ? 'Edit Vendor' : 'New Vendor'}</ModalHeader>
          <ModalBody className="space-y-3">
            <Input label="Name" isRequired value={vendorForm.name} onChange={setVendor('name')} />
            <Input label="Contact Name" value={vendorForm.contactName} onChange={setVendor('contactName')} />
            <Input label="Email" type="email" value={vendorForm.email} onChange={setVendor('email')} />
            <Input label="Phone" value={vendorForm.phone} onChange={setVendor('phone')} />
            <Input label="Trade" value={vendorForm.trade} onChange={setVendor('trade')} />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onVendorClose}>Cancel</Button>
            <Button
              color="primary"
              isDisabled={!vendorForm.name.trim()}
              isLoading={createVendor.isPending || updateVendor.isPending}
              onPress={handleSaveVendor}
            >
              {editVendorId ? 'Save' : 'Create'}
            </Button>
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
  const renameDoc = useRenameDocument();
  const replaceDoc = useReplaceDocument();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [filterCat, setFilterCat] = useState('ALL');
  const [uploadCategory, setUploadCategory] = useState('GENERAL');
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  // edit state
  const editFileRef = React.useRef<HTMLInputElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

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

  const openEdit = (doc: any) => { setEditId(doc.id); setEditName(doc.fileName || ''); setEditFile(null); setEditErr(null); };
  const cancelEdit = () => { setEditId(null); setEditFile(null); setEditErr(null); };

  const handleSaveEdit = async () => {
    if (!editName.trim()) { setEditErr('Name is required'); return; }
    setEditErr(null);
    try {
      if (editFile) {
        await replaceDoc.mutateAsync({ id: editId!, file: editFile, fileName: editName.trim() });
        addToast({ title: 'Document replaced', color: 'success' });
      } else {
        await renameDoc.mutateAsync({ id: editId!, fileName: editName.trim() });
        addToast({ title: 'Document renamed', color: 'success' });
      }
      cancelEdit();
    } catch (e) { setEditErr(errMsg(e, 'Failed to save')); }
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4 pt-4">
      {/* hidden file input for replace */}
      <input ref={editFileRef} type="file" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]; if (f) setEditFile(f); e.target.value = '';
      }} />

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
                {editId === doc.id ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Edit</span>
                      <div className="flex gap-1">
                        <Button size="sm" isIconOnly variant="light" onPress={cancelEdit} aria-label="Cancel"><FiX className="w-3 h-3 text-gray-400" /></Button>
                        <Button size="sm" isIconOnly color="primary" onPress={handleSaveEdit} isLoading={renameDoc.isPending || replaceDoc.isPending} aria-label="Save"><FiCheck className="w-3 h-3" /></Button>
                      </div>
                    </div>
                    {editErr && <p className="text-xs text-red-500">{editErr}</p>}
                    <Input size="sm" label="File name" value={editName} onChange={(e) => { setEditName(e.target.value); setEditErr(null); }} isInvalid={!!editErr} />
                    <Button size="sm" variant="flat" className="w-full" onPress={() => editFileRef.current?.click()} startContent={<FiUpload className="w-3.5 h-3.5" />}>
                      {editFile ? editFile.name : 'Replace file…'}
                    </Button>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="light" className="flex-1" onPress={cancelEdit}>Cancel</Button>
                      <Button size="sm" color="primary" className="flex-1" onPress={handleSaveEdit} isLoading={renameDoc.isPending || replaceDoc.isPending}>
                        {editFile ? 'Replace' : 'Save'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
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
                      <Button size="sm" variant="light" isIconOnly onPress={() => openEdit(doc)} aria-label="Edit">
                        <FiEdit2 className="w-3.5 h-3.5 text-gray-400" />
                      </Button>
                      <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => handleDelete(doc.id)}>
                        <FiTrash2 />
                      </Button>
                    </div>
                  </>
                )}
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

// ──────────────────────────────────────────────────────────────────────────────
// Project Activity Log Tab  (SUPER_ADMIN / FOUNDER only)
// ──────────────────────────────────────────────────────────────────────────────

type EntityCfg = {
  label: string;
  icon: React.ElementType;
  borderColor: string;
  chipStyle: string;
  filterActive: string;
};

const ENTITY_CFG: Record<string, EntityCfg> = {
  document:  { label: 'Document',  icon: FiFile,         borderColor: 'border-l-blue-400',    chipStyle: 'bg-blue-50 text-blue-700 border border-blue-200',       filterActive: 'bg-blue-500 text-white' },
  milestone: { label: 'Milestone', icon: FiFlag,         borderColor: 'border-l-amber-400',   chipStyle: 'bg-amber-50 text-amber-700 border border-amber-200',    filterActive: 'bg-amber-500 text-white' },
  lead:      { label: 'Lead',      icon: FiTarget,       borderColor: 'border-l-purple-400',  chipStyle: 'bg-purple-50 text-purple-700 border border-purple-200', filterActive: 'bg-purple-500 text-white' },
  sale:      { label: 'Sale',      icon: FiDollarSign,   borderColor: 'border-l-emerald-400', chipStyle: 'bg-emerald-50 text-emerald-700 border border-emerald-200', filterActive: 'bg-emerald-500 text-white' },
  lease:     { label: 'Lease',     icon: FiKey,          borderColor: 'border-l-teal-400',    chipStyle: 'bg-teal-50 text-teal-700 border border-teal-200',       filterActive: 'bg-teal-500 text-white' },
  task:      { label: 'Task',      icon: FiCheckSquare,  borderColor: 'border-l-orange-400',  chipStyle: 'bg-orange-50 text-orange-700 border border-orange-200', filterActive: 'bg-orange-500 text-white' },
  comment:   { label: 'Comment',   icon: FiMessageSquare,borderColor: 'border-l-slate-300',   chipStyle: 'bg-slate-100 text-slate-600 border border-slate-200',   filterActive: 'bg-slate-700 text-white' },
  building:  { label: 'Building',  icon: FiHome,         borderColor: 'border-l-indigo-400',  chipStyle: 'bg-indigo-50 text-indigo-700 border border-indigo-200', filterActive: 'bg-indigo-500 text-white' },
  unit:      { label: 'Unit',      icon: FiLayers,       borderColor: 'border-l-cyan-400',    chipStyle: 'bg-cyan-50 text-cyan-700 border border-cyan-200',       filterActive: 'bg-cyan-500 text-white' },
  budget:    { label: 'Budget',    icon: FiBarChart2,    borderColor: 'border-l-rose-400',    chipStyle: 'bg-rose-50 text-rose-700 border border-rose-200',       filterActive: 'bg-rose-500 text-white' },
  member:    { label: 'Team',      icon: FiUsers,        borderColor: 'border-l-violet-400',  chipStyle: 'bg-violet-50 text-violet-700 border border-violet-200', filterActive: 'bg-violet-500 text-white' },
};

const ACTION_CFG: Record<string, { label: string; style: string }> = {
  UPLOADED:  { label: 'Uploaded',  style: 'bg-blue-500 text-white' },
  CREATED:   { label: 'Created',   style: 'bg-slate-700 text-white' },
  ADDED:     { label: 'Added',     style: 'bg-slate-700 text-white' },
  COMPLETED: { label: 'Completed', style: 'bg-emerald-500 text-white' },
  CONVERTED: { label: 'Converted', style: 'bg-emerald-600 text-white' },
  LOST:      { label: 'Lost',      style: 'bg-red-500 text-white' },
  CLOSED:    { label: 'Closed',    style: 'bg-emerald-600 text-white' },
  JOINED:    { label: 'Joined',    style: 'bg-violet-500 text-white' },
};

const STATUS_CHIP_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  AVAILABLE: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  CLOSED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  DONE: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  LEASED: 'bg-teal-50 text-teal-700 border border-teal-200',
  SOLD: 'bg-purple-50 text-purple-700 border border-purple-200',
  OCCUPIED: 'bg-sky-50 text-sky-700 border border-sky-200',
  OWNER_OCCUPIED: 'bg-sky-50 text-sky-700 border border-sky-200',
  UNDER_CONTRACT: 'bg-amber-50 text-amber-700 border border-amber-200',
  LOI_SIGNED: 'bg-amber-50 text-amber-700 border border-amber-200',
  LEASE_PENDING: 'bg-amber-50 text-amber-700 border border-amber-200',
  NEGOTIATING: 'bg-amber-50 text-amber-700 border border-amber-200',
  IN_PROGRESS: 'bg-sky-50 text-sky-700 border border-sky-200',
  UNDER_CONSTRUCTION: 'bg-orange-50 text-orange-600 border border-orange-200',
  DRAFT: 'bg-slate-50 text-slate-500 border border-slate-200',
  PROSPECT: 'bg-slate-50 text-slate-600 border border-slate-200',
  NEW: 'bg-slate-50 text-slate-600 border border-slate-200',
  TODO: 'bg-slate-50 text-slate-500 border border-slate-200',
  NOT_STARTED: 'bg-slate-50 text-slate-500 border border-slate-200',
  CONTACTED: 'bg-blue-50 text-blue-600 border border-blue-200',
  QUALIFIED: 'bg-indigo-50 text-indigo-600 border border-indigo-200',
  PROPOSAL_SENT: 'bg-violet-50 text-violet-600 border border-violet-200',
  LOST: 'bg-red-50 text-red-600 border border-red-200',
  DEAD: 'bg-red-50 text-red-400 border border-red-100',
  CANCELLED: 'bg-red-50 text-red-500 border border-red-200',
  TERMINATED: 'bg-red-50 text-red-600 border border-red-200',
  EXPIRED: 'bg-orange-50 text-orange-600 border border-orange-200',
  OVERDUE: 'bg-red-50 text-red-600 border border-red-200',
  BLOCKED: 'bg-rose-50 text-rose-600 border border-rose-200',
  URGENT: 'bg-red-100 text-red-700 border border-red-200',
  HIGH: 'bg-orange-100 text-orange-700 border border-orange-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border border-amber-200',
  LOW: 'bg-slate-100 text-slate-600 border border-slate-200',
};

// Status legend: shown as a bar when a type filter is active
const STATUS_LEGENDS: Record<string, { label: string; style: string }[]> = {
  lead: [
    { label: 'New',           style: 'bg-slate-100 text-slate-600' },
    { label: 'Contacted',     style: 'bg-blue-100 text-blue-600' },
    { label: 'Qualified',     style: 'bg-indigo-100 text-indigo-600' },
    { label: 'Proposal Sent', style: 'bg-violet-100 text-violet-600' },
    { label: 'Negotiating',   style: 'bg-amber-100 text-amber-700' },
    { label: 'Converted',     style: 'bg-emerald-100 text-emerald-700' },
    { label: 'Lost',          style: 'bg-red-100 text-red-600' },
    { label: 'Dead',          style: 'bg-red-50 text-red-400' },
  ],
  sale: [
    { label: 'Prospect',       style: 'bg-slate-100 text-slate-600' },
    { label: 'LOI Signed',     style: 'bg-blue-100 text-blue-600' },
    { label: 'Under Contract', style: 'bg-amber-100 text-amber-700' },
    { label: 'Closed',         style: 'bg-emerald-100 text-emerald-700' },
    { label: 'Cancelled',      style: 'bg-red-100 text-red-500' },
  ],
  lease: [
    { label: 'Draft',          style: 'bg-slate-100 text-slate-500' },
    { label: 'Active',         style: 'bg-emerald-100 text-emerald-700' },
    { label: 'Expired',        style: 'bg-orange-100 text-orange-600' },
    { label: 'Terminated',     style: 'bg-red-100 text-red-600' },
    { label: 'Owner Occupied', style: 'bg-sky-100 text-sky-600' },
  ],
  task: [
    { label: 'Todo',        style: 'bg-slate-100 text-slate-500' },
    { label: 'In Progress', style: 'bg-sky-100 text-sky-600' },
    { label: 'Done',        style: 'bg-emerald-100 text-emerald-700' },
    { label: 'Cancelled',   style: 'bg-slate-100 text-slate-400' },
  ],
  milestone: [
    { label: 'Not Started', style: 'bg-slate-100 text-slate-500' },
    { label: 'In Progress', style: 'bg-sky-100 text-sky-600' },
    { label: 'Completed',   style: 'bg-emerald-100 text-emerald-700' },
    { label: 'Overdue',     style: 'bg-red-100 text-red-600' },
    { label: 'Blocked',     style: 'bg-rose-100 text-rose-600' },
  ],
  unit: [
    { label: 'Available',          style: 'bg-emerald-100 text-emerald-700' },
    { label: 'Under Contract',     style: 'bg-amber-100 text-amber-700' },
    { label: 'Lease Pending',      style: 'bg-amber-100 text-amber-700' },
    { label: 'Leased',             style: 'bg-teal-100 text-teal-700' },
    { label: 'Sold',               style: 'bg-purple-100 text-purple-700' },
    { label: 'Occupied',           style: 'bg-sky-100 text-sky-600' },
    { label: 'Under Construction', style: 'bg-orange-100 text-orange-600' },
  ],
};

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAbsoluteTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const ALL_ACTIVITY_TYPES = Object.keys(ENTITY_CFG);

function ProjectActivityTab({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const { data, isLoading, error } = useProjectActivity(projectId, page);

  const events: any[] = data?.events ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 60);

  const typeCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const ev of events) c[ev.type] = (c[ev.type] ?? 0) + 1;
    return c;
  }, [events]);

  const filtered = typeFilter ? events.filter((e: any) => e.type === typeFilter) : events;

  const grouped: { dateLabel: string; items: any[] }[] = React.useMemo(() => {
    const map = new Map<string, any[]>();
    for (const ev of filtered) {
      const d = new Date(ev.timestamp);
      const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return Array.from(map.entries()).map(([dateLabel, items]) => ({ dateLabel, items }));
  }, [filtered]);

  const legend = typeFilter ? (STATUS_LEGENDS[typeFilter] ?? null) : null;

  return (
    <div className="space-y-0">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <p className="text-base font-bold text-slate-900 tracking-tight">Project Activity Log</p>
            {!isLoading && total > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 text-white tabular-nums">
                {total}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Every action across leads, docs, milestones, tasks &amp; more
          </p>
        </div>

        {/* ── Filter chips ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setTypeFilter('')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${
              !typeFilter ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            All
            {!typeFilter && total > 0 && (
              <span className="ml-0.5 text-[10px] font-bold opacity-60">{total}</span>
            )}
          </button>
          {ALL_ACTIVITY_TYPES.map((t) => {
            const cfg = ENTITY_CFG[t];
            const count = typeCounts[t] ?? 0;
            const Icon = cfg.icon;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-150 ${
                  typeFilter === t ? cfg.filterActive + ' shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <Icon size={10} />
                {cfg.label}
                {count > 0 && (
                  <span className={`ml-0.5 text-[10px] font-bold ${typeFilter === t ? 'opacity-60' : 'opacity-50'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Status legend bar — answers "mention all statuses on bar" ── */}
      {legend && (
        <div className="flex items-center gap-2 flex-wrap mb-4 px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-100">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
            Status key
          </span>
          <span className="w-px h-3 bg-slate-200 shrink-0" />
          {legend.map((s, i) => (
            <React.Fragment key={s.label}>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.style}`}>
                {s.label}
              </span>
              {i < legend.length - 1 && (
                <span className="text-slate-300 text-[10px]">→</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="border-l-4 border-l-slate-200 bg-white rounded-r-lg border border-slate-100 px-3 py-3 animate-pulse">
              <div className="flex justify-between mb-2">
                <div className="flex gap-2">
                  <div className="h-5 w-16 bg-slate-100 rounded-full" />
                  <div className="h-5 w-12 bg-slate-100 rounded-full" />
                  <div className="h-5 w-24 bg-slate-100 rounded" />
                </div>
                <div className="h-4 w-14 bg-slate-100 rounded" />
              </div>
              <div className="h-3.5 bg-slate-100 rounded w-2/3 mb-2.5 ml-5" />
              <div className="flex gap-2 ml-5">
                <div className="h-4 w-16 bg-slate-100 rounded-full" />
                <div className="h-4 w-14 bg-slate-100 rounded-full" />
                <div className="h-4 w-20 bg-slate-100 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {!isLoading && error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          Failed to load activity log. Please try again.
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center py-14">
          <FiActivity size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-400">No activity recorded yet</p>
          <p className="text-xs text-slate-300 mt-1">Events will appear here as the project progresses</p>
        </div>
      )}

      {/* ── Timeline ── */}
      {!isLoading && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map(({ dateLabel, items }) => (
            <div key={dateLabel}>
              {/* Day header */}
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                  {dateLabel}
                </span>
                <div className="h-px flex-1 bg-slate-100" />
                <span className="text-[10px] font-semibold text-slate-300 whitespace-nowrap tabular-nums">
                  {items.length} {items.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              {/* Event cards */}
              <div className="space-y-2">
                {items.map((ev: any) => {
                  const cfg = ENTITY_CFG[ev.type] ?? ENTITY_CFG['document'];
                  const actionCfg = ACTION_CFG[ev.action] ?? { label: ev.action, style: 'bg-slate-600 text-white' };
                  const Icon = cfg.icon;

                  // Status chip: prefer meta.status, fall back to meta.priority
                  const statusValue: string | null = ev.meta?.status ?? ev.meta?.priority ?? null;
                  const statusStyle = statusValue
                    ? (STATUS_CHIP_STYLE[statusValue] ?? 'bg-slate-100 text-slate-600 border border-slate-200')
                    : null;
                  const statusLabel = statusValue
                    ? String(statusValue).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
                    : null;

                  // Secondary meta (category, source, role, type, amount)
                  const metaItems: string[] = [];
                  if (ev.meta?.category) metaItems.push(String(ev.meta.category).replace(/_/g, ' ').toLowerCase());
                  if (ev.meta?.source) metaItems.push('via ' + String(ev.meta.source).replace(/_/g, ' ').toLowerCase());
                  if (ev.meta?.commentType) metaItems.push(String(ev.meta.commentType).toLowerCase() + ' comment');
                  if (ev.meta?.buildingType) metaItems.push(String(ev.meta.buildingType).replace(/_/g, ' ').toLowerCase());
                  if (ev.meta?.unitType) metaItems.push(String(ev.meta.unitType).replace(/_/g, ' ').toLowerCase());
                  if (ev.meta?.role) metaItems.push(String(ev.meta.role).replace(/_/g, ' ').toLowerCase());
                  if (ev.meta?.amount != null) metaItems.push('$' + Number(ev.meta.amount).toLocaleString());

                  return (
                    <div
                      key={ev.id}
                      className={`border-l-4 ${cfg.borderColor} bg-white rounded-r-lg border border-l-0 border-slate-100 px-3 py-2.5 hover:border-slate-200 hover:shadow-sm transition-all duration-150`}
                    >
                      {/* Row 1: icon + entity name + timestamp */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Icon size={13} className="text-slate-400 shrink-0 mt-px" />
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {ev.entityName}
                          </span>
                        </div>
                        <span
                          className="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0 tabular-nums"
                          title={formatAbsoluteTime(ev.timestamp)}
                        >
                          {formatRelativeTime(ev.timestamp)}
                        </span>
                      </div>

                      {/* Row 2: description label */}
                      <p className="text-xs text-slate-500 mt-0.5 mb-2 line-clamp-1 pl-[19px]">
                        {ev.label}
                      </p>

                      {/* Row 3: type + action + status + meta + actor */}
                      <div className="flex items-center gap-1.5 flex-wrap pl-[19px]">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cfg.chipStyle}`}>
                          {cfg.label}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${actionCfg.style}`}>
                          {actionCfg.label}
                        </span>
                        {statusLabel && statusStyle && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusStyle}`}>
                            {statusLabel}
                          </span>
                        )}
                        {metaItems.map((m, idx) => (
                          <span key={idx} className="text-[10px] text-slate-400 font-medium">
                            {m}
                          </span>
                        ))}
                        {ev.actorName && (
                          <>
                            <span className="flex-1" />
                            <span className="text-[11px] text-slate-400 whitespace-nowrap">
                              by <span className="font-semibold text-slate-600">{ev.actorName}</span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && !isLoading && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-4">
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {page} / {totalPages} · {total} events
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="flat" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
              ← Prev
            </Button>
            <Button size="sm" variant="flat" isDisabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

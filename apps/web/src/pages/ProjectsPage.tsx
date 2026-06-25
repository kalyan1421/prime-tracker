import {
  Card, CardBody, Button, Input, Select, SelectItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Textarea, useDisclosure, addToast, Chip, Progress, Tooltip, Skeleton,
} from '@heroui/react';
import {
  FiMapPin, FiPlus, FiEdit2, FiTrash2, FiSearch,
  FiGrid, FiList, FiArrowUp, FiArrowDown, FiInbox,
} from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useState, useMemo, useCallback } from 'react';
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject, useProjectHealthBulk } from '../hooks/useApi';
import { HealthScoreRing } from '../components/HealthScoreRing';
import { fmt } from '../utils/fmt';
import { StatusBadge, PhaseProgress, ErrorState } from '../components/ui';
import { useAuthStore } from '../store/authStore';

const PHASES = ['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'];
const PROJECT_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL'];
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const TYPE_COLOR: Record<string, 'primary' | 'success' | 'secondary' | 'warning'> = {
  RESIDENTIAL: 'primary', COMMERCIAL: 'success', MIXED_USE: 'secondary', INDUSTRIAL: 'warning',
};

const EMPTY_PROJECT = {
  name: '', slug: '', location: '', address: '',
  acreage: '', phase: 'PRE_DEVELOPMENT', status: 'ACTIVE',
  description: '', projectType: '', startDate: '', targetEnd: '',
};

// Friendly error extractor — pulls the first NestJS validation message or the API message.
function extractErr(err: any, fallback: string): string {
  const msg = err?.response?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? fallback;
  if (typeof msg === 'string') return msg;
  return err?.message ?? fallback;
}

function BudgetHealthBar({ budget, actuals }: { budget: number; actuals: number }) {
  if (!budget) return <p className="text-xs text-gray-400">No budget set</p>;
  const pct = Math.min((actuals / budget) * 100, 100);
  const color = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success';
  return (
    <div className="mt-2">
      <div className="flex justify-between mb-0.5">
        <span className="text-[10px] text-gray-500">Spent</span>
        <span className="text-[10px] font-medium text-gray-600">
          {fmt(actuals)} / {fmt(budget)}
          <span className="ml-1 text-gray-400">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <Progress size="sm" value={pct} color={color} aria-label="Budget health" />
    </div>
  );
}

function ProjectCard({ p, onEdit, onDelete, canEdit, canDelete, health }: {
  p: any; onEdit: (p: any) => void; onDelete: (id: string) => void;
  canEdit: boolean; canDelete: boolean;
  health?: { score: number; breakdown: Record<string, { score: number; reason: string }> };
}) {
  const navigate = useNavigate();
  const showActions = canEdit || canDelete;
  const breakdown = health?.breakdown
    ? Object.entries(health.breakdown).map(([k, v]) => ({
        label: k.charAt(0).toUpperCase() + k.slice(1),
        value: `${v.score} · ${v.reason}`,
      }))
    : undefined;
  return (
    <Card shadow="sm" className="cursor-pointer hover:shadow-md transition-shadow duration-150">
      <CardBody onClick={() => navigate(`/projects/${p.id}`)}>
        <div className="flex justify-between items-start mb-2 gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {/* Slice 2: Health score ring — at-a-glance triage. */}
            {health && (
              <div onClick={(e) => e.stopPropagation()} className="shrink-0 mt-0.5">
                <HealthScoreRing score={health.score} size="sm" breakdown={breakdown} />
              </div>
            )}
            <div className="flex-1 min-w-0 pr-2">
              <p className="font-semibold text-sm text-gray-900 truncate">{p.name}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <FiMapPin className="text-gray-400 text-[11px] shrink-0" />
                <span className="text-[11px] text-gray-500 truncate">{p.location}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <StatusBadge status={p.status} />
            {canEdit && (
              <Button size="sm" variant="light" isIconOnly onPress={() => onEdit(p)} aria-label="Edit project">
                <FiEdit2 className="text-gray-400 text-xs" />
              </Button>
            )}
            {canDelete && p.status !== 'CANCELLED' && (
              <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => onDelete(p.id)} aria-label="Archive project">
                <FiTrash2 className="text-xs" />
              </Button>
            )}
          </div>
        </div>

        {p.projectType && (
          <Chip size="sm" variant="flat" color={TYPE_COLOR[p.projectType] || 'default'} className="mb-2 text-[10px]">
            {p.projectType.replace(/_/g, ' ')}
          </Chip>
        )}

        <div className="mb-2">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Phase</span>
            <span className="text-[10px] font-medium text-gray-600">{(p.phase || '').replace(/_/g, ' ')}</span>
          </div>
          <PhaseProgress current={p.phase || 'PRE_DEVELOPMENT'} />
        </div>

        <BudgetHealthBar budget={p.budgetTotal ?? 0} actuals={p.actualsTotal ?? 0} />

        <div className="grid grid-cols-2 gap-x-4 mt-3 pt-2 border-t border-gray-50">
          <div>
            <p className="text-[10px] text-gray-400">Buildings</p>
            <p className="text-xs font-semibold text-gray-700">{p._count?.buildings ?? 0}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">Units</p>
            <p className="text-xs font-semibold text-gray-700">{p.unitCount ?? 0}</p>
          </div>
        </div>
        {!showActions && null}
      </CardBody>
    </Card>
  );
}

function ProjectRow({ p, onEdit, onDelete, canEdit, canDelete }: {
  p: any; onEdit: (p: any) => void; onDelete: (id: string) => void;
  canEdit: boolean; canDelete: boolean;
}) {
  const navigate = useNavigate();
  const pct = p.budgetTotal ? Math.min(((p.actualsTotal ?? 0) / p.budgetTotal) * 100, 100) : 0;
  const pctColor = pct >= 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-green-600';
  return (
    <tr
      className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer text-sm"
      onClick={() => navigate(`/projects/${p.id}`)}
    >
      <td className="py-3 px-4">
        <p className="font-medium text-gray-900">{p.name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <FiMapPin className="text-gray-400 text-[10px]" />
          <span className="text-[11px] text-gray-500">{p.location}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        {p.projectType ? (
          <Chip size="sm" variant="flat" color={TYPE_COLOR[p.projectType] || 'default'} className="text-[10px]">
            {p.projectType.replace(/_/g, ' ')}
          </Chip>
        ) : <span className="text-gray-300">—</span>}
      </td>
      <td className="py-3 px-4">
        <div className="w-32">
          <p className="text-[10px] text-gray-500 mb-0.5">{(p.phase || '').replace(/_/g, ' ')}</p>
          <PhaseProgress current={p.phase || 'PRE_DEVELOPMENT'} />
        </div>
      </td>
      <td className="py-3 px-4 text-right tabular-nums">
        <p className="text-gray-800">{fmt(p.budgetTotal ?? 0)}</p>
        {p.budgetTotal > 0 && (
          <p className={`text-[11px] font-medium ${pctColor}`}>{pct.toFixed(0)}% spent</p>
        )}
      </td>
      <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
      <td className="py-3 px-4 text-center text-gray-600">{p._count?.buildings ?? 0} / {p.unitCount ?? 0}</td>
      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1 justify-end">
          {canEdit && (
            <Button size="sm" variant="light" isIconOnly onPress={() => onEdit(p)} aria-label="Edit">
              <FiEdit2 className="text-xs text-gray-400" />
            </Button>
          )}
          {canDelete && p.status !== 'CANCELLED' && (
            <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => onDelete(p.id)} aria-label="Archive">
              <FiTrash2 className="text-xs" />
            </Button>
          )}
          {!canEdit && !canDelete && <span className="text-gray-300 text-xs">—</span>}
        </div>
      </td>
    </tr>
  );
}

// Skeleton card matching the real ProjectCard layout
function ProjectCardSkeleton() {
  return (
    <Card shadow="sm">
      <CardBody className="space-y-3">
        <div className="flex justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-2 w-full rounded" />
        <Skeleton className="h-2 w-full rounded" />
        <div className="grid grid-cols-2 gap-4 pt-2">
          <Skeleton className="h-6 rounded" />
          <Skeleton className="h-6 rounded" />
        </div>
      </CardBody>
    </Card>
  );
}

export default function ProjectsPage() {
  const { hasPermission } = useAuthStore();
  const canCreate = hasPermission('project:create');
  const canEdit = hasPermission('project:edit');
  const canDelete = hasPermission('project:delete');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showArchived, setShowArchived] = useState(false);

  // Debounce search
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    clearTimeout((handleSearch as any)._t);
    (handleSearch as any)._t = setTimeout(() => setDebouncedSearch(val), 300);
  }, []);

  const queryParams = useMemo(() => {
    const p: Record<string, string | boolean> = {};
    if (statusFilter) p.status = statusFilter;
    if (phaseFilter) p.phase = phaseFilter;
    if (typeFilter) p.projectType = typeFilter;
    if (debouncedSearch) p.search = debouncedSearch;
    if (showArchived) p.archived = true;  // Slice 2: include soft-deleted
    if (sortBy) {
      const [by, order] = sortBy.split(':');
      p.sortBy = by;
      p.sortOrder = order || 'asc';
    }
    return Object.keys(p).length ? (p as any) : undefined;
  }, [statusFilter, phaseFilter, typeFilter, debouncedSearch, sortBy, showArchived]);

  const { data, isLoading, error } = useProjects(queryParams);
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();

  const [form, setForm] = useState<Record<string, string>>(EMPTY_PROJECT);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (formErrors[field]) setFormErrors((errs) => ({ ...errs, [field]: '' }));
  };

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_PROJECT);
    setFormErrors({});
    onFormOpen();
  };

  const openEdit = (p: any) => {
    setEditId(p.id);
    setForm({
      name: p.name || '', slug: p.slug || '', location: p.location || '',
      address: p.address || '', acreage: p.acreage?.toString() || '',
      phase: p.phase || 'PRE_DEVELOPMENT', status: p.status || 'ACTIVE',
      description: p.description || '', projectType: p.projectType || '',
      startDate: p.startDate ? p.startDate.slice(0, 10) : '',
      targetEnd: p.targetEnd ? p.targetEnd.slice(0, 10) : '',
    });
    setFormErrors({});
    onFormOpen();
  };

  const openDelete = (id: string) => { setDeleteId(id); onDeleteOpen(); };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Project name is required';
    else if (form.name.trim().length < 2) errs.name = 'At least 2 characters';
    else if (form.name.length > 120) errs.name = 'Max 120 characters';

    if (!form.slug.trim()) errs.slug = 'Slug is required';
    else if (!SLUG_REGEX.test(form.slug)) errs.slug = 'Lowercase letters/numbers/dashes only';
    else if (form.slug.length > 80) errs.slug = 'Max 80 characters';

    if (!form.location.trim()) errs.location = 'Location is required';

    if (form.acreage && isNaN(parseFloat(form.acreage))) errs.acreage = 'Must be a number';
    else if (form.acreage && parseFloat(form.acreage) <= 0) errs.acreage = 'Must be positive';

    if (form.startDate && form.targetEnd && new Date(form.startDate) > new Date(form.targetEnd)) {
      errs.targetEnd = 'Target end must be after start date';
    }

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        location: form.location.trim(),
        address: form.address.trim() || undefined,
        description: form.description.trim() || undefined,
        acreage: form.acreage ? parseFloat(form.acreage) : undefined,
        phase: form.phase,
        status: form.status,
        projectType: form.projectType || undefined,
        startDate: form.startDate || undefined,
        targetEnd: form.targetEnd || undefined,
      };
      if (editId) {
        await updateProject.mutateAsync({ id: editId, data: payload });
        addToast({ title: 'Project updated', color: 'success' });
      } else {
        await createProject.mutateAsync(payload);
        addToast({ title: 'Project created', color: 'success' });
      }
      onFormClose();
    } catch (err: any) {
      addToast({ title: extractErr(err, 'Failed to save project'), color: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteProject.mutateAsync(deleteId);
      addToast({ title: 'Project archived', color: 'success' });
      onDeleteClose();
    } catch (err: any) {
      addToast({ title: extractErr(err, 'Failed to archive project'), color: 'danger' });
    }
  };

  const projects = (data as any[]) || [];
  // Slice 2 — fetch health scores for all visible projects in one request.
  // Bulk hook is keyed on the sorted ID list, so it stays cached as long as the
  // set of projects doesn't change.
  const { data: healthMap = {} } = useProjectHealthBulk(projects.map((p) => p.id));
  const hasFilters = !!(statusFilter || phaseFilter || typeFilter || debouncedSearch);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Projects</h1>
          {!isLoading && (
            <p className="text-xs text-gray-500 mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        {canCreate && (
          <Button size="sm" color="primary" startContent={<FiPlus />} onPress={openCreate}>
            New Project
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white rounded-xl border border-gray-200 shadow-sm">
        <Input
          aria-label="Search projects"
          size="sm"
          className="w-full sm:w-52"
          placeholder="Search projects…"
          value={search}
          onValueChange={handleSearch}
          startContent={<FiSearch className="text-gray-400 text-sm shrink-0" />}
          isClearable
          onClear={() => { setSearch(''); setDebouncedSearch(''); }}
        />
        <Select
          aria-label="Filter by status"
          size="sm"
          className="w-full sm:w-36"
          placeholder="All statuses"
          selectedKeys={statusFilter ? [statusFilter] : []}
          onSelectionChange={(keys) => setStatusFilter((Array.from(keys)[0] as string) || '')}
        >
          <SelectItem key="ACTIVE">Active</SelectItem>
          <SelectItem key="ON_HOLD">On Hold</SelectItem>
          <SelectItem key="COMPLETED">Completed</SelectItem>
          <SelectItem key="CANCELLED">Archived</SelectItem>
        </Select>
        <Select
          aria-label="Filter by phase"
          size="sm"
          className="w-full sm:w-44"
          placeholder="All phases"
          selectedKeys={phaseFilter ? [phaseFilter] : []}
          onSelectionChange={(keys) => setPhaseFilter((Array.from(keys)[0] as string) || '')}
        >
          {PHASES.map((ph) => (
            <SelectItem key={ph}>{ph.replace(/_/g, ' ')}</SelectItem>
          ))}
        </Select>
        <Select
          aria-label="Filter by type"
          size="sm"
          className="w-full sm:w-40"
          placeholder="All types"
          selectedKeys={typeFilter ? [typeFilter] : []}
          onSelectionChange={(keys) => setTypeFilter((Array.from(keys)[0] as string) || '')}
        >
          {PROJECT_TYPES.map((t) => (
            <SelectItem key={t}>{t.replace(/_/g, ' ')}</SelectItem>
          ))}
        </Select>
        <Select
          aria-label="Sort projects"
          size="sm"
          className="w-full sm:w-40"
          placeholder="Sort by"
          selectedKeys={sortBy ? [sortBy] : []}
          onSelectionChange={(keys) => setSortBy((Array.from(keys)[0] as string) || '')}
        >
          <SelectItem key="name:asc" startContent={<FiArrowUp className="text-xs" />}>Name A→Z</SelectItem>
          <SelectItem key="name:desc" startContent={<FiArrowDown className="text-xs" />}>Name Z→A</SelectItem>
          <SelectItem key="createdAt:desc" startContent={<FiArrowDown className="text-xs" />}>Newest first</SelectItem>
          <SelectItem key="createdAt:asc" startContent={<FiArrowUp className="text-xs" />}>Oldest first</SelectItem>
          <SelectItem key="phase:asc" startContent={<FiArrowUp className="text-xs" />}>Phase</SelectItem>
        </Select>
        {/* Slice 2: archive toggle — surfaces soft-deleted projects */}
        <Button
          size="sm"
          variant={showArchived ? 'solid' : 'flat'}
          color={showArchived ? 'warning' : 'default'}
          onPress={() => setShowArchived((v) => !v)}
          className="self-start sm:self-auto"
        >
          {showArchived ? '✓ Showing Archived' : 'Show Archived'}
        </Button>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden ml-auto">
          <Tooltip content="Grid view">
            <button
              className={`px-2.5 py-1.5 transition-colors ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
            >
              <FiGrid className="text-sm" />
            </button>
          </Tooltip>
          <Tooltip content="List view">
            <button
              className={`px-2.5 py-1.5 border-l border-gray-200 transition-colors ${viewMode === 'list' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              <FiList className="text-sm" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <ProjectCardSkeleton key={i} />)}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && <ErrorState message="Could not load projects. Please try again." />}

      {/* Empty states (distinguish "no data yet" vs "no results from filters") */}
      {!isLoading && !error && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
            {hasFilters ? <FiSearch className="text-gray-400 text-xl" /> : <FiInbox className="text-gray-400 text-xl" />}
          </div>
          {hasFilters ? (
            <>
              <p className="text-sm font-medium text-gray-600">No projects match your filters</p>
              <p className="text-xs text-gray-400 mt-1">Try clearing filters or adjusting your search.</p>
              <Button
                size="sm"
                variant="light"
                className="mt-3"
                onPress={() => {
                  setSearch(''); setDebouncedSearch('');
                  setStatusFilter(''); setPhaseFilter(''); setTypeFilter(''); setSortBy('');
                }}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-600">No projects yet</p>
              <p className="text-xs text-gray-400 mt-1">Create your first project to get started.</p>
              {canCreate && (
                <Button size="sm" color="primary" startContent={<FiPlus />} className="mt-3" onPress={openCreate}>
                  New Project
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Grid view */}
      {!isLoading && !error && viewMode === 'grid' && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p: any) => (
            <ProjectCard
              key={p.id}
              p={p}
              onEdit={openEdit}
              onDelete={openDelete}
              canEdit={canEdit}
              canDelete={canDelete}
              health={healthMap[p.id]}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {!isLoading && !error && viewMode === 'list' && projects.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="responsive-table-wrap"><table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Project</th>
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Phase</th>
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-right">Budget</th>
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-center">Bldgs / Units</th>
                <th className="py-2.5 px-4 text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p: any) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  onEdit={openEdit}
                  onDelete={openDelete}
                  canEdit={canEdit}
                  canDelete={canDelete}
                />
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="border-b border-gray-100">
            {editId ? 'Edit Project' : 'New Project'}
          </ModalHeader>
          <ModalBody className="py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                size="sm" label="Project Name" isRequired
                value={form.name} onChange={set('name')}
                isInvalid={!!formErrors.name} errorMessage={formErrors.name}
              />
              <Input
                size="sm" label="Slug" isRequired
                value={form.slug} onChange={set('slug')}
                placeholder="unique-slug"
                description="Lowercase letters, numbers, dashes"
                isInvalid={!!formErrors.slug} errorMessage={formErrors.slug}
              />
              <Input
                size="sm" label="Location" isRequired
                value={form.location} onChange={set('location')}
                placeholder="e.g. Lewisville, TX"
                isInvalid={!!formErrors.location} errorMessage={formErrors.location}
              />
              <Input size="sm" label="Address" value={form.address} onChange={set('address')} />
              <Select
                size="sm"
                label="Project Type"
                selectedKeys={form.projectType ? [form.projectType] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setForm((f) => ({ ...f, projectType: val || '' }));
                }}
              >
                {PROJECT_TYPES.map((v) => <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>)}
              </Select>
              <Input
                size="sm" label="Acreage" type="number" step="0.01"
                value={form.acreage} onChange={set('acreage')}
                placeholder="0.00"
                isInvalid={!!formErrors.acreage} errorMessage={formErrors.acreage}
              />
              <Select
                size="sm" label="Phase"
                selectedKeys={form.phase ? [form.phase] : []}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setForm((f) => ({ ...f, phase: val }));
                }}
              >
                {PHASES.map((v) => <SelectItem key={v}>{v.replace(/_/g, ' ')}</SelectItem>)}
              </Select>
              <Select
                size="sm" label="Status"
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
              <Input size="sm" label="Start Date" type="date" value={form.startDate} onChange={set('startDate')} />
              <Input
                size="sm" label="Target Completion" type="date"
                value={form.targetEnd} onChange={set('targetEnd')}
                isInvalid={!!formErrors.targetEnd} errorMessage={formErrors.targetEnd}
              />
            </div>
            <Textarea size="sm" label="Description" value={form.description} onChange={set('description')} minRows={3} className="mt-4" />
          </ModalBody>
          <ModalFooter className="border-t border-gray-100">
            <Button size="sm" variant="light" onPress={onFormClose}>Cancel</Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleSave}
              isLoading={createProject.isPending || updateProject.isPending}
            >
              {editId ? 'Save Changes' : 'Create Project'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Archive Confirmation */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} isDismissable={false} size="sm">
        <ModalContent>
          <ModalHeader>Archive Project</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">
              This will mark the project as <strong>CANCELLED</strong>. Buildings, units, and historical
              data are preserved. You can restore it later by editing the project status.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onDeleteClose}>Go Back</Button>
            <Button size="sm" color="danger" onPress={handleDelete} isLoading={deleteProject.isPending}>
              Yes, Archive
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

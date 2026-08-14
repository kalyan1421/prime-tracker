import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

/**
 * Permission gate for read queries.
 *
 * Every read hook below that hits a `@RequirePermissions`-guarded route folds this
 * into its `enabled`. The reason is a bug class this file kept reproducing: a page or
 * widget is gated on one permission, but the hooks it calls need a different one, so a
 * role that legitimately reaches the screen fires a request the server refuses. The
 * user sees a red toast on a screen they are allowed to open, and nothing indicates
 * which of the eight parallel queries failed.
 *
 * Gating per call site does not hold — a hook picks up a new caller and the gate is
 * missed. The permission belongs to the endpoint, so it lives with the hook that calls
 * it. A role without the permission now gets `undefined` (the same shape as "still
 * loading"), never a 403, and the surrounding component decides what to render.
 *
 * This is deliberately NOT a security control. The server guard is. This only stops
 * the client asking questions it already knows the answer to.
 */
function useCan(...permissions: string[]) {
  const hasAnyPermission = useAuthStore((s) => s.hasAnyPermission);
  return hasAnyPermission(...permissions);
}

// ---- Dashboard ----
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/projects/dashboard').then((r) => r.data),
  });
}

// ---- Projects ----
export function useProjects(params?: {
  status?: string;
  phase?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  archived?: boolean;
}) {
  return useQuery({
    queryKey: ['projects', params],
    queryFn: () => api.get('/projects', { params }).then((r) => r.data),
  });
}

// Slice 2 — Project Health Scores (bulk for the projects list)
export function useProjectHealthBulk(projectIds: string[]) {
  const idsCsv = [...projectIds].sort().join(',');
  return useQuery({
    queryKey: ['project-health-bulk', idsCsv],
    queryFn: () =>
      api.get('/projects/health/bulk', { params: { ids: idsCsv } }).then((r) => r.data as Record<
        string,
        { score: number; breakdown: Record<string, { score: number; reason: string }> }
      >),
    enabled: idsCsv.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjectHealth(projectId: string) {
  return useQuery({
    queryKey: ['project-health', projectId],
    queryFn: () =>
      api.get(`/projects/${projectId}/health`).then((r) => r.data as {
        score: number;
        breakdown: Record<string, { score: number; reason: string }>;
      }),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get(`/projects/${projectId}/members`).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useAddProjectMember() {
  const qc = useQueryClient();
  return useMutation({
    // roles[] is the multi-role form (a member may be Finance AND Legal on one project);
    // role is the legacy single-role field the API still accepts and mirrors from roles[0].
    mutationFn: ({ projectId, data }: { projectId: string; data: { userId: string; role?: string; roles?: string[] } }) =>
      api.post(`/projects/${projectId}/members`, data).then((r) => r.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['project-members', v.projectId] }),
  });
}

export function useRemoveProjectMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      api.delete(`/projects/${projectId}/members/${userId}`).then((r) => r.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['project-members', v.projectId] }),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useProjectActivity(projectId: string, page = 1) {
  return useQuery({
    queryKey: ['project', 'activity', projectId, page],
    queryFn: () => api.get(`/projects/${projectId}/activity`, { params: { page, limit: 60 } }).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// ---- Financial Summary ----
// buildingId/unitId scope the summary to one building or unit — used by the Budget
// tab's filter (backend prioritizes unitId > buildingId > projectId, same as the
// dedicated useBuildingFinancialSummary/useUnitFinancialSummary hooks below).
export function useFinancialSummary(projectId: string, buildingId?: string, unitId?: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['financials', projectId, buildingId, unitId],
    queryFn: () => api.get('/budgets/summary', { params: { projectId, buildingId, unitId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useBuildingFinancialSummary(buildingId: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['financials', 'building', buildingId],
    queryFn: () => api.get('/budgets/summary', { params: { buildingId } }).then((r) => r.data),
    enabled: can && (!!buildingId),
  });
}

export function useUnitFinancialSummary(unitId: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['financials', 'unit', unitId],
    queryFn: () => api.get('/budgets/summary', { params: { unitId } }).then((r) => r.data),
    enabled: can && (!!unitId),
  });
}

export function useBudgetByBuildingUnitReport(projectId: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['financials', 'report', projectId],
    queryFn: () => api.get('/budgets/report', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

// ---- Budget Lines ----
// buildingId/unitId narrow a project-wide list down to one building or unit — used by
// the Budget tab's filter. Omit both for the project-wide list (existing behavior).
export function useBudgetLines(projectId: string, buildingId?: string, unitId?: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['budgets', projectId, buildingId, unitId],
    queryFn: () => api.get('/budgets', { params: { projectId, buildingId, unitId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useBuildingBudgetLines(buildingId: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['budgets', 'building', buildingId],
    queryFn: () => api.get('/budgets', { params: { buildingId } }).then((r) => r.data),
    enabled: can && (!!buildingId),
  });
}

export function useUnitBudgetLines(unitId: string) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['budgets', 'unit', unitId],
    queryFn: () => api.get('/budgets', { params: { unitId } }).then((r) => r.data),
    enabled: can && (!!unitId),
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/budgets', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/budgets/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/budgets/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

// ---- Milestones ----
export function useMilestones(projectId: string) {
  const can = useCan('milestone:view');
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => api.get('/milestones', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/milestones/${id}`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  });
}

export function useCreateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/milestones', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/milestones/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  });
}

// ---- Units ----
/**
 * Units for a project, or for a single building when `buildingId` is given.
 *
 * The building page used to call this with the projectId and filter in the browser,
 * pulling every unit in the project to display one building's. The API has supported
 * `?buildingId=` all along.
 *
 * No permission gate: unit:view is held by every role (see the useCan note above).
 */
export function useUnits(projectId: string, buildingId?: string) {
  return useQuery({
    queryKey: ['units', projectId, buildingId ?? 'all'],
    queryFn: () =>
      api.get('/units', { params: buildingId ? { buildingId } : { projectId } }).then((r) => r.data),
    enabled: !!buildingId || !!projectId,
  });
}

export function useInventory(filters?: {
  status?: string;
  unitType?: string;
  projectId?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ['inventory', filters],
    queryFn: () => api.get('/units/inventory', { params: filters }).then((r) => r.data),
  });
}

export function useUnit(id: string) {
  return useQuery({
    queryKey: ['unit', id],
    queryFn: () => api.get(`/units/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/**
 * The unit's occupancy history — tenancies, sales and vacancy windows, plus lifetime
 * totals. Server-computed: vacancy comes from the unit_status_events log, so the gap
 * before the first lease and the vacancy open right now both appear. Neither was
 * derivable from the lease rows this used to be built from on the client.
 */
export function useUnitHistory(id?: string) {
  return useQuery({
    queryKey: ['unit-history', id],
    queryFn: () => api.get(`/units/${id}/history`).then((r) => r.data),
    enabled: !!id,
  });
}

// ---- Unit Comments ----
export function useUnitComments(unitId: string) {
  return useQuery({
    queryKey: ['comments', 'unit', unitId],
    queryFn: () => api.get('/comments', { params: { unitId } }).then((r) => r.data),
    enabled: !!unitId,
  });
}

export function useProjectComments(projectId: string) {
  return useQuery({
    queryKey: ['comments', 'project', projectId],
    queryFn: () => api.get('/comments', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useRecentComments(limit = 20) {
  return useQuery({
    queryKey: ['comments-recent', limit],
    queryFn: () => api.get('/comments/recent', { params: { limit } }).then((r) => r.data),
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { unitId?: string; projectId?: string; content: string; commentType?: string }) =>
      api.post('/comments', data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      if (vars.unitId) qc.invalidateQueries({ queryKey: ['comments', 'unit', vars.unitId] });
      if (vars.projectId) qc.invalidateQueries({ queryKey: ['comments', 'project', vars.projectId] });
      qc.invalidateQueries({ queryKey: ['comments-recent'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, source }: { id: string; source: 'unit' | 'project' }) =>
      api.delete(`/comments/${source}/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments'] });
      qc.invalidateQueries({ queryKey: ['comments-recent'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

// ---- Monthly Lease Income ----
export function useMonthlyLeaseIncome(projectId: string) {
  const can = useCan('unit:view');
  return useQuery({
    queryKey: ['lease-income', projectId],
    queryFn: () => api.get('/units/lease-income', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

// ---- Leases ----
export function useLeases(projectId: string) {
  const can = useCan('lease:view');
  return useQuery({
    queryKey: ['leases', projectId],
    queryFn: () => api.get('/leases', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useRentRoll(projectId: string) {
  const can = useCan('lease:view');
  return useQuery({
    queryKey: ['rent-roll', projectId],
    queryFn: () => api.get('/leases/rent-roll', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

/**
 * Everything a lease write can touch downstream.
 *
 * Saving a lease seeds its deposit / NNN / TI obligations from the headline terms and
 * regenerates its rent schedule. Neither of those was invalidated, so the server did the
 * work and the panels kept rendering cached emptiness — a TI allowance typed on the lease
 * form appeared nowhere until a hard reload. Prefix-invalidated because a save may touch
 * any lease on the unit, and the caller does not always know which.
 */
function invalidateAfterLeaseWrite(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['leases'] });
  qc.invalidateQueries({ queryKey: ['rent-roll'] });
  qc.invalidateQueries({ queryKey: ['units'] });
  qc.invalidateQueries({ queryKey: ['unit'] });
  qc.invalidateQueries({ queryKey: ['unit-history'] });
  qc.invalidateQueries({ queryKey: ['lease-obligations'] });
  qc.invalidateQueries({ queryKey: ['obligation-summary'] });
  qc.invalidateQueries({ queryKey: ['lease-rent-periods'] });
  qc.invalidateQueries({ queryKey: ['lease-rent-summary'] });
  // Ending a tenancy voids invoices and releases the unit, so the collection ledger
  // and every feed that reads unit status go stale too. Left out until T1.2, which is
  // how a unit could read AVAILABLE on one panel and LEASED on the next.
  qc.invalidateQueries({ queryKey: ['lease-rent-invoices'] });
  qc.invalidateQueries({ queryKey: ['rent-invoices'] });
  qc.invalidateQueries({ queryKey: ['lease-assignments'] });
  qc.invalidateQueries({ queryKey: ['exceptions'] });
}

export function useCreateLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/leases', data).then((r) => r.data),
    onSuccess: () => {
      invalidateAfterLeaseWrite(qc);
    },
  });
}

export function useUpdateLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/leases/${id}`, data).then((r) => r.data),
    onSuccess: () => invalidateAfterLeaseWrite(qc),
  });
}

/**
 * End a tenancy — the one action behind turnover, renewal and relocation.
 *
 * Server-side this caps the rent schedule, voids unpaid invoices past the move-out
 * date, records the deposit decision and releases the unit. That is a lot of
 * aggregates for one POST, which is exactly why it goes through
 * invalidateAfterLeaseWrite rather than invalidating ['leases'] alone.
 */
export function useEndTenancy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/leases/${id}/end-tenancy`, data).then((r) => r.data),
    onSuccess: () => invalidateAfterLeaseWrite(qc),
  });
}

/** The tenant-assignment chain for a lease, oldest first. */
export function useLeaseAssignments(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-assignments', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/assignments`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

/**
 * Assign a lease to a new tenant. Unlike ending a tenancy this touches nothing but the
 * tenant's identity — but the unit timeline and the lease list both display the name,
 * so the same invalidation applies.
 */
export function useAssignTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.post(`/leases/${id}/assign-tenant`, data).then((r) => r.data),
    onSuccess: () => invalidateAfterLeaseWrite(qc),
  });
}

/**
 * Enter a tenancy that has already ended (H2 backfill).
 *
 * Writes a lease, its schedule and a complete ledger in one call, so every aggregate on
 * the unit page moves at once — hence the full invalidation rather than just ['leases'].
 */
export function useBackfillTenancy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/leases/backfill', data).then((r) => r.data),
    onSuccess: () => invalidateAfterLeaseWrite(qc),
  });
}

/**
 * R27 — the Founder gate on deleting a backfilled tenancy.
 *
 * Three calls rather than one "delete with approval": approving authorises the delete, it
 * does not perform it. Collapsing them would make the approval a click-through instead of
 * a decision.
 */
export function useRequestHistoricalDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leaseId, reason }: { leaseId: string; reason: string }) =>
      api.post(`/leases/${leaseId}/request-deletion`, { reason }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['historical-deletions'] }),
  });
}

export function useHistoricalDeletionRequests(status = 'PENDING') {
  // Gated on backfill, not delete — the requester has to see their own pending request.
  const can = useCan('unit:history:backfill');
  return useQuery({
    queryKey: ['historical-deletions', status],
    queryFn: () =>
      api.get('/leases/historical-deletions', { params: { status } }).then((r) => r.data),
    enabled: can,
  });
}

export function useCancelHistoricalDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      api.post(`/leases/historical-deletions/${requestId}/cancel`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['historical-deletions'] }),
  });
}

export function useDecideHistoricalDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, approve, note }: { requestId: string; approve: boolean; note?: string }) =>
      api.post(`/leases/historical-deletions/${requestId}/decide`, { approve, note })
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['historical-deletions'] }),
  });
}

export function useDeleteLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/leases/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leases'] });
      qc.invalidateQueries({ queryKey: ['rent-roll'] });
      // A historical delete consumes its approval, so the Founder queue changes too.
      qc.invalidateQueries({ queryKey: ['historical-deletions'] });
    },
  });
}

// ---- Sales ----
export function useSalesPipeline(projectId: string) {
  const can = useCan('sales:view');
  return useQuery({
    queryKey: ['sales', projectId],
    queryFn: () => api.get('/sales/pipeline', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/sales', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

export function useUpdateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/sales/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

export function useApproveSaleDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/sales/${id}/approve-discount`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  });
}

export function useDeleteSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/sales/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

// ---- Loans ----
/**
 * Loans for a project, or only those secured on one building.
 *
 * Project scope already includes building-level loans (LoansService.findByProject ORs on
 * building.projectId), so the building scope is a strict subset — not a rival definition.
 */
export function useLoans(projectId: string, buildingId?: string) {
  const can = useCan('loan:view');
  return useQuery({
    queryKey: ['loans', projectId, buildingId ?? 'all'],
    queryFn: () =>
      api.get('/loans', { params: buildingId ? { buildingId } : { projectId } }).then((r) => r.data),
    enabled: can && (!!buildingId || !!projectId),
  });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/loans', data).then((r) => r.data),
    onSuccess: (_r, v: any) => {
      qc.invalidateQueries({ queryKey: ['loans', v.projectId] });
    },
  });
}

export function useUpdateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string;[k: string]: unknown }) =>
      api.put(`/loans/${id}`, data).then((r) => r.data),
    onSuccess: (_r, v: any) => {
      qc.invalidateQueries({ queryKey: ['loans', v.projectId] });
    },
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => api.delete(`/loans/${id}`).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['loans', v.projectId] });
    },
  });
}

export function useMonthlyPayments(projectId: string) {
  const can = useCan('loan:view');
  return useQuery({
    queryKey: ['monthly-payments', projectId],
    queryFn: () => api.get('/loans/monthly-payments', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

// ---- Commitments ----
export function useCommitments(projectId: string, buildingId?: string, unitId?: string) {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['commitments', projectId, buildingId, unitId],
    queryFn: () => api.get('/commitments', { params: { projectId, buildingId, unitId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useCreateCommitment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/commitments', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commitments'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

export function useUpdateCommitment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/commitments/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commitments'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

export function useDeleteCommitment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/commitments/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commitments'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

// ---- KPI ----
export function useKpiHistory(projectId: string) {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['kpi', projectId],
    queryFn: () => api.get('/kpi/history', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

// ---- Users (Admin) ----
/** Self-service identity update. Never accepts role/email/isActive — the API rejects them. */
export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string; avatarUrl?: string; phone?: string; jobTitle?: string }) =>
      api.patch('/users/me', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/** Requires the current password; the API revokes every other session on success. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post('/auth/change-password', data).then((r) => r.data),
  });
}

/**
 * People that work can be assigned to. Use this for any assignee picker — `useUsers()`
 * hits an admin-only route (`user:manage`), so pickers built on it showed
 * "Missing permissions: user:manage" and an empty list to every non-admin.
 */
export function useAssignableUsers() {
  return useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
  });
}

export function useUsers(enabled = true) {
  const can = useCan('user:manage');
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
    // `can` covers the user:manage check the call sites used to do by hand. The
    // parameter is still honoured for callers that suppress the fetch for their own
    // reasons (a collapsed panel, a modal that has not opened yet).
    enabled: enabled && can,
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/users/${id}/role`, { role }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) =>
      api.patch(`/users/${id}/roles`, { roles }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useToggleUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}/status`, { isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ---- Audit ----
export function useAuditLog(params?: {
  action?: string;
  entity?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  const can = useCan('audit:view');
  return useQuery({
    queryKey: ['audit', params],
    queryFn: () => api.get('/audit', { params }).then((r) => r.data),
    enabled: can,
    // Paging through a log is a read-back-and-forth motion; without this every page
    // change blanks the table and re-runs the empty state.
    placeholderData: (prev) => prev,
  });
}

/** Distinct actions/entities/actors present in the log — populates the filter controls. */
export function useAuditFilterOptions() {
  const can = useCan('audit:view');
  return useQuery({
    queryKey: ['audit', 'filters'],
    queryFn: () => api.get('/audit/filters').then((r) => r.data),
    enabled: can,
    staleTime: 5 * 60_000,
  });
}

// ---- Project Mutations ----
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/projects', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/projects/${id}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project', vars.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Set/clear the project's approved budget (control total). Gated server-side by budget:edit. */
export function useSetApprovedBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approvedBudget }: { id: string; approvedBudget: number | null }) =>
      api.put(`/projects/${id}/approved-budget`, { approvedBudget }).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['project', vars.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ---- Unit Mutations ----
export function useCreateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/units', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });
}

export function useUpdateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/units/${id}`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });
}

export function useUpdateUnitStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/units/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });
}

export function useDeleteUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { id: string; force?: boolean }) => {
      const params = typeof input === 'string' ? { id: input } : input;
      const url = `/units/${params.id}${params.force ? '?force=true' : ''}`;
      return api.delete(url).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });
}

export function useCombineUnits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { buildingId: string; sourceUnitIds: string[]; unitNumber: string; unitType?: string; notes?: string }) =>
      api.post('/units/combine', data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units'] }); },
  });
}

// ---- Building Queries ----
export function useBuildings(projectId: string) {
  return useQuery({
    queryKey: ['buildings', projectId],
    queryFn: () => api.get('/buildings', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useBuilding(id: string) {
  return useQuery({
    queryKey: ['building', id],
    queryFn: () => api.get(`/buildings/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/buildings', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buildings'] }),
  });
}

export function useUpdateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/buildings/${id}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['buildings'] });
      // The single-building read is a DIFFERENT key from the list. Invalidating only the
      // list left the building detail page showing the values it had before the edit,
      // which is exactly the screen the edit was launched from.
      qc.invalidateQueries({ queryKey: ['building', vars.id] });
      // Project.phase is derived from max(building phases), so a phase edit changes the
      // project header too.
      qc.invalidateQueries({ queryKey: ['project'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useDeleteBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { id: string; force?: boolean }) => {
      const params = typeof input === 'string' ? { id: input } : input;
      const url = `/buildings/${params.id}${params.force ? '?force=true' : ''}`;
      return api.delete(url).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buildings'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

export function useReorderBuildings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectId: string; buildingIds: string[] }) =>
      api.patch('/buildings/reorder', data).then((r) => r.data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['buildings', vars.projectId] }),
  });
}

// ---- User Mutations ----
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/users', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    // Admin edit of another user's details. Role/roles/status have their own routes —
    // they are not accepted here and the DTO rejects them.
    mutationFn: ({ id, data }: { id: string; data: { name?: string; email?: string; phone?: string; jobTitle?: string } }) =>
      api.put(`/users/${id}`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/**
 * Admin reset of another user's password. Returns { sessionsRevoked } — surface it, the
 * admin should know the user was signed out everywhere.
 *
 * No cache invalidation: nothing in the users list reflects a password.
 */
export function useSetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api.patch(`/users/${id}/password`, { newPassword }).then((r) => r.data),
  });
}

// ---- Roles ----
export function useRoleCounts() {
  const can = useCan('user:manage');
  return useQuery({
    queryKey: ['roles', 'counts'],
    queryFn: () => api.get('/users/roles').then((r) => r.data),
    enabled: can,
  });
}

export function useRoleDefinitions() {
  const can = useCan('user:manage');
  return useQuery({
    queryKey: ['roles', 'definitions'],
    queryFn: () => api.get('/users/roles/definitions').then((r) => r.data),
    enabled: can,
  });
}

// ---- Reports ----
export function usePortfolioReport() {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['report-portfolio'],
    queryFn: () => api.get('/reports/portfolio').then((r) => r.data),
    enabled: can,
  });
}

export function useSalesReport() {
  const can = useCan('sales:view');
  return useQuery({
    queryKey: ['report-sales'],
    queryFn: () => api.get('/reports/sales-summary').then((r) => r.data),
    enabled: can,
  });
}

export function useRevenueReport() {
  const can = useCan('lease:view');
  return useQuery({
    queryKey: ['report-revenue'],
    queryFn: () => api.get('/reports/revenue').then((r) => r.data),
    enabled: can,
  });
}

export function useDebtReport() {
  const can = useCan('loan:view');
  return useQuery({
    queryKey: ['report-debt'],
    queryFn: () => api.get('/reports/debt').then((r) => r.data),
    enabled: can,
  });
}

export function useUnitSalesReport() {
  const can = useCan('sales:view');
  return useQuery({
    queryKey: ['report-unit-sales'],
    queryFn: () => api.get('/reports/unit-sales').then((r) => r.data),
    enabled: can,
  });
}

export function useVacancyReport(params?: { projectId?: string; minDays?: number }) {
  const can = useCan('sales:view');
  return useQuery({
    queryKey: ['report-vacancy', params],
    queryFn: () => api.get('/reports/vacancy', { params }).then((r) => r.data),
    enabled: can,
  });
}

// ---- MFA ----
export function useMfaSetup() {
  return useMutation({
    mutationFn: () => api.post('/auth/mfa/setup').then((r) => r.data),
  });
}

export function useMfaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post('/auth/mfa/enable', { token }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useMfaVerify() {
  return useMutation({
    mutationFn: (token: string) => api.post('/auth/mfa/verify', { token }).then((r) => r.data),
  });
}

// ---- Notifications ----
export function useNotifications(limit = 20) {
  return useQuery({
    queryKey: ['notifications', limit],
    queryFn: () => api.get('/notifications', { params: { limit } }).then((r) => r.data),
    staleTime: 30000, // socket push invalidates; this is the fallback refetch window
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', { ids }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get('/notifications/preferences').then((r) => r.data),
  });
}

/**
 * Delivery is split per channel: `enabled` drives in-app, `emailEnabled` drives
 * email. `emailEnabled` is deliberately nullable — null means "fall back to this
 * type's tier default" (ACTION types email, FYI types are in-app only), so it is
 * NOT interchangeable with false. Both fields are optional so a caller can move
 * one channel without restating the other.
 */
export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, enabled, emailEnabled }: { type: string; enabled?: boolean; emailEnabled?: boolean | null }) =>
      api
        .put('/notifications/preferences', {
          type,
          ...(enabled === undefined ? {} : { enabled }),
          ...(emailEnabled === undefined ? {} : { emailEnabled }),
        })
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });
}

export interface NotificationPreference {
  type: string;
  enabled: boolean;
  /** null = use the tier default; true/false = explicit user override. */
  emailEnabled?: boolean | null;
  tier?: 'ACTION' | 'FYI';
}

// ---- Leads ----
export function useLeadDashboard(params?: { projectId?: string }) {
  const can = useCan('lead:view');
  return useQuery({
    queryKey: ['leads', 'dashboard', params],
    queryFn: () => api.get('/leads/dashboard', { params }).then((r) => r.data),
    enabled: can,
  });
}

export function useLeads(
  params?: { projectId?: string; status?: string; source?: string; unitId?: string; assignedTo?: string; unassigned?: boolean; search?: string; brokerId?: string },
  // The lead:view check that used to live here is now `can`, below. The parameter
  // remains for callers that suppress the fetch for their own reasons.
  enabled = true,
) {
  const can = useCan('lead:view');
  return useQuery({
    queryKey: ['leads', params],
    queryFn: () => api.get('/leads', { params }).then((r) => r.data),
    enabled: enabled && can,
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => api.get(`/leads/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useLeadActivities(leadId: string) {
  return useQuery({
    queryKey: ['lead-activities', leadId],
    queryFn: () => api.get(`/leads/${leadId}/activities`).then((r) => r.data),
    enabled: !!leadId,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/leads', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/leads/${id}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', vars.id] });
    },
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/leads/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useAddLeadActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, data }: { leadId: string; data: Record<string, unknown> }) =>
      api.post(`/leads/${leadId}/activities`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['lead-activities', vars.leadId] });
      qc.invalidateQueries({ queryKey: ['lead', vars.leadId] });
    },
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, unitId, saleData }: { id: string; unitId: string; saleData: Record<string, unknown> }) =>
      api.post(`/leads/${id}/convert`, { unitId, ...saleData }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ---- Campaigns (Sprint 2 — marketing-spend attribution) ----

export function useCampaigns(params?: { projectId?: string; status?: string; channel?: string }) {
  const can = useCan('campaign:view');
  return useQuery({
    queryKey: ['campaigns', params],
    queryFn: () => api.get('/campaigns', { params }).then((r) => r.data),
    enabled: can,
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get(`/campaigns/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCampaignPerformance(params?: { projectId?: string; from?: string; to?: string }) {
  const can = useCan('campaign:view');
  return useQuery({
    queryKey: ['campaigns', 'performance', params],
    queryFn: () => api.get('/campaigns/performance', { params }).then((r) => r.data),
    enabled: can,
  });
}

export function useCampaignSpendTrend(params?: { projectId?: string; monthsBack?: number }) {
  const can = useCan('campaign:view');
  return useQuery({
    queryKey: ['campaigns', 'spend-trend', params],
    queryFn: () => api.get('/campaigns/spend-trend', { params }).then((r) => r.data),
    enabled: can,
  });
}

export function useCampaignSpendByCampaign(params?: { projectId?: string }) {
  const can = useCan('campaign:view');
  return useQuery({
    queryKey: ['campaigns', 'spend-by-campaign', params],
    queryFn: () => api.get('/campaigns/spend-by-campaign', { params }).then((r) => r.data),
    enabled: can,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/campaigns', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/campaigns/${id}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign', vars.id] });
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useRecordCampaignSpend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, data }: { campaignId: string; data: Record<string, unknown> }) =>
      api.post(`/campaigns/${campaignId}/spend`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign', vars.campaignId] });
    },
  });
}

// ---- Role-Based Dashboards ----
export function useFounderDashboard() {
  const can = useCan('unit:view');
  return useQuery({
    queryKey: ['dashboard', 'founder'],
    queryFn: () => api.get('/dashboard/founder').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: can,
  });
}

export function useFinanceDashboard() {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['dashboard', 'finance'],
    queryFn: () => api.get('/dashboard/finance').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: can,
  });
}

export function useConstructionDashboard() {
  const can = useCan('unit:view');
  return useQuery({
    queryKey: ['dashboard', 'construction'],
    queryFn: () => api.get('/dashboard/construction').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: can,
  });
}

export function useSalesDashboard() {
  const can = useCan('unit:view');
  return useQuery({
    queryKey: ['dashboard', 'sales'],
    queryFn: () => api.get('/dashboard/sales').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: can,
  });
}

// ---- QuickBooks ----
export function useQBStatus() {
  const can = useCan('quickbooks:manage');
  return useQuery({
    queryKey: ['qb-status'],
    queryFn: () => api.get('/quickbooks/status').then((r) => r.data),
    enabled: can,
  });
}

export function useQBSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/quickbooks/sync').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qb-status'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
    },
  });
}

// ---- Cash Flow ----
export function useCashFlow(projectId: string) {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['cashflow', projectId],
    queryFn: () => api.get('/cashflow', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useCashFlowForecast(projectId: string, months?: number) {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['cashflow-forecast', projectId, months],
    queryFn: () => api.get('/cashflow/forecast', { params: { projectId, months } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

/** Portfolio-wide cashflow forecast across the viewer's projects. */
export function useCashflowPortfolio(months?: number) {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['cashflow-portfolio', months],
    queryFn: () => api.get('/cashflow/portfolio', { params: { months } }).then((r) => r.data),
    enabled: can,
  });
}

/** Budget cash-obligations by category, M/Q/A. Omit projectId for portfolio. */
export function useBudgetObligations(projectId?: string, granularity: 'month' | 'quarter' | 'year' = 'month') {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['budget-obligations', projectId ?? 'portfolio', granularity],
    queryFn: () => api.get('/cashflow/obligations', { params: { projectId, granularity } }).then((r) => r.data),
    enabled: can,
  });
}

export function useCreateCashFlowEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/cashflow', data).then((r) => r.data),
    onSuccess: (_r, v: any) => {
      qc.invalidateQueries({ queryKey: ['cashflow', v.projectId] });
      qc.invalidateQueries({ queryKey: ['cashflow-forecast', v.projectId] });
    },
  });
}

export function useDeleteCashFlowEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) =>
      api.delete(`/cashflow/${id}`).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['cashflow', v.projectId] });
      qc.invalidateQueries({ queryKey: ['cashflow-forecast', v.projectId] });
    },
  });
}

// ---- Draw Management ----
export function useProjectDraws(projectId: string) {
  const can = useCan('draw:view');
  return useQuery({
    queryKey: ['draws', projectId],
    queryFn: () => api.get('/loans/draws', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useCreateDraw() {
  const qc = useQueryClient();
  return useMutation({
    // projectId is only used for cache invalidation below — it must NOT go in the
    // POST body (CreateDrawDto uses forbidNonWhitelisted → "property projectId should not exist").
    mutationFn: ({ loanId, projectId: _projectId, ...data }: { loanId: string; projectId: string;[k: string]: unknown }) =>
      api.post(`/loans/${loanId}/draws`, data).then((r) => r.data),
    onSuccess: (_r, v: any) => qc.invalidateQueries({ queryKey: ['draws', v.projectId] }),
  });
}

export function useUpdateDraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id, projectId: _projectId, ...data
    }: {
      id: string;
      projectId: string;
      amount?: number;
      requestedAmount?: number;
      requestDate?: string;
      expectedFundingDate?: string;
      notes?: string;
    }) =>
      api.patch(`/loans/draws/${id}`, data).then((r) => r.data),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['draws', v.projectId] }),
  });
}

export function useUpdateDrawStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id, status, approvedAmount, rejectionReason,
    }: {
      id: string;
      status: string;
      projectId: string;
      approvedAmount?: number;
      rejectionReason?: string;
    }) =>
      api.patch(`/loans/draws/${id}/status`, { status, approvedAmount, rejectionReason }).then((r) => r.data),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['draws', v.projectId] }),
  });
}

export function useDeleteDraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) =>
      api.delete(`/loans/draws/${id}`).then((r) => r.data),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['draws', v.projectId] }),
  });
}

// ---- Draw Schedule ----
export function useDrawSchedule(loanId: string) {
  return useQuery({
    queryKey: ['draw-schedule', loanId],
    queryFn: () => api.get(`/loans/${loanId}/schedule`).then((r) => r.data),
    enabled: !!loanId,
  });
}

export function useUpsertDrawScheduleLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, ...data }: {
      loanId: string;
      drawNumber: number;
      plannedAmount: number;
      plannedDate: string;
      description?: string;
    }) => api.post(`/loans/${loanId}/schedule`, data).then((r) => r.data),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['draw-schedule', v.loanId] }),
  });
}

export function useDeleteDrawScheduleLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, loanId }: { id: string; loanId: string }) =>
      api.delete(`/loans/schedule/${id}`).then((r) => r.data),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['draw-schedule', v.loanId] }),
  });
}

// ---- Vendors ----
export function useVendors() {
  const can = useCan('vendor:view');
  return useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get('/vendors').then((r) => r.data),
    enabled: can,
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/vendors', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string;[k: string]: unknown }) =>
      api.put(`/vendors/${id}`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
}

// ---- Contracts ----
export function useContracts(projectId: string) {
  const can = useCan('vendor:view');
  return useQuery({
    queryKey: ['contracts', projectId],
    queryFn: () => api.get('/contracts', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useContractSummary(projectId: string) {
  const can = useCan('vendor:view');
  return useQuery({
    queryKey: ['contracts-summary', projectId],
    queryFn: () => api.get('/contracts/summary', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/contracts', data).then((r) => r.data),
    onSuccess: (_r, v: any) => {
      qc.invalidateQueries({ queryKey: ['contracts', v.projectId] });
      qc.invalidateQueries({ queryKey: ['contracts-summary', v.projectId] });
    },
  });
}

export function useUpdateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; projectId: string;[k: string]: unknown }) =>
      api.put(`/contracts/${id}`, data).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['contracts', v.projectId] });
      qc.invalidateQueries({ queryKey: ['contracts-summary', v.projectId] });
    },
  });
}

export function useDeleteContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api.delete(`/contracts/${id}`).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['contracts', v.projectId] });
      qc.invalidateQueries({ queryKey: ['contracts-summary', v.projectId] });
    },
  });
}

export function useAddChangeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contractId, ...data }: { contractId: string; projectId: string;[k: string]: unknown }) =>
      api.post(`/contracts/${contractId}/change-orders`, data).then((r) => r.data),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['contracts', v.projectId] }),
  });
}

export function useApproveChangeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, projectId }: { id: string; status: string; projectId: string }) =>
      api.patch(`/contracts/change-orders/${id}/status`, { status }).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['contracts', v.projectId] });
      qc.invalidateQueries({ queryKey: ['contracts-summary', v.projectId] });
    },
  });
}

export function useAddContractPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contractId, ...data }: { contractId: string; projectId: string;[k: string]: unknown }) =>
      api.post(`/contracts/${contractId}/payments`, data).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['contracts', v.projectId] });
      qc.invalidateQueries({ queryKey: ['contracts-summary', v.projectId] });
    },
  });
}

// ---- Documents ----
export function useDocuments(params: { projectId?: string; unitId?: string; buildingId?: string; interiorProjectId?: string }) {
  const can = useCan('document:view');
  return useQuery({
    queryKey: ['documents', params],
    queryFn: () => api.get('/documents', { params }).then((r) => r.data),
    enabled: can && (!!(params.projectId || params.unitId || params.interiorProjectId)),
    staleTime: 0, // S3 signed URLs must always be fresh — never serve from cache
  });
}

export function useInteriorDocuments(interiorProjectId?: string) {
  const can = useCan('document:view');
  return useQuery({
    queryKey: ['documents', { interiorProjectId }],
    queryFn: () => api.get('/documents', { params: { interiorProjectId } }).then((r) => r.data),
    enabled: can && (!!interiorProjectId),
    staleTime: 0,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      api.post('/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useRenameDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fileName }: { id: string; fileName: string }) =>
      api.patch(`/documents/${id}`, { fileName }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useReplaceDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file, fileName }: { id: string; file: File; fileName?: string }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (fileName) fd.append('fileName', fileName);
      return api.post(`/documents/${id}/replace`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}

// ---- Investors ----
export function useInvestors() {
  const can = useCan('investor:view');
  return useQuery({
    queryKey: ['investors'],
    queryFn: () => api.get('/investors').then((r) => r.data),
    enabled: can,
  });
}

export function useInvestor(id: string) {
  return useQuery({
    queryKey: ['investor', id],
    queryFn: () => api.get(`/investors/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useInvestorSummary() {
  const can = useCan('investor:view');
  return useQuery({
    queryKey: ['investor-summary'],
    queryFn: () => api.get('/investors/summary').then((r) => r.data),
    enabled: can,
  });
}

export function useCreateInvestor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/investors', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investors'] });
      qc.invalidateQueries({ queryKey: ['investor-summary'] });
    },
  });
}

export function useUpdateInvestor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string;[k: string]: unknown }) =>
      api.put(`/investors/${id}`, data).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['investors'] });
      qc.invalidateQueries({ queryKey: ['investor', v.id] });
    },
  });
}

export function useAddPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ investorId, ...data }: { investorId: string;[k: string]: unknown }) =>
      api.post(`/investors/${investorId}/positions`, data).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['investor', v.investorId] });
      qc.invalidateQueries({ queryKey: ['investors'] });
    },
  });
}

export function useCreateCapitalCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/investors/capital-calls', data).then((r) => r.data),
    onSuccess: (_r, v: any) => {
      qc.invalidateQueries({ queryKey: ['investor', v.investorId] });
      qc.invalidateQueries({ queryKey: ['investors'] });
    },
  });
}

export function useMarkCapitalCallPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; investorId: string }) =>
      api.patch(`/investors/capital-calls/${id}/paid`).then((r) => r.data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['investor', v.investorId] });
      qc.invalidateQueries({ queryKey: ['investors'] });
    },
  });
}

export function useCreateDistribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/investors/distributions', data).then((r) => r.data),
    onSuccess: (_r, v: any) => {
      qc.invalidateQueries({ queryKey: ['investor', v.investorId] });
      qc.invalidateQueries({ queryKey: ['investors'] });
      qc.invalidateQueries({ queryKey: ['investor-summary'] });
    },
  });
}

// ---- Tasks ----
export function useTasks(params?: {
  projectId?: string;
  buildingId?: string;
  unitId?: string;
  assignedTo?: string;
  status?: string;
  priority?: string;
  /** 'TASK' = admin work items, 'CONSTRUCTION' = the site board. Omit for both. */
  kind?: string;
}) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.get('/tasks', { params }).then((r) => r.data),
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get(`/tasks/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/tasks', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/tasks/${id}`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', vars.id] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

/** Day-wise progress updates on one item, newest day first. */
export function useTaskUpdates(taskId?: string) {
  return useQuery({
    queryKey: ['task-updates', taskId],
    queryFn: () => api.get(`/tasks/${taskId}/updates`).then((r) => r.data),
    enabled: !!taskId,
  });
}

export function useAddTaskUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) =>
      api.post(`/tasks/${taskId}/updates`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['task-updates', vars.taskId] });
      // The board shows an update COUNT per row, so the list is stale too.
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useAddTaskUpdatePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ updateId, storagePath, caption }: {
      updateId: string; storagePath: string; caption?: string; taskId?: string;
    }) => api.post(`/tasks/updates/${updateId}/photos`, { storagePath, caption }).then((r) => r.data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['task-updates', vars.taskId] }),
  });
}

export function useDeleteTaskUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ updateId }: { updateId: string; taskId?: string }) =>
      api.delete(`/tasks/updates/${updateId}`).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['task-updates', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useTaskComments(taskId: string) {
  return useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => api.get(`/tasks/${taskId}/comments`).then((r) => r.data),
    enabled: !!taskId,
  });
}

export function useCreateTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, content }: { taskId: string; content: string }) =>
      api.post(`/tasks/${taskId}/comments`, { content }).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['task-comments', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
    },
  });
}

export function useDeleteTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, commentId }: { taskId: string; commentId: string }) =>
      api.delete(`/tasks/${taskId}/comments/${commentId}`).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['task-comments', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
    },
  });
}

export function useUploadTaskAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, formData }: { taskId: string; formData: FormData }) =>
      api.post(`/tasks/${taskId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteTaskAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, attachmentId }: { taskId: string; attachmentId: string }) =>
      api.delete(`/tasks/${taskId}/attachments/${attachmentId}`).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
    },
  });
}

// ---- Organizations ----

export function useOrganizations() {
  const can = useCan('org:manage');
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get('/organizations').then((r) => r.data),
    enabled: can,
  });
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['organizations', id],
    queryFn: () => api.get(`/organizations/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/**
 * Org-level tuning (sale-stage probabilities and the alert thresholds).
 *
 * The server returns the schema defaults when no row exists — same shape, with
 * `usingDefaults: true` — so callers never need a "not configured yet" branch.
 * Gated on org:manage because that is what the endpoint requires; without the guard the
 * query fires and 403s for everyone else.
 */
export function useOrgSettings(orgId?: string) {
  const can = useCan('org:manage');
  return useQuery({
    queryKey: ['org-settings', orgId],
    queryFn: () => api.get(`/organizations/${orgId}/settings`).then((r) => r.data),
    enabled: !!orgId && can,
  });
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: string; data: Record<string, unknown> }) =>
      api.patch(`/organizations/${orgId}/settings`, data).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['org-settings', v.orgId] });
      // The forecast reads these probabilities, so a saved change that left the pipeline
      // numbers stale would look like the setting had not applied.
      qc.invalidateQueries({ queryKey: ['sales-forecast'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/organizations', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.put(`/organizations/${id}`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useDeactivateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch(`/organizations/${id}/deactivate`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useAddOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, ...data }: { orgId: string; userId: string; orgRole: string }) =>
      api.post(`/organizations/${orgId}/members`, data).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['organizations'] });
      qc.invalidateQueries({ queryKey: ['organizations', vars.orgId] });
    },
  });
}

export function useRemoveOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, userId }: { orgId: string; userId: string }) =>
      api.delete(`/organizations/${orgId}/members/${userId}`).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['organizations'] });
      qc.invalidateQueries({ queryKey: ['organizations', vars.orgId] });
    },
  });
}

// ─────────── Slice 5: Budget Revisions ───────────
export function useBudgetRevisions(budgetLineId: string | undefined) {
  return useQuery({
    queryKey: ['budget-revisions', budgetLineId],
    queryFn: () => api.get(`/budgets/${budgetLineId}/revisions`).then((r) => r.data),
    enabled: !!budgetLineId,
  });
}
/** Project-wide budget change log (every revision across all lines, newest first). */
export function useProjectBudgetRevisions(projectId: string | undefined) {
  const can = useCan('budget:view');
  return useQuery({
    queryKey: ['budget-revisions', 'project', projectId],
    queryFn: () => api.get('/budgets/revisions', { params: { projectId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}
export function useCreateBudgetRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetLineId, ...data }: {
      budgetLineId: string; amount: number; reason: string;
      changeReason: 'SCOPE_ADD' | 'COST_INCREASE' | 'REALLOCATION' | 'ESTIMATE_REFINED' | 'CHANGE_ORDER' | 'OTHER';
    }) => api.post(`/budgets/${budgetLineId}/revisions`, data).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['budget-revisions', v.budgetLineId] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['project-health'] });
      qc.invalidateQueries({ queryKey: ['project-health-bulk'] });
    },
  });
}
export function useApproveBudgetRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) =>
      api.post(`/budgets/revisions/${revisionId}/approve`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-revisions'] }),
  });
}

// ─────────── Slice 6: Sales forecast ───────────
export function useSalesForecast(projectId: string | undefined) {
  const can = useCan('sales:view');
  return useQuery({
    queryKey: ['sales-forecast', projectId],
    queryFn: () => api.get('/sales/forecast', { params: { projectId } }).then((r) => r.data as {
      totalPipelineValue: number;
      weightedForecast: number;
      byStage: Array<{ stage: string; count: number; value: number; weighted: number; probability: number }>;
      closedYtd: number;
    }),
    enabled: can && (!!projectId),
    staleTime: 60_000,
  });
}

// ─────────── Slice 7: Milestone deps ───────────
export function useSetMilestoneDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dependsOnId }: { id: string; dependsOnId: string | null }) =>
      api.patch(`/milestones/${id}/depends-on`, { dependsOnId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  });
}
export function useMilestoneCanStart(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone-can-start', milestoneId],
    queryFn: () => api.get(`/milestones/${milestoneId}/can-start`).then((r) => r.data as { allowed: boolean; reason?: string }),
    enabled: !!milestoneId,
  });
}

// ─────────── Slice 8: Draws workflow ───────────
export function useDraw(drawId: string | undefined) {
  return useQuery({
    queryKey: ['draw', drawId],
    queryFn: () => api.get(`/draws/${drawId}`).then((r) => r.data),
    enabled: !!drawId,
  });
}
export function useDrawChecklist(drawId: string | undefined) {
  return useQuery({
    queryKey: ['draw-checklist', drawId],
    queryFn: () => api.get(`/draws/${drawId}/checklist`).then((r) => r.data as Array<{
      type: string; required: boolean; uploaded: number;
    }>),
    enabled: !!drawId,
  });
}
function drawAction(action: string) {
  return ({ id, ...body }: { id: string; comment?: string; reason?: string; fundedAt?: string }) =>
    api.post(`/draws/${id}/${action}`, body).then((r) => r.data);
}
export function useDrawWorkflow() {
  const qc = useQueryClient();
  const inv = (id: string) => {
    qc.invalidateQueries({ queryKey: ['draw', id] });
    qc.invalidateQueries({ queryKey: ['draw-checklist', id] });
    qc.invalidateQueries({ queryKey: ['draws'] });
    qc.invalidateQueries({ queryKey: ['project-health'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return {
    submit:          useMutation({ mutationFn: drawAction('submit'),           onSuccess: (_d, v) => inv(v.id) }),
    approveInternal: useMutation({ mutationFn: drawAction('approve-internal'), onSuccess: (_d, v) => inv(v.id) }),
    submitToLender:  useMutation({ mutationFn: drawAction('submit-to-lender'), onSuccess: (_d, v) => inv(v.id) }),
    markFunded:      useMutation({ mutationFn: drawAction('mark-funded'),      onSuccess: (_d, v) => inv(v.id) }),
    reject:          useMutation({ mutationFn: drawAction('reject'),           onSuccess: (_d, v) => inv(v.id) }),
    returnForInfo:   useMutation({ mutationFn: drawAction('return-for-info'), onSuccess: (_d, v) => inv(v.id) }),
    cancel:          useMutation({ mutationFn: drawAction('cancel'),           onSuccess: (_d, v) => inv(v.id) }),
  };
}
export function useAttachDrawDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ drawId, ...data }: {
      drawId: string;
      documentType: 'LIEN_WAIVER' | 'INSPECTION_REPORT' | 'SWORN_STATEMENT' | 'VENDOR_INVOICE' | 'CHANGE_ORDER' | 'OTHER';
      storagePath: string;
      filename: string;
    }) => api.post(`/draws/${drawId}/documents`, data).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['draw', v.drawId] });
      qc.invalidateQueries({ queryKey: ['draw-checklist', v.drawId] });
    },
  });
}
export function useRemoveDrawDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      api.delete(`/draws/documents/${documentId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['draw'] });
      qc.invalidateQueries({ queryKey: ['draw-checklist'] });
    },
  });
}

export function useRenameDrawDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, filename }: { documentId: string; filename: string }) =>
      api.patch(`/draws/documents/${documentId}`, { filename }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['draw'] });
      qc.invalidateQueries({ queryKey: ['draw-checklist'] });
    },
  });
}

// Actuals (POSTed expenses) — for variance computation
export function useActuals(projectId: string | undefined, buildingId?: string, unitId?: string) {
  const can = useCan('financial:view');
  return useQuery({
    queryKey: ['actuals', projectId, buildingId, unitId],
    queryFn: () => api.get('/actuals', { params: { projectId, buildingId, unitId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

// ─────────── Presigned Supabase upload ───────────
// Two-step upload: (1) get URL from API, (2) PUT file to Supabase directly.
// Returns a thin client wrapper that does both.
/**
 * Upload a file and get its storage path back.
 *
 * Goes THROUGH the API rather than browser → S3 direct. A presigned PUT is cross-origin
 * and needs a CORS rule on the bucket; without one the browser blocks it at preflight and
 * every upload dies as an opaque "Failed to fetch" — which is what was happening to site
 * photos and building images. This route is same-origin, so it works whatever the bucket
 * allows.
 *
 * Name and return shape are unchanged so every existing caller keeps working. Once the
 * bucket has a CORS rule, `presigned-upload` is still there and worth switching back to
 * for genuinely large files.
 */
export function usePresignedUpload() {
  return useMutation({
    mutationFn: async ({ file, projectId, projectName, category }: {
      file: File; projectId?: string; projectName?: string; category?: string;
    }) => {
      const form = new FormData();
      form.append('file', file);
      if (projectId) form.append('projectId', projectId);
      if (projectName) form.append('projectName', projectName);
      if (category) form.append('category', category);
      // Content-Type is deliberately NOT set: the browser has to add the multipart
      // boundary itself, and setting it by hand produces a body the server cannot parse.
      const { data } = await api.post<{ storagePath: string; publicUrl: string; filename: string }>(
        '/documents/upload-file',
        form,
      );
      return { storagePath: data.storagePath, publicUrl: data.publicUrl, filename: data.filename };
    },
  });
}

// ─────────── Exception Feed ───────────
export function useExceptions(projectId?: string) {
  return useQuery({
    queryKey: ['exceptions', projectId ?? 'portfolio'],
    queryFn: () => api.get('/exceptions', { params: projectId ? { projectId } : {} }).then((r) => r.data as Array<{
      id: string;
      severity: 'critical' | 'warning' | 'info';
      category: string;
      title: string;
      detail?: string;
      meta?: string;
      href?: string;
      createdAt?: string;
    }>),
    staleTime: 60_000,
  });
}

// ─────────── Milestone Photos ───────────
export function useMilestonePhotos(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone-photos', milestoneId],
    queryFn: () => api.get(`/milestones/${milestoneId}/photos`).then((r) => r.data),
    enabled: !!milestoneId,
  });
}
export function useAttachMilestonePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ milestoneId, ...body }: { milestoneId: string; storagePath: string; caption?: string }) =>
      api.post(`/milestones/${milestoneId}/photos`, body).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['milestone-photos', v.milestoneId] });
      qc.invalidateQueries({ queryKey: ['milestones'] });
    },
  });
}
export function useDeleteMilestonePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      api.delete(`/milestones/photos/${photoId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestone-photos'] });
      qc.invalidateQueries({ queryKey: ['milestones'] });
    },
  });
}

/**
 * Aggregate draw schedule across every loan on a project — for the milestone
 * "Linked Draw" picker. Returns a flat list of { id, label, loanId } per
 * schedule line.
 */
export function useProjectDrawSchedules(projectId: string | undefined) {
  const can = useCan('loan:view');
  return useQuery({
    queryKey: ['project-draw-schedules', projectId],
    queryFn: async () => {
      // 1. Fetch loans for the project
      const { data: loans } = await api.get('/loans', { params: { projectId } });
      const loanList = (loans as any[]) || [];
      // 2. Fetch each loan's schedule in parallel
      const schedules = await Promise.all(
        loanList.map(async (l: any) => {
          const { data } = await api.get(`/loans/${l.id}/schedule`);
          return ((data as any[]) || []).map((s) => ({
            id: s.id,
            drawNumber: s.drawNumber,
            plannedAmount: Number(s.plannedAmount),
            plannedDate: s.plannedDate,
            loanId: l.id,
            loanLabel: l.lender || l.loanType,
          }));
        }),
      );
      return schedules.flat();
    },
    enabled: can && (!!projectId),
  });
}

// ============================================================================
// Interior / Fit-Out module (Phase 1)
// ============================================================================

export function useInteriorProjects(params?: { unitId?: string; buildingId?: string; status?: string }) {
  const can = useCan('interior:view');
  return useQuery({
    queryKey: ['interior', params],
    queryFn: () => api.get('/interior', { params }).then((r) => r.data),
    enabled: can,
  });
}

export function useInteriorProject(id?: string) {
  return useQuery({
    queryKey: ['interior', 'detail', id],
    queryFn: () => api.get(`/interior/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useInteriorPortfolio() {
  const can = useCan('interior:view');
  return useQuery({
    queryKey: ['interior', 'portfolio'],
    queryFn: () => api.get('/interior/portfolio').then((r) => r.data),
    enabled: can,
  });
}

function invalidateInterior(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['interior'] });
}

export function useCreateInterior() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) => api.post('/interior', data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useUpdateInterior() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.patch(`/interior/${id}`, data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useAdvanceInteriorPhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target, handoverSignedBy, handoverNotes }: { id: string; target: string; handoverSignedBy?: string; handoverNotes?: string }) =>
      api.post(`/interior/${id}/advance`, { target, handoverSignedBy, handoverNotes }).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

// ─────── Interior package templates ───────
export function useInteriorTemplates() {
  const can = useCan('interior:view');
  return useQuery({
    queryKey: ['interior', 'templates'],
    queryFn: () => api.get('/interior/templates').then((r) => r.data),
    enabled: can,
  });
}

export function useCreateInteriorTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) => api.post('/interior/templates', data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useUpdateInteriorTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.patch(`/interior/templates/${id}`, data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useDeleteInteriorTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/interior/templates/${id}`).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useApproveInterior() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'client' | 'city' }) =>
      api.post(`/interior/${id}/approve-${kind}`).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useDeleteInterior() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/interior/${id}`).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useAddInteriorScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.post(`/interior/${id}/scope`, data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useAddInteriorInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.post(`/interior/${id}/invoices`, data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useAddSnag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.post(`/interior/${id}/snags`, data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useResolveSnag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snagId: string) => api.post(`/interior/snags/${snagId}/resolve`).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useUpdateSnag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.patch(`/interior/snags/${id}`, data).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

export function useDeleteInteriorScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, scopeId }: { projectId: string; scopeId: string }) =>
      api.delete(`/interior/${projectId}/scope/${scopeId}`).then((r) => r.data),
    onSuccess: () => invalidateInterior(qc),
  });
}

// ============================================================================
// Sale Payment Schedule (Phase 1)
// ============================================================================

export function useSalePayments(saleId?: string) {
  return useQuery({
    queryKey: ['salePayments', saleId],
    queryFn: () => api.get(`/sales/${saleId}/payments`).then((r) => r.data),
    enabled: !!saleId,
  });
}

export function useReceivables(weeks = 4) {
  const can = useCan('interior:finance');
  return useQuery({
    queryKey: ['receivables', weeks],
    queryFn: () => api.get('/sales/receivables', { params: { weeks } }).then((r) => r.data),
    enabled: can,
  });
}

function invalidatePayments(qc: ReturnType<typeof useQueryClient>, saleId?: string) {
  qc.invalidateQueries({ queryKey: ['salePayments', saleId] });
  qc.invalidateQueries({ queryKey: ['receivables'] });
}

export function useAddSalePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ saleId, data }: { saleId: string; data: Record<string, any> }) =>
      api.post(`/sales/${saleId}/payments`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidatePayments(qc, v.saleId),
  });
}

export function useApplyPaymentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ saleId, template }: { saleId: string; template: string }) =>
      api.post(`/sales/${saleId}/payments/from-template`, { template }).then((r) => r.data),
    onSuccess: (_d, v) => invalidatePayments(qc, v.saleId),
  });
}

export function useUpdateSalePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, saleId: _s }: { id: string; data: Record<string, any>; saleId?: string }) =>
      api.patch(`/sales/payments/${id}`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidatePayments(qc, v.saleId),
  });
}

export function useLogPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, saleId: _s }: { id: string; amount: number; saleId?: string }) =>
      api.post(`/sales/payments/${id}/log`, { amount }).then((r) => r.data),
    onSuccess: (_d, v) => invalidatePayments(qc, v.saleId),
  });
}

export function useDeleteSalePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, saleId: _s }: { id: string; saleId?: string }) =>
      api.delete(`/sales/payments/${id}`).then((r) => r.data),
    onSuccess: (_d, v) => invalidatePayments(qc, v.saleId),
  });
}

// ============================================================================
// Daily Construction Logs (Phase 4)
// ============================================================================

export function useDailyLogs(projectId?: string, buildingId?: string) {
  const can = useCan('dailylog:view');
  return useQuery({
    queryKey: ['daily-logs', projectId, buildingId ?? 'all'],
    queryFn: () => api.get('/daily-logs', { params: { projectId, buildingId } }).then((r) => r.data),
    enabled: can && (!!projectId),
  });
}

function invalidateDailyLogs(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['daily-logs'] });
}

export function useCreateDailyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) => api.post('/daily-logs', data).then((r) => r.data),
    onSuccess: () => invalidateDailyLogs(qc),
  });
}

export function useUpdateDailyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.patch(`/daily-logs/${id}`, data).then((r) => r.data),
    onSuccess: () => invalidateDailyLogs(qc),
  });
}

export function useDeleteDailyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/daily-logs/${id}`).then((r) => r.data),
    onSuccess: () => invalidateDailyLogs(qc),
  });
}

export function useAddDailyLogPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, storagePath, caption }: { id: string; storagePath: string; caption?: string }) =>
      api.post(`/daily-logs/${id}/photos`, { storagePath, caption }).then((r) => r.data),
    onSuccess: () => invalidateDailyLogs(qc),
  });
}

export function useRemoveDailyLogPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => api.delete(`/daily-logs/photos/${photoId}`).then((r) => r.data),
    onSuccess: () => invalidateDailyLogs(qc),
  });
}

// ============================================================================
// Brokers / referral tracking (Phase 4)
// ============================================================================

export function useBrokers(includeInactive = false) {
  const can = useCan('broker:view');
  return useQuery({
    queryKey: ['brokers', includeInactive],
    queryFn: () => api.get('/brokers', { params: { includeInactive } }).then((r) => r.data),
    enabled: can,
  });
}

export function useBrokerReport() {
  const can = useCan('broker:view');
  return useQuery({
    queryKey: ['brokers', 'report'],
    queryFn: () => api.get('/brokers/report').then((r) => r.data),
    enabled: can,
  });
}

function invalidateBrokers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['brokers'] });
}

export function useCreateBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) => api.post('/brokers', data).then((r) => r.data),
    onSuccess: () => invalidateBrokers(qc),
  });
}

export function useUpdateBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.patch(`/brokers/${id}`, data).then((r) => r.data),
    onSuccess: () => invalidateBrokers(qc),
  });
}

export function useDeleteBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/brokers/${id}`).then((r) => r.data),
    onSuccess: () => invalidateBrokers(qc),
  });
}

export function useBrokerSales(brokerId?: string) {
  return useQuery({
    queryKey: ['brokers', 'sales', brokerId],
    queryFn: () => api.get(`/brokers/${brokerId}/sales`).then((r) => r.data),
    enabled: !!brokerId,
  });
}

export function useMarkBrokerCommissionPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) =>
      api.patch(`/brokers/sales/${saleId}/mark-commission-paid`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brokers'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
  });
}

// ============================================================================
// Multi-unit interest / per-unit waitlist (Phase 4)
// ============================================================================

export function useUnitWaitlist(unitId?: string) {
  const can = useCan('lead:view');
  return useQuery({
    queryKey: ['unit-waitlist', unitId],
    queryFn: () => api.get('/leads/waitlist', { params: { unitId } }).then((r) => r.data),
    enabled: can && (!!unitId),
  });
}

function invalidateInterest(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['unit-waitlist'] });
  qc.invalidateQueries({ queryKey: ['leads'] });
  qc.invalidateQueries({ queryKey: ['lead'] });
}

export function useAddLeadInterest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, unitId, note }: { leadId: string; unitId: string; note?: string }) =>
      api.post(`/leads/${leadId}/interests`, { unitId, note }).then((r) => r.data),
    onSuccess: () => invalidateInterest(qc),
  });
}

export function useRemoveLeadInterest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (interestId: string) => api.delete(`/leads/interests/${interestId}`).then((r) => r.data),
    onSuccess: () => invalidateInterest(qc),
  });
}

// ============================================================================
// Real-time notifications via Socket.io (falls back to staleTime polling)
// ============================================================================

export function useNotificationsSocket() {
  const qc = useQueryClient();
  const token = useAuthStore.getState().accessToken;

  useEffect(() => {
    if (!token) return;
    let socket: any;
    import('socket.io-client').then(({ io }) => {
      socket = io('/notifications', {
        path: '/socket.io',
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
      });
      socket.on('notification', () => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
      });
    });
    return () => { socket?.disconnect(); };
  }, [token, qc]);
}

// ============================================================================
// Custom Options (admin-configurable dropdown values)
// ============================================================================

export function useCustomOptions(category: string) {
  return useQuery({
    queryKey: ['custom-options', category],
    queryFn: () => api.get('/custom-options', { params: { category } }).then((r) => r.data as CustomOption[]),
    staleTime: 5 * 60 * 1000, // cache for 5 min — changes infrequently
    enabled: !!category,
  });
}

export function useCustomOptionsCategories() {
  return useQuery({
    queryKey: ['custom-options-categories'],
    queryFn: () => api.get('/custom-options/categories').then((r) => r.data as string[]),
  });
}

export function useCreateCustomOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { category: string; value: string; label: string; color?: string; sortOrder?: number }) =>
      api.post('/custom-options', data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['custom-options', vars.category] });
      qc.invalidateQueries({ queryKey: ['custom-options-categories'] });
    },
  });
}

export function useUpdateCustomOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; label?: string; color?: string; sortOrder?: number }) =>
      api.patch(`/custom-options/${id}`, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-options'] }),
  });
}

export function useDeleteCustomOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/custom-options/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-options'] }),
  });
}

export interface CustomOption {
  id: string;
  category: string;
  value: string;
  label: string;
  color?: string | null;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
}

// ============================================================================
// Lease rent timeline (escalation periods)
// ============================================================================
// Money comes back from the API as strings (Prisma Decimal serializes to string).
// These hooks pass the payload through untouched — format in the component.

export function useLeaseRentPeriods(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-rent-periods', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/rent-periods`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

export function useLeaseRentSummary(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-rent-summary', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/rent-summary`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

// Rewriting the rent timeline changes this lease's periods/summary *and* every
// aggregate that reads lease rent. Those live under ['leases', projectId],
// ['rent-roll', projectId] and ['lease-income', projectId] — invalidating the
// prefix covers whichever project this lease belongs to (same broad-prefix
// approach as useCreateLease/useUpdateLease above).
function invalidateRentPeriods(qc: ReturnType<typeof useQueryClient>, leaseId?: string) {
  if (leaseId) {
    qc.invalidateQueries({ queryKey: ['lease-rent-periods', leaseId] });
    qc.invalidateQueries({ queryKey: ['lease-rent-summary', leaseId] });
  } else {
    qc.invalidateQueries({ queryKey: ['lease-rent-periods'] });
    qc.invalidateQueries({ queryKey: ['lease-rent-summary'] });
  }
  qc.invalidateQueries({ queryKey: ['leases'] });
  qc.invalidateQueries({ queryKey: ['rent-roll'] });
  qc.invalidateQueries({ queryKey: ['lease-income'] });
}

/** Build the full escalation schedule for a lease from its terms. */
export function useGenerateRentPeriods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leaseId, data }: { leaseId: string; data?: Record<string, any> }) =>
      api.post(`/leases/${leaseId}/rent-periods/generate`, data ?? {}).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentPeriods(qc, v.leaseId),
  });
}

/** Re-cut only the not-yet-started periods, leaving billed history intact. */
export function useRegenerateFutureRentPeriods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leaseId, data }: { leaseId: string; data?: Record<string, any> }) =>
      api.post(`/leases/${leaseId}/rent-periods/regenerate-future`, data ?? {}).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentPeriods(qc, v.leaseId),
  });
}

/** Insert a one-off period (negotiated step, abatement, holdover…). */
export function useAddManualRentPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leaseId, data }: { leaseId: string; data: Record<string, any> }) =>
      api.post(`/leases/${leaseId}/rent-periods/manual`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentPeriods(qc, v.leaseId),
  });
}

/**
 * R22 — correct a rent period that has already been billed.
 *
 * Invalidates the invoice queries too, not only the schedule: a correction flags the
 * months that were billed from the old figure, and a ledger still showing them clean is
 * the exact thing the flag exists to prevent.
 */
export function useCorrectRentPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId, data }: { periodId: string; data: Record<string, any> }) =>
      api.patch(`/leases/rent-periods/${periodId}/correct`, data).then((r) => r.data),
    onSuccess: (_d, _v) => {
      invalidateRentPeriods(qc);
      qc.invalidateQueries({ queryKey: ['lease-rent-invoices'] });
      qc.invalidateQueries({ queryKey: ['lease-rent-invoice-summary'] });
      qc.invalidateQueries({ queryKey: ['lease-rent-corrections'] });
      qc.invalidateQueries({ queryKey: ['unit-history'] });
    },
  });
}

/** The provenance trail — every correction on a lease, newest first. */
export function useLeaseRentCorrections(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-rent-corrections', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/rent-corrections`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

/** Acknowledge a flagged invoice. Records that somebody looked; changes no money. */
export function useClearInvoiceReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) =>
      api.post(`/leases/rent-invoices/${invoiceId}/clear-review`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lease-rent-invoices'] });
      qc.invalidateQueries({ queryKey: ['lease-rent-invoice-summary'] });
    },
  });
}

// ============================================================================
// Lease obligations (security deposits + TI allowances)
// ============================================================================

export function useLeaseObligations(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-obligations', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/obligations`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

export function useUnitObligationSummary(unitId?: string) {
  return useQuery({
    queryKey: ['obligation-summary', 'unit', unitId],
    queryFn: () => api.get(`/leases/obligation-summary/unit/${unitId}`).then((r) => r.data),
    enabled: !!unitId,
  });
}

export function useBuildingObligationSummary(buildingId?: string) {
  return useQuery({
    queryKey: ['obligation-summary', 'building', buildingId],
    queryFn: () => api.get(`/leases/obligation-summary/building/${buildingId}`).then((r) => r.data),
    enabled: !!buildingId,
  });
}

/**
 * Obligation writes are addressed by obligation/payment id, so the mutation
 * can't derive which rollups moved. Callers pass the ids they already have
 * (same trick as useDeleteComment's `{ id, source }` and useDeleteSalePayment's
 * `{ id, saleId }`): leaseId for the list, plus unitId/buildingId for the
 * rollups. A unit-level obligation rolls into its building too, so unless both
 * legs are known we sweep the whole ['obligation-summary', …] prefix rather
 * than leave one side stale.
 */
type ObligationScope = { leaseId?: string; unitId?: string; buildingId?: string };

function invalidateObligations(qc: ReturnType<typeof useQueryClient>, v: ObligationScope) {
  qc.invalidateQueries({ queryKey: v.leaseId ? ['lease-obligations', v.leaseId] : ['lease-obligations'] });
  if (v.unitId && v.buildingId) {
    qc.invalidateQueries({ queryKey: ['obligation-summary', 'unit', v.unitId] });
    qc.invalidateQueries({ queryKey: ['obligation-summary', 'building', v.buildingId] });
  } else {
    qc.invalidateQueries({ queryKey: ['obligation-summary'] });
  }
}

export function useCreateLeaseObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leaseId, data }: ObligationScope & { leaseId: string; data: Record<string, any> }) =>
      api.post(`/leases/${leaseId}/obligations`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidateObligations(qc, v),
  });
}

export function useUpdateLeaseObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ obligationId, data }: ObligationScope & { obligationId: string; data: Record<string, any> }) =>
      api.put(`/leases/obligations/${obligationId}`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidateObligations(qc, v),
  });
}

export function useDeleteLeaseObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ obligationId }: ObligationScope & { obligationId: string }) =>
      api.delete(`/leases/obligations/${obligationId}`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateObligations(qc, v),
  });
}

/** Forgive the outstanding balance (e.g. deposit waived at signing). */
export function useWaiveLeaseObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ obligationId, data }: ObligationScope & { obligationId: string; data?: Record<string, any> }) =>
      api.post(`/leases/obligations/${obligationId}/waive`, data ?? {}).then((r) => r.data),
    onSuccess: (_d, v) => invalidateObligations(qc, v),
  });
}

export function useRecordObligationPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ obligationId, data }: ObligationScope & { obligationId: string; data: Record<string, any> }) =>
      api.post(`/leases/obligations/${obligationId}/payments`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidateObligations(qc, v),
  });
}

export function useDeleteObligationPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId }: ObligationScope & { paymentId: string }) =>
      api.delete(`/leases/obligation-payments/${paymentId}`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateObligations(qc, v),
  });
}

// ============================================================================
// Rent invoices (monthly rent billing + collection)
// ============================================================================
// Money is passed through untouched — the API serialises Prisma Decimal to
// strings, so amounts stay strings all the way to the formatter.

export function useLeaseRentInvoices(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-rent-invoices', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/rent-invoices`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

/** Every invoice across all leases on a unit — the unit's collection history. */
export function useUnitRentInvoices(unitId?: string) {
  return useQuery({
    queryKey: ['rent-invoices', 'unit', unitId],
    queryFn: () => api.get(`/leases/rent-invoices/unit/${unitId}`).then((r) => r.data),
    enabled: !!unitId,
  });
}

/** { billed, collected, outstanding, overdueCount } — money fields are strings. */
export function useLeaseRentInvoiceSummary(leaseId?: string) {
  return useQuery({
    queryKey: ['lease-rent-invoice-summary', leaseId],
    queryFn: () => api.get(`/leases/${leaseId}/rent-invoice-summary`).then((r) => r.data),
    enabled: !!leaseId,
  });
}

/**
 * Payment writes are addressed by invoice id, so the mutation can't derive which
 * views moved. Callers pass the ids they already hold (same approach as
 * ObligationScope above): leaseId for the lease's list + summary, unitId for the
 * cross-lease unit view. Touching one invoice moves all three, so they are always
 * invalidated together; a missing leg falls back to sweeping that prefix rather
 * than leaving it stale.
 */
type RentInvoiceScope = { leaseId?: string; unitId?: string };

function invalidateRentInvoices(qc: ReturnType<typeof useQueryClient>, v: RentInvoiceScope) {
  qc.invalidateQueries({ queryKey: v.leaseId ? ['lease-rent-invoices', v.leaseId] : ['lease-rent-invoices'] });
  qc.invalidateQueries({
    queryKey: v.leaseId ? ['lease-rent-invoice-summary', v.leaseId] : ['lease-rent-invoice-summary'],
  });
  qc.invalidateQueries({ queryKey: v.unitId ? ['rent-invoices', 'unit', v.unitId] : ['rent-invoices'] });
}

/** Backfill/generate invoices for a lease from its rent timeline. */
export function useGenerateRentInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leaseId, data }: RentInvoiceScope & { leaseId: string; data?: Record<string, any> }) =>
      api.post(`/leases/${leaseId}/rent-invoices/generate`, data ?? {}).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentInvoices(qc, v),
  });
}

/** Record (or correct) a payment against one invoice: { amountPaid, paidAt?, method?, reference?, notes? }. */
export function useRecordRentPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, data }: RentInvoiceScope & { invoiceId: string; data: Record<string, any> }) =>
      api.patch(`/leases/rent-invoices/${invoiceId}/payment`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentInvoices(qc, v),
  });
}

/** Clear a mis-keyed payment, returning the invoice to unpaid. */
export function useClearRentPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId }: RentInvoiceScope & { invoiceId: string }) =>
      api.delete(`/leases/rent-invoices/${invoiceId}/payment`).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentInvoices(qc, v),
  });
}

/** Forgive an invoice (abatement, goodwill credit…) — requires a reason. */
export function useWaiveRentInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, data }: RentInvoiceScope & { invoiceId: string; data: { reason: string } }) =>
      api.post(`/leases/rent-invoices/${invoiceId}/waive`, data).then((r) => r.data),
    onSuccess: (_d, v) => invalidateRentInvoices(qc, v),
  });
}

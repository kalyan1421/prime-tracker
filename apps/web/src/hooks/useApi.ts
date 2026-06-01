import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

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
    mutationFn: ({ projectId, data }: { projectId: string; data: { userId: string; role?: string } }) =>
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

// ---- Financial Summary ----
export function useFinancialSummary(projectId: string) {
  return useQuery({
    queryKey: ['financials', projectId],
    queryFn: () => api.get('/budgets/summary', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

// ---- Budget Lines ----
export function useBudgetLines(projectId: string) {
  return useQuery({
    queryKey: ['budgets', projectId],
    queryFn: () => api.get('/budgets', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => api.get('/milestones', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
export function useUnits(projectId: string) {
  return useQuery({
    queryKey: ['units', projectId],
    queryFn: () => api.get('/units', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
  return useQuery({
    queryKey: ['lease-income', projectId],
    queryFn: () => api.get('/units/lease-income', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

// ---- Leases ----
export function useLeases(projectId: string) {
  return useQuery({
    queryKey: ['leases', projectId],
    queryFn: () => api.get('/leases', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useRentRoll(projectId: string) {
  return useQuery({
    queryKey: ['rent-roll', projectId],
    queryFn: () => api.get('/leases/rent-roll', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useCreateLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/leases', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leases'] });
      qc.invalidateQueries({ queryKey: ['rent-roll'] });
    },
  });
}

export function useUpdateLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/leases/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leases'] });
      qc.invalidateQueries({ queryKey: ['rent-roll'] });
    },
  });
}

export function useDeleteLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/leases/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leases'] });
      qc.invalidateQueries({ queryKey: ['rent-roll'] });
    },
  });
}

// ---- Sales ----
export function useSalesPipeline(projectId: string) {
  return useQuery({
    queryKey: ['sales', projectId],
    queryFn: () => api.get('/sales/pipeline', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
export function useLoans(projectId: string) {
  return useQuery({
    queryKey: ['loans', projectId],
    queryFn: () => api.get('/loans', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useMonthlyPayments(projectId: string) {
  return useQuery({
    queryKey: ['monthly-payments', projectId],
    queryFn: () => api.get('/loans/monthly-payments', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

// ---- Commitments ----
export function useCommitments(projectId: string) {
  return useQuery({
    queryKey: ['commitments', projectId],
    queryFn: () => api.get('/commitments', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
  return useQuery({
    queryKey: ['kpi', projectId],
    queryFn: () => api.get('/kpi/history', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

// ---- Users (Admin) ----
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
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

export function useToggleUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}/status`, { isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ---- Audit ----
export function useAuditLog(params?: { action?: string; entity?: string; limit?: number }) {
  return useQuery({
    queryKey: ['audit', params],
    queryFn: () => api.get('/audit', { params }).then((r) => r.data),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buildings'] }),
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
    mutationFn: ({ id, data }: { id: string; data: { name?: string; email?: string } }) =>
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

// ---- Roles ----
export function useRoleCounts() {
  return useQuery({
    queryKey: ['roles', 'counts'],
    queryFn: () => api.get('/users/roles').then((r) => r.data),
  });
}

export function useRoleDefinitions() {
  return useQuery({
    queryKey: ['roles', 'definitions'],
    queryFn: () => api.get('/users/roles/definitions').then((r) => r.data),
  });
}

// ---- Reports ----
export function usePortfolioReport() {
  return useQuery({
    queryKey: ['report-portfolio'],
    queryFn: () => api.get('/reports/portfolio').then((r) => r.data),
  });
}

export function useSalesReport() {
  return useQuery({
    queryKey: ['report-sales'],
    queryFn: () => api.get('/reports/sales-summary').then((r) => r.data),
  });
}

export function useRevenueReport() {
  return useQuery({
    queryKey: ['report-revenue'],
    queryFn: () => api.get('/reports/revenue').then((r) => r.data),
  });
}

export function useDebtReport() {
  return useQuery({
    queryKey: ['report-debt'],
    queryFn: () => api.get('/reports/debt').then((r) => r.data),
  });
}

export function useUnitSalesReport() {
  return useQuery({
    queryKey: ['report-unit-sales'],
    queryFn: () => api.get('/reports/unit-sales').then((r) => r.data),
  });
}

export function useVacancyReport(params?: { projectId?: string; minDays?: number }) {
  return useQuery({
    queryKey: ['report-vacancy', params],
    queryFn: () => api.get('/reports/vacancy', { params }).then((r) => r.data),
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
    refetchInterval: 30000, // poll every 30s
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

export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, enabled }: { type: string; enabled: boolean }) =>
      api.put('/notifications/preferences', { type, enabled }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });
}

// ---- Leads ----
export function useLeadDashboard(params?: { projectId?: string }) {
  return useQuery({
    queryKey: ['leads', 'dashboard', params],
    queryFn: () => api.get('/leads/dashboard', { params }).then((r) => r.data),
  });
}

export function useLeads(params?: { projectId?: string; status?: string; source?: string; unitId?: string; assignedTo?: string; search?: string }) {
  return useQuery({
    queryKey: ['leads', params],
    queryFn: () => api.get('/leads', { params }).then((r) => r.data),
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
  return useQuery({
    queryKey: ['campaigns', params],
    queryFn: () => api.get('/campaigns', { params }).then((r) => r.data),
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
  return useQuery({
    queryKey: ['campaigns', 'performance', params],
    queryFn: () => api.get('/campaigns/performance', { params }).then((r) => r.data),
  });
}

export function useCampaignSpendTrend(params?: { projectId?: string; monthsBack?: number }) {
  return useQuery({
    queryKey: ['campaigns', 'spend-trend', params],
    queryFn: () => api.get('/campaigns/spend-trend', { params }).then((r) => r.data),
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
  return useQuery({
    queryKey: ['dashboard', 'founder'],
    queryFn: () => api.get('/dashboard/founder').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useFinanceDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'finance'],
    queryFn: () => api.get('/dashboard/finance').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useConstructionDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'construction'],
    queryFn: () => api.get('/dashboard/construction').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSalesDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'sales'],
    queryFn: () => api.get('/dashboard/sales').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

// ---- QuickBooks ----
export function useQBStatus() {
  return useQuery({
    queryKey: ['qb-status'],
    queryFn: () => api.get('/quickbooks/status').then((r) => r.data),
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
  return useQuery({
    queryKey: ['cashflow', projectId],
    queryFn: () => api.get('/cashflow', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useCashFlowForecast(projectId: string) {
  return useQuery({
    queryKey: ['cashflow-forecast', projectId],
    queryFn: () => api.get('/cashflow/forecast', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
  return useQuery({
    queryKey: ['draws', projectId],
    queryFn: () => api.get('/loans/draws', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useCreateDraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, ...data }: { loanId: string; projectId: string;[k: string]: unknown }) =>
      api.post(`/loans/${loanId}/draws`, data).then((r) => r.data),
    onSuccess: (_r, v: any) => qc.invalidateQueries({ queryKey: ['draws', v.projectId] }),
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
  return useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get('/vendors').then((r) => r.data),
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
  return useQuery({
    queryKey: ['contracts', projectId],
    queryFn: () => api.get('/contracts', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useContractSummary(projectId: string) {
  return useQuery({
    queryKey: ['contracts-summary', projectId],
    queryFn: () => api.get('/contracts/summary', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
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
export function useDocuments(params: { projectId?: string; unitId?: string; buildingId?: string }) {
  return useQuery({
    queryKey: ['documents', params],
    queryFn: () => api.get('/documents', { params }).then((r) => r.data),
    enabled: !!(params.projectId || params.unitId),
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

// ---- Investors ----
export function useInvestors() {
  return useQuery({
    queryKey: ['investors'],
    queryFn: () => api.get('/investors').then((r) => r.data),
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
  return useQuery({
    queryKey: ['investor-summary'],
    queryFn: () => api.get('/investors/summary').then((r) => r.data),
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
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get('/organizations').then((r) => r.data),
  });
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['organizations', id],
    queryFn: () => api.get(`/organizations/${id}`).then((r) => r.data),
    enabled: !!id,
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
  return useQuery({
    queryKey: ['sales-forecast', projectId],
    queryFn: () => api.get('/sales/forecast', { params: { projectId } }).then((r) => r.data as {
      totalPipelineValue: number;
      weightedForecast: number;
      byStage: Array<{ stage: string; count: number; value: number; weighted: number; probability: number }>;
      closedYtd: number;
    }),
    enabled: !!projectId,
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

// Actuals (POSTed expenses) — for variance computation
export function useActuals(projectId: string | undefined) {
  return useQuery({
    queryKey: ['actuals', projectId],
    queryFn: () => api.get('/actuals', { params: { projectId } }).then((r) => r.data),
    enabled: !!projectId,
  });
}

// ─────────── Presigned Supabase upload ───────────
// Two-step upload: (1) get URL from API, (2) PUT file to Supabase directly.
// Returns a thin client wrapper that does both.
export function usePresignedUpload() {
  return useMutation({
    mutationFn: async ({ file, projectId, projectName, category }: {
      file: File; projectId?: string; projectName?: string; category?: string;
    }) => {
      const { data } = await api.post<{ uploadUrl: string; storagePath: string; token: string }>(
        '/documents/presigned-upload',
        { filename: file.name, projectId, projectName, category },
      );
      // Upload directly to Supabase Storage. The token is passed via header.
      const res = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return { storagePath: data.storagePath, filename: file.name };
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
    enabled: !!projectId,
  });
}

// ============================================================================
// Interior / Fit-Out module (Phase 1)
// ============================================================================

export function useInteriorProjects(params?: { unitId?: string; buildingId?: string; status?: string }) {
  return useQuery({
    queryKey: ['interior', params],
    queryFn: () => api.get('/interior', { params }).then((r) => r.data),
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
  return useQuery({
    queryKey: ['interior', 'portfolio'],
    queryFn: () => api.get('/interior/portfolio').then((r) => r.data),
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
    mutationFn: ({ id, target }: { id: string; target: string }) =>
      api.post(`/interior/${id}/advance`, { target }).then((r) => r.data),
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
  return useQuery({
    queryKey: ['receivables', weeks],
    queryFn: () => api.get('/sales/receivables', { params: { weeks } }).then((r) => r.data),
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
  return useQuery({
    queryKey: ['daily-logs', projectId, buildingId ?? 'all'],
    queryFn: () => api.get('/daily-logs', { params: { projectId, buildingId } }).then((r) => r.data),
    enabled: !!projectId,
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
  return useQuery({
    queryKey: ['brokers', includeInactive],
    queryFn: () => api.get('/brokers', { params: { includeInactive } }).then((r) => r.data),
  });
}

export function useBrokerReport() {
  return useQuery({
    queryKey: ['brokers', 'report'],
    queryFn: () => api.get('/brokers/report').then((r) => r.data),
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

// ============================================================================
// Multi-unit interest / per-unit waitlist (Phase 4)
// ============================================================================

export function useUnitWaitlist(unitId?: string) {
  return useQuery({
    queryKey: ['unit-waitlist', unitId],
    queryFn: () => api.get('/leads/waitlist', { params: { unitId } }).then((r) => r.data),
    enabled: !!unitId,
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

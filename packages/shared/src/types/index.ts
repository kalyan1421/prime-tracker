// =============================================
// Domain Types — Shared across API & Web
// =============================================

// ---- Enums ----

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FOUNDER = 'FOUNDER',
  EXECUTIVE = 'EXECUTIVE',
  FINANCE = 'FINANCE',
  ACCOUNTING = 'ACCOUNTING',
  AR_AP = 'AR_AP',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  CONSTRUCTION = 'CONSTRUCTION',
  SALES = 'SALES',
  MARKETING = 'MARKETING',
  LEGAL = 'LEGAL',
  VIEWER = 'VIEWER',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ProjectPhase {
  PRE_DEVELOPMENT = 'PRE_DEVELOPMENT',
  PERMITTING = 'PERMITTING',
  CONSTRUCTION = 'CONSTRUCTION',
  LEASE_UP = 'LEASE_UP',
  STABILIZED = 'STABILIZED',
  SOLD_REFI = 'SOLD_REFI',
}

export enum UnitType {
  RETAIL = 'RETAIL',
  MEDICAL = 'MEDICAL',
  FLEX = 'FLEX',
  RESIDENTIAL_LOT = 'RESIDENTIAL_LOT',
  OFFICE = 'OFFICE',
  RESTAURANT = 'RESTAURANT',
  EVENT_CENTER = 'EVENT_CENTER',
}

export enum UnitStatus {
  AVAILABLE = 'AVAILABLE',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  LEASED = 'LEASED',
  SOLD = 'SOLD',
  OCCUPIED = 'OCCUPIED',
  UNDER_CONSTRUCTION = 'UNDER_CONSTRUCTION',
}

export enum MilestoneStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
  BLOCKED = 'BLOCKED',
}

export enum BudgetCategory {
  LAND_ACQUISITION = 'LAND_ACQUISITION',
  SITE_WORK = 'SITE_WORK',
  HARD_COSTS = 'HARD_COSTS',
  SOFT_COSTS = 'SOFT_COSTS',
  FINANCING = 'FINANCING',
  PERMITS_FEES = 'PERMITS_FEES',
  CONTINGENCY = 'CONTINGENCY',
  MARKETING = 'MARKETING',
  LEGAL = 'LEGAL',
  OTHER = 'OTHER',
}

export enum LoanType {
  CONSTRUCTION = 'CONSTRUCTION',
  PERMANENT = 'PERMANENT',
  BRIDGE = 'BRIDGE',
  MEZZANINE = 'MEZZANINE',
  SBA = 'SBA',
}

export enum LeaseStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  TERMINATED = 'TERMINATED',
}

export enum SaleStatus {
  PROSPECT = 'PROSPECT',
  LOI_SIGNED = 'LOI_SIGNED',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum QBSyncStatus {
  PENDING = 'PENDING',
  SYNCED = 'SYNCED',
  ERROR = 'ERROR',
  UNMAPPED = 'UNMAPPED',
}

export enum OrgRole {
  LEAD = 'LEAD',
  EMPLOYEE = 'EMPLOYEE',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  MFA_VERIFY = 'MFA_VERIFY',
  EXPORT = 'EXPORT',
  QB_SYNC = 'QB_SYNC',
  ROLE_CHANGE = 'ROLE_CHANGE',
}

// ---- Permission Keys ----

export const PERMISSIONS = {
  // Projects
  PROJECT_VIEW: 'project:view',
  PROJECT_CREATE: 'project:create',
  PROJECT_EDIT: 'project:edit',
  PROJECT_DELETE: 'project:delete',

  // Financial
  FINANCIAL_VIEW: 'financial:view',
  FINANCIAL_EDIT: 'financial:edit',
  FINANCIAL_EXPORT: 'financial:export',
  LOAN_VIEW: 'loan:view',
  LOAN_EDIT: 'loan:edit',

  // Budget & Actuals
  BUDGET_VIEW: 'budget:view',
  BUDGET_EDIT: 'budget:edit',
  ACTUAL_VIEW: 'actual:view',
  ACTUAL_EDIT: 'actual:edit',

  // Sales & Leasing
  SALES_VIEW: 'sales:view',
  SALES_EDIT: 'sales:edit',
  LEASE_VIEW: 'lease:view',
  LEASE_EDIT: 'lease:edit',

  // Leads
  LEAD_VIEW: 'lead:view',
  LEAD_CREATE: 'lead:create',
  LEAD_EDIT: 'lead:edit',
  LEAD_DELETE: 'lead:delete',
  LEAD_CONVERT: 'lead:convert',

  // Campaigns (Sprint 2 — marketing-spend attribution)
  CAMPAIGN_VIEW: 'campaign:view',
  CAMPAIGN_CREATE: 'campaign:create',
  CAMPAIGN_EDIT: 'campaign:edit',
  CAMPAIGN_SPEND: 'campaign:spend',      // record CampaignSpend ledger entries
  CAMPAIGN_DELETE: 'campaign:delete',

  // Buildings & Units
  BUILDING_VIEW: 'building:view',
  BUILDING_EDIT: 'building:edit',
  UNIT_VIEW: 'unit:view',
  UNIT_EDIT: 'unit:edit',

  // Milestones
  MILESTONE_VIEW: 'milestone:view',
  MILESTONE_EDIT: 'milestone:edit',

  // Draw Requests
  DRAW_VIEW: 'draw:view',
  DRAW_EDIT: 'draw:edit',
  DRAW_APPROVE: 'draw:approve',

  // Vendors & Contracts
  VENDOR_VIEW: 'vendor:view',
  VENDOR_EDIT: 'vendor:edit',
  CONTRACT_VIEW: 'contract:view',
  CONTRACT_EDIT: 'contract:edit',
  PAYMENT_APPROVE: 'payment:approve',

  // Interior / Fit-Out + Sale Payment Schedule
  INTERIOR_VIEW: 'interior:view',
  INTERIOR_EDIT: 'interior:edit',
  INTERIOR_APPROVE: 'interior:approve',     // client/city approval gate (Founder/Exec authority)
  INTERIOR_FINANCE: 'interior:finance',     // log sub-contractor invoices
  PAYMENT_LOG: 'payment:log',               // record a (partial) sale-installment payment
  SALE_DISCOUNT_APPROVE: 'sales:approve-discount', // Founder/Co-Founder sign-off on over-threshold discounts

  // Daily construction logs
  DAILYLOG_VIEW: 'dailylog:view',
  DAILYLOG_EDIT: 'dailylog:edit',

  // Brokers / referral tracking (internal-only)
  BROKER_VIEW: 'broker:view',
  BROKER_EDIT: 'broker:edit',

  // Documents
  DOCUMENT_VIEW: 'document:view',
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_DELETE: 'document:delete',

  // Comments
  COMMENT_VIEW: 'comment:view',
  COMMENT_EDIT: 'comment:edit',

  // Investors
  INVESTOR_VIEW: 'investor:view',
  INVESTOR_MANAGE: 'investor:manage',

  // Reports
  REPORT_PORTFOLIO: 'report:portfolio',
  REPORT_SALES: 'report:sales',
  REPORT_REVENUE: 'report:revenue',
  REPORT_DEBT: 'report:debt',

  // Admin
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  AUDIT_VIEW: 'audit:view',
  QB_MANAGE: 'quickbooks:manage',
  SYSTEM_CONFIG: 'system:config',

  // Organizations
  ORG_MANAGE: 'org:manage',

  // Custom Options (admin-configurable dropdown values)
  SETTINGS_MANAGE: 'settings:manage',
} as const;

// ---- Role → Permission Mapping ----

// All permissions except system:config
const FOUNDER_PERMISSIONS = Object.values(PERMISSIONS).filter(
  (p) => p !== PERMISSIONS.SYSTEM_CONFIG,
);

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [UserRole.FOUNDER]: FOUNDER_PERMISSIONS,
  [UserRole.EXECUTIVE]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.FINANCIAL_VIEW,
    PERMISSIONS.FINANCIAL_EDIT,
    PERMISSIONS.FINANCIAL_EXPORT,
    PERMISSIONS.LOAN_VIEW,
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.ACTUAL_VIEW,
    PERMISSIONS.DRAW_VIEW,
    PERMISSIONS.DRAW_APPROVE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.LEAD_VIEW,
    PERMISSIONS.CAMPAIGN_VIEW,
    PERMISSIONS.MILESTONE_VIEW,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.PAYMENT_APPROVE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.INVESTOR_VIEW,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.REPORT_PORTFOLIO,
    PERMISSIONS.REPORT_SALES,
    PERMISSIONS.REPORT_REVENUE,
    PERMISSIONS.REPORT_DEBT,
    PERMISSIONS.INTERIOR_VIEW,
    PERMISSIONS.INTERIOR_APPROVE,
    PERMISSIONS.SALE_DISCOUNT_APPROVE,
    PERMISSIONS.DAILYLOG_VIEW,
    PERMISSIONS.BROKER_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
  ],
  [UserRole.FINANCE]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.FINANCIAL_VIEW,
    PERMISSIONS.FINANCIAL_EDIT,
    PERMISSIONS.FINANCIAL_EXPORT,
    PERMISSIONS.LOAN_VIEW,
    PERMISSIONS.LOAN_EDIT,
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.BUDGET_EDIT,
    PERMISSIONS.ACTUAL_VIEW,
    PERMISSIONS.ACTUAL_EDIT,
    PERMISSIONS.DRAW_VIEW,
    PERMISSIONS.DRAW_EDIT,
    PERMISSIONS.DRAW_APPROVE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.MILESTONE_VIEW,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.VENDOR_EDIT,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.PAYMENT_APPROVE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.INVESTOR_VIEW,
    PERMISSIONS.INVESTOR_MANAGE,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.QB_MANAGE,
    PERMISSIONS.REPORT_PORTFOLIO,
    PERMISSIONS.REPORT_REVENUE,
    PERMISSIONS.REPORT_DEBT,
    PERMISSIONS.INTERIOR_VIEW,
    PERMISSIONS.INTERIOR_FINANCE,
    PERMISSIONS.PAYMENT_LOG,
    PERMISSIONS.DAILYLOG_VIEW,
    PERMISSIONS.BROKER_VIEW,
  ],
  [UserRole.ACCOUNTING]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.FINANCIAL_VIEW,
    PERMISSIONS.FINANCIAL_EDIT,
    PERMISSIONS.FINANCIAL_EXPORT,
    PERMISSIONS.LOAN_VIEW,
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.BUDGET_EDIT,
    PERMISSIONS.ACTUAL_VIEW,
    PERMISSIONS.ACTUAL_EDIT,
    PERMISSIONS.DRAW_VIEW,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.QB_MANAGE,
    PERMISSIONS.REPORT_PORTFOLIO,
    PERMISSIONS.INTERIOR_VIEW,
    PERMISSIONS.INTERIOR_FINANCE,
    PERMISSIONS.PAYMENT_LOG,
    PERMISSIONS.DAILYLOG_VIEW,
  ],
  [UserRole.AR_AP]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.FINANCIAL_VIEW,
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.ACTUAL_VIEW,
    PERMISSIONS.ACTUAL_EDIT,
    PERMISSIONS.DRAW_VIEW,
    PERMISSIONS.DRAW_EDIT,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.PAYMENT_APPROVE,
    PERMISSIONS.DOCUMENT_VIEW,
    // AR/AP manages draw requests (draw:edit above) and needs to attach the lender's
    // required supporting docs (lien waivers, invoices) — draw:edit alone let them see
    // the upload control but every upload 403'd since it hits document:upload separately.
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.INTERIOR_VIEW,
    PERMISSIONS.INTERIOR_FINANCE,
    PERMISSIONS.PAYMENT_LOG,
  ],
  [UserRole.PROJECT_MANAGER]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.PROJECT_CREATE,
    PERMISSIONS.PROJECT_EDIT,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.BUILDING_EDIT,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT,
    // financial:view (actuals, cashflow, commitments, financial reports) is Finance-only.
    // PM keeps budget:view — needs the project budget to run the job — but not the
    // detailed financial module. See discovery: "financial data = Accounting + Finance".
    PERMISSIONS.BUDGET_VIEW,
    PERMISSIONS.ACTUAL_VIEW,
    PERMISSIONS.DRAW_VIEW,
    PERMISSIONS.DRAW_EDIT,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.MILESTONE_VIEW,
    PERMISSIONS.MILESTONE_EDIT,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.VENDOR_EDIT,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.CONTRACT_EDIT,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.REPORT_PORTFOLIO,
    PERMISSIONS.INTERIOR_VIEW,
    PERMISSIONS.INTERIOR_EDIT,
    PERMISSIONS.INTERIOR_FINANCE,
    PERMISSIONS.DAILYLOG_VIEW,
    PERMISSIONS.DAILYLOG_EDIT,
  ],
  [UserRole.CONSTRUCTION]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    // Construction is fully blind to financials — no financial:view (actuals/cashflow/
    // reports) and no budget:view (budget/spend/variance summary). Discovery: Construction
    // must not see financial data. Keeps draw:view for inspection/site-photo workflow.
    PERMISSIONS.DRAW_VIEW,
    PERMISSIONS.MILESTONE_VIEW,
    PERMISSIONS.MILESTONE_EDIT,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.INTERIOR_VIEW,
    PERMISSIONS.DAILYLOG_VIEW,
    PERMISSIONS.DAILYLOG_EDIT,
  ],
  [UserRole.SALES]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_EDIT,
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.LEASE_EDIT,
    PERMISSIONS.LEAD_VIEW,
    PERMISSIONS.LEAD_CREATE,
    PERMISSIONS.LEAD_EDIT,
    PERMISSIONS.LEAD_DELETE,
    PERMISSIONS.LEAD_CONVERT,
    // Sales sees campaigns (to know where each lead came from) but can't manage budgets.
    PERMISSIONS.CAMPAIGN_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.REPORT_SALES,
    PERMISSIONS.REPORT_REVENUE,
    PERMISSIONS.BROKER_VIEW,
    PERMISSIONS.BROKER_EDIT,
  ],
  [UserRole.MARKETING]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT,
    PERMISSIONS.LEAD_VIEW,
    PERMISSIONS.LEAD_CREATE,
    PERMISSIONS.LEAD_EDIT,
    PERMISSIONS.LEAD_DELETE,
    // Marketing owns the campaign module — creates, edits, records spend, deletes.
    PERMISSIONS.CAMPAIGN_VIEW,
    PERMISSIONS.CAMPAIGN_CREATE,
    PERMISSIONS.CAMPAIGN_EDIT,
    PERMISSIONS.CAMPAIGN_SPEND,
    PERMISSIONS.CAMPAIGN_DELETE,
    // Sales & lease views + edit needed for reports and updating tenant details.
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.LEASE_EDIT,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
    PERMISSIONS.REPORT_SALES,
    PERMISSIONS.REPORT_REVENUE,
    PERMISSIONS.BROKER_VIEW,
    PERMISSIONS.BROKER_EDIT,
  ],
  [UserRole.LEGAL]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    // Legal sees no financial data (financial:view removed; never had budget:view).
    // Retains loan/contract/sale/lease views for document & legal review.
    PERMISSIONS.LOAN_VIEW,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.VENDOR_VIEW,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_EDIT,
  ],
  [UserRole.VIEWER]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.MILESTONE_VIEW,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.DAILYLOG_VIEW,
  ],
};

// ---- Project Visibility Scoping ----

/**
 * Roles whose project visibility is scoped to assignment (ProjectMember rows).
 * Field/operational roles only see projects they are explicitly added to.
 * Everyone else — leadership (Founder/Executive), finance (Finance/Accounting/AR_AP),
 * Legal, Viewer, and Super Admin — sees the full portfolio.
 * Decision (2026-06-07): scope field roles only.
 */
export const PROJECT_SCOPED_ROLES: UserRole[] = [
  UserRole.PROJECT_MANAGER,
  UserRole.CONSTRUCTION,
  UserRole.SALES,
  UserRole.MARKETING,
];

/** True when a role only sees projects it is assigned to (ProjectMember). */
export function isProjectScopedRole(role: UserRole | string): boolean {
  return (PROJECT_SCOPED_ROLES as string[]).includes(role as string);
}

/**
 * A user with multiple roles is globally scoped if ANY role is global.
 * Only restrict to assigned projects when ALL roles are project-scoped.
 */
export function isMultiRoleProjectScoped(roles: (UserRole | string)[]): boolean {
  return roles.every((r) => isProjectScopedRole(r));
}

// ---- Role Metadata ----

export const ROLE_META: Record<UserRole, { label: string; description: string; category: 'admin' | 'leadership' | 'finance' | 'operations' | 'support' }> = {
  [UserRole.SUPER_ADMIN]: { label: 'Super Admin', description: 'Full system access including configuration and role management', category: 'admin' },
  [UserRole.FOUNDER]: { label: 'Founder', description: 'Full business access, user management, and organizations', category: 'leadership' },
  [UserRole.EXECUTIVE]: { label: 'Executive', description: 'Read access to all data with financial approval authority', category: 'leadership' },
  [UserRole.FINANCE]: { label: 'Finance', description: 'Financial management, loans, investors, reporting, and QuickBooks', category: 'finance' },
  [UserRole.ACCOUNTING]: { label: 'Accounting', description: 'Budget and actual management, QuickBooks sync, financial reporting', category: 'finance' },
  [UserRole.AR_AP]: { label: 'AR/AP', description: 'Accounts receivable/payable, draw requests, payment approvals', category: 'finance' },
  [UserRole.PROJECT_MANAGER]: { label: 'Project Manager', description: 'Project lifecycle, buildings, units, milestones, vendors, and documents', category: 'operations' },
  [UserRole.CONSTRUCTION]: { label: 'Construction', description: 'Construction milestones, documents, and building oversight', category: 'operations' },
  [UserRole.SALES]: { label: 'Sales', description: 'Sales pipeline, leads, leases, and revenue reporting', category: 'operations' },
  [UserRole.MARKETING]: { label: 'Marketing', description: 'Lead management, marketing documents, and sales reporting', category: 'operations' },
  [UserRole.LEGAL]: { label: 'Legal', description: 'Contract review, lease/sale oversight, and legal documents', category: 'support' },
  [UserRole.VIEWER]: { label: 'Viewer', description: 'Read-only access to projects, buildings, units, and milestones', category: 'support' },
};

// ---- Permission Categories (for Role Management UI) ----

export const PERMISSION_CATEGORIES: { key: string; label: string; permissions: string[] }[] = [
  { key: 'projects', label: 'Projects', permissions: ['project:view', 'project:create', 'project:edit', 'project:delete'] },
  { key: 'buildings', label: 'Buildings & Units', permissions: ['building:view', 'building:edit', 'unit:view', 'unit:edit'] },
  { key: 'financial', label: 'Financial', permissions: ['financial:view', 'financial:edit', 'financial:export', 'budget:view', 'budget:edit', 'actual:view', 'actual:edit'] },
  { key: 'loans', label: 'Loans & Draws', permissions: ['loan:view', 'loan:edit', 'draw:view', 'draw:edit', 'draw:approve'] },
  { key: 'sales_leasing', label: 'Sales & Leasing', permissions: ['sales:view', 'sales:edit', 'lease:view', 'lease:edit', 'lead:view', 'lead:create', 'lead:edit', 'lead:delete', 'lead:convert'] },
  { key: 'marketing', label: 'Marketing & Campaigns', permissions: ['campaign:view', 'campaign:create', 'campaign:edit', 'campaign:spend', 'campaign:delete'] },
  { key: 'milestones', label: 'Milestones', permissions: ['milestone:view', 'milestone:edit'] },
  { key: 'vendors', label: 'Vendors & Contracts', permissions: ['vendor:view', 'vendor:edit', 'contract:view', 'contract:edit', 'payment:approve'] },
  { key: 'documents', label: 'Documents', permissions: ['document:view', 'document:upload', 'document:delete'] },
  { key: 'investors', label: 'Investors', permissions: ['investor:view', 'investor:manage'] },
  { key: 'comments', label: 'Comments', permissions: ['comment:view', 'comment:edit'] },
  { key: 'reports', label: 'Reports', permissions: ['report:portfolio', 'report:sales', 'report:revenue', 'report:debt'] },
  { key: 'admin', label: 'Administration', permissions: ['user:manage', 'role:manage', 'audit:view', 'quickbooks:manage', 'system:config', 'org:manage'] },
];

// ---- API Response Types ----

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface DashboardSummary {
  totalProjects: number;
  activeProjects: number;
  totalBudget: number;
  totalActuals: number;
  totalCommitted: number;
  budgetVariance: number;
  unitsByStatus: Record<string, number>;
  projectsByPhase: Record<string, number>;
  recentMilestones: MilestoneSummary[];
  alerts: Alert[];
}

export interface MilestoneSummary {
  id: string;
  title: string;
  projectName: string;
  dueDate: string;
  status: MilestoneStatus;
}

export interface Alert {
  id: string;
  type: 'BUDGET_OVERRUN' | 'MILESTONE_OVERDUE' | 'LEASE_EXPIRING' | 'SYNC_ERROR';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  projectId?: string;
  createdAt: string;
}

export interface FinancialSummary {
  projectId: string;
  budgetTotal: number;
  actualTotal: number;
  committedTotal: number;
  forecastTotal: number;
  variance: number;
  variancePercent: number;
  byCategory: CategoryFinancial[];
}

export interface CategoryFinancial {
  category: BudgetCategory;
  budget: number;
  actual: number;
  committed: number;
  forecast: number;
  variance: number;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
  permissions: string[];
  mfaVerified: boolean;
}

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
  // Buyer portal role (Phase 2 of Document Vault rollout) — sees only their own unit.
  // Mirrors prisma/schema.prisma's UserRole exactly; the two were out of sync (CLIENT
  // existed in the DB enum but not here), which silently resolved any CLIENT user's
  // permissions to [] via ROLE_PERMISSIONS[role] ?? [] instead of a deliberate, typed
  // grant. No portal-specific scoping (e.g. "own unit only") exists yet — this entry
  // just makes the role's current (intentionally empty) access explicit and keeps every
  // Record<UserRole, ...> map below honest about covering it.
  CLIENT = 'CLIENT',
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

/**
 * Probability a deal at each stage eventually closes, used to weight the pipeline forecast.
 *
 * These mirror the `OrgSettings.saleStageProbabilities` column default in schema.prisma and
 * the fallback map in `SalesForecastService`. Kept here so the API (validating writes) and
 * the web settings UI (rendering the form) agree on the baseline without either owning it.
 */
export const DEFAULT_SALE_STAGE_PROBABILITIES: Record<string, number> = {
  PROSPECT: 0.1,
  LOI_SIGNED: 0.35,
  UNDER_CONTRACT: 0.75,
  CLOSED: 1.0,
  CANCELLED: 0.0,
};

/**
 * The stages whose probability can actually be configured.
 *
 * CLOSED and CANCELLED are deliberately excluded: the forecast filters both out of the
 * in-flight set before weighting anything, so their probabilities have no effect on
 * `totalPipelineValue` or `weightedForecast`. A settings form must not offer a field that
 * does nothing, and the API rejects writes to them for the same reason.
 *
 * Ordered from earliest stage to latest — the API enforces that the values do not decrease
 * along this order, and the UI should render them in it.
 */
export const WRITABLE_SALE_STAGE_PROBABILITIES = [
  'PROSPECT',
  'LOI_SIGNED',
  'UNDER_CONTRACT',
] as const;

export type WritableSaleStageProbability =
  (typeof WRITABLE_SALE_STAGE_PROBABILITIES)[number];

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
  // Recording rent received is deliberately NOT lease:edit — an AR/AP clerk must be
  // able to mark rent paid without also being able to rewrite the lease terms.
  RENT_COLLECT: 'rent:collect',

  // Historical backfill (H2). Entering a PAST tenancy is not the same power as editing a
  // live one: it writes a whole ledger at once, backdates occupancy events, and bypasses
  // the unit state machine by design. Split from lease:edit so it can be granted to the
  // people doing the data entry without also handing them the live book.
  //
  // Client decision 2026-08-12 (Q2, option b): Sales may CREATE and EDIT historical
  // records; only a Founder may DELETE one — hence two permissions, not one.
  UNIT_HISTORY_BACKFILL: 'unit:history:backfill',
  UNIT_HISTORY_DELETE: 'unit:history:delete',

  // Correcting a rent period that has ALREADY BEEN BILLED (R22).
  //
  // Granted to no role EXPLICITLY — deliberately. Editing future terms and rewriting a
  // figure a tenant was already invoiced for are different powers, and this is the only
  // one in the system that can change a number already sent out. Prime chooses who holds
  // it; until they do, the only people who can are Founder and Super Admin, who inherit
  // it from their blanket grants and already own the whole book.
  LEASE_HISTORY_CORRECT: 'lease:history:correct',

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
  /**
   * The build half of unit editing: unit number, type, size and notes — the physical
   * facts a site team owns and corrects. Deliberately excludes asking price, asking rent
   * and `status`, which are commercial/lifecycle fields and stay behind UNIT_EDIT.
   *
   * PUT /units/:id is gated on THIS permission, and the service then rejects the
   * commercial fields for anyone who lacks UNIT_EDIT. Every role holding UNIT_EDIT also
   * holds this, so the split widens who may edit without widening what they may edit.
   */
  UNIT_EDIT_BUILD: 'unit:editBuild',

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

  // Unit construction checklist (per-unit stage tracking, separate from Task/kind=CONSTRUCTION)
  CHECKLIST_VIEW: 'checklist:view',
  CHECKLIST_EDIT: 'checklist:edit',

  // Site Tracker — the cross-property construction status grid (blocker, site priority,
  // work type, site assignees). Deliberately NOT folded into unit:edit: CONSTRUCTION, the
  // role that actually knows whether a unit is blocked, does not hold unit:edit, while
  // SALES and MARKETING do. Gating a blocker flag on unit:edit would put it in exactly the
  // wrong hands. Mirrors the checklist:* holders instead.
  SITE_TRACKER_VIEW: 'siteTracker:view',
  SITE_TRACKER_EDIT: 'siteTracker:edit',

  // Minting a new template VERSION is a different act from ticking a stage off: it changes
  // what every future unit of that work type gets. Kept separate so Construction can run
  // its checklists without being able to redefine them.

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

  // Tasks (work tracking, per project/building/unit)
  TASK_VIEW: 'task:view',
  TASK_EDIT: 'task:edit',

  // Global Update Board (org-wide chat/announcement feed, not project-scoped)
  UPDATE_BOARD_VIEW: 'updateBoard:view',
  UPDATE_BOARD_CREATE: 'updateBoard:create',

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
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
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
    PERMISSIONS.CHECKLIST_VIEW,
    PERMISSIONS.SITE_TRACKER_VIEW,
    PERMISSIONS.BROKER_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
    // Founder-tier: can post to the global Update Board, not just read it.
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.FINANCE]: [
    PERMISSIONS.RENT_COLLECT,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.UPDATE_BOARD_VIEW,
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
    // Finance/Accounting can now post their own updates (e.g. a payment-milestone or
    // budget-variance note) — see UPDATE_BOARD_DESIGN.md §8. The board's own "Leadership
    // Only" toggle is how a sensitive one stays out of the whole-company broadcast.
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.ACCOUNTING]: [
    // rent:collect is worthless without lease:view — the invoice list and
    // summary endpoints it works against both require the read permission.
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.RENT_COLLECT,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
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
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.AR_AP]: [
    // rent:collect is worthless without lease:view — the invoice list and
    // summary endpoints it works against both require the read permission.
    PERMISSIONS.LEASE_VIEW,
    PERMISSIONS.RENT_COLLECT,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
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
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.PROJECT_MANAGER]: [
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.PROJECT_CREATE,
    PERMISSIONS.PROJECT_EDIT,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.BUILDING_EDIT,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT,
    PERMISSIONS.UNIT_EDIT_BUILD,
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
    PERMISSIONS.CHECKLIST_VIEW,
    PERMISSIONS.CHECKLIST_EDIT,
    PERMISSIONS.SITE_TRACKER_VIEW,
    PERMISSIONS.SITE_TRACKER_EDIT,
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.CONSTRUCTION]: [
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT_BUILD,
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
    PERMISSIONS.CHECKLIST_VIEW,
    PERMISSIONS.CHECKLIST_EDIT,
    PERMISSIONS.SITE_TRACKER_VIEW,
    PERMISSIONS.SITE_TRACKER_EDIT,
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.SALES]: [
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT,
    PERMISSIONS.UNIT_EDIT_BUILD,
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
    // Q2 option b: Sales enters the historical record, a Founder approves deletion.
    PERMISSIONS.UNIT_HISTORY_BACKFILL,
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.MARKETING]: [
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_EDIT,
    PERMISSIONS.UNIT_EDIT_BUILD,
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
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
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
    PERMISSIONS.UPDATE_BOARD_VIEW,
    PERMISSIONS.UPDATE_BOARD_CREATE,
  ],
  [UserRole.VIEWER]: [
    PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.BUILDING_VIEW,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.MILESTONE_VIEW,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.DAILYLOG_VIEW,
    PERMISSIONS.UPDATE_BOARD_VIEW,
  ],
  // Buyer portal (Phase 2) — not built yet, so deliberately empty rather than granted any
  // of the internal-staff permissions above. A CLIENT account today can only reach the
  // handful of self-scoped routes that carry no @RequirePermissions at all (own profile,
  // notifications, MFA). Revisit once the "own unit only" portal scoping is designed —
  // this is NOT the place to grant unit:view etc., since every permission here is checked
  // against the FULL portfolio, not a single unit.
  [UserRole.CLIENT]: [],
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
 * Whether a user is restricted to the projects they are a member of.
 *
 * ANY project-scoped role wins: hold one and you only see your assigned projects,
 * whatever else you hold. So adding someone to a single project genuinely limits them
 * to it — the behaviour an admin expects when they assign a project.
 *
 * This previously read `every` and, more importantly, was never called: every scoping
 * site used the single-role `isProjectScopedRole(viewer.role)` against the PRIMARY role
 * (roles[0]). Two users with the identical role set therefore got different access
 * purely from array order — [FINANCE, MARKETING] saw every project while
 * [MARKETING, FINANCE] saw only its own, even though both were members of one project.
 *
 * Pass every role the user holds, not just the primary.
 */
export function isMultiRoleProjectScoped(roles: (UserRole | string)[]): boolean {
  return roles.some((r) => isProjectScopedRole(r));
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
  [UserRole.CLIENT]: { label: 'Client', description: 'Buyer portal (Phase 2, not yet implemented) — will see only their own unit', category: 'support' },
};

// ---- Project Team Member Roles ----

/**
 * The fixed set of titles a project team member may hold (`ProjectMember.role` / `.roles`).
 * Client decision 2026-08-14: project-team roles are a closed list, not free text — a typo
 * used to persist silently and then render as an unrecognised chip forever.
 *
 * This is NOT `UserRole`. A system role grants permissions portfolio-wide; this is only a
 * label for what someone does on ONE project. The values overlap deliberately (a Finance
 * user is normally the FINANCE member) but the sets differ: TEAM_MEMBER has no UserRole
 * equivalent, and MARKETING / ACCOUNTING / AR_AP map onto SALES and FINANCE here.
 *
 * `OWNER` is deliberately absent. The server stamps it on whoever creates a project and it
 * is never assignable through the add-member API — including it would let a caller demote
 * or fabricate an owner.
 */
export const PROJECT_MEMBER_ROLES = [
  'PROJECT_MANAGER',
  'CONSTRUCTION',
  'FINANCE',
  'SALES',
  'LEGAL',
  'VIEWER',
  'TEAM_MEMBER',
] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

/** True when a value is one of the assignable project-team titles. */
export function isProjectMemberRole(value: string): value is ProjectMemberRole {
  return (PROJECT_MEMBER_ROLES as readonly string[]).includes(value);
}

/** Human labels for the project-role pickers, so the UI stops deriving them ad hoc. */
export const PROJECT_MEMBER_ROLE_META: Record<ProjectMemberRole, { label: string; description: string }> = {
  PROJECT_MANAGER: { label: 'Project Manager', description: 'Runs the project day to day' },
  CONSTRUCTION: { label: 'Construction', description: 'Site delivery and build oversight' },
  FINANCE: { label: 'Finance', description: 'Budget, draws, and project accounting' },
  SALES: { label: 'Sales', description: 'Sales, leasing, and leads on this project' },
  LEGAL: { label: 'Legal', description: 'Contracts, leases, and legal review' },
  VIEWER: { label: 'Viewer', description: 'Read-only visibility into this project' },
  TEAM_MEMBER: { label: 'Team Member', description: 'General contributor with no specific title' },
};

// ---- Permission Categories (for Role Management UI) ----

export const PERMISSION_CATEGORIES: { key: string; label: string; permissions: string[] }[] = [
  { key: 'projects', label: 'Projects', permissions: ['project:view', 'project:create', 'project:edit', 'project:delete'] },
  { key: 'buildings', label: 'Buildings & Units', permissions: ['building:view', 'building:edit', 'unit:view', 'unit:edit'] },
  { key: 'financial', label: 'Financial', permissions: ['financial:view', 'financial:edit', 'financial:export', 'budget:view', 'budget:edit', 'actual:view', 'actual:edit'] },
  { key: 'loans', label: 'Loans & Draws', permissions: ['loan:view', 'loan:edit', 'draw:view', 'draw:edit', 'draw:approve'] },
  { key: 'sales_leasing', label: 'Sales & Leasing', permissions: ['sales:view', 'sales:edit', 'lease:view', 'lease:edit', 'rent:collect', 'lead:view', 'lead:create', 'lead:edit', 'lead:delete', 'lead:convert'] },
  { key: 'marketing', label: 'Marketing & Campaigns', permissions: ['campaign:view', 'campaign:create', 'campaign:edit', 'campaign:spend', 'campaign:delete'] },
  { key: 'milestones', label: 'Milestones', permissions: ['milestone:view', 'milestone:edit'] },
  { key: 'checklist', label: 'Construction Checklist', permissions: ['checklist:view', 'checklist:edit'] },
  { key: 'site_tracker', label: 'Site Tracker', permissions: ['siteTracker:view', 'siteTracker:edit'] },
  { key: 'vendors', label: 'Vendors & Contracts', permissions: ['vendor:view', 'vendor:edit', 'contract:view', 'contract:edit', 'payment:approve'] },
  { key: 'documents', label: 'Documents', permissions: ['document:view', 'document:upload', 'document:delete'] },
  { key: 'investors', label: 'Investors', permissions: ['investor:view', 'investor:manage'] },
  { key: 'comments', label: 'Comments', permissions: ['comment:view', 'comment:edit'] },
  { key: 'reports', label: 'Reports', permissions: ['report:portfolio', 'report:sales', 'report:revenue', 'report:debt'] },
  { key: 'admin', label: 'Administration', permissions: ['user:manage', 'role:manage', 'audit:view', 'quickbooks:manage', 'system:config', 'org:manage'] },
];

// ---- Document Expiry (D2) ----

/**
 * Document categories that genuinely LAPSE. Advisory only, in both directions:
 *
 *  - the API never REQUIRES `expiresAt`, for any category — back-filled and historical
 *    documents legitimately have no known date, and refusing them would just mean the
 *    document is never filed;
 *  - the API returns a per-document `expiryExpected` flag derived from this same list, so
 *    a form can prompt for the date before the document exists and a list can mark the
 *    ones still missing it.
 *
 * Kept here rather than in the API so the upload form can highlight the field without a
 * round-trip. Values match the Prisma `DocCategory` enum.
 */
export const EXPIRY_TRACKED_DOC_CATEGORIES = [
  'PERMIT',
  'NOC',
  'POSSESSION_CERTIFICATE',
] as const;

/** Derived on read; null when the document carries no expiry date at all. */
export type DocumentExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

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

/**
 * The exact 403 body the API sends when a route demands a fresh TOTP step-up, and the
 * exact string the web client matches to decide whether to open the step-up modal.
 *
 * It lived as a duplicated literal in mfa.guard.ts and lib/api.ts. They matched, but
 * nothing enforced that: editing either one — a typo, a reworded message — would have
 * left the guard correctly refusing and the client silently showing a raw 403 instead
 * of prompting, with the request simply failing for no visible reason.
 */
export const MFA_REQUIRED_MESSAGE =
  'MFA verification required for this action. Please verify your TOTP code.';

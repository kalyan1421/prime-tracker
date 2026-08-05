import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { isProjectScopedRole } from '@prime-tracker/shared';
import { Mailer, createMailer } from './mailer';
import { NotificationsGateway } from './notifications.gateway';

const ALL_TYPES = Object.values(NotificationType);

// ============================================================================
// Severity tiers
//
// Every notification type is either ACTION (someone must DO something) or FYI
// (awareness only). The tier decides the DEFAULT channel mix:
//
//   ACTION -> in-app AND email
//   FYI    -> in-app only; email only if the user explicitly opted in
//
// This exists because the alternative — emailing every recipient for every
// trigger — trains people to filter the whole sender to a folder, at which
// point the ACTION alerts are lost along with the noise.
// ============================================================================

export type NotificationTier = 'ACTION' | 'FYI';

/**
 * The tier of every NotificationType. Exported so callers/tests can assert the
 * classification rather than re-deriving it.
 */
export const NOTIFICATION_TIERS = {
  // ---- ACTION: someone must do something ----
  MILESTONE_OVERDUE: 'ACTION',
  LEASE_EXPIRING_7: 'ACTION',
  LOAN_MATURITY_60: 'ACTION',
  DRAW_REQUEST_SUBMITTED: 'ACTION',
  DRAW_FUNDING_OVERDUE: 'ACTION',
  BUDGET_VARIANCE: 'ACTION',
  PAYMENT_OVERDUE: 'ACTION',
  PAYMENT_DUE_7: 'ACTION',
  SNAG_OVERDUE: 'ACTION',
  INTERIOR_HANDOVER_DUE: 'ACTION',
  LEASE_TERMINATED: 'ACTION',
  FREE_RENT_ENDING_30: 'ACTION',
  DEPOSIT_OUTSTANDING: 'ACTION',
  RENT_OVERDUE: 'ACTION',

  // ---- FYI: awareness only ----
  LEASE_EXPIRING_30: 'FYI',
  COMMENT_FINANCIAL: 'FYI',
  COMMENT_SALES: 'FYI',
  COMMENT_MARKETING: 'FYI',
  DRAW_REQUEST_APPROVED: 'FYI',
  DRAW_REQUEST_FUNDED: 'FYI',
  LEAD_ASSIGNED: 'FYI',
  LEAD_STATUS_CHANGED: 'FYI',
  INTERIOR_PHASE_CHANGED: 'FYI',
  UNIT_SOLD: 'FYI',
  LEASE_ADDED: 'FYI',
  LEASE_ACTIVATED: 'FYI',
  LEASE_RENT_CHANGED: 'FYI',
  TI_DISBURSED: 'FYI',
} as const satisfies Record<string, NotificationTier>;

/**
 * Compile-time exhaustiveness guard. If a NotificationType is added to the
 * Prisma enum without a tier, `_Unclassified` stops being `never` and this
 * assignment fails to compile — so a new type can never silently inherit a
 * default that emails everyone.
 */
type _Unclassified = Exclude<NotificationType, keyof typeof NOTIFICATION_TIERS>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _tiersAreExhaustive: [_Unclassified] extends [never] ? true : never = true;

/**
 * Portfolio owners. They are recipients of every routed event regardless of
 * project staffing — they own the whole book, not individual projects.
 */
export const LEADERSHIP_ROLES = ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE'] as const;

const LEADERSHIP_SET: ReadonlySet<string> = new Set<string>(LEADERSHIP_ROLES);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  // Provider-agnostic mailer (SMTP default, SES via MAIL_DRIVER=ses); null = in-app only.
  private mailer: Mailer | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Optional() private gateway: NotificationsGateway,
  ) {
    this.mailer = createMailer(this.config);
  }

  // ---- Severity tiers ----

  /**
   * Tier of a notification type. An unknown type falls back to FYI (in-app
   * only) on purpose: the failure mode of a missing classification must be a
   * quiet notification, never an unsolicited email blast.
   */
  tierOf(type: NotificationType | string): NotificationTier {
    const tier = (NOTIFICATION_TIERS as Record<string, NotificationTier>)[type as string];
    if (!tier) {
      this.logger.warn(`Notification type "${type}" has no severity tier — defaulting to FYI (in-app only)`);
      return 'FYI';
    }
    return tier;
  }

  // ---- Recipient routing ----

  /**
   * Resolve who should hear about an event.
   *
   *   recipients = every active leadership user (SUPER_ADMIN/FOUNDER/EXECUTIVE)
   *              ∪ every active user holding a GLOBAL role in `roles`
   *              ∪ active ProjectMember(projectId) holding a PROJECT-SCOPED role in `roles`
   *
   * Which roles are project-scoped is NOT decided here — it comes from
   * `isProjectScopedRole()` in `@prime-tracker/shared`, the same helper that
   * drives project *visibility* (ProjectsService, ProjectAccessService). Routing
   * that disagreed with visibility would be a second, silently divergent rule.
   *
   * Today that means only the field/operational roles — PROJECT_MANAGER,
   * CONSTRUCTION, SALES, MARKETING — are filtered by ProjectMember. FINANCE,
   * ACCOUNTING, AR_AP, LEGAL and VIEWER are deliberately global: they carry the
   * whole book, are rarely added as ProjectMembers, and are precisely the people
   * a rent-overdue or budget-variance alert exists for. Scoping them by
   * membership dropped them from their own alerts.
   *
   * Leadership is always role-global — they own the portfolio.
   *
   * Fallback (deliberate, not optional): if the project has ZERO ProjectMember
   * rows we fall back to role-global for the project-scoped roles too. A project
   * nobody has staffed yet would otherwise emit nothing to the field roles at
   * all, which reads as broken software rather than as a routing rule.
   *
   * When `projectId` is absent the behaviour is role-global for everyone.
   */
  async resolveRecipients(params: { roles: string[]; projectId?: string | null }): Promise<string[]> {
    const ids = new Set<string>();

    const leadership = await this.prisma.user.findMany({
      where: { role: { in: LEADERSHIP_ROLES as unknown as string[] } as any, isActive: true },
      select: { id: true },
    });
    for (const u of leadership) ids.add(u.id);

    const addRoleGlobal = async (roles: string[]) => {
      if (roles.length === 0) return;
      const users = await this.prisma.user.findMany({
        where: { role: { in: roles } as any, isActive: true },
        select: { id: true },
      });
      for (const u of users) ids.add(u.id);
    };

    // Leadership is already covered globally; split the rest by the shared rule.
    const requested = [...new Set(params.roles ?? [])].filter((r) => !LEADERSHIP_SET.has(r));
    const scopedRoles = requested.filter((r) => isProjectScopedRole(r));
    const globalRoles = requested.filter((r) => !isProjectScopedRole(r));

    // Global roles are never filtered by project membership.
    await addRoleGlobal(globalRoles);

    if (scopedRoles.length === 0) return [...ids];

    const projectId = params.projectId ?? undefined;
    if (!projectId) {
      await addRoleGlobal(scopedRoles);
      return [...ids];
    }

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });

    if (members.length === 0) {
      // Unstaffed project — see the fallback note above.
      await addRoleGlobal(scopedRoles);
      return [...ids];
    }

    const scoped = await this.prisma.user.findMany({
      where: {
        id: { in: members.map((m) => m.userId) },
        role: { in: scopedRoles } as any,
        isActive: true,
      },
      select: { id: true },
    });
    for (const u of scoped) ids.add(u.id);

    return [...ids];
  }

  // ---- Core: send in-app + optional email ----

  /**
   * Deliver to explicit user ids.
   *
   * Two independent gates:
   *   - `NotificationPreference.enabled = false`  -> user gets NOTHING (no in-app, no email)
   *   - `NotificationPreference.emailEnabled`     -> email only
   *        null/absent -> use this type's tier default (ACTION emails, FYI doesn't)
   *        true        -> email even for FYI
   *        false       -> never email, even for ACTION (still gets in-app)
   */
  async send(params: {
    userIds: string[];
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
    projectName?: string;
  }) {
    const { type, title, body, link } = params;
    const userIds = [...new Set(params.userIds ?? [])];
    if (userIds.length === 0) return;

    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type },
      select: { userId: true, enabled: true, emailEnabled: true },
    });
    const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

    // `enabled` gates in-app delivery, and a muted type means muted entirely.
    const targetUserIds = userIds.filter((id) => prefByUser.get(id)?.enabled !== false);
    if (targetUserIds.length === 0) return;

    // Create in-app notifications
    await this.prisma.notification.createMany({
      data: targetUserIds.map((userId) => ({ userId, type, title, body, link })),
    });

    // Push real-time to connected clients
    for (const uid of targetUserIds) {
      this.gateway?.emitToUser(uid, 'notification', { type, title, body, link });
    }

    // Send emails — tier default, overridable per user in either direction.
    if (!this.mailer) return;

    const emailByDefault = this.tierOf(type) === 'ACTION';
    const emailUserIds = targetUserIds.filter((id) => {
      const override = prefByUser.get(id)?.emailEnabled;
      return override === null || override === undefined ? emailByDefault : override;
    });
    if (emailUserIds.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { id: { in: emailUserIds }, isActive: true },
      select: { email: true, name: true },
    });

    const from = this.config.get('SMTP_FROM', 'PrimeTracker <noreply@primedevelopers.com>');
    const baseUrl = this.config.get('APP_BASE_URL', 'http://localhost:5173');

    for (const user of users) {
      try {
        await this.mailer.sendMail({
          from,
          to: user.email,
          subject: title,
          html: this.buildEmailHtml({ name: user.name, title, body, link, baseUrl }),
        });
      } catch (err) {
        this.logger.warn(`Failed to send email to ${user.email}: ${err}`);
      }
    }
  }

  /**
   * Role-targeted delivery. Pass `projectId` to get project-scoped routing
   * (leadership always included); omit it for the legacy role-global behaviour.
   */
  async sendToRoles(params: {
    roles: string[];
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
    projectId?: string | null;
  }) {
    const userIds = await this.resolveRecipients({ roles: params.roles, projectId: params.projectId });
    await this.send({ ...params, userIds });
  }

  // ---- In-App Notification Queries ----

  async findForUser(userId: string, limit = 20) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { notifications, unreadCount };
  }

  async markRead(userId: string, ids?: string[]) {
    const where = ids?.length
      ? { userId, id: { in: ids } }
      : { userId, readAt: null };
    await this.prisma.notification.updateMany({ where, data: { readAt: new Date() } });
    return { success: true };
  }

  // ---- Notification Preferences ----

  /**
   * Per-type preferences for a user. `emailEnabled: null` means "follow the
   * tier default" — `tier` and `emailDefault` are returned so the UI can render
   * that third state honestly instead of showing a lie as a checkbox.
   */
  async getPreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const map = new Map(existing.map((p) => [p.type, p]));
    return ALL_TYPES.map((type) => {
      const pref = map.get(type);
      const tier = this.tierOf(type);
      const emailDefault = tier === 'ACTION';
      const emailEnabled = pref?.emailEnabled ?? null;
      return {
        type,
        enabled: pref?.enabled ?? true,
        tier,
        emailDefault,
        emailEnabled,
        // What actually happens today, with the override resolved.
        emailEffective: pref?.enabled === false ? false : (emailEnabled ?? emailDefault),
      };
    });
  }

  /**
   * `emailEnabled` is tri-state: omit it to leave the current value alone,
   * pass `null` to clear the override back to the tier default, or pass a
   * boolean to force email on/off for this type.
   */
  /**
   * In-app (`enabled`) and email (`emailEnabled`) are independent channels, so BOTH are
   * optional: a caller changing one must never restate the other. Omitting a field
   * leaves it untouched.
   *
   * `emailEnabled: null` is meaningful — it clears the override back to the type's tier
   * default — and must not be conflated with "not sent".
   */
  async setPreference(
    userId: string,
    type: NotificationType,
    enabled?: boolean,
    emailEnabled?: boolean | null,
  ) {
    const update: { enabled?: boolean; emailEnabled?: boolean | null } = {};
    if (enabled !== undefined) update.enabled = enabled;
    if (emailEnabled !== undefined) update.emailEnabled = emailEnabled;

    return this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      // A row that doesn't exist yet is at its defaults: in-app on, email inheriting.
      create: { userId, type, enabled: enabled ?? true, emailEnabled: emailEnabled ?? null },
      update,
    });
  }

  // ---- Named Triggers (called from other services) ----

  async notifyMilestoneOverdue(milestone: { id: string; title: string; projectId: string; project: { name: string } }) {
    const link = `/projects/${milestone.projectId}/milestones`;
    await this.sendToRoles({
      roles: ['PROJECT_MANAGER'],
      projectId: milestone.projectId,
      type: NotificationType.MILESTONE_OVERDUE,
      title: `Milestone Overdue: ${milestone.title}`,
      body: `The milestone "${milestone.title}" in project ${milestone.project.name} is now overdue.`,
      link,
    });
  }

  async notifySnagOverdue(snag: {
    id: string;
    description: string;
    interiorProjectId: string;
    interiorName?: string;
    daysOverdue: number;
    projectId?: string | null;
  }) {
    const link = `/interior/${snag.interiorProjectId}`;
    const short = snag.description.length > 50 ? `${snag.description.slice(0, 50)}…` : snag.description;
    await this.sendToRoles({
      roles: ['PROJECT_MANAGER', 'CONSTRUCTION'],
      projectId: snag.projectId,
      type: NotificationType.SNAG_OVERDUE,
      title: `Snag overdue: ${short}`,
      body: `A punch-list item${snag.interiorName ? ` in "${snag.interiorName}"` : ''} is ${snag.daysOverdue} day(s) overdue.`,
      link,
    });
  }

  async notifyLeaseExpiring(lease: { unitId: string; tenantName: string; leaseEnd: Date; unit: { building: { project: { id: string; name: string } } } }, daysLeft: number) {
    const projectId = lease.unit.building.project.id;
    // Leases live inside the Revenue tab — there is no standalone `leases` tab.
    const link = `/projects/${projectId}/revenue`;
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING'],
      projectId,
      type: daysLeft <= 7 ? NotificationType.LEASE_EXPIRING_7 : NotificationType.LEASE_EXPIRING_30,
      title: `Lease Expiring in ${daysLeft} Days`,
      body: `${lease.tenantName}'s lease in ${lease.unit.building.project.name} expires on ${lease.leaseEnd.toLocaleDateString()}.`,
      link,
    });
  }

  // lender is nullable: it is an encrypted column that is NULL unless the caller
  // rehydrated it. Accepted but currently unused — the body names the project, not
  // the lender. Kept in the signature so callers keep decrypting; if the copy ever
  // does name the lender, guard against null there.
  async notifyLoanMaturity(loan: { id: string; lender?: string | null; maturityDate: Date; projectId: string; project: { name: string } }) {
    // Loans and their draws live in the Draws tab; `financials` is not a real tab.
    const link = `/projects/${loan.projectId}/draws`;
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING'],
      projectId: loan.projectId,
      type: NotificationType.LOAN_MATURITY_60,
      title: `Loan Maturing in 60 Days`,
      body: `A loan in project ${loan.project.name} matures on ${loan.maturityDate.toLocaleDateString()}.`,
      link,
    });
  }

  async notifyNewComment(comment: { commentType: string; content: string; projectId?: string; unit?: { building: { project: { id: string; name: string } } } }) {
    const typeMap: Record<string, { roles: string[]; notifType: NotificationType }> = {
      FINANCIAL: { roles: ['FINANCE', 'ACCOUNTING'], notifType: NotificationType.COMMENT_FINANCIAL },
      SALES: { roles: ['SALES'], notifType: NotificationType.COMMENT_SALES },
      MARKETING: { roles: ['SALES', 'MARKETING'], notifType: NotificationType.COMMENT_MARKETING },
    };
    const cfg = typeMap[comment.commentType];
    if (!cfg) return;
    const projId = comment.projectId || comment.unit?.building?.project?.id;
    const projName = comment.unit?.building?.project?.name || 'a project';
    await this.sendToRoles({
      roles: cfg.roles,
      projectId: projId,
      type: cfg.notifType,
      title: `New ${comment.commentType.charAt(0) + comment.commentType.slice(1).toLowerCase()} Comment`,
      body: `A new ${comment.commentType.toLowerCase()} comment was added in ${projName}: "${comment.content.slice(0, 80)}${comment.content.length > 80 ? '…' : ''}"`,
      link: projId ? `/projects/${projId}/comments` : undefined,
    });
  }

  async notifyDrawRequest(draw: {
    status: 'SUBMITTED' | 'APPROVED' | 'FUNDED';
    drawNumber: number;
    projectId: string;
    project: { name: string };
  }) {
    // SUBMITTED needs the people who can actually act on it (draw:approve); APPROVED/FUNDED
    // are FYI-only so ACCOUNTING (view-only on draws) is included there but not here.
    const config: Record<string, { type: NotificationType; roles: string[]; verb: string }> = {
      SUBMITTED: { type: NotificationType.DRAW_REQUEST_SUBMITTED, roles: ['FINANCE'], verb: 'submitted for approval' },
      APPROVED:  { type: NotificationType.DRAW_REQUEST_APPROVED,  roles: ['FINANCE', 'ACCOUNTING'], verb: 'approved' },
      FUNDED:    { type: NotificationType.DRAW_REQUEST_FUNDED,    roles: ['FINANCE', 'ACCOUNTING'], verb: 'funded' },
    };
    const cfg = config[draw.status];
    if (!cfg) return;
    await this.sendToRoles({
      roles: cfg.roles,
      projectId: draw.projectId,
      type: cfg.type,
      title: `Draw Request ${draw.status === 'SUBMITTED' ? 'Needs Approval' : draw.status}`,
      body: `Draw #${draw.drawNumber} for project ${draw.project.name} has been ${cfg.verb}.`,
      link: `/projects/${draw.projectId}/draws`,
    });
  }

  /**
   * A submitted draw has blown past its expected funding date. ACTION tier, so
   * it emails by default — and, unlike the raw insert this replaced, it honours
   * per-user mute/email preferences and project routing.
   *
   * Roles are FINANCE + AR_AP (the people who chase the lender); leadership is
   * added automatically by resolveRecipients.
   */
  async notifyDrawFundingOverdue(p: {
    drawNumber: number;
    projectId: string;
    projectName?: string | null;
    daysOverdue: number;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'AR_AP'],
      projectId: p.projectId,
      type: NotificationType.DRAW_FUNDING_OVERDUE,
      title: `Draw funding overdue (${p.daysOverdue}d)`,
      body: `Draw #${p.drawNumber} on ${p.projectName ?? 'a project'} is ${p.daysOverdue} day(s) past its expected funding date.`,
      link: `/projects/${p.projectId}/draws`,
    });
  }

  async notifyBudgetVariance(projectId: string, projectName: string, variancePct: number) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING'],
      projectId,
      type: NotificationType.BUDGET_VARIANCE,
      title: `Budget Variance Alert: ${projectName}`,
      body: `Project ${projectName} has exceeded budget by ${variancePct.toFixed(1)}% (threshold: 10%).`,
      link: `/projects/${projectId}/budget`,
    });
  }

  async notifyPaymentOverdue(p: {
    saleId: string;
    label: string;
    buyer: string | null;
    projectId: string;
    projectName?: string;
    daysOverdue: number;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP', 'SALES'],
      projectId: p.projectId,
      type: NotificationType.PAYMENT_OVERDUE,
      title: `Payment overdue (${p.daysOverdue}d): ${p.label}`,
      body: `Installment "${p.label}" for ${p.buyer ?? 'a buyer'} in ${p.projectName ?? 'a project'} is ${p.daysOverdue} day(s) overdue.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyPaymentDueSoon(p: {
    saleId: string;
    label: string;
    buyer: string | null;
    projectId: string;
    projectName?: string;
    daysLeft: number;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP', 'SALES'],
      projectId: p.projectId,
      type: NotificationType.PAYMENT_DUE_7,
      title: `Payment due in ${p.daysLeft}d: ${p.label}`,
      body: `Installment "${p.label}" for ${p.buyer ?? 'a buyer'} in ${p.projectName ?? 'a project'} is due in ${p.daysLeft} day(s).`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  // ---- Leasing-depth triggers (L3) ----
  //
  // All of these take a projectId so recipient routing works. Deep links point
  // only at tabs that exist on ProjectDetailPage — leases and sales both live
  // under `revenue`; an unknown tab silently falls back to Overview.

  async notifyUnitSold(p: {
    projectId: string;
    projectName?: string | null;
    unitId?: string | null;
    unitLabel: string;
    buyer?: string | null;
    salePrice?: number | null;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'SALES', 'ACCOUNTING'],
      projectId: p.projectId,
      type: NotificationType.UNIT_SOLD,
      title: `Unit sold: ${p.unitLabel}`,
      body: `${p.unitLabel} in ${p.projectName ?? 'a project'} was sold${p.buyer ? ` to ${p.buyer}` : ''}${
        p.salePrice != null ? ` for ${this.money(p.salePrice)}` : ''
      }.`,
      // The unit detail page is a real route; fall back to the Revenue tab.
      link: p.unitId ? `/projects/${p.projectId}/units/${p.unitId}` : `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyLeaseAdded(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    tenantName: string;
    unitLabel?: string | null;
    monthlyRent?: number | null;
  }) {
    await this.sendToRoles({
      roles: ['SALES', 'FINANCE'],
      projectId: p.projectId,
      type: NotificationType.LEASE_ADDED,
      title: `New lease: ${p.tenantName}`,
      body: `A lease for ${p.tenantName}${this.at(p.unitLabel)} in ${p.projectName ?? 'a project'} was created${
        p.monthlyRent != null ? ` at ${this.money(p.monthlyRent)}/mo` : ''
      }.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyLeaseActivated(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    tenantName: string;
    unitLabel?: string | null;
    monthlyRent?: number | null;
    leaseStart?: Date | null;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP'],
      projectId: p.projectId,
      type: NotificationType.LEASE_ACTIVATED,
      title: `Lease activated: ${p.tenantName}`,
      body: `${p.tenantName}'s lease${this.at(p.unitLabel)} in ${p.projectName ?? 'a project'} is now ACTIVE${
        p.leaseStart ? ` (from ${this.date(p.leaseStart)})` : ''
      }${p.monthlyRent != null ? ` at ${this.money(p.monthlyRent)}/mo` : ''}. Rent billing starts.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyLeaseTerminated(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    tenantName: string;
    unitLabel?: string | null;
    terminatedOn?: Date | null;
    reason?: string | null;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'SALES'],
      projectId: p.projectId,
      type: NotificationType.LEASE_TERMINATED,
      title: `Lease terminated: ${p.tenantName}`,
      body: `${p.tenantName}'s lease${this.at(p.unitLabel)} in ${p.projectName ?? 'a project'} was terminated${
        p.terminatedOn ? ` on ${this.date(p.terminatedOn)}` : ''
      }${p.reason ? ` — ${p.reason}` : ''}. Settle the deposit and re-list the space.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyLeaseRentChanged(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    tenantName: string;
    unitLabel?: string | null;
    previousRent?: number | null;
    newRent: number;
    effectiveFrom?: Date | null;
  }) {
    const from = p.previousRent != null ? `${this.money(p.previousRent)} → ` : '';
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP'],
      projectId: p.projectId,
      type: NotificationType.LEASE_RENT_CHANGED,
      title: `Rent changed: ${p.tenantName}`,
      body: `Rent for ${p.tenantName}${this.at(p.unitLabel)} in ${p.projectName ?? 'a project'} changes ${from}${this.money(
        p.newRent,
      )}/mo${p.effectiveFrom ? ` effective ${this.date(p.effectiveFrom)}` : ''}.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyFreeRentEnding(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    tenantName: string;
    unitLabel?: string | null;
    freeRentEnd: Date;
    daysLeft: number;
    firstPayingRent?: number | null;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP'],
      projectId: p.projectId,
      type: NotificationType.FREE_RENT_ENDING_30,
      title: `Free rent ends in ${p.daysLeft}d: ${p.tenantName}`,
      body: `${p.tenantName}'s free-rent period${this.at(p.unitLabel)} in ${p.projectName ?? 'a project'} ends ${this.date(
        p.freeRentEnd,
      )}. First paying month follows${p.firstPayingRent != null ? ` at ${this.money(p.firstPayingRent)}/mo` : ''}.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyDepositOutstanding(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    obligationId: string;
    tenantName: string;
    unitLabel?: string | null;
    outstanding: number;
    daysOverdue: number;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP', 'SALES'],
      projectId: p.projectId,
      type: NotificationType.DEPOSIT_OUTSTANDING,
      title: `Deposit outstanding (${p.daysOverdue}d): ${p.tenantName}`,
      body: `${this.money(p.outstanding)} of ${p.tenantName}'s security deposit${this.at(p.unitLabel)} in ${
        p.projectName ?? 'a project'
      } is ${p.daysOverdue} day(s) past due.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyTiDisbursed(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    obligationId: string;
    tenantName: string;
    unitLabel?: string | null;
    amount: number;
    totalPaid?: number | null;
    totalAgreed?: number | null;
  }) {
    const progress =
      p.totalPaid != null && p.totalAgreed != null
        ? ` (${this.money(p.totalPaid)} of ${this.money(p.totalAgreed)} disbursed)`
        : '';
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING'],
      projectId: p.projectId,
      type: NotificationType.TI_DISBURSED,
      title: `TI disbursed: ${this.money(p.amount)} to ${p.tenantName}`,
      body: `A tenant-improvement allowance payment of ${this.money(p.amount)} was recorded for ${p.tenantName}${this.at(
        p.unitLabel,
      )} in ${p.projectName ?? 'a project'}${progress}.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  async notifyRentOverdue(p: {
    projectId: string;
    projectName?: string | null;
    leaseId: string;
    invoiceId: string;
    tenantName: string;
    unitLabel?: string | null;
    periodMonth: Date;
    amountOutstanding: number;
    daysOverdue: number;
  }) {
    await this.sendToRoles({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP'],
      projectId: p.projectId,
      type: NotificationType.RENT_OVERDUE,
      title: `Rent overdue (${p.daysOverdue}d): ${p.tenantName}`,
      body: `${this.money(p.amountOutstanding)} of ${p.tenantName}'s rent${this.at(p.unitLabel)} in ${
        p.projectName ?? 'a project'
      } for ${this.month(p.periodMonth)} is ${p.daysOverdue} day(s) overdue.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  // ---- Formatting helpers ----

  private at(unitLabel?: string | null) {
    return unitLabel ? ` at ${unitLabel}` : '';
  }

  private money(value: number) {
    return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  private date(value: Date) {
    return value.toLocaleDateString();
  }

  private month(value: Date) {
    return value.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // ---- Email Template ----

  private buildEmailHtml(params: { name: string; title: string; body: string; link?: string; baseUrl: string }) {
    const { name, title, body, link, baseUrl } = params;
    const btnHtml = link
      ? `<p style="margin-top:24px"><a href="${baseUrl}${link}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">View in Prime Tracker</a></p>`
      : '';
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:0">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:#1e40af;padding:24px 32px">
      <p style="color:#fff;font-size:18px;font-weight:700;margin:0">Prime Developers</p>
      <p style="color:#93c5fd;font-size:12px;margin:4px 0 0">Prime Tracker Platform</p>
    </div>
    <div style="padding:32px">
      <p style="color:#374151;font-size:14px;margin:0 0 8px">Hi ${name},</p>
      <h2 style="color:#111827;font-size:18px;margin:0 0 16px">${title}</h2>
      <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0">${body}</p>
      ${btnHtml}
    </div>
    <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
      <p style="color:#9ca3af;font-size:11px;margin:0">You received this because of your notification preferences. <a href="${baseUrl}/settings/notifications" style="color:#6b7280">Manage preferences</a></p>
    </div>
  </div>
</body>
</html>`;
  }
}

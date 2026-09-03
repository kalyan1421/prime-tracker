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
  // Addressed at one named person, unlike COMMENT_* which broadcasts to a department.
  // Being named is a request for a reply, so it emails by default.
  COMMENT_MENTION: 'ACTION',
  // ACTION, not FYI: it names one person and asks them to do something. An assignment
  // that lands in a digest nobody opens is the same as no assignment at all.
  TASK_ASSIGNED: 'ACTION',
  // ACTION, not FYI: a tenant occupying past their term is a commercial decision waiting
  // to be made (renew / end it / let it run), and it is costing or earning money either
  // way. A digest entry would be read too late.
  LEASE_HOLDOVER: 'ACTION',
  // ACTION for both halves: a pending request blocks somebody's work until it is decided,
  // and the answer is addressed at one named person.
  HISTORY_DELETION_REQUESTED: 'ACTION',
  HISTORY_DELETION_DECIDED: 'ACTION',
  // D2 — the permit/NOC has actually LAPSED and is still on file. Operating on a lapsed
  // permit is a stop-work risk and a compliance exposure, so it emails.
  DOCUMENT_EXPIRED: 'ACTION',
  // C3/C4 — a slip cascade is waiting for a decision. ACTION for the same reason
  // HISTORY_DELETION_REQUESTED is: it BLOCKS something. Until a PM approves or rejects,
  // the dependent milestones sit on dates everyone knows are wrong, and any lender draw
  // date in the cascade has not moved either. A digest entry read three days later is
  // three days of a schedule nobody can trust.
  MILESTONE_SLIP_PENDING_REVIEW: 'ACTION',
  // Update Board — addressed at one named person, same reasoning as COMMENT_MENTION and
  // TASK_ASSIGNED.
  UPDATE_BOARD_COMMENT_MENTION: 'ACTION',
  UPDATE_BOARD_ASSIGNED: 'ACTION',
  // Update Board — a standing condition (due date approaching/passed) on an open item,
  // same reasoning as PAYMENT_DUE_7/PAYMENT_OVERDUE.
  UPDATE_BOARD_DUE_SOON: 'ACTION',

  // ---- FYI: awareness only ----
  // FYI, deliberately. It is a standing condition on potentially dozens of units at once,
  // and emailing a daily list of quiet units is exactly the noise that trains people to
  // filter this sender — which would cost them the ACTION alerts too. In-app, where the
  // board already lives, unless someone opts in.
  SITE_UPDATE_STALE: 'FYI',
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
  // D2 — the countdown, not the lapse. FYI for the same reason LEASE_EXPIRING_30 is: it
  // fires at THREE horizons (60/30/7) for every document that carries a date, and a
  // portfolio holds a lot of permits. Emailing all of them is precisely the "filter the
  // whole sender to a folder" failure described above — at which point DOCUMENT_EXPIRED
  // goes with it. In-app on every horizon; anyone who wants the early warnings by mail
  // sets emailEnabled: true for this one type.
  DOCUMENT_EXPIRING: 'FYI',
  // FYI, deliberately: this is a broadcast to every internal user, not a request
  // addressed at one person. Emailing the whole company on every post is exactly the
  // "filter the sender to a folder" failure the tier system exists to prevent.
  UPDATE_BOARD_POSTED: 'FYI',
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

// ============================================================================
// Recurrence
//
// Two different things are called "a notification":
//
//   RECURRING — a standing CONDITION ("this invoice is overdue"). The daily cron
//               re-evaluates it and calls send() again on every run for as long as
//               the condition holds.
//   EVENT     — something that HAPPENED once ("Ravi commented on Unit 101").
//
// Only the first kind may be suppressed. An event is never a duplicate: two comments
// on the same unit produce the same title and are still two distinct things the user
// needs to see.
//
// This distinction was missing, so every cron run inserted a fresh unread row per
// still-overdue item. One run on 2026-07-29 created 2,185 rows — 215 rent alerts times
// ten recipients — and the next run would have done it again. From the user's side the
// bell is permanently red and "mark all as read" looks broken, because by the next
// morning the same alerts are back as new rows.
// ============================================================================

/** How long a read alert stays suppressed before the standing condition re-raises it. */
export const RENOTIFY_COOLDOWN_HOURS = 24 * 7;

export const RECURRING_TYPES = {
  // Cron-driven standing conditions — re-raised until resolved.
  MILESTONE_OVERDUE: true,
  LEASE_EXPIRING_30: true,
  LEASE_EXPIRING_7: true,
  LOAN_MATURITY_60: true,
  BUDGET_VARIANCE: true,
  PAYMENT_OVERDUE: true,
  PAYMENT_DUE_7: true,
  RENT_OVERDUE: true,
  DEPOSIT_OUTSTANDING: true,
  SNAG_OVERDUE: true,
  INTERIOR_HANDOVER_DUE: true,
  DRAW_FUNDING_OVERDUE: true,
  FREE_RENT_ENDING_30: true,
  // D2 — both halves are standing CONDITIONS the daily cron re-evaluates ("this permit
  // expires in 23 days" / "this permit lapsed 5 days ago"), so both need a dedupeKey or
  // they would notify every single morning forever. Keyed on the document:
  //   DOCUMENT_EXPIRING -> `document:<id>:<horizon>d`  (horizon in the key so crossing
  //                        60 -> 30 -> 7 is a genuinely new, more urgent alert)
  //   DOCUMENT_EXPIRED  -> `document:<id>`             (one condition that persists until
  //                        the document is renewed or removed)
  DOCUMENT_EXPIRING: true,
  DOCUMENT_EXPIRED: true,

  // Discrete events — always delivered, never deduplicated.
  COMMENT_FINANCIAL: false,
  COMMENT_SALES: false,
  COMMENT_MARKETING: false,
  COMMENT_MENTION: false,
  // Not recurring — an assignment happens once. Re-assigning fires a fresh event
  // because the recipient changed, not because the condition persisted.
  TASK_ASSIGNED: false,
  // RECURRING: the condition persists day after day until someone acts, so the daily
  // cron must be able to re-raise it. That makes a dedupeKey mandatory — see
  // Notification.dedupeKey — or it would notify every morning forever.
  LEASE_HOLDOVER: true,
  // Discrete: a request is raised once and decided once. Re-raising after a rejection is
  // a new request, not the same condition persisting.
  HISTORY_DELETION_REQUESTED: false,
  HISTORY_DELETION_DECIDED: false,
  // Discrete, and no cron re-raises it. A second slip on the same milestone SUPERSEDES the
  // pending proposal and is a genuinely different cascade over different dates — it must
  // reach the reviewer, so it must not be deduplicated against the one it replaced.
  MILESTONE_SLIP_PENDING_REVIEW: false,
  DRAW_REQUEST_SUBMITTED: false,
  DRAW_REQUEST_APPROVED: false,
  DRAW_REQUEST_FUNDED: false,
  LEAD_ASSIGNED: false,
  LEAD_STATUS_CHANGED: false,
  INTERIOR_PHASE_CHANGED: false,
  UNIT_SOLD: false,
  LEASE_ADDED: false,
  LEASE_ACTIVATED: false,
  LEASE_TERMINATED: false,
  LEASE_RENT_CHANGED: false,
  TI_DISBURSED: false,
  // Discrete events, same reasoning as COMMENT_MENTION/TASK_ASSIGNED: a post going up, a
  // mention, and a tagging each happen once.
  UPDATE_BOARD_POSTED: false,
  UPDATE_BOARD_COMMENT_MENTION: false,
  UPDATE_BOARD_ASSIGNED: false,
  // RECURRING: an open post's due date stays a live condition until it is done/cancelled
  // or the date changes, so the daily cron must be able to re-raise it. dedupeKey ->
  // `update-board:<postId>`.
  UPDATE_BOARD_DUE_SOON: true,
  // RECURRING: silence persists every morning until somebody posts. dedupeKey ->
  // `unit:<id>:stale`, so one quiet unit is one pending alert however long it stays quiet.
  SITE_UPDATE_STALE: true,
} as const satisfies Record<string, boolean>;

/** Same exhaustiveness guard as the tiers: a new type must be classified explicitly. */
type _UnclassifiedRecurrence = Exclude<NotificationType, keyof typeof RECURRING_TYPES>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _recurrenceIsExhaustive: [_UnclassifiedRecurrence] extends [never] ? true : never = true;

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
    /** Stable identity of the condition — required for RECURRING types. See Notification.dedupeKey. */
    dedupeKey?: string;
  }) {
    const { type, title, body, link, dedupeKey } = params;
    const userIds = [...new Set(params.userIds ?? [])];
    if (userIds.length === 0) return;

    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type },
      select: { userId: true, enabled: true, emailEnabled: true },
    });
    const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

    // `enabled` gates in-app delivery, and a muted type means muted entirely.
    const enabledUserIds = userIds.filter((id) => prefByUser.get(id)?.enabled !== false);
    if (enabledUserIds.length === 0) return;

    const targetUserIds = await this.suppressAlreadyPending(enabledUserIds, type, dedupeKey);
    if (targetUserIds.length === 0) return;

    // Create in-app notifications
    await this.prisma.notification.createMany({
      data: targetUserIds.map((userId) => ({ userId, type, title, body, link, dedupeKey })),
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
  /**
   * Drop recipients who already have this alert pending.
   *
   * Applies only to RECURRING types — a standing condition the cron re-evaluates every
   * run. A recipient is skipped when they hold the same (type, dedupeKey) alert that is
   * either still unread, or was read less than RENOTIFY_COOLDOWN_HOURS ago:
   *
   *   still unread  — a second identical row adds no information, it just inflates the
   *                   badge and buries everything else.
   *   read recently — they have seen it and are presumably acting on it. Re-raising the
   *                   same item every morning is what made "mark all as read" look
   *                   broken. After the cooldown it does re-raise, which is the point of
   *                   a standing alert: still overdue a week later is worth saying again.
   *
   * Matching is on dedupeKey, NEVER on title. Seven recurring types put a live day
   * counter in the title — "Rent overdue (29d): Mathnasium" is "(30d)" tomorrow — so a
   * title match silently never fired for exactly the types that produced the backlog.
   * A recurring type that reaches here without a key is a bug in its trigger, so it is
   * logged loudly and delivered rather than silently dropped or silently duplicated.
   *
   * EVENT types are never suppressed — see RECURRING_TYPES.
   */
  private async suppressAlreadyPending(
    userIds: string[],
    type: NotificationType,
    dedupeKey?: string,
  ): Promise<string[]> {
    if (!RECURRING_TYPES[type as keyof typeof RECURRING_TYPES]) return userIds;

    if (!dedupeKey) {
      this.logger.error(
        `Recurring notification ${type} sent without a dedupeKey — it will re-raise on ` +
          'every cron run. Add one to its notify* method.',
      );
      return userIds;
    }

    const cooldownStart = new Date(Date.now() - RENOTIFY_COOLDOWN_HOURS * 3_600_000);
    const pending = await this.prisma.notification.findMany({
      where: {
        userId: { in: userIds },
        type,
        dedupeKey,
        OR: [{ readAt: null }, { createdAt: { gte: cooldownStart } }],
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (pending.length === 0) return userIds;
    const suppressed = new Set(pending.map((p) => p.userId));
    return userIds.filter((id) => !suppressed.has(id));
  }

  async sendToRoles(params: {
    roles: string[];
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
    projectId?: string | null;
    /** Stable identity of the condition — required for RECURRING types. */
    dedupeKey?: string;
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
      dedupeKey: `milestone:${milestone.id}`,
      title: `Milestone Overdue: ${milestone.title}`,
      body: `The milestone "${milestone.title}" in project ${milestone.project.name} is now overdue.`,
      link,
    });
  }

  /**
   * C3/C4 — a slip cascade is waiting for a decision.
   *
   * `roles: ['PROJECT_MANAGER']` is the whole routing rule: resolveRecipients() adds
   * SUPER_ADMIN / FOUNDER / EXECUTIVE unconditionally as portfolio owners, so this is
   * exactly "the PM and admins" the client asked for, with the PM half filtered to the
   * people actually staffed on that project. `roles: []` (the LEASE_HOLDOVER trick) would
   * have reached leadership ONLY and dropped the one person who has to decide.
   *
   * The draw count is in the body on purpose. A lender-facing date moving is a different
   * category of decision from an internal one, and the reviewer must not have to open the
   * proposal to find out that this cascade contains one.
   */
  async notifyMilestoneSlipPendingReview(p: {
    proposalId: string;
    projectId: string;
    projectName: string | null;
    milestoneTitle: string;
    daysSlipped: number;
    /** Dependent milestones whose dates would move. Excludes the trigger. */
    affectedCount: number;
    /** Draw schedules whose plannedDate would move. */
    drawCount: number;
    requestedByName: string | null;
  }) {
    const who = p.requestedByName ?? 'Someone';
    const cascade =
      p.affectedCount === 0
        ? 'No dependent milestones are affected'
        : `${p.affectedCount} dependent milestone${p.affectedCount === 1 ? '' : 's'} would move `
          + `by the same ${p.daysSlipped} day${p.daysSlipped === 1 ? '' : 's'}`;
    const draws =
      p.drawCount > 0
        ? ` This cascade also moves ${p.drawCount} LENDER DRAW date${p.drawCount === 1 ? '' : 's'}.`
        : '';

    await this.sendToRoles({
      roles: ['PROJECT_MANAGER'],
      projectId: p.projectId,
      type: NotificationType.MILESTONE_SLIP_PENDING_REVIEW,
      title: `Schedule slip needs review — ${p.milestoneTitle}`,
      body:
        `${who} moved "${p.milestoneTitle}"${p.projectName ? ` in ${p.projectName}` : ''} out by `
        + `${p.daysSlipped} day${p.daysSlipped === 1 ? '' : 's'}. ${cascade}.${draws}`
        + ' Nothing downstream has changed yet — approve or reject the cascade.',
      link: `/projects/${p.projectId}/milestones`,
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
      dedupeKey: `snag:${snag.id}`,
      title: `Snag overdue: ${short}`,
      body: `A punch-list item${snag.interiorName ? ` in "${snag.interiorName}"` : ''} is ${snag.daysOverdue} day(s) overdue.`,
      link,
    });
  }

  /**
   * A tracked unit nobody has posted about for a week.
   *
   * `days` is the age of the SILENCE, not of the last update — for a unit nobody has ever
   * posted about it counts from when the unit joined the tracker. Both are genuinely "no
   * one has said anything for N days", which is what the recipient needs to know; a unit
   * that has never had an update is not a special case worth a second alert type.
   */
  async notifySiteUpdateStale(unit: {
    id: string;
    unitNumber: string;
    projectId: string;
    projectName?: string;
    days: number;
    everUpdated: boolean;
  }) {
    await this.sendToRoles({
      roles: ['PROJECT_MANAGER', 'CONSTRUCTION'],
      projectId: unit.projectId,
      type: NotificationType.SITE_UPDATE_STALE,
      dedupeKey: `unit:${unit.id}:stale`,
      title: `No site update on Unit ${unit.unitNumber} for ${unit.days} days`,
      body: unit.everUpdated
        ? `The last site update${unit.projectName ? ` in ${unit.projectName}` : ''} was ${unit.days} days ago.`
        : `It has been on the tracker ${unit.days} days${unit.projectName ? ` in ${unit.projectName}` : ''} with no site update at all.`,
      link: `/site-tracker?projectId=${unit.projectId}`,
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
      // Keyed on the lease's own id — `unitId` here is really "unitId ?? buildingId",
      // whichever side of the polymorphic link is set (see the caller). The 30-day and
      // 7-day alerts are separate types, so the same key in both is correct: crossing
      // the 7-day threshold is a genuinely new, more urgent alert and must get through.
      dedupeKey: `lease:${lease.unitId}`,
      title: `Lease Expiring in ${daysLeft} Days`,
      body: `${lease.tenantName}'s lease in ${lease.unit.building.project.name} expires on ${lease.leaseEnd.toLocaleDateString()}.`,
      link,
    });
  }

  /**
   * A tenant is occupying past their contracted end with no move-out recorded.
   *
   * `roles: []` targets LEADERSHIP ONLY — sendToRoles adds SUPER_ADMIN / FOUNDER /
   * EXECUTIVE unconditionally as portfolio owners, so an empty list is exactly the
   * audience the client asked for. Not routed to FINANCE: the decision here is
   * commercial (renew / end it / let it run), not a collections task.
   */
  async notifyLeaseHoldover(lease: {
    id: string;
    tenantName: string;
    leaseEnd: Date;
    daysOver: number;
    projectId: string;
    projectName: string;
    /** Null (the default) means holdover rent is NOT being billed — see below. */
    holdoverRatePct?: number | null;
  }) {
    // The billing half of this message has to match what the invoicer actually does.
    // LeaseRentInvoiceService.holdoverExtension bails on `holdoverRatePct == null`, and
    // null is the DOCUMENTED DEFAULT — so on most holdovers no rent is generated at all.
    // This alert used to assert "rent is being billed at the holdover rate" in every
    // case, which told leadership the money was being collected on precisely the leases
    // where it silently was not. The cron fires for both cases (it matches on the term
    // being past, not on the rate), so the copy is what has to distinguish them.
    const rate = lease.holdoverRatePct;
    const billing =
      rate != null
        ? `Rent is being billed at ${rate}% of the last contracted rent.`
        : 'NO rent is being billed for these months — this lease has no holdover rate set, '
          + 'and one must be set on the lease before any holdover rent will be generated.';

    await this.sendToRoles({
      roles: [],
      projectId: lease.projectId,
      type: NotificationType.LEASE_HOLDOVER,
      // RECURRING, so this key is what stops it firing every single morning. Keyed on the
      // lease, because the condition is "this lease is in holdover" and it persists until
      // someone ends or extends it.
      dedupeKey: `holdover:${lease.id}`,
      title: `Holdover — ${lease.tenantName}`,
      body:
        `${lease.tenantName} is still in occupation ${lease.daysOver} days after their term `
        + `ended on ${lease.leaseEnd.toLocaleDateString()} (${lease.projectName}). `
        + `${billing} End the tenancy or extend the lease.`,
      link: `/projects/${lease.projectId}/revenue`,
    });
  }

  /**
   * R27 — a backfilled tenancy has been put up for deletion.
   *
   * Routed to leadership by ROLE rather than by project membership: the gate exists so a
   * Founder looks, and a Founder who happens not to be on that project is still the right
   * person to look.
   */
  async notifyHistoryDeletionRequested(params: {
    requestId: string;
    projectId: string | null;
    label: string; // tenant name for a lease, buyer for a sale
    unitLabel: string | null;
    reason: string;
    requestedByName: string | null;
    link: string | null;
  }) {
    await this.sendToRoles({
      roles: [...LEADERSHIP_ROLES],
      projectId: null,
      type: NotificationType.HISTORY_DELETION_REQUESTED,
      title: `Deletion requested — ${params.label}`,
      body:
        `${params.requestedByName ?? 'Someone'} asked to delete the recorded history for `
        + `${params.label}${params.unitLabel ? ` (${params.unitLabel})` : ''}. `
        + `Reason: “${params.reason}”. This history was typed in from records, so it `
        + `cannot be rebuilt — approve or reject it on the unit.`,
      link: params.link ?? undefined,
    });
  }

  /** The answer, back to whoever asked. */
  async notifyHistoryDeletionDecided(params: {
    requestedById: string;
    label: string;
    approved: boolean;
    note?: string | null;
    link: string | null;
  }) {
    await this.send({
      userIds: [params.requestedById],
      type: NotificationType.HISTORY_DELETION_DECIDED,
      title: params.approved
        ? `Approved — you can delete ${params.label}'s record`
        : `Rejected — ${params.label}'s record stays`,
      body: params.approved
        ? `A Founder approved your deletion request. The record is still there; deleting `
          + `it is a separate step, so nothing has been removed yet.`
          + (params.note ? ` Note: “${params.note}”` : '')
        : `A Founder rejected your deletion request and the record is unchanged.`
          + (params.note ? ` Note: “${params.note}”` : ''),
      link: params.link ?? undefined,
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
      dedupeKey: `loan:${loan.id}`,
      title: `Loan Maturing in 60 Days`,
      body: `A loan in project ${loan.project.name} matures on ${loan.maturityDate.toLocaleDateString()}.`,
      link,
    });
  }

  /**
   * D2 — document expiry.
   *
   * Routing: CONSTRUCTION / PROJECT_MANAGER / LEGAL. These are the people who actually
   * renew a permit, chase an NOC, or read a possession certificate. Deliberately NOT
   * `roles: []` — that form means LEADERSHIP ONLY (sendToRoles adds SUPER_ADMIN / FOUNDER /
   * EXECUTIVE unconditionally as portfolio owners), which would tell the founders a permit
   * is lapsing and tell nobody who can do anything about it. Leadership still receives
   * these on top, via that unconditional add.
   */
  private static readonly DOCUMENT_EXPIRY_ROLES = ['CONSTRUCTION', 'PROJECT_MANAGER', 'LEGAL'];

  /** Link to wherever the document is filed; null when it hangs off no project. */
  private documentLink(projectId?: string | null): string | undefined {
    return projectId ? `/projects/${projectId}/documents` : undefined;
  }

  /**
   * A document with an expiry date is approaching it. Fired once per horizon (60 / 30 / 7),
   * never daily — see the dedupeKey.
   */
  async notifyDocumentExpiring(doc: {
    id: string;
    fileName: string;
    category: string;
    expiresAt: Date;
    daysLeft: number;
    /** Which horizon bucket this alert belongs to. Part of the dedupe key. */
    horizonDays: number;
    projectId?: string | null;
    projectName?: string | null;
  }) {
    const where = doc.projectName ? ` (${doc.projectName})` : '';
    await this.sendToRoles({
      roles: NotificationsService.DOCUMENT_EXPIRY_ROLES,
      projectId: doc.projectId,
      type: NotificationType.DOCUMENT_EXPIRING,
      // RECURRING. The horizon is IN the key so the same document alerts once per bucket:
      // stable within a bucket (it does not re-fire every morning), and a new key the
      // moment it crosses into a tighter one, which is the escalation getting through.
      // The day count lives only in the title — never in the key, because a title that
      // counts down changes daily and would defeat the dedupe entirely.
      dedupeKey: `document:${doc.id}:${doc.horizonDays}d`,
      title: `${doc.category.replace(/_/g, ' ')} expires in ${doc.daysLeft} day(s): ${doc.fileName}`,
      body:
        `"${doc.fileName}"${where} expires on ${doc.expiresAt.toLocaleDateString()} `
        + `— ${doc.daysLeft} day(s) away. Start the renewal now if it is still needed; `
        + `clear the expiry date on the document if it is not.`,
      link: this.documentLink(doc.projectId),
    });
  }

  /**
   * The date has PASSED and the document is still on file.
   *
   * A separate type from DOCUMENT_EXPIRING rather than the same one escalating, because
   * muting is per-type: the 60-day warning is the one somebody eventually turns off, and
   * turning it off must not silence the alert that a permit has actually lapsed. It is
   * also the reason the tiers differ — this one emails, the countdown does not.
   *
   * No lookback bound, deliberately, mirroring checkHoldovers: a permit four months lapsed
   * is MORE worth surfacing than one lapsed a week ago, not less.
   */
  async notifyDocumentExpired(doc: {
    id: string;
    fileName: string;
    category: string;
    expiresAt: Date;
    daysOverdue: number;
    projectId?: string | null;
    projectName?: string | null;
  }) {
    const where = doc.projectName ? ` (${doc.projectName})` : '';
    await this.sendToRoles({
      roles: NotificationsService.DOCUMENT_EXPIRY_ROLES,
      projectId: doc.projectId,
      type: NotificationType.DOCUMENT_EXPIRED,
      // One standing condition per document — it persists until the document is renewed,
      // re-dated or removed, so no bucket suffix. Keyed on the document, not the title,
      // which carries a live day counter.
      dedupeKey: `document:${doc.id}`,
      title: `EXPIRED ${doc.category.replace(/_/g, ' ')}: ${doc.fileName}`,
      body:
        `"${doc.fileName}"${where} expired on ${doc.expiresAt.toLocaleDateString()} `
        + `— ${doc.daysOverdue} day(s) ago and it is still on file. Upload the renewed `
        + `document and set its new expiry, or remove it if it no longer applies.`,
      link: this.documentLink(doc.projectId),
    });
  }

  async notifyNewComment(comment: {
    commentType: string;
    content: string;
    projectId?: string;
    projectName?: string;
    unit?: { building: { project: { id: string; name: string } } };
  }) {
    const typeMap: Record<string, { roles: string[]; notifType: NotificationType }> = {
      FINANCIAL: { roles: ['FINANCE', 'ACCOUNTING'], notifType: NotificationType.COMMENT_FINANCIAL },
      SALES: { roles: ['SALES'], notifType: NotificationType.COMMENT_SALES },
      MARKETING: { roles: ['SALES', 'MARKETING'], notifType: NotificationType.COMMENT_MARKETING },
    };
    const cfg = typeMap[comment.commentType];
    if (!cfg) return;
    const projId = comment.projectId || comment.unit?.building?.project?.id;
    // A project-level comment has no `unit`, so reading the name only off the unit path
    // made every one of them say "in a project". Callers pass projectName directly.
    const projName =
      comment.projectName || comment.unit?.building?.project?.name || 'a project';
    await this.sendToRoles({
      roles: cfg.roles,
      projectId: projId,
      type: cfg.notifType,
      title: `New ${comment.commentType.charAt(0) + comment.commentType.slice(1).toLowerCase()} Comment`,
      body: `A new ${comment.commentType.toLowerCase()} comment was added in ${projName}: "${comment.content.slice(0, 80)}${comment.content.length > 80 ? '…' : ''}"`,
      link: projId ? `/projects/${projId}/comments` : undefined,
    });
  }

  /**
   * Someone was named in a comment.
   *
   * Sent directly to the mentioned users rather than through sendToRoles: being named is
   * personal, so it must reach them whether or not they hold the role that comment's
   * department routes to, and whether or not they are a member of that project. The
   * author is excluded — mentioning yourself is not a request for your own attention.
   */
  async notifyCommentMention(params: {
    mentionedUserIds: string[];
    authorId: string;
    authorName: string;
    content: string;
    where: string;
    link?: string;
  }) {
    const recipients = params.mentionedUserIds.filter((id) => id !== params.authorId);
    if (recipients.length === 0) return;

    const excerpt =
      params.content.length > 140 ? `${params.content.slice(0, 140)}…` : params.content;

    await this.send({
      userIds: recipients,
      type: NotificationType.COMMENT_MENTION,
      title: `${params.authorName} mentioned you`,
      body: `In ${params.where}: "${excerpt}"`,
      link: params.link,
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
      dedupeKey: `draw:${p.projectId}:${p.drawNumber}`,
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
      dedupeKey: `project:${projectId}`,
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
      dedupeKey: `salePayment:${p.saleId}:${p.label}`,
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
      dedupeKey: `salePayment:${p.saleId}:${p.label}`,
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
      }${p.reason ? ` — ${p.reason}` : ''}. ${this.tenancyEndAdvice(p.reason)}`,
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
      dedupeKey: `lease:${p.leaseId}`,
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
      dedupeKey: `lease:${p.leaseId}`,
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
      dedupeKey: `rentInvoice:${p.invoiceId}`,
      title: `Rent overdue (${p.daysOverdue}d): ${p.tenantName}`,
      body: `${this.money(p.amountOutstanding)} of ${p.tenantName}'s rent${this.at(p.unitLabel)} in ${
        p.projectName ?? 'a project'
      } for ${this.month(p.periodMonth)} is ${p.daysOverdue} day(s) overdue.`,
      link: `/projects/${p.projectId}/revenue`,
    });
  }

  // ---- Update Board (Phase 2) ----
  //
  // POSTED/COMMENT_MENTION/ASSIGNED are request-driven (fired inline from
  // UpdateBoardService on create/comment/assign, same as TasksService.notifyAssigned/
  // notifyMentions) and do not live here. DUE_SOON is the one CRON-driven trigger, so it
  // gets a named method like every other scheduled check in this file — but unlike those,
  // recipients are the post's own assignees/creator, not a role/project lookup, so this
  // takes explicit userIds rather than going through sendToRoles.

  async notifyUpdateBoardDueSoon(p: {
    postId: string;
    title: string;
    userIds: string[];
    dueDate: Date;
    isOverdue: boolean;
  }) {
    if (p.userIds.length === 0) return;
    await this.send({
      userIds: p.userIds,
      type: NotificationType.UPDATE_BOARD_DUE_SOON,
      // RECURRING — this is what stops it firing every morning while the post stays open.
      dedupeKey: `update-board:${p.postId}`,
      title: p.isOverdue
        ? `Update overdue: ${p.title}`
        : `Update due ${this.date(p.dueDate)}: ${p.title}`,
      body: p.isOverdue
        ? `"${p.title}" was due ${this.date(p.dueDate)} and is still open.`
        : `"${p.title}" is due ${this.date(p.dueDate)}.`,
      link: '/updates',
    });
  }

  // ---- Formatting helpers ----

  /**
   * What to actually do about a tenancy that just ended — which is not the same sentence
   * in every case.
   *
   * This used to read "Settle the deposit and re-list the space" unconditionally. That is
   * wrong for both sale-driven endings: a SOLD unit is never re-listed. It has been
   * misfiring on TENANT_BOUGHT since that path shipped, and the third-party transfer path
   * would have inherited it.
   */
  private tenancyEndAdvice(reason?: string | null): string {
    if (reason === 'TENANT_BOUGHT') {
      // The tenant is now the owner, so there is no space to re-let. The deposit is still
      // live money and still has to be settled — often against the purchase price.
      return 'The tenant has bought the unit, so it is not returning to the market. Settle the deposit.';
    }
    if (reason === 'LEASE_TRANSFERRED_WITH_SALE') {
      // Prime no longer owns the unit OR manages the tenancy. Nothing to re-list, and the
      // deposit is the new owner's problem to take on — which is a handover, not a refund.
      return 'The unit was sold with the tenant in place — the tenancy continues with the new owner. '
        + 'Confirm the deposit is handed over and stop billing this lease.';
    }
    return 'Settle the deposit and re-list the space.';
  }

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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { Mailer, createMailer } from './mailer';
import { NotificationsGateway } from './notifications.gateway';

const ALL_TYPES = Object.values(NotificationType);

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

  // ---- Core: send in-app + optional email ----

  async send(params: {
    userIds: string[];
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
    projectName?: string;
  }) {
    const { userIds, type, title, body, link } = params;

    // Filter by user preferences
    const enabled = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type, enabled: false },
    });
    const disabledUserIds = new Set(enabled.map((p) => p.userId));
    const targetUserIds = userIds.filter((id) => !disabledUserIds.has(id));

    if (targetUserIds.length === 0) return;

    // Create in-app notifications
    await this.prisma.notification.createMany({
      data: targetUserIds.map((userId) => ({ userId, type, title, body, link })),
    });

    // Push real-time to connected clients
    for (const uid of targetUserIds) {
      this.gateway?.emitToUser(uid, 'notification', { type, title, body, link });
    }

    // Send emails
    if (this.mailer) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: targetUserIds }, isActive: true },
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
  }

  async sendToRoles(params: {
    roles: string[];
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
  }) {
    const users = await this.prisma.user.findMany({
      where: { role: { in: params.roles as any }, isActive: true },
      select: { id: true },
    });
    await this.send({ ...params, userIds: users.map((u) => u.id) });
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

  async getPreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const map = new Map(existing.map((p) => [p.type, p.enabled]));
    return ALL_TYPES.map((type) => ({ type, enabled: map.get(type) ?? true }));
  }

  async setPreference(userId: string, type: NotificationType, enabled: boolean) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, enabled },
      update: { enabled },
    });
  }

  // ---- Named Triggers (called from other services) ----

  async notifyMilestoneOverdue(milestone: { id: string; title: string; projectId: string; project: { name: string } }) {
    const link = `/projects/${milestone.projectId}/milestones`;
    await this.sendToRoles({
      roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'PROJECT_MANAGER'],
      type: NotificationType.MILESTONE_OVERDUE,
      title: `Milestone Overdue: ${milestone.title}`,
      body: `The milestone "${milestone.title}" in project ${milestone.project.name} is now overdue.`,
      link,
    });
  }

  async notifySnagOverdue(snag: { id: string; description: string; interiorProjectId: string; interiorName?: string; daysOverdue: number }) {
    const link = `/interior/${snag.interiorProjectId}`;
    const short = snag.description.length > 50 ? `${snag.description.slice(0, 50)}…` : snag.description;
    await this.sendToRoles({
      roles: ['SUPER_ADMIN', 'FOUNDER', 'PROJECT_MANAGER', 'CONSTRUCTION'],
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
      roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'],
      type: daysLeft <= 7 ? NotificationType.LEASE_EXPIRING_7 : NotificationType.LEASE_EXPIRING_30,
      title: `Lease Expiring in ${daysLeft} Days`,
      body: `${lease.tenantName}'s lease in ${lease.unit.building.project.name} expires on ${lease.leaseEnd.toLocaleDateString()}.`,
      link,
    });
  }

  async notifyLoanMaturity(loan: { id: string; lender: string; maturityDate: Date; projectId: string; project: { name: string } }) {
    // Loans and their draws live in the Draws tab; `financials` is not a real tab.
    const link = `/projects/${loan.projectId}/draws`;
    await this.sendToRoles({
      roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'],
      type: NotificationType.LOAN_MATURITY_60,
      title: `Loan Maturing in 60 Days`,
      body: `A loan in project ${loan.project.name} matures on ${loan.maturityDate.toLocaleDateString()}.`,
      link,
    });
  }

  async notifyNewComment(comment: { commentType: string; content: string; projectId?: string; unit?: { building: { project: { id: string; name: string } } } }) {
    const typeMap: Record<string, { roles: string[]; notifType: NotificationType }> = {
      FINANCIAL: { roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'], notifType: NotificationType.COMMENT_FINANCIAL },
      SALES: { roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'SALES'], notifType: NotificationType.COMMENT_SALES },
      MARKETING: { roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'SALES', 'MARKETING'], notifType: NotificationType.COMMENT_MARKETING },
    };
    const cfg = typeMap[comment.commentType];
    if (!cfg) return;
    const projId = comment.projectId || comment.unit?.building?.project?.id;
    const projName = comment.unit?.building?.project?.name || 'a project';
    await this.sendToRoles({
      roles: cfg.roles,
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
      SUBMITTED: { type: NotificationType.DRAW_REQUEST_SUBMITTED, roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE'], verb: 'submitted for approval' },
      APPROVED:  { type: NotificationType.DRAW_REQUEST_APPROVED,  roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'], verb: 'approved' },
      FUNDED:    { type: NotificationType.DRAW_REQUEST_FUNDED,    roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'], verb: 'funded' },
    };
    const cfg = config[draw.status];
    if (!cfg) return;
    await this.sendToRoles({
      roles: cfg.roles,
      type: cfg.type,
      title: `Draw Request ${draw.status === 'SUBMITTED' ? 'Needs Approval' : draw.status}`,
      body: `Draw #${draw.drawNumber} for project ${draw.project.name} has been ${cfg.verb}.`,
      link: `/projects/${draw.projectId}/draws`,
    });
  }

  async notifyBudgetVariance(projectId: string, projectName: string, variancePct: number) {
    await this.sendToRoles({
      roles: ['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING'],
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
      roles: ['SUPER_ADMIN', 'FOUNDER', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'SALES'],
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
      roles: ['SUPER_ADMIN', 'FOUNDER', 'FINANCE', 'ACCOUNTING', 'AR_AP', 'SALES'],
      type: NotificationType.PAYMENT_DUE_7,
      title: `Payment due in ${p.daysLeft}d: ${p.label}`,
      body: `Installment "${p.label}" for ${p.buyer ?? 'a buyer'} in ${p.projectName ?? 'a project'} is due in ${p.daysLeft} day(s).`,
      link: `/projects/${p.projectId}/revenue`,
    });
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

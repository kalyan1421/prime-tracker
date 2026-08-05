import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { EncryptionService } from '../../common/encryption/encryption.service';

/**
 * Exception aggregator — the data source for the dashboard "Needs Attention" feed.
 *
 * Pulls in real exception items from across the system:
 *   - Overdue milestones
 *   - Stale available units (>90 days)
 *   - Draws past expected funding date
 *   - Draws awaiting internal approval (also the "Pending Approvals" surface)
 *   - Budget categories over threshold
 *   - Leases expiring within 30 days
 *   - Sales with no activity 14+ days
 *
 * Severity:  critical (red), warning (amber), info (blue)
 *
 * Cached briefly so a dashboard refresh doesn't hammer the DB.
 */

export type ExceptionSeverity = 'critical' | 'warning' | 'info';

export interface ExceptionItem {
  id: string;            // stable id per exception (used as React key)
  severity: ExceptionSeverity;
  category: string;      // 'milestone' | 'unit' | 'draw' | 'budget' | 'lease' | 'sale'
  title: string;
  detail?: string;
  meta?: string;         // e.g. project name
  href?: string;         // suggested navigation target
  createdAt?: Date;      // for sort
}

const TTL = 60;
const TAG = 'exceptions';

@Injectable()
export class ExceptionsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private encryption: EncryptionService,
  ) {}

  /**
   * Lender is AES-encrypted, so it must be rehydrated before being interpolated into
   * exception text — otherwise these read "...funding from undefined". Falls back to a
   * neutral label rather than an empty string if a row cannot be decrypted.
   */
  private lenderName(loan: { lender?: string | null; encryptedFields?: string | null } | null): string {
    if (!loan) return 'the lender';
    return this.encryption.decryptLoan(loan).lender || 'the lender';
  }

  invalidate() { this.cache.invalidateTag(TAG); }

  async forPortfolio(perms: string[] = []): Promise<ExceptionItem[]> {
    const all = await this.cache.wrap('exceptions:portfolio', TTL, () => this.compute(undefined), { tags: [TAG] });
    return this.filterByPermissions(all, perms);
  }

  async forProject(projectId: string, perms: string[] = []): Promise<ExceptionItem[]> {
    const all = await this.cache.wrap(`exceptions:project:${projectId}`, TTL, () => this.compute(projectId), { tags: [TAG] });
    return this.filterByPermissions(all, perms);
  }

  /**
   * Drop exception categories the viewer isn't allowed to see — the feed carries
   * lender/buyer/tenant names, so a Viewer/PM must not receive draw/sale/lease items
   * their role can't otherwise access. Applied per-request AFTER the cache so the
   * expensive compute() stays shared and permission-agnostic (no cache-key blowup).
   */
  private filterByPermissions(items: ExceptionItem[], perms: string[]): ExceptionItem[] {
    const can = (p: string) => perms.includes(p);
    return items.filter((it) => {
      switch (it.category) {
        case 'draw':  return can('draw:view') || can('financial:view');
        case 'sale':  return can('sales:view');
        case 'lease': return can('lease:view');
        // milestone / unit — visible to anyone with the baseline project:view the route requires.
        default:      return true;
      }
    });
  }

  /** Compute exceptions, scoped to one project or the whole portfolio. */
  private async compute(projectId?: string): Promise<ExceptionItem[]> {
    const projectFilter = projectId ? { projectId } : {};
    const projectFilterUnit = projectId ? { building: { projectId } } : {};
    const out: ExceptionItem[] = [];

    // ─── Overdue milestones ───
    const overdue = await this.prisma.milestone.findMany({
      where: { status: 'OVERDUE', ...projectFilter },
      select: { id: true, title: true, dueDate: true, projectId: true, project: { select: { name: true } } },
      take: 50,
    });
    for (const m of overdue) {
      const daysLate = Math.max(0, Math.floor((Date.now() - m.dueDate.getTime()) / 86_400_000));
      out.push({
        id: `milestone-${m.id}`,
        severity: daysLate > 14 ? 'critical' : 'warning',
        category: 'milestone',
        title: `Overdue: ${m.title}`,
        detail: `${daysLate} day${daysLate === 1 ? '' : 's'} past due`,
        meta: m.project.name,
        href: `/projects/${m.projectId}/milestones`,
        createdAt: m.dueDate,
      });
    }

    // ─── Stale available units ───
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    const stale = await this.prisma.unit.findMany({
      where: { status: 'AVAILABLE', availableSince: { lt: cutoff }, deletedAt: null, ...projectFilterUnit },
      select: {
        id: true, unitNumber: true, availableSince: true,
        building: { select: { name: true, project: { select: { id: true, name: true } } } },
      },
      take: 30,
    });
    for (const u of stale) {
      const days = Math.floor((Date.now() - (u.availableSince?.getTime() ?? Date.now())) / 86_400_000);
      out.push({
        id: `unit-${u.id}`,
        severity: days > 180 ? 'critical' : 'warning',
        category: 'unit',
        title: `Unit ${u.unitNumber} stale (${days}d)`,
        detail: `Available since ${u.availableSince?.toLocaleDateString()} — review price?`,
        meta: u.building.project.name,
        href: `/projects/${u.building.project.id}/units/${u.id}`,
        createdAt: u.availableSince ?? undefined,
      });
    }

    // ─── Draws past expected funding ───
    const overdueDraws = await this.prisma.drawRequest.findMany({
      where: {
        status: 'APPROVED', fundedAt: null,
        expectedFundingDate: { lt: new Date() },
        ...projectFilter,
      },
      select: {
        id: true, drawNumber: true, expectedFundingDate: true, projectId: true,
        loan: { select: { lender: true, encryptedFields: true } },
        project: { select: { name: true } },
      },
      take: 20,
    });
    for (const d of overdueDraws) {
      const days = Math.floor((Date.now() - (d.expectedFundingDate?.getTime() ?? Date.now())) / 86_400_000);
      out.push({
        id: `draw-${d.id}`,
        severity: days > 7 ? 'critical' : 'warning',
        category: 'draw',
        title: `Draw #${d.drawNumber} funding overdue`,
        detail: `${days} day${days === 1 ? '' : 's'} past expected funding from ${this.lenderName(d.loan)}`,
        meta: d.project?.name,
        href: d.projectId ? `/projects/${d.projectId}/draws` : undefined,
        createdAt: d.expectedFundingDate ?? undefined,
      });
    }

    // ─── Draws awaiting internal approval ───
    const pendingApproval = await this.prisma.drawRequest.findMany({
      where: { status: 'SUBMITTED', ...projectFilter },
      select: {
        id: true, drawNumber: true, requestDate: true, projectId: true,
        loan: { select: { lender: true, encryptedFields: true } },
        project: { select: { name: true } },
      },
      take: 20,
    });
    for (const d of pendingApproval) {
      const days = Math.floor((Date.now() - d.requestDate.getTime()) / 86_400_000);
      out.push({
        id: `draw-pending-${d.id}`,
        severity: days > 3 ? 'warning' : 'info',
        category: 'draw',
        title: `Draw #${d.drawNumber} awaiting approval`,
        detail: `Submitted ${days} day${days === 1 ? '' : 's'} ago from ${this.lenderName(d.loan)} — needs internal sign-off`,
        meta: d.project?.name,
        href: d.projectId ? `/projects/${d.projectId}/draws` : undefined,
        createdAt: d.requestDate,
      });
    }

    // ─── Leases expiring soon (next 30 days) ───
    const soon = new Date(Date.now() + 30 * 86_400_000);
    const expiringLeases = await this.prisma.lease.findMany({
      where: { status: 'ACTIVE', leaseEnd: { lt: soon, gt: new Date() }, deletedAt: null, unit: projectFilterUnit },
      select: {
        id: true, leaseEnd: true, tenantName: true,
        unit: { select: { id: true, unitNumber: true, building: { select: { project: { select: { id: true, name: true } } } } } },
      },
      take: 20,
    });
    for (const l of expiringLeases) {
      // Post-Sprint 1, a Lease may attach to a Building rather than a Unit
      // (e.g. Leander Bldg 1 leased whole). Skip building-only leases from the
      // per-unit exception view — they should be surfaced separately if needed.
      if (!l.unit) continue;
      const days = Math.floor((l.leaseEnd.getTime() - Date.now()) / 86_400_000);
      out.push({
        id: `lease-${l.id}`,
        severity: days < 7 ? 'critical' : 'warning',
        category: 'lease',
        title: `Lease expiring: Unit ${l.unit.unitNumber}`,
        detail: `${l.tenantName} — ${days} day${days === 1 ? '' : 's'} remaining`,
        meta: l.unit.building.project.name,
        href: `/projects/${l.unit.building.project.id}/units/${l.unit.id}`,
        createdAt: l.leaseEnd,
      });
    }

    // ─── Sales with activity drought (14+ days) ───
    const droughtCutoff = new Date(Date.now() - 14 * 86_400_000);
    const drySales = await this.prisma.sale.findMany({
      where: {
        status: { in: ['PROSPECT', 'LOI_SIGNED', 'UNDER_CONTRACT'] },
        deletedAt: null,
        OR: [
          { lastActivityAt: { lt: droughtCutoff } },
          { lastActivityAt: null, updatedAt: { lt: droughtCutoff } },
        ],
        ...projectFilter,
      },
      select: {
        id: true, status: true, buyer: true, lastActivityAt: true, updatedAt: true,
        project: { select: { id: true, name: true } },
      },
      take: 20,
    });
    for (const s of drySales) {
      const since = s.lastActivityAt ?? s.updatedAt;
      const days = Math.floor((Date.now() - since.getTime()) / 86_400_000);
      out.push({
        id: `sale-${s.id}`,
        severity: days > 30 ? 'warning' : 'info',
        category: 'sale',
        title: `${s.buyer || 'Unnamed buyer'} cold (${days}d)`,
        detail: `In ${s.status.replace(/_/g, ' ')} with no activity`,
        meta: s.project.name,
        href: `/projects/${s.project.id}/sales`,
        createdAt: since,
      });
    }

    // Sort: critical first, then warning, then info; within same severity newest first
    const sevRank = { critical: 0, warning: 1, info: 2 };
    out.sort((a, b) => {
      if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
      return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    });

    return out;
  }
}

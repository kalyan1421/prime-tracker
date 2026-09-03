import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The unit's life story, server-side.
 *
 * This replaces a client-side derivation in UnitDetailPage (`buildUnitHistory`) that
 * inferred vacancy from the gap between two ENDED leases. That inference had three
 * holes it could not close from lease rows alone:
 *
 *   - the vacancy BEFORE the first lease (initial lease-up) was invisible;
 *   - the vacancy happening RIGHT NOW was invisible, because there is no later lease
 *     to measure the gap against;
 *   - a unit that went vacant without a lease ever existing had no history at all.
 *
 * Vacancy here is read from `unit_status_events` instead, which records every
 * transition whether or not a lease was involved. The lease/sale rows still supply
 * the narrative detail; the event log supplies the clock.
 */

// ---------------------------------------------------------------------------
// Occupancy windows — pure, and deliberately exported for testing.
// ---------------------------------------------------------------------------

/** What a unit was DOING during a window, collapsed from the seven UnitStatus values. */
export type OccupancyKind = 'VACANT' | 'LEASED' | 'SOLD' | 'RESERVED' | 'CONSTRUCTION';

export interface OccupancyWindow {
  kind: OccupancyKind;
  status: UnitStatus;
  start: Date;
  /** Null while the window is still open. */
  end: Date | null;
  isOngoing: boolean;
  durationDays: number;
}

export function classifyStatus(status: UnitStatus): OccupancyKind {
  switch (status) {
    case 'AVAILABLE':
      return 'VACANT';
    case 'LEASED':
    case 'OCCUPIED':
      return 'LEASED';
    case 'SOLD':
      return 'SOLD';
    case 'UNDER_CONTRACT':
    case 'LEASE_PENDING':
      return 'RESERVED';
    case 'UNDER_CONSTRUCTION':
      return 'CONSTRUCTION';
    default:
      return 'RESERVED';
  }
}

/**
 * Can this unit be "vacant" at all?
 *
 * Vacancy is a LEASING fact — "the unit was on the market and earning nothing". Once it
 * is SOLD it is not Prime's to let, so the gaps between its old tenancies stop being a
 * story about lost rent and become noise on a record whose ending is the sale (client,
 * 2026-09-02).
 *
 * Exported and pure so the timeline entries and the summary tiles ask the SAME question.
 * They are computed in two different places, and a card whose tile says "Total vacant:
 * 214 days" above a timeline showing no vacancy at all is the two halves contradicting
 * each other.
 */
export function unitCanBeVacant(status: UnitStatus): boolean {
  return status !== 'SOLD';
}

const MS_PER_DAY = 86_400_000;

export function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / MS_PER_DAY));
}

export interface TimelineEventInput {
  toStatus: UnitStatus;
  effectiveAt: Date;
  recordedAt: Date;
}

/**
 * Turn the event log into contiguous windows.
 *
 * Each event opens a window that runs until the next event, or until `now` for the
 * last one. Sorted by effectiveAt with recordedAt as the tiebreak, because backfilled
 * events arrive out of chronological order — the real-world date is what orders the
 * story, and the write order only settles ties within the same instant.
 *
 * Zero-length windows are dropped: two events at the same instant mean a correction
 * or a rapid double-flip, and a window the unit spent no time in is noise.
 */
export function buildOccupancyWindows(
  events: TimelineEventInput[],
  now: Date = new Date(),
): OccupancyWindow[] {
  const sorted = [...events].sort((a, b) => {
    const d = a.effectiveAt.getTime() - b.effectiveAt.getTime();
    return d !== 0 ? d : a.recordedAt.getTime() - b.recordedAt.getTime();
  });

  const windows: OccupancyWindow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const next = sorted[i + 1];
    const isOngoing = !next;
    const end = next ? next.effectiveAt : null;
    // An event dated in the future (mis-keyed date) would otherwise produce a
    // negative-length trailing window; clamp to zero via daysBetween.
    const effectiveEnd = end ?? now;
    const durationDays = daysBetween(e.effectiveAt, effectiveEnd);

    if (!isOngoing && durationDays === 0 && end && end.getTime() <= e.effectiveAt.getTime()) {
      continue;
    }

    windows.push({
      kind: classifyStatus(e.toStatus),
      status: e.toStatus,
      start: e.effectiveAt,
      end,
      isOngoing,
      durationDays,
    });
  }
  return windows;
}

export interface OccupancySummary {
  totalDaysVacant: number;
  totalDaysLeased: number;
  totalDaysSold: number;
  /** Days in the currently-open window, when that window is a vacancy. Else 0. */
  currentVacancyDays: number;
  /** True when the unit is sitting available right now. */
  isCurrentlyVacant: boolean;
  /** Start of the open vacancy, when there is one. The honest `availableSince`. */
  vacantSince: Date | null;
}

export function summariseWindows(windows: OccupancyWindow[]): OccupancySummary {
  let totalDaysVacant = 0;
  let totalDaysLeased = 0;
  let totalDaysSold = 0;

  for (const w of windows) {
    if (w.kind === 'VACANT') totalDaysVacant += w.durationDays;
    else if (w.kind === 'LEASED') totalDaysLeased += w.durationDays;
    else if (w.kind === 'SOLD') totalDaysSold += w.durationDays;
  }

  const open = windows.find((w) => w.isOngoing);
  const vacantNow = !!open && open.kind === 'VACANT';

  return {
    totalDaysVacant,
    totalDaysLeased,
    totalDaysSold,
    currentVacancyDays: vacantNow ? open!.durationDays : 0,
    isCurrentlyVacant: vacantNow,
    vacantSince: vacantNow ? open!.start : null,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type TimelineEntryKind =
  | 'lease'
  | 'sale'
  | 'vacancy'
  | 'status'
  | 'rent_change'
  | 'free_rent'
  | 'fit_out'
  | 'lease_change'
  | 'tenancy_end'
  | 'assignment';

/**
 * Rent movements for one lease, as timeline entries.
 *
 * Rent changes were already stored correctly — an escalation lands as a
 * `LeaseRentPeriod` with source AUTO_ESCALATION, a negotiated change as MANUAL with a
 * mandatory reason — but they were only visible by expanding that one lease's schedule
 * table. The client asked for rent changes to show up in the UNIT's history, which is
 * where you go to understand what the unit has done over time.
 *
 * Two details that stop this being a naive diff of consecutive periods:
 *
 *  1. The INITIAL period is not a change. It is the lease starting, which the lease
 *     entry already says. Emitting it would double every tenancy.
 *  2. Free rent sits INSIDE the term as a period at rent 0, so consecutive-period
 *     diffing produces a fake "dropped to $0" then "rose to $10,000" pair around every
 *     abatement. Comparing against the last PAYING rent instead makes the abatement one
 *     entry, and a rent that simply resumes unchanged afterwards produces none.
 */
export function rentEntriesForLease(
  lease: {
    id: string;
    tenantName: string | null;
    tenantBrand: string | null;
    /** Last-resort value for an abatement with no paying period on either side. */
    monthlyRent?: any;
  },
  periods: Array<{
    id: string;
    sequence: number;
    startDate: Date;
    endDate: Date | null;
    baseRent: any;
    monthlyRent: any;
    isFreeRent: boolean;
    escalationPct: any;
    source: string;
    reason: string | null;
    createdBy?: { id: string; name: string | null; email: string } | null;
  }>,
) {
  const tenant = lease.tenantBrand || lease.tenantName || 'tenant';
  const ordered = [...periods].sort((a, b) => {
    const d = a.startDate.getTime() - b.startDate.getTime();
    return d !== 0 ? d : a.sequence - b.sequence;
  });

  const out: any[] = [];
  let lastPayingRent: number | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    const monthly = Number(p.monthlyRent ?? 0);

    if (p.isFreeRent) {
      // What the abatement was worth. Normally that is the rent in force before it —
      // but the commonest arrangement by far is free months at the START of a lease,
      // where there IS no earlier paying period. Looking forward to the next paying
      // one covers that; without it the most typical concession in the system rendered
      // its value as blank.
      const nextPaying = ordered.slice(i + 1).find((q) => !q.isFreeRent);
      const forgone =
        lastPayingRent ??
        (nextPaying ? Number(nextPaying.monthlyRent ?? 0) : null) ??
        (lease.monthlyRent != null ? Number(lease.monthlyRent) : null);

      out.push({
        id: `free-${p.id}`,
        kind: 'free_rent' as TimelineEntryKind,
        startDate: p.startDate,
        endDate: p.endDate,
        isOngoing: false,
        isHistorical: false,
        durationDays: p.endDate ? daysBetween(p.startDate, p.endDate) : 0,
        title: `Rent-free period — ${tenant}`,
        data: {
          leaseId: lease.id,
          tenantName: tenant,
          forgoneMonthlyRent: forgone,
          /** forgone x whole months abated — what the concession cost in total. */
          forgoneTotal:
            forgone != null && p.endDate
              ? Math.round(forgone * (daysBetween(p.startDate, p.endDate) / 30.44) * 100) / 100
              : null,
        },
      });
      continue;
    }

    if (lastPayingRent === null) {
      lastPayingRent = monthly; // the INITIAL rent — the lease entry already states it
      continue;
    }

    if (monthly !== lastPayingRent) {
      const isEscalation = p.source === 'AUTO_ESCALATION';
      out.push({
        id: `rent-${p.id}`,
        kind: 'rent_change' as TimelineEntryKind,
        startDate: p.startDate,
        endDate: null,
        isOngoing: false,
        isHistorical: false,
        durationDays: 0,
        title: isEscalation
          ? `Scheduled rent escalation — ${tenant}`
          : `Rent changed — ${tenant}`,
        data: {
          leaseId: lease.id,
          tenantName: tenant,
          from: lastPayingRent,
          to: monthly,
          delta: monthly - lastPayingRent,
          baseRent: Number(p.baseRent ?? 0),
          escalationPct: p.escalationPct != null ? Number(p.escalationPct) : null,
          source: p.source,
          isScheduled: isEscalation,
          reason: p.reason,
          changedBy: p.createdBy ?? null,
        },
      });
    }

    lastPayingRent = monthly;
  }

  return out;
}

@Injectable()
export class UnitHistoryService {
  constructor(private prisma: PrismaService) {}

  async getHistory(unitId: string, permissions: string[] = [], now: Date = new Date()) {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        unitNumber: true,
        status: true,
        sqft: true,
        createdAt: true,
        availableSince: true,
        deletedAt: true,
        building: {
          select: { id: true, name: true, projectId: true, deletedAt: true, project: { select: { deletedAt: true } } },
        },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    // A unit is only reachable if its whole chain is — deleting a project soft-deletes
    // the project, not its units/buildings, so this stayed openable by direct URL and
    // returned a full history for a unit that no longer exists anywhere else in the app.
    if (unit.deletedAt || unit.building?.deletedAt || unit.building?.project?.deletedAt) {
      throw new NotFoundException('Unit not found');
    }

    const [events, leases, sales] = await Promise.all([
      this.prisma.unitStatusEvent.findMany({
        where: { unitId },
        orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }],
        include: { recordedBy: { select: { id: true, name: true, email: true } } },
      }),
      // A lease or sale covering this unit can be attached to the unit OR to the whole
      // BUILDING it sits in — the models are polymorphic. Reading only unit-scoped rows
      // meant a unit inside a let or sold building showed an empty life story: no
      // tenancy, no sale, one open vacancy window that claimed it had never been used.
      this.prisma.lease.findMany({
        where: { deletedAt: null, OR: [{ unitId }, { building: { units: { some: { id: unitId } } } }] },
        orderBy: { leaseStart: 'desc' },
      }),
      this.prisma.sale.findMany({
        where: { deletedAt: null, OR: [{ unitId }, { building: { units: { some: { id: unitId } } } }] },
        orderBy: { createdAt: 'desc' },
        include: { broker: { select: { id: true, name: true } } },
      }),
    ]);

    const leaseIds = leases.map((l) => l.id);
    // R8 — sibling leases of a combined multi-unit deal live on OTHER units, so they
    // cannot come from the unit-scoped `leases` query above. Gated on there being
    // anything to look up: the overwhelming majority of units have no combined deal.
    const combinedRefs = [...new Set(leases.map((l) => l.combinedDealRef).filter(Boolean))] as string[];
    const [economics, rentPeriods, leaseChanges, combinedSiblings] = await Promise.all([
      this.economicsByLease(leaseIds),
      leaseIds.length
        ? this.prisma.leaseRentPeriod.findMany({
            where: { leaseId: { in: leaseIds } },
            orderBy: [{ leaseId: 'asc' }, { startDate: 'asc' }, { sequence: 'asc' }],
            include: { createdBy: { select: { id: true, name: true, email: true } } },
          })
        : Promise.resolve([]),
      // Edits to the lease TERMS — an extended end date, a revised deposit, a status
      // change. Recorded as a real diff by LeasesService.recordLeaseChanges, because the
      // raw audit row holds the whole submitted body and cannot say what moved.
      leaseIds.length
        ? this.prisma.auditEvent.findMany({
            where: { entity: 'Lease', action: 'LEASE_TERMS_CHANGED', entityId: { in: leaseIds } },
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } },
            take: 200,
          })
        : Promise.resolve([]),
      combinedRefs.length
        ? this.prisma.lease.findMany({
            where: {
              combinedDealRef: { in: combinedRefs },
              unitId: { not: unitId },
              deletedAt: null,
              // A sibling unit whose project (or building) has since been archived is
              // gone from the rest of the app; naming it here would be the one place
              // this history page still reaches into archived data.
              unit: { deletedAt: null, building: { deletedAt: null, project: { deletedAt: null } } },
            },
            select: { combinedDealRef: true, unit: { select: { unitNumber: true } } },
          })
        : Promise.resolve([]),
    ]);

    const combinedSiblingUnitsByRef = new Map<string, string[]>();
    for (const s of combinedSiblings) {
      if (!s.combinedDealRef) continue;
      const list = combinedSiblingUnitsByRef.get(s.combinedDealRef) ?? [];
      if (s.unit?.unitNumber) list.push(s.unit.unitNumber);
      combinedSiblingUnitsByRef.set(s.combinedDealRef, list);
    }

    // Tenant assignments. Not derivable from the lease row — it only ever holds the
    // CURRENT tenant — which is exactly why the table exists.
    const assignments = leaseIds.length
      ? await this.prisma.leaseTenantAssignment.findMany({
          where: { leaseId: { in: leaseIds } },
          orderBy: { effectiveDate: 'asc' },
          include: {
            recordedBy: { select: { id: true, name: true, email: true } },
            // Joined purely for liveness: documents are soft-deleted now, and the raw
            // `documentId` column outlives the delete. See assignmentEntries.
            document: { select: { id: true, deletedAt: true } },
          },
        })
      : [];

    const windows = buildOccupancyWindows(events, now);
    const summary = summariseWindows(windows);

    // The event log can be wrong about "vacant right now" — see activeLeaseCoversNow.
    // Asserting a false vacancy is worse than the SOLD-with-ACTIVE-lease case below: it
    // is not ambiguous data needing a human call, it is knowably wrong while a lease
    // with a future end date is sitting right there. Correct it before it reaches the
    // summary tiles or the timeline's "currently vacant" entry.
    const vacantWithActiveLease = summary.isCurrentlyVacant && activeLeaseCoversNow(leases, now);
    if (vacantWithActiveLease) {
      // Remove exactly the open window's contribution to the lifetime total — a genuine
      // PAST vacancy (a closed window, before this lease or between two others) is
      // unaffected, only the one currently misclassified as vacant.
      summary.totalDaysVacant = Math.max(0, summary.totalDaysVacant - summary.currentVacancyDays);
      summary.isCurrentlyVacant = false;
      summary.currentVacancyDays = 0;
      summary.vacantSince = null;
    }

    /**
     * A SOLD unit has no vacancy, for the reason spelled out on vacancyEntries: it is
     * not Prime's to let any more. The timeline drops those entries, so the tiles have
     * to drop the days too — a "Total vacant: 214 days" tile above a timeline showing no
     * vacancy at all is the two halves of one card contradicting each other.
     *
     * The days are zeroed, not recomputed: `totalDaysSold` already carries the time
     * since the sale, and the pre-sale vacancy is not a number anyone reads off a unit
     * Prime has sold.
     */
    if (!unitCanBeVacant(unit.status)) {
      summary.totalDaysVacant = 0;
      summary.isCurrentlyVacant = false;
      summary.currentVacancyDays = 0;
      summary.vacantSince = null;
    }

    // Rent movements, grouped back onto their lease so each entry can name the tenant
    // it belongs to — a unit on its third tenancy has three separate rent stories and
    // an undated "rent rose to $12,000" would belong to none of them.
    const periodsByLease = new Map<string, typeof rentPeriods>();
    for (const p of rentPeriods) {
      const list = periodsByLease.get(p.leaseId) ?? [];
      list.push(p);
      periodsByLease.set(p.leaseId, list);
    }
    const allRentEntries = leases.flatMap((l) =>
      rentEntriesForLease(l, (periodsByLease.get(l.id) ?? []) as any),
    );

    // ---- Rent movements that can never happen ----
    //
    // A rent schedule runs to the end of the lease term, so a lease still marked ACTIVE
    // on a unit that has been SOLD keeps projecting escalations years past the point
    // Prime stopped owning the unit. Showing "rent rises to $5,946 in Aug 2029" under a
    // unit sold in 2026 is not a display quirk — it is a number a reader will believe.
    //
    // Cut the timeline at the sale. The escalations are not deleted (the rent periods
    // are untouched); they are withheld from a history that would otherwise assert them,
    // and the count is reported so the omission is visible rather than silent.
    //
    // The root cause is that closing a sale does not terminate the sitting lease — R4,
    // in H3. This keeps the unit page honest until that lands.
    const closedSales = sales.filter((s) => s.status === 'CLOSED' && s.closingDate);
    const soldAt = closedSales.length
      ? new Date(Math.min(...closedSales.map((s) => +new Date(s.closingDate!))))
      : null;

    const visibleRentEntries = soldAt
      ? allRentEntries.filter((e) => new Date(e.startDate) <= soldAt)
      : allRentEntries;
    const suppressedAfterSale = allRentEntries.length - visibleRentEntries.length;

    // A rent schedule is generated for the whole term up front, so most of it has not
    // happened yet. In a panel headed "History" an escalation dated 2029 reads as a
    // past event; flag the ones still ahead so the UI can say "upcoming" instead of
    // stating them in the same voice as things that actually occurred.
    const rentEntries = visibleRentEntries.map((e) => ({
      ...e,
      isProjected: new Date(e.startDate) > now,
    }));

    // A lease still ACTIVE on a sold unit is a data inconsistency, not a display one:
    // the rent-invoice cron bills on lease status, so this tenant is still being
    // invoiced by someone who no longer owns the unit. Surface it rather than quietly
    // papering over it with the filter above.
    const activeLeaseOnSoldUnit =
      unit.status === 'SOLD' && leases.some((l) => l.status === 'ACTIVE');

    // Fit-out: signed but not yet paying. Its own kind rather than folded into vacancy,
    // because the unit is committed and off the market — counting it as vacancy would
    // overstate time-on-market — and not free rent either, since no rent has commenced
    // to abate. Only appears on leases that actually carry a rent start date.
    const fitOutEntries = leases
      .filter((l) => l.rentStartDate && +l.rentStartDate > +l.leaseStart)
      .map((l) => ({
        id: `fitout-${l.id}`,
        kind: 'fit_out' as TimelineEntryKind,
        startDate: l.leaseStart,
        endDate: l.rentStartDate!,
        isOngoing: false,
        isHistorical: false,
        durationDays: daysBetween(l.leaseStart, l.rentStartDate!),
        title: `Fit-out — ${l.tenantBrand || l.tenantName || 'tenant'}`,
        data: {
          leaseId: l.id,
          tenantName: l.tenantBrand || l.tenantName,
          rentStartDate: l.rentStartDate,
        },
      }));

    const leaseById = new Map(leases.map((l) => [l.id, l]));
    const changeEntries = leaseChanges.map((a: any) => {
      const lease = leaseById.get(a.entityId as string);
      const tenant = lease?.tenantBrand || lease?.tenantName || 'tenant';
      const fields: Array<{ field: string; label: string; type: string }> =
        (a.metadata as any)?.fields ?? [];
      const old = (a.oldValues ?? {}) as Record<string, any>;
      const neu = (a.newValues ?? {}) as Record<string, any>;
      return {
        id: `leasechange-${a.id}`,
        kind: 'lease_change' as TimelineEntryKind,
        // Dated when the edit was MADE. Unlike a rent period there is no effective date
        // to use — changing a lease's end date takes effect the moment it is saved.
        startDate: a.createdAt,
        endDate: null,
        isOngoing: false,
        isHistorical: false,
        durationDays: 0,
        title: `Lease updated — ${tenant}`,
        data: {
          leaseId: a.entityId,
          tenantName: tenant,
          changedBy: a.user ?? null,
          changes: fields.map((f) => ({
            label: f.label,
            type: f.type,
            from: old[f.field] ?? null,
            to: neu[f.field] ?? null,
          })),
        },
      };
    });

    const entries = [
      ...this.leaseEntries(leases, economics, combinedSiblingUnitsByRef),
      ...this.saleEntries(sales),
      ...this.vacancyEntries(windows, leases, now, unit.status),
      ...this.statusEntries(windows),
      ...tenancyEndEntries(leases),
      ...assignmentEntries(assignments, leases),
      ...rentEntries,
      ...fitOutEntries,
      ...changeEntries,
    ].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

    // Every kind but 'vacancy'/'status' embeds a tenant name or a dollar figure
    // straight into `title`/`data` (e.g. "Leased to Acme Corp", `monthlyRent`) — there
    // is no separate field to null out, so an entry the caller can't see gets dropped
    // whole rather than scrubbed. Mirrors how the rest of this session's audit fixed
    // the same class of leak elsewhere: redact, don't just rely on the frontend to not
    // render it.
    const canViewLeases = permissions.includes('lease:view');
    const canViewSales = permissions.includes('sales:view');
    const LEASE_KINDS = new Set(['lease', 'rent_change', 'free_rent', 'fit_out', 'lease_change', 'tenancy_end', 'assignment']);
    const visibleEntries = entries.filter((e) => {
      if (e.kind === 'sale') return canViewSales;
      if (LEASE_KINDS.has(e.kind)) return canViewLeases;
      return true;
    });

    return {
      unit: {
        id: unit.id,
        unitNumber: unit.unitNumber,
        status: unit.status,
        sqft: unit.sqft,
        buildingId: unit.building.id,
        buildingName: unit.building.name,
        projectId: unit.building.projectId,
      },
      entries: visibleEntries,
      windows,
      summary: {
        ...summary,
        tenancyCount: leases.length,
        saleCount: sales.length,
        closedSaleCount: sales.filter((s) => s.status === 'CLOSED').length,
        /** Rent collected across every tenancy this unit has ever had. */
        lifetimeRentCollected: !canViewLeases ? null : leases.reduce(
          (sum, l) => sum + (economics.get(l.id)?.collected ?? 0),
          0,
        ),
        lifetimeSaleProceeds: !canViewSales ? null : sales
          .filter((s) => s.status === 'CLOSED')
          .reduce((sum, s) => sum + Number(s.salePrice ?? 0), 0),
        /**
         * True when the unit has no observed transitions of its own — everything it
         * shows comes from the migration bootstrap row. Lets the UI say "history
         * starts here" instead of implying the unit was born on that date.
         */
        historyStartsAtBootstrap: events.length > 0 && events.every((e) => e.source === 'SYSTEM'),
        firstEventAt: events[0]?.effectiveAt ?? null,
        /** Lets the UI offer the rent-change filter only when there is something to filter. */
        rentChangeCount: rentEntries.filter((e) => e.kind === 'rent_change').length,
        leaseChangeCount: changeEntries.length,
        /** Scheduled rent movements withheld because they fall after the unit was sold. */
        suppressedAfterSale,
        soldAt,
        /**
         * Problems with the unit's own data that the timeline cannot fix and should not
         * hide. Rendered as a banner above the history.
         */
        dataWarnings: [
          // The old wording said the tenant "may still be being billed". That was never
          // true: NOT_ON_SOLD_UNIT takes these leases out of invoicing, the rent roll,
          // cash flow and dunning, and has done since it was written. Warning about
          // phantom billing sent people hunting for money that was never moving, and
          // buried the real point — the two records disagree about what this unit is.
          ...(activeLeaseOnSoldUnit
            ? [
                'This unit is marked SOLD but still carries an ACTIVE lease. Nothing is '
                + 'being billed — a lease on a sold unit is left out of the rent roll, '
                + 'invoicing and cash flow — but the two records disagree. End the tenancy '
                + 'from the Tenant card, or correct the unit status.',
              ]
            : []),
          ...(vacantWithActiveLease
            ? [
                'This unit’s status history shows it as vacant, but an ACTIVE lease covers ' +
                'today. The status-change log is likely missing an event for this tenancy — ' +
                'vacancy totals before today may undercount leased time until it is corrected.',
              ]
            : []),
          ...(suppressedAfterSale > 0
            ? [
                `${suppressedAfterSale} scheduled rent change${suppressedAfterSale === 1 ? '' : 's'} ` +
                'dated after the sale closed are not shown — they cannot occur.',
              ]
            : []),
        ],
      },
    };
  }

  /**
   * Contracted vs collected per lease, in three aggregate queries rather than one
   * per lease. A unit on its fourth tenancy would otherwise fan out into a dozen
   * round-trips just to render a summary strip.
   */
  private async economicsByLease(leaseIds: string[]) {
    const out = new Map<
      string,
      { contracted: number; collected: number; outstanding: number; billedMonths: number;
        depositAgreed: number; depositPaid: number; tiAgreed: number; tiPaid: number }
    >();
    if (leaseIds.length === 0) return out;

    const [invoiceAgg, obligations] = await Promise.all([
      this.prisma.leaseRentInvoice.groupBy({
        by: ['leaseId'],
        where: { leaseId: { in: leaseIds } },
        _sum: { amountDue: true, amountPaid: true },
        _count: { _all: true },
      }),
      this.prisma.leaseObligation.groupBy({
        by: ['leaseId', 'kind'],
        where: { leaseId: { in: leaseIds } },
        _sum: { totalAmount: true, paidAmount: true },
      }),
    ]);

    const blank = () => ({
      contracted: 0, collected: 0, outstanding: 0, billedMonths: 0,
      depositAgreed: 0, depositPaid: 0, tiAgreed: 0, tiPaid: 0,
    });

    for (const id of leaseIds) out.set(id, blank());

    for (const row of invoiceAgg) {
      const e = out.get(row.leaseId) ?? blank();
      e.contracted = Number(row._sum.amountDue ?? 0);
      e.collected = Number(row._sum.amountPaid ?? 0);
      e.outstanding = Math.max(0, e.contracted - e.collected);
      e.billedMonths = row._count._all;
      out.set(row.leaseId, e);
    }

    for (const row of obligations) {
      const e = out.get(row.leaseId) ?? blank();
      const total = Number(row._sum.totalAmount ?? 0);
      const paid = Number(row._sum.paidAmount ?? 0);
      if (row.kind === 'SECURITY_DEPOSIT') {
        e.depositAgreed += total;
        e.depositPaid += paid;
      } else if (row.kind === 'TI_ALLOWANCE') {
        e.tiAgreed += total;
        e.tiPaid += paid;
      }
      out.set(row.leaseId, e);
    }

    return out;
  }

  private leaseEntries(leases: any[], economics: Map<string, any>, combinedSiblingUnitsByRef: Map<string, string[]>) {
    return leases.map((l) => {
      const ended = ['EXPIRED', 'TERMINATED'].includes(String(l.status));
      const econ = economics.get(l.id);
      return {
        id: `lease-${l.id}`,
        kind: 'lease' as TimelineEntryKind,
        startDate: l.leaseStart,
        endDate: l.leaseEnd,
        isOngoing: !ended,
        // Was hardcoded false — nothing before H2's backfill (2026-08-13) could BE
        // historical, so it went unnoticed that this never turned true afterward either.
        isHistorical: !!l.isHistorical,
        durationDays: daysBetween(new Date(l.leaseStart), new Date(l.leaseEnd)),
        title: `Leased to ${l.tenantBrand || l.tenantName || 'unnamed tenant'}`,
        data: {
          leaseId: l.id,
          tenantName: l.tenantName,
          tenantLegalName: l.tenantLegalName,
          tenantBrand: l.tenantBrand,
          status: l.status,
          monthlyRent: Number(l.monthlyRent ?? 0),
          rentPerSqft: l.rentPerSqft != null ? Number(l.rentPerSqft) : null,
          termMonths: l.termMonths,
          escalationPct: l.escalationPct != null ? Number(l.escalationPct) : null,
          escalationFreq: l.escalationFreq,
          freeRentMonths: l.freeRentMonths,
          securityDeposit: l.securityDeposit != null ? Number(l.securityDeposit) : null,
          // R8 — the other unit(s) this tenancy was leased together with, if any.
          combinedWithUnits: l.combinedDealRef ? (combinedSiblingUnitsByRef.get(l.combinedDealRef) ?? []) : [],
          ...econ,
        },
      };
    });
  }

  private saleEntries(sales: any[]) {
    const label = (status: string) => {
      if (status === 'CLOSED') return 'Sold';
      if (status === 'CANCELLED') return 'Sale fell through';
      return `Sale in progress (${status.replace(/_/g, ' ').toLowerCase()})`;
    };
    return sales.map((s) => ({
      id: `sale-${s.id}`,
      kind: 'sale' as TimelineEntryKind,
      // A closed sale is dated by its closing; an open one by when it was last touched.
      startDate: s.closingDate ?? s.contractDate ?? s.loiDate ?? s.updatedAt ?? s.createdAt,
      endDate: null,
      isOngoing: !['CLOSED', 'CANCELLED'].includes(String(s.status)),
      // R4: a sale entered by hand after the fact, same meaning as Lease.isHistorical —
      // was false unconditionally before backfillSale existed to make it true.
      isHistorical: !!s.isHistorical,
      durationDays: 0,
      title: s.buyer ? `${label(s.status)} — ${s.buyer}` : label(s.status),
      data: {
        saleId: s.id,
        status: s.status,
        seller: s.seller,
        buyer: s.buyer,
        salePrice: s.salePrice != null ? Number(s.salePrice) : null,
        depositAmt: s.depositAmt != null ? Number(s.depositAmt) : null,
        loiDate: s.loiDate,
        contractDate: s.contractDate,
        closingDate: s.closingDate,
        lostReason: s.lostReason,
        broker: s.broker,
      },
    }));
  }

  /**
   * Every vacancy the unit has had, including the one before its first lease and the
   * one it may be sitting in right now — the two the old client-side derivation could
   * not see.
   */
  private vacancyEntries(
    windows: OccupancyWindow[],
    leases: any[] = [],
    now: Date = new Date(),
    unitStatus?: UnitStatus,
  ) {
    // See unitCanBeVacant. Suppressed here rather than in the frontend so the timeline
    // and the summary tiles cannot disagree — getHistory zeroes the day totals to match.
    if (unitStatus && !unitCanBeVacant(unitStatus)) return [];

    // A lease linked to a successor on the SAME unit is a renewal: the tenant never
    // left, so any vacancy window sitting in the handover is an artefact of how the
    // records were entered, not something that happened.
    //
    // Narrow on purpose — only windows lying ENTIRELY inside the handover gap are
    // dropped. A genuine multi-month gap between a lease and its "renewal" means the
    // unit really was empty, and suppressing that would be a lie told by the timeline.
    const handovers = successionGaps(leases);
    const suppressed = (w: OccupancyWindow) =>
      handovers.some(
        (g) =>
          w.start.getTime() >= g.from.getTime() &&
          (w.end ? w.end.getTime() <= g.to.getTime() : false),
      );
    // The open window is never really vacant if a lease covers today — see
    // activeLeaseCoversNow. Only the OPEN window is filtered: a past vacancy the log
    // genuinely recorded (e.g. between two tenancies) is real history and stays.
    const activeNow = activeLeaseCoversNow(leases, now);

    return windows
      .filter((w) => w.kind === 'VACANT')
      .filter((w) => !suppressed(w))
      .filter((w) => !(w.isOngoing && activeNow))
      .map((w) => ({
        id: `vacancy-${w.start.toISOString()}`,
        kind: 'vacancy' as TimelineEntryKind,
        startDate: w.start,
        endDate: w.end,
        isOngoing: w.isOngoing,
        isHistorical: false,
        durationDays: w.durationDays,
        title: w.isOngoing ? 'Available — currently vacant' : 'Vacant',
        data: { days: w.durationDays },
      }));
  }

  /**
   * Windows a lease/sale/vacancy entry does not already explain. In practice that is
   * construction: LEASED and SOLD windows are narrated by their lease and sale rows,
   * and RESERVED windows by the sale that reserved the unit, so emitting those too
   * would double up every entry on the timeline.
   */
  private statusEntries(windows: OccupancyWindow[]) {
    return windows
      .filter((w) => w.kind === 'CONSTRUCTION')
      .map((w) => ({
        id: `status-${w.start.toISOString()}`,
        kind: 'status' as TimelineEntryKind,
        startDate: w.start,
        endDate: w.end,
        isOngoing: w.isOngoing,
        isHistorical: false,
        durationDays: w.durationDays,
        title: 'Under construction',
        data: { status: w.status },
      }));
  }
}

/**
 * True when an ACTIVE lease on the unit covers `now`. Used to catch the mirror image
 * of `activeLeaseOnSoldUnit` below: a unit whose `unit_status_events` log is missing
 * whatever transition should have closed its vacancy window — most often a combined
 * unit created directly with `status: LEASED` but no matching event ever recorded, so
 * the log still has nothing later than the implicit "available" from creation. The
 * event log says vacant; a lease that has not ended says otherwise, and the lease is
 * the fact a person can see and correct the unit's event log against.
 */
export function activeLeaseCoversNow(leases: any[], now: Date): boolean {
  return leases.some(
    (l) =>
      l.status === 'ACTIVE' &&
      +new Date(l.leaseStart) <= +now &&
      (!l.leaseEnd || +new Date(l.leaseEnd) >= +now),
  );
}

/**
 * The handover windows between each lease and the successor that continues it on the
 * same unit. Used only to decide which vacancies are real.
 */
export function successionGaps(leases: any[]): Array<{ from: Date; to: Date }> {
  const byId = new Map(leases.map((l) => [l.id, l]));
  const gaps: Array<{ from: Date; to: Date }> = [];
  for (const l of leases) {
    if (!l.successorLeaseId) continue;
    const successor = byId.get(l.successorLeaseId);
    // Absent from this map = the successor is on a DIFFERENT unit, i.e. a relocation.
    // That leaves this unit genuinely empty, so its vacancy must stand.
    if (!successor) continue;
    const from = new Date(l.terminationDate ?? l.leaseEnd);
    const to = new Date(successor.leaseStart);
    if (to.getTime() >= from.getTime()) gaps.push({ from, to });
  }
  return gaps;
}

const TENANCY_END_LABEL: Record<string, string> = {
  EXPIRED: 'Lease expired',
  NON_RENEWAL: 'Not renewed',
  EARLY_TERMINATION: 'Ended early',
  EVICTION: 'Evicted',
  MUTUAL: 'Ended by mutual agreement',
  LANDLORD_TERMINATED: 'Terminated by Prime',
  RENEWED: 'Renewed onto a new lease',
  RELOCATED: 'Tenant relocated',
  ASSIGNED: 'Lease assigned',
  TENANT_BOUGHT: 'Tenant bought the unit',
  // R6 — a third-party sale is a LANDLORD CHANGE, not an ending. Falling through to the
  // generic 'Tenancy ended' would tell the reader the tenant left, when the whole point of
  // this reason is that they did not.
  LEASE_TRANSFERRED_WITH_SALE: 'Unit sold — tenancy transferred to the new owner',
};

/**
 * How each tenancy actually ended.
 *
 * Distinct from the `lease` entry, which spans the CONTRACTED term. When a tenant
 * leaves early the two disagree, and the disagreement is the point: a lease entry
 * running to 2030 next to a tenancy that ended in 2026 is what tells the reader
 * there was an early exit, and by how much.
 */
export function tenancyEndEntries(leases: any[]) {
  const byId = new Map(leases.map((l) => [l.id, l]));
  const label = TENANCY_END_LABEL;

  return leases
      .filter((l) => l.terminationDate)
      .map((l) => {
        const ended = new Date(l.terminationDate);
        const contractedEnd = new Date(l.leaseEnd);
        // Measured in BOTH directions, each with its own call. daysBetween clamps at
        // zero, so negating one to get the other silently yields -0 and holdover never
        // shows — which is how a tenant staying three months past their term would have
        // read as a clean expiry.
        const daysEarly = daysBetween(ended, contractedEnd);
        const daysHeldOver = daysBetween(contractedEnd, ended);
        const successor = l.successorLeaseId ? byId.get(l.successorLeaseId) : null;
        const who = l.tenantBrand || l.tenantName || 'the tenant';
        const reason = String(l.terminationReason ?? '');

        return {
          id: `tenancy-end-${l.id}`,
          kind: 'tenancy_end' as TimelineEntryKind,
          startDate: l.terminationDate,
          endDate: null,
          isOngoing: false,
          isHistorical: false,
          durationDays: 0,
          title: `${label[reason] ?? 'Tenancy ended'} — ${who}`,
          data: {
            leaseId: l.id,
            tenantName: l.tenantName,
            tenantBrand: l.tenantBrand,
            terminationReason: l.terminationReason,
            terminationNote: l.terminationNote,
            contractedEnd: l.leaseEnd,
            // Only meaningful when they differ; the UI hides it at zero.
            daysEarly: ended < contractedEnd ? daysEarly : 0,
            daysHeldOver: ended > contractedEnd ? daysHeldOver : 0,
            successorLeaseId: l.successorLeaseId ?? null,
            // Present only for a same-unit renewal — a relocation's successor is not in
            // this unit's lease set and cannot be named from here.
            successorTenant: successor?.tenantBrand || successor?.tenantName || null,
            continuesOnThisUnit: !!successor,
          },
        };
      });
  }

/**
   * Tenant assignments — the lease survived, the party changed.
   *
   * Deliberately NOT folded into `lease_change`. A term change is Prime editing its own
   * record of the deal; an assignment is a different legal entity becoming responsible
   * for the same contract, and the invoices either side of it were billed to different
   * people. Collapsing them would lose that.
   */
export function assignmentEntries(assignments: any[], leases: any[]) {
    const byId = new Map(leases.map((l) => [l.id, l]));
    return assignments.map((a) => {
      const lease = byId.get(a.leaseId);

      // Documents are soft-deleted, so `a.documentId` survives the delete while every read
      // in DocumentsService filters the row out — emitting the raw id gave the timeline a
      // link that 404s.
      //
      // Resolved to null AND flagged, rather than simply dropped: "no agreement was ever
      // filed for this assignment" and "the agreement was filed and later removed" are
      // different facts about a legal transfer, and a history that silently converts the
      // second into the first is worse than one with a dead link. The UI can render "signed
      // agreement removed from the vault" — which is also the prompt somebody needs to go
      // find out why.
      const documentFiled = a.documentId != null;
      const documentLive = documentFiled && a.document != null && a.document.deletedAt == null;

      return {
        id: `assignment-${a.id}`,
        kind: 'assignment' as TimelineEntryKind,
        startDate: a.effectiveDate,
        endDate: null,
        isOngoing: false,
        isHistorical: false,
        durationDays: 0,
        title: `Lease assigned — ${a.fromTenantName} → ${a.toTenantName}`,
        data: {
          leaseId: a.leaseId,
          fromTenantName: a.fromTenantName,
          fromTenantLegalName: a.fromTenantLegalName,
          toTenantName: a.toTenantName,
          toTenantLegalName: a.toTenantLegalName,
          reason: a.reason,
          note: a.note,
          documentId: documentLive ? a.documentId : null,
          /** An agreement was attached at the time, whether or not it is still retrievable. */
          documentFiled,
          /** True only when it has since been removed — the case worth naming in the UI. */
          documentRemoved: documentFiled && !documentLive,
          recordedBy: a.recordedBy ?? null,
          // Says out loud what the entry means, because "the rent did not change" is
          // the most common question an assignment raises.
          monthlyRent: lease?.monthlyRent != null ? Number(lease.monthlyRent) : null,
          termUnchanged: true,
        },
      };
    });
  }

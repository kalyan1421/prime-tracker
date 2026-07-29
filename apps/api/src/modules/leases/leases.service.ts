import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { LeaseRentPeriodService, startOfUtcDay, addMonthsUtc } from './lease-rent-period.service';

/**
 * Which rent period covers `at`, given periods sorted newest-start-first.
 *
 * Mirrors LeaseRentPeriodService.getEffectivePeriod exactly: the newest period
 * whose start is on or before `at` and which hasn't ended wins. That is what
 * lets a mid-term MANUAL renegotiation supersede an earlier row without the
 * earlier row's endDate ever being edited (past periods are immutable).
 */
function pickPeriodCovering<T extends { startDate: Date; endDate: Date | null }>(
  periodsNewestFirst: T[],
  at: Date,
): T | null {
  const day = startOfUtcDay(at);
  for (const p of periodsNewestFirst) {
    if (startOfUtcDay(p.startDate) > day) continue;
    if (p.endDate !== null && startOfUtcDay(p.endDate) < day) continue;
    return p;
  }
  return null;
}

/**
 * Fields whose change invalidates the generated rent schedule. Editing any of
 * these re-derives the FUTURE periods (past ones stay frozen).
 */
const SCHEDULE_INPUT_FIELDS = [
  'monthlyRent', 'escalationPct', 'escalationFreq',
  'freeRentMonths', 'freeRentStartDate', 'leaseStart', 'leaseEnd',
] as const;

@Injectable()
export class LeasesService {
  private readonly logger = new Logger(LeasesService.name);

  constructor(
    private prisma: PrismaService,
    private rentPeriods: LeaseRentPeriodService,
  ) {}

  async findByUnit(unitId: string) {
    return this.prisma.lease.findMany({ where: { unitId, deletedAt: null }, orderBy: { leaseStart: 'desc' } });
  }

  /** Sprint 1: building-level leases (e.g. Leander Bldg 1 leased as one whole asset). */
  async findByBuilding(buildingId: string) {
    return this.prisma.lease.findMany({ where: { buildingId, deletedAt: null }, orderBy: { leaseStart: 'desc' } });
  }

  async findByProject(projectId: string) {
    // OR clause to capture both unit-leases (via unit→building→project) and
    // building-leases (via building→project) under one project.
    return this.prisma.lease.findMany({
      where: {
        deletedAt: null,
        OR: [
          { unit: { building: { projectId } } },
          { building: { projectId } },
        ],
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
      orderBy: { leaseStart: 'desc' },
    });
  }

  /**
   * Rent roll as of a date (defaults to today).
   *
   * `lease.monthlyRent` is the CONTRACTED headline rent. What a tenant actually
   * owes in a given month is the rent period covering that date — which differs
   * once escalations or free-rent months exist. Summing monthlyRent flat
   * overstates the roll for any lease sitting in an abatement period.
   *
   * Leases with no generated periods fall back to `monthlyRent`, so this is
   * identical to the old behaviour for existing data and degrades gracefully if
   * schedule generation ever failed for a lease.
   *
   * Both totals are returned: `totalMonthlyRent` is the effective (correct) one,
   * `contractedMonthlyRent` is the old flat sum, so the UI can show the gap and
   * explain it rather than looking like the number silently dropped.
   */
  async getRentRoll(projectId: string, asOf: Date = new Date()) {
    const leases = await this.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        OR: [
          { unit: { building: { projectId } } },
          { building: { projectId } },
        ],
      },
      include: {
        unit: { include: { building: { select: { name: true } } } },
        building: { select: { id: true, name: true } },
      },
    });

    const leaseIds = leases.map((l) => l.id);
    const byLease = await this.periodsByLease(leaseIds);

    let totalRent = 0;
    let contractedRent = 0;
    let forwardYear = 0;
    let freeRentLeases = 0;

    const rows = leases.map((l) => {
      const periods = byLease.get(l.id) ?? [];
      const headline = Number(l.monthlyRent);
      const period = pickPeriodCovering(periods, asOf);
      const effectiveRent = period ? Number(period.monthlyRent) : headline;

      // Genuine next-12-months total: walk month by month through the schedule
      // rather than multiplying by 12. With free rent or a mid-year escalation
      // these differ materially — that gap is the whole point of the schedule.
      let leaseForwardYear = 0;
      for (let m = 0; m < 12; m += 1) {
        const at = addMonthsUtc(startOfUtcDay(asOf), m);
        const p = pickPeriodCovering(periods, at);
        leaseForwardYear += p ? Number(p.monthlyRent) : headline;
      }

      totalRent += effectiveRent;
      contractedRent += headline;
      forwardYear += leaseForwardYear;
      if (period?.isFreeRent) freeRentLeases += 1;

      return {
        ...l,
        effectiveMonthlyRent: effectiveRent,
        forwardYearRent: leaseForwardYear,
        currentPeriod: period,
      };
    });

    return {
      leases: rows,
      asOf,
      // Effective (correct) — what is actually owed this month.
      totalMonthlyRent: totalRent,
      // The old flat sum of headline rents, kept so the UI can show the gap.
      contractedMonthlyRent: contractedRent,
      // True next-12-months total. NOT totalMonthlyRent * 12.
      forwardYearRent: forwardYear,
      leaseCount: leases.length,
      freeRentLeaseCount: freeRentLeases,
    };
  }

  /** All rent periods for the given leases, newest start first (one query). */
  private async periodsByLease(leaseIds: string[]) {
    const byLease = new Map<string, Prisma.LeaseRentPeriodGetPayload<{}>[]>();
    if (leaseIds.length === 0) return byLease;

    const periods = await this.prisma.leaseRentPeriod.findMany({
      where: { leaseId: { in: leaseIds } },
      orderBy: [{ startDate: 'desc' }, { sequence: 'desc' }],
    });
    for (const p of periods) {
      const list = byLease.get(p.leaseId);
      if (list) list.push(p);
      else byLease.set(p.leaseId, [p]);
    }
    return byLease;
  }


  async findById(id: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id },
      include: { unit: true, building: { select: { id: true, name: true, projectId: true } } },
    });
    if (!lease || lease.deletedAt) throw new NotFoundException('Lease not found');
    return lease;
  }

  async create(data: Prisma.LeaseUncheckedCreateInput, createdById?: string) {
    // class-validator's @IsDateString() accepts a bare "YYYY-MM-DD" date, but Prisma's
    // DateTime columns need a full ISO-8601 datetime — pass Date objects so Prisma
    // serializes them correctly instead of erroring "premature end of input".
    if (typeof data.leaseStart === 'string') data.leaseStart = new Date(data.leaseStart);
    if (typeof data.leaseEnd === 'string') data.leaseEnd = new Date(data.leaseEnd);
    // Same coercion for freeRentStartDate — it's also @IsDateString(), so a bare
    // "YYYY-MM-DD" from an <input type="date"> would otherwise reach Prisma as a string.
    if (typeof data.freeRentStartDate === 'string') data.freeRentStartDate = new Date(data.freeRentStartDate);
    // Sprint 1: leases are polymorphic — exactly one of (unitId, buildingId) required.
    const unitId = data.unitId as string | null | undefined;
    const buildingId = data.buildingId as string | null | undefined;
    if (!unitId && !buildingId) {
      throw new BadRequestException('Lease must reference either a unit or a building');
    }
    if (unitId && buildingId) {
      throw new BadRequestException('Lease cannot reference both a unit and a building');
    }
    if (unitId) {
      // Fast-path check — the real enforcement is the partial unique index
      // "lease_unit_active_unique". This gives a friendlier 400 vs a raw Prisma
      // unique constraint error.
      const existing = await this.prisma.lease.findFirst({
        where: { unitId, deletedAt: null, status: { notIn: ['EXPIRED', 'TERMINATED'] } },
      });
      if (existing) {
        throw new BadRequestException('This unit already has an active lease. Expire or terminate the existing lease before adding a new one.');
      }
    }
    let lease: Prisma.LeaseGetPayload<{}>;
    try {
      lease = await this.prisma.lease.create({ data });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new BadRequestException('This unit already has an active lease. Expire or terminate the existing lease before adding a new one.');
      }
      throw e;
    }

    // Build the rent schedule (escalations + free-rent months) up front so the
    // client sees the full timeline the moment the lease is signed.
    //
    // Deliberately NOT part of the create transaction: a schedule that fails to
    // generate must not cost the user a lease they already entered. Nothing reads
    // periods without falling back to lease.monthlyRent (see getRentRoll), and
    // generateForLease is idempotent, so this is safe to retry later.
    await this.generateSchedule(lease.id, createdById);
    return lease;
  }

  /** Idempotent, non-fatal. Logged loudly rather than swallowed. */
  private async generateSchedule(leaseId: string, createdById?: string, force = false) {
    try {
      await this.rentPeriods.generateForLease(leaseId, { createdById, force });
    } catch (err) {
      this.logger.error(
        `Rent schedule generation failed for lease ${leaseId} — the lease is intact and rent ` +
        `falls back to its headline monthlyRent. Re-run via POST /leases/${leaseId}/rent-periods/generate. ${err}`,
      );
    }
  }

  async update(id: string, data: Prisma.LeaseUncheckedUpdateInput, updatedById?: string) {
    const before = await this.findById(id);
    if (typeof data.leaseStart === 'string') data.leaseStart = new Date(data.leaseStart);
    if (typeof data.leaseEnd === 'string') data.leaseEnd = new Date(data.leaseEnd);
    // Same coercion for freeRentStartDate — it's also @IsDateString(), so a bare
    // "YYYY-MM-DD" from an <input type="date"> would otherwise reach Prisma as a string.
    if (typeof data.freeRentStartDate === 'string') data.freeRentStartDate = new Date(data.freeRentStartDate);

    const updated = await this.prisma.lease.update({ where: { id }, data });

    // Terms that feed the schedule changed → re-derive the FUTURE periods. Past
    // periods stay frozen; the tenant was already invoiced against them.
    const scheduleChanged = SCHEDULE_INPUT_FIELDS.some(
      (f) => data[f] !== undefined && String(before[f] ?? '') !== String(updated[f] ?? ''),
    );
    if (scheduleChanged) {
      await this.generateSchedule(id, updatedById, true);
    }
    return updated;
  }

  // Soft-delete — preserves the row (and the unit's history) instead of destroying it.
  async delete(id: string) {
    await this.findById(id);
    return this.prisma.lease.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

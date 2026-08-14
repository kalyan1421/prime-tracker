import { Injectable } from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Where a transition came from. Kept as a string union rather than a DB enum so
 * adding a source (the backfill work adds BACKFILL usage, the interior module may
 * add more) is a code change, not a migration.
 */
export type UnitStatusEventSource =
  | 'MANUAL'          // someone changed the status on the unit form
  | 'LEASE_ACTIVATED' // a lease went ACTIVE and drove the unit
  | 'LEASE_ENDED'     // a lease expired/terminated and released the unit
  | 'SALE_CLOSED'     // a sale closed → SOLD
  | 'SALE_CANCELLED'  // a sale collapsed and released a reserved unit
  | 'UNIT_CREATED'    // the unit's first state
  | 'UNIT_COMBINED'   // unit merge minted or archived this unit
  | 'BACKFILL'        // historical entry (Phase H2)
  | 'SYSTEM';         // migration bootstrap

export interface RecordStatusEventInput {
  unitId: string;
  /** Null only for a unit's very first event. */
  fromStatus?: UnitStatus | null;
  toStatus: UnitStatus;
  /** Real-world time of the transition. Defaults to now. Backdate for history. */
  effectiveAt?: Date;
  source: UnitStatusEventSource;
  leaseId?: string;
  saleId?: string;
  reason?: string;
  isHistorical?: boolean;
  recordedById?: string;
}

/**
 * Writes the append-only unit occupancy log (`unit_status_events`).
 *
 * Deliberately NOT modelled on AuditService, which swallows its own errors so a
 * logging failure can never cost the user their write. The opposite is correct
 * here: this log is the source of truth for vacancy and time-on-market, so a unit
 * that moved without leaving an event is a silent hole in the history. Callers
 * pass their transaction client and a failure takes the whole transaction down
 * with it — a rejected status change is recoverable, a missing one is not.
 *
 * Every caller should pass `tx`. The bare-prisma default exists only for the
 * paths that genuinely have no surrounding transaction.
 */
@Injectable()
export class UnitStatusEventService {
  constructor(private prisma: PrismaService) {}

  async record(
    input: RecordStatusEventInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.unitStatusEvent.create({
      data: {
        unitId: input.unitId,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        effectiveAt: input.effectiveAt ?? new Date(),
        source: input.source,
        leaseId: input.leaseId,
        saleId: input.saleId,
        reason: input.reason,
        isHistorical: input.isHistorical ?? false,
        recordedById: input.recordedById,
      },
    });
  }

  /**
   * No-op when the status did not actually move. Callers frequently have an
   * `input.status` that merely repeats the current value; recording that would
   * fill the log with transitions that never happened.
   */
  async recordIfChanged(
    input: RecordStatusEventInput & { fromStatus: UnitStatus | null },
    tx?: Prisma.TransactionClient,
  ) {
    if (input.fromStatus === input.toStatus) return null;
    return this.record(input, tx);
  }

  /**
   * When each unit's CURRENT vacancy began, derived from the log.
   *
   * The honest replacement for `Unit.availableSince`, which is nulled the moment a
   * unit leaves AVAILABLE and — measured on live data 2026-08-12 — was set on only 2
   * of 499 units while 208 were AVAILABLE. Every reader of it was silently falling
   * back to `createdAt` and reporting a unit's age as its time on market.
   *
   * A unit is vacant iff its LATEST event landed on AVAILABLE; that event's
   * effectiveAt is when the vacancy started. Units not currently vacant are absent
   * from the map rather than present with a null.
   *
   * DISTINCT ON rather than a findMany-and-reduce: this runs over the whole unit
   * table for the vacancy report, and pulling every event for every unit to keep
   * one row each is the kind of query that is fine at 499 units and not at 5,000.
   */
  async currentVacancyStartByUnit(unitIds?: string[]): Promise<Map<string, Date>> {
    if (unitIds && unitIds.length === 0) return new Map();

    const rows = unitIds
      ? await this.prisma.$queryRaw<Array<{ unitId: string; effectiveAt: Date; toStatus: string }>>`
          SELECT DISTINCT ON ("unitId") "unitId", "effectiveAt", "toStatus"
          FROM "unit_status_events"
          WHERE "unitId" IN (${Prisma.join(unitIds)})
          ORDER BY "unitId", "effectiveAt" DESC, "recordedAt" DESC
        `
      : await this.prisma.$queryRaw<Array<{ unitId: string; effectiveAt: Date; toStatus: string }>>`
          SELECT DISTINCT ON ("unitId") "unitId", "effectiveAt", "toStatus"
          FROM "unit_status_events"
          ORDER BY "unitId", "effectiveAt" DESC, "recordedAt" DESC
        `;

    const out = new Map<string, Date>();
    for (const r of rows) {
      if (r.toStatus === 'AVAILABLE') out.set(r.unitId, r.effectiveAt);
    }
    return out;
  }

  /** Chronological history for one unit, oldest first. */
  async findByUnit(unitId: string) {
    return this.prisma.unitStatusEvent.findMany({
      where: { unitId },
      orderBy: { effectiveAt: 'asc' },
      include: {
        recordedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }
}

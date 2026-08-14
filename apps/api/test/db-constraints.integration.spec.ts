import { PrismaClient } from '@prisma/client';

/**
 * The database constraints, tested against a real Postgres.
 *
 * These are the LOAD-BEARING enforcement. The service-layer checks
 * (`assertNoOverlappingLease`, the `terminationDate >= leaseStart` guard) are a
 * friendly fast path that produces a readable 400 — but they can lose a race, and they
 * can be bypassed by any script, seed or psql session. What actually stops a unit being
 * double-booked is `lease_unit_no_overlap`.
 *
 * Until this file existed those constraints had been verified exactly once, by hand, on
 * the day they were written. A later migration could have dropped one and 649 unit
 * tests would still have passed — every one of them mocks Prisma and never touches a
 * database at all.
 *
 * Every case runs inside a transaction that is ALWAYS rolled back, so the suite leaves
 * the database exactly as it found it and can be run against a developer's own dev DB.
 *
 * Skipped automatically when no database is reachable, so `jest` stays green on a
 * machine with no Postgres. It is meant to run in CI, where one is guaranteed.
 */

const prisma = new PrismaClient();

/**
 * Set by the globalSetup probe BEFORE collection. It cannot be discovered in a
 * `beforeAll`: describe.skip is chosen while the file is being collected, so a flag set
 * in a hook is always still false when it is read — and every case would skip silently,
 * leaving a green suite that checks nothing.
 */
const dbAvailable = process.env.INTEGRATION_DB === '1';

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Run `fn` inside a transaction and always roll back.
 *
 * The rollback is forced by throwing a sentinel: Prisma has no "rollback and return"
 * API, and returning normally would COMMIT. Swallowing only the sentinel means a real
 * failure inside `fn` still surfaces.
 */
const ROLLBACK = Symbol('rollback');

async function inRolledBackTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  let out: T;
  try {
    await prisma.$transaction(async (tx) => {
      out = await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return out!;
}

/**
 * A user to attribute test rows to — created if the database has none.
 *
 * This suite used to reach for `tx.user.findFirst()` in four places and assume something
 * came back, which held only because a developer's database happens to be seeded. On a
 * FRESH database — which is exactly what CI builds from migrations — it broke two
 * different ways: two call sites did `if (!user) return;` and passed by doing nothing
 * (a false green on a constraint test that never ran), and two did `u?.id as string`,
 * handing `undefined` to a required field and dying with a PrismaClientValidationError.
 *
 * Creating the row makes every test self-sufficient, which is what an integration test
 * asserting DB constraints has to be — it must not depend on seed data that CI never runs.
 * The row is created inside the caller's rolled-back transaction, so nothing persists.
 */
async function ensureUser(tx: any): Promise<string> {
  const existing = await tx.user.findFirst({ where: { isActive: true }, select: { id: true } });
  if (existing) return existing.id;
  const suffix = Math.abs(Number(process.hrtime.bigint() % 1_000_000n));
  const created = await tx.user.create({
    data: {
      email: `integration-harness-${suffix}@test.local`,
      name: 'Integration Harness',
      role: 'FOUNDER',
      isActive: true,
    },
    select: { id: true },
  });
  return created.id;
}

/** Minimal object graph: org → project → building → unit. */
async function seedUnit(tx: any) {
  const suffix = Math.abs(Number(process.hrtime.bigint() % 1_000_000n));
  const org = await tx.organization.findFirst({ select: { id: true } });
  const project = await tx.project.create({
    data: {
      name: `IT ${suffix}`,
      slug: `it-${suffix}`,
      location: 'Integration Harness',
      status: 'ACTIVE',
      phase: 'CONSTRUCTION',
      projectType: 'COMMERCIAL',
      ...(org ? { org: { connect: { id: org.id } } } : {}),
    },
  });
  const building = await tx.building.create({
    data: { projectId: project.id, name: 'IT Building', buildingType: 'RETAIL' },
  });
  const unit = await tx.unit.create({
    data: { buildingId: building.id, unitNumber: `IT-${suffix}`, unitType: 'RETAIL', sqft: 1000 },
  });
  return { project, building, unit };
}

function leaseData(unitId: string, over: Record<string, unknown> = {}) {
  return {
    unitId,
    tenantName: 'IT Tenant',
    monthlyRent: 1000,
    leaseStart: new Date('2025-01-01'),
    leaseEnd: new Date('2030-01-01'),
    termMonths: 60,
    status: 'ACTIVE',
    ...over,
  };
}

const maybe = () => (dbAvailable ? describe : describe.skip);

describe('DB constraints (integration)', () => {
  it('is actually running against a database, not skipping silently', () => {
    // CI must fail if the probe could not connect. A skipped constraint suite is
    // indistinguishable from a passing one in a summary line, which is precisely how a
    // dropped constraint would reach production unnoticed.
    if (process.env.CI) expect(dbAvailable).toBe(true);
    else expect(typeof dbAvailable).toBe('boolean');
  });
});

maybe()('lease_unit_no_overlap', () => {
  it('refuses two overlapping leases on one unit', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      await tx.lease.create({ data: leaseData(unit.id) });

      await expect(
        tx.lease.create({
          data: leaseData(unit.id, {
            leaseStart: new Date('2026-01-01'),
            leaseEnd: new Date('2031-01-01'),
          }),
        }),
      ).rejects.toThrow(/lease_unit_no_overlap/);
    });
  });

  it('ALLOWS a lease starting the day another ends — same-day turnover is real', async () => {
    // '[)' bounds. This is the case the old `lease_unit_active_unique` index made
    // impossible and the whole reason it was replaced.
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      await tx.lease.create({
        data: leaseData(unit.id, { leaseEnd: new Date('2027-06-30') }),
      });

      const second = await tx.lease.create({
        data: leaseData(unit.id, {
          leaseStart: new Date('2027-06-30'),
          leaseEnd: new Date('2032-06-30'),
        }),
      });
      expect(second.id).toBeDefined();
    });
  });

  it('ALLOWS a successor once the predecessor has a move-out date — the T1.1 fix', async () => {
    // The defect this migration existed to fix: an early-terminated lease still carries
    // its contracted leaseEnd, so before the constraint ranged over
    // COALESCE(terminationDate, leaseEnd) it refused its own successor.
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const first = await tx.lease.create({ data: leaseData(unit.id) });

      await tx.lease.update({
        where: { id: first.id },
        data: { terminationDate: new Date('2026-06-30'), status: 'TERMINATED' },
      });

      const successor = await tx.lease.create({
        data: leaseData(unit.id, {
          leaseStart: new Date('2026-06-30'),
          leaseEnd: new Date('2031-06-30'),
        }),
      });
      expect(successor.id).toBeDefined();
    });
  });

  it('still refuses a successor that starts BEFORE the move-out date', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const first = await tx.lease.create({ data: leaseData(unit.id) });
      await tx.lease.update({
        where: { id: first.id },
        data: { terminationDate: new Date('2026-06-30') },
      });

      await expect(
        tx.lease.create({
          data: leaseData(unit.id, {
            leaseStart: new Date('2026-03-01'),
            leaseEnd: new Date('2031-03-01'),
          }),
        }),
      ).rejects.toThrow(/lease_unit_no_overlap/);
    });
  });

  it('does not constrain leases on DIFFERENT units', async () => {
    await inRolledBackTx(async (tx) => {
      const a = await seedUnit(tx);
      const b = await seedUnit(tx);
      await tx.lease.create({ data: leaseData(a.unit.id) });
      const other = await tx.lease.create({ data: leaseData(b.unit.id) });
      expect(other.id).toBeDefined();
    });
  });

  it('ignores soft-deleted leases, so a deleted tenancy cannot block a new one', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const first = await tx.lease.create({ data: leaseData(unit.id) });
      await tx.lease.update({ where: { id: first.id }, data: { deletedAt: new Date() } });

      const replacement = await tx.lease.create({ data: leaseData(unit.id) });
      expect(replacement.id).toBeDefined();
    });
  });
});

maybe()('lease_termination_after_start', () => {
  it('refuses a move-out date before the lease started', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id) });

      await expect(
        tx.lease.update({
          where: { id: lease.id },
          data: { terminationDate: new Date('2024-12-31') },
        }),
      ).rejects.toThrow(/lease_termination_after_start/);
    });
  });

  it('ALLOWS a move-out AFTER the contracted end — holdover is real and must be recordable', async () => {
    // Deliberately no upper bound on the CHECK. A tenant staying past their term is
    // normal, and bounding this would force it to be entered as a lie.
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id) });

      const held = await tx.lease.update({
        where: { id: lease.id },
        data: { terminationDate: new Date('2030-04-01') },
      });
      expect(held.terminationDate).toEqual(new Date('2030-04-01'));
    });
  });
});

maybe()('invoice_void_requires_voided_at', () => {
  it('refuses a VOID invoice with no voidedAt', async () => {
    // A VOID row with no date is indistinguishable from one voided at an unknown time,
    // and the AR reports have no date to exclude it from.
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id) });
      const invoice = await tx.leaseRentInvoice.create({
        data: {
          leaseId: lease.id,
          periodMonth: new Date('2026-01-01'),
          dueDate: new Date('2026-01-01'),
          amountDue: 1000,
        },
      });

      await expect(
        tx.leaseRentInvoice.update({ where: { id: invoice.id }, data: { status: 'VOID' } }),
      ).rejects.toThrow(/invoice_void_requires_voided_at/);
    });
  });

  it('accepts a VOID that carries its date', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id) });
      const invoice = await tx.leaseRentInvoice.create({
        data: {
          leaseId: lease.id,
          periodMonth: new Date('2026-01-01'),
          dueDate: new Date('2026-01-01'),
          amountDue: 1000,
        },
      });

      const voided = await tx.leaseRentInvoice.update({
        where: { id: invoice.id },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Tenancy ended' },
      });
      expect(voided.status).toBe('VOID');
    });
  });
});

maybe()('leases_successorLeaseId_key', () => {
  it('refuses two leases claiming the same successor', async () => {
    // Without this, a "continuation" could be claimed by two predecessors and the
    // timeline's continuity derivation would have no single answer.
    await inRolledBackTx(async (tx) => {
      const a = await seedUnit(tx);
      const b = await seedUnit(tx);
      const c = await seedUnit(tx);
      const successor = await tx.lease.create({ data: leaseData(c.unit.id) });
      const first = await tx.lease.create({ data: leaseData(a.unit.id) });
      const second = await tx.lease.create({ data: leaseData(b.unit.id) });

      await tx.lease.update({ where: { id: first.id }, data: { successorLeaseId: successor.id } });

      await expect(
        tx.lease.update({ where: { id: second.id }, data: { successorLeaseId: successor.id } }),
      ).rejects.toThrow();
    });
  });
});

maybe()('task_units', () => {
  it('cascades away with its task, leaving no orphan links', async () => {
    await inRolledBackTx(async (tx) => {
      const { project, building, unit } = await seedUnit(tx);
      // Was `if (!user) return;` — which made this constraint test pass by doing
      // nothing on any database without seed data, CI's included.
      const user = { id: await ensureUser(tx) };

      const task = await tx.task.create({
        data: {
          projectId: project.id,
          buildingId: building.id,
          kind: 'CONSTRUCTION',
          title: 'IT item',
          createdBy: user.id,
          units: { create: [{ unitId: unit.id }] },
        },
      });

      expect(await tx.taskUnit.count({ where: { taskId: task.id } })).toBe(1);
      await tx.task.delete({ where: { id: task.id } });
      expect(await tx.taskUnit.count({ where: { taskId: task.id } })).toBe(0);
    });
  });

  it('refuses to link the same unit to one task twice', async () => {
    // The composite primary key. Without it a careless relink could double-count a unit
    // on the board's "shared with" label.
    await inRolledBackTx(async (tx) => {
      const { project, building, unit } = await seedUnit(tx);
      const user = { id: await ensureUser(tx) };

      const task = await tx.task.create({
        data: {
          projectId: project.id,
          buildingId: building.id,
          title: 'IT item',
          createdBy: user.id,
          units: { create: [{ unitId: unit.id }] },
        },
      });

      await expect(
        tx.taskUnit.create({ data: { taskId: task.id, unitId: unit.id } }),
      ).rejects.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// endTenancy atomicity — against a REAL database
//
// The single most important claim in the T1.2 design is "one transaction; a lease
// marked terminated whose schedule still runs, or whose unit still reads LEASED, is
// worse than a refusal."
//
// No unit test can check it. Every spec in src/ stubs `$transaction` as
// `(fn) => fn(mockPrisma)` — a pass-through with no rollback semantics at all, so a
// service that committed each step independently would pass all 700 of them.
// ---------------------------------------------------------------------------

maybe()('endTenancy atomicity', () => {
  /**
   * These CANNOT use inRolledBackTx: a Prisma transaction client has no `$transaction`
   * method, so the service's own transaction cannot be nested inside the test's. That
   * limitation is the point — the whole thing being verified here is the service's REAL
   * transaction, and a nested one would not have the semantics under test.
   *
   * So they commit for real and clean up after themselves. Deleting the project
   * cascades to building, unit, lease, invoices and occupancy events.
   */
  const created: string[] = [];

  afterEach(async () => {
    for (const projectId of created.splice(0)) {
      // Leases FIRST, and explicitly. `leases.unitId` is ON DELETE SET NULL, so deleting
      // the project cascades to units but leaves the leases behind as orphans pointing
      // at neither a unit nor a building — rows that violate the service's "exactly one
      // of" rule and that nothing would ever clean up.
      //
      // Not swallowing errors here either: a cleanup that fails silently is how an
      // integration suite slowly fills a database with its own debris.
      const units = await prisma.unit.findMany({
        where: { building: { projectId } },
        select: { id: true },
      });
      const unitIds = units.map((u) => u.id);
      if (unitIds.length) {
        await prisma.leaseRentInvoice.deleteMany({ where: { lease: { unitId: { in: unitIds } } } });
        await prisma.leaseRentPeriod.deleteMany({ where: { lease: { unitId: { in: unitIds } } } });
        await prisma.leaseObligation.deleteMany({ where: { lease: { unitId: { in: unitIds } } } });
        await prisma.lease.deleteMany({ where: { unitId: { in: unitIds } } });
      }
      await prisma.project.delete({ where: { id: projectId } });
    }
  });

  async function seedCommitted() {
    const seeded = await seedUnit(prisma);
    created.push(seeded.project.id);
    await prisma.unit.update({ where: { id: seeded.unit.id }, data: { status: 'LEASED' } });
    const lease = await prisma.lease.create({ data: leaseData(seeded.unit.id) });
    return { ...seeded, lease };
  }

  /** The real service graph, wired to a real Prisma client. */
  function realLeasesService(client: any, overrides: { invoices?: any } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LeasesService } = require('../src/modules/leases/leases.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LeaseRentPeriodService } = require('../src/modules/leases/lease-rent-period.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LeaseRentInvoiceService } = require('../src/modules/leases/lease-rent-invoice.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LeaseObligationService } = require('../src/modules/leases/lease-obligation.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { UnitStatusEventService } = require('../src/common/utils/unit-status-event.service');

    const bus = { emit: () => undefined, on: () => undefined };
    const audit = { log: async () => undefined };

    return new LeasesService(
      client,
      new LeaseRentPeriodService(client),
      bus,
      new LeaseObligationService(client, bus),
      audit,
      overrides.invoices ?? new LeaseRentInvoiceService(client),
      new UnitStatusEventService(client),
    );
  }

  it('commits the lease stamp, the unit release and the occupancy event together', async () => {
    const { unit, lease } = await seedCommitted();

    await realLeasesService(prisma).endTenancy(lease.id, {
      terminationDate: '2026-06-30',
      terminationReason: 'EARLY_TERMINATION',
    });

    const after = await prisma.lease.findUnique({ where: { id: lease.id } });
    const unitAfter = await prisma.unit.findUnique({ where: { id: unit.id } });
    const events = await prisma.unitStatusEvent.count({
      where: { unitId: unit.id, source: 'LEASE_ENDED' },
    });

    expect(after!.terminationDate).toEqual(new Date('2026-06-30'));
    expect(after!.status).toBe('TERMINATED');
    expect(unitAfter!.status).toBe('AVAILABLE');
    // availableSince is what the vacancy report ages from — the whole point of the unit
    // write, and the step people used to forget when doing this by hand.
    expect(unitAfter!.availableSince).toEqual(new Date('2026-06-30'));
    expect(events).toBe(1);
  });

  it('ROLLS BACK the lease stamp when a later step fails', async () => {
    const { unit, lease } = await seedCommitted();

    // Fail at the void step — AFTER the lease row has been stamped and the schedule
    // capped. If the design were wrong, the stamp would survive and the lease would
    // read TERMINATED while its ledger carried on billing.
    const brokenInvoices = {
      paidAfter: async () => [],
      voidAfter: async () => {
        throw new Error('simulated failure inside the transaction');
      },
    };

    await expect(
      realLeasesService(prisma, { invoices: brokenInvoices }).endTenancy(lease.id, {
        terminationDate: '2026-06-30',
        terminationReason: 'EARLY_TERMINATION',
      }),
    ).rejects.toThrow(/simulated failure/);

    const after = await prisma.lease.findUnique({ where: { id: lease.id } });
    const unitAfter = await prisma.unit.findUnique({ where: { id: unit.id } });

    expect(after!.terminationDate).toBeNull();
    expect(after!.status).toBe('ACTIVE');
    expect(unitAfter!.status).toBe('LEASED');
  });

  it('leaves no orphan occupancy event when the transaction fails', async () => {
    // The event is written INSIDE the transaction on purpose. UnitStatusEventService
    // deliberately does not swallow its errors (unlike AuditService) — a unit that
    // moved without an event is a hole in the vacancy history, and an event for a
    // move that was rolled back is the same hole in reverse.
    const { unit, lease } = await seedCommitted();

    const brokenInvoices = {
      paidAfter: async () => [],
      voidAfter: async () => { throw new Error('boom'); },
    };

    await expect(
      realLeasesService(prisma, { invoices: brokenInvoices }).endTenancy(lease.id, {
        terminationDate: '2026-06-30',
        terminationReason: 'EARLY_TERMINATION',
      }),
    ).rejects.toThrow();

    expect(
      await prisma.unitStatusEvent.count({ where: { unitId: unit.id, source: 'LEASE_ENDED' } }),
    ).toBe(0);
  });
});

maybe()('historical_deletion_decision_has_decider (R27)', () => {
  /** A PENDING request needs a requester who exists; borrow any active user. */
  // Delegates to ensureUser so a fresh database gets a real id rather than `undefined`
  // smuggled through an `as string`.
  async function anyUser(tx: any) {
    return ensureUser(tx);
  }

  it('accepts a PENDING request with no decider — nobody has decided yet', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id, { isHistorical: true }) });

      const row = await tx.historicalRecordDeletion.create({
        data: { leaseId: lease.id, reason: 'entered twice', requestedById: await anyUser(tx) },
      });
      expect(row.status).toBe('PENDING');
    });
  });

  it('refuses a decided request that names no decider', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id, { isHistorical: true }) });

      // The whole point of the gate is that a person decided. A row claiming APPROVED
      // with nobody attached is an approval that never happened.
      await expect(
        tx.historicalRecordDeletion.create({
          data: {
            leaseId: lease.id,
            reason: 'entered twice',
            requestedById: await anyUser(tx),
            status: 'APPROVED',
          },
        }),
      ).rejects.toThrow(/historical_deletion_decision_has_decider|constraint/i);
    });
  });

  it('cascades away with its lease, leaving no orphan requests', async () => {
    await inRolledBackTx(async (tx) => {
      const { unit } = await seedUnit(tx);
      const lease = await tx.lease.create({ data: leaseData(unit.id, { isHistorical: true }) });
      await tx.historicalRecordDeletion.create({
        data: { leaseId: lease.id, reason: 'entered twice', requestedById: await anyUser(tx) },
      });

      await tx.lease.delete({ where: { id: lease.id } });

      expect(await tx.historicalRecordDeletion.count({ where: { leaseId: lease.id } })).toBe(0);
    });
  });
});

maybe()('rent_correction constraints (R22)', () => {
  async function seedPeriod(tx: any) {
    const { unit } = await seedUnit(tx);
    const lease = await tx.lease.create({ data: leaseData(unit.id) });
    const period = await tx.leaseRentPeriod.create({
      data: {
        leaseId: lease.id,
        sequence: 1,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        baseRent: 1000,
        monthlyRent: 1000,
        source: 'INITIAL',
      },
    });
    return { lease, period, userId: await ensureUser(tx) };
  }

  it('records a correction that moves the rent', async () => {
    await inRolledBackTx(async (tx) => {
      const { lease, period, userId } = await seedPeriod(tx);
      const row = await tx.leaseRentPeriodCorrection.create({
        data: {
          periodId: period.id,
          leaseId: lease.id,
          previousRent: 1000,
          correctedRent: 1050,
          reason: 'Signed lease says 1,050',
          correctedById: userId,
        },
      });
      expect(Number(row.previousRent)).toBe(1000);
    });
  });

  it('refuses a blank reason — the DB, not only the DTO', async () => {
    await inRolledBackTx(async (tx) => {
      const { lease, period, userId } = await seedPeriod(tx);
      await expect(
        tx.leaseRentPeriodCorrection.create({
          data: {
            periodId: period.id, leaseId: lease.id,
            previousRent: 1000, correctedRent: 1050,
            reason: '   ',
            correctedById: userId,
          },
        }),
      ).rejects.toThrow(/rent_correction_reason_not_blank|constraint/i);
    });
  });

  it('refuses a correction that corrects nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const { lease, period, userId } = await seedPeriod(tx);
      await expect(
        tx.leaseRentPeriodCorrection.create({
          data: {
            periodId: period.id, leaseId: lease.id,
            previousRent: 1000, correctedRent: 1000,
            reason: 'same number both sides',
            correctedById: userId,
          },
        }),
      ).rejects.toThrow(/rent_correction_changes_something|constraint/i);
    });
  });

  it('accepts a date-only correction, where the rent is unchanged on purpose', async () => {
    await inRolledBackTx(async (tx) => {
      const { lease, period, userId } = await seedPeriod(tx);
      const row = await tx.leaseRentPeriodCorrection.create({
        data: {
          periodId: period.id, leaseId: lease.id,
          previousRent: 1000, correctedRent: 1000,
          previousEndDate: new Date('2025-12-31'),
          correctedEndDate: new Date('2025-11-30'),
          reason: 'Period ran to November',
          correctedById: userId,
        },
      });
      expect(row.correctedEndDate?.toISOString().slice(0, 10)).toBe('2025-11-30');
    });
  });

  it('refuses to delete the author — a correction whose author cannot be named is not provenance', async () => {
    await inRolledBackTx(async (tx) => {
      const { lease, period, userId } = await seedPeriod(tx);
      await tx.leaseRentPeriodCorrection.create({
        data: {
          periodId: period.id, leaseId: lease.id,
          previousRent: 1000, correctedRent: 1050,
          reason: 'Signed lease says 1,050',
          correctedById: userId,
        },
      });

      await expect(tx.user.delete({ where: { id: userId } })).rejects.toThrow();
    });
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MilestoneDepsService } from './milestone-deps.service';
import { MilestonesService } from './milestones.service';

const DAY = 24 * 60 * 60 * 1000;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * An in-memory milestone graph, so the cascade tests read as schedules rather than as
 * chains of mockResolvedValueOnce. `dependsOnId` is the only edge; `linkedDrawScheduleId`
 * is the C4 hook.
 */
interface FakeMilestone {
  id: string;
  title: string;
  projectId: string;
  dueDate: Date;
  status: string;
  dependsOnId: string | null;
  linkedDrawScheduleId: string | null;
}

interface FakeSchedule {
  id: string;
  drawNumber: number;
  plannedDate: Date;
}

function makeWorld(milestones: FakeMilestone[], schedules: FakeSchedule[] = []) {
  const ms = new Map(milestones.map((m) => [m.id, { ...m }]));
  const sch = new Map(schedules.map((s) => [s.id, { ...s }]));

  const proposals = new Map<string, any>();
  const items: any[] = [];
  let seq = 0;

  const matchIn = (value: any, filter: any) =>
    filter && typeof filter === 'object' && 'in' in filter ? filter.in.includes(value) : value === filter;

  const prisma: any = {
    milestone: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(ms.get(where.id) ?? null)),
      findMany: jest.fn(({ where }: any) => {
        let rows = [...ms.values()];
        if (where?.id) rows = rows.filter((m) => matchIn(m.id, where.id));
        if (where?.dependsOnId) rows = rows.filter((m) => matchIn(m.dependsOnId, where.dependsOnId));
        if (where?.status?.notIn) rows = rows.filter((m) => !where.status.notIn.includes(m.status));
        return Promise.resolve(rows.map((r) => ({ ...r })));
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = ms.get(where.id);
        Object.assign(row!, data);
        return Promise.resolve({ ...row });
      }),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    drawSchedule: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(sch.get(where.id) ?? null)),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve([...sch.values()].filter((s) => matchIn(s.id, where.id)).map((s) => ({ ...s }))),
      ),
      update: jest.fn(({ where, data }: any) => {
        const row = sch.get(where.id);
        Object.assign(row!, data);
        return Promise.resolve({ ...row });
      }),
    },
    milestoneSlipProposal: {
      create: jest.fn(({ data }: any) => {
        const id = `prop-${++seq}`;
        const created = {
          id,
          projectId: data.projectId,
          milestoneId: data.milestoneId,
          oldDueDate: data.oldDueDate,
          newDueDate: data.newDueDate,
          daysSlipped: data.daysSlipped,
          status: 'PENDING',
          requestedById: data.requestedById ?? null,
          decidedById: null,
          decidedAt: null,
          decisionNote: null,
          supersededById: null,
        };
        proposals.set(id, created);
        for (const it of data.items.create) {
          items.push({ id: `item-${items.length + 1}`, proposalId: id, ...it });
        }
        return Promise.resolve({ ...created, items: items.filter((i) => i.proposalId === id) });
      }),
      findUnique: jest.fn(({ where, include }: any) => {
        const p = proposals.get(where.id);
        if (!p) return Promise.resolve(null);
        return Promise.resolve(
          include?.items ? { ...p, items: items.filter((i) => i.proposalId === p.id) } : { ...p },
        );
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          [...proposals.values()]
            .filter((p) => (where?.milestoneId ? p.milestoneId === where.milestoneId : true))
            .filter((p) => (where?.status ? p.status === where.status : true))
            .map((p) => ({ ...p })),
        ),
      ),
      update: jest.fn(({ where, data }: any) => {
        const p = proposals.get(where.id);
        Object.assign(p, data);
        return Promise.resolve({ ...p, items: items.filter((i) => i.proposalId === p.id) });
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        let rows = [...proposals.values()];
        if (where?.id?.in) rows = rows.filter((p) => where.id.in.includes(p.id));
        else if (where?.id) rows = rows.filter((p) => p.id === where.id);
        if (where?.status?.notIn) rows = rows.filter((p) => !where.status.notIn.includes(p.status));
        else if (where?.status) rows = rows.filter((p) => p.status === where.status);
        for (const p of rows) Object.assign(p, data);
        return Promise.resolve({ count: rows.length });
      }),
    },
    project: { findUnique: jest.fn(() => Promise.resolve({ name: 'Riverbend' })) },
    user: { findUnique: jest.fn(() => Promise.resolve({ id: 'u1', name: 'Priya' })) },
    auditEvent: { create: jest.fn(() => Promise.resolve({})) },
    $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  };

  return { prisma, ms, sch, proposals, items };
}

const mockBus = () => ({ emit: jest.fn() });
const mockAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

/** Every event of one type the service put on the bus. */
const eventsOf = (bus: any, type: string) =>
  bus.emit.mock.calls.map((c: any[]) => c[0]).filter((e: any) => e.type === type);

// A → B → C, plus D hanging off A. C is where the transitive test bites.
function chainWorld() {
  return makeWorld(
    [
      { id: 'A', title: 'Foundation', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: null, linkedDrawScheduleId: null },
      { id: 'B', title: 'Framing', projectId: 'p1', dueDate: d('2026-04-01'), status: 'NOT_STARTED', dependsOnId: 'A', linkedDrawScheduleId: null },
      { id: 'C', title: 'Roofing', projectId: 'p1', dueDate: d('2026-05-01'), status: 'NOT_STARTED', dependsOnId: 'B', linkedDrawScheduleId: null },
      { id: 'D', title: 'Site power', projectId: 'p1', dueDate: d('2026-04-15'), status: 'NOT_STARTED', dependsOnId: 'A', linkedDrawScheduleId: null },
    ],
  );
}

function serviceFor(world: ReturnType<typeof makeWorld>) {
  const bus = mockBus();
  const audit = mockAudit();
  const service = new MilestoneDepsService(world.prisma, bus as any, audit as any);
  return { service, bus, audit };
}

const propose = (service: MilestoneDepsService, overrides: Partial<Parameters<MilestoneDepsService['proposeSlippage']>[0]> = {}) =>
  service.proposeSlippage({
    milestoneId: 'A',
    projectId: 'p1',
    oldDueDate: d('2026-03-01'),
    newDueDate: d('2026-03-11'),
    daysSlipped: 10,
    requestedById: 'u1',
    ...overrides,
  });

describe('MilestoneDepsService — slip proposals (C3)', () => {
  // ─────── propose, do not apply ───────

  describe('proposeSlippage', () => {
    it('persists the cascade WITHOUT writing a single due date', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      const proposal = await propose(service);

      expect(proposal).not.toBeNull();
      expect(proposal!.status).toBe('PENDING');
      expect(world.prisma.milestone.update).not.toHaveBeenCalled();
      expect(world.prisma.drawSchedule.update).not.toHaveBeenCalled();
      // The schedule is untouched: B, C and D still hold their original dates.
      expect(world.ms.get('B')!.dueDate).toEqual(d('2026-04-01'));
      expect(world.ms.get('C')!.dueDate).toEqual(d('2026-05-01'));
      expect(world.ms.get('D')!.dueDate).toEqual(d('2026-04-15'));
    });

    it('walks the dependent tree transitively, one item per milestone', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      const proposal = await propose(service);
      const byId = new Map(proposal!.items.map((i: any) => [i.milestoneId, i]));

      // Trigger + B + D (depth 1) + C (depth 2).
      expect([...byId.keys()].sort()).toEqual(['A', 'B', 'C', 'D']);
      expect(byId.get('A')!.isTrigger).toBe(true);
      expect(byId.get('B')!.depth).toBe(1);
      expect(byId.get('D')!.depth).toBe(1);
      expect(byId.get('C')!.depth).toBe(2);
      expect(byId.get('C')!.proposedDueDate).toEqual(new Date(d('2026-05-01').getTime() + 10 * DAY));
    });

    it("records the trigger's own date as already-moved so approval never rewrites it", async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      const proposal = await propose(service);
      const trigger = proposal!.items.find((i: any) => i.isTrigger)!;

      expect(trigger.currentDueDate).toEqual(trigger.proposedDueDate);
    });

    it('emits milestone.slipProposed, and NOT milestone.slipped — nothing has moved yet', async () => {
      const world = chainWorld();
      const { service, bus } = serviceFor(world);

      await propose(service);

      expect(eventsOf(bus, 'milestone.slipped')).toHaveLength(0);
      const [proposed] = eventsOf(bus, 'milestone.slipProposed');
      expect(proposed).toMatchObject({
        milestoneId: 'A',
        projectId: 'p1',
        daysSlipped: 10,
        affectedCount: 3, // B, C, D — the trigger is not "affected", its date already moved
        drawCount: 0,
        requestedById: 'u1',
      });
    });

    it('excludes COMPLETED milestones, and stops the walk there', async () => {
      const world = chainWorld();
      world.ms.get('B')!.status = 'COMPLETED';
      const { service } = serviceFor(world);

      const proposal = await propose(service);
      const ids = proposal!.items.map((i: any) => i.milestoneId).sort();

      // B is done, so it does not move — and C, which only waits on B, is not reached.
      expect(ids).toEqual(['A', 'D']);
    });

    it('terminates on a pre-existing cycle instead of walking forever', async () => {
      // setDependency() rejects new cycles, but one already in the data (or created by a
      // future bulk import) must not hang the walk. Milestone has a single dependsOnId, so
      // a cycle is the only way to reach the same row twice.
      const world = makeWorld([
        { id: 'A', title: 'A', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: 'B', linkedDrawScheduleId: null },
        { id: 'B', title: 'B', projectId: 'p1', dueDate: d('2026-04-01'), status: 'NOT_STARTED', dependsOnId: 'A', linkedDrawScheduleId: null },
      ]);
      const { service } = serviceFor(world);

      const proposal = await propose(service);

      // A is visited as the trigger and never re-added when B's dependents are read.
      expect(proposal!.items.map((i: any) => i.milestoneId).sort()).toEqual(['A', 'B']);
      expect(proposal!.items.filter((i: any) => i.milestoneId === 'A')).toHaveLength(1);
    });

    it('proposes nothing when there are no dependents and no lender draw', async () => {
      const world = makeWorld([
        { id: 'A', title: 'Solo', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: null, linkedDrawScheduleId: null },
      ]);
      const { service, bus } = serviceFor(world);

      const proposal = await propose(service);

      // An approval request for a no-op is exactly the notification that trains people to
      // stop reading them.
      expect(proposal).toBeNull();
      expect(world.prisma.milestoneSlipProposal.create).not.toHaveBeenCalled();
      expect(eventsOf(bus, 'milestone.slipProposed')).toHaveLength(0);
    });

    it('proposes nothing for a zero or negative delta (a pull-in is not a slip)', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      expect(await propose(service, { daysSlipped: 0 })).toBeNull();
      expect(await propose(service, { daysSlipped: -5 })).toBeNull();
      expect(world.prisma.milestoneSlipProposal.create).not.toHaveBeenCalled();
    });

    it('records no draw fields for a milestone that funds nothing', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      const proposal = await propose(service);

      for (const item of proposal!.items) {
        expect(item.drawScheduleId).toBeNull();
        expect(item.currentDrawDate).toBeNull();
        expect(item.proposedDrawDate).toBeNull();
      }
    });
  });

  // ─────── superseding ───────

  describe('superseding', () => {
    it('closes the pending proposal when the same milestone slips again', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      const first = await propose(service);
      const second = await propose(service, { daysSlipped: 3, newDueDate: d('2026-03-14') });

      const stored = world.proposals.get(first!.id);
      expect(stored.status).toBe('SUPERSEDED');
      expect(stored.supersededById).toBe(second!.id);
      // No decider: nobody decided this, a newer slip arrived.
      expect(stored.decidedById).toBeNull();
      expect(stored.decidedAt).toBeInstanceOf(Date);
      expect(world.proposals.get(second!.id).status).toBe('PENDING');
    });

    it('leaves exactly one applyable proposal per trigger milestone', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      await propose(service);
      await propose(service, { daysSlipped: 3 });
      await propose(service, { daysSlipped: 7 });

      const pending = [...world.proposals.values()].filter((p) => p.status === 'PENDING');
      expect(pending).toHaveLength(1);
    });

    it('refuses to decide a superseded proposal', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);

      const first = await propose(service);
      await propose(service, { daysSlipped: 3 });

      await expect(service.decideProposal(first!.id, true, 'pm1')).rejects.toThrow(BadRequestException);
      expect(world.prisma.milestone.update).not.toHaveBeenCalled();
    });
  });

  // ─────── approve / reject ───────

  describe('decideProposal', () => {
    it('applies every shift transitively on approval', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);

      const applied = await service.decideProposal(proposal!.id, true, 'pm1', 'Weather delay');

      expect(applied.status).toBe('APPROVED');
      expect(applied.decidedById).toBe('pm1');
      expect(applied.decidedAt).toBeInstanceOf(Date);
      expect(applied.decisionNote).toBe('Weather delay');
      expect(world.ms.get('B')!.dueDate).toEqual(new Date(d('2026-04-01').getTime() + 10 * DAY));
      expect(world.ms.get('C')!.dueDate).toEqual(new Date(d('2026-05-01').getTime() + 10 * DAY));
      expect(world.ms.get('D')!.dueDate).toEqual(new Date(d('2026-04-15').getTime() + 10 * DAY));
      // The trigger's own date was already written by MilestonesService — approval must
      // not touch it again.
      expect(world.ms.get('A')!.dueDate).toEqual(d('2026-03-01'));
    });

    it('emits milestone.slipped once per milestone that actually moved', async () => {
      const world = chainWorld();
      const { service, bus } = serviceFor(world);
      const proposal = await propose(service);
      bus.emit.mockClear();

      await service.decideProposal(proposal!.id, true, 'pm1');

      const slipped = eventsOf(bus, 'milestone.slipped');
      expect(slipped.map((e: any) => e.milestoneId).sort()).toEqual(['B', 'C', 'D']);
      expect(slipped[0]).toMatchObject({ daysSlipped: 10 });
    });

    it('changes nothing on rejection', async () => {
      const world = chainWorld();
      const { service, bus } = serviceFor(world);
      const proposal = await propose(service);
      bus.emit.mockClear();

      const rejected = await service.decideProposal(proposal!.id, false, 'pm1', 'Re-sequencing instead');

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.decidedById).toBe('pm1');
      expect(world.prisma.milestone.update).not.toHaveBeenCalled();
      expect(world.prisma.drawSchedule.update).not.toHaveBeenCalled();
      expect(world.ms.get('B')!.dueDate).toEqual(d('2026-04-01'));
      expect(eventsOf(bus, 'milestone.slipped')).toHaveLength(0);
    });

    it('refuses to decide the same proposal twice', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);
      await service.decideProposal(proposal!.id, true, 'pm1');

      await expect(service.decideProposal(proposal!.id, true, 'pm2')).rejects.toThrow(BadRequestException);
    });

    it('404s on an unknown proposal', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      await expect(service.decideProposal('nope', true, 'pm1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─────── staleness ───────

  describe('staleness', () => {
    it('refuses to apply when a milestone in the cascade was re-dated since', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);

      // Somebody moved C by hand two days later.
      world.ms.get('C')!.dueDate = d('2026-05-20');

      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toThrow(ConflictException);
      // Nothing partially applied — B still holds its original date.
      expect(world.ms.get('B')!.dueDate).toEqual(d('2026-04-01'));
      expect(world.proposals.get(proposal!.id).status).toBe('STALE');
    });

    it('names what drifted so the reviewer knows why', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);
      world.ms.get('C')!.dueDate = d('2026-05-20');

      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toMatchObject({
        response: { drift: [{ milestoneId: 'C' }] },
      });
    });

    it('treats a milestone completed since the proposal as drift', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);

      world.ms.get('D')!.status = 'COMPLETED';

      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toThrow(ConflictException);
      expect(world.ms.get('D')!.dueDate).toEqual(d('2026-04-15'));
    });

    it('treats a lender draw date changed since the proposal as drift', async () => {
      const world = makeWorld(
        [
          { id: 'A', title: 'Foundation', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: null, linkedDrawScheduleId: 'ds1' },
          { id: 'B', title: 'Framing', projectId: 'p1', dueDate: d('2026-04-01'), status: 'NOT_STARTED', dependsOnId: 'A', linkedDrawScheduleId: null },
        ],
        [{ id: 'ds1', drawNumber: 3, plannedDate: d('2026-03-05') }],
      );
      const { service } = serviceFor(world);
      const proposal = await propose(service);

      world.sch.get('ds1')!.plannedDate = d('2026-03-20');

      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toThrow(ConflictException);
      expect(world.sch.get('ds1')!.plannedDate).toEqual(d('2026-03-20'));
      expect(world.ms.get('B')!.dueDate).toEqual(d('2026-04-01'));
    });

    it('rejection still works on a drifted proposal — nothing is being written', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);
      world.ms.get('C')!.dueDate = d('2026-05-20');

      const rejected = await service.decideProposal(proposal!.id, false, 'pm1');
      expect(rejected.status).toBe('REJECTED');
    });

    it('a STALE proposal is terminal — it cannot later be approved', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);
      world.ms.get('C')!.dueDate = d('2026-05-20');
      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toThrow(ConflictException);

      // Even if the schedule is put back, the row stays closed: recovery is a NEW cascade.
      world.ms.get('C')!.dueDate = d('2026-05-01');
      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─────── recompute ───────

  describe('recomputeProposal', () => {
    it('builds a fresh proposal against the current schedule and links the old one forward', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);
      world.ms.get('C')!.dueDate = d('2026-05-20');
      await expect(service.decideProposal(proposal!.id, true, 'pm1')).rejects.toThrow(ConflictException);

      const fresh = await service.recomputeProposal(proposal!.id, 'pm1');

      expect(fresh!.id).not.toBe(proposal!.id);
      expect(fresh!.status).toBe('PENDING');
      const freshC = fresh!.items.find((i: any) => i.milestoneId === 'C')!;
      // Recomputed off the NEW date, not the one captured last week.
      expect(freshC.currentDueDate).toEqual(d('2026-05-20'));
      expect(freshC.proposedDueDate).toEqual(new Date(d('2026-05-20').getTime() + 10 * DAY));
      expect(world.proposals.get(proposal!.id).supersededById).toBe(fresh!.id);
    });

    it('refuses to recompute a proposal somebody already decided', async () => {
      const world = chainWorld();
      const { service } = serviceFor(world);
      const proposal = await propose(service);
      await service.decideProposal(proposal!.id, false, 'pm1');

      await expect(service.recomputeProposal(proposal!.id, 'pm1')).rejects.toThrow(BadRequestException);
    });
  });
});

describe('MilestoneDepsService — linked lender draw dates (C4)', () => {
  function drawWorld() {
    return makeWorld(
      [
        { id: 'A', title: 'Foundation', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: null, linkedDrawScheduleId: 'ds1' },
        { id: 'B', title: 'Framing', projectId: 'p1', dueDate: d('2026-04-01'), status: 'NOT_STARTED', dependsOnId: 'A', linkedDrawScheduleId: 'ds2' },
        { id: 'C', title: 'Roofing', projectId: 'p1', dueDate: d('2026-05-01'), status: 'NOT_STARTED', dependsOnId: 'B', linkedDrawScheduleId: null },
      ],
      [
        { id: 'ds1', drawNumber: 3, plannedDate: d('2026-03-05') },
        { id: 'ds2', drawNumber: 4, plannedDate: d('2026-04-05') },
      ],
    );
  }

  it("includes the trigger's own draw even though its due date is already written", async () => {
    const world = drawWorld();
    const { service } = serviceFor(world);

    const proposal = await propose(service);
    const trigger = proposal!.items.find((i: any) => i.isTrigger)!;

    expect(trigger.drawScheduleId).toBe('ds1');
    expect(trigger.currentDrawDate).toEqual(d('2026-03-05'));
    expect(trigger.proposedDrawDate).toEqual(new Date(d('2026-03-05').getTime() + 10 * DAY));
    // Still nothing written.
    expect(world.sch.get('ds1')!.plannedDate).toEqual(d('2026-03-05'));
  });

  it('shifts plannedDate by the same delta as the milestone, on approval only', async () => {
    const world = drawWorld();
    const { service } = serviceFor(world);
    const proposal = await propose(service);

    expect(world.prisma.drawSchedule.update).not.toHaveBeenCalled();

    await service.decideProposal(proposal!.id, true, 'pm1');

    expect(world.sch.get('ds1')!.plannedDate).toEqual(new Date(d('2026-03-05').getTime() + 10 * DAY));
    expect(world.sch.get('ds2')!.plannedDate).toEqual(new Date(d('2026-04-05').getTime() + 10 * DAY));
  });

  it('applies milestone dates and lender draw dates in ONE transaction', async () => {
    const world = drawWorld();
    const { service } = serviceFor(world);
    const proposal = await propose(service);

    world.prisma.$transaction.mockClear();
    await service.decideProposal(proposal!.id, true, 'pm1');

    // A single callback transaction wraps the milestone writes, the draw writes and the
    // status flip. A half-applied cascade would leave the lender's schedule disagreeing
    // with the construction schedule it funds.
    expect(world.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reports the draw count on the proposal event so the alert can say so', async () => {
    const world = drawWorld();
    const { service, bus } = serviceFor(world);

    await propose(service);

    expect(eventsOf(bus, 'milestone.slipProposed')[0]).toMatchObject({ drawCount: 2 });
  });

  it('proposes a draw-only cascade when the milestone has no dependents at all', async () => {
    const world = makeWorld(
      [{ id: 'A', title: 'Foundation', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: null, linkedDrawScheduleId: 'ds1' }],
      [{ id: 'ds1', drawNumber: 3, plannedDate: d('2026-03-05') }],
    );
    const { service } = serviceFor(world);

    const proposal = await propose(service);

    // No dependents, but a lender date must never move unreviewed — so there IS something
    // to approve.
    expect(proposal).not.toBeNull();
    expect(proposal!.items).toHaveLength(1);
    expect(proposal!.items[0].drawScheduleId).toBe('ds1');
  });

  it('claims a shared draw schedule once, so it moves by one delta not two', async () => {
    const world = makeWorld(
      [
        { id: 'A', title: 'Foundation', projectId: 'p1', dueDate: d('2026-03-01'), status: 'IN_PROGRESS', dependsOnId: null, linkedDrawScheduleId: 'ds1' },
        { id: 'B', title: 'Framing', projectId: 'p1', dueDate: d('2026-04-01'), status: 'NOT_STARTED', dependsOnId: 'A', linkedDrawScheduleId: 'ds1' },
      ],
      [{ id: 'ds1', drawNumber: 3, plannedDate: d('2026-03-05') }],
    );
    const { service } = serviceFor(world);
    const proposal = await propose(service);

    expect(proposal!.items.filter((i: any) => i.drawScheduleId === 'ds1')).toHaveLength(1);

    await service.decideProposal(proposal!.id, true, 'pm1');
    expect(world.sch.get('ds1')!.plannedDate).toEqual(new Date(d('2026-03-05').getTime() + 10 * DAY));
  });
});

describe('MilestonesService.update — raises the gate instead of writing through it', () => {
  function setup() {
    const world = chainWorld();
    const bus = mockBus();
    const audit = mockAudit();
    const deps = new MilestoneDepsService(world.prisma, bus as any, audit as any);
    // findById() enriches photos; the storage stub keeps that out of the way.
    world.prisma.milestone.findUnique = jest.fn(({ where }: any) => {
      const m = world.ms.get(where.id);
      return Promise.resolve(m ? { ...m, photos: [] } : null);
    });
    const storage = { signedUrl: jest.fn().mockResolvedValue('') };
    const service = new MilestonesService(world.prisma, bus as any, deps, storage as any);
    return { world, bus, service };
  }

  /** proposeSlippage is fire-and-forget; let its promise chain settle. */
  const flush = () => new Promise((r) => setImmediate(r));

  it("writes the edited milestone's own date but nothing downstream", async () => {
    const { world, service } = setup();

    await service.update('A', { dueDate: d('2026-03-11') } as any, 'u1');
    await flush();

    expect(world.ms.get('A')!.dueDate).toEqual(d('2026-03-11'));
    expect(world.ms.get('B')!.dueDate).toEqual(d('2026-04-01'));
    expect(world.ms.get('C')!.dueDate).toEqual(d('2026-05-01'));
  });

  it('raises exactly one PENDING proposal, attributed to the editor', async () => {
    const { world, service } = setup();

    await service.update('A', { dueDate: d('2026-03-11') } as any, 'u1');
    await flush();

    const pending = [...world.proposals.values()].filter((p) => p.status === 'PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ milestoneId: 'A', daysSlipped: 10, requestedById: 'u1' });
  });

  it('raises nothing when the date is pulled IN', async () => {
    const { world, service } = setup();

    await service.update('A', { dueDate: d('2026-02-20') } as any, 'u1');
    await flush();

    expect(world.prisma.milestoneSlipProposal.create).not.toHaveBeenCalled();
  });

  it('raises nothing when a COMPLETED milestone is re-dated', async () => {
    const { world, service } = setup();
    world.ms.get('A')!.status = 'COMPLETED';

    await service.update('A', { dueDate: d('2026-03-11') } as any, 'u1');
    await flush();

    expect(world.prisma.milestoneSlipProposal.create).not.toHaveBeenCalled();
  });
});

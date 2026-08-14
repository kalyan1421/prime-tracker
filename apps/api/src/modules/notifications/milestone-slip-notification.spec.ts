import { NotificationType } from '@prisma/client';
import {
  NotificationsService,
  NOTIFICATION_TIERS,
  RECURRING_TYPES,
  LEADERSHIP_ROLES,
} from './notifications.service';
import { MilestoneEventHandlers } from './milestone-event-handlers.service';

/**
 * C3/C4 — MILESTONE_SLIP_PENDING_REVIEW: classification and routing.
 *
 * Its own file rather than more cases in scheduled-notifications.service.spec.ts: that
 * suite is the cron's, and this type has no cron — it is raised by a write.
 */

const USERS = [
  { id: 'founder', role: 'FOUNDER', isActive: true },
  { id: 'exec', role: 'EXECUTIVE', isActive: true },
  { id: 'super', role: 'SUPER_ADMIN', isActive: true },
  { id: 'pm-on', role: 'PROJECT_MANAGER', isActive: true },
  { id: 'pm-off', role: 'PROJECT_MANAGER', isActive: true },
  { id: 'finance', role: 'FINANCE', isActive: true },
];

function makePrisma() {
  const created: any[] = [];
  const prisma: any = {
    user: {
      findMany: jest.fn(({ where }: any) => {
        // Two callers: resolveRecipients() filters by role, the email step by id only.
        let rows = where.role?.in ? USERS.filter((u) => where.role.in.includes(u.role)) : [...USERS];
        if (where.id?.in) rows = rows.filter((u) => where.id.in.includes(u.id));
        return Promise.resolve(rows.map((u) => ({ id: u.id, email: `${u.id}@x.com`, name: u.id })));
      }),
      findUnique: jest.fn(() => Promise.resolve({ name: 'Priya' })),
    },
    // Only pm-on is staffed on the project.
    projectMember: { findMany: jest.fn(() => Promise.resolve([{ userId: 'pm-on' }])) },
    notificationPreference: { findMany: jest.fn(() => Promise.resolve([])) },
    notification: {
      findMany: jest.fn(() => Promise.resolve([])),
      createMany: jest.fn(({ data }: any) => {
        created.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    milestone: { findUnique: jest.fn(() => Promise.resolve({ title: 'Foundation pour' })) },
    project: { findUnique: jest.fn(() => Promise.resolve({ name: 'Riverbend' })) },
  };
  return { prisma, created };
}

function makeService(prisma: any) {
  const config = { get: jest.fn((_k: string, d?: string) => d) };
  const service = new NotificationsService(prisma, config as any, undefined as any);
  (service as any).mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
  return service;
}

const BASE = {
  proposalId: 'prop-1',
  projectId: 'p1',
  projectName: 'Riverbend',
  milestoneTitle: 'Foundation pour',
  daysSlipped: 10,
  affectedCount: 3,
  drawCount: 0,
  requestedByName: 'Priya',
};

describe('MILESTONE_SLIP_PENDING_REVIEW — classification', () => {
  it('is ACTION: a pending cascade blocks the schedule until someone decides', () => {
    const service = makeService(makePrisma().prisma);
    expect(service.tierOf(NotificationType.MILESTONE_SLIP_PENDING_REVIEW)).toBe('ACTION');
    expect(NOTIFICATION_TIERS.MILESTONE_SLIP_PENDING_REVIEW).toBe('ACTION');
  });

  it('is a discrete EVENT, not a recurring condition', () => {
    // A second slip supersedes the pending proposal and is a genuinely different cascade.
    // Deduplicating it against the one it replaced would hide the live one.
    expect(RECURRING_TYPES.MILESTONE_SLIP_PENDING_REVIEW).toBe(false);
  });

  it('is in the Prisma enum, so getPreferences() lists it and users can mute it', () => {
    expect(Object.values(NotificationType)).toContain('MILESTONE_SLIP_PENDING_REVIEW');
  });
});

describe('MILESTONE_SLIP_PENDING_REVIEW — routing', () => {
  it('reaches the project PM and leadership, and nobody else', async () => {
    const { prisma, created } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview(BASE);

    const recipients = created.map((n) => n.userId).sort();
    expect(recipients).toEqual(['exec', 'founder', 'pm-on', 'super']);
    // PROJECT_MANAGER is project-scoped, so a PM on another project is not pulled in.
    expect(recipients).not.toContain('pm-off');
    // Not a Finance decision — the schedule is the PM's.
    expect(recipients).not.toContain('finance');
  });

  it('routes by ROLE, not by `roles: []` — the deciding PM must be on the list', async () => {
    const { prisma, created } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview(BASE);

    // `roles: []` (the LEASE_HOLDOVER trick) would have produced leadership only.
    expect(created.map((n) => n.userId)).toContain('pm-on');
    for (const role of LEADERSHIP_ROLES) expect(role).toBeTruthy();
  });

  it('emails, because ACTION emails by default', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview(BASE);

    expect((service as any).mailer.sendMail).toHaveBeenCalled();
  });

  it('says the cascade has NOT been applied', async () => {
    const { prisma, created } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview(BASE);

    expect(created[0].body).toContain('3 dependent milestones would move');
    expect(created[0].body).toContain('Nothing downstream has changed yet');
    expect(created[0].link).toBe('/projects/p1/milestones');
  });

  it('calls out a lender draw date in the body — a different category of decision', async () => {
    const { prisma, created } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview({ ...BASE, drawCount: 2 });

    expect(created[0].body).toContain('2 LENDER DRAW dates');
  });

  it('omits the draw sentence when no lender date is involved', async () => {
    const { prisma, created } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview(BASE);

    expect(created[0].body).not.toContain('LENDER DRAW');
  });

  it('still alerts when the cascade is draw-only (no dependents)', async () => {
    const { prisma, created } = makePrisma();
    const service = makeService(prisma);

    await service.notifyMilestoneSlipPendingReview({ ...BASE, affectedCount: 0, drawCount: 1 });

    expect(created).not.toHaveLength(0);
    expect(created[0].body).toContain('No dependent milestones are affected');
    expect(created[0].body).toContain('1 LENDER DRAW date');
  });
});

describe('MilestoneEventHandlers', () => {
  it('turns milestone.slipProposed into the alert, with names resolved', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);
    const spy = jest.spyOn(service, 'notifyMilestoneSlipPendingReview').mockResolvedValue(undefined);
    const bus: any = { on: jest.fn() };
    const handlers = new MilestoneEventHandlers(prisma, bus, service);

    handlers.onModuleInit();
    expect(bus.on).toHaveBeenCalledWith('milestone.slipProposed', expect.any(Function));

    await bus.on.mock.calls[0][1]({
      proposalId: 'prop-1',
      milestoneId: 'm1',
      projectId: 'p1',
      daysSlipped: 10,
      affectedCount: 3,
      drawCount: 1,
      requestedById: 'u1',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'prop-1',
        projectId: 'p1',
        projectName: 'Riverbend',
        milestoneTitle: 'Foundation pour',
        drawCount: 1,
        requestedByName: 'Priya',
      }),
    );
  });

  it('still alerts when the milestone title or requester cannot be resolved', async () => {
    const { prisma } = makePrisma();
    prisma.milestone.findUnique = jest.fn(() => Promise.resolve(null));
    const service = makeService(prisma);
    const spy = jest.spyOn(service, 'notifyMilestoneSlipPendingReview').mockResolvedValue(undefined);
    const bus: any = { on: jest.fn() };
    new MilestoneEventHandlers(prisma, bus, service).onModuleInit();

    await bus.on.mock.calls[0][1]({
      proposalId: 'prop-1',
      milestoneId: 'm1',
      projectId: 'p1',
      daysSlipped: 4,
      affectedCount: 1,
      drawCount: 0,
      requestedById: null,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneTitle: 'a milestone', requestedByName: null }),
    );
  });
});

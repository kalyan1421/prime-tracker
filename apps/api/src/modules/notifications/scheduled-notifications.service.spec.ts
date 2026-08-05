import { NotificationType } from '@prisma/client';
import { ScheduledNotificationsService } from './scheduled-notifications.service';
import {
  NotificationsService,
  NOTIFICATION_TIERS,
  LEADERSHIP_ROLES,
  RECURRING_TYPES,
  RENOTIFY_COOLDOWN_HOURS,
} from './notifications.service';

const mockPrisma = {
  salePayment: { findMany: jest.fn(), updateMany: jest.fn() },
  leaseRentPeriod: { findMany: jest.fn() },
  leaseObligation: { findMany: jest.fn() },
  leaseRentInvoice: { findMany: jest.fn() },
};
const mockNotifications = {
  notifyPaymentOverdue: jest.fn(),
  notifyPaymentDueSoon: jest.fn(),
  notifyFreeRentEnding: jest.fn(),
  notifyDepositOutstanding: jest.fn(),
  notifyRentOverdue: jest.fn(),
};
// runDailyChecks generates the rent ledger before reading it; the per-check tests
// below call the checks directly, so a no-op stub is enough.
const mockRentInvoices = {
  generateDueThrough: jest.fn().mockResolvedValue({ invoicesCreated: 0, leasesProcessed: 0 }),
};

function daysFromNow(n: number) {
  // Nudged an hour TOWARDS now, in whichever direction the offset points. Fixtures are
  // built at module-evaluation time while the service computes its own `new Date()` when
  // the check runs, so a value sitting exactly on a window edge (`lte: in30`) dropped
  // outside it whenever the clock ticked in between — intermittent, roughly one run in
  // four. Shaving must follow the sign: a flat subtraction pushes PAST-due fixtures
  // further into the past and turns `daysOverdue: 4` into 5. An hour is far smaller than
  // any window under test, so every intended inside/outside classification is unchanged.
  const towardsNow = n >= 0 ? -3_600_000 : 3_600_000;
  return new Date(Date.now() + n * 86_400_000 + towardsNow);
}

/** A lease as the leasing checks fetch it: unit-anchored, project resolved. */
function leaseFixture(over: Record<string, unknown> = {}) {
  return {
    tenantName: 'Acme Retail',
    monthlyRent: 5000,
    unit: { unitNumber: 'A-101', building: { project: { id: 'pr1', name: 'Rio Ranch' } } },
    building: null,
    ...over,
  };
}

// Pass-through EncryptionService double: these suites mock Prisma, so rows already
// carry plaintext. Real crypto is covered in common/encryption/encryption.service.spec.ts.
const mockEncryption = {
  decryptLoan: (l: any) => l,
  decryptLoans: (l: any[]) => l ?? [],
  encryptFields: (o: any, fields: string[]) => {
    const out: any = { ...o };
    for (const f of fields) out[f] = null;
    return { ...out, encryptedFields: 'enc' };
  },
  decryptFields: (o: any) => o,
};

describe('ScheduledNotificationsService.checkSalePayments', () => {


  let service: ScheduledNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScheduledNotificationsService(mockPrisma as any, mockNotifications as any, mockRentInvoices as any, mockEncryption as any);
  });

  it('flips past-due installments to OVERDUE and notifies; warns on those due within 7 days', async () => {
    const sale = { id: 's1', buyer: 'Acme', projectId: 'pr1', project: { name: 'Rio Ranch' } };
    mockPrisma.salePayment.findMany.mockResolvedValue([
      { id: 'late', saleId: 's1', label: 'Deposit', status: 'DUE', dueDate: daysFromNow(-5), effectiveDueDate: null, sale },
      { id: 'soon', saleId: 's1', label: 'Slab', status: 'SCHEDULED', dueDate: daysFromNow(3), effectiveDueDate: null, sale },
      { id: 'far', saleId: 's1', label: 'Handover', status: 'SCHEDULED', dueDate: daysFromNow(45), effectiveDueDate: null, sale },
    ]);
    mockPrisma.salePayment.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.checkSalePayments();

    expect(res).toEqual({ overdue: 1, dueSoon: 1 });
    expect(mockPrisma.salePayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['late'] } }, data: { status: 'OVERDUE' } }),
    );
    expect(mockNotifications.notifyPaymentOverdue).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyPaymentOverdue).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Deposit', projectId: 'pr1', daysOverdue: expect.any(Number) }),
    );
    expect(mockNotifications.notifyPaymentDueSoon).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyPaymentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Slab' }),
    );
  });

  it('coalesces effectiveDueDate over dueDate when deciding overdue', async () => {
    const sale = { id: 's1', buyer: null, projectId: 'pr1', project: { name: 'P' } };
    mockPrisma.salePayment.findMany.mockResolvedValue([
      // dueDate is future, but the milestone-stamped effectiveDueDate is in the past → overdue
      { id: 'm1', saleId: 's1', label: 'Foundation', status: 'DUE', dueDate: daysFromNow(20), effectiveDueDate: daysFromNow(-2), sale },
    ]);
    mockPrisma.salePayment.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.checkSalePayments();
    expect(res.overdue).toBe(1);
    expect(mockNotifications.notifyPaymentOverdue).toHaveBeenCalled();
  });
});

// ============================================================================
// Change 4 — leasing-depth cron checks
// ============================================================================

describe('ScheduledNotificationsService.checkFreeRentEnding', () => {
  let service: ScheduledNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScheduledNotificationsService(mockPrisma as any, mockNotifications as any, mockRentInvoices as any, mockEncryption as any);
  });

  /** The window query has no `OR`; the "still abated?" query is the one with `OR`. */
  function mockPeriods(inWindow: any[], laterFree: any[] = []) {
    mockPrisma.leaseRentPeriod.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.OR ? laterFree : inWindow),
    );
  }

  it('notifies when the last free-rent month ends within 30 days', async () => {
    mockPeriods([
      { id: 'p1', leaseId: 'l1', endDate: daysFromNow(12), isFreeRent: true, lease: leaseFixture() },
    ]);

    const count = await service.checkFreeRentEnding();

    expect(count).toBe(1);
    expect(mockNotifications.notifyFreeRentEnding).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyFreeRentEnding).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pr1',
        leaseId: 'l1',
        tenantName: 'Acme Retail',
        unitLabel: 'A-101',
        firstPayingRent: 5000,
        daysLeft: expect.any(Number),
      }),
    );
  });

  it('does not fire when no free-rent period ends inside the window', async () => {
    mockPeriods([]);

    const count = await service.checkFreeRentEnding();

    expect(count).toBe(0);
    expect(mockNotifications.notifyFreeRentEnding).not.toHaveBeenCalled();
  });

  it('does not fire when a later free-rent month still runs past the window', async () => {
    mockPeriods(
      [{ id: 'p1', leaseId: 'l1', endDate: daysFromNow(12), isFreeRent: true, lease: leaseFixture() }],
      [{ leaseId: 'l1' }],
    );

    const count = await service.checkFreeRentEnding();

    expect(count).toBe(0);
    expect(mockNotifications.notifyFreeRentEnding).not.toHaveBeenCalled();
  });

  it('picks the LAST free month when several end inside the window', async () => {
    const last = daysFromNow(28);
    mockPeriods([
      { id: 'p1', leaseId: 'l1', endDate: daysFromNow(5), isFreeRent: true, lease: leaseFixture() },
      { id: 'p2', leaseId: 'l1', endDate: last, isFreeRent: true, lease: leaseFixture() },
    ]);

    await service.checkFreeRentEnding();

    expect(mockNotifications.notifyFreeRentEnding).toHaveBeenCalledTimes(1);
    expect(mockNotifications.notifyFreeRentEnding).toHaveBeenCalledWith(
      expect.objectContaining({ freeRentEnd: last }),
    );
  });

  it('resolves the project through a building-level lease', async () => {
    mockPeriods([
      {
        id: 'p1',
        leaseId: 'l1',
        endDate: daysFromNow(3),
        isFreeRent: true,
        lease: leaseFixture({
          unit: null,
          building: { name: 'Building B', project: { id: 'pr9', name: 'Leander P1' } },
        }),
      },
    ]);

    await service.checkFreeRentEnding();

    expect(mockNotifications.notifyFreeRentEnding).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'pr9', unitLabel: 'Building B' }),
    );
  });
});

describe('ScheduledNotificationsService.checkOutstandingDeposits', () => {
  let service: ScheduledNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScheduledNotificationsService(mockPrisma as any, mockNotifications as any, mockRentInvoices as any, mockEncryption as any);
  });

  it('notifies on a past-due deposit that is not settled, with the pending amount', async () => {
    mockPrisma.leaseObligation.findMany.mockResolvedValue([
      {
        id: 'ob1',
        leaseId: 'l1',
        kind: 'SECURITY_DEPOSIT',
        status: 'PARTIAL',
        dueDate: daysFromNow(-9),
        totalAmount: 10000,
        paidAmount: 2500,
        lease: leaseFixture(),
      },
    ]);

    const count = await service.checkOutstandingDeposits();

    expect(count).toBe(1);
    expect(mockNotifications.notifyDepositOutstanding).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pr1',
        obligationId: 'ob1',
        outstanding: 7500,
        daysOverdue: 9,
      }),
    );
  });

  it('does not fire when nothing is past due (SETTLED/WAIVED are filtered in the query)', async () => {
    mockPrisma.leaseObligation.findMany.mockResolvedValue([]);

    const count = await service.checkOutstandingDeposits();

    expect(count).toBe(0);
    expect(mockNotifications.notifyDepositOutstanding).not.toHaveBeenCalled();
    // Guard the query itself, since the terminal-state filter lives there.
    expect(mockPrisma.leaseObligation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'SECURITY_DEPOSIT',
          status: { notIn: ['SETTLED', 'WAIVED'] },
        }),
      }),
    );
  });
});

describe('ScheduledNotificationsService.checkOverdueRent', () => {
  let service: ScheduledNotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScheduledNotificationsService(mockPrisma as any, mockNotifications as any, mockRentInvoices as any, mockEncryption as any);
  });

  it('notifies on a past-due DUE/PARTIAL invoice with the outstanding balance', async () => {
    const periodMonth = new Date('2026-06-01T00:00:00.000Z');
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([
      {
        id: 'inv1',
        leaseId: 'l1',
        status: 'PARTIAL',
        dueDate: daysFromNow(-4),
        periodMonth,
        amountDue: 5000,
        amountPaid: 1200,
        lease: leaseFixture(),
      },
    ]);

    const count = await service.checkOverdueRent();

    expect(count).toBe(1);
    expect(mockNotifications.notifyRentOverdue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'pr1',
        invoiceId: 'inv1',
        periodMonth,
        amountOutstanding: 3800,
        daysOverdue: 4,
      }),
    );
  });

  it('does not fire when no invoice is overdue, and only queries DUE/PARTIAL', async () => {
    mockPrisma.leaseRentInvoice.findMany.mockResolvedValue([]);

    const count = await service.checkOverdueRent();

    expect(count).toBe(0);
    expect(mockNotifications.notifyRentOverdue).not.toHaveBeenCalled();
    expect(mockPrisma.leaseRentInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['DUE', 'PARTIAL'] } }),
      }),
    );
  });
});

// ============================================================================
// Change 1 + 2 — recipient routing and severity tiers
//
// These live here rather than in their own spec because this file is the
// notifications module's test surface.
// ============================================================================

const USERS = [
  { id: 'sa', role: 'SUPER_ADMIN', isActive: true, email: 'sa@p.com', name: 'Sam' },
  { id: 'founder', role: 'FOUNDER', isActive: true, email: 'f@p.com', name: 'Fay' },
  { id: 'exec', role: 'EXECUTIVE', isActive: true, email: 'e@p.com', name: 'Eve' },
  { id: 'fin1', role: 'FINANCE', isActive: true, email: 'fin1@p.com', name: 'Finn' },
  { id: 'fin2', role: 'FINANCE', isActive: true, email: 'fin2@p.com', name: 'Fern' },
  { id: 'acct', role: 'ACCOUNTING', isActive: true, email: 'a@p.com', name: 'Ada' },
  { id: 'sales', role: 'SALES', isActive: true, email: 's@p.com', name: 'Sal' },
  { id: 'sales2', role: 'SALES', isActive: true, email: 's2@p.com', name: 'Sid' },
  { id: 'pm', role: 'PROJECT_MANAGER', isActive: true, email: 'pm@p.com', name: 'Pia' },
  { id: 'arap', role: 'AR_AP', isActive: true, email: 'ar@p.com', name: 'Ari' },
  { id: 'finOff', role: 'FINANCE', isActive: false, email: 'off@p.com', name: 'Gone' },
];

describe('NotificationsService — recipient routing', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findMany: jest.fn(({ where }: any) => {
          let rows = USERS.filter((u) => u.isActive);
          if (where?.role?.in) rows = rows.filter((u) => where.role.in.includes(u.role));
          if (where?.id?.in) rows = rows.filter((u) => where.id.in.includes(u.id));
          return Promise.resolve(rows);
        }),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        // send() checks for an already-pending identical alert before writing.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const config = { get: jest.fn((_k: string, d?: string) => d) };
    service = new NotificationsService(prisma, config as any, undefined as any);
  });

  it('always includes leadership, even when they are not project members', async () => {
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'fin1' }]);

    const ids = await service.resolveRecipients({ roles: ['FINANCE'], projectId: 'pr1' });

    for (const leader of ['sa', 'founder', 'exec']) expect(ids).toContain(leader);
    expect(LEADERSHIP_ROLES).toEqual(['SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE']);
  });

  it('scopes PROJECT-SCOPED roles to project members', async () => {
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'sales' }, { userId: 'pm' }]);

    const ids = await service.resolveRecipients({ roles: ['SALES'], projectId: 'pr1' });

    expect(ids).toContain('sales');
    // sales2 holds the role but is not on the project; pm is on the project but not
    // a relevant role for this event.
    expect(ids).not.toContain('sales2');
    expect(ids).not.toContain('pm');
  });

  // ---- The rule that matters: scoped vs global comes from @prime-tracker/shared ----

  it('does NOT scope global roles by membership — Finance/Accounting/AR_AP still get the alert', async () => {
    // A staffed project where NONE of the finance people are members. Treating
    // every non-leadership role as project-scoped silently dropped exactly the
    // people rent-overdue / deposit / budget-variance alerts exist for.
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'sales' }, { userId: 'pm' }]);

    const ids = await service.resolveRecipients({
      roles: ['FINANCE', 'ACCOUNTING', 'AR_AP'],
      projectId: 'pr1',
    });

    expect(ids).toEqual(expect.arrayContaining(['fin1', 'fin2', 'acct', 'arap']));
    // No project-scoped role was requested, so membership is never consulted.
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('mixes the two rules in one call: global roles global, scoped roles filtered', async () => {
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'sales' }, { userId: 'pm' }]);

    const ids = await service.resolveRecipients({
      roles: ['FINANCE', 'SALES'],
      projectId: 'pr1',
    });

    // FINANCE is global: fin2 is not a member and is still notified.
    expect(ids).toEqual(expect.arrayContaining(['fin1', 'fin2']));
    // SALES is project-scoped: only the member is notified.
    expect(ids).toContain('sales');
    expect(ids).not.toContain('sales2');
  });

  it('falls back to role-global for scoped roles when the project has ZERO members', async () => {
    prisma.projectMember.findMany.mockResolvedValue([]);

    const ids = await service.resolveRecipients({ roles: ['SALES'], projectId: 'unstaffed' });

    // An unstaffed project must not go silent — every SALES user hears about it.
    expect(ids).toEqual(expect.arrayContaining(['sa', 'founder', 'exec', 'sales', 'sales2']));
    expect(ids).not.toContain('pm');
  });

  it('never routes to inactive users', async () => {
    prisma.projectMember.findMany.mockResolvedValue([]);
    const ids = await service.resolveRecipients({ roles: ['FINANCE'], projectId: 'unstaffed' });
    expect(ids).not.toContain('finOff');
  });

  it('is role-global and does not consult ProjectMember when projectId is absent', async () => {
    const ids = await service.resolveRecipients({ roles: ['FINANCE', 'SALES'] });

    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
    expect(ids).toEqual(expect.arrayContaining(['sa', 'founder', 'exec', 'fin1', 'fin2', 'sales']));
  });

  it('returns leadership only, without a member lookup, when no other role is relevant', async () => {
    const ids = await service.resolveRecipients({ roles: ['FOUNDER'], projectId: 'pr1' });

    expect(ids.sort()).toEqual(['exec', 'founder', 'sa']);
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('de-duplicates a leader who is also a project member', async () => {
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'founder' }, { userId: 'fin1' }]);
    // FOUNDER is filtered out of the scoped roles, but pass it anyway to prove dedupe.
    const ids = await service.resolveRecipients({ roles: ['FOUNDER', 'FINANCE'], projectId: 'pr1' });
    expect(ids.filter((id) => id === 'founder')).toHaveLength(1);
  });
});

describe('NotificationsService.notifyDrawFundingOverdue', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findMany: jest.fn(({ where }: any) => {
          let rows = USERS.filter((u) => u.isActive);
          if (where?.role?.in) rows = rows.filter((u) => where.role.in.includes(u.role));
          if (where?.id?.in) rows = rows.filter((u) => where.id.in.includes(u.id));
          return Promise.resolve(rows);
        }),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const config = { get: jest.fn((_k: string, d?: string) => d) };
    service = new NotificationsService(prisma, config as any, undefined as any);
  });

  it('routes through sendToRoles with the project, an ACTION type and a real tab link', async () => {
    const spy = jest.spyOn(service, 'sendToRoles').mockResolvedValue(undefined);

    await service.notifyDrawFundingOverdue({
      drawNumber: 4,
      projectId: 'pr1',
      projectName: 'Rio Ranch',
      daysOverdue: 12,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ['FINANCE', 'AR_AP'],
        projectId: 'pr1',
        type: NotificationType.DRAW_FUNDING_OVERDUE,
        link: '/projects/pr1/draws',
      }),
    );
    expect(service.tierOf(NotificationType.DRAW_FUNDING_OVERDUE)).toBe('ACTION');
  });

  it('reaches finance and leadership without a ProjectMember row', async () => {
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'pm' }]);

    await service.notifyDrawFundingOverdue({ drawNumber: 4, projectId: 'pr1', daysOverdue: 12 });

    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    const notified = rows.map((r: any) => r.userId);
    expect(notified).toEqual(expect.arrayContaining(['fin1', 'fin2', 'arap', 'founder']));
  });

  it('is mutable per user — the raw insert it replaced ignored preferences entirely', async () => {
    prisma.notificationPreference.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.userId.in.map((userId: string) => ({ userId, enabled: false, emailEnabled: null }))),
    );

    await service.notifyDrawFundingOverdue({ drawNumber: 4, projectId: 'pr1', daysOverdue: 12 });

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('NotificationsService — severity tiers and emailEnabled', () => {
  let service: NotificationsService;
  let prisma: any;
  let mailer: { sendMail: jest.Mock };

  const RECIPIENTS = ['fin1'];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findMany: jest.fn(({ where }: any) => {
          let rows = USERS.filter((u) => u.isActive);
          if (where?.role?.in) rows = rows.filter((u) => where.role.in.includes(u.role));
          if (where?.id?.in) rows = rows.filter((u) => where.id.in.includes(u.id));
          return Promise.resolve(rows);
        }),
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const config = { get: jest.fn((_k: string, d?: string) => d) };
    service = new NotificationsService(prisma, config as any, undefined as any);
    // createMailer() returns null without SMTP_HOST; inject a stub so email is observable.
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    (service as any).mailer = mailer;
  });

  function send(type: NotificationType) {
    return service.send({ userIds: RECIPIENTS, type, title: 'T', body: 'B', link: '/projects/pr1/revenue' });
  }

  it('classifies every NotificationType in the Prisma enum', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TIERS).toHaveProperty(type);
      expect(['ACTION', 'FYI']).toContain((NOTIFICATION_TIERS as Record<string, string>)[type]);
    }
  });

  it('carries the nine leasing-depth (L3) types in the Prisma enum itself', () => {
    // These once lived only in the database enum and were referenced by string
    // cast. schema.prisma now declares them, so the generated client must too —
    // otherwise getPreferences() silently stops listing them.
    for (const type of [
      'UNIT_SOLD',
      'LEASE_ADDED',
      'LEASE_ACTIVATED',
      'LEASE_TERMINATED',
      'LEASE_RENT_CHANGED',
      'FREE_RENT_ENDING_30',
      'DEPOSIT_OUTSTANDING',
      'TI_DISBURSED',
      'RENT_OVERDUE',
      'COMMENT_MENTION',
    ] as const) {
      expect(Object.values(NotificationType)).toContain(type);
      expect(NOTIFICATION_TIERS).toHaveProperty(type);
    }
    expect(Object.values(NotificationType)).toHaveLength(29);
  });

  it('agrees with the client-confirmed tier assignment', () => {
    expect(service.tierOf(NotificationType.MILESTONE_OVERDUE)).toBe('ACTION');
    expect(service.tierOf(NotificationType.LEASE_EXPIRING_7)).toBe('ACTION');
    expect(service.tierOf(NotificationType.DRAW_REQUEST_SUBMITTED)).toBe('ACTION');
    expect(service.tierOf('RENT_OVERDUE')).toBe('ACTION');
    expect(service.tierOf('DEPOSIT_OUTSTANDING')).toBe('ACTION');
    expect(service.tierOf('FREE_RENT_ENDING_30')).toBe('ACTION');

    expect(service.tierOf(NotificationType.LEASE_EXPIRING_30)).toBe('FYI');
    expect(service.tierOf(NotificationType.DRAW_REQUEST_APPROVED)).toBe('FYI');
    expect(service.tierOf(NotificationType.COMMENT_SALES)).toBe('FYI');
    expect(service.tierOf('UNIT_SOLD')).toBe('FYI');
    expect(service.tierOf('LEASE_ACTIVATED')).toBe('FYI');
    expect(service.tierOf('TI_DISBURSED')).toBe('FYI');
  });

  it('falls back to FYI (never email-everyone) for an unclassified type', () => {
    expect(service.tierOf('SOME_FUTURE_TYPE')).toBe('FYI');
  });

  // ---- emailEnabled: three states ----

  it('null/absent preference → ACTION emails', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);

    await send(NotificationType.MILESTONE_OVERDUE);

    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it('null/absent preference → FYI is in-app only', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);

    await send(NotificationType.LEASE_EXPIRING_30);

    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('an explicit null row behaves exactly like no row at all', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userId: 'fin1', enabled: true, emailEnabled: null },
    ]);

    await send(NotificationType.LEASE_EXPIRING_30);
    expect(mailer.sendMail).not.toHaveBeenCalled();

    await send(NotificationType.MILESTONE_OVERDUE);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it('emailEnabled: true opts a user INTO email for an FYI type', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userId: 'fin1', enabled: true, emailEnabled: true },
    ]);

    await send(NotificationType.LEASE_EXPIRING_30);

    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it('emailEnabled: false opts a user OUT of email for an ACTION type, keeping in-app', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userId: 'fin1', enabled: true, emailEnabled: false },
    ]);

    await send(NotificationType.MILESTONE_OVERDUE);

    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('enabled: false suppresses everything — no in-app row and no email', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([
      // emailEnabled:true must NOT resurrect a muted type.
      { userId: 'fin1', enabled: false, emailEnabled: true },
    ]);

    await send(NotificationType.MILESTONE_OVERDUE);

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('applies each recipient preference independently', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userId: 'fin1', enabled: true, emailEnabled: false },
      { userId: 'acct', enabled: false, emailEnabled: null },
    ]);

    await service.send({
      userIds: ['fin1', 'fin2', 'acct'],
      type: NotificationType.MILESTONE_OVERDUE,
      title: 'T',
      body: 'B',
    });

    // fin1 (opted out) + fin2 (default) get in-app; acct is muted entirely.
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 'fin1' }),
        expect.objectContaining({ userId: 'fin2' }),
      ]),
    });
    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    // Only fin2 emails.
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'fin2@p.com' }));
  });

  it('setPreference leaves emailEnabled untouched when it is not supplied', async () => {
    await service.setPreference('fin1', NotificationType.MILESTONE_OVERDUE, false);

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { enabled: false } }),
    );
  });

  it('setPreference writes an explicit null to clear an override back to the tier default', async () => {
    await service.setPreference('fin1', NotificationType.MILESTONE_OVERDUE, true, null);

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { enabled: true, emailEnabled: null } }),
    );
  });
});

/**
 * Re-notification suppression.
 *
 * The daily cron re-evaluates standing conditions and calls send() again on every run
 * for as long as the condition holds. Without suppression each run wrote a fresh unread
 * row per still-overdue item — one run on 2026-07-29 produced 2,185 rows — so the bell
 * was permanently red and "mark all as read" appeared not to stick.
 */
describe('NotificationsService — re-notification suppression', () => {
  let service: NotificationsService;
  let prisma: any;

  const pending = (userId: string) => ({ userId });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const config = { get: jest.fn((_k: string, d?: string) => d) };
    service = new NotificationsService(prisma, config as any, undefined as any);
  });

  // The title carries a live day counter, exactly as the real triggers build it.
  const send = (type: NotificationType, opts: { userIds?: string[]; day?: number; key?: string } = {}) =>
    service.send({
      userIds: opts.userIds ?? ['u1'],
      type,
      title: `Rent overdue (${opts.day ?? 29}d): Mathnasium`,
      body: 'B',
      dedupeKey: opts.key === undefined ? 'rentInvoice:inv-1' : opts.key,
    });

  it('writes a recurring alert when the user has nothing pending for it', async () => {
    await send(NotificationType.RENT_OVERDUE);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany.mock.calls[0][0].data[0].dedupeKey)
      .toBe('rentInvoice:inv-1');
  });

  it('suppresses a recurring alert the user already has pending', async () => {
    prisma.notification.findMany.mockResolvedValue([pending('u1')]);
    await send(NotificationType.RENT_OVERDUE);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('REGRESSION: suppresses across a changed day counter in the title', async () => {
    // The whole point of dedupeKey. Seven recurring types put the age in the title, so
    // yesterday's row reads "(29d)" and today's would read "(30d)". Keying on title
    // meant the lookup never matched and every cron run inserted a new unread row —
    // 2,150 of the first backlog's 2,288 rows were this one case.
    prisma.notification.findMany.mockResolvedValue([pending('u1')]);
    await send(NotificationType.RENT_OVERDUE, { day: 30 });

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.dedupeKey).toBe('rentInvoice:inv-1');
    expect(where).not.toHaveProperty('title');
  });

  it('separates two conditions that share a title shape', async () => {
    // Same wording, different invoice — must NOT suppress each other.
    prisma.notification.findMany.mockResolvedValue([]);
    await send(NotificationType.RENT_OVERDUE, { key: 'rentInvoice:inv-2' });
    expect(prisma.notification.findMany.mock.calls[0][0].where.dedupeKey)
      .toBe('rentInvoice:inv-2');
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
  });

  it('suppresses per-user, not for the whole batch', async () => {
    prisma.notification.findMany.mockResolvedValue([pending('u1')]);
    await send(NotificationType.RENT_OVERDUE, { userIds: ['u1', 'u2'] });

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.userId)).toEqual(['u2']);
  });

  it('matches on unread OR recently-read, so a read-but-still-overdue item stays quiet', async () => {
    await send(NotificationType.RENT_OVERDUE);
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { readAt: null },
      { createdAt: { gte: expect.any(Date) } },
    ]);
    const cutoff = where.OR[1].createdAt.gte as Date;
    const hoursBack = (Date.now() - cutoff.getTime()) / 3_600_000;
    expect(hoursBack).toBeGreaterThan(RENOTIFY_COOLDOWN_HOURS - 1);
    expect(hoursBack).toBeLessThan(RENOTIFY_COOLDOWN_HOURS + 1);
  });

  it('delivers (and complains) when a recurring type arrives with no dedupeKey', async () => {
    // A trigger that forgot its key must not silently start deduplicating on nothing,
    // nor silently drop the alert. It is delivered and logged as an error.
    const err = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    await send(NotificationType.RENT_OVERDUE, { key: '' });

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('without a dedupeKey'));
  });

  it('NEVER suppresses a discrete event — two comments share a title and are two things', async () => {
    prisma.notification.findMany.mockResolvedValue([pending('u1')]);
    await service.send({ userIds: ['u1'], type: NotificationType.COMMENT_SALES, title: 'T', body: 'B' });
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('classifies every notification type as recurring or event', () => {
    for (const type of Object.values(NotificationType)) {
      expect(RECURRING_TYPES).toHaveProperty(type);
    }
  });
});

/**
 * Interiors costing (client, 2026-10-17). The budget maths is checked against the
 * BuilderTrend job costing screen Kevin showed on 2026-10-13 for Centro Plaza Luxyn
 * (805–815): original $342,250, committed $318,007.06, projected $452,186.71.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { computeBudget, codesOverBudget, leftOnCode, type BudgetInput } from './interior-budget';
import { InteriorCostingService, derivePoPrefix, codeLabel, DEFAULT_SETTINGS } from './interior-costing.service';

// ── Luxyn, as BuilderTrend had it ────────────────────────────────────────────
const est = (code: string, amount: number, paidBy = 'PRIME') => ({ costCodeId: code, paidBy, amount });
const LUXYN_ORIGINAL = [
  est('01.25', 5000), est('02.25', 15000), est('concrete', 4000), est('05.00', 65000), est('1415', 22750),
  est('07.05', 20000), est('07.10', 30000), est('7.50', 18000), est('08.00', 45000), est('09.00', 40000),
  est('13.30', 25000), est('14.00', 21500), est('15.25', 21000), est('tile', 5000), est('19.00', 5000),
];
const po = (id: string, code: string, amount: number, status = 'APPROVED') =>
  ({ id, status, lines: [{ costCodeId: code, paidBy: 'PRIME', amount }] });
const LUXYN: BudgetInput = {
  locked: true,
  snapshot: LUXYN_ORIGINAL,
  lines: [],
  changeOrders: [
    { costCodeId: '13.10', paidBy: 'PRIME', amount: 36000, status: 'APPROVED' },
    { costCodeId: '02.20', paidBy: 'PRIME', amount: 11000, status: 'APPROVED' },
    { costCodeId: '09.00', paidBy: 'PRIME', amount: 62360, status: 'PENDING' },
  ],
  purchaseOrders: [
    po('p10', '02.20', 2200), po('p18', '1415', 21666.66), po('p20', '09.00', 57360), po('p21', '07.10', 25000),
    po('p22', '05.00', 49999.98), po('p24', '08.00', 42000), po('p28', '7.50', 10482.12), po('p29', 'concrete', 4278.81),
    po('p30', '07.05', 13247.23), po('p31', '09.00', 45000), po('p32', '02.20', 8800), po('p33', '01.25', 1674.36),
    po('p34', '15.00', 297.90), po('p35', '13.10', 36000), po('p36', 'tile', 4800, 'PENDING'),
  ],
  bills: [
    { purchaseOrderId: 'p31', amount: 45000, status: 'PAID' },
    { purchaseOrderId: 'p20', amount: 52360, status: 'PAID' },
    { purchaseOrderId: 'p35', amount: 8000, status: 'PAID' },
    { purchaseOrderId: 'p35', amount: 10000, status: 'PAID' },
    { purchaseOrderId: 'p24', amount: 22000, status: 'APPROVED' },
    { purchaseOrderId: 'p22', amount: 5000, status: 'PENDING' }, // not yet approved — not actual
  ],
};

describe('computeBudget — BuilderTrend parity', () => {
  const { rows, totals } = computeBudget(LUXYN);
  const row = (c: string) => rows.find((r) => r.costCodeId === c)!;

  it('original, committed and projected match the BuilderTrend screen', () => {
    expect(totals.original).toBe(342250);
    expect(totals.committed).toBe(318007.06);
    expect(totals.projected).toBe(452186.71);
  });

  it('revised = original + APPROVED change orders only; pending ones are shown, not added', () => {
    expect(totals.coApproved).toBe(47000);
    expect(totals.coPending).toBe(62360);
    expect(totals.revised).toBe(389250);
  });

  it('projected is the larger of revised, committed and actual, line by line', () => {
    expect(row('08.00')).toMatchObject({ revised: 45000, committed: 42000, actual: 22000, projected: 45000, toComplete: 23000, overUnder: 0 });
    expect(row('09.00')).toMatchObject({ revised: 40000, committed: 102360, actual: 97360, projected: 102360, overUnder: -62360 });
    expect(row('13.10')).toMatchObject({ original: 0, coApproved: 36000, revised: 36000, actual: 18000, overUnder: 0 });
  });

  it('counts pending POs as pending, and only approved/paid bills as actual', () => {
    expect(row('tile').pending).toBe(4800);
    expect(row('05.00').actual).toBe(0);
    expect(row('09.00').paid).toBe(97360);
  });

  it('approving the HVAC change order brings the job to within $577', () => {
    const after = computeBudget({ ...LUXYN, changeOrders: LUXYN.changeOrders.map((c) => ({ ...c, status: 'APPROVED' })) });
    expect(after.totals.overUnder).toBe(-576.71);
  });

  it('splits what PRIME and the TENANT pay from each line and change order', () => {
    const r = computeBudget({
      locked: false, snapshot: [], purchaseOrders: [], bills: [],
      lines: [{ costCodeId: 'a', paidBy: 'PRIME', quantity: 1, unitPrice: 1000 }, { costCodeId: 'a', paidBy: 'TENANT', total: 400 }],
      changeOrders: [{ costCodeId: 'a', paidBy: 'TENANT', amount: 250, status: 'APPROVED' }],
    });
    expect(r.totals).toMatchObject({ original: 1400, revised: 1650, revisedPrime: 1000, revisedTenant: 650 });
  });

  it('spreads a bill over its PO lines by share, and keeps a bill with no PO visible', () => {
    const r = computeBudget({
      locked: false, snapshot: [], lines: [], changeOrders: [],
      purchaseOrders: [{ id: 'p', status: 'APPROVED', lines: [{ costCodeId: 'a', paidBy: 'PRIME', amount: 300 }, { costCodeId: 'b', paidBy: 'PRIME', amount: 100 }] }],
      bills: [{ purchaseOrderId: 'p', amount: 200, status: 'APPROVED' }, { purchaseOrderId: null, amount: 50, status: 'PAID' }],
    });
    expect(r.rows.find((x) => x.costCodeId === 'a')!.actual).toBe(150);
    expect(r.rows.find((x) => x.costCodeId === 'b')!.actual).toBe(50);
    expect(r.rows.find((x) => x.costCodeId === null)!.actual).toBe(50);
  });
});

describe('budget checks for purchase orders', () => {
  it('knows what is left on a code: revised − committed − other pending POs', () => {
    expect(leftOnCode(LUXYN, '15.25')).toBe(21000);
    expect(leftOnCode(LUXYN, 'tile')).toBe(200); // 5,000 − 4,800 waiting
    expect(leftOnCode(LUXYN, 'tile', 'p36')).toBe(5000); // the PO being approved is not counted against itself
    expect(leftOnCode(LUXYN, '09.00')).toBe(-62360);
  });

  it('flags only the codes a new PO would take over', () => {
    expect(codesOverBudget(LUXYN, [{ costCodeId: '15.25', amount: 20000 }, { costCodeId: '09.00', amount: 1 }])).toEqual(['09.00']);
    expect(codesOverBudget(LUXYN, [{ costCodeId: '15.25', amount: 15000 }, { costCodeId: '15.25', amount: 7000 }])).toEqual(['15.25']);
  });
});

describe('helpers', () => {
  it('derives the BuilderTrend-style PO prefix from the fit-out name', () => {
    expect(derivePoPrefix('Centro 805 Luxyn')).toBe('LUX');
    expect(derivePoPrefix('RRC 12110 Shristi')).toBe('SHR');
    expect(derivePoPrefix('  ')).toBe('FIT');
  });
  it('labels codes the way BuilderTrend shows them, including codes with no number', () => {
    expect(codeLabel({ code: '07.05', name: 'Plumbing Material' })).toBe('07.05 - Plumbing Material');
    expect(codeLabel({ code: null, name: 'Concrete' })).toBe('Concrete');
  });
  it('defaults every power to Founder and PM, with a $60,000 change order limit', () => {
    expect(DEFAULT_SETTINGS.coLimit).toBe(60000);
    for (const k of ['lockRoles', 'unlockRoles', 'coApproverRoles', 'coAboveLimitRoles', 'poApproverRoles', 'varianceRoles', 'billApproverRoles'] as const) {
      expect(DEFAULT_SETTINGS[k]).toEqual(['FOUNDER', 'PROJECT_MANAGER']);
    }
  });
});

// ── the service's rules ──────────────────────────────────────────────────────
describe('InteriorCostingService — who may do what', () => {
  // One mock for both the client and the transaction it hands out.
  const prisma: any = {
    orgSettings: { findFirst: jest.fn() },
    organization: { findFirst: jest.fn() },
    interiorProject: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    interiorBudgetSnapshot: { deleteMany: jest.fn(), createMany: jest.fn() },
    interiorChangeOrder: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    interiorPurchaseOrder: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    interiorInvoice: { count: jest.fn() },
    interiorActivity: { create: jest.fn() },
    interiorCostCode: { findUnique: jest.fn(), findMany: jest.fn() },
    vendor: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const tx = prisma;
  const svc = () => new InteriorCostingService(prisma);
  const as = (role: string, extra: Partial<{ permissions: string[] }> = {}) =>
    ({ userId: `u-${role}`, role, roles: [], permissions: ['interior:view', 'interior:edit', 'interior:finance'], ...extra });

  /** A loaded project the way `load()` returns it. */
  const project = (over: any = {}) => ({
    id: 'ip', name: 'Centro 805 Luxyn', poPrefix: null, estimateStatus: 'LOCKED', area: 6540, tiAllowance: null,
    unit: null, building: null, lease: null, extraUnits: [], estimateSubmittedBy: null, estimateLockedBy: null,
    scopeItems: [], budgetSnapshot: [{ costCodeId: 'c1', paidBy: 'PRIME', amount: 10000 }], changeOrders: [],
    purchaseOrders: [], invoices: [], activity: [], ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.orgSettings.findFirst.mockResolvedValue(null); // defaults: Founder + PM
    prisma.interiorCostCode.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.interiorCostCode.findMany.mockResolvedValue([]);
  });

  it('lets a PM lock the estimate (client: PM has every power)', async () => {
    prisma.interiorProject.findFirst.mockResolvedValue(project({
      estimateStatus: 'SUBMITTED', budgetSnapshot: [],
      scopeItems: [{ costCodeId: 'c1', paidBy: 'PRIME', quantity: 1, unitPrice: 5000, total: 5000 }, { costCodeId: 'c1', paidBy: 'TENANT', total: 1000 }],
    }));
    await svc().lockEstimate('ip', as('PROJECT_MANAGER'));
    expect(tx.interiorBudgetSnapshot.createMany).toHaveBeenCalledWith({ data: [
      { interiorProjectId: 'ip', costCodeId: 'c1', paidBy: 'PRIME', amount: 5000 },
      { interiorProjectId: 'ip', costCodeId: 'c1', paidBy: 'TENANT', amount: 1000 },
    ] });
    expect(tx.interiorProject.update.mock.calls[0][0].data).toMatchObject({ estimateStatus: 'LOCKED', poPrefix: 'LUX' });
  });

  it('refuses a role that is not on the lock list', async () => {
    await expect(svc().lockEstimate('ip', as('ACCOUNTING'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('follows the lists Super Admin sets — and Super Admin always passes', async () => {
    prisma.orgSettings.findFirst.mockResolvedValue({
      interiorLockRoles: ['FOUNDER'], interiorUnlockRoles: ['FOUNDER'], interiorCoLimit: 60000,
      interiorCoApproverRoles: ['FOUNDER'], interiorCoAboveLimitRoles: ['FOUNDER'], interiorPoApproverRoles: ['FOUNDER'],
      interiorVarianceRoles: ['FOUNDER'], interiorBillApproverRoles: ['FOUNDER'],
    });
    prisma.interiorProject.findFirst.mockResolvedValue({ estimateStatus: 'LOCKED' });
    await expect(svc().unlockEstimate('ip', 'Tenant changed the layout', as('PROJECT_MANAGER'))).rejects.toBeInstanceOf(ForbiddenException);
    await svc().unlockEstimate('ip', 'Tenant changed the layout', as('SUPER_ADMIN'));
    expect(tx.interiorBudgetSnapshot.deleteMany).toHaveBeenCalled();
    expect(tx.interiorActivity.create.mock.calls[0][0].data.text).toContain('Tenant changed the layout');
  });

  it('needs a reason to unlock', async () => {
    await expect(svc().unlockEstimate('ip', '  ', as('FOUNDER'))).rejects.toThrow(/why/);
  });

  it('a PM approves a change order above the $60,000 limit too (default lists)', async () => {
    prisma.interiorChangeOrder.findUnique.mockResolvedValue({ id: 'co', interiorProjectId: 'ip', number: 3, amount: 62360, status: 'PENDING' });
    await expect(svc().decideChangeOrder('ip', 'co', 'APPROVE', as('PROJECT_MANAGER'))).resolves.toEqual({ status: 'APPROVED' });
  });

  it('uses the above-limit list only for amounts over the limit', async () => {
    prisma.orgSettings.findFirst.mockResolvedValue({
      ...Object.fromEntries(['Lock', 'Unlock', 'CoApprover', 'PoApprover', 'Variance', 'BillApprover'].map((k) => [`interior${k}Roles`, ['FOUNDER', 'PROJECT_MANAGER']])),
      interiorCoAboveLimitRoles: ['FOUNDER'], interiorCoLimit: 60000,
    });
    prisma.interiorChangeOrder.findUnique.mockResolvedValue({ id: 'co', interiorProjectId: 'ip', number: 3, amount: 62360, status: 'PENDING' });
    await expect(svc().decideChangeOrder('ip', 'co', 'APPROVE', as('PROJECT_MANAGER'))).rejects.toThrow(/over \$60,000/);
    prisma.interiorChangeOrder.findUnique.mockResolvedValue({ id: 'co', interiorProjectId: 'ip', number: 4, amount: 5000, status: 'PENDING' });
    await expect(svc().decideChangeOrder('ip', 'co', 'APPROVE', as('PROJECT_MANAGER'))).resolves.toEqual({ status: 'APPROVED' });
  });

  it('refuses change orders before the estimate is locked', async () => {
    prisma.interiorProject.findFirst.mockResolvedValue({ estimateStatus: 'DRAFT' });
    await expect(svc().createChangeOrder('ip', { amount: 100, reason: 'Scope add', note: 'x' }, as('FOUNDER'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('a tenant-requested change order defaults to the tenant paying', async () => {
    prisma.interiorProject.findFirst.mockResolvedValue({ estimateStatus: 'LOCKED' });
    tx.interiorChangeOrder.findFirst.mockResolvedValue({ number: 2 });
    await svc().createChangeOrder('ip', { costCodeId: 'c1', amount: 900, reason: 'Tenant request', note: 'Upgraded tile' }, as('PROJECT_MANAGER'));
    expect(tx.interiorChangeOrder.create.mock.calls[0][0].data).toMatchObject({ number: 3, paidBy: 'TENANT' });
  });

  it('blocks a PO sent for approval that goes over its code, unless it is a variance PO', async () => {
    prisma.interiorProject.findFirst.mockResolvedValue(project());
    const body = { title: 'Doors', vendorName: 'Bluesky Building Supplies LLC', status: 'PENDING' as const, lines: [{ costCodeId: 'c1', amount: 12000 }] };
    await expect(svc().createPurchaseOrder('ip', body, as('ACCOUNTING'))).rejects.toThrow(/Over budget/);

    tx.vendor.findFirst.mockResolvedValue(null);
    tx.vendor.create.mockResolvedValue({ id: 'v1' });
    tx.interiorPurchaseOrder.findFirst.mockResolvedValue({ number: 35 });
    tx.interiorPurchaseOrder.create.mockResolvedValue({ id: 'po' });
    await svc().createPurchaseOrder('ip', { ...body, variance: true }, as('ACCOUNTING'));
    expect(tx.interiorPurchaseOrder.create.mock.calls[0][0].data).toMatchObject({ number: 36, variance: true, status: 'PENDING', vendorId: 'v1' });
    expect(tx.interiorActivity.create.mock.calls.at(-1)[0].data.text).toContain('LUX-0036');
  });

  it('Accounts can raise a PO but cannot approve one', async () => {
    prisma.interiorPurchaseOrder.findUnique.mockResolvedValue({ id: 'po', interiorProjectId: 'ip', number: 1, status: 'PENDING', variance: false, lines: [{ costCodeId: 'c1', amount: 100 }] });
    await expect(svc().approvePurchaseOrder('ip', 'po', as('ACCOUNTING'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a bill bigger than what is left unbilled on its PO', async () => {
    prisma.interiorPurchaseOrder.findUnique.mockResolvedValue({
      id: 'po', interiorProjectId: 'ip', status: 'APPROVED', vendorId: 'v1',
      lines: [{ amount: 36000 }], invoices: [{ amount: 8000 }, { amount: 10000 }],
    });
    await expect(svc().checkBill('ip', 'po', 18000.01)).rejects.toThrow(/18,000 not yet billed/);
    await expect(svc().checkBill('ip', 'po', 18000)).resolves.toEqual({ vendorId: 'v1' });
  });

  it('hides every amount from a viewer without interior:finance', async () => {
    prisma.interiorProject.findFirst.mockResolvedValue(project({
      purchaseOrders: [{ id: 'po', number: 1, title: 'Doors', vendor: { id: 'v', name: 'Bluesky' }, status: 'APPROVED', lines: [{ amount: 36000 }], workCompletedAt: null, scheduledCompletion: null, materialsOnly: false }],
    }));
    const out: any = await svc().costing('ip', as('CONSTRUCTION', { permissions: ['interior:view'] }));
    expect(out.budget).toBeUndefined();
    expect(out.estimate).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('36000');
    expect(out.purchaseOrders[0]).toMatchObject({ number: 'LUX-0001', title: 'Doors' });
    expect(out.can.markWorkComplete).toBe(true);
  });
});

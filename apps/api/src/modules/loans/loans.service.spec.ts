import { LoansService } from './loans.service';

/**
 * Encryption double that behaves like the real thing in the way that matters here: the
 * `lender` COLUMN is null on disk and the value only exists inside `encryptedFields`.
 * A read path that forgets to decrypt gets null, not ciphertext, which is why the mistake
 * is silent rather than loud.
 */
const mockEncryption = {
  decryptLoan: (l: any) => (l ? { ...l, lender: l.encryptedFields?.lender ?? l.lender } : l),
  decryptLoans: (ls: any[]) => (ls ?? []).map((l) => ({ ...l, lender: l.encryptedFields?.lender ?? l.lender })),
};

const mockPrisma = { drawSchedule: { findMany: jest.fn() } };
const mockBus = { emit: jest.fn() };

describe('LoansService.findProjectDrawSchedules', () => {
  let service: LoansService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LoansService(mockPrisma as any, mockEncryption as any, mockBus as any);
  });

  /**
   * The regression this file exists for. `lender` is in SENSITIVE_LOAN_FIELDS, so selecting
   * the column raw yields null and every line silently falls back to being labelled by its
   * loanType — "CONSTRUCTION" instead of "First United Bank". Two loans from different
   * banks then render as the same option in the milestone picker.
   */
  it('labels lines with the DECRYPTED lender, not the loanType fallback', async () => {
    mockPrisma.drawSchedule.findMany.mockResolvedValue([
      {
        id: 's1', drawNumber: 1, plannedAmount: 1000, plannedDate: '2026-09-01', loanId: 'l1',
        loan: { id: 'l1', lender: null, loanType: 'CONSTRUCTION', encryptedFields: { lender: 'First United Bank' } },
      },
    ]);

    const [line] = await service.findProjectDrawSchedules('p1');

    expect(line.loanLabel).toBe('First United Bank');
    expect(line.loanLabel).not.toBe('CONSTRUCTION');
  });

  it('selects encryptedFields, without which the decrypt above cannot work', async () => {
    mockPrisma.drawSchedule.findMany.mockResolvedValue([]);

    await service.findProjectDrawSchedules('p1');

    const { include } = mockPrisma.drawSchedule.findMany.mock.calls[0][0];
    expect(include.loan.select.encryptedFields).toBe(true);
  });

  it('falls back to loanType only when the loan genuinely has no lender', async () => {
    mockPrisma.drawSchedule.findMany.mockResolvedValue([
      {
        id: 's1', drawNumber: 1, plannedAmount: 500, plannedDate: '2026-09-01', loanId: 'l1',
        loan: { id: 'l1', lender: null, loanType: 'BRIDGE', encryptedFields: {} },
      },
    ]);

    const [line] = await service.findProjectDrawSchedules('p1');

    expect(line.loanLabel).toBe('BRIDGE');
  });

  /**
   * Loans attach at project OR building level and legacy building-level rows can carry a
   * null projectId of their own, so matching on loan.projectId alone drops them. This
   * mirrors findByProject and has to keep mirroring it.
   */
  it('matches building-level loans as well as project-level, excluding soft-deleted', async () => {
    mockPrisma.drawSchedule.findMany.mockResolvedValue([]);

    await service.findProjectDrawSchedules('p1');

    const { where } = mockPrisma.drawSchedule.findMany.mock.calls[0][0];
    expect(where.loan.deletedAt).toBeNull();
    expect(where.loan.OR).toEqual([{ projectId: 'p1' }, { building: { projectId: 'p1' } }]);
  });

  it('coerces plannedAmount to a number (Prisma Decimal is not one)', async () => {
    mockPrisma.drawSchedule.findMany.mockResolvedValue([
      {
        id: 's1', drawNumber: 1, plannedAmount: '2500.50', plannedDate: '2026-09-01', loanId: 'l1',
        loan: { id: 'l1', lender: null, loanType: 'CONSTRUCTION', encryptedFields: { lender: 'CPB' } },
      },
    ]);

    const [line] = await service.findProjectDrawSchedules('p1');

    expect(line.plannedAmount).toBe(2500.5);
  });
});

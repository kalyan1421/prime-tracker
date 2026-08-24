import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HistoricalDeletionService } from './historical-deletion.service';

const mockPrisma: any = {
  historicalRecordDeletion: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

function makeService() {
  return new HistoricalDeletionService(mockPrisma as any);
}

describe('HistoricalDeletionService', () => {
  let service: HistoricalDeletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    mockPrisma.historicalRecordDeletion.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: 'r-new', ...data }),
    );
    mockPrisma.historicalRecordDeletion.update.mockImplementation(
      ({ where, data }: any) => Promise.resolve({ id: where.id, ...data }),
    );
  });

  describe('request', () => {
    it('requires a reason', async () => {
      await expect(service.request({ leaseId: 'l1' }, '  ', 'user-1'))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a second pending request for the same target', async () => {
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'PENDING' });
      await expect(service.request({ saleId: 's1' }, 'a reason', 'user-1'))
        .rejects.toThrow(/already pending/);
    });

    it('creates the request against whichever target is given', async () => {
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue(null);
      const req = await service.request({ saleId: 's1' }, '  duplicate record  ', 'user-1');
      expect(mockPrisma.historicalRecordDeletion.create).toHaveBeenCalledWith({
        data: { saleId: 's1', reason: 'duplicate record', requestedById: 'user-1' },
      });
      expect(req.saleId).toBe('s1');
    });
  });

  describe('decide', () => {
    const PENDING = { id: 'r1', leaseId: 'l1', status: 'PENDING', requestedById: 'user-1' };

    it('approves without deleting anything — the delete stays a separate act', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(PENDING);

      const { decided } = await service.decide('r1', true, 'founder-1', 'confirmed with Finance');

      expect(decided).toMatchObject({ status: 'APPROVED', decidedById: 'founder-1', decisionNote: 'confirmed with Finance' });
      expect(mockPrisma.historicalRecordDeletion.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: {
          status: 'APPROVED',
          decidedById: 'founder-1',
          decidedAt: expect.any(Date),
          decisionNote: 'confirmed with Finance',
        },
      });
    });

    it('works the same for a sale-backed request', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue({
        id: 'r2', saleId: 's1', status: 'PENDING', requestedById: 'user-1',
      });
      const { request } = await service.decide('r2', true, 'founder-1');
      expect(request.saleId).toBe('s1');
      expect(request.leaseId).toBeUndefined();
    });

    it('records a rejection just as fully', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(PENDING);
      const { decided } = await service.decide('r1', false, 'founder-1');
      expect(decided.status).toBe('REJECTED');
    });

    it('stops the requester approving their own request', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(PENDING);
      await expect(service.decide('r1', true, 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to re-decide a settled request', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue({ ...PENDING, status: 'REJECTED' });
      await expect(service.decide('r1', true, 'founder-1')).rejects.toThrow(/already rejected/);
    });

    it('404s on an unknown request', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(null);
      await expect(service.decide('nope', true, 'founder-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancel', () => {
    const PENDING = { id: 'r1', leaseId: 'l1', status: 'PENDING', requestedById: 'user-1' };

    it('lets the requester withdraw their own pending request', async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(PENDING);
      await service.cancel('r1', 'user-1');
      expect(mockPrisma.historicalRecordDeletion.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: 'CANCELLED', decidedById: 'user-1', decidedAt: expect.any(Date) },
      });
    });

    it("stops one person withdrawing another's request", async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue(PENDING);
      await expect(service.cancel('r1', 'someone-else')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuses to withdraw a decided request", async () => {
      mockPrisma.historicalRecordDeletion.findUnique.mockResolvedValue({ ...PENDING, status: 'APPROVED' });
      await expect(service.cancel('r1', 'user-1')).rejects.toThrow(/already approved/);
    });
  });

  describe('selfApprove', () => {
    it('creates a new pre-approved request when nothing is pending', async () => {
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue(null);
      const record = await service.selfApprove({ leaseId: 'l1' }, 'founder-1');
      expect(mockPrisma.historicalRecordDeletion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leaseId: 'l1', status: 'APPROVED', requestedById: 'founder-1', decidedById: 'founder-1',
        }),
      });
      expect(record.status).toBe('APPROVED');
    });

    it('settles an existing pending request instead of creating a second one', async () => {
      mockPrisma.historicalRecordDeletion.findFirst.mockResolvedValue({ id: 'r1', status: 'PENDING' });
      await service.selfApprove({ saleId: 's1' }, 'founder-1');
      expect(mockPrisma.historicalRecordDeletion.create).not.toHaveBeenCalled();
      expect(mockPrisma.historicalRecordDeletion.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'APPROVED', decidedById: 'founder-1' }),
      });
    });
  });

  it('markCompleted burns the approval', async () => {
    await service.markCompleted('r1');
    expect(mockPrisma.historicalRecordDeletion.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'COMPLETED' },
    });
  });
});

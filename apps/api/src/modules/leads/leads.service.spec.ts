import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';

const mockPrisma: any = {
  lead: { findUnique: jest.fn() },
  unit: { findUnique: jest.fn() },
  leadUnitInterest: { upsert: jest.fn(), delete: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
};

function makeService() {
  // ProjectAccessService stub: no scoping in unit tests (undefined = unrestricted).
  return new LeadsService(mockPrisma as any, { listProjectScope: async () => undefined } as any);
}

describe('LeadsService — multi-unit interest / waitlist', () => {
  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('addInterest', () => {
    it('requires a unitId', async () => {
      await expect(service.addInterest('l1', '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the lead is missing', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);
      mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(service.addInterest('l1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the unit is missing', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
      mockPrisma.unit.findUnique.mockResolvedValue(null);
      await expect(service.addInterest('l1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upserts the interest (idempotent on lead+unit)', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
      mockPrisma.unit.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.leadUnitInterest.upsert.mockResolvedValue({ id: 'i1', leadId: 'l1', unitId: 'u1' });
      await service.addInterest('l1', 'u1', 'wants ground floor');
      expect(mockPrisma.leadUnitInterest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { leadId_unitId: { leadId: 'l1', unitId: 'u1' } },
          create: expect.objectContaining({ leadId: 'l1', unitId: 'u1', note: 'wants ground floor' }),
        }),
      );
    });
  });

  describe('unitWaitlist', () => {
    it('requires a unitId', async () => {
      await expect(service.unitWaitlist('')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns interested leads in waitlist order with positions', async () => {
      mockPrisma.leadUnitInterest.findMany.mockResolvedValue([
        { id: 'i1', note: null, createdAt: new Date('2026-05-01'), lead: { id: 'l1', name: 'Early Bird' } },
        { id: 'i2', note: 'backup', createdAt: new Date('2026-05-10'), lead: { id: 'l2', name: 'Later' } },
      ]);
      const res = await service.unitWaitlist('u1');
      expect(res).toHaveLength(2);
      expect(res[0]).toMatchObject({ position: 1, lead: { name: 'Early Bird' } });
      expect(res[1]).toMatchObject({ position: 2, note: 'backup' });
      expect(mockPrisma.leadUnitInterest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { unitId: 'u1', unit: { deletedAt: null } }, orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('removeInterest', () => {
    it('deletes by join-row id when it exists', async () => {
      mockPrisma.leadUnitInterest.findUnique.mockResolvedValue({ id: 'i1' });
      mockPrisma.leadUnitInterest.delete.mockResolvedValue({ id: 'i1' });
      await service.removeInterest('i1');
      expect(mockPrisma.leadUnitInterest.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    });

    it('throws NotFound when the interest does not exist', async () => {
      mockPrisma.leadUnitInterest.findUnique.mockResolvedValue(null);
      await expect(service.removeInterest('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.leadUnitInterest.delete).not.toHaveBeenCalled();
    });
  });
});

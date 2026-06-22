import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DailyLogsService } from './daily-logs.service';

const mockPrisma: any = {
  dailyLog: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  dailyLogPhoto: { create: jest.fn(), delete: jest.fn() },
};

const mockStorage: any = { signedUrl: jest.fn().mockResolvedValue('https://signed-url') };

function makeService() {
  return new DailyLogsService(mockPrisma as any, mockStorage);
}

describe('DailyLogsService', () => {
  let service: DailyLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  describe('findAll', () => {
    it('filters by project/building and orders most-recent first', async () => {
      mockPrisma.dailyLog.findMany.mockResolvedValue([]);
      await service.findAll({ projectId: 'p1', buildingId: 'b1' });
      const arg = mockPrisma.dailyLog.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ projectId: 'p1', buildingId: 'b1' });
      expect(arg.orderBy[0]).toEqual({ logDate: 'desc' });
    });
  });

  describe('create', () => {
    it('requires notes', async () => {
      await expect(
        service.create({ projectId: 'p1', notes: '   ', authorId: 'u1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults logDate to now and stamps the author', async () => {
      mockPrisma.dailyLog.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.create({ projectId: 'p1', notes: 'Poured slab', authorId: 'u1', crewCount: 6, weather: 'Sunny' });
      expect(res.authorId).toBe('u1');
      expect(res.notes).toBe('Poured slab');
      expect(res.crewCount).toBe(6);
      expect(res.logDate).toBeInstanceOf(Date);
    });

    it('uses the provided logDate when given', async () => {
      mockPrisma.dailyLog.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.create({ projectId: 'p1', notes: 'x', authorId: 'u1', logDate: '2026-05-20' });
      expect(res.logDate.toISOString().slice(0, 10)).toBe('2026-05-20');
    });
  });

  describe('addPhoto', () => {
    it('throws NotFound when the log is missing', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue(null);
      await expect(service.addPhoto('nope', { storagePath: 'k' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('attaches a photo by storagePath', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', photos: [] });
      mockPrisma.dailyLogPhoto.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.addPhoto('l1', { storagePath: 'logs/l1/p.jpg', caption: 'Footings' });
      expect(res).toEqual({ dailyLogId: 'l1', storagePath: 'logs/l1/p.jpg', caption: 'Footings' });
    });

    it('rejects an empty storagePath', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue({ id: 'l1', photos: [] });
      await expect(service.addPhoto('l1', { storagePath: '' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findById', () => {
    it('throws NotFound when missing', async () => {
      mockPrisma.dailyLog.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

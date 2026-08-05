import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

const mockPrisma: any = {
  campaign: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  campaignProject: { deleteMany: jest.fn(), createMany: jest.fn() },
  project: { findMany: jest.fn() },
  // update() runs the re-link + scalar write together; the callback receives the same
  // mock client so assertions can inspect both halves.
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

const mockAccess: any = { listProjectScope: jest.fn().mockResolvedValue(undefined) };

function makeService() {
  return new CampaignsService(mockPrisma as any, mockAccess as any);
}

/** findById() is called first by update(); give it something that exists. */
function campaignExists(id = 'c1') {
  mockPrisma.campaign.findFirst.mockResolvedValue({ id, name: 'startup', deletedAt: null });
}

describe('CampaignsService', () => {
  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.listProjectScope.mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockPrisma.campaign.update.mockImplementation((a: any) => Promise.resolve({ id: 'c1', ...a.data }));
    service = makeService();
  });

  describe('update — project re-linking', () => {
    it('replaces the link set when projectIds is provided', async () => {
      campaignExists();
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      await service.update('c1', { projectIds: ['p1', 'p2'] });

      expect(mockPrisma.campaignProject.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'c1' } });
      expect(mockPrisma.campaignProject.createMany).toHaveBeenCalledWith({
        data: [{ campaignId: 'c1', projectId: 'p1' }, { campaignId: 'c1', projectId: 'p2' }],
      });
    });

    it('leaves existing links untouched when projectIds is omitted', async () => {
      campaignExists();

      await service.update('c1', { name: 'renamed' });

      // Omitted must not be read as "clear them" — editing only the name previously
      // had no way to touch links and must keep behaving that way.
      expect(mockPrisma.campaignProject.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.campaignProject.createMany).not.toHaveBeenCalled();
    });

    it('clears links (portfolio-wide) when given an empty array', async () => {
      campaignExists();

      await service.update('c1', { projectIds: [] });

      expect(mockPrisma.campaignProject.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'c1' } });
      // Nothing to insert — an empty createMany would be a pointless round-trip.
      expect(mockPrisma.campaignProject.createMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown or soft-deleted project without touching the links', async () => {
      campaignExists();
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1' }]); // asked for 2, found 1

      await expect(service.update('c1', { projectIds: ['p1', 'ghost'] }))
        .rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrisma.campaignProject.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.campaign.update).not.toHaveBeenCalled();
    });

    it('de-duplicates repeated ids', async () => {
      campaignExists();
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.update('c1', { projectIds: ['p1', 'p1'] });

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ['p1'] } }) }),
      );
      expect(mockPrisma.campaignProject.createMany).toHaveBeenCalledWith({
        data: [{ campaignId: 'c1', projectId: 'p1' }],
      });
    });

    it('re-links and writes scalars inside one transaction', async () => {
      campaignExists();
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p2' }]);

      await service.update('c1', { projectIds: ['p2'], name: 'renamed' });

      // A half-applied re-link would leave the campaign attributed to the wrong projects.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ name: 'renamed' }) }),
      );
    });

    it('does not pass projectIds through to campaign.update as a scalar', async () => {
      campaignExists();
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.update('c1', { projectIds: ['p1'] });

      const data = mockPrisma.campaign.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('projectIds');
    });

    it('404s when the campaign does not exist', async () => {
      mockPrisma.campaign.findFirst.mockResolvedValue(null);
      await expect(service.update('nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('distinguishes clearing a date from omitting it', async () => {
      campaignExists();

      await service.update('c1', { startDate: '' });
      expect(mockPrisma.campaign.update.mock.calls[0][0].data.startDate).toBeNull();

      jest.clearAllMocks();
      campaignExists();
      mockPrisma.campaign.update.mockImplementation((a: any) => Promise.resolve(a.data));
      await service.update('c1', { name: 'x' });
      expect(mockPrisma.campaign.update.mock.calls[0][0].data.startDate).toBeUndefined();
    });
  });

  describe('create', () => {
    it('rejects unknown projects', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      await expect(
        service.create({ name: 'c', channel: 'META' as any, projectIds: ['ghost'], createdBy: 'u1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a portfolio-wide campaign with no projects', async () => {
      mockPrisma.campaign.create.mockImplementation((a: any) => Promise.resolve(a.data));
      const res: any = await service.create({ name: 'c', channel: 'META' as any, createdBy: 'u1' });
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
      expect(res.projects).toEqual({ create: [] });
      expect(res.status).toBe('PLANNED');
    });
  });

  describe('performance — derived metrics', () => {
    const campaign = (over: any = {}) => ({
      id: 'c1', name: 'startup', channel: 'META', status: 'ACTIVE',
      plannedBudget: null, projects: [], spend: [], leads: [], ...over,
    });

    it('returns null for CPL/CPA/ROI rather than dividing by zero', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([campaign()]);
      const [row]: any = await service.performance();
      // The UI renders these as "—"; 0 would wrongly read as "costs nothing per lead".
      expect(row.cpl).toBeNull();
      expect(row.cpa).toBeNull();
      expect(row.roi).toBeNull();
      expect(row.totalSpend).toBe(0);
    });

    it('counts a conversion only when the linked sale is CLOSED', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([campaign({
        spend: [{ amount: 1000 }],
        leads: [
          { id: 'l1', status: 'CONVERTED', convertedToSale: { salePrice: 50000, status: 'CLOSED' } },
          // Converted lead on an open sale: revenue is not banked yet.
          { id: 'l2', status: 'CONVERTED', convertedToSale: { salePrice: 90000, status: 'UNDER_CONTRACT' } },
          { id: 'l3', status: 'NEW', convertedToSale: null },
        ],
      })]);

      const [row]: any = await service.performance();
      expect(row.leadCount).toBe(3);
      expect(row.convertedCount).toBe(1);
      expect(row.convertedRevenue).toBe(50000);
      expect(row.cpl).toBeCloseTo(1000 / 3);
      expect(row.cpa).toBe(1000);
      expect(row.roi).toBe(50);
    });

    it('scopes to the viewer’s projects when no projectId is given', async () => {
      mockAccess.listProjectScope.mockResolvedValue(['p1']);
      mockPrisma.campaign.findMany.mockResolvedValue([]);

      await service.performance({ viewer: { userId: 'u1', role: 'MARKETING' } });

      expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projects: { some: { projectId: { in: ['p1'] } } } }),
        }),
      );
    });

    it('filters to a single project when projectId is given', async () => {
      mockPrisma.campaign.findMany.mockResolvedValue([]);

      await service.performance({ projectId: 'p9' });

      expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projects: { some: { projectId: 'p9' } } }),
        }),
      );
    });
  });
});

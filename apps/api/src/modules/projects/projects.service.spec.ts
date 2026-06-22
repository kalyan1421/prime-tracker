import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const mockPrisma = {
  project: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  projectMember: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    createMany: jest.fn(),
  },
  lease: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { monthlyRent: 0 } }),
  },
  projectComment: { findMany: jest.fn().mockResolvedValue([]) },
  unitComment: { findMany: jest.fn().mockResolvedValue([]) },
};
// interactive transaction — run the callback with the same mock as the tx client
(mockPrisma as any).$transaction = jest.fn((cb: any) => cb(mockPrisma));

const mockAccess = {
  isScoped: (role: string) => ['PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING'].includes(role),
  accessibleProjectIds: jest.fn().mockResolvedValue([]),
  isMember: jest.fn(),
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectsService(mockPrisma as any, mockAccess as any);
  });

  describe('findAll', () => {
    it('should return all active projects with computed totals by default', async () => {
      // findAll includes buildings(_count.units), budgetLines, actuals — provide them.
      const projects = [
        {
          id: '1', name: 'Shops at Panther Creek', status: 'ACTIVE', phase: 'CONSTRUCTION',
          buildings: [{ _count: { units: 4 } }],
          budgetLines: [{ baselineAmt: 1000, revisedAmt: 1200 }],
          actuals: [{ amount: 500 }],
        },
        {
          id: '2', name: 'Premier Sports Complex', status: 'ACTIVE', phase: 'PERMITTING',
          buildings: [], budgetLines: [], actuals: [],
        },
      ];
      mockPrisma.project.findMany.mockResolvedValue(projects);

      const result = await service.findAll({});

      expect(mockPrisma.project.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      // computed fields surface on each row
      expect((result as any[])[0]).toMatchObject({ unitCount: 4, budgetTotal: 1200, actualsTotal: 500 });
    });

    it('should filter by status', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.findAll({ status: 'COMPLETED' as any });

      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('COMPLETED');
    });

    it('scopes a field role (PROJECT_MANAGER) to projects it is a member of', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.findAll({}, { userId: 'u-pm', role: 'PROJECT_MANAGER' });

      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where.members).toEqual({ some: { userId: 'u-pm' } });
    });

    it('does NOT scope a finance role — full portfolio visibility', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.findAll({}, { userId: 'u-fin', role: 'FINANCE' });

      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where.members).toBeUndefined();
    });

    it('does NOT scope when no viewer is supplied (internal call)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.findAll({});

      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where.members).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should return project with all relations', async () => {
      const project = {
        id: '1',
        name: 'Shops at Panther Creek',
        buildings: [{ id: 'b1', name: 'Retail Building A', units: [] }],
        units: [{ id: 'u1', unitNumber: 'A-101' }],
        milestones: [], budgetLines: [], commitments: [], actuals: [], loans: [], sales: [], kpiSnapshots: [],
      };
      mockPrisma.project.findUnique.mockResolvedValue(project);

      const result = await service.findById('1');

      expect(result.name).toBe('Shops at Panther Creek');
      expect(result.buildings).toHaveLength(1);
    });

    it('should throw NotFoundException for a non-existent project', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      await expect(service.findById('non-existent')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides a project from a scoped viewer who is not a member (NotFound)', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue(null);

      await expect(
        service.findById('1', { userId: 'u-pm', role: 'PROJECT_MANAGER' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // membership is checked BEFORE fetching the project
      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
    });

    it('lets a scoped viewer who IS a member open the project', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue({ id: 'pm-1' });
      mockPrisma.project.findUnique.mockResolvedValue({
        id: '1', name: 'Shops at Panther Creek',
        buildings: [], milestones: [], budgetLines: [], commitments: [],
        actuals: [], loans: [], sales: [], kpiSnapshots: [],
      });

      const result = await service.findById('1', { userId: 'u-pm', role: 'PROJECT_MANAGER' });
      expect(result.name).toBe('Shops at Panther Creek');
    });
  });

  describe('create', () => {
    it('auto-enrols the creator as an OWNER member', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null); // slug free
      mockPrisma.project.create.mockResolvedValue({ id: 'p-new', slug: 'new' });

      await service.create({ name: 'New', slug: 'new', location: 'TX' }, 'u-pm');

      expect(mockPrisma.projectMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { projectId: 'p-new', userId: 'u-pm', role: 'OWNER' },
        }),
      );
    });

    it('skips membership enrolment when no creator is supplied', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockPrisma.project.create.mockResolvedValue({ id: 'p-new', slug: 'new' });

      await service.create({ name: 'New', slug: 'new', location: 'TX' });

      expect(mockPrisma.projectMember.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getDashboardSummary', () => {
    it('should aggregate portfolio-level metrics from included relations', async () => {
      const summaryProjects = [
        {
          id: '1', name: 'Project A', status: 'ACTIVE', phase: 'CONSTRUCTION',
          budgetLines: [{ revisedAmt: 40000000, baselineAmt: 40000000 }],
          actuals: [{ amount: 12000000 }],
          commitments: [],
          buildings: [{ units: [{ status: 'LEASED' }, { status: 'AVAILABLE' }] }],
          loans: [],
          milestones: [],
        },
        {
          id: '2', name: 'Project B', status: 'ACTIVE', phase: 'PERMITTING',
          budgetLines: [{ revisedAmt: 20880000, baselineAmt: 20880000 }],
          actuals: [{ amount: 7320000 }],
          commitments: [], buildings: [], loans: [], milestones: [],
        },
      ];
      // getDashboardSummary calls project.findMany twice: active-with-includes, then allProjects.
      mockPrisma.project.findMany.mockResolvedValue(summaryProjects);

      const result = await service.getDashboardSummary();

      expect(result.totalProjects).toBe(2);
      expect(result.totalBudget).toBe(60880000);
      expect(result.totalActuals).toBe(19320000);
      expect(result.projectsByPhase).toHaveProperty('CONSTRUCTION');
    });
  });
});

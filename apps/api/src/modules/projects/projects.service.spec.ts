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
  lease: { findMany: jest.fn().mockResolvedValue([]) },
  projectComment: { findMany: jest.fn().mockResolvedValue([]) },
  unitComment: { findMany: jest.fn().mockResolvedValue([]) },
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectsService(mockPrisma as any);
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

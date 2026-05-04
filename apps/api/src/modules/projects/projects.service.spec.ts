import { ProjectsService } from './projects.service';

const mockPrisma = {
  project: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  budgetLine: { aggregate: jest.fn() },
  actual: { aggregate: jest.fn() },
  commitment: { aggregate: jest.fn() },
  unit: { groupBy: jest.fn() },
  milestone: { findMany: jest.fn() },
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectsService(mockPrisma as any);
  });

  describe('findAll', () => {
    it('should return all active projects by default', async () => {
      const projects = [
        { id: '1', name: 'Shops at Panther Creek', status: 'ACTIVE', phase: 'CONSTRUCTION' },
        { id: '2', name: 'Premier Sports Complex', status: 'ACTIVE', phase: 'PERMITTING' },
      ];
      mockPrisma.project.findMany.mockResolvedValue(projects);

      const result = await service.findAll({});

      expect(mockPrisma.project.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('should filter by status', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.findAll({ status: 'COMPLETED' });

      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('COMPLETED');
    });
  });

  describe('findById', () => {
    it('should return project with all relations', async () => {
      const project = {
        id: '1',
        name: 'Shops at Panther Creek',
        buildings: [{ id: 'b1', name: 'Retail Building A' }],
        units: [{ id: 'u1', unitNumber: 'A-101' }],
        milestones: [],
        budgets: [],
        actuals: [],
        loans: [],
        sales: [],
      };
      mockPrisma.project.findUnique.mockResolvedValue(project);

      const result = await service.findById('1');

      expect(result.name).toBe('Shops at Panther Creek');
      expect(result.buildings).toHaveLength(1);
    });

    it('should return null for non-existent project', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      const result = await service.findById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getDashboardSummary', () => {
    it('should aggregate portfolio-level metrics', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: '1', name: 'Project A', status: 'ACTIVE', phase: 'CONSTRUCTION' },
        { id: '2', name: 'Project B', status: 'ACTIVE', phase: 'PERMITTING' },
      ]);
      mockPrisma.budgetLine.aggregate.mockResolvedValue({ _sum: { revisedAmt: 60880000 } });
      mockPrisma.actual.aggregate.mockResolvedValue({ _sum: { amount: 19320000 } });
      mockPrisma.commitment.aggregate.mockResolvedValue({ _sum: { amount: 13270000 } });
      mockPrisma.unit.groupBy.mockResolvedValue([
        { status: 'LEASED', _count: { id: 5 } },
        { status: 'AVAILABLE', _count: { id: 5 } },
      ]);
      mockPrisma.milestone.findMany.mockResolvedValue([
        { id: 'm1', title: 'Steel Erection', dueDate: '2025-03-01', status: 'IN_PROGRESS', project: { name: 'Project A' } },
      ]);

      const result = await service.getDashboardSummary();

      expect(result.totalProjects).toBe(2);
      expect(result.totalBudget).toBe(60880000);
      expect(result.totalActuals).toBe(19320000);
      expect(result.projectsByPhase).toHaveProperty('CONSTRUCTION');
    });
  });
});

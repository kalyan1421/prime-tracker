import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PROJECT_MEMBER_ROLES } from '@prime-tracker/shared';
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
  // findAll groups units by building to compute the per-project sold count.
  unit: { groupBy: jest.fn().mockResolvedValue([]) },
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

  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectsService(mockPrisma as any, mockAccess as any, mockEncryption as any);
  });

  describe('findAll', () => {
    it('should return all active projects with computed totals by default', async () => {
      // findAll includes buildings(_count.units), budgetLines, actuals — provide them.
      const projects = [
        {
          id: '1', name: 'Shops at Panther Creek', status: 'ACTIVE', phase: 'CONSTRUCTION',
          buildings: [{ id: 'b1', _count: { units: 4 } }],
          budgetLines: [{ baselineAmt: 1000, revisedAmt: 1200 }],
          actuals: [{ amount: 500 }],
          _count: { leads: 3 },
        },
        {
          id: '2', name: 'Premier Sports Complex', status: 'ACTIVE', phase: 'PERMITTING',
          buildings: [], budgetLines: [], actuals: [], _count: { leads: 0 },
        },
      ];
      mockPrisma.project.findMany.mockResolvedValue(projects);
      // 2 of building b1's 4 units are sold.
      mockPrisma.unit.groupBy.mockResolvedValue([{ buildingId: 'b1', _count: { _all: 2 } }]);

      const result = await service.findAll({});

      expect(mockPrisma.project.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      // computed fields surface on each row
      expect((result as any[])[0]).toMatchObject({
        unitCount: 4, soldCount: 2, openLeadCount: 3, budgetTotal: 1200, actualsTotal: 500,
      });
      // A project with no buildings gets zero, not undefined — the card renders it raw.
      expect((result as any[])[1]).toMatchObject({ unitCount: 0, soldCount: 0, openLeadCount: 0 });
    });

    it('skips the sold-units query entirely when no project has a building', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: '3', name: 'Land only', status: 'ACTIVE', phase: 'PRE_DEVELOPMENT',
          buildings: [], budgetLines: [], actuals: [], _count: { leads: 0 } },
      ]);

      const result = await service.findAll({});

      expect(mockPrisma.unit.groupBy).not.toHaveBeenCalled();
      expect((result as any[])[0]).toMatchObject({ unitCount: 0, soldCount: 0 });
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

  describe('addMember', () => {
    // findById() runs first in addMember — give it a project to find.
    const found = {
      id: 'p1', name: 'Shops at Panther Creek',
      buildings: [], milestones: [], budgetLines: [], commitments: [],
      actuals: [], loans: [], sales: [], kpiSnapshots: [],
    };
    beforeEach(() => {
      mockPrisma.project.findUnique.mockResolvedValue(found);
      mockPrisma.projectMember.upsert.mockResolvedValue({ id: 'pm-1' });
    });

    it.each(PROJECT_MEMBER_ROLES)('accepts the fixed-list role %s', async (r) => {
      await service.addMember('p1', 'u1', r);

      expect(mockPrisma.projectMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { role: r, roles: [r] } }),
      );
    });

    it('rejects a typo in the single `role` field', async () => {
      await expect(service.addMember('p1', 'u1', 'PROJET_MANAGER'))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('rejects one bad entry among otherwise valid `roles`', async () => {
      await expect(service.addMember('p1', 'u1', undefined, ['FINANCE', 'LEGAAL']))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    // OWNER is stamped by create() and is not assignable — the picker must not be able to
    // fabricate one, so it is absent from the list and rejected like any other unknown.
    it('rejects OWNER, which only the server may assign', async () => {
      await expect(service.addMember('p1', 'u1', 'OWNER'))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('names the offending value AND the allowed set in the error', async () => {
      await expect(service.addMember('p1', 'u1', 'MANAGER')).rejects.toThrow(
        `Invalid project member role 'MANAGER'. Allowed roles: ${PROJECT_MEMBER_ROLES.join(', ')}`,
      );
    });

    it('defaults to TEAM_MEMBER when neither role nor roles is supplied', async () => {
      await service.addMember('p1', 'u1');

      expect(mockPrisma.projectMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { projectId: 'p1', userId: 'u1', role: 'TEAM_MEMBER', roles: ['TEAM_MEMBER'] },
        }),
      );
    });

    it('dedupes roles and keeps the primary mirroring roles[0]', async () => {
      await service.addMember('p1', 'u1', 'VIEWER', ['LEGAL', 'FINANCE', 'LEGAL']);

      expect(mockPrisma.projectMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          // `roles` wins over the legacy scalar, and role === roles[0]
          update: { role: 'LEGAL', roles: ['LEGAL', 'FINANCE'] },
        }),
      );
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

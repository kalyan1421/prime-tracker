import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

const mockPrisma = {
  organization: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orgMembership: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockAudit = {
  log: jest.fn(),
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationsService(mockPrisma as any, mockAudit as any);
  });

  describe('create', () => {
    it('should create an organization and log audit', async () => {
      const dto = { name: 'Acme Corp', entityType: 'LLC', description: 'Test org' };
      const created = { id: 'org1', name: 'Acme Corp', slug: 'acme-corp', entityType: 'LLC', description: 'Test org' };

      mockPrisma.organization.findUnique.mockResolvedValue(null); // no slug collision
      mockPrisma.organization.create.mockResolvedValue(created);

      const result = await service.create(dto, 'user1');

      expect(result).toEqual(created);
      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Acme Corp',
          slug: 'acme-corp',
          entityType: 'LLC',
          description: 'Test org',
        }),
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user1',
          action: 'CREATE',
          entity: 'Organization',
          entityId: 'org1',
        }),
      );
    });

    it('should handle slug collision by appending suffix', async () => {
      const dto = { name: 'Acme Corp' };
      const existing = { id: 'org0', slug: 'acme-corp' };
      const created = { id: 'org1', name: 'Acme Corp', slug: 'acme-corp-2' };

      // First findUnique for 'acme-corp' returns existing
      // Second findUnique for 'acme-corp-2' returns null
      mockPrisma.organization.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null);
      mockPrisma.organization.create.mockResolvedValue(created);

      const result = await service.create(dto, 'user1');

      expect(result.slug).toBe('acme-corp-2');
      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ slug: 'acme-corp-2' }),
      });
    });
  });

  describe('findAll', () => {
    it('should return active organizations with counts ordered by name', async () => {
      const orgs = [
        { id: 'org1', name: 'Alpha', _count: { memberships: 3, projects: 2 } },
        { id: 'org2', name: 'Beta', _count: { memberships: 1, projects: 5 } },
      ];
      mockPrisma.organization.findMany.mockResolvedValue(orgs);

      const result = await service.findAll();

      expect(result).toEqual(orgs);
      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          include: { _count: { select: { memberships: true, projects: true } } },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('should include inactive organizations when includeInactive is true', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);

      await service.findAll(true);

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return organization with memberships and project count', async () => {
      const org = {
        id: 'org1',
        name: 'Prime Developers',
        memberships: [
          {
            userId: 'u1',
            user: { id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'PROJECT_MANAGER' },
            manager: null,
          },
        ],
        _count: { projects: 3 },
      };
      mockPrisma.organization.findUnique.mockResolvedValue(org);

      const result = await service.findById('org1');

      expect(result).toEqual(org);
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org1' },
          include: expect.objectContaining({
            memberships: expect.any(Object),
            _count: { select: { projects: true } },
          }),
        }),
      );
    });

    it('should throw NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update organization fields and log audit', async () => {
      const existing = { id: 'org1', name: 'Old Name', slug: 'old-name', entityType: 'LLC' };
      const updated = { id: 'org1', name: 'New Name', slug: 'new-name', entityType: 'Corp' };

      // findById calls findUnique
      mockPrisma.organization.findUnique.mockResolvedValueOnce({ ...existing, memberships: [], _count: { projects: 0 } });
      // slug collision check
      mockPrisma.organization.findUnique.mockResolvedValueOnce(null);
      mockPrisma.organization.update.mockResolvedValue(updated);

      const result = await service.update('org1', { name: 'New Name', entityType: 'Corp' }, 'user1');

      expect(result).toEqual(updated);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org1' },
          data: expect.objectContaining({ name: 'New Name', entityType: 'Corp', slug: 'new-name' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'Organization',
          entityId: 'org1',
        }),
      );
    });

    it('should not regenerate slug if name is not changed', async () => {
      const existing = { id: 'org1', name: 'Same Name', slug: 'same-name', entityType: 'LLC' };

      mockPrisma.organization.findUnique.mockResolvedValueOnce({ ...existing, memberships: [], _count: { projects: 0 } });
      mockPrisma.organization.update.mockResolvedValue({ ...existing, description: 'Updated' });

      await service.update('org1', { description: 'Updated' }, 'user1');

      // Should not include slug in update data since name didn't change
      const updateCall = mockPrisma.organization.update.mock.calls[0][0];
      expect(updateCall.data.slug).toBeUndefined();
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false and log audit', async () => {
      const org = { id: 'org1', name: 'Test Org', isDefault: false, memberships: [], _count: { projects: 0 } };
      const deactivated = { ...org, isActive: false };

      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.organization.update.mockResolvedValue(deactivated);

      const result = await service.deactivate('org1', 'user1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org1' },
        data: { isActive: false },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'Organization',
          newValues: { isActive: false },
        }),
      );
    });

    it('should reject deactivating the default organization', async () => {
      const defaultOrg = { id: 'org1', name: 'Prime Developers', isDefault: true, memberships: [], _count: { projects: 0 } };

      mockPrisma.organization.findUnique.mockResolvedValue(defaultOrg);

      await expect(service.deactivate('org1', 'user1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('addMember', () => {
    it('should create membership and log audit', async () => {
      const user = { id: 'u1', role: 'SALES' };
      const membership = { id: 'mem1', orgId: 'org1', userId: 'u1', orgRole: 'EMPLOYEE' };

      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.orgMembership.findUnique.mockResolvedValue(null); // no duplicate
      mockPrisma.orgMembership.create.mockResolvedValue(membership);

      const result = await service.addMember('org1', 'u1', 'EMPLOYEE', 'actor1');

      expect(result).toEqual(membership);
      expect(mockPrisma.orgMembership.create).toHaveBeenCalledWith({
        data: { orgId: 'org1', userId: 'u1', orgRole: 'EMPLOYEE' },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'actor1',
          action: 'CREATE',
          entity: 'OrgMembership',
          entityId: 'mem1',
        }),
      );
    });

    it('should reject FOUNDER users from membership', async () => {
      const founder = { id: 'u1', role: 'FOUNDER' };
      mockPrisma.user.findUnique.mockResolvedValue(founder);

      await expect(service.addMember('org1', 'u1', 'LEAD', 'actor1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgMembership.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate membership', async () => {
      const user = { id: 'u1', role: 'SALES' };
      const existingMembership = { id: 'mem1', orgId: 'org1', userId: 'u1' };

      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.orgMembership.findUnique.mockResolvedValue(existingMembership);

      await expect(service.addMember('org1', 'u1', 'EMPLOYEE', 'actor1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.orgMembership.create).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('should delete membership and log audit', async () => {
      const membership = { id: 'mem1', orgId: 'org1', userId: 'u1', orgRole: 'EMPLOYEE' };

      mockPrisma.orgMembership.findUnique.mockResolvedValue(membership);
      mockPrisma.orgMembership.delete.mockResolvedValue(membership);

      await service.removeMember('org1', 'u1', 'actor1');

      expect(mockPrisma.orgMembership.delete).toHaveBeenCalledWith({
        where: { orgId_userId: { orgId: 'org1', userId: 'u1' } },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'actor1',
          action: 'DELETE',
          entity: 'OrgMembership',
          entityId: 'mem1',
        }),
      );
    });

    it('should throw NotFoundException if membership does not exist', async () => {
      mockPrisma.orgMembership.findUnique.mockResolvedValue(null);

      await expect(service.removeMember('org1', 'nonexistent', 'actor1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.orgMembership.delete).not.toHaveBeenCalled();
    });
  });
});

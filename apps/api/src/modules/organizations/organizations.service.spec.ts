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
  orgSettings: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
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

  // ---- Settings ----
  //
  // This is the first write path OrgSettings has ever had. Before it, the only protection
  // against a bad saleStageProbabilities value was read-time sanitisation in
  // SalesForecastService, which silently drops junk — so a typo showed up as a wrong
  // forecast rather than an error. These cover the rules that now stop it at the door.

  const SCHEMA_DEFAULT_PROBABILITIES = {
    PROSPECT: 0.1,
    LOI_SIGNED: 0.35,
    UNDER_CONTRACT: 0.75,
    CLOSED: 1.0,
    CANCELLED: 0.0,
  };

  /** A settings row as Prisma returns it — Decimal columns are objects, not numbers. */
  const settingsRow = (overrides: Record<string, unknown> = {}) => ({
    orgId: 'org1',
    saleStageProbabilities: { ...SCHEMA_DEFAULT_PROBABILITIES },
    unitStaleDaysThreshold: 90,
    budgetVarianceAlertPct: { toString: () => '10' },
    saleStageAgeAlertDays: 30,
    saleActivityDroughtDays: 14,
    drawFundingExpectedDays: 14,
    discountApprovalThresholdPct: { toString: () => '5' },
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    ...overrides,
  });

  const orgExists = () =>
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1' });

  /** The map handed to prisma.orgSettings.upsert on the write that happened. */
  const persistedProbabilities = () =>
    mockPrisma.orgSettings.upsert.mock.calls[0][0].update.saleStageProbabilities;

  /** BadRequestException message text, for asserting the caller is actually told what is wrong. */
  const rejectionMessage = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (err: any) {
      return String(err?.message ?? '');
    }
    throw new Error('expected the call to be rejected, but it succeeded');
  };

  describe('getSettings', () => {
    it('returns the schema defaults when no row exists, and creates nothing', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(null);

      const result = await service.getSettings('org1');

      expect(result).toEqual({
        orgId: 'org1',
        saleStageProbabilities: SCHEMA_DEFAULT_PROBABILITIES,
        unitStaleDaysThreshold: 90,
        budgetVarianceAlertPct: 10,
        saleStageAgeAlertDays: 30,
        saleActivityDroughtDays: 14,
        drawFundingExpectedDays: 14,
        discountApprovalThresholdPct: 5,
        usingDefaults: true,
        updatedAt: null,
      });
      // The whole point of the defaults branch: reading settings must not be a mutation.
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the organization itself does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.getSettings('nope')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.orgSettings.findUnique).not.toHaveBeenCalled();
    });

    it('returns the stored row with usingDefaults false and Decimals coerced to numbers', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(
        settingsRow({
          saleStageProbabilities: { PROSPECT: 0.2, LOI_SIGNED: 0.5, UNDER_CONTRACT: 0.8 },
          discountApprovalThresholdPct: { toString: () => '7.5' },
        }),
      );

      const result = await service.getSettings('org1');

      expect(result.usingDefaults).toBe(false);
      expect(result.saleStageProbabilities).toEqual({
        PROSPECT: 0.2,
        LOI_SIGNED: 0.5,
        UNDER_CONTRACT: 0.8,
        CLOSED: 1.0,
        CANCELLED: 0.0,
      });
      // Would be the Decimal object, not 7.5, without the coercion.
      expect(result.discountApprovalThresholdPct).toBe(7.5);
      expect(result.updatedAt).toBe('2026-08-01T12:00:00.000Z');
    });

    it('drops junk in a legacy stored map so the UI shows what the forecast will use', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(
        settingsRow({
          saleStageProbabilities: {
            PROSPECT: 'high',      // hand-edited nonsense
            LOI_SIGNED: 42,        // out of range
            UNDER_CONTRACT: 0.8,   // fine
            NOT_A_STAGE: 0.5,      // unknown key
          },
        }),
      );

      const result = await service.getSettings('org1');

      expect(result.saleStageProbabilities).toEqual({
        PROSPECT: 0.1,           // back to the default, exactly as the forecast does
        LOI_SIGNED: 0.35,
        UNDER_CONTRACT: 0.8,
        CLOSED: 1.0,
        CANCELLED: 0.0,
      });
      expect(result.saleStageProbabilities).not.toHaveProperty('NOT_A_STAGE');
    });
  });

  describe('updateSettings', () => {
    it('creates the row when absent', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique
        .mockResolvedValueOnce(null) // before: no row
        .mockResolvedValueOnce(
          settingsRow({ saleStageProbabilities: { PROSPECT: 0.2, LOI_SIGNED: 0.35, UNDER_CONTRACT: 0.75, CLOSED: 1.0, CANCELLED: 0.0 } }),
        );
      mockPrisma.orgSettings.upsert.mockResolvedValue({});

      const result = await service.updateSettings('org1', { saleStageProbabilities: { PROSPECT: 0.2 } }, 'user1');

      const call = mockPrisma.orgSettings.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ orgId: 'org1' });
      expect(call.create.orgId).toBe('org1');
      expect(call.create.saleStageProbabilities.PROSPECT).toBe(0.2);
      expect(result.usingDefaults).toBe(false);
    });

    it('updates the row when present and logs an audit event', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());
      mockPrisma.orgSettings.upsert.mockResolvedValue({});

      await service.updateSettings('org1', { saleStageProbabilities: { UNDER_CONTRACT: 0.9 } }, 'user1');

      expect(persistedProbabilities().UNDER_CONTRACT).toBe(0.9);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user1',
          action: 'UPDATE',
          entity: 'OrgSettings',
          entityId: 'org1',
        }),
      );
    });

    it.each([
      ['PROSPECT', 0.25],
      ['LOI_SIGNED', 0.45],
      ['UNDER_CONTRACT', 0.85],
    ])('accepts a write to the writable stage %s', async (stage, value) => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());
      mockPrisma.orgSettings.upsert.mockResolvedValue({});

      await service.updateSettings('org1', { saleStageProbabilities: { [stage]: value } }, 'user1');

      expect(persistedProbabilities()[stage]).toBe(value);
    });

    it.each(['CLOSED', 'CANCELLED'])(
      'rejects %s because its probability has no effect on the forecast',
      async (stage) => {
        orgExists();
        mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

        const msg = await rejectionMessage(() =>
          service.updateSettings('org1', { saleStageProbabilities: { [stage]: 0.5 } }, 'user1'),
        );

        expect(msg).toContain(`"${stage}"`);
        // The reason matters as much as the refusal: forProject filters both stages out of
        // inFlight, so storing the value would look accepted and change nothing.
        expect(msg).toContain('no effect on the forecast');
        expect(msg).toContain('PROSPECT, LOI_SIGNED, UNDER_CONTRACT');
        expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['above 1', 1.5],
      ['negative', -0.1],
    ])('rejects an out-of-range probability (%s)', async (_label, value) => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

      const msg = await rejectionMessage(() =>
        service.updateSettings('org1', { saleStageProbabilities: { PROSPECT: value } }, 'user1'),
      );

      expect(msg).toContain('PROSPECT');
      expect(msg).toContain(String(value));
      expect(msg).toContain('0 to 1 inclusive');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ['a numeric string', '0.5'],
      ['null', null],
      ['a boolean', true],
      ['a nested object', { value: 0.5 }],
    ])('rejects a non-numeric probability (%s)', async (_label, value) => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

      const msg = await rejectionMessage(() =>
        service.updateSettings('org1', { saleStageProbabilities: { PROSPECT: value } }, 'user1'),
      );

      expect(msg).toContain('PROSPECT');
      expect(msg).toContain('must be a number');
      expect(msg).toContain('0 to 1 inclusive');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
    ])('rejects a non-finite probability (%s)', async (_label, value) => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

      const msg = await rejectionMessage(() =>
        service.updateSettings('org1', { saleStageProbabilities: { PROSPECT: value } }, 'user1'),
      );

      expect(msg).toContain('finite number');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it('rejects an unknown stage key and says which stages exist', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

      const msg = await rejectionMessage(() =>
        service.updateSettings('org1', { saleStageProbabilities: { NEGOTIATING: 0.5 } }, 'user1'),
      );

      expect(msg).toContain('Unknown sale stage "NEGOTIATING"');
      expect(msg).toContain('PROSPECT, LOI_SIGNED, UNDER_CONTRACT');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it('merges a partial update rather than replacing the map', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(
        settingsRow({
          saleStageProbabilities: {
            PROSPECT: 0.2, LOI_SIGNED: 0.5, UNDER_CONTRACT: 0.8, CLOSED: 1.0, CANCELLED: 0.0,
          },
        }),
      );
      mockPrisma.orgSettings.upsert.mockResolvedValue({});

      await service.updateSettings('org1', { saleStageProbabilities: { LOI_SIGNED: 0.55 } }, 'user1');

      // Only LOI_SIGNED moves. The untouched stages — including the two the caller is not
      // even allowed to send — must survive, or editing one field would silently reset the rest.
      expect(persistedProbabilities()).toEqual({
        PROSPECT: 0.2,
        LOI_SIGNED: 0.55,
        UNDER_CONTRACT: 0.8,
        CLOSED: 1.0,
        CANCELLED: 0.0,
      });
    });

    it('keeps CLOSED and CANCELLED when the row did not exist at all', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(settingsRow());
      mockPrisma.orgSettings.upsert.mockResolvedValue({});

      await service.updateSettings('org1', { saleStageProbabilities: { PROSPECT: 0.15 } }, 'user1');

      const created = mockPrisma.orgSettings.upsert.mock.calls[0][0].create.saleStageProbabilities;
      expect(created).toEqual({
        PROSPECT: 0.15,
        LOI_SIGNED: 0.35,
        UNDER_CONTRACT: 0.75,
        CLOSED: 1.0,
        CANCELLED: 0.0,
      });
    });

    it('rejects an empty saleStageProbabilities object', async () => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

      const msg = await rejectionMessage(() =>
        service.updateSettings('org1', { saleStageProbabilities: {} }, 'user1'),
      );

      expect(msg).toContain('was empty');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ['null', null],
      ['an array', [0.1, 0.2]],
      ['a scalar', 0.5],
    ])('rejects saleStageProbabilities that is %s with a 400, not a crash', async (_label, value) => {
      orgExists();
      mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

      // The DTO stops these at the pipe; this is the guard for a direct/internal call, where
      // Object.entries(null) would otherwise be a 500 for what is plainly a bad request.
      const msg = await rejectionMessage(() =>
        service.updateSettings('org1', { saleStageProbabilities: value as any }, 'user1'),
      );

      expect(msg).toContain('must be an object mapping sale stages to probabilities');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    it('rejects a body that sets nothing', async () => {
      orgExists();

      const msg = await rejectionMessage(() => service.updateSettings('org1', {}, 'user1'));

      expect(msg).toContain('No settings supplied');
      expect(msg).toContain('saleStageProbabilities');
      expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
    });

    describe('ordering guard', () => {
      // DECISION: reject a decreasing ladder rather than warn. A forecast that falls when a
      // deal advances is a typo, and this number reaches lender-facing material — a log line
      // nobody reads is not a control.

      it('rejects a decreasing ladder inside a single request', async () => {
        orgExists();
        mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());

        const msg = await rejectionMessage(() =>
          service.updateSettings(
            'org1',
            { saleStageProbabilities: { PROSPECT: 0.5, LOI_SIGNED: 0.2 } },
            'user1',
          ),
        );

        expect(msg).toContain('must not decrease');
        expect(msg).toContain('"LOI_SIGNED" (0.2)');
        expect(msg).toContain('"PROSPECT" (0.5)');
        expect(msg).toContain('PROSPECT <= LOI_SIGNED <= UNDER_CONTRACT');
        expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
      });

      it('rejects a single-field update that breaks the ladder against stored values', async () => {
        orgExists();
        mockPrisma.orgSettings.findUnique.mockResolvedValue(
          settingsRow({
            saleStageProbabilities: {
              PROSPECT: 0.1, LOI_SIGNED: 0.35, UNDER_CONTRACT: 0.75, CLOSED: 1.0, CANCELLED: 0.0,
            },
          }),
        );

        // 0.9 on its own is a perfectly valid probability — it is only wrong relative to
        // the UNDER_CONTRACT 0.75 the caller cannot see, which is why the check runs on the
        // merged map rather than on the submitted keys.
        const msg = await rejectionMessage(() =>
          service.updateSettings('org1', { saleStageProbabilities: { LOI_SIGNED: 0.9 } }, 'user1'),
        );

        expect(msg).toContain('must not decrease');
        expect(msg).toContain('"UNDER_CONTRACT" (0.75)');
        expect(msg).toContain('"LOI_SIGNED" (0.9)');
        expect(mockPrisma.orgSettings.upsert).not.toHaveBeenCalled();
      });

      it('allows equal probabilities on adjacent stages', async () => {
        orgExists();
        mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());
        mockPrisma.orgSettings.upsert.mockResolvedValue({});

        await service.updateSettings(
          'org1',
          { saleStageProbabilities: { PROSPECT: 0.5, LOI_SIGNED: 0.5, UNDER_CONTRACT: 0.5 } },
          'user1',
        );

        // Unusual but coherent — only a strict decrease is the mistake.
        expect(persistedProbabilities()).toEqual(
          expect.objectContaining({ PROSPECT: 0.5, LOI_SIGNED: 0.5, UNDER_CONTRACT: 0.5 }),
        );
      });

      it('allows a strictly increasing ladder', async () => {
        orgExists();
        mockPrisma.orgSettings.findUnique.mockResolvedValue(settingsRow());
        mockPrisma.orgSettings.upsert.mockResolvedValue({});

        await service.updateSettings(
          'org1',
          { saleStageProbabilities: { PROSPECT: 0.05, LOI_SIGNED: 0.4, UNDER_CONTRACT: 0.95 } },
          'user1',
        );

        expect(persistedProbabilities()).toEqual({
          PROSPECT: 0.05,
          LOI_SIGNED: 0.4,
          UNDER_CONTRACT: 0.95,
          CLOSED: 1.0,
          CANCELLED: 0.0,
        });
      });
    });
  });
});

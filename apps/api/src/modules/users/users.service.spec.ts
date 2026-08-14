import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService, GUARDED_USER_RELATIONS } from './users.service';

const mockPrisma: any = {
  user: { update: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
};
const mockAudit: any = { log: jest.fn() };

function makeService() {
  return new UsersService(mockPrisma as any, mockAudit as any);
}

/**
 * `remove()` calls findUnique twice — once for the target's identity, once for the
 * `_count` census. Route by the shape of the select so the tests read like the code.
 */
function stubUser(
  identity: { id: string; name: string; email: string } | null,
  counts: Record<string, number> = {},
) {
  mockPrisma.user.findUnique.mockImplementation((args: any) => {
    if (args?.select?._count) return Promise.resolve(identity ? { _count: counts } : null);
    return Promise.resolve(identity);
  });
}

describe('UsersService.updateSelf', () => {
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('updates the caller’s own name and writes an audit entry', async () => {
    mockPrisma.user.update.mockResolvedValue({ id: 'me', name: 'New Name' });

    await service.updateSelf('me', { name: '  New Name  ' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'me' },
        data: { name: 'New Name' }, // trimmed
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'me', entityId: 'me', action: 'UPDATE' }),
    );
  });

  it('clears the avatar when given an empty string', async () => {
    mockPrisma.user.update.mockResolvedValue({ id: 'me', avatarUrl: null });

    await service.updateSelf('me', { avatarUrl: '' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { avatarUrl: null } }),
    );
  });

  it('ignores fields it is not allowed to set (no email/role/isActive)', async () => {
    mockPrisma.user.update.mockResolvedValue({ id: 'me' });

    await service.updateSelf('me', {
      name: 'Ok',
      // @ts-expect-error — these must never reach the update payload
      email: 'hacker@evil.com',
      role: 'SUPER_ADMIN',
      isActive: false,
    });

    const payload = mockPrisma.user.update.mock.calls[0][0].data;
    expect(payload).toEqual({ name: 'Ok' });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('isActive');
  });

  it('rejects an empty patch (whitespace-only name, nothing else)', async () => {
    await expect(service.updateSelf('me', { name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

/**
 * The guarded-relation list is derived from the Prisma DMMF, so these assertions are the
 * only thing standing between a schema edit and a silently changed deletion policy.
 */
describe('GUARDED_USER_RELATIONS', () => {
  const byField = (f: string) => GUARDED_USER_RELATIONS.find((r) => r.field === f);

  it('guards the required relation that produced the reported 23503', () => {
    expect(byField('historicalDeletionsRequested')).toMatchObject({ action: 'Restrict' });
  });

  it('guards attribution that would be silently nulled, not just what blocks', () => {
    // These are onDelete: SetNull — the delete would succeed and erase the actor.
    expect(byField('auditEvents')).toMatchObject({ action: 'SetNull' });
    expect(byField('milestonePhotoReviews')).toMatchObject({ action: 'SetNull' });
    expect(byField('slipProposalsDecided')).toMatchObject({ action: 'SetNull' });
    expect(byField('historicalDeletionsDecided')).toMatchObject({ action: 'SetNull' });
  });

  it('does not guard rows the schema declares Cascade — those belong to the account', () => {
    for (const field of [
      'sessions',
      'notifications',
      'notificationPreferences',
      'orgMemberships',
      'projectMemberships',
      'taskAssignments',
    ]) {
      expect(byField(field)).toBeUndefined();
    }
  });

  it('renders each relation as readable prose for the refusal message', () => {
    expect(byField('uploadedDocuments')?.label).toBe('uploaded documents');
    expect(byField('leaseRentCorrections')?.label).toBe('lease rent corrections');
  });
});

describe('UsersService.remove', () => {
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('refuses to delete your own account before touching the database', async () => {
    await expect(service.remove('me', 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('404s on a user that does not exist instead of a raw Prisma P2025', async () => {
    stubUser(null);
    await expect(service.remove('ghost', 'admin')).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('deletes a user who has left no trace, and audits it', async () => {
    stubUser({ id: 'u1', name: 'Typo Invite', email: 'typo@primedevelopers.com' }, {});
    mockPrisma.user.delete.mockResolvedValue({ id: 'u1' });

    await service.remove('u1', 'admin');

    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin', entity: 'User', entityId: 'u1', action: 'DELETE' }),
    );
  });

  it('refuses with 409 and names what still references the user', async () => {
    stubUser({ id: 'u2', name: 'Dana Reyes', email: 'dana@primedevelopers.com' }, {
      uploadedDocuments: 12,
      historicalDeletionsRequested: 1,
      auditEvents: 57,
    });

    const err: any = await service.remove('u2', 'admin').catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);

    const body: any = err.getResponse();
    expect(body.message).toContain('Dana Reyes cannot be deleted');
    expect(body.message).toContain('70 records across 3 types'); // 57 + 12 + 1
    expect(body.message).toContain('57 audit events');
    expect(body.message).toContain('12 uploaded documents');
    expect(body.message).toContain('1 historical deletions requested');
    expect(body.message).toContain('Deactivate Dana Reyes instead');

    // Structured detail for any caller that wants more than the sentence.
    expect(body.references).toEqual([
      { relation: 'auditEvents', label: 'audit events', count: 57, onDelete: 'SetNull' },
      { relation: 'uploadedDocuments', label: 'uploaded documents', count: 12, onDelete: 'Restrict' },
      {
        relation: 'historicalDeletionsRequested',
        label: 'historical deletions requested',
        count: 1,
        onDelete: 'Restrict',
      },
    ]);

    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('caps the named types at five and says how many more there are', async () => {
    stubUser({ id: 'u3', name: 'Sam Okafor', email: 'sam@primedevelopers.com' }, {
      auditEvents: 6,
      uploadedDocuments: 5,
      createdTasks: 4,
      taskComments: 3,
      createdLeads: 2,
      leadActivities: 1,
      dailyLogs: 1,
    });

    const err: any = await service.remove('u3', 'admin').catch((e) => e);

    expect(err.getResponse().message).toContain('and 2 more record types');
    expect(err.getResponse().references).toHaveLength(7);
  });

  it('turns a P2003 lost race into the same refusal, never a raw Prisma error', async () => {
    stubUser({ id: 'u4', name: 'Lee Park', email: 'lee@primedevelopers.com' }, {});
    mockPrisma.user.delete.mockRejectedValue(
      Object.assign(new Error('FK violation'), { code: 'P2003' }),
    );

    const err: any = await service.remove('u4', 'admin').catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(String(err.getResponse().message ?? err.getResponse())).toContain(
      'Deactivate the account instead',
    );
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('rethrows anything that is not a foreign-key conflict', async () => {
    stubUser({ id: 'u5', name: 'Ada Nwosu', email: 'ada@primedevelopers.com' }, {});
    mockPrisma.user.delete.mockRejectedValue(new Error('connection reset'));

    await expect(service.remove('u5', 'admin')).rejects.toThrow('connection reset');
  });
});

describe('UsersService.toggleActive', () => {
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  // The destination `remove()` now points admins at. It must keep working.
  it('deactivates a user the delete guard refused, and audits it', async () => {
    mockPrisma.user.update.mockResolvedValue({ id: 'u2', isActive: false });

    await service.toggleActive('u2', false, 'admin');

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u2' }, data: { isActive: false } }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'u2', newValues: { isActive: false } }),
    );
  });
});

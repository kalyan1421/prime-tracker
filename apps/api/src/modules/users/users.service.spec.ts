import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

const mockPrisma: any = {
  user: { update: jest.fn() },
};
const mockAudit: any = { log: jest.fn() };

function makeService() {
  return new UsersService(mockPrisma as any, mockAudit as any);
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

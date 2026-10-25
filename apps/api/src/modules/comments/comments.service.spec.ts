import { CommentsService } from './comments.service';

/** GET /comments/recent — "across all projects" now means all the caller may see. */
describe('CommentsService.findRecent — member-project scope', () => {
  const make = () => {
    const prisma: any = {
      unitComment: { findMany: jest.fn().mockResolvedValue([]) },
      projectComment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new CommentsService(prisma, {} as any) };
  };

  it('reaches unit comments through the unit\'s building and project comments directly', async () => {
    const { prisma, service } = make();
    await service.findRecent(10, { in: ['p1'] });
    expect(prisma.unitComment.findMany.mock.calls[0][0].where).toEqual({ unit: { building: { projectId: { in: ['p1'] } } } });
    expect(prisma.projectComment.findMany.mock.calls[0][0].where).toEqual({ projectId: { in: ['p1'] } });
  });

  it('is unfiltered for an unscoped caller', async () => {
    const { prisma, service } = make();
    await service.findRecent(10);
    expect(prisma.unitComment.findMany.mock.calls[0][0].where).toBeUndefined();
    expect(prisma.projectComment.findMany.mock.calls[0][0].where).toEqual({ projectId: undefined });
  });
});

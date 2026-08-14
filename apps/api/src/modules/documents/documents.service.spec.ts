import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocCategory } from '@prisma/client';
import { DocumentsService, EXPIRY_TRACKED_CATEGORIES, EXPIRY_SOON_DAYS } from './documents.service';

// ============================================================================
// D2 — document expiry dates
// ============================================================================
//
// `expiresAt` is nullable and NEVER required, for any category. Back-filled and historical
// permits legitimately have no known date, and refusing them at upload would mean the
// document is not filed at all — so the categories that ought to carry one are FLAGGED on
// read (`expiryExpected`) rather than refused on write.

const UPLOADER = { select: { id: true, name: true, avatarUrl: true } };

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86_400_000);
}

function file(over: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'permit.pdf',
    mimetype: 'application/pdf',
    size: 1234,
    buffer: Buffer.from('x'),
    ...over,
  } as Express.Multer.File;
}

describe('DocumentsService — expiry on write', () => {
  let service: DocumentsService;
  let prisma: any;
  let storage: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ name: 'Rio Ranch' }) },
      document: {
        create: jest.fn((args: any) => Promise.resolve({ id: 'd1', category: DocCategory.PERMIT, ...args.data })),
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', fileName: 'permit.pdf', category: DocCategory.PERMIT }),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: 'd1', category: DocCategory.PERMIT, expiresAt: null, ...args.data }),
        ),
      },
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ storagePath: 'p/permit.pdf', publicUrl: 'https://s3/permit.pdf' }),
      signedUrl: jest.fn().mockResolvedValue('https://s3/signed'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new DocumentsService(prisma, storage);
  });

  it('persists an ISO expiry sent with the upload', async () => {
    await service.create(
      file(),
      { projectId: 'pr1', category: 'PERMIT', expiresAt: '2027-03-31T00:00:00.000Z' },
      'u1',
    );

    const data = prisma.document.create.mock.calls[0][0].data;
    expect(data.expiresAt).toEqual(new Date('2027-03-31T00:00:00.000Z'));
    expect(data.category).toBe(DocCategory.PERMIT);
  });

  it('accepts an upload with NO expiry — that is the normal case, not an error', async () => {
    await service.create(file(), { projectId: 'pr1', category: 'PHOTO' }, 'u1');

    expect(prisma.document.create.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  it('does not require an expiry even for the categories that lapse', async () => {
    for (const category of EXPIRY_TRACKED_CATEGORIES) {
      await expect(service.create(file(), { projectId: 'pr1', category }, 'u1')).resolves.toBeDefined();
    }
  });

  it('rejects a malformed date BEFORE uploading, so no object is orphaned in the bucket', async () => {
    await expect(
      service.create(file(), { projectId: 'pr1', category: 'PERMIT', expiresAt: 'not-a-date' }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  // ---- update(): tri-state, read on key presence ----

  it('sets the expiry without being told the file name', async () => {
    await service.update('d1', { expiresAt: '2027-01-15T00:00:00.000Z' });

    expect(prisma.document.update.mock.calls[0][0].data).toEqual({
      expiresAt: new Date('2027-01-15T00:00:00.000Z'),
    });
  });

  it('clears the expiry on an explicit null', async () => {
    await service.update('d1', { expiresAt: null });

    expect(prisma.document.update.mock.calls[0][0].data).toEqual({ expiresAt: null });
  });

  it('LEAVES the expiry alone on a plain rename — omitted is not "clear it"', async () => {
    // The regression this guards: conflating "not sent" with "clear it" would silently
    // wipe a permit's expiry every time somebody renamed the file.
    await service.update('d1', { fileName: '  Building Permit 2026.pdf  ' });

    const data = prisma.document.update.mock.calls[0][0].data;
    expect(data).toEqual({ fileName: 'Building Permit 2026.pdf' });
    expect('expiresAt' in data).toBe(false);
  });

  it('still rejects a blank rename, and 404s an unknown document', async () => {
    await expect(service.update('d1', { fileName: '   ' })).rejects.toBeInstanceOf(BadRequestException);

    prisma.document.findUnique.mockResolvedValueOnce(null);
    await expect(service.update('nope', { expiresAt: null })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not touch the expiry when the FILE is replaced', async () => {
    // A better scan of a permit does not change when that permit lapses. A renewal is a
    // new expiry, set explicitly.
    prisma.document.findUnique.mockResolvedValueOnce({
      id: 'd1', fileName: 'permit.pdf', category: DocCategory.PERMIT, projectId: 'pr1', storagePath: 'old',
    });

    await service.replaceFile('d1', file());

    expect('expiresAt' in prisma.document.update.mock.calls[0][0].data).toBe(false);
  });
});

describe('DocumentsService — derived expiry fields on read', () => {
  let service: DocumentsService;
  let prisma: any;
  let storage: any;

  function listOf(...docs: any[]) {
    prisma.document.findMany.mockResolvedValue(
      docs.map((d) => ({ fileUrl: 'https://s3/x', storagePath: null, ...d })),
    );
    return service.findByProject('pr1');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { document: { findMany: jest.fn() } };
    storage = { signedUrl: jest.fn().mockResolvedValue('https://s3/signed') };
    service = new DocumentsService(prisma, storage);
  });

  it('flags the lapsing categories as expiryExpected even when no date is set', async () => {
    const [permit, photo] = await listOf(
      { id: 'a', category: DocCategory.PERMIT, expiresAt: null },
      { id: 'b', category: DocCategory.PHOTO, expiresAt: null },
    );

    // The advisory replacing a hard requirement: the UI can nag without the API refusing.
    expect(permit).toMatchObject({ expiryExpected: true, expiryStatus: null, daysUntilExpiry: null });
    expect(photo).toMatchObject({ expiryExpected: false, expiryStatus: null });
  });

  it('classifies VALID / EXPIRING_SOON / EXPIRED against the same horizon the cron uses', async () => {
    const [valid, soon, expired] = await listOf(
      { id: 'a', category: DocCategory.PERMIT, expiresAt: daysFromNow(EXPIRY_SOON_DAYS + 30) },
      { id: 'b', category: DocCategory.NOC, expiresAt: daysFromNow(EXPIRY_SOON_DAYS - 30) },
      { id: 'c', category: DocCategory.POSSESSION_CERTIFICATE, expiresAt: daysFromNow(-2) },
    );

    expect(valid.expiryStatus).toBe('VALID');
    expect(soon.expiryStatus).toBe('EXPIRING_SOON');
    expect(expired.expiryStatus).toBe('EXPIRED');
    expect(expired.daysUntilExpiry).toBeLessThan(0);
  });

  it('reports a status for ANY category that carries a date, not just the tracked three', async () => {
    // Setting a date on a brochure is a deliberate act; honour it.
    const [brochure] = await listOf({ id: 'a', category: DocCategory.BROCHURE, expiresAt: daysFromNow(5) });

    expect(brochure).toMatchObject({ expiryExpected: false, expiryStatus: 'EXPIRING_SOON' });
  });

  it('still signs the storage URL while decorating', async () => {
    prisma.document.findMany.mockResolvedValue([
      { id: 'a', category: DocCategory.PERMIT, expiresAt: null, fileUrl: 'https://s3/raw', storagePath: 'p/x.pdf' },
    ]);

    const [doc] = await service.findByProject('pr1');

    expect(doc.fileUrl).toBe('https://s3/signed');
    expect(doc.expiryExpected).toBe(true);
  });
});

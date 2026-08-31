import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DocCategory } from '@prisma/client';
import { DocumentsService, EXPIRY_TRACKED_CATEGORIES, EXPIRY_SOON_DAYS } from './documents.service';
import {
  DocumentRetentionService,
  PURGEABLE_CATEGORIES,
  DEFAULT_PURGE_GRACE_DAYS,
  MIN_PURGE_GRACE_DAYS,
  PURGE_BATCH_LIMIT,
} from './document-retention.service';

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
        findFirst: jest.fn().mockResolvedValue({ id: 'd1', fileName: 'permit.pdf', category: DocCategory.PERMIT }),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: 'd1', category: DocCategory.PERMIT, expiresAt: null, ...args.data }),
        ),
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'v1' }),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
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

    prisma.document.findFirst.mockResolvedValueOnce(null);
    await expect(service.update('nope', { expiresAt: null })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not touch the expiry when the FILE is replaced', async () => {
    // A better scan of a permit does not change when that permit lapses. A renewal is a
    // new expiry, set explicitly.
    prisma.document.findFirst.mockResolvedValueOnce({
      id: 'd1', fileName: 'permit.pdf', category: DocCategory.PERMIT, projectId: 'pr1', storagePath: 'old',
      versionNumber: 1, createdAt: new Date('2026-01-01'),
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

// ============================================================================
// Soft delete — one policy, honoured by every path
// ============================================================================
//
// `delete` used to be `prisma.document.delete()` while `Document.deletedAt` existed and
// SOME readers filtered on it. That split is what these tests pin shut: the deleter now
// stamps the column, and every read in the module — plus the two readers OUTSIDE it that
// already filtered, the sale-stage gate and the expiry cron — agree on what it means.
//
// The queries below are run against a tiny in-memory table rather than asserted as `where`
// object literals, so "the filter works" is demonstrated rather than restated. The
// gate-shaped and cron-shaped queries are written out here verbatim on purpose: this suite
// must not import the sales or notifications modules to check their behaviour.

/** Just enough of Prisma's `where` for these queries: scalar equality, `null`, `in`, `not`, `lte`. */
function matchesWhere(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    const value = row[key] ?? null;
    if (cond === null) return value === null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('not' in cond && cond.not === null && value === null) return false;
      if ('lte' in cond && !(value !== null && value <= cond.lte)) return false;
      return true;
    }
    return value === cond;
  });
}

describe('DocumentsService — delete is soft, and every read agrees', () => {
  let service: DocumentsService;
  let prisma: any;
  let storage: any;
  let rows: any[];

  function seed(over: Partial<Record<string, any>> = {}) {
    const row = {
      id: `d${rows.length + 1}`,
      fileName: 'loi.pdf',
      fileUrl: 'https://s3/raw',
      storagePath: 'p/loi.pdf',
      category: DocCategory.LOI,
      expiresAt: null,
      projectId: null,
      unitId: null,
      buildingId: null,
      interiorProjectId: null,
      saleId: null,
      deletedAt: null,
      ...over,
    };
    rows.push(row);
    return row;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    rows = [];
    prisma = {
      document: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(rows.filter((r) => matchesWhere(r, where)))),
        findFirst: jest.fn(({ where }: any) => Promise.resolve(rows.find((r) => matchesWhere(r, where)) ?? null)),
        update: jest.fn(({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id);
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
        // Present so the assertion below is about a call that COULD have happened.
        delete: jest.fn(),
      },
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ storagePath: 'p/new.pdf', publicUrl: 'https://s3/new.pdf' }),
      signedUrl: jest.fn().mockResolvedValue('https://s3/signed'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new DocumentsService(prisma, storage);
  });

  it('stamps deletedAt instead of removing the row', async () => {
    const doc = seed();

    const result = await service.delete(doc.id);

    expect(prisma.document.delete).not.toHaveBeenCalled();
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(rows).toHaveLength(1);
  });

  it('leaves the stored object in the bucket — the row still points at it', async () => {
    // Deliberate, and the cost is real: the object keeps being billed and a signed URL
    // issued a minute earlier lives out its hour. A DEED whose row survives while its
    // bytes are gone reads as proof and is not.
    const doc = seed({ category: DocCategory.DEED });

    await service.delete(doc.id);

    expect(storage.delete).not.toHaveBeenCalled();
    expect(rows[0].storagePath).toBe('p/loi.pdf');
  });

  it.each([
    ['findByProject', 'projectId', 'pr1'],
    ['findByUnit', 'unitId', 'un1'],
    ['findByBuilding', 'buildingId', 'bl1'],
    ['findByInteriorProject', 'interiorProjectId', 'ip1'],
  ])('%s returns live documents only', async (method, field, anchor) => {
    // The regression: three of these four filtered nothing, so a document deleted through
    // any path stayed visible in the list it was attached to.
    const live = seed({ [field]: anchor });
    const gone = seed({ [field]: anchor });
    await service.delete(gone.id);

    const listed = await (service as any)[method](anchor);

    expect(listed.map((d: any) => d.id)).toEqual([live.id]);
  });

  it('no longer satisfies a sale-stage gate once deleted', async () => {
    // SalesService.assertStageDocumentsAttached counts documents with this exact shape.
    // A deleted LOI must not keep a sale's PROSPECT → LOI_SIGNED transition unlocked.
    const loi = seed({ saleId: 's1', category: DocCategory.LOI });
    const gateQuery = { saleId: 's1', deletedAt: null, category: { in: [DocCategory.LOI] } };

    expect(await prisma.document.findMany({ where: gateQuery })).toHaveLength(1);

    await service.delete(loi.id);

    expect(await prisma.document.findMany({ where: gateQuery })).toHaveLength(0);
  });

  it('raises no expiry alert once deleted', async () => {
    // checkExpiringDocuments' shape: live rows carrying a date at or inside the horizon.
    // Nobody is renewing a permit that has been removed from the vault.
    const horizon = daysFromNow(EXPIRY_SOON_DAYS);
    const permit = seed({ category: DocCategory.PERMIT, expiresAt: daysFromNow(10) });
    const cronQuery = { deletedAt: null, expiresAt: { not: null, lte: horizon } };

    expect(await prisma.document.findMany({ where: cronQuery })).toHaveLength(1);

    await service.delete(permit.id);

    expect(await prisma.document.findMany({ where: cronQuery })).toHaveLength(0);
  });

  it('refuses to rename, re-file or hand back a deleted document', async () => {
    const doc = seed();
    await service.delete(doc.id);

    // getDownloadUrl is the one that would otherwise still mint a signed URL for bytes
    // that are deliberately still in the bucket.
    await expect(service.getDownloadUrl(doc.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(doc.id, { fileName: 'renamed.pdf' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.replaceFile(doc.id, file())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(doc.id)).rejects.toBeInstanceOf(NotFoundException);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });

  it('still serves a live document normally', async () => {
    // The guard has to 404 the deleted one WITHOUT breaking the ordinary path.
    const doc = seed();

    await expect(service.getDownloadUrl(doc.id)).resolves.toEqual({
      url: 'https://s3/signed',
      fileName: 'loi.pdf',
    });
  });
});

// ============================================================================
// DocumentVersion — the model stops being hollow
// ============================================================================
//
// Nothing in the API had ever written a version row, so the "archive of prior versions"
// the schema promises was permanently empty — while `replaceFile` hard-deleted the
// superseded object outright. Replacing a document destroyed the previous file with no
// record. These tests pin the other half of that: the outgoing version is recorded and its
// bytes are left alone.

describe('DocumentsService — replaceFile archives the outgoing version', () => {
  let service: DocumentsService;
  let prisma: any;
  let storage: any;
  let doc: any;
  let versions: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    versions = [];
    doc = {
      id: 'd1',
      fileName: 'drawing-rev-a.pdf',
      fileUrl: 'https://s3/rev-a.pdf',
      storagePath: 'p/rev-a.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      externalUrl: null,
      category: DocCategory.DRAWING,
      versionNumber: 1,
      uploadedById: 'u-original',
      projectId: 'pr1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    };

    prisma = {
      document: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(where.deletedAt === null && doc.deletedAt !== null ? null : doc),
        ),
        update: jest.fn(({ data }: any) => {
          Object.assign(doc, data);
          return Promise.resolve(doc);
        }),
      },
      documentVersion: {
        findFirst: jest.fn(() =>
          Promise.resolve([...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null),
        ),
        create: jest.fn(({ data }: any) => {
          if (versions.some((v) => v.versionNumber === data.versionNumber)) {
            // The real unique index on (documentId, versionNumber).
            return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
          }
          const row = { id: `v${versions.length + 1}`, archivedAt: new Date('2026-06-01T00:00:00.000Z'), ...data };
          versions.push(row);
          return Promise.resolve(row);
        }),
        findMany: jest.fn(() =>
          Promise.resolve([...versions].sort((a, b) => b.versionNumber - a.versionNumber)),
        ),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ storagePath: 'p/rev-b.pdf', publicUrl: 'https://s3/rev-b.pdf' }),
      signedUrl: jest.fn().mockResolvedValue('https://s3/signed'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new DocumentsService(prisma, storage);
  });

  it('records the outgoing file instead of destroying it', async () => {
    await service.replaceFile('d1', file({ originalname: 'drawing-rev-b.pdf', size: 200 }));

    // The regression that matters: the previous object used to be deleted here.
    expect(storage.delete).not.toHaveBeenCalled();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      documentId: 'd1',
      versionNumber: 1,
      fileName: 'drawing-rev-a.pdf',
      storagePath: 'p/rev-a.pdf',
      fileSize: 100,
      // Whoever filed THAT version, not whoever is replacing it now.
      uploadedById: 'u-original',
    });
  });

  it('advances the document to the next version number', async () => {
    await service.replaceFile('d1', file());
    expect(doc.versionNumber).toBe(2);
    expect(doc.storagePath).toBe('p/rev-b.pdf');

    storage.upload.mockResolvedValueOnce({ storagePath: 'p/rev-c.pdf', publicUrl: 'https://s3/rev-c.pdf' });
    await service.replaceFile('d1', file());

    expect(doc.versionNumber).toBe(3);
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    // Each archived version keeps its OWN bytes — two replaces, two retained objects.
    expect(versions.map((v) => v.storagePath)).toEqual(['p/rev-a.pdf', 'p/rev-b.pdf']);
  });

  it('dates a version from when its bytes went live, not from the last edit', async () => {
    // `updatedAt` would be wrong: a plain rename moves it. v1 went live when the document
    // was created; v2 went live when v1 was archived.
    await service.replaceFile('d1', file());
    expect(versions[0].uploadedAt).toEqual(doc.createdAt);

    await service.replaceFile('d1', file());
    expect(versions[1].uploadedAt).toEqual(versions[0].archivedAt);
  });

  it('turns a concurrent replace into a retryable conflict, not a 500', async () => {
    // Two replaces racing both read versionNumber 1; the unique index rejects the loser.
    versions.push({ id: 'v1', versionNumber: 1, archivedAt: new Date('2026-05-01') });

    await expect(service.replaceFile('d1', file())).rejects.toBeInstanceOf(ConflictException);
    // The transaction means nothing was half-written.
    expect(doc.versionNumber).toBe(1);
  });

  it('lists the archive newest-first and refuses to link bytes the purge has taken', async () => {
    versions.push(
      { id: 'v1', documentId: 'd1', versionNumber: 1, fileName: 'rev-a.pdf', storagePath: null },
      { id: 'v2', documentId: 'd1', versionNumber: 2, fileName: 'rev-b.pdf', storagePath: 'p/rev-b.pdf' },
    );

    const listed = await service.listVersions('d1');

    expect(listed.map((v) => v.versionNumber)).toEqual([2, 1]);
    // v2's object is still there.
    expect(listed[0]).toMatchObject({ available: true, fileUrl: 'https://s3/signed' });
    // v1 was purged: the row survives as a tombstone, the link does not. Handing back the
    // stored fileUrl here would be a 403 dressed as a download.
    expect(listed[1]).toMatchObject({ available: false, fileUrl: null, fileName: 'rev-a.pdf' });
  });

  it('does not expose the archive of a deleted document', async () => {
    doc.deletedAt = new Date();
    await expect(service.listVersions('d1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ============================================================================
// Retention — the window the soft delete deferred
// ============================================================================
//
// The soft delete stopped removing stored objects and said so: billed forever, no purge
// job. The policy is category-aware, because the reason the delete went soft (documents
// evidence obligations, and the sale-stage gate counts them) applies to twelve of the
// sixteen categories and to none of the four below.
//
// Same in-memory approach as the suite above — the queries run against real rows so
// "the filter selects exactly these" is demonstrated, not restated.

/** Operators the evaluator understands; anything else in a `where` value is a relation. */
const OPERATORS = new Set(['in', 'not', 'lte', 'lt', 'gte', 'gt', 'equals']);

function matchesCondition(value: any, condition: any): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return value?.getTime?.() === condition.getTime();
  if (condition && typeof condition === 'object') {
    if ('in' in condition && !condition.in.includes(value)) return false;
    if ('not' in condition) {
      const isNull = value === null || value === undefined;
      if (condition.not === null ? isNull : value === condition.not) return false;
    }
    if ('lte' in condition && !(value != null && value <= condition.lte)) return false;
    if ('lt' in condition && !(value != null && value < condition.lt)) return false;
    if ('gte' in condition && !(value != null && value >= condition.gte)) return false;
    return true;
  }
  return value === condition;
}

/** Adds OR/AND and one level of relation traversal to the matcher used above. */
function matchesQuery(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === 'OR') return (condition as any[]).some((w) => matchesQuery(row, w));
    if (key === 'AND') return (condition as any[]).every((w) => matchesQuery(row, w));
    const value = row[key];
    const isRelationWhere =
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Date) &&
      !Array.isArray(condition) &&
      !Object.keys(condition).some((k) => OPERATORS.has(k));
    if (isRelationWhere) return value ? matchesQuery(value, condition) : false;
    return matchesCondition(value ?? null, condition);
  });
}

describe('DocumentRetentionService — purge policy', () => {
  let retention: DocumentRetentionService;
  let prisma: any;
  let storage: any;
  let audit: any;
  let env: Record<string, string>;
  let docs: any[];
  let versions: any[];

  const NOW = new Date('2026-08-14T00:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  function seedDoc(over: Partial<Record<string, any>> = {}) {
    const row = {
      id: `d${docs.length + 1}`,
      fileName: 'site-photo.jpg',
      fileUrl: 'https://s3/raw',
      storagePath: `p/obj-${docs.length + 1}.jpg`,
      category: DocCategory.PHOTO,
      deletedAt: null,
      ...over,
    };
    docs.push(row);
    return row;
  }

  function seedVersion(document: any, over: Partial<Record<string, any>> = {}) {
    const row = {
      id: `v${versions.length + 1}`,
      documentId: document.id,
      versionNumber: 1,
      storagePath: `p/ver-${versions.length + 1}.jpg`,
      archivedAt: daysAgo(1),
      // The relation the version sweep reads through.
      document,
      ...over,
    };
    versions.push(row);
    return row;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    docs = [];
    versions = [];
    env = {};
    const table = (rows: () => any[]) => ({
      findMany: jest.fn(({ where, take }: any) => {
        const hits = rows().filter((r) => matchesQuery(r, where));
        return Promise.resolve(take ? hits.slice(0, take) : hits);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = rows().find((r) => r.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    });
    prisma = { document: table(() => docs), documentVersion: table(() => versions) };
    storage = { delete: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    retention = new DocumentRetentionService(
      prisma,
      storage,
      { get: (key: string) => env[key] } as any,
      audit,
    );
  });

  const run = (opts: any = {}) => retention.purge({ now: NOW, ...opts });

  it('purges a soft-deleted photo once the grace period has run out', async () => {
    const photo = seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });

    const manifest = await run();

    expect(storage.delete).toHaveBeenCalledWith('p/obj-1.jpg');
    expect(manifest.documents).toBe(1);
    // The ROW survives — a tombstone naming the file, its uploader and when it went.
    expect(docs).toHaveLength(1);
    expect(photo.fileName).toBe('site-photo.jpg');
    // ...pointing at nothing, which is what makes the re-run below a no-op.
    expect(photo.storagePath).toBeNull();
  });

  it.each(
    (Object.values(DocCategory) as DocCategory[]).filter((c) => !PURGEABLE_CATEGORIES.includes(c)),
  )('never purges a %s, however long ago it was deleted', async (category) => {
    // The twelve evidentiary categories. An allowlist, so a category added by a future
    // migration lands HERE by default rather than becoming silently purgeable.
    seedDoc({ category, deletedAt: daysAgo(5 * 365) });

    const manifest = await run();

    expect(storage.delete).not.toHaveBeenCalled();
    expect(manifest.objects).toEqual([]);
  });

  it('leaves a purgeable document that is not yet eligible completely alone', async () => {
    seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS - 1) });

    expect((await run()).objects).toEqual([]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('never touches a LIVE document, whatever its age or category', async () => {
    // The property that makes this safe to run against a working vault: the only thing it
    // can reach is something a person already chose to delete.
    const live = seedDoc({ deletedAt: null });

    await run();

    expect(storage.delete).not.toHaveBeenCalled();
    expect(live.storagePath).toBe('p/obj-1.jpg');
  });

  it('is safe to re-run — the second pass finds nothing left to do', async () => {
    seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 10) });

    await run();
    expect(storage.delete).toHaveBeenCalledTimes(1);

    const second = await run();

    // Idempotence comes from the nulled storagePath, not from a state flag: the row no
    // longer matches the sweep at all.
    expect(second.documents).toBe(0);
    expect(second.objects).toEqual([]);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('reports what it WOULD remove in a dry run, and removes nothing', async () => {
    const photo = seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });

    const manifest = await run({ dryRun: true });

    expect(manifest.dryRun).toBe(true);
    expect(manifest.documents).toBe(1);
    expect(manifest.objects[0]).toMatchObject({ documentId: photo.id, storagePath: 'p/obj-1.jpg' });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(photo.storagePath).toBe('p/obj-1.jpg');
    // Nothing happened, so nothing is logged as having happened.
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('honours DOCUMENT_PURGE_DRY_RUN as the off switch', async () => {
    env.DOCUMENT_PURGE_DRY_RUN = 'true';
    seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });

    expect((await retention.purge({ now: NOW })).dryRun).toBe(true);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('keeps the row pointing at an object the bucket refused to delete', async () => {
    // Nulling storagePath on a failure would strand the key with nothing left pointing at
    // it — the one outcome with no path back. Leave it; tomorrow retries.
    const photo = seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });
    storage.delete.mockRejectedValueOnce(new Error('AccessDenied'));

    const manifest = await run();

    expect(manifest.failed).toBe(1);
    expect(manifest.documents).toBe(0);
    expect(photo.storagePath).toBe('p/obj-1.jpg');
  });

  it('clamps a dangerously short configured grace to the floor', async () => {
    // `DOCUMENT_PURGE_GRACE_DAYS=1` from a bad deploy would otherwise purge everything
    // deleted yesterday.
    env.DOCUMENT_PURGE_GRACE_DAYS = '1';
    const tooRecent = seedDoc({ deletedAt: daysAgo(MIN_PURGE_GRACE_DAYS - 5) });
    const older = seedDoc({ deletedAt: daysAgo(MIN_PURGE_GRACE_DAYS + 5) });

    const manifest = await run();

    expect(manifest.graceDays).toBe(MIN_PURGE_GRACE_DAYS);
    expect(manifest.objects.map((o) => o.documentId)).toEqual([older.id]);
    expect(tooRecent.storagePath).not.toBeNull();
  });

  it.each(['0', '', 'ninety', '-5'])('falls back to the default grace for %p', async (value) => {
    // An unset variable renders as empty and a mis-set one as garbage. Neither is somebody
    // asking for an immediate purge, so neither is honoured as one.
    env.DOCUMENT_PURGE_GRACE_DAYS = value;
    seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS - 5) });

    const manifest = await run();

    expect(manifest.graceDays).toBe(DEFAULT_PURGE_GRACE_DAYS);
    expect(manifest.objects).toEqual([]);
  });

  it('caps the blast radius of a single run', async () => {
    for (let i = 0; i < PURGE_BATCH_LIMIT + 10; i++) {
      seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });
    }

    const manifest = await run();

    expect(manifest.documents).toBe(PURGE_BATCH_LIMIT);
    expect(manifest.capped).toBe(true);
    expect(docs.filter((d) => d.storagePath !== null)).toHaveLength(10);
  });

  it('writes one immutable manifest per document, carrying the keys it removed', async () => {
    // The purge is the only irreversible step in the flow, so it records the exact keys —
    // key plus date is what makes restore possible where the bucket has object versioning.
    const photo = seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });
    seedVersion(photo, { archivedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 2) });

    await run();

    expect(audit.log).toHaveBeenCalledTimes(1);
    const event = audit.log.mock.calls[0][0];
    expect(event).toMatchObject({ action: 'PURGE', entity: 'Document', entityId: photo.id });
    expect(event.userId).toBeUndefined(); // a policy purge has no actor
    expect(event.metadata.reason).toBe('RETENTION_POLICY');
    expect(event.metadata.objects.map((o: any) => o.storagePath).sort()).toEqual([
      'p/obj-1.jpg',
      'p/ver-1.jpg',
    ]);
  });

  // ---- archived versions: the cost replaceFile stopped deleting ----

  it('purges a version superseded long ago even while its document is live', async () => {
    // replaceFile no longer destroys the outgoing object, which is correct AND a new
    // unbounded cost. Same allowlist, same grace, keyed on when it was superseded.
    const live = seedDoc({ deletedAt: null });
    const old = seedVersion(live, { archivedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });
    const recent = seedVersion(live, { archivedAt: daysAgo(3) });

    const manifest = await run();

    expect(manifest.versions).toBe(1);
    expect(old.storagePath).toBeNull();
    expect(recent.storagePath).toBe('p/ver-2.jpg');
    // The live document's own object is untouched.
    expect(live.storagePath).toBe('p/obj-1.jpg');
  });

  it('keeps every version of a retained category forever', async () => {
    // A superseded draft of a deed is exactly the thing a dispute asks for.
    const deed = seedDoc({ category: DocCategory.DEED, deletedAt: daysAgo(5 * 365) });
    seedVersion(deed, { archivedAt: daysAgo(5 * 365) });

    expect((await run()).objects).toEqual([]);
  });

  it('takes a recently-archived version down with a document past its grace', async () => {
    // Without this arm, deleting a document would purge its current object while a version
    // replaced last week outlived it.
    const gone = seedDoc({ deletedAt: daysAgo(DEFAULT_PURGE_GRACE_DAYS + 1) });
    const recent = seedVersion(gone, { archivedAt: daysAgo(3) });

    const manifest = await run();

    expect(manifest.documents).toBe(1);
    expect(manifest.versions).toBe(1);
    expect(recent.storagePath).toBeNull();
  });
});

// ============================================================================
// Sale-attached documents — the stage gate's missing half
// ============================================================================
//
// SalesService.assertStageDocumentsAttached reads `document.saleId` to decide whether a
// sale may advance. Until this existed nothing could WRITE that column: the upload DTO had
// no saleId and create() never set one. So "upload the Deed, NOC and Possession Certificate
// to the sale's documents" named a place the app had no route to — the CLOSED gate was
// unsatisfiable through the UI, and Sales could read exactly why a deal would not close and
// do nothing about it.

describe('DocumentsService.create — attaching to a sale', () => {
  let service: DocumentsService;
  let prisma: any;
  let storage: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ name: 'Rio Ranch' }) },
      sale: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1', projectId: 'pr-from-sale', unitId: 'u-from-sale', deletedAt: null,
        }),
      },
      document: {
        create: jest.fn((args: any) => Promise.resolve({ id: 'd1', category: DocCategory.DEED, ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ storagePath: 'p/deed.pdf', publicUrl: 'https://s3/deed.pdf' }),
      signedUrl: jest.fn().mockResolvedValue('https://s3/signed'),
    };
    service = new DocumentsService(prisma, storage);
  });

  it('files the document against the sale AND its unit and project', async () => {
    // Both, not either: a Deed is evidence about the deal (the gate reads saleId) and about
    // the unit (whoever opens it next year will not know which sale it arrived on).
    await service.create(file(), { saleId: 's1', category: 'DEED' }, 'user-1');

    expect(prisma.document.create.mock.calls[0][0].data).toMatchObject({
      saleId: 's1',
      unitId: 'u-from-sale',
      projectId: 'pr-from-sale',
      category: 'DEED',
    });
  });

  it('derives the unit from the sale rather than trusting the caller', async () => {
    // A client sending a mismatched unitId would otherwise file a Deed against the wrong
    // unit. The sale already knows the right answer.
    await service.create(
      file(),
      { saleId: 's1', unitId: 'some-other-unit', projectId: 'some-other-project', category: 'DEED' },
      'user-1',
    );
    expect(prisma.document.create.mock.calls[0][0].data).toMatchObject({
      unitId: 'u-from-sale',
      projectId: 'pr-from-sale',
    });
  });

  it('refuses a sale that does not exist or was deleted, before touching storage', async () => {
    prisma.sale.findUnique.mockResolvedValue(null);
    await expect(service.create(file(), { saleId: 'nope' }, 'user-1'))
      .rejects.toThrow(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();

    prisma.sale.findUnique.mockResolvedValue({ id: 's1', projectId: 'p', unitId: 'u', deletedAt: new Date() });
    await expect(service.create(file(), { saleId: 's1' }, 'user-1'))
      .rejects.toThrow(NotFoundException);
  });

  it('leaves saleId null for an ordinary upload', async () => {
    await service.create(file(), { projectId: 'pr1', unitId: 'u1' }, 'user-1');
    expect(prisma.document.create.mock.calls[0][0].data).toMatchObject({
      saleId: null, unitId: 'u1', projectId: 'pr1',
    });
    expect(prisma.sale.findUnique).not.toHaveBeenCalled();
  });

  it('lists by sale alone, never widening to the unit', async () => {
    // A unit that sold twice must not let the first deal's Deed answer for the second.
    await service.findBySale('s1');
    expect(prisma.document.findMany.mock.calls[0][0].where).toEqual({ saleId: 's1', deletedAt: null });
  });
});

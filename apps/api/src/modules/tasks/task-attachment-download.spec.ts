import { NotFoundException } from '@nestjs/common';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TasksController } from './tasks.controller';

/**
 * Task attachments are served from a guarded controller route, not a static mount.
 *
 * They used to sit behind `app.useStaticAssets(uploads, { prefix: '/uploads' })`, which is
 * outside the `api` global prefix and outside every guard — readable by anyone holding the
 * URL — and which neither nginx nor the Vite dev proxy forwarded, so the Download button
 * saved the SPA's index.html instead of the file.
 *
 * The guard/permission side is covered by route-permissions.spec.ts. What is asserted here
 * is the file resolution: the stored `fileUrl` is reduced to its basename and re-checked
 * against the uploads directory, so neither a legacy row nor a hand-edited one can address
 * a file elsewhere on the box.
 */
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'tasks');

function makeController(attachment: { fileUrl: string; fileName: string }) {
  const service: any = { findAttachment: jest.fn().mockResolvedValue(attachment) };
  return new TasksController(service);
}

/** Minimal Express `res` — we only care which path `download()` is handed. */
function makeRes() {
  const res: any = { downloadedPath: null as string | null, downloadedName: null as string | null };
  res.download = (path: string, name: string) => {
    res.downloadedPath = path;
    res.downloadedName = name;
  };
  return res;
}

describe('GET /tasks/attachments/:attachmentId/download', () => {
  const realFile = 'legacy-1778267469487-947475858.txt';

  beforeAll(() => {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    writeFileSync(join(UPLOADS_DIR, realFile), 'legacy bytes');
  });

  afterAll(() => {
    rmSync(join(UPLOADS_DIR, realFile), { force: true });
  });

  it('serves a legacy row whose filename predates the uuid scheme', async () => {
    const controller = makeController({ fileUrl: `/uploads/tasks/${realFile}`, fileName: 'Report.txt' });
    const res = makeRes();
    await controller.downloadAttachment('a1', res);
    expect(res.downloadedPath).toBe(join(UPLOADS_DIR, realFile));
    // The ORIGINAL name is restored on the way out, not the on-disk one.
    expect(res.downloadedName).toBe('Report.txt');
  });

  it('404s when the row survives but the file is gone', async () => {
    const controller = makeController({ fileUrl: '/uploads/tasks/never-existed.pdf', fileName: 'x.pdf' });
    await expect(controller.downloadAttachment('a1', makeRes()))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['../../../../etc/passwd', 'traversal out of the uploads dir'],
    ['/etc/passwd', 'an absolute path'],
    ['/uploads/tasks/../../../package.json', 'traversal back up through the prefix'],
  ])('refuses %s (%s)', async (fileUrl) => {
    const controller = makeController({ fileUrl, fileName: 'evil' });
    await expect(controller.downloadAttachment('a1', makeRes()))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Attachments uploaded since 2026-10-24 live in the bucket (TasksService.uploadAttachment)
 * and are streamed back through this same route — not redirected, because the browser
 * fetches it as an authenticated XHR and a redirect to the bucket would be cross-origin.
 */
describe('GET /tasks/attachments/:attachmentId/download — stored in the bucket', () => {
  const { PassThrough, Readable } = require('stream');

  function makeStoredController(contentType: string) {
    const service: any = {
      findAttachment: jest.fn().mockResolvedValue({
        fileUrl: 'https://bucket/p1/task-attachments/file-abc.docx',
        storagePath: 'p1/task-attachments/file-abc.docx',
        fileName: 'Lien waiver.docx',
      }),
      openStoredAttachment: jest.fn().mockResolvedValue({
        body: Readable.from([Buffer.from('bytes')]),
        contentLength: 5,
        contentType,
      }),
    };
    return { controller: new TasksController(service), service };
  }

  it('streams the object with the derived type and an attachment disposition under the original name', async () => {
    const { controller, service } = makeStoredController('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const res: any = new PassThrough();
    const headers: Record<string, string> = {};
    res.setHeader = (k: string, v: string) => { headers[k] = v; };
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise((resolve) => res.on('end', resolve));

    await controller.downloadAttachment('a1', res);
    await done;

    expect(service.openStoredAttachment).toHaveBeenCalledWith('p1/task-attachments/file-abc.docx', 'Lien waiver.docx');
    expect(headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(headers['Content-Disposition']).toMatch(/^attachment; filename="Lien waiver.docx"/);
    expect(headers['Content-Length']).toBe('5');
    expect(Buffer.concat(chunks).toString()).toBe('bytes');
  });
});

describe('TasksService.uploadAttachment — through the storage driver, not local disk', () => {
  const { TasksService } = require('./tasks.service');

  function makeService(task: { projectId: string } | null) {
    const prisma: any = {
      task: { findUnique: jest.fn().mockResolvedValue(task) },
      taskAttachment: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'att1', ...data })) },
    };
    const storage: any = {
      upload: jest.fn().mockResolvedValue({
        storagePath: 'p1/task-attachments/file-abc.pdf',
        publicUrl: 'https://bucket/p1/task-attachments/file-abc.pdf',
        contentType: 'application/pdf',
      }),
    };
    return { service: new TasksService(prisma, {} as any, storage, {} as any), prisma, storage };
  }

  const file = { buffer: Buffer.from('%PDF'), originalname: 'Waiver.pdf', mimetype: 'application/pdf', size: 4 };

  it('stores the bytes via StorageService and records the bucket key and DERIVED type', async () => {
    const { service, prisma, storage } = makeService({ projectId: 'p1' });
    const row = await service.uploadAttachment('t1', 'u1', file);

    expect(storage.upload).toHaveBeenCalledWith(file.buffer, 'application/pdf', 'Waiver.pdf', {
      projectId: 'p1',
      category: 'task-attachments',
    });
    expect(prisma.taskAttachment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        storagePath: 'p1/task-attachments/file-abc.pdf',
        mimeType: 'application/pdf',
        fileName: 'Waiver.pdf',
      }),
    }));
    expect(row.storagePath).toBe('p1/task-attachments/file-abc.pdf');
  });

  it('404s an unknown task before storing anything', async () => {
    const { service, storage } = makeService(null);
    await expect(service.uploadAttachment('missing', 'u1', file)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

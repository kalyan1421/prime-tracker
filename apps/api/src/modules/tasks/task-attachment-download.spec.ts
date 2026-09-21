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

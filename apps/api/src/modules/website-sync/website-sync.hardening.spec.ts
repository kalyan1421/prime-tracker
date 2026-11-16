import { ForbiddenException } from '@nestjs/common';
import { WebsiteSyncService } from './website-sync.service';
import { WebsiteSyncController } from './website-sync.controller';
import { ProjectsController } from '../projects/projects.controller';

/**
 * PrimeDevelopers-web security audit (1 Nov): who may point a project at a
 * public listing (M3), and how snapshots travel (L5).
 */
const SECRET = 'a'.repeat(64);
const target = (url: string) =>
  new WebsiteSyncService({} as any, { get: (k: string) => ({ WEBSITE_SYNC_URL: url, WEBSITE_SYNC_SECRET: SECRET } as any)[k] } as any).target();

describe('sync transport (L5)', () => {
  it('pushes over https, or plain http only to this host', () => {
    expect(target('https://site.test/api/integrations/tracker/snapshot')).not.toBeNull();
    expect(target('http://127.0.0.1:3002/api/integrations/tracker/snapshot')).not.toBeNull();
    expect(target('http://localhost:3002/api/integrations/tracker/snapshot')).not.toBeNull();
    expect(target('http://site.test/api/integrations/tracker/snapshot')).toBeNull();
    expect(target('http://127.0.0.1.evil.test/x')).toBeNull();
  });
});

describe('admin-only website controls (M3)', () => {
  it('only settings:manage may force a push', async () => {
    const sync: any = { pushProject: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new WebsiteSyncController(sync);
    expect(() => controller.push('p1', false, true, ['project:edit'])).toThrow(ForbiddenException);
    await controller.push('p1', true, false, ['project:edit']);
    await controller.push('p1', false, true, ['project:edit', 'settings:manage']);
    expect(sync.pushProject).toHaveBeenCalledTimes(2);
  });

  it('only settings:manage may set or clear a website slug; other edits are unaffected', async () => {
    const projects: any = { update: jest.fn().mockResolvedValue({}) };
    const controller = new ProjectsController(projects);
    expect(() => controller.update('p1', { websiteSlug: 'pow-leander' } as any, ['project:edit'])).toThrow(ForbiddenException);
    expect(() => controller.update('p1', { websiteSlug: null } as any, ['project:edit'])).toThrow(ForbiddenException);
    await controller.update('p1', { name: 'Renamed' } as any, ['project:edit']);
    await controller.update('p1', { websiteSlug: 'pow-leander' } as any, ['settings:manage']);
    expect(projects.update).toHaveBeenCalledTimes(2);
  });
});

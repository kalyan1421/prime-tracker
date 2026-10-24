import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { ProjectAccessGuard } from './project-access.guard';
import { guardResolvesParam } from './project-access.service';

/**
 * Every id in a project-guarded route must be one ProjectAccessGuard can resolve.
 *
 * The guard only checks projects it can resolve from the request. An id it has no
 * resolver for is silently "no project context", and the request passes — for a scoped
 * role, no membership check at all. project-access.service.ts records finding that gap
 * repeatedly (stage photos, daily-log photos, task attachments, commission installments),
 * and the 24 Oct 2026 audit found six more: sale installments, change orders, milestone
 * photos, task updates, lead interests and website-sync, plus draw and schedule ids that
 * LoansController read as LOAN ids. A sweep, like route-permissions.spec.ts, so a new
 * route is checked the moment it exists rather than when someone remembers to.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

/**
 * Params deliberately NOT resolved, and why. Each is either not project data, or is
 * checked against a resolved parent in the service. Adding one here is a decision.
 */
const EXEMPT: Record<string, string> = {
  // A Broker is a portfolio-wide record with no project of its own.
  'BrokersController.findOne:id': 'portfolio-wide broker',
  'BrokersController.update:id': 'portfolio-wide broker',
  'BrokersController.remove:id': 'portfolio-wide broker',
  // These two list the broker's deals, and BrokersService narrows them to member projects.
  'BrokersController.getSalesByBroker:id': 'portfolio-wide broker; service scopes the deals',
  'BrokersController.leasesByBroker:id': 'portfolio-wide broker; service scopes the deals',
  // Editing/deleting a comment is author-only (or Founder/Super Admin, who are unscoped).
  'CommentsController.updateUnit:id': 'author-only',
  'CommentsController.updateProject:id': 'author-only',
  'CommentsController.deleteUnit:id': 'author-only',
  'CommentsController.deleteProject:id': 'author-only',
  'LeadsController.updateComment:commentId': 'author-only',
  'LeadsController.deleteComment:commentId': 'author-only',
  'TasksController.deleteComment:commentId': 'author-only (or Founder/Super Admin)',
  // Nested under a resolved parent ':id', and the service refuses a child of another parent.
  'LeadsController.updateActivity:activityId': 'service checks activity.leadId === :id',
  'InteriorController.removeScope:itemId': 'service checks item.interiorProjectId === :id',
  'InteriorController.updateEstimateLine:lineId': 'service checks line.interiorProjectId === :id',
  'InteriorController.removeEstimateLine:lineId': 'service checks line.interiorProjectId === :id',
  'InteriorController.decideChangeOrder:coId': 'service checks co.interiorProjectId === :id',
  'InteriorController.sendPurchaseOrder:poId': 'service checks po.interiorProjectId === :id',
  'InteriorController.approvePurchaseOrder:poId': 'service checks po.interiorProjectId === :id',
  'InteriorController.voidPurchaseOrder:poId': 'service checks po.interiorProjectId === :id',
  'InteriorController.completePurchaseOrder:poId': 'service checks po.interiorProjectId === :id',
  // Org-level cost-code catalogue, not a project's.
  'InteriorCostingController.updateCostCode:codeId': 'org-level settings',
  // A user id beside a resolved project id.
  'ProjectsController.removeMember:userId': 'a user, beside the resolved :id project',
  // The service resolves the slug and asserts membership itself.
  'ProjectsController.findBySlug:slug': 'ProjectsService.findBySlug checks membership',
};

/**
 * A bare ':id' that follows a literal segment ("change-orders/:id") is usually a CHILD's id
 * on a controller whose ':id' means the parent — exactly how draw and change-order ids
 * went unchecked. These are the ones where it genuinely is the controller's own entity.
 */
const ID_AFTER_LITERAL_OK = new Set([
  'WebsiteSyncController.snapshot', // projects/:id — a project, as mapped
  'WebsiteSyncController.push',
]);

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function loadControllers(file: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file);
  return Object.values(mod).filter((v: any) => typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v));
}

const GUARDED = controllerFiles(MODULES_DIR)
  .flatMap(loadControllers)
  .filter((c) => (Reflect.getMetadata(GUARDS_METADATA, c) ?? []).includes(ProjectAccessGuard));

const ROUTES: Array<{ key: string; controller: string; path: string }> = GUARDED.flatMap((c) =>
  Object.getOwnPropertyNames(c.prototype)
    .filter((h) => h !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, c.prototype[h]))
    .map((h) => ({ key: `${c.name}.${h}`, controller: c.name, path: String(Reflect.getMetadata(PATH_METADATA, c.prototype[h])) })),
);

const PARAM_ROWS = ROUTES.flatMap((r) =>
  (r.path.match(/:[A-Za-z]+/g) ?? []).map((p) => ({ ...r, param: p.slice(1) })),
);

describe('project-guarded route params', () => {
  it('finds guarded controllers and parameterised routes to check', () => {
    expect(GUARDED.length).toBeGreaterThan(25);
    expect(PARAM_ROWS.length).toBeGreaterThan(150);
  });

  it.each(PARAM_ROWS.map((r) => [`${r.key} :${r.param}`, r] as const))('%s resolves to a project', (_label, r) => {
    if (EXEMPT[`${r.key}:${r.param}`]) return;
    expect(guardResolvesParam(r.controller, r.param)).toBe(true);
  });

  it.each(ROUTES.filter((r) => /[^/:]+\/:id\b/.test(r.path)).map((r) => [r.key, r] as const))(
    '%s — a bare :id after a literal segment is the controller\'s own entity',
    (key) => {
      if (EXEMPT[`${key}:id`]) return;
      expect(ID_AFTER_LITERAL_OK.has(key)).toBe(true);
    },
  );

  it('keeps every exemption pointing at a route that exists', () => {
    const live = new Set(PARAM_ROWS.map((r) => `${r.key}:${r.param}`));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });
});

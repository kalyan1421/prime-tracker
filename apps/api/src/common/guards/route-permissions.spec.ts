import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS_KEY, ANY_PERMISSIONS_KEY } from '../decorators/index';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';

/**
 * Every HTTP route in the app must be behind a guard and a permission.
 *
 * This exists because the repo had NO tests at the HTTP layer at all: every service is
 * well covered one layer BELOW where requests actually arrive, so a dropped
 * `@RequirePermissions` or `@UseGuards` was invisible to 649 passing tests. That is not
 * hypothetical — the comment at the top of tasks.controller.ts records that it once had
 * no PermissionsGuard, which let any authenticated user CRUD tasks on any project.
 *
 * Written as a filesystem sweep rather than an explicit list so a NEW controller is
 * covered the moment it is created. A list would have to be remembered, which is
 * exactly the failure mode being guarded against.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

/**
 * Routes that are legitimately permission-free, and WHY.
 *
 * Two categories only:
 *
 *   AUTH  — you cannot hold a permission before you have a token.
 *   SELF  — the route derives its subject from `@CurrentUser('sub')` and touches only
 *           the caller's own row. Gating "read my own notifications" behind a
 *           permission would be wrong, not safer.
 *
 * SELF is the category that needs care: it is only safe while the handler takes the
 * user id from the TOKEN. A version that accepted `:userId` from the URL would be an
 * IDOR and would still sit quietly on this list — so a route moving into SELF deserves
 * a read of its handler, not just an entry here.
 */
const AUTH_ROUTES = [
  // Genuinely public — reached before a token exists.
  'AuthController.login',
  'AuthController.googleLogin',
  'AuthController.googleCallback',
  'AuthController.refresh',
  // Guarded per-route by JwtAuthGuard, but self-scoped: they act on the caller's own
  // session or credentials, so a permission would be the wrong instrument.
  'AuthController.logout',
  'AuthController.me',
  'AuthController.changePassword',
  'AuthController.setupMfa',
  'AuthController.enableMfa',
  'AuthController.disableMfa',
  'AuthController.verifyMfa',
];

/**
 * Hit by the OAuth provider, not by a logged-in user, so there is no token to carry a
 * permission. Its safety comes from the state/code exchange, not from RBAC.
 */
const OAUTH_CALLBACK_ROUTES = ['QuickbooksController.callback'];

const SELF_SCOPED_ROUTES = [
  'UsersController.updateSelf',
  'NotificationsController.findForUser',
  'NotificationsController.markRead',
  'NotificationsController.getPreferences',
  'NotificationsController.setPreference',
];

const PERMISSION_FREE = new Set([...AUTH_ROUTES, ...OAUTH_CALLBACK_ROUTES, ...SELF_SCOPED_ROUTES]);

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Every exported class in the file that Nest would treat as a controller. */
function loadControllers(file: string): Array<new (...args: any[]) => any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file);
  return Object.values(mod).filter(
    (v: any) => typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v),
  ) as Array<new (...args: any[]) => any>;
}

/** Handler methods on the controller, excluding the constructor and inherited noise. */
function routeHandlers(controller: any): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter((name) => {
    if (name === 'constructor') return false;
    const fn = controller.prototype[name];
    if (typeof fn !== 'function') return false;
    // A route handler is anything Nest stamped a path onto.
    return Reflect.hasMetadata(PATH_METADATA, fn);
  });
}

const CONTROLLERS = controllerFiles(MODULES_DIR).flatMap(loadControllers);

describe('every controller is guarded', () => {
  it('finds controllers to check (a passing-because-empty sweep is worthless)', () => {
    expect(CONTROLLERS.length).toBeGreaterThan(20);
  });

  const routeRows: Array<[string, any, string]> = CONTROLLERS.flatMap((c: any) =>
    routeHandlers(c).map((h) => [`${c.name}.${h}`, c, h] as [string, any, string]),
  );

  it.each(routeRows)('%s sits behind a guard', (key, controller, handler) => {
    // Class-level @UseGuards is the house pattern, but AuthController and
    // QuickbooksController legitimately guard PER ROUTE — they each mix genuinely
    // public endpoints with authenticated ones, and a class-level guard would either
    // lock out the login page or wave the rest through. So accept either, and assert
    // what actually matters: no route is reachable with no guard at all.
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
    const routeGuards = Reflect.getMetadata(GUARDS_METADATA, controller.prototype[handler]) ?? [];
    const guarded = classGuards.length > 0 || routeGuards.length > 0;

    // The four truly public routes are the only ones allowed to have neither.
    const PUBLIC = ['AuthController.login', 'AuthController.refresh', 'QuickbooksController.callback'];
    if (PUBLIC.includes(key)) return;

    expect(guarded).toBe(true);
  });
});

describe('every route requires a permission', () => {
  const rows: Array<[string, any, string]> = CONTROLLERS.flatMap((c: any) =>
    routeHandlers(c).map((h) => [`${c.name}.${h}`, c, h] as [string, any, string]),
  );

  it('sweeps a realistic number of routes', () => {
    expect(rows.length).toBeGreaterThan(150);
  });

  it.each(rows)('%s', (key, controller, handler) => {
    if (PERMISSION_FREE.has(key)) return;
    const perms =
      Reflect.getMetadata(PERMISSIONS_KEY, controller.prototype[handler]) ??
      Reflect.getMetadata(PERMISSIONS_KEY, controller);
    // @RequireAnyPermission is the other way a route states its requirement — one of N
    // rather than all of N. It writes a different metadata key, so a route guarded only
    // that way would read as permission-free here.
    const anyPerms =
      Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller.prototype[handler]) ??
      Reflect.getMetadata(ANY_PERMISSIONS_KEY, controller);

    expect(
      (Array.isArray(perms) && perms.length > 0) ||
      (Array.isArray(anyPerms) && anyPerms.length > 0),
    ).toBe(true);
  });
});

describe('the permission-free allowlist stays honest', () => {
  const allRoutes = new Set(
    CONTROLLERS.flatMap((c: any) => routeHandlers(c).map((h) => `${c.name}.${h}`)),
  );

  it.each([...PERMISSION_FREE])('%s still exists', (key) => {
    // A stale exemption for a deleted or renamed route is how an allowlist silently
    // stops describing reality — and how a NEW route can inherit an old exemption by
    // reusing a name.
    expect(allRoutes.has(key)).toBe(true);
  });

  it('has not grown without someone noticing', () => {
    // Every entry is a route anyone signed in can reach. The number going up should be
    // a decision, not a side effect.
    expect(PERMISSION_FREE.size).toBe(17);
  });
});

describe('the routes added this cycle carry the permission they are meant to', () => {
  // Spelled out rather than left to the sweep above: the sweep proves SOMETHING is
  // required, these prove it is the RIGHT thing. A tenancy transition behind
  // `project:view` would pass the sweep and be badly wrong.
  const expected: Array<[string, string, string[]]> = [
    ['LeasesController', 'endTenancy', ['lease:edit']],
    ['LeasesController', 'assignTenant', ['lease:edit']],
    ['LeasesController', 'assignments', ['lease:view']],
    ['TasksController', 'getUpdates', ['project:view']],
    ['TasksController', 'addUpdate', ['task:edit']],
    ['TasksController', 'addUpdatePhoto', ['task:edit']],
    ['TasksController', 'deleteUpdate', ['task:edit']],
    // The Site Tracker's destructive pair. Untracking clears the board fields AND deletes
    // the unit's checklist, so it must require both — one alone would let a holder of half
    // the rights do the whole job.
    ['UnitsController', 'untrackFromSiteTracker', ['siteTracker:edit', 'checklist:edit']],
    ['ConstructionChecklistController', 'clearUnitStages', ['checklist:edit']],
  ];

  it.each(expected)('%s.%s requires %s', (controllerName, handler, perms) => {
    const controller: any = CONTROLLERS.find((c) => c.name === controllerName);
    expect(controller).toBeDefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.prototype[handler])).toEqual(perms);
  });
});

import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * End-to-end journeys for the two features delivered this cycle.
 *
 * These earn their slowness by crossing every layer the unit tests mock away: the
 * ValidationPipe, the permission guards, the real transaction, the DB constraints, the
 * query invalidation, and the rendering. They are also, almost exactly, the two things
 * a demo would show.
 *
 * Each test SETS UP ITS OWN data through the API and tears it down afterwards, rather
 * than depending on seed state. A test that assumes "unit 402 exists and is vacant" is
 * a test that fails on someone else's database for reasons that have nothing to do with
 * the code.
 */

const API = process.env.API_BASE ?? 'http://localhost:3001';
const AUTH = { Authorization: 'Bearer demo-FOUNDER' };

/**
 * Serial, not parallel.
 *
 * The API throttles at 10 requests/second (`short` in ThrottlerModule). Each test here
 * builds a project, a building, three units and a lease before it starts, so five
 * running at once burst well past that and the fixtures half-build — producing failures
 * that look like product bugs and are not. The throttle is correct production
 * behaviour; the tests should live within it.
 */
test.describe.configure({ mode: 'serial' });

/** Keep fixture setup under the 10/s limit. */
const pace = () => new Promise((r) => setTimeout(r, 120));

/**
 * Projects this file created, registered the moment they exist.
 *
 * Ownership lives HERE rather than in each test's local variable: a test that failed
 * partway through seedFixture never reached its `projectId = project.id` line, so its
 * project was created and then never cleaned up. That is how a database accumulates
 * litter from exactly the runs you were not watching.
 */
const createdProjects: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of createdProjects.splice(0)) {
    // Soft-delete: the API sets deletedAt rather than removing rows, so these stay in
    // the table but out of every query the app makes. Slugs are unique per run, so they
    // never collide; purge them periodically with
    //   DELETE FROM projects WHERE slug LIKE 'e2e-%' AND "deletedAt" IS NOT NULL;
    await request.delete(`${API}/api/projects/${id}?force=true`, { headers: AUTH });
    await pace();
  }
});

/**
 * Pick an option from a HeroUI Select.
 *
 * HeroUI renders BOTH a visually-hidden native `<select>` (for form compatibility) and
 * the button that actually drives its React state, and both carry the label — so
 * `getByLabel` is always ambiguous and fails Playwright's strict mode. The button's
 * accessible name is "<current value> <Label>", hence anchoring the match to the END.
 */
async function chooseOption(page: Page, label: string, option: string | RegExp) {
  const trigger = page
    .locator('[data-slot="trigger"]')
    .filter({ has: page.locator(`text=${label}`) })
    .first();
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  // A CSS locator, deliberately, not getByRole. HeroUI portals its dropdown and marks
  // the wrapper aria-hidden during the open animation, so the options are absent from
  // Playwright's accessibility tree while being plainly visible on screen — every
  // role-based lookup times out against a dropdown that is demonstrably open.
  const choice = page
    .locator('[role="option"]')
    .filter({ hasText: option })
    .first();
  await choice.waitFor({ state: 'visible' });
  await choice.click();
}

/** Parse a response, failing with the body rather than with `undefined` three lines later. */
async function okJson(res: any, what: string) {
  if (!res.ok()) throw new Error(`${what} failed (${res.status()}): ${await res.text()}`);
  return res.json();
}

/** Dev quick-login. Skips rather than fails when DEMO_MODE is off. */
async function devLogin(page: Page) {
  await page.goto('/login');
  const founder = page.getByRole('button', { name: /^founder/i });
  if (!(await founder.count())) {
    test.skip(true, 'Dev quick-login not exposed — needs DEMO_MODE=true on the API');
  }
  await founder.first().click();
  await expect(page).toHaveURL(/\/dashboard\//, { timeout: 15_000 });
}

/** A throwaway project/building/unit, created and owned by this test. */
async function seedFixture(request: APIRequestContext, label: string) {
  // Date.now() alone collides when two parallel workers start in the same millisecond,
  // and a colliding slug fails the whole fixture for reasons unrelated to the code.
  const suffix = `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;

  await pace();
  const created = await request.post(`${API}/api/projects`, {
      headers: AUTH,
      data: {
        name: `E2E ${label} ${suffix}`,
        // Required and @unique. Derived from the label + timestamp so parallel runs and
        // repeated runs never collide.
        slug: `e2e-${label}-${suffix}`,
        location: 'E2E Harness',
        status: 'ACTIVE',
        phase: 'CONSTRUCTION',
        projectType: 'COMMERCIAL',
      },
  });
  // Fail loudly here rather than three assertions later with an undefined id — a fixture
  // that half-built is the least useful failure message an E2E run can produce.
  if (!created.ok()) {
    throw new Error(`fixture project failed (${created.status()}): ${await created.text()}`);
  }
  const project = await created.json();
  createdProjects.push(project.id);

  await pace();
  const building = await okJson(
    await request.post(`${API}/api/buildings`, {
      headers: AUTH,
      data: { projectId: project.id, name: 'E2E Building', buildingType: 'RETAIL' },
    }),
    'fixture building',
  );

  const units = [] as any[];
  for (const unitNumber of ['E2E-1', 'E2E-2', 'E2E-3']) {
    await pace();
    units.push(
      await okJson(
        await request.post(`${API}/api/units`, {
          headers: AUTH,
          data: { buildingId: building.id, unitNumber, unitType: 'RETAIL', sqft: 1000 },
        }),
        `fixture unit ${unitNumber}`,
      ),
    );
  }

  return { project, building, units };
}

// ---------------------------------------------------------------------------

test.describe('Ending a tenancy', () => {
  test('records the move-out, warns about the early exit, and releases the unit', async ({
    page,
    request,
  }) => {
    const { project, units } = await seedFixture(request, 'tenancy');
    const unit = units[0];

    // A five-year lease, so ending it today is unambiguously early.
    const lease = await okJson(
      await request.post(`${API}/api/leases`, {
        headers: AUTH,
        data: {
          unitId: unit.id,
          tenantName: 'E2E Tenant',
          monthlyRent: 2000,
          leaseStart: '2025-01-01',
          leaseEnd: '2030-01-01',
          termMonths: 60,
          status: 'ACTIVE',
        },
      }),
      'fixture lease',
    );
    expect(lease.id).toBeTruthy();

    await request.post(`${API}/api/leases/${lease.id}/rent-invoices/generate`, {
      headers: AUTH,
      data: {},
    });

    await devLogin(page);
    await page.goto(`/projects/${project.id}/units/${unit.id}`);

    await page.getByTitle(/End tenancy/i).click();

    // The warning is derived in the dialog, before anything is submitted — it is the
    // answer to the question the date field raises.
    await expect(page.getByText(/this is an early exit/i)).toBeVisible();

    await page.getByLabel(/Move-out date/i).fill('2026-06-30');
    await chooseOption(page, 'Reason', /Ended early/i);
    await page.getByRole('button', { name: /^End tenancy$/i }).click();

    // The toast reports what actually happened rather than a generic success.
    await expect(page.getByText(/tenancy ended/i)).toBeVisible({ timeout: 10_000 });

    // The unit write is the step people forgot when doing this by hand, and the reason
    // 206 units were once invisible to the vacancy report.
    const after = await request
      .get(`${API}/api/units/${unit.id}`, { headers: AUTH })
      .then((r) => r.json());
    expect(after.status).toBe('AVAILABLE');
    expect(String(after.availableSince)).toContain('2026-06-30');

    // Unpaid months past the move-out are VOID, not deleted — deleting them would let
    // the next generation run recreate them.
    const invoices = await request
      .get(`${API}/api/leases/${lease.id}/rent-invoices`, { headers: AUTH })
      .then((r) => r.json());
    expect(invoices.some((i: any) => i.status === 'VOID')).toBe(true);
    expect(invoices.every((i: any) => i.status !== 'VOID' || i.voidedAt)).toBe(true);

    // And the timeline gains the entry that explains the gap between the contracted end
    // and the real one.
    const history = await request
      .get(`${API}/api/units/${unit.id}/history`, { headers: AUTH })
      .then((r) => r.json());
    const end = history.entries.find((e: any) => e.kind === 'tenancy_end');
    expect(end).toBeTruthy();
    expect(end.data.daysEarly).toBeGreaterThan(0);
  });

  test('refuses when rent was already collected past the move-out date', async ({ request }) => {
    // Driven through the API rather than the UI: the value here is the SERVER refusing,
    // and the dialog surfaces that message verbatim.
    const { project, units } = await seedFixture(request, 'guard');

    const lease = await request
      .post(`${API}/api/leases`, {
        headers: AUTH,
        data: {
          unitId: units[0].id,
          tenantName: 'E2E Paid',
          monthlyRent: 1000,
          leaseStart: '2025-01-01',
          leaseEnd: '2030-01-01',
          termMonths: 60,
          status: 'ACTIVE',
        },
      })
      .then((r) => r.json());

    const invoices = await request
      .post(`${API}/api/leases/${lease.id}/rent-invoices/generate`, { headers: AUTH, data: {} })
      .then((r) => r.json());

    const late = invoices[invoices.length - 1];
    await request.patch(`${API}/api/leases/rent-invoices/${late.id}/payment`, {
      headers: AUTH,
      data: { amountPaid: 1000 },
    });

    const res = await request.post(`${API}/api/leases/${lease.id}/end-tenancy`, {
      headers: AUTH,
      data: { terminationDate: '2025-06-30', terminationReason: 'EARLY_TERMINATION' },
    });

    expect(res.status()).toBe(400);
    // The message names the months, which is what makes it actionable.
    expect((await res.json()).message).toMatch(/already been collected for \d{4}-\d{2}/);
  });
});

// ---------------------------------------------------------------------------

test.describe('Construction updates board', () => {
  test('a multi-unit item appears on the board and on every unit it covers', async ({
    page,
    request,
  }) => {
    const { project, building, units } = await seedFixture(request, 'board');

    const item = await okJson(
      await request.post(`${API}/api/tasks`, {
        headers: AUTH,
        data: {
          projectId: project.id,
          buildingId: building.id,
          kind: 'CONSTRUCTION',
          title: 'E2E INTERIOR FINISHOUT',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          unitIds: units.map((u) => u.id),
        },
      }),
      'create multi-unit item',
    );

    // The scalar is null precisely because the item covers more than one unit.
    expect(item.unitId).toBeNull();
    expect(item.units).toHaveLength(3);

    await devLogin(page);
    await page.goto(`/projects/${project.id}/board`);

    await expect(page.getByText('E2E INTERIOR FINISHOUT')).toBeVisible({ timeout: 15_000 });
    // Grouped by building, and the item names every unit it covers.
    await expect(page.getByText(/Units E2E-1, E2E-2, E2E-3/)).toBeVisible();

    // Post a dated update, then confirm it is attributed to the right DAY rather than
    // to when it was typed.
    // Exact text. /update/i also matches the "Updates" column header and the "Add item"
    // button's neighbourhood, and .first() then clicks the wrong thing silently.
    await page.getByRole('button', { name: /^Add update$/ }).click();
    // By placeholder, not label: HeroUI renders the label as a sibling element that
    // also matches getByLabel, so the label lookup is ambiguous under strict mode —
    // the same trap as the Select triggers above.
    await page
      .getByPlaceholder(/Type @name to notify someone/i)
      .fill('E2E drywall complete on all three.');
    await page.locator('input[type="date"]').last().fill('2026-08-01');
    await page.getByRole('button', { name: /^Post$/ }).click();
    await expect(page.getByText(/E2E drywall complete/)).toBeVisible({ timeout: 10_000 });

    const updates = await request
      .get(`${API}/api/tasks/${item.id}/updates`, { headers: AUTH })
      .then((r) => r.json());
    expect(updates[0].updateDate).toContain('2026-08-01');

    // Every unit sees it — a scalar unitId could not have expressed this at all.
    for (const unit of units) {
      const forUnit = await request
        .get(`${API}/api/tasks?unitId=${unit.id}&kind=CONSTRUCTION`, { headers: AUTH })
        .then((r) => r.json());
      expect(forUnit.map((t: any) => t.title)).toContain('E2E INTERIOR FINISHOUT');
    }
  });

  test('refuses an item spanning two buildings', async ({ request }) => {
    const a = await seedFixture(request, 'bldg-a');
    const b = await request
      .post(`${API}/api/buildings`, {
        headers: AUTH,
        data: { projectId: a.project.id, name: 'E2E Building B', buildingType: 'RETAIL' },
      })
      .then((r) => r.json());
    const otherUnit = await request
      .post(`${API}/api/units`, {
        headers: AUTH,
        data: { buildingId: b.id, unitNumber: 'E2E-B1', unitType: 'RETAIL' },
      })
      .then((r) => r.json());

    const res = await request.post(`${API}/api/tasks`, {
      headers: AUTH,
      data: {
        projectId: a.project.id,
        kind: 'CONSTRUCTION',
        title: 'E2E cross-building',
        unitIds: [a.units[0].id, otherUnit.id],
      },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/same building/i);
  });
});

// ---------------------------------------------------------------------------

test.describe('Marking a unit leased asks for the tenant', () => {
  test('opens the lease form and leaves a banner if it is dismissed', async ({ page, request }) => {
    const { project, units } = await seedFixture(request, 'prompt');
    const unit = units[0];

    await devLogin(page);
    await page.goto(`/projects/${project.id}/units/${unit.id}`);

    // Nothing to warn about yet.
    await expect(page.getByText(/no tenant or lease has been recorded/i)).toHaveCount(0);

    await page.getByRole('button', { name: /^Edit$/ }).first().click();
    await chooseOption(page, 'Status', 'LEASED');
    await page.getByRole('button', { name: /^Save$/ }).click();

    // A unit marked leased with no lease records nothing, so the form is offered
    // immediately rather than left for someone to remember.
    await expect(page.getByText(/Add Lease/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    // Dismissing it must not hide the problem — the status can also be set from the
    // grid or a script, so the banner is the durable half of the fix.
    await expect(page.getByText(/no tenant or lease has been recorded/i)).toBeVisible();
  });
});

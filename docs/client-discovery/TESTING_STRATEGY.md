# Testing Strategy — after Phase 1 (lease transitions) and Phase 2 (construction board)

**Date:** 2026-08-13
**Status:** Audit of actual coverage, not a proposal. Gaps ranked by what they would let through.

---

## Where coverage actually stands

| Layer | State | Count |
|---|---|---|
| **Service unit tests** (mocked Prisma) | Strong, and the house style is genuinely good — tests assert *why*, not just *what* | 649 across 25 spec files |
| **HTTP / controller tests** | **None.** No supertest, no `Test.createTestingModule` over a controller | 0 |
| **DB constraint tests** | **None.** The exclusion constraint and both CHECKs were verified by hand in psql and never again | 0 |
| **Transaction rollback tests** | **None.** Every spec stubs `$transaction` as a pass-through | 0 |
| **Frontend component tests** | ✅ vitest + testing-library, jsdom. Derived logic and permission branching | 32 |
| **E2E** | Playwright configured, 4 smoke tests (login, redirect, dashboard, health) | 4 |

19 API modules have no spec file at all (`budgets`, `draws`, `loans`, `documents`, `reports`, `exceptions`, …). That predates this cycle and is out of scope here, but it is the backdrop.

---

## Closed during this audit (+29 tests, 620 → 649)

These were the gaps where the code was **only ever mocked** — `leases.service.spec` asserted `endTenancy` *called* them correctly, while nothing tested what they *did*. They are also the money-touching ones.

| Added | Covers |
|---|---|
| `capAtTermination` × 6 | delete-after vs truncate-covering, open-ended periods, UTC day normalisation, transaction client |
| `paidAfter` × 3 | `gt` not `gte` (the move-out month is legitimately paid), status **or** amount signals money |
| `voidAfter` × 6 | voids never deletes, DUE/PARTIAL/FREE only, refuses rows carrying money, always stamps `voidedAt` |
| `summariseInvoices` × 2 | VOID leaves `billed` — without it, ending a 5-year lease in year 1 parks 4 years of rent in outstanding AR |
| Photo `storagePath` × 6 | absolute path, traversal, external URL, `file://`, empty; signed URLs returned; one bad photo doesn't blank the list |
| `Task.kind` × 4 | **see the defect below** |

### A real defect this audit found

`tasks.controller.ts` takes `@Body() body: any` on create and update, so the DTOs never run — `Task.kind` reached the database completely unvalidated. `kind: "ANYTHING"` would persist happily, and that row then matches **neither** `kind=CONSTRUCTION` (the board) **nor** `kind=TASK` (the tasks page). The item is silently *lost*, not visibly wrong, which is the worse failure. Fixed with a service-level `resolveKind()` guard plus four tests.

The same `@Body() body: any` still means `unitIds`, `dueDate` and `assignedTo` are unvalidated at the HTTP boundary — see gap 1.

---

## Delivered 2026-08-13 — gaps 1, 2, 3 and 5 are closed

| Gap | What landed | Result |
|---|---|---|
| **1. HTTP layer** | `route-permissions.spec.ts` sweeps EVERY controller from the filesystem, so a new one is covered the day it is written. Plus `tenancy-dto.spec.ts` running the real `ValidationPipe` config | **642 route checks + 31 DTO checks** |
| **2. DB constraints** | `test/db-constraints.integration.spec.ts` against a real Postgres, every case in a rolled-back transaction, own jest config + `pnpm test:integration` | **17 checks** |
| **3. Transaction rollback** | `endTenancy` atomicity against the real transaction — commit-together, roll-back-together, no orphan occupancy event | included in the 17 |
| **5. Playwright** | 5 journeys covering both features and the tenant prompt | **5 passing in 12s** |

**Findings from the sweep, worth recording:**

- **10 routes carry no permission.** All are legitimate — 5 auth flows and 5 self-scoped
  (`@CurrentUser('sub')`, acting only on the caller's own row). They are now an explicit,
  justified allowlist with a pinned size, so growth is a decision rather than a drift, and
  a stale entry for a renamed route fails the suite.
- **`AuthController` and `QuickbooksController` guard per-route, not per-class** — correct,
  since each mixes public and authenticated endpoints. The sweep accepts either and asserts
  what matters: no route is reachable with no guard at all.
- **`leases.unitId` is `ON DELETE SET NULL`.** Deleting a unit therefore leaves its leases
  behind pointing at neither a unit nor a building — rows that violate the service's
  "exactly one of" rule and that nothing cleans up. Not fixed here; worth a decision.
- **The API throttles at 10 req/s**, which parallel E2E fixtures blow straight through. The
  spec runs serially and paces its setup; the throttle is right and the tests live within it.

## Remaining gaps, ranked

### ~~1. HTTP-layer tests~~ ✅ DONE — see above

<details><summary>Original entry</summary>

#### No HTTP-layer tests — the DTO and permission boundary is unverified

Everything is tested one layer *below* where requests actually arrive. Nothing verifies that:

- `@RequirePermissions('lease:edit')` is on `end-tenancy` and `assign-tenant` (it is — but a refactor could drop it and every test would still pass)
- `EndTenancyDto` rejects a malformed `terminationReason`
- `@Body() body: any` on tasks lets through whatever it likes

**What to add:** one `*.controller.spec.ts` per new controller using `Test.createTestingModule` with the service mocked. Assert the permission decorators, and run the DTOs through `ValidationPipe` directly.

```ts
it('rejects a termination reason outside the enum', async () => {
  const dto = plainToInstance(EndTenancyDto, {
    terminationDate: '2026-06-30', terminationReason: 'BECAUSE',
  });
  expect(await validate(dto)).not.toHaveLength(0);
});
```

**Effort:** ~1 day for both new modules. **Highest value per hour of anything on this list.**
</details>

### ~~2. DB constraints~~ ✅ DONE — see above

<details><summary>Original entry</summary>

#### The DB constraints are load-bearing and untested

`lease_unit_no_overlap`, `lease_termination_after_start`, `invoice_void_requires_voided_at` are the *real* enforcement — the service checks are a friendly fast path that can lose a race. All three were verified once, by hand, in a rolled-back psql transaction. Nothing re-verifies them, so a future migration could drop one silently.

**What to add:** a `*.integration.spec.ts` against a real Postgres (testcontainers, or a `prime_tracker_test` database), each case wrapped in a rolled-back transaction. The five checks I ran by hand on 2026-08-13 are already written — they just need to become a file.

**Effort:** ~1 day including CI wiring. Blocks nothing today; the risk is a silent regression six months out.
</details>

### ~~3. Transaction rollback~~ ✅ DONE — see above

<details><summary>Original entry</summary>

#### Transaction rollback is never exercised

Every spec stubs `$transaction` as `(fn) => fn(mockPrisma)` — a pass-through. So the central design claim of `endTenancy`, *"one transaction; a lease marked terminated whose schedule still runs is worse than a refusal"*, has **no test**. If `voidAfter` throws after the lease row is stamped, does the stamp roll back? Nobody knows.

Same for `assignTenant` and the task multi-unit relink.

**What to add:** either an integration test (see gap 2), or a unit test whose `$transaction` mock throws partway and asserts nothing was committed. The integration version is the honest one.
</details>

### ~~4. Zero frontend COMPONENT tests~~ ✅ DONE 2026-08-14 — 32 tests

vitest 2.x + testing-library + jsdom, in `apps/web`. **vitest is pinned to 2.x on
purpose**: vitest 3+ requires vite 6 and the app is on vite 5. Upgrading vite to gain a
test runner would be the tail wagging the dog.

`vitest.config.ts` is separate from `vite.config.ts`. The app config carries the dev
server, its API proxy and the Tailwind plugin — none of which a component test needs, and
the proxy in particular would have tests inheriting whichever API port is in `.env`.

**What was tested, and what was not.** Not snapshot tests — they rot and prove little.
Two things instead:

1. **`src/utils/tenancy.ts` (21 tests).** `tenancyState`, `changeDelta`,
   `summariseChanges` and `fmtChangeValue` were extracted out of the 1,700-line
   `UnitDetailPage` so they could be tested at all. They are pure and they are the answer
   to "is this tenant actually the tenant" — the exact logic that was wrong on 2026-08-13,
   when a unit reading AVAILABLE displayed a tenant whose lease had finished. The tests
   pin the distinction that fixed it: `OVERDUE_TO_CLOSE` is **not** `isPast`, because a
   date passing is not somebody telling you the tenant left.

2. **`HistoricalRecordControls` (11 tests).** R27's permission branching, across Sales /
   Founder / the-requester. This is logic that breaks silently: nothing throws when the
   wrong person is shown a delete button, and nothing throws when the right person is
   shown nothing at all.

Both suites were mutation-checked — breaking the "nobody approves their own request" rule
in the component makes exactly one test fail, so they are not theatre.

### ~~5. Playwright~~ ✅ DONE — 5 journeys, see above

<details><summary>Original entry</summary>

#### Playwright covers neither new feature

The 4 existing smoke tests are login/dashboard/health. Two journeys are worth adding, because they cross more layers than anything else and they are exactly what a demo would show:

- **End a tenancy:** unit page → End tenancy → early-exit warning appears → submit → unit reads AVAILABLE, timeline shows `tenancy_end`, ledger shows VOID rows
- **Board:** project → Updates Board → add a multi-unit item → post a dated update → open the unit page → item appears with the "shared with" badge

Both are already scripted as the manual E2E runs from this cycle. **Effort:** ~1 day.
</details>

### 6. 🟡 The seed fixture is not a test

`seed-construction-board.ts` builds the right data but asserts nothing. `prisma/qa-unit-history-check.ts` is the precedent worth copying — it runs the real service against a live DB with 64 assertions and exits non-zero. A `qa-construction-board-check.ts` would make the fixture self-verifying.

---

## How to run

```bash
pnpm --filter @prime-tracker/api test               # 1424 unit tests, no dependencies
pnpm --filter @prime-tracker/api test:integration   # 25, needs Postgres; skips loudly without one
pnpm --filter @prime-tracker/api test:all           # both
pnpm --filter @prime-tracker/web test               # 32 component tests, no dependencies
pnpm --filter @prime-tracker/web exec playwright test   # 9, needs API + web running
```

**CI must set `CI=1`** for the integration suite. Without it a machine with no database
skips every constraint check and still reports green — which is exactly how a dropped
constraint would reach production. With `CI` set, the suite fails instead. GitHub Actions
sets `CI=true` itself, so this is satisfied there.

### CI actually runs these now (2026-08-14)

Until this date it did not. `.github/workflows/deploy.yml` validated the Prisma schema and
built both apps — **no test of any kind ran on any push or PR.** 1,400 unit tests, the
constraint suite and the E2E journeys all existed and none of them gated a merge.

The `ci` job now runs a Postgres 16 service container and, in order: validate schema →
build shared → generate client → **`prisma migrate deploy`** (which proves the
hand-written migrations still apply in order to an empty database, something nothing else
checks) → API unit → API integration → web component → build API → build web.

Playwright is deliberately **not** in that job: it needs both servers and a seeded
database, so it belongs in its own, rather than making every PR wait on a browser
download.

## Deliberately not covered

- **Snapshot tests** — they rot and assert nothing about behaviour.
- **Coverage-percentage targets** — this repo's tests are good because they encode *reasons*; a percentage target rewards the opposite.
- **The 19 spec-less modules** — pre-existing, and not something this cycle should absorb.

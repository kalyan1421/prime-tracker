# Building Detail — make it operational

**Status:** Draft for review
**Date:** 2026-08-06
**Route:** `/projects/:id/buildings/:buildingId` — `apps/web/src/pages/BuildingDetailPage.tsx`

---

## The headline finding

**This is a wiring job, not a build.** Nearly every capability requested already exists on
the API and is simply not reachable from the building page. An audit of the four asks:

| Capability | Backend | Frontend hook | Reachable from building page |
|---|---|---|---|
| Add / edit units in a building | `POST /units`, `PUT /units/:id`, `GET /units?buildingId=` — all exist | `useCreateUnit`, `useUpdateUnit`, `useUnits` | **No** |
| Edit building details | `PUT /buildings/:id` exists | `useUpdateBuilding` (used by the Construction tab) | **No** |
| Loans on a building | `POST /loans` accepts `buildingId`; `LoansService.findByBuilding()` written | `useCreateLoan`, `useLoans` | **Read-only, project-scoped** |
| Document upload | `POST /documents` and `GET /documents?buildingId=` exist | `useUploadDocument`, `useDocuments` | **Read-only** |

Only **one** genuinely missing backend piece was found:

> `LoansService.findByBuilding()` (`loans.service.ts:43`) has no controller route. The
> method was written and never exposed — the same "built but never called" pattern that
> left `notifyNewComment()` dormant since the notifications module shipped, and left the
> lead↔unit interest join unpopulated. Worth treating as a class of defect, not three
> coincidences.

Practical consequence: the estimate is small, and almost all of it is UI.

---

## Problem statement

A building is the unit of work for a project manager — it has its own phase, its own
budget, its own loan, its own drawings and permits. The building page shows all of that
and lets the user change none of it. Every action has to be performed from a different
screen that is organised by project, so the user has to hold "which building was I in"
in their head and re-find it in a list.

Concretely, to add a unit to Building B2 today: leave the building page → Construction
tab → Units tab → open the Add Unit modal → re-select B2 from a dropdown. Five
navigations to do the single most common thing on the page.

**Who this affects:** PROJECT_MANAGER and CONSTRUCTION daily; FINANCE for the loan link;
LEGAL for documents.

**Cost of not solving:** the page is a dashboard nobody acts from, so it gets bypassed —
and the per-building phase, budget and deposit data it uniquely surfaces goes unread.

---

## Goals

1. **Every section on the page is actionable from the page.** A user who lands on a
   building can add a unit, correct the building's details, attach a loan and upload a
   document without navigating away.
2. **Unit creation from a building is a two-click path** (button → form with the building
   pre-selected and non-editable), down from five navigations.
3. **Building-scoped reads stop over-fetching.** The page currently pulls every unit and
   every loan in the project and filters client-side; it should ask for the building's.
4. **Every section has seed data that exercises it**, so a reviewer can open one seeded
   building and see all seven sections populated — including the states that are easy to
   get wrong (no cover photo, a building-level loan, a partly-paid deposit).

## Non-goals

- **Unit deletion / combine from this page.** `combine()` carries role rules (SALES is
  refused) and archives source units; it belongs with the bulk unit tools, not a detail
  page. Out of scope to keep the surface small.
- **Draw requests against a building loan.** Draws are project-level in the data model
  today; changing that is a schema conversation, not this spec.
- **A building-level budget editor.** The page shows budget rollups; editing budget lines
  stays in the project Budget tab where the approval flow lives.
- **Reordering or moving units between buildings.** Real requirement, separate feature —
  it needs a story for leases and sales that follow the unit.
- **Document versioning UI.** `DocumentVersion` exists; surfacing version history is its
  own piece of work. v1 uploads a new document.

---

## User stories

**Project manager**
- As a PM, I want to add a unit while looking at the building it belongs to, so I do not
  have to re-find the building in a project-wide list.
- As a PM, I want to correct a building's sqft/stories/phase from its own page, so a
  typo does not send me to another screen.
- As a PM, I want a unit I just added to appear in the unit grid immediately, so I can
  confirm it landed without reloading.

**Finance**
- As a finance user, I want to attach a loan to a specific building, so debt sits against
  the asset that secures it rather than the whole project.
- As a finance user, I want the building's loan balance tile to reflect a loan I just
  attached, so the page agrees with itself.

**Legal / document owner**
- As a legal user, I want to upload a permit or deed against the building, so it is found
  by whoever opens that building rather than by searching a project-wide document list.

**Edge cases**
- As a VIEWER, I want the page to be readable but show no write controls, so I am not
  offered actions that will 403.
- As any user, I want a building with no units to tell me so and offer to add the first
  one, rather than showing an empty grid.
- As any user, I want an upload that fails to say so and leave the page usable.

---

## Requirements

### P0 — Must have

**R1. Add unit from the building page**
- An "Add unit" action in the Unit grid card header.
- Opens the existing unit form with `buildingId` fixed to the current building and not
  editable — the building is context here, not a choice.
- Reuses the unit form fields already used by the Units tab. No second definition of
  what a unit is.

*Acceptance*
- [ ] Given a building with 3 units, when I add a unit, then the grid shows 4 without a reload
- [ ] Given the form is open, then the building is displayed and cannot be changed
- [ ] Given a duplicate unit number within the building, then the API's error is surfaced inline, not as a bare toast
- [ ] Given I lack `unit:edit`, then the action is not rendered

**R2. Edit unit from the unit grid**
- Clicking a unit in the grid opens it for edit (or navigates to the unit page — see
  Open Questions Q1).

**R3. Edit building details**
- An edit action in the page header opening the existing building form (name, LLC, sqft,
  acreage, stories, type, phase, cover photo).
- Same component as the Construction tab's editor, so cover-photo upload comes free.

*Acceptance*
- [ ] Given I change the phase, then the header chip and the project's rolled-up phase both update
- [ ] Given I upload a cover photo, then the building card in the Construction tab shows it
- [ ] Given I lack `building:edit`, then the action is not rendered

**R4. Attach a loan to the building**
- "Add loan" in the Linked loans card, posting `buildingId`.
- **Backend:** add `GET /loans?buildingId=` routing to the existing
  `LoansService.findByBuilding()`; guard `loan:view` like its sibling.
- **Frontend:** `useLoans` gains an optional `buildingId`.

*Acceptance*
- [ ] Given I attach a loan, then it appears in Linked loans and in the Loan balance tile
- [ ] Given the project has loans not tied to this building, then they do NOT appear here
- [ ] Given I lack `loan:view`, then the whole card is absent (the hook already gates this)

**R5. Upload a document to the building**
- Upload control in the Documents card, posting `buildingId`.
- Reuses `useUploadDocument` and the same category picker as the project Documents tab.

*Acceptance*
- [ ] Given I upload a PDF, then it appears in the list with its category and uploader
- [ ] Given the upload fails, then an error is shown and the page stays usable
- [ ] Given I lack `document:view`, then the card is absent

**R6. Building-scoped fetching**
- `useUnits` passes `buildingId` when given one (the API already supports it).
- Replaces "fetch every unit in the project, filter in the browser".

**R7. Seed data covering every section**
- One fully-populated building so all seven sections render, plus deliberately chosen
  states that catch layout and empty-state bugs:
  - a building **with** a cover photo and one **without** (regression guard for the card
    alignment fix in `cf19a3e`)
  - units across at least four statuses, so the Unit Status Mix shows a real mix
  - a **building-level** loan and a project-level one, to prove the two do not bleed
  - a building-level lease and a unit-level lease (the Deposits card renders them as
    separate rows and that split is easy to get wrong)
  - a partly-paid deposit — the "Partly paid" chip and the outstanding figure
  - at least one document per category in use
  - a building with **zero** units, to exercise the empty state
- Idempotent and re-runnable, matching the existing seed scripts' conventions.

### P1 — Nice to have

- **R8.** Inline unit-status change from the grid (click a unit's chip to move it
  AVAILABLE → UNDER_CONTRACT), mirroring the lead status control added in `25cd5d1`.
- **R9.** Empty states with a call to action ("No units yet — add the first") rather than
  a bare message.
- **R10.** Deep-link the Documents card to the project Documents tab filtered to this
  building.

### P2 — Future

- **R11.** Move a unit between buildings (needs a story for the lease/sale that follows it).
- **R12.** Building-level draw requests (schema change).
- **R13.** Document version history on the building page.

---

## Success metrics

**Leading (measurable in the first two weeks)**
- Units created from the building page as a share of all unit creations — target **>40%**
  within 30 days. Measurable now: `AuditEvent` already records `CREATE`/`Units`; add the
  originating page to `metadata` when wiring R1.
- Building-page bounce rate: sessions that open a building and take no action. Target
  **below 60%**, from an assumed ~100% today (there is nothing to act on).

**Lagging**
- Buildings with a cover photo and a complete detail record — a proxy for whether people
  maintain building data once it is editable where they look at it. Target **>70%** of
  active buildings within a quarter.
- Support/"how do I" questions about adding units — should go to zero.

---

## Open questions

- **Q1 (design, blocking R2):** clicking a unit in the grid — open an edit modal in place,
  or navigate to the unit detail page? The unit page is richer (leases, comments,
  documents); the modal is faster for a correction. *Recommendation: navigate, and put
  edit on the unit page, since the grid is a status map rather than a table.*
- **Q2 (product, non-blocking):** should attaching a loan to a building also make it show
  in the project's loan list? Today `findByProject` filters on `projectId`, so a
  building-only loan is invisible at project level. That is arguably a bug, but changing
  it moves numbers on the project Overview.
- **Q3 (engineering, non-blocking):** `Unit.status` is a free `String` with a default, not
  an enum. Seeding four statuses is fine, but the lack of a DB constraint means a typo in
  any client writes an unrenderable status. Worth a follow-up.
- **Q4 (product, blocking R7):** should the seed extend the existing demo projects or add
  a dedicated "QA Building" project? *Recommendation: a dedicated project, so seeded
  edge cases cannot be mistaken for real client data.*

---

## Timeline and phasing

No hard external deadline. Suggested order — each phase is independently shippable:

1. **Phase 1 — reads and the missing route.** R4's backend route, R6's scoping. Small,
   no UI risk, unblocks the rest.
2. **Phase 2 — the two highest-frequency writes.** R1 (add unit) and R3 (edit building).
   These alone remove the five-navigation path.
3. **Phase 3 — finance and documents.** R4 frontend, R5.
4. **Phase 4 — seed data (R7).** Last, so it can cover what actually shipped; a reviewer
   then has one place that exercises every section.

**Dependency:** none outside this page. Every component to be reused (unit form, building
form, upload control, category picker) already exists.

---

## Notes for implementation

- The write controls must be gated on the **same permission the endpoint enforces**, not
  on role names. The permission sweep in `25cd5d1` removed the last role-name gates in
  this codebase; do not reintroduce one here. `useCan`-style gating in `useApi.ts` already
  prevents 403s on the read side.
- Reuse the existing forms rather than copying them. `EMPTY_BUILDING` and the unit form in
  `ProjectDetailPage.tsx` are the canonical definitions; a second copy will drift.
- The page is already permission-gated at the route (`building:view`, `App.tsx:88`), so
  section-level gating only needs to cover the write actions.

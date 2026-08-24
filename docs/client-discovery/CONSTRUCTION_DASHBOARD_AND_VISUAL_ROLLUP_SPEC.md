# Construction Dashboard + Visual Stage Rollup — Spec

**Status:** Locked — client answered all open questions 2026-08-22 (see Decisions Log). Ready to build.
**Date:** 2026-08-22
**Builds on:** the Unit Construction Checklist shipped 2026-08-21 (`construction-checklist` module —
`ConstructionStageTemplateItem` per building, `UnitConstructionStage` per unit). See
[[prime-tracker-nnn-monthly-and-checklist-spec]] for that build's history.
**Grounded against:** `apps/web/src/components/UnitConstructionChecklist.tsx`,
`ConstructionTemplateEditor.tsx`, `ConstructionChecklistRollup.tsx`,
`apps/api/src/modules/construction-checklist/`, `apps/web/src/pages/ConstructionDashboardPage.tsx`,
and `docs/client-discovery/INTERIOR_MODULE_DESIGN.md`.

---

## Problem Statement

The checklist that shipped yesterday gives each unit a fixed, ordered stage list (per the client's
Monday.com board screenshots), but two roles can't use it the way they need to yet. A CONSTRUCTION or
PROJECT_MANAGER user updating a stage from the field has to navigate Projects → project → Units tab →
unit detail → scroll to the checklist section — there's no fast "which project, which unit, what's next"
entry point from their own dashboard. And when a Founder/PM opens a project's Construction tab,
`ConstructionChecklistRollup` renders one progress-bar card per unit ("14/22 stages, Next: Drywall") —
readable one unit at a time, but not a single glance-able picture of where every unit in the project
currently sits, and it has no way to show that a unit has moved from shell construction into interior
fit-out.

## Goals

1. A CONSTRUCTION/PM-role user can go from their dashboard to updating a specific unit's stage status in
   ≤3 clicks — no hunting through project tabs.
2. Opening a project's Construction tab shows every unit's current stage at a glance — a PM can tell
   who's stuck and on what stage without opening any single unit.
3. The stage list stays open-ended — a PM/CONSTRUCTION user can always add a new stage to a unit's
   checklist, not just the ones a template seeded.
4. No regression to the checklist edit permissions, template system, or `getProjectRollup` contract
   shipped yesterday — extend it, don't replace it.

## Non-Goals

- **Not** building interior stages in any form in this spec — client decided (2026-08-22) that interior
  checklists wait for the full Interior/Fit-Out module (`InteriorProject`, the 7-phase `InteriorPhase`
  enum, isolated TI budget, sub-contractor invoices, snagging, per-sqft Sale-linked billing) from
  `INTERIOR_MODULE_DESIGN.md`. No `track` field, no second checklist per unit, no interior UI in this
  build — see Decisions Log #1. This spec is Construction-track only.
- **Not** changing the `UnitStatus` enum or adding an `INTERIORS` unit status — that enum drives
  sales/leasing logic elsewhere and is out of scope here.
- **Not** building drag-and-drop Kanban editing (dragging a card between stage columns). The visual
  rollup is read-first with a lightweight status action, not a full board editor.
- **Not** fixing the owner/assignee picker gap (`useUsers()` returns empty for non-`user:manage` roles,
  i.e. CONSTRUCTION/PM can't be picked as an owner today) — pre-existing, tracked separately.
- **Not** adding a native mobile app or push notifications — responsive web only.

## User Stories

- As a **CONSTRUCTION worker**, I want to open my dashboard and see the projects/units that need a
  status update, so I don't click through Projects → Units → Unit Detail every time.
- As a **CONSTRUCTION worker**, I want to mark a stage Done/Working on it/Blocked, set an owner, and log
  inspection status inline, so a site update takes seconds.
- As a **CONSTRUCTION/PM user**, I want to add a stage that isn't on the template when a unit hits
  something unusual, without being blocked by a fixed list.
- As a **PROJECT_MANAGER/FOUNDER**, I want a project's Construction tab to show every unit's current
  stage in one visual, so I can spot who's behind without opening each unit.
- As a **PROJECT_MANAGER**, I want to click any unit in the rollup and land on its checklist to fix a
  stuck stage.
- As an **EXECUTIVE** (view-only), I want the same visual rollup without edit controls, so I can review
  progress without risk of changing anything.

## Requirements

### Must-Have (P0)

1. **Design pass before build.** Produce a static mock of the visual rollup (stage-progress-strip form,
   per Decisions Log #3) and confirm it with the client before writing rollup UI code. This is a gate,
   not a formality — the strip layout has to read correctly across buildings whose templates have
   different stage counts/names, which is exactly why it was chosen over columns; get that proven on a
   mock first.
2. **"Update Unit Progress" entry point on the Construction/PM dashboard**
   (`ConstructionDashboardPage.tsx`): project picker → unit list → tapping a unit deep-links to its
   checklist on Unit Detail (reuse the existing edit UI, don't fork it).
   - *Acceptance:* from dashboard load, reaching a saved stage update takes ≤3 clicks/taps.
3. **Redesign `ConstructionChecklistRollup` as a compact stage-progress strip per unit** — one row per
   unit, a horizontal strip of its stages colored by `construction_stage_status`, working regardless of
   how many stages or what labels that unit's building template uses (no assumption of a shared stage
   set across the project). Clicking a unit deep-links to its checklist.
   - *Acceptance:* a PM can tell, without opening a unit, which stage it's currently on, purely from the
     strip — for units on different buildings with different-length templates.
4. **Same visual for view-only roles, controls hidden.** EXECUTIVE (and any `checklist:view`-only role)
   sees the identical rollup and strip; only the edit affordances (status change, add-stage) are absent
   — no separate read-only layout to build/maintain.
5. **The stage list stays open-ended, never fixed.** Preserve and surface the existing ad-hoc "Add stage"
   capability (`POST /construction-checklist/unit/:unitId/stage`) in both the dashboard entry point flow
   and from the rollup's deep link — a PM/CONSTRUCTION user can add a new stage to a unit's checklist at
   any time, not just the ones seeded from the building template. Building templates likewise stay
   editable after creation (already true today — template edits don't retroactively touch existing
   units, which is correct and unchanged).
   - *Acceptance:* from the new dashboard flow, a user can reach "Add stage" on a unit without detouring
     through a different page than today's Unit Detail checklist section.
6. **Permissions unchanged.** `checklist:view` (EXECUTIVE, FOUNDER, SUPER_ADMIN) /
   `checklist:edit` (CONSTRUCTION, PROJECT_MANAGER, FOUNDER, SUPER_ADMIN) govern the rollup and the new
   dashboard entry point exactly as they govern the checklist today.

### Nice-to-Have (P1)

7. "My open items" badge on the Construction dashboard nav — stages assigned to me, not Done.
8. Filter/search inside the visual rollup (by building, by stage, "behind only").
9. Bulk stage-status update (mark several units' current stage Done at once) from the rollup.

### Future Considerations (P2)

10. Full `InteriorProject` module per `INTERIOR_MODULE_DESIGN.md` — isolated TI budget, sub-contractor
    invoices, snagging, per-sqft Sale-linked billing, document gates, and its own stage/phase tracking.
    Interior stages are entirely deferred to this future build (Decisions Log #1) — nothing in this spec
    is a stand-in for it.
11. Photo attachments per stage, mirroring `MilestonePhoto`/`TaskUpdate`.
12. Notification on stage status change (e.g. notify PM when a stage flips to Blocked) — needs a new
    `STAGE_*` notification type with the same compile-time classification guard as `TASK_ASSIGNED`.

## Success Metrics

**Leading (2–4 weeks):**
- % of CONSTRUCTION-role logins that use the new dashboard entry point to log a stage update (target
  60%+ of field updates go through it rather than the buried unit-detail path).
- Median clicks from dashboard load to a saved stage update (target ≤3).

**Lagging (1–2 months):**
- Reduction in "which unit is stuck?" questions PM/Founder ask Construction (qualitative, client
  check-in).
- Increase in checklist completeness (avg. % of stages with a non-null status) for projects that have
  entered lease-up/interior phase.

## Decisions Log (client answers, 2026-08-22)

1. **Interior stages wait for the full Interior/Fit-Out module.** No lightweight track, no `track`
   field, no second checklist in this build. When `InteriorProject` is eventually built per
   `INTERIOR_MODULE_DESIGN.md`, it owns interior stage tracking outright — this spec's checklist stays
   Construction-only. Confirms the module design's existing "interior is optional, no parallel work by
   default" rule: a unit is never auto-switched into interior tracking just because shell construction
   finished — that decision belongs to the future module's own gating, not to this checklist.
2. **Rollup visual form: compact stage-progress strip per unit**, not kanban columns — chosen
   specifically because it holds up across buildings whose templates have different stage counts/names.
   Needs a design pass (mock, client sign-off) before the rollup is built — see P0 #1.
3. **View-only rollup = same visual, controls hidden.** No separate layout for EXECUTIVE/read-only
   roles.
4. **The checklist is never a fixed list.** PM (and CONSTRUCTION, within their edit permission) can add
   new stages to a unit's checklist at any time, beyond whatever the building template seeded — this is
   already how `UnitConstructionChecklist.tsx`'s "Add stage" works today (`POST
   /construction-checklist/unit/:unitId/stage`); this build must keep that reachable from the new
   dashboard flow, not regress it into a fixed list. See P0 #5.

No open questions remain — all forks from the previous draft are resolved. Ready to build.

## Timeline Considerations

- No external dependency; can start immediately — additive to a system shipped in the same session
  yesterday, so risk is low. No schema migration needed (no `track` field, no interior model) — this is
  a UI/API-shape change on top of the existing checklist tables.
- Explicitly **not** entangled with the Interior/Fit-Out module + Sale Payment Schedule build (roadmap
  #1/#2) — that remains a separate, larger, finance-integrated effort, unblocked by this spec.
- Suggested phasing: P0 #1 (design mock + sign-off, blocking) → P0 #2 (dashboard entry point, can build
  in parallel with the mock) → P0 #3–6 (rollup build, after #1 signs off) — each independently testable
  against the existing suites (1943 API + 36 web passing as of yesterday).

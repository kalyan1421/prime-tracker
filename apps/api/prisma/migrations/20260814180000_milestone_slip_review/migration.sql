-- C3 / C4 — the PM review gate on a milestone slip cascade, and the lender draw date
-- that moves with it.
--
-- Client decision 2026-08-14:
--   "PM review the cascade first — when a milestone's due date slips, should every
--    dependent milestone's date shift automatically[?] send notification to PM and
--    admins also"                                  -> reviewed, not automatic.
--   "yes — draw date move along with it[,] slipped milestone is linked to a lender's
--    draw schedule"                                -> the draw date moves too.
--
-- Before this, MilestoneDepsService.propagateSlippage() wrote every dependent's new due
-- date transitively and immediately. Nobody approved it and nobody was told in advance.
--
-- Purely additive: two new tables, one new enum value, no column dropped or altered.

-- The pending-review alert. ACTION-tier, routed to the project's PM plus leadership.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MILESTONE_SLIP_PENDING_REVIEW';

CREATE TABLE "milestone_slip_proposals" (
    "id"             TEXT NOT NULL,
    "projectId"      TEXT NOT NULL,
    -- The milestone whose due date actually moved.
    "milestoneId"    TEXT NOT NULL,
    "oldDueDate"     TIMESTAMP(3) NOT NULL,
    "newDueDate"     TIMESTAMP(3) NOT NULL,
    "daysSlipped"    INTEGER NOT NULL,
    -- PENDING | APPROVED | REJECTED | SUPERSEDED | STALE
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    -- Nullable, unlike historical_record_deletions.requestedById: the gate matters more
    -- than the attribution. A date moved by an import must still raise a reviewable
    -- proposal rather than silently applying because no actor could be named.
    "requestedById"  TEXT,
    "requestedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById"    TEXT,
    "decidedAt"      TIMESTAMP(3),
    "decisionNote"   TEXT,
    "supersededById" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_slip_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "milestone_slip_proposals_supersededById_key"
    ON "milestone_slip_proposals"("supersededById");
-- "is one already pending for this milestone?" — the supersession lookup.
CREATE INDEX "milestone_slip_proposals_milestoneId_status_idx"
    ON "milestone_slip_proposals"("milestoneId", "status");
-- The PM's review queue.
CREATE INDEX "milestone_slip_proposals_projectId_status_requestedAt_idx"
    ON "milestone_slip_proposals"("projectId", "status", "requestedAt");

ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_proposals_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_proposals_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL on both actors: losing who asked or who approved is bad, but not a reason to
-- block removing a departed user. Unlike a deletion request, an approved slip proposal
-- has already been applied to the schedule — the schedule itself is the record.
ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_proposals_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_proposals_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_proposals_supersededById_fkey"
    FOREIGN KEY ("supersededById") REFERENCES "milestone_slip_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same rule as historical_deletion_decision_has_decider: a row that says APPROVED with no
-- approver is indistinguishable from one approved by nobody.
--
-- SUPERSEDED and STALE are exempt from the DECIDER half and only that half: they are
-- closed by the system (a second slip arrived / the schedule moved underneath), so there
-- is no person to name. Naming the requester there — the trick used for a withdrawn
-- deletion request — would be a lie: nobody decided anything.
ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_decision_has_decider"
    CHECK (
      "status" IN ('PENDING', 'SUPERSEDED', 'STALE')
      OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
    );

-- Every terminal row records WHEN it closed, human-decided or not. For APPROVED that
-- timestamp is also the moment the dates were written.
ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_terminal_has_closed_at"
    CHECK ("status" = 'PENDING' OR "decidedAt" IS NOT NULL);

-- A slip is a TRANSLATION of the sub-tree, so the delta is one number for the whole
-- proposal, and a zero/negative one is not a slip.
ALTER TABLE "milestone_slip_proposals"
    ADD CONSTRAINT "milestone_slip_days_positive"
    CHECK ("daysSlipped" > 0);

CREATE TABLE "milestone_slip_proposal_items" (
    "id"               TEXT NOT NULL,
    "proposalId"       TEXT NOT NULL,
    "milestoneId"      TEXT NOT NULL,
    "isTrigger"        BOOLEAN NOT NULL DEFAULT false,
    "depth"            INTEGER NOT NULL DEFAULT 0,
    -- The staleness baseline: the dates as observed when the proposal was computed.
    -- Approval re-reads the live rows and refuses if either has moved since.
    "currentDueDate"   TIMESTAMP(3) NOT NULL,
    "proposedDueDate"  TIMESTAMP(3) NOT NULL,
    -- C4 — the lender's date. Null when this milestone funds no draw.
    "drawScheduleId"   TEXT,
    "currentDrawDate"  TIMESTAMP(3),
    "proposedDrawDate" TIMESTAMP(3),

    CONSTRAINT "milestone_slip_proposal_items_pkey" PRIMARY KEY ("id")
);

-- One row per milestone per proposal. A diamond in the dependency graph reaches the same
-- milestone twice, and shifting it twice would double the delta.
CREATE UNIQUE INDEX "milestone_slip_proposal_items_proposalId_milestoneId_key"
    ON "milestone_slip_proposal_items"("proposalId", "milestoneId");
CREATE INDEX "milestone_slip_proposal_items_milestoneId_idx"
    ON "milestone_slip_proposal_items"("milestoneId");
CREATE INDEX "milestone_slip_proposal_items_drawScheduleId_idx"
    ON "milestone_slip_proposal_items"("drawScheduleId");

ALTER TABLE "milestone_slip_proposal_items"
    ADD CONSTRAINT "milestone_slip_proposal_items_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "milestone_slip_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "milestone_slip_proposal_items"
    ADD CONSTRAINT "milestone_slip_proposal_items_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting a draw schedule must not silently drop the milestone
-- row from a pending cascade. The staleness check then sees the missing link and refuses.
ALTER TABLE "milestone_slip_proposal_items"
    ADD CONSTRAINT "milestone_slip_proposal_items_drawScheduleId_fkey"
    FOREIGN KEY ("drawScheduleId") REFERENCES "draw_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The three draw columns move together or not at all. A row carrying a proposed lender
-- date with no schedule to write it to is unapplyable.
ALTER TABLE "milestone_slip_proposal_items"
    ADD CONSTRAINT "milestone_slip_item_draw_dates_together"
    CHECK (
      ("drawScheduleId" IS NULL AND "currentDrawDate" IS NULL AND "proposedDrawDate" IS NULL)
      OR ("drawScheduleId" IS NOT NULL AND "currentDrawDate" IS NOT NULL AND "proposedDrawDate" IS NOT NULL)
    );

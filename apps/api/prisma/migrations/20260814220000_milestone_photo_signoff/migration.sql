-- C6 — a milestone photo is evidence only once somebody has signed it off.
--
-- Client decision 2026-08-14:
--   "Uploading a photo today is purely evidence[;] milestone photos require a sign-off
--    before that phase counts as complete"          -> yes, require sign-off.
--
-- Before this, MilestonePhoto held nothing but the upload. A milestone could be marked
-- COMPLETED with a pile of photos nobody had ever looked at.
--
-- Purely additive: one new enum type, four columns on milestone_photos, three on
-- milestones, one index, two FKs, three CHECKs. Nothing dropped, nothing altered.

CREATE TYPE "MilestonePhotoReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Existing photos land on PENDING, which is the honest answer: nobody has reviewed them.
-- No grandfathering pass — already-COMPLETED milestones are untouched (the gate only
-- fires on the transition INTO COMPLETED), and an in-flight milestone genuinely does now
-- need its evidence looked at.
ALTER TABLE "milestone_photos"
    ADD COLUMN "reviewStatus" "MilestonePhotoReviewStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "milestone_photos" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "milestone_photos" ADD COLUMN "reviewedAt"   TIMESTAMP(3);
ALTER TABLE "milestone_photos" ADD COLUMN "reviewNote"   TEXT;

-- The completion gate's only query: the non-APPROVED photos of one milestone.
CREATE INDEX "milestone_photos_milestoneId_reviewStatus_idx"
    ON "milestone_photos"("milestoneId", "reviewStatus");

-- SET NULL: losing WHO approved is bad, but not a reason to block removing a departed
-- user. The verdict and its timestamp survive them, which is what the gate reads.
ALTER TABLE "milestone_photos"
    ADD CONSTRAINT "milestone_photos_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A decided photo records WHEN. Deliberately keyed on the timestamp and not on
-- "reviewedById": the FK above nulls that column when a user is deleted, and a CHECK on
-- the id would turn every departing employee into a failed DELETE.
ALTER TABLE "milestone_photos"
    ADD CONSTRAINT "milestone_photo_decided_has_timestamp"
    CHECK ("reviewStatus" = 'PENDING' OR "reviewedAt" IS NOT NULL);

-- A rejection has to say what the evidence fails to show, or the uploader cannot fix it.
ALTER TABLE "milestone_photos"
    ADD CONSTRAINT "milestone_photo_rejection_has_note"
    CHECK ("reviewStatus" <> 'REJECTED' OR btrim(coalesce("reviewNote", '')) <> '');

-- ---------------------------------------------------------------------------
-- The override, recorded next to the completion itself.
--
-- Same shape as every other gate in this codebase (building/unit force-delete, sale
-- cancellation, interior handover past open snags): overridable, never silently — the
-- reason is mandatory and it lives on the row people read.
-- ---------------------------------------------------------------------------
ALTER TABLE "milestones" ADD COLUMN "signoffOverrideById"    TEXT;
ALTER TABLE "milestones" ADD COLUMN "signoffOverrideAt"      TIMESTAMP(3);
ALTER TABLE "milestones" ADD COLUMN "signoffOverrideReason"  TEXT;

ALTER TABLE "milestones"
    ADD CONSTRAINT "milestones_signoffOverrideById_fkey"
    FOREIGN KEY ("signoffOverrideById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An override stamp with no reason is the thing this feature exists to prevent. Keyed on
-- the timestamp for the same reason as above: the actor FK may null out later.
ALTER TABLE "milestones"
    ADD CONSTRAINT "milestone_signoff_override_has_reason"
    CHECK (
      ("signoffOverrideAt" IS NULL AND "signoffOverrideReason" IS NULL)
      OR ("signoffOverrideAt" IS NOT NULL AND btrim(coalesce("signoffOverrideReason", '')) <> '')
    );

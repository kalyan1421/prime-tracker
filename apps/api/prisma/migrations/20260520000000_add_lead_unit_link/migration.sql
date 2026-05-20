-- Lead → Unit linkage
--
-- Adds an optional FK so a Lead can be tied to a specific Unit (in addition to
-- the existing free-text `unitInterest`). The text column is preserved for
-- backfill — a later step will parse it and populate `unitId` where it can
-- match `Unit.unitNumber` within the same project.
--
-- onDelete: SET NULL — deleting a unit must not cascade-delete sales history
-- captured on the lead. The lead's `convertedToSaleId` still points to the
-- original sale even if the unit is soft-deleted.

ALTER TABLE "leads"
    ADD COLUMN "unitId" TEXT;

ALTER TABLE "leads"
    ADD CONSTRAINT "leads_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "leads_unitId_idx" ON "leads"("unitId");

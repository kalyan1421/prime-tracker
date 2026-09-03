-- Work type is removed from the system: it no longer selects a checklist template
-- (ConstructionChecklistService.applyTemplate already resolves against the building's
-- stage list only), it is no longer one of the signals that puts a unit "on the tracker",
-- and it is no longer editable or filterable anywhere in the UI.

-- DropIndex
DROP INDEX "units_workType_idx";

-- AlterTable
ALTER TABLE "units" DROP COLUMN "workType";
